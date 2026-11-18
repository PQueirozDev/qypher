use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub url: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScanConfig {
    pub project_id: String,
    pub url: String,
    pub authorized: bool,
    pub allow_private: bool,
    pub path_prefix: String,
    pub max_requests: u8,
    pub max_redirects: u8,
    pub timeout_seconds: u64,
    /// Busca por arquivos expostos e análise do HTML da página. Consentimento próprio.
    #[serde(default)]
    pub discovery: bool,
    /// Testes ativos não destrutivos (reflexão de origem CORS, métodos HTTP).
    #[serde(default)]
    pub active_checks: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Unrated,
    High,
    Medium,
    Low,
    Info,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub detector_id: String,
    pub detector_version: String,
    pub title: String,
    pub category: String,
    pub severity: Severity,
    pub confidence: String,
    pub classification: String,
    pub location: String,
    pub evidence: String,
    pub impact: String,
    pub recommendation: String,
    pub references: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub verification: String,
    /// Fraqueza correspondente (ex.: `CWE-693`). Vazio em boas práticas e snapshots antigos.
    #[serde(default)]
    pub cwe: String,
    /// Categoria do OWASP Top 10 2021. Vazio quando não se aplica.
    #[serde(default)]
    pub owasp: String,
    /// Prévia MASCARADA do conteúdo exposto publicamente (ex.: um `.env` acessível):
    /// nomes de chave e estrutura ficam visíveis, mas os valores são parcialmente ocultados,
    /// para o responsável confirmar o vazamento sem o app guardar o segredo inteiro.
    /// Redigido na exportação quando a redação está ligada.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample: Option<String>,
}

impl Finding {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: &str,
        observation: &HttpObservation,
        title: &str,
        severity: Severity,
        evidence: &str,
        impact: &str,
        recommendation: &str,
        reference: &str,
    ) -> Self {
        Self::at(
            id,
            &observation.url,
            title,
            severity,
            evidence,
            impact,
            recommendation,
            reference,
        )
    }

    /// Achado associado a uma URL, sem depender de uma observação HTTP completa.
    #[allow(clippy::too_many_arguments)]
    pub fn at(
        id: &str,
        location: &str,
        title: &str,
        severity: Severity,
        evidence: &str,
        impact: &str,
        recommendation: &str,
        reference: &str,
    ) -> Self {
        let taxonomy = crate::taxonomy::taxonomy(id);
        Self {
            cwe: taxonomy.map(|t| t.cwe.to_string()).unwrap_or_default(),
            owasp: taxonomy.map(|t| t.owasp.to_string()).unwrap_or_default(),
            id: format!("{:x}", Sha256::digest(format!("{}|{}", id, location))),
            detector_id: id.into(),
            detector_version: "1.0.0".into(),
            title: title.into(),
            category: "HTTP / TLS".into(),
            severity,
            confidence: "observed".into(),
            classification: "configuration".into(),
            location: location.into(),
            evidence: evidence.into(),
            impact: impact.into(),
            recommendation: recommendation.into(),
            references: vec![reference.into()],
            description: format!("{title}. A interpretação depende do contexto e da cobertura da verificação."),
            verification: "Aplique a recomendação em um ambiente de teste e repita a mesma verificação, no mesmo escopo. Confira a evidência e a cobertura; ausência de achados isoladamente não comprova correção.".into(),
            sample: None,
        }
    }

    /// Anexa uma prévia MASCARADA do conteúdo exposto. O valor inteiro nunca é guardado.
    pub fn with_sample(mut self, bytes: &[u8]) -> Self {
        self.sample = leak_sample(bytes);
        self
    }
}

/// Oculta parte de um valor sensível: mantém até 2 caracteres no início e marca o tamanho.
/// Nunca devolve o valor completo. `ab••••• (18)`; valores curtos ficam totalmente ocultos.
fn mask_value(value: &str) -> String {
    let n = value.chars().count();
    if n == 0 {
        return String::new();
    }
    let keep = if n >= 8 { 2 } else { 0 };
    let shown: String = value.chars().take(keep).collect();
    let bullets = "•".repeat((n - keep).min(10));
    format!("{shown}{bullets} ({n} caracteres)")
}

/// Verifica se o lado esquerdo de um par parece um nome de campo (e não conteúdo),
/// para preservar a estrutura `chave: valor` sem revelar o valor.
fn is_key_name(key: &str) -> bool {
    let k = key.trim();
    !k.is_empty()
        && k.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '"' | ' ' | '[' | ']')
        })
}

