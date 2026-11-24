//! Análise passiva: avalia o que o navegador do usuário **já recebeu** (cabeçalhos da
//! navegação principal e HTML renderizado), sem fazer nenhuma requisição nova.
//! Usada pela extensão de navegador via Native Messaging. Verificações que exigem
//! conexão própria (TLS, descoberta, sondas ativas) ficam como não executadas.

use crate::{detectors, facts_from, page};
use scanner_core::{CheckResult, CheckStatus, Finding, HttpObservation};
use serde::{Deserialize, Serialize};
use url::Url;

/// Limites de entrada: protegem o processo contra mensagens grandes ou malformadas.
pub const MAX_URL: usize = 2048;
pub const MAX_HEADERS: usize = 200;
pub const MAX_HEADER_VALUE: usize = 8 * 1024;
pub const MAX_HTML: usize = crate::discovery::PAGE_LIMIT;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PassiveInput {
    pub url: String,
    /// Status HTTP da navegação principal, quando o navegador o observou.
    #[serde(default)]
    pub status: Option<u16>,
    /// Cabeçalhos da resposta principal; ausentes quando a extensão não tem permissão.
    #[serde(default)]
    pub headers: Option<Vec<(String, String)>>,
    /// HTML do documento renderizado (DOM), já truncado pela extensão.
    #[serde(default)]
    pub html: Option<String>,
    #[serde(default)]
    pub html_truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PassiveReport {
    pub url: String,
    pub headers_observed: bool,
    pub html_observed: bool,
    pub checks: Vec<CheckResult>,
    pub findings: Vec<Finding>,
}

fn not_run(id: &str, resource: &str, reason: &str) -> CheckResult {
    CheckResult {
        detector_id: id.into(),
        detector_version: "1.0.0".into(),
        resource: resource.into(),
        status: CheckStatus::NotRun,
        reason: reason.into(),
        findings: vec![],
    }
}

pub fn validate_url(raw: &str) -> Result<Url, String> {
    if raw.len() > MAX_URL {
        return Err("URL acima do limite.".into());
    }
    let url = Url::parse(raw).map_err(|_| "URL inválida.")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Somente páginas http(s) podem ser analisadas.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URL com credenciais não é aceita.".into());
    }
    Ok(url)
}

