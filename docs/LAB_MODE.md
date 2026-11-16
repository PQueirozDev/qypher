# Lab Mode: Auth & Permissions Auditor

O **Laboratório de autorização** compara o acesso ao mesmo recurso fictício em condições controladas. Ele usa contas de teste fornecidas pelo proprietário, faz somente GET e registra evidências sanitizadas. Não descobre senhas, não cria contas, não executa logout e não busca dados reais para demonstrar uma falha.

## Cenários disponíveis

| Cenário                    | Referência                                       | Acesso que deve ser negado                                 |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| Rota privada               | Conta autorizada de teste                        | Anônimo, sem Authorization ou Cookie                       |
| Isolamento entre contas    | Conta proprietária do recurso fictício           | Outra conta de teste                                       |
| Permissão insuficiente     | Conta de teste com a permissão necessária        | Conta de teste sem essa permissão                          |
| Token revogado ou expirado | Credencial atual e válida da conta de referência | Credencial que o proprietário já revogou ou deixou expirar |

O último cenário verifica a rejeição de uma credencial fornecida como revogada ou expirada. O Qypher não realiza a revogação, não chama a rota de logout, não obtém refresh tokens e não mede automaticamente a duração de uma sessão. A validade e os papéis declarados das contas são pré-requisitos fornecidos pelo proprietário.

## Preparar um teste sem dados reais

1. Use uma aplicação local isolada ou uma homologação autorizada. Crie duas contas dedicadas ao teste, sem privilégios de produção.
2. Crie um recurso fictício pertencente à conta A. Seu conteúdo não deve conter dados pessoais, credenciais ou registros de usuários reais.
3. Inclua na resposta desse recurso um marcador exclusivo, por exemplo `qypher-fixture-resource-owner`. Ele deve aparecer somente quando o recurso fictício for realmente entregue, e não em páginas de login ou mensagens genéricas de erro.
4. Defina a rejeição esperada: HTTP 401, 403 ou 404. Confirme que o GET da rota não modifica dados nem inicia processos caros no servidor.
5. Cadastre o projeto em **Alvos** e abra o **Laboratório de autorização**. Escolha o cenário, a URL, o prefixo autorizado, o ambiente e o marcador.
6. Forneça a credencial da conta A e, quando necessário, a segunda credencial. Confirme a autorização, o uso de contas/recursos fictícios e, para loopback, a permissão de rede local.

Exemplo de contrato de uma fixture local:

```text
Recurso: http://127.0.0.1:8878/fixture/private
Prefixo: /fixture
Marcador: qypher-fixture-resource-owner
Rejeição esperada: 403

Conta A autorizada:
HTTP 200
{"fixture":"qypher-fixture-resource-owner","owner":"test-account-a"}

Conta B ou acesso anônimo:
HTTP 403
{"error":"forbidden"}
```

Essas respostas descrevem o contrato esperado da aplicação de teste; o Qypher não as fabrica. Para exercitar uma falha de isolamento intencionalmente em um laboratório descartável, o proprietário pode preparar uma rota fictícia que entregue esse mesmo marcador à conta B. A evidência será obtida das requisições reais feitas pelo motor. Não publique essa rota como parte de uma aplicação real.

## Baseline e interpretação da evidência

A primeira requisição usa a conta de referência. Ela precisa retornar **2xx e o marcador sintético**. Se isso não acontecer, o resultado é inconclusivo e o Qypher encerra o cenário antes de testar outra identidade. Assim, um token de referência inválido ou uma URL errada não se transformam em uma aparente confirmação de segurança.

Com a baseline válida, a segunda requisição usa acesso anônimo ou a credencial de comparação, conforme o cenário. Um código 200 isolado não prova acesso ao recurso: pode ser uma página de login, uma resposta pública genérica ou um fallback da aplicação.

| Resultado                          | Significado                                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confirmado no recurso fictício** | O acesso que deveria ser negado recebeu 2xx e o marcador exclusivo, após a confirmação da baseline. A confirmação vale somente para o cenário, recurso e contas declarados. |
| **Não reproduzido**                | A requisição recebeu exatamente o código de rejeição esperado, sem o marcador. Isso não comprova a segurança de outras rotas, operações ou combinações de contas.           |
| **Inconclusivo**                   | A baseline falhou, o código divergiu do esperado, houve redirecionamento, faltou o marcador ou ocorreu cancelamento, erro, timeout ou limite de leitura.                    |
| **Não executado**                  | Ainda não há uma execução do cenário capaz de produzir um resultado. Esse é o estado inicial; não equivale a uma verificação sem problemas.                                 |

