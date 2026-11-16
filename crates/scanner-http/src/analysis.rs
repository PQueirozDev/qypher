//! Análise de valores de cabeçalhos em memória. Só os diagnósticos (códigos fixos)
//! são persistidos; o valor bruto do cabeçalho nunca sai destas funções.

/// Códigos de problema em uma Content-Security-Policy. Ordem estável.
pub fn csp_issues(value: &str) -> Vec<&'static str> {
    let mut directives: Vec<(String, Vec<String>)> = vec![];
    for part in value.split(';').take(64) {
        let mut tokens = part.split_ascii_whitespace();
        if let Some(name) = tokens.next() {
            let name = name.to_ascii_lowercase();
            // A primeira ocorrência de uma diretiva prevalece (CSP3 §2.2.1).
            if !directives.iter().any(|(n, _)| *n == name) {
                directives.push((
                    name,
                    tokens.take(128).map(|t| t.to_ascii_lowercase()).collect(),
                ));
            }
        }
    }
    let get = |n: &str| directives.iter().find(|(d, _)| d == n).map(|(_, s)| s);
    let default = get("default-src");
    let script = get("script-src").or(default);
    let mut issues = vec![];
    match script {
        None => issues.push("script-src-missing"),
        Some(src) => {
            let has_nonce_or_hash = src.iter().any(|s| {
                s.starts_with("'nonce-")
                    || s.starts_with("'sha256-")
                    || s.starts_with("'sha384-")
                    || s.starts_with("'sha512-")
            });
            let strict_dynamic = src.iter().any(|s| s == "'strict-dynamic'");
            // Com nonce/hash, navegadores CSP2+ ignoram 'unsafe-inline'.
            if src.iter().any(|s| s == "'unsafe-inline'") && !has_nonce_or_hash {
                issues.push("script-unsafe-inline");
            }
            if src.iter().any(|s| s == "'unsafe-eval'") {
                issues.push("script-unsafe-eval");
            }
            // Com 'strict-dynamic', listas de hosts são ignoradas por navegadores modernos.
            if !strict_dynamic
                && src
                    .iter()
                    .any(|s| matches!(s.as_str(), "*" | "http:" | "https:" | "data:" | "blob:"))
            {
                issues.push("script-wildcard-source");
            }
        }
    }
    let object_none = get("object-src")
        .or(default)
        .is_some_and(|s| s.len() == 1 && s[0] == "'none'");
    if !object_none {
        issues.push("object-src-not-none");
    }
    if get("base-uri").is_none() {
        issues.push("base-uri-missing");
    }
    if get("frame-ancestors").is_none() {
        issues.push("frame-ancestors-missing");
    }
    issues
}

/// Resumo persistível de CSP: `issues=a,b` ou `issues=none`.
pub fn csp_summary(value: &str) -> String {
    let issues = csp_issues(value);
    if issues.is_empty() {
        "issues=none".into()
    } else {
        format!("issues={}", issues.join(","))
    }
}

/// Lê os códigos de um resumo produzido por [`csp_summary`].
/// Resumos antigos (`present (value not stored)`) retornam `None`.
pub fn csp_summary_issues(summary: &str) -> Option<Vec<&str>> {
    let list = summary.strip_prefix("issues=")?;
    Some(if list == "none" {
        vec![]
    } else {
        list.split(',').collect()
    })
}

#[derive(Debug, PartialEq, Eq)]
pub struct Hsts {
    pub max_age: u64,
    pub include_subdomains: bool,
    pub preload: bool,
}

pub fn hsts_parse(value: &str) -> Option<Hsts> {
    let mut max_age = None;
    let (mut include_subdomains, mut preload) = (false, false);
    for part in value.split(';').take(16) {
        let part = part.trim();
        if let Some((k, v)) = part.split_once('=') {
            if k.trim().eq_ignore_ascii_case("max-age") && max_age.is_none() {
                max_age = v.trim().trim_matches('"').parse::<u64>().ok();
            }
        } else if part.eq_ignore_ascii_case("includesubdomains") {
            include_subdomains = true;
        } else if part.eq_ignore_ascii_case("preload") {
            preload = true;
        }
    }
    Some(Hsts {
        max_age: max_age.filter(|n| *n > 0)?,
        include_subdomains,
        preload,
    })
}

