//! Sondas complementares da fase de exposição e dos testes ativos: página de erro,
//! listagem de diretórios, source maps e redirecionamento HTTP → HTTPS.
//!
//! Como no restante do motor, nenhum corpo de resposta é armazenado: cada função lê um
//! trecho limitado, compara com assinaturas fixas e guarda apenas o veredito.

use crate::discovery::{check, read_for_check, scoped, send, text, BODY_LIMIT};
use reqwest::{Client, Method};
use scanner_core::*;
use tokio_util::sync::CancellationToken;
use url::Url;

const A05_REF: &str =
    "OWASP Top 10 A05 Configuração insegura — https://owasp.org/Top10/A05_2021-Security_Misconfiguration/";
const ERROR_REF: &str =
    "OWASP WSTG-ERRH-01 Tratamento de erros — https://owasp.org/www-project-web-security-testing-guide/";

/// Reconhece páginas de depuração e rastros de pilha. Retorna a descrição e a severidade.
pub fn debug_signature(body: &str) -> Option<(&'static str, Severity)> {
    let t = body.to_ascii_lowercase();
    let has = |s: &str| t.contains(s);
    if has("werkzeug debugger") {
        return Some((
            "depurador interativo do Werkzeug/Flask, que permite executar código no servidor",
            Severity::High,
        ));
    }
    if has("you're seeing this error because you have") && has("debug = true") {
        return Some((
            "página de depuração do Django (DEBUG = True)",
            Severity::Medium,
        ));
    }
    if (has("whoops") && (has("illuminate\\") || has("stack trace")))
        || (has("ignition") && has("stack trace"))
    {
        return Some((
            "página de depuração do Laravel (APP_DEBUG = true)",
            Severity::Medium,
        ));
    }
    if has("symfony exception") || has("symfony\\component") {
        return Some((
            "página de exceção do Symfony em modo de depuração",
            Severity::Medium,
        ));
    }
    if has("action controller: exception caught") || has("rails.root:") {
        return Some((
            "página de erro de desenvolvimento do Rails",
            Severity::Medium,
        ));
    }
    if has("server error in '/' application")
        && (has("stack trace:") || has("version information:"))
    {
        return Some((
            "erro detalhado do ASP.NET (customErrors desligado), com rastro de pilha e versão",
            Severity::Medium,
        ));
    }
    if has("traceback (most recent call last)") {
        return Some(("rastro de pilha do Python", Severity::Medium));
    }
    if (has("at org.springframework") || has("java.lang.")) && has("exception") && has("\tat ") {
        return Some(("rastro de pilha do Java", Severity::Medium));
    }
    if has("node_modules") && has("    at ") {
        return Some((
            "rastro de pilha do Node.js com caminhos do servidor",
            Severity::Medium,
        ));
    }
    if (has("<b>fatal error</b>") || has("<b>warning</b>") || has("<b>notice</b>"))
        && has(" on line <b>")
    {
        return Some((
            "mensagem de erro do PHP com caminho de arquivo (display_errors ligado)",
            Severity::Low,
        ));
    }
    if has("whitelabel error page") {
        return Some(("página de erro padrão do Spring Boot", Severity::Low));
    }
    if has("apache tomcat/") {
        return Some((
            "página de erro do Tomcat com a versão do servidor",
            Severity::Low,
        ));
    }
    None
}

/// Reconhece o índice automático de diretórios de Apache, nginx, IIS e servidores embutidos.
pub fn listing_signature(body: &str) -> bool {
    let t = body.to_ascii_lowercase();
    t.contains("<title>index of /")
        || t.contains("<h1>index of /")
        || t.contains("directory listing for /")
        || t.contains("<title>directory listing")
        || t.contains("[to parent directory]")
}

/// Reconhece um source map (JSON com `version`, `sources` e `mappings`).
pub fn source_map_signature(body: &[u8]) -> bool {
    let t = text(body);
    // Um source map utilizável tem sempre `version` e o campo `mappings` (VLQ).
    // `sources` sozinho não comprova um mapa; exigir `mappings` reduz falso-positivo.
    !t.trim_start().starts_with('<') && t.contains("\"version\"") && t.contains("\"mappings\"")
}

