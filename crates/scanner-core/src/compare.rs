use crate::{CheckStatus, Finding, Scan, ScanStatus};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub new: Vec<Finding>,
    pub persistent: Vec<Finding>,
    pub resolved: Vec<Finding>,
    pub inconclusive: Vec<Finding>,
}

pub fn compare(before: &Scan, after: &Scan) -> Result<Comparison, String> {
    if before.id == after.id
        || before.config.project_id != after.config.project_id
        || before.config.url != after.config.url
        || before.config.path_prefix != after.config.path_prefix
        || before.config.allow_private != after.config.allow_private
        || before.started_at > after.started_at
    {
        return Err("Compare duas execuções distintas, em ordem cronológica, do mesmo projeto, alvo e escopo.".into());
    }
    let old: HashSet<_> = before.findings.iter().map(|f| &f.id).collect();
    let current: HashSet<_> = after.findings.iter().map(|f| &f.id).collect();
    let mut result = Comparison {
        new: vec![],
        persistent: vec![],
        resolved: vec![],
        inconclusive: vec![],
    };
    for f in &after.findings {
        if old.contains(&f.id) {
            result.persistent.push(f.clone());
        } else {
            result.new.push(f.clone());
        }
    }
    for f in &before.findings {
        if !current.contains(&f.id) {
            let covered = after.status == ScanStatus::Completed
                && after.checks.iter().any(|c| {
                    c.detector_id == f.detector_id
                        && c.detector_version == f.detector_version
                        && c.resource == f.location
                        && matches!(c.status, CheckStatus::Passed | CheckStatus::Finding)
                });
            if covered {
                result.resolved.push(f.clone());
            } else {
                result.inconclusive.push(f.clone());
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CheckResult, Finding, HttpObservation, ScanConfig, Severity};
    use std::collections::BTreeMap;
    fn pair() -> (Scan, Scan) {
        let mut before = Scan::new(ScanConfig {
            project_id: "p".into(),
            url: "https://example.com/".into(),
            authorized: true,
            allow_private: false,
            path_prefix: "/".into(),
            max_requests: 3,
            max_redirects: 2,
            timeout_seconds: 5,
            discovery: false,
            active_checks: false,
        });
        before.started_at = "2026-01-01T00:00:00Z".into();
        before.status = ScanStatus::Completed;
        let o = HttpObservation {
            url: before.config.url.clone(),
            status: 200,
            elapsed_ms: 1,
            headers: BTreeMap::new(),
            cookies: vec![],
            tls: None,
            tls_probe: None,
        };
        before.findings.push(Finding::new(
            "headers.csp",
            &o,
            "CSP",
            Severity::Low,
            "missing",
            "context",
            "configure",
            "OWASP",
        ));
        let mut after = Scan::new(before.config.clone());
        after.started_at = "2026-01-02T00:00:00Z".into();
        after.status = ScanStatus::Completed;
        after.checks.push(CheckResult {
            detector_id: "headers.csp".into(),
            detector_version: "1.0.0".into(),
            resource: o.url,
            status: CheckStatus::Passed,
            reason: "covered".into(),
            findings: vec![],
        });
        (before, after)
    }
    #[test]
    fn successful_same_resource_coverage_allows_resolution() {
        let (before, after) = pair();
        let result = compare(&before, &after).unwrap();
        assert_eq!(result.resolved.len(), 1);
        assert!(result.inconclusive.is_empty());
    }
    #[test]
    fn failed_cancelled_and_unexecuted_never_mean_resolved() {
        for status in [
            ScanStatus::Failed,
            ScanStatus::Cancelled,
            ScanStatus::Interrupted,
        ] {
            let (before, mut after) = pair();
            after.status = status;
            let result = compare(&before, &after).unwrap();
            assert!(result.resolved.is_empty());
            assert_eq!(result.inconclusive.len(), 1);
        }
        for status in [CheckStatus::NotRun, CheckStatus::Error] {
            let (before, mut after) = pair();
            after.checks[0].status = status;
            assert_eq!(compare(&before, &after).unwrap().inconclusive.len(), 1);
        }
    }
    #[test]
    fn version_or_resource_changes_are_inconclusive() {
        let (before, mut after) = pair();
        after.checks[0].detector_version = "2.0.0".into();
        assert_eq!(compare(&before, &after).unwrap().inconclusive.len(), 1);
        after.checks[0].detector_version = "1.0.0".into();
        after.checks[0].resource = "https://example.com/other".into();
        assert_eq!(compare(&before, &after).unwrap().inconclusive.len(), 1);
        after.checks.clear();
        assert_eq!(compare(&before, &after).unwrap().inconclusive.len(), 1);
    }
    #[test]
    fn stable_ids_correlate_and_cross_scope_is_rejected() {
        let (before, mut after) = pair();
        after.findings = before.findings.clone();
        after.findings[0].evidence = "changed description".into();
        assert_eq!(compare(&before, &after).unwrap().persistent.len(), 1);
        after.config.path_prefix = "/other".into();
        assert!(compare(&before, &after).is_err());
        assert!(compare(&before, &before).is_err());
    }
}
