# Qypher — arquitetura e decisões

Status: MVP em implementação · decisão inicial: 14/11/2026 · versão do produto: 0.1.0.

## Objetivo e limites

Aplicativo desktop local-first para auditorias autorizadas de aplicações web. O primeiro incremento executa um GET limitado e seus redirecionamentos no mesmo escopo, inspeciona HTTP/TLS e mantém projetos e execuções em SQLite. Não há exploração, crawling, submissão de formulários, autenticação, telemetria, serviços pagos ou execução de scripts do alvo. Ausência de um cabeçalho é uma oportunidade de hardening, não prova de exploração.

## Aplicativo, prévia e vitrine pública

Decisão de produto reafirmada em 15/11/2026: o Qypher é um aplicativo desktop instalável. Tauri hospeda a interface React em sua própria janela, os comandos IPC registrados acionam o motor Rust e o histórico fica em SQLite no computador. A implementação e a cobertura atuais, posteriores ao primeiro incremento descrito neste documento, estão em [EVOLUTION.md](EVOLUTION.md).

O servidor Vite e a porta 1420 permitem revisar o renderer no navegador durante o desenvolvimento. Eles não constituem um web app oficial e não são requisitos de execução do aplicativo distribuído. O pacote desktop inclui o `frontendDist` gerado pelo build da interface. A CLI Tauri ativa `tauri/custom-protocol` no build distribuível para carregar os arquivos embarcados; a feature local `custom-protocol` também permite conferir esse ramo diretamente via Cargo. `desktop:preview` agora gera a interface, compila offline com lockfile e essa feature e inicia a janela com arquivos embarcados, sem servidor Vite. `desktop:dev` mantém o fluxo de hot reload. O build de depuração embarcado passou, mas não é um instalador e não comprova inicialização do banco, IPC ou fluxos dentro do WebView. O bloqueio observado antes do setup está registrado em [DELIVERY.md](DELIVERY.md).

A vitrine implementada em `apps/showcase/` é uma aplicação estática independente, com apresentação, recursos, FAQ e captura real do renderer em desenvolvimento. `site:dev` usa a porta 1421 e `site:build` gera `apps/showcase/dist/`. O site compartilha somente a geometria ASCII local com o desktop; não importa a ponte Tauri, não recebe alvos ou credenciais e não executa scanners. O portfólio poderá apontar para essa apresentação, seguindo a separação entre produto e site usada por Qlip e Qrztweaks. Publicação, estudo de caso no portfólio e download de uma release validada continuam pendentes. A captura não é evidência de execução do motor nativo e a prévia do renderer não deve ser publicada como se fosse o aplicativo completo.

## Stack e alternativas

| Camada       | Escolha                                                   | Alternativas e motivo                                                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop      | Tauri 2 + Rust                                            | Electron inclui Chromium/Node e aumenta distribuição e memória; Qt exige outra linguagem de UI/distribuição. Tauri usa WebView do sistema, oferece comandos tipados e permissões explícitas. A diferença entre WebViews exige CI e validação em cada SO. |
| Interface    | React + TypeScript + Vite                                 | Next.js/SSR não ajudam um desktop offline; Svelte é viável, mas React facilita contribuição. CSS com tokens próprios evita uma camada de tema desnecessária; Lucide fornece ícones.                                                                      |
| Estado       | hooks React + snapshot via IPC                            | Zustand/TanStack Query ficam para quando houver necessidade real de cache remoto ou estado compartilhado complexo. Não há servidor HTTP local.                                                                                                           |
| Motor        | crates Rust + Tokio + reqwest/rustls                      | Python é útil para ferramentas externas, mas não agrega ao GET/TLS e complicaria o instalador; não é dependência do MVP. Rust reduz classes de falhas de memória.                                                                                        |
| Persistência | SQLite / rusqlite bundled                                 | PostgreSQL exige servidor. Migrations transacionais e versionadas; apenas dados locais. Uma conexão curta por operação, fora da thread da interface.                                                                                                     |
| Relatórios   | JSON, HTML escapado, PDF local                            | Sem API de conversão. HTML não carrega recursos externos. PDF é gerado a partir de dados, com paginação e fontes padrão.                                                                                                                                 |
| Gráficos     | SVG acessível derivado de resultados                      | Recharts é desnecessário para os gráficos simples do MVP; tabelas e rótulos acompanham os gráficos.                                                                                                                                                      |
| Qualidade    | cargo test/clippy/fmt, Vitest, Playwright, GitHub Actions | Testes de rede usam fixture local explícita. Builds desktop por SO; nenhum release oficial automático.                                                                                                                                                   |

## Componentes e fluxo

```text
React (conteúdo externo sempre como texto)
  -> comandos Tauri explicitamente registrados
  -> scanner-core: contratos, autorização, escopo, correlação
  -> scanner-http: DNS validado e fixado -> GET -> TLS/headers
  -> scanner-storage: migrations, projetos, histórico
  -> scanner-report: redação, JSON/HTML/PDF
```

Cada detector recebe uma observação imutável e emite achados e um registro de cobertura. O registry nativo permite registrar novos detectores sem alterar o orquestrador. Não são carregadas bibliotecas ou comandos arbitrários. Novos tipos de transporte devem passar pela mesma política de rede.

## Modelo de dados

