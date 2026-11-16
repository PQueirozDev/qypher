use crate::Dependency;
use std::collections::BTreeSet;

/// Identifiers are external data too: never persist or send recognized credentials as package names.
pub fn metadata_has_credential(value: &str) -> bool {
    crate::secrets::analyze_line("dependency-metadata", value, 1, false).is_some()
}

fn exact(version: &str, ecosystem: &str) -> bool {
    if version.is_empty()
        || version.len() > 100
        || !version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".+_-!".contains(&b))
    {
        return false;
    }
    if ecosystem == "PyPI" {
        return version.as_bytes()[0].is_ascii_digit();
    }
    let base = version.split(['-', '+']).next().unwrap_or("");
    let parts: Vec<_> = base.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
}

fn add(
    out: &mut Vec<Dependency>,
    ecosystem: &str,
    name: &str,
    version: &str,
    path: &str,
    source: &str,
) {
    if out.len() >= 20_000 {
        return;
    }
    let valid_shape = if ecosystem == "npm" {
        if let Some(scoped) = name.strip_prefix('@') {
            scoped.split_once('/').is_some_and(|(scope, package)| {
                !scope.is_empty()
                    && !package.is_empty()
                    && !package.contains(['/', '@'])
                    && !scope.contains('@')
            })
        } else {
            !name.contains(['/', '@'])
        }
    } else if ecosystem == "Go" || ecosystem == "Packagist" {
        // Módulos Go (host/caminho) e pacotes Packagist (vendor/pacote) usam "/".
        !name.contains('@') && name.split('/').all(|segment| !segment.is_empty())
    } else {
        !name.contains(['/', '@'])
    };
    if !valid_shape
        || name.is_empty()
        || name.len() > 200
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"@/_.-".contains(&b))
        || !exact(version, ecosystem)
    {
        return;
    }
    out.push(Dependency {
        ecosystem: ecosystem.into(),
        name: name.into(),
        version: version.into(),
        path: path.into(),
        version_source: source.into(),
    });
}

fn unquote(value: &str) -> &str {
    value.trim().trim_matches(['\'', '"'])
}

fn npm_selector(selector: &str) -> Option<(&str, &str)> {
    let index = selector.char_indices().skip(1).find(|(_, c)| *c == '@')?.0;
    Some((&selector[..index], &selector[index + 1..]))
}

fn pnpm(path: &str, text: &str, out: &mut Vec<Dependency>) -> Result<(), String> {
    let format = text
        .lines()
        .find_map(|line| line.trim().strip_prefix("lockfileVersion:").map(unquote))
        .ok_or("pnpm-lock sem lockfileVersion reconhecido")?;
    if !matches!(format.split('.').next(), Some("5" | "6" | "9")) {
        return Err("Versão pnpm-lock não suportada; cobertura incompleta.".into());
    }
    let mut packages = false;
    for line in text.lines() {
        if !line.starts_with([' ', '\t']) && !line.trim().is_empty() {
            packages = line.trim() == "packages:" || line.trim() == "packages: {}";
            continue;
        }
        if !packages
            || !line.starts_with("  ")
            || line.starts_with("   ")
            || !line.trim().ends_with(':')
        {
            continue;
        }
        let key = unquote(line.trim().trim_end_matches(':')).trim_start_matches('/');
        let key = key.split('(').next().unwrap_or("");
        let candidate = if format.starts_with('5') {
            key.rsplit_once('/')
        } else {
            key.rsplit_once('@').filter(|(name, _)| !name.is_empty())
        };
        if let Some((name, version)) = candidate {
            let version = version.split(['(', '_']).next().unwrap_or("");
            add(out, "npm", name, version, path, "lockfile");
        }
    }
    Ok(())
}

fn yarn(path: &str, text: &str, out: &mut Vec<Dependency>) -> Result<(), String> {
    if !text.contains("yarn lockfile v1")
        && !text.lines().any(|line| line.starts_with("__metadata:"))
    {
        return Err("Formato yarn.lock não reconhecido; cobertura incompleta.".into());
    }
    let mut package = None;
    for line in text.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        if !line.starts_with([' ', '\t']) {
            let selector = unquote(
                line.trim()
                    .trim_end_matches(':')
                    .split(',')
                    .next()
                    .unwrap_or(""),
            );
            package = npm_selector(selector)
                .filter(|(_, spec)| {
                    ![
                        "workspace:",
                        "file:",
                        "link:",
                        "portal:",
                        "https:",
                        "http:",
                        "git:",
                    ]
                    .iter()
                    .any(|prefix| spec.starts_with(prefix))
                })
                .map(|(name, spec)| {
                    spec.strip_prefix("npm:")
                        .and_then(npm_selector)
                        .map(|(actual, _)| actual)
                        .unwrap_or(name)
                        .to_string()
                });
        } else if let Some(name) = &package {
            let trimmed = line.trim();
            if let Some(version) = trimmed
                .strip_prefix("version:")
                .or_else(|| trimmed.strip_prefix("version "))
            {
                add(out, "npm", name, unquote(version), path, "lockfile");
            }
        }
    }
    Ok(())
}

