use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
};

use scriptmetakit::{
    CachePolicy, CommentSyntax, RefreshPolicy, RootPriority, RootPurpose, RootRegistration,
    RootStatus, ScanMode, ScanRequest, ScriptFormatKind, ScriptMetaKitConfig, ScriptMetaKitEngine,
    ScriptRuntimeKind, UpdateStatus, WatchPolicy, all_format_specs, inspect_script_file,
    normalize_version_string, path_based_root_id, read_script_metadata_draft_from_file,
    supported_script_extensions, validate_script_id_uniqueness,
};

use crate::{
    cli::Options,
    error::CliError,
    model::{
        FormatReport, FormatsReport, InspectionReport, IssueReport, ItemReport, ItemStatus,
        ReportError, RootReport, SCHEMA_VERSION, ScanReport, Summary, ValidationReport,
    },
    signal::{ActiveCancellationGuard, was_interrupted},
};

pub fn run_scan(
    directories: &[PathBuf],
    options: &Options,
    check_updates: bool,
    progress_enabled: bool,
    stderr: &mut dyn Write,
) -> Result<ScanReport, CliError> {
    let mut engine = make_engine(options)?;
    engine.set_roots(make_roots(directories, check_updates))?;
    let cancellation = engine.cancellation_token();
    let _reservation = cancellation.reserve_next_operation();
    let _cancellation = ActiveCancellationGuard::new(cancellation);

    let (scan, update) = if check_updates && progress_enabled {
        let mut progress_error = None;
        let result = engine.scan_roots_and_check_updates_with_progress(
            ScanRequest::all(ScanMode::MetadataOnly),
            true,
            |progress| {
                if progress_error.is_none()
                    && let Err(error) = writeln!(
                        stderr,
                        "[{}/{}] {:?}: {}",
                        progress.completed_items,
                        progress.total_items,
                        progress.phase,
                        progress.message
                    )
                {
                    progress_error = Some(error);
                }
            },
        );
        if let Some(error) = progress_error {
            return Err(CliError::Output(error));
        }
        result?
    } else {
        engine
            .scan_roots_and_check_updates(ScanRequest::all(ScanMode::MetadataOnly), check_updates)?
    };

    let update = update.as_deref();
    let mut items = scan
        .catalog_snapshot
        .as_ref()
        .map_or(&[][..], |catalog| catalog.file_items.as_slice())
        .iter()
        .map(|item| item_report(item, update, check_updates))
        .collect::<Vec<_>>();
    items.sort_by(|left, right| left.path.cmp(&right.path));

    let mut summary = Summary::default();
    for item in &items {
        summary.add(item.status);
    }
    if !options.status.is_empty() {
        items.retain(|item| {
            options
                .status
                .iter()
                .any(|filter| item.status.matches_filter(*filter))
        });
    }

    let roots = scan
        .roots
        .iter()
        .map(|root| RootReport {
            root_id: root.root_id.to_string(),
            path: root.path.clone(),
            status: root_status_name(root.status).to_string(),
            item_count: root.item_count,
            error: root.error.as_ref().map(|error| ReportError {
                code: error.code.clone(),
                message: error.message.clone(),
            }),
        })
        .collect();
    let issues = scan
        .file_issues
        .iter()
        .map(|issue| IssueReport {
            path: issue.path.clone(),
            code: issue.code.clone(),
            message: issue.message.clone(),
            root_id: issue.root_id.clone(),
        })
        .collect();
    let interrupted = was_interrupted()
        || scan.operation.cancelled
        || update.is_some_and(|result| result.operation.cancelled);

    Ok(ScanReport {
        schema_version: SCHEMA_VERSION,
        command: if check_updates { "check" } else { "scan" }.to_string(),
        scriptmeta_version: env!("CARGO_PKG_VERSION").to_string(),
        scriptmetakit_version: scriptmetakit::package_version().to_string(),
        checked_at: update.map(|result| result.checked_at),
        roots,
        items,
        issues,
        summary,
        interrupted,
    })
}

