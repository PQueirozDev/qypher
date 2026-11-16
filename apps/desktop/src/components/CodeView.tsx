import { Fragment } from 'react';
export function CodeView({
  value,
  label = 'evidence.json',
  maxLines = 120,
}: {
  value: unknown;
  label?: string;
  maxLines?: number;
}) {
  const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? 'null');
  const lines = text.split('\n');
  return (
    <div className="code-view" aria-label={label}>
      <div className="code-file">
        <span className="file-type">{label.endsWith('.json') ? '{}' : '</>'}</span>
        {label}
        <span>SOMENTE LEITURA</span>
      </div>
      <div className="code-lines" tabIndex={0}>
        {lines.slice(0, maxLines).map((line, i) => (
          <div
            className="code-line"
            key={i}
            style={{ animationDelay: `${Math.min(i, 12) * 10}ms` }}
          >
            <span className="line-number" aria-hidden="true">
              {i + 1}
            </span>
            <code>{color(line)}</code>
          </div>
        ))}
        {lines.length > maxLines && (
          <div className="code-line">
            <span className="line-number">…</span>
            <code>
              Visualização limitada a {maxLines} linhas. Exporte o artefato para consultar o
              snapshot completo.
            </code>
          </div>
        )}
      </div>
    </div>
  );
}
function color(line: string) {
  const expression = /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|\b\d+(?:\.\d+)?\b/g;
  const nodes = [];
  let from = 0;
  for (const match of line.matchAll(expression)) {
    const index = match.index!;
    if (index > from) nodes.push(<Fragment key={`t${from}`}>{line.slice(from, index)}</Fragment>);
    const value = match[0];
    const key = value.startsWith('"') && /^\s*:/.test(line.slice(index + value.length));
    nodes.push(
      <span
        key={`s${index}`}
        className={
          key
            ? 'syntax-key'
            : value.startsWith('"')
              ? 'syntax-string'
              : /^(true|false|null)$/.test(value)
                ? 'syntax-literal'
                : 'syntax-number'
        }
      >
        {value}
      </span>,
    );
    from = index + value.length;
  }
  if (from < line.length) nodes.push(<Fragment key="end">{line.slice(from)}</Fragment>);
  return nodes;
}