pub fn inventory(path: &str, text: &str) -> Result<Vec<Dependency>, String> {
    let filename = path.rsplit('/').next().unwrap_or(path);
    let mut out = vec![];
    match filename {
        "package-lock.json" => {
            let value: serde_json::Value =
                serde_json::from_str(text).map_err(|_| "package-lock.json inválido")?;
            let packages = value
                .get("packages")
                .and_then(|v| v.as_object())
                .ok_or("Apenas package-lock v2/v3 com packages é suportado.")?;
            for (key, package) in packages {
                if let (Some((_, fallback)), Some(version)) = (
                    key.rsplit_once("node_modules/"),
                    package.get("version").and_then(|v| v.as_str()),
                ) {
                    if package.get("link").and_then(|v| v.as_bool()) == Some(true) {
                        continue;
                    }
                    add(
                        &mut out,
                        "npm",
                        package
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or(fallback),
                        version,
                        path,
                        "lockfile",
                    );
                }
            }
        }
        "package.json" => {
            let value: serde_json::Value =
                serde_json::from_str(text).map_err(|_| "package.json inválido")?;
            if !value.is_object() {
                return Err("package.json deve ser um objeto".into());
            }
            for section in ["dependencies", "devDependencies", "optionalDependencies"] {
                if value
                    .get(section)
                    .is_some_and(|section| !section.is_object())
                {
                    return Err("Seção de dependências package.json inválida".into());
                }
                if let Some(dependencies) = value.get(section).and_then(|v| v.as_object()) {
                    for (name, version) in dependencies {
                        if !version.is_string() {
                            return Err("Versão package.json não é texto".into());
                        }
                        if let Some(version) = version.as_str() {
                            add(
                                &mut out,
                                "npm",
                                name,
                                version.strip_prefix('=').unwrap_or(version),
                                path,
                                "manifest_pin",
                            );
                        }
                    }
                }
            }
        }
        "pnpm-lock.yaml" => pnpm(path, text, &mut out)?,
        "yarn.lock" => yarn(path, text, &mut out)?,
        "Cargo.lock" => {
            let value: toml::Value = toml::from_str(text).map_err(|_| "Cargo.lock inválido")?;
            if let Some(packages) = value.get("package").and_then(|v| v.as_array()) {
                for package in packages {
                    let official =
                        package
                            .get("source")
                            .and_then(|v| v.as_str())
                            .is_some_and(|source| {
                                matches!(
                                    source,
                                    "registry+https://github.com/rust-lang/crates.io-index"
                                        | "registry+https://index.crates.io/"
                                        | "sparse+https://index.crates.io/"
                                )
                            });
                    if !official {
                        continue;
                    }
                    if let (Some(name), Some(version)) = (
                        package.get("name").and_then(|v| v.as_str()),
                        package.get("version").and_then(|v| v.as_str()),
                    ) {
                        add(&mut out, "crates.io", name, version, path, "lockfile");
                    }
                }
            }
        }
        "poetry.lock" => {
            let value: toml::Value = toml::from_str(text).map_err(|_| "poetry.lock inválido")?;
            let packages = value
                .get("package")
                .and_then(|v| v.as_array())
                .ok_or("poetry.lock sem package reconhecido")?;
            for package in packages {
                if package.get("source").is_some() {
                    continue;
                }
                if let (Some(name), Some(version)) = (
                    package.get("name").and_then(|v| v.as_str()),
                    package.get("version").and_then(|v| v.as_str()),
                ) {
                    add(&mut out, "PyPI", name, version, path, "lockfile");
                }
            }
        }
        "requirements.txt" => {
            if text.lines().any(|line| {
                let line = line.trim();
                line.starts_with('-')
            }) {
                return Err("Índices ou includes de requirements exigem resolução separada; nenhum pacote desse arquivo foi atribuído automaticamente ao PyPI.".into());
            }
            for line in text.lines() {
                let spec = line.split(';').next().unwrap_or("").trim();
                if spec.starts_with('#') {
                    continue;
                }
                if let Some((name, version)) = spec.split_once("==") {
                    let name = name.trim();
                    let name = match name.split_once('[') {
                        Some((base, extras)) if extras.ends_with(']') => base,
                        Some(_) => continue,
                        None => name,
                    };
                    add(
                        &mut out,
                        "PyPI",
                        name,
                        version.split_whitespace().next().unwrap_or(""),
                        path,
                        "requirement_pin",
                    );
                }
            }
        }
        "go.sum" => {
            for line in text.lines() {
                let mut parts = line.split_whitespace();
                let (Some(name), Some(version)) = (parts.next(), parts.next()) else {
                    continue;
                };
                // Linhas "<versão>/go.mod" repetem o pacote; a dedup cuida do resto.
                let version = version.strip_suffix("/go.mod").unwrap_or(version);
                add(&mut out, "Go", name, version.trim_start_matches('v'), path, "lockfile");
            }
        }
        "composer.lock" => {
            let value: serde_json::Value =
                serde_json::from_str(text).map_err(|_| "composer.lock inválido")?;
            for key in ["packages", "packages-dev"] {
                if let Some(list) = value.get(key).and_then(|p| p.as_array()) {
                    for pkg in list {
                        if let (Some(name), Some(version)) = (
                            pkg.get("name").and_then(|v| v.as_str()),
                            pkg.get("version").and_then(|v| v.as_str()),
                        ) {
                            add(&mut out, "Packagist", name, version.trim_start_matches('v'), path, "lockfile");
                        }
                    }
                }
            }
        }
        "Gemfile.lock" => {
            // Seção GEM: pacotes aparecem como "    nome (versão)" sob "specs:".
            let mut in_specs = false;
            for line in text.lines() {
                let trimmed = line.trim_end();
                if trimmed.trim() == "specs:" {
                    in_specs = true;
                    continue;
                }
                // Uma nova seção sem indentação encerra o bloco de specs.
                if in_specs && !line.starts_with(' ') && !trimmed.is_empty() {
                    in_specs = false;
                }
                // Só as linhas com 4 espaços (dependências diretas da specs) contam.
                if in_specs && line.starts_with("    ") && !line.starts_with("      ") {
                    let entry = line.trim();
                    if let Some((name, rest)) = entry.split_once(" (") {
                        if let Some(version) = rest.strip_suffix(')') {
                            add(&mut out, "RubyGems", name.trim(), version.trim(), path, "lockfile");
                        }
                    }
                }
            }
        }
        _ => {}
    }
    if out.len() >= 20_000 {
        return Err(
            "Arquivo excedeu o limite de entradas de dependências; a cobertura é parcial.".into(),
        );
    }
    if out.iter().any(|dependency| {
        metadata_has_credential(&dependency.name) || metadata_has_credential(&dependency.version)
    }) {
        return Err("Identificador de dependência contém possível credencial; os valores foram descartados e a cobertura é parcial.".into());
    }
    let mut seen = BTreeSet::new();
    out.retain(|dependency| {
        seen.insert((
            dependency.ecosystem.clone(),
            dependency.name.clone(),
            dependency.version.clone(),
        ))
    });
    Ok(out)
}