/// Procura segredos embutidos no código-fonte original (`sourcesContent`) de um
/// source map JÁ baixado. Zero requisições novas; nunca devolve o valor do segredo.
/// Usa o texto cru (sem lowercase) para preservar prefixos sensíveis a maiúsculas (AWS).
pub fn source_map_secrets(body: &[u8]) -> Vec<(&'static str, String, Severity)> {
    let raw = String::from_utf8_lossy(body);
    if !raw.contains("\"sourcesContent\"") {
        return vec![];
    }
    crate::page::secrets(&raw)
}

/// Pede um caminho inexistente e procura páginas de depuração ou rastros de pilha.
pub async fn error_page(
    scan: &mut Scan,
    base: &Url,
    client: &Client,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let id = "exposure.error-page";
    let marker: String = scan
        .id
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(8)
        .collect();
    let Some(target) = scoped(base, &scan.config, &format!("/qypher-inexistente-{marker}")) else {
        return Ok(());
    };
    let Some(response) = send(scan, client, cancel, id, Method::GET, &target, None).await? else {
        return Ok(());
    };
    let status = response.status().as_u16();
    let Some(body) = read_for_check(scan, id, &target, response, 64 * 1024, cancel).await? else {
        return Ok(());
    };
    let complete = body.complete;
    let body = String::from_utf8_lossy(&body.bytes).into_owned();
    match debug_signature(&body) {
        Some((what, severity)) => {
            let mut f = Finding::at(
                id,
                target.as_str(),
                "Página de erro revela detalhes internos",
                severity,
                &format!("Um caminho inexistente respondeu HTTP {status} com assinatura de {what}. Corpo e credenciais foram descartados."),
                "Rastros de pilha e páginas de depuração revelam caminhos do servidor, versões, trechos de código e às vezes variáveis de ambiente e credenciais. Depuradores interativos permitem executar código.",
                "Desligue o modo de depuração em produção (DEBUG=False, APP_DEBUG=false, customErrors=On, display_errors=Off) e sirva uma página de erro genérica.",
                ERROR_REF,
            );
            f.category = "Exposição".into();
            f.confidence = "confirmed".into();
            f.classification = "exposure".into();
            scan.log(
                "discovery.exposed",
                &format!("Página de erro: {what}"),
                LogLevel::Warn,
            );
            scan.findings.push(f.clone());
            scan.checks.push(check(
                id,
                &target,
                CheckStatus::Finding,
                "Assinatura de página de depuração confirmada.",
                Some(f),
            ));
        }
        None => scan.checks.push(check(
            id,
            &target,
            if complete { CheckStatus::Passed } else { CheckStatus::Error },
            &format!("HTTP {status}; nenhuma assinatura de depuração observada. Leitura completa: {complete}."),
            None,
        )),
    }
    Ok(())
}

/// Diretórios comuns testados quanto à listagem automática de arquivos.
pub const LISTING_DIRECTORIES: [(&str, bool); 6] = [
    ("/uploads/", true),
    ("/backup/", true),
    ("/files/", true),
    ("/static/", false),
    ("/assets/", false),
    ("/images/", false),
];

pub async fn directory_listings(
    scan: &mut Scan,
    base: &Url,
    client: &Client,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let id = "exposure.directory-listing";
    for (path, sensitive) in LISTING_DIRECTORIES {
        let Some(target) = scoped(base, &scan.config, path) else {
            continue;
        };
        let Some(response) = send(scan, client, cancel, id, Method::GET, &target, None).await?
        else {
            continue;
        };
        let status = response.status().as_u16();
        let Some(body) = read_for_check(scan, id, &target, response, BODY_LIMIT, cancel).await?
        else {
            continue;
        };
        let listed = status == 200 && listing_signature(&String::from_utf8_lossy(&body.bytes));
        if listed {
            let mut f = Finding::at(
                id,
                target.as_str(),
                "Listagem de diretório habilitada",
                if sensitive { Severity::Medium } else { Severity::Low },
                &format!("GET {} devolveu o índice automático de arquivos do diretório.", target.path()),
                "Qualquer visitante vê e baixa todos os arquivos da pasta, inclusive os que não têm link: uploads de usuários, backups e arquivos esquecidos.",
                "Desative a listagem (Apache: Options -Indexes; nginx: autoindex off) e sirva só os arquivos necessários.",
                A05_REF,
            );
            f.category = "Exposição".into();
            f.confidence = "confirmed".into();
            f.classification = "exposure".into();
            scan.log(
                "discovery.exposed",
                &format!("Listagem de diretório: {path}"),
                LogLevel::Warn,
            );
            scan.findings.push(f.clone());
            scan.checks.push(check(
                id,
                &target,
                CheckStatus::Finding,
                "Índice de diretório reconhecido.",
                Some(f),
            ));
        } else {
            scan.checks.push(check(
                id,
                &target,
                if body.complete && matches!(status, 200 | 401 | 403 | 404 | 410) {
                    CheckStatus::Passed
                } else {
                    CheckStatus::Error
                },
                &format!(
                    "HTTP {status}; nenhum índice observado. Leitura completa: {}.",
                    body.complete
                ),
                None,
            ));
        }
    }
    Ok(())
}

