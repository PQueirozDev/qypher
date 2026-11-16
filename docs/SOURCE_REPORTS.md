# Source Lab: revisão e exportação

O incremento atual inclui Leak Hunter contextual, Supabase/Firebase estáticos, novos lockfiles, revisão reversível de falsos positivos, comparação por identidade de escopo e verificação pré-deploy. Consulte [EVOLUTION.md](EVOLUTION.md) para a cobertura e os limites atuais.

O Source Lab analisa uma cópia local autorizada sem executar seu código. Os achados de SAST são triagem lexical: exigem revisão da origem dos dados e não comprovam exploração. A busca de possíveis segredos também examina comentários; os valores encontrados não são copiados para as evidências.

## Revisar resultados

Selecione uma execução salva em **Análise de código**. A busca por título, regra ou caminho pode ser combinada com os filtros de categoria e severidade. Há 50 achados por página e 100 dependências por página; os controles mostram a página e o total da seleção. Alterar a busca, um filtro ou a execução retorna à primeira página.

A paginação permite acessar todos os resultados persistidos. Os limites do motor continuam separados: até 200 achados por arquivo, 5.000 achados de triagem no total e 2.000 versões de dependências. Truncamento e cobertura parcial não representam ausência de problemas.

## Exportar uma execução

1. Escolha uma execução finalizada.
2. Selecione **JSON nativo** ou **SARIF 2.1.0** no formato do relatório.
3. Mantenha **Ocultar nomes e caminhos no relatório** habilitado para compartilhar sem as localizações dos arquivos.
4. Clique em **Exportar relatório de código** e escolha o destino no diálogo nativo.

A exportação usa a execução salva completa, independentemente da página e dos filtros visuais. Execuções em andamento não podem ser exportadas. Execuções canceladas, interrompidas ou com falha podem ser exportadas com seu estado preservado. Cancelar o diálogo não grava um arquivo; erros de gravação são apresentados pela interface.

O JSON mantém o formato do snapshot existente, incluindo configuração, módulos, contadores, dependências e logs. A ocultação substitui o nome da raiz e os caminhos de achados e dependências em uma cópia; o histórico original permanece disponível no aplicativo.

## Campos SARIF

O formato segue a [especificação SARIF 2.1.0 com Errata 01](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html). O relatório contém um `run`, o driver `Qypher Source Lab`, regras únicas por ID e resultados com mensagem, evidência sanitizada, impacto, recomendação, referência, categoria, confiança e versão do detector.

| Severidade Qypher | Nível SARIF |
| ----------------- | ----------- |
| `high`            | `error`     |
| `medium`, `low`   | `warning`   |
| `info`, `unrated` | `note`      |

A severidade original permanece em `result.properties.severity`. `unrated` continua sem pontuação; não há geração de CVSS.

Com caminhos visíveis, `locations` usa URIs relativas codificadas em UTF-8 e a base simbólica `%SRCROOT%`. O leitor pode associar essa base ao checkout local. A raiz absoluta do computador não é exportada no SARIF. A linha só é incluída quando conhecida e começa em 1; alertas agregados do antivírus não recebem uma localização fictícia. Caminhos absolutos, referências a diretórios pais e localizações sintéticas não são convertidos em links de arquivo.

Com a ocultação habilitada, os resultados não possuem `locations`. Para navegar aos arquivos em um leitor compatível, desmarque essa opção antes de exportar. O Qypher apenas salva o arquivo localmente; não faz upload nem abre referências externas.

Os módulos e contadores acompanham o SARIF em `run.properties`. Cobertura parcial, arquivos ignorados, binários, erros e módulos indisponíveis geram notificações de execução. `executionSuccessful` é falso quando a execução não terminou normalmente ou um módulo retornou erro. Um valor verdadeiro significa que o processo concluiu; não atesta que o projeto está seguro ou que todos os arquivos foram examinados.

## Limites de leitura

Além dos limites de arquivos, bytes, profundidade e tempo, o total de diretórios descobertos, incluindo os que aguardam leitura, é limitado a `4 × maxFiles + 1024`. O limite é aplicado antes de inserir novos diretórios na fila. Diretórios excedentes são contabilizados como ignorados e a análise fica marcada como truncada. Binários não analisados textualmente também deixam a cobertura lexical parcial.

## Verificação

`cargo test --offline --locked -p scanner-source` cobre redação dos caminhos, ausência de segredos nos dois formatos, caracteres reservados em URIs, regras repetidas, linhas desconhecidas, resultados vazios, cancelamento, falhas, segredos em comentários e os limites de diretórios e binários.

`tests/e2e/source-results.spec.ts` cobre a navegação além dos antigos limites de exibição, filtros combinados, argumentos IPC da exportação, ocultação padrão, cancelamento, erro e acessibilidade automática. Esses testes usam um substituto de IPC exclusivamente nos testes. Eles não exercitam o diálogo de salvamento nem o WebView nativo; a validação manual dessas etapas continua necessária.
