# Extensão de navegador

Status: **MVP implementado (fases 1 e 2) na versão 0.1.2.** Código em [`extensions/browser/`](../extensions/browser/README.md), host em `apps/desktop/src-tauri/src/native_host.rs` e análise passiva em `crates/scanner-http/src/passive.rs`. Este documento registra a arquitetura e o modelo de ameaças, como pede o [THREAT_MODEL.md](THREAT_MODEL.md) para integrações com navegador.

## Decisões do MVP

- **Exige o app instalado.** O próprio executável do Qypher atua como host de Native Messaging quando o navegador o inicia (sem binário extra no instalador).
- **Registro explícito:** nada é registrado no navegador até o usuário clicar em "Ativar integração" em Configuração; "Desativar" remove tudo (somente usuário atual, sem administrador).
- **Distribuição inicial fora das lojas:** "carregar sem compactação" no Chromium (ID fixo pela chave do manifesto) e extensão temporária no Firefox.
- **Pontuação separada:** a análise passiva não gera índice de postura; mostra só contagem por severidade.
- **Popup** em vez de painel lateral: funciona igual no Chromium e no Firefox.

## Objetivo

Analisar o site aberto na aba atual sem copiar a URL para o app. O usuário clica no ícone do Qypher, vê o resumo (índice, severidades, achados) num painel lateral e, se quiser, abre a análise completa no app desktop.

## Princípio que não muda

**Site aberto não é site autorizado.** A extensão separa dois níveis:

| Nível | O que faz | Autorização |
| --- | --- | --- |
| Passivo | Lê o que o navegador **já recebeu** ao carregar a página: cabeçalhos da resposta, flags de cookies (sem valores), HTML/DOM renderizado, recursos carregados. Nenhuma requisição nova. | Nenhuma além do clique do usuário (equivale ao DevTools). |
| Ativo | Descoberta de arquivos, testes de CORS/métodos, varredura com limite de requisições. | O mesmo consentimento explícito do app desktop, confirmado **no app**, nunca na extensão. |

Resultados passivos são marcados como "observação passiva da aba" e nunca como cobertura completa, mantendo a regra do produto de não apresentar cobertura que não ocorreu.

## Arquitetura recomendada: extensão fina + Native Messaging

```
Aba do navegador ──(content script: resumo do DOM)──┐
webRequest (somente leitura: cabeçalhos) ───────────┤
                                                     ▼
                       Service worker da extensão (MV3)
                                                     │  chrome.runtime.connectNative
                                                     ▼
                  qypher-native-host (binário Rust, stdin/stdout)
                                                     │  reaproveita scanner-core / scanner-http::analysis
                                                     ▼
                     Detectores + banco local (scanner-storage)
                                                     │
                     Painel lateral ◄── achados sanitizados
                     "Abrir no Qypher" ──► app desktop (tela Achados)
```

Por que esta opção:

- **Um só conjunto de detectores.** Os achados vêm do mesmo código Rust do app, então extensão e app nunca divergem.
- **Local-first preservado.** Nada sai da máquina; o canal é stdin/stdout com um processo local registrado pelo instalador.
- **Histórico unificado.** A análise passiva entra no mesmo banco e aparece na tela Achados.

### Alternativas consideradas

| Opção | Prós | Contras | Decisão |
| --- | --- | --- | --- |
| Detectores reescritos em JS dentro da extensão | Funciona sem o app | Duplica e diverge da lógica Rust; dobra a manutenção | Descartada |
| Detectores Rust compilados para WASM na extensão | Mesma lógica, sem app instalado | A análise já é pura, mas o crate `scanner-http` depende de `reqwest`/`tokio`; precisa de feature ou crate separado para compilar em WASM; bundle maior | Fase 3 |
| Extensão chama servidor HTTP local do app | Simples de implementar | Porta aberta no localhost é superfície de ataque para qualquer site | Descartada |

## Trabalho necessário no motor