/// Mascara uma linha de conteúdo exposto: preserva a estrutura (chave, `=`/`:`) e oculta o valor.
fn mask_line(line: &str) -> String {
    let trimmed = line.trim();
    // Delimitadores PEM (`-----BEGIN ... -----`) são apenas cabeçalhos informativos,
    // não segredos — mantêm-se visíveis para indicar O QUE vazou.
    if trimmed.starts_with("-----") {
        return line.to_string();
    }
    // Qualquer outra linha com material de chave privada nunca é devolvida crua:
    // oculta o valor (preservando o nome do campo quando houver).
    if trimmed.contains("PRIVATE KEY") {
        if let Some(pos) = line.find(['=', ':']) {
            let key = &line[..pos];
            let is_key = is_key_name(key);
            if is_key {
                let sep = line[pos..].chars().next().unwrap_or('=');
                return format!("{key}{sep} •••••• (material de chave ocultado)");
            }
        }
        return "•••••• (material de chave ocultado)".to_string();
    }
    for sep in ['=', ':'] {
        if let Some(pos) = line.find(sep) {
            let (key, rest) = line.split_at(pos);
            let value = rest[1..].trim();
            // Só mascara quando há um valor que parece conteúdo (evita mexer em `[core]`).
            if is_key_name(key) && value.len() >= 3 {
                return format!(
                    "{key}{sep} {}",
                    mask_value(value.trim_matches(['"', '\'', ',', ';']))
                );
            }
        }
    }
    // Linha sem par chave/valor: mascara tokens longos (prováveis chaves/tokens).
    let mut out = String::new();
    for word in line.split_inclusive(char::is_whitespace) {
        let core = word.trim();
        let secretish = core.len() >= 16
            && core.chars().all(|c| {
                c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=' | '_' | '-' | '.')
            });
        if secretish {
            out.push_str(&mask_value(core));
            out.push_str(&word[core.len()..]);
        } else {
            out.push_str(word);
        }
    }
    out
}

