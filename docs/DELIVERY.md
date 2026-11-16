# Registro de desenvolvimento e validação

## Incremento — vitrine separada e interface embarcada

15/11/2026: foi implementada a apresentação local em `apps/showcase/`, separada da interface operacional do aplicativo. Há arte ASCII, recursos, FAQ responsivo e captura real do renderer em desenvolvimento (`public/interface.png`), com indicação de sua origem. A página não recebe alvos ou credenciais, não importa IPC e não executa scanners. O download permanece indisponível até existir uma release validada. `npm.cmd run site:dev` serve a vitrine em `http://127.0.0.1:1421/`; `npm.cmd run site:build` gera `apps/showcase/dist/`. A porta 1420 continua sendo somente a prévia de desenvolvimento da interface desktop. Nenhuma página foi publicada e o repositório do portfólio não foi alterado.

Validações desta etapa: o build da vitrine passou; dois novos testes Playwright passaram em 2,8 s, verificando a independência do IPC e dos formulários de scan, âncoras, captura real, download indisponível, menu mobile, FAQ, movimento reduzido e ausência de transbordamento horizontal em 390 px. ESLint passou incluindo os arquivos do site. A vitrine foi aberta no Edge visível, com título e heading conferidos. Verificações axe em desktop e mobile de 392 px não apontaram violações nas regras selecionadas; isso não equivale a conformidade integral.

O helper `desktop:preview` foi alterado para primeiro gerar a interface e depois executar `cargo build --offline --locked -p qypher-desktop --bin qypher-desktop --features custom-protocol`. O executável resultante carrega arquivos embarcados e não depende do Vite. O build de depuração embarcado passou em 58,42 s, além do build frontend. Isso não é a geração ou validação de um instalador. `desktop:dev` mantém o fluxo com hot reload.

**Bloqueio nativo observado:** o processo cria uma janela identificada como Qypher, mas os marcadores de diagnóstico chegaram somente a `runtime_build` e `runtime_built`, sem `setup_entered`. O banco SQLite continua ausente no perfil de prévia. Um teste isolado com cache novo e GPU desativada apresentou o mesmo comportamento, sem determinar a causa nem alterar as proteções do produto. O controle visual do Windows estava indisponível por falha na conexão ao pipe nativo. Não foi confirmado o carregamento operacional da interface React, do banco ou do IPC. A inicialização do WebView2 e os fluxos completos de scan, cancelamento e diálogos nativos precisam ser resolvidos e verificados antes de declarar o aplicativo utilizável. Os testes do renderer e a vitrine local não substituem essa validação.

## Incremento — controles de autorização e produto desktop

15/11/2026: os controles de autorização receberam caixas roxas, cartões clicáveis, títulos, indicação de obrigatório/opcional, foco de teclado e suporte às cores de alto contraste do sistema. Continuam sendo inputs nativos: nenhuma permissão é pré-selecionada e mudar o alvo ou as opções continua invalidando o consentimento. O estilo de checkbox é compartilhado pelo aplicativo.

Foi reafirmada a separação entre o aplicativo Tauri/Rust/SQLite, a prévia Vite de desenvolvimento e a vitrine de apresentação. A apresentação foi comparada com o código local das páginas Qlip e Qrztweaks do portfólio, sem editar esse repositório. A vitrine foi implementada localmente na etapa registrada acima; publicação e download público continuam pendentes. A feature convencional `custom-protocol` permite conferir diretamente via Cargo a configuração com frontend embarcado; a CLI Tauri já ativa esse recurso no build distribuível.

Validação deste incremento: TypeScript/Vite e ESLint passaram; os 13 testes Playwright selecionados de consentimento, terminal e Lab passaram, incluindo acionamento por Espaço, remoção de consentimento e verificações automáticas de acessibilidade. As capturas dos controles marcados e desmarcados foram inspecionadas. `cargo check --offline --locked -p qypher-desktop --features custom-protocol` passou com o frontend gerado. Isso não equivale a gerar ou testar um instalador. A rodada anterior de 30 testes e os demais resultados estão preservados abaixo.

## Estado atual — evolução defensiva e terminal

Data: 15/11/2026 · **Qypher 0.1.0 em desenvolvimento**. Este registro descreve verificações locais, não uma release, publicação ou instalador validado. As seções seguintes preservam revisões anteriores; seus bloqueios e contagens não substituem este estado atual.

