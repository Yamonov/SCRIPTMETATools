use std::{
    env,
    io::{self, IsTerminal, Write},
    process::ExitCode,
};

use clap::Parser;
use scriptmetakitcli::{ExecutionEnvironment, cli::Cli, execute, install_signal_handler};

fn main() -> ExitCode {
    let cli = Cli::parse();
    if let Err(error) = install_signal_handler() {
        eprintln!("scriptmeta: {error}");
        return ExitCode::from(error.exit_code());
    }

    let stdin = io::stdin();
    let stdout = io::stdout();
    let stderr = io::stderr();
    let environment = ExecutionEnvironment {
        stdout_is_terminal: stdout.is_terminal(),
        stderr_is_terminal: stderr.is_terminal(),
        no_color: env::var_os("NO_COLOR").is_some(),
    };
    let mut input = stdin.lock();
    let mut output = stdout.lock();
    let mut diagnostics = stderr.lock();
    match execute(cli, &mut input, &mut output, &mut diagnostics, environment) {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            let _ = writeln!(diagnostics, "scriptmeta: {error}");
            ExitCode::from(error.exit_code())
        }
    }
}
