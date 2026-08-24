import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

type RegisteredScript = {
  recordKey: string;
  scriptId: string;
  fileName: string;
  filePath: string;
  version: string | null;
  targetApp: string | null;
  descriptionText: string | null;
  metaUrl: string | null;
  resolvedVersion: string | null;
  latestPageUrl: string | null;
  resolvedMetaPageUrl: string | null;
  distributionNote: string | null;
  isUnresolved: boolean | null;
  redirectCount: number | null;
  hasScriptmeta: boolean;
  canEditScriptmeta: boolean;
  canAppendScriptmeta: boolean;
  scriptmetaEditState: string;
};

type ImportSummary = {
  folders: string[];
  records: RegisteredScript[];
  scannedFiles: number;
  registeredCount: number;
  skippedCount: number;
  warnings: string[];
};

type PersistedRecords = {
  folders: string[];
  records: RegisteredScript[];
  warnings: string[];
  scannedFiles: number;
  skippedCount: number;
};

type EditableScriptMetadataDraft = {
  scriptId: string;
  version: string | null;
  description: string | null;
  targetApp: string | null;
  minTargetVersion: string | null;
  metaUrl: string | null;
  name: string | null;
  author: string | null;
  releaseDate: string | null;
  editPasswordSha256: string | null;
};

type ScriptMetadataEditDocument = {
  filePath: string;
  draft: EditableScriptMetadataDraft;
  commentStyle: string;
  lineEnding: string;
  hasExistingBlock: boolean;
  unknownLines: string[];
  existingBlockText: string | null;
  sourceFingerprint: string;
};

type ScriptMetadataSaveResult = {
  filePath: string;
  operation: "inserted" | "replaced" | string;
  backupFilePath: string | null;
  document: ScriptMetadataEditDocument;
};

type DistributionResolution = {
  scriptId: string;
  resolvedVersion: string | null;
  latestPageUrl: string | null;
  resolvedMetaPageUrl: string;
  distributionNote: string | null;
  isUnresolved: boolean;
  redirectCount: number | null;
};

const UNSPECIFIED_TARGET_KEY = "__unspecified_target__";
const TARGET_APP_OPTIONS = ["Photoshop", "Illustrator", "InDesign"] as const;
const DISALLOWED_META_URL_SUFFIXES = [
  ".zip",
  ".js",
  ".jsx",
  ".jsxinc",
  ".applescript",
  ".idjs",
  ".jxa",
  ".psjs",
] as const;

type EditorMode = "localSubset" | "updateProfile";

const state = {
  folders: [] as string[],
  records: new Map<string, RegisteredScript>(),
  scannedFiles: 0,
  skippedFiles: 0,
  statusMessage: "ウインドウ全体にフォルダをドロップできます。現在は待機中です。",
  isDropActive: false,
  isResolving: false,
  isCheckingUpdates: false,
  warnings: [] as string[],
  selectedTargetKey: null as string | null,
  selectedRecordKey: null as string | null,
  metadataDocument: null as ScriptMetadataEditDocument | null,
  editorDraft: null as EditableScriptMetadataDraft | null,
  editorMode: "localSubset" as EditorMode,
  checkedFields: new Set<DraftField>(),
  unlockedRecordKeys: new Set<string>(),
  passwordInput: "",
  passwordMessage: null as string | null,
  passwordSettingInput: "",
  passwordSettingMessage: null as string | null,
  isGeneratingEditPassword: false,
  isVerifyingPassword: false,
  isLoadingDetail: false,
  isSavingDetail: false,
  editorDirty: false,
  detailMessage: null as string | null,
};

let statusMessageEl: HTMLElement | null;
let heroCopyEl: HTMLElement | null;
let summaryChipsEl: HTMLElement | null;
let scriptListEl: HTMLElement | null;
let emptyStateEl: HTMLElement | null;
let refreshButtonEl: HTMLButtonElement | null;
let updateButtonEl: HTMLButtonElement | null;
let clearButtonEl: HTMLButtonElement | null;
let heroProgressEl: HTMLElement | null;
let folderListEl: HTMLElement | null;
let folderCountEl: HTMLElement | null;
let addFolderButtonEl: HTMLButtonElement | null;
let targetListEl: HTMLElement | null;
let targetCountEl: HTMLElement | null;
let detailPaneEl: HTMLElement | null;

type ScriptTone = "none" | "local" | "update" | "ok" | "error";
type DraftField = keyof EditableScriptMetadataDraft;
type VisibleDraftField = Exclude<DraftField, "editPasswordSha256">;

function isTauriRuntime(): boolean {
  return Boolean(
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}

function isDevMode(): boolean {
  return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
}

function compareVersions(lhs: string, rhs: string): number {
  const left = lhs.split(".").map((value) => Number.parseInt(value, 10) || 0);
  const right = rhs.split(".").map((value) => Number.parseInt(value, 10) || 0);
  const count = Math.max(left.length, right.length);

  for (let index = 0; index < count; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue < rightValue) {
      return -1;
    }
    if (leftValue > rightValue) {
      return 1;
    }
  }

  return 0;
}

function isCheckable(script: RegisteredScript): boolean {
  return Boolean(script.scriptId.trim() && script.version?.trim() && script.metaUrl?.trim());
}

function hasUpdate(script: RegisteredScript): boolean {
  if (!script.version || !script.resolvedVersion) {
    return false;
  }

  return compareVersions(script.version, script.resolvedVersion) < 0;
}

function scriptTone(script: RegisteredScript): ScriptTone {
  if (!script.hasScriptmeta) {
    return "none";
  }

  if (script.isUnresolved === true) {
    return "error";
  }

  if (!script.resolvedVersion && script.distributionNote) {
    return "error";
  }

  if (hasUpdate(script)) {
    return "update";
  }

  if (!isCheckable(script)) {
    return "local";
  }

  return "ok";
}

function preferredOpenUrl(script: RegisteredScript): string | null {
  const rawCandidate =
    script.resolvedMetaPageUrl ?? script.latestPageUrl ?? script.metaUrl;

  if (!rawCandidate) {
    return null;
  }

  try {
    const url = new URL(rawCandidate);

    if (url.hostname === "gist.githubusercontent.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && parts[1] === "raw") {
        return `https://gist.github.com/${parts[0]}`;
      }
      const [owner, gistId] = parts;
      if (owner && gistId) {
        return `https://gist.github.com/${owner}/${gistId}`;
      }
    }

    if (url.hostname === "gist.github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length === 1) {
        return `https://gist.github.com/${parts[0]}`;
      }
      const [owner, gistId] = parts;
      if (owner && gistId) {
        return `https://gist.github.com/${owner}/${gistId}`;
      }
    }

    if (url.hostname === "raw.githubusercontent.com") {
      const [owner, repo] = url.pathname.split("/").filter(Boolean);
      if (owner && repo) {
        return `https://github.com/${owner}/${repo}`;
      }
    }

    if (url.hostname === "api.github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "repos" && parts[1] && parts[2]) {
        return `https://github.com/${parts[1]}/${parts[2]}`;
      }
    }

    if (url.hostname === "github.com") {
      const [owner, repo] = url.pathname.split("/").filter(Boolean);
      if (owner && repo) {
        return `https://github.com/${owner}/${repo}`;
      }
    }

    return url.toString();
  } catch {
    return null;
  }
}

function parentFolderPath(filePath: string): string {
  const normalized = filePath.split("\\").join("/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) {
    return normalized;
  }
  return normalized.slice(0, lastSlash);
}

function targetKey(targetApp: string | null | undefined): string {
  const normalized = normalizeTargetAppValue(targetApp);
  if (normalized) {
    return normalized;
  }

  const trimmed = targetApp?.trim();
  return trimmed ? trimmed : UNSPECIFIED_TARGET_KEY;
}

function targetLabelFromKey(key: string): string {
  return key === UNSPECIFIED_TARGET_KEY ? "未指定" : key;
}

function normalizeTargetAppValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const withoutAdobe = trimmed.replace(/^Adobe\s+/i, "");
  const normalized = TARGET_APP_OPTIONS.find(
    (option) => option.toLowerCase() === withoutAdobe.toLowerCase(),
  );
  return normalized ?? null;
}

function targetAppDraftValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return normalizeTargetAppValue(trimmed) ?? trimmed;
}

function editorModeFromDraft(
  document: ScriptMetadataEditDocument,
  draft: EditableScriptMetadataDraft,
  hasExistingBlock = document.hasExistingBlock,
): EditorMode {
  if (hasExistingBlock && draft.version?.trim() && draft.metaUrl?.trim()) {
    return "updateProfile";
  }
  return "localSubset";
}

function visibleFieldsForMode(mode: EditorMode): VisibleDraftField[] {
  const localFields: VisibleDraftField[] = [
    "scriptId",
    "name",
    "author",
    "version",
    "releaseDate",
    "targetApp",
    "description",
  ];

  if (mode === "localSubset") {
    return localFields;
  }

  return [
    "scriptId",
    "name",
    "author",
    "version",
    "releaseDate",
    "targetApp",
    "minTargetVersion",
    "metaUrl",
    "description",
  ];
}