pub fn run_inspect(path: &Path) -> InspectionReport {
    let inspection = inspect_script_file(path);
    let (metadata, metadata_error, diagnostics) = match read_script_metadata_draft_from_file(path) {
        Ok(result) if result.has_existing_block => (Some(result.draft), None, result.diagnostics),
        Ok(_) => (None, None, Vec::new()),
        Err(error) => (
            None,
            Some(ReportError {
                code: error.code().to_string(),
                message: error.to_string(),
            }),
            Vec::new(),
        ),
    };
    InspectionReport {
        schema_version: SCHEMA_VERSION,
        command: "inspect".to_string(),
        scriptmeta_version: env!("CARGO_PKG_VERSION").to_string(),
        scriptmetakit_version: scriptmetakit::package_version().to_string(),
        path: path.to_path_buf(),
        inspection,
        metadata,
        metadata_error,
        diagnostics,
    }
}

pub fn run_validate(
    paths: &[PathBuf],
    options: &Options,
    stderr: &mut dyn Write,
) -> Result<ValidationReport, CliError> {
    let (directories, files): (Vec<_>, Vec<_>) =
        paths.iter().cloned().partition(|path| path.is_dir());
    let mut issues = Vec::new();
    let mut uniqueness_items = BTreeMap::new();

    if !directories.is_empty() {
        let mut scan_options = options.clone();
        scan_options.status.clear();
        let scan = run_scan(&directories, &scan_options, false, false, stderr)?;
        issues.extend(scan.issues);
        for item in scan.items {
            validate_file(&item.metadata_path, &mut issues, &mut uniqueness_items);
        }
    }

    for path in files {
        validate_file(&path, &mut issues, &mut uniqueness_items);
    }

    let uniqueness_items = uniqueness_items.into_values().collect::<Vec<_>>();
    let uniqueness = validate_script_id_uniqueness(&uniqueness_items);
    let valid = issues.is_empty() && uniqueness.is_unique();
    Ok(ValidationReport {
        schema_version: SCHEMA_VERSION,
        command: "validate".to_string(),
        scriptmeta_version: env!("CARGO_PKG_VERSION").to_string(),
        scriptmetakit_version: scriptmetakit::package_version().to_string(),
        valid,
        checked_paths: paths.len(),
        valid_items: uniqueness.total_items,
        issues,
        duplicates: uniqueness.duplicates,
    })
}

pub fn formats_report() -> FormatsReport {
    FormatsReport {
        schema_version: SCHEMA_VERSION,
        command: "formats".to_string(),
        scriptmeta_version: env!("CARGO_PKG_VERSION").to_string(),
        scriptmetakit_version: scriptmetakit::package_version().to_string(),
        supported_extensions: supported_script_extensions()
            .iter()
            .map(|extension| (*extension).to_string())
            .collect(),
        formats: all_format_specs()
            .iter()
            .map(|format| FormatReport {
                kind: format_kind_name(format.kind).to_string(),
                extensions: format
                    .extensions
                    .iter()
                    .map(|extension| (*extension).to_string())
                    .collect(),
                runtime_kind: format
                    .runtime_kind
                    .map(runtime_kind_name)
                    .map(str::to_string),
                comment_syntax: comment_syntax_name(format.comment_syntax).to_string(),
                supports_scriptmeta_write: format.supports_scriptmeta_write,
                is_package: format.is_package,
            })
            .collect(),
    }
}

fn make_engine(options: &Options) -> Result<ScriptMetaKitEngine, CliError> {
    let mut config = ScriptMetaKitConfig::new("scriptmeta", "scriptmeta");
    config.parser.preferred_languages =
        scriptmetakit::LanguagePreferences::new(&options.languages)?;
    config.parser.custom_metadata_keys =
        scriptmetakit::CustomMetadataSelection::new(&options.custom_keys)?;
    config.cache.enabled = false;
    config.cache.memory_cache = false;
    config.cache.persistent_cache = false;
    config.watcher.enabled = false;
    config.scanner.max_depth = options.max_depth;
    config.scanner.max_nodes_per_root = options.max_nodes;
    config.scanner.skip_hidden = !options.include_hidden;
    config.scanner.skip_packages = !options.include_packages;
    config.scanner.follow_symlinks = !options.no_follow_symlinks;
    config.scanner.resolve_macos_alias = !options.no_resolve_aliases;
    config.scanner.decompile_compiled_osa_during_scan = options.decompile_osa;
    config.scanner.scan_timeout_per_root_millis = Some(options.scan_timeout);
    config.update_check.max_concurrent_meta_url_checks = options.concurrency;
    config.update_check.retry_attempts = options.retries;
    config.update_check.request_timeout_millis = Some(options.request_timeout);
    config.update_check.resource_timeout_millis = Some(options.resource_timeout);
    ScriptMetaKitEngine::new(config).map_err(CliError::from)
}

