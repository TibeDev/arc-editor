import { appDataDir, join } from '@tauri-apps/api/path';
import {
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

export const WORKSPACE_SNAPSHOT_VERSION = 1;

export type StoredLayoutNode =
  | { type: 'group'; group: number }
  | {
      type: 'split';
      id?: string;
      direction: 'vertical' | 'horizontal';
      ratio: number;
      first: StoredLayoutNode;
      second: StoredLayoutNode;
    };

export type RestoredLayoutNode =
  | { type: 'group'; groupId: string }
  | {
      type: 'split';
      id: string;
      direction: 'vertical' | 'horizontal';
      ratio: number;
      first: RestoredLayoutNode;
      second: RestoredLayoutNode;
    };

export type StoredGroup = { active: string; tabs: string[] };

export type StoredTerminal = {
  key: string;
  title: string;
  cwd: string;
  command?: string;
};

export type StoredSnapshot = {
  version: number;
  workspace: string;
  savedAt: string;
  layout: StoredLayoutNode;
  groups: StoredGroup[];
  activeGroup: number;
  viewer: { open: boolean; width: number };
  expandedDirs: string[];
  selectedPath: string;
  terminals: StoredTerminal[];
};

export function normalizeWorkspacePath(workspacePath: string): string {
  return workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

export async function workspaceHash(workspacePath: string): Promise<string> {
  const normalized = normalizeWorkspacePath(workspacePath);
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function workspaceStatePaths(workspacePath: string) {
  const hash = await workspaceHash(workspacePath);
  const dir = await join(await appDataDir(), 'workspaces');
  return {
    dir,
    file: await join(dir, `${hash}.json`),
    backup: await join(dir, `${hash}.json.bak`),
  };
}

export function serializeLayoutNode(
  node: unknown,
  groupIndexOf: (groupId: string) => number,
): StoredLayoutNode | null {
  if (!node || typeof node !== 'object') return null;
  const value = node as {
    type?: unknown;
    groupId?: unknown;
    direction?: unknown;
    ratio?: unknown;
    first?: unknown;
    second?: unknown;
  };
  if (value.type === 'group' && typeof value.groupId === 'string') {
    return { type: 'group', group: groupIndexOf(value.groupId) };
  }
  if (
    value.type === 'split' &&
    (value.direction === 'vertical' || value.direction === 'horizontal') &&
    typeof value.ratio === 'number' &&
    Number.isFinite(value.ratio)
  ) {
    const first = serializeLayoutNode(value.first, groupIndexOf);
    const second = serializeLayoutNode(value.second, groupIndexOf);
    if (!first || !second) return first ?? second;
    return {
      type: 'split',
      direction: value.direction,
      ratio: value.ratio,
      first,
      second,
    };
  }
  return null;
}

export function deserializeLayoutNode(
  node: unknown,
  groupAt: (index: number) => string | undefined,
  makeSplitId: () => string,
): RestoredLayoutNode | null {
  if (!node || typeof node !== 'object') return null;
  const value = node as {
    type?: unknown;
    group?: unknown;
    direction?: unknown;
    ratio?: unknown;
    first?: unknown;
    second?: unknown;
  };
  if (value.type === 'group') {
    if (typeof value.group !== 'number' || !Number.isInteger(value.group))
      return null;
    const groupId = groupAt(value.group);
    return groupId ? { type: 'group', groupId } : null;
  }
  if (
    value.type === 'split' &&
    (value.direction === 'vertical' || value.direction === 'horizontal') &&
    typeof value.ratio === 'number' &&
    Number.isFinite(value.ratio) &&
    value.ratio > 0.02 &&
    value.ratio < 0.98
  ) {
    const first = deserializeLayoutNode(value.first, groupAt, makeSplitId);
    const second = deserializeLayoutNode(value.second, groupAt, makeSplitId);
    if (!first || !second) return null;
    return {
      type: 'split',
      id: makeSplitId(),
      direction: value.direction,
      ratio: value.ratio,
      first,
      second,
    };
  }
  return null;
}

export async function saveWorkspaceState(
  workspacePath: string,
  snapshot: unknown,
): Promise<void> {
  const { dir, file, backup } = await workspaceStatePaths(workspacePath);
  await mkdir(dir, { recursive: true });
  try {
    await rename(file, backup);
  } catch {
    // no previous state on disk
  }
  await writeTextFile(file, JSON.stringify(snapshot));
}

export async function loadWorkspaceState(
  workspacePath: string,
): Promise<StoredSnapshot | null> {
  const { file, backup } = await workspaceStatePaths(workspacePath);
  for (const candidate of [file, backup]) {
    try {
      const parsed: unknown = JSON.parse(await readTextFile(candidate));
      const snapshot = validateStoredSnapshot(parsed);
      if (snapshot) return snapshot;
    } catch {
      // fall through to the backup candidate
    }
  }
  return null;
}

function isPlainStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function validateStoredLayout(value: unknown): StoredLayoutNode | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as {
    type?: unknown;
    group?: unknown;
    direction?: unknown;
    ratio?: unknown;
    first?: unknown;
    second?: unknown;
  };
  if (node.type === 'group') {
    if (typeof node.group !== 'number' || !Number.isInteger(node.group))
      return null;
    if (node.group < 0) return null;
    return { type: 'group', group: node.group };
  }
  if (
    node.type === 'split' &&
    (node.direction === 'vertical' || node.direction === 'horizontal') &&
    typeof node.ratio === 'number' &&
    Number.isFinite(node.ratio) &&
    node.ratio > 0.02 &&
    node.ratio < 0.98
  ) {
    const first = validateStoredLayout(node.first);
    const second = validateStoredLayout(node.second);
    if (!first || !second) return null;
    return {
      type: 'split',
      direction: node.direction,
      ratio: node.ratio,
      first,
      second,
    };
  }
  return null;
}

export function validateStoredSnapshot(value: unknown): StoredSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<StoredSnapshot> & { terminals?: unknown };
  if (raw.version !== WORKSPACE_SNAPSHOT_VERSION) return null;
  if (typeof raw.workspace !== 'string' || !raw.workspace) return null;
  if (typeof raw.savedAt !== 'string') return null;
  if (!Array.isArray(raw.groups) || !raw.groups.every(isStoredGroup)) return null;
  const layout = validateStoredLayout(raw.layout);
  if (!layout) return null;
  const groups = raw.groups;
  const activeGroup =
    typeof raw.activeGroup === 'number' && Number.isInteger(raw.activeGroup)
      ? Math.min(groups.length - 1, Math.max(0, raw.activeGroup))
      : 0;
  const viewer =
    raw.viewer && typeof raw.viewer === 'object'
      ? (() => {
          const rawViewer = raw.viewer as { open?: unknown; width?: unknown };
          return {
            open: typeof rawViewer.open === 'boolean' ? rawViewer.open : true,
            width:
              typeof rawViewer.width === 'number' && Number.isFinite(rawViewer.width)
                ? rawViewer.width
                : 244,
          };
        })()
      : { open: true, width: 244 };
  const expandedDirs = isPlainStringArray(raw.expandedDirs)
    ? raw.expandedDirs
    : [];
  const selectedPath =
    typeof raw.selectedPath === 'string' ? raw.selectedPath : '';
  const storedTerminals: StoredTerminal[] = [];
  if (Array.isArray(raw.terminals)) {
    for (const entry of raw.terminals) {
      if (!entry || typeof entry !== 'object') continue;
      const terminal = entry as Partial<StoredTerminal>;
      if (typeof terminal.key !== 'string' || !terminal.key) continue;
      if (typeof terminal.cwd !== 'string' || !terminal.cwd) continue;
      storedTerminals.push({
        key: terminal.key,
        title: typeof terminal.title === 'string' ? terminal.title : 'Terminal',
        cwd: terminal.cwd,
        command:
          typeof terminal.command === 'string' ? terminal.command : undefined,
      });
    }
  }
  return {
    version: WORKSPACE_SNAPSHOT_VERSION,
    workspace: raw.workspace,
    savedAt: raw.savedAt,
    layout,
    groups,
    activeGroup,
    viewer,
    expandedDirs,
    selectedPath,
    terminals: storedTerminals,
  };
}

function isStoredGroup(value: unknown): value is StoredGroup {
  if (!value || typeof value !== 'object') return false;
  const group = value as Partial<StoredGroup>;
  return (
    typeof group.active === 'string' &&
    isPlainStringArray(group.tabs)
  );
}

export async function gcWorkspaces(): Promise<void> {
  const dir = await join(await appDataDir(), 'workspaces');
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return;
  }
  const removeBackupFor = async (name: string) => {
    if (!name.endsWith('.json')) return;
    try {
      await remove(await join(dir, `${name}.bak`));
    } catch {
      // no backup file
    }
  };
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue;
    const filePath = await join(dir, entry.name);
    try {
      const parsed: unknown = JSON.parse(await readTextFile(filePath));
      const workspacePath =
        parsed && typeof parsed === 'object'
          ? (parsed as { workspace?: unknown }).workspace
          : undefined;
      if (typeof workspacePath !== 'string' || !workspacePath) {
        await remove(filePath);
        await removeBackupFor(entry.name);
        continue;
      }
      try {
        await stat(workspacePath);
      } catch {
        await remove(filePath);
        await removeBackupFor(entry.name);
      }
    } catch {
      // unparseable bucket: leave it to the load-time fallback
    }
  }
}