/// Leak Hunter: lê até três bundles da mesma origem/prefixo, sem executar JavaScript.
pub async fn script_bundles(
    scan: &mut Scan,
    scripts: &[Url],
    client: &Client,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let id = "page.bundle-secret";
    for script in scripts.iter().take(3) {
        let mut target = script.clone();
        target.set_query(None);
        target.set_fragment(None);
        let Some(response) = send(scan, client, cancel, id, Method::GET, &target, None).await?
        else {
            continue;
        };
        let status = response.status().as_u16();
        if response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().contains("text/html"))
        {
            scan.checks.push(check(
                id,
                &target,
                CheckStatus::NotRun,
                "O script respondeu HTML; análise de bundle não executada.",
                None,
            ));
            continue;
        }
        let Some(body) = read_for_check(
            scan,
            id,
            &target,
            response,
            crate::discovery::PAGE_LIMIT,
            cancel,
        )
        .await?
        else {
            continue;
        };
        let matched = if status == 200 {
            crate::page::secrets(&String::from_utf8_lossy(&body.bytes))
        } else {
            vec![]
        };
        if matched.is_empty() {
            scan.checks.push(check(id, &target,
                if body.complete && matches!(status, 200 | 401 | 403 | 404 | 410) { CheckStatus::Passed } else { CheckStatus::Error },
                &format!("HTTP {status}; nenhum padrão privado reconhecido no bundle. Leitura completa: {}.", body.complete), None));
        } else {
            let evidence = matched
                .iter()
                .map(|(kind, hint, _)| format!("{kind} [{hint}]"))
                .collect::<Vec<_>>()
                .join("; ");
            let mut finding = Finding::at(id, target.as_str(), "Possível segredo privado em bundle JavaScript público", Severity::High,
                &evidence,
                "O padrão pode ser uma credencial privada incluída no build público. Sua validade não foi testada; fixtures e exemplos podem ser falsos positivos.",
                "Confirme sem divulgar o valor. Se for segredo real, revogue/rotacione, remova do build e mova o acesso privilegiado para o servidor. Não trate configurações públicas Firebase/Supabase como credenciais privadas por si só.",
                "OWASP Secrets Management — https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html");
            finding.category = "Leak Hunter / JavaScript".into();
            finding.confidence = "heuristic".into();
            finding.classification = "potential".into();
            finding.detector_version = "1.0.1".into();
            scan.findings.push(finding.clone());
            scan.checks.push(check(
                id,
                &target,
                CheckStatus::Finding,
                "Padrão observado em memória; valores e conteúdo não foram armazenados.",
                Some(finding),
            ));
            scan.log("leaks.bundle", "Padrão privado em bundle autorizado; somente metadados sanitizados foram registrados.", LogLevel::Warn);
        }
    }
    Ok(())
}

