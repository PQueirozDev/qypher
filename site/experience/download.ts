// Escolha do instalador certo para o visitante, a partir do último release público.
export type Platform = 'windows' | 'macos' | 'linux';

export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface Installer {
  platform: Platform;
  name: string;
  url: string;
  size: number;
}

export const REPO = 'PQueirozDev/qypher';
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
export const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export const PLATFORM_LABEL: Record<Platform, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

// Ordem de preferência por sistema: o primeiro padrão encontrado vence.
const PREFERENCE: Record<Platform, RegExp[]> = {
  windows: [/-setup\.exe$/i, /\.msi$/i],
  macos: [/universal\.dmg$/i, /\.dmg$/i],
  linux: [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i],
};

export function detectPlatform(userAgent: string, platformHint = ''): Platform | null {
  const source = `${platformHint} ${userAgent}`;
  if (/android|iphone|ipad|ipod/i.test(source)) return null;
  if (/win/i.test(source)) return 'windows';
  if (/mac/i.test(source)) return 'macos';
  if (/linux|x11|cros/i.test(source)) return 'linux';
  return null;
}

export function pickInstaller(assets: ReleaseAsset[], platform: Platform): Installer | null {
  // Assinaturas do atualizador (.sig) e o manifesto (latest.json) nunca são instaladores.
  const candidates = assets.filter((asset) => !/\.(sig|json)$/i.test(asset.name));
  for (const pattern of PREFERENCE[platform]) {
    const asset = candidates.find((candidate) => pattern.test(candidate.name));
    if (asset)
      return { platform, name: asset.name, url: asset.browser_download_url, size: asset.size };
  }
  return null;
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1).replace('.', ',')} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
