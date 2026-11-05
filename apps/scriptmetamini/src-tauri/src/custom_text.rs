use std::collections::BTreeMap;

use scriptmetakit::{ScriptMetaCommentStyle, ScriptMetadataDraft};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTextIssue {
    pub line: usize,
    pub message: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTextValidation {
    pub fields: BTreeMap<String, Vec<String>>,
    pub issues: Vec<CustomTextIssue>,
}

pub fn comment_style(label: &str) -> Result<ScriptMetaCommentStyle, String> {
    match label {
        "java_script_block" => Ok(ScriptMetaCommentStyle::JavaScriptBlock),
        "apple_script_block" => Ok(ScriptMetaCommentStyle::AppleScriptBlock),
        "plain_text" => Ok(ScriptMetaCommentStyle::PlainText),
        _ => Err("メタデータのコメント形式を確認できません。".into()),
    }
}

pub fn parse_custom_metadata_text(
    text: &str,
    original: &BTreeMap<String, Vec<String>>,
    style: ScriptMetaCommentStyle,
) -> CustomTextValidation {
    let mut result = CustomTextValidation::default();
    let mut entries = Vec::new();
    for (index, raw) in text.lines().enumerate() {
        if raw.trim().is_empty() {
            continue;
        }
        let line = index + 1;
        let Some((key, value)) = raw.split_once('=') else {
            result.issues.push(CustomTextIssue {
                line,
                message: "「X-作成者ID-項目名=値」の形式で入力してください。".into(),
            });
            continue;
        };
        let key = match scriptmetakit::normalize_custom_metadata_key(key.trim()) {
            Ok(key) => key,
            Err(_) => {
                result.issues.push(CustomTextIssue {
                    line,
                    message: "キーは「X-作成者ID-項目名」の形式で入力してください。".into(),
                });
                continue;
            }
        };
        let value = value.trim();
        result
            .fields
            .entry(key.clone())
            .or_default()
            .push(value.into());
        entries.push((line, key, value));
    }

    for (line, key, value) in entries {
        // The Kit preserves unchanged legacy-invalid values. Check the whole key's
        // value list so adding/removing a duplicate still validates every new value.
        if result.fields.get(&key) == original.get(&key) {
            continue;
        }
        if let Some(issue) = scriptmetakit::validate_custom_metadata_field(&key, value).first() {
            let message = match issue.code.as_str() {
                "custom_metadata_reserved_marker" => {
                    "ブロックの開始・終了を表す予約文字列は使えません。"
                }
                "custom_metadata_legacy_field" => {
                    "旧形式のメタデータ項目と誤認される記述が含まれています。"
                }
                "custom_metadata_line_break" => "値は1行で入力してください。",
                _ => "拡張キーまたは値の形式が不正です。",
            };
            result.issues.push(CustomTextIssue {
                line,
                message: message.into(),
            });
            continue;
        }
        let mut draft = ScriptMetadataDraft {
            script_id: "local.validation.custom".into(),
            ..Default::default()
        };
        draft.custom_fields.insert(key, vec![value.into()]);
        if scriptmetakit::render_script_metadata_for_style(&draft, style).is_err() {
            result.issues.push(CustomTextIssue {
                line,
                message: "保存先のコメントを終了・開始する文字列が含まれています。".into(),
            });
        }
    }
    result.issues.sort_by_key(|issue| issue.line);
    result
}

#[tauri::command]
pub fn validate_custom_metadata_text(
    text: String,
    original_custom_fields: BTreeMap<String, Vec<String>>,
    style: String,
) -> Result<CustomTextValidation, String> {
    Ok(parse_custom_metadata_text(
        &text,
        &original_custom_fields,
        comment_style(&style)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_empty_values_duplicates_and_equals_in_urls() {
        let result = parse_custom_metadata_text(
            "X-iw-Note=\r\n\r\nX-iw-URL=https://example.com/?a=1&b=2\r\nX-iw-Note=second\r\n",
            &BTreeMap::new(),
            ScriptMetaCommentStyle::JavaScriptBlock,
        );
        assert!(result.issues.is_empty());
        assert_eq!(result.fields["X-iw-note"], vec!["", "second"]);
        assert_eq!(
            result.fields["X-iw-url"],
            vec!["https://example.com/?a=1&b=2"]
        );
    }

    #[test]
    fn reports_all_bad_line_numbers_without_rewriting_input() {
        let result = parse_custom_metadata_text(
            "X-iw-Good=valid\n\nunfinished\nName=wrong\nX-iw-Note=bad Name=oops\nX-iw-End=*/\nX-iw-Marker=SCRIPTMETA-END",
            &BTreeMap::new(),
            ScriptMetaCommentStyle::JavaScriptBlock,
        );
        assert_eq!(
            result
                .issues
                .iter()
                .map(|issue| issue.line)
                .collect::<Vec<_>>(),
            vec![3, 4, 5, 6, 7]
        );
        assert_eq!(result.fields["X-iw-good"], vec!["valid"]);
    }

    #[test]
    fn applies_the_destination_comment_rules() {
        let text = "X-iw-Note=(*\nX-iw-End=*)";
        let js = parse_custom_metadata_text(
            text,
            &BTreeMap::new(),
            ScriptMetaCommentStyle::JavaScriptBlock,
        );
        let apple = parse_custom_metadata_text(
            text,
            &BTreeMap::new(),
            ScriptMetaCommentStyle::AppleScriptBlock,
        );
        assert!(js.issues.is_empty());
        assert_eq!(
            apple
                .issues
                .iter()
                .map(|issue| issue.line)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[test]
    fn preserves_unchanged_legacy_invalid_values_but_rejects_new_duplicates() {
        let original = BTreeMap::from([("X-iw-note".into(), vec!["bad Name=legacy".into()])]);
        assert!(
            parse_custom_metadata_text(
                "X-iw-Note=bad Name=legacy",
                &original,
                ScriptMetaCommentStyle::JavaScriptBlock
            )
            .issues
            .is_empty()
        );
        let changed = parse_custom_metadata_text(
            "X-iw-Note=bad Name=legacy\nX-iw-Note=extra",
            &original,
            ScriptMetaCommentStyle::JavaScriptBlock,
        );
        assert_eq!(
            changed
                .issues
                .iter()
                .map(|issue| issue.line)
                .collect::<Vec<_>>(),
            vec![1]
        );
    }
}
