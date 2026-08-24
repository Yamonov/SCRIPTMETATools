use std::{fs, path::Path};

use assert_cmd::{Command, cargo::cargo_bin_cmd};
use predicates::prelude::*;
use serde_json::Value;

fn write_script(path: &Path, script_id: &str, version: &str, meta_url: Option<&str>) {
    let meta_url_line = meta_url.map_or_else(String::new, |url| format!("Meta-URL: {url}\n"));
    let source = format!(
        "/*\nSCRIPTMETA-BEGIN\nScript-ID: {script_id}\nVersion: {version}\n{meta_url_line}Name: Sample Script\nSCRIPTMETA-END\n*/\n"
    );
    fs::write(path, source).expect("write script fixture");
}

fn scriptmeta() -> Command {
    cargo_bin_cmd!("scriptmeta")
}

#[test]
fn help_lists_the_initial_commands() {
    scriptmeta()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("check"))
        .stdout(predicate::str::contains("scan"))
        .stdout(predicate::str::contains("inspect"))
        .stdout(predicate::str::contains("validate"))
        .stdout(predicate::str::contains("formats"))
        .stdout(predicate::str::contains("completions"));
}

#[test]
fn no_arguments_reports_a_usage_error() {
    scriptmeta()
        .assert()
        .code(2)
        .stderr(predicate::str::contains("at least one directory"));
}

#[test]
fn scan_json_reports_discovered_metadata() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_script(
        &temp.path().join("Sample.jsx"),
        "com.example.scan",
        "1.0.0",
        None,
    );

    let output = scriptmeta()
        .args(["scan", "--format", "json"])
        .arg(temp.path())
        .output()
        .expect("run scriptmeta scan");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).expect("json report");
    assert_eq!(report["command"], "scan");
    assert_eq!(report["items"][0]["script_id"], "com.example.scan");
    assert_eq!(report["items"][0]["status"], "scanned");
}

#[test]
fn directory_arguments_default_to_update_check() {
    let temp = tempfile::tempdir().expect("tempdir");
    let distribution = temp.path().join("distribution.txt");
    fs::write(
        &distribution,
        "SCRIPTMETA-DIST-BEGIN\nScript-ID: com.example.update\nLatest-Version: 2.0.0\nLatest-Page-URL: https://example.com/update\nSCRIPTMETA-DIST-END\n",
    )
    .expect("write distribution fixture");
    let meta_url = url::Url::from_file_path(&distribution).expect("file URL");
    write_script(
        &temp.path().join("Update.jsx"),
        "com.example.update",
        "1.0.0",
        Some(meta_url.as_str()),
    );

    let output = scriptmeta()
        .args(["--format", "json"])
        .arg(temp.path())
        .output()
        .expect("run scriptmeta check");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).expect("json report");
    assert_eq!(report["command"], "check");
    assert_eq!(report["items"][0]["status"], "update_available");
    assert_eq!(report["items"][0]["latest_version"], "2.0.0");
}

#[test]
fn invalid_directory_returns_input_error() {
    scriptmeta()
        .arg("path-that-does-not-exist")
        .assert()
        .code(2)
        .stderr(predicate::str::contains("directory does not exist"));
}

#[test]
fn validate_reports_duplicate_script_ids() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_script(
        &temp.path().join("First.jsx"),
        "com.example.duplicate",
        "1.0.0",
        None,
    );
    write_script(
        &temp.path().join("Second.jsx"),
        "com.example.duplicate",
        "1.1.0",
        None,
    );

    let output = scriptmeta()
        .args(["validate", "--format", "json"])
        .arg(temp.path())
        .output()
        .expect("run scriptmeta validate");

    assert_eq!(output.status.code(), Some(4));
    let report: Value = serde_json::from_slice(&output.stdout).expect("json report");
    assert_eq!(report["valid"], false);
    assert_eq!(
        report["duplicates"][0]["script_id"],
        "com.example.duplicate"
    );
}

#[test]
fn inspect_reports_metadata_and_file_capabilities() {
    let temp = tempfile::tempdir().expect("tempdir");
    let path = temp.path().join("Inspect.jsx");
    write_script(&path, "com.example.inspect", "3.2.1", None);

    let output = scriptmeta()
        .args(["inspect", "--format", "json"])
        .arg(&path)
        .output()
        .expect("run scriptmeta inspect");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).expect("json report");
    assert_eq!(report["metadata"]["script_id"], "com.example.inspect");
    assert_eq!(report["metadata"]["version"], "3.2.1");
    assert_eq!(report["inspection"]["is_supported_script_path"], true);
}

#[test]
fn formats_json_lists_supported_extensions() {
    let output = scriptmeta()
        .args(["formats", "--format", "json"])
        .output()
        .expect("run scriptmeta formats");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).expect("json report");
    assert_eq!(report["command"], "formats");
    assert!(
        report["supported_extensions"]
            .as_array()
            .expect("extension array")
            .iter()
            .any(|extension| extension == "jsx")
    );
}

#[test]
fn explicit_check_command_matches_the_default_operation() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_script(
        &temp.path().join("Explicit.jsx"),
        "com.example.explicit",
        "1.0.0",
        None,
    );

    let output = scriptmeta()
        .args(["check", "--format", "json"])
        .arg(temp.path())
        .output()
        .expect("run explicit check");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).expect("json report");
    assert_eq!(report["command"], "check");
    assert_eq!(report["items"][0]["status"], "not_checkable");
}

