//! Produto e versão anunciados em `Server`, `X-Powered-By` e cabeçalhos semelhantes.
//!
//! Só os tokens `Produto/versão` são mantidos (caracteres restritos e tamanho limitado);
//! o restante do cabeçalho é descartado. As regras de versão sem suporte listam apenas
//! fatos públicos e estáveis, com a data de referência no texto do achado.

/// Tokens `Produto/1.2.3` do valor de um cabeçalho. Partes sem versão numérica são ignoradas.
pub fn tokens(value: &str, default_product: Option<&str>) -> Vec<(String, String)> {
    let name_ok = |s: &str| {
        !s.is_empty()
            && s.len() <= 32
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    };
    let version_ok = |s: &str| {
        s.len() <= 24
            && s.chars().next().is_some_and(|c| c.is_ascii_digit())
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    };
    let mut out: Vec<(String, String)> = vec![];
    for part in value.split_ascii_whitespace().take(16) {
        let part = part.trim_matches(|c: char| matches!(c, '(' | ')' | ',' | ';'));
        let (name, version) = match part.split_once('/') {
            Some((n, v)) => (n, v),
            None => match default_product {
                Some(product) => (product, part),
                None => continue,
            },
        };
        if name_ok(name) && version_ok(version) && !out.iter().any(|(n, _)| n == name) {
            out.push((name.to_string(), version.to_string()));
        }
        if out.len() >= 6 {
            break;
        }
    }
    out
}

/// Resumo persistível: `versions=Apache/2.4.49,PHP/7.4.3` ou `present (no version)`.
pub fn summary(value: &str, default_product: Option<&str>) -> String {
    let found = tokens(value, default_product);
    if found.is_empty() {
        "present (no version)".into()
    } else {
        format!(
            "versions={}",
            found
                .iter()
                .map(|(n, v)| format!("{n}/{v}"))
                .collect::<Vec<_>>()
                .join(",")
        )
    }
}

/// Lê os pares de um resumo produzido por [`summary`]. Resumos antigos retornam vazio.
pub fn summary_tokens(summary: &str) -> Vec<(&str, &str)> {
    summary
        .strip_prefix("versions=")
        .map(|list| list.split(',').filter_map(|t| t.split_once('/')).collect())
        .unwrap_or_default()
}

fn numbers(version: &str) -> (u32, u32, u32) {
    let mut parts = version.split(['.', '-', '_']).map(|p| {
        p.chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>()
            .parse::<u32>()
            .unwrap_or(0)
    });
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

/// Motivo pelo qual uma versão anunciada é um risco. `true` no segundo campo = falha crítica
/// conhecida (execução remota de código), que eleva a severidade.
pub fn outdated(product: &str, version: &str) -> Option<(&'static str, bool)> {
    let v = numbers(version);
    match product.to_ascii_lowercase().as_str() {
        "apache" if v == (2, 4, 49) || v == (2, 4, 50) => Some((
            "Apache 2.4.49/2.4.50 tem path traversal com execução remota de código (CVE-2021-41773 e CVE-2021-42013)",
            true,
        )),
        "apache" if (v.0, v.1) < (2, 4) => Some((
            "a série Apache 2.2 e anteriores não recebe correções de segurança desde 2018",
            false,
        )),
        "php" if (v.0, v.1) < (8, 2) => Some((
            "esta série do PHP não recebe mais correções de segurança (PHP 8.1 encerrou o suporte em 31/12/2025)",
            false,
        )),
        "microsoft-iis" if v.0 < 10 => Some((
            "IIS anterior ao 10 roda em Windows Server 2012 R2 ou mais antigo, sem suporte desde outubro de 2023",
            false,
        )),
        "openssl" if v.0 < 3 => Some((
            "OpenSSL anterior à série 3.x não recebe correções públicas (1.1.1 encerrou o suporte em setembro de 2023)",
            false,
        )),
        "python" | "cpython" if (v.0, v.1) < (3, 10) => Some((
            "esta série do Python não recebe mais correções de segurança (3.9 encerrou o suporte em outubro de 2025)",
            false,
        )),
        _ => None,
    }
}

/// Servidores de desenvolvimento que não devem atender tráfego de produção.
pub fn development_server(product: &str) -> Option<&'static str> {
    match product.to_ascii_lowercase().as_str() {
        "werkzeug" => Some("Werkzeug (servidor de desenvolvimento do Flask)"),
        "simplehttp" => Some("SimpleHTTP (python -m http.server)"),
        "wsgiserver" => Some("WSGIServer (runserver do Django)"),
        "webrick" => Some("WEBrick (servidor de desenvolvimento do Ruby)"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_extracted_and_sanitized() {
        let t = tokens("Apache/2.4.49 (Ubuntu) OpenSSL/1.1.1k PHP/7.4.3", None);
        assert_eq!(
            t,
            vec![
                ("Apache".to_string(), "2.4.49".to_string()),
                ("OpenSSL".to_string(), "1.1.1k".to_string()),
                ("PHP".to_string(), "7.4.3".to_string()),
            ]
        );
        assert!(tokens("cloudflare", None).is_empty());
        assert!(tokens("Evil/<script>alert(1)</script>", None).is_empty());
        assert_eq!(
            tokens("4.0.30319", Some("ASP.NET")),
            vec![("ASP.NET".to_string(), "4.0.30319".to_string())]
        );
    }

    #[test]
    fn summary_round_trip() {
        let s = summary("nginx/1.18.0 (Ubuntu)", None);
        assert_eq!(s, "versions=nginx/1.18.0");
        assert_eq!(summary_tokens(&s), vec![("nginx", "1.18.0")]);
        assert_eq!(summary("gws", None), "present (no version)");
        assert!(summary_tokens("present (value not stored)").is_empty());
    }

    #[test]
    fn known_unsupported_versions() {
        assert!(outdated("Apache", "2.4.49").unwrap().1);
        assert!(!outdated("Apache", "2.2.34").unwrap().1);
        assert!(outdated("Apache", "2.4.62").is_none());
        assert!(outdated("PHP", "7.4.3").is_some());
        assert!(outdated("PHP", "8.1.2-1ubuntu2.14").is_some());
        assert!(outdated("PHP", "8.3.4").is_none());
        assert!(outdated("Microsoft-IIS", "8.5").is_some());
        assert!(outdated("Microsoft-IIS", "10.0").is_none());
        assert!(outdated("OpenSSL", "1.1.1k").is_some());
        assert!(outdated("OpenSSL", "3.0.13").is_none());
        assert!(outdated("Python", "2.7.18").is_some());
        assert!(outdated("nginx", "1.18.0").is_none());
        assert!(development_server("Werkzeug").is_some());
        assert!(development_server("gunicorn").is_none());
    }
}
