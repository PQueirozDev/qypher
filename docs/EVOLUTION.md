# Evolução do Qypher

## Identidade e arquitetura preservada

**De vibe coders, para vibe coders.** Você cria com IA. O Qypher ajuda a proteger.

A implementação continua sobre o aplicativo existente, incluindo o shell e os componentes de análise já presentes. React/TypeScript e Vite formam o renderer; Tauri 2 fornece a janela e comandos IPC. Os cinco crates Rust separam contratos/política de rede, HTTP/TLS, código-fonte, SQLite e relatórios. Tokio executa trabalho assíncrono; leituras locais pesadas ficam fora da thread da interface. Não foi introduzido servidor obrigatório, modelo remoto ou biblioteca de análise adicional.

O terminal integrado usa registros de execução HTTP, código e laboratório. Busca e filtro afetam a visualização; limpar o terminal não exclui o histórico. Comandos da paleta são operações internas enumeradas, nunca comandos de shell. Dashboard e laboratório são acessíveis pela navegação; a tela inicial de análise e os fluxos anteriores foram mantidos. A paleta dark usa as cores solicitadas. Inter é empacotada; JetBrains Mono é declarada com fontes locais alternativas, sem download ou CDN automático.

## Aplicativo e site de apresentação

O Qypher permanece um aplicativo Tauri/Rust/SQLite instalável. A vitrine separada em `apps/showcase/` segue a distinção entre app e apresentação observada nos projetos Qlip e Qrztweaks do portfólio. Ela contém recursos, FAQ, arte ASCII com pausa e uma captura real do renderer em desenvolvimento, identificada como tal. Não possui formulário de alvos, acesso a credenciais, ponte IPC ou funções de scan. O download está sinalizado como indisponível, sem link para um instalador não validado. A vitrine está implementada e validada localmente; publicação e inclusão no portfólio continuam pendentes.

`npm.cmd run site:dev` abre essa apresentação na porta 1421; `npm.cmd run site:build` gera seus arquivos estáticos em `apps/showcase/dist/`. A porta 1420 continua dedicada ao renderer de desenvolvimento do desktop. Os dois testes Playwright próprios da vitrine passaram, cobrindo a separação operacional, âncoras, imagem real, download indisponível, menu mobile, FAQ, movimento reduzido e ausência de transbordamento horizontal em 390 px. A inspeção no Edge visível confirmou o carregamento da página; verificações axe em desktop e mobile não encontraram violações nas regras selecionadas. Esses resultados não validam o runtime nativo.

## Terminal, navegação e prévia local

O prompt aceita navegação (`home`, `dashboard`, `repo`, `lab`, `tools`), ajuda, cancelamento e preparação de escopo. `scan`, `quick` ou `deep` seguidos de uma URL HTTP(S) preenchem a tela de análise, sem iniciar requisições. Credenciais, query, fragmentos e comandos adicionais são recusados. A autorização não é herdada de um comando. `↑` e `↓` percorrem até 40 comandos sanitizados mantidos somente na memória da sessão; `Tab` completa operações conhecidas e `Escape` limpa a entrada. Não há execução de shell.

As abas `executar`, `scope.json` e `runtime` mostram respectivamente o formulário, a configuração selecionada e o estado real da conexão. Os botões dependentes de IPC explicam seus pré-requisitos na prévia web. O atalho para ferramentas locais, instruções do desktop e controle de exibição do terminal funcionam também sem o motor. A configuração de animações é local, pode ser desativada e respeita a preferência de movimento reduzido do sistema.

Quando a conexão inicial falha, `Reconectar` refaz a leitura do estado e reinstala as assinaturas dos eventos de progresso e conclusão. A recuperação é verificada por teste de interface com substituto de IPC, sem ser apresentada como validação do WebView nativo.

A estética ASCII usa geometria procedural própria, renderizada como caracteres em um elemento `pre`, em roxo e prata. Há duas cenas — escudo e órbita — com seleção e pausa. A atualização tem limite aproximado de 12 quadros por segundo e é suspensa quando o painel sai da área visível, a página fica oculta, o usuário desativa as animações ou o sistema pede movimento reduzido. Não usa canvas, imagens externas, conteúdo do alvo ou eventos fictícios. A arte permanece separada das evidências e dos logs do scanner.