1. ✅ Expor uma entrada passiva sobre o que já existe: `detectors::analyze(&HttpObservation)` e `page::analyze(body, url)` já são funções puras, sem rede (a rede fica em `scanner-http/src/lib.rs`). Falta montar um `HttpObservation` a partir dos dados do navegador (sem TLS probe, que exige conexão própria) e marcar como não executados os detectores que dependem de requisições.
2. ✅ Host de Native Messaging: o executável do app detecta o lançamento pelo navegador, lê mensagens JSON com prefixo de tamanho, valida esquema e tamanho máximo, chama a função acima e devolve achados sanitizados (até 1 MB).
3. ✅ O app registra o manifesto do host sob demanda (registro HKCU no Windows, arquivo JSON no macOS/Linux) com `allowed_origins` limitado ao ID da extensão.
4. Pendente: novo tipo de execução no banco: `source = "browser_passive"`, exibido com rótulo próprio na tela Achados.

## A extensão (MV3)

Permissões mínimas:

- `activeTab` e `scripting`: lê o HTML só da aba em que o usuário clicou.
- `webRequest` (observação, não bloqueio) + permissão de host **opcional**, pedida no clique: guarda os cabeçalhos da navegação principal por aba, com valores de cookies já substituídos por `[redigido]` e só uma lista fixa de cabeçalhos de segurança.
- `nativeMessaging`, `storage` (sessão, apagada ao fechar a aba).
- Sem `host_permissions` fixas.

Interface:

- Ícone com contador de achados da aba (badge colorido pela maior severidade).
- Painel lateral reaproveitando o visual da nova tela de revisão: medidor do índice, barra de severidades, lista de achados com detalhe e "Copiar prompt de correção".
- Botão "Abrir análise completa no Qypher": abre o app na tela de nova análise com a URL preenchida; o consentimento ativo acontece lá.
- Estado sem app instalado: explica o que falta e aponta para o download, sem simular resultados.

## Ameaças a tratar

- **Página hostil.** O content script roda num mundo isolado, só lê e não injeta UI na página; nenhuma resposta do host é interpretada como HTML.
- **Mensagens forjadas.** O host aceita apenas o ID da extensão (`allowed_origins`), valida esquema e tamanho e rejeita campos desconhecidos.
- **Vazamento de dados sensíveis.** Valores de cookies, tokens em URL e campos de formulário são descartados ou redigidos antes de sair do content script, usando as mesmas regras de `sanitizeTechnicalText`.
- **Privilégio do WebView.** O alvo nunca é renderizado dentro do app; a extensão usa o navegador do próprio usuário.
- **Lojas.** Chrome Web Store e AMO exigem política de privacidade e justificativa de cada permissão; o texto deve dizer que nenhum dado sai do computador.

## Compatibilidade

| Navegador | Observações |
| --- | --- |
| Chrome, Edge, Brave, Opera | MV3 com `sidePanel`; um só pacote |
| Firefox | MV3 com `sidebar_action` em vez de `sidePanel`; Native Messaging suportado com manifesto próprio |
| Safari | Fora do escopo inicial: exige app container e outro modelo de extensão |

## Fases

1. **Fundação no motor:** função de análise pura, testes com observações gravadas e binário `qypher-native-host`.
2. **MVP Chromium:** popup e painel lateral, análise passiva da aba ativa, "Abrir no Qypher", histórico unificado.
3. **Firefox e modo sem app:** port para Firefox; avaliar WASM para análise passiva quando o app não estiver instalado.
4. **Refinos:** reanálise automática opcional ao recarregar a aba (desligada por padrão), comparação com a última execução do mesmo site.

## Pendências

- Publicar na Chrome Web Store e no AMO (exige política de privacidade e o ID atribuído pela loja no `allowed_origins`).
- Histórico unificado: gravar a análise passiva no banco local e exibi-la na tela Achados.
- Remover os registros do host também na desinstalação (hoje: botão "Desativar" no app).
- Fases 3 e 4 abaixo.
