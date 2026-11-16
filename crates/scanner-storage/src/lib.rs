use chrono::Utc;
use rusqlite::{params, Connection};
use scanner_core::*;
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;

pub struct Store(Connection);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReview {
    pub scan_id: String,
    pub finding_id: String,
    pub disposition: String,
    pub reviewed_at: String,
}

fn remove_legacy_samples(value: &mut serde_json::Value) -> usize {
    match value {
        serde_json::Value::Object(object) => {
            let removed = usize::from(object.remove("sample").is_some());
            removed
                + object
                    .values_mut()
                    .map(remove_legacy_samples)
                    .sum::<usize>()
        }
        serde_json::Value::Array(values) => values.iter_mut().map(remove_legacy_samples).sum(),
        _ => 0,
    }
}

impl Store {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(3))
            .map_err(|e| e.to_string())?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;",
            )
            .map_err(|e| e.to_string())?;
        let version: i32 = connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 3 {
            return Err("Banco criado por uma versão mais recente do Qypher.".into());
        }
        if version == 0 {
            connection
                .execute_batch(&format!(
                    "BEGIN IMMEDIATE; {} COMMIT;",
                    include_str!("../migrations/001_initial.sql")
                ))
                .map_err(|e| e.to_string())?;
        }
        if version < 2 {
            connection
                .execute_batch(&format!(
                    "BEGIN IMMEDIATE; {} COMMIT;",
                    include_str!("../migrations/002_source_scans.sql")
                ))
                .map_err(|e| e.to_string())?;
        }
        if version < 3 {
            connection
                .execute_batch("BEGIN IMMEDIATE;")
                .map_err(|e| e.to_string())?;
            let upgraded = (|| -> Result<()> {
                // Walk all history, independently of UI pagination, and preserve unknown fields.
                let mut query = connection
                    .prepare("SELECT id,data FROM scans")
                    .map_err(|e| e.to_string())?;
                let rows = query
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })
                    .map_err(|e| e.to_string())?;
                for row in rows {
                    let (id, data) = row.map_err(|e| e.to_string())?;
                    let mut value: serde_json::Value =
                        serde_json::from_str(&data).map_err(|_| {
                            "Histórico inválido: a migração de privacidade não foi aplicada."
                                .to_string()
                        })?;
                    if remove_legacy_samples(&mut value) > 0 {
                        let data = serde_json::to_string(&value).map_err(|e| e.to_string())?;
                        connection
                            .execute("UPDATE scans SET data=?1 WHERE id=?2", params![data, id])
                            .map_err(|e| e.to_string())?;
                    }
                }
                connection
                    .execute_batch(include_str!("../migrations/003_lab_and_reviews.sql"))
                    .map_err(|e| e.to_string())?;
                Ok(())
            })();
            match upgraded {
                Ok(()) => connection
                    .execute_batch("COMMIT;")
                    .map_err(|e| e.to_string())?,
                Err(error) => {
                    let _ = connection.execute_batch("ROLLBACK;");
                    return Err(error);
                }
            }
            // Logical sanitization is guaranteed; backups and filesystem remnants are outside it.
            let _ = connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        }
        Ok(Self(connection))
    }
    pub fn create_project(&self, name: &str, url: &str) -> Result<Project> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
            return Err("Nome deve conter entre 1 e 80 caracteres sem controles.".into());
        }
        let url = parse_target(url).map_err(|e| e.to_string())?.to_string();
        let p = Project {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            url,
            created_at: Utc::now().to_rfc3339(),
        };
        self.0
            .execute(
                "INSERT INTO projects VALUES (?1,?2,?3,?4)",
                params![p.id, p.name, p.url, p.created_at],
            )
            .map_err(|e| e.to_string())?;
        Ok(p)
    }
    pub fn save_scan(&self, scan: &Scan) -> Result<()> {
        let data = serde_json::to_string(scan).map_err(|e| e.to_string())?;
        self.0.execute("INSERT INTO scans (id,project_id,started_at,data) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            params![scan.id,scan.config.project_id,scan.started_at,data]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn scan(&self, id: &str) -> Result<Scan> {
        let data: String = self
            .0
            .query_row("SELECT data FROM scans WHERE id=?1", [id], |r| r.get(0))
            .map_err(|_| "Auditoria não encontrada.".to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let mut statement = self
            .0
            .prepare("SELECT id,name,url,created_at FROM projects ORDER BY created_at DESC")
            .map_err(|e| e.to_string())?;
        let projects = statement
            .query_map([], |r| {
                Ok(Project {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    url: r.get(2)?,
                    created_at: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut statement = self
            .0
            .prepare("SELECT data FROM scans ORDER BY started_at DESC LIMIT 200")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut scans = vec![];
        for row in rows {
            scans.push(
                serde_json::from_str(&row.map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?,
            );
        }
        Ok(Snapshot { projects, scans })
    }
    pub fn interrupt_abandoned(&self) -> Result<()> {
        // Startup only: never call this while a worker is active.
        for id in self.running_ids("scans")? {
            let mut scan = self.scan(&id)?;
            if scan.status == ScanStatus::Running {
                scan.status = ScanStatus::Interrupted;
                scan.finished_at = Some(Utc::now().to_rfc3339());
                scan.risk = None;
                scan.error=Some("Execução interrompida pelo encerramento do aplicativo. Cobertura inconclusiva.".into());
                scan.log("scan.interrupted","Execução anterior interrompida; nenhuma resolução de achados pode ser inferida.",LogLevel::Warn);
                self.save_scan(&scan)?;
            }
        }
        for id in self.running_ids("source_scans")? {
            let mut scan = self.source(&id)?;
            if scan.status == ScanStatus::Running {
                scan.status = ScanStatus::Interrupted;
                scan.finished_at = Some(Utc::now().to_rfc3339());
                scan.error =
                    Some("Análise de código interrompida pelo encerramento do aplicativo.".into());
                self.save_source(&scan)?;
            }
        }
        for id in self.running_ids("lab_runs")? {
            let mut run = self.lab(&id)?;
            run.status = ScanStatus::Interrupted;
            run.finished_at = Some(Utc::now().to_rfc3339());
            run.verdict = scanner_http::lab::LabVerdict::Inconclusive;
            run.reason = "Laboratório interrompido pelo encerramento do aplicativo; credenciais não foram persistidas.".into();
            run.error = Some("Execução interrompida.".into());
            self.save_lab(&run)?;
        }
        Ok(())
    }
    pub fn save_source(&self, scan: &scanner_source::SourceScan) -> Result<()> {
        let data = serde_json::to_string(scan).map_err(|e| e.to_string())?;
        self.0.execute("INSERT INTO source_scans (id,started_at,data) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![scan.id,scan.started_at,data]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn source_scans(&self) -> Result<Vec<scanner_source::SourceScan>> {
        let mut q = self
            .0
            .prepare("SELECT data FROM source_scans ORDER BY started_at DESC LIMIT 100")
            .map_err(|e| e.to_string())?;
        let rows = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = vec![];
        for row in rows {
            out.push(
                serde_json::from_str(&row.map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?,
            );
        }
        Ok(out)
    }
    pub fn source(&self, id: &str) -> Result<scanner_source::SourceScan> {
        let data: String = self
            .0
            .query_row("SELECT data FROM source_scans WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(|_| "Análise de código não encontrada.")?;
        serde_json::from_str(&data).map_err(|e| e.to_string())
    }
    pub fn delete_source(&self, id: &str) -> Result<()> {
        self.0
            .execute("DELETE FROM source_scans WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    fn running_ids(&self, table: &str) -> Result<Vec<String>> {
        if !matches!(table, "scans" | "source_scans" | "lab_runs") {
            return Err("Tabela de execução inválida.".into());
        }
        let mut query = self
            .0
            .prepare(&format!(
                "SELECT id FROM {table} WHERE json_extract(data,'$.status')='running'"
            ))
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub fn source_reviews(&self, id: &str) -> Result<Vec<SourceReview>> {
        let mut query = self.0.prepare("SELECT scan_id,finding_id,disposition,reviewed_at FROM source_reviews WHERE scan_id=?1 ORDER BY reviewed_at").map_err(|e| e.to_string())?;
        let rows = query
            .query_map([id], |row| {
                Ok(SourceReview {
                    scan_id: row.get(0)?,
                    finding_id: row.get(1)?,
                    disposition: row.get(2)?,
                    reviewed_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub fn review_source(&self, id: &str, finding_id: &str, false_positive: bool) -> Result<()> {
        let scan = self.source(id)?;
        if scan.status == ScanStatus::Running
            || !scan.findings.iter().any(|finding| finding.id == finding_id)
        {
            return Err("Selecione um achado de uma análise finalizada.".into());
        }
        if false_positive {
            self.0.execute("INSERT INTO source_reviews VALUES (?1,?2,'false_positive',?3) ON CONFLICT(scan_id,finding_id) DO UPDATE SET reviewed_at=excluded.reviewed_at", params![id,finding_id,Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
        } else {
            self.0
                .execute(
                    "DELETE FROM source_reviews WHERE scan_id=?1 AND finding_id=?2",
                    params![id, finding_id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn save_lab(&self, run: &scanner_http::lab::LabRun) -> Result<()> {
        let data = serde_json::to_string(run).map_err(|e| e.to_string())?;
        self.0.execute("INSERT INTO lab_runs VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![run.id,run.project_id,run.started_at,data]).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn lab(&self, id: &str) -> Result<scanner_http::lab::LabRun> {
        let data: String = self
            .0
            .query_row("SELECT data FROM lab_runs WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .map_err(|_| "Execução de laboratório não encontrada.".to_string())?;
        serde_json::from_str(&data).map_err(|_| "Registro de laboratório inválido.".into())
    }
    pub fn lab_history(&self) -> Result<Vec<scanner_http::lab::LabRun>> {
        let mut query = self
            .0
            .prepare("SELECT data FROM lab_runs ORDER BY started_at DESC LIMIT 100")
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|row| {
            serde_json::from_str(&row.map_err(|e| e.to_string())?)
                .map_err(|_| "Registro de laboratório inválido.".to_string())
        })
        .collect()
    }
    pub fn delete_lab(&self, id: &str) -> Result<()> {
        self.0
            .execute("DELETE FROM lab_runs WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    /// Remove os trechos de conteúdo vazado de uma auditoria, mantendo o restante.
    /// Retorna quantos achados foram limpos.
    pub fn purge_samples(&self, id: &str) -> Result<usize> {
        let mut scan = self.scan(id)?;
        let mut cleared = 0;
        let mut clear = |f: &mut Finding| {
            if f.sample.take().is_some() {
                cleared += 1;
            }
        };
        for f in &mut scan.findings {
            clear(f);
        }
        for c in &mut scan.checks {
            for f in &mut c.findings {
                clear(f);
            }
        }
        if cleared > 0 {
            scan.log(
                "scan.purged",
                "Trechos de conteúdo vazado removidos deste registro a pedido do usuário.",
                LogLevel::Info,
            );
            self.save_scan(&scan)?;
        }
        Ok(cleared)
    }
    pub fn delete_scan(&self, id: &str) -> Result<()> {
        self.0
            .execute("DELETE FROM scans WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn delete_project(&self, id: &str) -> Result<()> {
        self.0
            .execute("DELETE FROM projects WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrations_roundtrip_and_cascade() {
        let s = Store::open(":memory:").unwrap();
        let p = s.create_project("Teste", "https://example.com").unwrap();
        let scan = Scan::new(ScanConfig {
            project_id: p.id.clone(),
            url: p.url.clone(),
            authorized: true,
            allow_private: false,
            path_prefix: "/".into(),
            max_requests: 1,
            max_redirects: 0,
            timeout_seconds: 2,
            discovery: false,
            active_checks: false,
        });
        s.save_scan(&scan).unwrap();
        assert_eq!(s.scan(&scan.id).unwrap().id, scan.id);
        s.interrupt_abandoned().unwrap();
        assert_eq!(s.purge_samples(&scan.id).unwrap(), 0);
        assert_eq!(s.scan(&scan.id).unwrap().status, ScanStatus::Interrupted);
        s.delete_project(&p.id).unwrap();
        assert!(s.snapshot().unwrap().scans.is_empty());
        assert!(s.save_scan(&scan).is_err());
    }
    #[test]
    fn invalid_project_does_not_persist() {
        let s = Store::open(":memory:").unwrap();
        assert!(s.create_project("", "https://example.com").is_err());
        assert!(s.create_project("test", "https://a:b@example.com").is_err());
        assert!(s.snapshot().unwrap().projects.is_empty());
    }

    #[test]
    fn migration_removes_legacy_samples_from_every_row_without_dropping_metadata() {
        let path = std::env::temp_dir().join(format!("qypher-privacy-{}.db", Uuid::new_v4()));
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(include_str!("../migrations/001_initial.sql"))
                .unwrap();
            connection
                .execute_batch(include_str!("../migrations/002_source_scans.sql"))
                .unwrap();
            connection
                .execute(
                    "INSERT INTO projects VALUES ('p','fixture','https://example.invalid/','now')",
                    [],
                )
                .unwrap();
            for index in 0..205 {
                let data = serde_json::json!({"status":"completed","findings":[{"sample":"old-secret-value","id":"preserved"}],"checks":[{"findings":[{"sample":"nested-secret"}]}],"futureMetadata":{"keep":true}}).to_string();
                connection
                    .execute(
                        "INSERT INTO scans VALUES (?1,'p','now',?2)",
                        params![format!("scan-{index}"), data],
                    )
                    .unwrap();
            }
        }
        {
            let store = Store::open(&path).unwrap();
            let count: usize = store.0.query_row("SELECT COUNT(*) FROM scans WHERE instr(data,'old-secret-value')>0 OR instr(data,'nested-secret')>0", [], |row| row.get(0)).unwrap();
            assert_eq!(count, 0);
            let metadata: String = store
                .0
                .query_row("SELECT data FROM scans WHERE id='scan-204'", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert!(metadata.contains("preserved"));
            assert!(metadata.contains("futureMetadata"));
            assert_eq!(
                store
                    .0
                    .pragma_query_value::<i32, _>(None, "user_version", |row| row.get(0))
                    .unwrap(),
                3
            );
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn reviews_are_explicit_reversible_and_deleted_with_the_source_run() {
        let store = Store::open(":memory:").unwrap();
        let mut scan = scanner_source::SourceScan::new(
            "fixture".into(),
            scanner_source::SourceConfig::default(),
        );
        scan.findings =
            scanner_source::rules::analyze_text("a.js", "js", "eval(value)", true, false, false);
        store.save_source(&scan).unwrap();
        let finding_id = scan.findings[0].id.clone();
        assert!(store.review_source(&scan.id, &finding_id, true).is_err());
        scan.status = ScanStatus::Completed;
        store.save_source(&scan).unwrap();
        assert!(store
            .review_source(&scan.id, "not-a-finding", true)
            .is_err());
        store.review_source(&scan.id, &finding_id, true).unwrap();
        assert_eq!(store.source_reviews(&scan.id).unwrap().len(), 1);
        assert_eq!(store.source(&scan.id).unwrap().findings.len(), 1);
        store.review_source(&scan.id, &finding_id, false).unwrap();
        assert!(store.source_reviews(&scan.id).unwrap().is_empty());
        store.review_source(&scan.id, &finding_id, true).unwrap();
        store.delete_source(&scan.id).unwrap();
        assert!(store.source_reviews(&scan.id).unwrap().is_empty());
    }

    #[test]
    fn recovery_includes_old_source_runs_beyond_the_visual_history_limit() {
        let store = Store::open(":memory:").unwrap();
        for index in 0..105 {
            let mut scan = scanner_source::SourceScan::new(
                "fixture".into(),
                scanner_source::SourceConfig::default(),
            );
            scan.id = format!("source-{index:04}");
            scan.started_at = format!("2026-01-{index:04}");
            store.save_source(&scan).unwrap();
        }
        assert_eq!(store.source_scans().unwrap().len(), 100);
        store.interrupt_abandoned().unwrap();
        let running: usize = store
            .0
            .query_row(
                "SELECT COUNT(*) FROM source_scans WHERE json_extract(data,'$.status')='running'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(running, 0);
    }

    #[test]
    fn lab_history_never_contains_credentials_or_the_synthetic_marker() {
        let store = Store::open(":memory:").unwrap();
        let project = store
            .create_project("Fixture", "http://127.0.0.1/")
            .unwrap();
        let request: scanner_http::lab::LabRequest = serde_json::from_value(serde_json::json!({
            "projectId":project.id,"url":project.url,"pathPrefix":"/","authorized":true,"syntheticDataConfirmed":true,
            "environment":"local","allowPrivate":true,"scenario":"protected_route","marker":"qypher-fixture-private-marker",
            "ownerCredential":{"kind":"bearer","value":"private-test-credential"},"challengerCredential":null,
            "expectedDeniedStatus":403,"maxRequests":2,"timeoutSeconds":5
        })).unwrap();
        let run = scanner_http::lab::LabRun::new(&request);
        store.save_lab(&run).unwrap();
        let data: String = store
            .0
            .query_row("SELECT data FROM lab_runs WHERE id=?1", [&run.id], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(!data.contains("private-test-credential"));
        assert!(!data.contains("qypher-fixture-private-marker"));
        store.interrupt_abandoned().unwrap();
        assert_eq!(store.lab(&run.id).unwrap().status, ScanStatus::Interrupted);
        store.delete_project(&project.id).unwrap();
        assert!(store.lab_history().unwrap().is_empty());
    }
}
