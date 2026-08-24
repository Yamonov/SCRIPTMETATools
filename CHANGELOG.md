# Changelog

## SCRIPTMETA Tools 1.0.0

### SCRIPTMETAKitMini 1.1.0

- Renames the displayed product from SCRIPTMETAKitApp to SCRIPTMETAKitMini while preserving the
  existing bundle identifier for upgrade compatibility.
- Updates the shared engine from SCRIPTMETAKit 1.0.8 to 1.2.2.
- Updates Tauri, Vite, TypeScript, and frontend dependencies and resolves all npm audit findings.
- Publishes a signed and notarized macOS universal DMG and an unsigned Windows x64 portable zip.
- Includes MIT, SCRIPTMETAKit, and third-party dependency notices in release packages.

### scriptmeta CLI 0.1.0

- Adds directory update checks, offline scans, file inspection, metadata validation, format
  discovery, and shell completion generation.
- Adds human, JSON, and JSONL output, stable exit codes, bounded update checks, and Ctrl+C
  cancellation.
- Publishes a signed/notarized macOS universal zip and an unsigned Windows x64 zip.