pub struct Inventory {
    pub dependencies: Vec<Dependency>,
    pub unresolved: Vec<(String, String)>,
}

pub fn analyze_inventory(path: &str, text: &str) -> Result<Inventory, String> {
    let dependencies = inventory(path, text)?;
    let filename = path.rsplit('/').next().unwrap_or(path);
    let mut unresolved = BTreeSet::new();
    match filename {
        "package.json" => {
            let value: serde_json::Value =
                serde_json::from_str(text).map_err(|_| "package.json inválido")?;
            for section in ["dependencies", "devDependencies", "optionalDependencies"] {
                if let Some(object) = value.get(section).and_then(|value| value.as_object()) {
                    for (name, version) in object {
                        let version = version.as_str().unwrap_or("");
                        if !exact(version.strip_prefix('=').unwrap_or(version), "npm") {
                            unresolved.insert(("npm".into(), name.clone()));
                        }
                    }
                }
            }
        }
        "requirements.txt" => {
            for line in text.lines() {
                let line = line.split(';').next().unwrap_or("").trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let name = line
                    .split(['<', '>', '=', '!', '~', '[', ' '])
                    .next()
                    .unwrap_or("")
                    .trim();
                if !dependencies
                    .iter()
                    .any(|dependency| dependency.name == name)
                {
                    unresolved.insert(("PyPI".into(), name.into()));
                }
            }
        }
        "Cargo.lock" => {
            let value: toml::Value = toml::from_str(text).map_err(|_| "Cargo.lock inválido")?;
            if value
                .get("package")
                .and_then(|value| value.as_array())
                .is_some_and(|packages| {
                    packages.iter().any(|package| {
                        package
                            .get("source")
                            .and_then(|value| value.as_str())
                            .is_some_and(|source| {
                                !matches!(
                                    source,
                                    "registry+https://github.com/rust-lang/crates.io-index"
                                        | "registry+https://index.crates.io/"
                                        | "sparse+https://index.crates.io/"
                                )
                            })
                    })
                })
            {
                unresolved.insert(("crates.io".into(), String::new()));
            }
        }
        "poetry.lock" => {
            let value: toml::Value = toml::from_str(text).map_err(|_| "poetry.lock inválido")?;
            if value
                .get("package")
                .and_then(|value| value.as_array())
                .is_some_and(|packages| {
                    packages
                        .iter()
                        .any(|package| package.get("source").is_some())
                })
            {
                unresolved.insert(("PyPI".into(), String::new()));
            }
        }
        "package-lock.json" => {
            let value: serde_json::Value =
                serde_json::from_str(text).map_err(|_| "package-lock inválido")?;
            if value
                .get("packages")
                .and_then(|value| value.as_object())
                .is_some_and(|packages| {
                    packages.values().any(|package| {
                        package.get("link").and_then(|value| value.as_bool()) == Some(true)
                    })
                })
            {
                unresolved.insert(("npm".into(), String::new()));
            }
        }
        "pnpm-lock.yaml" | "yarn.lock"
            if [
                "workspace:",
                "link:",
                "file:",
                "portal:",
                "@https:",
                "@git:",
            ]
            .iter()
            .any(|marker| text.contains(marker)) =>
        {
            unresolved.insert(("npm".into(), String::new()));
        }
        _ => {}
    }
    Ok(Inventory {
        dependencies,
        unresolved: unresolved.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_like_package_names_never_enter_the_inventory() {
        let token = ["ghp_", "abcdefghijklmnopqrstuvwxyz1234567890"].concat();
        let input = serde_json::json!({"dependencies":{token.clone():"1.2.3"}}).to_string();
        let error = inventory("package.json", &input).unwrap_err();
        assert!(!error.contains(&token));
        assert!(inventory(
            "package.json",
            r#"{"dependencies":{"safe-package":"1.2.3"}}"#
        )
        .is_ok());
    }
    #[test]
    fn scoped_npm_and_python_pins_are_not_ranges() {
        let packages = inventory("package-lock.json", r#"{"packages":{"node_modules/@scope/pkg":{"version":"1.2.3"},"node_modules/pkg/node_modules/child":{"version":"2.0.0"}}}"#).unwrap();
        assert_eq!(packages[0].name, "@scope/pkg");
        let python = inventory(
            "requirements.txt",
            "requests[socks]==2.32.0\nrange>=1\nwildcard==1.*\n# comment",
        )
        .unwrap();
        assert_eq!(python.len(), 1);
        assert_eq!(python[0].name, "requests");
    }
    #[test]
    fn pnpm_scoped_packages_and_peer_suffixes_are_resolved() {
        for version in ["6.0", "9.0"] {
            let input = format!("lockfileVersion: '{version}'\npackages:\n  '@scope/pkg@1.2.3(peer@2.0.0)':\n    resolution: {{integrity: abc}}\n  foo@2.1.0:\n    resolution: {{integrity: def}}\nsnapshots:\n  ignore@4.0.0: {{}}\n");
            let packages = inventory("pnpm-lock.yaml", &input).unwrap();
            assert_eq!(packages.len(), 2);
            assert_eq!(packages[0].name, "@scope/pkg");
            assert_eq!(packages[0].version, "1.2.3");
        }
        assert!(inventory("pnpm-lock.yaml", "lockfileVersion: '99.0'").is_err());
    }
    #[test]
    fn classic_and_berry_yarn_formats_keep_exact_versions() {
        let classic = "# yarn lockfile v1\n\"@scope/pkg@^1.0.0\", \"@scope/pkg@~1.2.0\":\n  version \"1.2.3\"\n  resolved \"https://registry.npmjs.org/x\"\n";
        let berry = "__metadata:\n  version: 8\n\"@scope/pkg@npm:^1.0.0\":\n  version: 1.2.3\n  resolution: \"@scope/pkg@npm:1.2.3\"\n";
        for input in [classic, berry] {
            let packages = inventory("yarn.lock", input).unwrap();
            assert_eq!(packages.len(), 1);
            assert_eq!(packages[0].name, "@scope/pkg");
            assert_eq!(packages[0].version, "1.2.3");
        }
    }
    #[test]
    fn poetry_and_cargo_do_not_mislabel_private_registry_packages() {
        let cargo = "[[package]]\nname='public-package'\nversion='1.2.3'\nsource='registry+https://github.com/rust-lang/crates.io-index'\n[[package]]\nname='private-package'\nversion='9.0.0'\nsource='registry+https://private.invalid/index'\n";
        let packages = inventory("Cargo.lock", cargo).unwrap();
        assert_eq!(packages.len(), 1);
        let poetry = "[[package]]\nname='requests'\nversion='2.32.0'\n[[package]]\nname='private-package'\nversion='1.0.0'\n[package.source]\ntype='legacy'\nurl='https://private.invalid/simple'\n";
        let packages = inventory("poetry.lock", poetry).unwrap();
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].name, "requests");
    }
    #[test]
    fn go_composer_and_gemfile_lockfiles_are_inventoried() {
        let go = "github.com/pkg/errors v0.9.1 h1:abc\ngithub.com/pkg/errors v0.9.1/go.mod h1:def\ngolang.org/x/net v0.17.0 h1:ghi\n";
        let packages = inventory("go.sum", go).unwrap();
        assert!(packages.iter().any(|d| d.ecosystem == "Go" && d.name == "github.com/pkg/errors" && d.version == "0.9.1"));
        assert!(packages.iter().any(|d| d.name == "golang.org/x/net" && d.version == "0.17.0"));
        // A versão e a linha /go.mod são o mesmo pacote: sem duplicata.
        assert_eq!(packages.iter().filter(|d| d.name == "github.com/pkg/errors").count(), 1);

        let composer = r#"{"packages":[{"name":"monolog/monolog","version":"2.9.1"}],"packages-dev":[{"name":"phpunit/phpunit","version":"9.6.0"}]}"#;
        let packages = inventory("composer.lock", composer).unwrap();
        assert!(packages.iter().any(|d| d.ecosystem == "Packagist" && d.name == "monolog/monolog" && d.version == "2.9.1"));
        assert!(packages.iter().any(|d| d.name == "phpunit/phpunit"));

        let gemfile = "GEM\n  remote: https://rubygems.org/\n  specs:\n    rails (7.1.0)\n    rack (3.0.8)\n      other-dep (= 1.0)\n\nPLATFORMS\n  ruby\n";
        let packages = inventory("Gemfile.lock", gemfile).unwrap();
        assert!(packages.iter().any(|d| d.ecosystem == "RubyGems" && d.name == "rails" && d.version == "7.1.0"));
        assert!(packages.iter().any(|d| d.name == "rack" && d.version == "3.0.8"));
        // A dependência transitiva indentada com 6 espaços não entra.
        assert!(!packages.iter().any(|d| d.name == "other-dep"));
    }
    #[test]
    fn manifests_distinguish_declared_pins_and_never_resolve_ranges_or_urls() {
        let packages = inventory("package.json", r#"{"dependencies":{"pin":"1.2.3","range":"^1.2.3","tag":"latest","url":"https://host.invalid/pkg.tgz","workspace":"workspace:*"}}"#).unwrap();
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].version_source, "manifest_pin");
        assert!(inventory("package.json", "[]").is_err());
    }

    #[test]
    fn ranges_and_custom_indexes_are_never_complete_dependency_coverage() {
        let manifest =
            analyze_inventory("package.json", r#"{"dependencies":{"express":"^4.0.0"}}"#).unwrap();
        assert!(manifest.dependencies.is_empty());
        assert_eq!(manifest.unresolved, vec![("npm".into(), "express".into())]);
        assert_eq!(
            analyze_inventory("requirements.txt", "requests>=2")
                .unwrap()
                .unresolved
                .len(),
            1
        );
        for flag in ["-i", "-f", "-c", "--no-index"] {
            assert!(inventory(
                "requirements.txt",
                &format!("{flag} https://private.invalid/simple\nprivatepkg==1.2.3")
            )
            .is_err());
        }
    }

    #[test]
    fn duplicate_entries_cannot_hide_inventory_truncation() {
        assert!(inventory("requirements.txt", &"same-package==1.2.3\n".repeat(20_001)).is_err());
    }
}
