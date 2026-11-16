//! Static cloud-policy inspection. No database, SDK, emulator or target process is invoked.
use crate::SourceFinding;
use scanner_core::Severity;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

const MAX_TOKENS: usize = 200_000;
const MAX_FINDINGS: usize = 500;

#[derive(Default)]
pub struct Inspector {
    findings: Vec<SourceFinding>,
    created: BTreeMap<String, (String, usize, Relation)>,
    enabled: BTreeSet<String>,
    pub supabase_files: u32,
    pub firebase_files: u32,
    pub partial: bool,
}

pub struct Inspection {
    pub findings: Vec<SourceFinding>,
    pub supabase_files: u32,
    pub firebase_files: u32,
    pub partial: bool,
}

struct Rule {
    id: &'static str,
    title: &'static str,
    category: &'static str,
    severity: Severity,
    confidence: &'static str,
    description: &'static str,
    impact: &'static str,
    recommendation: &'static str,
    verification: &'static str,
    reference: &'static str,
}

const RLS_MISSING: Rule = Rule {
    id: "supabase.rls-not-observed", title: "Ativação de RLS não observada para tabela criada", category: "supabase", severity: Severity::Medium, confidence: "heuristic",
    description: "Uma migration Supabase cria uma tabela public, mas os arquivos elegíveis lidos não mostram sua ativação de Row Level Security. O estado do banco em execução não foi consultado.",
    impact: "Se a tabela estiver exposta pela Data API e houver grants de acesso, registros poderão ficar acessíveis sem as políticas de isolamento esperadas.",
    recommendation: "Confira a configuração efetiva no ambiente autorizado. Revise a ativação de RLS e políticas por usuário/tenant em uma migration; ativar RLS sem políticas pode interromper acessos legítimos.",
    verification: "Em homologação, inspecione RLS/grants e teste recursos fictícios com usuário anônimo e duas contas. Confirme que cada conta vê somente os registros previstos. Reanalise todas as migrations.",
    reference: "https://supabase.com/docs/guides/database/postgres/row-level-security",
};
const RLS_DISABLED: Rule = Rule {
    id: "supabase.rls-disabled", title: "Migration desabilita Row Level Security", category: "supabase", severity: Severity::High, confidence: "configuration",
    description: "Foi observado ALTER TABLE ... DISABLE ROW LEVEL SECURITY em SQL Supabase. Uma migration posterior pode alterar esse estado; não houve consulta ao banco.",
    impact: "Se aplicado a uma tabela exposta, o comando pode retirar a proteção de linhas e deixar somente os grants como barreira de acesso.",
    recommendation: "Revise a necessidade do comando, mantenha RLS e políticas mínimas para tabelas expostas. Não aplique mudanças automaticamente em produção.",
    verification: "Confira o estado final das migrations e o catálogo do banco de homologação; teste negação de acesso entre contas com dados sintéticos.",
    reference: "https://supabase.com/docs/guides/database/postgres/row-level-security",
};
const POLICY_OPEN: Rule = Rule {
    id: "supabase.permissive-policy", title: "Política Supabase possui predicado incondicional", category: "supabase", severity: Severity::Medium, confidence: "configuration",
    description: "Uma política RLS ou de Storage contém USING (true) ou WITH CHECK (true). A configuração pode ser legítima para conteúdo público; a finalidade e os demais controles precisam de revisão.",
    impact: "Um predicado sem restrição de linha pode permitir leitura ou escrita entre usuários, conforme a operação, os papéis autorizados e os grants efetivos.",
    recommendation: "Revise os papéis e operações da política e restrinja por identidade/tenant quando os dados não forem públicos. Substitua a política permissiva: adicionar outra política permissiva pode manter o acesso por combinação OR.",
    verification: "Use duas contas e registros/objetos fictícios em homologação. Verifique leituras, criações e alterações entre proprietários, incluindo acesso anônimo quando aplicável.",
    reference: "https://supabase.com/docs/guides/database/postgres/row-level-security",
};
const DEFINER_PATH: Rule = Rule {
    id: "supabase.definer-search-path", title: "Função SECURITY DEFINER sem search_path fixo observado", category: "supabase", severity: Severity::Medium, confidence: "configuration",
    description: "Uma definição de função privilegiada usa SECURITY DEFINER sem SET search_path no cabeçalho observado. O corpo não é executado nem usado para inferir privilégios remotos.",
    impact: "Nomes não qualificados podem resolver objetos inesperados quando uma função roda com os privilégios de seu proprietário.",
    recommendation: "Defina search_path controlado, prefira vazio com objetos qualificados por schema e revise grants de EXECUTE e a necessidade de SECURITY DEFINER.",
    verification: "Revise a definição final e os grants no ambiente de teste; confirme que usuários não confiáveis não conseguem influenciar a resolução de objetos ou executar operações indevidas.",
    reference: "https://supabase.com/docs/guides/database/functions",
};
const FIREBASE_OPEN: Rule = Rule {
    id: "firebase.unconditional-access", title: "Regra Firebase permite acesso incondicional", category: "firebase", severity: Severity::High, confidence: "configuration",
    description: "Uma regra local concede acesso com condição constante true. Isso descreve o arquivo analisado, sem afirmar que ele está publicado ou que contém dados privados.",
    impact: "Se publicada em um caminho com dados ou arquivos privados, a regra poderá liberar operações aos clientes sem verificar identidade ou propriedade.",
    recommendation: "Defina autorização adequada por operação, identidade e proprietário do recurso. Use deny-by-default nos caminhos privados e teste a política no emulador antes de publicar.",
    verification: "No emulador local, teste clientes anônimos, proprietário e outra conta usando recursos sintéticos. As operações não autorizadas devem ser negadas.",
    reference: "https://firebase.google.com/docs/firestore/security/insecure-rules",
};
const FIREBASE_AUTH_ONLY: Rule = Rule {
    id: "firebase.auth-without-isolation", title: "Regra exige login sem restrição de proprietário observada", category: "firebase", severity: Severity::Medium, confidence: "heuristic",
    description: "A condição observada verifica somente se request.auth existe. Isso pode ser intencional para conteúdo compartilhado; não demonstra isolamento por usuário ou tenant.",
    impact: "Qualquer conta autenticada poderá alcançar o caminho quando nenhuma outra condição limitar a operação; o impacto depende do conteúdo e da intenção do produto.",
    recommendation: "Para dados privados, vincule o usuário autenticado ao proprietário do recurso e valide os campos permitidos. Mantenha regras amplas apenas onde o compartilhamento for intencional.",
    verification: "Teste no emulador com duas contas e documentos/arquivos fictícios. Confirme que a segunda conta não acessa o recurso privado da primeira.",
    reference: "https://firebase.google.com/docs/rules/basics",
};