A evolução mantém React/TypeScript, Tauri 2, os cinco crates Rust e SQLite. Foram integrados Quick/Deep com consentimentos separados, Leak Hunter contextual, inventário ampliado de dependências, auditoria estática Supabase/Firebase, Lab de autorização com GETs e recursos fictícios, revisão de falsos positivos, comparação por escopo, gate pré-deploy/CLI e AI Fix Studio local. Escopo e limitações estão em [EVOLUTION.md](EVOLUTION.md) e [LAB_MODE.md](LAB_MODE.md).

O terminal reúne eventos reais HTTP, código e Lab, com pesquisa, filtro, cópia e limpeza somente da visualização. O prompt tem histórico em memória, preenchimento com Tab e preparação de URL sem iniciar análise. As abas de configuração e runtime mostram dados reais da sessão. A prévia no navegador explica quando um botão exige IPC, oferece ferramentas locais e mostra como abrir o desktop; os efeitos decorativos podem ser desativados e respeitam movimento reduzido.

O controle de reconexão refaz a leitura do estado e reinstala as assinaturas dos eventos quando a conexão inicial falha, evitando um runtime aparentemente conectado sem atualizações de progresso.

A nova arte ASCII procedural usa texto em `pre`, com escudo e órbita em roxo/prata, seleção de cena e pausa. O renderizador local limita a frequência a aproximadamente 12 quadros por segundo e suspende a atualização fora da área visível, com página oculta, movimento reduzido ou animações desativadas. Não consome conteúdo do alvo nem gera eventos de análise. O teste de pausa e movimento reduzido passou no navegador.

Foram corrigidos a exportação da execução selecionada em Achados, o bloqueio de exclusão durante tarefas Source/Lab, a seleção de baseline ao trocar de análise e os resultados de hash desatualizados após edição. As ferramentas também tratam a seleção repetida do mesmo arquivo e alterações durante cálculo assíncrono.

### Evidência de validação deste incremento

| Verificação                                                                | Resultado observado                                                                                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testes Rust offline com lockfile                                           | 123 testes passaram no motor, incluindo CLI, políticas de rede/Lab, sanitização, inventário, comparação, armazenamento e relatórios                                 |
| `cargo clippy --offline --locked --workspace --all-targets -- -D warnings` | Passou na revisão final, incluindo o perfil de prévia                                                                                                               |
| Build de depuração `qypher-desktop` offline com lockfile                   | Passou, incluindo o perfil de dados separado em modo debug                                                                                                          |
| `npm.cmd test`                                                             | 24 testes Vitest passaram na revisão do terminal, comandos e interpretação dos resultados                                                                           |
| `npm.cmd run build`                                                        | TypeScript e build Vite passaram na mesma revisão                                                                                                                   |
| `npm.cmd run lint`                                                         | ESLint passou na revisão final                                                                                                                                      |
| `cargo fmt --all -- --check`                                               | Passou na revisão final                                                                                                                                             |
| Testes SQLite                                                              | 2 testes passaram na revisão do armazenamento                                                                                                                       |
| Playwright com Edge                                                        | 30 de 30 testes passaram na rodada final em 25,3 s, incluindo navegação, utilitários, relatório selecionado, terminal, ASCII, acessibilidade e reconexão de eventos |

O build Rust emitiu aviso de colisão de nome de PDB entre artefatos, sem falha de compilação. Os testes de interface usam substitutos de IPC somente em `tests/`; os testes Rust executam o motor e os serializadores reais. A validação anterior de parsing de PDF foi preservada, sem revisão visual do artefato. Nenhum teste ativo foi executado contra sistemas de terceiros.

A arte ASCII e o layout foram inspecionados em capturas de 1440 × 1000 e 1000 × 700. Na menor resolução, documento e área principal não tiveram transbordamento horizontal; o acesso ao Source Lab pelos atalhos foi exercitado. Os testes automáticos de acessibilidade não encontraram violações nas regras WCAG A/AA selecionadas; isso não equivale a conformidade integral nem valida os diálogos nativos.

`npm.cmd run desktop:preview` é o helper de prévia nativa com motor real e perfil de dados separado. A versão atual gera a interface e compila offline com `custom-protocol`, carregando arquivos embarcados sem iniciar Vite; banco/cache WebView2 são direcionados a `tmp/native-preview/`, sem disparar scans automaticamente. Requer o cache e o toolchain desktop já instalados. O build passou e o processo com janela Qypher foi identificado pelo sistema; a pasta de cache WebView2 foi criada. Isso não comprova que o IPC conectou: não foi observado um banco nesse perfil nem verificado um fluxo de scan dentro do WebView, conforme o bloqueio de inicialização registrado acima. Diálogos de seleção/salvamento, exportação nativa completa, serviços OSV/ClamAV reais e instaladores continuam sem validação de ponta a ponta. O renderer de desenvolvimento em `http://127.0.0.1:1420/` permite navegar e usar ferramentas locais, mas não substitui o motor desktop nem a vitrine da porta 1421.

