//! Leak Hunter works on local strings only. Values are discarded before a finding is built.
use crate::{SourceFinding, SECRETS_DETECTOR_VERSION};
use scanner_core::Severity;
use sha2::{Digest, Sha256};

fn entropy(value: &str) -> f64 {
    let mut frequencies = [0usize; 256];
    for byte in value.bytes() {
        frequencies[byte as usize] += 1;
    }
    let length = value.len() as f64;
    frequencies
        .iter()
        .filter(|n| **n > 0)
        .map(|n| {
            let p = *n as f64 / length;
            -p * p.log2()
        })
        .sum()
}

fn placeholder(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "example",
        "placeholder",
        "changeme",
        "replace_me",
        "your_key",
        "your_token",
        "test-only",
        "dummy",
        "redacted",
        "process.env",
        "os.environ",
        "${",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn literal<'a>(path: &str, value: &'a str) -> Option<&'a str> {
    let value = value.trim();
    if value.starts_with(['\'', '"', '`']) {
        let quote = value.as_bytes()[0];
        let mut escaped = false;
        for (index, byte) in value.bytes().enumerate().skip(1) {
            if escaped {
                escaped = false;
                continue;
            }
            if byte == b'\\' {
                escaped = true;
                continue;
            }
            if byte == quote {
                return Some(&value[1..index]);
            }
        }
        None
    } else if path
        .rsplit('/')
        .next()
        .is_some_and(|name| name == ".env" || name.starts_with(".env."))
    {
        Some(
            value
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_end_matches([';', ',']),
        )
    } else {
        None
    }
}

fn jwt_role(value: &str) -> Option<String> {
    let mut segments = value.split('.');
    let _header = segments.next()?;
    let payload = segments.next()?;
    let _signature = segments.next()?;
    if segments.next().is_some() || payload.len() > 4096 || payload.len() % 4 == 1 {
        return None;
    }
    let mut decoded = Vec::new();
    let mut accumulator = 0u32;
    let mut bits = 0u32;
    for byte in payload.bytes().take_while(|b| *b != b'=') {
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            _ => return None,
        };
        accumulator = (accumulator << 6) | u32::from(digit);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            decoded.push((accumulator >> bits) as u8);
        }
    }
    let value: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    value
        .get("role")?
        .as_str()
        .filter(|role| role.len() < 64)
        .map(str::to_string)
}

fn public_key(value: &str, firebase_context: bool) -> bool {
    value.starts_with("sb_publishable_")
        || (firebase_context && value.starts_with("AIza"))
        || jwt_role(value).is_some_and(|role| role == "anon")
}

fn credential(
    kind: &str,
    rule_id: &str,
    path: &str,
    line: usize,
    confidence: &str,
    severity: Severity,
) -> SourceFinding {
    SourceFinding {
        id: format!("{:x}", Sha256::digest(format!("{rule_id}|{path}|{line}"))),
        rule_id: rule_id.into(), detector_version: SECRETS_DETECTOR_VERSION.into(),
        title: format!("Leak Hunter: {kind}"),
        description: "Um padrão de credencial foi observado em um arquivo local. Isso não prova validade, exposição pública ou uso indevido; valide a origem sem divulgar o valor.".into(),
        category: "secrets".into(), severity, confidence: confidence.into(), path: path.into(), line,
        evidence: format!("{kind} na linha {line}. Valor e prefixo completamente ocultados; conteúdo da linha não armazenado."),
        impact: "Se a credencial for real e tiver sido compartilhada, alguém poderá usar os privilégios associados. Um arquivo local ou uma fixture não demonstra acesso externo.".into(),
        recommendation: "Confirme a finalidade sem copiar a credencial. Se for real e exposta, revogue/rotacione no fornecedor, remova o literal e o histórico compartilhado e use variáveis de ambiente ou um cofre. Não basta apagar o arquivo.".into(),
        verification: "Revogue a credencial anterior, substitua-a por uma nova fora do código, execute os testes funcionais e repita o Leak Hunter. Verifique também o histórico Git e os artefatos publicados por um processo autorizado separado.".into(),
        suggested_fix: None,
        reference: "CWE-798 — https://cwe.mitre.org/data/definitions/798.html".into(),
    }
}

