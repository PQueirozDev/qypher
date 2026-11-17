//! Análise do HTML da página final, em memória. O corpo nunca é persistido:
//! só achados com evidências resumidas (hosts, nomes de biblioteca, tipo de segredo).

use scanner_core::{clean, Finding, Severity};
use std::collections::BTreeSet;
use url::Url;

const SRI_REF: &str =
    "MDN Subresource Integrity — https://developer.mozilla.org/docs/Web/Security/Subresource_Integrity";
const A06_REF: &str =
    "OWASP Top 10 A06 Componentes vulneráveis e desatualizados — https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/";
const SECRETS_REF: &str =
    "OWASP Secrets Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html";

/// Valor de um atributo dentro do texto de uma tag (`<script src="…">`).
pub fn attr(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(pos) = lower[from..].find(name) {
        let start = from + pos;
        let before_ok = start > 0 && lower.as_bytes()[start - 1].is_ascii_whitespace();
        let rest = lower[start + name.len()..].trim_start();
        if before_ok && rest.starts_with('=') {
            let offset = lower.len() - rest.len() + 1;
            let value = tag.get(offset..)?.trim_start();
            return Some(match value.chars().next()? {
                q @ ('"' | '\'') => value[1..].split(q).next()?.to_string(),
                _ => value
                    .split(|c: char| c.is_ascii_whitespace() || c == '>')
                    .next()?
                    .to_string(),
            });
        }
        from = start + name.len();
    }
    None
}

/// Tags de abertura `<name …>` do documento (limitadas para conter o custo).
pub fn tags<'a>(html: &'a str, lower: &str, name: &str) -> Vec<&'a str> {
    let open = format!("<{name}");
    let mut out = vec![];
    let mut from = 0;
    while let Some(pos) = lower[from..].find(&open) {
        let start = from + pos;
        let after = lower.as_bytes().get(start + open.len()).copied();
        let end = lower[start..]
            .find('>')
            .map(|e| start + e)
            .unwrap_or(lower.len());
        if after.is_some_and(|b| b.is_ascii_whitespace() || b == b'>' || b == b'/') {
            if let Some(tag) = html.get(start..end) {
                out.push(tag);
            }
        }
        from = end.max(start + 1);
        if out.len() >= 500 {
            break;
        }
    }
    out
}

/// Extrai `1.12.4` de `…jquery-1.12.4.min.js` logo após o marcador.
fn version_after(src: &str, marker: &str) -> Option<(u32, u32, u32)> {
    let rest = &src[src.find(marker)? + marker.len()..];
    let rest = rest.trim_start_matches(['-', '/', '@', '.', 'v']);
    let digits: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let mut parts = digits.split('.').filter(|p| !p.is_empty());
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    Some((major, minor, patch))
}

/// Bibliotecas com versões sabidamente vulneráveis. Retorna (nome, versão, motivo).
pub fn outdated_library(src: &str) -> Option<(&'static str, String, &'static str)> {
    let src = src.to_ascii_lowercase();
    let file = src.rsplit('/').next().unwrap_or(&src).to_string();
    let fmt = |v: (u32, u32, u32)| format!("{}.{}.{}", v.0, v.1, v.2);
    if file.starts_with("jquery") && !file.starts_with("jquery-ui") {
        let v = version_after(&src, "jquery")?;
        if v < (3, 5, 0) {
            return Some((
                "jQuery",
                fmt(v),
                "XSS em .html()/.append() (CVE-2020-11022/11023)",
            ));
        }
    }
    if file.starts_with("bootstrap") {
        let v = version_after(&src, "bootstrap")?;
        if v < (3, 4, 1) || (v.0 == 4 && v < (4, 3, 1)) {
            return Some((
                "Bootstrap",
                fmt(v),
                "XSS em tooltip/popover (CVE-2019-8331)",
            ));
        }
    }
    if file.starts_with("angular") && !src.contains("@angular") {
        let v = version_after(&src, "angular")?;
        if v.0 == 1 {
            return Some((
                "AngularJS",
                fmt(v),
                "linha 1.x sem suporte desde 2022, com falhas conhecidas",
            ));
        }
    }
    if file.starts_with("lodash") {
        let v = version_after(&src, "lodash")?;
        if v < (4, 17, 21) {
            return Some((
                "Lodash",
                fmt(v),
                "prototype pollution e injeção de comando (CVE-2021-23337)",
            ));
        }
    }
    None
}

