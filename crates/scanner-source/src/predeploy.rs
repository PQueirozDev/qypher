//! Conservative local pre-deploy policy. A clean result is limited to the completed coverage.
use crate::{SourceFinding, SourceScan};
use scanner_core::{ScanStatus, Severity};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceComparison {
    pub new: Vec<SourceFinding>,
    pub persistent: Vec<SourceFinding>,
    pub resolved: Vec<SourceFinding>,
    pub inconclusive: Vec<SourceFinding>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GateStatus {
    Blocked,
    ReviewRequired,
    NoBlockersObserved,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredeploySummary {
    pub status: GateStatus,
    pub reason: String,
    pub blockers: usize,
    pub reviewed: usize,
    pub checks_not_completed: Vec<String>,
    pub comparison: Option<SourceComparison>,
}

fn complete(scan: &SourceScan) -> bool {
    scan.status == ScanStatus::Completed
        && !scan.stats.truncated
        && scan.stats.errors == 0
        && scan.stats.skipped == 0
        && scan.stats.binaries == 0
}

fn module_for(category: &str) -> &str {
    match category {
        "secrets" => "source.secrets",
        "suspicious" => "source.suspicious",
        "dependency" => "dependencies.osv",
        "antivirus" => "malware.clamav",
        "supabase" => "source.supabase",
        "firebase" => "source.firebase",
        _ => "source.sast",
    }
}

pub fn compare(before: &SourceScan, after: &SourceScan) -> Result<SourceComparison, String> {
    if before.id == after.id
        || before.scope_id.is_empty()
        || before.scope_id != after.scope_id
        || before.started_at > after.started_at
    {
        return Err("Compare execuções distintas, em ordem cronológica e com a mesma identidade local de escopo. Históricos antigos sem identidade não são comparáveis.".into());
    }
    let old: HashSet<_> = before.findings.iter().map(|finding| &finding.id).collect();
    let current: HashSet<_> = after.findings.iter().map(|finding| &finding.id).collect();
    let mut shifted = HashMap::new();
    let mut paired = HashMap::new();
    for finding in &before.findings {
        if !current.contains(&finding.id) {
            *shifted
                .entry((&finding.rule_id, &finding.detector_version, &finding.path))
                .or_insert(0usize) += 1;
        }
    }
    let mut result = SourceComparison {
        new: vec![],
        persistent: vec![],
        resolved: vec![],
        inconclusive: vec![],
    };
    for finding in &after.findings {
        if old.contains(&finding.id) {
            result.persistent.push(finding.clone());
        } else {
            let remaining =
                shifted.get_mut(&(&finding.rule_id, &finding.detector_version, &finding.path));
            if let Some(count) = remaining.filter(|count| **count > 0) {
                *count -= 1;
                *paired
                    .entry((&finding.rule_id, &finding.detector_version, &finding.path))
                    .or_insert(0usize) += 1;
                result.persistent.push(finding.clone());
            } else {
                result.new.push(finding.clone());
            }
        }
    }
    for finding in &before.findings {
        if current.contains(&finding.id) {
            continue;
        }
        if let Some(count) = paired
            .get_mut(&(&finding.rule_id, &finding.detector_version, &finding.path))
            .filter(|count| **count > 0)
        {
            *count -= 1;
            continue;
        }
        let module = module_for(&finding.category);
        // Rule/path families cannot prove which occurrence disappeared after a line shift.
        // Keep old occurrences inconclusive while the same rule is still present in the file.
        if after
            .findings
            .iter()
            .any(|current| current.rule_id == finding.rule_id && current.path == finding.path)
        {
            result.inconclusive.push(finding.clone());
            continue;
        }
        let same_detector = before
            .modules
            .iter()
            .find(|m| m.id == module)
            .zip(after.modules.iter().find(|m| m.id == module))
            .is_some_and(|(old, new)| old.version == new.version && new.status == "completed");
        if complete(after) && same_detector {
            result.resolved.push(finding.clone());
        } else {
            result.inconclusive.push(finding.clone());
        }
    }
    Ok(result)
}

pub fn evaluate(
    scan: &SourceScan,
    baseline: Option<&SourceScan>,
    dismissed: &HashSet<String>,
) -> Result<PredeploySummary, String> {
    if scan.status == ScanStatus::Running {
        return Err("Finalize a análise antes da verificação pré-deploy.".into());
    }
    let comparison = baseline.map(|before| compare(before, scan)).transpose()?;
    let blockers = scan
        .findings
        .iter()
        .filter(|finding| !dismissed.contains(&finding.id) && finding.severity == Severity::High)
        .count();
    let reviewed = scan
        .findings
        .iter()
        .filter(|finding| dismissed.contains(&finding.id))
        .count();
    let mut incomplete: Vec<String> = scan
        .modules
        .iter()
        .filter(|module| matches!(module.status.as_str(), "partial" | "error" | "unavailable"))
        .map(|module| module.id.clone())
        .collect();
    for required in [
        "source.sast",
        "source.secrets",
        "source.suspicious",
        "source.dependencies",
    ] {
        if !scan
            .modules
            .iter()
            .any(|module| module.id == required && module.status == "completed")
        {
            incomplete.push(required.into());
        }
    }
    if !scan.dependencies.is_empty()
        && !scan
            .modules
            .iter()
            .any(|module| module.id == "dependencies.osv" && module.status == "completed")
    {
        incomplete.push("dependencies.osv".into());
    }
    if !complete(scan) {
        incomplete.push("source.coverage".into());
    }
    if scan.scope_id.is_empty() {
        incomplete.push("source.identity".into());
    }
    incomplete.sort();
    incomplete.dedup();
    let (status, reason) = if blockers > 0 {
        (GateStatus::Blocked, "Há achados de alta severidade pendentes de revisão ou correção. A política local bloqueou a verificação pré-deploy.")
    } else if !incomplete.is_empty()
        || scan
            .findings
            .iter()
            .any(|finding| !dismissed.contains(&finding.id))
    {
        (GateStatus::ReviewRequired, "Há achados a revisar ou verificações importantes incompletas. Não foi emitida aprovação de segurança.")
    } else {
        (GateStatus::NoBlockersObserved, "Nenhum bloqueio foi observado na cobertura executada. Este resultado não garante segurança nem autoriza publicação automaticamente.")
    };
    Ok(PredeploySummary {
        status,
        reason: reason.into(),
        blockers,
        reviewed,
        checks_not_completed: incomplete,
        comparison,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{rules, SourceConfig};
    fn scan() -> SourceScan {
        let mut scan = SourceScan::new("fixture".into(), SourceConfig::default());
        scan.scope_id = "scope-a".into();
        scan.status = ScanStatus::Completed;
        for module in [
            "source.sast",
            "source.secrets",
            "source.suspicious",
            "source.dependencies",
        ] {
            scan.module(module, "completed", "fixture");
        }
        scan
    }
    #[test]
    fn missing_coverage_is_never_an_approval() {
        let mut scan = scan();
        assert_eq!(
            evaluate(&scan, None, &HashSet::new()).unwrap().status,
            GateStatus::NoBlockersObserved
        );
        scan.stats.truncated = true;
        assert_eq!(
            evaluate(&scan, None, &HashSet::new()).unwrap().status,
            GateStatus::ReviewRequired
        );
        scan.status = ScanStatus::Cancelled;
        assert_eq!(
            evaluate(&scan, None, &HashSet::new()).unwrap().status,
            GateStatus::ReviewRequired
        );
        scan.status = ScanStatus::Running;
        assert!(evaluate(&scan, None, &HashSet::new()).is_err());
    }
    #[test]
    fn reviewed_findings_are_retained_but_not_counted_as_blockers() {
        let mut scan = scan();
        scan.findings =
            rules::analyze_text("test.py", "py", "pickle.loads(data)", true, false, false);
        assert_eq!(
            evaluate(&scan, None, &HashSet::new()).unwrap().status,
            GateStatus::Blocked
        );
        let dismissed = scan
            .findings
            .iter()
            .map(|finding| finding.id.clone())
            .collect();
        let summary = evaluate(&scan, None, &dismissed).unwrap();
        assert_eq!(summary.blockers, 0);
        assert_eq!(summary.reviewed, 1);
        assert_eq!(scan.findings.len(), 1);
    }
    #[test]
    fn scopes_versions_and_partial_results_prevent_false_resolution() {
        let mut before = scan();
        before.started_at = "2026-01-01T00:00:00Z".into();
        before.findings = rules::analyze_text("a.js", "js", "eval(input)", true, false, false);
        let mut after = scan();
        after.started_at = "2026-01-02T00:00:00Z".into();
        assert_eq!(compare(&before, &after).unwrap().resolved.len(), 1);
        after.stats.truncated = true;
        assert_eq!(compare(&before, &after).unwrap().inconclusive.len(), 1);
        after.scope_id = "different-folder-same-name".into();
        assert!(compare(&before, &after).is_err());
        after.scope_id.clear();
        assert!(compare(&before, &after).is_err());
    }

    #[test]
    fn moving_a_finding_to_another_line_is_not_a_new_problem_or_a_resolution() {
        let mut before = scan();
        before.started_at = "2026-01-01T00:00:00Z".into();
        before.findings = rules::analyze_text("a.js", "js", "eval(input)", true, false, false);
        let mut after = scan();
        after.started_at = "2026-01-02T00:00:00Z".into();
        after.findings =
            rules::analyze_text("a.js", "js", "// moved\neval(input)", true, false, false);
        let comparison = compare(&before, &after).unwrap();
        assert!(comparison.new.is_empty());
        assert!(comparison.resolved.is_empty());
        assert_eq!(comparison.persistent.len(), 1);
    }
}
