const REGISTRY_REPO = "https://raw.githubusercontent.com/TibeDev/arc-plugins/main";

export const PLUGIN_REGISTRY_URL = `${REGISTRY_REPO}/registry.json`;
const PLUGIN_RAW_BASE = REGISTRY_REPO;
const CACHE_KEY = "arc.marketplace.index";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const ICON_PATTERN = /\.(svg|png|webp)$/i;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

export type MarketplaceFile = { path: string; size: number; sha256: string };

export type MarketplaceEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  repository?: string;
  path: string;
  tags?: string[];
  icon?: string;
  files: MarketplaceFile[];
};

export type MarketplaceIndex = {
  schemaVersion: number;
  generatedAt?: string;
  plugins: MarketplaceEntry[];
};

export type MarketplaceResult = {
  index: MarketplaceIndex;
  stale: boolean;
  savedAt?: number;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function assertSafePath(path: string, label: string) {
  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.includes("\\") ||
    /^[a-z]:/i.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a safe relative path.`);
  }
}

function validateFile(value: unknown, label: string): MarketplaceFile {
  const file = asRecord(value, label);
  const path = requiredString(file.path, `${label}.path`);
  assertSafePath(path, `${label}.path`);
  if (typeof file.size !== "number" || !Number.isInteger(file.size) || file.size < 0) {
    throw new Error(`${label}.size must be a non-negative integer.`);
  }
  if (file.size > MAX_FILE_BYTES) throw new Error(`${label} exceeds the 2 MB file limit.`);
  const sha256 = requiredString(file.sha256, `${label}.sha256`);
  if (!SHA256_PATTERN.test(sha256)) throw new Error(`${label}.sha256 must be a SHA-256 hex digest.`);
  return { path, size: file.size, sha256: sha256.toLowerCase() };
}

function validateEntry(value: unknown, label: string): MarketplaceEntry {
  const entry = asRecord(value, label);
  const id = requiredString(entry.id, `${label}.id`);
  if (!ID_PATTERN.test(id)) throw new Error(`${label}.id is not a valid plugin ID.`);
  const name = requiredString(entry.name, `${label}.name`);
  const version = requiredString(entry.version, `${label}.version`);
  const description = requiredString(entry.description, `${label}.description`);
  const path = requiredString(entry.path, `${label}.path`);
  if (path !== `plugins/${id}`) throw new Error(`${label}.path must be "plugins/${id}".`);

  const rawFiles = entry.files;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) throw new Error(`${label}.files must list the plugin files.`);
  if (rawFiles.length > MAX_FILES) throw new Error(`${label} exceeds the ${MAX_FILES} file limit.`);
  const files = rawFiles.map((file, index) => validateFile(file, `${label}.files[${index}]`));
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`${label}.files contains duplicate path "${file.path}".`);
    paths.add(file.path);
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error(`${label} exceeds the 5 MB plugin size limit.`);
  if (!paths.has("plugin.json")) throw new Error(`${label} is missing plugin.json.`);
  if (!paths.has("main.js")) throw new Error(`${label} is missing main.js.`);

  const icon = optionalString(entry.icon, `${label}.icon`);
  if (icon !== undefined) {
    assertSafePath(icon, `${label}.icon`);
    if (!ICON_PATTERN.test(icon)) throw new Error(`${label}.icon must be SVG, PNG, or WebP.`);
    if (!paths.has(icon)) throw new Error(`${label}.icon must be listed in files.`);
  }

  const repository = optionalString(entry.repository, `${label}.repository`);
  const author = optionalString(entry.author, `${label}.author`);
  const tags = entry.tags === undefined
    ? undefined
    : Array.isArray(entry.tags)
      ? entry.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : (() => { throw new Error(`${label}.tags must be an array of strings.`); })();

  return {
    id,
    name,
    version,
    description,
    path,
    files,
    ...(author === undefined ? {} : { author }),
    ...(repository === undefined ? {} : { repository }),
    ...(icon === undefined ? {} : { icon }),
    ...(tags === undefined ? {} : { tags }),
  };
}

function parseIndex(value: unknown): MarketplaceIndex {
  const root = asRecord(value, "Registry");
  if (root.schemaVersion !== 1) throw new Error("Unsupported marketplace schema version.");
  if (!Array.isArray(root.plugins)) throw new Error("Registry plugins must be an array.");
  const plugins = root.plugins.map((plugin, index) => validateEntry(plugin, `plugins[${index}]`));
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (seen.has(plugin.id)) throw new Error(`Registry contains duplicate plugin ID "${plugin.id}".`);
    seen.add(plugin.id);
  }
  const generatedAt = typeof root.generatedAt === "string" ? root.generatedAt : undefined;
  return { schemaVersion: 1, ...(generatedAt === undefined ? {} : { generatedAt }), plugins };
}

function readCache(): { index: MarketplaceIndex; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { savedAt?: unknown; index?: unknown };
    if (typeof cached.savedAt !== "number") return null;
    return { index: parseIndex(cached.index), savedAt: cached.savedAt };
  } catch {
    return null;
  }
}

export async function fetchRegistryIndex(): Promise<MarketplaceResult> {
  try {
    const response = await fetch(PLUGIN_REGISTRY_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Marketplace request failed with status ${response.status}.`);
    const index = parseIndex(await response.json());
    const savedAt = Date.now();
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt, index }));
    return { index, stale: false, savedAt };
  } catch (error) {
    const cached = readCache();
    if (cached) return { index: cached.index, stale: true, savedAt: cached.savedAt };
    throw error;
  }
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchVerifiedFile(entry: MarketplaceEntry, file: MarketplaceFile): Promise<Uint8Array> {
  const url = `${PLUGIN_RAW_BASE}/${entry.path.split("/").map(encodeURIComponent).join("/")}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not download ${entry.id}/${file.path} (status ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`${entry.id}/${file.path} exceeds the 2 MB file limit.`);
  if (bytes.byteLength !== file.size) throw new Error(`Size mismatch for ${entry.id}/${file.path}.`);
  const digest = toHex(await crypto.subtle.digest("SHA-256", bytes));
  if (digest !== file.sha256.toLowerCase()) throw new Error(`Checksum mismatch for ${entry.id}/${file.path}.`);
  return bytes;
}

export async function fetchPluginFiles(entry: MarketplaceEntry): Promise<Map<string, Uint8Array>> {
  const safe = validateEntry(entry, entry.id);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const file of safe.files) {
    const bytes = await fetchVerifiedFile(safe, file);
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new Error(`${safe.id} exceeds the 5 MB plugin size limit.`);
    files.set(file.path, bytes);
  }
  return files;
}

const iconCache = new Map<string, string>();

function toDataUrl(bytes: Uint8Array, path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  const type = extension === "svg" ? "image/svg+xml" : extension === "png" ? "image/png" : "image/webp";
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

export async function fetchPluginIcon(entry: MarketplaceEntry): Promise<string | null> {
  if (!entry.icon) return null;
  const safe = validateEntry(entry, entry.id);
  const file = safe.files.find((candidate) => candidate.path === safe.icon);
  if (!file) return null;
  const key = `${safe.id}:${file.sha256}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const dataUrl = toDataUrl(await fetchVerifiedFile(safe, file), file.path);
  iconCache.set(key, dataUrl);
  return dataUrl;
}

function parseVersion(value: string): { numbers: number[]; prerelease: string } {
  const trimmed = value.trim().replace(/^[v=]+/, "");
  const separator = trimmed.indexOf("-");
  const core = separator < 0 ? trimmed : trimmed.slice(0, separator);
  const prerelease = separator < 0 ? "" : trimmed.slice(separator + 1);
  const numbers = core.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return { numbers, prerelease };
}

function comparePrerelease(a: string, b: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const left = a.split(".");
  const right = b.split(".");
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index];
    const y = right[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumber = /^\d+$/.test(x) ? Number(x) : null;
    const yNumber = /^\d+$/.test(y) ? Number(y) : null;
    if (xNumber !== null && yNumber !== null) {
      if (xNumber !== yNumber) return xNumber < yNumber ? -1 : 1;
    } else if (xNumber !== null) {
      return -1;
    } else if (yNumber !== null) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < Math.max(left.numbers.length, right.numbers.length); index += 1) {
    const x = left.numbers[index] ?? 0;
    const y = right.numbers[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}
