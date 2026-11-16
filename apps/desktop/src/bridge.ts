// Public Tauri 2 global API, injected by withGlobalTauri. No private internals.
interface TauriApi {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  event: {
    listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
  };
}
declare global {
  interface Window {
    __TAURI__?: TauriApi;
  }
}
export const native = typeof window !== 'undefined' && Boolean(window.__TAURI__);
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.__TAURI__)
    return Promise.reject(
      new Error('Abra o aplicativo desktop para acessar o motor Rust e o banco local.'),
    );
  return window.__TAURI__.core.invoke<T>(command, args);
}
export function listen<T>(event: string, handler: (event: { payload: T }) => void) {
  if (!window.__TAURI__) return Promise.reject(new Error('Runtime desktop indisponível.'));
  return window.__TAURI__.event.listen<T>(event, handler);
}
