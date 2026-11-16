use crate::{SourceFinding, SourceScan};
use scanner_core::Severity;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};
use tokio_util::sync::CancellationToken;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AntivirusStatus {
    pub engine: String,
    pub available: bool,
    pub detail: String,
}
fn executable() -> Option<PathBuf> {
    #[cfg(windows)]
    let paths = vec![PathBuf::from(std::env::var_os("ProgramFiles")?).join("ClamAV/clamscan.exe")];
    #[cfg(not(windows))]
    let paths = vec![
        PathBuf::from("/usr/bin/clamscan"),
        PathBuf::from("/usr/local/bin/clamscan"),
        PathBuf::from("/opt/homebrew/bin/clamscan"),
    ];
    paths.into_iter().find(|p| p.is_file())
}
pub fn status() -> AntivirusStatus {
    let available = executable().is_some();
    AntivirusStatus{engine:"ClamAV".into(),available,detail:if available{"Executável encontrado. Base de assinaturas e compatibilidade serão verificadas ao executar."}else{"ClamAV não encontrado em uma localização de instalação suportada. Instale explicitamente com a base atualizada; Qypher não o instala automaticamente."}.into()}
}
async fn bounded_output<R: tokio::io::AsyncRead + Unpin>(reader: R) -> Result<Vec<u8>, String> {
    let mut data = vec![];
    reader
        .take(128 * 1024 + 1)
        .read_to_end(&mut data)
        .await
        .map_err(|_| "Falha ao ler saída do ClamAV")?;
    if data.len() > 128 * 1024 {
        Err("Saída do ClamAV excedeu 128 KiB".into())
    } else {
        Ok(data)
    }
}

