// Preferência local de inicialização e versão do aplicativo.
// Usa localStorage (persistente no webview) com proteção contra valores corrompidos.
const KEY = 'qypher.startInTerminal';

export function startInTerminal(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setStartInTerminal(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';