Persistem as pendências de OAuth GitHub e armazenamento protegido pelo SO, histórico Git, detecção genérica de dados pessoais, SAST semântico, configuração efetiva dos provedores e emuladores, metadados completos de advisories, PDF/HTML Source/Lab, fonte mono empacotada, lockfile npm e distribuição nos três sistemas. Nada disso é apresentado como concluído. Não foram alteradas credenciais ou configurações de produção.

## Histórico das revisões anteriores

Data: 14/11/2026 · nome final: **Qypher** · versão: 0.1.0 em desenvolvimento.

## Incremento — Source Lab, SARIF e validação nativa

Implementação integrada de relatórios SARIF 2.1.0 no `scanner-source` e no comando Tauri `export_source`, com seleção de formato na interface. JSON mantém o formato existente. A ocultação de caminhos é habilitada por padrão e remove localizações do SARIF. O histórico permanece intacto. A exportação usa a execução salva completa e preserva cobertura e estados inconclusivos.

A interface agora permite acessar todos os achados e dependências persistidos por paginação, com filtros combinados por busca, categoria e severidade. Foram corrigidas a omissão de segredos em comentários, a fila de diretórios sem limite aplicado na inserção e a cobertura lexical incorretamente completa para arquivos binários. O detector de segredos passa a `1.0.1`. Uso e contratos estão em [SOURCE_REPORTS.md](SOURCE_REPORTS.md).

Verificações executadas neste ambiente Windows:

| Verificação                                                                | Resultado                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `cargo test --offline --locked`                                            | 59 testes passaram nos cinco crates do motor; 15 são do `scanner-source`                                                 |
| `cargo check --offline --locked -p qypher-desktop`                         | Passou, incluindo o comando de exportação e a integração Tauri                                                           |
| `cargo clippy --offline --locked --workspace --all-targets -- -D warnings` | Passou; ajustes pontuais de lint no Source Lab e alias de tipo no módulo HTTP                                            |
| `npm.cmd test`                                                             | 13 testes passaram                                                                                                       |
| `npm.cmd run test:schema`                                                  | 2 testes SQLite passaram                                                                                                 |
| `npm.cmd run build` e `npm.cmd run lint`                                   | Passaram                                                                                                                 |
| Playwright com `PLAYWRIGHT_CHANNEL=msedge`                                 | 10 testes passaram; quatro cobrem os novos resultados/exportações e a análise automática de acessibilidade do Source Lab |

Os testes de interface usam um substituto de IPC; os testes Rust executam o motor nativo e os serializadores. O diálogo de salvamento e o WebView Tauri não foram exercitados de ponta a ponta. OSV, ClamAV e instalação/desinstalação também não foram executados nesta revisão. O PDF passou no teste de parsing já existente, sem revisão visual do artefato. A checagem Tauri não é um instalador nem um teste da janela nativa.

`Cargo.lock` está presente e o cache/toolchain atual permitiu as verificações offline. As afirmações de ausência de dependências e linker nas revisões abaixo descrevem o ambiente anterior e são mantidas como histórico. A geração e revisão do lockfile npm e a validação da distribuição continuam pendentes.

## Revisão 2 — workbench desktop e Source lab

O shell visual foi refeito como workbench: barra de janela Tauri sem decoração padrão, explorador, abas, código com linhas numeradas, console, comandos internos e paleta Ctrl+K. Foram removidos os slogans e o dashboard promocional. As animações são de entrada, linhas de código, cursor, foco, painéis e estado real de execução, com suporte à redução de movimento.

Foi implementado o crate nativo `scanner-source`, com leitura confinada por `cap-std`, triagem lexical de código, possíveis segredos, indicadores suspeitos e inventário de versões npm/Cargo/Python. OSV é opcional e autorizado separadamente; ClamAV é opcional e recebe somente um TAR limitado em memória via stdin, sem executar código, remover ou colocar arquivos em quarentena pelo Qypher. A migration 002 separa o histórico de código. Há cancelamento, JSON redigido e controle compartilhado de execução. O fechamento normal aguarda o cancelamento e a conclusão dos workers.

