import { parseCommand, type Finding, type DemoCommand } from './demo.ts';
import { element, play, type MotionContext } from './dom.ts';

export function createTerminal(context: MotionContext) {
  const abort = new AbortController();
  const { signal } = abort;
  const terminal = element('.product-terminal');
  const input = element<HTMLInputElement>('#demo-command');
  const output = element('#command-output');
  const guided = element('.terminal-output');
  const command = element('#typed-command');
  const result = element('.terminal-result');
  const lines = [...guided.querySelectorAll<HTMLElement>('.terminal-line')];
  const feed = element('#radar-feed');
  const recommendation = element('#terminal-recommendation');
  const status = element('#terminal-status');
  const received = new Map<string, { finding: Finding; time: number }>();
  let mode: DemoCommand = 'demo';
  let started = false;
  let demoTime = 0;
  let custom: Animation | null = null;
  let lastLineCount = -1;

  function finish() {
    started = true;
    demoTime = 550 + (lines.length + 1) * 600;
    command.textContent = 'demo';
    lines.forEach((line) => line.classList.remove('pending'));
    result.classList.remove('pending');
    status.textContent = 'SIMULAÇÃO CONCLUÍDA';
  }
  function start() {
    mode = 'demo';
    started = true;
    demoTime = 0;
    lastLineCount = -1;
    terminal.dataset.command = 'demo';
    output.replaceChildren();
    output.hidden = true;
    guided.hidden = false;
    result.hidden = false;
    feed.hidden = false;
    command.textContent = '';
    lines.forEach((line) => line.classList.add('pending'));
    result.classList.add('pending');
    status.textContent = 'DEMONSTRAÇÃO GUIADA';
    if (!context.moving()) finish();
  }
  function print(texts: string[]) {
    const fragment = document.createDocumentFragment();
    texts.forEach((text) => {
      const line = document.createElement('p');
      line.textContent = text;
      fragment.append(line);
    });
    output.replaceChildren(fragment);
    output.hidden = false;
    if (context.moving()) {
      custom?.cancel();
      custom = play(output, [{ opacity: 0.2 }, { opacity: 1 }], { duration: 220 }, context);
    }
  }
  function run(raw: string) {
    const selected = parseCommand(raw);
    input.value = '';
    if (selected === 'demo') {
      start();
      return;
    }
    guided.hidden = true;
    result.hidden = true;
    feed.hidden = true;
    mode = selected || 'help';
    terminal.dataset.command = selected || 'unknown';
    command.textContent = raw.trim().slice(0, 40);
    status.textContent = selected === 'clear' ? 'PRONTO PARA DEMONSTRAR' : 'CONSOLE DEMONSTRATIVO';
    if (!selected) {
      print([
        'Comando indisponível nesta demonstração.',
        'Use somente: help, demo, clear ou about. Nenhum comando de sistema é executado.',
      ]);
    } else if (selected === 'help') {
      print([
        'help   → mostra os comandos disponíveis',
        'demo   → repete o cenário fictício guiado',
        'clear  → limpa esta saída visual',
        'about  → apresenta o projeto',
        'Este console é apenas uma demonstração frontend.',
      ]);
    } else if (selected === 'about') {
      print([
        'QYPHER / ferramenta desktop de auditoria defensiva.',
        'De VibeCoders para VibeCoders.',
        'Código aberto · análise local · somente em escopo autorizado.',
        'Este website não executa scanners e não recebe alvos para análise.',
      ]);
    } else {
      output.replaceChildren();
      output.hidden = true;
    }
  }
  element<HTMLFormElement>('#demo-form').addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      run(input.value);
    },
    { signal },
  );
  terminal.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((button) => {
    button.addEventListener('click', () => run(button.dataset.command || ''), { signal });
  });
  element('#terminal-replay').addEventListener('click', start, { signal });
  element<HTMLInputElement>('#crt-toggle').addEventListener(
    'change',
    (event) => {
      terminal.dataset.crt = (event.currentTarget as HTMLInputElement).checked ? 'on' : 'off';
    },
    { signal },
  );
  terminal.querySelectorAll<HTMLElement>('[data-js-control]').forEach((control) => {
    control.hidden = false;
  });

  return {
    detection(finding: Finding, time: number) {
      received.set(finding.id, { finding, time });
      if (mode !== 'demo') return;
      const fragment = document.createDocumentFragment();
      [...received.values()].slice(-3).forEach((item) => {
        const entry = document.createElement('li');
        entry.dataset.finding = item.finding.id;
        const label = document.createElement('span');
        label.textContent = `T+${String(Math.floor(item.time / 1000)).padStart(2, '0')} / ${item.finding.code}`;
        const text = document.createElement('span');
        text.textContent = item.finding.title;
        entry.append(label, text);
        fragment.append(entry);
      });
      element('ol', feed).replaceChildren(fragment);
      recommendation.textContent = finding.recommendation;
      terminal.dataset.latestFinding = finding.id;
    },
    tick(delta: number, visible: boolean) {
      if (!visible || mode !== 'demo') return;
      if (!started) start();
      demoTime += delta;
      command.textContent = 'demo'.slice(0, Math.floor(demoTime / 100));
      const count = Math.min(lines.length, Math.max(0, Math.floor((demoTime - 550) / 600)));
      if (count !== lastLineCount) {
        lastLineCount = count;
        lines.forEach((line, index) => line.classList.toggle('pending', index >= count));
      }
      result.classList.toggle('pending', count < lines.length);
      if (count === lines.length) status.textContent = 'SIMULAÇÃO CONCLUÍDA';
    },
    settle() {
      custom?.finish();
      if (mode === 'demo') finish();
    },
    destroy() {
      abort.abort();
      custom?.cancel();
    },
  };
}
