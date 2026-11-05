import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the production event handlers without launching a browser or app.
class Element {
  children = [];
  listeners = {};
  value = '';
  disabled = false;
  className = '';
  attributes = {};
  dataset = {};
  style = {};
  scrollTop = 0;
  classList = {
    add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
    remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
    toggle: (name, enabled) => {
    const names = new Set(this.className.split(' ').filter(Boolean));
    if (enabled) names.add(name); else names.delete(name);
    this.className = [...names].join(' ');
  } };
  focus() {}
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  scrollIntoView() {}
  get lastElementChild() { return this.children.at(-1); }
  fire(name, event = {}) { this.listeners[name]?.(event); }
}
class TextArea extends Element {}

function setup(invokeMock = async () => { throw new Error('Unexpected IPC call'); }) {
  let nextTimer = 0;
  const timers = new Map();
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '')
    .replaceAll('import.meta', '({env:{DEV:false}})');
  const js = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None}}).outputText;
  const context = vm.createContext({
    document: {createElement: tag => tag === 'textarea' ? new TextArea() : new Element()},
    window: {addEventListener() {}}, HTMLTextAreaElement: TextArea,
    structuredClone,
    invoke: invokeMock,
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    flushQueuedTimer: () => {
      const last = [...timers.entries()].at(-1);
      if (!last) return;
      timers.delete(last[0]);
      return last[1]();
    },
    FakeElement: Element,
  });
  vm.runInContext(js + `
    state.selectedRecordKey = 'test';
    state.records.set('test', {recordKey:'test', scriptmetaEditState:'editable'});
    state.editorDraft = emptyDraft();
    advancedMetadata = {
      localization: {default_language:'ja', translations:{ja:{name:'日本語',author:null,description:'元の説明'},en:{name:'English',author:null,description:null}}, unqualified:{name:null,author:null,description:null}},
      tags: ['one'], customFields: {'X-org.example-note':['', 'second'], 'X-org.example-order':['0020']}
    };
    selectedLanguage = 'en';
    selectedFieldLanguages = {name:'ja',author:'ja',description:'ja'};
    globalThis.harness = {
      custom: createCustomEditor, tags: createTagsEditor,
      raw: currentCustomText,
      issues: setCustomTextIssues,
      getIssues: () => customTextIssues,
      flush: globalThis.flushQueuedTimer,
      mountValidation: () => {
        state.editorDraft.scriptId = 'org.example.test';
        state.checkedFields.add('scriptId');
        state.metadataDocument = {draft:emptyDraft(),advanced:structuredClone(advancedMetadata),commentStyle:'java_script_block',filePath:'Test.jsx'};
        window.__TAURI_INTERNALS__ = {};
        const save = new FakeElement(), validation = new FakeElement(), preview = new FakeElement();
        detailPaneEl = {querySelector: selector => ({'.detail-save':save,'.detail-validation':validation,'.scriptmeta-preview-code':preview})[selector] ?? null};
        return {save,validation,preview};
      },
      composing: () => editorComposing,
      selections: () => selectedFieldLanguages,
      localized: createLocalizedField,
      languageEditor: createLanguageEditor,
      changeLanguage,
      order: () => orderedEditorLanguages(advancedMetadata.localization),
      rowSelection: () => selectedLanguage,
      enabled: value => { multilingualChecked = value; },
      effectiveAdvanced: effectiveAdvancedMetadata,
      initialize: editor => {
        if (editor) advancedMetadata.localization = structuredClone(editor);
        state.metadataDocument = {draft:emptyDraft(),advanced:structuredClone(advancedMetadata),commentStyle:'java_script_block',filePath:'Test.jsx'};
        loadAdvanced(state.metadataDocument);
      },
      metadata: () => advancedMetadata,
      dirty: () => state.editorDirty,
      lock: () => { state.isSavingDetail = true; },
      effective: effectiveDraftForSave,
    };
  `, context);
  return context.harness;
}

test('custom text preserves unfinished lines, selection and textarea identity during validation', () => {
  const h = setup();
  const panel = h.custom();
  const editor = panel.children[1];
  const input = editor.children[2];
  assert.equal(input.value, 'X-org.example-note=\nX-org.example-note=second\nX-org.example-order=0020');
  input.value = 'X-iw-Key=value\nunfinished';
  input.selectionStart = 14;
  input.selectionEnd = 14;
  input.fire('input');
  h.issues([{line:2,message:'キー=値で入力してください。'}]);
  assert.equal(editor.children[2], input);
  assert.equal(input.value, h.raw());
  assert.equal(input.selectionStart, 14);
  assert.equal(input.selectionEnd, 14);
  assert.match(editor.children[0].children[1].className, /is-invalid/);
  assert.match(editor.children[1].children[1].className, /is-invalid/);
  assert.equal(input.attributes['aria-invalid'], 'true');
});