#[test]
fn paths_from_supplies_directories_with_spaces() {
    let temp = tempfile::tempdir().expect("tempdir");
    let root = temp.path().join("Scripts With Spaces");
    fs::create_dir(&root).expect("create script root");
    write_script(
        &root.join("Listed.jsx"),
        "com.example.paths-from",
        "1.0.0",
        None,
    );
    let list = temp.path().join("directories.txt");
    fs::write(&list, format!("{}\n", root.display())).expect("write path list");

    let output = scriptmeta()
        .args(["scan", "--format", "json", "--paths-from"])
        .arg(&list)
        .output()
        .expect("run scan with paths file");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).expect("json report");
    assert_eq!(report["items"][0]["script_id"], "com.example.paths-from");
}

#[test]
fn fail_on_updates_returns_the_documented_exit_code() {
    let temp = tempfile::tempdir().expect("tempdir");
    let distribution = temp.path().join("distribution.txt");
    fs::write(
        &distribution,
        "SCRIPTMETA-DIST-BEGIN\nScript-ID: com.example.fail-on-update\nLatest-Version: 2.0.0\nSCRIPTMETA-DIST-END\n",
    )
    .expect("write distribution fixture");
    let meta_url = url::Url::from_file_path(&distribution).expect("file URL");
    write_script(
        &temp.path().join("Update.jsx"),
        "com.example.fail-on-update",
        "1.0.0",
        Some(meta_url.as_str()),
    );

    scriptmeta()
        .args(["--fail-on", "updates", "--format", "json"])
        .arg(temp.path())
        .assert()
        .code(10);
}

#[test]
fn status_filter_changes_items_but_not_the_summary() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_script(
        &temp.path().join("Filtered.jsx"),
        "com.example.filtered",
        "1.0.0",
        None,
    );

    let output = scriptmeta()
        .args(["--format", "json", "--status", "up-to-date"])
        .arg(temp.path())
        .output()
        .expect("run filtered check");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).expect("json report");
    assert_eq!(report["items"].as_array().expect("items").len(), 0);
    assert_eq!(report["summary"]["not_checkable"], 1);
}

#[test]
fn jsonl_contains_item_and_summary_records() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_script(
        &temp.path().join("Jsonl.jsx"),
        "com.example.jsonl",
        "1.0.0",
        None,
    );

    let output = scriptmeta()
        .args(["scan", "--format", "jsonl"])
        .arg(temp.path())
        .output()
        .expect("run JSONL scan");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let records = String::from_utf8(output.stdout)
        .expect("UTF-8 JSONL")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("JSONL record"))
        .collect::<Vec<_>>();
    assert!(records.iter().any(|record| record["type"] == "item"));
    assert!(records.iter().any(|record| record["type"] == "summary"));
}

#[test]
fn validate_file_reports_an_invalid_meta_url() {
    let temp = tempfile::tempdir().expect("tempdir");
    let path = temp.path().join("InvalidURL.jsx");
    write_script(&path, "com.example.invalid-url", "1.0.0", Some("not a URL"));

    let output = scriptmeta()
        .args(["validate", "--format", "json"])
        .arg(&path)
        .output()
        .expect("validate invalid URL");

    assert_eq!(output.status.code(), Some(4));
    let report: Value = serde_json::from_slice(&output.stdout).expect("json report");
    assert!(
        report["issues"]
            .as_array()
            .expect("issues")
            .iter()
            .any(|issue| issue["code"] == "invalid_meta_url")
    );
}

#[test]
fn completions_generates_zsh_definitions() {
    scriptmeta()
        .args(["completions", "zsh"])
        .assert()
        .success()
        .stdout(predicate::str::contains("#compdef scriptmeta"));
}

#[test]
fn failed_update_check_returns_four_by_default() {
    let temp = tempfile::tempdir().expect("tempdir");
    let missing_distribution = temp.path().join("missing-distribution.txt");
    let meta_url = url::Url::from_file_path(&missing_distribution).expect("file URL");
    write_script(
        &temp.path().join("Failure.jsx"),
        "com.example.failure",
        "1.0.0",
        Some(meta_url.as_str()),
    );

    scriptmeta()
        .args(["--format", "json"])
        .arg(temp.path())
        .assert()
        .code(4)
        .stdout(predicate::str::contains("\"status\": \"failed\""));
}

#[test]
fn fail_on_never_preserves_failed_results_but_returns_zero() {
    let temp = tempfile::tempdir().expect("tempdir");
    let missing_distribution = temp.path().join("missing-distribution.txt");
    let meta_url = url::Url::from_file_path(&missing_distribution).expect("file URL");
    write_script(
        &temp.path().join("AllowedFailure.jsx"),
        "com.example.allowed-failure",
        "1.0.0",
        Some(meta_url.as_str()),
    );

    scriptmeta()
        .args(["--format", "json", "--fail-on", "never"])
        .arg(temp.path())
        .assert()
        .success()
        .stdout(predicate::str::contains("\"status\": \"failed\""));
}

#[test]
fn paths_from_stdin_is_supported() {
    let temp = tempfile::tempdir().expect("tempdir");
    write_script(
        &temp.path().join("Stdin.jsx"),
        "com.example.stdin",
        "1.0.0",
        None,
    );

    scriptmeta()
        .args(["scan", "--format", "json", "--paths-from", "-"])
        .write_stdin(format!("{}\n", temp.path().display()))
        .assert()
        .success()
        .stdout(predicate::str::contains("com.example.stdin"));
}