fn make_roots(paths: &[PathBuf], check_updates: bool) -> Vec<RootRegistration> {
    paths
        .iter()
        .map(|path| RootRegistration {
            root_id: path_based_root_id(path),
            path: path.clone(),
            display_name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned()),
            purpose: if check_updates {
                RootPurpose::UpdateCheck
            } else {
                RootPurpose::MetadataCatalog
            },
            watch_policy: WatchPolicy::Disabled,
            cache_policy: CachePolicy::Disabled,
            refresh_policy: RefreshPolicy::ManualOnly,
            priority: RootPriority::UserInitiated,
        })
        .collect()
}

fn item_report(
    item: &scriptmetakit::ScriptMetaItem,
    update: Option<&scriptmetakit::UpdateCheckResult>,
    check_updates: bool,
) -> ItemReport {
    let item_id = item.item_id();
    let status = if check_updates {
        update
            .and_then(|result| result.statuses_by_item_id.get(&item_id))
            .copied()
            .map(item_status)
            .unwrap_or(ItemStatus::NotCheckable)
    } else {
        ItemStatus::Scanned
    };
    let resolution = update.and_then(|result| result.resolutions_by_item_id.get(&item_id));
    let failure = update.and_then(|result| result.failures_by_item_id.get(&item_id));
    let legacy_error = update.and_then(|result| result.errors_by_item_id.get(&item_id));
    let error = failure
        .map(|failure| ReportError {
            code: failure.code.clone(),
            message: failure.message.clone(),
        })
        .or_else(|| {
            legacy_error.map(|message| ReportError {
                code: "update_check_failed".to_string(),
                message: message.clone(),
            })
        });
    ItemReport {
        metadata_path: item.identity_path.clone(),
        status,
        path: item.file_path.clone(),
        root_id: item.root_id.to_string(),
        script_id: item.script_id.clone(),
        name: item.name.clone(),
        author: item.author.clone(),
        description: item.description.clone(),
        presentation: item.presentation.clone(),
        current_version: item.version.clone(),
        latest_version: resolution.and_then(|resolution| resolution.latest_version.clone()),
        meta_url: item.meta_url.as_ref().map(ToString::to_string),
        latest_page_url: resolution
            .and_then(|resolution| resolution.latest_page_url.as_ref())
            .map(ToString::to_string),
        error,
    }
}

