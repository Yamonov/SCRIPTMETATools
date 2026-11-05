use std::path::PathBuf;

use clap::{ArgAction, Parser, Subcommand, ValueEnum};
use clap_complete::Shell;

#[derive(Clone, Debug, Parser)]
#[command(
    name = "scriptmeta",
    version,
    about = "Scan SCRIPTMETA scripts and check for updates",
    args_conflicts_with_subcommands = true,
    subcommand_precedence_over_arg = true
)]
pub struct Cli {
    #[command(flatten)]
    pub options: Options,

    #[command(subcommand)]
    pub command: Option<Command>,

    #[arg(value_name = "DIRECTORY")]
    pub directories: Vec<PathBuf>,
}

#[derive(Clone, Debug, Subcommand)]
pub enum Command {
    /// Scan directories and check every discovered script for updates.
    Check {
        #[arg(value_name = "DIRECTORY")]
        directories: Vec<PathBuf>,
    },
    /// Scan directories without accessing update metadata sources.
    Scan {
        #[arg(value_name = "DIRECTORY")]
        directories: Vec<PathBuf>,
    },
    /// Inspect one script file and its SCRIPTMETA block.
    Inspect {
        #[arg(value_name = "FILE")]
        file: PathBuf,
    },
    /// Validate files or directories and detect duplicate Script-ID values.
    Validate {
        #[arg(value_name = "PATH")]
        paths: Vec<PathBuf>,
    },
    /// List the script formats and extensions supported by SCRIPTMETAKit.
    Formats,
    /// Generate shell completion output on stdout.
    Completions {
        #[arg(value_enum)]
        shell: Shell,
    },
}

#[derive(Clone, Debug, clap::Args)]
pub struct Options {
    /// Preferred metadata display language for scan/check. Repeat in priority order.
    #[arg(long = "language", value_name = "BCP47", global = true)]
    pub languages: Vec<String>,

    /// Custom metadata key to include in scan/check. Repeat, or use X- for all keys.
    #[arg(long = "custom-key", value_name = "KEY", global = true)]
    pub custom_keys: Vec<String>,

    /// Output format. Machine-readable formats never contain progress text.
    #[arg(long, value_enum, default_value_t = OutputFormat::Human, global = true)]
    pub format: OutputFormat,

    /// Read additional paths from a UTF-8 file, one path per line. Use - for stdin.
    #[arg(long, value_name = "FILE", global = true)]
    pub paths_from: Option<PathBuf>,

    /// Control progress messages written to stderr.
    #[arg(long, value_enum, default_value_t = ProgressMode::Auto, global = true)]
    pub progress: ProgressMode,

    /// Control ANSI color in human-readable output.
    #[arg(long, value_enum, default_value_t = ColorMode::Auto, global = true)]
    pub color: ColorMode,

    /// Select which findings make the command return a non-zero exit code.
    #[arg(long, value_enum, default_value_t = FailOn::Errors, global = true)]
    pub fail_on: FailOn,

    /// Show only matching item statuses. May be supplied more than once.
    #[arg(long, value_enum, global = true)]
    pub status: Vec<StatusFilter>,

    /// Maximum simultaneous metadata-source checks.
    #[arg(long, default_value_t = 6, global = true)]
    pub concurrency: usize,

    /// Number of retry attempts after the initial metadata-source request.
    #[arg(long, default_value_t = 2, global = true)]
    pub retries: usize,

    /// Timeout for each metadata-source request, such as 15s or 2m.
    #[arg(
        long,
        default_value = "15s",
        value_parser = parse_duration_millis,
        global = true
    )]
    pub request_timeout: u64,

    /// Total resource timeout for each metadata source.
    #[arg(
        long,
        default_value = "15s",
        value_parser = parse_duration_millis,
        global = true
    )]
    pub resource_timeout: u64,

    /// Scan timeout for each root directory.
    #[arg(
        long,
        default_value = "30s",
        value_parser = parse_duration_millis,
        global = true
    )]
    pub scan_timeout: u64,

    /// Maximum directory depth below each root.
    #[arg(long, default_value_t = 24, global = true)]
    pub max_depth: usize,

    /// Maximum filesystem nodes scanned in each root.
    #[arg(long, default_value_t = 10_000, global = true)]
    pub max_nodes: usize,

    /// Include hidden files and directories.
    #[arg(long, global = true)]
    pub include_hidden: bool,

    /// Descend into script packages and other package directories.
    #[arg(long, global = true)]
    pub include_packages: bool,

    /// Do not follow symbolic links.
    #[arg(long, global = true)]
    pub no_follow_symlinks: bool,

    /// Do not resolve macOS alias files.
    #[arg(long, global = true)]
    pub no_resolve_aliases: bool,

    /// Decompile compiled OSA scripts while scanning on macOS.
    #[arg(long, global = true)]
    pub decompile_osa: bool,

    /// Suppress progress, table headings, and summary text in human output.
    #[arg(long, conflicts_with = "verbose", global = true)]
    pub quiet: bool,

    /// Include root and diagnostic details. Repeat for additional detail.
    #[arg(short, long, action = ArgAction::Count, global = true)]
    pub verbose: u8,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
pub enum OutputFormat {
    #[default]
    Human,
    Json,
    Jsonl,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
pub enum ProgressMode {
    #[default]
    Auto,
    Always,
    Never,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
pub enum ColorMode {
    #[default]
    Auto,
    Always,
    Never,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
pub enum FailOn {
    Never,
    #[default]
    Errors,
    Updates,
    UpdatesOrErrors,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum StatusFilter {
    Scanned,
    UpToDate,
    UpdateAvailable,
    NotCheckable,
    Failed,
    Cancelled,
}

fn parse_duration_millis(value: &str) -> Result<u64, String> {
    let duration = humantime::parse_duration(value).map_err(|error| error.to_string())?;
    u64::try_from(duration.as_millis()).map_err(|_| "duration is too large".to_string())
}
