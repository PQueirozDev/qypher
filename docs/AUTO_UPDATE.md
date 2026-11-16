# Atualização automática

O Qypher usa o atualizador do Tauri. O aplicativo instalado verifica as releases do GitHub ao
abrir e, quando há uma versão nova **assinada**, baixa e instala em segundo plano, reiniciando
com a versão atualizada. Já está tudo configurado:

- Par de chaves de assinatura **gerado**.
- Chave **pública** embutida em `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
- Endpoint apontando para as releases: `.../releases/latest/download/latest.json`.
- Plugin `tauri-plugin-updater` registrado, com verificação em segundo plano no `setup` (apenas em build de release).
- Secrets `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` **configurados** no repositório; o workflow de release (`.github/workflows/release.yml`) os usa para assinar os artefatos do atualizador.

## Publicar uma versão (dispara o auto-update)

```bash
git tag v0.1.0
git push origin v0.1.0
```

O GitHub Actions compila os instaladores das três plataformas, assina os artefatos do
atualizador, gera o `latest.json` e cria uma **release em rascunho**. Revise e publique. A partir
daí, as versões instaladas se atualizam sozinhas quando você publica uma tag maior.

## Guarde a chave privada

A chave privada e a senha foram gravadas localmente em `qypher-updater.key` e
`qypher-updater.pass` (ambos ignorados pelo git). **Guarde esses dois arquivos em local seguro.**
Se perdê-los, não será possível assinar novas atualizações para quem já instalou — seria preciso
gerar um novo par e redistribuir o aplicativo. Eles também estão como secrets no GitHub, mas
secrets não podem ser lidos de volta.

## Trocar a chave (se necessário)

```bash
cargo install tauri-cli --version "^2"      # se ainda não tiver
cargo tauri signer generate -p "SUA_SENHA" -w qypher-updater.key -f
```

Depois, atualize `pubkey` no `tauri.conf.json` com o conteúdo de `qypher-updater.key.pub` e
refaça os secrets `TAURI_SIGNING_PRIVATE_KEY` (conteúdo de `qypher-updater.key`) e
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