function fieldTagTitle(field: DraftField): string {
  const titles: Record<DraftField, string> = {
    scriptId: "Script-ID",
    version: "Version",
    description: "Description",
    targetApp: "Target-App",
    minTargetVersion: "Min-Target-Version",
    metaUrl: "Meta-URL",
    name: "Name",
    author: "Author",
    releaseDate: "Release-Date",
    editPasswordSha256: "Edit-Password-SHA256",
  };
  return titles[field];
}

function fieldTitle(field: DraftField): string {
  if (state.editorMode === "updateProfile") {
    return fieldTagTitle(field);
  }

  const localTitles: Partial<Record<DraftField, string>> = {
    scriptId: "スクリプトの、絶対に被らない認識用ID",
    name: "スクリプトの分かりやすい表示用の別名",
    author: "スクリプトの作者",
    version: "スクリプトのバージョン",
    releaseDate: "作成日",
    targetApp: "対象のアプリ（表示用で、動作には影響しません）",
    description: "スクリプトの説明や操作方法",
    editPasswordSha256: "タグ編集をパスワードロック",
  };

  return localTitles[field] ?? fieldTagTitle(field);
}

function hasConfiguredEditPassword(): boolean {
  return Boolean(state.editorDraft?.editPasswordSha256?.trim());
}

function canApplyEditPasswordSetting(): boolean {
  return Boolean(
    state.editorDraft &&
      state.passwordSettingInput.trim().length > 0 &&
      !state.isSavingDetail &&
      !state.isGeneratingEditPassword &&
      !isEditorLocked(),
  );
}

function defaultPasswordSettingMessage(): string {
  return "設定すると Author が必須になります。保存時に Edit-Password-SHA256 として書き込みます。";
}

function fieldRequirementForDraft(
  field: VisibleDraftField,
  mode: EditorMode,
  draft: EditableScriptMetadataDraft | null,
): "必須" | "推奨" | "任意" {
  if (field === "scriptId") {
    return "必須";
  }
  if (field === "version" || field === "metaUrl") {
    return mode === "updateProfile" ? "必須" : "任意";
  }
  if (field === "targetApp" || field === "description") {
    return "推奨";
  }
  if (field === "author") {
    if (draft?.editPasswordSha256?.trim()) {
      return "必須";
    }
    return mode === "updateProfile" ? "推奨" : "任意";
  }
  return "任意";
}

function fieldRequirement(field: VisibleDraftField, mode: EditorMode): "必須" | "推奨" | "任意" {
  return fieldRequirementForDraft(field, mode, state.editorDraft);
}

function fieldRequirementClass(field: VisibleDraftField, value: string | null): string {
  const requirement = fieldRequirement(field, state.editorMode);
  if (requirement === "必須") {
    return normalizedFieldValue(value, field).length === 0 ? " is-required-field" : "";
  }
  if (requirement === "推奨") {
    return " is-recommended-field";
  }
  return "";
}

function syncFieldRequirementClass(wrapper: HTMLElement, field: VisibleDraftField): void {
  const requirement = fieldRequirement(field, state.editorMode);
  const current = normalizedFieldValue(state.editorDraft?.[field] ?? null, field);
  const isRequiredEmpty = requirement === "必須" && current.length === 0;
  wrapper.classList.toggle("is-required-field", isRequiredEmpty);
  wrapper.classList.toggle("is-recommended-field", requirement === "推奨");

  const checkbox = wrapper.querySelector<HTMLInputElement>(".field-caption input[type='checkbox']");
  if (checkbox) {
    checkbox.checked = state.checkedFields.has(field);
    checkbox.disabled = isCheckDisabled(field) || state.isSavingDetail || isEditorLocked();
  }
}

function fieldPlaceholder(field: VisibleDraftField): string {
  const requirement = fieldRequirement(field, state.editorMode);
  if (field === "scriptId") {
    return "local.user.ScriptName";
  }
  if (field === "version") {
    return "1.0";
  }
  if (field === "metaUrl") {
    return "https://example.com/SCRIPTMETA.txt";
  }
  if (field === "releaseDate") {
    return "2026-06-21";
  }
  return requirement;
}

function normalizedFieldValue(value: string | null | undefined, field: DraftField): string {
  const rawValue = value ?? "";
  if (field === "description") {
    return rawValue.trim();
  }
  return rawValue.replace(/\r\n/g, " ").replace(/[\r\n]/g, " ").trim();
}

function recordsForSelectedTarget(): RegisteredScript[] {
  const records = [...state.records.values()];
  if (!state.selectedTargetKey) {
    return records;
  }
  return records.filter((record) => targetKey(record.targetApp) === state.selectedTargetKey);
}

function selectedScript(): RegisteredScript | null {
  if (!state.selectedRecordKey) {
    return null;
  }
  return state.records.get(state.selectedRecordKey) ?? null;
}

function documentHasExistingBlockForScript(
  document: ScriptMetadataEditDocument | null,
  script: RegisteredScript | null,
): boolean {
  return Boolean(document?.hasExistingBlock && script?.hasScriptmeta);
}

function selectedDocumentHasExistingBlock(): boolean {
  return documentHasExistingBlockForScript(state.metadataDocument, selectedScript());
}

