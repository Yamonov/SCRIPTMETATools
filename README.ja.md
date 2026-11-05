# SCRIPTMETA Tools 1.5.0

SCRIPTMETAに対応したスクリプトのメタデータを扱う、macOS・Windows用ツールです。

[English](README.md) · [1.5.0のダウンロード](https://github.com/Yamonov/SCRIPTMETATools/releases/tag/tools-v1.5.0)

## ダウンロード

| ツール | macOS（Apple Silicon／Intel） | Windows x64 |
| --- | --- | --- |
| **SCRIPTMETAKitMini 1.5.0** | [Universal DMG](https://github.com/Yamonov/SCRIPTMETATools/releases/download/tools-v1.5.0/SCRIPTMETAKitMini_1.5.0_macos_universal.dmg) | [ポータブルZIP](https://github.com/Yamonov/SCRIPTMETATools/releases/download/tools-v1.5.0/SCRIPTMETAKitMini_1.5.0_windows_x64.zip) |
| **scriptmeta CLI 1.5.0** | [Universal ZIP](https://github.com/Yamonov/SCRIPTMETATools/releases/download/tools-v1.5.0/scriptmeta_1.5.0_macos_universal.zip) | [ポータブルZIP](https://github.com/Yamonov/SCRIPTMETATools/releases/download/tools-v1.5.0/scriptmeta_1.5.0_windows_x64.zip) |

macOS版はDeveloper ID署名・Apple公証済みです。MiniアプリとDMGには公証チケットも添付しています。Windows版は未署名です。リリースに添付した`SHA256SUMS.txt`でダウンロード内容を確認できます。

macOS版MiniはDMGを開き、アプリをApplicationsへコピーしてください。Windows版はZIPを展開し、`scriptmetakitmini.exe`を起動します。Microsoft Edge WebView2 Runtimeが必要です。CLIはZIPを展開してターミナルから実行するか、`PATH`の通った場所へ配置してください。

## SCRIPTMETAKitMini

登録フォルダのスクリプトを読み取り、更新情報の確認とSCRIPTMETAの編集を行うデスクトップアプリです。

- **Name・Author・Descriptionの多言語編集**：各項目に独立した言語タブを表示します。未入力のタブは薄赤で表示します。
- **言語リスト**：「＋」から言語を追加し、「−」から選択した言語を削除できます。ドラッグで順番を変えられ、先頭が既定言語です。追加は最大10言語で、既存の言語情報は保持します。
- **Tags編集**：言語共通のタグを追加・削除できます。欄の全幅を使い、タグ内の文字は折り返しません。
- **ユーザー拡張キーの編集**：`X-作成者ID-項目名=値`を1行ずつ入力します。入力が止まってから不正な行を赤表示します。IME変換中は検証を待ち、カーソル・選択範囲・Undoを維持します。
- **保存**：プレビューを確認して保存できます。外部変更を検知し、未知の項目や未変更の項目を保持してバックアップを作成します。
- **更新確認**：Local Subset／Update Profileに対応します。更新情報と配布ページへのリンクを表示します。スクリプトの自動インストールは行いません。

## scriptmeta CLI

CLIは**読み取り専用**です。メタデータの一覧、更新確認、個別ファイルの内容確認、検証を行います。ファイル編集、更新ファイルのダウンロード、インストールは行いません。

```console
scriptmeta check ./Scripts
scriptmeta scan ./Scripts --format json
scriptmeta scan ./Scripts --language ja --language en --custom-key X- --format json
scriptmeta inspect ./Scripts/Example.jsx --format json
scriptmeta validate ./Scripts
scriptmeta formats
```

WindowsのPowerShellでは、展開先で次のように実行できます。

```powershell
.\scriptmeta.exe scan "C:\Scripts" --language ja --custom-key X- --format json
```

`--language`は`scan`／`check`の表示言語を優先順に指定します。`--custom-key`は取得する拡張キーを指定するオプションです。複数回指定でき、`X-`ならすべての対応拡張キーを取得します。Tagsは言語共通です。

`inspect`では全言語の編集用情報とTags・拡張キーを確認できます。空の値や同じキーの複数の値も保持します。`validate`ではKitの規則に基づく検証と、Script-IDの重複確認を行います。出力は通常表示・JSON・JSONLに対応し、進捗は標準エラー出力へ送ります。

詳細なオプションと終了コードは[CLIのREADME](crates/scriptmetakitcli/README.md)を参照してください。

## 共通エンジン・ライセンス

両ツールとも公開タグで固定した**SCRIPTMETAKit 2.1.1**を使用します。解析・言語変換・検証・保存形式の生成はKitが担当します。

ツール本体は[MIT License](LICENSE)、SCRIPTMETAKitはApache-2.0です。[NOTICE](NOTICE)と[依存ライブラリのライセンス](THIRD_PARTY_LICENSES.md)は配布物にも同梱しています。

ビルド・検証方法は[English README](README.md#shared-engine-and-source-builds)、配布手順は[RELEASING.md](RELEASING.md)を参照してください。
