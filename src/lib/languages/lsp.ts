import { monaco } from '../editor/monaco';
import type { PluginLanguageServerHandle } from '../pluginRuntime';

type LspRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

type LspTextEdit = { range: LspRange; newText: string };
type LspLocation = { uri: string; range: LspRange };
type LspDiagnostic = {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
};

type CompletionItem = {
  label: string | { label: string };
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  insertText?: string;
  textEdit?: { range: LspRange; newText: string };
  filterText?: string;
  sortText?: string;
};

const toRange = (range: LspRange) =>
  new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );

const completionKind = (kind?: number) => {
  const kinds = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 2: return kinds.Method;
    case 3: return kinds.Function;
    case 4: return kinds.Constructor;
    case 5: return kinds.Field;
    case 6: return kinds.Variable;
    case 7: return kinds.Class;
    case 8: return kinds.Interface;
    case 9: return kinds.Module;
    case 10: return kinds.Property;
    case 11: return kinds.Unit;
    case 12: return kinds.Value;
    case 13: return kinds.Enum;
    case 14: return kinds.Keyword;
    case 15: return kinds.Snippet;
    case 16: return kinds.Color;
    case 17: return kinds.File;
    case 18: return kinds.Reference;
    case 19: return kinds.Folder;
    case 20: return kinds.EnumMember;
    case 21: return kinds.Constant;
    case 22: return kinds.Struct;
    case 23: return kinds.Event;
    case 24: return kinds.Operator;
    case 25: return kinds.TypeParameter;
    default: return kinds.Text;
  }
};

const markerSeverity = (severity?: number) => {
  switch (severity) {
    case 1: return monaco.MarkerSeverity.Error;
    case 2: return monaco.MarkerSeverity.Warning;
    case 3: return monaco.MarkerSeverity.Info;
    default: return monaco.MarkerSeverity.Hint;
  }
};

const documentUri = (model: monaco.editor.ITextModel) => model.uri.toString(true);
const textOf = (contents: unknown): string => {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(textOf).filter(Boolean).join('\n\n');
  if (contents && typeof contents === 'object') {
    const value = (contents as { value?: unknown; language?: unknown }).value;
    if (typeof value === 'string') return value;
  }
  return '';
};

