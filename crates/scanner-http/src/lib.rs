pub mod analysis;
pub mod detectors;
pub mod discovery;
pub mod lab;
pub mod page;
pub mod passive;
pub mod probes;
pub mod software;
pub mod tls;
use chrono::{DateTime, Utc};
use reqwest::{header::HeaderMap, redirect::Policy, Client};
use scanner_core::*;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    net::SocketAddr,
    time::{Duration, Instant},
};
use tokio::net::lookup_host;
use tokio_util::sync::CancellationToken;
use url::Url;
use x509_parser::prelude::*;

pub use tokio_util::sync::CancellationToken as ScanCancellation;

/// Um redirecionamento é "canônico" (mesmo site) quando só muda o esquema (http→https)
/// ou alterna o prefixo `www.` do host. Nesses casos seguir é seguro e esperado;
/// qualquer outro destino continua exigindo nova autorização do usuário.
fn canonical_redirect(from: &Url, to: &Url) -> bool {
    match (from.host_str(), to.host_str()) {
        (Some(a), Some(b)) => {
            let bare = |h: &str| h.strip_prefix("www.").unwrap_or(h).to_ascii_lowercase();
            bare(a) == bare(b)
        }
        _ => false,
    }
}

/// Identificação enviada em todos os pedidos, para o dono do alvo reconhecer a auditoria.
pub(crate) const USER_AGENT: &str = concat!(
    "Qypher/",
    env!("CARGO_PKG_VERSION"),
    " (authorized security audit)"
);

fn header_facts(headers: &HeaderMap) -> (BTreeMap<String, String>, Vec<CookieFact>) {
    facts_from(
        |name| headers.get(name).and_then(|h| h.to_str().ok()),
        headers
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok()),
    )
}

/// Resumo de cabeçalhos e cookies a partir de qualquer fonte (resposta própria ou
/// cabeçalhos já recebidos pelo navegador). Valores sensíveis nunca são guardados.
pub(crate) fn facts_from<'a>(
    get: impl Fn(&str) -> Option<&'a str>,
    set_cookies: impl Iterator<Item = &'a str>,
) -> (BTreeMap<String, String>, Vec<CookieFact>) {
    let mut facts = BTreeMap::new();
    for name in [
        "strict-transport-security",
        "content-security-policy",
        "x-content-type-options",
        "referrer-policy",
        "permissions-policy",
        "access-control-allow-origin",
        "access-control-allow-credentials",
        "content-security-policy-report-only",
        "x-frame-options",
        "vary",
        "server",
        "x-powered-by",
        "x-aspnet-version",
        "x-aspnetmvc-version",
    ] {
        // Vários cabeçalhos CSP são combinados pelo navegador; analisamos o primeiro,
        // que é o comportamento conservador para relatar fraquezas.
        if let Some(value) = get(name).filter(|v| !v.trim().is_empty()) {
            let summary: String = match name {
                "strict-transport-security" => analysis::hsts_summary(value),
                "content-security-policy" | "content-security-policy-report-only" => {
                    analysis::csp_summary(value)
                }
                "x-frame-options" => analysis::x_frame_options_summary(value).into(),
                "vary" => analysis::vary_summary(value).into(),
                "x-content-type-options" => {
                    if value.trim().eq_ignore_ascii_case("nosniff") {
                        "nosniff".into()
                    } else {
                        "invalid".into()
                    }
                }
                "access-control-allow-origin" => match value.trim() {
                    "*" => "wildcard".into(),
                    "null" => "null".into(),
                    _ => "specific origin (redacted)".into(),
                },
                "access-control-allow-credentials" => {
                    if value.trim().eq_ignore_ascii_case("true") {
                        "true".into()
                    } else {
                        "other".into()
                    }
                }
                // Só os tokens Produto/versão são mantidos; o restante é descartado.
                "server" | "x-powered-by" => software::summary(value, None),
                "x-aspnet-version" => software::summary(value, Some("ASP.NET")),
                "x-aspnetmvc-version" => software::summary(value, Some("ASP.NET-MVC")),
                _ => "present (value not stored)".into(),
            };
            facts.insert(name.to_string(), summary);
        }
    }
    let cookies = set_cookies
        .take(64)
        .map(|v| {
            let mut parts = v.split(';');
            let name = clean(
                parts
                    .next()
                    .and_then(|p| p.split_once('='))
                    .map(|(n, _)| n.trim())
                    .unwrap_or("[invalid]"),
                64,
            );
            let attrs: Vec<_> = parts.map(|p| p.trim().to_ascii_lowercase()).collect();
            let secure = attrs.iter().any(|p| p == "secure");
            let prefix_violation = analysis::cookie_prefix_violation(&name, &attrs, secure);
            let same_site_none = attrs.iter().any(|p| {
                p.split_once('=')
                    .is_some_and(|(k, v)| k.trim() == "samesite" && v.trim() == "none")
            });
            CookieFact {
                name,
                secure,
                prefix_violation,
                same_site_none,
                http_only: attrs.iter().any(|p| p == "httponly"),
                same_site: attrs.iter().any(|p| {
                    p.split_once('=').is_some_and(|(k, v)| {
                        k.trim() == "samesite"
                            && (matches!(v.trim(), "lax" | "strict")
                                || (v.trim() == "none" && secure))
                    })
                }),
            }
        })
        .collect();
    (facts, cookies)
}

