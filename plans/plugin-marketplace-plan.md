# Arc Plugin Marketplace Plan

## Goal

Let users browse and install Arc plugins from a public GitHub repository. No Arc-owned server, no database, no API keys. A GitHub repo is the registry; plugin files are served by `raw.githubusercontent.com`.

The existing plugin install path already writes `plugin.json` and `main.js` into `$APPDATA/dev.arc.ide/plugins/<id>`. The marketplace reuses that path.

## Research: how Zed does it

Zed uses `github.com/zed-industries/extensions` as the source of truth:

- `extensions.toml` lists every extension, version, and submodule path.
- `.gitmodules` maps each extension to its own GitHub repo.
- CI compiles each extension to Wasm and uploads an archive plus manifest to storage.
- The app queries zed.dev, not GitHub directly, because compiled archives need hosting.

That model does not fit Arc:

- Arc plugins are plain ES modules (`plugin.json` + `main.js`), already executed as-is. No compile step, no Wasm, no archive hosting.
- A submodule per plugin adds git complexity for no benefit at this size.
- A server would be the only thing to operate.

So Arc can go one step simpler than Zed: put the plugin files directly in the registry repo and fetch them raw. GitHub is both the index and the file host.

## Chosen design (v1)

One public repo, for example `YOUR_ORG/arc-plugins`:

```text
arc-plugins/
  registry.json                 generated index, committed
  plugins/
    hello-world/
      plugin.json
      main.js
      icon.svg                  optional
      README.md                 optional, not installed by default
  scripts/
    build-registry.mjs          validate + generate registry.json
  .github/workflows/validate.yml
  CONTRIBUTING.md
  README.md
```

Client fetches:

```text
https://raw.githubusercontent.com/YOUR_ORG/arc-plugins/main/registry.json
https://raw.githubusercontent.com/YOUR_ORG/arc-plugins/main/plugins/<id>/<file>
```

Why bundled files instead of submodules or GitHub Releases:

- One PR adds a plugin. Review sees the exact JavaScript that users will run.
- No git submodules, no release assets, no build artifacts to keep in sync.
- A fork or mirror works by changing one URL constant.
- Plugin size is tiny. The whole registry can stay under a few MB.

Future escape hatch: registry entries can add a `source` field for externally hosted release assets if a plugin outgrows the repo. Do not build that now.

## Registry schema v1

