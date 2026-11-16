//! Fase opcional de exposição: lista fixa de caminhos sensíveis, validada por assinatura
//! de conteúdo (evita falsos positivos de páginas 200 genéricas), e testes ativos não
//! destrutivos. Tudo dentro da origem/prefixo autorizados, um pedido por vez e no orçamento.

use crate::probes;
use reqwest::{Client, Method, Response};
use scanner_core::*;
use tokio_util::sync::CancellationToken;
use url::Url;

const A05_REF: &str =
    "OWASP Top 10 A05 Configuração insegura — https://owasp.org/Top10/A05_2021-Security_Misconfiguration/";
const WSTG_REF: &str =
    "OWASP WSTG — Enumerar arquivos e backups expostos — https://owasp.org/www-project-web-security-testing-guide/";
const CORS_REF: &str = "PortSwigger — CORS — https://portswigger.net/web-security/cors";

/// Origem sintética usada no teste de reflexão. `.invalid` nunca resolve (RFC 6761).
pub const PROBE_ORIGIN: &str = "https://qypher-probe.invalid";
pub(crate) const BODY_LIMIT: usize = 8 * 1024;
pub const PAGE_LIMIT: usize = 1024 * 1024;

pub struct Exposure {
    pub slug: &'static str,
    pub path: &'static str,
    pub title: &'static str,
    pub severity: Severity,
    pub matches: fn(&[u8]) -> bool,
    pub impact: &'static str,
    pub fix: &'static str,
}

pub(crate) fn text(body: &[u8]) -> String {
    String::from_utf8_lossy(body).to_ascii_lowercase()
}
pub(crate) fn is_html(body: &[u8]) -> bool {
    let t = text(&body[..body.len().min(512)]);
    t.contains("<!doctype html") || t.contains("<html") || t.contains("<head")
}
fn env_file(body: &[u8]) -> bool {
    if is_html(body) {
        return false;
    }
    let t = String::from_utf8_lossy(body);
    let assignments = t
        .lines()
        .filter(|l| {
            l.split_once('=').is_some_and(|(k, _)| {
                let k = k.trim().trim_start_matches("export ");
                k.len() >= 3
                    && k.chars()
                        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
            })
        })
        .count();
    assignments >= 2
}
fn sql_dump(body: &[u8]) -> bool {
    let t = text(body);
    !is_html(body)
        && (t.contains("-- mysql dump")
            || t.contains("-- postgresql database dump")
            || (t.contains("create table") && t.contains("insert into")))
}
fn zip(body: &[u8]) -> bool {
    body.starts_with(b"PK\x03\x04")
}
fn gzip(body: &[u8]) -> bool {
    body.starts_with(&[0x1f, 0x8b])
}

