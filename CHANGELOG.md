# Changelog

## Não lançado

- Visual novo no app e no site, no estilo de um tiling window manager: fundo preto, janelas com borda e barra de título (`[~/findings]`), tudo em fonte monoespaçada, cantos retos, destaques em creme, títulos como prompt (`$ `) com cursor piscando, botões entre colchetes e barra de status com o modo `NORMAL` do vim. Cores roxas e azuis substituídas em todas as folhas de estilo.
- Logo novo em pixel art (escudo em Q com o prompt `>_`) no topo e na abertura do app, no cabeçalho e no rodapé do site, no favicon, na imagem de compartilhamento, nos ícones do app e nas imagens do instalador.
- Prefixos e colchetes decorativos não entram no nome acessível de títulos e botões.
- README e capturas do site atualizados; caminhos das imagens do README corrigidos para `site/public/`.

## 0.1.5

- Abertura do app volta a tocar quando o sistema pede menos movimento (por exemplo, Windows com "Efeitos de animação" desligados): antes virava cerca de 2 s de tela preta. Agora toca uma versão calma, só com fades em sequência; no modo normal, a versão completa.
- "Ativadas" em Configuração → Animações da interface passa a valer sobre a preferência do sistema no app inteiro, com aviso na tela quando o sistema está reduzindo o movimento.
- Testes automáticos para o modo calmo e para a opção "Ativadas".

## 0.1.4

- Resultado da análise (página "analisar") redesenhado: medidor do índice com contagem animada, distribuição por severidade com filtros, achados em acordeão com passos numerados (o que está errado, evidência com cópia, por que importa, como corrigir, como verificar), prompt de IA por achado e em lote, exportação e estado limpo. Corrige o corpo do achado, que usava a classe de layout `t-body` e quebrava em colunas.
- Análise em andamento: radar animado, progresso com brilho, contadores de requisições, tempo e eventos, e log que acompanha o fim sem roubar a leitura.
- Painel: estilos restaurados e redesenhados (as regras estavam em `theme.css`, que não é carregado), métricas com contagem, barra de severidades e evolução animada.
- Animações do app: transição entre páginas com entrada escalonada, pílula deslizante na barra lateral, entrada da tela inicial, foco do campo de URL, botão de análise com brilho, paleta de comandos redesenhada com fundo desfocado (a busca recebe o foco), avisos deslizando e hover nos cartões. Tudo desliga com "reduzir movimento" ou em Configuração.
- Site: barra de progresso de leitura no menu, botão de voltar ao topo, inclinação 3D nos cartões de recursos, linha dos passos de "Como funciona" desenhada na rolagem, marcadores dos princípios em sequência e destaque do download para o seu sistema.

## 0.1.3

- Desinstalador remove o registro do host da extensão em todos os navegadores (atualizações automáticas preservam a integração).
- Site: página de política de privacidade (`/privacidade`) cobrindo app e extensão, exigida pelas lojas de extensões; link no rodapé.
- `package-lock.json` versionado: instalações de CI e release passam a usar `npm ci` reprodutível.
- Testes de acessibilidade aguardam o fim das animações de entrada antes de medir contraste (falhavam no runner macOS, mais lento).

## 0.1.2

- Extensão para navegadores (Chrome, Edge, Brave e Firefox): analisa a aba aberta de forma passiva com o motor local, sem requisições novas, mostra achados por severidade e abre a análise completa no app com a URL preenchida (a autorização continua no app). Código em `extensions/browser/`.
- App: o executável atua como host de Native Messaging; integração ativada e desativada em Configuração, somente para o usuário atual.
- Motor: `scanner-http::passive` analisa cabeçalhos e HTML já recebidos pelo navegador, com limites de entrada e TLS/descoberta marcados como não executados.
- Site: imagens (logo, favicon e captura) voltam a ser publicadas; estavam fora de `site/public/` e o build não as copiava.

## 0.1.1