pub fn analyze_line(
    path: &str,
    line: &str,
    number: usize,
    firebase_context: bool,
) -> Option<SourceFinding> {
    if line.contains("-----BEGIN ") && line.contains("PRIVATE KEY-----") {
        return Some(credential(
            "possível chave privada",
            "leaks.private-key",
            path,
            number,
            "pattern",
            Severity::High,
        ));
    }
    for word in line.split(|c: char| !c.is_ascii_alphanumeric() && !"_-.".contains(c)) {
        if placeholder(word) {
            continue;
        }
        let github_classic = word.strip_prefix("ghp_").is_some_and(|body| {
            (40..=255).contains(&word.len()) && body.bytes().all(|b| b.is_ascii_alphanumeric())
        });
        let aws = word
            .strip_prefix("AKIA")
            .or_else(|| word.strip_prefix("ASIA"))
            .is_some_and(|body| {
                word.len() == 20
                    && word
                        .bytes()
                        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
                    && entropy(body) >= 2.0
            });
        let known = if github_classic
            || (word.starts_with("github_pat_")
                && (40..=255).contains(&word.len())
                && entropy(word) >= 3.0)
        {
            Some((
                "possível token GitHub",
                "secrets.possible-credential",
                Severity::High,
            ))
        } else if aws {
            Some((
                "identificador de chave AWS",
                "secrets.possible-credential",
                Severity::Medium,
            ))
        } else if word.starts_with("sb_secret_") && word.len() >= 24 && entropy(word) >= 3.0 {
            Some((
                "possível chave privilegiada Supabase",
                "leaks.supabase-service-key",
                Severity::High,
            ))
        } else if (word.starts_with("sk_live_") || word.starts_with("sk_test_"))
            && word.len() >= 24
            && entropy(word) >= 3.0
        {
            Some(("possível chave Stripe", "leaks.stripe-key", Severity::High))
        } else if word.starts_with("eyJ")
            && jwt_role(word).is_some_and(|role| role == "service_role")
        {
            Some((
                "JWT com papel service_role declarado",
                "leaks.supabase-service-key",
                Severity::High,
            ))
        } else {
            None
        };
        if let Some((kind, rule, severity)) = known {
            return Some(credential(kind, rule, path, number, "pattern", severity));
        }
    }
    let (key, value) = line.split_once('=').or_else(|| line.split_once(':'))?;
    let key = key.to_ascii_lowercase();
    let value = literal(path, value)?;
    if value.len() > 1024 || public_key(value, firebase_context) || placeholder(value) {
        return None;
    }
    let password = key.contains("password") || key.contains("passwd");
    let token = [
        "api_key",
        "apikey",
        "secret",
        "access_token",
        "accesskey",
        "access_key",
        "auth_token",
        "bearer_token",
    ]
    .iter()
    .any(|word| key.contains(word));
    if (password && value.len() >= 4 && !value.contains(['(', '{']))
        || (token && value.len() >= 16 && entropy(value) >= 3.2 && !value.contains([' ', '(', '{']))
    {
        return Some(credential(
            "possível credencial literal",
            "secrets.possible-credential",
            path,
            number,
            "contextual",
            Severity::High,
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn entropy_needs_credential_context_and_values_are_never_retained() {
        let value = "A9xQ2vL8mR4cT6zN1pS5uW3k";
        assert!(analyze_line(
            "src/app.ts",
            &format!("const checksum = '{value}';"),
            1,
            false
        )
        .is_none());
        let finding = analyze_line(
            "src/app.ts",
            &format!("const api_key = '{value}';"),
            2,
            false,
        )
        .unwrap();
        assert_eq!(finding.confidence, "contextual");
        assert!(!serde_json::to_string(&finding).unwrap().contains(value));
        assert!(analyze_line(".env", "API_KEY=replace_me_with_your_key", 1, false).is_none());
        assert!(analyze_line(
            "src/app.ts",
            "const api_key = process.env.API_KEY;",
            1,
            false
        )
        .is_none());
    }
    #[test]
    fn legitimate_public_keys_are_not_credentials_by_themselves() {
        assert!(analyze_line(
            "src/config.ts",
            "const apiKey = 'AIzaSyA9xQ2vL8mR4cT6zN1pS5uW3k';",
            1,
            true
        )
        .is_none());
        assert!(analyze_line(
            ".env",
            "API_KEY=sb_publishable_A9xQ2vL8mR4cT6zN1pS5uW3k",
            1,
            false
        )
        .is_none());
        let anon = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature";
        assert!(analyze_line(
            "src/config.ts",
            &format!("const api_key = '{anon}';"),
            1,
            false
        )
        .is_none());
        let privileged = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";
        let finding = analyze_line(
            "src/config.ts",
            &format!("const key = '{privileged}';"),
            1,
            false,
        )
        .unwrap();
        assert_eq!(finding.rule_id, "leaks.supabase-service-key");
        assert!(!format!("{finding:?}").contains(privileged));
    }
    #[test]
    fn hardcoded_development_password_is_reviewable_without_requiring_entropy() {
        assert!(analyze_line(".env.local", "DB_PASSWORD=admin123", 1, false).is_some());
        assert!(analyze_line("src/app.ts", "const password = '';", 1, false).is_none());
        assert!(analyze_line(
            "src/app.ts",
            "const password = 'example-password';",
            1,
            false
        )
        .is_none());
    }
    #[test]
    fn malformed_or_large_jwt_payloads_are_not_decoded() {
        assert!(jwt_role("a.invalid!.c").is_none());
        assert!(jwt_role(&format!("a.{}.c", "x".repeat(5000))).is_none());
    }
}