pub fn catalog() -> Vec<Exposure> {
    let git = "O histórico e o código-fonte completos podem ser reconstruídos por qualquer visitante, incluindo credenciais antigas.";
    let git_fix = "Bloqueie o acesso a diretórios ocultos no servidor (ex.: location ~ /\\. { deny all; }) e não publique a pasta .git. Troque credenciais que já estiveram no repositório.";
    let backup = "Backups costumam conter código, senhas e dados de usuários; o download é direto e sem autenticação.";
    let backup_fix = "Remova o arquivo da raiz pública, guarde backups fora do diretório servido e troque as credenciais contidas nele.";
    let debug = "Painéis de diagnóstico revelam configuração interna, variáveis de ambiente, rotas e às vezes permitem alterar o estado da aplicação.";
    let debug_fix = "Desative o recurso em produção ou restrinja por autenticação e rede interna.";
    let secret = "A credencial dá acesso direto ao serviço em nome do dono: leitura e alteração de dados, publicação de código ou controle da infraestrutura.";
    let secret_fix = "Revogue e gere a credencial de novo imediatamente, remova o arquivo da raiz pública e bloqueie arquivos ocultos no servidor.";
    let admin = "Gerenciadores de banco expostos ficam sujeitos a força bruta e às falhas do próprio painel; um acesso equivale ao controle do banco de dados.";
    let admin_fix = "Remova o painel de produção ou restrinja por VPN/IP e autenticação adicional.";
    vec![
        Exposure { slug: "git-head", path: "/.git/HEAD", title: "Repositório Git exposto", severity: Severity::High,
            matches: |b| { let t = text(b); t.starts_with("ref: refs/") || (t.trim().len() == 40 && t.trim().chars().all(|c| c.is_ascii_hexdigit())) },
            impact: git, fix: git_fix },
        Exposure { slug: "git-config", path: "/.git/config", title: "Configuração do Git exposta", severity: Severity::High,
            matches: |b| text(b).contains("[core]"), impact: git, fix: git_fix },
        Exposure { slug: "svn", path: "/.svn/entries", title: "Metadados do Subversion expostos", severity: Severity::Medium,
            matches: |b| !is_html(b) && { let t = text(b); t.starts_with("12\n") || t.starts_with("10\n") || t.contains("svn:") }, impact: git, fix: git_fix },
        Exposure { slug: "env", path: "/.env", title: "Arquivo .env exposto", severity: Severity::High,
            matches: env_file,
            impact: "Arquivos .env guardam senhas de banco, chaves de API e segredos de sessão; a exposição costuma levar ao comprometimento total da aplicação.",
            fix: "Remova o arquivo da raiz pública, bloqueie arquivos ocultos no servidor e troque todos os segredos que ele continha." },
        Exposure { slug: "env-backup", path: "/.env.bak", title: "Cópia do arquivo .env exposta", severity: Severity::High,
            matches: env_file, impact: backup, fix: backup_fix },
        Exposure { slug: "htpasswd", path: "/.htpasswd", title: "Arquivo de senhas .htpasswd exposto", severity: Severity::High,
            matches: |b| !is_html(b) && { let t = String::from_utf8_lossy(b); t.lines().any(|l| l.contains(":$apr1$") || l.contains(":$2y$") || l.contains(":{SHA}")) },
            impact: "Os hashes de senha podem ser quebrados offline e usados para entrar nas áreas protegidas.",
            fix: "Mova o arquivo para fora da raiz pública, bloqueie arquivos ocultos e troque as senhas." },
        Exposure { slug: "ds-store", path: "/.DS_Store", title: "Arquivo .DS_Store exposto", severity: Severity::Low,
            matches: |b| b.len() > 8 && &b[4..8] == b"Bud1",
            impact: "Revela nomes de arquivos e pastas do diretório, inclusive os que não têm link em lugar nenhum.",
            fix: "Remova o arquivo e bloqueie arquivos ocultos no servidor." },
        Exposure { slug: "backup-zip", path: "/backup.zip", title: "Backup compactado acessível", severity: Severity::High,
            matches: zip, impact: backup, fix: backup_fix },
        Exposure { slug: "backup-tar", path: "/backup.tar.gz", title: "Backup compactado acessível", severity: Severity::High,
            matches: gzip, impact: backup, fix: backup_fix },
        Exposure { slug: "backup-sql", path: "/backup.sql", title: "Dump de banco de dados acessível", severity: Severity::High,
            matches: sql_dump, impact: backup, fix: backup_fix },
        Exposure { slug: "dump-sql", path: "/dump.sql", title: "Dump de banco de dados acessível", severity: Severity::High,
            matches: sql_dump, impact: backup, fix: backup_fix },
        Exposure { slug: "database-sql", path: "/database.sql", title: "Dump de banco de dados acessível", severity: Severity::High,
            matches: sql_dump, impact: backup, fix: backup_fix },
        Exposure { slug: "wp-config-backup", path: "/wp-config.php.bak", title: "Backup do wp-config.php acessível", severity: Severity::High,
            matches: |b| { let t = text(b); t.contains("<?php") && t.contains("db_password") }, impact: backup, fix: backup_fix },
        Exposure { slug: "phpinfo", path: "/phpinfo.php", title: "Página phpinfo() pública", severity: Severity::Medium,
            matches: |b| { let t = text(b); t.contains("phpinfo()") || (t.contains("php version") && t.contains("configure command")) }, impact: debug, fix: "Apague o arquivo do servidor." },
        Exposure { slug: "php-info", path: "/info.php", title: "Página phpinfo() pública", severity: Severity::Medium,
            matches: |b| { let t = text(b); t.contains("phpinfo()") || (t.contains("php version") && t.contains("configure command")) }, impact: debug, fix: "Apague o arquivo do servidor." },
        Exposure { slug: "server-status", path: "/server-status", title: "Apache server-status público", severity: Severity::Medium,
            matches: |b| text(b).contains("apache server status"), impact: debug, fix: debug_fix },
        Exposure { slug: "actuator-env", path: "/actuator/env", title: "Spring Boot Actuator /env público", severity: Severity::High,
            matches: |b| { let t = text(b); t.contains("propertysources") || t.contains("activeprofiles") }, impact: debug, fix: debug_fix },
        Exposure { slug: "actuator", path: "/actuator", title: "Spring Boot Actuator público", severity: Severity::Medium,
            matches: |b| { let t = text(b); t.contains("\"_links\"") && t.contains("actuator") }, impact: debug, fix: debug_fix },
        Exposure { slug: "pprof", path: "/debug/pprof/", title: "Profiler Go (pprof) público", severity: Severity::Medium,
            matches: |b| { let t = text(b); t.contains("pprof") && t.contains("goroutine") }, impact: debug, fix: debug_fix },
        Exposure { slug: "elmah", path: "/elmah.axd", title: "Log de erros ELMAH público", severity: Severity::Medium,
            matches: |b| text(b).contains("error log for"), impact: debug, fix: debug_fix },
        Exposure { slug: "symfony-profiler", path: "/_profiler/", title: "Symfony Profiler público", severity: Severity::Medium,
            matches: |b| text(b).contains("symfony profiler"), impact: debug, fix: debug_fix },
        Exposure { slug: "telescope", path: "/telescope/requests", title: "Laravel Telescope público", severity: Severity::Medium,
            matches: |b| text(b).contains("laravel telescope"), impact: debug, fix: debug_fix },
        Exposure { slug: "swagger", path: "/swagger.json", title: "Especificação da API publicada", severity: Severity::Info,
            matches: |b| { let t = text(b); !is_html(b) && (t.contains("\"swagger\"") || t.contains("\"openapi\"")) },
            impact: "A especificação lista todos os endpoints e parâmetros. É intencional em APIs públicas, mas revela superfície interna em APIs privadas.",
            fix: "Confirme se a documentação deveria ser pública; se não, proteja por autenticação." },
        Exposure { slug: "openapi", path: "/openapi.json", title: "Especificação da API publicada", severity: Severity::Info,
            matches: |b| { let t = text(b); !is_html(b) && (t.contains("\"swagger\"") || t.contains("\"openapi\"")) },
            impact: "A especificação lista todos os endpoints e parâmetros. É intencional em APIs públicas, mas revela superfície interna em APIs privadas.",
            fix: "Confirme se a documentação deveria ser pública; se não, proteja por autenticação." },
        Exposure { slug: "crossdomain", path: "/crossdomain.xml", title: "crossdomain.xml permite qualquer domínio", severity: Severity::Low,
            matches: |b| { let t = text(b); t.contains("allow-access-from") && t.contains("domain=\"*\"") },
            impact: "Clientes legados (Flash, Silverlight, alguns PDFs) de qualquer site podem ler respostas autenticadas.",
            fix: "Remova o arquivo ou limite os domínios permitidos." },
        // Credenciais e chaves
        Exposure { slug: "aws-credentials", path: "/.aws/credentials", title: "Credenciais da AWS expostas", severity: Severity::High,
            matches: |b| !is_html(b) && text(b).contains("aws_access_key_id"), impact: secret, fix: secret_fix },
        Exposure { slug: "npmrc", path: "/.npmrc", title: "Token do npm exposto (.npmrc)", severity: Severity::High,
            matches: |b| !is_html(b) && text(b).contains("_authtoken"), impact: secret, fix: secret_fix },
        Exposure { slug: "git-credentials", path: "/.git-credentials", title: "Credenciais do Git expostas", severity: Severity::High,
            matches: |b| !is_html(b) && { let t = text(b); t.lines().any(|l| (l.starts_with("https://") || l.starts_with("http://")) && l.contains('@') && l.matches(':').count() >= 2) },
            impact: secret, fix: secret_fix },
        Exposure { slug: "ssh-key", path: "/id_rsa", title: "Chave privada SSH exposta", severity: Severity::High,
            matches: |b| { let t = text(b); t.contains("-----begin") && t.contains("private key-----") }, impact: secret, fix: secret_fix },
        Exposure { slug: "sftp-config", path: "/.vscode/sftp.json", title: "Configuração de SFTP com credenciais exposta", severity: Severity::High,
            matches: |b| !is_html(b) && { let t = text(b); t.contains("\"host\"") && (t.contains("\"password\"") || t.contains("\"privatekeypath\"") || t.contains("\"passphrase\"")) },
            impact: secret, fix: secret_fix },
        Exposure { slug: "config-php-backup", path: "/config.php.bak", title: "Backup de configuração PHP acessível", severity: Severity::High,
            matches: |b| text(b).contains("<?php"), impact: backup, fix: backup_fix },
        Exposure { slug: "web-inf", path: "/WEB-INF/web.xml", title: "Descritor WEB-INF/web.xml acessível", severity: Severity::High,
            matches: |b| text(b).contains("<web-app"),
            impact: "A pasta WEB-INF guarda configuração, classes e bibliotecas da aplicação Java; o acesso direto indica que o código e os segredos podem ser baixados.",
            fix: "Corrija a configuração do servidor/proxy para nunca servir WEB-INF e META-INF." },
        Exposure { slug: "web-config", path: "/web.config", title: "Arquivo web.config acessível", severity: Severity::Medium,
            matches: |b| !is_html(b) && text(b).contains("<configuration"),
            impact: "O web.config pode conter strings de conexão, chaves de máquina e regras internas da aplicação.",
            fix: "Bloqueie o download de arquivos de configuração no servidor e mova segredos para um cofre." },
        Exposure { slug: "docker-compose", path: "/docker-compose.yml", title: "docker-compose.yml acessível", severity: Severity::Medium,
            matches: |b| !is_html(b) && { let t = text(b); t.contains("services:") && (t.contains("image:") || t.contains("build:")) },
            impact: "Revela a arquitetura, portas internas e, com frequência, senhas definidas em variáveis de ambiente.",
            fix: "Não publique arquivos de infraestrutura na raiz servida e troque as senhas que constavam nele." },
        Exposure { slug: "package-json", path: "/package.json", title: "Manifesto de dependências acessível", severity: Severity::Low,
            matches: |b| !is_html(b) && text(b).contains("\"dependencies\""),
            impact: "Lista as dependências e versões exatas do projeto, o que facilita procurar falhas públicas aplicáveis.",
            fix: "Sirva apenas a pasta de build; não publique a raiz do projeto." },
        Exposure { slug: "hg", path: "/.hg/requires", title: "Repositório Mercurial exposto", severity: Severity::Medium,
            matches: |b| !is_html(b) && { let t = text(b); t.contains("revlogv1") || t.contains("fncache") || t.contains("dotencode") }, impact: git, fix: git_fix },
        // Logs e diagnóstico
        Exposure { slug: "laravel-log", path: "/storage/logs/laravel.log", title: "Log do Laravel acessível", severity: Severity::Medium,
            matches: |b| !is_html(b) && { let t = text(b); t.contains("local.error") || t.contains("production.error") || t.contains("[stacktrace]") },
            impact: "Logs de aplicação guardam rastros de pilha, consultas SQL, e-mails, tokens e dados de usuários.",
            fix: "Bloqueie o acesso à pasta storage e sirva somente a pasta public." },
        Exposure { slug: "wp-debug-log", path: "/wp-content/debug.log", title: "Log de depuração do WordPress acessível", severity: Severity::Medium,
            matches: |b| !is_html(b) && { let t = text(b); t.contains("php notice") || t.contains("php warning") || t.contains("php fatal error") },
            impact: "O log revela caminhos do servidor, plugins instalados e erros que ajudam a montar um ataque.",
            fix: "Desative WP_DEBUG_LOG em produção, apague o arquivo e bloqueie o acesso a arquivos .log." },
        Exposure { slug: "server-info", path: "/server-info", title: "Apache server-info público", severity: Severity::Medium,
            matches: |b| text(b).contains("apache server information"), impact: debug, fix: debug_fix },
        Exposure { slug: "trace-axd", path: "/trace.axd", title: "Rastreamento do ASP.NET (trace.axd) público", severity: Severity::Medium,
            matches: |b| { let t = text(b); t.contains("application trace") && t.contains("requests to this application") }, impact: debug, fix: debug_fix },
        Exposure { slug: "actuator-heapdump", path: "/actuator/heapdump", title: "Dump de memória do Spring Boot acessível", severity: Severity::High,
            matches: |b| b.starts_with(b"JAVA PROFILE"),
            impact: "O dump de memória contém senhas, tokens de sessão e dados de usuários em texto claro.",
            fix: debug_fix },
        // Painéis administrativos
        Exposure { slug: "admin-phpmyadmin", path: "/phpmyadmin/", title: "phpMyAdmin acessível pela internet", severity: Severity::Medium,
            matches: |b| { let t = text(b); t.contains("phpmyadmin") && (t.contains("pma_username") || t.contains("<title>phpmyadmin")) }, impact: admin, fix: admin_fix },
        Exposure { slug: "admin-adminer", path: "/adminer.php", title: "Adminer acessível pela internet", severity: Severity::Medium,
            matches: |b| { let t = text(b); t.contains("adminer") && t.contains("auth[") }, impact: admin, fix: admin_fix },
        Exposure { slug: "admin-wp-login", path: "/wp-login.php", title: "Tela de login do WordPress exposta", severity: Severity::Info,
            matches: |b| { let t = text(b); t.contains("wp-submit") || t.contains("user_login") },
            impact: "A tela de login pública permite tentativas de adivinhação de senha e enumeração de usuários.",
            fix: "Ative autenticação em dois fatores e limite de tentativas; se possível, restrinja o acesso por IP." },
    ]
}

