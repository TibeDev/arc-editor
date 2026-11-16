import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import type { ThemeDefinition } from '../settings';

type MonacoEnvironment = {
  getWorker: (moduleId: string, label: string) => Worker;
};

(self as unknown as { MonacoEnvironment: MonacoEnvironment }).MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

export { monaco };

export type EditorViewHandle = monaco.editor.IStandaloneCodeEditor;

const modelLanguages = new Map<string, string>();

export function fileUri(path: string): monaco.Uri {
  return monaco.Uri.file(path);
}

export function pathFromUri(uri: monaco.Uri | string): string {
  const value = typeof uri === 'string' ? monaco.Uri.parse(uri) : uri;
  return value.scheme === 'file' ? value.fsPath : value.toString(true);
}

export function acquireModel(path: string, content: string, languageId: string): monaco.editor.ITextModel {
  const uri = fileUri(path);
  let model = monaco.editor.getModel(uri);
  if (!model) {
    model = monaco.editor.createModel(content, languageId, uri);
  } else if (model.getLanguageId() !== languageId) {
    monaco.editor.setModelLanguage(model, languageId);
  }
  modelLanguages.set(path, languageId);
  return model;
}

export function releaseModel(path: string): void {
  const model = monaco.editor.getModel(fileUri(path));
  model?.dispose();
  modelLanguages.delete(path);
}

export function modelForPath(path: string): monaco.editor.ITextModel | null {
  return monaco.editor.getModel(fileUri(path));
}

const languageAliases: Record<string, string> = {
  htm: 'html',
  svg: 'xml',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  yml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  xml: 'xml',
  php: 'php',
};

export function languageIdForFile(name: string, override?: string): string {
  if (override) return override;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return languageAliases[extension] ?? (extension || 'plaintext');
}

const phpCompletions: { label: string; type: string; detail: string }[] = [
  { label: '<?php', type: 'keyword', detail: 'Start PHP code' },
  { label: 'echo', type: 'keyword', detail: 'Output text' },
  { label: 'function', type: 'keyword', detail: 'Declare a function' },
  { label: 'class', type: 'keyword', detail: 'Declare a class' },
  { label: 'public', type: 'keyword', detail: 'Public visibility' },
  { label: 'private', type: 'keyword', detail: 'Private visibility' },
  { label: 'protected', type: 'keyword', detail: 'Protected visibility' },
  { label: 'static', type: 'keyword', detail: 'Static declaration' },
  { label: 'new', type: 'keyword', detail: 'Create an object' },
  { label: 'return', type: 'keyword', detail: 'Return from a function' },
  { label: 'if', type: 'keyword', detail: 'Conditional statement' },
  { label: 'elseif', type: 'keyword', detail: 'Additional conditional branch' },
  { label: 'else', type: 'keyword', detail: 'Fallback conditional branch' },
  { label: 'foreach', type: 'keyword', detail: 'Iterate over an array' },
  { label: 'for', type: 'keyword', detail: 'For loop' },
  { label: 'while', type: 'keyword', detail: 'While loop' },
  { label: 'try', type: 'keyword', detail: 'Start exception handling' },
  { label: 'catch', type: 'keyword', detail: 'Handle an exception' },
  { label: 'throw', type: 'keyword', detail: 'Throw an exception' },
  { label: 'use', type: 'keyword', detail: 'Import a namespace or trait' },
  { label: 'namespace', type: 'keyword', detail: 'Declare a namespace' },
  { label: 'interface', type: 'keyword', detail: 'Declare an interface' },
  { label: 'trait', type: 'keyword', detail: 'Declare a trait' },
  { label: 'extends', type: 'keyword', detail: 'Extend a class' },
  { label: 'implements', type: 'keyword', detail: 'Implement an interface' },
  { label: 'include', type: 'keyword', detail: 'Include a PHP file' },
  { label: 'require', type: 'keyword', detail: 'Require a PHP file' },
  { label: 'count', type: 'function', detail: 'Count items in an array or Countable' },
  { label: 'array_map', type: 'function', detail: 'Apply a callback to array values' },
  { label: 'array_filter', type: 'function', detail: 'Filter array values using a callback' },
  { label: 'array_merge', type: 'function', detail: 'Merge one or more arrays' },
  { label: 'in_array', type: 'function', detail: 'Check whether a value exists in an array' },
  { label: 'isset', type: 'function', detail: 'Check whether a variable is set' },
  { label: 'empty', type: 'function', detail: 'Check whether a value is empty' },
  { label: 'strlen', type: 'function', detail: 'Get string length' },
  { label: 'str_replace', type: 'function', detail: 'Replace text in a string' },
  { label: 'explode', type: 'function', detail: 'Split a string into an array' },
  { label: 'implode', type: 'function', detail: 'Join array values into a string' },
  { label: 'trim', type: 'function', detail: 'Remove whitespace from a string' },
  { label: 'htmlspecialchars', type: 'function', detail: 'Escape HTML special characters' },
  { label: 'json_encode', type: 'function', detail: 'Encode a value as JSON' },
  { label: 'json_decode', type: 'function', detail: 'Decode a JSON string' },
  { label: 'preg_match', type: 'function', detail: 'Perform a regular-expression match' },
  { label: 'filter_var', type: 'function', detail: 'Filter a value' },
  { label: 'header', type: 'function', detail: 'Send an HTTP response header' },
  { label: 'http_response_code', type: 'function', detail: 'Get or set HTTP response code' },
  { label: 'password_hash', type: 'function', detail: 'Create a password hash' },
  { label: 'password_verify', type: 'function', detail: 'Verify a password against a hash' },
  { label: 'file_get_contents', type: 'function', detail: 'Read a file into a string' },
  { label: 'file_put_contents', type: 'function', detail: 'Write data to a file' },
  { label: 'var_dump', type: 'function', detail: 'Inspect a value' },
  { label: 'print_r', type: 'function', detail: 'Display structured information' },
  { label: 'DateTime', type: 'class', detail: 'Date and time representation' },
  { label: 'Exception', type: 'class', detail: 'Base exception class' },
  { label: '$this', type: 'variable', detail: 'Current object' },
  { label: '$_GET', type: 'variable', detail: 'Query-string values' },
  { label: '$_POST', type: 'variable', detail: 'Submitted form values' },
  { label: '$_REQUEST', type: 'variable', detail: 'Request values' },
  { label: '$_SERVER', type: 'variable', detail: 'Server and request information' },
  { label: '$_SESSION', type: 'variable', detail: 'Session values' },
  { label: '$_COOKIE', type: 'variable', detail: 'Cookie values' },
  { label: '$_FILES', type: 'variable', detail: 'Uploaded files' },
  { label: '$_ENV', type: 'variable', detail: 'Environment values' },
];