fn run_of(body: &str, start: usize, ok: fn(u8) -> bool) -> usize {
    body.as_bytes()[start..]
        .iter()
        .take_while(|b| ok(**b))
        .count()
}

type SecretRule = (&'static str, &'static str, usize, fn(u8) -> bool, Severity);

/// Tipos de segredo encontrados no corpo. Nunca retorna o valor; só o tipo e um prefixo curto.
pub fn secrets(body: &str) -> Vec<(&'static str, String, Severity)> {
    let alnum: fn(u8) -> bool = |b| b.is_ascii_alphanumeric();
    let upper: fn(u8) -> bool = |b| b.is_ascii_uppercase() || b.is_ascii_digit();
    let token: fn(u8) -> bool = |b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-';
    let rules: [SecretRule; 11] = [
        ("AKIA", "chave de acesso AWS", 16, upper, Severity::High),
        ("ASIA", "chave temporária AWS", 16, upper, Severity::High),
        (
            "sk_live_",
            "chave secreta Stripe",
            20,
            alnum,
            Severity::High,
        ),
        ("ghp_", "token pessoal do GitHub", 36, alnum, Severity::High),
        ("gho_", "token OAuth do GitHub", 36, alnum, Severity::High),
        ("ghs_", "token de servidor do GitHub", 36, alnum, Severity::High),
        (
            "github_pat_",
            "token granular do GitHub",
            40,
            token,
            Severity::High,
        ),
        ("glpat-", "token de acesso GitLab", 20, token, Severity::High),
        ("xoxb-", "token de bot do Slack", 20, token, Severity::High),
        ("xoxp-", "token de usuário do Slack", 20, token, Severity::High),
        ("npm_", "token de automação npm", 36, token, Severity::High),
    ];
    let mut found = vec![];
    for (prefix, label, min, ok, severity) in rules {
        let mut from = 0;
        while let Some(pos) = body[from..].find(prefix) {
            let start = from + pos;
            let boundary = start == 0 || !body.as_bytes()[start - 1].is_ascii_alphanumeric();
            let len = run_of(body, start + prefix.len(), ok);
            if boundary && len >= min {
                found.push((
                    label,
                    format!("{prefix}…({} caracteres)", prefix.len() + len),
                    severity.clone(),
                ));
                break;
            }
            from = start + prefix.len();
        }
    }
    if body.contains("-----BEGIN") && body.contains("PRIVATE KEY-----") {
        found.push((
            "chave privada PEM",
            "-----BEGIN … PRIVATE KEY-----".into(),
            Severity::High,
        ));
    }
    if let Some(scheme) = connection_credential(body) {
        found.push((
            "credencial em string de conexão",
            format!("{scheme}://…:•••••@… (senha embutida)"),
            Severity::High,
        ));
    }
    found
}

/// Esquemas de bancos/serviços cuja string de conexão com senha embutida é
/// um vazamento de alto sinal (não inclui http/https para evitar exemplos de basic-auth).
const DB_SCHEMES: [&str; 14] = [
    "postgresql",
    "postgres",
    "mysql",
    "mariadb",
    "mongodb+srv",
    "mongodb",
    "rediss",
    "redis",
    "amqps",
    "amqp",
    "mssql",
    "sqlserver",
    "clickhouse",
    "cockroachdb",
];