function targetGroups(): Array<{ key: string; label: string; count: number }> {
  const groups = new Map<string, number>();
  for (const record of state.records.values()) {
    const key = targetKey(record.targetApp);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  return [...groups.entries()]
    .map(([key, count]) => ({
      key,
      label: targetLabelFromKey(key),
      count,
    }))
    .sort((lhs, rhs) => lhs.label.localeCompare(rhs.label, "ja"));
}

function ensureSelectionsAreAvailable(): void {
  if (
    state.selectedTargetKey &&
    !targetGroups().some((group) => group.key === state.selectedTargetKey)
  ) {
    state.selectedTargetKey = null;
  }

  if (!state.selectedRecordKey) {
    return;
  }

  const visibleRecords = recordsForSelectedTarget();
  if (!visibleRecords.some((record) => record.recordKey === state.selectedRecordKey)) {
    clearDetailSelection();
  }
}

function clearDetailSelection(): void {
  state.selectedRecordKey = null;
  state.metadataDocument = null;
  state.editorDraft = null;
  state.editorMode = "localSubset";
  state.checkedFields.clear();
  state.passwordInput = "";
  state.passwordMessage = null;
  state.passwordSettingInput = "";
  state.passwordSettingMessage = null;
  state.isGeneratingEditPassword = false;
  state.isVerifyingPassword = false;
  state.isLoadingDetail = false;
  state.isSavingDetail = false;
  state.editorDirty = false;
  state.detailMessage = null;
}

function setDropActive(isActive: boolean): void {
  state.isDropActive = isActive;
  document.body.classList.toggle("is-drop-active", isActive);
  if (statusMessageEl && isActive) {
    statusMessageEl.textContent = "ここでフォルダをドロップしてください。";
  } else if (
    statusMessageEl &&
    state.statusMessage === "ここでフォルダをドロップしてください。"
  ) {
    statusMessageEl.textContent = "ウインドウ全体にフォルダをドロップできます。現在は待機中です。";
  }
}

function setStatus(message: string): void {
  state.statusMessage = message;
  if (statusMessageEl) {
    statusMessageEl.textContent = message;
  }
}

function renderHeroCopy(): void {
  if (!heroCopyEl) {
    return;
  }

  heroCopyEl.textContent = `登録 ${state.folders.length} 件 / script ${state.records.size} 件 / 走査 ${state.scannedFiles} 件 / 除外 ${state.skippedFiles} 件`;
}

function renderSummary(): void {
  if (!summaryChipsEl) {
    return;
  }

  const records = recordsForSelectedTarget();
  const noMetaCount = records.filter((record) => scriptTone(record) === "none").length;
  const localCount = records.filter((record) => scriptTone(record) === "local").length;
  const updateCount = records.filter((record) => scriptTone(record) === "update").length;
  const okCount = records.filter((record) => scriptTone(record) === "ok").length;
  const errorCount = records.filter((record) => scriptTone(record) === "error").length;

  const chips = [
    { label: `メタ無し ${noMetaCount}`, className: "metric-chip is-none" },
    { label: `LS ${localCount}`, className: "metric-chip is-local" },
    { label: `アップデートあり ${updateCount}`, className: "metric-chip is-update" },
    { label: `確認済み ${okCount}`, className: "metric-chip is-ok" },
    { label: `エラー ${errorCount}`, className: "metric-chip is-error" },
  ];

  summaryChipsEl.replaceChildren(
    ...chips.map((chipData) => {
      const chip = document.createElement("span");
      chip.className = chipData.className;
      chip.textContent = chipData.label;
      return chip;
    }),
  );
}

function renderRefreshButton(): void {
  if (!refreshButtonEl) {
    return;
  }

  refreshButtonEl.disabled =
    state.folders.length === 0 || state.isResolving || state.isCheckingUpdates;
  refreshButtonEl.textContent = state.isResolving ? "読み込み中..." : "リスト再読み込み";
}

function renderUpdateButton(): void {
  if (!updateButtonEl) {
    return;
  }

  const checkableCount = [...state.records.values()].filter(isCheckable).length;
  updateButtonEl.disabled =
    checkableCount === 0 || state.isResolving || state.isCheckingUpdates;
  updateButtonEl.textContent = state.isCheckingUpdates ? "確認中..." : "更新チェック";
}

function renderClearButton(): void {
  if (!clearButtonEl) {
    return;
  }

  clearButtonEl.disabled =
    state.folders.length === 0 || state.isResolving || state.isCheckingUpdates;
}

function renderAddFolderButton(): void {
  if (!addFolderButtonEl) {
    return;
  }

  addFolderButtonEl.disabled = state.isResolving || state.isCheckingUpdates;
}

function renderProgressBar(): void {
  if (!heroProgressEl) {
    return;
  }

  heroProgressEl.classList.toggle("is-hidden", state.isResolving === false);
  heroProgressEl.setAttribute(
    "aria-hidden",
    state.isResolving ? "false" : "true",
  );
}

function applyBrowserPreviewState(): void {
  if (isTauriRuntime() || !isDevMode()) {
    return;
  }

  const previewRecords: RegisteredScript[] = [
    {
      recordKey: "/Users/example/Scripts/Photoshop/Export Layers.jsx",
      scriptId: "com.example.exportlayers",
      fileName: "Export Layers.jsx",
      filePath: "/Users/example/Scripts/Photoshop/Export Layers.jsx",
      version: "1.2.0",
      targetApp: "Photoshop",
      descriptionText: "Layer export helper with SCRIPTMETA distribution data.",
      metaUrl: "https://example.com/SCRIPTMETA.txt",
      resolvedVersion: "1.3.0",
      latestPageUrl: "https://example.com/SCRIPTMETA.txt",
      resolvedMetaPageUrl: "https://example.com/SCRIPTMETA.txt",
      distributionNote: null,
      isUnresolved: false,
      redirectCount: 0,
      hasScriptmeta: true,
      canEditScriptmeta: true,
      canAppendScriptmeta: false,
      scriptmetaEditState: "editable",
    },
    {
      recordKey: "/Users/example/Scripts/Illustrator/Artboard Navigator.jsx",
      scriptId: "com.example.artboardnavigator",
      fileName: "Artboard Navigator.jsx",
      filePath: "/Users/example/Scripts/Illustrator/Artboard Navigator.jsx",
      version: "1.0.3",
      targetApp: "Illustrator",
      descriptionText: "Artboard navigation helper.",
      metaUrl: "https://example.com/SCRIPTMETA.txt",
      resolvedVersion: "1.0.3",
      latestPageUrl: "https://example.com/SCRIPTMETA.txt",
      resolvedMetaPageUrl: "https://example.com/SCRIPTMETA.txt",
      distributionNote: null,
      isUnresolved: false,
      redirectCount: 0,
      hasScriptmeta: true,
      canEditScriptmeta: true,
      canAppendScriptmeta: false,
      scriptmetaEditState: "editable",
    },
    {
      recordKey: "/Users/example/Scripts/Photoshop/Watermark.jsx",
      scriptId: "",
      fileName: "Watermark.jsx",
      filePath: "/Users/example/Scripts/Photoshop/Watermark.jsx",
      version: null,
      targetApp: "Photoshop",
      descriptionText: null,
      metaUrl: null,
      resolvedVersion: null,
      latestPageUrl: null,
      resolvedMetaPageUrl: null,
      distributionNote: null,
      isUnresolved: null,
      redirectCount: null,
      hasScriptmeta: false,
      canEditScriptmeta: false,
      canAppendScriptmeta: true,
      scriptmetaEditState: "appendable",
    },
  ];

  state.folders = ["/Users/example/Scripts"];
  state.records = new Map(
    previewRecords.map((record) => [record.recordKey, record] as const),
  );
  state.scannedFiles = 3;
  state.skippedFiles = 0;
  state.warnings = [];
  setStatus("ブラウザプレビュー用のリストを表示しています。");
}

function statusIconLabel(script: RegisteredScript): string {
  if (!script.hasScriptmeta) {
    return "メタ無し";
  }
  return isCheckable(script) ? "UP" : "LS";
}

function iconSvg(name: "folder" | "globe"): string {
  if (name === "folder") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z"/><path d="M2.5 10h19"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13.5 13.5 0 0 1 0 18"/><path d="M12 3a13.5 13.5 0 0 0 0 18"/></svg>`;
}

function createRowActionButton(
  label: string,
  icon: "folder" | "globe",
  action: () => Promise<void>,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "row-action";
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = iconSvg(icon);
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`項目を開けませんでした: ${message}`);
    }
  });
  return button;
}

function createScriptRow(script: RegisteredScript): HTMLElement {
  const row = document.createElement("article");
  const tone = scriptTone(script);
  const isSelected = state.selectedRecordKey === script.recordKey;
  row.className = `script-row is-${tone}${isSelected ? " is-selected" : ""}`;
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-pressed", isSelected ? "true" : "false");
  row.addEventListener("click", () => {
    void selectScript(script.recordKey);
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void selectScript(script.recordKey);
    }
  });

  const status = document.createElement("div");
  status.className = "script-cell col-status";
  const statusPill = document.createElement("span");
  statusPill.className = `status-pill is-${tone}`;
  statusPill.textContent = statusIconLabel(script);
  status.append(statusPill);

  const scriptCell = document.createElement("div");
  scriptCell.className = "script-cell col-script";

  const name = document.createElement("div");
  name.className = "script-name";
  name.textContent = script.fileName;
  name.title = script.filePath;

  const scriptId = document.createElement("div");
  scriptId.className = "script-id";
  scriptId.textContent = script.scriptId.trim() || "Script-ID 未設定";
  scriptId.title = script.metaUrl ?? script.filePath;

  const path = document.createElement("div");
  path.className = "script-path";
  path.textContent = parentFolderPath(script.filePath);
  path.title = script.filePath;

  scriptCell.append(name, scriptId, path);

  const version = document.createElement("div");
  version.className = "script-cell col-version version-pair";
  const current = document.createElement("span");
  current.className = "version-current";
  current.textContent = script.version ?? "未設定";
  const latest = document.createElement("span");
  latest.className = "version-latest";
  latest.textContent = script.resolvedVersion ?? (isCheckable(script) ? "未取得" : "未確認");
  version.append(current, latest);

  const actions = document.createElement("div");
  actions.className = "script-cell col-actions row-actions";
  const openCandidate = preferredOpenUrl(script);
  actions.append(
    createRowActionButton("Finderで表示", "folder", () => revealItemInDir(script.filePath)),
  );
  if (openCandidate) {
    actions.append(createRowActionButton("Webで開く", "globe", () => openUrl(openCandidate)));
  }

  row.append(status, scriptCell, version, actions);
  return row;
}

function renderFolders(): void {
  if (!folderListEl || !folderCountEl) {
    return;
  }

  folderCountEl.textContent = String(state.folders.length);
  if (state.folders.length === 0) {
    const empty = document.createElement("div");
    empty.className = "folder-empty";
    empty.textContent = "フォルダをドロップ";
    folderListEl.replaceChildren(empty);
    return;
  }

  folderListEl.replaceChildren(
    ...state.folders.map((folder) => {
      const item = document.createElement("div");
      item.className = "folder-item";
      item.textContent = folder;
      item.title = folder;
      return item;
    }),
  );
}

function createTargetItem(
  label: string,
  count: number,
  isSelected: boolean,
  onSelect: () => void,
): HTMLButtonElement {
  const item = document.createElement("button");
  item.className = `target-item${isSelected ? " is-selected" : ""}`;
  item.type = "button";
  item.setAttribute("aria-pressed", isSelected ? "true" : "false");

  const name = document.createElement("span");
  name.className = "target-name";
  name.textContent = label;

  const badge = document.createElement("strong");
  badge.className = "target-badge";
  badge.textContent = String(count);

  item.append(name, badge);
  item.addEventListener("click", onSelect);
  return item;
}

function renderTargets(): void {
  if (!targetListEl || !targetCountEl) {
    return;
  }

  const groups = targetGroups();
  targetCountEl.textContent = String(groups.length);

  if (state.records.size === 0) {
    const empty = document.createElement("div");
    empty.className = "target-empty";
    empty.textContent = "ターゲットなし";
    targetListEl.replaceChildren(empty);
    return;
  }

  const allItem = createTargetItem(
    "すべて",
    state.records.size,
    state.selectedTargetKey === null,
    () => {
      state.selectedTargetKey = null;
      render();
    },
  );

  const groupItems = groups.map((group) =>
    createTargetItem(
      group.label,
      group.count,
      state.selectedTargetKey === group.key,
      () => {
        state.selectedTargetKey = group.key;
        render();
      },
    ),
  );

  targetListEl.replaceChildren(allItem, ...groupItems);
}

function renderScripts(): void {
  if (!scriptListEl || !emptyStateEl) {
    return;
  }

  const records = recordsForSelectedTarget().sort((lhs, rhs) => {
    const toneOrder: Record<ScriptTone, number> = {
      error: 0,
      update: 1,
      none: 2,
      local: 3,
      ok: 4,
    };
    const toneDiff = toneOrder[scriptTone(lhs)] - toneOrder[scriptTone(rhs)];
    if (toneDiff !== 0) {
      return toneDiff;
    }

    return lhs.fileName.localeCompare(rhs.fileName, "ja");
  });

  const emptyCopy = emptyStateEl.querySelector("p");
  if (emptyCopy) {
    if (state.records.size === 0 && state.folders.length > 0) {
      emptyCopy.textContent = "編集できる script は見つかりませんでした。";
    } else if (state.records.size === 0) {
      emptyCopy.textContent = "まだフォルダが登録されていません。";
    } else {
      emptyCopy.textContent = "選択したターゲットの script はありません。";
    }
  }

  scriptListEl.replaceChildren(...records.map(createScriptRow));
  emptyStateEl.classList.toggle("is-hidden", records.length > 0);
}

function renderDetailPane(): void {
  if (!detailPaneEl) {
    return;
  }

  const script = selectedScript();
  if (!script) {
    const empty = document.createElement("div");
    empty.className = "detail-empty";
    const copy = document.createElement("p");
    copy.textContent = "script を選択してください。";
    empty.append(copy);
    detailPaneEl.replaceChildren(empty);
    return;
  }

  const header = createDetailHeader(script);

  const body = document.createElement("div");
  body.className = "detail-body";

  body.append(createDetailMeta(script));

  if (state.isLoadingDetail) {
    const loading = document.createElement("div");
    loading.className = "detail-loading";
    loading.textContent = "読み込み中...";
    body.append(loading);
    detailPaneEl.replaceChildren(header, body);
    return;
  }

  if (!state.metadataDocument || !state.editorDraft) {
    const message = document.createElement("div");
    message.className = "detail-message is-error";
    message.textContent = state.detailMessage ?? "メタデータを読み込めませんでした。";
    body.append(message, createReloadButton(script.recordKey));
    detailPaneEl.replaceChildren(header, body);
    return;
  }

  if (state.detailMessage) {
    const message = document.createElement("div");
    message.className = `detail-message${state.detailMessage.includes("失敗") ? " is-error" : ""}`;
    message.textContent = state.detailMessage;
    body.append(message);
  }

  const editorSection = document.createElement("div");
  editorSection.className = `editor-section${isEditorLocked() ? " is-locked" : ""}`;
  editorSection.append(createModeSelector());

  const saveButton = document.createElement("button");
  saveButton.className = "action-button detail-save";
  saveButton.type = "button";
  saveButton.textContent = state.isSavingDetail ? "保存中..." : "保存";
  saveButton.addEventListener("click", () => {
    void saveSelectedScript();
  });

  const validation = document.createElement("p");
  validation.className = "detail-validation";

  const form = document.createElement("form");
  form.className = "metadata-form";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSelectedScript();
  });

  const visibleFields = visibleFieldsForMode(state.editorMode);
  for (const field of visibleFields) {
    if (field === "targetApp") {
      form.append(createTargetAppField(field, state.editorDraft.targetApp));
    } else if (field === "description") {
      form.append(createTextAreaField(field, state.editorDraft.description));
    } else {
      form.append(createInputField(field, state.editorDraft[field]));
      if (field === "author") {
        form.append(createEditPasswordSettingField());
      }
    }
  }

  const unknown = createUnknownLinesNotice(state.metadataDocument);

  editorSection.append(
    validation,
    form,
    createPreviewPanel(
      "SCRIPTMETAブロックプレビュー",
      renderMetadataPreview(state.editorDraft, state.metadataDocument.commentStyle),
      "scriptmeta-preview-code",
    ),
  );
  if (state.editorMode === "updateProfile") {
    editorSection.append(
      createPreviewPanel(
        "SCRIPTMETA-DISTブロックプレビュー",
        renderDistributionPreview(state.editorDraft),
        "distribution-preview-code",
        createCopyDistributionButton(),
      ),
    );
  }

  body.append(editorSection);
  if (unknown) {
    body.append(unknown);
  }
  const footer = document.createElement("div");
  footer.className = "detail-footer";
  footer.append(createReloadButton(script.recordKey), saveButton);
  detailPaneEl.replaceChildren(header, body, footer);
  syncEditorControls(saveButton, validation);
}

function createDetailHeader(script: RegisteredScript): HTMLElement {
  const header = document.createElement("div");
  header.className = "detail-header";

  const titleBlock = document.createElement("div");
  titleBlock.className = "detail-title-block";
  const title = document.createElement("h2");
  title.textContent = script.fileName;
  const subtitle = document.createElement("p");
  subtitle.textContent = script.scriptId.trim() || "Script-ID 未設定";
  titleBlock.append(title, subtitle);

  const tools = document.createElement("div");
  tools.className = "detail-header-tools";

  const stateLabel = document.createElement("span");
  stateLabel.className = `detail-state is-${script.scriptmetaEditState}`;
  stateLabel.textContent = editStateLabel(script);
  tools.append(stateLabel);

  const passwordGate = createPasswordGate();
  if (passwordGate) {
    tools.append(passwordGate);
  }

  header.append(titleBlock, tools);
  return header;
}

function storedEditPasswordHash(): string | null {
  const value = state.metadataDocument?.draft.editPasswordSha256 ?? null;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isEditorUnlocked(): boolean {
  const storedValue = storedEditPasswordHash();
  if (!storedValue) {
    return true;
  }
  return Boolean(
    state.selectedRecordKey && state.unlockedRecordKeys.has(state.selectedRecordKey),
  );
}

function isEditorLocked(): boolean {
  return Boolean(storedEditPasswordHash() && !isEditorUnlocked());
}

function createPasswordGate(): HTMLElement | null {
  const storedValue = storedEditPasswordHash();
  if (!storedValue) {
    return null;
  }

  const isUnlocked = isEditorUnlocked();
  const wrapper = document.createElement("div");
  wrapper.className = "password-gate";

  const label = document.createElement("span");
  label.className = "password-label";
  label.textContent = "編集パスワード";

  const row = document.createElement("div");
  row.className = "password-row";

  const input = document.createElement("input");
  input.type = "password";
  input.value = state.passwordInput;
  input.placeholder = isUnlocked ? "解除済み" : "パスワード";
  input.autocomplete = "current-password";
  input.disabled = isUnlocked || state.isVerifyingPassword;
  input.addEventListener("input", () => {
    state.passwordInput = input.value;
    state.passwordMessage = null;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void verifySelectedEditPassword();
    }
  });

  const button = document.createElement("button");
  button.type = "button";
  button.className = "password-button";
  button.textContent = state.isVerifyingPassword ? "確認中" : "解除";
  button.disabled =
    isUnlocked || state.isVerifyingPassword || state.passwordInput.trim().length === 0;
  button.addEventListener("click", () => {
    void verifySelectedEditPassword();
  });

  row.append(input, button);

  const message = document.createElement("small");
  message.textContent = isUnlocked
    ? "編集できます。"
    : state.passwordMessage ?? "入力が通るまで編集欄を無効にします。";

  wrapper.append(label, row, message);
  return wrapper;
}

async function verifySelectedEditPassword(): Promise<void> {
  const storedValue = storedEditPasswordHash();
  const recordKey = state.selectedRecordKey;
  if (!storedValue || !recordKey || state.isVerifyingPassword) {
    return;
  }

  state.isVerifyingPassword = true;
  state.passwordMessage = "確認中です。";
  renderDetailPane();

  try {
    const isVerified = isTauriRuntime()
      ? await invoke<boolean>("verify_edit_password", {
          password: state.passwordInput,
          storedValue,
        })
      : state.passwordInput === "secret";

    if (isVerified) {
      state.unlockedRecordKeys.add(recordKey);
      state.passwordInput = "";
      state.passwordMessage = "解除しました。";
      state.detailMessage = "編集できます。";
    } else {
      state.passwordMessage = "パスワードが違います。";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.passwordMessage = `確認に失敗しました: ${message}`;
  } finally {
    state.isVerifyingPassword = false;
    renderDetailPane();
  }
}

function createPreviewPanel(
  title: string,
  text: string,
  codeClassName: string,
  actionButton?: HTMLButtonElement,
): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "preview-panel";

  const header = document.createElement("div");
  header.className = "preview-header";
  const heading = document.createElement("h3");
  heading.textContent = title;
  header.append(heading);
  if (actionButton) {
    header.append(actionButton);
  }

  const preview = document.createElement("pre");
  preview.className = `metadata-preview ${codeClassName}`;
  preview.textContent = text;
  panel.append(header, preview);
  return panel;
}

function createCopyDistributionButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "subtle-button preview-copy-button";
  button.type = "button";
  button.textContent = "コピー";
  button.addEventListener("click", async () => {
    const text = detailPaneEl?.querySelector<HTMLElement>(".distribution-preview-code")
      ?.textContent;
    if (!text?.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("SCRIPTMETA-DIST ブロックをコピーしました。");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`コピーに失敗しました: ${message}`);
    }
  });
  return button;
}

function createDetailMeta(script: RegisteredScript): HTMLElement {
  const meta = document.createElement("div");
  meta.className = "detail-meta";

  const rows = [
    ["Path", script.filePath],
    ["Version", script.version ?? "未設定"],
    ["Target", script.targetApp ?? "未指定"],
    ["Meta-URL", script.metaUrl ?? "未設定"],
  ] as const;

  for (const [label, value] of rows) {
    const item = document.createElement("div");
    const dt = document.createElement("span");
    dt.textContent = label;
    const dd = document.createElement("strong");
    dd.textContent = value;
    dd.title = value;
    item.append(dt, dd);
    meta.append(item);
  }

  return meta;
}

function createReloadButton(recordKey: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "subtle-button";
  button.type = "button";
  button.textContent = "再読み込み";
  button.disabled = state.isLoadingDetail || state.isSavingDetail;
  button.addEventListener("click", () => {
    void selectScript(recordKey, true);
  });
  return button;
}

function createModeSelector(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "mode-selector";

  const modes: Array<{ mode: EditorMode; label: string }> = [
    { mode: "localSubset", label: "Local Subset" },
    { mode: "updateProfile", label: "Update Profile" },
  ];

  for (const item of modes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mode-button${state.editorMode === item.mode ? " is-selected" : ""}`;
    button.textContent = item.label;
    button.disabled = state.isSavingDetail || isEditorLocked() || modeSelectionDisabled();
    button.addEventListener("click", () => {
      setEditorMode(item.mode);
    });
    wrapper.append(button);
  }

  return wrapper;
}