pub fn analyze(input: PassiveInput) -> Result<PassiveReport, String> {
    let mut url = validate_url(&input.url)?;
    // Query e fragmento podem carregar tokens; não fazem parte do relatório.
    url.set_query(None);
    url.set_fragment(None);
    let resource = url.to_string();
    let mut checks = vec![];

    let headers_observed = input.headers.is_some();
    match input.headers {
        Some(headers) => {
            if headers.len() > MAX_HEADERS {
                return Err("Cabeçalhos acima do limite.".into());
            }
            if headers
                .iter()
                .any(|(n, v)| n.len() > 256 || v.len() > MAX_HEADER_VALUE)
            {
                return Err("Cabeçalho acima do limite.".into());
            }
            let lower: Vec<(String, &str)> = headers
                .iter()
                .map(|(n, v)| (n.trim().to_ascii_lowercase(), v.as_str()))
                .collect();
            let (facts, cookies) = facts_from(
                |name| {
                    lower
                        .iter()
                        .find(|(n, _)| n == name)
                        .map(|(_, v)| *v)
                },
                lower
                    .iter()
                    .filter(|(n, _)| n == "set-cookie")
                    .map(|(_, v)| *v),
            );
            let observation = HttpObservation {
                url: resource.clone(),
                status: input.status.unwrap_or(200),
                elapsed_ms: 0,
                headers: facts,
                cookies,
                tls: None,
                tls_probe: None,
            };
            checks.extend(detectors::analyze(&observation));
        }
        None => checks.push(not_run(
            "headers.observed",
            &resource,
            "Cabeçalhos não observados: permita a leitura de cabeçalhos na extensão e recarregue a página.",
        )),
    }

    let html_observed = input.html.is_some();
    match input.html {
        Some(html) => {
            if html.len() > MAX_HTML + 4096 {
                return Err("HTML acima do limite.".into());
            }
            let findings = page::analyze(&html, &url);
            let complete = !input.html_truncated;
            checks.push(CheckResult {
                detector_id: "page.content".into(),
                detector_version: "1.0.0".into(),
                resource: resource.clone(),
                status: if !complete {
                    CheckStatus::Error
                } else if findings.is_empty() {
                    CheckStatus::Passed
                } else {
                    CheckStatus::Finding
                },
                reason: if complete {
                    "Análise do HTML renderizado na aba: recursos externos, bibliotecas, conteúdo misto, formulários e segredos."
                } else {
                    "HTML acima de 1 MiB; achados limitados ao prefixo lido e cobertura inconclusiva."
                }
                .into(),
                findings,
            });
        }
        None => checks.push(not_run(
            "page.content",
            &resource,
            "HTML da aba não disponível.",
        )),
    }

    checks.push(not_run(
        "active.checks",
        &resource,
        "Análise passiva: descoberta de arquivos, TLS e testes ativos só rodam no app, com autorização.",
    ));
    let findings = checks.iter().flat_map(|c| c.findings.clone()).collect();
    Ok(PassiveReport {
        url: resource,
        headers_observed,
        html_observed,
        checks,
        findings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(headers: Option<Vec<(&str, &str)>>, html: Option<&str>) -> PassiveInput {
        PassiveInput {
            url: "https://loja.example/conta?token=abc#x".into(),
            status: Some(200),
            headers: headers.map(|h| {
                h.into_iter()
                    .map(|(n, v)| (n.to_string(), v.to_string()))
                    .collect()
            }),
            html: html.map(str::to_string),
            html_truncated: false,
        }
    }

    #[test]
    fn strips_query_and_fragment_from_resource() {
        let report = analyze(input(None, None)).unwrap();
        assert_eq!(report.url, "https://loja.example/conta");
        assert!(!report.headers_observed);
        assert!(report.findings.is_empty());
    }

    #[test]
    fn missing_headers_and_insecure_session_cookie_become_findings() {
        let report = analyze(input(
            Some(vec![
                ("Content-Type", "text/html"),
                ("Set-Cookie", "sessionid=[redigido]; Path=/"),
            ]),
            None,
        ))
        .unwrap();
        let ids: Vec<_> = report
            .findings
            .iter()
            .map(|f| f.detector_id.as_str())
            .collect();
        assert!(ids.contains(&"headers.csp"), "{ids:?}");
        assert!(ids.iter().any(|id| id.starts_with("cookies")), "{ids:?}");
        // TLS nunca é avaliado no modo passivo.
        assert!(report
            .checks
            .iter()
            .filter(|c| c.detector_id.starts_with("tls."))
            .all(|c| matches!(c.status, CheckStatus::NotRun)));
    }

    #[test]
    fn header_names_are_case_insensitive() {
        let csp = "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
        let report = analyze(input(Some(vec![("CONTENT-SECURITY-POLICY", csp)]), None)).unwrap();
        assert!(!report
            .findings
            .iter()
            .any(|f| f.detector_id == "headers.csp"));
    }

    #[test]
    fn rejects_non_http_urls_credentials_and_oversized_input() {
        for url in [
            "file:///etc/passwd",
            "chrome://settings",
            "https://u:p@site.example/",
        ] {
            let mut i = input(None, None);
            i.url = url.into();
            assert!(analyze(i).is_err(), "{url}");
        }
        let many = vec![("x-a", "b"); MAX_HEADERS + 1];
        assert!(analyze(input(Some(many), None)).is_err());
        let big = "a".repeat(MAX_HEADER_VALUE + 1);
        assert!(analyze(input(Some(vec![("x-a", big.as_str())]), None)).is_err());
    }

    #[test]
    fn truncated_html_is_inconclusive() {
        let mut i = input(None, Some("<html><body>ok</body></html>"));
        i.html_truncated = true;
        let report = analyze(i).unwrap();
        let page = report
            .checks
            .iter()
            .find(|c| c.detector_id == "page.content")
            .unwrap();
        assert!(matches!(page.status, CheckStatus::Error));
    }
}