let phpRegistered = false;

export function registerPhpCompletion(): void {
  if (phpRegistered) return;
  phpRegistered = true;
  monaco.languages.registerCompletionItemProvider('php', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: phpCompletions.map((item) => ({
          label: item.label,
          kind: item.type === 'function'
            ? monaco.languages.CompletionItemKind.Function
            : item.type === 'class'
              ? monaco.languages.CompletionItemKind.Class
              : item.type === 'variable'
                ? monaco.languages.CompletionItemKind.Variable
                : monaco.languages.CompletionItemKind.Keyword,
          detail: item.detail,
          insertText: item.label,
          range,
        })),
      };
    },
  });
}

const tokenRules = (theme: ThemeDefinition): monaco.editor.ITokenThemeRule[] => {
  const c = theme.colors;
  return [
    { token: 'keyword', foreground: c.keyword },
    { token: 'keyword.control', foreground: c.control },
    { token: 'string', foreground: c.string },
    { token: 'number', foreground: c.number },
    { token: 'constant', foreground: c.number },
    { token: 'comment', foreground: c.comment, fontStyle: 'italic' },
    { token: 'type', foreground: c.type },
    { token: 'type.identifier', foreground: c.type },
    { token: 'identifier', foreground: c.text },
    { token: 'function', foreground: c.function },
    { token: 'variable', foreground: c.property },
    { token: 'variable.predefined', foreground: c.property },
    { token: 'property', foreground: c.property },
    { token: 'attribute.name', foreground: c.attribute },
    { token: 'attribute.value', foreground: c.attribute },
    { token: 'tag', foreground: c.tag },
    { token: 'delimiter', foreground: c.operator },
    { token: 'operator', foreground: c.operator },
    { token: 'metatag', foreground: c.meta },
    { token: 'invalid', foreground: c.invalid, background: c.invalidBackground },
  ];
};