function modeSelectionDisabled(): boolean {
  const document = state.metadataDocument;
  const hasExistingBlock = selectedDocumentHasExistingBlock();
  if (!document || !hasExistingBlock) {
    return false;
  }
  return editorModeFromDraft(document, document.draft, hasExistingBlock) === "updateProfile";
}

function fieldCaption(field: VisibleDraftField): HTMLElement {
  const caption = document.createElement("span");
  caption.className = "field-caption";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.checkedFields.has(field);
  checkbox.disabled = isCheckDisabled(field) || state.isSavingDetail || isEditorLocked();
  checkbox.addEventListener("change", () => {
    setFieldChecked(field, checkbox.checked);
  });

  const title = document.createElement("strong");
  title.textContent = fieldTitle(field);

  const requirement = document.createElement("em");
  requirement.textContent = fieldRequirement(field, state.editorMode);

  caption.append(checkbox, title, requirement);
  return caption;
}

function createInputField(field: VisibleDraftField, value: string | null): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = `metadata-field field-${field}${fieldRequirementClass(field, value)}`;

  const input = document.createElement("input");
  input.className = "metadata-control";
  input.value = value ?? "";
  input.placeholder = fieldPlaceholder(field);
  input.autocomplete = "off";
  input.spellcheck = false;
  input.disabled = isInputDisabled(field);
  if (field === "releaseDate") {
    input.inputMode = "numeric";
  }
  input.addEventListener("input", () => {
    updateDraftField(field, input.value);
    syncFieldRequirementClass(wrapper, field);
  });

  wrapper.append(fieldCaption(field));
  if (field === "scriptId") {
    const row = document.createElement("div");
    row.className = "script-id-input-row";
    const generateButton = document.createElement("button");
    generateButton.type = "button";
    generateButton.className = "field-mini-button";
    generateButton.textContent = "ID生成";
    generateButton.disabled = state.isSavingDetail || isEditorLocked();
    generateButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      generateScriptId();
    });
    row.append(input, generateButton);
    wrapper.append(row);
  } else {
    wrapper.append(input);
  }
  syncFieldRequirementClass(wrapper, field);
  return wrapper;
}

