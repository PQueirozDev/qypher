use crate::{SourceFinding, SourceScan};
use scanner_core::{address_allowed, Severity};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    net::SocketAddr,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

fn checked_results(
    value: &serde_json::Value,
    expected: usize,
) -> Result<&[serde_json::Value], String> {
    let results = value
        .get("results")
        .and_then(|value| value.as_array())
        .ok_or("OSV: formato de resposta desconhecido")?;
    if results.len() != expected {
        return Err("OSV: resultado não corresponde ao lote enviado.".into());
    }
    for result in results {
        if !result.is_object()
            || result.get("vulns").is_some_and(|value| !value.is_array())
            || result
                .get("next_page_token")
                .is_some_and(|value| !value.is_string())
            || result
                .get("vulns")
                .and_then(|value| value.as_array())
                .is_some_and(|vulns| vulns.iter().any(|vuln| !vuln.is_object()))
        {
            return Err("OSV: estrutura incompleta ou inesperada; nenhum resultado limpo pode ser inferido.".into());
        }
    }
    Ok(results)
}

async fn query(scan: &mut SourceScan, cancel: &CancellationToken) -> Result<bool, String> {
    let safe: Vec<_> = scan
        .dependencies
        .iter()
        .filter(|dependency| {
            ![
                dependency.name.as_str(),
                dependency.version.as_str(),
                dependency.ecosystem.as_str(),
            ]
            .iter()
            .any(|value| crate::dependencies::metadata_has_credential(value))
        })
        .take(500)
        .cloned()
        .collect();
    let mut partial = scan.dependencies.len() > safe.len();
    if safe.is_empty() {
        return Ok(partial);
    }
    let addresses: Vec<SocketAddr> = tokio::select! {biased;_=cancel.cancelled()=>return Err("cancelled".into()),r=tokio::time::timeout(Duration::from_secs(5),tokio::net::lookup_host(("api.osv.dev",443)))=>r.map_err(|_|"OSV: timeout DNS")?.map_err(|_|"OSV: falha DNS")?.collect()};
    if addresses.is_empty()
        || addresses.len() > 64
        || addresses.iter().any(|a| !address_allowed(a.ip(), false))
    {
        return Err("OSV: endereço de serviço recusado pela política.".into());
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs("api.osv.dev", &addresses)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .user_agent(concat!("Qypher/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "OSV: cliente indisponível")?;
    let dependencies = safe;
    let start = Instant::now();
    for chunk in dependencies.chunks(100) {
        if start.elapsed() >= Duration::from_secs(scan.config.timeout_seconds) {
            return Err("OSV: orçamento de tempo esgotado.".into());
        }
        let body = json!({"queries":chunk.iter().map(|d|json!({"package":{"name":d.name,"ecosystem":d.ecosystem},"version":d.version})).collect::<Vec<_>>()});
        let mut response = tokio::select! {biased;_=cancel.cancelled()=>return Err("cancelled".into()),r=client.post("https://api.osv.dev/v1/querybatch").json(&body).send()=>r.map_err(|_|"OSV: falha de conexão ou timeout")?};
        if !response.status().is_success() {
            return Err("OSV: serviço retornou erro. Nenhuma ausência de vulnerabilidade pode ser inferida.".into());
        }
        let mut data = vec![];
        loop {
            let next = tokio::select! {biased;_=cancel.cancelled()=>return Err("cancelled".into()),r=response.chunk()=>r.map_err(|_|"OSV: resposta incompleta")?};
            let Some(bytes) = next else { break };
            if data.len() + bytes.len() > 4 * 1024 * 1024 {
                return Err("OSV: resposta acima do limite de 4 MiB.".into());
            }
            data.extend_from_slice(&bytes);
        }
        let value: serde_json::Value =
            serde_json::from_slice(&data).map_err(|_| "OSV: JSON inválido")?;
        let results = checked_results(&value, chunk.len())?;
        for (dependency, result) in chunk.iter().zip(results) {
            if result
                .get("next_page_token")
                .and_then(|v| v.as_str())
                .is_some_and(|v| !v.is_empty())
            {
                partial = true;
            }
            if let Some(vulns) = result.get("vulns").and_then(|v| v.as_array()) {
                for vuln in vulns.iter().take(50) {
                    if scan.findings.len() >= 5000 {
                        partial = true;
                        break;
                    }
                    let Some(id) = vuln.get("id").and_then(|v| v.as_str()).filter(|s| {
                        s.len() <= 120
                            && s.chars()
                                .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
                    }) else {
                        partial = true;
                        continue;
                    };
                    scan.findings.push(SourceFinding {
                        id: format!("{:x}",Sha256::digest(format!("osv|{}|{}|{}|{}",dependency.ecosystem,dependency.name,dependency.version,id))),
                        rule_id: "dependencies.osv".into(),
                        detector_version: "1.0.0".into(),
                        title: format!("{}: {} {}",id,dependency.name,dependency.version),
                        description: "A base OSV associou um advisory à versão informada pelo arquivo de dependências. A aplicação pode ou não alcançar o código afetado.".into(),
                        category: "dependency".into(),
                        severity: Severity::Unrated,
                        confidence: "version_match".into(),
                        path: dependency.path.clone(),
                        line: 0,
                        evidence: format!("OSV associou {id} à versão declarada/resolvida {} de {} ({}). Origem: {}. Sem pontuação CVSS atribuída.",dependency.version,dependency.name,dependency.ecosystem,dependency.version_source),
                        impact: "A versão inventariada corresponde a um advisory. O impacto e a possibilidade de exploração dependem do uso e devem ser revisados no advisory original.".into(),
                        recommendation: "Consulte o advisory, confirme a versão afetada e atualize para uma versão corrigida compatível. Refaça os testes da aplicação.".into(),
                        verification: "Confira no advisory original a faixa afetada e a versão corrigida, atualize o lockfile após revisão, execute os testes da aplicação e consulte o OSV novamente.".into(),
                        suggested_fix: None,
                        reference: format!("https://osv.dev/vulnerability/{id}"),
                    });
                }
                if vulns.len() > 50 {
                    partial = true;
                }
            }
        }
    }
    Ok(partial)
}

pub async fn run(scan: &mut SourceScan, cancel: &CancellationToken) -> Result<(), String> {
    if !scan.config.osv {
        scan.module(
            "dependencies.osv",
            "not_run",
            "Consulta externa desabilitada. Nenhum nome de pacote foi enviado.",
        );
        return Ok(());
    }
    if scan.dependencies.is_empty() {
        scan.module(
            "dependencies.osv",
            "not_run",
            "Nenhuma versão resolvida suportada foi inventariada.",
        );
        return Ok(());
    }
    scan.log("osv.start","Consultando somente nomes/ecossistemas/versões de até 500 dependências, com consentimento.");
    let outcome = tokio::time::timeout(
        Duration::from_secs(scan.config.timeout_seconds),
        query(scan, cancel),
    )
    .await
    .unwrap_or_else(|_| Err("OSV: timeout do módulo; resultado inconclusivo.".into()));
    match outcome {
        Ok(partial) => {
            scan.module("dependencies.osv",if partial{"partial"}else{"completed"},"Consulta de versões ao OSV. Limite de 500 pacotes, 5 lotes e 50 advisories por pacote; paginação adicional permanece fora da cobertura.");
            Ok(())
        }
        Err(e) if e == "cancelled" => Err(e),
        Err(e) => {
            scan.module("dependencies.osv", "error", &e);
            scan.log("osv.error", &e);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn recognized_credentials_in_legacy_package_metadata_never_trigger_a_lookup() {
        let mut scan = SourceScan::new("fixture".into(), crate::SourceConfig::default());
        scan.dependencies.push(crate::Dependency {
            ecosystem: "npm".into(),
            name: ["ghp_", "abcdefghijklmnopqrstuvwxyz1234567890"].concat(),
            version: "1.2.3".into(),
            path: "package-lock.json".into(),
            version_source: "lockfile".into(),
        });
        assert!(query(&mut scan, &CancellationToken::new()).await.unwrap());
        assert!(scan.findings.is_empty());
    }
    #[test]
    fn malformed_advisory_responses_never_mean_no_vulnerabilities() {
        for input in [
            json!({"results":[null]}),
            json!({"results":[{"vulns":false}]}),
            json!({"results":[{"vulns":["wrong"]}]}),
            json!({"results":[{"next_page_token":3}]}),
            json!({"results":[]}),
        ] {
            assert!(checked_results(&input, 1).is_err());
        }
        assert!(checked_results(&json!({"results":[{}]}), 1).is_ok());
        assert!(checked_results(
            &json!({"results":[{"vulns":[{"id":"GHSA-test"}],"next_page_token":"next"}]}),
            1
        )
        .is_ok());
    }
}
