/*
<javascriptresource>
<name>InDesignに合わせてクロップ</name>
<category>YPresets</category>
</javascriptresource>

SCRIPTMETA-BEGIN
Script-ID=org.iwashi.Photoshop_InDesign_Crop
Version=1.1
Release-Date=2026-03-09
Meta-URL=https://gist.github.com/Yamonov/d06d117b56445e52b30764b9c994356c
Target-App=Photoshop
Description-BEGIN
Photoshopで開いている画像を、InDesignに配置したフレームに応じてサイズ変更します。
フレームが食い込んでいる部分にはガイドを、画像が足りない部分はサイズ変更します。
正立のみ対応します。回転画像には対応していません。
Description-END
SCRIPTMETA-END
*/

#target photoshop


// --- NFC/NFD 正規化ヘルパ ---
function toNFCJa(s) {
    if (!s) return s;
    var map = {
        "カ\u3099": "ガ",
        "キ\u3099": "ギ",
        "ク\u3099": "グ",
        "ケ\u3099": "ゲ",
        "コ\u3099": "ゴ",
        "サ\u3099": "ザ",
        "シ\u3099": "ジ",
        "ス\u3099": "ズ",
        "セ\u3099": "ゼ",
        "ソ\u3099": "ゾ",
        "タ\u3099": "ダ",
        "チ\u3099": "ヂ",
        "ツ\u3099": "ヅ",
        "テ\u3099": "デ",
        "ト\u3099": "ド",
        "ハ\u3099": "バ",
        "ヒ\u3099": "ビ",
        "フ\u3099": "ブ",
        "ヘ\u3099": "ベ",
        "ホ\u3099": "ボ",
        "ウ\u3099": "ヴ",
        "ワ\u3099": "ヷ",
        "ヰ\u3099": "ヸ",
        "ヱ\u3099": "ヹ",
        "ヲ\u3099": "ヺ",
        "ハ\u309A": "パ",
        "ヒ\u309A": "ピ",
        "フ\u309A": "プ",
        "ヘ\u309A": "ペ",
        "ホ\u309A": "ポ",
        "か\u3099": "が",
        "き\u3099": "ぎ",
        "く\u3099": "ぐ",
        "け\u3099": "げ",
        "こ\u3099": "ご",
        "さ\u3099": "ざ",
        "し\u3099": "じ",
        "す\u3099": "ず",
        "せ\u3099": "ぜ",
        "そ\u3099": "ぞ",
        "た\u3099": "だ",
        "ち\u3099": "ぢ",
        "つ\u3099": "づ",
        "て\u3099": "で",
        "と\u3099": "ど",
        "は\u3099": "ば",
        "ひ\u3099": "び",
        "ふ\u3099": "ぶ",
        "へ\u3099": "べ",
        "ほ\u3099": "ぼ",
        "う\u3099": "ゔ",
        "は\u309A": "ぱ",
        "ひ\u309A": "ぴ",
        "ふ\u309A": "ぷ",
        "へ\u309A": "ぺ",
        "ほ\u309A": "ぽ",
        "A\u0301": "Á",
        "E\u0301": "É",
        "I\u0301": "Í",
        "O\u0301": "Ó",
        "U\u0301": "Ú",
        "Y\u0301": "Ý",
        "a\u0301": "á",
        "e\u0301": "é",
        "i\u0301": "í",
        "o\u0301": "ó",
        "u\u0301": "ú",
        "y\u0301": "ý",
        "A\u0300": "À",
        "E\u0300": "È",
        "I\u0300": "Ì",
        "O\u0300": "Ò",
        "U\u0300": "Ù",
        "a\u0300": "à",
        "e\u0300": "è",
        "i\u0300": "ì",
        "o\u0300": "ò",
        "u\u0300": "ù",
        "A\u0302": "Â",
        "E\u0302": "Ê",
        "I\u0302": "Î",
        "O\u0302": "Ô",
        "U\u0302": "Û",
        "a\u0302": "â",
        "e\u0302": "ê",
        "i\u0302": "î",
        "o\u0302": "ô",
        "u\u0302": "û",
        "A\u0308": "Ä",
        "E\u0308": "Ë",
        "I\u0308": "Ï",
        "O\u0308": "Ö",
        "U\u0308": "Ü",
        "Y\u0308": "Ÿ",
        "a\u0308": "ä",
        "e\u0308": "ë",
        "i\u0308": "ï",
        "o\u0308": "ö",
        "u\u0308": "ü",
        "y\u0308": "ÿ",
        "A\u0303": "Ã",
        "N\u0303": "Ñ",
        "O\u0303": "Õ",
        "a\u0303": "ã",
        "n\u0303": "ñ",
        "o\u0303": "õ",
        "A\u030A": "Å",
        "a\u030A": "å",
        "A\u0304": "Ā",
        "E\u0304": "Ē",
        "I\u0304": "Ī",
        "O\u0304": "Ō",
        "U\u0304": "Ū",
        "a\u0304": "ā",
        "e\u0304": "ē",
        "i\u0304": "ī",
        "o\u0304": "ō",
        "u\u0304": "ū",
        "C\u030C": "Č",
        "D\u030C": "Ď",
        "E\u030C": "Ě",
        "N\u030C": "Ň",
        "R\u030C": "Ř",
        "S\u030C": "Š",
        "T\u030C": "Ť",
        "Z\u030C": "Ž",
        "c\u030C": "č",
        "d\u030C": "ď",
        "e\u030C": "ě",
        "n\u030C": "ň",
        "r\u030C": "ř",
        "s\u030C": "š",
        "t\u030C": "ť",
        "z\u030C": "ž",
        "Z\u0307": "Ż",
        "z\u0307": "ż",
        "A\u0328": "Ą",
        "E\u0328": "Ę",
        "a\u0328": "ą",
        "e\u0328": "ę",
        "C\u0327": "Ç",
        "c\u0327": "ç"
    };
    var out = String(s);
    for (var k in map) out = out.split(k).join(map[k]);
    return out;
}
// 実体解決 + fsName + NFC化
function _normPathLocal(p) {
    try {
        var f = new File(p);
        try {
            f = f.resolve();
        } catch (_e) {}
        var s = f.fsName;
        return toNFCJa(s);
    } catch (e) {
        try {
            return toNFCJa(String(p));
        } catch (e2) {
            return String(p);
        }
    }
}
var NFC_HELPER_SRC = toNFCJa.toString();
var NORM_HELPER_SRC = _normPathLocal.toString();
function _normPathLocalNoNFC(p) {
    try {
        var f = new File(p);
        try {
            f = f.resolve();
        } catch (_e) {}
        return f.fsName;
    } catch (e) {
        try {
            return String(p);
        } catch (e2) {
            return String(p);
        }
    }
}
function _matchLinkPathLocal(linkFilePath, rawTargetPath, targetNorm) {
    if (linkFilePath !== rawTargetPath) return false;
    var lnkNorm = _normPath(linkFilePath);
    return (lnkNorm === targetNorm);
}
function _decodeAndNormalizePathLocal(encodedPath) {
    var decoded = decodeURIComponent(encodedPath);
    decoded = toNFCJa(decoded);
    try {
        decoded = _normPath(decoded);
    } catch (_e) {}
    return decoded;
}
function _decodePathRawLocal(encodedPath) {
    var decoded = decodeURIComponent(encodedPath);
    return toNFCJa(decoded);
}
var NORM_HELPER_SRC_ID = _normPathLocalNoNFC.toString();
var MATCH_LINK_HELPER_SRC = _matchLinkPathLocal.toString();
var DECODE_NORM_HELPER_SRC = _decodeAndNormalizePathLocal.toString();
var DECODE_RAW_HELPER_SRC = _decodePathRawLocal.toString();