function createTextAreaField(field: VisibleDraftField, value: string | null): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = `metadata-field field-${field} is-textarea${fieldRequirementClass(field, value)}`;

  const textarea = document.createElement("textarea");
  textarea.className = "metadata-control";
  textarea.value = value ?? "";
  textarea.rows = 5;
  textarea.spellcheck = false;
  textarea.disabled = isInputDisabled(field);
  textarea.addEventListener("input", () => {
    updateDraftField(field, textarea.value);
    syncFieldRequirementClass(wrapper, field);
  });

  wrapper.append(fieldCaption(field), textarea);
  syncFieldRequirementClass(wrapper, field);
  return wrapper;
}

function createTargetAppField(field: VisibleDraftField, value: string | null): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = `metadata-field field-${field}${fieldRequirementClass(field, value)}`;

  const inputRow = document.createElement("div");
  inputRow.className = "target-app-input-row";
  const input = document.createElement("input");
  input.className = "metadata-control";
  input.value = targetAppDraftValue(value) ?? "";
  input.placeholder = "Photoshop / Illustrator / InDesign";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.disabled = isInputDisabled(field);
  input.addEventListener("input", () => {
    updateDraftField(field, input.value);
    syncFieldRequirementClass(wrapper, field);
  });

  const menu = document.createElement("div");
  menu.className = "target-app-menu";
  menu.setAttribute("role", "listbox");
  for (const optionValue of TARGET_APP_OPTIONS) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "target-app-option";
    option.textContent = optionValue;
    option.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    option.addEventListener("click", () => {
      updateDraftField(field, optionValue);
      input.value = optionValue;
      wrapper.classList.remove("is-menu-open");
      syncFieldRequirementClass(wrapper, field);
      const checkbox = wrapper.querySelector<HTMLInputElement>(".field-caption input");
      if (checkbox) {
        checkbox.checked = state.checkedFields.has(field);
      }
    });
    menu.append(option);
  }

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "target-app-menu-button";
  menuButton.setAttribute("aria-label", "Target-App候補");
  menuButton.textContent = "⌄";
  menuButton.disabled = isInputDisabled(field);
  menuButton.addEventListener("click", (event) => {
    event.preventDefault();
    updateTargetAppMenuPlacement(wrapper, inputRow);
    wrapper.classList.toggle("is-menu-open");
  });

  input.addEventListener("focus", () => {
    updateTargetAppMenuPlacement(wrapper, inputRow);
    wrapper.classList.add("is-menu-open");
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => wrapper.classList.remove("is-menu-open"), 120);
  });

  inputRow.append(input, menuButton, menu);
  wrapper.append(fieldCaption(field), inputRow);
  syncFieldRequirementClass(wrapper, field);
  return wrapper;
}

function updateTargetAppMenuPlacement(wrapper: HTMLElement, inputRow: HTMLElement): void {
  const detailBody = wrapper.closest<HTMLElement>(".detail-body");
  const rowRect = inputRow.getBoundingClientRect();
  const containerRect = detailBody?.getBoundingClientRect() ?? {
    top: 0,
    bottom: window.innerHeight,
  };
  const menuHeight = 102;
  const spaceAbove = rowRect.top - containerRect.top;
  const spaceBelow = containerRect.bottom - rowRect.bottom;
  wrapper.classList.toggle(
    "is-menu-above",
    spaceBelow < menuHeight && spaceAbove > spaceBelow,
  );
}

function syncPasswordSettingControls(): void {
  const wrapper =
    detailPaneEl?.querySelector<HTMLElement>(".password-setting-field") ?? null;
  if (!wrapper) {
    return;
  }

  const setButton =
    wrapper.querySelector<HTMLButtonElement>(".password-setting-apply-button") ?? null;
  if (setButton) {
    setButton.disabled = !canApplyEditPasswordSetting();
  }

  const message = wrapper.querySelector<HTMLElement>(".password-setting-message") ?? null;
  if (message && !state.passwordSettingMessage) {
    message.textContent = defaultPasswordSettingMessage();
  }
}

function createEditPasswordSettingField(): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "metadata-field field-editPasswordSha256 password-setting-field";

  const caption = document.createElement("span");
  caption.className = "field-caption password-setting-caption";
  const title = document.createElement("strong");
  title.textContent = fieldTitle("editPasswordSha256");
  const requirement = document.createElement("em");
  requirement.textContent = "任意";
  caption.append(title, requirement);

  const row = document.createElement("div");
  row.className = "password-setting-row";

  const status = document.createElement("span");
  status.className = `password-setting-status${hasConfiguredEditPassword() ? " is-set" : ""}`;
  status.textContent = hasConfiguredEditPassword() ? "設定済み" : "未設定";

  const input = document.createElement("input");
  input.type = "password";
  input.value = state.passwordSettingInput;
  input.placeholder = "新しい編集パスワード";
  input.autocomplete = "new-password";
  input.disabled = state.isSavingDetail || state.isGeneratingEditPassword || isEditorLocked();
  input.addEventListener("input", () => {
    state.passwordSettingInput = input.value;
    state.passwordSettingMessage = null;
    syncPasswordSettingControls();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void applyEditPasswordSetting();
    }
  });

  const setButton = document.createElement("button");
  setButton.type = "button";
  setButton.className = "field-mini-button password-setting-apply-button";
  setButton.textContent = hasConfiguredEditPassword() ? "変更" : "設定";
  setButton.disabled = !canApplyEditPasswordSetting();
  setButton.addEventListener("click", () => {
    void applyEditPasswordSetting();
  });

  row.append(status, input, setButton);

  if (hasConfiguredEditPassword()) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "field-mini-button password-remove-button";
    removeButton.textContent = "削除";
    removeButton.disabled = state.isSavingDetail || state.isGeneratingEditPassword || isEditorLocked();
    removeButton.addEventListener("click", () => {
      removeEditPasswordSetting();
    });
    row.append(removeButton);
  }

  const message = document.createElement("small");
  message.className = "password-setting-message";
  message.textContent = state.passwordSettingMessage ?? defaultPasswordSettingMessage();

  wrapper.append(caption, row, message);
  return wrapper;
}

async function applyEditPasswordSetting(): Promise<void> {
  const password = state.passwordSettingInput.trim();
  if (!state.editorDraft || !password || state.isGeneratingEditPassword) {
    return;
  }
  state.isGeneratingEditPassword = true;
  state.passwordSettingMessage = "生成中です。";
  renderDetailPane();

  try {
    const hashed = isTauriRuntime()
      ? await invoke<string>("generate_edit_password", { password })
      : await generatePreviewEditPasswordHash(password);
    state.editorDraft.editPasswordSha256 = hashed;
    state.passwordSettingInput = "";
    state.passwordSettingMessage = "編集パスワードを設定しました。";
    syncCheckedFieldAfterInput("editPasswordSha256");
    state.editorDirty = true;
    state.detailMessage = "未保存の変更があります。";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.passwordSettingMessage = `設定に失敗しました: ${message}`;
  } finally {
    state.isGeneratingEditPassword = false;
    renderDetailPane();
  }
}

