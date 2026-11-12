import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Decoration,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  ViewPlugin,
  type DecorationSet,
} from '@codemirror/view';
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  Transaction,
  type Extension,
} from '@codemirror/state';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  copyFile,
  exists,
  mkdir,
  open as openFs,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { Plugin } from 'prettier';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  File,
  FilePlus2,
  Folder,
  FolderOpen,
  Github,
  Globe,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Search,
  Server,
  Settings as SettingsIcon,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react';
import {
  SiCss,
  SiHtml5,
  SiJavascript,
  SiJson,
  SiMarkdown,
  SiPhp,
  SiReact,
  SiSass,
  SiSvg,
  SiTypescript,
  SiYaml,
} from 'react-icons/si';
import { appDataDir, join } from '@tauri-apps/api/path';
import TitleBar from './TitleBar';
import './pluginExtensions.css';
import './panel-layout.css';
import { forgetTerminalOutput } from './terminalOutput';
import {
  usePluginRuntime,
  type PluginAppSnapshot,
  type PluginCommandDefinition,
  type PluginContextMenuItem,
  type PluginEditorContext,
  type PluginLanguageContribution,
  type PluginPanelContribution,
  type PluginStatusItem,
  type PluginToolbarAction,
} from './pluginRuntime';
import {
  APP_SETTINGS_VERSION,
  BUILTIN_THEMES,
  DEFAULT_THEME,
  isThemeDefinition,
  loadSettings,
  themeCss,
  type AppSettings,
  type ThemeDefinition,
} from './settings';

const TerminalView = lazy(() => import('./TerminalView'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));
const GithubPanel = lazy(() => import('./GithubPanel'));
const PluginPanel = lazy(() => import('./PluginPanel'));
const ThemeMaker = lazy(() => import('./ThemeMaker'));

type DiskFile = { name: string; path: string; kind: 'file' | 'directory' };
type FsEvent = {
  root: string;
  kind: 'created' | 'removed' | 'renamed' | 'modified';
  paths: string[];
  isDir?: boolean;
};
type OpenFile = {
  path: string;
  name: string;
  revision: number;
  dirty: boolean;
};
type EditorFile = OpenFile & { content: string };
type TerminalSession = {
  id: string;
  key: string;
  cwd: string;
  title: string;
  command?: string;
};
type TreeNode = DiskFile & { children?: TreeNode[] };
type GroupId = string;
type EditorGroup = { id: GroupId; activePath: string; tabs: string[] };
type SplitDirection = 'vertical' | 'horizontal';
type SplitPlacement = { direction: SplitDirection; after: boolean };
type LayoutNode =
  | { type: 'group'; groupId: GroupId }
  | {
      type: 'split';
      id: string;
      direction: SplitDirection;
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };
type NewItemKind = 'file' | 'folder';
type ContextMenuState = { x: number; y: number; target?: DiskFile };
type FileClipboard = { entries: DiskFile[]; workspace: string };
type DeletedEntry = {
  originalPath: string;
  trashedPath: string;
  entry: DiskFile;
};
type UndoBatch = { workspace: string; entries: DeletedEntry[] };
const GITHUB_TAB_KEY = 'internal:github';
const PLUGIN_TAB_KEY = 'internal:plugins';
const PLUGIN_VIEW_PREFIX = 'internal:plugin-view:';
const MIN_VIEWER_WIDTH = 140;

function PluginViewHost({ panel }: { panel: PluginPanelContribution }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!container.current) return;
    try {
      const cleanup = panel.mount(container.current);
      return () => cleanup?.();
    } catch (cause) {
      setError(String(cause));
    }
  }, [panel]);
  return (
    <div className="plugin-view-host" ref={container}>
      {error && (
        <div className="message error">Plugin panel failed: {error}</div>
      )}
    </div>
  );
}

async function requestWorkspaceAccess(root: string): Promise<boolean> {
  const alreadyAllowed = await invoke<boolean>('workspace_access_allowed', {
    root,
  });
  if (alreadyAllowed) return true;
  const approved = window.confirm(
    `Arc needs permission to read and edit files in this folder and its subfolders:\n\n${root}\n\nGrant access for this app session?`,
  );
  if (!approved) return false;
  await invoke('workspace_grant_access', { root });
  return true;
}

function matchesPluginShortcut(
  event: KeyboardEvent,
  shortcut: string,
): boolean {
  const parts = shortcut
    .toLowerCase()
    .split('+')
    .map((part) => part.trim());
  const key = parts.find(
    (part) => !['ctrl', 'cmd', 'meta', 'shift', 'alt', 'option'].includes(part),
  );
  if (!key) return false;
  const expectsControl = parts.some((part) =>
    ['ctrl', 'cmd', 'meta'].includes(part),
  );
  const expectsShift = parts.includes('shift');
  const expectsAlt = parts.some((part) => ['alt', 'option'].includes(part));
  return (
    (event.ctrlKey || event.metaKey) === expectsControl &&
    event.shiftKey === expectsShift &&
    event.altKey === expectsAlt &&
    event.key.toLowerCase() === key
  );
}

function insertSplit(
  layout: LayoutNode,
  targetId: GroupId,
  newGroupId: GroupId,
  placement: SplitPlacement,
  splitId: string,
): LayoutNode {
  if (layout.type === 'group') {
    if (layout.groupId !== targetId) return layout;
    const newGroup: LayoutNode = { type: 'group', groupId: newGroupId };
    return {
      type: 'split',
      id: splitId,
      direction: placement.direction,
      ratio: 0.5,
      first: placement.after ? layout : newGroup,
      second: placement.after ? newGroup : layout,
    };
  }
  const first = insertSplit(
    layout.first,
    targetId,
    newGroupId,
    placement,
    splitId,
  );
  if (first !== layout.first) return { ...layout, first };
  const second = insertSplit(
    layout.second,
    targetId,
    newGroupId,
    placement,
    splitId,
  );
  return second !== layout.second ? { ...layout, second } : layout;
}

function pruneLayout(
  layout: LayoutNode,
  groupIds: Set<GroupId>,
): LayoutNode | null {
  if (layout.type === 'group')
    return groupIds.has(layout.groupId) ? layout : null;
  const first = pruneLayout(layout.first, groupIds);
  const second = pruneLayout(layout.second, groupIds);
  if (!first) return second;
  if (!second) return first;
  return { ...layout, first, second };
}

function resizeLayout(
  layout: LayoutNode,
  splitId: string,
  ratio: number,
): LayoutNode {
  if (layout.type === 'group') return layout;
  if (layout.id === splitId) return { ...layout, ratio };
  return {
    ...layout,
    first: resizeLayout(layout.first, splitId, ratio),
    second: resizeLayout(layout.second, splitId, ratio),
  };
}

function buildCodeHighlighting(theme: ThemeDefinition) {
  const c = theme.colors;
  return HighlightStyle.define([
    { tag: tags.keyword, color: c.keyword },
    { tag: [tags.controlKeyword, tags.definitionKeyword], color: c.control },
    { tag: [tags.string, tags.special(tags.string)], color: c.string },
    { tag: [tags.number, tags.bool, tags.null], color: c.number },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: c.function,
    },
    { tag: [tags.typeName, tags.className, tags.namespace], color: c.type },
    { tag: [tags.propertyName, tags.attributeName], color: c.property },
    { tag: [tags.tagName, tags.self], color: c.tag },
    { tag: tags.attributeValue, color: c.attribute },
    {
      tag: [tags.operator, tags.punctuation, tags.separator],
      color: c.operator,
    },
    { tag: tags.comment, color: c.comment, fontStyle: 'italic' },
    { tag: tags.meta, color: c.meta },
    {
      tag: tags.invalid,
      color: c.invalid,
      backgroundColor: c.invalidBackground,
    },
  ]);
}

const externalContentUpdate = Annotation.define<boolean>();

const indentGuideMark = Decoration.mark({ class: 'cm-indent-guide' });
const leadingIndentation = /^[\t ]+/;

function buildIndentGuides(view: EditorView, tabSize: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const visible of view.visibleRanges) {
    let position = visible.from;
    while (position <= visible.to) {
      const line = view.state.doc.lineAt(position);
      const indentation = leadingIndentation.exec(line.text)?.[0] ?? '';
      if (indentation.length >= tabSize)
        builder.add(line.from, line.from + indentation.length, indentGuideMark);
      if (line.to >= visible.to) break;
      position = line.to + 1;
    }
  }
  return builder.finish();
}

function indentationGuides(tabSize: number) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildIndentGuides(view, tabSize);
      }

      update(update: {
        docChanged: boolean;
        viewportChanged: boolean;
        view: EditorView;
      }) {
        if (update.docChanged || update.viewportChanged)
          this.decorations = buildIndentGuides(update.view, tabSize);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

const phpCompletions = [
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
  {
    label: 'count',
    type: 'function',
    detail: 'Count items in an array or Countable',
  },
  {
    label: 'array_map',
    type: 'function',
    detail: 'Apply a callback to array values',
  },
  {
    label: 'array_filter',
    type: 'function',
    detail: 'Filter array values using a callback',
  },
  {
    label: 'array_merge',
    type: 'function',
    detail: 'Merge one or more arrays',
  },
  {
    label: 'in_array',
    type: 'function',
    detail: 'Check whether a value exists in an array',
  },
  {
    label: 'isset',
    type: 'function',
    detail: 'Check whether a variable is set',
  },
  {
    label: 'empty',
    type: 'function',
    detail: 'Check whether a value is empty',
  },
  { label: 'strlen', type: 'function', detail: 'Get string length' },
  {
    label: 'str_replace',
    type: 'function',
    detail: 'Replace text in a string',
  },
  {
    label: 'explode',
    type: 'function',
    detail: 'Split a string into an array',
  },
  {
    label: 'implode',
    type: 'function',
    detail: 'Join array values into a string',
  },
  {
    label: 'trim',
    type: 'function',
    detail: 'Remove whitespace from a string',
  },
  {
    label: 'htmlspecialchars',
    type: 'function',
    detail: 'Escape HTML special characters',
  },
  { label: 'json_encode', type: 'function', detail: 'Encode a value as JSON' },
  { label: 'json_decode', type: 'function', detail: 'Decode a JSON string' },
  {
    label: 'preg_match',
    type: 'function',
    detail: 'Perform a regular-expression match',
  },
  { label: 'filter_var', type: 'function', detail: 'Filter a value' },
  { label: 'header', type: 'function', detail: 'Send an HTTP response header' },
  {
    label: 'http_response_code',
    type: 'function',
    detail: 'Get or set HTTP response code',
  },
  {
    label: 'password_hash',
    type: 'function',
    detail: 'Create a password hash',
  },
  {
    label: 'password_verify',
    type: 'function',
    detail: 'Verify a password against a hash',
  },
  {
    label: 'file_get_contents',
    type: 'function',
    detail: 'Read a file into a string',
  },
  {
    label: 'file_put_contents',
    type: 'function',
    detail: 'Write data to a file',
  },
  { label: 'var_dump', type: 'function', detail: 'Inspect a value' },
  {
    label: 'print_r',
    type: 'function',
    detail: 'Display structured information',
  },
  { label: 'DateTime', type: 'class', detail: 'Date and time representation' },
  { label: 'Exception', type: 'class', detail: 'Base exception class' },
  { label: '$this', type: 'variable', detail: 'Current object' },
  { label: '$_GET', type: 'variable', detail: 'Query-string values' },
  { label: '$_POST', type: 'variable', detail: 'Submitted form values' },
  { label: '$_REQUEST', type: 'variable', detail: 'Request values' },
  {
    label: '$_SERVER',
    type: 'variable',
    detail: 'Server and request information',
  },
  { label: '$_SESSION', type: 'variable', detail: 'Session values' },
  { label: '$_COOKIE', type: 'variable', detail: 'Cookie values' },
  { label: '$_FILES', type: 'variable', detail: 'Uploaded files' },
  { label: '$_ENV', type: 'variable', detail: 'Environment values' },
];

function phpCompletion(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[$A-Za-z_][\w$]*/);
  if (!word && !context.explicit) return null;
  return {
    from: word?.from ?? context.pos,
    options: phpCompletions,
    validFor: /^[$A-Za-z_][\w$]*$/,
  };
}

function expandDocumentTemplate(view: EditorView, extension: string): boolean {
  if (!['html', 'htm', 'php'].includes(extension)) return false;
  const document = view.state.doc.toString();
  const selection = view.state.selection.main;
  if (
    selection.from !== document.length ||
    selection.to !== document.length ||
    !/^\s*!\s*$/.test(document)
  )
    return false;

  const phpFile = extension === 'php';
  const phpBlock = phpFile ? '<?php\n\n?>\n' : '';
  const template = `${phpBlock}<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Document</title>\n</head>\n<body>\n\n</body>\n</html>`;
  const cursor = phpFile
    ? '<?php\n'.length
    : template.indexOf('<body>\n') + '<body>\n'.length;
  view.dispatch({
    changes: { from: 0, to: document.length, insert: template },
    selection: { anchor: cursor },
    scrollIntoView: true,
  });
  return true;
}

const extensionOf = (name: string) =>
  name.split('.').pop()?.toLowerCase() ?? '';

function contentFingerprint(value: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x85ebca6b);
  }
  return `${value.length}:${(hashA >>> 0).toString(36)}:${(hashB >>> 0).toString(36)}`;
}

async function prettierFormat(
  name: string,
  content: string,
): Promise<string | null> {
  const ext = extensionOf(name);
  let parser: string;
  let plugins: Plugin[];
  if (['html', 'htm', 'svg', 'vue'].includes(ext)) {
    parser = 'html';
    plugins = [await import('prettier/plugins/html')];
  } else if (['css', 'scss'].includes(ext)) {
    parser = ext === 'scss' ? 'scss' : 'css';
    plugins = [await import('prettier/plugins/postcss')];
  } else if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) {
    parser = 'babel';
    plugins = await Promise.all([
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ]);
  } else if (['ts', 'mts', 'cts', 'tsx'].includes(ext)) {
    parser = 'typescript';
    plugins = await Promise.all([
      import('prettier/plugins/typescript'),
      import('prettier/plugins/estree'),
    ]);
  } else if (['json', 'jsonc'].includes(ext)) {
    parser = 'json';
    plugins = await Promise.all([
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ]);
  } else if (['md', 'mdx'].includes(ext)) {
    parser = ext === 'mdx' ? 'mdx' : 'markdown';
    plugins = [await import('prettier/plugins/markdown')];
  } else if (['yaml', 'yml'].includes(ext)) {
    parser = 'yaml';
    plugins = [await import('prettier/plugins/yaml')];
  } else {
    return null;
  }
  const prettier = await import('prettier/standalone');
  return prettier.format(content, {
    parser,
    plugins,
    tabWidth: 2,
    useTabs: false,
    singleQuote: true,
  });
}

function makeTree(files: DiskFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const directories = new Map<string, TreeNode>();
  const depthOf = (path: string) => path.split('/').length;
  for (const file of [...files].sort((a, b) => {
    const depth = depthOf(a.path) - depthOf(b.path);
    if (depth !== 0) return depth;
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  })) {
    const parentPath = file.path.split('/').slice(0, -1).join('/');
    const parent = directories.get(parentPath);
    const node: TreeNode = {
      ...file,
      ...(file.kind === 'directory' ? { children: [] } : {}),
    };
    (parent?.children ?? root).push(node);
    if (file.kind === 'directory') directories.set(file.path, node);
  }
  return root;
}

function removeNestedEntries(entries: DiskFile[]): DiskFile[] {
  const directories = new Set(
    entries
      .filter((entry) => entry.kind === 'directory')
      .map((entry) => entry.path),
  );
  return entries.filter((entry) => {
    let parent = entry.path.split('/').slice(0, -1).join('/');
    while (parent) {
      if (directories.has(parent)) return false;
      parent = parent.split('/').slice(0, -1).join('/');
    }
    return true;
  });
}

function FileIcon({ name }: { name: string }) {
  const ext = extensionOf(name);
  if (['html', 'htm'].includes(ext))
    return <SiHtml5 className="file-icon icon-html" />;
  if (ext === 'php') return <SiPhp className="file-icon icon-php" />;
  if (ext === 'css') return <SiCss className="file-icon icon-css" />;
  if (ext === 'scss') return <SiSass className="file-icon icon-scss" />;
  if (['jsx', 'tsx'].includes(ext))
    return <SiReact className="file-icon icon-react" />;
  if (['js', 'mjs', 'cjs'].includes(ext))
    return <SiJavascript className="file-icon icon-js" />;
  if (['ts', 'mts', 'cts'].includes(ext))
    return <SiTypescript className="file-icon icon-ts" />;
  if (['json', 'jsonc'].includes(ext))
    return <SiJson className="file-icon icon-json" />;
  if (['md', 'mdx'].includes(ext))
    return <SiMarkdown className="file-icon icon-md" />;
  if (ext === 'svg') return <SiSvg className="file-icon icon-svg" />;
  if (['yaml', 'yml'].includes(ext))
    return <SiYaml className="file-icon icon-yaml" />;
  return <File size={14} className="file-icon" />;
}

function PluginToolbarIcon({ name, svg }: { name?: string; svg?: string }) {
  if (svg)
    return (
      <span
        className="plugin-svg-icon"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  if (name === 'server') return <Server size={15} />;
  if (name === 'globe') return <Globe size={15} />;
  return <Puzzle size={15} />;
}

async function loadCodeLanguage(extension: string): Promise<Extension> {
  const aliases: Record<string, string> = {
    html: 'html',
    css: 'css',
    scss: 'scss',
    javascript: 'js',
    typescript: 'ts',
    json: 'json',
    jsonc: 'jsonc',
    markdown: 'md',
    php: 'php',
  };
  extension = aliases[extension] ?? extension;
  if (['html', 'htm', 'svg'].includes(extension))
    return (await import('@codemirror/lang-html')).html();
  if (extension === 'php') {
    const { php, phpLanguage } = await import('@codemirror/lang-php');
    return [php(), phpLanguage.data.of({ autocomplete: phpCompletion })];
  }
  if (['css', 'scss'].includes(extension))
    return (await import('@codemirror/lang-css')).css();
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'].includes(extension)) {
    return (await import('@codemirror/lang-javascript')).javascript({
      jsx: true,
      typescript: ['ts', 'tsx'].includes(extension),
    });
  }
  if (['json', 'jsonc'].includes(extension))
    return (await import('@codemirror/lang-json')).json();
  if (['md', 'mdx'].includes(extension))
    return (await import('@codemirror/lang-markdown')).markdown();
  return [];
}

