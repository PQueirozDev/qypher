//! Host de Native Messaging para a extensão de navegador do Qypher.
//!
//! O navegador inicia o próprio executável do app com a origem da extensão como
//! argumento; nesse caso não abrimos janela: lemos mensagens JSON com prefixo de
//! tamanho em stdin e respondemos em stdout. Só a análise **passiva** roda aqui
//! (nenhuma requisição de rede). Abrir a análise completa entrega a URL ao app,
//! onde o consentimento continua obrigatório.

use scanner_http::passive::{self, PassiveInput};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, Read, Write};
use std::path::PathBuf;

pub const HOST_NAME: &str = "org.qypher.native";
/// ID fixo da extensão Chromium (derivado da chave pública em `manifest.json`).
pub const CHROME_EXTENSION_ID: &str = "cnpaofiocpinipphkapcebfcmamffkif";
/// ID da extensão Firefox (`browser_specific_settings.gecko.id`).
pub const FIREFOX_EXTENSION_ID: &str = "browser@qypher.org";

const MAX_INCOMING: u32 = 4 * 1024 * 1024;
/// O navegador recusa mensagens do host acima de 1 MB.
const MAX_OUTGOING: usize = 1024 * 1024 - 1024;
const MAX_FINDINGS: usize = 200;

/// O navegador passa a origem da extensão (Chromium) ou o ID da extensão (Firefox).
pub fn launched_by_browser(args: &[String]) -> bool {
    args.iter()
        .skip(1)
        .any(|arg| arg.starts_with("chrome-extension://") || arg == FIREFOX_EXTENSION_ID)
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Ping {},
    Analyze { input: PassiveInput },
    Open { url: String },
}

fn read_message(input: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match input.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_le_bytes(len);
    if len > MAX_INCOMING {
        return Err(io::Error::other("mensagem acima do limite"));
    }
    let mut buf = vec![0u8; len as usize];
    input.read_exact(&mut buf)?;
    Ok(Some(buf))
}

fn write_message(output: &mut impl Write, value: &Value) -> io::Result<()> {
    let bytes = serde_json::to_vec(value).map_err(io::Error::other)?;
    output.write_all(&(bytes.len() as u32).to_le_bytes())?;
    output.write_all(&bytes)?;
    output.flush()
}

fn error(message: &str) -> Value {
    json!({ "ok": false, "error": message })
}

fn handle(raw: &[u8]) -> Value {
    let request: Request = match serde_json::from_slice(raw) {
        Ok(request) => request,
        Err(_) => return error("Mensagem inválida."),
    };
    match request {
        Request::Ping {} => json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }),
        Request::Analyze { input } => match passive::analyze(input) {
            Ok(mut report) => {
                let total = report.findings.len();
                report.findings.truncate(MAX_FINDINGS);
                for check in &mut report.checks {
                    check.findings.clear();
                }
                let mut value = json!({ "ok": true, "report": report, "total": total });
                // Garante o limite de 1 MB do navegador cortando achados excedentes.
                while serde_json::to_vec(&value).map(|b| b.len()).unwrap_or(0) > MAX_OUTGOING {
                    let findings = value["report"]["findings"].as_array_mut();
                    match findings {
                        Some(list) if !list.is_empty() => {
                            let keep = list.len() / 2;
                            list.truncate(keep);
                        }
                        _ => return error("Resposta acima do limite."),
                    }
                }
                value
            }
            Err(message) => error(&message),
        },
        Request::Open { url } => {
            match passive::validate_url(&url).and_then(|url| open_app(url.as_str())) {
                Ok(()) => json!({ "ok": true }),
                Err(message) => error(&message),
            }
        }
    }
}

/// Abre (ou reutiliza) a janela do app com a URL pré-preenchida na nova análise.
fn open_app(url: &str) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|_| "Executável do app não encontrado.")?;
    let mut command = std::process::Command::new(exe);
    command
        .args(["--scan-url", url])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        // O Chromium coloca o host num job que encerra filhos; o app precisa sobreviver.
        command.creation_flags(DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB);
        if command.spawn().is_ok() {
            return Ok(());
        }
        command.creation_flags(DETACHED_PROCESS);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|_| "Não foi possível abrir o Qypher.".into())
}

pub fn run() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    while let Ok(Some(raw)) = read_message(&mut input) {
        let response = handle(&raw);
        if write_message(&mut output, &response).is_err() {
            break;
        }
    }
}

/// URL entregue por `--scan-url` (linha de comando ou segunda instância).
pub fn scan_url_from_args(args: &[String]) -> Option<String> {
    let position = args.iter().position(|a| a == "--scan-url")?;
    let raw = args.get(position + 1)?;
    passive::validate_url(raw).ok().map(|u| u.to_string())
}

