use std::{io, path::PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("{0}")]
    Input(String),

    #[error("failed to read {path}: {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: io::Error,
    },

    #[error("output failed: {0}")]
    Output(#[from] io::Error),

    #[error("SCRIPTMETAKit operation failed: {0}")]
    Kit(#[from] scriptmetakit::ScriptMetaKitError),

    #[error("JSON serialization failed: {0}")]
    Json(#[from] serde_json::Error),

    #[error("failed to install the Ctrl+C handler: {0}")]
    Signal(String),
}

impl CliError {
    #[must_use]
    pub const fn exit_code(&self) -> u8 {
        match self {
            Self::Input(_) | Self::Read { .. } => 2,
            Self::Output(_) | Self::Kit(_) | Self::Json(_) | Self::Signal(_) => 3,
        }
    }
}