Foram corrigidos fluxos em que a exportação podia receber outra execução que a selecionada, a exclusão de projetos não considerava tarefas Source/Lab e utilitários mantinham hashes antigos após alterações de entrada. A comparação pré-deploy reinicializa sua seleção ao mudar de análise. O hash de arquivo permite selecionar novamente o mesmo arquivo e bloqueia alterações conflitantes durante o cálculo.

```powershell
# Vitrine do projeto em http://127.0.0.1:1421/, sem scanner ou IPC
npm.cmd run site:dev
npm.cmd run site:build

# Renderer em http://127.0.0.1:1420/, sem scanners nativos
npm.cmd run dev

# Janela nativa com arquivos da interface embarcados, sem servidor Vite
npm.cmd run desktop:preview

# Janela nativa com hot reload durante o desenvolvimento
npm.cmd run desktop:dev
```

`desktop:preview` usa dependências/cache já instalados, gera a interface e compila o executável de depuração offline com lockfile e `--features custom-protocol`. Os arquivos do renderer ficam embarcados, portanto esse helper não inicia nem depende de um servidor Vite. O perfil aponta banco e cache WebView2 para `tmp/native-preview/`; o perfil de produção não é usado. Nenhuma análise inicia automaticamente. Primeiro build sem cache exige preparar o ambiente pelo fluxo normal de desenvolvimento. O build nativo embarcado passou e a janela foi identificada pelo sistema, mas a inicialização observada continua bloqueada antes do setup do banco: não foi criado um SQLite nesse perfil nem confirmado um fluxo de IPC. A causa da falha de inicialização do WebView2 permanece indeterminada. IPC, diálogos e execução de scans dentro do WebView continuam sem validação. Veja [DELIVERY.md](DELIVERY.md).

## Auditoria inicial e plano executado

| Fase        | Problema identificado                                                                              | Implementação e limite                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Fundação    | Amostras brutas podiam atravessar IPC/SQLite; consentimentos e escopo eram ampliados na interface  | Amostras desabilitadas no modelo; migration 003 limpa registros anteriores; Quick padrão; autorização, rede privada e sondagens separadas |
| Análise     | Detecção lexical e inventário com poucos formatos; leituras interrompidas podiam parecer completas | Leak Hunter contextual, mais lockfiles, cobertura parcial explícita, análise de bundles próprios e leitura limitada/cancelável            |
| Aplicações  | Não havia inspeção específica de políticas cloud                                                   | Auditoria estática Supabase/Firebase, com evidência sem valores e correção sugerida para revisão                                          |
| Simulação   | Não havia comparação de identidades com prova de recurso                                           | Lab GET com baseline válida, marcador sintético e quatro cenários; sem escrita ou extração de dados privados                              |
| Integrações | Prompts genéricos e ausência de gate de código                                                     | AI Fix Studio local, revisão de falsos positivos, comparação por escopo e CLI pré-deploy                                                  |
| Qualidade   | Documentação e testes divergiam dos módulos atuais                                                 | Testes nativos, CLI real, SQLite, interface/IPC e acessibilidade; validação desktop e distribuição continuam separadas                    |

## Cobertura real

### Quick e Deep Scan

Quick inspeciona HTTP/TLS e cabeçalhos em uma requisição e redirecionamentos autorizados, com orçamento padrão de três pedidos. Não ativa descoberta de arquivos nem sondas de handshake legado. Deep habilita descoberta e análise de conteúdo, com teto padrão de 60 pedidos na tela inicial; sondagens ativas de CORS/métodos exigem opção própria. O teto nativo permanece 100 operações, incluindo sondas, sem execução concorrente contra o alvo.

O transporte mantém a mesma origem e prefixo autorizado, valida e fixa DNS, desativa proxy de ambiente e não segue redirecionamento automaticamente. Não amplia a origem para testar HTTP em outra porta/protocolo. Endereços de metadados continuam bloqueados mesmo com permissão privada. Leituras com erro, limite ou cancelamento não geram uma conclusão de cobertura completa. A sonda de heapdump não é executada pelo custo e pela possibilidade de gerar dados sensíveis.

