use crate::{analysis, software};
use scanner_core::*;

fn csp_issue_label(code: &str) -> &'static str {
    match code {
        "script-src-missing" => "sem script-src nem default-src (qualquer script é permitido)",
        "script-unsafe-inline" => "'unsafe-inline' em scripts sem nonce/hash",
        "script-unsafe-eval" => "'unsafe-eval' em scripts",
        "script-wildcard-source" => "fonte curinga em scripts (*, http:, https:, data: ou blob:)",
        "object-src-not-none" => "object-src diferente de 'none'",
        "base-uri-missing" => "base-uri ausente",
        "frame-ancestors-missing" => "frame-ancestors ausente",
        _ => "diagnóstico desconhecido",
    }
}

const HEADERS_REF: &str =
    "OWASP Secure Headers Project — https://owasp.org/www-project-secure-headers/";
const ASVS_REF: &str = "OWASP ASVS 5.0.0, V3/V12 — https://github.com/OWASP/ASVS/tree/v5.0.0";

/// Heurística de cookie de sessão/autenticação pelo nome. Conservadora para evitar
/// classificar cookies de preferência ou CSRF (lidos por JS de propósito) como sessão.
fn is_session_cookie(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.contains("session")
        || n.contains("sessid")
        || matches!(
            n.as_str(),
            "sid" | "auth"
                | "connect.sid"
                | "phpsessid"
                | "jsessionid"
                | "asp.net_sessionid"
                | "laravel_session"
        )
}

pub struct NativeDetector {
    pub id: &'static str,
    pub run: fn(&HttpObservation) -> Option<Finding>,
}
impl Detector for NativeDetector {
    fn id(&self) -> &'static str {
        self.id
    }
    fn analyze(&self, o: &HttpObservation) -> CheckResult {
        let finding = (self.run)(o);
        let https = o.url.starts_with("https://");
        let not_run = match self.id {
            "tls.expiry" | "tls.certificate" => o.tls.is_none(),
            "tls.legacy-version" | "tls.weak-cipher" => o.tls_probe.is_none(),
            "headers.hsts" => !https,
            // Só avaliam a qualidade quando o cabeçalho existe e foi analisado nesta versão.
            "headers.hsts-strength" => {
                !https
                    || o.headers
                        .get("strict-transport-security")
                        .is_none_or(|v| !v.starts_with("max-age="))
            }
            "headers.csp-strength" => o
                .headers
                .get("content-security-policy")
                .is_none_or(|v| analysis::csp_summary_issues(v).is_none()),
            _ => false,
        };
        CheckResult {
            detector_id: self.id.into(),
            detector_version: self.version().into(),
            resource: o.url.clone(),
            status: if not_run {
                CheckStatus::NotRun
            } else if finding.is_some() {
                CheckStatus::Finding
            } else {
                CheckStatus::Passed
            },
            reason: if not_run {
                "Não aplicável nesta resposta ou sem certificado leaf disponível; consulte o protocolo.".into()
            } else {
                "Verificação limitada aos cabeçalhos e ao certificado desta resposta.".into()
            },
            findings: finding.into_iter().collect(),
        }
    }
}