/// Verifica se os scripts da própria origem publicam o source map correspondente.
pub async fn source_maps(
    scan: &mut Scan,
    scripts: &[Url],
    client: &Client,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let id = "exposure.source-map";
    for script in scripts.iter().take(3) {
        let mut target = script.clone();
        target.set_query(None);
        target.set_fragment(None);
        target.set_path(&format!("{}.map", script.path()));
        let Some(response) = send(scan, client, cancel, id, Method::GET, &target, None).await?
        else {
            continue;
        };
        let status = response.status().as_u16();
        let Some(body) = read_for_check(scan, id, &target, response, BODY_LIMIT, cancel).await?
        else {
            continue;
        };
        // Mapa truncado sem leitura completa não confirma exposição.
        let exposed = status == 200 && body.complete && source_map_signature(&body.bytes);
        if exposed {
            let mut f = Finding::at(
                id,
                target.as_str(),
                "Source map publicado em produção",
                Severity::Low,
                &format!("GET {} devolveu um source map válido.", target.path()),
                "O código-fonte original do front-end pode ser reconstruído, com comentários, nomes internos, rotas de API e eventuais segredos embutidos no build.",
                "Não publique arquivos .map em produção, ou restrinja o acesso e envie os source maps só para a ferramenta de monitoramento de erros.",
                A05_REF,
            );
            f.category = "Exposição".into();
            f.confidence = "confirmed".into();
            f.classification = "exposure".into();
            scan.findings.push(f.clone());
            scan.checks.push(check(
                id,
                &target,
                CheckStatus::Finding,
                "Source map reconhecido.",
                Some(f),
            ));
            // Segredos embutidos no código-fonte original (sourcesContent): achado separado.
            let leaked = source_map_secrets(&body.bytes);
            if leaked.iter().any(|(_, _, s)| *s == Severity::High) {
                let secret_id = "exposure.source-map-secret";
                let evidence = leaked
                    .iter()
                    .map(|(label, hint, _)| format!("{label} [{hint}]"))
                    .collect::<Vec<_>>()
                    .join("; ");
                let mut sf = Finding::at(
                    secret_id,
                    target.as_str(),
                    "Possível segredo embutido em source map exposto",
                    Severity::High,
                    &format!("O source map {} inclui o código-fonte original com possível credencial: {evidence}.", target.path()),
                    "O source map publicado embute o código-fonte (sourcesContent), que pode conter chaves, tokens ou strings de conexão. A validade não foi testada: exemplos e credenciais revogadas são falsos positivos.",
                    "Remova arquivos .map de produção e rotacione qualquer segredo que estava no bundle. Mantenha segredos apenas no servidor ou em um cofre.",
                    A05_REF,
                );
                sf.category = "Exposição".into();
                sf.confidence = "heuristic".into();
                sf.classification = "potential".into();
                sf.detector_version = "1.0.0".into();
                scan.findings.push(sf.clone());
                scan.checks.push(check(
                    secret_id,
                    &target,
                    CheckStatus::Finding,
                    "Possível segredo observado no sourcesContent.",
                    Some(sf),
                ));
            }
        } else {
            scan.checks.push(check(
                id,
                &target,
                if body.complete && matches!(status, 200 | 401 | 403 | 404 | 410) { CheckStatus::Passed } else { CheckStatus::Error },
                &format!("HTTP {status}; nenhuma assinatura de source map observada. Leitura completa: {}.", body.complete),
                None,
            ));
        }
    }
    Ok(())
}