pub(crate) struct BodyRead {
    pub bytes: Vec<u8>,
    pub complete: bool,
}

pub(crate) async fn read_limited(
    mut response: Response,
    limit: usize,
    cancel: &CancellationToken,
) -> Result<BodyRead, String> {
    let mut out = Vec::new();
    loop {
        let next = tokio::select! { biased;
            _=cancel.cancelled()=>return Err("cancelled".into()),
            next=response.chunk()=>next.map_err(|_| "Leitura HTTP interrompida; cobertura inconclusiva.")?
        };
        match next {
            Some(chunk) => {
                let take = chunk.len().min(limit - out.len());
                out.extend_from_slice(&chunk[..take]);
                if take < chunk.len() {
                    return Ok(BodyRead {
                        bytes: out,
                        complete: false,
                    });
                }
            }
            None => {
                return Ok(BodyRead {
                    bytes: out,
                    complete: true,
                })
            }
        }
    }
}

pub(crate) async fn read_for_check(
    scan: &mut Scan,
    id: &str,
    target: &Url,
    response: Response,
    limit: usize,
    cancel: &CancellationToken,
) -> Result<Option<BodyRead>, String> {
    match read_limited(response, limit, cancel).await {
        Ok(body) => Ok(Some(body)),
        Err(error) if error == "cancelled" => Err(error),
        Err(_) => {
            scan.checks.push(check(
                id,
                target,
                CheckStatus::Error,
                "Leitura HTTP incompleta; nenhuma ausência de problemas pode ser inferida.",
                None,
            ));
            Ok(None)
        }
    }
}