/// Detecta `scheme://usuário:senha@host` com uma senha plausível (não placeholder,
/// não variável de template). Retorna o esquema detectado; NUNCA retorna a senha.
fn connection_credential(body: &str) -> Option<&'static str> {
    let bytes = body.as_bytes();
    let mut from = 0;
    while let Some(rel) = body[from..].find("://") {
        let sep = from + rel;
        from = sep + 3;
        // Captura o esquema imediatamente antes de "://".
        let mut s = sep;
        while s > 0 {
            let c = bytes[s - 1];
            if c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.') {
                s -= 1;
            } else {
                break;
            }
        }
        let scheme = body[s..sep].to_ascii_lowercase();
        let Some(matched) = DB_SCHEMES.iter().copied().find(|&db| db == scheme) else {
            continue;
        };
        // Lê a userinfo até '@', parando em delimitadores de autoridade/atributo.
        let rest = &body[from..];
        let mut end: Option<usize> = None;
        for (i, &b) in rest.as_bytes().iter().enumerate() {
            if b == b'@' {
                end = Some(i);
                break;
            }
            if matches!(
                b,
                b'/' | b'?' | b'#' | b' ' | b'"' | b'\'' | b'\\' | b'\n' | b'\r' | b'\t' | b'<'
                    | b'>' | b'`' | b')'
            ) {
                break;
            }
        }
        let Some(end) = end else { continue };
        let userinfo = &rest[..end];
        let Some(colon) = userinfo.find(':') else {
            continue;
        };
        if is_plausible_password(&userinfo[colon + 1..]) {
            return Some(matched);
        }
    }
    None
}

/// Uma senha só conta como vazamento quando parece um literal real: descarta
/// placeholders comuns e variáveis de template (`${VAR}`, `{{var}}`, `%ENV%`, `<senha>`).
fn is_plausible_password(pass: &str) -> bool {
    let p = pass.trim();
    if p.len() < 3 || p.len() > 200 {
        return false;
    }
    if matches!(p.as_bytes()[0], b'$' | b'{' | b'<' | b'%' | b'#') {
        return false;
    }
    if p.contains("${") || p.contains("{{") || p.contains("%(") {
        return false;
    }
    if p.chars().all(|c| matches!(c, '*' | '.' | 'x' | 'X' | '•')) {
        return false;
    }
    let lower = p.to_ascii_lowercase();
    const PLACEHOLDERS: [&str; 14] = [
        "password",
        "pass",
        "passwd",
        "senha",
        "secret",
        "changeme",
        "example",
        "user",
        "username",
        "yourpassword",
        "your_password",
        "placeholder",
        "redacted",
        "token",
    ];
    !PLACEHOLDERS.iter().any(|&ph| lower == ph)
}

/// Scripts servidos pela própria origem (no máximo 3), para verificar source maps.
pub fn same_origin_scripts(body: &str, page: &Url) -> Vec<Url> {
    let lower = body.to_ascii_lowercase();
    let mut out: Vec<Url> = vec![];
    for tag in tags(body, &lower, "script") {
        let Some(src) = attr(tag, "src") else {
            continue;
        };
        let Ok(resolved) = page.join(src.trim()) else {
            continue;
        };
        if resolved.origin() == page.origin()
            && resolved.path().to_ascii_lowercase().ends_with(".js")
            && !out.iter().any(|u| u.path() == resolved.path())
        {
            out.push(resolved);
        }
        if out.len() >= 3 {
            break;
        }
    }
    out
}

/// Endereços IPv4 de redes privadas (RFC 1918) citados no corpo, fora de blocos SVG.
pub fn private_addresses(body: &str) -> Vec<String> {
    let lower = body.to_ascii_lowercase();
    let lower = lower.as_bytes();
    let bytes = body.as_bytes();
    let mut out: Vec<String> = vec![];
    let mut i = 0;
    while i < bytes.len() && out.len() < 5 {
        // Coordenadas de desenhos vetoriais parecem endereços (10.5.3.2); pule o bloco.
        if lower[i..].starts_with(b"<svg") {
            i += lower[i..]
                .windows(5)
                .position(|w| w == b"</svg")
                .unwrap_or(lower.len() - i)
                .max(1);
            continue;
        }
        let boundary = i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'.');
        if !(bytes[i].is_ascii_digit() && boundary) {
            i += 1;
            continue;
        }
        let end = i + bytes[i..]
            .iter()
            .take_while(|b| b.is_ascii_digit() || **b == b'.')
            .count();
        let candidate = body[i..end].trim_end_matches('.');
        let octets: Vec<u8> = candidate
            .split('.')
            .filter_map(|p| p.parse().ok())
            .collect();
        let after_ok = bytes.get(end).is_none_or(|b| !b.is_ascii_alphanumeric());
        if candidate.split('.').count() == 4 && octets.len() == 4 && after_ok {
            let private = octets[0] == 10
                || (octets[0] == 192 && octets[1] == 168)
                || (octets[0] == 172 && (16..=31).contains(&octets[1]));
            if private && !out.iter().any(|v| v == candidate) {
                out.push(candidate.to_string());
            }
        }
        i = end.max(i + 1);
    }
    out
}

