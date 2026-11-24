# Website público do Qypher

Landing page independente do aplicativo desktop, com HTML, CSS, Canvas 2D e módulos
TypeScript exclusivos. Este diretório mantém a
identidade original, os links para o repositório e os três destinos de releases.
Não importa componentes do desktop, IPC, scanners ou APIs do produto.

## Desenvolvimento local

Com as dependências existentes do repositório instaladas, execute na raiz:

```powershell
npm.cmd --prefix site run dev
```

Acesse `http://127.0.0.1:4173/`.

O comando global `npm run site:dev` pertence à vitrine separada de
`apps/showcase/`. Ele não serve este website. Nenhum script global foi alterado.

## Build e hospedagem

```powershell
npm.cmd --prefix site run build
```

O resultado fica em `site/dist/`. O build checa os módulos TypeScript e gera
JavaScript para o navegador. Publique o conteúdo compilado desse diretório, não
o código-fonte sem build. O `vercel.json` de `site/` declara `npm run build` e
saída `dist`, preservando os cabeçalhos existentes. Na Vercel, o diretório do
projeto deve ser `site/`. Os caminhos de assets pressupõem a raiz do domínio.
Nenhuma configuração global ou do aplicativo foi alterada.

## Interações e acessibilidade

- Radar, marcadores e terminal exibem somente dados fictícios identificados.
  Nenhum comando de sistema ou análise de segurança é executado pelo website.
- Um único ciclo `requestAnimationFrame`, limitado a aproximadamente 30 fps,
  coordena Canvas, radar, cursor e terminal. O radar e o terminal só são
  atualizados quando visíveis. A página oculta suspende o ciclo e as animações.
- Movimento reduzido mantém o radar estático e o terminal completo, desativa o
  cursor decorativo e os reveals. O botão de pausa controla os efeitos contínuos.
- A chuva de código ocupa toda a página em um Canvas fixo. O mouse ilumina e
  curva suavemente os caracteres próximos. No mobile, há menos colunas e caudas
  mais curtas; a densidade de pixels também é limitada. O cursor decorativo
  mantém o cursor nativo e só funciona com mouse de precisão.
- Menu e tooltips funcionam por teclado. Escape fecha o menu e dispensa tooltips.
- O conteúdo permanece presente sem JavaScript. A primeira prévia apresenta o
  terminal demonstrativo e uma aba separada mostra `public/interface.png`, a captura real
  já disponível do renderer em desenvolvimento, sem motor nativo conectado.
- O radar sincroniza pulsos e painéis com a varredura. Mouse, toque e teclado
  permitem fixar um achado. Escape e os controles retornam ao modo automático.
- O terminal reconhece somente `help`, `demo`, `clear` e `about`. A saída é
  construída com `textContent`, sem shell, `eval`, endpoints ou requisições de análise.
- A textura CRT tem um controle próprio. Montagem, dissolução e text reveal são
  pontuais; a arte decorativa é ocultada de leitores de tela.
- As áreas dos parágrafos são reservadas no Canvas para evitar caracteres sobre
  o conteúdo. Radar, terminal e ASCII suspendem atualizações fora da área visível.

Nenhuma biblioteca de animação ou dependência de runtime foi adicionada. O
manifesto de `site/` declara apenas Vite e TypeScript, já utilizados na raiz.
As fontes Inter e JetBrains Mono continuam
usando o Google Fonts, como na página original. Os instaladores dependem das
releases publicadas pelo projeto; os endereços originais foram preservados.

## Módulos e verificações

`experience/demo.ts` contém o cenário fictício, a geometria dos marcadores e a
lista de comandos permitidos. `radar.ts`, `terminal.ts`, `ascii.ts` e `gallery.ts`
implementam os componentes visuais; `dom.ts` compartilha consultas tipadas e
registro de animações. `main.js` mantém o único ciclo de animação.

```powershell
npm.cmd --prefix site run typecheck
npm.cmd --prefix site test
node site/tests/browser.mjs
```

O teste de navegador requer a prévia local em execução, as dependências de
desenvolvimento da raiz e Chrome instalado. `PLAYWRIGHT_CHANNEL` seleciona outro
canal disponível e `SITE_BASE_URL` permite verificar um build em outra porta.
Resultados e capturas ficam em `tmp/visual2/`.

A suíte cobre sincronização, seleção fixada, comandos, rejeição de HTML, CRT,
abas, teclado, touch, pausa, `visibilitychange`, movimento reduzido, conteúdo sem
JavaScript, links e ausência de overflow entre 320 e 1920 px. O axe executa as
regras WCAG A/AA selecionadas; não representa certificação de acessibilidade.

Há uma captura real de desenvolvimento disponível. A galeria não inventa telas
separadas de achados, relatórios ou histórico. Estes testes não validam o runtime
nativo. O README principal reúne capturas do website e uma pixel art complementar;
essa arte não substitui a logo oficial.

Imagens e arquivos estáticos referenciados por caminho absoluto (`/logo.png`, `/interface.png`) ficam em `site/public/`; o Vite só copia essa pasta para `dist/`.