// Photoshopでファイルを開いているか確認
if (app.documents.length > 0) {
    app.activeDocument.suspendHistory("画像伸ばし", "mainProcess()");
}

function mainProcess() {
    // InDesign応答格納
    var inDesignResponse = null;

    // 単位の保存と設定
    var doc = app.activeDocument;
    var originalRulerUnits = preferences.rulerUnits;
    preferences.rulerUnits = Units.PIXELS;

    try {
        var guides = doc.guides;
        var canvasWidth = doc.width.value;
        var canvasHeight = doc.height.value;

        // `'` を含むファイル名でも壊れないよう encodeURIComponent を使用
        var encodedFilePath = encodeURIComponent(_normPathLocal(doc.fullName.fsName));
        sendToInDesign(encodedFilePath);
        activatePhotoshop();

        var responseObject = parseJsonResponse(inDesignResponse);
        if (!responseObject) {
            alert("InDesign応答の解析に失敗しました。\r" + inDesignResponse);
            return;
        }
        if (responseObject.status === "cancel") {
            return;
        }
        if (responseObject.status !== "ok") {
            alert(responseObject.message || "InDesign側でエラーが発生しました。");
            return;
        }

        try {
            // 背景を通常レイヤに（背景ロックを外したい場合）
            doc.backgroundLayer.isBackgroundLayer = false;
        } catch (e) {}

        var adjustments = responseObject.adjustments || [];
        doc.guides.removeAll();

        for (var k = 0; k < 4; k++) {
            var adjustmentValue = String(adjustments[k] || 0);
            var guidePosition = 0;
            var shouldAddGuide = false;

            if (adjustmentValue.indexOf("g") === 0) {
                // g=ガイドオフセットだけ入れてキャンバス増分は0
                guidePosition = Number(adjustmentValue.slice(1));
                adjustments[k] = 0;
                shouldAddGuide = (guidePosition > 0);
            } else {
                var v = parseInt(adjustmentValue, 10);
                adjustments[k] = isNaN(v) ? 0 : v;
            }

            if (shouldAddGuide && k >= 2) {
                guidePosition = (k === 2) ? canvasHeight - guidePosition : canvasWidth - guidePosition;
            }

            if (shouldAddGuide) {
                var direction = (k % 2 === 0) ? Direction.HORIZONTAL : Direction.VERTICAL;
                guides.add(direction, UnitValue(guidePosition, 'px'));
            }
        }

        // カンバスサイズの変更
        doc.resizeCanvas(canvasWidth + adjustments[1], canvasHeight + adjustments[0], AnchorPosition.BOTTOMRIGHT);
        doc.resizeCanvas(canvasWidth + adjustments[1] + adjustments[3], canvasHeight + adjustments[0] + adjustments[2], AnchorPosition.TOPLEFT);
    } finally {
        // 単位を元に戻す
        preferences.rulerUnits = originalRulerUnits;
    }

    // ───────────────────────────────────────────────────────────
    // InDesignをBridgeTalkで呼び出す（同期待機）
    function sendToInDesign(encodedPath) {
        // InDesign側で実行する関数（InDesignコンテキスト）
        var inDesignFunction = function(encodedKey) {
            /*__INJECT_TO_NFC_JA__*/
            var decodedRawKey = _decodePathRaw(encodedKey);
            var decodedNormKey = _decodeAndNormalizePath(encodedKey);

            if (app.documents.length === 0) {
                return toJson({
                    status: "error",
                    message: "ドキュメントが開かれていません。"
                });
            }

            // 環境復元のため退避
            var origUnit = app.scriptPreferences.measurementUnit;
            var origOrigin = app.activeDocument.viewPreferences.rulerOrigin;
            try {
                app.scriptPreferences.measurementUnit = MeasurementUnits.MILLIMETERS;
                app.activeDocument.viewPreferences.rulerOrigin = RulerOrigin.SPREAD_ORIGIN;
                if (app.scriptPreferences.measurementUnit !== MeasurementUnits.MILLIMETERS) {
                    return toJson({
                        status: "error",
                        message: "単位設定に失敗しました（MILLIMETERS 以外）"
                    });
                }

                var links = app.activeDocument.links;
                var matchingLinks = [];
                var i;

                for (i = 0; i < links.length; i++) {
                    var matched = _matchLinkPath(links[i].filePath, decodedRawKey, decodedNormKey);
                    if (!matched) {
                        // フォールバック: ファイル名(NFC)一致 + ファイルサイズ一致
                        try {
                            var lf = new File(links[i].filePath);
                            var tf = new File(decodedNormKey);
                            var nameEq = toNFCJa(lf.name) === toNFCJa(tf.name);
                            var lenEq = (lf.length === tf.length && lf.length > 0);
                            if (nameEq && lenEq) matched = true;
                        } catch (__e) {}
                    }
                    if (matched) {
                        if (links[i].status === LinkStatus.NORMAL) {
                            matchingLinks.push(links[i]);
                        } else {
                            return toJson({
                                status: "error",
                                message: "リンクが更新されていないため、正確な拡大率を取得できません。\nInDesignでリンクパネルを確認してください。"
                            });
                        }
                    }
                }

                if (matchingLinks.length === 0) {
                    var firstLinkPath = links.length > 0 ? _normPath(links[0].filePath) : "リンクなし";
                    return toJson({
                        status: "error",
                        message: "この画像はInDesignドキュメント中に存在しません。\n最初のリンクのパス: " + firstLinkPath + "\n検索キー: " + decodedNormKey
                    });
                }

                var candidates = [];
                for (i = 0; i < matchingLinks.length; i++) {
                    var link = matchingLinks[i];
                    var item = link.parent;
                    var parentItem = item.parent;
                    var effectivePpi = item.effectivePpi;
                    var pageName = getPageName(item);
                    var hScale = getNumber(item.horizontalScale);
                    var vScale = getNumber(item.verticalScale);
                    var parentBounds = toNumberArray(parentItem.geometricBounds);
                    var frameWidth = Math.abs(parentBounds[3] - parentBounds[1]);
                    var frameHeight = Math.abs(parentBounds[2] - parentBounds[0]);
                    var adjustments = buildAdjustments(item, parentItem, effectivePpi);

                    candidates.push({
                        index: i,
                        pageName: pageName,
                        linkName: link.name,
                        hScale: hScale,
                        vScale: vScale,
                        effectivePpi: [getNumber(effectivePpi[0]), getNumber(effectivePpi[1])],
                        itemBounds: toNumberArray(item.geometricBounds),
                        parentBounds: parentBounds,
                        frameWidthMM: frameWidth,
                        frameHeightMM: frameHeight,
                        sortScale: Math.max(hScale, vScale),
                        adjustments: adjustments,
                        label: "",
                        _itemRef: item
                    });
                }

                sortCandidates(candidates);
                updateCandidateLabels(candidates);

                var selected = candidates.length === 1 ? candidates[0] : showCandidateDialog(candidates);
                if (!selected) {
                    return toJson({
                        status: "cancel"
                    });
                }

                selected = stripInternalFields(selected);
                return toJson({
                    status: "ok",
                    matchCount: candidates.length,
                    selectedIndex: selected.index,
                    selected: selected,
                    adjustments: selected.adjustments
                });
            } catch (e) {
                return toJson({
                    status: "error",
                    message: "InDesign側エラー: " + e
                });
            } finally {
                // 環境復元
                try {
                    app.scriptPreferences.measurementUnit = origUnit;
                } catch (_) {}
                try {
                    app.activeDocument.viewPreferences.rulerOrigin = origOrigin;
                } catch (_) {}
            }

            function getNumber(value) {
                var num = Number(value);
                return isNaN(num) ? 0 : num;
            }

            function toNumberArray(values) {
                var result = [];
                for (var idx = 0; idx < values.length; idx++) {
                    result.push(getNumber(values[idx]));
                }
                return result;
            }

            function getPageName(item) {
                try {
                    if (item.parentPage) {
                        return item.parentPage.name;
                    }
                } catch (_pageError) {}
                return "ペーストボード";
            }

            function makeCandidateLabel(order, pageName, frameWidthMM, frameHeightMM) {
                var orderLabel = zeroPad(order, 2);
                return orderLabel + "：" + zeroPadPageName(pageName) + "ページ（" +
                    formatMM(frameWidthMM) + "mm × " + formatMM(frameHeightMM) + "mm）";
            }

            function buildAdjustments(item, parentItem, effectivePpi) {
                var list = [];
                for (var j = 0; j < 4; j++) {
                    var itemBound = item.geometricBounds[j];
                    var parentBound = parentItem.geometricBounds[j];
                    var ppi = (j % 2 === 0) ? effectivePpi[1] : effectivePpi[0];
                    var difference = (j < 2) ? itemBound - parentBound : parentBound - itemBound;
                    var adjustment = Math.round(ppi / 25.4 * Math.abs(difference));
                    list.push(difference > 0 ? adjustment : "g" + adjustment);
                }
                return list;
            }

            function sortCandidates(list) {
                list.sort(function(a, b) {
                    return a.sortScale - b.sortScale;
                });
            }

            function updateCandidateLabels(list) {
                for (var idx = 0; idx < list.length; idx++) {
                    list[idx].label = makeCandidateLabel(idx + 1, list[idx].pageName, list[idx].frameWidthMM, list[idx].frameHeightMM);
                }
            }

            function stripInternalFields(candidate) {
                return {
                    index: candidate.index,
                    pageName: candidate.pageName,
                    linkName: candidate.linkName,
                    hScale: candidate.hScale,
                    vScale: candidate.vScale,
                    effectivePpi: candidate.effectivePpi,
                    itemBounds: candidate.itemBounds,
                    parentBounds: candidate.parentBounds,
                    frameWidthMM: candidate.frameWidthMM,
                    frameHeightMM: candidate.frameHeightMM,
                    sortScale: candidate.sortScale,
                    adjustments: candidate.adjustments,
                    label: candidate.label
                };
            }

            function showCandidateDialog(candidates) {
                var dialog = new Window("dialog", "クロップするリンクを選択");
                dialog.orientation = "column";
                dialog.alignChildren = ["fill", "fill"];
                dialog.spacing = 8;
                dialog.margins = 12;

                var messageGroup = dialog.add("group");
                messageGroup.orientation = "column";
                messageGroup.alignChildren = ["fill", "top"];
                messageGroup.alignment = ["fill", "top"];
                var messageLine1 = messageGroup.add("statictext", undefined, "「" + candidates[0].linkName + "」が複数配置されています。");
                var messageLine2 = messageGroup.add("statictext", undefined, "トリミングを取得するものを選んでください。");
                var messageLine3 = messageGroup.add("statictext", undefined, "※リストを選択すると該当画像を表示します");
                messageLine1.minimumSize.width = 340;
                messageLine2.minimumSize.width = 340;
                messageLine3.minimumSize.width = 340;

                var infoText = dialog.add("statictext", undefined, "候補数: " + candidates.length);
                var listBox = dialog.add("listbox", undefined, [], { multiselect: false });
                listBox.preferredSize = [340, 260];

                for (var idx = 0; idx < candidates.length; idx++) {
                    var item = listBox.add("item", candidates[idx].label);
                    item.candidate = candidates[idx];
                }

                var buttonGroup = dialog.add("group");
                buttonGroup.orientation = "row";
                buttonGroup.alignment = ["right", "center"];
                var cancelButton = buttonGroup.add("button", undefined, "キャンセル", { name: "cancel" });
                var okButton = buttonGroup.add("button", undefined, "OK", { name: "ok" });

                listBox.onChange = function() {
                    if (!this.selection) return;
                    focusCandidate(this.selection.candidate);
                };
                listBox.onDoubleClick = function() {
                    if (!this.selection) return;
                    dialog.close(1);
                };

                if (listBox.items.length > 0) {
                    listBox.selection = listBox.items[0];
                    focusCandidate(listBox.selection.candidate);
                }

                cancelButton.onClick = function() {
                    dialog.close(0);
                };
                okButton.onClick = function() {
                    if (!listBox.selection) {
                        alert("候補を選択してください。");
                        return;
                    }
                    dialog.close(1);
                };

                var result = dialog.show();
                if (result !== 1 || !listBox.selection) {
                    return null;
                }
                return listBox.selection.candidate;
            }

            function focusCandidate(candidate) {
                if (!candidate || !candidate._itemRef) return;
                try {
                    var doc = app.activeDocument;
                    var item = candidate._itemRef;
                    var win = doc.layoutWindows.length > 0 ? doc.layoutWindows[0] : null;
                    if (!win) return;
                    if (item.parentPage) {
                        win.activePage = item.parentPage;
                    }
                    item.select();
                    if (!fitSelection(win)) {
                        try {
                            win.zoom(ZoomOptions.FIT_PAGE);
                        } catch (_fitPageError) {}
                    }
                } catch (_focusError) {}
            }

            function fitSelection(win) {
                try {
                    var fitSelectionAction = app.menuActions.itemByName("$ID/Fit Selection in Window");
                    if (fitSelectionAction && fitSelectionAction.isValid) {
                        fitSelectionAction.invoke();
                        return true;
                    }
                } catch (_menuError) {}

                try {
                    win.zoom(ZoomOptions.FIT_SPREAD);
                    return true;
                } catch (_spreadError) {}

                return false;
            }

            function escapeJsonString(text) {
                return String(text)
                    .replace(/\\/g, "\\\\")
                    .replace(/"/g, '\\"')
                    .replace(/\r/g, "\\r")
                    .replace(/\n/g, "\\n");
            }

            function toJson(value) {
                if (value === null) return "null";
                var type = typeof value;
                if (type === "string") return '"' + escapeJsonString(value) + '"';
                if (type === "number") return isFinite(value) ? String(value) : "0";
                if (type === "boolean") return value ? "true" : "false";
                if (value instanceof Array) {
                    var arr = [];
                    for (var ai = 0; ai < value.length; ai++) {
                        arr.push(toJson(value[ai]));
                    }
                    return "[" + arr.join(",") + "]";
                }
                var parts = [];
                for (var key in value) {
                    if (!value.hasOwnProperty(key)) continue;
                    parts.push('"' + escapeJsonString(key) + '":' + toJson(value[key]));
                }
                return "{" + parts.join(",") + "}";
            }

            function zeroPad(value, digits) {
                var text = String(value);
                while (text.length < digits) {
                    text = "0" + text;
                }
                return text;
            }

            function formatMM(value) {
                return getNumber(value).toFixed(2);
            }

            function zeroPadPageName(pageName) {
                var text = String(pageName).replace(/^\s+|\s+$/g, "");
                var num = parseInt(text, 10);
                if (!isNaN(num) && String(num) === text) {
                    return zeroPad(num, 3);
                }
                return text;
            }
        };

        var bt = new BridgeTalk();
        bt.target = "indesign";
        // ヘルパをInDesign側スコープへ注入
        var injected = inDesignFunction.toString().replace(
            "/*__INJECT_TO_NFC_JA__*/",
            "var toNFCJa = " + NFC_HELPER_SRC + ";\n" +
            "var _normPath = " + NORM_HELPER_SRC_ID + ";\n" +
            "var _matchLinkPath = " + MATCH_LINK_HELPER_SRC + ";\n" +
            "var _decodeAndNormalizePath = " + DECODE_NORM_HELPER_SRC + ";\n" +
            "var _decodePathRaw = " + DECODE_RAW_HELPER_SRC + ";"
        );

        function _escJS(str) {
            // BridgeTalk 本文に安全に埋め込むための最小限エスケープ
            return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        }
        bt.body = "(" + injected + ")('" + _escJS(encodedPath) + "');";
        inDesignResponse = null;

        bt.onResult = function(response) {
            inDesignResponse = response.body;
        };
        bt.onError = function(err) {
            inDesignResponse = '{"status":"error","message":"BridgeTalkエラー: ' +
                String(err && err.body ? err.body : "unknown").replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
                '"}';
        };
        bt.send();

        // 同期待機（最大5分）
        var start = new Date().getTime();
        var timeoutMs = 300000;
        while (inDesignResponse === null && (new Date().getTime() - start) < timeoutMs) {
            try { BridgeTalk.pump(); } catch (_e) {}
            $.sleep(50);
        }
        if (inDesignResponse === null) {
            inDesignResponse = '{"status":"error","message":"InDesignから応答がありません（タイムアウト）"}';
        }
    }
}

function parseJsonResponse(text) {
    var normalized = String(text || "").replace(/^\uFEFF/, "").replace(/^\s+|\s+$/g, "");
    if (!normalized) return null;
    try {
        return JSON.parse(normalized);
    } catch (jsonError) {
        try {
            return eval("(" + normalized + ")");
        } catch (evalError) {
            return null;
        }
    }
}

function activatePhotoshop() {
    try {
        BridgeTalk.bringToFront("photoshop");
        return;
    } catch (e) {}

    try {
        app.bringToFront();
    } catch (e2) {}
}
