use std::path::PathBuf;

use serde::Serialize;

use crate::cli::StatusFilter;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    Scanned,
    UpToDate,
    UpdateAvailable,
    NotCheckable,
    Failed,
    Cancelled,
}

impl ItemStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Scanned => "scanned",
            Self::UpToDate => "up_to_date",
            Self::UpdateAvailable => "update_available",
            Self::NotCheckable => "not_checkable",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    #[must_use]
    pub const fn matches_filter(self, filter: StatusFilter) -> bool {
        matches!(
            (self, filter),
            (Self::Scanned, StatusFilter::Scanned)
                | (Self::UpToDate, StatusFilter::UpToDate)
                | (Self::UpdateAvailable, StatusFilter::UpdateAvailable)
                | (Self::NotCheckable, StatusFilter::NotCheckable)
                | (Self::Failed, StatusFilter::Failed)
                | (Self::Cancelled, StatusFilter::Cancelled)
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ReportError {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RootReport {
    pub root_id: String,
    pub path: PathBuf,
    pub status: String,
    pub item_count: usize,
    pub error: Option<ReportError>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ItemReport {
    #[serde(skip)]
    pub metadata_path: PathBuf,
    pub status: ItemStatus,
    pub path: PathBuf,
    pub root_id: String,
    pub script_id: String,
    pub name: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub presentation: scriptmetakit::MetadataPresentation,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub meta_url: Option<String>,
    pub latest_page_url: Option<String>,
    pub error: Option<ReportError>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct Summary {
    pub total: usize,
    pub scanned: usize,
    pub update_available: usize,
    pub up_to_date: usize,
    pub not_checkable: usize,
    pub failed: usize,
    pub cancelled: usize,
}

impl Summary {
    pub fn add(&mut self, status: ItemStatus) {
        self.total += 1;
        match status {
            ItemStatus::Scanned => self.scanned += 1,
            ItemStatus::UpdateAvailable => self.update_available += 1,
            ItemStatus::UpToDate => self.up_to_date += 1,
            ItemStatus::NotCheckable => self.not_checkable += 1,
            ItemStatus::Failed => self.failed += 1,
            ItemStatus::Cancelled => self.cancelled += 1,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct IssueReport {
    pub path: PathBuf,
    pub code: String,
    pub message: String,
    pub root_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ScanReport {
    pub schema_version: u32,
    pub command: String,
    pub scriptmeta_version: String,
    pub scriptmetakit_version: String,
    pub checked_at: Option<u64>,
    pub roots: Vec<RootReport>,
    pub items: Vec<ItemReport>,
    pub issues: Vec<IssueReport>,
    pub summary: Summary,
    pub interrupted: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ValidationReport {
    pub schema_version: u32,
    pub command: String,
    pub scriptmeta_version: String,
    pub scriptmetakit_version: String,
    pub valid: bool,
    pub checked_paths: usize,
    pub valid_items: usize,
    pub issues: Vec<IssueReport>,
    pub duplicates: Vec<scriptmetakit::ScriptIdDuplicate>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct InspectionReport {
    pub schema_version: u32,
    pub command: String,
    pub scriptmeta_version: String,
    pub scriptmetakit_version: String,
    pub path: PathBuf,
    pub inspection: scriptmetakit::ScriptFileInspection,
    pub metadata: Option<scriptmetakit::ScriptMetadataDraft>,
    pub metadata_error: Option<ReportError>,
    pub diagnostics: Vec<scriptmetakit::MetadataDiagnostic>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FormatsReport {
    pub schema_version: u32,
    pub command: String,
    pub scriptmeta_version: String,
    pub scriptmetakit_version: String,
    pub supported_extensions: Vec<String>,
    pub formats: Vec<FormatReport>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct FormatReport {
    pub kind: String,
    pub extensions: Vec<String>,
    pub runtime_kind: Option<String>,
    pub comment_syntax: String,
    pub supports_scriptmeta_write: bool,
    pub is_package: bool,
}
