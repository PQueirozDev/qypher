# Roadmap

## Evolução atual para vibe coders

Implementados: consentimentos Quick/Deep separados, terminal integrado, Leak Hunter contextual, auditoria estática Supabase/Firebase, novos lockfiles, Lab com contas e recursos fictícios, AI Fix Studio local, revisão reversível, comparação de código e CLI pré-deploy. A [matriz de cobertura e pendências](EVOLUTION.md) descreve cada fase e substitui o estado histórico abaixo quando houver diferença. GitHub remoto, histórico Git, emuladores/provedores, SAST semântico e distribuição validada continuam etapas próprias.

## Revisão atual do workbench

Implementados no código: shell desktop com console, comandos internos, Source lab lexical, possíveis segredos inclusive em comentários, indicadores suspeitos, inventário npm/Cargo/Python, OSV e ClamAV opcionais, histórico SQLite separado e relatórios JSON/SARIF com ocultação de caminhos. O Source Lab tem paginação e filtros combinados; fila de diretórios e cobertura de binários têm limites explícitos. Testes Rust, `cargo check` do Tauri e Clippy do workspace passaram no Windows. O próximo marco é validar a execução no WebView, os diálogos nativos e o instalador. Veja [SOURCE_REPORTS.md](SOURCE_REPORTS.md) e [DELIVERY.md](DELIVERY.md).

Cobertura futura: análise semântica e fluxo de dados (adapters Semgrep ou equivalente), histórico Git para segredos com controle de escopo, importação GitHub sem hooks/checkout e com proteção de extração, revisão de infraestrutura/dependências adicionais, testes autenticados e validação ativa não destrutiva com ZAP em escopo explícito. São trabalhos pendentes; não aparecem como scanners executados.

## 0.1 — base funcional (código implementado, validação desktop pendente)

Projetos, SQLite, HTTP/TLS protegido, 10 regras nativas, achados/recomendações, logs, cancelamento, histórico, correlação conservadora e JSON/HTML/PDF. Design system escuro acessível e utilitários locais. Para liberar: resolver dependências, versionar lockfiles, passar testes/CI, revisar PDF e validar instalador real no Windows.

## 0.2 — cobertura e experiência

Paginação do histórico além de 200 execuções; tendências entre escopos comparáveis; regras CSP/HSTS mais profundas; detalhes do handshake e teste TLS local com certificados controlados; comparação nos relatórios; allowlist explícita de múltiplas origens, inclusive upgrade HTTP→HTTPS, com consentimento por origem.

## 0.3 — acessibilidade independente

Sidecar Playwright explicitamente instalado, sandbox sem acesso a dados privilegiados, política de todas as subrequisições e DNS, limites de memória/processo e egress; axe-core com versão fixa; evidências de seletores sem capturar valores sensíveis. Contraste, alt, labels, headings, ARIA e teclado detectáveis. Critérios WCAG 2.2 e aviso de cobertura parcial.

## 0.4 — ZAP passivo

Conexão local autenticada com versão suportada detectada. Importação de alertas passivos e plano Automation Framework com job passiveScan-wait. Nenhum activeScan, spider ou navegador iniciado sem nova autorização/escopo. Gestão explícita do processo e consumo. A integração não deve reutilizar a credencial da API em relatórios.

## Futuro

Keyring nativo para credenciais, testes autenticados, SARIF para achados HTTP/TLS, inventário de dependências fornecido pelo usuário, SBOM, revisão de ASVS, testes de autorização sob controle granular, assinatura/notarização e atualização assinada. Detectores ativos só após revisão de segurança e controles próprios; nenhuma exploração destrutiva está planejada.

## Decisões do mantenedor antes de publicação

Confirmar Apache-2.0 e identidade de distribuição `org.qypher.desktop`; definir organização/repositório e contato privado de segurança; fornecer certificados/contas para assinatura, se desejado; aprovar a primeira versão pública após validação. Nenhuma dessas decisões impede desenvolvimento local ou testes.
