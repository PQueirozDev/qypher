# Contribuir com Qypher

Leia [arquitetura](docs/ARCHITECTURE.md), [desenvolvimento](docs/DEVELOPMENT.md) e [modelo de ameaças](docs/THREAT_MODEL.md). Discuta mudanças de protocolo, credenciais e scanners ativos antes de implementá-las. Pequenas correções podem ir diretamente para revisão.

Use branch por mudança e commits descritivos. Não reescreva módulos funcionais fora do escopo. Rust: rustfmt/Clippy; TypeScript: strict, ESLint e Prettier; componentes pequenos, hooks sem efeitos de rede duplicados e HTML semântico. Não introduza dependências sem justificar manutenção, licença e custo de distribuição.

Inclua evidência de validação: `npm run build`, `npm test`, `npm run lint`, `npm run test:e2e`, `cargo test`, `cargo clippy --all-targets -- -D warnings` e `cargo fmt --all -- --check`, conforme o alcance da mudança. Registre qualquer bloqueio; não descreva um teste não executado como aprovado. Código de rede exige fixtures locais e regressões para escopo, timeout, cancelamento e destinos especiais.

Não envie segredos, dados de clientes ou alvos não autorizados em fixtures, screenshots, issues ou relatórios. Use domínios reservados e loopback. Detectores precisam de cobertura e recomendações, sem CVE/CVSS presumido. Versões de detectores devem mudar quando sua semântica mudar. Atualize migrations, contratos TypeScript/Rust, changelog e documentação juntos.

Pull requests devem explicar o problema, comportamento resultante, testes executados e limites. Ao trabalhar em paralelo, divida por módulos ou worktrees e não edite os mesmos arquivos simultaneamente. Alterações em fronteiras de confiança exigem revisão de segurança de outro mantenedor antes de release.

Ao contribuir, você disponibiliza suas alterações sob Apache-2.0 e concorda com o [código de conduta](CODE_OF_CONDUCT.md). Não há CLA adicional nesta etapa.
