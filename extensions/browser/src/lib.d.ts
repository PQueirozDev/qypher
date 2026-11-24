// Tipos das funções puras da extensão (usados apenas pelos testes em TypeScript).
export interface Finding {
  severity: string;
  [key: string]: unknown;
}
export type Counts = Record<'high' | 'medium' | 'low' | 'info' | 'unrated', number>;
export const HOST_NAME: string;
export const MAX_HTML_BYTES: number;
export const SEVERITIES: readonly string[];
export const SEVERITY_LABEL: Record<string, string>;
export function redactSetCookie(value: string): string;
export function sanitizeHeaders(
  headers: { name?: string; value?: string }[] | undefined,
): [string, string][];
export function samePage(a: string, b: string): boolean;
export function isAnalyzable(url: string): boolean;
export function truncateUtf8(text: string, limit?: number): { html: string; truncated: boolean };
export function countBySeverity(findings: Finding[] | undefined): Counts;
export function sortFindings<T extends Finding>(findings: T[] | undefined): T[];
export function badgeFor(counts: Counts): { text: string; color: string };
export function explainNativeError(message: unknown): { kind: string; text: string };
