use crate::model::{SourceFinding, SECRETS_DETECTOR_VERSION};
use scanner_core::Severity;
use sha2::{Digest, Sha256};

pub struct Rule {
    pub id: &'static str,
    pub category: &'static str,
    pub title: &'static str,
    pub needles: &'static [&'static str],
    pub extensions: &'static [&'static str],
    pub severity: Severity,
    pub impact: &'static str,
    pub fix: &'static str,
    pub cwe: &'static str,
}
pub fn registry() -> Vec<Rule> {
    [
        Rule {
            id: "js.eval",
            category: "sast",
            title: "Execução dinâmica com eval",
            needles: &["eval("],
            extensions: &["js","jsx","ts","tsx","mjs","cjs"],
            severity: Severity::Medium,
            impact: "Dados externos podem atingir execução de código. A origem dos dados não foi comprovada por esta regra lexical.",
            fix: "Substitua eval por parsing estrito (por exemplo JSON.parse), elimine interpretação de código e valide a estrutura dos dados.",
            cwe: "CWE-95",
        },
        Rule {
            id: "js.function",
            category: "sast",
            title: "Construtor dinâmico de funções",
            needles: &["new Function("],
            extensions: &["js","ts","mjs","cjs"],
            severity: Severity::Medium,
            impact: "Strings podem ser interpretadas como código; é necessária revisão do fluxo de dados.",
            fix: "Use funções declaradas explicitamente e uma tabela de operações permitidas.",
            cwe: "CWE-95",
        },
        Rule {
            id: "web.innerhtml",
            category: "sast",
            title: "Sink HTML requer revisão de XSS",
            needles: &["innerHTML", "="],
            extensions: &["js","jsx","ts","tsx","html"],
            severity: Severity::Medium,
            impact: "HTML não confiável pode alcançar o DOM. Sanitização e origem dos dados ainda precisam de revisão.",
            fix: "Prefira textContent ou renderização escapada. Quando HTML for indispensável, use sanitização mantida e uma política restritiva.",
            cwe: "CWE-79",
        },
        Rule {
            id: "react.rawhtml",
            category: "sast",
            title: "Renderização React de HTML bruto",
            needles: &["dangerouslySetInnerHTML"],
            extensions: &["jsx","tsx","js","ts"],
            severity: Severity::Medium,
            impact: "A API ignora o escape padrão do React. A regra não comprova que o conteúdo seja controlado por um atacante.",
            fix: "Elimine HTML bruto ou sanitize de forma adequada imediatamente antes da renderização.",
            cwe: "CWE-79",
        },
        Rule {
            id: "py.os-system",
            category: "sast",
            title: "Comando de shell em Python",
            needles: &["os.system("],
            extensions: &["py"],
            severity: Severity::Medium,
            impact: "Construção de comandos pode permitir injeção quando recebe entradas não confiáveis.",
            fix: "Use subprocess com lista fixa de argumentos, shell=False e allowlist de operações.",
            cwe: "CWE-78",
        },
        Rule {
            id: "py.shell-true",
            category: "sast",
            title: "Subprocess usa shell=True",
            needles: &["shell", "=", "True"],
            extensions: &["py"],
            severity: Severity::Medium,
            impact: "Interpretação pelo shell aumenta o risco de injeção de comandos; depende da entrada.",
            fix: "Passe argumentos como lista e desative o shell. Não concatene valores externos.",
            cwe: "CWE-78",
        },
        Rule {
            id: "py.pickle",
            category: "sast",
            title: "Desserialização com pickle",
            needles: &["pickle.load"],
            extensions: &["py"],
            severity: Severity::High,
            impact: "Pickle pode executar código ao ler dados manipulados. A confiabilidade da entrada não foi estabelecida.",
            fix: "Não processe pickle externo; use formatos de dados sem execução e valide um schema.",
            cwe: "CWE-502",
        },
        Rule {
            id: "php.unserialize",
            category: "sast",
            title: "Desserialização PHP requer revisão",
            needles: &["unserialize("],
            extensions: &["php"],
            severity: Severity::High,
            impact: "Objetos manipulados podem disparar cadeias perigosas dependendo das classes disponíveis.",
            fix: "Prefira JSON com schema. Não desserialize objetos de origem não confiável.",
            cwe: "CWE-502",
        },
        Rule {
            id: "sql.concatenate",
            category: "sast",
            title: "Consulta SQL aparentemente concatenada",
            needles: &["execute(","+"],
            extensions: &["py","java","php","cs"],
            severity: Severity::Medium,
            impact: "Concatenação em consultas pode permitir SQL Injection. É necessária análise dos parâmetros e do fluxo.",
            fix: "Use parâmetros vinculados/prepared statements. Não monte valores SQL com concatenação.",
            cwe: "CWE-89",
        },
        Rule {
            id: "tls.verify-disabled",
            category: "sast",
            title: "Validação TLS desabilitada",
            needles: &["verify", "=", "False"],
            extensions: &["py"],
            severity: Severity::High,
            impact: "Conexões podem aceitar um certificado não confiável e permitir interceptação.",
            fix: "Mantenha a verificação de certificados e configure uma CA confiável quando necessário.",
            cwe: "CWE-295",
        },
        Rule {
            id: "rust.tls-disabled",
            category: "sast",
            title: "Cliente Rust aceita certificados inválidos",
            needles: &["danger_accept_invalid_certs(true)"],
            extensions: &["rs"],
            severity: Severity::High,
            impact: "A identidade do servidor deixa de ser validada adequadamente.",
            fix: "Remova o bypass e configure raízes confiáveis explicitamente.",
            cwe: "CWE-295",
        },
        Rule {
            id: "node.tls-disabled",
            category: "sast",
            title: "Cliente Node desabilita validação TLS",
            needles: &["rejectUnauthorized", "false"],
            extensions: &["js","ts","mjs","cjs"],
            severity: Severity::High,
            impact: "Certificados não confiáveis podem ser aceitos pela conexão.",
            fix: "Mantenha rejectUnauthorized habilitado e configure CAs confiáveis.",
            cwe: "CWE-295",
        },
        Rule {
            id: "crypto.weak-password-hash",
            category: "sast",
            title: "Hash rápido próximo de senha",
            needles: &["md5(","password"],
            extensions: &["py","php","js","ts","java","cs"],
            severity: Severity::Medium,
            impact: "MD5 não é adequado para armazenamento de senhas. Proximidade lexical não prova a finalidade.",
            fix: "Para senhas, use Argon2id ou uma função de derivação adequada com parâmetros revisados.",
            cwe: "CWE-916",
        },
        Rule {
            id: "php.webshell-pattern",
            category: "suspicious",
            title: "Entrada HTTP combinada com execução dinâmica",
            needles: &["eval(","$_"],
            extensions: &["php"],
            severity: Severity::High,
            impact: "O padrão pode representar execução remota ou webshell, mas a regra lexical não confirma malware.",
            fix: "Isole para revisão manual, remova interpretação de entrada HTTP e compare o arquivo com uma fonte íntegra conhecida.",
            cwe: "CWE-95",
        },
        Rule {
            id: "js.obfuscated-exec",
            category: "suspicious",
            title: "Decodificação seguida de execução dinâmica",
            needles: &["eval(","atob("],
            extensions: &["js","ts","html","mjs","cjs"],
            severity: Severity::High,
            impact: "Pode ocultar código executável. Também há usos legítimos; não equivale a uma detecção antivírus.",
            fix: "Reveja o conteúdo em ambiente isolado sem executá-lo. Remova execução dinâmica e valide a procedência.",
            cwe: "CWE-506",
        },
        Rule {
            id: "php.obfuscated-exec",
            category: "suspicious",
            title: "Execução de conteúdo codificado em PHP",
            needles: &["eval(","base64_decode("],
            extensions: &["php"],
            severity: Severity::High,
            impact: "Combinação frequentemente usada para ocultar comportamento; precisa de validação manual.",
            fix: "Não execute o trecho. Compare o código com o upstream e revise em ambiente isolado.",
            cwe: "CWE-506",
        },
        Rule {
            id: "shell.download-exec",
            category: "suspicious",
            title: "Download encaminhado diretamente ao shell",
            needles: &["curl", "|", "sh"],
            extensions: &["sh","bash","yml","yaml","json","dockerfile"],
            severity: Severity::High,
            impact: "Código remoto pode ser executado sem revisão ou verificação de integridade.",
            fix: "Baixe uma versão fixa, verifique assinatura/hash confiável e revise antes de executar.",
            cwe: "CWE-494",
        },
        Rule {
            id: "powershell.encoded",
            category: "suspicious",
            title: "Comando PowerShell codificado",
            needles: &["-encodedcommand"],
            extensions: &["ps1","bat","cmd","json","yml","yaml"],
            severity: Severity::Medium,
            impact: "Conteúdo codificado reduz visibilidade. Não prova comportamento malicioso.",
            fix: "Revise a origem e decodifique somente como dados, sem executar.",
            cwe: "CWE-506",
        },
        Rule {
            id: "github.pull-request-target",
            category: "sast",
            title: "Workflow privilegiado em pull_request_target",
            needles: &["pull_request_target"],
            extensions: &["yml","yaml"],
            severity: Severity::Medium,
            impact: "Checkouts/execuções de conteúdo de PR podem atingir tokens e secrets se o workflow não separar contextos.",
            fix: "Não execute código não confiável nesse contexto. Use permissões mínimas e analise a cadeia completa de jobs.",
            cwe: "CWE-269",
        },
        Rule {
            id: "docker.root",
            category: "sast",
            title: "Imagem declara execução como root",
            needles: &["USER root"],
            extensions: &["dockerfile"],
            severity: Severity::Low,
            impact: "Privilégios excessivos ampliam o impacto de um comprometimento do processo.",
            fix: "Crie um usuário sem privilégios e aplique permissões mínimas na imagem.",
            cwe: "CWE-250",
        },
        Rule {
            id: "docker.add-url",
            category: "sast",
            title: "Dockerfile baixa arquivo remoto com ADD",
            needles: &["ADD http"],
            extensions: &["dockerfile"],
            severity: Severity::Medium,
            impact: "ADD a partir de uma URL traz conteúdo remoto sem verificação de integridade para dentro da imagem.",
            fix: "Prefira COPY de arquivos versionados ou baixe com verificação de hash/assinatura antes de usar.",
            cwe: "CWE-494",
        },
        Rule {
            id: "k8s.privileged",
            category: "sast",
            title: "Container Kubernetes privilegiado",
            needles: &["privileged:", "true"],
            extensions: &["yml", "yaml"],
            severity: Severity::High,
            impact: "Um container privilegiado tem acesso quase total ao nó; um comprometimento vira comprometimento do host.",
            fix: "Remova privileged: true, use securityContext com privilégios mínimos e runAsNonRoot.",
            cwe: "CWE-250",
        },
        Rule {
            id: "k8s.host-network",
            category: "sast",
            title: "Pod Kubernetes usa a rede do host",
            needles: &["hostNetwork:", "true"],
            extensions: &["yml", "yaml"],
            severity: Severity::Medium,
            impact: "hostNetwork expõe o pod à rede do nó, contornando o isolamento de rede do cluster.",
            fix: "Desative hostNetwork a menos que seja estritamente necessário e justificado.",
            cwe: "CWE-668",
        },
        Rule {
            id: "terraform.open-ingress",
            category: "sast",
            title: "Regra de rede aberta para a internet (0.0.0.0/0)",
            needles: &["0.0.0.0/0"],
            extensions: &["tf"],
            severity: Severity::Medium,
            impact: "Liberar 0.0.0.0/0 expõe o recurso a toda a internet. É aceitável para HTTP/HTTPS públicos, mas perigoso para SSH, RDP ou bancos.",
            fix: "Restrinja o CIDR às faixas necessárias; para administração, use VPN ou IPs específicos.",
            cwe: "CWE-284",
        },
        Rule {
            id: "terraform.public-bucket",
            category: "sast",
            title: "Bucket ou ACL pública em Terraform",
            needles: &["public-read"],
            extensions: &["tf"],
            severity: Severity::Medium,
            impact: "Uma ACL public-read torna os objetos legíveis por qualquer um, o que já causou vários vazamentos de dados.",
            fix: "Use ACL privada e políticas explícitas; bloqueie acesso público na conta sempre que possível.",
            cwe: "CWE-732",
        },
        Rule {
            id: "actions.unpinned-uses",
            category: "sast",
            title: "GitHub Action sem versão fixada por SHA",
            needles: &["uses:", "@master"],
            extensions: &["yml", "yaml"],
            severity: Severity::Low,
            impact: "Referenciar uma action por @master (ou tag móvel) executa o que o mantenedor publicar depois, inclusive uma versão comprometida.",
            fix: "Fixe cada action por commit SHA completo e revise atualizações.",
            cwe: "CWE-829",
        },
].into_iter().collect()
}
pub fn finding(rule: &Rule, path: &str, line: usize) -> SourceFinding {
    SourceFinding {
        id: format!("{:x}",Sha256::digest(format!("{}|{}|{}",rule.id,path,line))),
        rule_id: rule.id.into(),
        detector_version: if rule.category == "secrets" { SECRETS_DETECTOR_VERSION } else { "1.0.0" }.into(),
        title: rule.title.into(),
        description: rule.impact.into(),
        category: rule.category.into(),
        severity: rule.severity.clone(),
        confidence: "heuristic".into(),
        path: path.into(),
        line,
        evidence: format!("Padrão lexical observado na linha {line}. O conteúdo e os valores da linha não foram armazenados."),
        impact: rule.impact.into(),
        recommendation: rule.fix.into(),
        verification: "Revise a origem e o destino dos dados, adicione um teste de regressão para entrada não confiável e repita a análise após a correção. A ausência do padrão lexical não comprova segurança do fluxo.".into(),
        suggested_fix: None,
        reference: format!("{} — https://cwe.mitre.org/data/definitions/{}.html",rule.cwe,rule.cwe.trim_start_matches("CWE-")),
    }
}
pub fn analyze_text(
    path: &str,
    extension: &str,
    text: &str,
    sast: bool,
    secrets: bool,
    suspicious: bool,
) -> Vec<SourceFinding> {
    let rules = registry();
    let mut out = vec![];
    let firebase_context = text.to_ascii_lowercase().contains("firebase");
    for (index, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        let comment = ["//", "#", "/*", "*", "<!--"]
            .iter()
            .any(|prefix| trimmed.starts_with(prefix));
        for rule in &rules {
            if comment
                || (rule.category == "sast" && !sast)
                || (rule.category == "suspicious" && !suspicious)
                || !rule.extensions.contains(&extension)
            {
                continue;
            }
            let matched = if rule.id == "powershell.encoded" {
                line.to_ascii_lowercase().contains(rule.needles[0])
            } else {
                rule.needles.iter().all(|needle| line.contains(needle))
            };
            if matched {
                out.push(finding(rule, path, index + 1));
            }
        }
        if secrets {
            if let Some(finding) =
                crate::secrets::analyze_line(path, line, index + 1, firebase_context)
            {
                out.push(finding);
            }
        }
        if out.len() >= 200 {
            break;
        }
    }
    out.truncate(200);
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn iac_rules_flag_insecure_infrastructure() {
        let k8s = analyze_text(
            "deploy.yaml",
            "yaml",
            "    securityContext:\n      privileged: true\n",
            true,
            false,
            false,
        );
        assert!(k8s.iter().any(|f| f.rule_id == "k8s.privileged"));
        let tf = analyze_text(
            "main.tf",
            "tf",
            "  cidr_blocks = [\"0.0.0.0/0\"]\n",
            true,
            false,
            false,
        );
        assert!(tf.iter().any(|f| f.rule_id == "terraform.open-ingress"));
        let docker = analyze_text(
            "Dockerfile",
            "dockerfile",
            "ADD https://x/y.sh /tmp/y.sh\n",
            true,
            false,
            false,
        );
        assert!(docker.iter().any(|f| f.rule_id == "docker.add-url"));
    }
    #[test]
    fn distinguishes_heuristics_and_never_copies_secret() {
        let secret = ["ghp_", "abcdefghijklmnopqrstuvwxyz1234567890"].concat();
        let r = analyze_text(
            "app.ts",
            "ts",
            &format!("const key = '{secret}';\neval(atob(input));"),
            true,
            true,
            true,
        );
        assert!(r.iter().any(|f| f.category == "secrets"));
        assert!(r.iter().any(|f| f.category == "suspicious"));
        assert!(!format!("{r:?}").contains(&secret));
    }
    #[test]
    fn disabled_modules_and_comment_lines_are_not_reported() {
        assert!(analyze_text(
            "a.py",
            "py",
            "# os.system(user)\nos.system(user)",
            false,
            false,
            false
        )
        .is_empty());
        assert_eq!(
            analyze_text(
                "a.py",
                "py",
                "# os.system(user)\nos.system(user)",
                true,
                false,
                false
            )
            .len(),
            1
        );
    }

    #[test]
    fn secrets_in_comments_are_detected_without_copying_the_value() {
        let secret = ["ghp_", "abcdefghijklmnopqrstuvwxyz1234567890"].concat();
        for prefix in ["//", "#", "/*", "*", "<!--"] {
            let text = format!("{prefix} former token: {secret}");
            let findings = analyze_text("app.ts", "ts", &text, true, true, true);
            assert_eq!(findings.len(), 1, "{prefix}");
            assert_eq!(findings[0].category, "secrets");
            assert_eq!(findings[0].detector_version, SECRETS_DETECTOR_VERSION);
            assert!(!format!("{findings:?}").contains(&secret));
            assert!(analyze_text("app.ts", "ts", &text, true, false, true).is_empty());
        }
    }
}
