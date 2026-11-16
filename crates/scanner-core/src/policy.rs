use crate::ScanConfig;
use std::net::IpAddr;
use thiserror::Error;
use url::{Host, Url};

#[derive(Debug, Error)]
#[error("{0}")]
pub struct PolicyError(pub String);

/// Teto de requisições por execução (inclui sondas TLS, exposição e testes ativos).
pub const MAX_REQUESTS: u8 = 100;

fn reject<T>(message: &str) -> Result<T, PolicyError> {
    Err(PolicyError(message.into()))
}

pub fn parse_target(value: &str) -> Result<Url, PolicyError> {
    if value.len() > 2048 || value.contains('\\') || value.chars().any(char::is_control) {
        return reject("URL inválida ou muito longa.");
    }
    let url =
        Url::parse(value).map_err(|_| PolicyError("Informe uma URL HTTP(S) válida.".into()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return reject("Somente HTTP e HTTPS são permitidos.");
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return reject("Credenciais, parâmetros e fragmentos não são aceitos na URL neste MVP.");
    }
    let path = url.path().to_ascii_lowercase();
    if ["%2f", "%5c", "%2e", "%25", "%00"]
        .iter()
        .any(|s| path.contains(s))
    {
        return reject("Caminho com codificação ambígua não permitido.");
    }
    Ok(url)
}

impl ScanConfig {
    pub fn validate(&self) -> Result<Url, PolicyError> {
        if !self.authorized {
            return reject("Confirme que tem autorização para auditar este alvo.");
        }
        if !(1..=MAX_REQUESTS).contains(&self.max_requests)
            || self.max_redirects > 5
            || !(2..=30).contains(&self.timeout_seconds)
        {
            return reject(
                "Limites inválidos: 1–100 requisições, 0–5 redirecionamentos, timeout 2–30 s.",
            );
        }
        if !self.path_prefix.starts_with('/')
            || self.path_prefix.len() > 1024
            || self.path_prefix.contains("//")
            || self.path_prefix.contains(['%', '\\', '?', '#'])
            || self.path_prefix.split('/').any(|p| matches!(p, "." | ".."))
            || self.path_prefix.chars().any(char::is_control)
        {
            return reject("Prefixo de caminho inválido.");
        }
        let url = parse_target(&self.url)?;
        self.check_url(&url)?;
        Ok(url)
    }

    pub fn check_url(&self, target: &Url) -> Result<(), PolicyError> {
        let initial = parse_target(&self.url)?;
        parse_target(target.as_str())?;
        if target.origin() != initial.origin() {
            return reject("Redirecionamento bloqueado: origem fora da allowlist.");
        }
        let prefix = self.path_prefix.trim_end_matches('/');
        if !prefix.is_empty()
            && target.path() != prefix
            && !target.path().starts_with(&format!("{prefix}/"))
        {
            return reject("URL fora do prefixo de caminho autorizado.");
        }
        Ok(())
    }
}

pub fn literal_ip(url: &Url) -> Option<IpAddr> {
    match url.host()? {
        Host::Ipv4(ip) => Some(ip.into()),
        Host::Ipv6(ip) => Some(ip.into()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::address_allowed;
    fn config() -> ScanConfig {
        ScanConfig {
            project_id: "x".into(),
            url: "https://example.com/app".into(),
            authorized: true,
            allow_private: false,
            path_prefix: "/app".into(),
            max_requests: 3,
            max_redirects: 2,
            timeout_seconds: 5,
            discovery: false,
            active_checks: false,
        }
    }
    #[test]
    fn scope_is_origin_and_segment_bound() {
        let c = config();
        assert!(c.validate().is_ok());
        for u in [
            "https://evil.com/app",
            "http://example.com/app",
            "https://example.com/application",
            "https://example.com/app/%2fadmin",
            "https://example.com/app?token=x",
        ] {
            assert!(c.check_url(&Url::parse(u).unwrap()).is_err(), "{u}");
        }
        assert!(c
            .check_url(&Url::parse("https://example.com/app/page").unwrap())
            .is_ok());
    }
    #[test]
    fn deny_reserved_and_metadata_even_with_private_authorization() {
        for ip in [
            "169.254.169.254",
            "168.63.129.16",
            "fd00:ec2::254",
            "fd20:ce::254",
            "100.100.100.200",
            "0.0.0.0",
            "224.0.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "::",
            "fe80::1",
            "ff02::1",
            "2001:db8::1",
            "2002:7f00:1::",
            "::ffff:169.254.169.254",
        ] {
            assert!(!address_allowed(ip.parse().unwrap(), true), "{ip}");
        }
        for ip in [
            "127.0.0.1",
            "10.1.1.1",
            "172.16.0.1",
            "192.168.0.1",
            "::1",
            "fd00::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!address_allowed(ip.parse().unwrap(), false));
            assert!(address_allowed(ip.parse().unwrap(), true));
        }
        assert!(address_allowed("1.1.1.1".parse().unwrap(), false));
    }
    #[test]
    fn authorization_is_not_optional() {
        let mut c = config();
        c.authorized = false;
        assert!(c.validate().is_err());
        assert!(parse_target("https://user:pass@example.com").is_err());
        assert!(parse_target("file:///etc/passwd").is_err());
    }
}