/// Resolve o host e valida todos os endereços pela política de rede.
/// Mesma fronteira usada pelo cliente HTTP e pelas sondas TLS.
pub(crate) async fn resolve_checked(
    url: &Url,
    config: &ScanConfig,
    cancel: &CancellationToken,
) -> Result<Vec<SocketAddr>, String> {
    let host = url.host_str().ok_or("Host ausente")?;
    let port = url.port_or_known_default().ok_or("Porta ausente")?;
    let addrs: Vec<SocketAddr> = if let Some(ip) = literal_ip(url) {
        vec![SocketAddr::new(ip, port)]
    } else {
        tokio::select! {
            biased;
            _=cancel.cancelled()=>return Err("cancelled".into()),
            resolved=tokio::time::timeout(Duration::from_secs(config.timeout_seconds),lookup_host((host,port)))=>
                resolved.map_err(|_|"Timeout na resolução DNS")?.map_err(|_|"Falha na resolução DNS")?.collect()
        }
    };
    if addrs.len() > 64 {
        return Err(
            "DNS retornou endereços demais; conexão recusada por limite de recursos.".into(),
        );
    }
    if addrs.is_empty()
        || addrs
            .iter()
            .any(|a| !address_allowed(a.ip(), config.allow_private))
    {
        return Err(
            "Destino bloqueado pela política de rede (privado, reservado ou metadados).".into(),
        );
    }
    Ok(addrs)
}

async fn checked_client(
    url: &Url,
    config: &ScanConfig,
    cancel: &CancellationToken,
) -> Result<Client, String> {
    let addrs = resolve_checked(url, config, cancel).await?;
    client_for_addresses(url, config, &addrs)
}

fn client_for_addresses(
    url: &Url,
    config: &ScanConfig,
    addrs: &[SocketAddr],
) -> Result<Client, String> {
    let host = url.host_str().ok_or("Host ausente")?;
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .resolve_to_addrs(host, addrs)
        .timeout(Duration::from_secs(config.timeout_seconds))
        .connect_timeout(Duration::from_secs(config.timeout_seconds))
        .tls_info(true)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| "Falha ao inicializar cliente TLS".into())
}

pub async fn run(
    mut scan: Scan,
    cancel: CancellationToken,
    progress: impl Fn(&Scan) + Send + Sync,
) -> Scan {
    let result = execute(&mut scan, &cancel, &progress).await;
    match result {
        Ok(()) => {
            scan.status = ScanStatus::Completed;
            scan.risk = risk_for_scan(&scan);
            scan.log("scan.completed","Análise concluída. Cobertura limitada à resposta HTTP e redirecionamentos permitidos.",LogLevel::Info);
        }
        Err(e) if e == "cancelled" => {
            scan.status = ScanStatus::Cancelled;
            scan.log(
                "scan.cancelled",
                "Cancelamento confirmado. Nenhuma nova requisição será iniciada.",
                LogLevel::Warn,
            );
        }
        Err(e) => {
            scan.status = ScanStatus::Failed;
            scan.error = Some(e.clone());
            scan.log("scan.failed", &e, LogLevel::Error);
        }
    }
    scan.finished_at = Some(Utc::now().to_rfc3339());
    progress(&scan);
    scan
}

