# Qypher

**De vibe coders, para vibe coders.** Você cria com IA. O Qypher ajuda a proteger. Desktop open source para auditorias autorizadas, evidências e recomendações práticas. Rust + Tauri 2 + React/TypeScript + SQLite. Sem conta, telemetria, APIs pagas ou servidor obrigatório.

O produto é um **aplicativo instalável para computador**: a interface roda na janela Tauri, o motor Rust executa as verificações e o SQLite guarda o histórico local. A vitrine em `apps/showcase/` apresenta o projeto com recursos, perguntas frequentes, arte ASCII e uma captura real do renderer em desenvolvimento; não executa análises nem expõe IPC. Ela já pode ser vista localmente em `http://127.0.0.1:1421/`, mas ainda não foi publicada. O download permanece indisponível até existir uma release validada. O Vite da interface desktop, na porta 1420, serve somente como prévia de desenvolvimento.

Esta evolução mantém a base existente e integra Quick/Deep Scan com consentimentos separados, terminal de eventos reais, Leak Hunter, auditoria estática Supabase/Firebase, mais lockfiles, laboratório de autorização com dados fictícios, revisão de falsos positivos, comparação de código, CLI pré-deploy e AI Fix Studio local. Consulte a [auditoria, fases executadas e limites](docs/EVOLUTION.md) e o [guia do laboratório](docs/LAB_MODE.md). Recursos remotos GitHub, histórico Git e validação de bancos em produção permanecem pendentes; não são apresentados como executados.

O Qypher usa um **workbench desktop com terminal**, paleta `Ctrl+K`, abas de configuração, evidências com linhas numeradas e controles de janela Tauri. O console permite pesquisar, filtrar, copiar e limpar a visualização dos eventos reais; o prompt tem histórico de sessão e preenchimento com `Tab`. O renderer React compõe a interface do aplicativo. Veja [WORKBENCH.md](docs/WORKBENCH.md).

A identidade visual inclui arte ASCII procedural em roxo e prata, com cenas de escudo e órbita, troca de geometria e pausa. A animação é gerada localmente em texto, sem imagens externas ou dados do alvo. Ela respeita movimento reduzido, a preferência de animações e a visibilidade da página; os logs continuam correspondendo somente às ações reais.

**Source lab:** implementação nativa de triagem lexical SAST, possíveis segredos, indicadores suspeitos, inventário npm/Cargo/Python, consulta OSV opcional e ClamAV opcional. Selecione uma cópia local autorizada do repositório, inclusive cópias do GitHub. Nenhum código do alvo é executado e não há clone remoto automático. Consulta OSV envia nomes/versões somente após consentimento; antivírus não é instalado silenciosamente. Achados e dependências têm paginação; JSON e SARIF exportam a execução salva com ocultação de caminhos habilitada por padrão. Veja [SOURCE_REPORTS.md](docs/SOURCE_REPORTS.md).

> **Estado: 0.1.0 em desenvolvimento, ainda não é uma release validada.** Testes Rust, frontend, SQLite e interface passaram neste ambiente; o build de depuração do aplicativo Tauri com arquivos embarcados e Clippy do workspace também passaram. O processo nativo apresenta uma janela, mas a inicialização observada não chegou ao setup do banco; a causa do bloqueio na inicialização do WebView2 ainda não foi determinada. A interface React operacional, IPC, scans e diálogos dentro do WebView não estão validados. A vitrine local carregou no navegador, sem representar execução do aplicativo. A revisão visual do PDF e o instalador também permanecem pendentes. Veja o [registro de validação](docs/DELIVERY.md), que distingue as revisões e suas verificações. Não há resultados simulados no produto.

## O que este incremento implementa

- Projetos e histórico em SQLite, migrations, exclusão e recuperação de execuções interrompidas.
- GET HTTP(S) real e redirecionamentos sob autorização, escopo de origem/caminho e orçamento limitado.
- HTTPS, HSTS, CSP, nosniff, Referrer/Permissions Policy, cookies, CORS e divulgação técnica.
- Validação TLS e observação de expiração do certificado leaf, quando disponível.
- Evidências sanitizadas, recomendações e cobertura explícita por detector.
- Comparação que mantém achados inconclusivos quando a cobertura não permite inferir resolução.
- Leak Hunter contextual e auditoria estática de políticas Supabase/Firebase, com valores sensíveis omitidos.
- Inventário npm, pnpm, Yarn, Cargo e Python; consulta OSV opcional, cobertura parcial explícita e versões declaradas diferenciadas das resolvidas.
- Laboratório GET com contas de teste e marcador fictício fornecidos pelo proprietário, baseline verificada, limites e cancelamento.
- Pré-deploy pelo mesmo motor do desktop, comparação de código por escopo e revisão reversível de falsos positivos.
- AI Fix Studio local para gerar prompts contextualizados, sem enviar código a modelos nem aplicar correções automaticamente.
- Exportação local JSON, HTML escapado e PDF paginado; redação de URLs habilitada por padrão.
- JWT local **sem verificação de assinatura**, SHA-256/SHA-512, integridade de arquivo, cookies, CSP, comparação de linhas e leitura SARIF.

Não inclui exploração destrutiva, coleta ilimitada de recursos, descoberta de senhas, CVSS automático, ZAP ou scanner axe-core dos alvos. O Lab compara somente contas e recursos fictícios fornecidos pelo proprietário, sem criar sessões ou modificar dados. A auditoria automatizada não substitui testes manuais de segurança ou acessibilidade.

## Começar no Windows