Verificações desta revisão: TypeScript/Vite passaram; ESLint passou; 13 testes Vitest passaram, incluindo comandos e renderização segura do editor; 2 testes SQLite passaram; 6 testes Playwright passaram no Edge, incluindo paleta/console, autorização de escopo local e axe-core do painel. Foram corrigidos contraste e nomes acessíveis da navegação. Os doubles IPC existem somente nos testes e não validam o motor Rust. `cargo fmt --check` é a verificação sintática/formatação do workspace; não equivale a compilação.

**Os bloqueios nativos permanecem:** Cargo offline falha por `chrono` ausente; `link.exe`, Windows SDK/Build Tools e CLI Tauri não estão disponíveis. Não foi possível compilar ou executar os módulos Rust, consultar OSV pelo motor, executar ClamAV ou gerar instalador. Os novos módulos são código implementado, não funcionalidades declaradas como validadas. Não houve scan de terceiros nem instalação silenciosa de ferramenta. A validação nativa e a revisão de dependências continuam obrigatórias antes de release.

Repositórios do GitHub são analisados por uma cópia local escolhida no diálogo. Clone/download remoto automático, histórico Git, SAST semântico, validação ativa de XSS/SQLi, autenticação/autorização de aplicações, ZAP e acessibilidade dos alvos permanecem fora desta revisão. Nenhuma ferramenta garante detectar todas as vulnerabilidades ou todo malware. Escopo e cobertura estão documentados em [WORKBENCH.md](WORKBENCH.md).

O registro abaixo descreve a primeira revisão e permanece como histórico da validação inicial.

## Estado por fase

| Fase                   | Entregue                                                                                                  | Limites                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Pesquisa/arquitetura   | Stack avaliada, decisões, modelo, ameaças e referências                                                   | Revisão independente antes da primeira release                         |
| Design system          | Sidebar, dashboard, formulários, achados, histórico, relatórios, utilitários, foco e movimento reduzido   | Verificado em Edge web; WebViews nativos ainda não testados            |
| Núcleo                 | Código Rust para projetos, SQLite, política de rede, HTTP/TLS, registry, logs estruturados e cancelamento | Compilação/execução nativa bloqueadas neste ambiente                   |
| Relatórios             | Código JSON/HTML/PDF, diálogo nativo e redação padrão                                                     | Exportação end-to-end e renderização do PDF nativo ainda não validadas |
| Integrações            | Investigação ZAP API/Automation Framework e contrato axe-core isolado                                     | Não integradas; nenhum alerta fictício na interface                    |
| Qualidade/distribuição | Testes, CI de três SOs, ícones e workflow manual de pacotes                                               | CI remoto não executado, sem instalador gerado ou publicação           |

## Ambiente observado

Windows, PowerShell 5.1, Node 24.20.0, npm 11.19.0, Rust/Cargo 1.99.1, toolchain MSVC. `npm.ps1` é bloqueado pela política do sistema; foi usado `npm.cmd` sem mudar a política. Python não está utilizável e não é dependência do produto.

O sandbox não conseguiu conectar a crates.io/registries na resolução completa. `cargo test` falhou tentando baixar `chrono`; `cargo test --offline` confirmou que o índice/pacote necessário não está disponível. `npm install --offline` também falhou por metadados ausentes. Não foram gerados lockfiles falsos.

Foi possível reaproveitar tarballs já existentes no cache npm, verificando sua integridade e extraindo-os em `tmp/frontend-check/`, com junction local `node_modules`. Esses arquivos são ignorados pelo Git; não são um mecanismo de bootstrap distribuído. Isso permitiu testar o frontend com bibliotecas reais: React 19.3.1, TypeScript 5.9.3, Vite 8.3.8, plugin React 6.3.0, Vitest 5.1.0, Playwright 1.63.0, axe-core 4.13.0, Lucide 0.468.0 e Inter 5.3.0. O mantenedor deve resolver a árvore completa normalmente e versionar os lockfiles antes de release.

## Verificações efetivamente executadas