`registry.json` is generated. Do not edit by hand.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-28T12:00:00Z",
  "plugins": [
    {
      "id": "hello-world",
      "name": "Hello World",
      "version": "1.0.0",
      "description": "Sample plugin.",
      "author": "Jane Doe",
      "repository": "https://github.com/jane/arc-hello-world",
      "path": "plugins/hello-world",
      "tags": ["sample"],
      "icon": "icon.svg",
      "files": [
        { "path": "plugin.json", "size": 123, "sha256": "..." },
        { "path": "main.js", "size": 456, "sha256": "..." },
        { "path": "icon.svg", "size": 789, "sha256": "..." }
      ]
    }
  ]
}
```

Rules:

- `id` must match the app manifest regex: `^[a-z0-9][a-z0-9._-]{1,63}$`.
- `plugin.json` must pass the same validation as the app (`name`, `version`, `description`, `main === "main.js"`).
- `path` must be `plugins/<id>`.
- Every file path is relative, uses `/`, and must not be absolute or contain `..`.
- `files` must include `plugin.json` and `main.js`.
- Optional `icon` must be listed in `files` and be SVG, PNG, or WebP.
- Unknown fields are ignored by the client for forward compatibility.
- Client caps: max 100 files, 2 MB per file, 5 MB total per plugin.

The plugin manifest does not change. Marketplace-only metadata (`author`, `tags`, `repository`, checksums) stays in `registry.json`.

## Client flow

New file `src/lib/marketplace.ts`:

```ts
export const PLUGIN_REGISTRY_URL =
  "https://raw.githubusercontent.com/YOUR_ORG/arc-plugins/main/registry.json";

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
```

Functions:

- `fetchRegistryIndex()`: `fetch(PLUGIN_REGISTRY_URL, { cache: "no-store" })`, parse JSON, validate shape, reject duplicate ids and invalid entries. Cache the last good index in `localStorage` under `arc.marketplace.index` with a timestamp. On network failure, return the cached index and mark it stale.
- `fetchPluginFiles(entry)`: loop `entry.files`, fetch `raw.../plugins/<id>/<path>`, enforce size cap, verify `crypto.subtle.digest("SHA-256", bytes)` against `sha256`, return `Map<string, Uint8Array>`. Abort on first mismatch.
- `compareVersions(a, b)`: tiny numeric/prerelease comparison. No new dependency.

Fetching from the webview is acceptable: `raw.githubusercontent.com` sends `Access-Control-Allow-Origin: *`, and the app has no CSP. If a target platform ever blocks this, add a small Rust command using the existing `ureq` dependency. Do not add it preemptively.

No polling. Fetch when the Marketplace tab opens and when the user clicks Refresh.

## Install and update flow

Refactor `src/lib/pluginRuntime.ts` so ZIP import and marketplace install share one path:

1. Extract `installPluginFromFiles(files, options)`:
   - Parse `plugin.json` with existing `parseManifest`.
   - Reject built-in ids unless explicitly installing a built-in.
   - Write to a staging directory under app data.
   - Back up and replace `$APPDATA/dev.arc.ide/plugins/<id>` using the existing rename/rollback pattern.
   - Update `setPlugins`.
   - `options.preserveEnabledState`: keep a disabled plugin disabled on update. Fresh installs enable the plugin.
2. Rewrite `importFromArchive` to:
   - Extract every file in the ZIP, not only `plugin.json` and `main.js`. This fixes the current limitation where `api.assets` files are dropped.
   - Reject absolute paths, `..`, and unsafe entries.
   - Require `plugin.json` and `main.js`.
   - Call `installPluginFromFiles`.
3. Add `installFromMarketplace(entry)`:
   - Fetch and verify files via `marketplace.ts`.
   - Confirm before writing (same trust warning as ZIP import).
   - Call `installPluginFromFiles(files, { preserveEnabledState: true })`.

Update detection:

- Installed version equals registry version: show `Installed`.
- Installed version is lower: show `Update`.
- Installed version is higher: show `Installed` and no downgrade.
- Plugin is built-in: hide it from Marketplace, or show `Built-in` disabled.

No silent auto-update. The user clicks Install or Update every time.

## UI changes

`src/components/PluginPanel.tsx`:

- Add tabs at the top of the installed view: `Installed` and `Marketplace`. Keep the existing search, list/grid switch, API docs, folder, and ZIP import controls.
- Marketplace list:
  - Name, description, author, version, tags.
  - `Install` / `Update` / `Installed` button.
  - Repository link (opener already allows `https://github.com/**`).
  - Optional icon loaded as a data URL from the verified bytes.
- Header actions: Refresh, last updated, stale/offline notice.
- Loading and error states. Per-plugin busy state so one install does not block the list.
- Confirm dialog:

  ```text
  Install "NAME" by AUTHOR?
  Plugin JavaScript runs inside Arc and can read files, run processes, and use the network.
  Only install plugins you trust.
  ```

- Update confirm states the old and new version.
- Uninstall stays on the Installed tab.

CSS additions in `PluginPanel.css` only. Reuse existing card, toggle, and action-button classes.

`src/App.tsx`:

- Pass two new props to `PluginPanel`: `onInstallMarketplace` and `onRefreshMarketplace` (or let the panel call `marketplace.ts` and only pass `onInstallMarketplaceFiles`). Keep wiring minimal.
- No settings changes in v1. The registry URL is a constant in `marketplace.ts`.

## Registry repo tooling

`scripts/build-registry.mjs`, zero npm dependencies:

- Walk `plugins/*/`.
- Validate each `plugin.json` with the same rules as the app.
- Reject duplicate ids, missing `main.js`, unsafe paths, and files over the caps.
- Compute SHA-256 and size for every file.
- Emit stable, sorted `registry.json`.
- `--check` compares generated output with the committed file and exits non-zero on drift.

`.github/workflows/validate.yml`:

```yaml
on: [pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: node scripts/build-registry.mjs --check
```

`CONTRIBUTING.md`:

- Add `plugins/<id>/plugin.json` and `main.js`.
- Run `node scripts/build-registry.mjs`.
- Commit the regenerated `registry.json`.
- CI must pass. A maintainer reviews the JavaScript because plugins are not sandboxed.
- Version bump instructions: change `version` in `plugin.json`, regenerate, PR.