fn archive_header(index: usize, size: usize) -> [u8; 512] {
    let mut header = [0u8; 512];
    let name = format!("file-{index:05}.dat");
    header[..name.len()].copy_from_slice(name.as_bytes());
    header[100..108].copy_from_slice(b"0000600\0");
    header[108..116].copy_from_slice(b"0000000\0");
    header[116..124].copy_from_slice(b"0000000\0");
    header[124..136].copy_from_slice(format!("{size:011o}\0").as_bytes());
    header[136..148].copy_from_slice(b"00000000000\0");
    header[148..156].fill(b' ');
    header[156] = b'0';
    header[257..263].copy_from_slice(b"ustar\0");
    header[263..265].copy_from_slice(b"00");
    let sum: u32 = header.iter().map(|b| *b as u32).sum();
    header[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
    header
}
fn bounded_archive(
    root: &Path,
    files: &[String],
    config: &crate::SourceConfig,
    cancel: &CancellationToken,
) -> Result<(Vec<u8>, bool), String> {
    let directory = cap_std::fs::Dir::open_ambient_dir(root, cap_std::ambient_authority())
        .map_err(|_| "ClamAV: escopo local indisponível")?;
    let mut archive = vec![];
    let mut total = 0u64;
    let mut partial = false;
    let clock = std::time::Instant::now();
    for (index, path) in files.iter().take(config.max_files as usize).enumerate() {
        if cancel.is_cancelled() {
            return Err("cancelled".into());
        }
        if clock.elapsed() >= Duration::from_secs(config.timeout_seconds) {
            return Err("ClamAV: timeout na preparação do fluxo".into());
        }
        let file = match directory.open(path) {
            Ok(f) => f,
            Err(_) => {
                partial = true;
                continue;
            }
        };
        let mut data = vec![];
        if file
            .take(config.max_file_bytes + 1)
            .read_to_end(&mut data)
            .is_err()
        {
            partial = true;
            continue;
        }
        if data.len() as u64 > config.max_file_bytes
            || data.len() as u64 > config.max_total_bytes.saturating_sub(total)
        {
            partial = true;
            continue;
        }
        total += data.len() as u64;
        archive.extend_from_slice(&archive_header(index, data.len()));
        archive.extend_from_slice(&data);
        archive.resize(archive.len() + (512 - data.len() % 512) % 512, 0);
    }
    archive.extend_from_slice(&[0u8; 1024]);
    Ok((archive, partial))
}

pub async fn run(
    scan: &mut SourceScan,
    root: &Path,
    cancel: &CancellationToken,
) -> Result<(), String> {
    if !scan.config.antivirus {
        scan.module(
            "malware.clamav",
            "not_run",
            "Antivírus não solicitado; heurísticas de código não substituem um antivírus.",
        );
        return Ok(());
    }
    let Some(exe) = executable() else {
        scan.module(
            "malware.clamav",
            "unavailable",
            "ClamAV não instalado. Nenhuma conclusão antivírus foi produzida.",
        );
        return Ok(());
    };
    if scan.av_files.is_empty() {
        scan.module(
            "malware.clamav",
            "not_run",
            "Nenhum arquivo elegível foi lido; o antivírus não recebeu uma pasta irrestrita.",
        );
        return Ok(());
    }
    let archive_root = root.to_path_buf();
    let phase_started = std::time::Instant::now();
    let files = std::mem::take(&mut scan.av_files);
    let config = scan.config.clone();
    let token = cancel.clone();
    let prepared = tokio::task::spawn_blocking(move || {
        bounded_archive(&archive_root, &files, &config, &token)
    })
    .await
    .map_err(|_| "ClamAV: falha na preparação")?;
    let (archive, partial) = match prepared {
        Ok(v) => v,
        Err(e) if e == "cancelled" => return Err(e),
        Err(_) => {
            scan.module(
                "malware.clamav",
                "error",
                "Não foi possível preparar o fluxo limitado de arquivos. Resultado inconclusivo.",
            );
            return Ok(());
        }
    };
    if cancel.is_cancelled() {
        return Err("cancelled".into());
    }
    let remaining =
        Duration::from_secs(scan.config.timeout_seconds).saturating_sub(phase_started.elapsed());
    if remaining.is_zero() {
        scan.module(
            "malware.clamav",
            "error",
            "Timeout do módulo na preparação. Nenhum processo foi iniciado.",
        );
        return Ok(());
    }
    let archive_size = archive.len() as u64;
    let working_directory = exe
        .parent()
        .ok_or("ClamAV: diretório de instalação inválido")?
        .to_path_buf();
    let mut command = Command::new(exe);
    command
        .args([
            "--infected",
            "--no-summary",
            "--stdout",
            "--follow-dir-symlinks=0",
            "--follow-file-symlinks=0",
            "--max-dir-recursion=32",
            "--max-recursion=16",
            "--alert-exceeds-max=yes",
        ])
        .arg(format!(
            "--max-filesize={}",
            archive_size.max(scan.config.max_file_bytes)
        ))
        .arg(format!(
            "--max-scansize={}",
            archive_size.saturating_add(scan.config.max_total_bytes)
        ))
        .arg(format!(
            "--max-files={}",
            scan.config.max_files.saturating_add(1)
        ))
        .arg("--")
        .arg("-")
        .current_dir(working_directory)
        .env_remove("LD_PRELOAD")
        .env_remove("LD_LIBRARY_PATH")
        .env_remove("DYLD_INSERT_LIBRARIES")
        .env_remove("DYLD_LIBRARY_PATH")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(_) => {
            scan.module(
                "malware.clamav",
                "error",
                "Não foi possível iniciar o executável conhecido do ClamAV.",
            );
            return Ok(());
        }
    };
    let stdout = child.stdout.take().ok_or("ClamAV: stdout ausente")?;
    let stderr = child.stderr.take().ok_or("ClamAV: stderr ausente")?;
    let mut stdin = child.stdin.take().ok_or("ClamAV: stdin ausente")?;
    let feed = tokio::spawn(async move {
        stdin
            .write_all(&archive)
            .await
            .map_err(|_| "ClamAV: fluxo de entrada interrompido")?;
        stdin
            .shutdown()
            .await
            .map_err(|_| "ClamAV: falha no fechamento da entrada")
    });
    let out = tokio::spawn(bounded_output(stdout));
    let err = tokio::spawn(bounded_output(stderr));
    scan.log(
        "clamav.start",
        "ClamAV iniciado com argumentos fixos, sem remoção/quarentena e sem seguir links.",
    );
    let exit = tokio::select! {biased;_=cancel.cancelled()=>{let _=child.kill().await;let _=child.wait().await;out.abort();err.abort();feed.abort();return Err("cancelled".into());},_=tokio::time::sleep(remaining)=>{let _=child.kill().await;let _=child.wait().await;out.abort();err.abort();feed.abort();scan.module("malware.clamav","error","Antivírus interrompido por timeout. Resultado inconclusivo.");return Ok(());},r=child.wait()=>r.map_err(|_|"ClamAV: falha ao aguardar processo")?};
    let fed = feed.await;
    let stdout = out.await.map_err(|_| "ClamAV: falha na captura")?;
    let stderr = err.await.map_err(|_| "ClamAV: falha na captura")?;
    let (Ok(stdout), Ok(stderr)) = (stdout, stderr) else {
        scan.module(
            "malware.clamav",
            "error",
            "Saída incompleta ou acima do limite; resultado inconclusivo.",
        );
        return Ok(());
    };
    match exit.code() {
        Some(0) if stderr.is_empty()&&matches!(fed,Ok(Ok(())))=>scan.module("malware.clamav",if partial{"partial"}else{"completed"},"ClamAV não retornou detecções no fluxo TAR limitado dos arquivos elegíveis. Nomes foram anonimizados; arquivos ignorados, limites e ameaças desconhecidas não são descartados."),
        Some(1)=>{
            let count=String::from_utf8_lossy(&stdout).lines().filter(|l|l.ends_with(" FOUND")).count();
            scan.findings.push(SourceFinding {
                id: format!("{:x}",Sha256::digest(format!("clamav|{}",scan.root_name))),
                rule_id: "malware.clamav-alert".into(),
                detector_version: "1.0.0".into(),
                title: "ClamAV retornou um alerta".into(),
                description: "O processo ClamAV retornou um alerta para o fluxo limitado enviado. Isso exige revisão, sem executar ou remover arquivos.".into(),
                category: "antivirus".into(),
                severity: Severity::High,
                confidence: "scanner_alert".into(),
                path: "[escopo local selecionado]".into(),
                line: 0,
                evidence: format!("Código de saída 1; {count} linha(s) FOUND. Nomes e conteúdo de arquivos não foram copiados. Alertas heurísticos/limites precisam de revisão."),
                impact: "Pode haver conteúdo malicioso ou uma condição heurística. A saída do antivírus deve ser revisada; não foi executado nem removido qualquer arquivo pelo Qypher.".into(),
                recommendation: "Não execute os arquivos suspeitos. Confirme a detecção com base atualizada e revisão em ambiente isolado. Trate eventuais falsos positivos conforme o fornecedor.".into(),
                verification: "Confirme versão e atualização da base do ClamAV, repita a análise isolada e revise alertas de limite ou heurística com o fornecedor.".into(),
                suggested_fix: None,
                reference: "https://docs.clamav.net/manual/Usage/Scanning.html".into(),
            });
            scan.module("malware.clamav","alert","ClamAV retornou um alerta; não há atestado de limpeza. Nenhuma remediação automática foi solicitada.");
        },
        _=>scan.module("malware.clamav","error","ClamAV retornou erro, aviso ou saída não conclusiva. Verifique instalação/base e limites; nenhum resultado limpo foi inferido."),
    }
    Ok(())
}