| Comando/verificação                           | Resultado                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm.cmd run build`                           | Passou: TypeScript strict e build Vite; JS aproximadamente 282 kB / 87 kB gzip                  |
| `npm.cmd run lint`                            | Passou: ESLint em interface, testes e scripts                                                   |
| `npm.cmd test`                                | 8 testes Vitest passaram em 2 arquivos                                                          |
| `npm.cmd run test:schema`                     | 1 teste SQLite real passou: migration, foreign key, roundtrip JSON e cascata                    |
| `PLAYWRIGHT_CHANNEL=msedge npm run test:e2e`  | 4 testes passaram com Edge instalado e Vite iniciado separadamente                              |
| Análise axe-core do dashboard                 | Nenhuma violação automática nas tags WCAG A/AA selecionadas; não comprova conformidade integral |
| Screenshots dashboard / nova auditoria        | Inspecionados em `test-results/`; sem dados de auditoria inventados                             |
| `cargo fmt --all -- --check`                  | Passou em todo o workspace                                                                      |
| `rustc --test --emit=metadata .../network.rs` | Passou na checagem de tipos do módulo de endereços e seus testes; NÃO executou testes           |
| `cargo test` / `cargo test --offline`         | Bloqueados por dependências indisponíveis; suíte Rust não executada                             |
| `rustc --test .../network.rs`                 | Falhou no link: `link.exe` não encontrado                                                       |
| `npm.cmd run desktop:build`                   | Bloqueado: CLI Tauri não instalada no ambiente/cache                                            |
| `npm.cmd audit --offline`                     | Bloqueado: `ENOLOCK`, sem lockfile completo                                                     |
| Testes desktop, TLS local e PDF nativo        | Não executados; dependem da compilação nativa                                                   |

O teste de autorização Playwright usa um **double de IPC somente dentro de tests/** para verificar configuração/consentimento. Ele não valida o motor Rust. O produto não contém runtime de demonstração, resultados falsos ou banco simulado.

Na execução automática do webServer do Playwright, o encerramento da árvore npm/Vite ficou pendente no sandbox Windows. Para obter um resultado final com código 0, o Vite foi iniciado em sessão separada e reutilizado pelos testes. A prévia local pode ser iniciada com `npm.cmd run dev`.

## Recursos implementados no código

- Um GET por vez, até 10 requisições e 5 redirecionamentos, com orçamento e timeout obrigatórios. Sem corpo, crawling, credenciais ou payloads de exploração.
- Origem exata e prefixo de caminho; validação DNS por salto e IPs fixados; proxy do ambiente desativado; proteção de endereços reservados/metadados IPv4/IPv6 e opção separada para rede privada.
- Dez detectores observacionais com ID, versão, confiança, evidência, impacto, recomendação e cobertura. Falta de cabeçalho é classificada como configuração/hardening, sem CVE/CVSS inventado.
- Persistência antes da execução, conclusão/falha/cancelamento, recuperação após encerramento e instância única para evitar duas sessões alterando estado de execução.
- Comparação conservadora por recurso/versão/escopo; erros e verificações não executadas são inconclusivos.
- UI conectada por IPC público Tauri, CSP de produção restritiva e permissões apenas para ouvir eventos. CSP de desenvolvimento permite o preâmbulo e WebSocket locais do Vite.
- Utilitários locais funcionais, exportações redigidas e dados de alvo tratados como texto não confiável.

## Pendências antes de chamar de MVP instalável validado

1. Instalar Microsoft C++ Build Tools, Windows SDK e confirmar WebView2.
2. Em ambiente com rede, executar `npm install` e `cargo generate-lockfile`; revisar e versionar ambos os lockfiles.
3. Executar testes Rust, Clippy completo e build Tauri; resolver qualquer falha encontrada na primeira compilação nativa.
4. Executar fixture autorizada no desktop, testar persistência, cancelamento, comparação e exclusão. Conferir que nenhuma conexão fora do escopo ocorreu.
5. Exportar HTML/JSON/PDF pelo diálogo real; renderizar e revisar o PDF. O gerador usa fontes padrão WinAnsi, com suporte a caracteres portugueses; outros alfabetos podem ser substituídos por `?` e precisam de melhoria futura.
6. Gerar NSIS, validar instalação/desinstalação em Windows 10/11 e rodar CI Linux/macOS.
7. Auditar dependências, completar inventário de licenças/SBOM e revisar a fronteira de segurança antes de publicação.

## Decisões que exigem o mantenedor antes de publicar

Licença Apache-2.0 e identificador `org.qypher.desktop` são defaults documentados. Confirmar identidade/organização, endereço de divulgação privada e contato de moderação. Assinatura/notarização dependem de certificados/contas próprios e eventual contratação. A publicação oficial exige autorização separada; nenhum release ou deploy foi publicado nesta entrega.