/// URL de um caminho de sonda dentro do prefixo autorizado (`/app` + `/.env` → `/app/.env`).
pub(crate) fn scoped(base: &Url, config: &ScanConfig, path: &str) -> Option<Url> {
    let prefix = config.path_prefix.trim_end_matches('/');
    base.join(&format!("{prefix}{path}")).ok()
}

pub(crate) fn check(
    id: &str,
    resource: &Url,
    status: CheckStatus,
    reason: &str,
    finding: Option<Finding>,
) -> CheckResult {
    CheckResult {
        detector_id: id.into(),
        detector_version: if id == "page.bundle-secret" || id.starts_with("active.cors-") {
            "1.0.1"
        } else {
            "1.0.0"
        }
        .into(),
        resource: resource.to_string(),
        status,
        reason: reason.into(),
        findings: finding.into_iter().collect(),
    }
}

/// Envia um pedido dentro do escopo e do orçamento. `Ok(None)` = não executado (motivo no check).
pub(crate) async fn send(
    scan: &mut Scan,
    client: &Client,
    cancel: &CancellationToken,
    id: &str,
    method: Method,
    target: &Url,
    origin: Option<&str>,
) -> Result<Option<Response>, String> {
    if cancel.is_cancelled() {
        return Err("cancelled".into());
    }
    if scan.config.check_url(target).is_err() {
        scan.checks.push(check(
            id,
            target,
            CheckStatus::NotRun,
            "Caminho fora do prefixo autorizado.",
            None,
        ));
        return Ok(None);
    }
    if scan.request_count >= scan.config.max_requests {
        scan.checks.push(check(
            id,
            target,
            CheckStatus::NotRun,
            "Orçamento de requisições esgotado.",
            None,
        ));
        return Ok(None);
    }
    scan.request_count += 1;
    let mut request = client.request(method, target.clone());
    if let Some(origin) = origin {
        request = request.header("Origin", origin);
    }
    let result = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err("cancelled".into()),
        r = request.send() => r,
    };
    match result {
        Ok(response) => Ok(Some(response)),
        Err(_) => {
            scan.checks.push(check(
                id,
                target,
                CheckStatus::Error,
                "Falha de rede ou timeout; resultado inconclusivo.",
                None,
            ));
            Ok(None)
        }
    }
}

