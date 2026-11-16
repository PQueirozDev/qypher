mod pdf;
use scanner_core::*;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub product: String,
    pub project: Project,
    pub scan: Scan,
    pub limitations: Vec<String>,
    pub redacted: bool,
}

pub fn build(project: &Project, scan: &Scan, redact: bool) -> Report {
    let mut project = project.clone();
    let mut scan = scan.clone();
    for finding in scan.findings.iter_mut().chain(
        scan.checks
            .iter_mut()
            .flat_map(|check| check.findings.iter_mut()),
    ) {
        finding.sample = None;
    }
    // Raw response bodies, cookie values and authorization headers never enter the model.
    if redact {
        project.url = "[URL ocultada]".into();
        scan.config.url = "[URL ocultada]".into();
        scan.config.path_prefix = "[caminho ocultado]".into();
        for o in &mut scan.observations {
            o.url = "[URL ocultada]".into();
            if let Some(t) = &mut o.tls {
                t.issuer = "[emissor ocultado]".into();
            }
        }
        for c in &mut scan.checks {
            c.resource = "[URL ocultada]".into();
            for f in &mut c.findings {
                redact_finding(f);
            }
        }
        for f in &mut scan.findings {
            redact_finding(f);
        }
        for o in &mut scan.observations {
            for c in &mut o.cookies {
                c.name = "[cookie]".into();
            }
        }
    }
    let mut limitations = vec![
        "Auditoria automatizada dentro da origem autorizada, um pedido por vez. Corpos de resposta são analisados em memória e nunca armazenados.".to_string(),
    ];
    limitations.push(if scan.config.discovery {
        "Exposição: lista fixa de arquivos e painéis conhecidos, validada por assinatura de conteúdo. Não há crawling nem força bruta de caminhos.".into()
    } else {
        "A busca por arquivos expostos e a análise do HTML não foram executadas nesta auditoria.".into()
    });
    limitations.push(if scan.config.active_checks {
        "Testes ativos limitados a reflexão de origem CORS, métodos HTTP anunciados e TRACE dentro do escopo autorizado. Nenhum payload de exploração foi enviado.".into()
    } else {
        "Nenhum teste ativo foi executado nesta auditoria.".into()
    });
    limitations.extend([
        "Não foram testados XSS, injeção de SQL, autenticação, autorização nem lógica de negócio.".to_string(),
        "O índice de postura é um resumo interno dos achados; não é CVSS. Versões de software vêm de cabeçalhos e nomes de arquivo e precisam de confirmação.".to_string(),
        "Verificações automatizadas não substituem um teste de invasão manual.".to_string(),
    ]);
    if redact {
        for f in scan
            .findings
            .iter_mut()
            .chain(scan.checks.iter_mut().flat_map(|c| c.findings.iter_mut()))
        {
            if matches!(
                f.detector_id.as_str(),
                "disclosure.robots" | "page.private-ip" | "active.http-redirect"
            ) {
                f.evidence = "Detalhes ocultados na exportação.".into();
            }
        }
    }
    Report {
        product: format!("Qypher {}", ENGINE_VERSION),
        project,
        scan,
        redacted: redact,
        limitations,
    }
}