function EditorPane({
  group,
  file,
  activeTerminal,
  terminals,
  files,
  onActivate,
  onChange,
  onClose,
  onDropFile,
  canCreateSplit,
  onSelect,
  onTerminalTitleChange,
  workspace,
  diskConflict,
  onConflictReload,
  onConflictKeep,
  pluginPanel,
  pluginViews,
  editorViews,
  pluginLanguages,
  pluginLanguageOverrides,
  pluginEditorExtensions,
  pluginGrammarFor,
  pluginGrammarVersion,
  onSelectionChange,
  settings,
  theme,
}: {
  group: EditorGroup;
  file?: EditorFile;
  activeTerminal?: TerminalSession;
  terminals: TerminalSession[];
  files: OpenFile[];
  onActivate: (id: GroupId) => void;
  onChange: (path: string, content: string) => void;
  onClose: (id: GroupId, path: string) => void;
  onDropFile: (id: GroupId, path: string, placement?: SplitPlacement) => void;
  canCreateSplit: boolean;
  onSelect: (id: GroupId, path: string) => void;
  onTerminalTitleChange: (id: string, title: string) => void;
  workspace: string;
  diskConflict?: boolean;
  onConflictReload?: (path: string) => void;
  onConflictKeep?: (path: string) => void;
  pluginPanel: ReactNode;
  pluginViews: PluginPanelContribution[];
  editorViews: { current: Map<string, Map<GroupId, EditorView>> };
  pluginLanguages: PluginLanguageContribution[];
  pluginLanguageOverrides: Record<string, string>;
  pluginEditorExtensions: Extension;
  pluginGrammarFor: (languageId: string) => Extension | Promise<Extension> | undefined;
  pluginGrammarVersion: number;
  onSelectionChange?: (path: string) => void;
  settings: AppSettings;
  theme: ThemeDefinition;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const snapshot = useRef<{
    path: string;
    selection: EditorSelection;
    scrollTop: number;
    scrollLeft: number;
  } | null>(null);
  const [compartments] = useState(() => ({
    settings: new Compartment(),
    theme: new Compartment(),
    language: new Compartment(),
  }));
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (!file || !host.current) {
      view.current?.destroy();
      view.current = null;
      return;
    }

    view.current?.destroy();
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: file.content,
        extensions: [
          history(),
          highlightSelectionMatches(),
          compartments.settings.of([]),
          compartments.theme.of([]),
          compartments.language.of([]),
          pluginEditorExtensions,
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) =>
                transaction.annotation(externalContentUpdate),
              )
            ) {
              onChange(file.path, update.state.doc.toString());
            }
            if (update.selectionSet || update.docChanged || update.focusChanged)
              onSelectionChangeRef.current?.(file.path);
          }),
          EditorView.domEventHandlers({
            focus: () => {
              onActivate(group.id);
              return false;
            },
          }),
        ],
        selection:
          snapshot.current?.path === file.path
            ? snapshot.current.selection
            : undefined,
      }),
    });
    view.current = editor;
    const views = editorViews.current.get(file.path) ?? new Map<GroupId, EditorView>();
    views.set(group.id, editor);
    editorViews.current.set(file.path, views);
    if (snapshot.current?.path === file.path) {
      const previous = snapshot.current;
      requestAnimationFrame(() => {
        if (view.current === editor) {
          editor.scrollDOM.scrollTop = previous.scrollTop;
          editor.scrollDOM.scrollLeft = previous.scrollLeft;
        }
      });
    }
    return () => {
      snapshot.current = {
        path: file.path,
        selection: editor.state.selection,
        scrollTop: editor.scrollDOM.scrollTop,
        scrollLeft: editor.scrollDOM.scrollLeft,
      };
      editor.destroy();
      const views = editorViews.current.get(file.path);
      if (views?.get(group.id) === editor) {
        views.delete(group.id);
        if (!views.size) editorViews.current.delete(file.path);
      }
      if (view.current === editor) view.current = null;
    };
  }, [editorViews, file?.path, group.id, onActivate, onChange, pluginEditorExtensions]);

  useEffect(() => {
    const editor = view.current;
    if (!file || !editor) return;
    let cancelled = false;
    const extension = extensionOf(file.name);
    const override = pluginLanguageOverrides[file.path];
    const contribution =
      pluginLanguages.find((entry) => entry.id === override) ??
      pluginLanguages.find(
        (entry) =>
          (entry.extensions ?? []).some(
            (value) => value.toLowerCase() === extension,
          ) ||
          (entry.filenames ?? []).some(
            (value) => value.toLowerCase() === file.name.toLowerCase(),
          ),
      );
    void (async () => {
      const language = contribution
        ? await Promise.resolve(contribution.load())
        : await loadCodeLanguage(override ?? extension);
      const grammarIds = [contribution?.id, contribution?.id.split(':').at(-1), override, extension].filter((value): value is string => Boolean(value));
      const grammar = grammarIds.map((id) => pluginGrammarFor(id)).find(Boolean);
      const resolvedGrammar = grammar ? await Promise.resolve(grammar) : undefined;
      return resolvedGrammar ? [language, resolvedGrammar] : language;
    })()
      .then((language) => {
        if (!cancelled && view.current === editor)
          editor.dispatch({
            effects: compartments.language.reconfigure(language),
          });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [compartments.language, file?.path, file?.name, pluginLanguageOverrides, pluginLanguages, pluginGrammarFor, pluginGrammarVersion]);

  useEffect(() => {
    const editor = view.current;
    if (!file || !editor) return;
    const extension = extensionOf(file.name);
    const isCss = ['css', 'scss'].includes(extension);
    editor.dispatch({
      effects: compartments.settings.reconfigure([
        EditorState.tabSize.of(settings.tabSize),
        indentUnit.of(' '.repeat(settings.tabSize)),
        ...(settings.lineNumbers ? [lineNumbers()] : []),
        keymap.of([
          ...(settings.autoCloseBrackets ? closeBracketsKeymap : []),
          {
            key: 'Tab',
            run: (view) => expandDocumentTemplate(view, extension),
          },
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        ...(settings.bracketMatching ? [bracketMatching()] : []),
        ...(settings.autoCloseBrackets ? [closeBrackets()] : []),
        ...(settings.autoIndent ? [indentOnInput()] : []),
        ...(settings.activeLine
          ? [highlightActiveLine(), highlightActiveLineGutter()]
          : []),
        ...(settings.indentGuides && !isCss
          ? [indentationGuides(settings.tabSize)]
          : []),
        ...(settings.wordWrap ? [EditorView.lineWrapping] : []),
        ...(settings.autocomplete ? [autocompletion()] : []),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: settings.fontFamily,
            fontSize: `${settings.fontSize}px`,
            lineHeight: String(settings.lineHeight),
          },
          '.cm-tooltip-autocomplete ul': {
            fontFamily: settings.fontFamily,
            fontSize: '12px',
            maxHeight: '250px',
          },
          '.cm-tooltip-autocomplete ul li': {
            padding: '3px 8px',
            lineHeight: '20px',
          },
          '.cm-focused': { outline: 'none' },
        }),
      ]),
    });
  }, [
    compartments.settings,
    file?.path,
    file?.name,
    settings.tabSize,
    settings.lineNumbers,
    settings.autoCloseBrackets,
    settings.bracketMatching,
    settings.autoIndent,
    settings.activeLine,
    settings.indentGuides,
    settings.wordWrap,
    settings.autocomplete,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
  ]);

  useEffect(() => {
    const editor = view.current;
    if (!file || !editor) return;
    editor.dispatch({
      effects: compartments.theme.reconfigure([
        syntaxHighlighting(buildCodeHighlighting(theme)),
        EditorView.theme({
          '&': {
            backgroundColor: theme.colors.editor,
            color: theme.colors.text,
          },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            color: theme.colors.lineNumber,
            border: 'none',
            paddingRight: '13px',
          },
          '.cm-activeLineGutter': {
            color: theme.colors.secondaryText,
            backgroundColor: theme.colors.activeLine,
          },
          '.cm-activeLine': { backgroundColor: theme.colors.activeLine },
          '.cm-cursor': {
            borderLeftColor: `${theme.colors.cursor} !important`,
            borderLeftWidth: '2px',
            opacity: '1',
            filter: `drop-shadow(0 0 2px ${theme.colors.cursor})`,
          },
          '&.cm-focused .cm-cursor': {
            borderLeftColor: `${theme.colors.cursor} !important`,
            borderLeftWidth: '2px',
            opacity: '1',
          },
          '.cm-selectionBackground, ::selection': {
            backgroundColor: `${theme.colors.selection} !important`,
          },
          '.cm-tooltip': {
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.raised,
            color: theme.colors.text,
            boxShadow: 'none',
          },
          '.cm-tooltip-autocomplete ul li[aria-selected]': {
            backgroundColor: theme.colors.selected,
            color: theme.colors.text,
          },
          '.cm-completionIcon': { display: 'none' },
          '.cm-completionLabel': { color: theme.colors.text },
          '.cm-completionDetail': {
            color: theme.colors.muted,
            fontStyle: 'normal',
            marginLeft: '12px',
          },
        }),
      ]),
    });
  }, [compartments.theme, file?.path, theme]);

  useEffect(() => {
    if (!file || !view.current) return;
    const editor = view.current;
    const current = editor.state.doc.toString();
    if (current !== file.content) {
      const scrollTop = editor.scrollDOM.scrollTop;
      const scrollLeft = editor.scrollDOM.scrollLeft;
      const length = file.content.length;
      const selection = EditorSelection.create(
        editor.state.selection.ranges.map((range) =>
          EditorSelection.range(
            Math.min(range.anchor, length),
            Math.min(range.head, length),
          ),
        ),
        editor.state.selection.mainIndex,
      );
      editor.dispatch({
        changes: { from: 0, to: current.length, insert: file.content },
        selection,
        annotations: [
          externalContentUpdate.of(true),
          Transaction.addToHistory.of(false),
        ],
      });
      const restoreScroll = () => {
        if (view.current !== editor) return;
        editor.scrollDOM.scrollTop = scrollTop;
        editor.scrollDOM.scrollLeft = scrollLeft;
      };
      restoreScroll();
      requestAnimationFrame(restoreScroll);
    }
  }, [file?.path, file?.revision]);

  const filesByPath = useMemo(
    () => new Map(files.map((entry) => [entry.path, entry])),
    [files],
  );
  const terminalsByKey = useMemo(
    () => new Map(terminals.map((entry) => [entry.key, entry])),
    [terminals],
  );
  const pluginViewsByKey = useMemo(
    () =>
      new Map(
        pluginViews.map((panel) => [`${PLUGIN_VIEW_PREFIX}${panel.id}`, panel]),
      ),
    [pluginViews],
  );
  const tabItems = useMemo(
    () =>
      group.tabs
        .map((key) => ({
          key,
          file: filesByPath.get(key),
          terminal: terminalsByKey.get(key),
          github: key === GITHUB_TAB_KEY,
          plugins: key === PLUGIN_TAB_KEY,
          pluginView: pluginViewsByKey.get(key),
        }))
        .filter(
          (entry) =>
            entry.file ||
            entry.terminal ||
            entry.github ||
            entry.plugins ||
            entry.pluginView,
        ),
    [filesByPath, group.tabs, pluginViewsByKey, terminalsByKey],
  );
  const groupTerminals = tabItems.flatMap((entry) =>
    entry.terminal ? [entry.terminal] : [],
  );

  return (
    <section
      className={`editor-pane ${dragActive ? 'drop-target' : ''}`}
      onMouseDown={() => onActivate(group.id)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        const editorTabPath = event.dataTransfer.getData(
          'application/x-arc-editor-tab',
        );
        const path =
          editorTabPath || event.dataTransfer.getData('application/x-arc-file');
        if (path) {
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = (event.clientX - bounds.left) / bounds.width;
          const y = (event.clientY - bounds.top) / bounds.height;
          const nearSide =
            canCreateSplit &&
            (editorTabPath || x < 0.22 || x > 0.78 || y < 0.22 || y > 0.78);
          const direction: SplitDirection =
            Math.min(x, 1 - x) < Math.min(y, 1 - y) ? 'vertical' : 'horizontal';
          const placement = nearSide
            ? {
                direction,
                after: direction === 'vertical' ? x > 0.5 : y > 0.5,
              }
            : undefined;
          onDropFile(group.id, path, placement);
        }
      }}
    >
      <div
        className="tab-strip"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragActive(false);
          const path =
            event.dataTransfer.getData('application/x-arc-editor-tab') ||
            event.dataTransfer.getData('application/x-arc-file');
          if (path) onDropFile(group.id, path);
        }}
      >
        {tabItems.map(
          ({ key, file: tab, terminal, github, plugins, pluginView }) => (
            <button
              key={key}
              className={`editor-tab ${key === group.activePath ? 'active' : ''}`}
              draggable={!pluginView}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-arc-editor-tab', key);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => onSelect(group.id, key)}
            >
              {terminal ? (
                <TerminalIcon size={14} className="file-icon" />
              ) : github ? (
                <Github size={14} className="file-icon" />
              ) : plugins || pluginView ? (
                <Puzzle size={14} className="file-icon" />
              ) : (
                <FileIcon name={tab!.name} />
              )}
              <span className="tab-name">
                {terminal
                  ? settings.terminalShowTitle
                    ? terminal.title
                    : 'Terminal'
                  : github
                    ? 'GitHub'
                    : plugins
                      ? 'Plugins'
                      : pluginView
                        ? pluginView.title
                        : tab!.name}
              </span>
              {tab?.dirty ? (
                <Circle size={8} className="dirty-dot" fill="currentColor" />
              ) : null}
              <span
                className="tab-close"
                title="Close editor (Ctrl+W)"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(group.id, key);
                }}
              >
                <X size={13} />
              </span>
            </button>
          ),
        )}
        <div className="tab-spacer" />
      </div>
      {file && diskConflict && (
        <div className="disk-conflict">
          <span>{file.name} changed on disk.</span>
          <button onClick={() => onConflictReload?.(file.path)}>Reload</button>
          <button onClick={() => onConflictKeep?.(file.path)}>Keep mine</button>
        </div>
      )}
      {file && <div className="editor-host" ref={host} />}
      {group.activePath === GITHUB_TAB_KEY && (
        <Suspense fallback={<div className="editor-empty" />}>
          <GithubPanel workspace={workspace} />
        </Suspense>
      )}
      {group.activePath === PLUGIN_TAB_KEY && pluginPanel}
      {pluginViewsByKey.has(group.activePath) && (
        <PluginViewHost panel={pluginViewsByKey.get(group.activePath)!} />
      )}
      {!file &&
        !activeTerminal &&
        group.activePath !== GITHUB_TAB_KEY &&
        group.activePath !== PLUGIN_TAB_KEY &&
        !pluginViewsByKey.has(group.activePath) && (
          <div className="editor-empty">
            <span>Choose a file to begin.</span>
            <span>Drop a file on an edge to split the editor.</span>
          </div>
        )}
      {groupTerminals.length > 0 && (
        <div className={`terminal-stack ${activeTerminal ? 'active' : ''}`}>
          {groupTerminals.map((session) => (
            <div
              key={session.id}
              className={`terminal-host ${activeTerminal?.id === session.id ? 'active' : ''}`}
            >
              {activeTerminal?.id === session.id && (
                <Suspense fallback={<div className="terminal-view" />}>
                  <TerminalView
                    session={session}
                    active
                    theme={theme}
                    settings={settings}
                    onTitleChange={onTerminalTitleChange}
                  />
                </Suspense>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SplitContainer({
  node,
  first,
  second,
  onResize,
}: {
  node: Extract<LayoutNode, { type: 'split' }>;
  first: ReactNode;
  second: ReactNode;
  onResize: (id: string, ratio: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    start: number;
    size: number;
    ratio: number;
    pending: number;
  } | null>(null);
  const frame = useRef<number | null>(null);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);
  const applyRatio = (ratio: number) => {
    const element = container.current;
    if (!element) return;
    const template = `${ratio}fr 5px ${1 - ratio}fr`;
    if (node.direction === 'vertical')
      element.style.gridTemplateColumns = template;
    else element.style.gridTemplateRows = template;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = {
      start: node.direction === 'vertical' ? event.clientX : event.clientY,
      size: node.direction === 'vertical' ? bounds.width : bounds.height,
      ratio: node.ratio,
      pending: node.ratio,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const coordinate =
      node.direction === 'vertical' ? event.clientX : event.clientY;
    const delta = (coordinate - current.start) / current.size;
    current.pending = Math.max(0.12, Math.min(0.88, current.ratio + delta));
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (drag.current) applyRatio(drag.current.pending);
    });
  };
  const finishResize = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    applyRatio(current.pending);
    onResize(node.id, current.pending);
  };
  const template =
    node.direction === 'vertical'
      ? `${node.ratio}fr 5px ${1 - node.ratio}fr`
      : `${node.ratio}fr 5px ${1 - node.ratio}fr`;

  return (
    <div
      ref={container}
      className={`split-container ${node.direction}`}
      style={
        node.direction === 'vertical'
          ? { gridTemplateColumns: template }
          : { gridTemplateRows: template }
      }
    >
      <div className="split-child">{first}</div>
      <div
        className={`split-divider ${node.direction}`}
        role="separator"
        aria-orientation={
          node.direction === 'vertical' ? 'vertical' : 'horizontal'
        }
        onPointerDown={onPointerDown}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerMove={onPointerMove}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={finishResize}
      >
        <span />
      </div>
      <div className="split-child">{second}</div>
    </div>
  );
}

function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [themes, setThemes] = useState<ThemeDefinition[]>(BUILTIN_THEMES);
  const [customThemeIds, setCustomThemeIds] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeMakerOpen, setThemeMakerOpen] = useState(false);
  const [workspace, setWorkspace] = useState('');
  const [files, setFiles] = useState<DiskFile[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const fileContents = useRef(new Map<string, string>());
  const [groups, setGroups] = useState<EditorGroup[]>([
    { id: 'group-1', activePath: '', tabs: [] },
  ]);
  const [diskConflicts, setDiskConflicts] = useState<Set<string>>(new Set());
  const watcherRoot = useRef('');
  const activeWatchRoot = useRef('');
  const watchGeneration = useRef(0);
  const fsEventQueue = useRef<FsEvent[]>([]);
  const fsApplyScheduled = useRef(false);
  const lastDiskWrite = useRef(new Map<string, string>());
  const allowedHiddenPaths = useRef(new Set<string>());
  const settingsRef = useRef<AppSettings>(settings);
  const openFilesRef = useRef<OpenFile[]>([]);
  const groupsRef = useRef<EditorGroup[]>([]);
  const processFsEventsRef = useRef<(events: FsEvent[]) => Promise<void>>(
    async () => undefined,
  );
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const editorViews = useRef(new Map<string, Map<GroupId, EditorView>>());
  const lastActiveEditorPath = useRef('');
  const [pluginLanguageOverrides, setPluginLanguageOverrides] = useState<
    Record<string, string>
  >({});
  const [layout, setLayout] = useState<LayoutNode>({
    type: 'group',
    groupId: 'group-1',
  });
  const [activeGroupId, setActiveGroupId] = useState<GroupId>('group-1');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedDirectory, setSelectedDirectory] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [newItemKind, setNewItemKind] = useState<NewItemKind | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [renamingPath, setRenamingPath] = useState('');
  const [renameName, setRenameName] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(
    null,
  );
  const [undoStack, setUndoStack] = useState<UndoBatch[]>([]);
  const [viewerOpen, setViewerOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [treeScrollTop, setTreeScrollTop] = useState(0);
  const [treeViewportHeight, setTreeViewportHeight] = useState(480);
  const folderChord = useRef(false);
  const folderChordTimer = useRef<number | undefined>(undefined);
  const folderDialogOpen = useRef(false);
  const historyRestoreStarted = useRef(false);
  const viewerDrag = useRef<{
    startX: number;
    startWidth: number;
    pointerId: number;
  } | null>(null);
  const selectionAnchor = useRef('');
  const trashCounter = useRef(0);
  const scanGeneration = useRef(0);
  const scannedTree = useRef('');
  const treeScrollRef = useRef<HTMLDivElement>(null);
  const groupCounter = useRef(1);
  const splitCounter = useRef(0);
  const terminalCounter = useRef(0);
  const tree = useMemo(() => makeTree(files), [files]);
  const visibleTreeNodes = useMemo(() => {
    const visible: { node: TreeNode; depth: number }[] = [];
    const visit = (nodes: TreeNode[], depth: number) =>
      nodes.forEach((node) => {
        visible.push({ node, depth });
        if (node.kind === 'directory' && expanded.has(node.path))
          visit(node.children ?? [], depth + 1);
      });
    visit(tree, 0);
    return visible;
  }, [expanded, tree]);
  const visibleTreeEntries = useMemo(
    () => visibleTreeNodes.map(({ node }) => node),
    [visibleTreeNodes],
  );
  const treeWindowStart = Math.max(0, Math.floor(treeScrollTop / 24) - 8);
  const treeWindowEnd = Math.min(
    visibleTreeNodes.length,
    treeWindowStart + Math.ceil(treeViewportHeight / 24) + 16,
  );
  const activeTheme =
    themes.find((entry) => entry.id === settings.selectedTheme) ??
    DEFAULT_THEME;
  const dynamicThemeCss = useMemo(
    () => themeCss(activeTheme, settings),
    [activeTheme, settings],
  );

  useEffect(() => {
    localStorage.setItem(
      'arc.settings',
      JSON.stringify({ ...settings, version: APP_SETTINGS_VERSION }),
    );
  }, [settings]);

  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const trashRoot = await join(await appDataDir(), 'undo-trash');
        if (await exists(trashRoot))
          await remove(trashRoot, { recursive: true });
      } catch {
        // Best effort: a stale trash folder must not block startup.
      }
    })();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const enabled = settings.editorGlassEnabled && settings.nativeBackgroundBlurEnabled;
    void invoke('set_native_background_blur', { enabled }).catch((error) => {
      if (enabled) {
        setSettings((current) => ({ ...current, nativeBackgroundBlurEnabled: false }));
      }
      setMessage(`Could not ${enabled ? 'enable' : 'disable'} desktop blur: ${String(error)}`);
    });
  }, [settings.editorGlassEnabled, settings.nativeBackgroundBlurEnabled]);

  useEffect(() => {
    if (!isTauri()) return;
    void getCurrentWindow()
      .setDecorations(!settings.titleBarEnabled)
      .catch((error) =>
        setMessage(`Could not update window decorations: ${String(error)}`),
      );
  }, [settings.titleBarEnabled]);

  const runPluginAction = async (action: PluginToolbarAction) => {
    try {
      await action.onClick();
    } catch (error) {
      setMessage(`Plugin ${action.pluginName} failed: ${String(error)}`);
    }
  };

  const runPluginStatusItem = async (item: PluginStatusItem) => {
    try {
      await item.onClick?.();
    } catch (error) {
      setMessage(`Plugin ${item.pluginName} failed: ${String(error)}`);
    }
  };

  useEffect(() => {
    if (!isTauri()) {
      const saved = Object.keys(localStorage)
        .filter((key) => key.startsWith('arc.theme.'))
        .flatMap((key) => {
          try {
            const value: unknown = JSON.parse(
              localStorage.getItem(key) ?? 'null',
            );
            return isThemeDefinition(value) ? [value] : [];
          } catch {
            return [];
          }
        });
      const merged = new Map(BUILTIN_THEMES.map((theme) => [theme.id, theme]));
      saved.forEach((theme) => merged.set(theme.id, theme));
      setThemes([...merged.values()]);
      setCustomThemeIds(
        new Set(
          saved
            .filter(
              (theme) =>
                !BUILTIN_THEMES.some((builtin) => builtin.id === theme.id),
            )
            .map((theme) => theme.id),
        ),
      );
      return;
    }
    void (async () => {
      const themesPath = await join(await appDataDir(), 'themes');
      const entries = await readDir(themesPath);
      const loaded: ThemeDefinition[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory) continue;
        try {
          const path = await join(themesPath, entry.name, 'theme.json');
          const value: unknown = JSON.parse(await readTextFile(path));
          if (isThemeDefinition(value)) loaded.push(value);
        } catch {
          continue;
        }
      }
      const merged = new Map(BUILTIN_THEMES.map((theme) => [theme.id, theme]));
      loaded.forEach((theme) => merged.set(theme.id, theme));
      setThemes([...merged.values()]);
      setCustomThemeIds(
        new Set(
          loaded
            .filter(
              (theme) =>
                !BUILTIN_THEMES.some((builtin) => builtin.id === theme.id),
            )
            .map((theme) => theme.id),
        ),
      );
    })().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (isTauri()) {
      void getCurrentWebview()
        .setZoom(settings.zoomLevel)
        .catch((error) => setMessage(`Could not set zoom: ${String(error)}`));
    } else {
      document.documentElement.style.zoom = String(settings.zoomLevel);
    }
  }, [settings.zoomLevel]);

  const updateSettings = (patch: Partial<AppSettings>) =>
    setSettings((current) => ({ ...current, ...patch }));

  const beginViewerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    viewerDrag.current = {
      startX: event.clientX,
      startWidth: viewerOpen ? settings.sidebarWidth : MIN_VIEWER_WIDTH,
      pointerId: event.pointerId,
    };
  };

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = viewerDrag.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const width = Math.round(drag.startWidth + event.clientX - drag.startX);
      if (width < MIN_VIEWER_WIDTH) {
        setViewerOpen(false);
        return;
      }
      setViewerOpen(true);
      setSettings((current) => ({
        ...current,
        sidebarWidth: Math.min(480, width),
      }));
    };
    const finishResize = (event: PointerEvent) => {
      if (viewerDrag.current?.pointerId === event.pointerId)
        viewerDrag.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
    };
  }, []);

  const persistTheme = async (theme: ThemeDefinition, custom: boolean) => {
    const saved = { ...theme, name: theme.name.trim() };
    try {
      if (isTauri()) {
        const themesPath = await join(await appDataDir(), 'themes');
        const themePath = await join(themesPath, saved.id);
        await mkdir(themesPath, { recursive: true });
        await mkdir(themePath, { recursive: true });
        await writeTextFile(
          await join(themePath, 'theme.json'),
          JSON.stringify(saved, null, 2),
        );
      } else {
        localStorage.setItem(`arc.theme.${saved.id}`, JSON.stringify(saved));
      }
      setThemes((current) =>
        current.some((entry) => entry.id === saved.id)
          ? current.map((entry) => (entry.id === saved.id ? saved : entry))
          : [...current, saved],
      );
      if (custom)
        setCustomThemeIds((current) => new Set([...current, saved.id]));
      updateSettings({ selectedTheme: saved.id });
      setThemeMakerOpen(false);
      setSettingsOpen(true);
      setMessage(`Saved theme: ${saved.name}`);
    } catch (error) {
      setMessage(`Could not save theme: ${String(error)}`);
    }
  };

  const createTheme = async (theme: ThemeDefinition, name: string) => {
    if (
      themes.some(
        (entry) =>
          entry.name.trim().toLowerCase() === name.trim().toLowerCase(),
      )
    ) {
      setMessage(`A theme named “${name}” already exists.`);
      return;
    }
    const baseId =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'custom-theme';
    let id = baseId;
    let suffix = 2;
    while (
      themes.some((entry) => entry.id === id) ||
      BUILTIN_THEMES.some((entry) => entry.id === id)
    )
      id = `${baseId}-${suffix++}`;
    await persistTheme({ ...theme, id, name: name.trim() }, true);
  };

  const deleteTheme = async (id: string) => {
    const theme = themes.find((entry) => entry.id === id);
    if (
      !theme ||
      !customThemeIds.has(id) ||
      !window.confirm(`Remove theme “${theme.name}”? This cannot be undone.`)
    )
      return;
    try {
      if (isTauri())
        await remove(await join(await appDataDir(), 'themes', id), {
          recursive: true,
        });
      else localStorage.removeItem(`arc.theme.${id}`);
      setThemes((current) => current.filter((entry) => entry.id !== id));
      setCustomThemeIds(
        (current) => new Set([...current].filter((entry) => entry !== id)),
      );
      if (settings.selectedTheme === id)
        updateSettings({ selectedTheme: DEFAULT_THEME.id });
    } catch (error) {
      setMessage(`Could not remove theme: ${String(error)}`);
    }
  };

  const openThemeFolder = async (theme: ThemeDefinition) => {
    if (!isTauri()) {
      setMessage('Theme folders are available in Arc desktop.');
      return;
    }
    try {
      const folder = await join(await appDataDir(), 'themes', theme.id);
      await mkdir(folder, { recursive: true });
      const file = await join(folder, 'theme.json');
      if (!(await exists(file)))
        await writeTextFile(file, JSON.stringify(theme, null, 2));
      await openPath(folder);
    } catch (error) {
      setMessage(`Could not open theme folder: ${String(error)}`);
    }
  };

  useEffect(() => {
    const preventWheelZoom = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    const preventGestureZoom = (event: Event) => event.preventDefault();
    window.addEventListener('wheel', preventWheelZoom, { passive: false });
    window.addEventListener('gesturestart', preventGestureZoom, {
      passive: false,
    });
    window.addEventListener('gesturechange', preventGestureZoom, {
      passive: false,
    });
    window.addEventListener('gestureend', preventGestureZoom, {
      passive: false,
    });
    return () => {
      window.removeEventListener('wheel', preventWheelZoom);
      window.removeEventListener('gesturestart', preventGestureZoom);
      window.removeEventListener('gesturechange', preventGestureZoom);
      window.removeEventListener('gestureend', preventGestureZoom);
    };
  }, []);

  const normalizeGroups = (
    nextGroups: EditorGroup[],
    preferredId?: GroupId,
  ) => {
    const populated = nextGroups.filter((group) => group.tabs.length > 0);
    const emptyFallback = nextGroups.find(
      (group) => group.id === preferredId,
    ) ??
      nextGroups.find((group) => group.id === activeGroupId) ??
      nextGroups[0] ?? {
        id: `group-${++groupCounter.current}`,
        activePath: '',
        tabs: [],
      };
    const kept = populated.length ? populated : [emptyFallback];
    const keptIds = new Set(kept.map((group) => group.id));
    setGroups(kept);
    setLayout(
      (current) =>
        pruneLayout(current, keptIds) ?? { type: 'group', groupId: kept[0].id },
    );
    setActiveGroupId(
      preferredId && keptIds.has(preferredId)
        ? preferredId
        : keptIds.has(activeGroupId)
          ? activeGroupId
          : kept[0].id,
    );
  };

  const createSplitGroup = (targetId: GroupId, placement: SplitPlacement) => {
    const newGroupId = `group-${++groupCounter.current}`;
    const splitId = `split-${++splitCounter.current}`;
    setGroups((current) =>
      current.some((group) => group.id === newGroupId)
        ? current
        : [...current, { id: newGroupId, activePath: '', tabs: [] }],
    );
    setLayout((current) =>
      insertSplit(current, targetId, newGroupId, placement, splitId),
    );
    setActiveGroupId(newGroupId);
    return newGroupId;
  };

  // ---- Live file tree updates (backend watcher) ----

  const processFsEvents = async (events: FsEvent[]) => {
    if (!watcherRoot.current) return;
    const root = watcherRoot.current;
    const showHidden = settingsRef.current.showHiddenFiles;
    const hidden = (relativePath: string) =>
      !showHidden && relativePath.split('/').some((part) => part.startsWith('.'));
    const relative = (absolutePath: string) =>
      absolutePath.startsWith(`${root}/`)
        ? absolutePath.slice(root.length + 1)
        : absolutePath === root
          ? ''
          : '';
    const removals: string[] = [];
    const created: DiskFile[] = [];
    const renames = new Map<string, string>();
    const modified: string[] = [];
    let rootGone = false;

    for (const event of events) {
      if (event.root !== root) continue;
      if (event.kind === 'modified') {
        const relativePath = relative(event.paths[0]);
        if (relativePath) modified.push(relativePath);
        continue;
      }
      if (event.kind === 'removed') {
        const relativePath = relative(event.paths[0]);
        removals.push(relativePath);
        if (!relativePath) rootGone = true;
        continue;
      }
      if (event.kind === 'created') {
        const relativePath = relative(event.paths[0]);
        if (relativePath && !hidden(relativePath)) {
          created.push({
            name: relativePath.split('/').at(-1) ?? relativePath,
            path: relativePath,
            kind: event.isDir ? 'directory' : 'file',
          });
        }
        continue;
      }
      if (event.kind === 'renamed') {
        const from = relative(event.paths[0]);
        const to = relative(event.paths[1] ?? '');
        if (!to) continue;
        renames.set(from, to);
        removals.push(from);
        if (!hidden(to)) {
          created.push({
            name: to.split('/').at(-1) ?? to,
            path: to,
            kind: event.isDir ? 'directory' : 'file',
          });
        }
      }
    }

    if (rootGone) {
      setFiles([]);
    } else if (removals.length > 0 || created.length > 0) {
      setFiles((current) => {
        const next = current.filter(
          (file) =>
            !removals.some(
              (relativePath) =>
                relativePath &&
                (file.path === relativePath ||
                  file.path.startsWith(`${relativePath}/`)),
            ),
        );
        const added: DiskFile[] = [];
        const seen = new Set(next.map((file) => file.path));
        for (const entry of created) {
          if (seen.has(entry.path)) continue;
          added.push(entry);
          seen.add(entry.path);
        }
        return added.length ? [...next, ...added] : next;
      });
    }

    const doomed = new Set<string>();
    for (const relativePath of removals) {
      if (!relativePath) continue;
      for (const file of openFilesRef.current) {
        if (
          (file.path === relativePath ||
            file.path.startsWith(`${relativePath}/`)) &&
          !file.dirty &&
          ![...renames.keys()].some(
            (from) =>
              file.path === from || file.path.startsWith(`${from}/`),
          )
        ) {
          doomed.add(file.path);
        }
      }
    }
    if (doomed.size) {
      for (const path of doomed) {
        fileContents.current.delete(path);
        lastDiskWrite.current.delete(path);
      }
      setOpenFiles((current) =>
        current.filter((file) => !doomed.has(file.path)),
      );
      normalizeGroups(
        groupsRef.current.map((group) => {
          const tabs = group.tabs.filter((tab) => !doomed.has(tab));
          return {
            ...group,
            tabs,
            activePath: doomed.has(group.activePath)
              ? (tabs.at(-1) ?? '')
              : group.activePath,
          };
        }),
      );
    }
    if (renames.size > 0) {
      const remap = (path: string) => {
        let next = path;
        for (const [from, to] of renames) {
          if (next === from) next = to;
          else if (from && next.startsWith(`${from}/`))
            next = `${to}${next.slice(from.length)}`;
        }
        return next;
      };
      const touches = (path: string) =>
        [...renames.keys()].some(
          (from) => path === from || path.startsWith(`${from}/`),
        );
      if (openFilesRef.current.some((file) => touches(file.path))) {
        fileContents.current = new Map(
          [...fileContents.current].map(([path, content]) => [
            remap(path),
            content,
          ]),
        );
        lastDiskWrite.current = new Map(
          [...lastDiskWrite.current].map(([path, content]) => [
            remap(path),
            content,
          ]),
        );
        setOpenFiles((current) =>
          current.map((file) => {
            const next = remap(file.path);
            return next === file.path
              ? file
              : {
                  ...file,
                  path: next,
                  name: next.split('/').pop() ?? file.name,
                };
          }),
        );
        setGroups((current) =>
          current.map((group) => ({
            ...group,
            tabs: group.tabs.map(remap),
            activePath: group.activePath ? remap(group.activePath) : '',
          })),
        );
        setDiskConflicts((current) => new Set([...current].map(remap)));
        setExpanded((current) => new Set([...current].map(remap)));
      }
    }

    // Tree selection: renamed folders re-point; deleted folders fall back to
    // the workspace root so new files/folders land somewhere that exists.
    if (removals.length > 0 || renames.size > 0) {
      const remapSelection = (path: string) => {
        let next = path;
        for (const [from, to] of renames) {
          if (next === from) next = to;
          else if (from && next.startsWith(`${from}/`))
            next = `${to}${next.slice(from.length)}`;
        }
        for (const removedRel of removals) {
          if (
            removedRel &&
            (next === removedRel || next.startsWith(`${removedRel}/`))
          )
            return '';
        }
        return next;
      };
      if (selectedPath) setSelectedPath(remapSelection(selectedPath));
      if (selectedDirectory) setSelectedDirectory(remapSelection(selectedDirectory));
      if (selectedPaths.size)
        setSelectedPaths((current) => {
          const next = new Set<string>();
          for (const path of current) {
            const remapped = remapSelection(path);
            if (remapped) next.add(remapped);
          }
          return next;
        });
      selectionAnchor.current = remapSelection(selectionAnchor.current);
    }

    for (const relativePath of modified) {
      const open = openFilesRef.current.find(
        (file) => file.path === relativePath,
      );
      if (!open) continue;
      try {
        const content = await readTextFile(`${root}/${relativePath}`);
        const lastWritten = lastDiskWrite.current.get(relativePath);
        if (
          lastWritten !== undefined &&
          lastWritten === contentFingerprint(content)
        )
          continue;
        if (open.dirty) {
          setDiskConflicts((current) =>
            current.has(relativePath)
              ? current
              : new Set(current).add(relativePath),
          );
          continue;
        }
        fileContents.current.set(relativePath, content);
        setOpenFiles((current) =>
          current.map((file) =>
            file.path === relativePath
              ? { ...file, revision: file.revision + 1, dirty: false }
              : file,
          ),
        );
      } catch {
        // The file vanished; the follow-up remove event closes the tab.
      }
    }
  };
  useEffect(() => {
    processFsEventsRef.current = processFsEvents;
  });

  useEffect(() => {
    settingsRef.current = settings;
    openFilesRef.current = openFiles;
    groupsRef.current = groups;
  });

  useEffect(() => {
    if (!isTauri()) return;
    const unlistenAll = Promise.all([
      listen<FsEvent[]>('fs-changed', (event) => {
        for (const change of event.payload) fsEventQueue.current.push(change);
        if (fsApplyScheduled.current) return;
        fsApplyScheduled.current = true;
        const flush = () => {
          fsApplyScheduled.current = false;
          const events = fsEventQueue.current;
          fsEventQueue.current = [];
          if (!events.length) return;
          if (!watcherRoot.current) {
            // Watcher handle not wired yet (watch_project pending): retry.
            fsEventQueue.current =
              events.length > 500 ? events.slice(-500) : events;
            fsApplyScheduled.current = true;
            window.setTimeout(flush, 120);
            return;
          }
          void processFsEventsRef.current(events);
        };
        window.requestAnimationFrame(flush);
      }),
      listen<string>('fs-watcher-error', (event) => {
        setMessage(event.payload);
      }),
    ]);
    return () => {
      void unlistenAll.then((unlisten) => unlisten.forEach((fn) => fn()));
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const generation = ++watchGeneration.current;
    let cancelled = false;
    const unwatchPath = async (path: string) => {
      try {
        await invoke('unwatch_project', { root: path });
      } catch {
        // best effort
      }
    };
    void (async () => {
      const previous = activeWatchRoot.current;
      if (previous) await unwatchPath(previous);
      if (!workspace) {
        watcherRoot.current = '';
        activeWatchRoot.current = '';
        return;
      }
      try {
        const watched = await invoke<string>('watch_project', {
          root: workspace,
        });
        if (cancelled || generation !== watchGeneration.current) {
          // A newer run owns the watcher (watch_project replaces the backend
          // watcher outright); never unwatch from a stale run.
          return;
        }
        watcherRoot.current = watched;
        activeWatchRoot.current = watched;
      } catch (error) {
        if (cancelled) return;
        watcherRoot.current = '';
        activeWatchRoot.current = '';
        setMessage(`Live file updates unavailable: ${String(error)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const updateTerminalTitle = useCallback((id: string, title: string) => {
    setTerminals((current) =>
      current.map((terminal) =>
        terminal.id === id ? { ...terminal, title } : terminal,
      ),
    );
  }, []);

  const openTerminal = (command?: string): string | null => {
    if (!isTauri()) {
      setMessage('Terminal sessions are available in Arc desktop.');
      return null;
    }
    const id = `terminal-${Date.now()}-${++terminalCounter.current}`;
    const session = {
      id,
      key: `terminal:${id}`,
      cwd: workspace,
      title: 'Terminal',
      command,
    };
    setTerminals((current) => [...current, session]);
    setGroups((current) =>
      current.map((group) =>
        group.id === activeGroupId
          ? {
              ...group,
              activePath: session.key,
              tabs: [...group.tabs, session.key],
            }
          : group,
      ),
    );
    setActiveGroupId(activeGroupId);
    setSettingsOpen(false);
    setThemeMakerOpen(false);
    setMessage('');
    pluginRuntime.emitEvent('terminal:opened', { id });
    return id;
  };

  const openGithubPanel = () => {
    if (!workspace) {
      setMessage('Open a folder first.');
      return;
    }
    setGroups((current) =>
      current.map((group) =>
        group.id === activeGroupId
          ? {
              ...group,
              activePath: GITHUB_TAB_KEY,
              tabs: group.tabs.includes(GITHUB_TAB_KEY)
                ? group.tabs
                : [...group.tabs, GITHUB_TAB_KEY],
            }
          : group,
      ),
    );
    setSettingsOpen(false);
    setThemeMakerOpen(false);
    setMessage('');
  };

  const openPluginPanel = () => {
    setGroups((current) =>
      current.map((group) =>
        group.id === activeGroupId
          ? {
              ...group,
              activePath: PLUGIN_TAB_KEY,
              tabs: group.tabs.includes(PLUGIN_TAB_KEY)
                ? group.tabs
                : [...group.tabs, PLUGIN_TAB_KEY],
            }
          : group,
      ),
    );
    setSettingsOpen(false);
    setThemeMakerOpen(false);
    setMessage('');
  };

  const resizeSplit = (splitId: string, ratio: number) => {
    setLayout((current) => resizeLayout(current, splitId, ratio));
  };

  const refreshWorkspace = useCallback(
    async (rootPath: string) => {
      const generation = ++scanGeneration.current;
      const collected: DiskFile[] = [];
      const ignored = new Set([
        'node_modules',
        '.git',
        'dist',
        'build',
        '.next',
        'target',
        '__pycache__',
        '.venv',
        'venv',
        '.cache',
      ]);
      const pending = [{ folder: rootPath, prefix: '' }];
      let pendingIndex = 0;
      while (
        generation === scanGeneration.current &&
        pendingIndex < pending.length &&
        collected.length < 5000
      ) {
        const batch = pending.slice(pendingIndex, pendingIndex + 4);
        pendingIndex += batch.length;
        const contents = await Promise.all(
          batch.map(({ folder }) => readDir(folder)),
        );
        if (generation !== scanGeneration.current) return;
        const hiddenGrants: { path: string; directory: boolean }[] = [];
        for (
          let folderIndex = 0;
          folderIndex < batch.length;
          folderIndex += 1
        ) {
          const folder = batch[folderIndex];
          for (const entry of contents[folderIndex]) {
            if (
              generation !== scanGeneration.current ||
              collected.length >= 5000
            )
              break;
            if (
              ignored.has(entry.name) ||
              (!settings.showHiddenFiles && entry.name.startsWith('.'))
            )
              continue;
            if (entry.name.startsWith('.')) {
              const hiddenPath = `${folder.folder}/${entry.name}`;
              const hiddenKey = `${rootPath}:${hiddenPath}`;
              if (!allowedHiddenPaths.current.has(hiddenKey)) {
                hiddenGrants.push({
                  path: hiddenPath,
                  directory: entry.isDirectory,
                });
              }
            }
            const relative = folder.prefix
              ? `${folder.prefix}/${entry.name}`
              : entry.name;
            if (entry.isDirectory) {
              collected.push({
                name: entry.name,
                path: relative,
                kind: 'directory',
              });
              pending.push({
                folder: `${folder.folder}/${entry.name}`,
                prefix: relative,
              });
            } else {
              collected.push({
                name: entry.name,
                path: relative,
                kind: 'file',
              });
            }
          }
        }
        if (hiddenGrants.length && generation === scanGeneration.current) {
          await invoke('workspace_allow_hidden_paths', {
            root: rootPath,
            paths: hiddenGrants,
          });
          if (generation !== scanGeneration.current) return;
          for (const grant of hiddenGrants) {
            allowedHiddenPaths.current.add(`${rootPath}:${grant.path}`);
          }
        }
      }
      if (generation === scanGeneration.current) {
        scannedTree.current = `${rootPath}\u0000${settings.showHiddenFiles}`;
        setFiles(collected);
      }
    },
    [settings.showHiddenFiles],
  );

  useEffect(() => {
    const element = treeScrollRef.current;
    if (!element) return;
    const updateHeight = () => setTreeViewportHeight(element.clientHeight);
    element.scrollTop = 0;
    setTreeScrollTop(0);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewerOpen, workspace]);

  useEffect(() => {
    // Fallback when the backend watcher is unavailable (watch reached its
    // limit, unsupported mount): refresh the tree when the window regains
    // focus so external edits are still picked up eventually.
    if (!isTauri() || !workspace) return;
    const rescan = () => {
      if (document.visibilityState !== 'visible') return;
      // With the backend watcher healthy the tree stays live; rescan only
      // serves as the fallback for watch failure / unsupported mounts.
      if (watcherRoot.current) return;
      void refreshWorkspace(workspace);
    };
    window.addEventListener('focus', rescan);
    document.addEventListener('visibilitychange', rescan);
    return () => {
      window.removeEventListener('focus', rescan);
      document.removeEventListener('visibilitychange', rescan);
    };
  }, [refreshWorkspace, workspace]);

  useEffect(() => {
    if (!workspace) return;
    if (scannedTree.current === `${workspace}\u0000${settings.showHiddenFiles}`)
      return;
    void refreshWorkspace(workspace);
  }, [refreshWorkspace, settings.showHiddenFiles, workspace]);

  const parentDirectory = (path: string) =>
    path.split('/').slice(0, -1).join('/');

  const copyTreeEntry = async (
    source: string,
    destination: string,
    kind: DiskFile['kind'],
  ) => {
    if (kind === 'directory') {
      await mkdir(destination);
      for (const child of await readDir(source)) {
        await copyTreeEntry(
          `${source}/${child.name}`,
          `${destination}/${child.name}`,
          child.isDirectory ? 'directory' : 'file',
        );
      }
    } else {
      await copyFile(source, destination);
    }
  };

  const copyEntryToDirectory = async (
    entry: DiskFile,
    sourceWorkspace: string,
    destinationDirectory: string,
    verb: 'Copied' | 'Duplicated' = 'Copied',
  ) => {
    if (!workspace) return;
    if (
      entry.kind === 'directory' &&
      sourceWorkspace === workspace &&
      (destinationDirectory === entry.path ||
        destinationDirectory.startsWith(`${entry.path}/`))
    ) {
      setMessage('Cannot copy a folder into itself or one of its subfolders.');
      return;
    }
    const dot = entry.kind === 'file' ? entry.name.lastIndexOf('.') : -1;
    const extension = dot > 0 ? entry.name.slice(dot) : '';
    const base = extension ? entry.name.slice(0, dot) : entry.name;
    let name = entry.name;
    let destination = destinationDirectory
      ? `${destinationDirectory}/${name}`
      : name;
    const mustRename =
      verb === 'Duplicated' ||
      (sourceWorkspace === workspace &&
        parentDirectory(entry.path) === destinationDirectory);
    if (mustRename || (await exists(`${workspace}/${destination}`))) {
      let index = 1;
      do {
        const suffix = index === 1 ? ' copy' : ` copy ${index}`;
        name = `${base}${suffix}${extension}`;
        destination = destinationDirectory
          ? `${destinationDirectory}/${name}`
          : name;
        index += 1;
      } while (await exists(`${workspace}/${destination}`));
    }

    const source = `${sourceWorkspace}/${entry.path}`;
    const absoluteDestination = `${workspace}/${destination}`;
    try {
      await copyTreeEntry(source, absoluteDestination, entry.kind);
      await refreshWorkspace(workspace);
      setSelectedPath(destination);
      setSelectedPaths(new Set([destination]));
      selectionAnchor.current = destination;
      if (entry.kind === 'directory')
        setExpanded(
          (current) => new Set([...current, destinationDirectory, destination]),
        );
      setMessage(`${verb} ${entry.name} as ${name}`);
      window.setTimeout(
        () =>
          setMessage((current) =>
            current.startsWith(`${verb} `) ? '' : current,
          ),
        1800,
      );
    } catch (error) {
      if (await exists(absoluteDestination).catch(() => false)) {
        await remove(absoluteDestination, {
          recursive: entry.kind === 'directory',
        }).catch(() => undefined);
      }
      setMessage(`Could not copy ${entry.name}: ${String(error)}`);
    }
  };

  const copyEntry = (entry: DiskFile) => {
    const selected = files.filter((file) => selectedPaths.has(file.path));
    const entries = removeNestedEntries(
      selected.some((file) => file.path === entry.path) ? selected : [entry],
    );
    setFileClipboard({ entries, workspace });
    setSelectedPath(entry.path);
    if (!selectedPaths.has(entry.path)) setSelectedPaths(new Set([entry.path]));
    setContextMenu(null);
    setMessage(
      entries.length === 1
        ? `Copied ${entry.name}. Paste it with Ctrl+V.`
        : `Copied ${entries.length} items. Paste with Ctrl+V.`,
    );
  };

  const pasteEntry = async (destinationDirectory: string) => {
    if (!fileClipboard) return;
    for (const entry of fileClipboard.entries)
      await copyEntryToDirectory(
        entry,
        fileClipboard.workspace,
        destinationDirectory,
      );
    setContextMenu(null);
  };

  const duplicateEntry = async (entry: DiskFile) => {
    const selected = files.filter((file) => selectedPaths.has(file.path));
    const entries = removeNestedEntries(
      selected.some((file) => file.path === entry.path) ? selected : [entry],
    );
    for (const selectedEntry of entries)
      await copyEntryToDirectory(
        selectedEntry,
        workspace,
        parentDirectory(selectedEntry.path),
        'Duplicated',
      );
    setContextMenu(null);
  };

  const moveEntry = async (path: string, destinationDirectory: string) => {
    const entry = files.find((file) => file.path === path);
    if (!entry || !workspace) return;
    if (
      entry.kind === 'directory' &&
      (destinationDirectory === entry.path ||
        destinationDirectory.startsWith(`${entry.path}/`))
    ) {
      setMessage('Cannot move a folder into itself or one of its subfolders.');
      return;
    }
    if (parentDirectory(entry.path) === destinationDirectory) return;
    const destination = destinationDirectory
      ? `${destinationDirectory}/${entry.name}`
      : entry.name;
    try {
      if (await exists(`${workspace}/${destination}`)) {
        setMessage(`${entry.name} already exists in that folder.`);
        return;
      }
      await rename(`${workspace}/${entry.path}`, `${workspace}/${destination}`);
      const remap = (current: string) =>
        current === entry.path
          ? destination
          : entry.kind === 'directory' && current.startsWith(`${entry.path}/`)
            ? `${destination}${current.slice(entry.path.length)}`
            : current;
      fileContents.current = new Map(
        [...fileContents.current].map(([path, content]) => [
          remap(path),
          content,
        ]),
      );
      setOpenFiles((current) =>
        current.map((file) => {
          const nextPath = remap(file.path);
          return nextPath === file.path
            ? file
            : {
                ...file,
                path: nextPath,
                name: nextPath.split('/').pop() ?? file.name,
              };
        }),
      );
      setGroups((current) =>
        current.map((group) => ({
          ...group,
          tabs: group.tabs.map(remap),
          activePath: group.activePath ? remap(group.activePath) : '',
        })),
      );
      setFileClipboard((current) =>
        current?.workspace === workspace
          ? {
              ...current,
              entries: current.entries.map((copied) => ({
                ...copied,
                path: remap(copied.path),
                name: remap(copied.path).split('/').pop() ?? copied.name,
              })),
            }
          : current,
      );
      setSelectedPaths((current) => new Set([...current].map(remap)));
      setExpanded((current) => new Set([...current].map(remap)));
      setSelectedPath((current) => (current ? remap(current) : destination));
      setSelectedDirectory((current) =>
        current ? remap(current) : destinationDirectory,
      );
      if (destinationDirectory)
        setExpanded((current) => new Set([...current, destinationDirectory]));
      setDropTargetPath(null);
      setContextMenu(null);
      await refreshWorkspace(workspace);
      setMessage(`Moved ${entry.name}`);
    } catch (error) {
      setDropTargetPath(null);
      setMessage(`Could not move ${entry.name}: ${String(error)}`);
    }
  };

  const moveEntries = async (paths: string[], destinationDirectory: string) => {
    const requested = new Set(paths);
    const entries = removeNestedEntries(
      files.filter((entry) => requested.has(entry.path)),
    );
    for (const entry of entries)
      await moveEntry(entry.path, destinationDirectory);
  };

  useEffect(() => {
    if (historyRestoreStarted.current) return;
    historyRestoreStarted.current = true;
    const previousWorkspace = localStorage.getItem('arc.lastWorkspace');
    if (!previousWorkspace) return;
    void (async () => {
      try {
        if (!(await requestWorkspaceAccess(previousWorkspace))) {
          localStorage.removeItem('arc.lastWorkspace');
          setMessage('Folder access declined.');
          return;
        }
        await refreshWorkspace(previousWorkspace);
        setWorkspace(previousWorkspace);
        setMessage('');
      } catch {
        localStorage.removeItem('arc.lastWorkspace');
      }
    })();
  }, [refreshWorkspace]);

  const openWorkspace = async () => {
    if (folderDialogOpen.current) return;
    folderDialogOpen.current = true;
    try {
      const selected = await invoke<string | null>('workspace_pick');
      if (!selected) return;
      if (!(await requestWorkspaceAccess(selected))) {
        setMessage('Folder access declined.');
        return;
      }
      await refreshWorkspace(selected);
      localStorage.setItem('arc.lastWorkspace', selected);
      terminals.forEach((terminal) => {
        forgetTerminalOutput(terminal.id);
        void invoke('terminal_close', { id: terminal.id });
      });
      setTerminals([]);
      setWorkspace(selected);
      setOpenFiles([]);
      fileContents.current.clear();
      lastDiskWrite.current.clear();
      allowedHiddenPaths.current.clear();
      setDiskConflicts(new Set());
      for (const batch of undoStack)
        for (const entry of batch.entries)
          void remove(entry.trashedPath, {
            recursive: entry.entry.kind === 'directory',
          }).catch(() => undefined);
      setUndoStack([]);
      setGroups([{ id: 'group-1', activePath: '', tabs: [] }]);
      setLayout({ type: 'group', groupId: 'group-1' });
      setActiveGroupId('group-1');
      groupCounter.current = 1;
      splitCounter.current = 0;
      setExpanded(new Set());
      setSelectedDirectory('');
      setSelectedPaths(new Set());
      setSelectedPath('');
      selectionAnchor.current = '';
      setNewItemKind(null);
      setNewItemName('');
      setRenamingPath('');
      setRenameName('');
      setContextMenu(null);
      setMessage('');
    } catch (error) {
      setMessage(`Could not open workspace: ${String(error)}`);
    } finally {
      folderDialogOpen.current = false;
    }
  };

  const openFile = async (file: DiskFile, targetGroupId = activeGroupId) => {
    if (file.kind !== 'file' || !workspace) return;
    const existing = openFiles.find((entry) => entry.path === file.path);
    const assignToGroup = () => {
      const currentGroups = groups.some((group) => group.id === targetGroupId)
        ? groups
        : [...groups, { id: targetGroupId, activePath: '', tabs: [] }];
      const nextGroups = currentGroups.map((group) => {
        if (group.id === targetGroupId) {
          return {
            ...group,
            activePath: file.path,
            tabs: group.tabs.includes(file.path)
              ? group.tabs
              : [...group.tabs, file.path],
          };
        }
        if (!group.tabs.includes(file.path)) return group;
        const tabs = group.tabs.filter((tab) => tab !== file.path);
        return {
          ...group,
          tabs,
          activePath:
            group.activePath === file.path
              ? (tabs.at(-1) ?? '')
              : group.activePath,
        };
      });
      normalizeGroups(nextGroups, targetGroupId);
    };
    if (existing) {
      assignToGroup();
      setMessage('');
      return;
    }
    try {
      const absolutePath = `${workspace}/${file.path}`;
      const metadata = await stat(absolutePath);
      if (
        metadata.size > 5 * 1024 * 1024 &&
        !window.confirm(
          `${file.name} is ${(metadata.size / (1024 * 1024)).toFixed(1)} MB. Opening it may use substantial memory. Continue?`,
        )
      )
        return;
      const content = await readTextFile(absolutePath);
      fileContents.current.set(file.path, content);
      setOpenFiles((current) => [
        ...current,
        { path: file.path, name: file.name, revision: 0, dirty: false },
      ]);
      assignToGroup();
      setMessage('');
    } catch (error) {
      setMessage(`Could not open ${file.name}: ${String(error)}`);
    }
  };

  const saveFile = useCallback(
    async (path: string): Promise<boolean> => {
      const file = openFiles.find((entry) => entry.path === path);
      if (!file || !workspace) return false;
      const currentContent = fileContents.current.get(path) ?? '';
      let content: string;
      let formatFailed = false;
      try {
        const willSaveContent = await pluginRuntime.applyWillSave(
          path,
          currentContent,
        );
        content = willSaveContent;
        if (settings.prettierOnSave) {
          try {
            content =
              (await prettierFormat(file.name, willSaveContent)) ??
              willSaveContent;
          } catch {
            formatFailed = true;
          }
        }
      } catch (error) {
        setMessage(`Could not save ${file.name}: ${String(error)}`);
        return false;
      }
      try {
        await writeTextFile(`${workspace}/${file.path}`, content);
        fileContents.current.set(path, content);
        lastDiskWrite.current.set(path, contentFingerprint(content));
        setDiskConflicts((current) => {
          if (!current.has(path)) return current;
          const next = new Set(current);
          next.delete(path);
          return next;
        });
        setOpenFiles((current) =>
          current.map((entry) =>
            entry.path === path
              ? {
                  ...entry,
                  revision:
                    entry.revision + (content === currentContent ? 0 : 1),
                  dirty: false,
                }
              : entry,
          ),
        );
        const savedMessage = formatFailed
          ? "Prettier couldn't format"
          : 'Saved';
        setMessage(savedMessage);
        pluginRuntime.emitEvent('file:saved', { path, content });
        window.setTimeout(
          () =>
            setMessage((current) =>
              current === savedMessage ? '' : current,
            ),
          1400,
        );
        return true;
      } catch (error) {
        setMessage(`Could not save ${file.name}: ${String(error)}`);
        return false;
      }
    },
    [openFiles, settings.prettierOnSave, workspace],
  );

  const updateFile = useCallback(
    (path: string, content: string, replace = false) => {
      if (fileContents.current.get(path) === content) return;
      fileContents.current.set(path, content);
      pluginRuntime.emitEvent('editor:changed', { path, content });
      setOpenFiles((current) => {
        const file = current.find((entry) => entry.path === path);
        if (!file || (file.dirty && !replace)) return current;
        return current.map((entry) =>
          entry.path === path
            ? {
                ...entry,
                dirty: true,
                revision: entry.revision + (replace ? 1 : 0),
              }
            : entry,
        );
      });
    },
    [],
  );

  const formatFile = useCallback(
    async (path: string) => {
      const file = openFiles.find((entry) => entry.path === path);
      if (!file) return;
      const content = fileContents.current.get(path) ?? '';
      try {
        const pluginFormatted = await pluginRuntime.formatWithPlugins(
          path,
          file.name,
          content,
        );
        const formatted =
          pluginFormatted ?? (await prettierFormat(file.name, content));
        if (formatted === null) {
          setMessage(
            `Prettier does not support .${extensionOf(file.name) || 'txt'} files.`,
          );
          return;
        }
        updateFile(path, formatted, true);
        setMessage('Formatted');
        window.setTimeout(
          () =>
            setMessage((current) => (current === 'Formatted' ? '' : current)),
          1400,
        );
      } catch {
        setMessage("Prettier couldn't format");
      }
    },
    [openFiles, updateFile],
  );

  const reloadFromDisk = useCallback(
    async (path: string) => {
      if (!workspace) return;
      setDiskConflicts((current) => {
        if (!current.has(path)) return current;
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      const file = openFilesRef.current.find((entry) => entry.path === path);
      if (!file) return;
      try {
        const content = await readTextFile(`${workspace}/${path}`);
        fileContents.current.set(path, content);
        setOpenFiles((current) =>
          current.map((entry) =>
            entry.path === path
              ? { ...entry, revision: entry.revision + 1, dirty: false }
              : entry,
          ),
        );
      } catch (error) {
        setMessage(`Could not reload ${file.name}: ${String(error)}`);
      }
    },
    [workspace],
  );

  const keepBuffer = useCallback((path: string) => {
    setDiskConflicts((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }, []);

  const closeTab = useCallback(
    async (groupId: GroupId, path: string) => {
      const group = groups.find((entry) => entry.id === groupId);
      if (!group) return;
      const otherGroupsStillUseFile = groups.some(
        (entry) => entry.id !== groupId && entry.tabs.includes(path),
      );
      const terminal = terminals.find((entry) => entry.key === path);
      const file = openFiles.find((entry) => entry.path === path);
      if (!otherGroupsStillUseFile && file?.dirty && !(await saveFile(path)))
        return;
      const nextGroups = groups.map((entry) => {
        if (entry.id !== groupId) return entry;
        const nextTabs = entry.tabs.filter((tab) => tab !== path);
        const nextActive =
          entry.activePath === path
            ? (nextTabs[Math.max(0, entry.tabs.indexOf(path) - 1)] ?? '')
            : entry.activePath;
        return { ...entry, tabs: nextTabs, activePath: nextActive };
      });
      normalizeGroups(nextGroups, groupId);
      if (!otherGroupsStillUseFile && terminal) {
        setTerminals((current) =>
          current.filter((entry) => entry.id !== terminal.id),
        );
        forgetTerminalOutput(terminal.id);
        void invoke('terminal_close', { id: terminal.id }).catch((error) =>
          setMessage(`Could not close terminal: ${String(error)}`),
        );
        pluginRuntime.emitEvent('terminal:closed', { id: terminal.id });
      }
      if (!otherGroupsStillUseFile && !terminal) {
        fileContents.current.delete(path);
        lastDiskWrite.current.delete(path);
        setDiskConflicts((current) => {
          if (!current.has(path)) return current;
          const next = new Set(current);
          next.delete(path);
          return next;
        });
        setOpenFiles((current) =>
          current.filter((entry) => entry.path !== path),
        );
      }
    },
    [groups, normalizeGroups, openFiles, saveFile, terminals],
  );

  const createFile = async (input: string) => {
    if (!workspace) {
      setMessage('Open a folder first.');
      return;
    }
    const name = input?.trim();
    if (!name) return;
    if (name === '.' || name === '..' || /[\\/]/.test(name)) {
      setMessage('Enter a file name without a path.');
      return;
    }
    const path = selectedDirectory ? `${selectedDirectory}/${name}` : name;
    try {
      const handle = await openFs(`${workspace}/${path}`, {
        write: true,
        create: true,
        createNew: true,
      });
      await handle.close();
      await refreshWorkspace(workspace);
      fileContents.current.set(path, '');
      const newFile = { path, name, revision: 0, dirty: false };
      setOpenFiles((current) => [...current, newFile]);
      setSelectedPath(path);
      setSelectedPaths(new Set([path]));
      selectionAnchor.current = path;
      setGroups((current) =>
        current.map((group) =>
          group.id === activeGroupId
            ? {
                ...group,
                activePath: path,
                tabs: group.tabs.includes(path)
                  ? group.tabs
                  : [...group.tabs, path],
              }
            : group,
        ),
      );
      setNewItemKind(null);
      setNewItemName('');
      setMessage('');
    } catch (error) {
      setMessage(`Could not create ${name}: ${String(error)}`);
    }
  };

  const createFolder = async (input: string) => {
    if (!workspace) {
      setMessage('Open a folder first.');
      return;
    }
    const name = input?.trim();
    if (!name) return;
    if (name === '.' || name === '..' || /[\\/]/.test(name)) {
      setMessage('Enter a folder name without a path.');
      return;
    }
    const path = selectedDirectory ? `${selectedDirectory}/${name}` : name;
    try {
      await mkdir(`${workspace}/${path}`);
      await refreshWorkspace(workspace);
      setExpanded((current) => new Set([...current, selectedDirectory, path]));
      setSelectedDirectory(path);
      setSelectedPath(path);
      setSelectedPaths(new Set([path]));
      selectionAnchor.current = path;
      setNewItemKind(null);
      setNewItemName('');
      setMessage('');
    } catch (error) {
      setMessage(`Could not create folder ${name}: ${String(error)}`);
    }
  };

  const openDroppedFile = (
    groupId: GroupId,
    path: string,
    placement?: SplitPlacement,
  ) => {
    const terminal = terminals.find((entry) => entry.key === path);
    if (terminal || path === GITHUB_TAB_KEY || path === PLUGIN_TAB_KEY) {
      const targetGroup = placement
        ? createSplitGroup(groupId, placement)
        : groupId;
      const currentGroups = groups.some((group) => group.id === targetGroup)
        ? groups
        : [...groups, { id: targetGroup, activePath: '', tabs: [] }];
      normalizeGroups(
        currentGroups.map((group) => {
          if (group.id === targetGroup)
            return {
              ...group,
              activePath: path,
              tabs: group.tabs.includes(path)
                ? group.tabs
                : [...group.tabs, path],
            };
          if (!group.tabs.includes(path)) return group;
          const tabs = group.tabs.filter((tab) => tab !== path);
          return {
            ...group,
            tabs,
            activePath:
              group.activePath === path
                ? (tabs.at(-1) ?? '')
                : group.activePath,
          };
        }),
        targetGroup,
      );
      return;
    }
    const file = files.find(
      (entry) => entry.path === path && entry.kind === 'file',
    );
    if (!file) return;
    const targetGroup = placement
      ? createSplitGroup(groupId, placement)
      : groupId;
    void openFile(file, targetGroup);
  };

  const startCreating = (kind: NewItemKind) => {
    if (!workspace) {
      setMessage('Open a folder first.');
      return;
    }
    setViewerOpen(true);
    setNewItemKind(kind);
    setNewItemName('');
    setContextMenu(null);
    setMessage('');
  };

  const openContainingFolder = async (target?: DiskFile) => {
    if (!workspace) return;
    try {
      if (target) await revealItemInDir(`${workspace}/${target.path}`);
      else await openPath(workspace);
      setContextMenu(null);
    } catch (error) {
      setMessage(`Could not open containing folder: ${String(error)}`);
    }
  };

  const runPluginContextMenuItem = async (
    item: PluginContextMenuItem,
    target?: DiskFile,
  ) => {
    setContextMenu(null);
    try {
      await item.onClick({
        workspace,
        target: target && {
          name: target.name,
          path: target.path,
          kind: target.kind,
        },
      });
    } catch (error) {
      setMessage(`Plugin ${item.pluginName} failed: ${String(error)}`);
    }
  };

  const copyPath = async (target: DiskFile, relative: boolean) => {
    try {
      await writeText(relative ? target.path : `${workspace}/${target.path}`);
      setContextMenu(null);
      setMessage(relative ? 'Copied relative path' : 'Copied path');
      window.setTimeout(
        () =>
          setMessage((current) =>
            current.startsWith('Copied ') ? '' : current,
          ),
        1400,
      );
    } catch (error) {
      setMessage(`Could not copy path: ${String(error)}`);
    }
  };

  const startRename = (target: DiskFile) => {
    setContextMenu(null);
    setRenamingPath(target.path);
    setRenameName(target.name);
  };

  const renameEntry = async (target: DiskFile, input: string) => {
    const name = input.trim();
    if (!name || name === target.name) {
      setRenamingPath('');
      setRenameName('');
      return;
    }
    if (name === '.' || name === '..' || /[\\/]/.test(name)) {
      setMessage('Enter a name without a path.');
      return;
    }
    const parent = target.path.split('/').slice(0, -1).join('/');
    const nextPath = parent ? `${parent}/${name}` : name;
    const oldAbsolute = `${workspace}/${target.path}`;
    const newAbsolute = `${workspace}/${nextPath}`;
    try {
      if (await exists(newAbsolute)) {
        setMessage(`${name} already exists.`);
        return;
      }
      await rename(oldAbsolute, newAbsolute);
      const remap = (path: string) =>
        path === target.path
          ? nextPath
          : target.kind === 'directory' && path.startsWith(`${target.path}/`)
            ? `${nextPath}${path.slice(target.path.length)}`
            : path;
      fileContents.current = new Map(
        [...fileContents.current].map(([path, content]) => [
          remap(path),
          content,
        ]),
      );
      setOpenFiles((current) =>
        current.map((file) => {
          const path = remap(file.path);
          return path === file.path
            ? file
            : { ...file, path, name: path.split('/').pop() ?? file.name };
        }),
      );
      setGroups((current) =>
        current.map((group) => ({
          ...group,
          tabs: group.tabs.map(remap),
          activePath: group.activePath ? remap(group.activePath) : '',
        })),
      );
      setFileClipboard((current) =>
        current?.workspace === workspace
          ? {
              ...current,
              entries: current.entries.map((copied) => ({
                ...copied,
                path: remap(copied.path),
                name: remap(copied.path).split('/').pop() ?? copied.name,
              })),
            }
          : current,
      );
      setSelectedPaths((current) => new Set([...current].map(remap)));
      setExpanded((current) => new Set([...current].map(remap)));
      setSelectedPath(nextPath);
      selectionAnchor.current = nextPath;
      setSelectedDirectory((current) => (current ? remap(current) : ''));
      setRenamingPath('');
      setRenameName('');
      await refreshWorkspace(workspace);
      setMessage('');
    } catch (error) {
      setMessage(`Could not rename ${target.name}: ${String(error)}`);
    }
  };

  const deleteEntries = async (requestedEntries: DiskFile[]) => {
    if (!workspace || !requestedEntries.length) return;
    const entries = removeNestedEntries(requestedEntries);
    const batch: DeletedEntry[] = [];
    let failure = '';
    try {
      const trashRoot = await join(await appDataDir(), 'undo-trash');
      await mkdir(trashRoot, { recursive: true });
      for (const entry of entries) {
        const trashedPath = await join(
          trashRoot,
          `${Date.now()}-${++trashCounter.current}-${entry.name}`,
        );
        try {
          await copyTreeEntry(
            `${workspace}/${entry.path}`,
            trashedPath,
            entry.kind,
          );
          await remove(`${workspace}/${entry.path}`, {
            recursive: entry.kind === 'directory',
          });
          batch.push({ originalPath: entry.path, trashedPath, entry });
        } catch (error) {
          if (await exists(trashedPath).catch(() => false))
            await remove(trashedPath, {
              recursive: entry.kind === 'directory',
            }).catch(() => undefined);
          failure = `${entry.name}: ${String(error)}`;
        }
      }
    } catch (error) {
      setMessage(`Could not delete items: ${String(error)}`);
      return;
    }
    if (!batch.length) {
      if (failure) setMessage(`Could not delete ${failure}`);
      return;
    }
    const affected = (path: string) =>
      batch.some(
        ({ entry }) =>
          path === entry.path ||
          (entry.kind === 'directory' && path.startsWith(`${entry.path}/`)),
      );
    setUndoStack((current) => [...current, { workspace, entries: batch }]);
    for (const path of fileContents.current.keys())
      if (affected(path)) {
        fileContents.current.delete(path);
        lastDiskWrite.current.delete(path);
      }
    setOpenFiles((current) => current.filter((file) => !affected(file.path)));
    const nextGroups = groups.map((group) => {
      const tabs = group.tabs.filter((path) => !affected(path));
      return {
        ...group,
        tabs,
        activePath: affected(group.activePath)
          ? (tabs.at(-1) ?? '')
          : group.activePath,
      };
    });
    normalizeGroups(nextGroups);
    setSelectedPaths(
      (current) => new Set([...current].filter((path) => !affected(path))),
    );
    setSelectedPath((current) => (affected(current) ? '' : current));
    setSelectedDirectory((current) => (affected(current) ? '' : current));
    setExpanded(
      (current) => new Set([...current].filter((path) => !affected(path))),
    );
    setFileClipboard((current) => {
      if (current?.workspace !== workspace) return current;
      const remaining = current.entries.filter(
        (entry) => !affected(entry.path),
      );
      return remaining.length ? { ...current, entries: remaining } : null;
    });
    if (affected(selectionAnchor.current)) selectionAnchor.current = '';
    setContextMenu(null);
    await refreshWorkspace(workspace);
    setMessage(
      failure
        ? `Deleted ${batch.length} items. Some items failed: ${failure}`
        : `Deleted ${batch.length} items. Press Ctrl+Z to undo.`,
    );
  };

  const undoDeletion = async () => {
    if (!workspace) return;
    let batchIndex = -1;
    for (let index = undoStack.length - 1; index >= 0; index -= 1) {
      if (undoStack[index].workspace === workspace) {
        batchIndex = index;
        break;
      }
    }
    if (batchIndex < 0) return;
    const batch = undoStack[batchIndex];
    const collision = await Promise.all(
      batch.entries.map(async (entry) =>
        (await exists(`${workspace}/${entry.originalPath}`))
          ? entry.originalPath
          : '',
      ),
    );
    const collidingPath = collision.find(Boolean);
    if (collidingPath) {
      setMessage(`Cannot undo: ${collidingPath} already exists.`);
      return;
    }
    const restored: DeletedEntry[] = [];
    let failure = '';
    for (const entry of batch.entries) {
      try {
        const parent = parentDirectory(entry.originalPath);
        if (parent) await mkdir(`${workspace}/${parent}`, { recursive: true });
        const destination = `${workspace}/${entry.originalPath}`;
        await copyTreeEntry(entry.trashedPath, destination, entry.entry.kind);
        restored.push(entry);
        await remove(entry.trashedPath, {
          recursive: entry.entry.kind === 'directory',
        }).catch(() => undefined);
      } catch (error) {
        const destination = `${workspace}/${entry.originalPath}`;
        if (await exists(destination).catch(() => false))
          await remove(destination, {
            recursive: entry.entry.kind === 'directory',
          }).catch(() => undefined);
        failure = String(error);
        break;
      }
    }
    if (!restored.length) {
      setMessage(`Could not undo deletion: ${failure}`);
      return;
    }
    const restoredPaths = new Set(restored.map((entry) => entry.originalPath));
    setUndoStack((current) =>
      current.flatMap((item, index) =>
        index !== batchIndex
          ? [item]
          : (() => {
              const remaining = item.entries.filter(
                (entry) => !restoredPaths.has(entry.originalPath),
              );
              return remaining.length ? [{ ...item, entries: remaining }] : [];
            })(),
      ),
    );
    await refreshWorkspace(workspace);
    setSelectedPaths(restoredPaths);
    setSelectedPath(restored.at(-1)?.originalPath ?? '');
    selectionAnchor.current = restored.at(-1)?.originalPath ?? '';
    setSelectedDirectory('');
    setExpanded((current) => {
      const next = new Set(current);
      for (const entry of restored) {
        const parent = parentDirectory(entry.originalPath);
        if (parent) next.add(parent);
      }
      return next;
    });
    setMessage(
      failure
        ? `Restored ${restored.length} items; undo incomplete: ${failure}`
        : `Restored ${restored.length} items.`,
    );
  };

  const setActiveTab = (groupId: GroupId, path: string) => {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId ? { ...group, activePath: path } : group,
      ),
    );
    setActiveGroupId(groupId);
  };

  const handleKey = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    const target = event.target as HTMLElement;
    if (
      (event.key === 'F2' || event.key === 'Delete') &&
      target.matches("input, textarea, [contenteditable='true']")
    )
      return;
    if (event.key === 'Escape') {
      if (commandPaletteOpen) {
        setCommandPaletteOpen(false);
        return;
      }
      const hadMenu = Boolean(contextMenu);
      setContextMenu(null);
      if (hadMenu) return;
      const inViewer =
        !settingsOpen &&
        !themeMakerOpen &&
        Boolean(target.closest('.file-viewer')) &&
        !target.matches("input, textarea, [contenteditable='true']");
      if (inViewer && !renamingPath && !newItemKind) {
        // Escape deselects (VS Code behavior): selection falls back to root.
        if (selectedPath || selectedPaths.size) {
          setSelectedPath('');
          setSelectedPaths(new Set());
          setSelectedDirectory('');
          selectionAnchor.current = '';
        }
      }
      return;
    }
    if (event.key === 'F2' && selectedPath) {
      event.preventDefault();
      const entry = files.find((file) => file.path === selectedPath);
      if (entry) startRename(entry);
      return;
    }
    if (event.key === 'Delete' && selectedPath) {
      event.preventDefault();
      setContextMenu(null);
      void deleteEntries(currentSelection());
      return;
    }
    if (event.altKey && event.shiftKey && key === 'f') {
      event.preventDefault();
      const group = groups.find((entry) => entry.id === activeGroupId);
      if (group?.activePath) void formatFile(group.activePath);
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.shiftKey && key === 'p') {
      event.preventDefault();
      setCommandPaletteOpen(true);
      setCommandQuery('');
      return;
    }
    const pluginBinding = pluginRuntime.keybindings.find(
      (binding) =>
        pluginRuntime.conditionMatches(binding.pluginId, binding.condition) &&
        matchesPluginShortcut(event, binding.shortcut),
    );
    if (pluginBinding) {
      const command = pluginRuntime.commands.find(
        (candidate) => candidate.id === pluginBinding.commandId,
      );
      if (command) {
        event.preventDefault();
        void runPaletteCommand(command);
        return;
      }
    }
    const pluginCommand = pluginRuntime.commands.find(
      (command) =>
        command.shortcut && matchesPluginShortcut(event, command.shortcut),
    );
    if (pluginCommand) {
      event.preventDefault();
      void runPaletteCommand(pluginCommand);
      return;
    }
    if (!modifier) return;
    if (key === 't') {
      event.preventDefault();
      openTerminal();
      return;
    }
    if (key === 'n') {
      event.preventDefault();
      startCreating(event.shiftKey ? 'folder' : 'file');
      return;
    }
    const inFileViewer =
      !settingsOpen &&
      !themeMakerOpen &&
      Boolean(
        target.closest('.file-viewer, .context-menu') ||
        contextMenu ||
        (target === document.body &&
          (selectedPath ||
            undoStack.some((batch) => batch.workspace === workspace))),
      ) &&
      !target.matches("input, textarea, [contenteditable='true']");
    if (
      inFileViewer &&
      key === 'z' &&
      undoStack.some((batch) => batch.workspace === workspace)
    ) {
      event.preventDefault();
      void undoDeletion();
      return;
    }
    if (inFileViewer && key === 'c') {
      const entries = currentSelection();
      if (entries.length) {
        event.preventDefault();
        copyEntry(entries.at(-1)!);
        return;
      }
    }
    if (inFileViewer && key === 'v' && fileClipboard) {
      event.preventDefault();
      const selected = files.find((file) => file.path === selectedPath);
      const destination = contextMenu
        ? contextMenu.target?.kind === 'directory'
          ? contextMenu.target.path
          : contextMenu.target
            ? parentDirectory(contextMenu.target.path)
            : ''
        : selected?.kind === 'directory'
          ? selected.path
          : selected
            ? parentDirectory(selected.path)
            : selectedDirectory;
      void pasteEntry(destination);
      return;
    }
    if (key === ',' || event.code === 'Comma') {
      event.preventDefault();
      if (themeMakerOpen) {
        setThemeMakerOpen(false);
        setSettingsOpen(true);
      } else {
        setSettingsOpen((current) => !current);
      }
      return;
    }
    if (key === '=' || key === '+' || event.code === 'NumpadAdd') {
      event.preventDefault();
      updateSettings({
        zoomLevel: Math.min(
          2,
          Math.round((settings.zoomLevel + 0.1) * 10) / 10,
        ),
      });
      return;
    }
    if (key === '-' || event.code === 'NumpadSubtract') {
      event.preventDefault();
      updateSettings({
        zoomLevel: Math.max(
          0.5,
          Math.round((settings.zoomLevel - 0.1) * 10) / 10,
        ),
      });
      return;
    }
    if (key === '0' || event.code === 'Numpad0') {
      event.preventDefault();
      updateSettings({ zoomLevel: 1 });
      return;
    }
    if (key === 'k') {
      event.preventDefault();
      folderChord.current = true;
      window.clearTimeout(folderChordTimer.current);
      folderChordTimer.current = window.setTimeout(() => {
        folderChord.current = false;
      }, 1500);
      return;
    }
    if (event.code === 'Backslash') {
      event.preventDefault();
      createSplitGroup(activeGroupId, {
        direction: event.shiftKey ? 'horizontal' : 'vertical',
        after: true,
      });
      return;
    }
    if (folderChord.current) {
      folderChord.current = false;
      window.clearTimeout(folderChordTimer.current);
      if (key === 'o') {
        event.preventDefault();
        void openWorkspace();
        return;
      }
    }
    if (key === 'b') {
      event.preventDefault();
      setViewerOpen((value) => !value);
    } else if (key === 'w') {
      event.preventDefault();
      const group = groups.find((entry) => entry.id === activeGroupId);
      if (group?.activePath) void closeTab(activeGroupId, group.activePath);
    } else if (key === 's') {
      event.preventDefault();
      const group = groups.find((entry) => entry.id === activeGroupId);
      if (group?.activePath) void saveFile(group.activePath);
    }
  };
  const keyHandlerRef = useRef(handleKey);
  keyHandlerRef.current = handleKey;
  useEffect(() => {
    const dispatchKey = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener('keydown', dispatchKey);
    return () => window.removeEventListener('keydown', dispatchKey);
  }, []);

  const startTreeDrag = (
    event: ReactDragEvent<HTMLElement>,
    entry: DiskFile,
  ) => {
    const selected = selectedPaths.has(entry.path)
      ? files.filter((file) => selectedPaths.has(file.path))
      : [entry];
    const entries = removeNestedEntries(selected);
    if (!selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set([entry.path]));
      setSelectedPath(entry.path);
      selectionAnchor.current = entry.path;
    }
    event.dataTransfer.setData(
      'application/x-arc-tree-entries',
      JSON.stringify(entries.map((item) => item.path)),
    );
    event.dataTransfer.setData('application/x-arc-tree-entry', entry.path);
    event.dataTransfer.setData('application/x-arc-file', entry.path);
    event.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleTreeDragOver = (
    event: ReactDragEvent<HTMLElement>,
    destination: string,
  ) => {
    if (
      !Array.from(event.dataTransfer.types).includes(
        'application/x-arc-tree-entries',
      ) &&
      !Array.from(event.dataTransfer.types).includes(
        'application/x-arc-tree-entry',
      )
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetPath(destination);
  };

  const handleTreeDrop = (
    event: ReactDragEvent<HTMLElement>,
    destination: string,
  ) => {
    const encoded = event.dataTransfer.getData(
      'application/x-arc-tree-entries',
    );
    const single = event.dataTransfer.getData('application/x-arc-tree-entry');
    let paths: string[] = single ? [single] : [];
    try {
      if (encoded) paths = JSON.parse(encoded) as string[];
    } catch {
      paths = single ? [single] : [];
    }
    if (!paths.length) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTargetPath(null);
    void moveEntries(paths, destination);
  };

  const deferredFilter = useDeferredValue(filter);
  const normalizedFilter = deferredFilter.trim().toLowerCase();
  const filteredFiles = useMemo(
    () =>
      normalizedFilter
        ? files.filter(
            (file) =>
              file.kind === 'file' &&
              file.path.toLowerCase().includes(normalizedFilter),
          )
        : [],
    [files, normalizedFilter],
  );

  const currentSelection = () =>
    removeNestedEntries(
      files.filter(
        (file) => selectedPaths.has(file.path) || file.path === selectedPath,
      ),
    );

  const selectTreeEntry = (event: ReactMouseEvent, entry: DiskFile) => {
    if (event.shiftKey) {
      const visible = deferredFilter.trim() ? filteredFiles : visibleTreeEntries;
      const anchor = selectionAnchor.current || selectedPath;
      const from = visible.findIndex((item) => item.path === anchor);
      const to = visible.findIndex((item) => item.path === entry.path);
      const range = visible.slice(
        Math.min(from < 0 ? to : from, to),
        Math.max(from < 0 ? to : from, to) + 1,
      );
      const next =
        event.ctrlKey || event.metaKey
          ? new Set(selectedPaths)
          : new Set<string>();
      range.forEach((item) => next.add(item.path));
      setSelectedPaths(next);
      setSelectedPath(entry.path);
      return false;
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(
        selectedPaths.size ? selectedPaths : selectedPath ? [selectedPath] : [],
      );
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      setSelectedPaths(next);
      setSelectedPath(
        next.has(entry.path) ? entry.path : ([...next].at(-1) ?? ''),
      );
      if (!next.size) setSelectedDirectory('');
      if (!selectionAnchor.current) selectionAnchor.current = entry.path;
      return false;
    }
    setSelectedPaths(new Set([entry.path]));
    setSelectedPath(entry.path);
    selectionAnchor.current = entry.path;
    return true;
  };

  const selectContextEntry = (entry: DiskFile) => {
    if (!selectedPaths.has(entry.path)) {
      setSelectedPaths(new Set([entry.path]));
      setSelectedPath(entry.path);
      selectionAnchor.current = entry.path;
    } else {
      setSelectedPath(entry.path);
    }
  };

  const renderSearchResults = () => {
    const start = Math.max(0, Math.floor(treeScrollTop / 24) - 8);
    const end = Math.min(
      filteredFiles.length,
      start + Math.ceil(treeViewportHeight / 24) + 16,
    );
    return (
      <>
        <div aria-hidden="true" style={{ height: start * 24 }} />
        {filteredFiles.slice(start, end).map((file) =>
          renamingPath === file.path ? (
            <div key={file.path}>{renderRenameInput(file)}</div>
          ) : (
            <button
              key={file.path}
              className={`tree-row search-result ${selectedPaths.has(file.path) || selectedPath === file.path ? 'selected' : ''}`}
              draggable
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectContextEntry(file);
                setContextMenu({
                  x: Math.min(event.clientX, window.innerWidth - 205),
                  y: Math.min(event.clientY, window.innerHeight - 305),
                  target: file,
                });
              }}
              onDragStart={(event) => startTreeDrag(event, file)}
              onDragEnd={() => setDropTargetPath(null)}
              onDragOver={(event) =>
                handleTreeDragOver(event, parentDirectory(file.path))
              }
              onDrop={(event) =>
                handleTreeDrop(event, parentDirectory(file.path))
              }
              onClick={(event) => {
                if (selectTreeEntry(event, file)) void openFile(file);
              }}
            >
              <FileIcon name={file.name} />
              <span className="tree-label">{file.name}</span>
              <span className="search-path">{file.path}</span>
            </button>
          ),
        )}
        <div
          aria-hidden="true"
          style={{ height: Math.max(0, filteredFiles.length - end) * 24 }}
        />
      </>
    );
  };

  const renderRenameInput = (entry: DiskFile, depth = 0) => (
    <div
      className="tree-row rename-row"
      style={{ paddingLeft: `${10 + depth * 13}px` }}
    >
      {entry.kind === 'directory' ? (
        <Folder size={14} className="folder-icon" />
      ) : (
        <FileIcon name={entry.name} />
      )}
      <input
        autoFocus
        value={renameName}
        onChange={(event) => setRenameName(event.target.value)}
        onBlur={() => {
          setRenamingPath((current) => (current === entry.path ? '' : current));
          setRenameName('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            void renameEntry(entry, renameName);
          } else if (event.key === 'Escape') {
            setRenamingPath('');
            setRenameName('');
          }
        }}
      />
    </div>
  );

  const renderTree = () => (
    <>
      <div aria-hidden="true" style={{ height: treeWindowStart * 24 }} />
      {visibleTreeNodes
        .slice(treeWindowStart, treeWindowEnd)
        .map(({ node, depth }) => {
          const isOpen = expanded.has(node.path);
          const isActive =
            selectedPaths.has(node.path) || selectedPath === node.path;
          const isDropTarget =
            node.kind === 'directory' && dropTargetPath === node.path;
          const icon =
            node.kind === 'directory' ? (
              <Folder
                size={14}
                className={isOpen ? 'folder-open' : 'folder-icon'}
              />
            ) : (
              <FileIcon name={node.name} />
            );
          return renamingPath === node.path ? (
            <div key={node.path}>{renderRenameInput(node, depth)}</div>
          ) : (
            <button
              key={node.path}
              className={`tree-row ${isActive ? 'selected' : ''} ${isDropTarget ? 'drop-target-row' : ''}`}
              style={{ paddingLeft: `${10 + depth * 13}px` }}
              draggable
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                selectContextEntry(node);
                if (node.kind === 'directory') setSelectedDirectory(node.path);
                setContextMenu({
                  x: Math.min(event.clientX, window.innerWidth - 205),
                  y: Math.min(event.clientY, window.innerHeight - 305),
                  target: node,
                });
              }}
              onDragStart={(event) => startTreeDrag(event, node)}
              onDragEnd={() => setDropTargetPath(null)}
              onDragOver={(event) =>
                handleTreeDragOver(
                  event,
                  node.kind === 'directory'
                    ? node.path
                    : parentDirectory(node.path),
                )
              }
              onDrop={(event) =>
                handleTreeDrop(
                  event,
                  node.kind === 'directory'
                    ? node.path
                    : parentDirectory(node.path),
                )
              }
              onClick={(event) => {
                const openSingle = selectTreeEntry(event, node);
                if (!openSingle) return;
                if (node.kind === 'directory') {
                  setSelectedDirectory(node.path);
                  setExpanded((current) => {
                    const next = new Set(current);
                    next.has(node.path)
                      ? next.delete(node.path)
                      : next.add(node.path);
                    return next;
                  });
                } else {
                  void openFile(node);
                }
              }}
            >
              {node.kind === 'directory' ? (
                isOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )
              ) : (
                <span className="tree-spacer" />
              )}
              {icon}
              <span className="tree-label">{node.name}</span>
            </button>
          );
        })}
      <div
        aria-hidden="true"
        style={{
          height: Math.max(0, visibleTreeNodes.length - treeWindowEnd) * 24,
        }}
      />
    </>
  );

  const openPluginView = (id: string) => {
    const path = `${PLUGIN_VIEW_PREFIX}${id}`;
    setGroups((current) =>
      current.map((group) =>
        group.id === activeGroupId
          ? {
              ...group,
              activePath: path,
              tabs: group.tabs.includes(path)
                ? group.tabs
                : [...group.tabs, path],
            }
          : group,
      ),
    );
    setSettingsOpen(false);
    setThemeMakerOpen(false);
    setMessage('');
  };

  const activeEditorPath = () => {
    const activePath = groups.find(
      (group) => group.id === activeGroupId,
    )?.activePath;
    return openFiles.some((file) => file.path === activePath)
      ? activePath
      : undefined;
  };

  const editorViewForPath = (path: string) => {
    const views = editorViews.current.get(path);
    if (!views) return null;
    return views.get(activeGroupId) ?? views.values().next().value ?? null;
  };

  const getPluginEditor = (path?: string) =>
    editorViewForPath(path ?? activeEditorPath() ?? '');

  const getPluginEditorSnapshot = (path?: string) => {
    const activePath = path ?? activeEditorPath();
    if (!activePath) return null;
    const file = openFiles.find((entry) => entry.path === activePath);
    if (!file) return null;
    const editor = editorViewForPath(activePath);
    const selection = editor?.state.selection.main;
    return {
      path: activePath,
      name: file.name,
      text: fileContents.current.get(activePath) ?? '',
      dirty: file.dirty,
      selection: { from: selection?.from ?? 0, to: selection?.to ?? 0 },
    };
  };

  const getPluginEditorContext = (path?: string): PluginEditorContext | null => {
    const snapshot = getPluginEditorSnapshot(path);
    if (!snapshot) return null;
    const editor = editorViewForPath(snapshot.path);
    const line = editor
      ? editor.state.doc.lineAt(editor.state.selection.main.head)
      : null;
    const visibleRanges = editor
      ? editor.visibleRanges.map((range) => ({
          from: range.from,
          to: range.to,
        }))
      : [];
    const languageId =
      pluginLanguageOverrides[snapshot.path] ??
      pluginRuntime.languages.find(
        (language) =>
          (language.extensions ?? []).some(
            (value) => value.toLowerCase() === extensionOf(snapshot.name),
          ) ||
          (language.filenames ?? []).some(
            (value) => value.toLowerCase() === snapshot.name.toLowerCase(),
          ),
      )?.id ??
      extensionOf(snapshot.name);
    return {
      path: snapshot.path,
      uri: `file://${snapshot.path.split('/').map(encodeURIComponent).join('/')}`,
      name: snapshot.name,
      language: languageId,
      version: editor?.state.doc.length ?? snapshot.text.length,
      cursor: {
        line: line?.number ?? 1,
        column: line
          ? (editor?.state.selection.main.head ?? line.from) - line.from + 1
          : 1,
        offset: editor?.state.selection.main.head ?? snapshot.selection.from,
      },
      selection: snapshot.selection,
      selections: editor
        ? editor.state.selection.ranges.map((range) => ({
            from: range.from,
            to: range.to,
          }))
        : [snapshot.selection],
      dirty: snapshot.dirty,
      focused: editor?.hasFocus ?? false,
      visibleRanges,
    };
  };

  const normalizePluginPath = (path: string) =>
    path.startsWith(workspace)
      ? path.slice(workspace.length).replace(/^[\\/]+/, '')
      : path.replace(/\\/g, '/').replace(/^\.\//, '');

  const pluginRuntime = usePluginRuntime(workspace, setMessage, {
    getAppState: (): PluginAppSnapshot => ({
      workspace,
      activeFile: activeEditorPath() ?? '',
      openFiles: openFiles.map(({ path, name, dirty }) => ({
        path,
        name,
        dirty,
      })),
      terminals: terminals.map(({ id, title, cwd }) => ({ id, title, cwd })),
      settings: { ...settings },
      theme: { ...activeTheme, colors: { ...activeTheme.colors } },
    }),
    getThemes: () => themes.map(({ id, name }) => ({ id, name })),
    openWorkspace: async () => openWorkspace(),
    openSettings: () => {
      setSettingsOpen(true);
      setThemeMakerOpen(false);
    },
    openGithub: openGithubPanel,
    openPlugins: openPluginPanel,
    openPluginPanel: openPluginView,
    setTitle: (title) => {
      document.title = title;
      if (isTauri()) void getCurrentWindow().setTitle(title);
    },
    updateSettings,
    setTheme: (id) => {
      if (!themes.some((theme) => theme.id === id)) return false;
      updateSettings({ selectedTheme: id });
      return true;
    },
    refreshWorkspace: async () => {
      if (workspace) await refreshWorkspace(workspace);
    },
    openFile: async (path) => {
      const relativePath = normalizePluginPath(path);
      await openFile({
        path: relativePath,
        name: relativePath.split('/').at(-1) ?? relativePath,
        kind: 'file',
      });
    },
    deleteFile: async (path) => {
      const relativePath = normalizePluginPath(path);
      const entry = files.find((file) => file.path === relativePath);
      if (!entry) throw new Error(`Workspace entry not found: ${relativePath}`);
      await deleteEntries([entry]);
    },
    renameFile: async (path, name) => {
      const relativePath = normalizePluginPath(path);
      const entry = files.find((file) => file.path === relativePath);
      if (!entry) throw new Error(`Workspace entry not found: ${relativePath}`);
      await renameEntry(entry, name);
    },
    saveFile,
    formatFile,
    getEditor: (path) =>
      getPluginEditor(path ? normalizePluginPath(path) : undefined),
    getEditorSnapshot: (path) =>
      getPluginEditorSnapshot(path ? normalizePluginPath(path) : undefined),
    getEditorContext: (path) =>
      getPluginEditorContext(path ? normalizePluginPath(path) : undefined),
    getLastActiveContext: () =>
      getPluginEditorContext(lastActiveEditorPath.current || undefined),
    setEditorLanguage: (path, languageId) => {
      const relativePath = normalizePluginPath(path);
      setPluginLanguageOverrides((current) => ({
        ...current,
        [relativePath]: languageId,
      }));
    },
    closePluginPanel: (id) => {
      const key = `${PLUGIN_VIEW_PREFIX}${id}`;
      const group = groups.find((entry) => entry.tabs.includes(key));
      if (group) void closeTab(group.id, key);
    },
    getWorkspaceFolders: () =>
      workspace
        ? [
            {
              path: workspace,
              name: workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace,
              index: 0,
            },
          ]
        : [],
    isWorkspaceTrusted: () => Boolean(workspace),
    getGitStatus: () =>
      workspace
        ? invoke('github_status', { root: workspace })
        : Promise.resolve(null),
    getGitBranch: async () => {
      const status = (await (workspace
        ? invoke('github_status', { root: workspace })
        : Promise.resolve(null))) as { branch?: string | null } | null;
      return status?.branch ? { name: status.branch } : null;
    },
    getGitDiff: (path, staged) =>
      workspace
        ? invoke<string>('github_diff', {
            root: workspace,
            path: path ?? null,
            staged: staged ?? false,
          })
        : Promise.resolve(''),
    setEditorText: (path, text) => {
      const relativePath = normalizePluginPath(path);
      const editor = editorViewForPath(relativePath);
      if (editor)
        editor.dispatch({
          changes: { from: 0, to: editor.state.doc.length, insert: text },
        });
      else if (openFiles.some((file) => file.path === relativePath))
        updateFile(relativePath, text, true);
      else throw new Error(`No open editor matches ${relativePath}.`);
    },
    getTerminals: () =>
      terminals.map(({ id, title, cwd }) => ({ id, title, cwd })),
    openTerminal,
    writeTerminal: async (id, data) => invoke('terminal_write', { id, data }),
    resizeTerminal: async (id, cols, rows) =>
      invoke('terminal_resize', { id, cols, rows }),
    closeTerminal: async (id) => {
      const terminal = terminals.find((entry) => entry.id === id);
      if (!terminal) return;
      const group = groups.find((entry) => entry.tabs.includes(terminal.key));
      if (group) await closeTab(group.id, terminal.key);
    },
  });

  useEffect(() => {
    pluginRuntime.emitEvent('workspace:changed', { path: workspace });
  }, [pluginRuntime.emitEvent, workspace]);
  const previousOpenPaths = useRef(new Set<string>());
  useEffect(() => {
    const next = new Set(openFiles.map((file) => file.path));
    for (const path of next) {
      if (previousOpenPaths.current.has(path)) continue;
      const file = openFiles.find((entry) => entry.path === path);
      pluginRuntime.emitEvent('document:opened', {
        path,
        name: file?.name ?? path,
      });
    }
    for (const path of previousOpenPaths.current) {
      if (next.has(path)) continue;
      pluginRuntime.emitEvent('document:closed', { path });
    }
    previousOpenPaths.current = next;
  }, [openFiles, pluginRuntime.emitEvent]);
  useEffect(() => {
    const path = activeEditorPath();
    if (path) lastActiveEditorPath.current = path;
    const context = getPluginEditorContext();
    pluginRuntime.emitEvent('editor:active', getPluginEditorSnapshot());
    pluginRuntime.emitEvent('editor:active-changed', context);
  }, [pluginRuntime.emitEvent, activeGroupId, groups, openFiles]);
  useEffect(() => {
    pluginRuntime.emitEvent('editor:context-changed', getPluginEditorContext());
  }, [
    pluginRuntime.emitEvent,
    activeGroupId,
    groups,
    openFiles,
    pluginLanguageOverrides,
  ]);
  useEffect(() => {
    pluginRuntime.emitEvent('settings:changed', {
      settings,
      theme: activeTheme,
    });
  }, [pluginRuntime.emitEvent, settings, activeTheme]);

  const appCommands: PluginCommandDefinition[] = commandPaletteOpen ? [
    { id: 'open-folder', title: 'Open Folder', run: () => openWorkspace() },
    { id: 'new-file', title: 'New File', run: () => startCreating('file') },
    {
      id: 'new-folder',
      title: 'New Folder',
      run: () => startCreating('folder'),
    },
    {
      id: 'new-terminal',
      title: 'New Terminal',
      run: () => {
        openTerminal();
      },
    },
    {
      id: 'open-settings',
      title: 'Open Settings',
      run: () => setSettingsOpen(true),
    },
    { id: 'open-plugins', title: 'Open Plugins', run: openPluginPanel },
    { id: 'open-github', title: 'Open GitHub', run: openGithubPanel },
    {
      id: 'save-file',
      title: 'Save Active File',
      run: async () => {
        const path = activeEditorPath();
        if (path) await saveFile(path);
      },
    },
    {
      id: 'format-file',
      title: 'Format Active File',
      run: async () => {
        const path = activeEditorPath();
        if (path) await formatFile(path);
      },
    },
    {
      id: 'toggle-file-viewer',
      title: 'Toggle File Viewer',
      run: () => setViewerOpen((visible) => !visible),
    },
    {
      id: 'plugin-go-to-definition',
      title: 'Go to Definition',
      run: () => pluginRuntime.languageCommands.goToDefinition(),
    },
    {
      id: 'plugin-find-references',
      title: 'Find References',
      run: () => pluginRuntime.languageCommands.findReferences(),
    },
    {
      id: 'plugin-rename-symbol',
      title: 'Rename Symbol',
      run: () => pluginRuntime.languageCommands.renameSymbol(),
    },
    {
      id: 'plugin-document-symbols',
      title: 'Go to Document Symbol',
      run: () => pluginRuntime.languageCommands.documentSymbols(),
    },
    {
      id: 'plugin-workspace-symbols',
      title: 'Go to Workspace Symbol',
      run: () => pluginRuntime.languageCommands.workspaceSymbols(),
    },
    {
      id: 'plugin-code-actions',
      title: 'Show Code Actions',
      run: () => pluginRuntime.languageCommands.codeActions(),
    },
    {
      id: 'plugin-signature-help',
      title: 'Show Signature Help',
      run: () => pluginRuntime.languageCommands.signatureHelp(),
    },
  ] : [];
  const commandItems: (PluginCommandDefinition & {
    pluginId: string;
    pluginName: string;
  })[] = commandPaletteOpen ? [
    ...appCommands.map((command) => ({
      ...command,
      pluginId: 'arc',
      pluginName: 'Arc',
    })),
    ...pluginRuntime.commands,
    ...pluginRuntime.panels.map((panel) => ({
      id: `open-panel:${panel.id}`,
      title: `Open ${panel.title}`,
      description: `Plugin panel from ${panel.pluginName}`,
      pluginId: panel.pluginId,
      pluginName: panel.pluginName,
      run: () => openPluginView(panel.id),
    })),
  ].filter((command) =>
    `${command.title} ${command.description ?? ''} ${command.pluginName}`
      .toLowerCase()
      .includes(commandQuery.toLowerCase()),
  ) : [];
  const runPaletteCommand = async (
    command: PluginCommandDefinition & { pluginId: string; pluginName: string },
  ) => {
    setCommandPaletteOpen(false);
    try {
      await command.run();
    } catch (error) {
      setMessage(`Command ${command.title} failed: ${String(error)}`);
    }
  };

  const renderLayout = (node: LayoutNode): ReactNode => {
    if (node.type === 'split') {
      return (
        <SplitContainer
          key={node.id}
          node={node}
          onResize={resizeSplit}
          first={renderLayout(node.first)}
          second={renderLayout(node.second)}
        />
      );
    }
    const group = groups.find((entry) => entry.id === node.groupId);
    if (!group) return null;
    return (
      <EditorPane
        key={group.id}
        group={group}
        file={(() => {
          const file = openFiles.find(
            (entry) => entry.path === group.activePath,
          );
          return file
            ? { ...file, content: fileContents.current.get(file.path) ?? '' }
            : undefined;
        })()}
        activeTerminal={terminals.find(
          (terminal) => terminal.key === group.activePath,
        )}
        terminals={terminals}
        files={openFiles}
        onActivate={setActiveGroupId}
        onChange={updateFile}
        onClose={closeTab}
        onDropFile={openDroppedFile}
        canCreateSplit={group.tabs.length > 0}
        onSelect={setActiveTab}
        onTerminalTitleChange={updateTerminalTitle}
        workspace={workspace}
        diskConflict={diskConflicts.has(group.activePath)}
        onConflictReload={reloadFromDisk}
        onConflictKeep={keepBuffer}
        pluginViews={pluginRuntime.panels}
        editorViews={editorViews}
        pluginLanguages={pluginRuntime.languages}
        pluginLanguageOverrides={pluginLanguageOverrides}
        pluginEditorExtensions={pluginRuntime.editorExtensions}
        pluginGrammarFor={pluginRuntime.getGrammar}
        pluginGrammarVersion={pluginRuntime.grammarVersion}
        onSelectionChange={(path) => {
          const context = getPluginEditorContext(path);
          pluginRuntime.emitEvent('editor:selection-changed', context);
          pluginRuntime.emitEvent('editor:context-changed', context);
        }}
        pluginPanel={
          <Suspense fallback={<div className="editor-empty" />}>
            <PluginPanel
              plugins={pluginRuntime.plugins}
              pluginDirectory={pluginRuntime.pluginDirectory}
              availableBuiltins={pluginRuntime.availableBuiltins}
              panels={pluginRuntime.panels}
              onInstallPlugin={pluginRuntime.installFromFolder}
              onInstallBuiltin={pluginRuntime.installBuiltin}
              onTogglePlugin={pluginRuntime.setEnabled}
              onUninstallPlugin={pluginRuntime.uninstall}
              onOpenPanel={openPluginView}
            />
          </Suspense>
        }
        settings={settings}
        theme={activeTheme}
      />
    );
  };

  if (themeMakerOpen)
    return (
      <Suspense fallback={null}>
        <ThemeMaker
          initialTheme={activeTheme}
          themes={themes}
          settings={settings}
          onBack={() => {
            setThemeMakerOpen(false);
            setSettingsOpen(true);
          }}
          onSave={(theme) =>
            void persistTheme(theme, customThemeIds.has(theme.id))
          }
          onCreate={(theme, name) => void createTheme(theme, name)}
          onOpenFolder={(theme) => void openThemeFolder(theme)}
          errorMessage={
            message.startsWith('Could not') ||
            message.startsWith('A theme named')
              ? message
              : ''
          }
        />
      </Suspense>
    );

  return (
    <main
      className={`app-shell ${settings.appTheme === 'macos' ? 'app-theme-macos' : ''} ${settings.editorGlassEnabled ? 'editor-glass-enabled' : ''} ${settings.titleBarEnabled ? '' : 'titlebar-off'}`}
      style={settings.interfaceFontFamily ? { fontFamily: settings.interfaceFontFamily } : undefined}
      onClick={() => {
        if (contextMenu) setContextMenu(null);
      }}
    >
      <style>{dynamicThemeCss}</style>
      {settings.titleBarEnabled && <TitleBar />}
      <div className="app-body">
      {!workspace &&
      terminals.length === 0 &&
      !groups.some((group) => group.tabs.includes(PLUGIN_TAB_KEY)) ? (
        <section className="welcome-screen">
          <div className="welcome-tools">
            <button
              className="settings-launch"
              aria-label="New terminal (Ctrl+T)"
              title="New terminal (Ctrl+T)"
              onClick={() => openTerminal()}
            >
              <TerminalIcon size={15} />
            </button>
            <button
              className="settings-launch"
              aria-label="Open plugins"
              title="Open plugins"
              onClick={openPluginPanel}
            >
              <Puzzle size={15} />
            </button>
            <button
              className="settings-launch"
              aria-label="Open settings (Ctrl+,)"
              title="Settings (Ctrl+,)"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon size={15} />
            </button>
          </div>
          <div className="welcome-content">
            <div className="welcome-name">ARC</div>
            <button
              className="welcome-open"
              onClick={() => void openWorkspace()}
            >
              Open Folder
            </button>
            <div className="welcome-shortcuts">
              <div>
                <span>
                  <kbd>Ctrl</kbd> <kbd>K</kbd> <kbd>Ctrl</kbd> <kbd>O</kbd>
                </span>
                <span>Open folder</span>
              </div>
              <div>
                <span>
                  <kbd>Ctrl</kbd> <kbd>T</kbd>
                </span>
                <span>New terminal</span>
              </div>
              <div>
                <span>
                  <kbd>Ctrl</kbd> <kbd>B</kbd>
                </span>
                <span>Show file viewer</span>
              </div>
              <div>
                <span>
                  <kbd>Ctrl</kbd> <kbd>W</kbd>
                </span>
                <span>Close editor</span>
              </div>
              <div>
                <span>
                  <kbd>Ctrl</kbd> <kbd>S</kbd>
                </span>
                <span>Save file</span>
              </div>
              <div>
                <span>
                  <kbd>Shift</kbd> <kbd>Alt</kbd> <kbd>F</kbd>
                </span>
                <span>Format document</span>
              </div>
              <div>
                <span>
                  <kbd>Ctrl</kbd> <kbd>\</kbd>
                </span>
                <span>Split editor</span>
              </div>
              <div>
                <span>
                  <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>\</kbd>
                </span>
                <span>Horizontal split</span>
              </div>
              <div>
                <span>
                  <kbd>Ctrl</kbd> <kbd>,</kbd>
                </span>
                <span>Settings</span>
              </div>
              <div>
                <span>
                  <kbd>Ctrl</kbd> <kbd>N</kbd>
                </span>
                <span>New file</span>
              </div>
              <div>
                <span>
                  <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>N</kbd>
                </span>
                <span>New folder</span>
              </div>
            </div>
            {message && (
              <div
                className={`welcome-message ${message.startsWith('Could not') ? 'error' : ''}`}
              >
                {message}
              </div>
            )}
          </div>
        </section>
      ) : (
        <>
          {workspace && viewerOpen && (
            <aside
              className="file-viewer"
              style={{
                width: settings.sidebarWidth,
                flexBasis: settings.sidebarWidth,
              }}
              onContextMenu={(event) => {
                if ((event.target as HTMLElement).closest('.tree-row')) return;
                event.preventDefault();
                setSelectedDirectory('');
                setContextMenu({
                  x: Math.min(event.clientX, window.innerWidth - 205),
                  y: Math.min(event.clientY, window.innerHeight - 230),
                });
              }}
            >
              <div className="viewer-heading">
                <div className="viewer-actions">
                  <button
                    className="tool-button"
                    title="Settings (Ctrl+,)"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <SettingsIcon size={14} />
                  </button>
                  <button
                    className="tool-button"
                    title="Open plugins"
                    onClick={openPluginPanel}
                  >
                    <Puzzle size={14} />
                  </button>
                  <button
                    className="tool-button"
                    title="Open GitHub"
                    onClick={() => openGithubPanel()}
                  >
                    <Github size={14} />
                  </button>
                  <button
                    className="tool-button"
                    title="New terminal (Ctrl+T)"
                    onClick={() => openTerminal()}
                  >
                    <TerminalIcon size={14} />
                  </button>
                </div>
                <div className="viewer-actions">
                  <button
                    className="tool-button"
                    title="Search files"
                    onClick={() => {
                      setSearchOpen((value) => !value);
                      setFilter('');
                    }}
                  >
                    <Search size={14} />
                  </button>
                  <button
                    className="tool-button"
                    title="Open another folder"
                    onClick={() => void openWorkspace()}
                  >
                    <FolderOpen size={14} />
                  </button>
                  <button
                    className="tool-button"
                    title="New file (Ctrl+N)"
                    onClick={() => startCreating('file')}
                  >
                    <FilePlus2 size={14} />
                  </button>
                  <button
                    className="tool-button"
                    title="New folder (Ctrl+Shift+N)"
                    onClick={() => startCreating('folder')}
                  >
                    <FolderPlus size={14} />
                  </button>
                  <button
                    className="tool-button"
                    title="Hide file viewer (Ctrl+B)"
                    onClick={() => setViewerOpen(false)}
                  >
                    <PanelLeftClose size={14} />
                  </button>
                </div>
              </div>
              {searchOpen && (
                <label className="search-row">
                  <Search size={13} />
                  <input
                    autoFocus
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Find file"
                  />
                  <button
                    className="tool-button"
                    onClick={() => {
                      setSearchOpen(false);
                      setFilter('');
                    }}
                  >
                    <X size={13} />
                  </button>
                </label>
              )}
              <div
                ref={treeScrollRef}
                className="tree-scroll"
                onScroll={(event) =>
                  setTreeScrollTop(
                    Math.floor(event.currentTarget.scrollTop / 24) * 24,
                  )
                }
                onDragOver={(event) => {
                  if ((event.target as HTMLElement).closest('.tree-row'))
                    return;
                  handleTreeDragOver(event, '');
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(
                      event.relatedTarget as Node | null,
                    )
                  )
                    setDropTargetPath(null);
                }}
                onDrop={(event) => {
                  if ((event.target as HTMLElement).closest('.tree-row'))
                    return;
                  handleTreeDrop(event, '');
                }}
                onClick={(event) => {
                  // Empty space below the last row selects the workspace
                  // root (VS Code behavior): new files land at the root.
                  if ((event.target as HTMLElement).closest('.tree-row, input'))
                    return;
                  setSelectedPaths(new Set());
                  setSelectedPath('');
                  setSelectedDirectory('');
                  selectionAnchor.current = '';
                }}
              >
                {newItemKind && (
                  <div className="tree-create-row">
                    {newItemKind === 'file' ? (
                      <FilePlus2 size={14} />
                    ) : (
                      <FolderPlus size={14} />
                    )}
                    <input
                      autoFocus
                      aria-label={`New ${newItemKind} name`}
                      placeholder={
                        newItemKind === 'file' ? 'filename.ext' : 'folder name'
                      }
                      value={newItemName}
                      onChange={(event) => setNewItemName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void (newItemKind === 'file'
                            ? createFile(newItemName)
                            : createFolder(newItemName));
                        } else if (event.key === 'Escape') {
                          setNewItemKind(null);
                          setNewItemName('');
                        }
                      }}
                    />
                  </div>
                )}
                {deferredFilter.trim() ? (
                  filteredFiles.length ? (
                    renderSearchResults()
                  ) : (
                    <div className="empty-hint">No files found.</div>
                  )
                ) : tree.length ? (
                  renderTree()
                ) : (
                  <div className="empty-hint">No visible files.</div>
                )}
              </div>
              <div className="file-viewer-footer">
                {pluginRuntime.actions.map((action) => (
                  <button
                    key={action.id}
                    className="settings-launch"
                    aria-label={action.label}
                    title={action.title ?? action.label}
                    onClick={() => void runPluginAction(action)}
                  >
                    <PluginToolbarIcon
                      name={action.icon}
                      svg={
                        action.icon
                          ? pluginRuntime.icons[
                              `${action.pluginId}:${action.icon}`
                            ]
                          : undefined
                      }
                    />
                  </button>
                ))}
                <span
                  className="file-viewer-project"
                  title={workspace.split(/[\\/]/).filter(Boolean).pop()}
                >
                  {workspace.split(/[\\/]/).filter(Boolean).pop()}
                </span>
              </div>
            </aside>
          )}
          {workspace && (
            <div
              className={`file-viewer-resizer ${viewerOpen ? '' : 'collapsed'}`}
              role="separator"
              tabIndex={0}
              aria-label="Resize file viewer"
              aria-orientation="vertical"
              aria-valuemin={MIN_VIEWER_WIDTH}
              aria-valuemax={480}
              aria-valuenow={settings.sidebarWidth}
              onPointerDown={beginViewerResize}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                  return;
                event.preventDefault();
                const nextWidth =
                  settings.sidebarWidth +
                  (event.key === 'ArrowRight' ? 10 : -10);
                if (nextWidth < MIN_VIEWER_WIDTH) setViewerOpen(false);
                else {
                  setViewerOpen(true);
                  updateSettings({ sidebarWidth: Math.min(480, nextWidth) });
                }
              }}
            >
              <span />
            </div>
          )}
          {workspace && !viewerOpen && (
            <button
              className="show-viewer"
              title="Show file viewer (Ctrl+B)"
              onClick={() => setViewerOpen(true)}
            >
              <PanelLeftOpen size={15} />
            </button>
          )}
          {!workspace && (
            <div className="terminal-global-tools">
              <button
                className="settings-launch"
                aria-label="Open folder"
                title="Open folder"
                onClick={() => void openWorkspace()}
              >
                <FolderOpen size={15} />
              </button>
              <button
                className="settings-launch"
                aria-label="New terminal (Ctrl+T)"
                title="New terminal (Ctrl+T)"
                onClick={() => openTerminal()}
              >
                <TerminalIcon size={15} />
              </button>
              <button
                className="settings-launch"
                aria-label="Open plugins"
                title="Open plugins"
                onClick={openPluginPanel}
              >
                <Puzzle size={15} />
              </button>
              <button
                className="settings-launch"
                aria-label="Open settings (Ctrl+,)"
                title="Settings (Ctrl+,)"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon size={15} />
              </button>
            </div>
          )}
          <section className="editor-root">
            {renderLayout(layout)}
            {pluginRuntime.statusItems.length > 0 && (
              <div className="plugin-status-bar">
                {pluginRuntime.statusItems
                  .filter((item) => item.position !== 'right')
                  .map((item) => (
                    <button
                      key={item.id}
                      title={item.tooltip ?? item.pluginName}
                      onClick={() => void runPluginStatusItem(item)}
                    >
                      {item.text}
                    </button>
                  ))}
                <span />
                {pluginRuntime.statusItems
                  .filter((item) => item.position === 'right')
                  .map((item) => (
                    <button
                      key={item.id}
                      title={item.tooltip ?? item.pluginName}
                      onClick={() => void runPluginStatusItem(item)}
                    >
                      {item.text}
                    </button>
                  ))}
              </div>
            )}
            {message && (
              <div
                className={`message ${message.startsWith('Could not') ? 'error' : ''}`}
                onClick={() => setMessage('')}
              >
                {message}
              </div>
            )}
          </section>
          {contextMenu && (
            <div
              className="context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onMouseLeave={() => setContextMenu(null)}
              onClick={(event) => event.stopPropagation()}
            >
              {contextMenu.target ? (
                <>
                  {pluginRuntime.contextMenuItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() =>
                        void runPluginContextMenuItem(item, contextMenu.target)
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                  {pluginRuntime.contextMenuItems.length > 0 && (
                    <div className="menu-divider" />
                  )}
                  {pluginRuntime.contextMenuItems.length === 0 && (
                    <div className="menu-divider" />
                  )}
                  <button onClick={() => startRename(contextMenu.target!)}>
                    Rename <kbd>F2</kbd>
                  </button>
                  <button
                    onClick={() => void duplicateEntry(contextMenu.target!)}
                  >
                    Duplicate
                  </button>
                  <button onClick={() => copyEntry(contextMenu.target!)}>
                    Copy <kbd>Ctrl+C</kbd>
                  </button>
                  <button
                    disabled={!fileClipboard}
                    onClick={() =>
                      void pasteEntry(
                        contextMenu.target!.kind === 'directory'
                          ? contextMenu.target!.path
                          : parentDirectory(contextMenu.target!.path),
                      )
                    }
                  >
                    Paste{' '}
                    {contextMenu.target.kind === 'directory'
                      ? 'into Folder'
                      : 'Beside'}{' '}
                    <kbd>Ctrl+V</kbd>
                  </button>
                  <div className="menu-divider" />
                  <button
                    className="danger-item"
                    onClick={() => void deleteEntries(currentSelection())}
                  >
                    Delete <kbd>Del</kbd>
                  </button>
                  <div className="menu-divider" />
                  <button
                    onClick={() =>
                      void openContainingFolder(contextMenu.target)
                    }
                  >
                    Open Containing Folder
                  </button>
                  <button
                    onClick={() => void copyPath(contextMenu.target!, false)}
                  >
                    Copy Path
                  </button>
                  <button
                    onClick={() => void copyPath(contextMenu.target!, true)}
                  >
                    Copy Relative Path
                  </button>
                </>
              ) : (
                <>
                  {pluginRuntime.contextMenuItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => void runPluginContextMenuItem(item)}
                    >
                      {item.label}
                    </button>
                  ))}
                  {pluginRuntime.contextMenuItems.length > 0 && (
                    <div className="menu-divider" />
                  )}
                  {pluginRuntime.contextMenuItems.length === 0 && (
                    <div className="menu-divider" />
                  )}
                  <button
                    disabled={!fileClipboard}
                    onClick={() => void pasteEntry('')}
                  >
                    Paste here <kbd>Ctrl+V</kbd>
                  </button>
                  <div className="menu-divider" />
                  <button onClick={() => void openContainingFolder()}>
                    Open Containing Folder
                  </button>
                  <div className="menu-divider" />
                  <button onClick={() => startCreating('file')}>
                    Create File
                  </button>
                  <button onClick={() => startCreating('folder')}>
                    Create Folder
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel
            settings={settings}
            themes={themes}
            customThemeIds={customThemeIds}
            onChange={updateSettings}
            onClose={() => setSettingsOpen(false)}
            onOpenThemeMaker={() => {
              setSettingsOpen(false);
              setThemeMakerOpen(true);
            }}
            onDeleteTheme={(id) => void deleteTheme(id)}
            pluginConfigurations={pluginRuntime.configurations}
            getPluginConfigValue={pluginRuntime.getConfiguration}
            onUpdatePluginConfig={pluginRuntime.updateConfiguration}
          />
        </Suspense>
      )}
      {commandPaletteOpen && (
        <div
          className="plugin-command-backdrop"
          onClick={() => setCommandPaletteOpen(false)}
        >
          <section
            className="plugin-command-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              autoFocus
              value={commandQuery}
              placeholder="Search commands and plugin actions…"
              onChange={(event) => setCommandQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCommandPaletteOpen(false);
                else if (event.key === 'Enter' && commandItems[0])
                  void runPaletteCommand(commandItems[0]);
              }}
            />
            <div>
              {commandItems.map((command) => (
                <button
                  key={command.id}
                  onClick={() => void runPaletteCommand(command)}
                >
                  <span>
                    {command.title}
                    <small>{command.description}</small>
                  </span>
                  <small>
                    {command.shortcut ? (
                      <kbd>{command.shortcut}</kbd>
                    ) : (
                      command.pluginName
                    )}
                  </small>
                </button>
              ))}
              {commandItems.length === 0 && <p>No matching commands.</p>}
            </div>
          </section>
        </div>
      )}
      </div>
    </main>
  );
}

export default App;