fn finding(rule: &Rule, path: &str, line: usize, suggested_fix: Option<String>) -> SourceFinding {
    SourceFinding {
        id: format!("{:x}", Sha256::digest(format!("{}|{path}|{line}", rule.id))),
        rule_id: rule.id.into(),
        detector_version: "1.0.0".into(),
        title: rule.title.into(),
        description: rule.description.into(),
        category: rule.category.into(),
        severity: rule.severity.clone(),
        confidence: rule.confidence.into(),
        path: path.into(),
        line,
        evidence: if line > 0 {
            format!("Padrão de configuração observado na linha {line}. Conteúdo, dados e credenciais não foram copiados.")
        } else {
            "Condição de acesso observada na estrutura JSON. Localização de linha não determinada; valores e conteúdo não foram copiados.".into()
        },
        impact: rule.impact.into(),
        recommendation: rule.recommendation.into(),
        verification: rule.verification.into(),
        suggested_fix,
        reference: rule.reference.into(),
    }
}

#[derive(Clone)]
struct Relation {
    schema: String,
    name: String,
}
impl Relation {
    fn key(&self) -> String {
        format!("{}\0{}", self.schema, self.name)
    }
    fn quoted(&self) -> String {
        format!(
            "\"{}\".\"{}\"",
            self.schema.replace('"', "\"\""),
            self.name.replace('"', "\"\"")
        )
    }
}

struct Token {
    value: String,
    line: usize,
}