fn exposure_finding(id: &str, target: &Url, e: &Exposure) -> Finding {
    let mut f = Finding::at(
        id,
        target.as_str(),
        e.title,
        e.severity.clone(),
        &format!("GET {} respondeu 200 e o conteúdo corresponde à assinatura esperada. Um trecho do conteúdo exposto está anexado para você conferir e avisar o responsável.", target.path()),
        e.impact,
        e.fix,
        if e.severity == Severity::Info { A05_REF } else { WSTG_REF },
    );
    f.category = "Exposição".into();
    f.confidence = "confirmed".into();
    f.classification = "exposure".into();
    f
}

pub async fn exposures(
    scan: &mut Scan,
    base: &Url,
    client: &Client,
    scripts: &[Url],
    cancel: &CancellationToken,
    progress: &(impl Fn(&Scan) + Send + Sync),
) -> Result<(), String> {
    scan.log(
        "discovery.start",
        "Busca por arquivos e painéis expostos iniciada (lista fixa, um pedido por vez).",
        LogLevel::Info,
    );
    progress(scan);
    for e in catalog() {
        let id = format!("exposure.{}", e.slug);
        let Some(target) = scoped(base, &scan.config, e.path) else {
            continue;
        };
        if e.slug == "actuator-heapdump" {
            scan.checks.push(check(&id, &target, CheckStatus::NotRun,
                "GET pode gerar um dump de memória no servidor. A sonda foi omitida para evitar custo e coleta de conteúdo privado.", None));
            continue;
        }
        let Some(response) = send(scan, client, cancel, &id, Method::GET, &target, None).await?
        else {
            continue;
        };
        let status = response.status().as_u16();
        let Some(body) = read_for_check(scan, &id, &target, response, BODY_LIMIT, cancel).await?
        else {
            continue;
        };
        let exposed = status == 200 && (e.matches)(&body.bytes);
        if exposed {
            let finding = exposure_finding(&id, &target, &e).with_sample(&body.bytes);
            scan.log(
                "discovery.exposed",
                &format!("Exposto: {} ({})", e.path, e.title),
                LogLevel::Warn,
            );
            scan.findings.push(finding.clone());
            scan.checks.push(check(
                &id,
                &target,
                CheckStatus::Finding,
                "Assinatura de conteúdo confirmada.",
                Some(finding),
            ));
        } else {
            scan.checks.push(check(
                &id,
                &target,
                if body.complete && matches!(status, 200 | 401 | 403 | 404 | 410) { CheckStatus::Passed } else { CheckStatus::Error },
                &format!(
                    "HTTP {status}; nenhuma assinatura observada neste conteúdo. Leitura completa: {}.", body.complete
                ),
                None,
            ));
        }
        progress(scan);
    }
    probes::error_page(scan, base, client, cancel).await?;
    probes::directory_listings(scan, base, client, cancel).await?;
    probes::script_bundles(scan, scripts, client, cancel).await?;
    probes::source_maps(scan, scripts, client, cancel).await?;
    progress(scan);
    security_txt(scan, base, client, cancel).await?;
    robots(scan, base, client, cancel).await?;
    sitemap(scan, base, client, cancel).await?;
    progress(scan);
    Ok(())
}

async fn security_txt(
    scan: &mut Scan,
    base: &Url,
    client: &Client,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let id = "disclosure.security-txt";
    let Ok(target) = base.join("/.well-known/security.txt") else {
        return Ok(());
    };
    let Some(response) = send(scan, client, cancel, id, Method::GET, &target, None).await? else {
        return Ok(());
    };
    let status = response.status().as_u16();
    let Some(body) = read_for_check(scan, id, &target, response, BODY_LIMIT, cancel).await? else {
        return Ok(());
    };
    let ok = status == 200 && !is_html(&body.bytes) && text(&body.bytes).contains("contact:");
    if !ok && !body.complete {
        scan.checks.push(check(
            id,
            &target,
            CheckStatus::Error,
            "security.txt acima do limite; verificação inconclusiva.",
            None,
        ));
        return Ok(());
    }
    if ok {
        scan.checks.push(check(
            id,
            &target,
            CheckStatus::Passed,
            "security.txt com campo Contact encontrado.",
            None,
        ));
    } else {
        let mut f = Finding::at(id, target.as_str(), "security.txt ausente", Severity::Info,
            "/.well-known/security.txt não existe ou não tem o campo Contact.",
            "Pesquisadores que encontrarem uma falha não têm um canal claro para avisar, e o problema pode ficar sem correção.",
            "Publique /.well-known/security.txt com Contact e Expires, conforme a RFC 9116.",
            "RFC 9116 — https://www.rfc-editor.org/rfc/rfc9116");
        f.category = "Exposição".into();
        scan.findings.push(f.clone());
        scan.checks.push(check(
            id,
            &target,
            CheckStatus::Finding,
            "Arquivo ausente ou incompleto.",
            Some(f),
        ));
    }
    Ok(())
}

