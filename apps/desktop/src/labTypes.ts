import type { ScanStatus } from './types';

export type LabScenario =
  'protected_route' | 'account_isolation' | 'insufficient_permissions' | 'revoked_session';
export type LabVerdict = 'confirmed' | 'not_reproduced' | 'inconclusive' | 'not_run';
export interface TestCredential {
  kind: 'bearer' | 'cookie';
  value: string;
}
export interface LabRequest {
  projectId: string;
  url: string;
  pathPrefix: string;
  authorized: boolean;
  syntheticDataConfirmed: boolean;
  environment: 'local' | 'staging';
  allowPrivate: boolean;
  scenario: LabScenario;
  marker: string;
  ownerCredential: TestCredential;
  challengerCredential: TestCredential | null;
  expectedDeniedStatus: number;
  maxRequests: number;
  timeoutSeconds: number;
}
export interface LabRun {
  id: string;
  projectId: string;
  url: string;
  pathPrefix: string;
  environment: 'local' | 'staging';
  scenario: LabScenario;
  maxRequests: number;
  timeoutSeconds: number;
  startedAt: string;
  finishedAt: string | null;
  status: ScanStatus;
  requestCount: number;
  verdict: LabVerdict;
  reason: string;
  requests: {
    identity: string;
    method: string;
    url: string;
    status: number | null;
    expected: string;
    markerObserved: boolean;
    elapsedMs: number;
    cookies: { name: string; secure: boolean; httpOnly: boolean; sameSite: boolean }[];
  }[];
  logs: { at: string; level: 'info' | 'warn' | 'error'; event: string; message: string }[];
  error: string | null;
}
export const scenarioLabel: Record<LabScenario, string> = {
  protected_route: 'Rota privada: acesso anônimo',
  account_isolation: 'Isolamento entre contas de teste',
  insufficient_permissions: 'Permissão insuficiente',
  revoked_session: 'Token previamente revogado ou expirado',
};
export const verdictLabel: Record<LabVerdict, string> = {
  confirmed: 'Confirmado no recurso fictício',
  not_reproduced: 'Não reproduzido',
  inconclusive: 'Inconclusivo',
  not_run: 'Não executado',
};
