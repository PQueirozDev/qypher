# Qypher workbench — evolução desktop

O produto é um aplicativo Tauri local. O renderer React faz parte da janela desktop; Vite é somente a ferramenta de desenvolvimento. O site de apresentação é um projeto futuro separado.

## Experiência

Barra de título própria com controles reais da janela, navegação compacta, abas, explorador de alvos, evidências com linhas numeradas e console persistente. A paleta e o console aceitam comandos internos documentados, nunca comandos arbitrários do sistema. Animações indicam abertura de painéis, foco, chegada de logs e execução; respeitam `prefers-reduced-motion`. Não há tráfego, números, logs ou progresso simulados.

## Auditoria de código-fonte

Novo crate `scanner-source`, separado de HTTP e acessibilidade. A pasta é selecionada pelo diálogo nativo e vinculada a um token da sessão. O frontend não escolhe caminhos arbitrários via IPC. Não há execução do repositório, instalação de dependências, hooks Git, scripts de build ou submódulos. Repositórios do GitHub são analisados a partir de uma cópia local escolhida pelo usuário; nenhum clone/download é iniciado automaticamente.

Módulos independentes: triagem lexical de código inseguro, possíveis segredos, indicadores de código suspeito, inventário de versões resolvidas, consulta OSV opcional e integração ClamAV opcional. Triagem lexical não equivale a análise semântica ou comprovação de exploração. Indicador suspeito não é diagnóstico de malware. Um antivírus sem detecções também não comprova ausência de ameaças.

Limites: número de arquivos, bytes por arquivo, total lido, profundidade e tempo. Não seguir symlinks/reparse points, nem percorrer `.git`, diretórios de dependências ou artefatos de build. Arquivos ignorados, erros, limites e módulos não executados aparecem na cobertura. Segredos e conteúdo integral do código não são persistidos; evidências registram regra, arquivo relativo e linha.

OSV consulta somente nomes/ecossistemas/versões após consentimento específico, sem código ou credenciais. Endpoint fixo HTTPS, sem proxy de ambiente, DNS validado, redirecionamentos desativados e respostas limitadas. CVEs/GHSAs só aparecem quando retornados pela base, sem inventar CVSS. ClamAV usa executável em localização conhecida, argumentos fixos e entrada TAR em memória com nomes anônimos e apenas os arquivos elegíveis. Não recebe uma pasta irrestrita nem argumentos retornados pelo alvo. Não há shell, remoção ou quarentena solicitada pelo Qypher. Cancelamento e timeout encerram e aguardam o processo filho; o fechamento normal do aplicativo aguarda a rotina de cancelamento.

O ClamAV precisa ser instalado explicitamente e ter assinaturas atualizadas. Seus limites de descompressão são distintos da leitura textual: a entrada agrega os arquivos elegíveis com overhead TAR; o orçamento de expansão é limitado pela entrada mais o total configurado. Alertas de limite também precisam de revisão. O relatório não atesta limpeza integral. A biblioteca do antivírus pode usar temporários internamente; o Qypher não grava o fluxo de código em arquivos temporários próprios.

Histórico Git, diretórios de dependências/build, arquivos grandes, binários para triagem textual e formatos de lockfile não suportados ficam fora da cobertura. O inventário preserva no máximo 2.000 versões e o OSV consulta até 500. A triagem emite até 200 achados por arquivo e 5.000 no total, marcando truncamento; o antivírus pode acrescentar um alerta agregado. A UI pagina todos os achados e dependências persistidos, com busca e filtros combinados de categoria e severidade. JSON e SARIF exportam a execução salva completa, com ocultação de caminhos habilitada por padrão. Consulte [SOURCE_REPORTS.md](SOURCE_REPORTS.md) para formatos, cobertura e uso. Logs locais de código mantêm as últimas 200 entradas e os eventos do worker são limitados a quatro por segundo. Cancelamento da leitura de arquivos é cooperativo entre operações locais; não interrompe uma chamada de I/O bloqueada pelo SO.

## Persistência e limites da entrega

Migration 002 para execuções de código, sem misturar achados web e estáticos. Resultados parciais/cancelados continuam explicitamente parciais. Não existe promessa de encontrar todas as vulnerabilidades, testar todos os caminhos ou identificar todo malware. A compilação nativa depende do toolchain MSVC e do acesso aos registries, conforme `DELIVERY.md`.

Fontes técnicas: [OSV API](https://google.github.io/osv.dev/post-v1-querybatch/), [ClamAV](https://docs.clamav.net/manual/Usage/Scanning.html), [Tauri window](https://v2.tauri.app/reference/javascript/api/namespacewindow/), [CWE](https://cwe.mitre.org/).
