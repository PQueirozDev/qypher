# Integração OWASP ZAP — especificação, não executada

O MVP não chama ZAP, não instala Java/ZAP nem inicia subprocessos. Não apresenta alertas ZAP simulados. Esta integração será opcional e independente do motor nativo.

## Investigação

A [API oficial](https://www.zaproxy.org/docs/api/) permite consultar versão, progresso da fila passiva e alertas. A API deve escutar apenas loopback e exigir chave; não desabilitar a chave nem expor `0.0.0.0`. A chave será mantida em keyring do SO quando o suporte de credenciais existir e excluída de logs/relatórios. O adapter deve reconhecer versões e schemas suportados, com teste de contrato antes de habilitar uma versão.

O [Automation Framework](https://www.zaproxy.org/docs/desktop/addons/automation-framework/) usa planos YAML e jobs. [`passiveScan-wait`](https://www.zaproxy.org/docs/desktop/addons/automation-framework/job-pscanwait/) espera a fila existente; não gera tráfego nem descobre URLs sozinho. O tráfego deve ser importado ou capturado sob o mesmo escopo autorizado. Spider, AJAX spider e activeScan não entram no modo passivo por padrão.

## Condições de implementação

- Usuário seleciona explicitamente instalação/endpoint local e conhece requisitos de Java/memória da versão escolhida; medir consumo e exibir antes da execução.
- Allowlist de origem/caminho reaplicada aos alertas; nenhum comando ou YAML proveniente de alvos é executado.
- Processo externo, se gerenciado, recebe argumentos fixos, diretório temporário isolado e limites; cancelamento encerra somente o processo criado e seus filhos.
- Política DNS/egress precisa cobrir tráfego do ZAP. Proxy no ZAP não pode contornar a proteção SSRF do Qypher.
- Guardar ID da regra, versão, confidence e evidence redigida; não converter alertas de baixa confiança em vulnerabilidades confirmadas automaticamente.

Não há versão mínima declarada como testada neste MVP. Fixar uma versão suportada e seus add-ons será requisito antes da implementação.