// ---------- Registro do host nos navegadores ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationStatus {
    pub enabled: bool,
    pub browsers: Vec<String>,
    pub chrome_extension_id: &'static str,
}

fn manifest_dir() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir().ok_or("Pasta de dados local indisponível.")?;
    Ok(base.join("Qypher").join("native-host"))
}

fn manifest(chromium: bool) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|_| "Executável do app não encontrado.")?;
    let mut value = json!({
        "name": HOST_NAME,
        "description": "Qypher: análise passiva local da aba atual",
        "path": exe,
        "type": "stdio",
    });
    if chromium {
        value["allowed_origins"] = json!([format!("chrome-extension://{CHROME_EXTENSION_ID}/")]);
    } else {
        value["allowed_extensions"] = json!([FIREFOX_EXTENSION_ID]);
    }
    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}

#[cfg(windows)]
const REGISTRY: [(&str, &str, bool); 5] = [
    (
        "Chrome",
        "Software\\Google\\Chrome\\NativeMessagingHosts",
        true,
    ),
    (
        "Edge",
        "Software\\Microsoft\\Edge\\NativeMessagingHosts",
        true,
    ),
    (
        "Brave",
        "Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts",
        true,
    ),
    ("Chromium", "Software\\Chromium\\NativeMessagingHosts", true),
    ("Firefox", "Software\\Mozilla\\NativeMessagingHosts", false),
];

#[cfg(windows)]
pub fn enable() -> Result<IntegrationStatus, String> {
    use windows_registry::CURRENT_USER;
    let dir = manifest_dir()?;
    std::fs::create_dir_all(&dir).map_err(|_| "Não foi possível criar a pasta do host.")?;
    let chromium = dir.join(format!("{HOST_NAME}.chromium.json"));
    let firefox = dir.join(format!("{HOST_NAME}.firefox.json"));
    std::fs::write(&chromium, manifest(true)?).map_err(|_| "Falha ao gravar manifesto.")?;
    std::fs::write(&firefox, manifest(false)?).map_err(|_| "Falha ao gravar manifesto.")?;
    for (_, key, is_chromium) in REGISTRY {
        let path = if is_chromium { &chromium } else { &firefox };
        CURRENT_USER
            .create(format!("{key}\\{HOST_NAME}"))
            .and_then(|k| k.set_string("", path.to_string_lossy().as_ref()))
            .map_err(|_| "Falha ao registrar o host no navegador.")?;
    }
    Ok(status())
}

