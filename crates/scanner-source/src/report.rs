//! Local exports: no source snippets, absolute roots or external resource reads.
use crate::SourceScan;
use scanner_core::{ScanStatus, Severity};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceReportFormat {
    #[default]
    Json,
    Sarif,
}

impl SourceReportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Sarif => "sarif",
        }
    }
}

pub fn render(
    scan: &SourceScan,
    format: SourceReportFormat,
    redact_paths: bool,
) -> Result<Vec<u8>, String> {
    if scan.status == ScanStatus::Running {
        return Err("Finalize a análise antes de exportar.".into());
    }
    if scan.dependencies.iter().any(|dependency| {
        crate::dependencies::metadata_has_credential(&dependency.name)
            || crate::dependencies::metadata_has_credential(&dependency.version)
    }) {
        return Err("O histórico contém identificador potencialmente sensível; execute uma nova análise antes de exportar. Nenhum valor foi incluído no relatório.".into());
    }
    let value = match format {
        SourceReportFormat::Json => {
            let mut copy = scan.clone();
            if redact_paths {
                copy.root_name = "[repositório]".into();
                copy.scope_id.clear();
                for finding in &mut copy.findings {
                    finding.path = "[caminho ocultado]".into();
                }
                for dependency in &mut copy.dependencies {
                    dependency.path = "[caminho ocultado]".into();
                }
            }
            serde_json::to_value(copy)
        }
        SourceReportFormat::Sarif => Ok(sarif(scan, redact_paths)),
    }
    .map_err(|_| "Falha ao preparar relatório de código.")?;
    serde_json::to_vec_pretty(&value).map_err(|_| "Falha ao serializar relatório de código.".into())
}

fn level(severity: &Severity) -> &'static str {
    match severity {
        Severity::High => "error",
        Severity::Medium | Severity::Low => "warning",
        Severity::Info | Severity::Unrated => "note",
    }
}

// Encode path segments as URI bytes, including '%' and delimiters. Never emit
// absolute, parent-relative or synthetic locations as clickable file paths.
fn relative_uri(path: &str) -> Option<String> {
    if path.is_empty() || path.starts_with(['/', '\\', '[']) || path.contains('\\') {
        return None;
    }
    if path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
        || path.as_bytes().get(1) == Some(&b':')
        || path.chars().any(char::is_control)
    {
        return None;
    }
    let mut uri = String::new();
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~/".contains(&byte) {
            uri.push(byte as char);
        } else {
            use std::fmt::Write;
            write!(&mut uri, "%{byte:02X}").expect("writing to a String cannot fail");
        }
    }
    Some(uri)
}

