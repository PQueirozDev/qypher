use crate::{cloud, dependencies, model::*, rules};
use cap_std::{ambient_authority, fs::Dir};
use scanner_core::ScanStatus;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

fn reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
fn skip_directory(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".svn"
            | ".hg"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".venv"
            | "venv"
            | "vendor"
            | ".cache"
            | "__pycache__"
    )
}
fn extension(path: &Path) -> String {
    if path
        .file_name()
        .is_some_and(|v| v.to_string_lossy().eq_ignore_ascii_case("Dockerfile"))
    {
        "dockerfile".into()
    } else {
        path.extension()
            .map(|s| s.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    }
}
pub fn validate_root(root: &Path) -> Result<PathBuf, String> {
    let metadata =
        fs::symlink_metadata(root).map_err(|_| "Não foi possível abrir a pasta selecionada.")?;
    if reparse(&metadata) || !metadata.is_dir() {
        return Err("Selecione uma pasta real, sem symlink/reparse point na raiz.".into());
    }
    let root = root
        .canonicalize()
        .map_err(|_| "Falha ao resolver a pasta.")?;
    if root.parent().is_none() {
        return Err("Selecione um projeto, não a raiz do sistema de arquivos.".into());
    }
    Ok(root)
}

pub fn scope_id(root: &Path) -> Result<String, String> {
    let canonical = validate_root(root)?;
    let mut digest = Sha256::new();
    digest.update(b"qypher-source-scope-v1\0");
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        digest.update(canonical.as_os_str().as_bytes());
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        for unit in canonical.as_os_str().encode_wide() {
            let unit = if (u16::from(b'A')..=u16::from(b'Z')).contains(&unit) {
                unit + 32
            } else {
                unit
            };
            digest.update(unit.to_le_bytes());
        }
    }
    #[cfg(not(any(unix, windows)))]
    digest.update(canonical.to_string_lossy().as_bytes());
    Ok(format!("{:x}", digest.finalize()))
}
pub fn inspect(
    root: &Path,
    scan: &mut SourceScan,
    cancelled: &dyn Fn() -> bool,
    progress: &dyn Fn(&SourceScan),
) -> Result<(), String> {
    scan.config.validate()?;
    let root = validate_root(root)?;
    scan.scope_id = scope_id(&root)?;
    let capability = Dir::open_ambient_dir(&root, ambient_authority())
        .map_err(|_| "Falha ao abrir o escopo local.")?;
    let clock = Instant::now();
    let mut dirs = VecDeque::from([(PathBuf::from("."), 0usize)]);
    let directory_budget = scan.config.max_files.saturating_mul(4).saturating_add(1024);
    let mut discovered_directories = 1u32;
    let mut seen = BTreeMap::<(String, String, String), usize>::new();
    let mut unresolved_dependencies = BTreeSet::new();
    let mut resolved_dependencies = BTreeSet::new();
    let mut cloud = cloud::Inspector::default();
    scan.log("source.readonly","Leitura por capability de diretório. Scripts, hooks e binários do alvo não serão executados.");
    progress(scan);
    'walk: while let Some((relative, depth)) = dirs.pop_front() {
        if cancelled() {
            return Err("cancelled".into());
        }
        if clock.elapsed() >= Duration::from_secs(scan.config.timeout_seconds) {
            scan.stats.truncated = true;
            break;
        }
        if depth > 32 {
            scan.stats.truncated = true;
            scan.stats.skipped += 1;
            continue;
        }
        let entries = match capability.read_dir(&relative) {
            Ok(v) => v,
            Err(_) => {
                scan.stats.errors += 1;
                continue;
            }
        };
        scan.stats.directories += 1;
        for entry in entries {
            if cancelled() {
                return Err("cancelled".into());
            }
            if clock.elapsed() >= Duration::from_secs(scan.config.timeout_seconds)
                || scan.stats.files >= scan.config.max_files
            {
                scan.stats.truncated = true;
                break 'walk;
            }
            let entry = match entry {
                Ok(v) => v,
                Err(_) => {
                    scan.stats.errors += 1;
                    continue;
                }
            };
            let path = relative.join(entry.file_name());
            let metadata = match fs::symlink_metadata(root.join(&path)) {
                Ok(v) => v,
                Err(_) => {
                    scan.stats.errors += 1;
                    continue;
                }
            };
            if reparse(&metadata) {
                scan.stats.skipped += 1;
                continue;
            }
            if metadata.is_dir() {
                if skip_directory(&entry.file_name().to_string_lossy()) {
                    scan.stats.skipped += 1;
                } else if discovered_directories >= directory_budget {
                    scan.stats.truncated = true;
                    scan.stats.skipped += 1;
                } else {
                    discovered_directories += 1;
                    dirs.push_back((path, depth + 1));
                }
                continue;
            }
            if !metadata.is_file() {
                scan.stats.skipped += 1;
                continue;
            }
            if metadata.len() > scan.config.max_file_bytes {
                scan.stats.skipped += 1;
                continue;
            }
            if metadata.len() > scan.config.max_total_bytes.saturating_sub(scan.stats.bytes) {
                scan.stats.truncated = true;
                break 'walk;
            }
            // The capability open cannot escape the selected root even if names change concurrently.
            let file = match capability.open(&path) {
                Ok(v) => v,
                Err(_) => {
                    scan.stats.errors += 1;
                    continue;
                }
            };
            let mut bytes = vec![];
            if file
                .take(scan.config.max_file_bytes + 1)
                .read_to_end(&mut bytes)
                .is_err()
            {
                scan.stats.errors += 1;
                continue;
            }
            if bytes.len() as u64 > scan.config.max_file_bytes
                || bytes.len() as u64 > scan.config.max_total_bytes.saturating_sub(scan.stats.bytes)
            {
                scan.stats.skipped += 1;
                scan.stats.truncated = true;
                continue;
            }
            scan.stats.files += 1;
            scan.stats.bytes += bytes.len() as u64;
            let relative_path = path
                .strip_prefix(".")
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if scan.config.antivirus {
                scan.av_files.push(relative_path.clone());
            }
            if bytes.contains(&0) || std::str::from_utf8(&bytes).is_err() {
                scan.stats.binaries += 1;
                continue;
            }
            let text = std::str::from_utf8(&bytes).map_err(|_| "Falha ao interpretar texto.")?;
            let ext = extension(&path);
            if scan.config.sast {
                cloud.inspect(&relative_path, text);
            }
            if scan.findings.len() < 5000 {
                let found = rules::analyze_text(
                    &relative_path,
                    &ext,
                    text,
                    scan.config.sast,
                    scan.config.secrets,
                    scan.config.suspicious,
                );
                if found.len() >= 200 {
                    scan.stats.truncated = true;
                }
                scan.findings.extend(found);
                if scan.findings.len() > 5000 {
                    scan.findings.truncate(5000);
                    scan.stats.truncated = true;
                }
            } else {
                scan.stats.truncated = true;
            }
            if scan.config.dependencies {
                match dependencies::analyze_inventory(&relative_path, text) {
                    Ok(found) => {
                        let directory = relative_path
                            .rsplit_once('/')
                            .map(|(directory, _)| directory)
                            .unwrap_or("");
                        for (ecosystem, name) in found.unresolved {
                            if unresolved_dependencies.len() >= 2000 {
                                scan.stats.truncated = true;
                                break;
                            }
                            unresolved_dependencies.insert((
                                directory.to_string(),
                                ecosystem,
                                name,
                            ));
                        }
                        for d in found.dependencies {
                            if d.version_source == "lockfile" {
                                if resolved_dependencies.len() < 2000 {
                                    resolved_dependencies.insert((
                                        directory.to_string(),
                                        d.ecosystem.clone(),
                                        d.name.clone(),
                                    ));
                                } else {
                                    scan.stats.truncated = true;
                                }
                            }
                            let key = (d.ecosystem.clone(), d.name.clone(), d.version.clone());
                            if let Some(index) = seen.get(&key) {
                                if scan.dependencies[*index].version_source == "manifest_pin"
                                    && d.version_source != "manifest_pin"
                                {
                                    scan.dependencies[*index] = d;
                                }
                                continue;
                            }
                            if scan.dependencies.len() >= 2000 {
                                scan.stats.truncated = true;
                                break;
                            }
                            seen.insert(key, scan.dependencies.len());
                            scan.dependencies.push(d);
                        }
                    }
                    Err(_) => {
                        scan.stats.errors += 1;
                        scan.log(
                            "dependencies.parse-error",
                            "Um lockfile não pôde ser interpretado; a cobertura está incompleta.",
                        );
                    }
                }
            }
            if scan.stats.files.is_multiple_of(25) {
                progress(scan);
            }
        }
    }
    let cloud = cloud.finish();
    unresolved_dependencies.retain(|dependency| !resolved_dependencies.contains(dependency));
    let remaining = 5000usize.saturating_sub(scan.findings.len());
    scan.stats.truncated |= cloud.partial || cloud.findings.len() > remaining;
    scan.findings
        .extend(cloud.findings.into_iter().take(remaining));
    let partial = scan.stats.truncated
        || scan.stats.errors > 0
        || scan.stats.skipped > 0
        || scan.stats.binaries > 0;
    for (id, enabled) in [
        ("source.sast", scan.config.sast),
        ("source.secrets", scan.config.secrets),
        ("source.suspicious", scan.config.suspicious),
        ("source.dependencies", scan.config.dependencies),
    ] {
        let dependency_partial = id == "source.dependencies" && !unresolved_dependencies.is_empty();
        let detail = if !enabled {
            "Desabilitado pelo usuário.".into()
        } else if id == "source.dependencies" {
            format!("Inventário estático de versões declaradas/resolvidas. {} declaração(ões)/origem(ns) sem resolução compatível no mesmo diretório. Ranges, origens privadas, includes e formatos não suportados não comprovam ausência de vulnerabilidades.", unresolved_dependencies.len())
        } else {
            "Cobertura lexical dos arquivos elegíveis; arquivos ignorados, binários e limites permanecem fora da análise textual.".into()
        };
        scan.module(
            id,
            if !enabled {
                "not_run"
            } else if partial || dependency_partial {
                "partial"
            } else {
                "completed"
            },
            &detail,
        );
    }
    for (id, count) in [
        ("source.supabase", cloud.supabase_files),
        ("source.firebase", cloud.firebase_files),
    ] {
        let status = if !scan.config.sast || count == 0 {
            "not_run"
        } else if partial {
            "partial"
        } else {
            "completed"
        };
        let detail = if !scan.config.sast {
            "Análise estática desabilitada.".into()
        } else if count == 0 {
            "Nenhum arquivo de política/migration compatível foi reconhecido; nenhuma configuração remota foi inspecionada.".into()
        } else {
            format!("{count} arquivo(s) de política/migration analisado(s) estaticamente. Nenhum banco, emulador ou dado remoto foi acessado. Estado final remoto, regras dinâmicas e isolamento real exigem validação autorizada separada.")
        };
        scan.module(id, status, &detail);
    }
    scan.log(
        "source.inventory",
        &format!(
            "{} arquivos lidos; {} bytes; {} ignorados; {} erros; {} versões resolvidas.",
            scan.stats.files,
            scan.stats.bytes,
            scan.stats.skipped,
            scan.stats.errors,
            scan.dependencies.len()
        ),
    );
    progress(scan);
    Ok(())
}