// Strings, function bodies and comments are opaque. Tokens never include data literals.
fn tokenize(text: &str, sql: bool) -> (Vec<Token>, bool) {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let (mut index, mut line) = (0, 1);
    let mut complete = true;
    while index < bytes.len() {
        if out.len() >= MAX_TOKENS {
            complete = false;
            break;
        }
        let byte = bytes[index];
        if byte.is_ascii_whitespace() {
            if byte == b'\n' {
                line += 1;
            }
            index += 1;
            continue;
        }
        if (sql && bytes[index..].starts_with(b"--")) || (!sql && bytes[index..].starts_with(b"//"))
        {
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if bytes[index..].starts_with(b"/*") {
            index += 2;
            let mut depth = 1u32;
            while index + 1 < bytes.len() && depth > 0 {
                if sql && bytes[index..].starts_with(b"/*") {
                    depth += 1;
                    if depth > 32 {
                        complete = false;
                        break;
                    }
                    index += 2;
                    continue;
                }
                if bytes[index..].starts_with(b"*/") {
                    depth -= 1;
                    index += 2;
                    continue;
                }
                if bytes[index] == b'\n' {
                    line += 1;
                }
                index += 1;
            }
            if depth > 0 {
                complete = false;
                break;
            }
            continue;
        }
        if sql && byte == b'$' {
            let mut end = index + 1;
            while end < bytes.len()
                && end - index <= 64
                && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_')
            {
                end += 1;
            }
            if bytes.get(end) == Some(&b'$') {
                let delimiter = &text[index..=end];
                let start = end + 1;
                if let Some(offset) = text[start..].find(delimiter) {
                    let finish = start + offset + delimiter.len();
                    let token_line = line;
                    line += bytes[index..finish].iter().filter(|b| **b == b'\n').count();
                    out.push(Token {
                        value: "<body>".into(),
                        line: token_line,
                    });
                    index = finish;
                    continue;
                }
                complete = false;
                break;
            }
        }
        if byte == b'\'' || byte == b'"' {
            let quote = byte;
            let start = index;
            let token_line = line;
            let escaped_string = !sql
                || (quote == b'\''
                    && start > 0
                    && matches!(bytes[start - 1], b'E' | b'e')
                    && (start == 1 || !bytes[start - 2].is_ascii_alphanumeric()));
            index += 1;
            let mut closed = false;
            while index < bytes.len() {
                if bytes[index] == b'\n' {
                    line += 1;
                }
                if bytes[index] == b'\\' && escaped_string {
                    if bytes.get(index + 1) == Some(&b'\n') {
                        line += 1;
                    }
                    index = (index + 2).min(bytes.len());
                    continue;
                }
                if bytes[index] == quote {
                    if sql && bytes.get(index + 1) == Some(&quote) {
                        index += 2;
                        continue;
                    }
                    index += 1;
                    closed = true;
                    break;
                }
                index += 1;
            }
            if !closed {
                complete = false;
                break;
            }
            out.push(Token {
                value: if sql && quote == b'"' {
                    text[start..index].to_string()
                } else {
                    "<literal>".into()
                },
                line: token_line,
            });
            continue;
        }
        let start = index;
        if byte.is_ascii_alphanumeric() || byte == b'_' {
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            out.push(Token {
                value: text[start..index].to_ascii_lowercase(),
                line,
            });
        } else if byte.is_ascii() {
            index += 1;
            if index < bytes.len()
                && matches!(
                    (byte, bytes[index]),
                    (b'!', b'=')
                        | (b'=', b'=')
                        | (b'&', b'&')
                        | (b'|', b'|')
                        | (b'<', b'=')
                        | (b'>', b'=')
                )
            {
                index += 1;
            }
            out.push(Token {
                value: text[start..index].into(),
                line,
            });
        } else {
            // Unsupported unquoted identifier: preserve an opaque token, not a false match.
            index += text[index..]
                .chars()
                .next()
                .map(char::len_utf8)
                .unwrap_or(1);
            out.push(Token {
                value: "<unsupported>".into(),
                line,
            });
            complete = false;
        }
    }
    (out, complete)
}

fn word(tokens: &[Token], index: usize) -> &str {
    tokens
        .get(index)
        .map(|token| token.value.as_str())
        .unwrap_or("")
}
fn sequence(tokens: &[Token], words: &[&str]) -> bool {
    tokens.windows(words.len()).any(|window| {
        window
            .iter()
            .zip(words)
            .all(|(token, word)| token.value == *word)
    })
}
fn identifier(token: &str) -> Option<String> {
    if token.starts_with('"') && token.ends_with('"') && token.len() > 2 {
        let value = token[1..token.len() - 1].replace("\"\"", "\"");
        if value.len() <= 128 && !value.chars().any(char::is_control) {
            return Some(value);
        }
    } else if token.len() <= 128
        && token
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Some(token.into());
    }
    None
}
fn relation(tokens: &[Token], mut index: usize) -> Option<Relation> {
    if word(tokens, index) == "if" {
        index += if word(tokens, index + 1) == "not" {
            3
        } else {
            2
        };
    }
    if word(tokens, index) == "only" {
        index += 1;
    }
    let first = identifier(word(tokens, index))?;
    if word(tokens, index + 1) == "." {
        Some(Relation {
            schema: first,
            name: identifier(word(tokens, index + 2))?,
        })
    } else {
        Some(Relation {
            schema: "public".into(),
            name: first,
        })
    }
}
fn true_clause(tokens: &[Token], name: &str) -> bool {
    tokens.iter().enumerate().any(|(index, token)| {
        token.value == name
            && word(tokens, index + 1) == "("
            && word(tokens, index + 2) == "true"
            && word(tokens, index + 3) == ")"
    })
}