test('language tabs are independent and mark only empty translations', () => {
  const h = setup();
  const name = h.localized('name');
  const desc = h.localized('description');
  const tabs = desc.children[1];
  const panels = desc.children[2];
  assert.equal(tabs.children[0].textContent, 'ja');
  assert.equal(tabs.children[1].textContent, 'en');
  assert.match(tabs.children[1].className, /is-empty/);
  tabs.children[1].fire('click');
  assert.equal(h.selections().description, 'en');
  assert.equal(h.selections().name, 'ja');
  assert.equal(name.children[2].children[0].hidden, false);
  const input = panels.children[1].children[0];
  assert.equal(input.value, '');
  input.value = 'English description'; input.fire('input');
  assert.doesNotMatch(tabs.children[1].className, /is-empty/);
  tabs.children[0].fire('click');
  tabs.children[1].fire('click');
  assert.equal(panels.children[1].children[0], input);
  assert.equal(h.metadata().localization.translations.ja.description, '元の説明');
  assert.equal(h.metadata().localization.translations.en.description, 'English description');
  assert.equal(h.effective().description, '元の説明');
});

test('custom text composition keeps native text and defers validation', () => {
  const h = setup();
  const input = h.custom().children[1].children[2];
  input.fire('compositionstart');
  input.value = 'X-iw-Note=変換中'; input.fire('input');
  assert.equal(h.composing(), true);
  assert.equal(h.raw(), 'X-iw-Note=変換中');
  input.fire('compositionend');
  assert.equal(h.composing(), false);
  assert.equal(input.value, 'X-iw-Note=変換中');
});

test('tag input commits on change without replacing the input and removes tags', () => {
  const h = setup();
  const panel = h.tags();
  const chips = panel.children[1];
  const input = panel.children[2];
  input.value = 'two, three'; input.fire('change');
  assert.deepEqual([...h.metadata().tags], ['one', 'two', 'three']);
  assert.equal(panel.children[2], input);
  chips.children[0].fire('click');
  assert.deepEqual([...h.metadata().tags], ['two', 'three']);
});

test('IME Enter does not commit an unfinished tag and saving disables editors', () => {
  const h = setup();
  const input = h.tags().children[2];
  input.value = '変換中';
  input.fire('keydown', {key:'Enter', isComposing:true});
  assert.deepEqual([...h.metadata().tags], ['one']);
  h.lock();
  assert.equal(h.localized('name').children[2].children[0].children[0].disabled, true);
  assert.equal(h.custom().children[1].children[2].disabled, true);
});


test('validation waits until composition ends and groups rapid keystrokes', async () => {
  const calls = [];
  const h = setup(async (command) => {
    calls.push(command);
    return command === 'validate_custom_metadata_text' ? {fields:{},issues:[]} : 'preview';
  });
  h.mountValidation();
  const input = h.custom().children[1].children[2];
  input.fire('compositionstart');
  for (const value of ['X-iw-Note=に', 'X-iw-Note=日本', 'X-iw-Note=日本語']) {
    input.value = value; input.fire('input');
  }
  await h.flush();
  assert.deepEqual(calls, []);
  input.fire('compositionend');
  input.fire('input');
  await h.flush();
  assert.deepEqual(calls, ['validate_custom_metadata_text', 'preview_metadata']);
});

test('stale asynchronous validation cannot mark newer input invalid', async () => {
  const pending = [];
  const h = setup((command) => command === 'validate_custom_metadata_text'
    ? new Promise(resolve => pending.push(resolve)) : Promise.resolve('current preview'));
  const controls = h.mountValidation();
  const input = h.custom().children[1].children[2];
  input.value = 'unfinished'; input.fire('input');
  const first = h.flush();
  input.value = 'X-iw-Note=corrected'; input.fire('input');
  const second = h.flush();
  pending[0]({fields:{},issues:[{line:1,message:'old error'}]});
  await first;
  assert.equal(h.getIssues().length, 0);
  assert.equal(controls.save.disabled, true);
  pending[1]({fields:{'X-iw-note':['corrected']},issues:[]});
  await second;
  assert.equal(h.getIssues().length, 0);
  assert.equal(controls.save.disabled, false);
  assert.equal(input.value, 'X-iw-Note=corrected');
});


function languageAPI(calls = []) {
  return async (command, args) => {
    assert.equal(command, 'edit_metadata_language');
    const editor = structuredClone(args.editor), op = args.operation;
    calls.push({...op});
    if (op.operation === 'add_language') editor.translations[op.language] ??= {name:null,author:null,description:null};
    if (op.operation === 'set_default_language') {
      editor.translations[op.language] ??= {name:null,author:null,description:null};
      if (!editor.default_language) {
        for (const field of ['name','author','description']) if (editor.unqualified[field] !== null) editor.translations[op.language][field] = editor.unqualified[field];
        editor.unqualified = {name:null,author:null,description:null};
      }
      editor.default_language = op.language;
    }
    if (op.operation === 'remove_language') {
      if (Object.keys(editor.translations).length === 1) editor.unqualified = editor.translations[op.language];
      delete editor.translations[op.language];
      if (editor.default_language === op.language) editor.default_language = null;
    }
    return editor;
  };
}

