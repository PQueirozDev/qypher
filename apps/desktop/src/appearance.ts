export type MotionPreference = 'system' | 'on' | 'off';
export function readMotionPreference(): MotionPreference {
  try {
    const value = localStorage.getItem('qypher.motion');
    return value === 'off' || value === 'on' ? value : 'system';
  } catch {
    return 'system';
  }
}
export function applyMotionPreference(value: MotionPreference) {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = value;
}
const BOOT_KEY = 'qypher.bootSplash';
export function bootSplashEnabled(): boolean {
  try {
    if (localStorage.getItem(BOOT_KEY) === 'off') return false;
  } catch {
    /* Sem armazenamento: usa o padrão. */
  }
  return readMotionPreference() !== 'off';
}
export function saveBootSplash(enabled: boolean) {
  try {
    localStorage.setItem(BOOT_KEY, enabled ? 'on' : 'off');
  } catch {
    /* Preferência válida só nesta sessão quando o armazenamento está indisponível. */
  }
}
export function saveMotionPreference(value: MotionPreference) {
  applyMotionPreference(value);
  try {
    localStorage.setItem('qypher.motion', value);
  } catch {
    /* Session-only preference when browser storage is unavailable. */
  }
}
