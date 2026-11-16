# Distribuição e assinatura

## Pacotes locais

Os ícones PNG/ICO/ICNS são versionados; `npm run icons` os regenera com Node, sem rede. O ícone SVG fonte fica em `apps/desktop/app-icon.svg`.

- Windows 10/11: `npm run desktop:build`, NSIS por usuário em `target/release/bundle/nsis/`. Para MSI, no Windows, execute `npm run desktop:build -- --bundles msi`; é necessário o recurso opcional VBSCRIPT para o WiX. WebView2 pode ser instalado pelo bootstrapper durante a instalação, com rede, se ausente. Para ambiente offline, forneça o runtime pelos procedimentos oficiais, sem desabilitar validação.
- Linux: `npm run desktop:build -- --bundles appimage,deb` no Linux com dependências WebKitGTK. Artefatos em `target/release/bundle/`.
- macOS: `npm run desktop:build -- --bundles dmg` no macOS com Xcode Command Line Tools. ARM64 e Intel precisam de builds próprios ou um universal validado.

Fonte oficial: [Windows Installer](https://v2.tauri.app/distribute/windows-installer/) e [distribuição Tauri](https://v2.tauri.app/distribute/). Os comandos só produzem artefatos depois de dependências e compilação bem-sucedidas. **Nenhum instalador foi gerado neste ambiente restrito.**

## Pipeline

`.github/workflows/ci.yml` executa frontend, testes e compilação nos três SOs. `.github/workflows/packages.yml` é acionado manualmente e só envia artefatos privados da execução do GitHub Actions. Não cria release, tag, publicação ou assinatura automática. Após revisar os lockfiles e executar testes, o mantenedor pode baixar, validar e autorizar a publicação separadamente.

O pipeline inicial usa `npm install` e Cargo sem `--locked` porque os lockfiles ainda não puderam ser resolvidos aqui. Isso está explicitamente marcado como bloqueador da primeira release. Após versioná-los, os workflows usam automaticamente `npm ci`/`--locked`.

## Windows

Distribuição confiável deve usar assinatura Authenticode, identidade verificada, timestamp e certificado ou serviço de assinatura. O certificado precisa ficar em hardware/serviço ou armazenamento de secrets, nunca no repositório. Certificados OV/EV e serviços de assinatura têm cobranças variáveis por fornecedor, região e volume; obtenha uma cotação antes de contratar. Assinatura não é garantia imediata de reputação SmartScreen. [Procedimento oficial Tauri](https://v2.tauri.app/distribute/sign/windows/).

Sem identidade/certificado fornecidos, este projeto prepara somente pacotes de desenvolvimento não assinados. Nenhuma compra é necessária para compilar e testar localmente.

## macOS

Distribuição fora da App Store normalmente requer Developer ID, hardened runtime, assinatura dos componentes e notarização com credenciais Apple, seguidos de stapling. O Apple Developer Program tem taxa de associação; preços locais/exceções podem variar, confirme no [programa oficial](https://developer.apple.com/programs/). Credenciais da API App Store Connect devem ficar no secret store do CI e com escopo mínimo. Assinatura ad-hoc não equivale a notarização nem elimina avisos do Gatekeeper. [Procedimento oficial Tauri](https://v2.tauri.app/distribute/sign/macos/).

## Checklist de release

Confirmar versão/licença/identificador, gerar e revisar lockfiles, executar CI + validação desktop manual, auditar dependências, abrir PDFs e verificar paginação, validar instalação/desinstalação no Windows 10/11, gerar checksums e SBOM, obter aprovação do mantenedor para assinatura e publicação. Atualizações automáticas estão fora do MVP.
