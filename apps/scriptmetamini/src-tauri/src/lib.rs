mod custom_text;

use scriptmetakit::{
    DistributionResolverOptions, FileSystemEntry, MetadataLocalizationEditor,
    MetadataLocalizationOperation, PathResolutionStatus, RootPreflightOptions, ScanMode,
    ScannerOptions, ScriptMetaBackupOptions, ScriptMetaCommentStyle, ScriptMetaItem,
    ScriptMetaKitConfig, ScriptMetaKitEngine, ScriptMetaWriteMode, ScriptMetaWriteOperation,
    ScriptMetadata, ScriptMetadataDraft, UpdateResolver, UpdateStatus,
    generate_edit_password_sha256, is_valid_edit_password_sha256, normalize_metadata_url,
    read_script_metadata_draft_from_file, resolve_registered_path, verify_edit_password_sha256,
    write_script_metadata_to_file_if_unchanged,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisteredScript {
    record_key: String,
    script_id: String,
    file_name: String,
    file_path: String,
    version: Option<String>,
    target_app: Option<String>,
    description_text: Option<String>,
    meta_url: Option<String>,
    resolved_version: Option<String>,
    latest_page_url: Option<String>,
    resolved_meta_page_url: Option<String>,
    distribution_note: Option<String>,
    is_unresolved: Option<bool>,
    redirect_count: Option<usize>,
    has_scriptmeta: bool,
    can_edit_scriptmeta: bool,
    can_append_scriptmeta: bool,
    scriptmeta_edit_state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportSummary {
    folders: Vec<String>,
    records: Vec<RegisteredScript>,
    scanned_files: usize,
    registered_count: usize,
    skipped_count: usize,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedRecords {
    folders: Vec<String>,
    records: Vec<RegisteredScript>,
    warnings: Vec<String>,
    scanned_files: usize,
    skipped_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedFolderState {
    folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DistributionResolution {
    script_id: String,
    resolved_version: Option<String>,
    latest_page_url: Option<String>,
    resolved_meta_page_url: String,
    distribution_note: Option<String>,
    is_unresolved: bool,
    redirect_count: Option<usize>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditableScriptMetadataDraft {
    script_id: String,
    version: Option<String>,
    description: Option<String>,
    target_app: Option<String>,
    min_target_version: Option<String>,
    meta_url: Option<String>,
    name: Option<String>,
    author: Option<String>,
    release_date: Option<String>,
    edit_password_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdvancedMetadata {
    localization: MetadataLocalizationEditor,
    tags: Vec<String>,
    custom_fields: BTreeMap<String, Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    custom_text: Option<String>,
}

#[tauri::command]
fn edit_metadata_language(
    mut editor: MetadataLocalizationEditor,
    operation: MetadataLocalizationOperation,
) -> Result<MetadataLocalizationEditor, String> {
    editor.edit(operation).map_err(|error| error.to_string())?;
    Ok(editor)
}

fn apply_advanced_metadata(
    mut draft: ScriptMetadataDraft,
    advanced: &AdvancedMetadata,
    original: &BTreeMap<String, Vec<String>>,
    style: ScriptMetaCommentStyle,
) -> Result<ScriptMetadataDraft, String> {
    draft.extensions.get_or_insert_with(Default::default).tags =
        scriptmetakit::normalize_metadata_tags(&advanced.tags).map_err(|e| e.to_string())?;
    draft = advanced
        .localization
        .applying_to(&draft)
        .map_err(|e| e.to_string())?;
    draft.custom_fields.clear();
    if let Some(text) = &advanced.custom_text {
        let validation = custom_text::parse_custom_metadata_text(text, original, style);
        if let Some(issue) = validation.issues.first() {
            return Err(format!("{}行目: {}", issue.line, issue.message));
        }
        draft.custom_fields = validation.fields;
        return Ok(draft);
    }
    for (key, values) in &advanced.custom_fields {
        let normalized =
            scriptmetakit::normalize_custom_metadata_key(key).map_err(|e| e.to_string())?;
        draft
            .custom_fields
            .entry(normalized)
            .or_default()
            .extend(values.clone());
    }
    Ok(draft)
}

// Omitted keys preserve the original source, including unchanged legacy-invalid values.
fn custom_metadata_changes(
    draft: &mut ScriptMetadataDraft,
    original: &BTreeMap<String, Vec<String>>,
) {
    for (key, values) in original {
        if draft.custom_fields.get(key) == Some(values) {
            draft.custom_fields.remove(key);
        } else {
            draft.custom_fields.entry(key.clone()).or_default();
        }
    }
}

#[tauri::command]
fn preview_metadata(
    draft: EditableScriptMetadataDraft,
    advanced: AdvancedMetadata,
    style: String,
    original_block: Option<String>,
    original_custom_fields: BTreeMap<String, Vec<String>>,
) -> Result<String, String> {
    let mut draft = apply_advanced_metadata(
        kit_draft_from_editable(draft)?,
        &advanced,
        &original_custom_fields,
        custom_text::comment_style(&style)?,
    )?;
    custom_metadata_changes(&mut draft, &original_custom_fields);
    let (path, open, close) = match style.as_str() {
        "apple_script_block" => ("Preview.applescript", "(*", "*)"),
        "plain_text" => ("Preview.txt", "", ""),
        _ => ("Preview.jsx", "/*", "*/"),
    };
    if let Some(original) = original_block {
        let source = format!("{open}\nSCRIPTMETA-BEGIN\n{original}\nSCRIPTMETA-END\n{close}");
        return scriptmetakit::write_script_metadata_to_text(
            &source,
            Path::new(path),
            &draft,
            ScriptMetaWriteMode::InsertOrReplace,
        )
        .map(|result| result.text)
        .map_err(|e| e.to_string());
    }
    let style = match style.as_str() {
        "apple_script_block" => ScriptMetaCommentStyle::AppleScriptBlock,
        "plain_text" => ScriptMetaCommentStyle::PlainText,
        _ => ScriptMetaCommentStyle::JavaScriptBlock,
    };
    scriptmetakit::render_script_metadata_for_style(&draft, style).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScriptMetadataEditDocument {
    advanced: AdvancedMetadata,
    file_path: String,
    draft: EditableScriptMetadataDraft,
    comment_style: String,
    line_ending: String,
    has_existing_block: bool,
    unknown_lines: Vec<String>,
    existing_block_text: Option<String>,
    source_fingerprint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptMetadataSaveRequest {
    advanced: Option<AdvancedMetadata>,
    file_path: String,
    draft: EditableScriptMetadataDraft,
    mode: Option<String>,
    checked_fields: Option<Vec<String>>,
    source_fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScriptMetadataSaveResult {
    file_path: String,
    operation: String,
    backup_file_path: Option<String>,
    document: ScriptMetadataEditDocument,
}

#[derive(Debug)]
struct ScanResult {
    records: Vec<RegisteredScript>,
    scanned_files: usize,
    registered_count: usize,
    skipped_count: usize,
}

#[tauri::command]
fn register_dropped_paths(
    paths: Vec<String>,
    existing_folders: Vec<String>,
) -> Result<ImportSummary, String> {
    let mut warnings = Vec::new();
    let mut folders = sanitize_folder_paths(existing_folders, &mut warnings)?;

    for raw_path in paths {
        let path = PathBuf::from(&raw_path);
        if !path.exists() {
            warnings.push(format!("見つからないパスを無視しました: {}", raw_path));
            continue;
        }

        let normalized = match normalize_folder_path(&path) {
            Ok(normalized) => normalized,
            Err(error) => {
                warnings.push(error);
                continue;
            }
        };
        if !folders.contains(&normalized) {
            folders.push(normalized);
        }
    }

    let scan_result = scan_registered_folders(&folders, &mut warnings)?;

    Ok(ImportSummary {
        folders,
        records: scan_result.records,
        scanned_files: scan_result.scanned_files,
        registered_count: scan_result.registered_count,
        skipped_count: scan_result.skipped_count,
        warnings,
    })
}

#[tauri::command]
fn load_saved_records(app: tauri::AppHandle) -> Result<PersistedRecords, String> {
    let file_path = storage_file_path(&app)?;
    if !file_path.exists() {
        return Ok(PersistedRecords {
            folders: Vec::new(),
            records: Vec::new(),
            warnings: Vec::new(),
            scanned_files: 0,
            skipped_count: 0,
        });
    }

    let raw = fs::read_to_string(&file_path).map_err(|error| error.to_string())?;
    let mut warnings = Vec::new();
    let mut should_resave = false;

    let stored = match serde_json::from_str::<PersistedFolderState>(&raw) {
        Ok(stored) => stored,
        Err(_) => match serde_json::from_str::<Vec<RegisteredScript>>(&raw) {
            Ok(old_records) => {
                let mut folders = Vec::new();
                let mut seen = HashSet::new();
                for record in old_records {
                    let Some(parent) = Path::new(&record.file_path).parent() else {
                        continue;
                    };
                    if let Ok(folder) = normalize_folder_path(parent)
                        && seen.insert(folder.clone())
                    {
                        folders.push(folder);
                    }
                }
                should_resave = true;
                warnings.push("保存形式をフォルダ登録へ移行しました。".to_string());
                PersistedFolderState { folders }
            }
            Err(error) => {
                return Ok(PersistedRecords {
                    folders: Vec::new(),
                    records: Vec::new(),
                    warnings: vec![format!("保存データを読めませんでした: {}", error)],
                    scanned_files: 0,
                    skipped_count: 0,
                });
            }
        },
    };

    let stored_folders = stored.folders;
    let folders = sanitize_folder_paths(stored_folders.clone(), &mut warnings)?;
    let scan_result = scan_registered_folders(&folders, &mut warnings)?;

    if should_resave
        || folders != stored_folders
        || warnings
            .iter()
            .any(|warning| warning.contains("削除しました"))
    {
        save_folders_to_disk(&file_path, &folders)?;
    }

    Ok(PersistedRecords {
        folders,
        records: scan_result.records,
        warnings,
        scanned_files: scan_result.scanned_files,
        skipped_count: scan_result.skipped_count,
    })
}

#[tauri::command]
fn save_registered_folders(app: tauri::AppHandle, folders: Vec<String>) -> Result<(), String> {
    let file_path = storage_file_path(&app)?;
    let mut warnings = Vec::new();
    let sanitized = sanitize_folder_paths(folders, &mut warnings)?;
    save_folders_to_disk(&file_path, &sanitized)
}

#[tauri::command]
async fn resolve_registered_scripts(
    records: Vec<RegisteredScript>,
) -> Result<Vec<DistributionResolution>, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_records_with_kit(records))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn load_script_metadata_document(file_path: String) -> Result<ScriptMetadataEditDocument, String> {
    let path = PathBuf::from(file_path);
    let result = read_script_metadata_draft_from_file(&path).map_err(|error| error.to_string())?;
    edit_document_from_result(result)
}

#[tauri::command]
fn verify_edit_password(password: String, stored_value: String) -> Result<bool, String> {
    let stored_value = stored_value.trim();
    if !is_valid_edit_password_sha256(stored_value) {
        return Err("Edit-Password-SHA256 の形式が不正です。".to_string());
    }
    Ok(verify_edit_password_sha256(&password, stored_value))
}

#[tauri::command]
fn generate_edit_password(password: String) -> Result<String, String> {
    generate_edit_password_sha256(&password).map_err(|error| error.to_string())
}

#[tauri::command]
fn pick_folder() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("登録フォルダを選択")
        .pick_folder()
        .map(|path| path.display().to_string()))
}

#[tauri::command]
fn save_script_metadata_document(
    app: tauri::AppHandle,
    request: ScriptMetadataSaveRequest,
) -> Result<ScriptMetadataSaveResult, String> {
    let path = PathBuf::from(&request.file_path);
    let current = read_script_metadata_draft_from_file(&path).map_err(|error| error.to_string())?;

    if !request.source_fingerprint.trim().is_empty()
        && current.source_fingerprint != request.source_fingerprint
    {
        return Err(
            "ファイルが外部で変更されています。再読み込みしてから保存してください。".to_string(),
        );
    }

    let draft = effective_kit_draft_for_save(&current, &request)?;
    let backup_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("ScriptMetaBackups");
    let backup_options = ScriptMetaBackupOptions {
        root_directory: backup_root,
    };
    let write_result = write_script_metadata_to_file_if_unchanged(
        &path,
        &draft,
        ScriptMetaWriteMode::InsertOrReplace,
        Some(&backup_options),
        Some(&request.source_fingerprint),
    )
    .map_err(|error| error.to_string())?;

    let updated = read_script_metadata_draft_from_file(&path).map_err(|error| error.to_string())?;

    Ok(ScriptMetadataSaveResult {
        file_path: write_result.file_path.display().to_string(),
        operation: write_operation_label(write_result.operation).to_string(),
        backup_file_path: write_result
            .backup
            .map(|backup| backup.backup_file_path.display().to_string()),
        document: edit_document_from_result(updated)?,
    })
}

fn storage_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(directory.join("scripts.json"))
}

fn save_folders_to_disk(path: &Path, folders: &[String]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = PersistedFolderState {
        folders: folders.to_vec(),
    };
    let json = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| error.to_string())
}

fn sanitize_folder_paths(
    folders: Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<Vec<String>, String> {
    let mut sanitized = Vec::new();
    let mut seen = HashSet::new();

    for raw_folder in folders {
        let path = PathBuf::from(&raw_folder);
        if !path.exists() {
            warnings.push(format!(
                "存在しないため登録フォルダから削除しました: {}",
                raw_folder
            ));
            continue;
        }

        let normalized = match normalize_folder_path(&path) {
            Ok(normalized) => normalized,
            Err(error) => {
                warnings.push(format!(
                    "登録フォルダから削除しました: {} ({})",
                    raw_folder, error
                ));
                continue;
            }
        };
        if seen.insert(normalized.clone()) {
            sanitized.push(normalized);
        }
    }

    sanitized.sort();
    Ok(sanitized)
}

fn normalize_folder_path(path: &Path) -> Result<String, String> {
    let scanner_options = ScannerOptions::default();
    let resolution = resolve_registered_path(path, &scanner_options, None);
    if matches!(
        resolution.resolution_status,
        PathResolutionStatus::Broken
            | PathResolutionStatus::Unsupported
            | PathResolutionStatus::PermissionDenied
            | PathResolutionStatus::Cycle
    ) {
        return Err(format!(
            "エイリアスを解決できませんでした: {}{}",
            path.display(),
            resolution
                .resolution_message
                .as_deref()
                .map(|message| format!(" ({message})"))
                .unwrap_or_default()
        ));
    }

    let canonical = fs::canonicalize(&resolution.resolved_path).map_err(|error| {
        format!(
            "フォルダを確認できませんでした: {} ({})",
            path.display(),
            error
        )
    })?;
    if !canonical.is_dir() {
        return Err(format!("フォルダのみ登録できます: {}", path.display()));
    }
    Ok(canonical.display().to_string())
}

fn edit_document_from_result(
    result: scriptmetakit::ScriptMetadataEditReadResult,
) -> Result<ScriptMetadataEditDocument, String> {
    Ok(ScriptMetadataEditDocument {
        file_path: result.file_path.display().to_string(),
        advanced: AdvancedMetadata {
            custom_text: None,
            localization: MetadataLocalizationEditor::from_draft(&result.draft)
                .map_err(|e| e.to_string())?,
            tags: result
                .draft
                .extensions
                .as_ref()
                .map(|v| v.tags.clone())
                .unwrap_or_default(),
            custom_fields: result.draft.custom_fields.clone(),
        },
        draft: editable_draft_from_kit(result.draft),
        comment_style: comment_style_label(result.comment_style).to_string(),
        line_ending: result.line_ending,
        has_existing_block: result.has_existing_block,
        unknown_lines: result.unknown_lines,
        existing_block_text: result.existing_block_text,
        source_fingerprint: result.source_fingerprint,
    })
}

fn editable_draft_from_kit(draft: ScriptMetadataDraft) -> EditableScriptMetadataDraft {
    EditableScriptMetadataDraft {
        script_id: draft.script_id,
        version: draft.version,
        description: draft.description,
        target_app: draft.target_app,
        min_target_version: draft.min_target_version,
        meta_url: draft.meta_url.map(|url| url.to_string()),
        name: draft.name,
        author: draft.author,
        release_date: draft.release_date,
        edit_password_sha256: draft.edit_password_sha256,
    }
}

fn kit_draft_from_editable(
    draft: EditableScriptMetadataDraft,
) -> Result<ScriptMetadataDraft, String> {
    let meta_url = match optional_text(draft.meta_url) {
        Some(value) => Some(
            normalize_metadata_url(&value)
                .ok_or_else(|| "Meta-URL の形式が不正です。".to_string())?,
        ),
        None => None,
    };

    Ok(ScriptMetadataDraft {
        script_id: draft.script_id.trim().to_string(),
        version: optional_text(draft.version),
        description: optional_text(draft.description),
        target_app: optional_text(draft.target_app),
        min_target_version: optional_text(draft.min_target_version),
        meta_url,
        name: optional_text(draft.name),
        author: optional_text(draft.author),
        release_date: optional_text(draft.release_date),
        edit_password_sha256: optional_text(draft.edit_password_sha256),
        ..ScriptMetadataDraft::default()
    })
}

fn effective_kit_draft_for_save(
    current: &scriptmetakit::ScriptMetadataEditReadResult,
    request: &ScriptMetadataSaveRequest,
) -> Result<ScriptMetadataDraft, String> {
    let mut draft = ScriptMetadataDraft::default();
    let requested = kit_draft_from_editable(request.draft.clone())?;
    let mode = request.mode.as_deref().unwrap_or("localSubset");
    let checked_fields: HashSet<&str> = request
        .checked_fields
        .as_ref()
        .map(|fields| fields.iter().map(String::as_str).collect())
        .unwrap_or_default();

    for field in visible_field_names_for_mode(mode) {
        if !checked_fields.contains(field) {
            continue;
        }

        match *field {
            "scriptId" => draft.script_id = requested.script_id.clone(),
            "version" => draft.version = requested.version.clone(),
            "description" => draft.description = requested.description.clone(),
            "targetApp" => draft.target_app = requested.target_app.clone(),
            "minTargetVersion" => draft.min_target_version = requested.min_target_version.clone(),
            "metaUrl" => draft.meta_url = requested.meta_url.clone(),
            "name" => draft.name = requested.name.clone(),
            "author" => draft.author = requested.author.clone(),
            "releaseDate" => draft.release_date = requested.release_date.clone(),
            _ => {}
        }
    }

    if mode == "localSubset" {
        draft.min_target_version = None;
        draft.meta_url = None;
    }
    draft.edit_password_sha256 = requested.edit_password_sha256.clone();

    if draft.script_id.trim().is_empty() {
        return Err("保存には Script-ID が必要です。".to_string());
    }
    if !is_valid_script_id(&draft.script_id) {
        return Err(
            "Script-ID は英数字、ドット、アンダースコア、ハイフンだけで入力してください。"
                .to_string(),
        );
    }
    if mode == "updateProfile" {
        if draft.version.as_deref().and_then(non_empty_str).is_none() {
            return Err("Update Profile では Version が必要です。".to_string());
        }
        if draft.meta_url.is_none() {
            return Err("Update Profile では Meta-URL が必要です。".to_string());
        }
    }
    if let Some(meta_url) = draft.meta_url.as_ref() {
        validate_meta_url_is_information_page(meta_url)?;
    }
    if let Some(advanced) = &request.advanced {
        draft = apply_advanced_metadata(
            draft,
            advanced,
            &current.draft.custom_fields,
            current.comment_style,
        )?;
        custom_metadata_changes(&mut draft, &current.draft.custom_fields);
    }
    Ok(draft)
}

fn visible_field_names_for_mode(mode: &str) -> &'static [&'static str] {
    match mode {
        "updateProfile" => &[
            "scriptId",
            "name",
            "author",
            "version",
            "releaseDate",
            "targetApp",
            "minTargetVersion",
            "metaUrl",
            "description",
        ],
        _ => &[
            "scriptId",
            "name",
            "author",
            "version",
            "releaseDate",
            "targetApp",
            "description",
        ],
    }
}

fn is_valid_script_id(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

fn validate_meta_url_is_information_page(url: &url::Url) -> Result<(), String> {
    const DISALLOWED_SUFFIXES: &[&str] = &[
        ".zip",
        ".js",
        ".jsx",
        ".jsxinc",
        ".applescript",
        ".idjs",
        ".jxa",
        ".psjs",
    ];

    let path = url.path().trim_matches('/').to_lowercase();
    if DISALLOWED_SUFFIXES
        .iter()
        .any(|suffix| path.ends_with(suffix))
    {
        return Err(
            "Meta-URL にはスクリプトや zip への直リンクではなく、SCRIPTMETA 情報ページを指定してください。"
                .to_string(),
        );
    }
    Ok(())
}

fn non_empty_str(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

fn optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn comment_style_label(style: ScriptMetaCommentStyle) -> &'static str {
    match style {
        ScriptMetaCommentStyle::JavaScriptBlock => "java_script_block",
        ScriptMetaCommentStyle::AppleScriptBlock => "apple_script_block",
        ScriptMetaCommentStyle::PlainText => "plain_text",
    }
}

fn write_operation_label(operation: ScriptMetaWriteOperation) -> &'static str {
    match operation {
        ScriptMetaWriteOperation::Inserted => "inserted",
        ScriptMetaWriteOperation::Replaced => "replaced",
    }
}

fn scriptmetakitmini_config() -> ScriptMetaKitConfig {
    let mut config = ScriptMetaKitConfig::new("com.yamo.scriptmetakitapp", "scriptmetakitmini");
    config.watcher.enabled = false;
    config.cache.persistent_cache = false;
    config.scanner.root_preflight = RootPreflightOptions {
        reject_low_script_density_large_roots: false,
        ..RootPreflightOptions::default()
    };
    config
}

fn scan_registered_folders(
    folders: &[String],
    warnings: &mut Vec<String>,
) -> Result<ScanResult, String> {
    let paths = folders.iter().map(PathBuf::from);
    let mut engine =
        ScriptMetaKitEngine::new(scriptmetakitmini_config()).map_err(|error| error.to_string())?;
    let result = engine
        .scan_root_paths(paths, ScanMode::FileListAndMetadata)
        .map_err(|error| error.to_string())?;

    for issue in &result.file_issues {
        warnings.push(format!("{}: {}", issue.path.display(), issue.message));
    }

    let scanned_files = result
        .flattened_file_entries()
        .filter(|entry| !entry.is_directory)
        .count();

    let mut records_by_key = BTreeMap::new();
    for entry in result.flattened_file_entries() {
        let Some(record) = registered_script_from_entry(entry) else {
            continue;
        };
        if records_by_key
            .insert(record.record_key.clone(), record)
            .is_some()
        {
            warnings.push(format!(
                "同じファイルが重複したため 1 件にまとめました: {}",
                entry.resolved_path.display()
            ));
        }
    }

    let mut records: Vec<_> = records_by_key.into_values().collect();
    records.sort_by(|lhs, rhs| {
        lhs.file_name
            .to_lowercase()
            .cmp(&rhs.file_name.to_lowercase())
            .then(lhs.script_id.cmp(&rhs.script_id))
    });

    let registered_count = records.len();
    Ok(ScanResult {
        records,
        scanned_files,
        registered_count,
        skipped_count: scanned_files.saturating_sub(registered_count),
    })
}

fn registered_script_from_entry(entry: &FileSystemEntry) -> Option<RegisteredScript> {
    if entry.is_directory {
        return None;
    }

    if let Some(item) = entry.scriptmeta_item.as_ref() {
        return Some(registered_script_from_item(item.as_ref(), entry));
    }

    if !entry.can_append_scriptmeta && !entry.can_edit_scriptmeta {
        return None;
    }

    let file_path = entry.resolved_path.display().to_string();
    Some(RegisteredScript {
        record_key: file_path.clone(),
        script_id: String::new(),
        file_name: file_name_for_path(&entry.resolved_path),
        file_path,
        version: None,
        target_app: None,
        description_text: None,
        meta_url: None,
        resolved_version: None,
        latest_page_url: None,
        resolved_meta_page_url: None,
        distribution_note: None,
        is_unresolved: None,
        redirect_count: None,
        has_scriptmeta: entry.has_scriptmeta,
        can_edit_scriptmeta: entry.can_edit_scriptmeta,
        can_append_scriptmeta: entry.can_append_scriptmeta,
        scriptmeta_edit_state: entry.scriptmeta_edit_state.as_str().to_string(),
    })
}

fn registered_script_from_item(item: &ScriptMetaItem, entry: &FileSystemEntry) -> RegisteredScript {
    let file_path = entry.resolved_path.display().to_string();
    RegisteredScript {
        record_key: file_path.clone(),
        script_id: item.script_id.clone(),
        file_name: file_name_for_path(&entry.resolved_path),
        file_path,
        version: item.version.clone(),
        target_app: item.target_app.clone(),
        description_text: item.description.clone(),
        meta_url: item.meta_url.as_ref().map(|url| url.to_string()),
        resolved_version: None,
        latest_page_url: None,
        resolved_meta_page_url: None,
        distribution_note: None,
        is_unresolved: None,
        redirect_count: None,
        has_scriptmeta: entry.has_scriptmeta,
        can_edit_scriptmeta: entry.can_edit_scriptmeta,
        can_append_scriptmeta: entry.can_append_scriptmeta,
        scriptmeta_edit_state: entry.scriptmeta_edit_state.as_str().to_string(),
    }
}

fn file_name_for_path(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn resolve_records_with_kit(
    records: Vec<RegisteredScript>,
) -> Result<Vec<DistributionResolution>, String> {
    let resolver = UpdateResolver::new(DistributionResolverOptions::default())
        .map_err(|error| error.to_string())?;
    let mut results = Vec::new();
    let mut seen_script_ids = HashSet::new();

    for record in records {
        if !seen_script_ids.insert(record.script_id.clone()) {
            continue;
        }

        let item = match script_item_from_record(&record) {
            Ok(item) => item,
            Err(error) => {
                results.push(unresolved_result(&record, error));
                continue;
            }
        };

        match resolver.resolve_item(&item) {
            Ok(resolved) => results.push(distribution_result_from_resolved(&record, resolved)),
            Err(error) => results.push(unresolved_result(&record, error.to_string())),
        }
    }

    Ok(results)
}

fn script_item_from_record(record: &RegisteredScript) -> Result<ScriptMetaItem, String> {
    let script_id = record.script_id.trim();
    if script_id.is_empty() {
        return Err("Script-ID が未設定です。".to_string());
    }

    let version = record
        .version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Version が未設定です。".to_string())?;

    let meta_url_raw = record
        .meta_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Meta-URL が未設定です。".to_string())?;

    let meta_url = normalize_metadata_url(meta_url_raw)
        .ok_or_else(|| "Meta-URL の形式が不正です。".to_string())?;
    let file_path = PathBuf::from(&record.file_path);
    let metadata = ScriptMetadata {
        presentation: Default::default(),
        script_id: script_id.to_string(),
        version: Some(version.to_string()),
        description: record.description_text.clone(),
        target_app: record.target_app.clone(),
        min_target_version: None,
        meta_url: Some(meta_url),
        latest_url: None,
        latest_version: None,
        latest_page_url: None,
        name: Some(record.file_name.clone()),
        author: None,
        release_date: None,
        edit_password_sha256: None,
    };

    Ok(ScriptMetaItem::from_metadata(
        "scriptmetakitmini".into(),
        file_path.clone(),
        file_path,
        metadata,
    ))
}

fn distribution_result_from_resolved(
    record: &RegisteredScript,
    resolved: scriptmetakit::resolver::ResolvedItemUpdate,
) -> DistributionResolution {
    let Some(resolution) = resolved.resolution else {
        return DistributionResolution {
            script_id: record.script_id.clone(),
            resolved_version: None,
            latest_page_url: None,
            resolved_meta_page_url: record.meta_url.clone().unwrap_or_default(),
            distribution_note: Some("更新確認に必要な情報がありません。".to_string()),
            is_unresolved: true,
            redirect_count: None,
        };
    };

    let is_unresolved = resolution.is_unresolved
        || matches!(
            resolved.status,
            UpdateStatus::Failed | UpdateStatus::NotCheckable | UpdateStatus::Cancelled
        );
    let note = resolution
        .note
        .clone()
        .or_else(|| is_unresolved.then(|| "最新版を確定できません。".to_string()));

    DistributionResolution {
        script_id: record.script_id.clone(),
        resolved_version: resolution.latest_version,
        latest_page_url: resolution.latest_page_url.map(|url| url.to_string()),
        resolved_meta_page_url: resolution.final_page_url.to_string(),
        distribution_note: note,
        is_unresolved,
        redirect_count: resolution.redirect_count.map(|count| count as usize),
    }
}

fn unresolved_result(record: &RegisteredScript, message: String) -> DistributionResolution {
    DistributionResolution {
        script_id: record.script_id.clone(),
        resolved_version: None,
        latest_page_url: None,
        resolved_meta_page_url: record.meta_url.clone().unwrap_or_default(),
        distribution_note: Some(message),
        is_unresolved: true,
        redirect_count: None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            register_dropped_paths,
            preview_metadata,
            edit_metadata_language,
            custom_text::validate_custom_metadata_text,
            load_saved_records,
            save_registered_folders,
            resolve_registered_scripts,
            load_script_metadata_document,
            verify_edit_password,
            generate_edit_password,
            pick_folder,
            save_script_metadata_document
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_item_from_record_uses_kit_url_normalization() {
        let record = RegisteredScript {
            record_key: "/tmp/Test.jsx".to_string(),
            script_id: "com.example.test".to_string(),
            file_name: "Test.jsx".to_string(),
            file_path: "/tmp/Test.jsx".to_string(),
            version: Some("1.0".to_string()),
            target_app: Some("Photoshop".to_string()),
            description_text: Some("Test".to_string()),
            meta_url: Some("example.com/meta".to_string()),
            resolved_version: None,
            latest_page_url: None,
            resolved_meta_page_url: None,
            distribution_note: None,
            is_unresolved: None,
            redirect_count: None,
            has_scriptmeta: true,
            can_edit_scriptmeta: true,
            can_append_scriptmeta: false,
            scriptmeta_edit_state: "editable".to_string(),
        };

        let item = script_item_from_record(&record).expect("item");
        assert_eq!(item.script_id, "com.example.test");
        assert_eq!(item.version.as_deref(), Some("1.0"));
        assert_eq!(
            item.meta_url.as_ref().map(|url| url.as_str()),
            Some("https://example.com/meta")
        );
    }

    #[test]
    fn registered_script_from_item_uses_resolved_path_for_alias_entries() {
        let display_path = PathBuf::from("/tmp/Alias/Photoshop/BrushPanel.jsx");
        let resolved_path = PathBuf::from("/tmp/Real/Photoshop/BrushPanel.jsx");
        let metadata = ScriptMetadata {
            presentation: Default::default(),
            script_id: "org.example.BrushPanel".to_string(),
            version: Some("1".to_string()),
            description: None,
            target_app: Some("Photoshop".to_string()),
            min_target_version: None,
            meta_url: None,
            latest_url: None,
            latest_version: None,
            latest_page_url: None,
            name: None,
            author: None,
            release_date: None,
            edit_password_sha256: None,
        };
        let item = ScriptMetaItem::from_metadata(
            "test-root".into(),
            display_path.clone(),
            resolved_path.clone(),
            metadata,
        );
        let entry = FileSystemEntry {
            display_path,
            resolved_path: resolved_path.clone(),
            path_kind: scriptmetakit::PathKind::MacosAlias,
            resolution_status: PathResolutionStatus::Resolved,
            resolution_message: None,
            is_directory: false,
            file_size: None,
            content_modified_at: None,
            identity: None,
            runtime_kind: None,
            shebang: None,
            has_scriptmeta: true,
            has_scriptmeta_edit_password: false,
            is_file_locked: false,
            is_read_only: false,
            can_edit_scriptmeta: true,
            can_append_scriptmeta: false,
            scriptmeta_edit_state: scriptmetakit::ScriptMetaEditState::Editable,
            scriptmeta_item: None,
            children: Vec::new(),
        };

        let record = registered_script_from_item(&item, &entry);

        assert_eq!(record.record_key, resolved_path.display().to_string());
        assert_eq!(record.file_path, resolved_path.display().to_string());
        assert_eq!(record.file_name, "BrushPanel.jsx");
    }

    #[test]
    fn scans_sample_scripts_with_kit_engine() {
        let samples = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../samples/Scripts");
        let mut warnings = Vec::new();
        let result = scan_registered_folders(&[samples.display().to_string()], &mut warnings)
            .expect("scan samples");

        assert!(result.registered_count > 0);
        assert!(result.records.iter().any(|record| {
            record.script_id == "org.iwashi.Photoshop_HalftoneGenerator"
                || record.script_id == "org.iwashi.Halftone_Generator"
        }));
    }

    fn advanced_fixture() -> (
        String,
        scriptmetakit::ScriptMetadataEditReadResult,
        AdvancedMetadata,
    ) {
        let source = "/*\nSCRIPTMETA-BEGIN\nScript-ID=org.example.test\nMeta-Default-language=ja\nName=日本語\nName[en]=English\nAuthor=作者\nTags=画像,print\nX-org.example-Order=0020\nX-org.example-Note=\nX-org.example-Multi=first\nX-org.example-Multi=second\nUnknown=keep\nDescription-BEGIN\n[ja]\n日本語の説明\n[en]\nEnglish description\nDescription-END\nSCRIPTMETA-END\n*/\nconst untouched = true;\n".to_string();
        let read =
            scriptmetakit::read_script_metadata_draft_from_text(&source, Path::new("Test.jsx"))
                .unwrap();
        let advanced = AdvancedMetadata {
            custom_text: None,
            localization: MetadataLocalizationEditor::from_draft(&read.draft).unwrap(),
            tags: read.draft.extensions.as_ref().unwrap().tags.clone(),
            custom_fields: read.draft.custom_fields.clone(),
        };
        (source, read, advanced)
    }

    fn advanced_roundtrip(
        source: &str,
        read: &scriptmetakit::ScriptMetadataEditReadResult,
        advanced: &AdvancedMetadata,
    ) -> scriptmetakit::ScriptMetadataEditReadResult {
        let request = ScriptMetadataSaveRequest {
            advanced: Some(advanced.clone()),
            draft: editable_draft_from_kit(read.draft.clone()),
            file_path: "Test.jsx".into(),
            mode: Some("localSubset".into()),
            checked_fields: Some(vec!["scriptId".into()]),
            source_fingerprint: read.source_fingerprint.clone(),
        };
        let draft = effective_kit_draft_for_save(read, &request).unwrap();
        let result = scriptmetakit::write_script_metadata_to_text(
            source,
            Path::new("Test.jsx"),
            &draft,
            ScriptMetaWriteMode::InsertOrReplace,
        )
        .unwrap();
        assert!(result.text.ends_with("const untouched = true;\n"));
        assert!(result.text.contains("Unknown=keep"));
        scriptmetakit::read_script_metadata_draft_from_text(&result.text, Path::new("Test.jsx"))
            .unwrap()
    }

    #[test]
    fn multilingual_tags_and_custom_values_roundtrip() {
        let (source, read, mut advanced) = advanced_fixture();
        advanced
            .localization
            .set_text(
                scriptmetakit::MetadataLocalizedField::Description,
                Some("en"),
                Some("Changed English".into()),
            )
            .unwrap();
        advanced.tags = vec![" print ".into(), "画像".into(), "print".into()];
        advanced
            .custom_fields
            .insert("X-org.example-order".into(), vec!["0030".into()]);
        let result = advanced_roundtrip(&source, &read, &advanced);
        let editor = MetadataLocalizationEditor::from_draft(&result.draft).unwrap();
        assert_eq!(
            editor
                .text(
                    scriptmetakit::MetadataLocalizedField::Description,
                    Some("ja")
                )
                .unwrap(),
            Some("日本語の説明")
        );
        assert_eq!(
            editor
                .text(
                    scriptmetakit::MetadataLocalizedField::Description,
                    Some("en")
                )
                .unwrap(),
            Some("Changed English")
        );
        assert_eq!(result.draft.extensions.unwrap().tags, vec!["print", "画像"]);
        assert_eq!(
            result.draft.custom_fields["X-org.example-order"],
            vec!["0030"]
        );
        assert_eq!(
            result.draft.custom_fields["X-org.example-multi"],
            vec!["first", "second"]
        );
    }

    #[test]
    fn custom_delete_empty_value_and_rename_are_distinct() {
        let (source, read, mut advanced) = advanced_fixture();
        advanced.custom_fields.remove("X-org.example-order");
        advanced
            .custom_fields
            .insert("X-org.example-renamed".into(), vec!["0020".into()]);
        let result = advanced_roundtrip(&source, &read, &advanced);
        assert!(
            !result
                .draft
                .custom_fields
                .contains_key("X-org.example-order")
        );
        assert_eq!(result.draft.custom_fields["X-org.example-note"], vec![""]);
        assert_eq!(
            result.draft.custom_fields["X-org.example-renamed"],
            vec!["0020"]
        );
    }

    #[test]
    fn preview_preserves_existing_block_and_translations() {
        let (_, read, advanced) = advanced_fixture();
        let preview = preview_metadata(
            editable_draft_from_kit(read.draft.clone()),
            advanced,
            "java_script_block".into(),
            read.existing_block_text,
            read.draft.custom_fields,
        )
        .unwrap();
        assert_eq!(preview.matches("SCRIPTMETA-BEGIN").count(), 1);
        assert!(preview.contains("Unknown=keep"));
        assert!(preview.contains("Name[en]=English"));
        assert!(preview.contains("X-org.example-Order=0020"));
    }

    #[test]
    fn invalid_custom_changes_are_rejected_but_unchanged_values_survive() {
        let source = "/*\nSCRIPTMETA-BEGIN\nScript-ID=org.example.test\nX-org.example-Note= Name=legacy\nSCRIPTMETA-END\n*/\nconst untouched = true;\n";
        let read =
            scriptmetakit::read_script_metadata_draft_from_text(source, Path::new("Test.jsx"))
                .unwrap();
        let advanced = AdvancedMetadata {
            custom_text: None,
            localization: MetadataLocalizationEditor::from_draft(&read.draft).unwrap(),
            tags: vec![],
            custom_fields: read.draft.custom_fields.clone(),
        };
        let preview = preview_metadata(
            editable_draft_from_kit(read.draft.clone()),
            advanced.clone(),
            "java_script_block".into(),
            read.existing_block_text.clone(),
            read.draft.custom_fields.clone(),
        )
        .unwrap();
        assert!(preview.contains("X-org.example-Note= Name=legacy"));
        let mut changed = advanced;
        changed
            .custom_fields
            .insert("X-org.example-new".into(), vec!["bad\nvalue".into()]);
        assert!(
            preview_metadata(
                editable_draft_from_kit(read.draft.clone()),
                changed,
                "java_script_block".into(),
                read.existing_block_text,
                read.draft.custom_fields
            )
            .is_err()
        );
    }

    #[test]
    fn language_removal_keeps_last_language_as_plain_text() {
        let (_, _, mut advanced) = advanced_fixture();
        advanced.localization.remove_language("en").unwrap();
        advanced.localization.remove_language("ja").unwrap();
        let draft = apply_advanced_metadata(
            ScriptMetadataDraft {
                script_id: "org.example.test".into(),
                ..Default::default()
            },
            &advanced,
            &BTreeMap::new(),
            ScriptMetaCommentStyle::JavaScriptBlock,
        )
        .unwrap();
        assert_eq!(draft.name.as_deref(), Some("日本語"));
        assert_eq!(draft.description.as_deref(), Some("日本語の説明"));
        assert!(draft.extensions.unwrap().default_language.is_none());
    }

    #[test]
    fn multiline_custom_text_roundtrips_and_removes_deleted_keys() {
        let (source, read, mut advanced) = advanced_fixture();
        advanced.custom_text =
            Some("X-iw-Note=\nX-iw-URL=https://example.com/?a=1&b=2\n\nX-iw-Note=second".into());
        let saved = advanced_roundtrip(&source, &read, &advanced);
        assert_eq!(saved.draft.custom_fields["X-iw-note"], vec!["", "second"]);
        assert_eq!(
            saved.draft.custom_fields["X-iw-url"],
            vec!["https://example.com/?a=1&b=2"]
        );
        assert!(
            !saved
                .draft
                .custom_fields
                .contains_key("X-org.example-order")
        );
        assert_eq!(saved.draft.name, read.draft.name);
    }

    #[test]
    fn save_revalidates_raw_custom_text_even_when_fields_map_is_valid() {
        let (_, read, mut advanced) = advanced_fixture();
        advanced.custom_text = Some("X-iw-Good=valid\nunfinished".into());
        let request = ScriptMetadataSaveRequest {
            advanced: Some(advanced),
            draft: editable_draft_from_kit(read.draft.clone()),
            file_path: "Test.jsx".into(),
            mode: Some("localSubset".into()),
            checked_fields: Some(vec!["scriptId".into()]),
            source_fingerprint: read.source_fingerprint.clone(),
        };
        let error = effective_kit_draft_for_save(&read, &request).unwrap_err();
        assert!(error.starts_with("2行目:"), "{error}");
    }

    #[test]
    fn save_draft_omits_unchecked_existing_fields() {
        let current = scriptmetakit::ScriptMetadataEditReadResult {
            file_path: PathBuf::from("/tmp/Test.jsx"),
            draft: ScriptMetadataDraft {
                script_id: "com.example.test".to_string(),
                version: Some("1.0.0".to_string()),
                target_app: Some("Photoshop".to_string()),
                description: Some("Old description".to_string()),
                ..ScriptMetadataDraft::default()
            },
            comment_style: ScriptMetaCommentStyle::JavaScriptBlock,
            line_ending: "\n".to_string(),
            has_existing_block: true,
            diagnostics: Vec::new(),
            existing_lines: Vec::new(),
            unknown_lines: Vec::new(),
            existing_block_text: None,
            source_fingerprint: "fingerprint".to_string(),
        };
        let request = ScriptMetadataSaveRequest {
            advanced: None,
            file_path: "/tmp/Test.jsx".to_string(),
            draft: EditableScriptMetadataDraft {
                script_id: "com.example.test".to_string(),
                version: Some("1.1.0".to_string()),
                target_app: Some("Illustrator".to_string()),
                description: Some("New description".to_string()),
                ..EditableScriptMetadataDraft::default()
            },
            mode: Some("localSubset".to_string()),
            checked_fields: Some(vec![
                "scriptId".to_string(),
                "version".to_string(),
                "description".to_string(),
            ]),
            source_fingerprint: "fingerprint".to_string(),
        };

        let draft = effective_kit_draft_for_save(&current, &request).expect("draft");

        assert_eq!(draft.script_id, "com.example.test");
        assert_eq!(draft.version.as_deref(), Some("1.1.0"));
        assert_eq!(draft.description.as_deref(), Some("New description"));
        assert_eq!(draft.target_app, None);
    }
}