impl Inspector {
    fn push(&mut self, finding: SourceFinding) {
        if self.findings.len() < MAX_FINDINGS {
            self.findings.push(finding);
        } else {
            self.partial = true;
        }
    }

    pub fn inspect(&mut self, path: &str, text: &str) {
        let lower_path = path.to_ascii_lowercase();
        let name = lower_path.rsplit('/').next().unwrap_or(&lower_path);
        if lower_path.ends_with(".sql")
            && (lower_path.split('/').any(|part| part == "supabase")
                || text.contains("auth.uid")
                || text.contains("storage.objects")
                || text.contains("supabase"))
        {
            self.supabase_files += 1;
            let (tokens, complete) = tokenize(text, true);
            self.partial |= !complete;
            for statement in tokens.split(|token| token.value == ";") {
                if statement.is_empty() {
                    continue;
                }
                let line = statement[0].line;
                if word(statement, 0) == "create"
                    && (word(statement, 1) == "table"
                        || (word(statement, 1) == "unlogged" && word(statement, 2) == "table"))
                {
                    let index = if word(statement, 1) == "table" { 2 } else { 3 };
                    if let Some(table) =
                        relation(statement, index).filter(|table| table.schema == "public")
                    {
                        if self.created.len() < 2000 {
                            self.created
                                .entry(table.key())
                                .or_insert((path.into(), line, table));
                        } else {
                            self.partial = true;
                        }
                    }
                }
                if word(statement, 0) == "alter" && word(statement, 1) == "table" {
                    if let Some(table) = relation(statement, 2) {
                        if sequence(statement, &["enable", "row", "level", "security"]) {
                            if self.enabled.len() < 2000 {
                                self.enabled.insert(table.key());
                            } else {
                                self.partial = true;
                            }
                        }
                        if sequence(statement, &["disable", "row", "level", "security"]) {
                            self.push(finding(&RLS_DISABLED, path, line, Some(format!("-- Revise em homologação; RLS sem políticas pode bloquear o aplicativo.\nALTER TABLE {} ENABLE ROW LEVEL SECURITY;", table.quoted()))));
                        }
                    }
                }
                if word(statement, 0) == "create"
                    && word(statement, 1) == "policy"
                    && (true_clause(statement, "using") || true_clause(statement, "check"))
                {
                    self.push(finding(&POLICY_OPEN, path, line, Some("-- Revise a política existente e substitua o predicado incondicional.\n-- Para dados privados, vincule auth.uid() à coluna de proprietário validada.\n-- Não adicione apenas outra política permissiva: políticas podem ser combinadas por OR.".into())));
                }
                if word(statement, 0) == "create"
                    && sequence(statement, &["security", "definer"])
                    && !sequence(statement, &["set", "search_path"])
                {
                    self.push(finding(&DEFINER_PATH, path, line, Some("-- Na definição da função, após revisar nomes qualificados por schema:\n-- SECURITY DEFINER\n-- SET search_path = ''\n-- Revise também os grants de EXECUTE e a identidade do proprietário.".into())));
                }
            }
        }
        if lower_path.ends_with(".rules")
            && (text.contains("cloud.firestore") || text.contains("firebase.storage"))
        {
            self.firebase_files += 1;
            let (tokens, complete) = tokenize(text, false);
            self.partial |= !complete;
            for (index, token) in tokens
                .iter()
                .enumerate()
                .filter(|(_, token)| token.value == "allow")
            {
                let tail = &tokens[index + 1..];
                let Some(colon) = tail
                    .iter()
                    .position(|token| matches!(token.value.as_str(), ":" | ";" | "allow" | "}"))
                else {
                    self.partial = true;
                    continue;
                };
                if word(tail, colon) != ":" || word(tail, colon + 1) != "if" {
                    self.partial = true;
                    continue;
                }
                let condition = &tail[colon + 2..];
                let Some(end) = condition
                    .iter()
                    .position(|token| matches!(token.value.as_str(), ";" | "allow" | "}"))
                else {
                    self.partial = true;
                    continue;
                };
                if condition[end].value != ";" {
                    self.partial = true;
                    continue;
                }
                let values: Vec<&str> = condition[..end]
                    .iter()
                    .map(|token| token.value.as_str())
                    .filter(|value| !matches!(*value, "(" | ")"))
                    .collect();
                if values == ["true"] {
                    let mut finding = finding(&FIREBASE_OPEN, path, token.line, None);
                    if !tail[..colon].iter().any(|token| {
                        matches!(
                            token.value.as_str(),
                            "write" | "create" | "update" | "delete"
                        )
                    }) {
                        finding.severity = Severity::Medium;
                    }
                    self.push(finding);
                } else if values == ["request", ".", "auth", "!=", "null"] {
                    self.push(finding(&FIREBASE_AUTH_ONLY, path, token.line, None));
                }
            }
        }
        if name.ends_with("rules.json") {
            match serde_json::from_str::<serde_json::Value>(text) {
                Ok(value) if value.get("rules").is_some() => {
                    self.firebase_files += 1;
                    if !value.get("rules").is_some_and(|rules| rules.is_object()) {
                        self.partial = true;
                        return;
                    }
                    let mut pending = vec![(value.get("rules").unwrap(), 0usize)];
                    let mut visited = 0usize;
                    while let Some((value, depth)) = pending.pop() {
                        visited += 1;
                        if depth > 32 || visited > 10000 {
                            self.partial = true;
                            break;
                        }
                        if let Some(object) = value.as_object() {
                            for (key, value) in object {
                                if matches!(key.as_str(), ".read" | ".write")
                                    && !value.is_boolean()
                                    && !value.is_string()
                                {
                                    self.partial = true;
                                    continue;
                                }
                                if matches!(key.as_str(), ".read" | ".write")
                                    && (value == &serde_json::Value::Bool(true)
                                        || value.as_str().is_some_and(|s| s.trim() == "true"))
                                {
                                    let mut finding = finding(&FIREBASE_OPEN, path, 0, None);
                                    if key == ".read" {
                                        finding.severity = Severity::Medium;
                                    }
                                    // Keep individual access modes distinct even without a precise source line.
                                    finding.id = format!(
                                        "{:x}",
                                        Sha256::digest(format!(
                                            "{}|{path}|{visited}|{key}",
                                            FIREBASE_OPEN.id
                                        ))
                                    );
                                    self.push(finding);
                                } else if value.is_object() {
                                    if pending.len() < 10000 {
                                        pending.push((value, depth + 1));
                                    } else {
                                        self.partial = true;
                                    }
                                }
                            }
                        }
                    }
                }
                Err(_) => {
                    self.firebase_files += 1;
                    self.partial = true;
                }
                _ => {}
            }
        }
    }

