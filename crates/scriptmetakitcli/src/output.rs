use std::{fmt::Write as _, io::Write};

use serde::Serialize;

use crate::{
    cli::{ColorMode, Options, OutputFormat},
    error::CliError,
    model::{FormatsReport, InspectionReport, ItemStatus, ScanReport, ValidationReport},
};

pub fn write_scan_report(
    report: &ScanReport,
    options: &Options,
    color_enabled: bool,
    output: &mut dyn Write,
) -> Result<(), CliError> {
    match options.format {
        OutputFormat::Human => write_scan_human(report, options, color_enabled, output),
        OutputFormat::Json => write_json(report, true, output),
        OutputFormat::Jsonl => {
            for root in &report.roots {
                write_json_line(&serde_json::json!({ "type": "root", "root": root }), output)?;
            }
            for item in &report.items {
                write_json_line(&serde_json::json!({ "type": "item", "item": item }), output)?;
            }
            for issue in &report.issues {
                write_json_line(
                    &serde_json::json!({ "type": "issue", "issue": issue }),
                    output,
                )?;
            }
            write_json_line(
                &serde_json::json!({
                    "type": "summary",
                    "schema_version": report.schema_version,
                    "command": report.command,
                    "scriptmeta_version": report.scriptmeta_version,
                    "scriptmetakit_version": report.scriptmetakit_version,
                    "checked_at": report.checked_at,
                    "summary": report.summary,
                    "interrupted": report.interrupted
                }),
                output,
            )
        }
    }
}

pub fn write_validation_report(
    report: &ValidationReport,
    options: &Options,
    output: &mut dyn Write,
) -> Result<(), CliError> {
    match options.format {
        OutputFormat::Human => {
            if report.valid {
                writeln!(
                    output,
                    "Valid: {} SCRIPTMETA item(s) across {} input path(s)",
                    report.valid_items, report.checked_paths
                )?;
            } else {
                writeln!(
                    output,
                    "Invalid: {} issue(s), {} duplicate Script-ID group(s)",
                    report.issues.len(),
                    report.duplicates.len()
                )?;
                for issue in &report.issues {
                    writeln!(
                        output,
                        "ERROR\t{}\t{}\t{}",
                        issue.code,
                        human_cell(&issue.path.display().to_string()),
                        human_cell(&issue.message)
                    )?;
                }
                for duplicate in &report.duplicates {
                    writeln!(
                        output,
                        "DUPLICATE\t{}\t{}",
                        human_cell(&duplicate.script_id),
                        human_cell(
                            &duplicate
                                .file_paths
                                .iter()
                                .map(|path| path.display().to_string())
                                .collect::<Vec<_>>()
                                .join(", ")
                        )
                    )?;
                }
            }
            Ok(())
        }
        OutputFormat::Json => write_json(report, true, output),
        OutputFormat::Jsonl => {
            for issue in &report.issues {
                write_json_line(
                    &serde_json::json!({ "type": "issue", "issue": issue }),
                    output,
                )?;
            }
            for duplicate in &report.duplicates {
                write_json_line(
                    &serde_json::json!({ "type": "duplicate", "duplicate": duplicate }),
                    output,
                )?;
            }
            write_json_line(
                &serde_json::json!({
                    "type": "summary",
                    "schema_version": report.schema_version,
                    "command": report.command,
                    "valid": report.valid,
                    "checked_paths": report.checked_paths,
                    "valid_items": report.valid_items
                }),
                output,
            )
        }
    }
}

pub fn write_inspection_report(
    report: &InspectionReport,
    options: &Options,
    output: &mut dyn Write,
) -> Result<(), CliError> {
    match options.format {
        OutputFormat::Human => {
            writeln!(
                output,
                "Path: {}",
                human_cell(&report.path.display().to_string())
            )?;
            writeln!(
                output,
                "Supported: {}",
                report.inspection.is_supported_script_path
            )?;
            writeln!(
                output,
                "Edit state: {}",
                report.inspection.scriptmeta_edit_state.as_str()
            )?;
            if let Some(metadata) = report.metadata.as_ref() {
                writeln!(output, "Script-ID: {}", human_cell(&metadata.script_id))?;
                writeln!(
                    output,
                    "Version: {}",
                    human_cell(metadata.version.as_deref().unwrap_or("-"))
                )?;
                writeln!(
                    output,
                    "Meta-URL: {}",
                    human_cell(
                        &metadata
                            .meta_url
                            .as_ref()
                            .map_or("-".to_string(), ToString::to_string)
                    )
                )?;
            } else {
                writeln!(output, "SCRIPTMETA: not found")?;
            }
            if let Some(error) = report.metadata_error.as_ref() {
                writeln!(
                    output,
                    "Error: {}: {}",
                    error.code,
                    human_cell(&error.message)
                )?;
            }
            Ok(())
        }
        OutputFormat::Json => write_json(report, true, output),
        OutputFormat::Jsonl => write_json_line(report, output),
    }
}

