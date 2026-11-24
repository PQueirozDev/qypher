# Modelo de ameaças do MVP

## Evolução atual

Os controles do incremento atual estão descritos em [EVOLUTION.md](EVOLUTION.md) e [LAB_MODE.md](LAB_MODE.md). O transporte HTTP aceita até 100 operações limitadas por execução; Quick e Deep exigem escopo e consentimentos explícitos. Corpos são processados somente em memória limitada e amostras brutas são descartadas no modelo/IPC/relatórios; a migration 003 remove campos legados de todo o histórico. Leituras incompletas não produzem cobertura completa. Bundles próprios são limitados a três arquivos de 1 MiB cada. A sonda HTTP em outra origem e heapdump não são executados.

O Lab recebe credenciais de teste apenas na entrada e as mantém em memória da execução. Não as grava no banco, logs, eventos ou relatórios. Requer recursos fictícios, marcador sintético e baseline válida, permite apenas GET e não segue redirecionamentos. Em homologação exige HTTPS; no ambiente local exige loopback e consentimento de rede privada. Cancelamento é compartilhado com as demais análises. GET ainda pode ter efeitos em um servidor mal implementado; nenhum cenário deve apontar a recursos reais para demonstrar falhas.

O pré-deploy conserva resultados inconclusivos quando há exclusões, limites, falta de resolução de versões ou módulos não executados. Sugestões cloud e prompts são texto para revisão; nunca são aplicados ao banco ou executados como instruções. Identificadores de pacotes com padrão reconhecido de credencial são recusados, inclusive antes do OSV. Backups e remanescentes do sistema de arquivos estão fora da garantia de remoção lógica de amostras. O banco continua sem criptografia.

As tabelas abaixo registram o modelo inicial do MVP; onde diferirem, prevalecem os controles atuais acima.

## Ativos e confiança

Ativos: máquina do auditor, banco local, histórico e relatórios. O frontend empacotado e os crates são confiáveis após revisão. Sites, cabeçalhos, certificados, arquivos SARIF, tokens colados e dados importados são sempre não confiáveis. Não existe servidor local exposto por Tauri em produção.

## Controles

| Ameaça                          | Controle                                                                                       | Limite residual                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| SSRF / DNS rebinding            | resolução por salto, validação de todos os IPs conectados, DNS override, sem proxy de ambiente | roteamento/VPN/hosts e configuração do SO são responsabilidade do ambiente; escopo é autorização do usuário, não prova de propriedade |
| Redirecionamento fora do escopo | origem exata e prefixo de segmento antes de resolver/conectar                                  | upgrades HTTP → HTTPS exigem configurar o projeto com a URL HTTPS; cross-origin não é permitido                                       |
| Metadados                       | bloqueio permanente link-local/CGNAT/reservados/endereços especiais                            | serviços internos dentro de RFC1918 ficam alcançáveis apenas quando explicitamente autorizados                                        |
| DoS do alvo                     | uma execução por vez; na descoberta, no máximo 4 conexões simultâneas (GETs de leitura em caminhos estáticos); orçamento e timeout por operação                  | um GET pode ter efeitos em aplicações mal construídas; não há garantia de ausência de efeitos                                         |
| DoS do auditor                  | não coletar corpo, limites de entradas, cookies, logs e arquivos locais                        | processamento de certificados e bibliotecas de protocolo depende de atualizações de dependências                                      |
| XSS nos resultados/relatórios   | React como texto, escape de HTML, CSP, PDF sem scripts, SARIF sem recursos externos            | um comprometimento dos assets empacotados pode acessar os comandos permitidos                                                         |
| Segredos nos dados              | nenhuma credencial/body/cookie value; URL sem query/usuário/senha; redação na exportação       | nomes de projeto/URLs/certificados podem conter informações internas; revisar manualmente                                             |
| Escrita de arquivo indevida     | destino escolhido pelo diálogo nativo dentro do backend; sem parâmetro de caminho no IPC       | usuário pode sobrescrever arquivo selecionado; respeitar confirmação do diálogo                                                       |
| Falsa conclusão de correção     | mesma origem/escopo/versão e cobertura concluída; falhas viram inconclusivas                   | uma observação distinta ainda não é prova de correção permanente                                                                      |
| Cadeia de suprimentos           | lockfiles a gerar, CI, audit, permissões mínimas e sem plugins executáveis                     | release está bloqueada até resolução/validação; assinatura e revisão externas pendentes                                               |

## Exclusões deliberadas

Os prefixos IPv6 `fd00:ec2::/32` e `fd20:ce::/32` são bloqueados conservadoramente mesmo com autorização de rede privada, cobrindo os endpoints de metadados documentados por [AWS](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html) e [Google Cloud](https://docs.cloud.google.com/compute/docs/metadata/overview). O endereço de plataforma Azure `168.63.129.16` também é negado. Novos endpoints de plataforma exigem atualizar a política e as regressões.

Sem autenticação web, exploração destrutiva, brute force, persistência, evasão, auto-update ou download automático de scanner. A única integração de subprocesso acrescentada é o ClamAV opcional em localização conhecida: entrada TAR limitada por stdin, argumentos fixos e nenhum código/argumento executável vindo do repositório. OSV usa endpoint fixo público e consentimento específico. A leitura estática usa `cap-std` para confinar aberturas ao diretório selecionado. Sem criptografia do banco. Sem sandbox de navegador porque o motor não renderiza páginas. Integrar um navegador ou ZAP exige nova análise de ameaças e processos isolados, nunca renderizar o alvo na WebView privilegiada.

## Checklist para mudanças de rede

Não adicionar novos protocolos ou métodos sem rever a autorização e os testes. Não desabilitar validação TLS. Todo salto passa pela allowlist. Endereços especiais e IPv4 mapeado devem ter regressões. Não obedecer variáveis de proxy do ambiente no transporte protegido. A autorização de rede privada nunca deve liberar link-local ou metadados.

Extensão de navegador (0.1.2): análise passiva via Native Messaging, sem rede nova, sem renderizar o alvo no app e com host restrito ao ID da extensão. Ameaças e mitigações em [BROWSER_EXTENSION.md](BROWSER_EXTENSION.md).
