//! Controlled GET-only authorization tests against owner-supplied synthetic resources.
//! Credentials are input-only and are never part of events, history or reports.
use crate::{client_for_addresses, header_facts, resolve_checked};
use reqwest::header::{HeaderValue, AUTHORIZATION, COOKIE};
use scanner_core::{
    literal_ip, parse_target, CookieFact, LogEntry, LogLevel, ScanConfig, ScanStatus,
};
use serde::{Deserialize, Serialize};
use std::{
    net::IpAddr,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

const BODY_LIMIT: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LabScenario {
    ProtectedRoute,
    AccountIsolation,
    InsufficientPermissions,
    RevokedSession,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LabEnvironment {
    Local,
    Staging,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialKind {
    Bearer,
    Cookie,
}

// Deliberately neither Debug nor Serialize: input secrets must not enter snapshots.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestCredential {
    pub kind: CredentialKind,
    pub value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LabRequest {
    pub project_id: String,
    pub url: String,
    pub path_prefix: String,
    pub authorized: bool,
    pub synthetic_data_confirmed: bool,
    pub environment: LabEnvironment,
    pub allow_private: bool,
    pub scenario: LabScenario,
    pub marker: String,
    pub owner_credential: TestCredential,
    pub challenger_credential: Option<TestCredential>,
    pub expected_denied_status: u16,
    pub max_requests: u8,
    pub timeout_seconds: u64,
}

impl TestCredential {
    fn header(&self) -> Result<HeaderValue, String> {
        if !(8..=4096).contains(&self.value.len())
            || self.value.trim() != self.value
            || self.value.chars().any(|c| c.is_control() || !c.is_ascii())
        {
            return Err("Credencial de teste inválida: use 8–4096 caracteres ASCII, sem controles ou espaços nas extremidades.".into());
        }
        let text = match self.kind {
            CredentialKind::Bearer => format!("Bearer {}", self.value),
            CredentialKind::Cookie => self.value.clone(),
        };
        let mut header = HeaderValue::from_str(&text)
            .map_err(|_| "Credencial de teste contém caracteres inválidos.")?;
        header.set_sensitive(true);
        Ok(header)
    }
}

impl LabRequest {
    fn policy(&self) -> ScanConfig {
        ScanConfig {
            project_id: self.project_id.clone(),
            url: self.url.clone(),
            authorized: self.authorized,
            allow_private: self.allow_private,
            path_prefix: self.path_prefix.clone(),
            max_requests: self.max_requests,
            max_redirects: 0,
            timeout_seconds: self.timeout_seconds,
            discovery: false,
            active_checks: false,
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if !self.authorized || !self.synthetic_data_confirmed {
            return Err("Confirme autorização do proprietário e uso exclusivo de contas e recursos fictícios.".into());
        }
        if !(2..=8).contains(&self.max_requests)
            || !(2..=15).contains(&self.timeout_seconds)
            || ![401, 403, 404].contains(&self.expected_denied_status)
        {
            return Err("Lab requer 2–8 requisições, timeout de 2–15 s e rejeição esperada 401, 403 ou 404.".into());
        }
        let url = self.policy().validate().map_err(|e| e.to_string())?;
        match self.environment {
            LabEnvironment::Staging if url.scheme() != "https" => {
                return Err(
                    "Homologação exige HTTPS para proteger as credenciais de teste.".into(),
                );
            }
            LabEnvironment::Local => {
                let local =
                    literal_ip(&url).is_some_and(loopback) || url.host_str() == Some("localhost");
                if !local || !self.allow_private {
                    return Err(
                        "Lab local exige loopback e autorização explícita de rede local.".into(),
                    );
                }
            }
            _ => {}
        }
        if !(24..=128).contains(&self.marker.len())
            || !self.marker.starts_with("qypher-fixture-")
            || !self
                .marker
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("Use marcador sintético qypher-fixture-… com 24–128 caracteres ASCII (letras, números, hífen e sublinhado).".into());
        }
        self.owner_credential.header()?;
        if self.scenario != LabScenario::ProtectedRoute {
            let challenger = self
                .challenger_credential
                .as_ref()
                .ok_or("Informe a segunda credencial de teste para este cenário.")?;
            challenger.header()?;
            if challenger.value == self.owner_credential.value {
                return Err(
                    "As credenciais de referência e de comparação devem ser diferentes.".into(),
                );
            }
        } else if self.challenger_credential.is_some() {
            return Err("O cenário de rota privada compara com acesso anônimo; remova a segunda credencial.".into());
        }
        Ok(())
    }
}

fn loopback(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_loopback(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.to_ipv4_mapped().is_some_and(|v| v.is_loopback()),
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LabVerdict {
    Confirmed,
    NotReproduced,
    Inconclusive,
    NotRun,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabObservation {
    pub identity: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub expected: String,
    pub marker_observed: bool,
    pub elapsed_ms: u64,
    pub cookies: Vec<CookieFact>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabRun {
    pub id: String,
    pub project_id: String,
    pub url: String,
    pub path_prefix: String,
    pub environment: LabEnvironment,
    pub scenario: LabScenario,
    pub max_requests: u8,
    pub timeout_seconds: u64,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: ScanStatus,
    pub request_count: u8,
    pub verdict: LabVerdict,
    pub reason: String,
    pub requests: Vec<LabObservation>,
    pub logs: Vec<LogEntry>,
    pub error: Option<String>,
}

impl LabRun {
    pub fn new(request: &LabRequest) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: request.project_id.clone(),
            url: parse_target(&request.url)
                .map(|u| u.to_string())
                .unwrap_or_else(|_| "[alvo inválido]".into()),
            path_prefix: request.path_prefix.clone(),
            environment: request.environment,
            scenario: request.scenario,
            max_requests: request.max_requests,
            timeout_seconds: request.timeout_seconds,
            started_at: chrono::Utc::now().to_rfc3339(),
            finished_at: None,
            status: ScanStatus::Running,
            request_count: 0,
            verdict: LabVerdict::NotRun,
            reason: "Aguardando validação do escopo sintético.".into(),
            requests: vec![],
            logs: vec![LogEntry::new(
                "lab.created",
                "Cenário registrado sem credenciais ou conteúdo do recurso.",
                LogLevel::Info,
            )],
            error: None,
        }
    }
    fn log(&mut self, event: &str, message: &str, level: LogLevel) {
        self.logs.push(LogEntry::new(event, message, level));
    }
}

pub async fn run(
    mut run: LabRun,
    request: LabRequest,
    cancel: CancellationToken,
    progress: impl Fn(&LabRun) + Send + Sync,
) -> LabRun {
    // Absolute cap includes DNS, headers and body, in addition to per-request timeout.
    let total_seconds = request
        .timeout_seconds
        .saturating_mul(request.max_requests as u64)
        .min(120);
    let result = tokio::time::timeout(
        Duration::from_secs(total_seconds),
        execute(&mut run, &request, &cancel, &progress),
    )
    .await
    .unwrap_or_else(|_| {
        Err("Orçamento total de tempo do Lab esgotado; resultado inconclusivo.".into())
    });
    match result {
        Ok(()) => run.status = ScanStatus::Completed,
        Err(e) if e == "cancelled" => {
            run.status = ScanStatus::Cancelled;
            run.verdict = LabVerdict::Inconclusive;
            run.reason = "Teste interrompido; nenhuma nova requisição será iniciada.".into();
        }
        Err(e) => {
            run.status = ScanStatus::Failed;
            run.verdict = LabVerdict::Inconclusive;
            run.reason = "Não foi possível concluir o cenário com evidência suficiente.".into();
            run.error = Some(e);
        }
    }
    run.finished_at = Some(chrono::Utc::now().to_rfc3339());
    run.log("lab.finished", "Execução encerrada. O resultado se aplica somente ao recurso sintético e às credenciais de teste fornecidas.", LogLevel::Info);
    progress(&run);
    run
}

async fn execute(
    run: &mut LabRun,
    request: &LabRequest,
    cancel: &CancellationToken,
    progress: &(impl Fn(&LabRun) + Send + Sync),
) -> Result<(), String> {
    request.validate()?;
    let policy = request.policy();
    let url = policy.validate().map_err(|e| e.to_string())?;
    run.log("lab.policy", "Autorização, ambiente, método GET e recurso fictício validados. Redirecionamentos desabilitados.", LogLevel::Info);
    progress(run);
    let baseline = observe(
        run,
        request,
        &policy,
        &url,
        Some(&request.owner_credential),
        "owner",
        "2xx com marcador sintético",
        cancel,
    )
    .await?;
    let baseline_ok =
        baseline.status.is_some_and(|s| (200..300).contains(&s)) && baseline.marker_observed;
    progress(run);
    if !baseline_ok {
        run.verdict = LabVerdict::Inconclusive;
        run.reason = "A conta proprietária não retornou 2xx com o marcador sintético. Confirme rota, conta e fixture antes de testar autorização.".into();
        return Ok(());
    }
    let credential = if request.scenario == LabScenario::ProtectedRoute {
        None
    } else {
        request.challenger_credential.as_ref()
    };
    let identity = if credential.is_none() {
        "anonymous"
    } else {
        "challenger"
    };
    let expected = format!(
        "HTTP {} sem marcador sintético",
        request.expected_denied_status
    );
    let observed = observe(
        run, request, &policy, &url, credential, identity, &expected, cancel,
    )
    .await?;
    let status = observed.status.unwrap_or(0);
    let marker = observed.marker_observed;
    if (200..300).contains(&status) && marker {
        run.verdict = LabVerdict::Confirmed;
        run.reason = "O acesso que deveria ser negado recebeu 2xx e o marcador exclusivo do recurso fictício, após confirmação pela conta proprietária.".into();
        run.log("lab.confirmed", "O cenário reproduziu acesso inesperado ao recurso sintético. Nenhum conteúdo ou credencial foi armazenado.", LogLevel::Warn);
    } else if status == request.expected_denied_status && !marker {
        run.verdict = LabVerdict::NotReproduced;
        run.reason = "O acesso recebeu a rejeição esperada, sem o marcador sintético. A falha não foi reproduzida neste recurso e nestas condições.".into();
    } else {
        run.verdict = LabVerdict::Inconclusive;
        run.reason = "A resposta divergiu do esperado sem prova suficiente de acesso: redirecionamento, código diferente ou ausência do marcador. Nenhum bypass foi afirmado.".into();
    }
    progress(run);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn observe(
    run: &mut LabRun,
    request: &LabRequest,
    policy: &ScanConfig,
    url: &url::Url,
    credential: Option<&TestCredential>,
    identity: &str,
    expected: &str,
    cancel: &CancellationToken,
) -> Result<LabObservation, String> {
    if cancel.is_cancelled() {
        return Err("cancelled".into());
    }
    policy.check_url(url).map_err(|e| e.to_string())?;
    if run.request_count >= request.max_requests {
        return Err("Orçamento de requisições do Lab esgotado.".into());
    }
    let addresses = resolve_checked(url, policy, cancel).await?;
    if request.environment == LabEnvironment::Local && !addresses.iter().all(|a| loopback(a.ip())) {
        return Err("Lab local recusou resolução fora de loopback.".into());
    }
    let client = client_for_addresses(url, policy, &addresses)?;
    let mut outgoing = client.get(url.clone());
    if let Some(credential) = credential {
        let name = match credential.kind {
            CredentialKind::Bearer => AUTHORIZATION,
            CredentialKind::Cookie => COOKIE,
        };
        outgoing = outgoing.header(name, credential.header()?);
    }
    if cancel.is_cancelled() {
        return Err("cancelled".into());
    }
    run.request_count += 1;
    let index = run.requests.len();
    run.requests.push(LabObservation {
        identity: identity.into(),
        method: "GET".into(),
        url: url.to_string(),
        status: None,
        expected: expected.into(),
        marker_observed: false,
        elapsed_ms: 0,
        cookies: vec![],
    });
    run.log(
        "lab.request",
        "Enviando GET no escopo validado; credenciais e corpo não entram nos logs.",
        LogLevel::Info,
    );
    let start = Instant::now();
    let mut response = tokio::select! { biased;
        _=cancel.cancelled()=>return Err("cancelled".into()),
        response=outgoing.send()=>response.map_err(|_| "Falha de rede, TLS ou timeout durante GET do Lab.")?
    };
    let status = response.status().as_u16();
    if response.headers().get_all("set-cookie").iter().count() > 64 {
        return Err("Resposta do Lab excedeu 64 cookies; evidência de sessão inconclusiva.".into());
    }
    let (_, mut cookies) = header_facts(response.headers());
    for cookie in &mut cookies {
        cookie.name = "[cookie de teste]".into();
    }
    run.requests[index].status = Some(status);
    run.requests[index].cookies = cookies;
    run.requests[index].elapsed_ms = start.elapsed().as_millis() as u64;
    let marker_observed = if response.status().is_redirection() {
        false
    } else {
        let mut body = Vec::new();
        loop {
            let chunk = tokio::select! { biased;
                _=cancel.cancelled()=>return Err("cancelled".into()),
                chunk=response.chunk()=>chunk.map_err(|_| "Leitura incompleta da resposta do Lab; resultado inconclusivo.")?
            };
            let Some(chunk) = chunk else {
                break;
            };
            if body.len().saturating_add(chunk.len()) > BODY_LIMIT {
                return Err("Resposta do Lab excedeu 64 KiB; resultado inconclusivo.".into());
            }
            body.extend_from_slice(&chunk);
        }
        body.windows(request.marker.len())
            .any(|window| window == request.marker.as_bytes())
    };
    run.requests[index].marker_observed = marker_observed;
    run.requests[index].elapsed_ms = start.elapsed().as_millis() as u64;
    Ok(run.requests[index].clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn input(url: String) -> LabRequest {
        LabRequest {
            project_id: "fixture-project".into(),
            url,
            path_prefix: "/fixture".into(),
            authorized: true,
            synthetic_data_confirmed: true,
            environment: LabEnvironment::Local,
            allow_private: true,
            scenario: LabScenario::AccountIsolation,
            marker: "qypher-fixture-resource-owner".into(),
            owner_credential: TestCredential {
                kind: CredentialKind::Bearer,
                value: "fixture-owner-token".into(),
            },
            challenger_credential: Some(TestCredential {
                kind: CredentialKind::Bearer,
                value: "fixture-other-token".into(),
            }),
            expected_denied_status: 403,
            max_requests: 2,
            timeout_seconds: 2,
        }
    }

    async fn fixture(
        challenger_status: u16,
        challenger_body: &'static str,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/fixture/owner-resource",
            listener.local_addr().unwrap()
        );
        let task = tokio::spawn(async move {
            let mut requests = vec![];
            for index in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut data = vec![0u8; 8192];
                let n = socket.read(&mut data).await.unwrap();
                let request = String::from_utf8_lossy(&data[..n]).to_string();
                assert!(request.starts_with("GET /fixture/owner-resource HTTP/1.1"));
                let (status, body) = if index == 0 {
                    (200, "qypher-fixture-resource-owner")
                } else {
                    (challenger_status, challenger_body)
                };
                let location = if status == 302 {
                    "Location: http://127.0.0.1:9/outside\r\n"
                } else {
                    ""
                };
                let response = format!("HTTP/1.1 {status} Result\r\n{location}Content-Length: {}\r\nConnection: close\r\nSet-Cookie: session=fixture-secret-cookie; HttpOnly; Secure; SameSite=Lax\r\n\r\n{body}", body.len());
                socket.write_all(response.as_bytes()).await.unwrap();
                requests.push(request);
            }
            requests
        });
        (url, task)
    }

    #[tokio::test]
    async fn confirms_only_synthetic_resource_and_never_serializes_credentials() {
        let (url, server) = fixture(200, "qypher-fixture-resource-owner").await;
        let request = input(url);
        let result = run(
            LabRun::new(&request),
            request,
            CancellationToken::new(),
            |_| {},
        )
        .await;
        assert_eq!(result.verdict, LabVerdict::Confirmed);
        assert_eq!(result.request_count, 2);
        let requests = server.await.unwrap();
        assert!(requests[0]
            .to_ascii_lowercase()
            .contains("authorization: bearer fixture-owner-token"));
        assert!(requests[1]
            .to_ascii_lowercase()
            .contains("authorization: bearer fixture-other-token"));
        let serialized = serde_json::to_string(&result).unwrap();
        for secret in [
            "fixture-owner-token",
            "fixture-other-token",
            "fixture-secret-cookie",
            "qypher-fixture-resource-owner",
        ] {
            assert!(!serialized.contains(secret), "{secret}");
        }
    }

    #[tokio::test]
    async fn denial_is_not_reproduced_and_generic_success_is_inconclusive() {
        for (status, body, verdict) in [
            (403, "denied", LabVerdict::NotReproduced),
            (200, "generic login page", LabVerdict::Inconclusive),
        ] {
            let (url, server) = fixture(status, body).await;
            let request = input(url);
            let result = run(
                LabRun::new(&request),
                request,
                CancellationToken::new(),
                |_| {},
            )
            .await;
            assert_eq!(result.verdict, verdict);
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn anonymous_scenario_omits_authorization_and_cookie_headers() {
        let (url, server) = fixture(403, "denied").await;
        let mut request = input(url);
        request.scenario = LabScenario::ProtectedRoute;
        request.challenger_credential = None;
        let result = run(
            LabRun::new(&request),
            request,
            CancellationToken::new(),
            |_| {},
        )
        .await;
        assert_eq!(result.verdict, LabVerdict::NotReproduced);
        let requests = server.await.unwrap();
        assert!(!requests[1].to_ascii_lowercase().contains("authorization:"));
        assert!(!requests[1].to_ascii_lowercase().contains("cookie:"));
    }

    #[tokio::test]
    async fn pre_cancelled_run_never_starts_a_request() {
        let request = input("http://127.0.0.1:9/fixture/resource".into());
        let cancel = CancellationToken::new();
        cancel.cancel();
        let result = run(LabRun::new(&request), request, cancel, |_| {}).await;
        assert_eq!(result.status, ScanStatus::Cancelled);
        assert_eq!(result.request_count, 0);
    }

    #[tokio::test]
    async fn redirect_is_inconclusive_without_following_the_location() {
        let (url, server) = fixture(302, "").await;
        let request = input(url);
        let result = run(
            LabRun::new(&request),
            request,
            CancellationToken::new(),
            |_| {},
        )
        .await;
        assert_eq!(result.status, ScanStatus::Completed);
        assert_eq!(result.verdict, LabVerdict::Inconclusive);
        assert_eq!(result.requests[1].status, Some(302));
        assert_eq!(result.request_count, 2);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn invalid_baseline_stops_before_testing_another_identity() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/fixture/resource", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut data = [0u8; 2048];
            let _ = socket.read(&mut data).await;
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nlogin",
                )
                .await
                .unwrap();
        });
        let request = input(url);
        let result = run(
            LabRun::new(&request),
            request,
            CancellationToken::new(),
            |_| {},
        )
        .await;
        assert_eq!(result.verdict, LabVerdict::Inconclusive);
        assert_eq!(result.request_count, 1);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_pending_response_and_keeps_the_audit_record() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/fixture/resource", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(5)).await;
        });
        let cancel = CancellationToken::new();
        let trigger = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(60)).await;
            trigger.cancel();
        });
        let request = input(url);
        let start = Instant::now();
        let result = run(LabRun::new(&request), request, cancel, |_| {}).await;
        assert!(start.elapsed() < Duration::from_secs(1));
        assert_eq!(result.status, ScanStatus::Cancelled);
        assert_eq!(result.verdict, LabVerdict::Inconclusive);
        assert_eq!(result.request_count, 1);
        assert_eq!(result.requests.len(), 1);
        assert!(result.requests[0].status.is_none());
        server.abort();
    }

    #[tokio::test]
    async fn metadata_target_is_blocked_before_any_request() {
        let mut request = input("https://169.254.169.254/fixture/resource".into());
        request.environment = LabEnvironment::Staging;
        let result = run(
            LabRun::new(&request),
            request,
            CancellationToken::new(),
            |_| {},
        )
        .await;
        assert_eq!(result.status, ScanStatus::Failed);
        assert_eq!(result.request_count, 0);
    }

    #[test]
    fn rejects_production_like_unsafe_inputs_and_equal_identities() {
        let mut request = input("http://127.0.0.1:9/fixture/resource".into());
        assert!(request.validate().is_ok());
        request.synthetic_data_confirmed = false;
        assert!(request.validate().is_err());
        request.synthetic_data_confirmed = true;
        request.challenger_credential.as_mut().unwrap().value = "fixture-owner-token".into();
        assert!(request.validate().is_err());
        request.challenger_credential.as_mut().unwrap().value =
            "fixture-other-token\r\nX-Test: injected".into();
        assert!(request.validate().is_err());
        request.challenger_credential.as_mut().unwrap().value = "fixture-other-token".into();
        request.environment = LabEnvironment::Staging;
        assert!(request.validate().is_err());
        request.environment = LabEnvironment::Local;
        request.url = "https://example.com/fixture/resource".into();
        assert!(request.validate().is_err());
        request.environment = LabEnvironment::Staging;
        assert!(request.validate().is_ok());
        request.path_prefix = "/elsewhere".into();
        assert!(request.validate().is_err());
    }
}
