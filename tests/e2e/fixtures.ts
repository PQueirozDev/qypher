import { test as base, expect, type Page } from '@playwright/test';

export { expect, type Page };

// O app inicia travado no terminal em tela cheia (preferência `qypher.startInTerminal`).
// Por padrão os testes abrem direto no workspace; os que testam o terminal de
// inicialização usam `test.use({ startInTerminal: true })`.
// A animação de abertura fica desligada nos testes, exceto quando `bootSplash: true`.
export const test = base.extend<{ startInTerminal: boolean; bootSplash: boolean }>({
  startInTerminal: [false, { option: true }],
  bootSplash: [false, { option: true }],
  page: async ({ page, startInTerminal, bootSplash }, provide) => {
    await page.addInitScript(
      ([value, boot]) => {
        try {
          if (localStorage.getItem('qypher.bootSplash') === null)
            localStorage.setItem('qypher.bootSplash', boot ? 'on' : 'off');
          if (localStorage.getItem('qypher.startInTerminal') === null)
            localStorage.setItem('qypher.startInTerminal', String(value));
        } catch {
          /* armazenamento indisponível: o app usa o padrão */
        }
      },
      [startInTerminal, bootSplash] as const,
    );
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