async function generatePreviewEditPasswordHash(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`preview:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `preview:${hex}`;
}

function removeEditPasswordSetting(): void {
  if (!state.editorDraft) {
    return;
  }
  state.editorDraft.editPasswordSha256 = null;
  state.passwordSettingInput = "";
  state.passwordSettingMessage = "保存時に編集パスワードを削除します。";
  syncCheckedFieldAfterInput("editPasswordSha256");
  state.editorDirty = true;
  state.detailMessage = "未保存の変更があります。";
  renderDetailPane();
}

function updateDraftField(field: DraftField, rawValue: string): void {
  if (!state.editorDraft) {
    return;
  }

  if (field === "scriptId") {
    state.editorDraft.scriptId = rawValue;
  } else {
    state.editorDraft[field] = rawValue.length > 0 ? rawValue : null;
  }
  syncCheckedFieldAfterInput(field);
  state.editorDirty = true;
  state.detailMessage = "未保存の変更があります。";

  const saveButton = detailPaneEl?.querySelector<HTMLButtonElement>(".detail-save") ?? null;
  const validation = detailPaneEl?.querySelector<HTMLElement>(".detail-validation") ?? null;
  if (saveButton && validation) {
    syncEditorControls(saveButton, validation);
  }
}

function setEditorMode(mode: EditorMode): void {
  if (state.editorMode === mode) {
    return;
  }

  state.editorMode = mode;
  state.editorDirty = true;
  state.detailMessage = "未保存の変更があります。";

  if (mode === "updateProfile") {
    state.checkedFields.add("version");
    state.checkedFields.add("metaUrl");
  } else {
    state.checkedFields.delete("minTargetVersion");
    state.checkedFields.delete("metaUrl");
  }

  renderDetailPane();
}

function isCheckDisabled(field: VisibleDraftField): boolean {
  return fieldRequirement(field, state.editorMode) === "必須";
}

function isInputDisabled(field: VisibleDraftField): boolean {
  void field;
  return state.isSavingDetail || isEditorLocked();
}

function setFieldChecked(field: DraftField, checked: boolean): void {
  if (checked) {
    state.checkedFields.add(field);
  } else {
    state.checkedFields.delete(field);
  }
  state.editorDirty = true;
  state.detailMessage = "未保存の変更があります。";
  renderDetailPane();
}

function syncCheckedFieldAfterInput(field: DraftField): void {
  if (field === "editPasswordSha256") {
    const author = normalizedFieldValue(state.editorDraft?.author ?? null, "author");
    if (hasConfiguredEditPassword() || author.length > 0) {
      state.checkedFields.add("author");
    } else {
      state.checkedFields.delete("author");
    }
    return;
  }

  if (!visibleFieldsForMode(state.editorMode).includes(field as VisibleDraftField)) {
    return;
  }

  const visibleField = field as VisibleDraftField;
  if (fieldRequirement(visibleField, state.editorMode) === "必須") {
    state.checkedFields.add(visibleField);
    return;
  }

  const current = normalizedFieldValue(state.editorDraft?.[field] ?? null, field);
  if (current.length > 0) {
    state.checkedFields.add(visibleField);
  } else {
    state.checkedFields.delete(visibleField);
  }
}

function syncEditorControls(
  saveButton: HTMLButtonElement,
  validation: HTMLElement,
): void {
  const script = selectedScript();
  const canWrite =
    script?.scriptmetaEditState === "editable" || script?.scriptmetaEditState === "appendable";
  const errors = validationMessages();
  const validationText = isEditorLocked()
    ? "編集パスワードを入力してください。"
    : !canWrite
    ? "このファイルは読み取り専用、または編集対象外です。"
    : errors[0] ??
      (selectedDocumentHasExistingBlock()
        ? "既存の SCRIPTMETA ブロックを更新します。"
        : "SCRIPTMETA ブロックを新規追加します。");

  validation.textContent = validationText;
  validation.classList.toggle("is-error", errors.length > 0 || !canWrite || isEditorLocked());
  saveButton.disabled =
    isEditorLocked() ||
    !canWrite ||
    errors.length > 0 ||
    state.isSavingDetail ||
    !hasUserChanges();
  if (state.editorDraft && state.metadataDocument) {
    const effectiveDraft = effectiveDraftForSave();
    const previewDraft = effectiveDraft;
    const scriptmetaPreview =
      detailPaneEl?.querySelector<HTMLElement>(".scriptmeta-preview-code") ?? null;
    const distributionPreview =
      detailPaneEl?.querySelector<HTMLElement>(".distribution-preview-code") ?? null;
    if (scriptmetaPreview) {
      scriptmetaPreview.textContent = renderMetadataPreview(
        previewDraft,
        state.metadataDocument.commentStyle,
      );
    }
    if (distributionPreview) {
      distributionPreview.textContent = renderDistributionPreview(previewDraft);
    }
    const copyButton =
      detailPaneEl?.querySelector<HTMLButtonElement>(".preview-copy-button") ?? null;
    if (copyButton) {
      copyButton.disabled = isEditorLocked() || !canCopyDistributionPreview(effectiveDraft);
    }
  }
}

function optionalNormalizedDraftValue(
  value: string | null | undefined,
  field: DraftField,
): string | null {
  const normalized = normalizedFieldValue(value, field);
  return normalized.length > 0 ? normalized : null;
}

function hasUserChanges(): boolean {
  if (!state.metadataDocument) {
    return false;
  }
  if (!selectedDocumentHasExistingBlock() && state.checkedFields.size > 0) {
    return true;
  }
  return state.editorDirty;
}

function validationMessages(): string[] {
  const draft = effectiveDraftForSave();
  const messages: string[] = [];
  const scriptId = normalizedFieldValue(draft.scriptId, "scriptId");
  if (!scriptId) {
    messages.push("保存には Script-ID が必要です。");
  } else if (!/^[A-Za-z0-9._-]+$/.test(scriptId)) {
    messages.push("Script-ID は英数字、ドット、アンダースコア、ハイフンだけで入力してください。");
  }

  const version = normalizedFieldValue(draft.version, "version");
  if (state.editorMode === "updateProfile" && !version) {
    messages.push("Update Profile では Version が必要です。");
  } else if (version && !isValidVersionLikeScripta(version)) {
    messages.push("Version の形式が不正です。");
  }

  const metaUrl = normalizedFieldValue(draft.metaUrl, "metaUrl");
  if (state.editorMode === "updateProfile" && !metaUrl) {
    messages.push("Update Profile では Meta-URL が必要です。");
  } else if (metaUrl) {
    const error = metaUrlValidationError(metaUrl);
    if (error) {
      messages.push(error);
    }
  }

  const editPasswordHash = draft.editPasswordSha256?.trim();
  if (editPasswordHash && !isValidEditPasswordHash(editPasswordHash)) {
    messages.push("Edit-Password-SHA256 の形式が不正です。");
  }
  if (editPasswordHash && !draft.author?.trim()) {
    messages.push("Edit-Password-SHA256 がある場合は Author が必要です。");
  }

  return messages;
}

function isValidEditPasswordHash(value: string): boolean {
  const [salt, digest, ...rest] = value.trim().split(":");
  return Boolean(
    salt &&
      digest &&
      rest.length === 0 &&
      digest.length === 64 &&
      /^[0-9a-fA-F]+$/.test(digest),
  );
}

function isValidVersionLikeScripta(value: string): boolean {
  return /^[0-9]+(?:[._-][A-Za-z0-9]+)*$/.test(value.trim());
}

function metaUrlValidationError(value: string): string | null {
  const normalized = normalizedUrl(value);
  if (!normalized) {
    return "Meta-URL の形式が不正です。";
  }
  const path = normalized.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  if (DISALLOWED_META_URL_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
    return "Meta-URL にはスクリプトや zip への直リンクではなく、SCRIPTMETA 情報ページを指定してください。";
  }
  return null;
}

function normalizedUrl(value: string): URL | null {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) {
    return null;
  }

  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const url = new URL(candidate);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) {
        return url;
      }
    } catch {
      // Try the next candidate.
    }
    if (trimmed.includes("://")) {
      break;
    }
  }
  return null;
}

function effectiveDraftForSave(): EditableScriptMetadataDraft {
  const draft = emptyDraft();
  const values = state.editorDraft ?? emptyDraft();

  for (const field of visibleFieldsForMode(state.editorMode)) {
    if (!state.checkedFields.has(field)) {
      continue;
    }
    if (field === "scriptId") {
      draft.scriptId = normalizedFieldValue(values.scriptId, field);
    } else {
      const normalized = normalizedFieldValue(values[field], field);
      draft[field] = normalized.length > 0 ? normalized : null;
    }
  }

  if (state.editorMode === "localSubset") {
    draft.minTargetVersion = null;
    draft.metaUrl = null;
  }
  draft.editPasswordSha256 = optionalNormalizedDraftValue(
    values.editPasswordSha256,
    "editPasswordSha256",
  );

  return normalizeEditorDraft(draft);
}

function emptyDraft(): EditableScriptMetadataDraft {
  return {
    scriptId: "",
    version: null,
    description: null,
    targetApp: null,
    minTargetVersion: null,
    metaUrl: null,
    name: null,
    author: null,
    releaseDate: null,
    editPasswordSha256: null,
  };
}

function generateScriptId(): void {
  if (!state.editorDraft) {
    return;
  }

  const script = selectedScript();
  const baseName = script?.fileName.replace(/\.[^.]+$/, "") ?? "script";
  const component = sanitizedIdComponent(baseName) || "script";
  const suffix = Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join("");
  updateDraftField("scriptId", `local.user.${component}_${suffix}`);
  renderDetailPane();
}

function sanitizedIdComponent(value: string): string {
  return value
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "");
}

function createUnknownLinesNotice(editDocument: ScriptMetadataEditDocument): HTMLElement | null {
  if (editDocument.unknownLines.length === 0) {
    return null;
  }

  const notice = document.createElement("div");
  notice.className = "unknown-lines";
  const title = document.createElement("strong");
  title.textContent = "未解釈の行";
  const body = document.createElement("pre");
  body.textContent = editDocument.unknownLines.join("\n");
  notice.append(title, body);
  return notice;
}

function editStateLabel(script: RegisteredScript): string {
  if (script.scriptmetaEditState === "editable") {
    return script.hasScriptmeta ? "編集" : "追加";
  }
  if (script.scriptmetaEditState === "appendable") {
    return "追加";
  }
  if (script.scriptmetaEditState === "read_only") {
    return "読取専用";
  }
  if (script.scriptmetaEditState === "obfuscated") {
    return "保護";
  }
  return "確認";
}

function renderMetadataPreview(
  draft: EditableScriptMetadataDraft,
  commentStyle: string,
): string {
  const lines: string[] = ["SCRIPTMETA-BEGIN"];
  addPreviewField(lines, "Script-ID", draft.scriptId);
  addPreviewField(lines, "Version", draft.version);
  addPreviewField(lines, "Meta-URL", draft.metaUrl);
  addPreviewField(lines, "Name", draft.name);
  addPreviewField(lines, "Author", draft.author);
  addPreviewField(lines, "Release-Date", draft.releaseDate);
  addPreviewField(lines, "Target-App", draft.targetApp);
  addPreviewField(lines, "Min-Target-Version", draft.minTargetVersion);
  addPreviewField(lines, "Edit-Password-SHA256", draft.editPasswordSha256);
  const description = draft.description?.trim();
  if (description) {
    if (description.includes("\n")) {
      lines.push("Description-BEGIN", ...description.split(/\r?\n/), "Description-END");
    } else {
      addPreviewField(lines, "Description", description);
    }
  }
  lines.push("SCRIPTMETA-END");
  const block = lines.join("\n");

  if (commentStyle === "apple_script_block") {
    return `(*\n${block}\n*)`;
  }
  if (commentStyle === "plain_text") {
    return block;
  }
  return `/*\n${block}\n*/`;
}

function renderDistributionPreview(draft: EditableScriptMetadataDraft): string {
  const lines = ["SCRIPTMETA-DIST-BEGIN"];
  lines.push(`Script-ID=${normalizedFieldValue(draft.scriptId, "scriptId")}`);
  lines.push(`Version=${normalizedFieldValue(draft.version, "version")}`);
  lines.push("SCRIPTMETA-DIST-END");
  return lines.join("\n");
}

function canCopyDistributionPreview(draft: EditableScriptMetadataDraft): boolean {
  return Boolean(
    normalizedFieldValue(draft.scriptId, "scriptId") &&
      normalizedFieldValue(draft.version, "version"),
  );
}

function addPreviewField(lines: string[], key: string, value: string | null): void {
  const trimmed = value?.trim();
  if (trimmed) {
    lines.push(`${key}=${trimmed}`);
  }
}

function normalizeEditorDraft(
  draft: EditableScriptMetadataDraft,
): EditableScriptMetadataDraft {
  return {
    ...draft,
    targetApp: targetAppDraftValue(draft.targetApp),
  };
}

function editorDraftForDocument(
  document: ScriptMetadataEditDocument,
  script: RegisteredScript,
  hasExistingBlock = document.hasExistingBlock,
): EditableScriptMetadataDraft {
  const draft = normalizeEditorDraft({ ...document.draft });
  if (!hasExistingBlock) {
    draft.name = null;
    draft.targetApp = targetAppDraftValue(script.targetApp);
    draft.scriptId = "";
  }
  return draft;
}

function initialCheckedFields(
  document: ScriptMetadataEditDocument,
  draft: EditableScriptMetadataDraft,
  hasExistingBlock = document.hasExistingBlock,
): Set<DraftField> {
  const fields = new Set<DraftField>();
  const mode = editorModeFromDraft(document, draft, hasExistingBlock);
  for (const field of visibleFieldsForMode(mode)) {
    if (
      fieldRequirementForDraft(field, mode, draft) === "必須" ||
      normalizedFieldValue(draft[field], field)
    ) {
      fields.add(field);
    }
  }
  return fields;
}

function draftFromRecord(script: RegisteredScript): EditableScriptMetadataDraft {
  return {
    scriptId: script.scriptId,
    version: script.version,
    description: script.descriptionText,
    targetApp: targetAppDraftValue(script.targetApp),
    minTargetVersion: null,
    metaUrl: script.metaUrl,
    name: null,
    author: null,
    releaseDate: null,
    editPasswordSha256: null,
  };
}

function browserDocumentFromRecord(script: RegisteredScript): ScriptMetadataEditDocument {
  return {
    filePath: script.filePath,
    draft: draftFromRecord(script),
    commentStyle: "java_script_block",
    lineEnding: "\n",
    hasExistingBlock: script.hasScriptmeta,
    unknownLines: [],
    existingBlockText: null,
    sourceFingerprint: `browser:${script.recordKey}`,
  };
}

async function selectScript(recordKey: string, forceReload = false): Promise<void> {
  if (state.selectedRecordKey === recordKey && state.metadataDocument && !forceReload) {
    return;
  }

  state.selectedRecordKey = recordKey;
  state.metadataDocument = null;
  state.editorDraft = null;
  state.editorMode = "localSubset";
  state.checkedFields.clear();
  state.passwordInput = "";
  state.passwordMessage = null;
  state.passwordSettingInput = "";
  state.passwordSettingMessage = null;
  state.isGeneratingEditPassword = false;
  state.isVerifyingPassword = false;
  state.editorDirty = false;
  state.isLoadingDetail = true;
  state.detailMessage = null;
  render();

  const script = state.records.get(recordKey);
  if (!script) {
    clearDetailSelection();
    render();
    return;
  }

  try {
    const document = isTauriRuntime()
      ? await invoke<ScriptMetadataEditDocument>("load_script_metadata_document", {
          filePath: script.filePath,
        })
      : browserDocumentFromRecord(script);

    if (state.selectedRecordKey !== recordKey) {
      return;
    }

    state.metadataDocument = document;
    const hasExistingBlock = documentHasExistingBlockForScript(document, script);
    state.editorDraft = editorDraftForDocument(document, script, hasExistingBlock);
    state.editorMode = editorModeFromDraft(document, state.editorDraft, hasExistingBlock);
    state.checkedFields = initialCheckedFields(document, state.editorDraft, hasExistingBlock);
    state.editorDirty = !hasExistingBlock && state.checkedFields.size > 0;
    state.isLoadingDetail = false;
    state.detailMessage = hasExistingBlock
      ? "SCRIPTMETA を読み込みました。"
      : "SCRIPTMETA を追加できます。";
  } catch (error) {
    if (state.selectedRecordKey !== recordKey) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    state.metadataDocument = null;
    state.editorDraft = null;
    state.isLoadingDetail = false;
    state.detailMessage = `読み込みに失敗しました: ${message}`;
  }

  render();
}

async function saveSelectedScript(): Promise<void> {
  const script = selectedScript();
  if (
    !script ||
    !state.metadataDocument ||
    !state.editorDraft ||
    state.isSavingDetail ||
    isEditorLocked()
  ) {
    return;
  }

  state.isSavingDetail = true;
  state.detailMessage = "保存中です。";
  renderDetailPane();
  const effectiveDraft = effectiveDraftForSave();

  try {
    const result = isTauriRuntime()
      ? await invoke<ScriptMetadataSaveResult>("save_script_metadata_document", {
          request: {
            filePath: state.metadataDocument.filePath,
            draft: effectiveDraft,
            mode: state.editorMode,
            checkedFields: [...state.checkedFields],
            sourceFingerprint: state.metadataDocument.sourceFingerprint,
          },
        })
      : {
          filePath: script.filePath,
          operation: script.hasScriptmeta ? "replaced" : "inserted",
          backupFilePath: null,
          document: {
            ...state.metadataDocument,
            draft: effectiveDraft,
            hasExistingBlock: true,
            sourceFingerprint: `browser:${Date.now()}`,
          },
        };

    state.metadataDocument = result.document;
    state.editorDraft = normalizeEditorDraft(result.document.draft);
    state.editorMode = editorModeFromDraft(result.document, state.editorDraft);
    state.checkedFields = initialCheckedFields(result.document, state.editorDraft);
    state.editorDirty = false;
    state.detailMessage =
      result.operation === "inserted" ? "SCRIPTMETA を追加しました。" : "SCRIPTMETA を保存しました。";

    if (isTauriRuntime()) {
      await reloadSavedStateIntoState();
    } else {
      state.records.set(script.recordKey, {
        ...script,
        scriptId: result.document.draft.scriptId,
        version: result.document.draft.version,
        targetApp: result.document.draft.targetApp,
        descriptionText: result.document.draft.description,
        metaUrl: result.document.draft.metaUrl,
        hasScriptmeta: true,
        canEditScriptmeta: true,
        canAppendScriptmeta: false,
        scriptmetaEditState: "editable",
      });
    }

    const refreshed = [...state.records.values()].find(
      (record) => record.filePath === result.document.filePath,
    );
    state.selectedRecordKey = refreshed?.recordKey ?? script.recordKey;
    if (result.document.draft.editPasswordSha256?.trim() && state.selectedRecordKey) {
      state.unlockedRecordKeys.add(state.selectedRecordKey);
    }
    setStatus(state.detailMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.detailMessage = `保存に失敗しました: ${message}`;
    setStatus(state.detailMessage);
  } finally {
    state.isSavingDetail = false;
    render();
  }
}

function render(): void {
  ensureSelectionsAreAvailable();
  renderHeroCopy();
  renderFolders();
  renderTargets();
  renderSummary();
  renderRefreshButton();
  renderUpdateButton();
  renderClearButton();
  renderAddFolderButton();
  renderProgressBar();
  renderScripts();
  renderDetailPane();
}

function applyPersistedState(persisted: PersistedRecords): void {
  state.folders = persisted.folders;
  state.records = new Map(
    persisted.records.map((record) => [record.recordKey, record] as const),
  );
  state.warnings = persisted.warnings;
  state.scannedFiles = persisted.scannedFiles;
  state.skippedFiles = persisted.skippedCount;
}

async function saveRegisteredFolders(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await invoke("save_registered_folders", {
      folders: state.folders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`保存に失敗しました: ${message}`);
  }
}

async function loadSavedFolders(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const persisted = await invoke<PersistedRecords>("load_saved_records");
    applyPersistedState(persisted);

    if (persisted.folders.length > 0) {
      if (persisted.records.length > 0) {
        setStatus(
          `${persisted.folders.length} 件の登録フォルダから ${persisted.records.length} 件の script を読み込みました。`,
        );
      } else {
        setStatus(
          `${persisted.folders.length} 件の登録フォルダを確認しました。script は見つかりませんでした。`,
        );
      }
    }

    render();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`保存済みデータの読み込みに失敗しました: ${message}`);
  }
}

async function reloadSavedStateIntoState(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const persisted = await invoke<PersistedRecords>("load_saved_records");
  applyPersistedState(persisted);
}

async function reloadRegisteredFolders(): Promise<void> {
  if (state.folders.length === 0 || state.isResolving) {
    return;
  }

  if (!isTauriRuntime()) {
    setStatus("リストを再読み込みしました。");
    return;
  }

  state.isResolving = true;
  setStatus("登録フォルダを確認しています...");
  render();

  try {
    await reloadSavedStateIntoState();
    setStatus("リストを再読み込みしました。");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`リストの再読み込みに失敗しました: ${message}`);
  } finally {
    state.isResolving = false;
    render();
  }
}

async function checkRegisteredUpdates(): Promise<void> {
  if (state.isResolving || state.isCheckingUpdates) {
    return;
  }

  const checkableRecords = [...state.records.values()].filter(isCheckable);
  if (checkableRecords.length === 0) {
    setStatus("更新チェックできる script がありません。");
    return;
  }

  state.isCheckingUpdates = true;
  setStatus("更新情報を確認しています...");
  render();

  try {
    const resolutions = isTauriRuntime()
      ? await invoke<DistributionResolution[]>("resolve_registered_scripts", {
          records: checkableRecords,
        })
      : checkableRecords.map((record) => ({
          scriptId: record.scriptId,
          resolvedVersion: record.resolvedVersion ?? record.version,
          latestPageUrl: record.latestPageUrl,
          resolvedMetaPageUrl: record.resolvedMetaPageUrl ?? record.metaUrl ?? "",
          distributionNote: record.distributionNote,
          isUnresolved: false,
          redirectCount: record.redirectCount,
        }));

    applyDistributionResolutions(resolutions);
    setStatus(`${resolutions.length} 件の更新チェックが完了しました。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`更新チェックに失敗しました: ${message}`);
  } finally {
    state.isCheckingUpdates = false;
    render();
  }
}

