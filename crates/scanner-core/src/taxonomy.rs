//! Classificação dos achados em CWE e OWASP Top 10 (2021), e rótulos em português.
//!
//! O mapeamento segue, quando existe, a classificação usada pelo OWASP ZAP para o alerta
//! equivalente. É uma referência de triagem: não substitui a análise do contexto do alvo.

use crate::{CheckStatus, ScanStatus, Severity};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Taxonomy {
    pub cwe: &'static str,
    pub owasp: &'static str,
}

const A01: &str = "A01:2021 Quebra de controle de acesso";
const A02: &str = "A02:2021 Falhas criptográficas";
const A05: &str = "A05:2021 Configuração insegura";
const A06: &str = "A06:2021 Componentes vulneráveis e desatualizados";
const A07: &str = "A07:2021 Falhas de identificação e autenticação";
const A08: &str = "A08:2021 Falhas de integridade de software e dados";

/// Retorna a classificação de um detector. `None` para boas práticas sem fraqueza associada.
pub fn taxonomy(detector_id: &str) -> Option<Taxonomy> {
    let t = |cwe, owasp| Some(Taxonomy { cwe, owasp });
    match detector_id {
        "transport.https" | "page.password-over-http" | "page.mixed-content" => t("CWE-319", A02),
        "headers.hsts" | "headers.hsts-strength" => t("CWE-319", A05),
        "headers.csp" | "headers.csp-strength" | "headers.csp-report-only" => t("CWE-693", A05),
        "headers.nosniff" | "headers.permissions" => t("CWE-693", A05),
        "headers.referrer" | "disclosure.robots" => t("CWE-200", A05),
        "headers.framing" => t("CWE-1021", A05),
        "headers.disclosure" | "headers.version" | "page.generator" => t("CWE-497", A05),
        "cookies.attributes" | "cookies.prefix" => t("CWE-614", A05),
        "cors.policy" | "cors.credentials" | "active.cors-reflection" | "active.cors-null" => {
            t("CWE-942", A05)
        }
        "tls.expiry" => t("CWE-324", A02),
        "tls.certificate" => t("CWE-326", A02),
        "tls.legacy-version" | "tls.weak-cipher" => t("CWE-327", A02),
        "page.sri" => t("CWE-353", A08),
        "page.outdated-library" | "headers.outdated-software" => t("CWE-1104", A06),
        "page.inline-secret" | "page.bundle-secret" => t("CWE-798", A07),
        "page.csrf-token" => t("CWE-352", A01),
        "page.private-ip" => t("CWE-497", A05),
        "active.http-methods" | "active.trace" => t("CWE-749", A05),
        "active.http-redirect" => t("CWE-319", A02),
        "exposure.error-page" => t("CWE-209", A05),
        "exposure.directory-listing" => t("CWE-548", A05),
        "exposure.source-map" => t("CWE-540", A05),
        "exposure.source-map-secret" => t("CWE-798", A07),
        "exposure.crossdomain" => t("CWE-942", A05),
        "exposure.swagger" | "exposure.openapi" => t("CWE-200", A05),
        id if id.starts_with("exposure.git") || id == "exposure.svn" => t("CWE-527", A05),
        id if id.starts_with("exposure.backup")
            || id.ends_with("-sql")
            || id == "exposure.wp-config-backup"
            || id == "exposure.env-backup" =>
        {
            t("CWE-530", A05)
        }
        "exposure.env" | "exposure.htpasswd" | "exposure.ds-store" => t("CWE-538", A05),
        id if id.starts_with("exposure.admin") => t("CWE-284", A05),
        id if id.starts_with("exposure.") => t("CWE-489", A05),
        _ => None,
    }
}

/// Endereço da definição da CWE (`CWE-79` → página no MITRE).
pub fn cwe_url(cwe: &str) -> String {
    format!(
        "https://cwe.mitre.org/data/definitions/{}.html",
        cwe.trim_start_matches("CWE-")
    )
}

impl Severity {
    pub fn label(&self) -> &'static str {
        match self {
            Severity::High => "Alta",
            Severity::Medium => "Média",
            Severity::Low => "Baixa",
            Severity::Info => "Informativa",
            Severity::Unrated => "Não pontuada",
        }
    }
}

impl ScanStatus {
    pub fn label(&self) -> &'static str {
        match self {
            ScanStatus::Running => "em execução",
            ScanStatus::Completed => "concluída",
            ScanStatus::Failed => "falhou / parcial",
            ScanStatus::Cancelled => "cancelada",
            ScanStatus::Interrupted => "interrompida",
        }
    }
}

impl CheckStatus {
    pub fn label(&self) -> &'static str {
        match self {
            CheckStatus::Passed => "sem achado",
            CheckStatus::Finding => "achado observado",
            CheckStatus::NotRun => "não executado",
            CheckStatus::Error => "erro",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_classification_is_well_formed() {
        for id in [
            "transport.https",
            "headers.csp-strength",
            "headers.framing",
            "cookies.prefix",
            "cors.credentials",
            "tls.weak-cipher",
            "page.sri",
            "page.inline-secret",
            "active.cors-reflection",
            "exposure.git-head",
            "exposure.env",
            "exposure.backup-zip",
            "exposure.dump-sql",
            "exposure.phpinfo",
            "exposure.admin-phpmyadmin",
        ] {
            let t = taxonomy(id).unwrap_or_else(|| panic!("{id} sem classificação"));
            assert!(t.cwe.starts_with("CWE-") && t.cwe[4..].parse::<u32>().is_ok());
            assert!(t.owasp.starts_with("A0") && t.owasp.contains(":2021 "));
        }
        assert_eq!(taxonomy("exposure.git-config").unwrap().cwe, "CWE-527");
        assert_eq!(taxonomy("exposure.database-sql").unwrap().cwe, "CWE-530");
        assert_eq!(taxonomy("disclosure.security-txt"), None);
        assert_eq!(
            cwe_url("CWE-79"),
            "https://cwe.mitre.org/data/definitions/79.html"
        );
    }
}
