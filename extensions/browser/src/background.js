// Service worker: guarda os cabeçalhos da navegação principal de cada aba (só quando o
// usuário concedeu permissão de host), coleta o HTML sob demanda e fala com o app.
import {
  HOST_NAME,
  badgeFor,
  countBySeverity,
  isAnalyzable,
  samePage,
  sanitizeHeaders,
  truncateUtf8,
} from './lib.js';

const key = (tabId) => `tab:${tabId}`;

function onHeaders(details) {
  if (details.tabId < 0 || details.type !== 'main_frame') return;
  const entry = {
    url: details.url,
    status: details.statusCode,
    headers: sanitizeHeaders(details.responseHeaders),
    at: Date.now(),
  };
  chrome.storage.session.set({ [key(details.tabId)]: entry }).catch(() => undefined);
}

// "extraHeaders" é necessário no Chromium para ver Set-Cookie; o Firefox não o aceita.
const filter = { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] };
try {
  chrome.webRequest.onHeadersReceived.addListener(onHeaders, filter, [
    'responseHeaders',
    'extraHeaders',
  ]);
} catch {
  chrome.webRequest.onHeadersReceived.addListener(onHeaders, filter, ['responseHeaders']);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(key(tabId)).catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  // Nova navegação: o selo antigo deixa de valer.
  if (change.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' });
});

function sendNative(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

// Executado dentro da aba: devolve apenas o HTML do documento.
function readDocument() {
  return document.documentElement ? document.documentElement.outerHTML : '';
}

async function analyzeTab(tab) {
  if (!tab?.id || !isAnalyzable(tab.url ?? '')) {
    return { ok: false, kind: 'unsupported', error: 'Abra uma página http(s) para analisar.' };
  }
  let html = null;
  let htmlTruncated = false;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readDocument,
    });
    if (typeof result?.result === 'string') {
      const cut = truncateUtf8(result.result);
      html = cut.html;
      htmlTruncated = cut.truncated;
    }
  } catch {
    html = null;
  }
  const stored = (await chrome.storage.session.get(key(tab.id)))[key(tab.id)];
  const cached = stored && samePage(stored.url, tab.url) ? stored : null;
  const input = { url: tab.url, html, htmlTruncated };
  if (cached) {
    input.status = cached.status;
    input.headers = cached.headers;
  }
  const response = await sendNative({ type: 'analyze', input });
  if (response?.ok) {
    const { text, color } = badgeFor(countBySeverity(response.report.findings));
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color }).catch(() => undefined);
    chrome.action.setBadgeText({ tabId: tab.id, text }).catch(() => undefined);
  }
  return response;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Só páginas da própria extensão (o popup) podem pedir ações; scripts em sites, não.
  const fromExtensionPage =
    sender.id === chrome.runtime.id && (sender.url ?? '').startsWith(chrome.runtime.getURL(''));
  if (!fromExtensionPage) return false;
  const run = async () => {
    if (message?.type === 'analyze') {
      const tab = Number.isInteger(message.tabId)
        ? await chrome.tabs.get(message.tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      return analyzeTab(tab);
    }
    if (message?.type === 'open' && typeof message.url === 'string') {
      return sendNative({ type: 'open', url: message.url });
    }
    if (message?.type === 'ping') return sendNative({ type: 'ping' });
    return { ok: false, error: 'Ação desconhecida.' };
  };
  run().then(reply, (error) => reply({ ok: false, error: String(error?.message ?? error) }));
  return true;
});