/// Quantidade de formulários POST sem campo oculto que pareça um token anti-CSRF.
pub fn forms_without_csrf(body: &str, lower: &str) -> usize {
    const HINTS: [&str; 6] = [
        "csrf",
        "xsrf",
        "token",
        "authenticity",
        "nonce",
        "verification",
    ];
    let mut missing = 0;
    let mut from = 0;
    while let Some(pos) = lower[from..].find("<form") {
        let start = from + pos;
        let open_end = lower[start..].find('>').map_or(lower.len(), |e| start + e);
        let end = lower[open_end..]
            .find("</form")
            .map_or(lower.len(), |e| open_end + e);
        let is_post =
            attr(&body[start..open_end], "method").is_some_and(|m| m.eq_ignore_ascii_case("post"));
        if is_post {
            let has_token = tags(&body[open_end..end], &lower[open_end..end], "input")
                .iter()
                .any(|t| {
                    attr(t, "type").is_some_and(|v| v.eq_ignore_ascii_case("hidden"))
                        && attr(t, "name").is_some_and(|n| {
                            let n = n.to_ascii_lowercase();
                            HINTS.iter().any(|h| n.contains(h))
                        })
                });
            if !has_token {
                missing += 1;
            }
        }
        from = end.max(start + 1);
        if from >= lower.len() {
            break;
        }
    }
    missing
}

