import { test as base, expect, type Page } from '@playwright/test';

export { expect, type Page };

// O app inicia travado no terminal em tela cheia (preferência `qypher.startInTerminal`).
// Por padrão os testes abrem direto no workspace; os que testam o terminal de
// inicialização usam `test.use({ startInTerminal: true })`.
export const test = base.extend<{ startInTerminal: boolean }>({
  startInTerminal: [false, { option: true }],
  page: async ({ page, startInTerminal }, provide) => {
    await page.addInitScript((value) => {
      try {
        if (localStorage.getItem('qypher.startInTerminal') === null)
          localStorage.setItem('qypher.startInTerminal', String(value));
      } catch {
        /* armazenamento indisponível: o app usa o padrão */
      }
    }, startInTerminal);
    await provide(page);
  },
});

// Navegação do Workspace 2.0: sidebar única com todos os destinos.
export async function navigate(page: Page, label: string) {
  await page
    .getByRole('complementary', { name: 'Navegação do workspace', exact: true })
    .getByRole('button', { name: label, exact: true })
    .click();
}