fn sarif(scan: &SourceScan, redact_paths: bool) -> Value {
    // Rule descriptors describe the detector, rather than one advisory/package.
    let mut indices = BTreeMap::new();
    let mut rules = Vec::new();
    let mut results = Vec::new();
    for finding in &scan.findings {
        let next_index = rules.len();
        let index = *indices.entry(&finding.rule_id).or_insert_with(|| {
            rules.push(json!({
                "id": finding.rule_id,
                "shortDescription": {"text": finding.rule_id},
                "properties": {"tags": [finding.category]}
            }));
            next_index
        });
        let mut result = json!({
            "ruleId": finding.rule_id,
            "ruleIndex": index,
            "level": level(&finding.severity),
            "message": {"text": format!("{}\n{}\n{}\nImpacto: {}\nRecomendação: {}\nComo verificar: {}\nReferência: {}",
                finding.title, finding.description, finding.evidence, finding.impact,
                finding.recommendation, finding.verification, finding.reference)},
            "properties": {
                "category": finding.category,
                "confidence": finding.confidence,
                "severity": finding.severity,
                "detectorVersion": finding.detector_version,
                "verification": finding.verification,
                "suggestedFix": finding.suggested_fix
            }
        });
        if !redact_paths {
            if let Some(uri) = relative_uri(&finding.path) {
                let mut location =
                    json!({"artifactLocation": {"uri": uri, "uriBaseId": "%SRCROOT%"}});
                if finding.line > 0 {
                    location["region"] = json!({"startLine": finding.line});
                }
                result["locations"] = json!([{"physicalLocation": location}]);
            }
        }
        results.push(result);
    }
    let mut notifications = Vec::new();
    for module in &scan.modules {
        if matches!(module.status.as_str(), "partial" | "error" | "unavailable") {
            notifications.push(json!({
                "level": if module.status == "error" {"error"} else {"warning"},
                "message": {"text": format!("{}: {}", module.id, module.detail)}
            }));
        }
    }
    if scan.stats.truncated
        || scan.stats.errors > 0
        || scan.stats.skipped > 0
        || scan.stats.binaries > 0
    {
        notifications.push(json!({"level": "warning", "message": {"text":
            "Cobertura limitada: há arquivos ignorados, binários, erros ou limites de leitura. Ausência de achados não comprova ausência de vulnerabilidades."}}));
    }
    let successful = scan.status == ScanStatus::Completed
        && !scan.modules.iter().any(|module| module.status == "error");
    if !successful {
        notifications.push(json!({"level": "error", "message": {"text":
            "A análise não concluiu com sucesso todos os módulos executados. Os achados disponíveis são parciais."}}));
    }
    json!({
        "$schema": "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {"driver": {"name": "Qypher Source Lab", "version": env!("CARGO_PKG_VERSION"), "rules": rules}},
            "invocations": [{"executionSuccessful": successful, "toolExecutionNotifications": notifications}],
            "results": results,
            "properties": {
                "scanId": scan.id,
                "status": scan.status,
                "redacted": redact_paths,
                "stats": scan.stats,
                "modules": scan.modules,
                "limitations": [
                    "Triagem lexical e módulos opcionais; não há análise semântica ou comprovação de exploração.",
                    "Segredos e conteúdo dos arquivos não são incluídos. Nenhum CVSS foi atribuído.",
                    "Caminhos ocultados removem localizações SARIF; habilite caminhos relativos para navegar pelos arquivos."
                ]
            }
        }]
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{rules, SourceConfig};

    fn fixture() -> SourceScan {
        let mut scan = SourceScan::new("private-repository".into(), SourceConfig::default());
        scan.findings = rules::analyze_text(
            "src/app.ts",
            "ts",
            "eval(user);\neval(other);",
            true,
            false,
            false,
        );
        scan.status = ScanStatus::Completed;
        scan
    }

    fn document(scan: &SourceScan, redact: bool) -> Value {
        serde_json::from_slice(&render(scan, SourceReportFormat::Sarif, redact).unwrap()).unwrap()
    }

    #[test]
    fn exports_deduplicated_rules_levels_and_one_based_locations() {
        let scan = fixture();
        let value = document(&scan, false);
        assert_eq!(value["version"], "2.1.0");
        let run = &value["runs"][0];
        assert_eq!(run["tool"]["driver"]["rules"].as_array().unwrap().len(), 1);
        assert_eq!(run["results"].as_array().unwrap().len(), 2);
        assert_eq!(run["results"][1]["ruleIndex"], 0);
        assert_eq!(run["results"][1]["level"], "warning");
        assert_eq!(
            run["results"][1]["locations"][0]["physicalLocation"]["region"]["startLine"],
            2
        );
        assert_eq!(run["invocations"][0]["executionSuccessful"], true);
    }

    #[test]
    fn redaction_removes_locations_and_preserves_original_scan() {
        let scan = fixture();
        let value = document(&scan, true);
        let output = value.to_string();
        assert!(!output.contains("private-repository"));
        assert!(!output.contains("src/app.ts"));
        assert!(value["runs"][0]["results"][0].get("locations").is_none());
        let json: Value =
            serde_json::from_slice(&render(&scan, SourceReportFormat::Json, true).unwrap())
                .unwrap();
        assert_eq!(json["rootName"], "[repositório]");
        assert_eq!(json["findings"][0]["path"], "[caminho ocultado]");
        assert_eq!(scan.findings[0].path, "src/app.ts");
    }

    #[test]
    fn encodes_reserved_characters_and_rejects_unsafe_paths() {
        assert_eq!(
            relative_uri("src/ação #1%.ts").unwrap(),
            "src/a%C3%A7%C3%A3o%20%231%25.ts"
        );
        for path in [
            "",
            "../secret",
            "src/../secret",
            "/etc/passwd",
            "//host/file",
            "C:/secret",
            "C:\\secret",
            "[escopo local selecionado]",
            "https://example.test/a",
            "a\n.js",
        ] {
            assert!(relative_uri(path).is_none(), "{path:?}");
        }
    }

    #[test]
    fn file_level_alerts_have_no_fabricated_line_and_unknown_severity_is_a_note() {
        let mut scan = fixture();
        scan.findings[0].line = 0;
        scan.findings[0].severity = Severity::Unrated;
        let value = document(&scan, false);
        let result = &value["runs"][0]["results"][0];
        assert_eq!(result["level"], "note");
        assert!(result["locations"][0]["physicalLocation"]
            .get("region")
            .is_none());
        scan.findings[0].path = "[escopo local selecionado]".into();
        assert!(document(&scan, false)["runs"][0]["results"][0]
            .get("locations")
            .is_none());
    }

    #[test]
    fn empty_partial_cancelled_and_failed_scans_are_not_clean_attestations() {
        let mut scan = fixture();
        scan.findings.clear();
        scan.stats.truncated = true;
        scan.module("source.sast", "partial", "Limite atingido.");
        let value = document(&scan, true);
        assert!(value["runs"][0]["results"].as_array().unwrap().is_empty());
        assert!(
            !value["runs"][0]["invocations"][0]["toolExecutionNotifications"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        for status in [
            ScanStatus::Cancelled,
            ScanStatus::Interrupted,
            ScanStatus::Failed,
        ] {
            scan.status = status;
            assert_eq!(
                document(&scan, true)["runs"][0]["invocations"][0]["executionSuccessful"],
                false
            );
        }
        scan.status = ScanStatus::Completed;
        scan.module("dependencies.osv", "error", "Serviço indisponível.");
        assert_eq!(
            document(&scan, true)["runs"][0]["invocations"][0]["executionSuccessful"],
            false
        );
    }

    #[test]
    fn running_scans_cannot_be_exported_in_either_format() {
        let mut scan = fixture();
        scan.status = ScanStatus::Running;
        for format in [SourceReportFormat::Json, SourceReportFormat::Sarif] {
            assert!(render(&scan, format, true).is_err());
        }
    }

    #[test]
    fn secrets_and_antivirus_file_lists_never_enter_reports() {
        let mut scan = fixture();
        let secret = ["ghp_", "abcdefghijklmnopqrstuvwxyz1234567890"].concat();
        scan.findings = rules::analyze_text(
            "src/private.ts",
            "ts",
            &format!("// removed credential: {secret}"),
            true,
            true,
            true,
        );
        assert_eq!(scan.findings.len(), 1);
        scan.av_files.push("internal-av-file-name".into());
        scan.dependencies.push(crate::Dependency {
            ecosystem: "npm".into(),
            name: "example-package".into(),
            version: "1.0.0".into(),
            path: "private/nested/package-lock.json".into(),
            version_source: "lockfile".into(),
        });
        for format in [SourceReportFormat::Json, SourceReportFormat::Sarif] {
            for redact in [false, true] {
                let output = String::from_utf8(render(&scan, format, redact).unwrap()).unwrap();
                assert!(!output.contains(&secret));
                assert!(!output.contains("internal-av-file-name"));
                if redact {
                    assert!(!output.contains("src/private.ts"));
                    assert!(!output.contains("private/nested/package-lock.json"));
                    assert!(!output.contains("private-repository"));
                }
            }
        }
    }
}