- Abertura animada do aplicativo: escudo desenhado, wordmark e status reais (interface, motor local, telemetria). Exibida uma vez por abertura, pulável com clique ou Esc, desligável em Configuração e reduzida quando o sistema pede menos movimento. Aguarda o motor responder (com limite) e o workspace entra junto com a saída.
- Tela de achados redesenhada: medidor do índice de postura, barra de severidades clicável, abas com contagem, filtros em uma linha com "Limpar filtros", lista fixa ao rolar, detalhe em passos numerados, cópia da evidência e prompt em lote recolhido. Corrige abas e filtros sem estilo (as regras estavam em um CSS não importado).
- Tipografia: Geist e Geist Mono embarcadas no app desktop (antes Inter e fallback do sistema para monoespaçada).
- Acabamento: fundo plano, foco visível consistente, feedback ao clicar e transições na mesma curva.
- Versão exibida em "Sobre" e no User-Agent do OSV passa a vir da versão do pacote.
- Proposta de extensão para navegadores em docs/BROWSER_EXTENSION.md.

## 0.1.0 — em desenvolvimento

- Instalador: Linux (.deb, .rpm, AppImage) e macOS (.dmg universal) voltam a ser gerados no release; NSIS com página de licença, imagens próprias, pasta no menu Iniciar, metadados de publisher/copyright e compressão LZMA.
- Website: botão de download direto que detecta o sistema e baixa o instalador do último release, com links diretos por plataforma e fallback para a página de releases.

- Evolução integrada sobre o aplicativo existente: identidade para vibe coders, terminal real com filtros/cópia/limpeza visual, dashboard e AI Fix Studio local para Codex, Claude Code e outros assistentes.
- Quick por padrão e Deep com autorização própria; rede privada e sondagens ativas explícitas, sem ampliação automática de origem ou prefixo.
- Lab GET para contas e recursos fictícios: acesso anônimo, isolamento entre usuários, privilégio insuficiente e token previamente revogado, com baseline/marcador, cancelamento e histórico sanitizado.
- Leak Hunter contextual, auditoria estática Supabase/Firebase e inventário pnpm/Yarn/Poetry/manifestos, com cobertura conservadora e distinção de versões declaradas.
- Revisões reversíveis de falsos positivos, comparação de código por identidade de escopo e CLI/workflow manual pré-deploy com estados de bloqueio/revisão.
- Migration 003 remove amostras brutas antigas, cria histórico Lab/revisões e recupera execuções fora dos limites visuais do histórico. Credenciais e corpos não cruzam armazenamento/IPC.

- Source Lab: exportação SARIF 2.1.0 integrada ao diálogo nativo, JSON preservado e controle de ocultação de caminhos habilitado por padrão.
- Paginação de todos os achados e dependências persistidos; filtros combinados por busca, categoria e severidade.
- Correções no scanner de código: segredos em comentários, limite da fila de diretórios e cobertura parcial para binários.
- Testes nativos dos relatórios e regressões de segurança; testes de interface para paginação, exportação, falhas e acessibilidade.

- Nova experiência de workbench desktop: controles Tauri, abas, console persistente, comandos internos, paleta Ctrl+K e animações com redução de movimento.
- Source lab nativo com SAST lexical, possíveis segredos, indicadores suspeitos e inventário de dependências; OSV e ClamAV opcionais com consentimento e limites.
- Migration 002 para histórico de código, exportação JSON redigida, leitura confinada por capability e fechamento normal aguardando cancelamento.

- Workspace Rust/Tauri 2 + React/TypeScript; design system local-first escuro.
- Política de autorização, escopo, DNS/IP, orçamento, timeout e cancelamento.
- Motor HTTP/TLS observacional, registry de 10 detectores e evidências sanitizadas.
- Projetos, migrations SQLite, histórico e comparação conservadora.
- JSON, HTML escapado e PDF com redação padrão.
- Seis utilitários locais e documentação de integrações futuras.
- Testes unitários, testes web e workflows de CI/artefatos manuais.

A versão ainda não foi lançada. Testes Rust e checagem Tauri passaram; validação do WebView e diálogos nativos, lockfile npm, revisão visual do PDF e instalador continuam pendentes. Consulte docs/DELIVERY.md.
