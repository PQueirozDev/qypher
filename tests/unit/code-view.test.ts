import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CodeView } from '../../apps/desktop/src/components/CodeView';
it('treats source findings and filenames as text rather than executable markup', () => {
  const html = renderToStaticMarkup(
    createElement(CodeView, {
      label: '<script>file</script>.json',
      value: { evidence: '<img src=x onerror=alert(1)>', command: '<script>run()</script>' },
    }),
  );
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img');
  expect(html).toContain('SOMENTE LEITURA');
});
it('renders missing evidence safely without claiming a result', () => {
  const html = renderToStaticMarkup(createElement(CodeView, { value: undefined }));
  expect(html).toContain('null');
  expect(html).not.toContain('passed');
});