test('language list uses the Scripta choices and row selection does not switch field tabs', () => {
  const h = setup(languageAPI()); h.initialize();
  const editor = h.languageEditor();
  const list = editor.children[1].children[0];
  const add = editor.children[1].children[1].children[0];
  assert.equal(list.children[0].children[0].textContent, 'ja');
  assert.match(list.children[0].children[1].textContent, /日本語.*★既定言語/);
  assert.deepEqual(add.children.slice(1,5).map(option => option.value), ['ja','en','zh','ko']);
  assert.equal(add.children.length, 41);
  list.children[1].fire('click');
  assert.equal(h.rowSelection(), 'en');
  assert.equal(h.selections().name, 'ja');
  assert.equal(h.selections().description, 'ja');
});

test('first language labels existing ordinary text and later additions preserve selected tabs', async () => {
  const calls = [], h = setup(languageAPI(calls));
  h.initialize({default_language:null,translations:{},unqualified:{name:'Legacy',author:'Author',description:'Legacy description'}});
  h.enabled(true);
  await h.changeLanguage({kind:'add',language:'ja'});
  assert.equal(calls[0].operation, 'set_default_language');
  assert.equal(h.metadata().localization.translations.ja.name, 'Legacy');
  await h.changeLanguage({kind:'add',language:'en'});
  assert.equal(h.rowSelection(), 'en');
  assert.equal(h.selections().name, 'ja');
  assert.equal(h.selections().description, 'ja');
});

test('moving the first language changes the default but retains text and active tabs', async () => {
  const h = setup(languageAPI()); h.initialize();
  await h.changeLanguage({kind:'move',language:'en',destination:0});
  assert.deepEqual([...h.order()], ['en','ja']);
  assert.equal(h.metadata().localization.default_language, 'en');
  assert.equal(h.metadata().localization.translations.ja.name, '日本語');
  assert.equal(h.metadata().localization.translations.en.name, 'English');
  assert.equal(h.selections().name, 'ja');
});

test('removing the default selects the next default and removing the last keeps ordinary text', async () => {
  const h = setup(languageAPI()); h.initialize();
  await h.changeLanguage({kind:'remove',language:'ja'});
  assert.equal(h.metadata().localization.default_language, 'en');
  assert.equal(h.selections().name, 'en');
  await h.changeLanguage({kind:'remove',language:'en'});
  assert.equal(h.metadata().localization.default_language, null);
  assert.equal(h.metadata().localization.unqualified.name, 'English');
  assert.equal(h.order().length, 0);
});

test('unchecked structure preserves original languages while saving text to its original language', async () => {
  const h = setup(languageAPI()); h.initialize();
  await h.changeLanguage({kind:'move',language:'en',destination:0});
  const field = h.localized('name');
  field.children[1].children[0].fire('click');
  const input = field.children[2].children[0].children[0];
  input.value='Changed English';input.fire('input');
  h.enabled(false);
  const effective=h.effectiveAdvanced().localization;
  assert.equal(effective.default_language, 'ja');
  assert.equal(effective.translations.ja.name, '日本語');
  assert.equal(effective.translations.en.name, 'Changed English');
});

test('unchecked first-language conversion keeps edited ordinary text without introducing a language', async () => {
  const h = setup(languageAPI());
  h.initialize({default_language:null,translations:{},unqualified:{name:'Legacy',author:null,description:null}});
  h.enabled(true);
  await h.changeLanguage({kind:'add',language:'ja'});
  const field=h.localized('name');
  const input=field.children[2].children[0].children[0];
  input.value='Edited';input.fire('input');
  h.enabled(false);
  const effective=h.effectiveAdvanced().localization;
  assert.equal(effective.default_language,null);
  assert.equal(Object.keys(effective.translations).length,0);
  assert.equal(effective.unqualified.name,'Edited');
});

test('existing languages stay readable and the add menu stops at ten languages', async () => {
  const h=setup(languageAPI());h.initialize();
  for(const language of ['zh','ko','ar','de','fr','it','es','pt']) await h.changeLanguage({kind:'add',language});
  await h.changeLanguage({kind:'add',language:'vi'});
  assert.equal(h.order().length,10);
  assert.equal(h.languageEditor().children[1].children[1].children[0].disabled,true);
});


test('existing regional language codes retain their code and display a localized name', () => {
  const h=setup(languageAPI());
  h.initialize({default_language:'en-US',translations:{'en-US':{name:'English',author:null,description:null}},unqualified:{name:null,author:null,description:null}});
  const row=h.languageEditor().children[1].children[0].children[0];
  assert.equal(row.children[0].textContent,'en-US');
  assert.match(row.children[1].textContent,/英語/);
});