async fn execute(
    scan: &mut Scan,
    cancel: &CancellationToken,
    progress: &(impl Fn(&Scan) + Send + Sync),
) -> Result<(), String> {
    let mut url = scan.config.validate().map_err(|e| e.to_string())?;
    scan.log(
        "policy.validated",
        "Autorização, URL e prefixo de caminho validados.",
        LogLevel::Info,
    );
    progress(scan);
    for redirect in 0..=scan.config.max_redirects {
        if cancel.is_cancelled() {
            return Err("cancelled".into());
        }
        scan.config.check_url(&url).map_err(|e| e.to_string())?;
        if scan.request_count >= scan.config.max_requests {
            return Err(
                "Orçamento de requisições esgotado antes de concluir os redirecionamentos.".into(),
            );
        }
        let client = checked_client(&url, &scan.config, cancel).await?;
        if cancel.is_cancelled() {
            return Err("cancelled".into());
        }
        scan.request_count += 1;
        scan.log(
            "http.request",
            &format!(
                "GET #{}: destino validado e resolução DNS fixada.",
                scan.request_count
            ),
            LogLevel::Info,
        );
        progress(scan);
        let start = Instant::now();
        let response = tokio::select! {
            biased;
            _=cancel.cancelled()=>return Err("cancelled".into()),
            result=client.get(url.clone()).send()=>result.map_err(|e|
                if e.is_timeout() {"Timeout HTTP/TLS."} else if e.is_connect() {"Falha de conexão ou validação TLS. Certificados inválidos não são aceitos."} else {"Falha de protocolo HTTP."})?
        };
        let tls = response
            .extensions()
            .get::<reqwest::tls::TlsInfo>()
            .and_then(|t| t.peer_certificate())
            .and_then(|der| {
                let (_, cert) = parse_x509_certificate(der).ok()?;
                let expires = DateTime::from_timestamp(cert.validity().not_after.timestamp(), 0)?;
                let facts = tls::cert_facts(&cert);
                Some(TlsObservation {
                    certificate_sha256: format!("{:x}", Sha256::digest(der)),
                    expires_at: expires.to_rfc3339(),
                    days_remaining: (expires - Utc::now()).num_days(),
                    issuer: clean(&cert.issuer().to_string(), 256),
                    key_algorithm: facts.key_algorithm,
                    key_bits: facts.key_bits,
                    signature_algorithm: facts.signature_algorithm,
                    weak_signature: facts.weak_signature,
                    validity_days: facts.validity_days,
                    wildcard: facts.wildcard,
                })
            });
        // Sondas de handshake apenas para HTTPS, com orçamento e autorização já concedidos.
        // Só ClientHello é enviado; nenhum dado de aplicação trafega.
        let tls_probe = if scan.config.active_checks
            && url.scheme() == "https"
            && tls.is_some()
            && scan.request_count.saturating_add(tls::PROBE_CONNECTIONS) <= scan.config.max_requests
        {
            if let Ok(resolved) = resolve_checked(&url, &scan.config, cancel).await {
                if let Some(addr) = resolved.first().copied() {
                    scan.request_count = scan.request_count.saturating_add(tls::PROBE_CONNECTIONS);
                    let host = url.host_str().unwrap_or_default().to_string();
                    let t = Duration::from_secs(scan.config.timeout_seconds);
                    let probe = tokio::select! {
                        biased;
                        _=cancel.cancelled()=>return Err("cancelled".into()),
                        p=tls::probe_all(addr, &host, t)=>p,
                    };
                    scan.log(
                        "tls.probe",
                        "Sondas de versão/cifra TLS concluídas (apenas ClientHello).",
                        LogLevel::Info,
                    );
                    Some(probe)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        if response.headers().get_all("set-cookie").iter().count() > 64
            || response
                .headers()
                .get_all("set-cookie")
                .iter()
                .any(|v| v.to_str().is_err())
        {
            return Err(
                "Cabeçalhos de cookies inválidos ou acima do limite de 64; cobertura inconclusiva."
                    .into(),
            );
        }
        let (headers, cookies) = header_facts(response.headers());
        let observation = HttpObservation {
            url: url.to_string(),
            status: response.status().as_u16(),
            elapsed_ms: start.elapsed().as_millis() as u64,
            headers,
            cookies,
            tls,
            tls_probe,
        };
        let checks = detectors::analyze(&observation);
        scan.findings
            .extend(checks.iter().flat_map(|c| c.findings.clone()));
        scan.checks.extend(checks);
        scan.log(
            "http.response",
            &format!(
                "Resposta HTTP {} recebida; corpo não armazenado.",
                observation.status
            ),
            LogLevel::Info,
        );
        scan.observations.push(observation);
        progress(scan);
        if response.status().is_redirection() {
            if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
                return Ok(());
            }
            let location = response
                .headers()
                .get("location")
                .ok_or("Redirecionamento sem Location.")?
                .to_str()
                .map_err(|_| "Location inválido.")?;
            // Join and validate before any DNS lookup or connection to the next hop.
            let next = url
                .join(location)
                .map_err(|_| "URL de redirecionamento inválida.")?;
            if next.origin() != url.origin() && matches!(next.scheme(), "http" | "https") {
                if canonical_redirect(&url, &next) {
                    // Mesmo site (http→https ou apex↔www): seguir é seguro e esperado.
                    scan.log(
                        "redirect.canonical",
                        &format!(
                            "Redirecionamento canônico seguido para {} (mesmo site).",
                            next.origin().ascii_serialization()
                        ),
                        LogLevel::Info,
                    );
                    scan.config.url = next.to_string();
                    scan.config.path_prefix = "/".into();
                } else {
                    // Outro site: a origem de destino não é segredo e permite autorizar o endereço certo.
                    return Err(format!(
                        "O site redireciona para {} — fora do endereço autorizado. Analise esse endereço.",
                        next.origin().ascii_serialization()
                    ));
                }
            }
            scan.config.check_url(&next).map_err(|e| e.to_string())?;
            if redirect == scan.config.max_redirects {
                return Err("Limite de redirecionamentos atingido.".into());
            }
            url = next;
        } else {
            return deep_checks(scan, &url, &client, response, cancel, progress).await;
        }
    }
    Err("Limite de redirecionamentos atingido.".into())
}

/// Fases opcionais sobre a resposta final, cada uma com consentimento próprio na configuração.
async fn deep_checks(
    scan: &mut Scan,
    url: &Url,
    client: &Client,
    response: reqwest::Response,
    cancel: &CancellationToken,
    progress: &(impl Fn(&Scan) + Send + Sync),
) -> Result<(), String> {
    let mut scripts = vec![];
    if scan.config.discovery {
        let is_html = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.to_ascii_lowercase().contains("html"));
        if is_html {
            let body = discovery::read_for_check(
                scan,
                "page.content",
                url,
                response,
                discovery::PAGE_LIMIT,
                cancel,
            )
            .await?;
            if let Some(body) = body {
                let complete = body.complete;
                let body = String::from_utf8_lossy(&body.bytes);
                let findings = page::analyze(&body, url);
                scripts = page::same_origin_scripts(&body, url);
                scan.log(
                    "page.analyzed",
                    &format!(
                        "HTML analisado em memória ({} achado(s)); corpo descartado.",
                        findings.len()
                    ),
                    LogLevel::Info,
                );
                scan.checks.push(CheckResult {
                detector_id: "page.content".into(),
                detector_version: "1.0.0".into(),
                resource: url.to_string(),
                status: if !complete { CheckStatus::Error } else if findings.is_empty() {
                    CheckStatus::Passed
                } else {
                    CheckStatus::Finding
                },
                reason: if complete { "Análise estática do HTML: recursos externos, bibliotecas, conteúdo misto, formulários e segredos." } else { "HTML acima de 1 MiB; achados limitados ao prefixo lido e cobertura inconclusiva." }.into(),
                findings: findings.clone(),
            });
                scan.findings.extend(findings);
            }
        }
        discovery::exposures(scan, url, client, &scripts, cancel, progress).await?;
    }
    if scan.config.active_checks {
        discovery::active(scan, url, client, cancel).await?;
        probes::http_redirect(scan, url, cancel).await?;
        progress(scan);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };
    async fn fixture(response: &'static str) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut data = [0; 2048];
                    let _ = socket.read(&mut data).await;
                    if !response.is_empty() {
                        let _ = socket.write_all(response.as_bytes()).await;
                    } else {
                        tokio::time::sleep(Duration::from_secs(10)).await;
                    }
                });
            }
        });
        (url, task)
    }
    fn config(url: String) -> ScanConfig {
        ScanConfig {
            project_id: "test".into(),
            url,
            authorized: true,
            allow_private: true,
            path_prefix: "/".into(),
            max_requests: 3,
            max_redirects: 2,
            timeout_seconds: 2,
            discovery: false,
            active_checks: false,
        }
    }
    #[tokio::test]
    async fn real_http_is_analyzed_without_cookie_values() {
        let (url,task)=fixture("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nServer: fixture\r\nSet-Cookie: session=secret-value; SameSite=None\r\n\r\n").await;
        let s = run(Scan::new(config(url)), CancellationToken::new(), |_| {}).await;
        task.abort();
        assert_eq!(s.status, ScanStatus::Completed);
        assert_eq!(s.request_count, 1);
        let cookie = s
            .findings
            .iter()
            .find(|f| f.detector_id == "cookies.attributes")
            .expect("deveria avaliar os atributos do cookie");
        // 'session' sem HttpOnly/Secure é tratado como provável cookie de sessão (peso maior).
        assert_eq!(cookie.severity, Severity::Medium);
        assert!(cookie.evidence.contains("provável cookie de sessão"));
        assert!(!format!("{s:?}").contains("secret-value"));
        assert!(s
            .checks
            .iter()
            .any(|c| c.detector_id == "tls.expiry" && c.status == CheckStatus::NotRun));
    }
    #[tokio::test]
    async fn header_values_are_analyzed_but_not_stored() {
        let (url,task)=fixture("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nContent-Security-Policy: default-src 'self' https://cdn-secreto.example 'unsafe-inline'\r\nAccess-Control-Allow-Origin: null\r\nAccess-Control-Allow-Credentials: true\r\nSet-Cookie: __Host-id=v; Path=/app\r\n\r\n").await;
        let s = run(Scan::new(config(url)), CancellationToken::new(), |_| {}).await;
        task.abort();
        assert_eq!(s.status, ScanStatus::Completed);
        for id in [
            "headers.csp-strength",
            "headers.framing",
            "cors.credentials",
            "cookies.prefix",
        ] {
            assert!(
                s.findings.iter().any(|f| f.detector_id == id),
                "{id} deveria gerar achado"
            );
        }
        assert!(!format!("{s:?}").contains("cdn-secreto"));
    }
    /// Servidor vulnerável de teste: expõe .git/HEAD, reflete Origin e serve HTML com CDN sem SRI.
    async fn vulnerable_fixture() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut data = [0; 4096];
                    let n = socket.read(&mut data).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&data[..n]).to_string();
                    let line = request.lines().next().unwrap_or_default().to_string();
                    let origin = request
                        .lines()
                        .find_map(|l| l.strip_prefix("origin: ").or(l.strip_prefix("Origin: ")))
                        .map(|o| o.trim().to_string());
                    let (status, ctype, body) = if line.starts_with("GET / ") {
                        ("200 OK", "text/html", "<html><script src=\"https://cdn.example/jquery-1.9.0.min.js\"></script><input type=\"password\"></html>")
                    } else if line.starts_with("GET /.git/HEAD ") {
                        ("200 OK", "text/plain", "ref: refs/heads/main\n")
                    } else if line.starts_with("OPTIONS ") {
                        ("204 No Content", "text/plain", "")
                    } else {
                        // soft-404: responde 200 com HTML genérico para qualquer caminho
                        (
                            "200 OK",
                            "text/html",
                            "<!doctype html><html>nao encontrado</html>",
                        )
                    };
                    let cors = origin
                        .map(|o| format!("Access-Control-Allow-Origin: {o}\r\nAccess-Control-Allow-Credentials: true\r\n"))
                        .unwrap_or_default();
                    let response = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nAllow: GET, PUT, DELETE\r\n{cors}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        (url, task)
    }
    #[tokio::test]
    async fn discovery_and_active_checks_find_real_weaknesses() {
        let (url, task) = vulnerable_fixture().await;
        let mut c = config(url);
        c.max_requests = MAX_REQUESTS;
        c.discovery = true;
        c.active_checks = true;
        let s = run(Scan::new(c), CancellationToken::new(), |_| {}).await;
        task.abort();
        assert_eq!(s.status, ScanStatus::Completed, "{:?}", s.error);
        let ids: Vec<_> = s.findings.iter().map(|f| f.detector_id.as_str()).collect();
        for id in [
            "exposure.git-head",
            "page.sri",
            "page.outdated-library",
            "page.password-over-http",
            "active.cors-reflection",
            "active.cors-null",
            "active.http-methods",
            "disclosure.security-txt",
        ] {
            assert!(ids.contains(&id), "{id} ausente em {ids:?}");
        }
        // O soft-404 (200 com HTML genérico) não pode virar falso positivo.
        assert_eq!(
            ids.iter().filter(|i| i.starts_with("exposure.")).count(),
            1,
            "{ids:?}"
        );
        let git = s
            .findings
            .iter()
            .find(|f| f.detector_id == "exposure.git-head")
            .unwrap();
        // Uma prévia mascarada do conteúdo exposto é anexada para o responsável conferir,
        // sem jamais mostrar o valor inteiro.
        assert!(
            git.sample.is_some(),
            "A prévia do conteúdo exposto deveria ser capturada."
        );
        assert!(
            !serde_json::to_string(&s)
                .unwrap()
                .contains("refs/heads/main"),
            "O valor inteiro nunca deve atravessar o modelo (apenas a prévia mascarada)."
        );
        let cors = s
            .findings
            .iter()
            .find(|f| f.detector_id == "active.cors-reflection")
            .unwrap();
        assert_eq!(cors.severity, Severity::Medium);
        assert_eq!(cors.classification, "configuration");
        assert_eq!(cors.confidence, "observed");
        assert!(s.request_count <= MAX_REQUESTS);
    }
    #[tokio::test]
    async fn deep_phases_are_off_without_consent() {
        let (url, task) = vulnerable_fixture().await;
        let mut c = config(url);
        c.max_requests = 60;
        let s = run(Scan::new(c), CancellationToken::new(), |_| {}).await;
        task.abort();
        assert_eq!(s.request_count, 1);
        assert!(!s
            .findings
            .iter()
            .any(|f| f.detector_id.starts_with("exposure.")
                || f.detector_id.starts_with("active.")
                || f.detector_id.starts_with("page.")));
    }
    #[tokio::test]
    async fn discovery_respects_budget_and_path_prefix() {
        let (url, task) = vulnerable_fixture().await;
        let mut c = config(url);
        c.max_requests = 4;
        c.discovery = true;
        let s = run(Scan::new(c), CancellationToken::new(), |_| {}).await;
        task.abort();
        assert_eq!(s.status, ScanStatus::Completed);
        assert_eq!(s.request_count, 4);
        assert!(s
            .checks
            .iter()
            .any(|c| c.status == CheckStatus::NotRun && c.reason.contains("Orçamento")));
    }
    #[test]
    fn canonical_redirect_recognizes_same_site_only() {
        let u = |s: &str| Url::parse(s).unwrap();
        // http→https e apex↔www são o mesmo site.
        assert!(canonical_redirect(
            &u("http://exemplo.com/"),
            &u("https://exemplo.com/")
        ));
        assert!(canonical_redirect(
            &u("https://exemplo.com/"),
            &u("https://www.exemplo.com/")
        ));
        assert!(canonical_redirect(
            &u("https://www.exemplo.com/"),
            &u("https://exemplo.com/a")
        ));
        // Outro domínio ou subdomínio de serviço NÃO é canônico.
        assert!(!canonical_redirect(
            &u("https://exemplo.com/"),
            &u("https://app.exemplo.com/")
        ));
        assert!(!canonical_redirect(
            &u("https://meusite.com.br/"),
            &u("https://meusite.vercel.app/")
        ));
    }
    #[tokio::test]
    async fn redirect_out_of_scope_is_never_requested() {
        let (url,task)=fixture("HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data/\r\nContent-Length: 0\r\n\r\n").await;
        let s = run(Scan::new(config(url)), CancellationToken::new(), |_| {}).await;
        task.abort();
        assert_eq!(s.status, ScanStatus::Failed);
        assert_eq!(s.request_count, 1);
    }
    #[tokio::test]
    async fn private_target_needs_separate_consent() {
        let mut c = config("http://127.0.0.1:1234/".into());
        c.allow_private = false;
        let s = run(Scan::new(c), CancellationToken::new(), |_| {}).await;
        assert_eq!(s.status, ScanStatus::Failed);
        assert_eq!(s.request_count, 0);
    }
    #[tokio::test]
    async fn cancellation_interrupts_pending_response() {
        let (url, task) = fixture("").await;
        let cancel = CancellationToken::new();
        let token = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(80)).await;
            token.cancel();
        });
        let start = Instant::now();
        let s = run(Scan::new(config(url)), cancel, |_| {}).await;
        task.abort();
        assert_eq!(s.status, ScanStatus::Cancelled);
        assert!(start.elapsed() < Duration::from_secs(1));
    }
    #[tokio::test]
    async fn budget_limits_redirect_loops() {
        let (url, task) =
            fixture("HTTP/1.1 302 Found\r\nLocation: /\r\nContent-Length: 0\r\n\r\n").await;
        let mut c = config(url);
        c.max_requests = 1;
        let s = run(Scan::new(c), CancellationToken::new(), |_| {}).await;
        task.abort();
        assert_eq!(s.status, ScanStatus::Failed);
        assert_eq!(s.request_count, 1);
    }
}