/// Resumo persistível: `max-age=N;includeSubDomains;preload` ou `invalid`.
pub fn hsts_summary(value: &str) -> String {
    match hsts_parse(value) {
        None => "invalid".into(),
        Some(h) => {
            let mut s = format!("max-age={}", h.max_age);
            if h.include_subdomains {
                s.push_str(";includeSubDomains");
            }
            if h.preload {
                s.push_str(";preload");
            }
            s
        }
    }
}

/// Mínimo recomendado para HSTS: 180 dias (exigência do preload list: 1 ano).
pub const HSTS_MIN_MAX_AGE: u64 = 15_552_000;

pub fn x_frame_options_summary(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "deny" => "deny",
        "sameorigin" => "sameorigin",
        _ => "invalid",
    }
}

pub fn vary_summary(value: &str) -> &'static str {
    if value
        .split(',')
        .any(|v| v.trim().eq_ignore_ascii_case("origin") || v.trim() == "*")
    {
        "origin"
    } else {
        "other"
    }
}

/// Retorna true quando um cookie com prefixo `__Secure-`/`__Host-` viola as regras do prefixo.
pub fn cookie_prefix_violation(name: &str, attrs: &[String], secure: bool) -> bool {
    if name.starts_with("__Host-") {
        let has_domain = attrs.iter().any(|a| a.starts_with("domain="));
        let path_root = attrs.iter().any(|a| a == "path=/");
        !secure || has_domain || !path_root
    } else if name.starts_with("__Secure-") {
        !secure
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strong_csp_has_no_issues() {
        let csp = "default-src 'self'; script-src 'nonce-abc' 'strict-dynamic' 'unsafe-inline' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";
        assert!(csp_issues(csp).is_empty(), "{:?}", csp_issues(csp));
    }

    #[test]
    fn weak_csp_is_flagged() {
        let issues = csp_issues("default-src * 'unsafe-inline' 'unsafe-eval'");
        for code in [
            "script-unsafe-inline",
            "script-unsafe-eval",
            "script-wildcard-source",
            "object-src-not-none",
            "base-uri-missing",
            "frame-ancestors-missing",
        ] {
            assert!(issues.contains(&code), "{code} ausente em {issues:?}");
        }
    }

    #[test]
    fn csp_without_script_or_default_src() {
        assert!(csp_issues("img-src 'self'").contains(&"script-src-missing"));
    }

    #[test]
    fn first_duplicate_directive_wins() {
        let issues = csp_issues("script-src 'self'; script-src 'unsafe-eval'");
        assert!(!issues.contains(&"script-unsafe-eval"));
    }

    #[test]
    fn csp_summary_round_trip() {
        let s = csp_summary("script-src 'self' 'unsafe-eval'");
        assert!(!s.contains("self"), "valor bruto não deve vazar: {s}");
        let issues = csp_summary_issues(&s).unwrap();
        assert!(issues.contains(&"script-unsafe-eval"));
        assert_eq!(csp_summary_issues("present (value not stored)"), None);
    }

    #[test]
    fn hsts_parsing() {
        assert_eq!(
            hsts_parse("max-age=31536000; includeSubDomains; preload"),
            Some(Hsts {
                max_age: 31_536_000,
                include_subdomains: true,
                preload: true
            })
        );
        assert_eq!(hsts_parse("max-age=0"), None);
        assert_eq!(hsts_parse("includeSubDomains"), None);
        assert_eq!(hsts_summary("max-age=\"300\""), "max-age=300");
    }

    #[test]
    fn cookie_prefixes() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(!cookie_prefix_violation(
            "__Host-id",
            &a(&["secure", "path=/"]),
            true
        ));
        assert!(cookie_prefix_violation(
            "__Host-id",
            &a(&["secure", "path=/", "domain=example.com"]),
            true
        ));
        assert!(cookie_prefix_violation("__Secure-id", &a(&[]), false));
        assert!(!cookie_prefix_violation("session", &a(&[]), false));
    }
}