O estado da execução é separado do resultado: ela pode estar em andamento, concluída, cancelada, com falha ou interrompida pelo encerramento do aplicativo. Uma execução concluída ainda pode ter resultado inconclusivo.

## Escopo, rede e limites

- **Local:** somente `localhost` ou um IP de loopback, com autorização de rede local. Todos os endereços DNS usados também precisam ser loopback. HTTP é permitido nesse ambiente de desenvolvimento.
- **Homologação:** exige HTTPS e validação normal do certificado. Não existe opção de ignorar erros TLS. A seleção de homologação é uma declaração do proprietário, não uma descoberta automática de que o servidor não é produção.
- A origem precisa coincidir com o projeto cadastrado. O prefixo do Lab não pode ampliar o caminho cadastrado no projeto. Para autorizar outra área, cadastre a raiz apropriada como projeto e escolha conscientemente o prefixo.
- Credenciais, query string, fragmentos e caminhos com codificação ambígua não são aceitos na URL. Destinos reservados e de metadados de nuvem continuam bloqueados, mesmo com permissão de rede privada.
- O DNS é validado e fixado no cliente de cada requisição. Não são usados proxies do ambiente, cookie jar de navegador ou redirecionamentos automáticos. Uma resposta 3xx fica inconclusiva; seu `Location` não é seguido.
- O orçamento configurável aceita **2–8 requisições**. Os cenários atuais usam normalmente dois GETs e podem parar após o primeiro. Eles não tentam preencher o orçamento com sondas adicionais.
- O timeout aceita **2–15 segundos por requisição**. Há também um teto de execução que inclui DNS, cabeçalhos e corpo: `min(timeoutSeconds × maxRequests, 120 segundos)`.
- Cada corpo é limitado a **64 KiB** e descartado após a comparação. Excesso, falha de leitura e mais de 64 cookies deixam a evidência inconclusiva.

## Credenciais e armazenamento

São aceitos Bearer tokens ou cookies de teste. Para Bearer, informe somente o valor: o motor acrescenta `Bearer `. Para cookie, use `nome=valor`. As credenciais devem ter 8–4096 caracteres ASCII, sem controles, CR/LF ou espaços nas extremidades. A credencial de comparação deve ser diferente da credencial de referência.

`LabRequest` e `TestCredential` são somente tipos de entrada: não implementam serialização nem formatação de debug. As credenciais permanecem na memória da execução e são enviadas apenas ao alvo autorizado. Não entram no SQLite, eventos, logs, prompts ou relatórios. O valor do marcador e os corpos das respostas também não fazem parte do resultado salvo.

O histórico guarda o cenário, escopo, horários, contagem de requisições, códigos HTTP, identidade lógica (`owner`, `anonymous` ou `challenger`), presença booleana do marcador, duração e atributos dos cookies. Nomes de cookies são anonimizados e seus valores são descartados. A observação de flags de cookies não equivale a uma auditoria completa do ciclo de vida da sessão.

A interface exporta o resultado do Lab em JSON com URLs e prefixos ocultados. Os relatórios HTTP existentes em PDF, HTML e JSON continuam separados. Uma execução em andamento não pode ser exportada. Excluir um projeto remove seus registros de Lab associados; isso não promete apagamento forense de backups ou cópias já exportadas.

## Interromper e repetir

Use **Interromper laboratório** durante uma execução. O cancelamento interrompe o fluxo de rede local e impede novas requisições; os metadados das requisições já iniciadas permanecem na auditoria. Fechar normalmente o aplicativo solicita o cancelamento do worker. Após um encerramento inesperado, o histórico pendente fica marcado como interrompido e inconclusivo.

**GET não garante ausência de efeitos no servidor.** Aplicações podem implementar rotas GET que alteram estado ou geram trabalho pesado. O Qypher não consegue desfazer uma requisição que o servidor já recebeu; interromper o cliente também não garante interromper um processamento remoto. Por isso, use rotas sintéticas conhecidas e um ambiente descartável ou homologação preparada pelo proprietário.

Depois da correção, execute novamente o mesmo cenário com novas credenciais de teste quando necessário. Confira a baseline, o comportamento esperado, o observado e a cobertura. Amplie os testes da própria aplicação para outras rotas, ações de escrita e combinações de papéis; essas operações não são executadas por este módulo.

## Referências

- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): negar por padrão e validar permissões em cada requisição.
- [OWASP WSTG — Bypassing Authorization Schema, WSTG-ATHZ-02](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/05-Authorization/02-Bypassing_Authorization_Schema/): revisão dos controles de autorização por identidade e papel.

As referências orientam a metodologia. Este módulo não implementa todos os testes do WSTG nem representa certificação OWASP ou ASVS.
