use chrono::Utc;
use scanner_core::{LogEntry, LogLevel, ScanStatus, Severity};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const SECRETS_DETECTOR_VERSION: &str = "1.1.0";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceConfig {
    pub authorized: bool,
    pub sast: bool,
    pub secrets: bool,
    pub suspicious: bool,
    pub dependencies: bool,
    pub osv: bool,
    pub antivirus: bool,
    pub max_files: u32,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
    pub timeout_seconds: u64,
}
impl SourceConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !self.authorized {
            return Err("Confirme sua autorização para analisar esta cópia local.".into());
        }
        if !(1..=10000).contains(&self.max_files)
            || !(1024..=4 * 1024 * 1024).contains(&self.max_file_bytes)
            || !(1024 * 1024..=256 * 1024 * 1024).contains(&self.max_total_bytes)
            || !(5..=300).contains(&self.timeout_seconds)
        {
            return Err("Limites de leitura inválidos.".into());
        }
        if ![
            self.sast,
            self.secrets,
            self.suspicious,
            self.dependencies,
            self.antivirus,
        ]
        .iter()
        .any(|v| *v)
        {
            return Err("Escolha pelo menos um módulo.".into());
        }
        if self.osv && !self.dependencies {
            return Err("OSV requer inventário de dependências habilitado.".into());
        }
        Ok(())
    }
}
impl Default for SourceConfig {
    fn default() -> Self {
        Self {
            authorized: false,
            sast: true,
            secrets: true,
            suspicious: true,
            dependencies: true,
            osv: false,
            antivirus: false,
            max_files: 3000,
            max_file_bytes: 1024 * 1024,
            max_total_bytes: 64 * 1024 * 1024,
            timeout_seconds: 90,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFinding {
    pub id: String,
    pub rule_id: String,
    pub detector_version: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub category: String,
    pub severity: Severity,
    pub confidence: String,
    pub path: String,
    pub line: usize,
    pub evidence: String,
    pub impact: String,
    pub recommendation: String,
    #[serde(default)]
    pub verification: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_fix: Option<String>,
    pub reference: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStats {
    pub files: u32,
    pub bytes: u64,
    pub skipped: u32,
    pub errors: u32,
    pub binaries: u32,
    pub directories: u32,
    pub truncated: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleResult {
    pub id: String,
    pub version: String,
    pub status: String,
    pub detail: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub ecosystem: String,
    pub name: String,
    pub version: String,
    pub path: String,
    #[serde(default)]
    pub version_source: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceScan {
    #[serde(skip)]
    pub av_files: Vec<String>,
    pub schema_version: u8,
    pub id: String,
    pub root_name: String,
    #[serde(default)]
    pub scope_id: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: ScanStatus,
    pub config: SourceConfig,
    pub stats: SourceStats,
    pub findings: Vec<SourceFinding>,
    pub dependencies: Vec<Dependency>,
    pub modules: Vec<ModuleResult>,
    pub logs: Vec<LogEntry>,
    pub error: Option<String>,
}
impl SourceScan {
    pub fn new(root_name: String, config: SourceConfig) -> Self {
        Self {
            av_files: vec![],
            schema_version: 1,
            id: Uuid::new_v4().to_string(),
            root_name,
            scope_id: String::new(),
            started_at: Utc::now().to_rfc3339(),
            finished_at: None,
            status: ScanStatus::Running,
            config,
            stats: SourceStats::default(),
            findings: vec![],
            dependencies: vec![],
            modules: vec![],
            logs: vec![LogEntry::new(
                "source.created",
                "Execução local registrada. Nenhum código do repositório será executado.",
                LogLevel::Info,
            )],
            error: None,
        }
    }
    pub fn log(&mut self, event: &str, message: &str) {
        if self.logs.len() >= 200 {
            self.logs.remove(0);
        }
        self.logs
            .push(LogEntry::new(event, message, LogLevel::Info));
    }
    pub fn module(&mut self, id: &str, status: &str, detail: &str) {
        self.modules.push(ModuleResult {
            id: id.into(),
            version: if id == "source.secrets" {
                SECRETS_DETECTOR_VERSION
            } else if id == "source.dependencies" {
                "1.1.0"
            } else {
                "1.0.0"
            }
            .into(),
            status: status.into(),
            detail: detail.into(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn previous_source_snapshots_deserialize_without_new_optional_fields() {
        let scan = SourceScan::new("older-project".into(), SourceConfig::default());
        let mut value = serde_json::to_value(scan).unwrap();
        value.as_object_mut().unwrap().remove("scopeId");
        value["findings"] = serde_json::json!([{
            "id":"old", "ruleId":"js.eval", "detectorVersion":"1.0.0", "title":"Old finding", "category":"sast", "severity":"medium", "confidence":"heuristic", "path":"app.js", "line":1,
            "evidence":"Pattern only", "impact":"Review", "recommendation":"Review", "reference":"CWE-95"
        }]);
        value["dependencies"] = serde_json::json!([{"ecosystem":"npm", "name":"pkg", "version":"1.2.3", "path":"package-lock.json"}]);
        let old: SourceScan = serde_json::from_value(value).unwrap();
        assert!(old.scope_id.is_empty());
        assert!(old.findings[0].description.is_empty());
        assert!(old.findings[0].verification.is_empty());
        assert!(old.findings[0].suggested_fix.is_none());
        assert!(old.dependencies[0].version_source.is_empty());
    }
}