fn redact_finding(f: &mut Finding) {
    f.location = "[URL ocultada]".into();
    f.sample = None;
    if f.detector_id == "cookies.attributes" {
        f.evidence = "Cookies com atributos a revisar. Nomes ocultados para exportação.".into();
    }
}
pub fn json(report: &Report) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(report).map_err(|e| e.to_string())
}
pub fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub fn html(report: &Report) -> Vec<u8> {
    let s = &report.scan;
    let mut content=format!("<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src 'none'\"><title>Qypher · relatório</title><style>body{{font:15px/1.6 system-ui,sans-serif;color:#161b26;max-width:980px;margin:48px auto;padding:24px}}h1{{font-size:36px;border-bottom:4px solid #3f5fc0;padding-bottom:20px}}small{{color:#5b6472}}article{{border:1px solid #cdd3df;border-radius:12px;padding:24px;margin:20px 0;break-inside:avoid}}code,pre{{white-space:pre-wrap;overflow-wrap:anywhere}}table{{width:100%;border-collapse:collapse}}td,th{{text-align:left;padding:10px;border-bottom:1px solid #d9dee8}}.pill{{color:#3f5fc0}}@media print{{body{{margin:0;max-width:none}}}}</style><header><small>SEGURANÇA DE APLICAÇÕES / RELATÓRIO LOCAL</small><h1>Qypher<span class=\"pill\">.</span></h1><h2>{}</h2></header><h2>Resumo executivo</h2><p>{} achados em {} requisição(ões). Estado: {}. {}</p><p>Alvo: <code>{}</code><br>Escopo: <code>{}</code><br>Início (UTC): {}<br>Fim (UTC): {}<br>Motor: {}<br>Redação de dados: {}</p>",
        escape(&report.project.name),s.findings.len(),s.request_count,s.status.label(),s.risk.as_ref().map(|r|format!("Índice de postura: {} ({}/100).",r.grade,r.score)).unwrap_or_default(),escape(&s.config.url),escape(&s.config.path_prefix),escape(&s.started_at),escape(s.finished_at.as_deref().unwrap_or("em andamento")),escape(&s.engine_version),report.redacted);
    if let Some(error) = &s.error {
        content.push_str(&format!("<p>Limitação da execução: {}</p>", escape(error)));
    }
    content.push_str("<h2>Achados e recomendações</h2>");
    if s.findings.is_empty() {
        content.push_str("<p>Nenhum achado observado nesta cobertura. Isso não comprova ausência de vulnerabilidades.</p>");
    }
    for f in &s.findings {
        content.push_str(&format!("<article><small>{} / {} {} / confiança: {}</small><h3>{}</h3><p><code>{}</code></p><p><b>Evidência:</b> {}</p><p><b>Impacto:</b> {}</p><p><b>Recomendação:</b> {}</p><p><b>Detector:</b> {} v{}<br><b>Referências:</b> {}</p></article>",f.severity.label(),escape(&f.owasp),escape(&f.cwe),escape(&f.confidence),escape(&f.title),escape(&f.location),escape(&f.evidence),escape(&f.impact),escape(&f.recommendation),escape(&f.detector_id),escape(&f.detector_version),escape(&f.references.join("; "))));
    }
    content.push_str("<h2>Cobertura e evidências de execução</h2><table><tr><th>Detector / versão</th><th>Recurso</th><th>Estado</th></tr>");
    for c in &s.checks {
        content.push_str(&format!(
            "<tr><td>{} / {}</td><td>{}</td><td>{}</td></tr>",
            escape(&c.detector_id),
            escape(&c.detector_version),
            escape(&c.resource),
            c.status.label()
        ));
    }
    content.push_str("</table><h2>Verificações não realizadas e limites</h2><ul>");
    for l in &report.limitations {
        content.push_str(&format!("<li>{}</li>", escape(l)));
    }
    content.push_str("</ul><p>Comparações com execuções anteriores estão disponíveis na seção Histórico do aplicativo e não foram incorporadas a esta exportação.</p><footer><small>Documento local · Qypher · Trate o relatório como dado sensível.</small></footer></html>");
    content.into_bytes()
}
pub fn pdf(report: &Report) -> Result<Vec<u8>, String> {
    pdf::render(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn report() -> Report {
        let p = Project {
            id: "p".into(),
            name: "<script>alert(1)</script>".into(),
            url: "https://sensitive.example/app".into(),
            created_at: "now".into(),
        };
        let s = Scan::new(ScanConfig {
            project_id: p.id.clone(),
            url: p.url.clone(),
            authorized: true,
            allow_private: false,
            path_prefix: "/app".into(),
            max_requests: 1,
            max_redirects: 0,
            timeout_seconds: 2,
            discovery: false,
            active_checks: false,
        });
        build(&p, &s, true)
    }
    #[test]
    fn reports_escape_and_redact() {
        let r = report();
        let html = String::from_utf8(html(&r)).unwrap();
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(!String::from_utf8(json(&r).unwrap())
            .unwrap()
            .contains("sensitive.example"));
    }
    #[test]
    fn pdf_is_parseable_and_has_pages() {
        let data = pdf(&report()).unwrap();
        let parsed = lopdf::Document::load_mem(&data).unwrap();
        assert!(!parsed.get_pages().is_empty());
    }
}