export function applyArcTheme(theme: ThemeDefinition): void {
  const c = theme.colors;
  monaco.editor.defineTheme(`arc-${theme.id}`, {
    base: 'vs-dark',
    inherit: true,
    rules: tokenRules(theme),
    colors: {
      'editor.background': c.editor,
      'editor.foreground': c.text,
      'editorLineNumber.foreground': c.lineNumber,
      'editorLineNumber.activeForeground': c.text,
      'editor.lineHighlightBackground': c.activeLine,
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': c.cursor,
      'editor.selectionBackground': c.selection,
      'editor.inactiveSelectionBackground': c.selection,
      'editor.selectionHighlightBackground': c.selection,
      'editorIndentGuide.background1': c.indentGuide,
      'editorIndentGuide.activeBackground1': c.border,
      'editorWidget.background': c.raised,
      'editorWidget.border': c.border,
      'editorSuggestWidget.background': c.raised,
      'editorSuggestWidget.border': c.border,
      'editorSuggestWidget.selectedBackground': c.selected,
      'editorSuggestWidget.foreground': c.text,
      'editorHoverWidget.background': c.raised,
      'editorHoverWidget.border': c.border,
      'editorGutter.background': c.editor,
      'editorBracketMatch.background': c.selected,
      'editorBracketMatch.border': c.border,
      'editorError.foreground': c.error,
      'editorWarning.foreground': c.warning,
      'editorInfo.foreground': c.accent,
      'editorOverviewRuler.border': '#00000000',
      'scrollbarSlider.background': `${c.border}80`,
      'scrollbarSlider.hoverBackground': c.border,
    },
  });
  monaco.editor.setTheme(`arc-${theme.id}`);
}

export function offsetToPosition(model: monaco.editor.ITextModel, offset: number): monaco.Position {
  return model.getPositionAt(Math.max(0, Math.min(offset, model.getValueLength())));
}

export function positionToOffset(model: monaco.editor.ITextModel, position: monaco.Position): number {
  return model.getOffsetAt(position);
}

export function wordRangeAt(model: monaco.editor.ITextModel, position: monaco.Position): monaco.Range {
  const word = model.getWordAtPosition(position);
  if (!word) return new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
  return new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
}

export function expandDocumentTemplate(editor: EditorViewHandle, extension: string): boolean {
  if (!['html', 'htm', 'php'].includes(extension)) return false;
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection || !selection.isEmpty()) return false;
  if (selection.positionLineNumber !== model.getLineCount() || selection.positionColumn !== model.getLineMaxColumn(model.getLineCount())) return false;
  const text = model.getValue();
  if (!/^\s*!\s*$/.test(text)) return false;
  const phpFile = extension === 'php';
  const phpBlock = phpFile ? '<?php\n\n?>\n' : '';
  const template = `${phpBlock}<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Document</title>\n</head>\n<body>\n\n</body>\n</html>`;
  const cursor = phpFile ? '<?php\n'.length : template.indexOf('<body>\n') + '<body>\n'.length;
  editor.executeEdits('arc-template', [{ range: model.getFullModelRange(), text: template, forceMoveMarkers: true }]);
  const position = model.getPositionAt(cursor);
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  return true;
}

const decorationCollections = new WeakMap<EditorViewHandle, Map<string, monaco.editor.IEditorDecorationsCollection>>();

export function setEditorDecorations(
  editor: EditorViewHandle,
  key: string,
  ranges: { from: number; to: number }[],
  options: { className?: string; style?: string },
): void {
  const model = editor.getModel();
  if (!model) return;
  let collections = decorationCollections.get(editor);
  if (!collections) {
    collections = new Map();
    decorationCollections.set(editor, collections);
  }
  let collection = collections.get(key);
  if (!collection) {
    collection = editor.createDecorationsCollection([]);
    collections.set(key, collection);
  }
  collection.set(ranges.map((range) => ({
    range: new monaco.Range(
      model.getPositionAt(range.from).lineNumber,
      model.getPositionAt(range.from).column,
      model.getPositionAt(range.to).lineNumber,
      model.getPositionAt(range.to).column,
    ),
    options: {
      inlineClassName: options.className,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  })));
}

export function clearEditorDecorations(editor: EditorViewHandle, key: string): void {
  decorationCollections.get(editor)?.delete(key);
}
