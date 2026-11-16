import { useState } from 'react';
import { Copy, Sparkles } from 'lucide-react';
import { buildIssuePrompt, copyText, type FixAssistant, type FixIssue } from '../aiPrompt';

export function AiFixStudio({ context, issues }: { context: string; issues: FixIssue[] }) {
  const [assistant, setAssistant] = useState<FixAssistant>('generic');
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState('all');
  const selected = issues.find((issue) => issue.id === selectedId);
  const selectedIssues = selected ? [selected] : issues;
  const prompt = expanded ? buildIssuePrompt(context, selectedIssues, assistant) : '';
  async function copy() {
    try {
      await copyText(buildIssuePrompt(context, selectedIssues, assistant));
      setMessage('Prompt copiado. Revise o conteúdo antes de compartilhar com um assistente.');
    } catch {
      setMessage('Não foi possível copiar. Abra a prévia e selecione o texto.');
      setExpanded(true);
    }
  }
  return (
    <section className="fix-studio" aria-label="AI Fix Studio">
      <div className="fix-studio-heading">
        <Sparkles size={18} />
        <div>
          <h3>AI Fix Studio</h3>
          <p>Entenda, corrija e verifique. Prompts gerados neste dispositivo.</p>
        </div>
      </div>
      <div className="fix-studio-controls">
        {issues.length > 1 && (
          <label>
            Achado para o prompt
            <select
              value={selected?.id ?? 'all'}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setMessage('');
              }}
            >
              <option value="all">Conjunto atual ({issues.length})</option>
              {issues.map((issue, index) => (
                <option key={issue.id} value={issue.id}>
                  {index + 1}. {issue.title.slice(0, 90)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Assistente de destino
          <select
            value={assistant}
            onChange={(event) => {
              setAssistant(event.target.value as FixAssistant);
              setMessage('');
            }}
          >
            <option value="generic">Assistente genérico</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
          </select>
        </label>
        <button
          className="button secondary"
          disabled={!issues.length}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Ocultar prévia' : 'Revisar prompt'}
        </button>
        <button className="button primary" disabled={!issues.length} onClick={() => void copy()}>
          <Copy size={14} />
          Copiar prompt de correção
        </button>
      </div>
      <p className="muted-text">
        Inclui evidência sanitizada, impacto, correção e pedido de testes de regressão. Nenhum
        código é enviado e nenhuma correção é aplicada automaticamente.
      </p>
      {selectedIssues.length > 40 && (
        <p className="notice">
          A prévia inclui até 40 achados por vez. Escolha qualquer achado no seletor para gerar seu
          prompt individual, inclusive os que ficaram fora do conjunto.
        </p>
      )}
      {expanded && (
        <label className="fix-preview">
          Prévia do prompt
          <textarea readOnly value={prompt} rows={16} spellCheck={false} />
        </label>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