/// HTTP e HTTPS são origens diferentes. O consentimento de testes ativos não
/// amplia a allowlist; a porta HTTP só pode ser analisada como alvo autorizado próprio.
pub async fn http_redirect(
    scan: &mut Scan,
    url: &Url,
    cancel: &CancellationToken,
) -> Result<(), String> {
    if cancel.is_cancelled() {
        return Err("cancelled".into());
    }
    scan.checks.push(check(
        "active.http-redirect", url, CheckStatus::NotRun,
        "HTTP usa outra origem/porta. Nenhuma conexão foi feita fora da allowlist; cadastre o endereço HTTP como alvo autorizado separado.",
        None,
    ));
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_pages_are_recognized() {
        let cases = [
            ("<title>Werkzeug Debugger</title>", Severity::High),
            (
                "You're seeing this error because you have <code>DEBUG = True</code>",
                Severity::Medium,
            ),
            (
                "<h1>Whoops!</h1> Illuminate\\Database\\QueryException <h2>Stack trace</h2>",
                Severity::Medium,
            ),
            (
                "Server Error in '/' Application.<b>Stack Trace:</b>",
                Severity::Medium,
            ),
            (
                "Traceback (most recent call last):\n  File \"app.py\"",
                Severity::Medium,
            ),
            (
                "<b>Warning</b>: include(x) in <b>/var/www/a.php</b> on line <b>3</b>",
                Severity::Low,
            ),
            ("<h1>Whitelabel Error Page</h1>", Severity::Low),
        ];
        for (body, severity) in cases {
            assert_eq!(debug_signature(body).map(|s| s.1), Some(severity), "{body}");
        }
    }

    #[test]
    fn ordinary_not_found_pages_are_ignored() {
        for body in [
            "",
            "<html><h1>404 Not Found</h1><hr>nginx</html>",
            "<html>Página não encontrada. Voltar ao início.</html>",
            "<h1>Whoops, looks like something went wrong.</h1>",
            "{\"error\":\"not found\"}",
        ] {
            assert_eq!(debug_signature(body), None, "{body}");
            assert!(!listing_signature(body), "{body}");
        }
    }

    #[test]
    fn directory_indexes_are_recognized() {
        assert!(listing_signature(
            "<html><head><title>Index of /uploads</title>"
        ));
        assert!(listing_signature("<h1>Directory listing for /files/</h1>"));
        assert!(listing_signature("<a href=\"/\">[To Parent Directory]</a>"));
    }

    #[test]
    fn source_maps_are_recognized() {
        assert!(source_map_signature(
            br#"{"version":3,"sources":["a.ts"],"mappings":"AAAA"}"#
        ));
        assert!(!source_map_signature(
            b"<!doctype html><html>\"version\" \"sources\"</html>"
        ));
        assert!(!source_map_signature(b"{\"error\":\"not found\"}"));
        // `sources` sem `mappings` não é um mapa utilizável comprovado.
        assert!(!source_map_signature(
            br#"{"version":3,"sources":["a.ts"]}"#
        ));
    }

    #[test]
    fn source_map_secrets_in_sources_content_are_detected_without_values() {
        let key = ["glpat-", &"a".repeat(20)].concat();
        let map = format!(
            r#"{{"version":3,"sources":["a.ts"],"mappings":"AAAA","sourcesContent":["const t='{key}';"]}}"#
        );
        let found = source_map_secrets(map.as_bytes());
        assert!(
            found.iter().any(|(_, _, s)| *s == Severity::High),
            "deveria achar o token embutido"
        );
        assert!(
            found.iter().all(|(_, hint, _)| !hint.contains(&key)),
            "o valor completo nunca pode aparecer"
        );
        // Sem sourcesContent (só mappings) não há código-fonte embutido para varrer.
        assert!(source_map_secrets(br#"{"version":3,"mappings":"AAAA"}"#).is_empty());
    }

    #[tokio::test]
    async fn bundle_secrets_are_metadata_only_and_other_origins_never_get_requested() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = Url::parse(&format!(
            "http://{}/app/bundle.js",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let private_value = ["ghp_", &"Ab9".repeat(14)].concat();
        let body = format!("const token = '{private_value}';");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut data = [0u8; 2048];
            let n = socket.read(&mut data).await.unwrap();
            assert!(String::from_utf8_lossy(&data[..n]).starts_with("GET /app/bundle.js "));
            let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/javascript\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        let config = ScanConfig {
            project_id: "fixture".into(),
            url: target.to_string(),
            authorized: true,
            allow_private: true,
            path_prefix: "/app".into(),
            max_requests: 3,
            max_redirects: 0,
            timeout_seconds: 2,
            discovery: true,
            active_checks: false,
        };
        let mut scan = Scan::new(config);
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        script_bundles(
            &mut scan,
            &[
                target,
                Url::parse("https://outside.invalid/bundle.js").unwrap(),
            ],
            &client,
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(scan.request_count, 1);
        assert_eq!(scan.findings.len(), 1);
        assert_eq!(scan.findings[0].detector_id, "page.bundle-secret");
        assert_eq!(scan.findings[0].confidence, "heuristic");
        assert!(scan
            .checks
            .iter()
            .any(|check| check.status == CheckStatus::NotRun));
        assert!(!serde_json::to_string(&scan)
            .unwrap()
            .contains(&private_value));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn http_upgrade_probe_never_opens_an_unlisted_origin() {
        let url = Url::parse("https://example.test/app").unwrap();
        let mut scan = Scan::new(ScanConfig {
            project_id: "fixture".into(),
            url: url.to_string(),
            authorized: true,
            allow_private: false,
            path_prefix: "/app".into(),
            max_requests: 2,
            max_redirects: 0,
            timeout_seconds: 2,
            discovery: false,
            active_checks: true,
        });
        http_redirect(&mut scan, &url, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(scan.request_count, 0);
        assert_eq!(scan.checks[0].status, CheckStatus::NotRun);
    }
}
