//! Headless local pre-deploy check using the same scanner as the desktop.
use scanner_source::{advisories, engine, predeploy, report, SourceConfig, SourceScan};
use std::{
    collections::HashSet,
    io::{Read, Write},
    path::PathBuf,
};
use tokio_util::sync::CancellationToken;

const HELP: &str = "Qypher pre-deploy security check\n\nUsage: qypher-check --path DIRECTORY --authorized [--allow-osv] [--baseline FILE] [--output FILE] [--sarif FILE]\n\nRead-only static analysis. Never runs repository code, installs packages or changes project files.\n--authorized confirms permission for this local directory.\n--allow-osv explicitly allows sending package names/ecosystems/versions to OSV (no source code).\n--baseline reads a previous native JSON snapshot from the same local directory identity.\n--output saves native JSON for local comparison; --sarif saves a redacted SARIF report.\nOutput files must not already exist. Native JSON includes relative paths and the repository name.\nExit codes: 0=no blockers observed in completed coverage, 2=high-severity blockers, 3=review/incomplete coverage, 1=error.\nNo result guarantees security or publishes/deploys the project. Ctrl+C stops the process; no approval is printed before completion.";

#[derive(Default)]
struct Args {
    path: Option<PathBuf>,
    authorized: bool,
    osv: bool,
    baseline: Option<PathBuf>,
    output: Option<PathBuf>,
    sarif: Option<PathBuf>,
}

fn parse(args: impl Iterator<Item = String>) -> Result<Option<Args>, String> {
    let mut args = args.peekable();
    let mut parsed = Args::default();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--help" | "-h" => return Ok(None),
            "--authorized" => parsed.authorized = true,
            "--allow-osv" => parsed.osv = true,
            "--path" | "--baseline" | "--output" | "--sarif" => {
                let value = args
                    .next()
                    .filter(|value| !value.starts_with("--"))
                    .ok_or("Missing file/directory argument.")?;
                let destination = match flag.as_str() {
                    "--path" => &mut parsed.path,
                    "--baseline" => &mut parsed.baseline,
                    "--output" => &mut parsed.output,
                    _ => &mut parsed.sarif,
                };
                if destination.is_some() {
                    return Err("Repeated file/directory option.".into());
                }
                *destination = Some(PathBuf::from(value));
            }
            _ => return Err("Unknown option. Use --help.".into()),
        }
    }
    if parsed.path.is_none() || !parsed.authorized {
        return Err("A local --path and explicit --authorized are required.".into());
    }
    Ok(Some(parsed))
}

fn save(path: &PathBuf, data: &[u8]) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| {
            "Cannot create report; choose a writable destination that does not already exist."
                .to_string()
        })?;
    file.write_all(data)
        .map_err(|_| "Failed to write report.".into())
}

fn regular_file(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.is_file() && metadata.file_attributes() & 0x400 == 0
    }
    #[cfg(not(windows))]
    {
        metadata.is_file() && !metadata.file_type().is_symlink()
    }
}

fn read_baseline(path: &PathBuf) -> Result<SourceScan, String> {
    let metadata =
        std::fs::symlink_metadata(path).map_err(|_| "Cannot inspect baseline.".to_string())?;
    if !regular_file(&metadata) || metadata.len() > 16 * 1024 * 1024 {
        return Err(
            "Baseline must be a regular file of at most 16 MiB, without links or reparse points."
                .into(),
        );
    }
    let file = std::fs::File::open(path).map_err(|_| "Cannot open baseline.".to_string())?;
    if !regular_file(
        &file
            .metadata()
            .map_err(|_| "Cannot inspect opened baseline.".to_string())?,
    ) {
        return Err("Baseline is not a regular file.".into());
    }
    let mut bytes = Vec::new();
    file.take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read baseline.".to_string())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("Baseline exceeds 16 MiB.".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid native source baseline.".to_string())
}

async fn execute(args: Args) -> Result<i32, String> {
    let root = engine::validate_root(args.path.as_deref().ok_or("Missing directory.")?)?;
    let config = SourceConfig {
        authorized: args.authorized,
        osv: args.osv,
        antivirus: false,
        ..SourceConfig::default()
    };
    let mut scan = SourceScan::new(
        root.file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "repository".into()),
        config,
    );
    let mut outcome = engine::inspect(&root, &mut scan, &|| false, &|_| {});
    if outcome.is_ok() {
        outcome = advisories::run(&mut scan, &CancellationToken::new()).await;
    }
    engine::finish(&mut scan, outcome);
    let baseline = if let Some(path) = args.baseline {
        Some(read_baseline(&path)?)
    } else {
        None
    };
    let gate = predeploy::evaluate(&scan, baseline.as_ref(), &HashSet::new())?;
    if let Some(path) = args.output {
        save(
            &path,
            &report::render(&scan, report::SourceReportFormat::Json, false)?,
        )?;
    }
    if let Some(path) = args.sarif {
        save(
            &path,
            &report::render(&scan, report::SourceReportFormat::Sarif, true)?,
        )?;
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&gate).map_err(|_| "Cannot serialize gate.".to_string())?
    );
    Ok(match gate.status {
        predeploy::GateStatus::NoBlockersObserved => 0,
        predeploy::GateStatus::Blocked => 2,
        predeploy::GateStatus::ReviewRequired => 3,
    })
}

#[tokio::main]
async fn main() {
    let code = match parse(std::env::args().skip(1)) {
        Ok(None) => {
            println!("{HELP}");
            0
        }
        Ok(Some(args)) => match execute(args).await {
            Ok(code) => code,
            Err(error) => {
                eprintln!("Qypher: {error}");
                1
            }
        },
        Err(error) => {
            eprintln!("Qypher: {error}");
            1
        }
    };
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_authorization_and_rejects_ambiguous_options() {
        let parse_args = |values: &[&str]| parse(values.iter().map(|value| value.to_string()));
        assert!(parse_args(&["--path", "."]).is_err());
        assert!(parse_args(&["--authorized", "--path", ".", "--path", "."]).is_err());
        assert!(parse_args(&["--authorized", "--path", ".", "--execute"]).is_err());
        assert!(parse_args(&["--authorized", "--path", "."])
            .unwrap()
            .is_some());
    }
    #[test]
    fn report_writer_never_overwrites_an_existing_file() {
        let path = std::env::temp_dir().join(format!("qypher-cli-report-{}", uuid::Uuid::new_v4()));
        save(&path, b"first").unwrap();
        assert!(save(&path, b"second").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"first");
        std::fs::remove_file(path).unwrap();
    }
}