function applyDistributionResolutions(resolutions: DistributionResolution[]): void {
  const resolutionsByScriptId = new Map(
    resolutions.map((resolution) => [resolution.scriptId, resolution] as const),
  );

  for (const [recordKey, record] of state.records.entries()) {
    const resolution = resolutionsByScriptId.get(record.scriptId);
    if (!resolution) {
      continue;
    }
    state.records.set(recordKey, {
      ...record,
      resolvedVersion: resolution.resolvedVersion,
      latestPageUrl: resolution.latestPageUrl,
      resolvedMetaPageUrl: resolution.resolvedMetaPageUrl,
      distributionNote: resolution.distributionNote,
      isUnresolved: resolution.isUnresolved,
      redirectCount: resolution.redirectCount,
    });
  }
}

async function importDroppedFolders(paths: string[]): Promise<void> {
  if (paths.length === 0 || state.isResolving) {
    return;
  }

  if (!isTauriRuntime()) {
    setStatus("ブラウザプレビューではフォルダ追加は実行できません。");
    return;
  }

  state.isResolving = true;
  setStatus("登録フォルダを確認しています...");
  render();

  try {
    const result = await invoke<ImportSummary>("register_dropped_paths", {
      paths,
      existingFolders: state.folders,
    });
    state.folders = result.folders;
    state.records = new Map(
      result.records.map((record) => [record.recordKey, record] as const),
    );
    state.scannedFiles = result.scannedFiles;
    state.skippedFiles = result.skippedCount;
    state.warnings = result.warnings;
    clearDetailSelection();

    if (result.folders.length === 0) {
      setStatus("登録フォルダがありません。フォルダをドロップしてください。");
    } else if (result.registeredCount > 0) {
      setStatus(
        `${result.folders.length} 件のフォルダから ${result.registeredCount} 件登録しました。`,
      );
    } else {
      setStatus("登録フォルダを確認しました。編集できる script は見つかりませんでした。");
    }

    await saveRegisteredFolders();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`登録に失敗しました: ${message}`);
  } finally {
    state.isResolving = false;
    render();
  }
}