pub fn analyze(body: &str, page: &Url) -> Vec<Finding> {
    let lower = body.to_ascii_lowercase();
    let location = page.as_str();
    let https = page.scheme() == "https";
    let mut findings = vec![];
    let finding = |id: &str,
                   title: &str,
                   severity: Severity,
                   evidence: &str,
                   impact: &str,
                   fix: &str,
                   reference: &str| {
        let mut f = Finding::at(
            id,
            location,
            title,
            severity,
            &clean(evidence, 900),
            impact,
            fix,
            reference,
        );
        f.category = "Conteúdo da página".into();
        f
    };

    let mut resources: Vec<(String, bool)> = vec![]; // (url, tem integrity)
    for tag in tags(body, &lower, "script") {
        if let Some(src) = attr(tag, "src") {
            resources.push((src, attr(tag, "integrity").is_some_and(|v| !v.is_empty())));
        }
    }
    for tag in tags(body, &lower, "link") {
        let rel = attr(tag, "rel").unwrap_or_default().to_ascii_lowercase();
        if rel.contains("stylesheet") {
            if let Some(href) = attr(tag, "href") {
                resources.push((href, attr(tag, "integrity").is_some_and(|v| !v.is_empty())));
            }
        }
    }

    let mut no_sri = BTreeSet::new();
    let mut outdated = BTreeSet::new();
    for (raw, integrity) in &resources {
        let Ok(resolved) = page.join(raw.trim()) else {
            continue;
        };
        if resolved.origin() != page.origin()
            && !integrity
            && matches!(resolved.scheme(), "http" | "https")
        {
            if let Some(host) = resolved.host_str() {
                no_sri.insert(clean(host, 80));
            }
        }
        if let Some((name, version, why)) = outdated_library(resolved.path()) {
            outdated.insert(format!("{name} {version} — {why}"));
        }
    }
    if !no_sri.is_empty() {
        let hosts: Vec<_> = no_sri.iter().take(8).cloned().collect();
        findings.push(finding(
            "page.sri",
            "Scripts ou estilos de terceiros sem verificação de integridade",
            Severity::Low,
            &format!("Recursos carregados de {} origem(ns) externa(s) sem atributo integrity: {}.", no_sri.len(), hosts.join(", ")),
            "Se o CDN ou o terceiro for comprometido, código malicioso roda na página com acesso total a sessão e dados do usuário.",
            "Adicione integrity=\"sha384-…\" e crossorigin=\"anonymous\" a cada recurso externo com versão fixa, ou hospede os arquivos na própria origem.",
            SRI_REF,
        ));
    }
    if !outdated.is_empty() {
        findings.push(finding(
            "page.outdated-library",
            "Biblioteca JavaScript com vulnerabilidade conhecida",
            Severity::Medium,
            &outdated.iter().take(8).cloned().collect::<Vec<_>>().join("; "),
            "Versões com falhas públicas podem ser exploradas quando a aplicação usa as funções afetadas. A versão foi lida do nome do arquivo; confirme antes de concluir.",
            "Atualize para a versão estável mais recente da biblioteca e remova cópias antigas.",
            A06_REF,
        ));
    }

    if https {
        let mut mixed = BTreeSet::new();
        for (name, attribute) in [
            ("script", "src"),
            ("link", "href"),
            ("iframe", "src"),
            ("img", "src"),
            ("form", "action"),
        ] {
            for tag in tags(body, &lower, name) {
                if attr(tag, attribute)
                    .is_some_and(|v| v.trim().to_ascii_lowercase().starts_with("http://"))
                {
                    mixed.insert(name);
                }
            }
        }
        if !mixed.is_empty() {
            let active =
                mixed.contains("script") || mixed.contains("iframe") || mixed.contains("form");
            findings.push(finding(
                "page.mixed-content",
                "Conteúdo misto: recursos HTTP em página HTTPS",
                if active { Severity::Medium } else { Severity::Low },
                &format!("Elementos que apontam para http://: {}.", mixed.iter().copied().collect::<Vec<_>>().join(", ")),
                "Recursos sem criptografia podem ser alterados na rede. Scripts, iframes e envios de formulário por HTTP comprometem a página inteira.",
                "Sirva todos os recursos por HTTPS e adicione a diretiva CSP upgrade-insecure-requests.",
                "MDN Mixed content — https://developer.mozilla.org/docs/Web/Security/Mixed_content",
            ));
        }
    } else if tags(body, &lower, "input")
        .iter()
        .any(|t| attr(t, "type").is_some_and(|v| v.eq_ignore_ascii_case("password")))
    {
        findings.push(finding(
            "page.password-over-http",
            "Campo de senha em página sem HTTPS",
            Severity::High,
            "A página contém <input type=\"password\"> e foi servida por HTTP.",
            "A senha trafega em texto claro e pode ser capturada por qualquer um na mesma rede.",
            "Sirva a aplicação exclusivamente por HTTPS e redirecione HTTP para HTTPS.",
            "OWASP Top 10 A02 Falhas criptográficas — https://owasp.org/Top10/A02_2021-Cryptographic_Failures/",
        ));
    }

    let leaked = secrets(body);
    if !leaked.is_empty() {
        let severity = if leaked.iter().any(|(_, _, s)| *s == Severity::High) {
            Severity::High
        } else {
            Severity::Low
        };
        let mut finding = finding(
            "page.inline-secret",
            "Possível credencial exposta no código da página",
            severity,
            &leaked.iter().map(|(label, hint, _)| format!("{label} [{hint}]")).collect::<Vec<_>>().join("; "),
            "O padrão pode corresponder a credencial privada acessível ao visitante. A validade não foi testada: exemplos, fixtures e credenciais já revogadas podem ser falsos positivos.",
            "Valide o tipo sem divulgar nem testar a credencial contra o provedor. Se for um segredo real, revogue/rotacione e mantenha-o apenas no servidor ou cofre de segredos.",
            SECRETS_REF,
        );
        finding.confidence = "heuristic".into();
        finding.classification = "potential".into();
        finding.detector_version = "1.0.1".into();
        findings.push(finding);
    }

    let unprotected_forms = forms_without_csrf(body, &lower);
    if unprotected_forms > 0 {
        let mut f = finding(
            "page.csrf-token",
            "Formulário POST sem token anti-CSRF visível",
            Severity::Low,
            &format!("{unprotected_forms} formulário(s) com method=\"post\" sem campo oculto de token."),
            "Se a aplicação também não usar cookies SameSite nem verificar a origem do pedido, outro site pode enviar o formulário em nome de um usuário logado. O token pode estar em um cabeçalho adicionado por JavaScript; confirme.",
            "Use tokens anti-CSRF por sessão ou por pedido, cookies de sessão com SameSite=Lax ou Strict e validação do cabeçalho Origin nas rotas que alteram dados.",
            "OWASP CSRF Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html",
        );
        f.confidence = "heuristic".into();
        findings.push(f);
    }

    // Um alvo que já é um IP privado cita o próprio endereço legitimamente.
    let internal = if matches!(page.host(), Some(url::Host::Domain(_))) {
        private_addresses(body)
    } else {
        vec![]
    };
    if !internal.is_empty() {
        let mut f = finding(
            "page.private-ip",
            "Endereço de rede interna exposto na página",
            Severity::Low,
            &format!("Endereços privados citados no HTML: {}.", internal.join(", ")),
            "Revela a numeração da rede interna e ajuda a planejar movimentação lateral ou ataques de SSRF. Pode ser um número de versão parecido com um endereço; confirme.",
            "Remova endereços internos de páginas, comentários e mensagens de erro; use nomes públicos ou um proxy.",
            "OWASP WSTG-INFO-05 Vazamento de informação no conteúdo — https://owasp.org/www-project-web-security-testing-guide/",
        );
        f.confidence = "heuristic".into();
        findings.push(f);
    }

    for tag in tags(body, &lower, "meta") {
        if attr(tag, "name").is_some_and(|n| n.eq_ignore_ascii_case("generator")) {
            if let Some(content) =
                attr(tag, "content").filter(|c| c.chars().any(|ch| ch.is_ascii_digit()))
            {
                findings.push(finding(
                    "page.generator",
                    "Tecnologia e versão identificadas na página",
                    Severity::Info,
                    &format!("meta generator: {}", clean(&content, 80)),
                    "Revelar a versão exata facilita buscar falhas públicas específicas dela.",
                    "Remova a meta tag generator e mantenha a plataforma atualizada.",
                    A06_REF,
                ));
                break;
            }
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page() -> Url {
        Url::parse("https://app.example/").unwrap()
    }

    #[test]
    fn attributes_are_extracted() {
        assert_eq!(
            attr("<script src=\"/a.js\" defer", "src").as_deref(),
            Some("/a.js")
        );
        assert_eq!(attr("<script SRC='/a.js'", "src").as_deref(), Some("/a.js"));
        assert_eq!(attr("<script src=/a.js", "src").as_deref(), Some("/a.js"));
        assert_eq!(attr("<script data-src=\"/x.js\"", "src"), None);
    }

    #[test]
    fn external_script_without_integrity_and_old_jquery() {
        let html = r#"<html><script src="https://cdn.example/jquery-1.12.4.min.js"></script>
            <script src="https://ok.example/a.js" integrity="sha384-abc"></script>
            <script src="/local.js"></script></html>"#;
        let f = analyze(html, &page());
        let sri = f.iter().find(|f| f.detector_id == "page.sri").unwrap();
        assert!(sri.evidence.contains("cdn.example") && !sri.evidence.contains("ok.example"));
        assert!(f
            .iter()
            .any(|f| f.detector_id == "page.outdated-library"
                && f.evidence.contains("jQuery 1.12.4")));
    }

    #[test]
    fn modern_libraries_are_not_flagged() {
        assert!(outdated_library("/js/jquery-3.7.1.min.js").is_none());
        assert!(outdated_library("/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js").is_none());
        assert!(outdated_library("/npm/bootstrap@4.1.0/dist/js/bootstrap.min.js").is_some());
    }

    #[test]
    fn secrets_are_reported_without_values() {
        let html = "<script>const k='AKIAIOSFODNN7EXAMPLE';</script>";
        let f = analyze(html, &page());
        let s = f
            .iter()
            .find(|f| f.detector_id == "page.inline-secret")
            .unwrap();
        assert_eq!(s.severity, Severity::High);
        assert!(!s.evidence.contains("IOSFODNN7EXAMPLE"));
    }

    #[test]
    fn public_google_firebase_keys_are_not_private_secret_findings() {
        let key = ["AIza", &"a".repeat(35)].concat();
        let html = format!("<script>const firebaseConfig = {{apiKey:'{key}'}};</script>");
        assert!(secrets(&html).is_empty());
        assert!(!analyze(&html, &page())
            .iter()
            .any(|f| f.detector_id == "page.inline-secret"));
    }

    #[test]
    fn connection_string_with_password_is_detected_without_the_password() {
        let html = r#"<script>const db="postgres://admin:S3cr3tP%40ss@db.internal:5432/app";</script>"#;
        let found = secrets(html);
        let hit = found
            .iter()
            .find(|(label, _, _)| *label == "credencial em string de conexão")
            .expect("deveria detectar a credencial");
        assert_eq!(hit.2, Severity::High);
        assert!(!hit.1.contains("S3cr3tP"), "a senha não pode aparecer na evidência");
        let f = analyze(html, &page());
        let inline = f
            .iter()
            .find(|f| f.detector_id == "page.inline-secret")
            .expect("deveria virar achado");
        assert_eq!(inline.severity, Severity::High);
        assert!(!inline.evidence.contains("S3cr3tP"));
    }

    #[test]
    fn additional_high_signal_token_prefixes_are_detected_without_values() {
        let gitlab = ["glpat-", &"a".repeat(20)].concat();
        let npm = ["npm_", &"b".repeat(36)].concat();
        for raw in [gitlab, npm] {
            let html = format!("<script>const t='{raw}';</script>");
            let found = secrets(&html);
            assert!(!found.is_empty(), "deveria detectar {raw}");
            assert!(
                found.iter().all(|(_, hint, _)| !hint.contains(&raw)),
                "o valor completo nunca pode aparecer"
            );
        }
    }

    #[test]
    fn connection_strings_with_placeholders_or_without_password_are_ignored() {
        // variável de template
        assert!(connection_credential("mysql://user:${DB_PASS}@host/db").is_none());
        // placeholder literal
        assert!(connection_credential("mongodb://user:password@host").is_none());
        // sem senha embutida
        assert!(connection_credential("postgres://localhost:5432/db").is_none());
        assert!(connection_credential("postgresql://appuser@db/app").is_none());
        // esquema fora do conjunto (evita exemplos de basic-auth em http)
        assert!(connection_credential("https://user:pass@example.com").is_none());
    }

    #[test]
    fn mixed_content_and_password_over_http() {
        let f = analyze("<iframe src=\"http://x.example/\"></iframe>", &page());
        assert!(f
            .iter()
            .any(|f| f.detector_id == "page.mixed-content" && f.severity == Severity::Medium));
        let http = Url::parse("http://app.example/").unwrap();
        let f = analyze("<input type=password name=p>", &http);
        assert!(f.iter().any(|f| f.detector_id == "page.password-over-http"));
    }

    #[test]
    fn forms_and_internal_addresses() {
        let html = r#"<form method="POST" action="/login"><input name="user"><input type="password" name="p"></form>
            <form method="post"><input type="hidden" name="csrf_token" value="x"></form>
            <form method="get"><input name="q"></form>
            <!-- backend em 10.0.3.17 e 192.168.1.20; versão 10.0.3.17.5 e 8.8.8.8 -->
            <svg><path d="M 10.5.3.2 172.16.0.1"/></svg>"#;
        let lower = html.to_ascii_lowercase();
        assert_eq!(forms_without_csrf(html, &lower), 1);
        assert_eq!(private_addresses(html), vec!["10.0.3.17", "192.168.1.20"]);
        let f = analyze(html, &page());
        assert!(f
            .iter()
            .any(|f| f.detector_id == "page.csrf-token" && f.confidence == "heuristic"));
        assert!(f.iter().any(|f| f.detector_id == "page.private-ip"));
        // Alvo em IP privado não é sinalizado por citar a própria rede.
        let private_target = Url::parse("http://192.168.1.20/").unwrap();
        assert!(!analyze(html, &private_target)
            .iter()
            .any(|f| f.detector_id == "page.private-ip"));
    }

    #[test]
    fn same_origin_scripts_are_listed_once() {
        let html = r#"<script src="/static/app.js?v=3"></script><script src="/static/app.js"></script>
            <script src="https://cdn.example/x.js"></script><script src="vendor.JS"></script><script src="/data.json"></script>"#;
        let scripts = same_origin_scripts(html, &page());
        let paths: Vec<_> = scripts.iter().map(|u| u.path()).collect();
        assert_eq!(paths, vec!["/static/app.js", "/vendor.JS"]);
    }

    #[test]
    fn clean_page_has_no_findings() {
        assert!(analyze(
            "<html><script src=\"/app.js\"></script><p>AKIA curto</p></html>",
            &page()
        )
        .is_empty());
    }
}
