import type { ScanStatus, Severity } from './types';
export type SourceReportFormat = 'json' | 'sarif';
export interface SourceConfig {
  authorized: boolean;
  sast: boolean;
  secrets: boolean;
  suspicious: boolean;
  dependencies: boolean;
  osv: boolean;
  antivirus: boolean;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  timeoutSeconds: number;
}
export interface SourceTarget {
  token: string;
  name: string;
  path: string;
}
export interface SourceFinding {
  description?: string;
  verification?: string;
  suggestedFix?: string | null;
  id: string;
  ruleId: string;
  detectorVersion: string;
  title: string;
  category: string;
  severity: Severity;
  confidence: string;
  path: string;
  line: number;
  evidence: string;
  impact: string;
  recommendation: string;
  reference: string;
}
export interface SourceScan {
  scopeId?: string;
  schemaVersion: number;
  id: string;
  rootName: string;
  startedAt: string;
  finishedAt: string | null;
  status: ScanStatus;
  config: SourceConfig;
  stats: {
    files: number;
    bytes: number;
    skipped: number;
    errors: number;
    binaries: number;
    directories: number;
    truncated: boolean;
  };
  findings: SourceFinding[];
  dependencies: {
    ecosystem: string;
    name: string;
    version: string;
    path: string;
    versionSource?: string;
  }[];
  modules: { id: string; version: string; status: string; detail: string }[];
  logs: { at: string; level: 'info' | 'warn' | 'error'; event: string; message: string }[];
  error: string | null;
}
export interface SourceReview {
  scanId: string;
  findingId: string;
  disposition: 'false_positive';
  reviewedAt: string;
}
export interface PredeploySummary {
  status: 'blocked' | 'review_required' | 'no_blockers_observed';
  reason: string;
  blockers: number;
  reviewed: number;
  checksNotCompleted: string[];
  comparison: {
    new: SourceFinding[];
    persistent: SourceFinding[];
    resolved: SourceFinding[];
    inconclusive: SourceFinding[];
  } | null;
}
export interface AntivirusStatus {
  engine: string;
  available: boolean;
  detail: string;
}
export const defaultSourceConfig: SourceConfig = {
  authorized: false,
  sast: true,
  secrets: true,
  suspicious: true,
  dependencies: true,
  osv: false,
  antivirus: false,
  maxFiles: 3000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  timeoutSeconds: 90,
};