HTML, arquivos conhecidos e até três bundles próprios são examinados em memória, sem execução de JavaScript nem persistência do corpo. Os bundles têm limite de 1 MiB cada. A presença de source map é observada; não há coleta ilimitada dos arquivos ou de suas fontes. CORS refletido é uma observação de configuração, não prova de exploração com uma vítima autenticada.

### Código, vazamentos, dependências e cloud

O Source Lab usa uma pasta escolhida no diálogo nativo, token de seleção e leitura confinada por `cap-std`. Código, hooks, builds e testes do repositório analisado não são executados. O Leak Hunter considera padrões de credenciais, comentários e entropia quando há contexto apropriado; não testa se uma credencial funciona. Chaves públicas legítimas Supabase/Firebase não são vazamentos por si mesmas.

Supabase: SQL de migrations, RLS não observado/desabilitado, políticas incondicionais, políticas de Storage e funções privilegiadas sem `search_path` observado. Firebase: Firestore/Storage Rules e Realtime Database Rules, com distinção entre permissão aberta, autenticação simples e indícios de isolamento por proprietário. São análises estáticas, não inspeções do banco/provedor em execução; nenhuma sugestão SQL é aplicada automaticamente.

Inventário: package-lock v2/v3, pnpm v5/v6/v9, Yarn classic/Berry, Cargo.lock, requirements com pins/extras, Poetry e pins exatos de package.json. Versão declarada não é apresentada como instalação confirmada. Ranges sem lockfile correspondente e origens privadas não resolvidas deixam a cobertura parcial. Identificadores que correspondam a padrões de credenciais são recusados antes de persistência e consulta externa.

OSV continua opcional e envia apenas identificadores/versionamento de pacotes elegíveis após autorização. A resposta batch fornece IDs de advisories; não são inventadas severidade, CVSS ou versão corrigida. Esses detalhes precisam ser conferidos na fonte original. Consulta que falha ou possui formato inesperado fica inconclusiva.

### Laboratório e auditoria de autorização

O Lab implementa rota privada anônima, isolamento de duas contas, permissão insuficiente e uso de token previamente revogado/expirado pelo proprietário. A conta de referência precisa receber o marcador fictício esperado antes da comparação. HTTP 200 sem marcador é inconclusivo. Há quatro resultados: confirmado no recurso fictício, não reproduzido, inconclusivo e não executado.

São permitidos somente GET, loopback no ambiente local e HTTPS em homologação, com origem/prefixo vinculados ao projeto. Duas a oito requisições, timeout, cancelamento e histórico de metadados limitam o trabalho. Credenciais e marcador não fazem parte do modelo salvo, eventos ou relatórios. O Qypher não efetua logout, cria contas nem busca recursos reais para provar acesso. Veja [LAB_MODE.md](LAB_MODE.md).

### AI Fix Studio

Prompts para Codex, Claude Code ou outro assistente são gerados localmente, com prévia e seleção de achados. Incluem explicação, evidência sanitizada, impacto, correção, testes de regressão e nova verificação. Dados do alvo são identificados como não confiáveis. O Qypher não envia código a modelos, não aplica patches nem executa o projeto automaticamente. Copiar um prompt não confirma a correção: revise e reanalise depois de modificar o projeto.

## Pontuação e interpretação

O índice de postura HTTP começa em 100 e desconta uma vez por detector, pela maior severidade: alta 30, média 12, baixa 4, informativa 1 e não pontuada 0. Qualquer alta limita o índice a 55. Faixas: A ≥90, B ≥75, C ≥60, D ≥40 e F abaixo de 40. O índice só é apresentado para execução concluída com verificações efetivas; verificações não executadas e erros aparecem ao lado.