    pub fn finish(mut self) -> Inspection {
        for (key, (path, line, table)) in std::mem::take(&mut self.created) {
            if !self.enabled.contains(&key) {
                self.push(finding(&RLS_MISSING, &path, line, Some(format!("-- Modelo para revisão: confirme grants e crie políticas mínimas antes de aplicar.\nALTER TABLE {} ENABLE ROW LEVEL SECURITY;\n-- Teste os fluxos legítimos e o isolamento de contas em homologação.", table.quoted()))));
            }
        }
        Inspection {
            findings: self.findings,
            supabase_files: self.supabase_files,
            firebase_files: self.firebase_files,
            partial: self.partial,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supabase_rls_is_correlated_across_files_without_claiming_remote_state() {
        let mut inspector = Inspector::default();
        inspector.inspect(
            "supabase/migrations/001.sql",
            "CREATE TABLE public.accounts(id uuid); CREATE TABLE public.notes(id uuid);",
        );
        inspector.inspect(
            "supabase/migrations/002.sql",
            "ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;",
        );
        let result = inspector.finish();
        assert_eq!(result.findings.len(), 1);
        assert_eq!(result.findings[0].rule_id, "supabase.rls-not-observed");
        assert!(result.findings[0]
            .suggested_fix
            .as_ref()
            .unwrap()
            .contains("\"public\".\"notes\""));
        assert_eq!(result.supabase_files, 2);
    }
    #[test]
    fn comments_literals_and_function_bodies_cannot_invent_policy_findings() {
        let mut inspector = Inspector::default();
        inspector.inspect("supabase/migrations/001.sql", "-- ALTER TABLE public.a DISABLE ROW LEVEL SECURITY;\nSELECT 'CREATE POLICY p ON public.a USING (true);';\nCREATE FUNCTION f() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT 'hello; world'; $$;");
        assert!(inspector.finish().findings.is_empty());
        let mut inspector = Inspector::default();
        inspector.inspect(
            "migrations/other-postgres.sql",
            "CREATE TABLE public.a(id int);",
        );
        assert_eq!(inspector.finish().supabase_files, 0);
    }
    #[test]
    fn permissive_storage_policy_and_privileged_function_are_detected_without_literals() {
        let mut inspector = Inspector::default();
        inspector.inspect("supabase/migrations/001.sql", "CREATE POLICY p ON storage.objects FOR ALL TO anon USING (true) WITH CHECK (true);\nCREATE FUNCTION dangerous() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'private-value-do-not-copy'; $$;");
        let result = inspector.finish();
        assert_eq!(result.findings.len(), 2);
        assert!(result
            .findings
            .iter()
            .any(|finding| finding.rule_id == "supabase.definer-search-path"));
        assert!(!serde_json::to_string(&result.findings)
            .unwrap()
            .contains("private-value-do-not-copy"));
    }
    #[test]
    fn firebase_distinguishes_open_auth_only_and_owner_checks() {
        let mut inspector = Inspector::default();
        inspector.inspect("firestore.rules", "service cloud.firestore {\n match /databases/{db}/documents {\n // allow write: if true;\n allow read: if true;\n allow write: if request.auth != null;\n allow update: if request.auth != null && request.auth.uid == resource.data.owner;\n } }");
        let result = inspector.finish();
        assert_eq!(result.findings.len(), 2);
        assert_eq!(result.findings[0].line, 4);
        assert_eq!(
            result.findings[1].rule_id,
            "firebase.auth-without-isolation"
        );
    }
    #[test]
    fn realtime_database_rules_are_read_without_fetching_any_data() {
        let mut inspector = Inspector::default();
        inspector.inspect(
            "database.rules.json",
            r#"{"rules":{".read":true,".write":"true","private":{".read":"auth.uid == $uid"}}}"#,
        );
        let result = inspector.finish();
        assert_eq!(result.firebase_files, 1);
        assert_eq!(result.findings.len(), 2);
        assert!(result.findings.iter().all(|finding| finding.line == 0));
    }
    #[test]
    fn malformed_policy_files_mark_coverage_partial() {
        let mut inspector = Inspector::default();
        inspector.inspect("database.rules.json", "{broken");
        inspector.inspect(
            "supabase/migrations/broken.sql",
            "CREATE FUNCTION f() RETURNS int AS $$ unterminated",
        );
        assert!(inspector.finish().partial);
    }

    #[test]
    fn nested_sql_comments_and_escaped_literals_are_opaque() {
        let mut inspector = Inspector::default();
        inspector.inspect(
            "supabase/migrations/001.sql",
            r#"/* outer /* nested */ CREATE POLICY p ON public.t USING (true); */
SELECT E'escaped\'; CREATE POLICY fake ON public.t USING (true);';"#,
        );
        assert!(inspector.finish().findings.is_empty());
    }

    #[test]
    fn malformed_repeated_allow_tokens_do_not_create_findings() {
        let mut inspector = Inspector::default();
        inspector.inspect(
            "firestore.rules",
            &format!("service cloud.firestore {{ {} }}", "allow ".repeat(10000)),
        );
        let result = inspector.finish();
        assert!(result.partial);
        assert!(result.findings.is_empty());
    }
}
