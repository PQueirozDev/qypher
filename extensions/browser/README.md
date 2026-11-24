# Extensão Qypher para navegadores

Analisa de forma **passiva** a aba aberta com o motor do Qypher instalado no computador.
Nenhuma requisição nova é feita e nada sai da máquina: a extensão lê os cabeçalhos da
navegação principal (com permissão) e o HTML renderizado, e envia ao app por Native
Messaging. Análises completas abrem no app, onde a autorização continua obrigatória.

Arquitetura e modelo de ameaças: [docs/BROWSER_EXTENSION.md](../../docs/BROWSER_EXTENSION.md).

## Instalação (desenvolvimento / pré-loja)

1. Instale o Qypher 0.1.2 ou superior.
2. No app: **Configuração → Extensão do navegador → Ativar integração com o navegador**.
   Isso registra o host `org.qypher.native` apenas para o usuário atual
   (Chrome, Edge, Brave, Chromium e Firefox). "Desativar" remove os registros.
3. Baixe `qypher-extension-chromium-<versão>.zip` ou `qypher-extension-firefox-<versão>.zip`
   na [página de releases](https://github.com/PQueirozDev/qypher/releases) e extraia, ou gere
   a extensão na raiz do repositório:

   ```powershell
   npm run extension:build
   ```

4. Carregue:
   - **Chrome / Edge / Brave:** `chrome://extensions` → ative o modo desenvolvedor →
     **Carregar sem compactação** → pasta extraída (ou `extensions/browser/dist/chromium`).
     O ID precisa ser `cnpaofiocpinipphkapcebfcmamffkif` (fixado pela chave do manifesto).
   - **Firefox 128+:** `about:debugging#/runtime/this-firefox` → **Carregar extensão
     temporária** → `manifest.json` da pasta extraída (ou de `extensions/browser/dist/firefox`).

5. Abra um site, clique no ícone do Qypher. Para avaliar CSP, HSTS e cookies, clique em
   **Permitir leitura de cabeçalhos** uma vez e recarregue a página.

## Estrutura

| Arquivo | Papel |
| --- | --- |
| `manifest.json` | Manifesto MV3 base (Chromium). O build deriva a variante Firefox. |
| `src/background.js` | Guarda cabeçalhos sanitizados por aba, coleta o HTML sob demanda e fala com o host. |
| `src/popup.*` | Interface: resumo por severidade, lista de achados, abrir análise completa. |
| `src/lib.js` | Funções puras (sanitização, resumo); testadas em `tests/unit/extension.test.ts`. |

## Garantias

- Valores de cookies são substituídos por `[redigido]` antes de sair da extensão; só uma
  lista fixa de cabeçalhos de segurança é encaminhada.
- Query string e fragmento não entram no relatório.
- Achados são exibidos com `textContent`; nenhuma resposta vira HTML.
- O host aceita só esta extensão (`allowed_origins` / `allowed_extensions`), valida o
  esquema das mensagens e limita tamanhos.
- Permissão de leitura de cabeçalhos é opcional e pedida no clique do usuário.

## Lojas

A política de privacidade exigida pela Chrome Web Store e pelo AMO está em
<https://qypher.pqueirozdev.com.br/privacidade>. A justificativa de cada permissão está na
mesma página. Para enviar à Chrome Web Store, remova o campo `key` do manifesto e acrescente o
ID atribuído pela loja a `CHROME_EXTENSION_ID` no host (`native_host.rs`).

## A chave da extensão

A chave **pública** está no `manifest.json` e fixa o ID no Chromium. A chave privada
correspondente só é necessária para empacotar `.crx` fora da loja; guarde-a fora do
repositório. Na Chrome Web Store o ID é atribuído pela loja e deve ser acrescentado a
`CHROME_EXTENSION_ID`/`allowed_origins` no host.
