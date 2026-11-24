import { invoke, native } from './bridge';
import type { LabRequest, LabRun } from './labTypes';
import type { SourceReview, PredeploySummary } from './sourceTypes';
import type { Comparison, Project, ScanConfig, Snapshot } from './types';
import type {
  SourceConfig,
  SourceTarget,
  SourceScan,
  AntivirusStatus,
  SourceReportFormat,
} from './sourceTypes';
export { native } from './bridge';
export interface BrowserIntegrationStatus {
  enabled: boolean;
  browsers: string[];
  chromeExtensionId: string;
}
export function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!native)
    return Promise.reject(
      new Error('Abra o aplicativo desktop para acessar o motor Rust e o banco local.'),
    );
  return invoke<T>(command, args);
}
export const api = {
  takeScanUrl: () => call<string | null>('take_scan_url'),
  browserIntegrationStatus: () => call<BrowserIntegrationStatus>('browser_integration_status'),
  setBrowserIntegration: (enabled: boolean) =>
    call<BrowserIntegrationStatus>('set_browser_integration', { enabled }),
  labHistory: () => call<LabRun[]>('lab_history'),
  startLab: (request: LabRequest) => call<string>('start_lab', { request }),
  deleteLab: (id: string) => call<void>('delete_lab', { id }),
  exportLab: (id: string, redactPaths = true) =>
    call<string | null>('export_lab', { id, redactPaths }),
  sourceReviews: (id: string) => call<SourceReview[]>('source_reviews', { id }),
  reviewSource: (id: string, findingId: string, falsePositive: boolean) =>
    call<void>('review_source', { id, findingId, falsePositive }),
  sourcePredeploy: (id: string, baselineId: string | null) =>
    call<PredeploySummary>('source_predeploy', { id, baselineId }),
  windowAction: (action: 'minimize' | 'maximize' | 'close') =>
    call<void>('window_action', { action }),
  pickRepository: () => call<SourceTarget | null>('pick_repository'),
  sourceHistory: () => call<SourceScan[]>('source_history'),
  startSource: (token: string, config: SourceConfig) =>
    call<string>('start_source', { token, config }),
  deleteSource: (id: string) => call<void>('delete_source', { id }),
  exportSource: (id: string, redactPaths: boolean, format: SourceReportFormat = 'json') =>
    call<string | null>('export_source', { id, redactPaths, format }),
  antivirusStatus: () => call<AntivirusStatus>('antivirus_status'),
  snapshot: () => call<Snapshot>('snapshot'),
  createProject: (name: string, url: string) => call<Project>('create_project', { name, url }),
  startScan: (config: ScanConfig) => call<string>('start_scan', { config }),
  cancelScan: (id: string) => call<void>('cancel_scan', { id }),
  deleteScan: (id: string) => call<void>('delete_scan', { id }),
  purgeSamples: (id: string) => call<number>('purge_samples', { id }),
  deleteProject: (id: string) => call<void>('delete_project', { id }),
  compare: (before: string, after: string) => call<Comparison>('compare_scans', { before, after }),
  export: (id: string, format: string, redact: boolean) =>
    call<string | null>('export_scan', { id, format, redact }),
};
