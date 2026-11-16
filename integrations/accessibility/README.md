# Acessibilidade — contrato de módulo futuro

O aplicativo não executa axe-core contra os alvos neste MVP. A dependência axe-core em desenvolvimento é usada somente para testar a acessibilidade da própria interface web. Nenhum resultado WCAG do alvo é inventado.

Planejamento: Playwright em processo isolado, Chromium provisionado explicitamente, axe-core versionado e regras WCAG 2.2 aplicáveis. Cada resultado deve trazer rule ID, impact, seletor, trecho sanitizado, explicação, referência e exemplo de correção.

Antes de habilitar renderização, aplicar escopo/limites/DNS a todas as subrequisições, incluindo frames, workers, WebSockets e redirecionamentos. Bloquear file://, downloads, extensões e acesso aos dados do desktop. Uma interceptação `page.route` isolada não elimina DNS rebinding; o egress do processo precisa ser controlado. Remover listeners, temporários e processo inteiro ao cancelar. Nunca carregar o alvo na WebView Tauri privilegiada.

As regras automáticas podem detectar partes de contraste, alt, labels, hierarquia, semântica e ARIA, mas a conformidade WCAG exige avaliação manual. Resultados de acessibilidade não compartilham o score de severidade de segurança. Referências: [axe-core](https://github.com/dequelabs/axe-core), [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