fn validate_file(
    path: &Path,
    issues: &mut Vec<IssueReport>,
    uniqueness_items: &mut BTreeMap<String, scriptmetakit::ScriptIdUniquenessItem>,
) {
    let inspection = inspect_script_file(path);
    if !inspection.is_supported_script_path {
        issues.push(issue(
            path,
            "unsupported_script_path",
            "file format is not supported",
        ));
        return;
    }
    let result = match read_script_metadata_draft_from_file(path) {
        Ok(result) => result,
        Err(error) => {
            issues.push(issue(path, error.code(), &error.to_string()));
            return;
        }
    };
    if !result.has_existing_block {
        issues.push(issue(
            path,
            "missing_scriptmeta",
            "SCRIPTMETA block was not found",
        ));
        return;
    }
    if result.draft.script_id.trim().is_empty() {
        issues.push(issue(path, "missing_script_id", "Script-ID is required"));
        return;
    }
    if result
        .draft
        .version
        .as_deref()
        .is_some_and(|version| normalize_version_string(version).is_none())
    {
        issues.push(issue(path, "invalid_version", "Version is invalid"));
    }
    let has_raw_meta_url = result.existing_lines.iter().any(|line| {
        line.trim_start()
            .to_ascii_lowercase()
            .starts_with("meta-url")
    });
    if has_raw_meta_url && result.draft.meta_url.is_none() {
        issues.push(issue(path, "invalid_meta_url", "Meta-URL is invalid"));
    }
    for diagnostic in &result.diagnostics {
        if diagnostic.code.starts_with("custom_metadata_")
            || diagnostic.code.starts_with("invalid_")
            || matches!(
                diagnostic.code.as_str(),
                "missing_default_language" | "missing_name"
            )
        {
            issues.push(issue(
                path,
                &diagnostic.code,
                &format!("{} (metadata line {:?})", diagnostic.field, diagnostic.line),
            ));
        }
    }
    if let Err(error) =
        scriptmetakit::render_script_metadata_for_style(&result.draft, result.comment_style)
    {
        issues.push(issue(path, error.code(), &error.to_string()));
    }
    let item_id = path.to_string_lossy().into_owned();
    uniqueness_items.insert(
        item_id.clone(),
        scriptmetakit::ScriptIdUniquenessItem {
            item_id,
            file_path: path.to_path_buf(),
            script_id: result.draft.script_id,
        },
    );
}

fn issue(path: &Path, code: &str, message: &str) -> IssueReport {
    IssueReport {
        path: path.to_path_buf(),
        code: code.to_string(),
        message: message.to_string(),
        root_id: None,
    }
}

const fn item_status(status: UpdateStatus) -> ItemStatus {
    match status {
        UpdateStatus::UpToDate => ItemStatus::UpToDate,
        UpdateStatus::UpdateAvailable => ItemStatus::UpdateAvailable,
        UpdateStatus::Failed => ItemStatus::Failed,
        UpdateStatus::Cancelled => ItemStatus::Cancelled,
        UpdateStatus::Idle | UpdateStatus::Checking | UpdateStatus::NotCheckable => {
            ItemStatus::NotCheckable
        }
    }
}

const fn root_status_name(status: RootStatus) -> &'static str {
    match status {
        RootStatus::NotLoaded => "not_loaded",
        RootStatus::Ready => "ready",
        RootStatus::Dirty => "dirty",
        RootStatus::Loading => "loading",
        RootStatus::Missing => "missing",
        RootStatus::Unreadable => "unreadable",
        RootStatus::TimedOut => "timed_out",
        RootStatus::Overflowed => "overflowed",
        RootStatus::Cancelled => "cancelled",
    }
}

const fn format_kind_name(kind: ScriptFormatKind) -> &'static str {
    match kind {
        ScriptFormatKind::AdobeJavaScript => "adobe_java_script",
        ScriptFormatKind::AdobeJsxbin => "adobe_jsxbin",
        ScriptFormatKind::AdobeUxp => "adobe_uxp",
        ScriptFormatKind::AppleScriptText => "apple_script_text",
        ScriptFormatKind::AppleScriptCompiled => "apple_script_compiled",
        ScriptFormatKind::AppleScriptPackage => "apple_script_package",
        ScriptFormatKind::JavaScriptForAutomation => "java_script_for_automation",
    }
}

const fn runtime_kind_name(kind: ScriptRuntimeKind) -> &'static str {
    match kind {
        ScriptRuntimeKind::AppleScript => "apple_script",
        ScriptRuntimeKind::JavaScriptForAutomation => "java_script_for_automation",
        ScriptRuntimeKind::AdobeJavaScript => "adobe_java_script",
        ScriptRuntimeKind::AdobeUxp => "adobe_uxp",
    }
}

const fn comment_syntax_name(syntax: CommentSyntax) -> &'static str {
    match syntax {
        CommentSyntax::JavaScriptBlock => "java_script_block",
        CommentSyntax::AppleScriptBlock => "apple_script_block",
        CommentSyntax::PlainText => "plain_text",
        CommentSyntax::None => "none",
    }
}
