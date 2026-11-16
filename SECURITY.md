# Segurança e divulgação responsável

O Qypher 0.1.0 está em desenvolvimento e não tem release oficial validada. Só a linha de desenvolvimento atual recebe correções neste estágio. Não use como única barreira de segurança ou como prova de conformidade.

Use apenas alvos próprios ou explicitamente autorizados. O MVP não implementa exploração, brute force, persistência, evasão ou scans autenticados. Não solicite a inclusão de recursos destrutivos ou execução arbitrária de comandos.

## Reportar falhas do Qypher

Antes da publicação, o mantenedor deve habilitar **GitHub Private Vulnerability Reporting** no repositório real. Quando habilitado, use a aba Security → Report a vulnerability para relatos privados. **Esse canal ainda não foi configurado/verificado nesta entrega.** Não publique segredos, payloads com dados reais ou detalhes exploráveis em issues públicas. Caso não haja canal privado disponível, procure o mantenedor pelo contato privado verificado do repositório antes de transmitir detalhes.

Inclua versão/commit, SO/WebView, condições, passos mínimos usando fixture local, impacto e evidência sanitizada. Não execute testes sobre terceiros para demonstrar uma falha. Aguarde coordenação com o mantenedor antes da divulgação de detalhes sensíveis. Ainda não há SLA ou programa de recompensa.

Banco e relatórios são dados sensíveis. Sem criptografia de banco/backup neste MVP. Proteja o perfil do usuário e o disco; exclusão SQL não equivale a apagamento forense. Não ignore falhas de certificado TLS.
