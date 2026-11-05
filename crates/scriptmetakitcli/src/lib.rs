#![deny(unsafe_code)]

use std::{
    collections::BTreeSet,
    fs,
    io::{BufRead, Write},
    path::{Path, PathBuf},
};

use clap::CommandFactory;

pub mod cli;
mod commands;
mod error;
mod model;
mod output;
mod signal;

pub use error::CliError;

use cli::{Cli, Command, FailOn, Options, ProgressMode};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ExecutionEnvironment {
    pub stdout_is_terminal: bool,
    pub stderr_is_terminal: bool,
    pub no_color: bool,
}

pub fn install_signal_handler() -> Result<(), CliError> {
    signal::install_handler()
}

pub fn execute(
    cli: Cli,
    input: &mut dyn BufRead,
    output: &mut dyn Write,
    diagnostics: &mut dyn Write,
    environment: ExecutionEnvironment,
) -> Result<u8, CliError> {
    let Cli {
        options,
        command,
        directories,
    } = cli;
    validate_options(&options)?;
    let progress_enabled = progress_is_enabled(&options, environment.stderr_is_terminal);
    let color_enabled = output::color_is_enabled(
        &options,
        environment.stdout_is_terminal,
        environment.no_color,
    );

    match command {
        None => {
            let paths = collect_paths(directories, options.paths_from.as_deref(), input)?;
            validate_directories(&paths)?;
            let report = commands::run_scan(&paths, &options, true, progress_enabled, diagnostics)?;
            output::write_scan_report(&report, &options, color_enabled, output)?;
            Ok(scan_exit_code(&report, options.fail_on))
        }
        Some(Command::Check { directories }) => {
            let paths = collect_paths(directories, options.paths_from.as_deref(), input)?;
            validate_directories(&paths)?;
            let report = commands::run_scan(&paths, &options, true, progress_enabled, diagnostics)?;
            output::write_scan_report(&report, &options, color_enabled, output)?;
            Ok(scan_exit_code(&report, options.fail_on))
        }
        Some(Command::Scan { directories }) => {
            let paths = collect_paths(directories, options.paths_from.as_deref(), input)?;
            validate_directories(&paths)?;
            let report = commands::run_scan(&paths, &options, false, false, diagnostics)?;
            output::write_scan_report(&report, &options, color_enabled, output)?;
            Ok(scan_exit_code(&report, options.fail_on))
        }
        Some(Command::Inspect { file }) => {
            reject_paths_from(&options)?;
            validate_file(&file)?;
            let report = commands::run_inspect(&file);
            let invalid =
                !report.inspection.is_supported_script_path || report.metadata_error.is_some();
            output::write_inspection_report(&report, &options, output)?;
            Ok(if invalid { 4 } else { 0 })
        }
        Some(Command::Validate { paths }) => {
            let paths = collect_paths(paths, options.paths_from.as_deref(), input)?;
            validate_existing_paths(&paths)?;
            let report = commands::run_validate(&paths, &options, diagnostics)?;
            output::write_validation_report(&report, &options, output)?;
            Ok(if report.valid { 0 } else { 4 })
        }
        Some(Command::Formats) => {
            reject_paths_from(&options)?;
            let report = commands::formats_report();
            output::write_formats_report(&report, &options, output)?;
            Ok(0)
        }
        Some(Command::Completions { shell }) => {
            reject_paths_from(&options)?;
            let mut command = Cli::command();
            clap_complete::generate(shell, &mut command, "scriptmeta", output);
            Ok(0)
        }
    }
}

fn collect_paths(
    inline_paths: Vec<PathBuf>,
    paths_from: Option<&Path>,
    input: &mut dyn BufRead,
) -> Result<Vec<PathBuf>, CliError> {
    let mut paths = inline_paths;
    if let Some(source) = paths_from {
        let mut content = String::new();
        if source == Path::new("-") {
            input
                .read_to_string(&mut content)
                .map_err(CliError::Output)?;
        } else {
            content = fs::read_to_string(source).map_err(|error| CliError::Read {
                path: source.to_path_buf(),
                source: error,
            })?;
        }
        paths.extend(path_list(&content));
    }
    let paths = paths
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return Err(CliError::Input(
            "at least one directory or path must be provided".to_string(),
        ));
    }
    Ok(paths)
}

