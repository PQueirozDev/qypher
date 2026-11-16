export type Severity = 'high' | 'medium' | 'low' | 'info' | 'unrated';
export type ScanStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface Project {
  id: string;
  name: string;
  url: string;
  createdAt: string;
}
export interface ScanConfig {
  projectId: string;
  url: string;
  authorized: boolean;
  allowPrivate: boolean;
  pathPrefix: string;
  maxRequests: number;
  maxRedirects: number;
  timeoutSeconds: number;
  /** Busca por arquivos expostos e análise do HTML. */
  discovery?: boolean;
  /** Testes ativos não destrutivos (CORS, métodos HTTP). */
  activeChecks?: boolean;
}
export interface Finding {
  id: string;
  detectorId: string;
  detectorVersion: string;
  title: string;
  category: string;
  severity: Severity;
  confidence: string;
  classification: string;
  location: string;
  evidence: string;
  impact: string;
  recommendation: string;
  references: string[];
  description?: string;
  verification?: string;
  cwe?: string;
  owasp?: string;
  sample?: string | null;
}
export interface HttpObservation {
  url: string;
  status: number;
  elapsedMs: number;
  headers: Record<string, string>;
  cookies: {
    name: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: boolean;
    prefixViolation?: boolean;
    sameSiteNone?: boolean;
  }[];
  tlsProbe?: { tls10: boolean | null; tls11: boolean | null; weakCiphers: boolean | null } | null;
  tls: {
    certificateSha256: string;
    expiresAt: string;
    daysRemaining: number;
    issuer: string;
  } | null;
}
export interface CheckResult {
  detectorId: string;
  detectorVersion: string;
  resource: string;
  status: 'passed' | 'finding' | 'not_run' | 'error';
  reason: string;
  findings: Finding[];
}
export interface Scan {
  schemaVersion: number;
  engineVersion: string;
  id: string;
  config: ScanConfig;
  startedAt: string;
  finishedAt: string | null;
  status: ScanStatus;
  requestCount: number;
  observations: HttpObservation[];
  checks: CheckResult[];
  findings: Finding[];
  logs: { at: string; level: 'info' | 'warn' | 'error'; event: string; message: string }[];
  error: string | null;
  risk?: {
    score: number;
    grade: string;
    high: number;
    medium: number;
    low: number;
    info: number;
  } | null;
}
export interface Snapshot {
  projects: Project[];
  scans: Scan[];
}
export interface Comparison {
  new: Finding[];
  persistent: Finding[];
  resolved: Finding[];
  inconclusive: Finding[];
}
export const severityLabel: Record<Severity, string> = {
  unrated: 'Não pontuada',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
  info: 'Informativa',
};
export const statusLabel: Record<ScanStatus, string> = {
  running: 'Em execução',
  completed: 'Concluída',
  failed: 'Falhou / parcial',
  cancelled: 'Cancelada',
  interrupted: 'Interrompida',
};
export function date(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}
export function latestByProject(scans: Scan[]) {
  const seen = new Set<string>();
  return scans.filter((s) => {
    if (seen.has(s.config.projectId)) return false;
    seen.add(s.config.projectId);
    return true;
  });
}