pub fn registry() -> Vec<Box<dyn Detector>> {
    vec![
        Box::new(NativeDetector {
            id: "transport.https",
            run: |o| {
                (!o.url.starts_with("https://")).then(|| Finding::new("transport.https",o,"Transporte sem HTTPS",Severity::Medium,
            "A resposta foi obtida por HTTP sem criptografia.","O tráfego pode ser lido ou alterado na rede.",
            "Disponibilize HTTPS com certificado válido e use a URL HTTPS como alvo. Redirecione HTTP para HTTPS no servidor.",ASVS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.hsts",
            run: |o| {
                (o.url.starts_with("https://") && o.headers.get("strict-transport-security").is_none_or(|v| v == "invalid")).then(||
            Finding::new("headers.hsts",o,"HSTS ausente ou sem max-age válido",Severity::Low,
            "Strict-Transport-Security não contém max-age positivo observado.","O navegador pode aceitar acessos futuros por HTTP; o impacto depende do contexto.",
            "Após validar HTTPS em todos os subdomínios, configure Strict-Transport-Security: max-age=31536000. Avalie includeSubDomains antes de habilitar.",HEADERS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.csp",
            run: |o| {
                (!o.headers.contains_key("content-security-policy")).then(|| Finding::new("headers.csp",o,"Política CSP não observada",Severity::Low,
            "Content-Security-Policy ausente ou vazia na resposta.","Falta uma camada de defesa adicional contra injeção de conteúdo. Isso não comprova XSS.",
            "Defina uma CSP adequada à aplicação. Comece em Report-Only, remova fontes desnecessárias e use nonces por resposta para scripts.",HEADERS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.nosniff",
            run: |o| {
                (o.headers.get("x-content-type-options").is_none_or(|v| v != "nosniff")).then(|| Finding::new("headers.nosniff",o,"Proteção contra MIME sniffing ausente",Severity::Low,
            "X-Content-Type-Options: nosniff não observado.","Navegadores podem interpretar alguns recursos com tipo diferente do declarado.",
            "Envie X-Content-Type-Options: nosniff e Content-Type correto em todos os recursos.",HEADERS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.referrer",
            run: |o| {
                (!o.headers.contains_key("referrer-policy")).then(|| Finding::new("headers.referrer",o,"Referrer-Policy não observada",Severity::Info,
            "O servidor não declarou Referrer-Policy nesta resposta.","O comportamento depende do padrão do navegador; URLs podem revelar contexto em navegações.",
            "Declare Referrer-Policy: strict-origin-when-cross-origin ou uma política mais restritiva compatível com a aplicação.",HEADERS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.permissions",
            run: |o| {
                (!o.headers.contains_key("permissions-policy")).then(|| Finding::new("headers.permissions",o,"Permissions-Policy não observada",Severity::Info,
            "Nenhuma Permissions-Policy declarada.","Recursos do navegador seguem permissões padrão; não há evidência de vulnerabilidade explorável.",
            "Desative recursos desnecessários, por exemplo Permissions-Policy: camera=(), microphone=(), geolocation=().",HEADERS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "cookies.attributes",
            run: |o| {
                let insecure: Vec<_> = o
                    .cookies
                    .iter()
                    .filter(|c| !c.secure || !c.http_only || !c.same_site)
                    .map(|c| {
                        let tag = if is_session_cookie(&c.name) {
                            " ⚠ provável cookie de sessão"
                        } else {
                            ""
                        };
                        format!(
                            "{} [Secure={}, HttpOnly={}, SameSite válido={}]{tag}",
                            c.name, c.secure, c.http_only, c.same_site
                        )
                    })
                    .collect();
                // Sessão sem HttpOnly (roubo via XSS) ou sem Secure (vaza em HTTP) pesa mais.
                let session_at_risk = o
                    .cookies
                    .iter()
                    .any(|c| is_session_cookie(&c.name) && (!c.http_only || !c.secure));
                let severity = if session_at_risk {
                    Severity::Medium
                } else {
                    Severity::Low
                };
                let impact = if session_at_risk {
                    "Um provável cookie de sessão sem HttpOnly pode ser lido por JavaScript (roubo de sessão via XSS); sem Secure pode vazar em texto claro por HTTP. Cookies lidos por JavaScript podem intencionalmente não ter HttpOnly; a finalidade não foi confirmada."
                } else {
                    "Cookies podem ter proteção insuficiente. Cookies usados por JavaScript podem intencionalmente não ter HttpOnly; a finalidade não foi inferida."
                };
                (!insecure.is_empty()).then(|| Finding::new("cookies.attributes",o,"Revisar atributos dos cookies",severity,
            &insecure.join("; "),impact,
            "Para cookies de sessão use Secure, HttpOnly e SameSite=Lax/Strict. SameSite=None exige Secure. Revise cada cookie segundo sua finalidade.",ASVS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "cors.policy",
            run: |o| {
                (o.headers.get("access-control-allow-origin").is_some_and(|v|v == "wildcard")).then(|| Finding::new("cors.policy",o,"CORS permite origem universal",Severity::Info,
            "Access-Control-Allow-Origin: * foi observado; não foram enviados Origin nem credenciais.",
            "Pode ser intencional para recursos públicos. Esta resposta não prova leitura autenticada ou reflexão de origem.",
            "Use uma allowlist de origens para dados restritos, Vary: Origin quando dinâmico e evite combinar origem universal com credenciais.",ASVS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.disclosure",
            run: |o| {
                let present: Vec<&str> = [
                    "server",
                    "x-powered-by",
                    "x-aspnet-version",
                    "x-aspnetmvc-version",
                ]
                .into_iter()
                .filter(|n| o.headers.contains_key(*n))
                .collect();
                if present.is_empty() {
                    return None;
                }
                let versions: Vec<String> = present
                    .iter()
                    .flat_map(|n| software::summary_tokens(&o.headers[*n]))
                    .map(|(product, version)| format!("{product}/{version}"))
                    .collect();
                let (severity, evidence) = if versions.is_empty() {
                    (
                        Severity::Info,
                        format!(
                            "Cabeçalhos presentes: {}. Nenhuma versão anunciada.",
                            present.join(", ")
                        ),
                    )
                } else {
                    (
                        Severity::Low,
                        format!(
                            "Versões anunciadas nos cabeçalhos: {}.",
                            versions.join(", ")
                        ),
                    )
                };
                Some(Finding::new("headers.disclosure",o,"Identificação técnica nos cabeçalhos",severity,&evidence,
                    "Informar produto e versão facilita procurar falhas públicas específicas. A presença sozinha não comprova vulnerabilidade.",
                    "Remova ou generalize esses cabeçalhos no servidor/reverse proxy (Apache: ServerTokens Prod; nginx: server_tokens off; PHP: expose_php = Off).",HEADERS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.outdated-software",
            run: |o| {
                let mut problems = vec![];
                let mut critical = false;
                for name in ["server", "x-powered-by"] {
                    let Some(summary) = o.headers.get(name) else {
                        continue;
                    };
                    for (product, version) in software::summary_tokens(summary) {
                        if let Some((reason, is_critical)) = software::outdated(product, version) {
                            critical |= is_critical;
                            problems.push(format!("{product}/{version}: {reason}"));
                        }
                        if let Some(server) = software::development_server(product) {
                            problems.push(format!("{server} atendendo requisições, o que não é adequado para produção"));
                        }
                    }
                }
                if problems.is_empty() {
                    return None;
                }
                Some(Finding::new("headers.outdated-software",o,"Software de servidor sem suporte ou vulnerável",
                    if critical { Severity::High } else { Severity::Medium },&problems.join("; "),
                    "Versões sem suporte acumulam falhas públicas sem correção, e servidores de desenvolvimento não têm as proteções de produção. A versão vem do cabeçalho: pode estar mascarada ou ter correções aplicadas pela distribuição; confirme no servidor.",
                    "Atualize para uma versão com suporte ativo, aplique as correções de segurança da distribuição e use um servidor de aplicação de produção.",
                    "OWASP Top 10 A06 Componentes vulneráveis e desatualizados — https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/"))
            },
        }),
        Box::new(NativeDetector {
            id: "tls.expiry",
            run: |o| {
                o.tls.as_ref().filter(|t|t.days_remaining <= 30).map(|t|Finding::new("tls.expiry",o,"Certificado próximo do vencimento",Severity::Low,
            &format!("Certificado leaf expira em {} ({} dias).",t.expires_at,t.days_remaining),"Expiração pode causar indisponibilidade e falhas de conexão segura.",
            "Renove o certificado e automatize a renovação com monitoramento. Não desabilite validação de TLS.",ASVS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.csp-strength",
            run: |o| {
                let issues =
                    analysis::csp_summary_issues(o.headers.get("content-security-policy")?)?;
                if issues.is_empty() {
                    return None;
                }
                // Fraquezas em scripts anulam a proteção contra XSS; as demais são hardening.
                let severity = if issues.iter().any(|i| i.starts_with("script-")) {
                    Severity::Medium
                } else {
                    Severity::Low
                };
                let evidence = issues
                    .iter()
                    .map(|i| csp_issue_label(i))
                    .collect::<Vec<_>>()
                    .join("; ");
                Some(Finding::new("headers.csp-strength",o,"CSP presente, mas fraca",severity,
                    &format!("Diagnóstico da política (valor não armazenado): {evidence}."),
                    "Uma CSP permissiva em scripts não impede a execução de código injetado; a proteção contra XSS fica reduzida ou nula. Isso não comprova XSS.",
                    "Use script-src com 'nonce-…' por resposta e 'strict-dynamic', remova 'unsafe-inline'/'unsafe-eval' e curingas, e defina object-src 'none', base-uri 'none' e frame-ancestors. Valide com Content-Security-Policy-Report-Only antes.",
                    "OWASP CSP Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html"))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.hsts-strength",
            run: |o| {
                let h = analysis::hsts_parse(o.headers.get("strict-transport-security")?)?;
                let mut gaps = vec![];
                if h.max_age < analysis::HSTS_MIN_MAX_AGE {
                    gaps.push(format!(
                        "max-age de {} dias (recomendado ≥ 180)",
                        h.max_age / 86_400
                    ));
                }
                if !h.include_subdomains {
                    gaps.push("sem includeSubDomains".into());
                }
                (!gaps.is_empty()).then(|| Finding::new("headers.hsts-strength",o,"HSTS com proteção limitada",Severity::Info,
                    &gaps.join("; "),
                    "Com max-age curto o navegador esquece a política rapidamente; sem includeSubDomains, subdomínios ainda aceitam HTTP e cookies podem ser expostos.",
                    "Depois de confirmar HTTPS em todos os subdomínios, use Strict-Transport-Security: max-age=31536000; includeSubDomains e avalie o preload (hstspreload.org).",HEADERS_REF))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.framing",
            run: |o| {
                let frame_ancestors = o
                    .headers
                    .get("content-security-policy")
                    .and_then(|v| analysis::csp_summary_issues(v))
                    .is_some_and(|i| !i.contains(&"frame-ancestors-missing"));
                let xfo = o
                    .headers
                    .get("x-frame-options")
                    .is_some_and(|v| v != "invalid");
                (!frame_ancestors && !xfo).then(|| Finding::new("headers.framing",o,"Página pode ser incorporada em iframe de terceiros",Severity::Low,
                    "Nem CSP frame-ancestors nem X-Frame-Options válido foram observados.",
                    "Outros sites podem incorporar a página e induzir cliques (clickjacking). O impacto depende de haver ações sensíveis na página.",
                    "Envie Content-Security-Policy: frame-ancestors 'self' (ou 'none') e, para navegadores antigos, X-Frame-Options: DENY ou SAMEORIGIN.",
                    "OWASP Clickjacking Defense Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html"))
            },
        }),
        Box::new(NativeDetector {
            id: "cors.credentials",
            run: |o| {
                let acao = o.headers.get("access-control-allow-origin")?;
                let creds = o
                    .headers
                    .get("access-control-allow-credentials")
                    .is_some_and(|v| v == "true");
                let vary_origin = o.headers.get("vary").is_some_and(|v| v == "origin");
                let mut problems = vec![];
                if acao == "null" {
                    problems.push("Access-Control-Allow-Origin: null (alcançável a partir de iframes sandbox e arquivos locais)");
                }
                if acao == "wildcard" && creds {
                    problems.push("origem universal combinada com Allow-Credentials: true (o navegador rejeita a combinação, mas indica configuração incorreta)");
                }
                if acao == "specific origin (redacted)" && !vary_origin {
                    problems.push("origem específica sem Vary: Origin (risco de cache servir a política de outra origem)");
                }
                if problems.is_empty() {
                    return None;
                }
                // `null` com credenciais é explorável a partir de iframes sandbox (origem null);
                // `*` com credenciais é bloqueado pelo navegador, então é apenas configuração incorreta.
                let severity = if acao == "null" && creds {
                    Severity::Medium
                } else {
                    Severity::Low
                };
                Some(Finding::new("cors.credentials",o,"Configuração de CORS arriscada",severity,
                    &problems.join("; "),
                    "Dependendo dos dados servidos, outra origem pode ler respostas em nome do usuário, ou um cache pode servir a política errada. Nenhuma origem foi refletida nem testada ativamente.",
                    "Use uma allowlist fixa de origens, nunca aceite 'null', envie Vary: Origin quando o cabeçalho for dinâmico e só habilite credenciais para origens confiáveis.",
                    "PortSwigger — CORS — https://portswigger.net/web-security/cors"))
            },
        }),
        Box::new(NativeDetector {
            id: "cookies.prefix",
            run: |o| {
                let bad: Vec<_> = o
                    .cookies
                    .iter()
                    .filter(|c| c.prefix_violation || (c.same_site_none && !c.secure))
                    .map(|c| {
                        if c.prefix_violation {
                            format!(
                                "{} [prefixo __Host-/__Secure- sem os atributos exigidos]",
                                c.name
                            )
                        } else {
                            format!("{} [SameSite=None sem Secure]", c.name)
                        }
                    })
                    .collect();
                (!bad.is_empty()).then(|| Finding::new("cookies.prefix",o,"Cookies rejeitados ou mal declarados",Severity::Low,
                    &bad.join("; "),
                    "Navegadores modernos descartam esses cookies, o que pode quebrar sessões ou levar a contornos menos seguros. Indica configuração inconsistente.",
                    "Cookies __Host- exigem Secure, Path=/ e nenhum Domain; __Secure- exige Secure; SameSite=None exige Secure.",
                    "MDN Set-Cookie — https://developer.mozilla.org/docs/Web/HTTP/Headers/Set-Cookie"))
            },
        }),
        Box::new(NativeDetector {
            id: "tls.certificate",
            run: |o| {
                let t = o.tls.as_ref()?;
                let mut problems = vec![];
                if t.weak_signature {
                    problems.push(format!("assinatura fraca ({})", t.signature_algorithm));
                }
                if t.key_algorithm == "RSA" && t.key_bits > 0 && t.key_bits < 2048 {
                    problems.push(format!("chave RSA de {} bits (mínimo 2048)", t.key_bits));
                }
                if t.key_algorithm == "EC" && t.key_bits > 0 && t.key_bits < 256 {
                    problems.push(format!("chave EC de {} bits (mínimo 256)", t.key_bits));
                }
                if problems.is_empty() {
                    return None;
                }
                Some(Finding::new("tls.certificate",o,"Certificado com criptografia fraca",Severity::Medium,
                    &problems.join("; "),
                    "Algoritmos de assinatura ou chaves abaixo do recomendado reduzem a garantia de autenticidade e podem ser recusados por navegadores.",
                    "Emita um certificado com assinatura SHA-256 ou superior e chave RSA ≥ 2048 bits ou curva elíptica ≥ 256 bits.",
                    "Mozilla TLS Guidelines — https://wiki.mozilla.org/Security/Server_Side_TLS"))
            },
        }),
        Box::new(NativeDetector {
            id: "tls.legacy-version",
            run: |o| {
                let p = o.tls_probe.as_ref()?;
                let mut versions = vec![];
                if p.tls10 == Some(true) {
                    versions.push("TLS 1.0");
                }
                if p.tls11 == Some(true) {
                    versions.push("TLS 1.1");
                }
                (!versions.is_empty()).then(|| Finding::new("tls.legacy-version",o,"Versões de TLS obsoletas aceitas",Severity::Medium,
                    &format!("O servidor completou o handshake com: {}.", versions.join(", ")),
                    "TLS 1.0 e 1.1 estão descontinuados (depreciados pela IETF em 2021) e têm fraquezas conhecidas de cifra e integridade.",
                    "Desabilite TLS 1.0 e 1.1 no servidor/reverse proxy e aceite apenas TLS 1.2 e 1.3.",
                    "RFC 8996 — https://www.rfc-editor.org/rfc/rfc8996"))
            },
        }),
        Box::new(NativeDetector {
            id: "tls.weak-cipher",
            run: |o| {
                (o.tls_probe.as_ref()?.weak_ciphers == Some(true)).then(|| Finding::new("tls.weak-cipher",o,"Cifras TLS fracas aceitas",Severity::Medium,
                    "O servidor aceitou um handshake oferecendo apenas cifras fracas (RC4, 3DES, EXPORT, NULL ou anônimas).",
                    "Cifras obsoletas podem permitir recuperação de texto claro ou ausência de confidencialidade.",
                    "Configure a lista de cifras para suítes modernas com AEAD (AES-GCM, ChaCha20-Poly1305) e forward secrecy (ECDHE).",
                    "Mozilla TLS Guidelines — https://wiki.mozilla.org/Security/Server_Side_TLS"))
            },
        }),
        Box::new(NativeDetector {
            id: "headers.csp-report-only",
            run: |o| {
                (o.headers.contains_key("content-security-policy-report-only") && !o.headers.contains_key("content-security-policy")).then(||
                    Finding::new("headers.csp-report-only",o,"CSP apenas em modo de relatório",Severity::Info,
                    "Content-Security-Policy-Report-Only presente sem Content-Security-Policy aplicada.",
                    "A política só gera relatórios; nenhuma restrição é aplicada pelo navegador.",
                    "Depois de revisar os relatórios, publique a mesma política em Content-Security-Policy.",HEADERS_REF))
            },
        }),
    ]
}

pub fn analyze(observation: &HttpObservation) -> Vec<CheckResult> {
    registry().iter().map(|d| d.analyze(observation)).collect()
}