fn path_list(content: &str) -> impl Iterator<Item = PathBuf> + '_ {
    content.lines().enumerate().filter_map(|(index, line)| {
        let line = if index == 0 {
            line.strip_prefix('\u{feff}').unwrap_or(line)
        } else {
            line
        };
        (!line.is_empty()).then(|| PathBuf::from(line))
    })
}

fn validate_directories(paths: &[PathBuf]) -> Result<(), CliError> {
    for path in paths {
        let metadata = fs::metadata(path).map_err(|_| {
            CliError::Input(format!("directory does not exist: {}", path.display()))
        })?;
        if !metadata.is_dir() {
            return Err(CliError::Input(format!(
                "path is not a directory: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn validate_file(path: &Path) -> Result<(), CliError> {
    let metadata = fs::metadata(path)
        .map_err(|_| CliError::Input(format!("file does not exist: {}", path.display())))?;
    if !metadata.is_file() {
        return Err(CliError::Input(format!(
            "path is not a file: {}",
            path.display()
        )));
    }
    Ok(())
}

fn validate_existing_paths(paths: &[PathBuf]) -> Result<(), CliError> {
    for path in paths {
        fs::metadata(path)
            .map_err(|_| CliError::Input(format!("path does not exist: {}", path.display())))?;
    }
    Ok(())
}

fn validate_options(options: &Options) -> Result<(), CliError> {
    scriptmetakit::LanguagePreferences::new(&options.languages)
        .map_err(|error| CliError::Input(error.to_string()))?;
    scriptmetakit::CustomMetadataSelection::new(&options.custom_keys)
        .map_err(|error| CliError::Input(error.to_string()))?;
    if options.concurrency == 0 {
        return Err(CliError::Input(
            "--concurrency must be greater than zero".to_string(),
        ));
    }
    if options.max_nodes == 0 {
        return Err(CliError::Input(
            "--max-nodes must be greater than zero".to_string(),
        ));
    }
    for (name, value) in [
        ("--request-timeout", options.request_timeout),
        ("--resource-timeout", options.resource_timeout),
        ("--scan-timeout", options.scan_timeout),
    ] {
        if value == 0 {
            return Err(CliError::Input(format!("{name} must be greater than zero")));
        }
    }
    Ok(())
}

fn reject_paths_from(options: &Options) -> Result<(), CliError> {
    if options.paths_from.is_some() {
        return Err(CliError::Input(
            "--paths-from is not supported by this command".to_string(),
        ));
    }
    Ok(())
}

const fn progress_is_enabled(options: &Options, stderr_is_terminal: bool) -> bool {
    if options.quiet {
        return false;
    }
    match options.progress {
        ProgressMode::Auto => stderr_is_terminal,
        ProgressMode::Always => true,
        ProgressMode::Never => false,
    }
}

fn scan_exit_code(report: &model::ScanReport, fail_on: FailOn) -> u8 {
    if report.interrupted || report.summary.cancelled > 0 {
        return 130;
    }
    if fail_on == FailOn::Never {
        return 0;
    }
    if report.summary.failed > 0 || !report.issues.is_empty() {
        return 4;
    }
    if matches!(fail_on, FailOn::Updates | FailOn::UpdatesOrErrors)
        && report.summary.update_available > 0
    {
        return 10;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::path_list;

    #[test]
    fn path_list_preserves_spaces_and_skips_empty_lines() {
        let paths = path_list("/one\n\n/path with spaces\n").collect::<Vec<_>>();
        assert_eq!(
            paths,
            vec![
                std::path::PathBuf::from("/one"),
                std::path::PathBuf::from("/path with spaces")
            ]
        );
    }

    #[test]
    fn path_list_removes_utf8_bom_from_the_first_path() {
        let paths = path_list("\u{feff}/one\n").collect::<Vec<_>>();
        assert_eq!(paths, vec![std::path::PathBuf::from("/one")]);
    }
}
