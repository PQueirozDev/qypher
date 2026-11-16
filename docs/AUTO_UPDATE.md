# Atualização automática

O Qypher usa o atualizador do Tauri: o aplicativo verifica as releases do GitHub e, quando há
uma versão nova assinada, baixa e instala sozinho. Para isso funcionar são necessários uma
**chave de assinatura** (gerada uma única vez) e o **workflow de release** (já incluído em
`.github/workflows/release.yml`).

> O ambiente onde este repositório foi montado não tem o CLI do Tauri, então a chave **não**
> pôde ser gerada aqui. Os passos abaixo são feitos uma vez, na sua máquina.

## 1. Gerar a chave de assinatura

Com o [CLI do Tauri](https://v2.tauri.app/) disponível (via `npm`/`cargo`):

```bash
npm install -g @tauri-apps/cli
tauri signer generate -w ./qypher-updater.key
```

O comando imprime a **chave pública** (`untrusted comment: ...`) e grava a **chave privada** em
`qypher-updater.key`. Guarde a senha escolhida. Nunca faça commit da chave privada
(ela já está coberta por `*.key` no `.gitignore`).

## 2. Apontar o aplicativo para o atualizador

No `apps/desktop/src-tauri/tauri.conf.json`, adicione (trocando `SUA_CHAVE_PUBLICA`):

```jsonc
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "SUA_CHAVE_PUBLICA",
      "endpoints": [
        "https://github.com/PQueirozDev/qypher/releases/latest/download/latest.json"
      ]
    }
  }
}
```

E habilite o plugin no crate (`apps/desktop/src-tauri`):

```bash
cargo add tauri-plugin-updater
```

No `lib.rs`, registre o plugin no builder:

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
```

## 3. Guardar a chave privada como secret no GitHub

No repositório → **Settings → Secrets and variables → Actions**, crie:

- `TAURI_SIGNING_PRIVATE_KEY` — conteúdo do arquivo `qypher-updater.key`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — a senha definida na geração.

O workflow de release já lê esses secrets e assina os artefatos do atualizador.

## 4. Publicar uma versão

```bash
git tag v0.1.0
git push origin v0.1.0
```

O GitHub Actions compila os instaladores das três plataformas, assina os artefatos do
atualizador e cria uma **release em rascunho**. Revise e publique. A partir daí, versões
instaladas se atualizam sozinhas quando você publica uma tag maior.

## Sem a chave

Enquanto a chave não existir, o workflow ainda gera e publica os **instaladores** normalmente
(a seção de downloads do site já aponta para eles). Apenas a atualização automática fica
desligada até os passos 1–3 serem concluídos.