/// Converte bytes expostos em uma prévia legível e MASCARADA (até ~1800 caracteres).
/// `None` para conteúdo binário. O valor completo dos segredos nunca é retornado.
pub fn leak_sample(bytes: &[u8]) -> Option<String> {
    let end = bytes.len().min(8192);
    let text = String::from_utf8_lossy(&bytes[..end]);
    let total = text.chars().count();
    let printable = text
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t' | '\r'))
        .count();
    // Conteúdo majoritariamente binário (zip, heapdump) não vira prévia legível.
    if total == 0 || printable * 10 < total * 9 {
        return None;
    }
    let mut out = String::new();
    for line in text.lines().take(60) {
        let clean: String = line
            .chars()
            .filter(|c| !c.is_control() || *c == '\t')
            .collect();
        out.push_str(&mask_line(&clean));
        out.push('\n');
        if out.chars().count() >= 1800 {
            out.push_str("… (restante omitido)");
            break;
        }
    }
    let out = out.trim_end().to_string();
    (!out.is_empty()).then_some(out)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CheckStatus {
    Passed,
    Finding,
    NotRun,
    Error,
}

#[cfg(test)]
mod leak_tests {
    use super::leak_sample;
    #[test]
    fn values_are_masked_and_never_shown_whole() {
        // Valor longo o bastante para revelar um prefixo: o restante vira bullets + tamanho.
        let exposed = b"CHAVE_EXEMPLO=abcdefghijklmnop\n[core]\nREGIAO=sa-east-1\n";
        let preview = leak_sample(exposed).unwrap();
        assert!(preview.contains("CHAVE_EXEMPLO="), "a chave deve aparecer");
        assert!(
            preview.contains("ab•"),
            "deve mostrar só o prefixo do valor"
        );
        assert!(
            preview.contains("(16 caracteres)"),
            "deve indicar o tamanho"
        );
        assert!(
            !preview.contains("abcdefghijklmnop"),
            "nunca mostra o valor inteiro"
        );
        assert!(
            preview.contains("[core]"),
            "estrutura sem valor é preservada"
        );
        // Binário (assinatura de zip) não vira prévia legível.
        assert_eq!(
            leak_sample(&[0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3, 4, 5]),
            None
        );
        assert_eq!(leak_sample(b""), None);
    }

    #[test]
    fn inline_private_key_material_is_never_shown_whole() {
        // Chave privada inline numa linha de valor: o corpo jamais pode vazar.
        let exposed = b"RSA_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----MIIEpAIBAAKCAQEA1234567890abcdef-----END RSA PRIVATE KEY-----\n";
        let preview = leak_sample(exposed).unwrap();
        assert!(
            !preview.contains("MIIEpAIBAAKCAQEA1234567890abcdef"),
            "o material da chave nunca pode aparecer"
        );
        assert!(preview.contains("material de chave ocultado"));
        // Delimitador PEM isolado continua visível (informativo, não é segredo).
        let header = leak_sample(b"-----BEGIN PRIVATE KEY-----\n").unwrap();
        assert!(header.contains("-----BEGIN PRIVATE KEY-----"));
    }

    #[test]
    fn masked_preview_reaches_storage_and_ipc_for_the_owner() {
        let mut finding = super::Finding::at(
            "test",
            "https://example.invalid/",
            "t",
            super::Severity::High,
            "metadata",
            "impact",
            "fix",
            "ref",
        );
        finding.sample = Some("CHAVE=ab•••••••• (18 caracteres)".into());
        let value = serde_json::to_value(&finding).unwrap();
        assert_eq!(
            value.get("sample").and_then(|v| v.as_str()),
            Some("CHAVE=ab•••••••• (18 caracteres)")
        );
        let restored: super::Finding = serde_json::from_value(value).unwrap();
        assert_eq!(
            restored.sample.as_deref(),
            Some("CHAVE=ab•••••••• (18 caracteres)")
        );
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub detector_id: String,
    pub detector_version: String,
    pub resource: String,
    pub status: CheckStatus,
    pub reason: String,
    pub findings: Vec<Finding>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieFact {
    pub name: String,
    pub secure: bool,
    pub http_only: bool,
    pub same_site: bool,
    /// `__Host-`/`__Secure-` sem os atributos exigidos. Ausente em snapshots antigos.
    #[serde(default)]
    pub prefix_violation: bool,
    #[serde(default)]
    pub same_site_none: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsObservation {
    pub certificate_sha256: String,
    pub expires_at: String,
    pub days_remaining: i64,
    pub issuer: String,
    #[serde(default)]
    pub key_algorithm: String,
    #[serde(default)]
    pub key_bits: u32,
    #[serde(default)]
    pub signature_algorithm: String,
    #[serde(default)]
    pub weak_signature: bool,
    #[serde(default)]
    pub validity_days: i64,
    #[serde(default)]
    pub wildcard: bool,
}

/// Resultado de sondas de handshake. `None` em cada campo = inconclusivo.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsProbe {
    pub tls10: Option<bool>,
    pub tls11: Option<bool>,
    pub weak_ciphers: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpObservation {
    pub url: String,
    pub status: u16,
    pub elapsed_ms: u64,
    pub headers: BTreeMap<String, String>,
    pub cookies: Vec<CookieFact>,
    pub tls: Option<TlsObservation>,
    #[serde(default)]
    pub tls_probe: Option<TlsProbe>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScanStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub at: String,
    pub level: LogLevel,
    pub event: String,
    pub message: String,
}

impl LogEntry {
    pub fn new(event: &str, message: &str, level: LogLevel) -> Self {
        Self {
            at: Utc::now().to_rfc3339(),
            level,
            event: crate::clean(event, 64),
            message: crate::clean(message, 1024),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub schema_version: u8,
    pub engine_version: String,
    pub id: String,
    pub config: ScanConfig,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: ScanStatus,
    pub request_count: u8,
    pub observations: Vec<HttpObservation>,
    pub checks: Vec<CheckResult>,
    pub findings: Vec<Finding>,
    pub logs: Vec<LogEntry>,
    pub error: Option<String>,
    /// Índice de postura, calculado só quando a execução conclui. Ver `risk.rs`.
    #[serde(default)]
    pub risk: Option<crate::risk::RiskSummary>,
}

impl Scan {
    pub fn log(&mut self, event: &str, message: &str, level: LogLevel) {
        self.logs.push(LogEntry::new(event, message, level));
    }
    pub fn new(config: ScanConfig) -> Self {
        Self {
            schema_version: 1,
            engine_version: crate::ENGINE_VERSION.into(),
            id: Uuid::new_v4().to_string(),
            config,
            started_at: Utc::now().to_rfc3339(),
            finished_at: None,
            status: ScanStatus::Running,
            request_count: 0,
            observations: vec![],
            checks: vec![],
            findings: vec![],
            logs: vec![LogEntry::new(
                "scan.created",
                "Execução registrada; aguardando validação da política.",
                LogLevel::Info,
            )],
            error: None,
            risk: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub projects: Vec<Project>,
    pub scans: Vec<Scan>,
}
