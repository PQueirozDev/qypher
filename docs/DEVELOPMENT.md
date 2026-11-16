# Desenvolvimento

## Requisitos

- Node.js 24 LTS e npm. Rust stable, rustfmt e Clippy (`rustup component add rustfmt clippy`).
- Windows: toolchain `stable-x86_64-pc-windows-msvc`, C++ Build Tools (Desktop development with C++), Windows SDK e WebView2. `cl.exe` pode não estar no PATH mesmo quando instalado; use o Developer PowerShell se necessário.
- Linux: pacotes [oficiais Tauri 2](https://v2.tauri.app/start/prerequisites/#linux), incluindo WebKitGTK 4.1, librsvg, build-essential, OpenSSL e libayatana-appindicator.
- macOS: Xcode Command Line Tools e Rust. Assinatura/notarização têm requisitos adicionais.

Não é necessário Python, Docker, ZAP ou um servidor externo. Nenhum instalador de ferramentas externas é executado pelo aplicativo.

## Comandos

Na raiz: `npm install`; `npm run desktop:dev`. No PowerShell com política restrita: `npm.cmd`. A CLI Tauri entra em `apps/desktop`; os hooks usam `npm --prefix ../..` para executar Vite na raiz do workspace. O Vite serve somente `127.0.0.1:1420`.

`npm run dev` serve a interface web e os utilitários locais. Ela não emula SQLite nem o motor e não usa localStorage para inventar auditorias. O bridge usa a [API global pública do Tauri](https://v2.tauri.app/reference/javascript/api/) habilitada por `withGlobalTauri`; somente os comandos explicitamente registrados ficam disponíveis. A CSP e as capabilities limitam a WebView local.

`npm run build` executa TypeScript strict e Vite. `npm test` executa as regras locais. `npm run test:e2e` usa Playwright para verificar a prévia web; esses testes não são testes do WebView desktop. `npx playwright install chromium` provisiona o navegador de teste explicitamente. `PLAYWRIGHT_CHANNEL=msedge` pode usar Edge instalado no Windows quando configurado no teste.

`cargo test --locked` executa os cinco crates do motor; `cargo test --workspace --locked` também compila o wrapper desktop. `cargo clippy --workspace --all-targets -- -D warnings` e `cargo fmt --all -- --check` verificam Rust. `npm run lint`, `npm run format` e `npx prettier --check apps/desktop/src docs *.md` verificam TypeScript/CSS/docs. O Source Lab exporta JSON/SARIF; testes e contratos estão em [SOURCE_REPORTS.md](SOURCE_REPORTS.md).

## Adicionar um detector

Implemente `scanner_core::Detector` e registre em `scanner_http::detectors::registry()`. O detector analisa uma `HttpObservation` imutável, sem poder de rede próprio. Deve fornecer ID, versão, cobertura (`passed/finding/not_run/error`) e evidência sem segredos. Uma mudança semântica na regra exige incrementar sua versão. Não use `passed` para sinalizar sucesso de uma verificação não realizada.

Uma nova requisição deve passar pelo transporte protegido, nunca por um cliente criado diretamente pelo detector. Não aceite comandos, URLs ou scripts retornados pelo alvo para execução automática. Não classifique cabeçalhos ausentes como exploração confirmada. CVE/CVSS requerem validação específica.

## Dados

O renderer é parte do aplicativo desktop. O workbench inclui controles reais da janela Tauri e console de comandos internos (não um shell do sistema). `Ctrl+K` abre a paleta e `Ctrl+\`` alterna o console. O Source lab usa seleção de diretório no backend, token de escopo da sessão, `scanner-source` e migration 002. Para uma cópia do GitHub, escolha a cópia local autorizada; o aplicativo não executa clone, hooks, scripts npm, builds ou testes do repositório.

ClamAV, se desejado, precisa estar em `Program Files/ClamAV/clamscan.exe` no Windows, `/usr/bin/clamscan` ou `/usr/local/bin/clamscan` no Linux, ou `/opt/homebrew/bin/clamscan` no macOS. Atualize assinaturas conforme a documentação do fornecedor. O Qypher nunca instala o antivírus ou modifica sua configuração de proteção. O adapter usa stdin TAR em memória, limites e argumentos fixos; não recebe comandos do alvo nem usa o diretório do projeto como cwd. Não há sandbox de SO completo para o executável: versão, base e instalação confiável exigem revisão antes de distribuição.

O SQLite fica no `app_data_dir` do Tauri, no arquivo `qypher.db`. No Windows normalmente corresponde a `%APPDATA%/org.qypher.desktop/`; no Linux/macOS o diretório segue convenções do sistema. Sem credenciais armazenadas. O banco contém URLs, nomes de cookies e evidências de configuração, portanto deve ser tratado como sensível. Não é criptografado. Exclusão SQL não promete apagamento forense dos arquivos/backups/WAL.

A migration inicial está em `crates/scanner-storage/migrations`. Migrações futuras precisam ser transacionais e cobertas por teste a partir de bancos antigos. Nunca silencie erro de deserialização ou descarte histórico silenciosamente. O snapshot da interface carrega as últimas 200 execuções; execuções anteriores permanecem no banco e ainda não têm paginação na UI.

## Dependências e ambiente restrito

`npm install` e Cargo precisam de rede na primeira resolução. Falhas de download não comprovam defeito nem sucesso de build. Não altere certificados TLS ou a política de execução do sistema para contornar falhas. Os testes registrados em `DELIVERY.md` descrevem exatamente o ambiente usado.

Gere ambos os lockfiles e versione-os antes de release. Faça auditoria (`npm audit`, `cargo audit`) após resolução e trate alertas com análise de impacto. `cargo audit` precisa ser instalado explicitamente (`cargo install cargo-audit --locked`) e acessa o banco RustSec.

## Validação desktop manual obrigatória antes de release

Criar projeto → fechar/abrir → verificar persistência → executar fixture autorizada → conferir achados → cancelar um alvo lento → consultar histórico → exportar JSON/HTML/PDF → reabrir os arquivos → comparar duas execuções → excluir dados → instalar/desinstalar pacote por usuário. Repetir nos três SOs e com teclado/escala de tela. O teste automatizado web não substitui esse ciclo.

O Vercel CLI não é necessário para este desktop local. Caso o mantenedor use Vercel para publicar documentação ou serviços futuros, recomenda-se instalar `npm i -g vercel` para disponibilizar `vercel env pull`, `vercel deploy` e `vercel logs`; nenhuma implantação Vercel é criada por este projeto.