Instale Node.js 24 LTS, Rust stable (MSVC), [Microsoft C++ Build Tools e Windows SDK](https://v2.tauri.app/start/prerequisites/#windows) e WebView2 Runtime. A primeira instalação precisa acessar npm e crates.io.

No PowerShell, dentro do clone deste repositório:

```powershell
npm.cmd install
npm.cmd run doctor
npm.cmd run desktop:dev
```

O uso de `npm.cmd` evita depender da política de execução de scripts PowerShell. O projeto não altera essa política. No Linux/macOS use `npm`.

```powershell
# Vitrine do projeto em http://127.0.0.1:1421/, sem scanner ou IPC
npm.cmd run site:dev
npm.cmd run site:build

# Renderer de desenvolvimento em http://127.0.0.1:1420/, sem motor desktop
npm.cmd run dev

# Janela desktop com interface embarcada e perfil de depuração separado
npm.cmd run desktop:preview

# Desenvolvimento da janela desktop com hot reload
npm.cmd run desktop:dev

# Build e testes
npm.cmd run build
npm.cmd test
npm.cmd run lint
cargo test
cargo clippy --all-targets -- -D warnings
npx.cmd playwright install chromium
npm.cmd run test:e2e

# Instalador Windows por usuário (NSIS)
npm.cmd run desktop:build
```

A vitrine usa `http://127.0.0.1:1421/` e gera arquivos estáticos em `apps/showcase/dist/`. A captura `apps/showcase/public/interface.png` retrata o renderer de prévia, sem resultados inventados e sem afirmar que o aplicativo nativo já está operacional. Não há formulário para alvos, credenciais ou operações de scan nessa página. O portfólio pode apresentar essa vitrine quando ela for revisada e publicada; nenhum arquivo do portfólio foi alterado.

A prévia do renderer na porta 1420 permite navegar, usar o terminal e executar as ferramentas locais; scanners, histórico SQLite e diálogos de arquivos dependem do desktop. Esse endereço não é a vitrine nem um web app oficial. `desktop:preview` primeiro gera a interface com `npm run build`, depois compila o executável de depuração com `cargo build --offline --locked -p qypher-desktop --bin qypher-desktop --features custom-protocol` e o inicia com os arquivos embarcados, sem precisar de navegador ou servidor Vite. Banco e cache WebView2 são direcionados a `tmp/native-preview/`; não confunda a criação da pasta de cache com a conclusão da inicialização do banco. Nenhuma análise começa automaticamente. Requer dependências do projeto, cache Rust e toolchain desktop já disponíveis; não instala ferramentas nem usa resultados de demonstração. O perfil separado vale para esse modo de depuração; o aplicativo distribuído usa seu diretório de dados normal. `desktop:dev` continua disponível para hot reload. A validação do pacote instalado permanece separada dos builds e testes dessas prévias.

O instalador é gerado em `target/release/bundle/nsis/`. O instalador deste MVP não é assinado. Não contorne avisos do sistema para binários de origem desconhecida. Requisitos de outros sistemas, comandos de empacotamento e assinatura estão em [DISTRIBUTION.md](docs/DISTRIBUTION.md).

**Lockfiles:** `Cargo.lock` está disponível e as verificações Rust locais usam `--locked`. O `package-lock.json` ainda precisa ser gerado, revisado e versionado com a árvore completa de dependências npm. Execute o CI e use `npm ci` após essa etapa. A distribuição reproduzível continua pendente dessa validação.

## Primeira auditoria segura

1. No desktop, abra **Analisar** e informe a URL de uma aplicação própria/autorizada, sem credenciais ou query.
2. Escolha Quick ou Deep Scan; a aba `scope.json` mostra a configuração selecionada. As sondagens ativas de Deep têm autorização separada.
3. Confirme a autorização. Para localhost/rede privada, marque também a permissão específica.
4. Execute. Consulte os achados, sua classificação, evidências, cobertura e logs reais. Interrompa a análise se necessário.
5. Exporte o resultado pela tela de análise ou abra **mais → Relatórios**, mantenha a redação ativa e escolha o destino no diálogo nativo.

Para configuração detalhada de projeto, caminho e orçamento, use **mais → Projetos** e **mais → Auditoria HTTP**. O comando interno `deep https://seu-projeto.com/caminho` apenas prepara o formulário: a execução continua exigindo autorização explícita.

Para usar uma fixture local fornecida pelo projeto:

```powershell
node examples/fixture-server.mjs
```

Cadastre `http://127.0.0.1:8877/` e autorize localhost. O servidor só escuta loopback e contém configurações propositalmente incompletas para testar os detectores; não é uma aplicação de produção. A autorização de localhost não libera metadados de nuvem/link-local.

## Organização

```text
apps/desktop/          React, design system, comandos e configuração Tauri
apps/showcase/         Vitrine estática separada, sem IPC ou operações de análise
crates/scanner-core/   Contratos, autorização, política de rede, comparação
crates/scanner-http/   Transporte HTTP/TLS e registry de detectores
crates/scanner-source/ Triagem de código, segredos, dependências, OSV e ClamAV
crates/scanner-storage/ SQLite e migrations
crates/scanner-report/ JSON, HTML e PDF
integrations/         Especificações ZAP e acessibilidade (não integradas)
tests/                Testes TypeScript e navegação web
examples/             Fixture HTTP local para validação do motor
docs/                 Arquitetura, ameaças, desenvolvimento e roadmap
```

Consulte [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DEVELOPMENT.md](docs/DEVELOPMENT.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) e [ROADMAP.md](docs/ROADMAP.md).

Use somente em aplicações para as quais tenha autorização. A origem e o prefixo configurados são allowlists, não um mecanismo de autorização do proprietário. O banco é local e não criptografado; proteja sua conta/disco e revise os relatórios antes de compartilhar.

Licença [Apache-2.0](LICENSE). Publicação, identidade visual definitiva e certificados de assinatura permanecem sob controle do mantenedor.