Isso não é CVSS, probabilidade de ataque ou aprovação de segurança. Uma configuração observada, uma hipótese lexical e um cenário reproduzido são resultados diferentes. As referências CWE/OWASP são versionadas; o mapeamento existente Top 10:2021 não é anunciado como a edição mais recente. ASVS e guias OWASP orientam a revisão manual; o aplicativo não declara conformidade integral com um padrão.

## Pré-deploy, revisão e comparação

Achados podem ser marcados como falsos positivos por execução, de forma reversível, sem apagar sua evidência. JSON/SARIF registram a revisão. A comparação de código exige identidade opaca de diretório igual e ordem cronológica; nomes de pastas iguais não bastam. Mudanças de linha são correlacionadas conservadoramente por regra, versão e arquivo. Uma ausência só é considerada não observada em cobertura equivalente quando o módulo concluiu; erros, exclusões, limites e versões incompatíveis deixam o caso inconclusivo.

O gate retorna `blocked` para altas pendentes, `review_required` para outros achados ou verificações importantes incompletas e `no_blockers_observed` quando não observou bloqueios na cobertura concluída. Não publica o projeto. Exclusões intencionais como `.git` e `node_modules` também podem tornar a execução parcial; esta política rigorosa foi mantida. Históricos antigos sem identidade de escopo não recebem comparação automática.

CLI real, usando o mesmo motor do desktop:

```powershell
cargo run --locked -p scanner-source --bin qypher-check -- --path C:\Projetos\MeuApp --authorized
```

Opções: `--baseline FILE`, `--output FILE` para snapshot JSON local, `--sarif FILE` para SARIF redigido e `--allow-osv` para consentir a consulta externa. Arquivos de saída existentes não são sobrescritos. O JSON nativo contém nome e caminhos relativos para comparação; revise antes de compartilhar. Baselines precisam ser arquivos regulares de até 16 MiB, sem symlink/reparse direto. A identidade local pode diferir em outro computador ou caminho.

Códigos de saída: 0 = nenhum bloqueio observado; 2 = altas pendentes; 3 = revisão/cobertura incompleta; 1 = erro. Ctrl+C encerra o CLI, sem imprimir aprovação antes da conclusão. O workflow manual `predeploy.yml` demonstra a integração sem tokens de serviços externos.

## Segurança e migração

A migration 003 cria histórico Lab e revisões, removendo os campos `sample` de todos os registros HTTP anteriores, inclusive além da paginação. O modelo também descarta esses campos na leitura e serialização. Não promete remoção forense de backups, cópias de relatórios ou remanescentes do sistema de arquivos. SQLite continua local e não criptografado.

As importações e baselines têm limites; URLs não aceitam credenciais/query, resultados são renderizados como texto e relatórios HTML escapam conteúdo. Comandos e executáveis não são derivados de instruções do alvo. ClamAV permanece opcional, com executável conhecido e argumentos fixos. Nenhuma ferramenta garante que um GET não tenha efeito em um servidor mal implementado; use os cenários em recursos fictícios próprios.

## Pendências explícitas

- GitHub remoto com OAuth oficial e credenciais protegidas pelo SO; análise de cópias locais já funciona.
- Histórico Git opt-in com controles próprios; detecção genérica de dados pessoais.
- SAST semântico/fluxo de dados e cobertura completa de todas as sintaxes de lockfiles, SQL e Rules.
- Consulta autorizada à configuração efetiva Supabase/Firebase e testes com emuladores.
- Detalhes completos de advisories, severidades e versões corrigidas além do batch OSV.
- Expiração/logout completos pelo provedor, escrita controlada e políticas de sessão além dos GETs sintéticos fornecidos.
- PDF/HTML unificados para Source/Lab: HTTP mantém PDF/HTML/JSON, Source usa JSON/SARIF e Lab usa JSON.
- Fontes JetBrains Mono empacotadas, validação nativa do WebView/diálogos, revisão visual do PDF e instaladores assinados nos três sistemas.

Os resultados e limitações de validação ficam em [DELIVERY.md](DELIVERY.md). Referências: [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/), [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Firebase Security Rules](https://firebase.google.com/docs/firestore/security/insecure-rules) e [OSV API](https://google.github.io/osv.dev/post-v1-querybatch/).