export function connectLanguageServer(options: {
  handle: PluginLanguageServerHandle;
  language: string;
  documentSelector?: string[];
}): () => void {
  const { handle, language } = options;
  const selector = new Set(options.documentSelector ?? [language]);
  const disposables: monaco.IDisposable[] = [];
  const openModels = new Set<string>();
  const versions = new Map<string, number>();
  const pendingChanges = new Map<string, number>();
  const modelListeners = new Map<string, monaco.IDisposable>();

  const matches = (model: monaco.editor.ITextModel) => selector.has(model.getLanguageId());

  const didOpen = (model: monaco.editor.ITextModel) => {
    if (!matches(model) || openModels.has(documentUri(model))) return;
    openModels.add(documentUri(model));
    versions.set(documentUri(model), model.getVersionId());
    modelListeners.set(documentUri(model), model.onDidChangeContent(() => didChange(model)));
    void handle.notify('textDocument/didOpen', {
      textDocument: {
        uri: documentUri(model),
        languageId: model.getLanguageId(),
        version: model.getVersionId(),
        text: model.getValue(),
      },
    });
  };

  const didChange = (model: monaco.editor.ITextModel) => {
    const uri = documentUri(model);
    if (!openModels.has(uri)) return;
    const version = model.getVersionId();
    if (versions.get(uri) === version) return;
    versions.set(uri, version);
    const previous = pendingChanges.get(uri);
    if (previous !== undefined) window.clearTimeout(previous);
    pendingChanges.set(uri, window.setTimeout(() => {
      pendingChanges.delete(uri);
      void handle.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text: model.getValue() }],
      });
    }, 120));
  };

  const didClose = (model: monaco.editor.ITextModel) => {
    const uri = documentUri(model);
    if (!openModels.delete(uri)) return;
    modelListeners.get(uri)?.dispose();
    modelListeners.delete(uri);
    void handle.notify('textDocument/didClose', { textDocument: { uri } });
  };

  for (const model of monaco.editor.getModels()) didOpen(model);
  disposables.push(monaco.editor.onDidCreateModel(didOpen));
  disposables.push(monaco.editor.onWillDisposeModel(didClose));

  disposables.push(monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['.', ':', '$', '>', '/'],
    async provideCompletionItems(model, position) {
      const result = await handle.request('textDocument/completion', {
        textDocument: { uri: documentUri(model) },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
      }) as { items?: CompletionItem[] } | CompletionItem[] | null;
      const items = Array.isArray(result) ? result : result?.items ?? [];
      const word = model.getWordUntilPosition(position);
      const defaultRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: items.map((item) => {
          const label = typeof item.label === 'string' ? item.label : item.label.label;
          return {
            label,
            kind: completionKind(item.kind),
            detail: item.detail,
            documentation: textOf(item.documentation),
            insertText: item.textEdit?.newText ?? item.insertText ?? label,
            filterText: item.filterText,
            sortText: item.sortText,
            range: item.textEdit ? toRange(item.textEdit.range) : defaultRange,
            insertTextRules: item.kind === 15
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          };
        }),
      };
    },
  }));

  disposables.push(monaco.languages.registerHoverProvider(language, {
    async provideHover(model, position) {
      const result = await handle.request('textDocument/hover', {
        textDocument: { uri: documentUri(model) },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
      }) as { contents: unknown; range?: LspRange } | null;
      if (!result) return null;
      const value = textOf(result.contents);
      if (!value) return null;
      return { contents: [{ value }], range: result.range ? toRange(result.range) : undefined };
    },
  }));

  disposables.push(monaco.languages.registerDefinitionProvider(language, {
    async provideDefinition(model, position) {
      const result = await handle.request('textDocument/definition', {
        textDocument: { uri: documentUri(model) },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
      }) as LspLocation | LspLocation[] | null;
      return (Array.isArray(result) ? result : result ? [result] : []).map((location) => ({
        uri: monaco.Uri.parse(location.uri),
        range: toRange(location.range),
      }));
    },
  }));

  disposables.push(monaco.languages.registerReferenceProvider(language, {
    async provideReferences(model, position) {
      const result = await handle.request('textDocument/references', {
        textDocument: { uri: documentUri(model) },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
        context: { includeDeclaration: true },
      }) as LspLocation[] | null;
      return (result ?? []).map((location) => ({
        uri: monaco.Uri.parse(location.uri),
        range: toRange(location.range),
      }));
    },
  }));

  disposables.push(monaco.languages.registerRenameProvider(language, {
    async provideRenameEdits(model, position, newName) {
      const result = await handle.request('textDocument/rename', {
        textDocument: { uri: documentUri(model) },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
        newName,
      }) as { changes?: Record<string, LspTextEdit[]>; documentChanges?: { textDocument: { uri: string }; edits: LspTextEdit[] }[] } | null;
      const edits: { resource: monaco.Uri; textEdit: { range: monaco.IRange; text: string } }[] = [];
      if (result?.changes) {
        for (const [uri, textEdits] of Object.entries(result.changes)) {
          for (const edit of textEdits) edits.push({ resource: monaco.Uri.parse(uri), textEdit: { range: toRange(edit.range), text: edit.newText } });
        }
      }
      for (const change of result?.documentChanges ?? []) {
        for (const edit of change.edits) edits.push({ resource: monaco.Uri.parse(change.textDocument.uri), textEdit: { range: toRange(edit.range), text: edit.newText } });
      }
      return { edits } as unknown as monaco.languages.WorkspaceEdit;
    },
  }));

  disposables.push(monaco.languages.registerDocumentFormattingEditProvider(language, {
    async provideDocumentFormattingEdits(model) {
      const result = await handle.request('textDocument/formatting', {
        textDocument: { uri: documentUri(model) },
        options: { tabSize: model.getOptions().tabSize, insertSpaces: model.getOptions().insertSpaces },
      }) as LspTextEdit[] | null;
      return (result ?? []).map((edit) => ({ range: toRange(edit.range), text: edit.newText }));
    },
  }));

  const offDiagnostics = handle.onNotification((method, params) => {
    if (method !== 'textDocument/publishDiagnostics') return;
    const payload = params as { uri: string; diagnostics: LspDiagnostic[] };
    const model = monaco.editor.getModel(monaco.Uri.parse(payload.uri));
    if (!model) return;
    monaco.editor.setModelMarkers(model, 'lsp', (payload.diagnostics ?? []).map((diagnostic) => ({
      ...toRange(diagnostic.range),
      severity: markerSeverity(diagnostic.severity),
      message: diagnostic.message,
      source: diagnostic.source,
      code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    })));
  });

  return () => {
    offDiagnostics();
    for (const timer of pendingChanges.values()) window.clearTimeout(timer);
    pendingChanges.clear();
    disposables.forEach((disposable) => disposable.dispose());
    modelListeners.forEach((listener) => listener.dispose());
    modelListeners.clear();
    for (const uri of openModels) void handle.notify('textDocument/didClose', { textDocument: { uri } });
    openModels.clear();
  };
}
