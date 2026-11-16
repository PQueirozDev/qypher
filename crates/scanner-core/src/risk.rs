//! Índice de postura de uma auditoria: um resumo transparente dos achados, de 0 a 100.
//!
//! Não é CVSS nem prova de exploração. Serve para comparar execuções do mesmo alvo e
//! priorizar correções. Fórmula: parte de 100 e desconta por detector com achado
//! (cada detector conta uma vez, pela maior severidade): alta 30, média 12, baixa 4,
//! informativa 1. Com qualquer achado de severidade alta o índice não passa de 55.

use crate::{CheckStatus, Finding, Scan, ScanStatus, Severity};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RiskSummary {
    /// 0 (pior) a 100 (nenhum achado na cobertura executada).
    pub score: u8,
    /// A, B, C, D ou F.
    pub grade: String,
    pub high: u32,
    pub medium: u32,
    pub low: u32,
    pub info: u32,
}

fn weight(severity: &Severity) -> u32 {
    match severity {
        Severity::High => 30,
        Severity::Medium => 12,
        Severity::Low => 4,
        Severity::Info => 1,
        Severity::Unrated => 0,
    }
}

pub fn risk(findings: &[Finding]) -> RiskSummary {
    // Um mesmo detector pode disparar em vários saltos de redirecionamento; conta uma vez.
    let mut worst: BTreeMap<&str, &Severity> = BTreeMap::new();
    for f in findings {
        let entry = worst.entry(f.detector_id.as_str()).or_insert(&f.severity);
        if weight(&f.severity) > weight(entry) {
            *entry = &f.severity;
        }
    }
    let mut summary = RiskSummary::default();
    let mut penalty = 0u32;
    for severity in worst.values() {
        penalty += weight(severity);
        match severity {
            Severity::High => summary.high += 1,
            Severity::Medium => summary.medium += 1,
            Severity::Low => summary.low += 1,
            Severity::Info | Severity::Unrated => summary.info += 1,
        }
    }
    let mut score = 100u32.saturating_sub(penalty);
    if summary.high > 0 {
        score = score.min(55);
    }
    summary.score = score as u8;
    summary.grade = match score {
        90..=100 => "A",
        75..=89 => "B",
        60..=74 => "C",
        40..=59 => "D",
        _ => "F",
    }
    .into();
    summary
}

/// A numeric posture requires at least one completed observation. Never grade an empty run.
pub fn risk_for_scan(scan: &Scan) -> Option<RiskSummary> {
    (scan.status == ScanStatus::Completed
        && scan
            .checks
            .iter()
            .any(|check| matches!(check.status, CheckStatus::Passed | CheckStatus::Finding)))
    .then(|| risk(&scan.findings))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finding(id: &str, severity: Severity) -> Finding {
        Finding::at(
            id,
            "https://example.com/",
            "t",
            severity,
            "e",
            "i",
            "r",
            "ref",
        )
    }

    #[test]
    fn clean_scan_is_grade_a() {
        let r = risk(&[]);
        assert_eq!((r.score, r.grade.as_str()), (100, "A"));
    }

    #[test]
    fn one_high_finding_caps_the_score() {
        let r = risk(&[finding("exposure.git-head", Severity::High)]);
        assert_eq!((r.score, r.grade.as_str(), r.high), (55, "D", 1));
    }

    #[test]
    fn repeated_detector_counts_once_by_worst_severity() {
        let r = risk(&[
            finding("headers.csp", Severity::Low),
            finding("headers.csp", Severity::Low),
            finding("headers.csp", Severity::Medium),
        ]);
        assert_eq!((r.score, r.medium, r.low), (88, 1, 0));
    }

    #[test]
    fn many_findings_never_underflow() {
        let all: Vec<_> = (0..20)
            .map(|i| finding(&format!("x.{i}"), Severity::High))
            .collect();
        let r = risk(&all);
        assert_eq!((r.score, r.grade.as_str(), r.high), (0, "F", 20));
    }
}