/// Caminhos do robots.txt que sugerem áreas sensíveis.
pub fn sensitive_robots_paths(body: &str) -> Vec<String> {
    const WORDS: [&str; 12] = [
        "admin", "backup", "private", "secret", "config", "internal", "staging", "dev", "test",
        "api", "login", "db",
    ];
    let mut out: Vec<String> = body
        .lines()
        .filter_map(|l| {
            let (k, v) = l.split_once(':')?;
            (k.trim().eq_ignore_ascii_case("disallow")).then(|| v.trim().to_string())
        })
        .filter(|p| p.starts_with('/') && p.len() > 1)
        .filter(|p| {
            let p = p.to_ascii_lowercase();
            WORDS.iter().any(|w| {
                p.split(|c: char| !c.is_ascii_alphanumeric())
                    .any(|seg| seg == *w)
            })
        })
        .map(|p| clean(&p, 80))
        .collect();
    out.sort();
    out.dedup();
    out.truncate(10);
    out
}

/// Extrai caminhos da mesma origem de um sitemap.xml (ou índice de sitemaps).
/// Retorna no máximo 40 caminhos distintos, ordenados.
pub fn sitemap_paths(body: &str, base: &Url) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    let lower = body.to_ascii_lowercase();
    let mut from = 0;
    while let Some(start) = lower[from..].find("<loc>") {
        let s = from + start + 5;
        let Some(end) = lower[s..].find("</loc>") else {
            break;
        };
        let raw = body[s..s + end].trim();
        from = s + end + 6;
        if let Ok(url) = base.join(raw) {
            if url.origin() == base.origin() {
                let path = clean(url.path(), 120);
                if !out.contains(&path) {
                    out.push(path);
                }
            }
        }
        if out.len() >= 400 {
            break;
        }
    }
    out.sort();
    out.dedup();
    out.truncate(40);
    out
}

async fn sitemap(
    scan: &mut Scan,
    base: &Url,
    client: &Client,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let id = "disclosure.sitemap";
    let Ok(target) = base.join("/sitemap.xml") else {
        return Ok(());
    };
    let Some(response) = send(scan, client, cancel, id, Method::GET, &target, None).await? else {
        return Ok(());
    };
    let status = response.status().as_u16();
    let Some(body) = read_for_check(scan, id, &target, response, 512 * 1024, cancel).await? else {
        return Ok(());
    };
    let paths = if status == 200 && !is_html(&body.bytes) {
        sitemap_paths(&String::from_utf8_lossy(&body.bytes), base)
    } else {
        vec![]
    };
    if paths.is_empty() {
        scan.checks.push(check(
            id,
            &target,
            if body.complete {
                CheckStatus::Passed
            } else {
                CheckStatus::Error
            },
            "sitemap.xml ausente, vazio ou acima do limite de leitura.",
            None,
        ));
    } else {
        scan.log(
            "discovery.routes",
            &format!("{} rota(s) pública(s) descoberta(s) no sitemap.", paths.len()),
            LogLevel::Info,
        );
        let shown: Vec<_> = paths.iter().take(20).cloned().collect();
        let mut f = Finding::at(id, target.as_str(), "Rotas públicas mapeadas pelo sitemap", Severity::Info,
            &format!("{} rota(s) same-origin no sitemap.xml. Amostra: {}.", paths.len(), shown.join(", ")),
            "O sitemap revela a superfície pública da aplicação. É útil para SEO, mas também entrega aos atacantes um mapa das rotas, inclusive áreas que você talvez não quisesse divulgar.",
            "Confirme que nenhuma rota administrativa, de teste ou interna aparece no sitemap. Áreas sensíveis devem exigir autenticação, não depender de ocultação.",
            WSTG_REF);
        f.category = "Exposição".into();
        scan.findings.push(f.clone());
        scan.checks.push(check(id, &target, CheckStatus::Finding, "Rotas públicas enumeradas.", Some(f)));
    }
    Ok(())
}

async fn robots(
    scan: &mut Scan,
    base: &Url,
    client: &Client,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let id = "disclosure.robots";
    let Ok(target) = base.join("/robots.txt") else {
        return Ok(());
    };
    let Some(response) = send(scan, client, cancel, id, Method::GET, &target, None).await? else {
        return Ok(());
    };
    let status = response.status().as_u16();
    let Some(body) = read_for_check(scan, id, &target, response, 64 * 1024, cancel).await? else {
        return Ok(());
    };
    let paths = if status == 200 {
        if is_html(&body.bytes) {
            vec![]
        } else {
            sensitive_robots_paths(&String::from_utf8_lossy(&body.bytes))
        }
    } else {
        vec![]
    };
    if paths.is_empty() {
        scan.checks.push(check(
            id,
            &target,
            if body.complete {
                CheckStatus::Passed
            } else {
                CheckStatus::Error
            },
            if body.complete {
                "robots.txt ausente ou sem caminhos sensíveis na resposta."
            } else {
                "robots.txt acima do limite; nenhuma ausência de caminhos sensíveis foi inferida."
            },
            None,
        ));
    } else {
        let mut f = Finding::at(id, target.as_str(), "robots.txt aponta para áreas sensíveis", Severity::Info,
            &format!("Caminhos em Disallow: {}.", paths.join(", ")),
            "robots.txt é público e não protege nada: ele funciona como um mapa das áreas que o dono prefere esconder.",
            "Proteja essas áreas com autenticação em vez de depender do robots.txt e evite listar caminhos reveladores.",
            WSTG_REF);
        f.category = "Exposição".into();
        scan.findings.push(f.clone());
        scan.checks.push(check(
            id,
            &target,
            CheckStatus::Finding,
            "Caminhos sensíveis listados.",
            Some(f),
        ));
    }
    Ok(())
}

