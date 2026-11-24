import {
  SEVERITIES,
  SEVERITY_LABEL,
  countBySeverity,
  explainNativeError,
  sortFindings,
} from './lib.js';

const $ = (id) => document.getElementById(id);
let pageUrl = '';
let findings = [];
let filter = 'all';

function show(id) {
  for (const section of ['loading', 'message', 'result']) $(section).hidden = section !== id;
}

function message(title, text, retry = true) {
  $('message-title').textContent = title;
  $('message-text').textContent = text;
  $('retry').hidden = !retry;
  show('message');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderChips(counts) {
  const bar = $('bar');
  const chips = $('chips');
  bar.replaceChildren();
  chips.replaceChildren();
  const all = el('button', `chip ${filter === 'all' ? 'active' : ''}`, `Todas ${findings.length}`);
  all.type = 'button';
  all.setAttribute('aria-pressed', String(filter === 'all'));
  all.addEventListener('click', () => setFilter('all'));
  chips.append(all);
  for (const severity of SEVERITIES) {
    if (!counts[severity]) continue;
    const segment = el('i', `sev-${severity}`);
    segment.style.flexGrow = String(counts[severity]);
    if (filter !== 'all' && filter !== severity) segment.classList.add('dim');
    bar.append(segment);
    const chip = el(
      'button',
      `chip sev-${severity} ${filter === severity ? 'active' : ''}`,
      `${SEVERITY_LABEL[severity]} ${counts[severity]}`,
    );
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(filter === severity));
    chip.addEventListener('click', () => setFilter(filter === severity ? 'all' : severity));
    chips.append(chip);
  }
}

function renderFinding(finding) {
  const item = el('li', `finding sev-${finding.severity}`);
  const details = el('details');
  const summary = el('summary');
  summary.append(el('span', 'dot'));
  const text = el('span', 'text');
  text.append(el('strong', '', finding.title));
  const meta = el('span', 'meta');
  meta.append(el('span', 'sev', SEVERITY_LABEL[finding.severity] ?? finding.severity));
  meta.append(el('code', '', finding.detectorId));
  text.append(meta);
  summary.append(text);
  details.append(summary);
  const body = el('div', 'body');
  const sections = [
    ['Por que importa', finding.impact],
    ['Como corrigir', finding.recommendation],
    ['Evidência', finding.evidence],
  ];
  for (const [title, value] of sections) {
    if (!value) continue;
    body.append(el('h3', '', title));
    body.append(el(title === 'Evidência' ? 'pre' : 'p', '', value));
  }
  details.append(body);
  item.append(details);
  return item;
}

function render() {
  const counts = countBySeverity(findings);
  $('total').textContent = String(findings.length);
  renderChips(counts);
  const visible = sortFindings(findings).filter((f) => filter === 'all' || f.severity === filter);
  $('findings').replaceChildren(...visible.map(renderFinding));
  $('empty').hidden = findings.length > 0;
}

function setFilter(value) {
  filter = value;
  render();
}

async function analyze() {
  show('loading');
  $('open').disabled = true;
  // `?tab=` permite abrir este painel fora do popup (ex.: testes automatizados).
  const tabId = Number(new URLSearchParams(location.search).get('tab')) || undefined;
  const response = await chrome.runtime.sendMessage({ type: 'analyze', tabId }).catch((error) => ({
    ok: false,
    error: String(error?.message ?? error),
  }));
  if (!response?.ok) {
    if (response?.kind === 'unsupported')
      return message('Página não suportada', response.error, false);
    const problem = explainNativeError(response?.error);
    return message(
      problem.kind === 'no-host' ? 'Conecte o app Qypher' : 'Não foi possível analisar',
      problem.text,
    );
  }
  const { report } = response;
  pageUrl = report.url;
  findings = report.findings ?? [];
  $('target-url').textContent = report.url;
  $('target-url').title = report.url;
  $('headers-notice').hidden = report.headersObserved;
  $('open').disabled = false;
  render();
  show('result');
}

$('retry').addEventListener('click', () => void analyze());

$('grant').addEventListener('click', async () => {
  // Pedido feito no clique do usuário, como exige o navegador.
  const granted = await chrome.permissions
    .request({ origins: ['http://*/*', 'https://*/*'] })
    .catch(() => false);
  if (granted) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await chrome.tabs.reload(tab.id);
    window.close();
  }
});

$('open').addEventListener('click', async () => {
  if (!pageUrl) return;
  $('open').disabled = true;
  const response = await chrome.runtime
    .sendMessage({ type: 'open', url: pageUrl })
    .catch(() => null);
  if (response?.ok) window.close();
  else {
    $('open').disabled = false;
    message('Não foi possível abrir o Qypher', explainNativeError(response?.error).text);
  }
});

void analyze();