#[cfg(windows)]
pub fn disable() -> Result<IntegrationStatus, String> {
    use windows_registry::CURRENT_USER;
    for (_, key, _) in REGISTRY {
        let _ = CURRENT_USER.remove_tree(format!("{key}\\{HOST_NAME}"));
    }
    if let Ok(dir) = manifest_dir() {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(status())
}

#[cfg(windows)]
pub fn status() -> IntegrationStatus {
    use windows_registry::CURRENT_USER;
    let browsers: Vec<String> = REGISTRY
        .iter()
        .filter(|(_, key, _)| {
            CURRENT_USER
                .open(format!("{key}\\{HOST_NAME}"))
                .and_then(|k| k.get_string(""))
                .is_ok_and(|path| std::path::Path::new(&path).exists())
        })
        .map(|(name, _, _)| name.to_string())
        .collect();
    IntegrationStatus {
        enabled: !browsers.is_empty(),
        browsers,
        chrome_extension_id: CHROME_EXTENSION_ID,
    }
}

/// macOS e Linux: um manifesto por navegador instalado, na pasta que o navegador lê.
#[cfg(not(windows))]
fn host_dirs() -> Vec<(&'static str, PathBuf, bool)> {
    let Some(home) = dirs::home_dir() else {
        return vec![];
    };
    #[cfg(target_os = "macos")]
    let list = {
        let support = home.join("Library/Application Support");
        vec![
            ("Chrome", support.join("Google/Chrome"), true),
            ("Edge", support.join("Microsoft Edge"), true),
            ("Brave", support.join("BraveSoftware/Brave-Browser"), true),
            ("Chromium", support.join("Chromium"), true),
            ("Firefox", support.join("Mozilla"), false),
        ]
    };
    #[cfg(not(target_os = "macos"))]
    let list = vec![
        ("Chrome", home.join(".config/google-chrome"), true),
        ("Edge", home.join(".config/microsoft-edge"), true),
        (
            "Brave",
            home.join(".config/BraveSoftware/Brave-Browser"),
            true,
        ),
        ("Chromium", home.join(".config/chromium"), true),
        ("Firefox", home.join(".mozilla"), false),
    ];
    list.into_iter()
        .filter(|(_, dir, _)| dir.exists())
        .map(|(name, dir, chromium)| {
            let sub = if chromium || cfg!(target_os = "macos") {
                "NativeMessagingHosts"
            } else {
                "native-messaging-hosts"
            };
            (name, dir.join(sub), chromium)
        })
        .collect()
}

#[cfg(not(windows))]
pub fn enable() -> Result<IntegrationStatus, String> {
    for (_, dir, chromium) in host_dirs() {
        std::fs::create_dir_all(&dir).map_err(|_| "Não foi possível criar a pasta do host.")?;
        std::fs::write(dir.join(format!("{HOST_NAME}.json")), manifest(chromium)?)
            .map_err(|_| "Falha ao gravar manifesto.")?;
    }
    Ok(status())
}

#[cfg(not(windows))]
pub fn disable() -> Result<IntegrationStatus, String> {
    for (_, dir, _) in host_dirs() {
        let _ = std::fs::remove_file(dir.join(format!("{HOST_NAME}.json")));
    }
    Ok(status())
}

#[cfg(not(windows))]
pub fn status() -> IntegrationStatus {
    let browsers: Vec<String> = host_dirs()
        .into_iter()
        .filter(|(_, dir, _)| dir.join(format!("{HOST_NAME}.json")).exists())
        .map(|(name, _, _)| name.to_string())
        .collect();
    IntegrationStatus {
        enabled: !browsers.is_empty(),
        browsers,
        chrome_extension_id: CHROME_EXTENSION_ID,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(value: &Value) -> Vec<u8> {
        let mut out = vec![];
        write_message(&mut out, value).unwrap();
        out
    }

    #[test]
    fn detects_browser_launch_arguments() {
        let chrome = vec![
            "qypher.exe".into(),
            "chrome-extension://abc/".into(),
            "--parent-window=0".into(),
        ];
        assert!(launched_by_browser(&chrome));
        let firefox = vec![
            "qypher".into(),
            "/x/host.json".into(),
            FIREFOX_EXTENSION_ID.into(),
        ];
        assert!(launched_by_browser(&firefox));
        assert!(!launched_by_browser(&["qypher.exe".into()]));
        assert!(!launched_by_browser(&[
            "qypher.exe".into(),
            "--scan-url".into()
        ]));
    }

    #[test]
    fn framing_round_trip_and_size_limit() {
        let bytes = frame(&json!({ "type": "ping" }));
        let mut reader = bytes.as_slice();
        let raw = read_message(&mut reader).unwrap().unwrap();
        assert_eq!(handle(&raw)["ok"], true);
        assert!(read_message(&mut reader).unwrap().is_none());
        let mut huge = (MAX_INCOMING + 1).to_le_bytes().to_vec();
        huge.extend([0u8; 8]);
        assert!(read_message(&mut huge.as_slice()).is_err());
    }

    #[test]
    fn rejects_unknown_messages_and_fields() {
        assert_eq!(handle(br#"{"type":"shell","cmd":"x"}"#)["ok"], false);
        assert_eq!(handle(br#"{"type":"ping","extra":1}"#)["ok"], false);
        assert_eq!(handle(b"not json")["ok"], false);
    }

    #[test]
    fn analyze_returns_passive_report_without_nested_findings() {
        let raw = serde_json::to_vec(&json!({
            "type": "analyze",
            "input": {
                "url": "https://site.example/",
                "headers": [["content-type", "text/html"]],
            }
        }))
        .unwrap();
        let response = handle(&raw);
        assert_eq!(response["ok"], true, "{response}");
        assert!(!response["report"]["findings"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(response["report"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["findings"].as_array().unwrap().is_empty()));
    }

    /// Escreve no registro/pastas reais do usuário; rode só manualmente:
    /// `cargo test -p qypher-desktop -- --ignored registration_round_trip`
    #[test]
    #[ignore]
    fn registration_round_trip() {
        let enabled = enable().unwrap();
        assert!(enabled.enabled, "nenhum navegador registrado");
        let disabled = disable().unwrap();
        assert!(!disabled.enabled);
        assert!(disabled.browsers.is_empty());
    }

    #[test]
    fn scan_url_argument_is_validated() {
        let ok = vec![
            "q".into(),
            "--scan-url".into(),
            "https://site.example/a".into(),
        ];
        assert_eq!(
            scan_url_from_args(&ok).as_deref(),
            Some("https://site.example/a")
        );
        let bad = vec![
            "q".into(),
            "--scan-url".into(),
            "javascript:alert(1)".into(),
        ];
        assert!(scan_url_from_args(&bad).is_none());
    }
}