/// Testes ativos não destrutivos na URL final: reflexão de origem e métodos HTTP.
pub async fn active(
    scan: &mut Scan,
    url: &Url,
    client: &Client,
    cancel: &CancellationToken,
) -> Result<(), String> {
    scan.log(
        "active.start",
        "Testes ativos não destrutivos iniciados (CORS e métodos HTTP).",
        LogLevel::Info,
    );

    // 1. Reflexão de origem arbitrária.
    for (id, origin) in [
        ("active.cors-reflection", PROBE_ORIGIN),
        ("active.cors-null", "null"),
    ] {
        if let Some(response) =
            send(scan, client, cancel, id, Method::GET, url, Some(origin)).await?
        {
            let header = |n: &str| {
                response
                    .headers()
                    .get(n)
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v.trim().to_string())
            };
            let reflected = header("access-control-allow-origin").is_some_and(|v| v == origin);
            let credentials = header("access-control-allow-credentials")
                .is_some_and(|v| v.eq_ignore_ascii_case("true"));
            if reflected {
                let mut f = Finding::at(id, url.as_str(),
                    if origin == "null" { "CORS confia na origem null" } else { "CORS reflete qualquer origem" },
                    if credentials { Severity::Medium } else { Severity::Low },
                    &format!("Pedido com Origin: {origin} recebeu Access-Control-Allow-Origin: {origin}{}.",
                        if credentials { " e Access-Control-Allow-Credentials: true" } else { "" }),
                    if credentials {
                        "A resposta aceita a origem de teste e credenciais. Se houver dados sensíveis autenticados e o navegador enviar a sessão, pode haver leitura por outra origem. Este teste não usou contas nem comprovou acesso a dados privados."
                    } else {
                        "A resposta aceita leitura por essa origem sem credenciais. O risco depende de haver conteúdo que não deva ser público; a reflexão isolada não comprova exploração."
                    },
                    "Compare o Origin recebido com uma allowlist fixa no servidor, nunca devolva o valor recebido, não aceite null e envie Vary: Origin.",
                    CORS_REF);
                f.category = "Teste ativo".into();
                f.confidence = "observed".into();
                f.classification = "configuration".into();
                f.detector_version = "1.0.1".into();
                scan.findings.push(f.clone());
                scan.checks.push(check(
                    id,
                    url,
                    CheckStatus::Finding,
                    "Origem de teste refletida.",
                    Some(f),
                ));
            } else {
                scan.checks.push(check(
                    id,
                    url,
                    CheckStatus::Passed,
                    "Origem de teste não foi refletida.",
                    None,
                ));
            }
        }
    }

    // 2. Métodos anunciados em OPTIONS. PUT/DELETE não são enviados, só lidos do cabeçalho Allow.
    let id = "active.http-methods";
    if let Some(response) = send(scan, client, cancel, id, Method::OPTIONS, url, None).await? {
        let allow = ["allow", "access-control-allow-methods"]
            .iter()
            .filter_map(|n| response.headers().get(*n).and_then(|v| v.to_str().ok()))
            .collect::<Vec<_>>()
            .join(",")
            .to_ascii_uppercase();
        let risky: Vec<&str> = ["PUT", "DELETE", "PATCH", "TRACE", "CONNECT"]
            .into_iter()
            .filter(|m| allow.split(',').any(|a| a.trim() == *m))
            .collect();
        if risky.is_empty() {
            scan.checks.push(check(
                id,
                url,
                CheckStatus::Passed,
                "Nenhum método de risco anunciado em OPTIONS.",
                None,
            ));
        } else {
            let mut f = Finding::at(id, url.as_str(), "Métodos HTTP de escrita ou diagnóstico anunciados", Severity::Low,
                &format!("OPTIONS anuncia: {}. Os métodos não foram executados.", risky.join(", ")),
                "Se esses métodos não exigirem autenticação, permitem alterar ou apagar recursos. O anúncio sozinho não prova que funcionam sem login.",
                "Permita só os métodos que a aplicação usa (em geral GET, POST, HEAD) e exija autenticação e autorização nos de escrita.",
                A05_REF);
            f.category = "Teste ativo".into();
            scan.findings.push(f.clone());
            scan.checks.push(check(
                id,
                url,
                CheckStatus::Finding,
                "Métodos de risco anunciados.",
                Some(f),
            ));
        }
    }

    // 3. TRACE habilitado (Cross-Site Tracing). TRACE não altera estado no servidor.
    let id = "active.trace";
    if let Some(response) = send(scan, client, cancel, id, Method::TRACE, url, None).await? {
        let echoed = response.status().as_u16() == 200
            && response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .is_some_and(|v| v.to_ascii_lowercase().starts_with("message/http"));
        if echoed {
            let mut f = Finding::at(id, url.as_str(), "Método TRACE habilitado", Severity::Low,
                "TRACE respondeu 200 com Content-Type message/http, devolvendo o pedido recebido.",
                "O servidor devolve os cabeçalhos do pedido, o que pode expor cookies HttpOnly e credenciais de proxy em ataques combinados (Cross-Site Tracing).",
                "Desative TRACE (Apache: TraceEnable off; nginx já recusa por padrão).",
                A05_REF);
            f.category = "Teste ativo".into();
            f.confidence = "confirmed".into();
            scan.findings.push(f.clone());
            scan.checks.push(check(
                id,
                url,
                CheckStatus::Finding,
                "TRACE devolveu o pedido.",
                Some(f),
            ));
        } else {
            scan.checks
                .push(check(id, url, CheckStatus::Passed, "TRACE recusado.", None));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exposure(slug: &str) -> Exposure {
        catalog().into_iter().find(|e| e.slug == slug).unwrap()
    }

    #[test]
    fn sitemap_extracts_same_origin_paths() {
        let base = Url::parse("https://exemplo.com/").unwrap();
        let xml = r#"<urlset><url><loc>https://exemplo.com/produtos</loc></url>
            <url><loc>https://exemplo.com/admin/painel</loc></url>
            <url><loc>https://outro.com/externo</loc></url>
            <url><loc>https://exemplo.com/produtos</loc></url></urlset>"#;
        let paths = sitemap_paths(xml, &base);
        assert_eq!(paths, vec!["/admin/painel", "/produtos"]);
    }

    #[test]
    fn signatures_reject_generic_pages() {
        let soft_404 =
            b"<!DOCTYPE html><html><body>Pagina nao encontrada APP_KEY=1 DB_PASS=2</body></html>";
        for e in catalog() {
            assert!(
                !(e.matches)(soft_404),
                "{} aceitou uma página HTML genérica",
                e.slug
            );
            assert!(!(e.matches)(b""), "{} aceitou corpo vazio", e.slug);
        }
    }

    #[test]
    fn signatures_accept_real_content() {
        assert!((exposure("git-head").matches)(b"ref: refs/heads/main\n"));
        assert!((exposure("git-config").matches)(
            b"[core]\n\trepositoryformatversion = 0\n"
        ));
        assert!((exposure("env").matches)(
            b"APP_KEY=base64:abc\nDB_PASSWORD=hunter2\n"
        ));
        assert!((exposure("backup-zip").matches)(b"PK\x03\x04rest"));
        assert!((exposure("backup-sql").matches)(
            b"-- MySQL dump 10.13\nCREATE TABLE users (id int);"
        ));
        assert!((exposure("htpasswd").matches)(b"admin:$apr1$abc$def\n"));
        assert!((exposure("actuator-env").matches)(
            b"{\"activeProfiles\":[],\"propertySources\":[]}"
        ));
    }

    #[tokio::test]
    async fn bounded_reads_distinguish_complete_truncated_failed_and_cancelled_bodies() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        async fn response(bytes: &'static [u8], declared: usize) -> Response {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/", listener.local_addr().unwrap());
            tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0u8; 2048];
                let _ = socket.read(&mut request).await;
                let headers = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {declared}\r\nConnection: close\r\n\r\n"
                );
                socket.write_all(headers.as_bytes()).await.unwrap();
                socket.write_all(bytes).await.unwrap();
            });
            Client::builder()
                .no_proxy()
                .build()
                .unwrap()
                .get(url)
                .send()
                .await
                .unwrap()
        }
        let cancel = CancellationToken::new();
        let exact = read_limited(response(b"12345678", 8).await, 8, &cancel)
            .await
            .unwrap();
        assert!(exact.complete);
        assert_eq!(exact.bytes.len(), 8);
        let truncated = read_limited(response(b"123456789", 9).await, 8, &cancel)
            .await
            .unwrap();
        assert!(!truncated.complete);
        assert_eq!(truncated.bytes.len(), 8);
        assert!(read_limited(response(b"short", 100).await, 8, &cancel)
            .await
            .is_err());
        let incoming = response(b"12345678", 8).await;
        cancel.cancel();
        assert_eq!(
            read_limited(incoming, 8, &cancel).await.err().as_deref(),
            Some("cancelled")
        );
    }

    #[test]
    fn catalog_slugs_and_paths_are_unique_and_absolute() {
        let c = catalog();
        let mut slugs: Vec<_> = c.iter().map(|e| e.slug).collect();
        slugs.sort();
        slugs.dedup();
        assert_eq!(slugs.len(), c.len());
        assert!(c
            .iter()
            .all(|e| e.path.starts_with('/') && !e.path.contains("..")));
    }

    #[test]
    fn robots_sensitive_paths() {
        let body = "User-agent: *\nDisallow: /admin/\nDisallow: /images/\nDisallow: /api/v1/internal\nAllow: /\n";
        assert_eq!(
            sensitive_robots_paths(body),
            vec!["/admin/", "/api/v1/internal"]
        );
        assert!(sensitive_robots_paths("Disallow: /\n").is_empty());
    }
}
