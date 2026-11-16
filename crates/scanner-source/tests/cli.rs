use std::{fs, process::Command};

#[test]
fn predeploy_cli_uses_real_scanner_and_preserves_conservative_exit_codes() {
    let root = std::env::temp_dir().join(format!("qypher-cli-fixture-{}", uuid::Uuid::new_v4()));
    let baseline = root.with_extension("baseline.json");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("danger.py"), "pickle.loads(untrusted)\n").unwrap();
    let command = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_qypher-check"))
            .args(args)
            .output()
            .unwrap()
    };
    let path = root.to_str().unwrap();
    let report_path = baseline.to_str().unwrap();
    assert_eq!(command(&["--path", path]).status.code(), Some(1));
    let blocked = command(&["--path", path, "--authorized", "--output", report_path]);
    assert_eq!(
        blocked.status.code(),
        Some(2),
        "{}",
        String::from_utf8_lossy(&blocked.stderr)
    );
    assert!(String::from_utf8_lossy(&blocked.stdout).contains("blocked"));
    let snapshot: serde_json::Value =
        serde_json::from_slice(&fs::read(&baseline).unwrap()).unwrap();
    assert!(!snapshot["findings"].as_array().unwrap().is_empty());
    fs::write(root.join("danger.py"), "value = 1\n").unwrap();
    let after = command(&["--path", path, "--authorized", "--baseline", report_path]);
    assert_eq!(
        after.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&after.stderr)
    );
    let gate: serde_json::Value = serde_json::from_slice(&after.stdout).unwrap();
    assert_eq!(gate["comparison"]["resolved"].as_array().unwrap().len(), 1);
    fs::write(
        root.join("package.json"),
        r#"{"dependencies":{"example":"1.2.3"}}"#,
    )
    .unwrap();
    let partial = command(&["--path", path, "--authorized"]);
    assert_eq!(partial.status.code(), Some(3));
    fs::remove_file(baseline).unwrap();
    fs::remove_dir_all(root).unwrap();
}