pub fn write_formats_report(
    report: &FormatsReport,
    options: &Options,
    output: &mut dyn Write,
) -> Result<(), CliError> {
    match options.format {
        OutputFormat::Human => {
            writeln!(
                output,
                "Supported extensions: {}",
                report.supported_extensions.join(", ")
            )?;
            for format in &report.formats {
                writeln!(
                    output,
                    "{}\t{}\twrite={}\tpackage={}",
                    format.kind,
                    format.extensions.join(","),
                    format.supports_scriptmeta_write,
                    format.is_package
                )?;
            }
            Ok(())
        }
        OutputFormat::Json => write_json(report, true, output),
        OutputFormat::Jsonl => {
            for format in &report.formats {
                write_json_line(
                    &serde_json::json!({ "type": "format", "format": format }),
                    output,
                )?;
            }
            write_json_line(
                &serde_json::json!({
                    "type": "summary",
                    "schema_version": report.schema_version,
                    "supported_extensions": report.supported_extensions
                }),
                output,
            )
        }
    }
}

#[must_use]
pub fn color_is_enabled(options: &Options, stdout_is_terminal: bool, no_color: bool) -> bool {
    if options.format != OutputFormat::Human || no_color {
        return false;
    }
    match options.color {
        ColorMode::Auto => stdout_is_terminal,
        ColorMode::Always => true,
        ColorMode::Never => false,
    }
}

fn write_scan_human(
    report: &ScanReport,
    options: &Options,
    color_enabled: bool,
    output: &mut dyn Write,
) -> Result<(), CliError> {
    if !options.quiet {
        writeln!(output, "STATUS\tNAME\tCURRENT\tLATEST\tPATH")?;
    }
    for item in &report.items {
        let status = colored_status(item.status, color_enabled);
        let name = human_cell(item.name.as_deref().unwrap_or(&item.script_id));
        writeln!(
            output,
            "{}\t{}\t{}\t{}\t{}",
            status,
            name,
            human_cell(item.current_version.as_deref().unwrap_or("-")),
            human_cell(item.latest_version.as_deref().unwrap_or("-")),
            human_cell(&item.path.display().to_string())
        )?;
        if options.verbose > 0
            && let Some(error) = item.error.as_ref()
        {
            writeln!(
                output,
                "  error {}: {}",
                error.code,
                human_cell(&error.message)
            )?;
        }
    }
    for issue in &report.issues {
        writeln!(
            output,
            "ISSUE\t{}\t{}\t{}",
            issue.code,
            human_cell(&issue.path.display().to_string()),
            human_cell(&issue.message)
        )?;
    }
    if options.verbose > 0 {
        for root in &report.roots {
            writeln!(
                output,
                "ROOT\t{}\t{}\titems={}\t{}",
                root.status,
                human_cell(&root.path.display().to_string()),
                root.item_count,
                human_cell(
                    &root
                        .error
                        .as_ref()
                        .map_or("".to_string(), |error| error.message.clone())
                )
            )?;
        }
    }
    if !options.quiet {
        writeln!(
            output,
            "Summary: {} scripts, {} updates, {} current, {} not checkable, {} failed, {} cancelled",
            report.summary.total,
            report.summary.update_available,
            report.summary.up_to_date,
            report.summary.not_checkable,
            report.summary.failed,
            report.summary.cancelled
        )?;
    }
    Ok(())
}

fn colored_status(status: ItemStatus, enabled: bool) -> String {
    if !enabled {
        return status.as_str().to_string();
    }
    let color = match status {
        ItemStatus::UpdateAvailable => "\x1b[33m",
        ItemStatus::UpToDate | ItemStatus::Scanned => "\x1b[32m",
        ItemStatus::NotCheckable => "\x1b[36m",
        ItemStatus::Failed => "\x1b[31m",
        ItemStatus::Cancelled => "\x1b[35m",
    };
    format!("{color}{}\x1b[0m", status.as_str())
}

fn human_cell(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\t' => output.push_str("\\t"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            character if character.is_control() => {
                let _ = write!(output, "\\u{{{:x}}}", u32::from(character));
            }
            character => output.push(character),
        }
    }
    output
}

fn write_json<T: Serialize + ?Sized>(
    value: &T,
    pretty: bool,
    output: &mut dyn Write,
) -> Result<(), CliError> {
    if pretty {
        serde_json::to_writer_pretty(&mut *output, value)?;
    } else {
        serde_json::to_writer(&mut *output, value)?;
    }
    writeln!(output)?;
    Ok(())
}

fn write_json_line<T: Serialize + ?Sized>(
    value: &T,
    output: &mut dyn Write,
) -> Result<(), CliError> {
    write_json(value, false, output)
}

#[cfg(test)]
mod tests {
    use super::human_cell;

    #[test]
    fn human_cell_preserves_unicode_and_escapes_terminal_controls() {
        assert_eq!(
            human_cell("日本語\tline\n\u{1b}[31m"),
            "日本語\\tline\\n\\u{1b}[31m"
        );
    }
}