pub fn finish(scan: &mut SourceScan, result: Result<(), String>) {
    match result {
        Ok(()) => scan.status = ScanStatus::Completed,
        Err(e) if e == "cancelled" => scan.status = ScanStatus::Cancelled,
        Err(e) => {
            scan.status = ScanStatus::Failed;
            scan.error = Some(e);
        }
    }
    scan.finished_at = Some(chrono::Utc::now().to_rfc3339());
    for id in [
        "source.sast",
        "source.secrets",
        "source.suspicious",
        "source.dependencies",
        "source.supabase",
        "source.firebase",
        "dependencies.osv",
        "malware.clamav",
    ] {
        if !scan.modules.iter().any(|m| m.id == id) {
            let enabled = match id {
                "source.sast" | "source.supabase" | "source.firebase" => scan.config.sast,
                "source.secrets" => scan.config.secrets,
                "source.suspicious" => scan.config.suspicious,
                "source.dependencies" => scan.config.dependencies,
                "dependencies.osv" => scan.config.osv,
                "malware.clamav" => scan.config.antivirus,
                _ => false,
            };
            let partial = enabled
                && ((id.starts_with("source.") && scan.stats.files > 0)
                    || (id == "dependencies.osv"
                        && scan.findings.iter().any(|f| f.category == "dependency"))
                    || (id == "malware.clamav"
                        && scan.logs.iter().any(|l| l.event == "clamav.start")));
            scan.module(id,if partial{"partial"}else{"not_run"},"Não houve conclusão deste módulo; nenhuma ausência de problemas pode ser inferida.");
        }
    }
    scan.log(
        "source.finished",
        "Execução encerrada. Consulte a cobertura antes de interpretar ausência de achados.",
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let p = std::env::temp_dir().join(format!("qypher-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&p).unwrap();
        p
    }
    #[test]
    fn files_are_read_without_running_install_scripts() {
        let root = fixture();
        fs::write(root.join("app.js"), "eval(atob(input));").unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(root.join("node_modules/ignored.js"), "eval(untrusted);").unwrap();
        let c = SourceConfig {
            authorized: true,
            ..SourceConfig::default()
        };
        let mut s = SourceScan::new("fixture".into(), c);
        inspect(&root, &mut s, &|| false, &|_| {}).unwrap();
        assert_eq!(s.stats.files, 1);
        assert!(s.findings.iter().any(|f| f.category == "suspicious"));
        assert!(s.stats.skipped > 0);
        fs::remove_dir_all(&root).unwrap();
    }
    #[test]
    fn cancellation_and_budget_never_report_full_coverage() {
        let root = fixture();
        fs::write(root.join("a.py"), "os.system(input())").unwrap();
        let c = SourceConfig {
            authorized: true,
            ..SourceConfig::default()
        };
        let mut s = SourceScan::new("fixture".into(), c);
        assert_eq!(
            inspect(&root, &mut s, &|| true, &|_| {}).unwrap_err(),
            "cancelled"
        );
        finish(&mut s, Err("cancelled".into()));
        assert_eq!(s.status, ScanStatus::Cancelled);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn cloud_findings_scope_identity_and_resolved_versions_integrate_with_the_engine() {
        let root = fixture();
        fs::create_dir(root.join("supabase")).unwrap();
        fs::write(
            root.join("supabase/schema.sql"),
            "CREATE TABLE public.messages(id uuid);",
        )
        .unwrap();
        fs::write(
            root.join("package.json"),
            r#"{"dependencies":{"pkg":"1.2.3"}}"#,
        )
        .unwrap();
        fs::write(
            root.join("package-lock.json"),
            r#"{"packages":{"node_modules/pkg":{"version":"1.2.3"}}}"#,
        )
        .unwrap();
        let config = SourceConfig {
            authorized: true,
            ..SourceConfig::default()
        };
        let mut scan = SourceScan::new("fixture".into(), config);
        inspect(&root, &mut scan, &|| false, &|_| {}).unwrap();
        assert_eq!(scan.scope_id, scope_id(&root).unwrap());
        assert!(scan
            .findings
            .iter()
            .any(|finding| finding.rule_id == "supabase.rls-not-observed"));
        assert_eq!(scan.dependencies.len(), 1);
        assert_eq!(scan.dependencies[0].version_source, "lockfile");
        assert_eq!(
            scan.modules
                .iter()
                .find(|module| module.id == "source.supabase")
                .unwrap()
                .status,
            "completed"
        );
        let other = fixture();
        assert_ne!(scan.scope_id, scope_id(&other).unwrap());
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&other).unwrap();
    }

    #[test]
    fn dependency_ranges_require_a_matching_local_lockfile_for_complete_coverage() {
        let root = fixture();
        fs::write(
            root.join("package.json"),
            r#"{"dependencies":{"express":"^4.0.0"}}"#,
        )
        .unwrap();
        let config = SourceConfig {
            authorized: true,
            ..SourceConfig::default()
        };
        let mut scan = SourceScan::new("fixture".into(), config.clone());
        inspect(&root, &mut scan, &|| false, &|_| {}).unwrap();
        assert_eq!(
            scan.modules
                .iter()
                .find(|module| module.id == "source.dependencies")
                .unwrap()
                .status,
            "partial"
        );
        fs::write(
            root.join("package-lock.json"),
            r#"{"packages":{"node_modules/express":{"version":"4.21.0"}}}"#,
        )
        .unwrap();
        let mut scan = SourceScan::new("fixture".into(), config);
        inspect(&root, &mut scan, &|| false, &|_| {}).unwrap();
        assert_eq!(
            scan.modules
                .iter()
                .find(|module| module.id == "source.dependencies")
                .unwrap()
                .status,
            "completed"
        );
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn directory_queue_is_bounded_even_without_readable_files() {
        let root = fixture();
        let config = SourceConfig {
            authorized: true,
            max_files: 1,
            ..SourceConfig::default()
        };
        let budget = config.max_files * 4 + 1024;
        for index in 0..budget + 2 {
            fs::create_dir(root.join(format!("dir-{index}"))).unwrap();
        }
        let mut scan = SourceScan::new("fixture".into(), config);
        inspect(&root, &mut scan, &|| false, &|_| {}).unwrap();
        assert_eq!(scan.stats.files, 0);
        assert_eq!(scan.stats.directories, budget);
        assert!(scan.stats.truncated);
        assert!(scan
            .modules
            .iter()
            .filter(|module| !matches!(module.id.as_str(), "source.supabase" | "source.firebase"))
            .all(|module| module.status == "partial"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn binary_files_do_not_imply_completed_text_analysis() {
        let root = fixture();
        fs::write(root.join("binary.bin"), b"\0binary").unwrap();
        let config = SourceConfig {
            authorized: true,
            ..SourceConfig::default()
        };
        let mut scan = SourceScan::new("fixture".into(), config);
        inspect(&root, &mut scan, &|| false, &|_| {}).unwrap();
        assert_eq!(scan.stats.binaries, 1);
        assert!(scan
            .modules
            .iter()
            .filter(|module| !matches!(module.id.as_str(), "source.supabase" | "source.firebase"))
            .all(|module| module.status == "partial"));
        fs::remove_dir_all(&root).unwrap();
    }
}