- `Project`: UUID, nome, URL canônica, criação.
- `ScanConfig`: projeto, URL, confirmação explícita de autorização, permissão separada para rede privada, prefixo de caminho, orçamento de requisições, timeout e redirecionamentos.
- `Scan`: UUID, configuração, timestamps, estado (`running`, `completed`, `failed`, `cancelled`, `interrupted`), observações HTTP/TLS, cobertura e achados. Uma execução em andamento é persistida antes do trabalho.
- `Finding`: ID estável por detector + origem/caminho + localização, versão do detector, categoria, severidade, confiança, evidência redigida, impacto, recomendação, referências versionadas e classificação.
- `CheckResult`: detector, versão, estado (`passed`, `finding`, `not_run`, `error`), motivo. Comparação só marca resolução quando o detector foi concluído com sucesso para o mesmo recurso e configuração compatível.

O histórico armazena JSON versionado dentro de tabelas relacionais de projetos/execuções. Isso preserva snapshots completos e permite evoluir o contrato com migrations. Chaves estrangeiras habilitadas. Execuções abandonadas são marcadas `interrupted` ao abrir o aplicativo.

## Fronteira de rede e segurança

1. Autorização obrigatória, confirmada a cada execução. URL HTTP(S), sem usuário/senha, fragmento ou query. Segredos não são aceitos na URL.
2. Escopo: origem exata (scheme/host/porta) e prefixo de caminho em fronteira de segmento. Cada redirecionamento é validado antes da requisição; não há navegação automática.
3. DNS resolvido a cada salto, com timeout e cancelamento; todos os endereços precisam ser permitidos. A conexão usa os IPs validados, preservando SNI/host. Proxies de ambiente ficam desativados para não contornar a política.
4. Loopback/rede privada requerem opção adicional explícita. Metadados de nuvem, link-local, multicast, unspecified, faixas reservadas e IPv4 mapeado malicioso são bloqueados mesmo nesse modo. TLS inválido nunca é ignorado.
5. Uma execução por aplicativo, concorrência de rede 1, GET somente, até 10 requisições, até 5 redirecionamentos e timeout de 2–30 s por operação; corpo não é coletado. Cancelamento por token interrompe rede e DNS. Não há descoberta automática de URLs.
6. Não guardar valores de Set-Cookie, Authorization ou conteúdo do corpo. Evidências usam nomes de cookies e resumos; campos de servidor são limitados e sanitizados. Exportação redige URLs por padrão.
7. CSP Tauri restritiva; nenhum remote URL na WebView, shell ou fs genérico. Caminhos de exportação vêm do diálogo nativo. Resultados não entram em `innerHTML` nem são executados.
8. MVP sem credenciais ou scans autenticados. Uma futura implementação deve usar keyring do SO e jamais incluir segredos em snapshots/exportações.

## Cobertura do MVP

HTTP/HTTPS, escopo de redirecionamento, validação TLS pelas raízes públicas embarcadas do reqwest/rustls, expiração do certificado leaf, HSTS/CSP/nosniff/Referrer-Policy/Permissions-Policy, atributos de cookies, configuração observável de CORS e divulgação de servidor. CAs corporativas instaladas no SO não são automaticamente confiáveis neste modo; suporte a raízes adicionais exige configuração futura explícita. CORS é observação de resposta, sem provar exploração. Sem CVE/CVSS inventado. A validade criptográfica do TLS não mede toda a configuração do servidor ou revogação.

Acessibilidade é um módulo independente planejado: axe-core precisa de navegador isolado e renderização de conteúdo não confiável. Não será apresentada como executada no MVP. ZAP requer instalação explícita, API local autenticada e processo externo isolado; análise passiva não é substituída por resultados simulados.

## Distribuição

O plugin oficial de instância única impede duas janelas/processos de disputar a recuperação de execuções abandonadas e o controle de concorrência. Argumentos recebidos de uma segunda instância não são executados; a janela existente é apenas reativada.

Windows primeiro (NSIS por usuário, sem privilégio de administrador). Linux AppImage/deb e macOS DMG são gerados pelos respectivos runners. Lockfiles versionados, CI de três SOs, workflow manual de artefatos sem publicação automática. Assinatura Windows e notarização macOS exigem identidade/certificados do mantenedor e ficam documentadas; não há chave embutida nem updater automático.

## Referências consultadas

- Tauri 2: https://v2.tauri.app/start/prerequisites/ e https://v2.tauri.app/distribute/windows-installer/
- Permissões: https://v2.tauri.app/security/capabilities/
- reqwest: https://docs.rs/reqwest/latest/reqwest/struct.ClientBuilder.html
- OWASP Secure Headers: https://owasp.org/www-project-secure-headers/
- OWASP ASVS 5.0: https://owasp.org/www-project-application-security-verification-standard/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/

## Decisões futuras

A revisão desktop está em [WORKBENCH.md](WORKBENCH.md): shell com controles nativos, console sem shell arbitrário e novo `scanner-source` com persistência em migration 002. SAST lexical, segredos, indicadores e inventário são locais; OSV e ClamAV são opcionais, com cobertura própria. A análise de cópias locais do GitHub não usa checkout/execução de scripts. Esses componentes não substituem a avaliação semântica/manual de todas as classes de falha.

Validar contribuições externas antes de aceitar plugins executáveis; escolher sandbox e empacotamento do Playwright/axe-core; integrar ZAP passivo; keyring para autenticação; rever política de retenção/criptografia em disco conforme o modelo de ameaça. Licença inicial Apache-2.0, por oferecer concessão explícita de patentes. Nenhuma publicação ou assinatura oficial acontece automaticamente.