async function addFolderFromDialog(): Promise<void> {
  if (state.isResolving || state.isCheckingUpdates) {
    return;
  }

  if (!isTauriRuntime()) {
    setStatus("ブラウザプレビューではフォルダダイアログを開けません。");
    return;
  }

  try {
    const folder = await invoke<string | null>("pick_folder");
    if (!folder) {
      return;
    }
    await importDroppedFolders([folder]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`フォルダを追加できませんでした: ${message}`);
  }
}

async function bindDragDrop(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  const unlisten = await getCurrentWindow().onDragDropEvent((event) => {
    const { payload } = event;

    if (payload.type === "enter" || payload.type === "over") {
      setDropActive(true);
      return;
    }

    if (payload.type === "leave") {
      setDropActive(false);
      return;
    }

    setDropActive(false);
    void importDroppedFolders(payload.paths);
  });

  window.addEventListener("beforeunload", () => {
    void unlisten();
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  statusMessageEl = document.querySelector("#status-message");
  heroCopyEl = document.querySelector("#hero-copy");
  summaryChipsEl = document.querySelector("#summary-chips");
  scriptListEl = document.querySelector("#script-list");
  emptyStateEl = document.querySelector("#empty-state");
  refreshButtonEl = document.querySelector("#refresh-button");
  updateButtonEl = document.querySelector("#update-button");
  clearButtonEl = document.querySelector("#clear-button");
  heroProgressEl = document.querySelector("#hero-progress");
  folderListEl = document.querySelector("#folder-list");
  folderCountEl = document.querySelector("#folder-count");
  addFolderButtonEl = document.querySelector("#add-folder-button");
  targetListEl = document.querySelector("#target-list");
  targetCountEl = document.querySelector("#target-count");
  detailPaneEl = document.querySelector("#detail-pane");

  refreshButtonEl?.addEventListener("click", () => {
    void reloadRegisteredFolders();
  });
  updateButtonEl?.addEventListener("click", () => {
    void checkRegisteredUpdates();
  });
  addFolderButtonEl?.addEventListener("click", () => {
    void addFolderFromDialog();
  });
  clearButtonEl?.addEventListener("click", async () => {
    state.folders = [];
    state.records.clear();
    state.scannedFiles = 0;
    state.skippedFiles = 0;
    state.warnings = [];
    state.selectedTargetKey = null;
    state.unlockedRecordKeys.clear();
    clearDetailSelection();
    setStatus("登録フォルダ情報をクリアしました。");
    render();
    await saveRegisteredFolders();
  });

  render();
  if (isTauriRuntime()) {
    await loadSavedFolders();
    await bindDragDrop();
  } else {
    applyBrowserPreviewState();
    render();
  }
});