No tags or releases are needed. The registry is always `main`.

## Security

This is the important part. Arc plugins run unsandboxed with the full plugin API: files, processes, terminals, network, secrets, and MCP. Installing from the marketplace is remote code execution as the user.

Mitigations:

- **Review is the gate.** Every plugin enters through a PR that a maintainer reviews. Say this in the registry README and CONTRIBUTING.
- **Explicit consent.** Never install silently. Confirm with name, author, repository, and the trust warning.
- **Integrity, not authenticity.** SHA-256 checks detect corrupted or mismatched downloads. They do not prove the registry itself is honest, because the index is also remote. TLS plus repo review is the v1 trust model.
- **Path safety.** Reuse the existing staging and rename flow. Reject absolute paths, `..`, and backslashes. Write only inside `plugins/<id>`.
- **Size caps.** Per file and per plugin, both client and registry validator.
- **Host allowlist.** Marketplace fetches only `raw.githubusercontent.com`. Repository links only open through the existing opener allowlist.
- **No background updates.** No telemetry, no polling, no silent writes.
- **Built-in ids stay reserved.** The app already rejects imports that collide with built-ins.

Later hardening, not v1:

- Sign `registry.json` with an Ed25519 key embedded in the app. Verify before parsing.
- Add `minAppVersion` per entry and block incompatible plugins.
- Add a user-configurable registry URL for forks and self-hosting.

## Files touched in this repo

| File | Change |
| --- | --- |
| `src/lib/marketplace.ts` | New. Registry types, fetch, validation, checksums, version compare, cache. |
| `src/lib/pluginRuntime.ts` | Extract `installPluginFromFiles`; ZIP import extracts all files; add `installFromMarketplace`. |
| `src/components/PluginPanel.tsx` | Installed/Marketplace tabs, cards, install/update, refresh, errors. |
| `src/components/PluginPanel.css` | Marketplace list styles. |
| `src/App.tsx` | Wire the new PluginPanel props. |
| `README.md` | One paragraph and link for the marketplace. |
| `PLUGIN_API.md` | Short "Publishing a plugin" section pointing at the registry repo. |
| `AGENTS.md` | Add `src/lib/marketplace.ts` to the frontend table. |

New repo (separate from this one): `arc-plugins` with the layout above.

## Phases

1. **Registry repo** (half day): layout, validator, CI, CONTRIBUTING, seed one example plugin. Verify raw URLs work in a browser and with `curl`.
2. **Install refactor** (half day): `installPluginFromFiles`, ZIP extracts all files, preserve enabled state on update.
3. **Marketplace client and UI** (one day): fetch, cache, checksums, tabs, cards, install/update, confirmations.
4. **Docs and polish** (half day): README, PLUGIN_API, AGENTS, stale/offline states, manual test pass.

## Testing

Registry repo:

- `node scripts/build-registry.mjs --check` on a clean tree.
- Add `node:test` cases for duplicate ids, missing `main.js`, `..` paths, oversized files, and checksum output. No npm dependencies.
- CI runs the same check.

Arc app:

- `npm run build` (typecheck gate).
- Manual with `npm run tauri dev`:
  - Marketplace loads, search and tags filter.
  - Install a plugin, confirm it appears under Installed and activates.
  - Disable it, install an update, confirm it stays disabled.
  - Tamper with a checksum in a local registry copy and confirm install aborts.
  - Offline: cached index appears with a stale notice.
  - Built-in ids are hidden.
  - ZIP import still works and now keeps asset files.
  - Uninstall removes the folder and the plugin.
- No frontend test runner exists, so no new test framework is added.

## Out of scope for v1

- Ratings, download counts, reviews.
- Search server, categories page, screenshots, rendered README pages.
- Auto-update, update channels, multiple versions per plugin.
- Plugin signing.
- Custom registry URL setting.
- Submodules, release assets, or a build service.

## Open questions

1. Which GitHub org/repo hosts the registry? The URL constant depends on it.
2. Seed the registry with the three built-ins, or only community plugins?
3. Is a user-configurable registry URL wanted in v1 for forks and private registries?
4. Is registry signing required before launch, or acceptable as a follow-up?
