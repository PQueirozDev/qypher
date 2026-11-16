use crate::Report;
use lopdf::{
    content::{Content, Operation},
    dictionary, Document, Object, Stream,
};

// PDF base fonts with WinAnsi encoding avoid runtime fonts/network resources.
fn ansi(text: &str) -> Vec<u8> {
    text.chars()
        .map(|c| match c {
            '\u{2013}' | '\u{2014}' => b'-',
            '\u{2022}' => b'*',
            _ if (c as u32) <= 255 => c as u8,
            _ => b'?',
        })
        .collect()
}
fn wrap(text: &str, width: usize) -> Vec<String> {
    let mut lines = vec![];
    let mut line = String::new();
    for word in text.split_whitespace() {
        for part in word.chars().collect::<Vec<_>>().chunks(width) {
            let part: String = part.iter().collect();
            if line.chars().count() + part.chars().count() + 1 > width && !line.is_empty() {
                lines.push(std::mem::take(&mut line));
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(&part);
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

pub fn render(r: &Report) -> Result<Vec<u8>, String> {
    let mut lines: Vec<(String, bool)> = vec![];
    let mut add = |text: String, heading: bool| {
        for l in wrap(&text, 84) {
            lines.push((l, heading));
        }
        lines.push((String::new(), false));
    };
    add("RELATÓRIO DE AUDITORIA DE SEGURANÇA".into(), true);
    add(r.project.name.clone(), true);
    add(
        format!(
            "Alvo: {} | Escopo: {}",
            r.scan.config.url, r.scan.config.path_prefix
        ),
        false,
    );
    add(
        format!(
            "Início UTC: {} | Fim UTC: {}",
            r.scan.started_at,
            r.scan.finished_at.as_deref().unwrap_or("em andamento")
        ),
        false,
    );
    add("Resumo executivo".into(), true);
    add(format!("{} achados; {} requisições; estado: {}. Ausência de achados não comprova segurança. Motor Qypher {}. Dados ocultados: {}.",r.scan.findings.len(),r.scan.request_count,r.scan.status.label(),r.scan.engine_version,r.redacted),false);
    if let Some(e) = &r.scan.error {
        add(format!("Limite da execução: {e}"), false);
    }
    for (i, f) in r.scan.findings.iter().enumerate() {
        add(
            format!("{:02}. {} [{}]", i + 1, f.title, f.severity.label()),
            true,
        );
        add(
            format!(
                "{} | {} | confiança {} | {} v{}",
                f.location, f.classification, f.confidence, f.detector_id, f.detector_version
            ),
            false,
        );
        add(format!("Evidência: {}", f.evidence), false);
        add(format!("Impacto: {}", f.impact), false);
        add(format!("Recomendação: {}", f.recommendation), false);
        add(format!("Referências: {}", f.references.join("; ")), false);
    }
    add("Cobertura de verificações".into(), true);
    for c in &r.scan.checks {
        add(
            format!(
                "{} v{} | {} | {} | {}",
                c.detector_id,
                c.detector_version,
                c.status.label(),
                c.resource,
                c.reason
            ),
            false,
        );
    }
    add("Verificações não realizadas e limites".into(), true);
    for l in &r.limitations {
        add(l.clone(), false);
    }
    add(
        "Comparação histórica: consulte o aplicativo. Não incorporada a esta exportação.".into(),
        false,
    );
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let regular=doc.add_object(dictionary!{"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica","Encoding"=>"WinAnsiEncoding"});
    let bold=doc.add_object(dictionary!{"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica-Bold","Encoding"=>"WinAnsiEncoding"});
    let body=doc.add_object(dictionary!{"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Courier","Encoding"=>"WinAnsiEncoding"});
    let body_bold=doc.add_object(dictionary!{"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Courier-Bold","Encoding"=>"WinAnsiEncoding"});
    let resources = doc.add_object(
        dictionary! {"Font"=>dictionary!{"F1"=>regular,"F2"=>bold,"F3"=>body,"F4"=>body_bold}},
    );
    let mut kids = vec![];
    let total = lines.len().div_ceil(43);
    for (page, chunk) in lines.chunks(43).enumerate() {
        let mut operations = vec![
            Operation::new("rg", vec![0.04.into(), 0.045.into(), 0.06.into()]),
            Operation::new("re", vec![0.into(), 760.into(), 595.into(), 82.into()]),
            Operation::new("f", vec![]),
        ];
        fn text(
            ops: &mut Vec<Operation>,
            value: &str,
            x: i64,
            y: i64,
            size: i64,
            font: &str,
            color: [f32; 3],
        ) {
            ops.push(Operation::new(
                "rg",
                color.into_iter().map(Object::Real).collect(),
            ));
            ops.push(Operation::new("BT", vec![]));
            ops.push(Operation::new(
                "Tf",
                vec![Object::Name(font.as_bytes().to_vec()), size.into()],
            ));
            ops.push(Operation::new("Td", vec![x.into(), y.into()]));
            ops.push(Operation::new(
                "Tj",
                vec![Object::string_literal(ansi(value))],
            ));
            ops.push(Operation::new("ET", vec![]));
        }
        text(
            &mut operations,
            "Qypher.",
            42,
            790,
            26,
            "F2",
            [0.93, 0.94, 0.96],
        );
        text(
            &mut operations,
            "RELATÓRIO DE SEGURANÇA",
            300,
            795,
            10,
            "F1",
            [0.62, 0.65, 0.72],
        );
        for (i, (line, heading)) in chunk.iter().enumerate() {
            text(
                &mut operations,
                line,
                42,
                730 - i as i64 * 15,
                10,
                if *heading { "F4" } else { "F3" },
                [0.09, 0.11, 0.15],
            );
        }
        text(
            &mut operations,
            &format!(
                "Qypher {}  |  Relatório sensível  |  {} / {}",
                r.scan.engine_version,
                page + 1,
                total
            ),
            42,
            34,
            9,
            "F1",
            [0.36, 0.39, 0.45],
        );
        let bytes = Content { operations }.encode().map_err(|e| e.to_string())?;
        let contents = doc.add_object(Stream::new(dictionary! {}, bytes));
        let id=doc.add_object(dictionary!{"Type"=>"Page","Parent"=>pages_id,"Contents"=>contents,"Resources"=>resources,"MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()]});
        kids.push(Object::Reference(id));
    }
    doc.objects.insert(
        pages_id,
        dictionary! {"Type"=>"Pages","Kids"=>kids.clone(),"Count"=>kids.len() as i64}.into(),
    );
    let catalog = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages_id});
    doc.trailer.set("Root", catalog);
    let mut output = vec![];
    doc.save_to(&mut output).map_err(|e| e.to_string())?;
    Ok(output)
}
