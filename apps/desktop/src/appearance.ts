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
export function saveMotionPreference(value: MotionPreference) {
  applyMotionPreference(value);
  try {
    localStorage.setItem('qypher.motion', value);
  } catch {
    /* Session-only preference when browser storage is unavailable. */
  }
}
