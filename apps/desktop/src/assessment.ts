import type { Finding, Scan } from './types';

export type FindingKind = 'confirmed' | 'possible' | 'configuration';

export function findingKind(finding: Finding): FindingKind {
  if (finding.classification === 'configuration') return 'configuration';
  if (
    finding.classification === 'vulnerability' &&
    ['confirmed', 'validated'].includes(finding.confidence)
  )
    return 'confirmed';
  return 'possible';
}

export const kindLabel: Record<FindingKind, string> = {
  confirmed: 'Vulnerabilidade confirmada',
  possible: 'Possível vulnerabilidade ou exposição',
  configuration: 'Recomendação de configuração',
};

export function confidenceLabel(value: string): string {
  return (
    (
      {
        confirmed: 'Evidência confirmada',
        validated: 'Validação reproduzida',
        observed: 'Observação direta',
        heuristic: 'Heurística: revisão necessária',
        version_match: 'Correspondência de versão',
        scanner_alert: 'Alerta do scanner',
      } as Record<string, string>
    )[value] ?? value
  );
}

export function scanCoverage(scan: Scan) {
  const executed = scan.checks.filter(
    (check) => check.status === 'passed' || check.status === 'finding',
  ).length;
  const notRun = scan.checks.filter((check) => check.status === 'not_run').length;
  const errors = scan.checks.filter((check) => check.status === 'error').length;
  return {
    executed,
    notRun,
    errors,
    partial: scan.status !== 'completed' || notRun > 0 || errors > 0 || executed === 0,
  };
}

export function usableScore(scan: Scan): number | null {
  const score = scan.risk?.score;
  if (
    scan.status !== 'completed' ||
    scanCoverage(scan).executed === 0 ||
    typeof score !== 'number' ||
    !Number.isFinite(score)
  )
    return null;
  return Math.max(0, Math.min(100, score));
}

export function elapsedSeconds(scan: Scan): number | null {
  if (!scan.finishedAt) return null;
  const milliseconds = Date.parse(scan.finishedAt) - Date.parse(scan.startedAt);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds / 1000 : null;
}
