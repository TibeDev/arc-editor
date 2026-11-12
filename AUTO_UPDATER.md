# Auto-updater and release channels

Research notes for adding self-updates to Arc. **Status: implemented.**

## Verdict

Yes. Tauri 2 has a first-party updater (`tauri-plugin-updater`) that checks a signed update manifest, downloads the platform bundle, verifies its signature, installs it, and restarts the app.

Two parts:

1. **Auto-update** — signed artifacts published on GitHub Releases plus a `latest.json` manifest.
2. **Channels** — stable and beta endpoints selected at runtime, because Tauri's JavaScript `check()` cannot override endpoints; the Rust `UpdaterBuilder` can.

GitHub Releases fits this repo: it already publishes Linux, Windows, and macOS bundles from tags. The missing pieces are updater artifacts, signing keys, and a generated manifest.

## Current state

| Area | Current behavior |
| --- | --- |
| Release trigger | `.github/workflows/release.yml`, tags `v*.*.*` |
| Version gate | Tag must be on `main` and match `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` |
| Build | Matrix: Linux (deb/rpm/AppImage), Windows (msi/nsis), macOS (universal dmg) |
| Publish | `softprops/action-gh-release` uploads bundle files and generates notes |
| Updater | Not installed. No `tauri-plugin-updater`, no `createUpdaterArtifacts`, no `latest.json`, no signing |
| Linux install | `install-appimage.sh` copies to `~/Applications/Arc.AppImage` and creates a desktop entry |
| Settings | `src/lib/settings.ts`, versioned with `APP_SETTINGS_VERSION` |
| App shell | `src/App.tsx` monolith; UI settings in `src/components/SettingsPanel.tsx` |

`softprops/action-gh-release` does **not** generate updater artifacts, `.sig` files, or `latest.json`. That must change.

## Recommended design

- **Stable channel**: normal tags `vX.Y.Z`, released as non-prerelease. Endpoint:
  `https://github.com/TibeDev/arc-editor/releases/latest/download/latest.json`
- **Beta channel**: tags `vX.Y.Z-beta.N`, released as prerelease. GitHub's `releases/latest` ignores prereleases, so stable is unaffected. Beta endpoint uses a moving pointer release tagged `beta`:
  `https://github.com/TibeDev/arc-editor/releases/download/beta/latest.json`
- **Runtime selection**: custom Rust commands build the endpoint from the selected channel. The JS plugin API cannot set endpoints.
- **Startup behavior**: check after a short delay, then every few hours. Prompt the user by default; optional auto-install is a setting.
- **Signing**: mandatory. Public key is compiled into the app. Private key lives only in GitHub Actions secrets and an offline backup.

## Required changes

### 1. Dependencies

`src-tauri/Cargo.toml`:

```toml
[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]
tauri-plugin-updater = "2"
```

Current published versions: `tauri-plugin-updater` 2.14.1, `tauri-plugin-process` 2.4.0. The updater requires Rust 1.90+; CI already uses `dtolnay/rust-toolchain@stable`.

No JavaScript updater package is required if all updater calls go through custom Rust commands. `@tauri-apps/api/core` already provides `invoke` and `Channel`. If the frontend calls the plugin directly instead, add `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process`.

### 2. Tauri configuration

`src-tauri/tauri.conf.json`:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<contents of the generated public key>",
      "endpoints": [
        "https://github.com/TibeDev/arc-editor/releases/latest/download/latest.json"
      ]
    }
  }
}
```

The configured endpoint is a fallback. The channel commands override it at runtime. `pubkey` must be the key text, not a file path.

### 3. Signing keys

Generate once:

```sh
npm run tauri signer generate -- -w ~/.tauri/arc.key
```

This creates a private key and a public key. Then:

- Put the public key text in `plugins.updater.pubkey`.
- Add the private key and its password as GitHub secrets:
  `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Back up the private key offline. Losing it permanently prevents updates for already-installed users. Leaking it allows signing malicious updates.
- Key rotation requires shipping a build with the new public key before signing with the new private key.

The build must see the private key in the environment. `.env` files do not work.

### 4. Rust plugin initialization

`src-tauri/src/lib.rs`, inside `run()`:

```rust
.setup(|app| {
    #[cfg(desktop)]
    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
    Ok(())
})
```

Current `run()` starts at `src-tauri/src/lib.rs:3093`. Add the updater state and commands to the existing `manage` / `generate_handler!` chain.

### 5. Channel-aware updater commands

The updater needs to keep the checked `Update` value until the user installs it. The implementation in `src-tauri/src/lib.rs` is authoritative; it also gates Linux to AppImage and accepts an `allow_downgrade` flag.

```rust
use std::sync::Mutex;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

struct PendingUpdate(Mutex<Option<Update>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    date: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
enum DownloadEvent {
    Started { content_length: Option<u64> },
    Progress { chunk_length: usize },
    Finished,
}

fn channel_endpoint(channel: &str) -> Result<&'static str, String> {
    match channel {
        "stable" => Ok(
            "https://github.com/TibeDev/arc-editor/releases/latest/download/latest.json",
        ),
        "beta" => Ok(
            "https://github.com/TibeDev/arc-editor/releases/download/beta/latest.json",
        ),
        _ => Err(format!("unknown update channel: {channel}")),
    }
}

#[tauri::command]
async fn updater_check(
    app: AppHandle,
    channel: String,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let endpoint = channel_endpoint(&channel)?
        .parse()
        .map_err(|error| format!("invalid update endpoint: {error}"))?;

    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .version_comparator(|current, update| update.version != current)
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    let info = update.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        date: update.date.map(|date| date.to_string()),
    });

    *pending.0.lock().map_err(|error| error.to_string())? = update;
    Ok(info)
}

#[tauri::command]
async fn updater_install(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or_else(|| "no pending update".to_string())?;

    let mut started = false;
    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                    started = true;
                }
                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|error| error.to_string())?;

    app.restart();
}
```

Notes:

- `version_comparator(|current, update| update.version != current)` allows channel switches and manual downgrades. The default comparator only installs strictly newer semver, so beta `0.3.0-beta.1` cannot switch back to stable `0.2.0`.
- Do not enable downgrades for automatic checks without a user action. A signed older version may contain known vulnerabilities.
- On Windows, `download_and_install` exits the app automatically before running the installer.
- `app.restart()` avoids needing `tauri-plugin-process` and its permission.
- Register `updater_check`, `updater_install`, and `.manage(PendingUpdate(Mutex::new(None)))` in `run()`.

### 6. Permissions

Custom app commands are not gated by capabilities. If the frontend calls the updater plugin directly instead, add `"updater:default"` to `src-tauri/capabilities/default.json`.

### 7. Settings

Add to `src/lib/settings.ts`:

```ts
export type UpdateChannel = "stable" | "beta" | "off";

export interface AppSettings {
  updateChannel: UpdateChannel;
  autoCheckUpdates: boolean;
  autoInstallUpdates: boolean;
}
```

Add defaults, bump `APP_SETTINGS_VERSION` (currently `1`), and keep the existing merge in `loadSettings()`; it already fills missing keys from `DEFAULT_SETTINGS`, so an explicit migration is only needed if semantics change.

Recommended defaults: `updateChannel: "stable"`, `autoCheckUpdates: true`, `autoInstallUpdates: false`.

### 8. Frontend behavior

- On startup, after settings load, wait a few seconds and call `updater_check` with the selected channel. Skip in `import.meta.env.DEV`.
- Repeat every 6 hours while the app runs.
- If an update exists:
  - `autoInstallUpdates` false: show a banner or settings entry with version, notes, **Install** and **Later**.
  - `autoInstallUpdates` true: call `updater_install`, show progress, restart.
- Settings panel: channel select (Stable / Beta / Off), auto-check toggle, auto-install toggle, current version, **Check now** button.
- Use a `Channel<DownloadEvent>` for progress:

```ts
import { Channel, invoke } from "@tauri-apps/api/core";

const onEvent = new Channel<DownloadEvent>();
onEvent.onmessage = (event) => {
  if (event.event === "progress") {
    setDownloaded((bytes) => bytes + event.data.chunkLength);
  }
};

await invoke("updater_install", { onEvent });
```

## CI changes

### Option A (recommended): use `tauri-action`

`tauri-apps/tauri-action` builds, uploads bundles and `.sig` files, and generates/merges `latest.json` for the release. It merges platform entries when the workflow uses a matrix.

Change the workflow permissions to `contents: write` for the build job, and replace the build and upload steps with:

```yaml
- uses: tauri-apps/tauri-action@v1
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  with:
    tagName: ${{ github.ref_name }}
    releaseName: "Arc ${{ github.ref_name }}"
    generateReleaseNotes: true
    prerelease: ${{ contains(github.ref_name, '-') }}
    updaterJsonPreferNsis: true
    args: ${{ matrix.args }}
```

Suggested matrix `args`:

| Platform | Args |
| --- | --- |
| Linux | `--ci --bundles deb rpm appimage` |
| Windows | `--ci --bundles msi nsis` |
| macOS | `--ci --target universal-apple-darwin --bundles dmg` |

Keep the existing tag-on-main and version-match gate before the build step. Remove the old `actions/upload-artifact` steps and the `softprops/action-gh-release` release job when using Option A; `tauri-action` now uploads the assets and creates the release.

`updaterJsonPreferNsis: true` makes Windows prefer the NSIS `setup.exe` over MSI. NSIS is the more reliable updater path.

Potential issue: parallel matrix jobs read, merge, and rewrite `latest.json`. The action merges existing platform entries, but a race can drop entries. If that happens, set `strategy.max-parallel: 1` or move release upload to a single job after the matrix.

### Beta channel pointer

After a prerelease build, copy that release's `latest.json` to the moving `beta` release. One-time setup creates the `beta` release as a prerelease, so GitHub's `latest` still resolves to stable.

```yaml
channel-pointer:
  needs: build
  if: contains(github.ref_name, '-')
  runs-on: ubuntu-24.04
  permissions:
    contents: write
  steps:
    - env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: |
        gh release view beta --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1 || \
          gh release create beta --repo "$GITHUB_REPOSITORY" --prerelease \
            --title "Beta channel" --notes "Points to the latest beta build."
        gh release download "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" \
          --pattern latest.json --output /tmp/latest.json --clobber
        gh release upload beta /tmp/latest.json --repo "$GITHUB_REPOSITORY" --clobber
```

Stable releases need no pointer: `releases/latest` automatically selects the newest non-prerelease.

### Option B: keep `softprops/action-gh-release`

Keep the existing build matrix, then add a release-job script that:

1. Downloads all `.sig` files and bundles.
2. Maps each artifact to `linux-x86_64`, `windows-x86_64`, `darwin-x86_64`, `darwin-aarch64`, etc.
3. Builds `latest.json` with `version`, `pub_date`, and per-platform `signature` + asset URL.
4. Uploads `latest.json` plus all `.sig` files.

This duplicates logic `tauri-action` already provides. Use Option A unless keeping the current workflow shape is more important.

## Platform caveats

### Linux

- AppImage updates are automatic. The updater downloads the new signed AppImage and rewrites the file at `$APPIMAGE` in place, then the app restarts. No manual download or replacement.
- The AppImage file must be writable by the user. Arc's documented install path (`install-appimage.sh` → `~/Applications/Arc.AppImage`) is writable and works.
- The AppImage runtime must set `APPIMAGE`. Launching the extracted binary directly will fail the update.
- `install-appimage.sh` overwrites `~/Applications/Arc.AppImage`; the updater replaces the running AppImage file, which is compatible with that layout.
- deb/rpm updates are supported by the updater crate, but Tauri's `createUpdaterArtifacts` only emits an AppImage signature on Linux. This workflow does not publish deb/rpm update entries, so `updater_check` rejects non-AppImage Linux installs with a clear error. Use the AppImage for auto-updates.

### Windows

- NSIS is recommended; set `updaterJsonPreferNsis: true` if both MSI and NSIS are built.
- The app exits automatically during install. Do not block the exit or expect to resume the same session.
- `installMode` defaults to `"passive"`; `"basicUi"` and `"quiet"` are available in `plugins.updater.windows.installMode`.
- Code signing is recommended to avoid SmartScreen warnings, but is not required by the updater.

### macOS

- The updater artifact is `.app.tar.gz`; the updater replaces the app bundle.
- The app must be code-signed and notarized for Gatekeeper to accept updates. The current CI builds an unsigned universal dmg, so macOS auto-update is blocked until Apple signing credentials exist.
- A universal build maps to both `darwin-x86_64` and `darwin-aarch64` in `latest.json`.

## Manifest format

Static manifest (`latest.json`):

```json
{
  "version": "0.1.3",
  "notes": "Release notes",
  "pub_date": "2026-11-12T00:00:00Z",
  "platforms": {
    "linux-x86_64": {
      "signature": "<contents of .sig>",
      "url": "https://github.com/.../Arc_0.1.3_amd64.AppImage"
    },
    "windows-x86_64": {
      "signature": "<contents of .sig>",
      "url": "https://github.com/.../Arc_0.1.3_x64-setup.exe"
    },
    "darwin-x86_64": {
      "signature": "<contents of .sig>",
      "url": "https://github.com/.../Arc_0.1.3_universal.app.tar.gz"
    },
    "darwin-aarch64": {
      "signature": "<contents of .sig>",
      "url": "https://github.com/.../Arc_0.1.3_universal.app.tar.gz"
    }
  }
}
```

Tauri validates the entire manifest before comparing versions. Every listed platform entry must be complete.

## Version and channel behavior

- Stable `0.1.2` → beta `0.2.0-beta.1`: default semver comparison allows it.
- Beta `0.3.0-beta.1` → stable `0.2.0`: default comparison rejects it; requires `version_comparator`.
- Stable `0.1.2` → pinned `0.1.0`: requires `version_comparator`; treat as explicit user action.
- Same version is not reinstalled unless the comparator allows `update.version == current` (not recommended).
- A release tag without updater artifacts has no usable `latest.json`; first updater-enabled release becomes the floor.

## Testing plan

1. `cargo test` in `src-tauri/`: unit-test `update_endpoint` and invalid channel input. Existing Rust tests live at the bottom of `src-tauri/src/lib.rs`.
2. `npm run build`: TypeScript gate for settings and UI changes.
3. Local signing build:
   ```sh
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/arc.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="<password>"
   npm run tauri build -- --bundles appimage
   ```
4. Manual end-to-end:
   - Install version N via `install-appimage.sh`.
   - Bump versions to N+1 in all three files, tag, push.
   - Wait for CI, launch installed AppImage.
   - Verify check, signature verification, download progress, install, restart.
5. Beta test: publish `vN-beta.1`, confirm stable endpoint still reports N, beta endpoint reports the beta, and switching channels behaves as expected.
6. macOS and Windows: verify on each platform before announcing support; unsigned macOS builds will fail.

Do not use `dangerousInsecureTransportProtocol` in production. If local HTTP testing is needed, use a separate dev-only config.

## Risks and open decisions

| Risk / decision | Notes |
| --- | --- |
| Private key loss | Installed users can never update again. Back up offline before first release. |
| Private key leak | Attacker can sign malicious updates. Rotate by shipping a new public key first. |
| macOS unsigned | Updater cannot reliably install. Needs Apple Developer ID + notarization. |
| Linux deb/rpm | The updater crate can install them, but this build only signs AppImage artifacts. Non-AppImage installs are rejected. |
| Silent auto-install | Loses unsaved editor state on restart. Default to prompt; make auto-install opt-in. |
| Downgrades | Useful for rollback and channel switching, but a security risk if automatic. Gate behind explicit action. |
| Manifest tampering | Artifact signature still verifies. TLS protects the manifest; repo write access is the trust boundary. |
| Parallel `latest.json` writes | Matrix jobs can race. Use `max-parallel: 1` or a single publish job if entries go missing. |
| Release channel names | Start with stable + beta. Add nightly only if there is a real build cadence; each channel needs its own pointer release. |
| Specific version pinning | Optional. Use `releases/download/vX.Y.Z/latest.json` plus `version_comparator`. Only works for releases that contain updater artifacts. |

## File map for implementation

| File | Change |
| --- | --- |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-updater` |
| `src-tauri/src/lib.rs` | Plugin init, `PendingUpdate` state, `updater_check` / `updater_install`, tests |
| `src-tauri/tauri.conf.json` | `createUpdaterArtifacts`, `plugins.updater.pubkey` and fallback endpoint |
| `src-tauri/capabilities/default.json` | Only if the frontend uses the updater plugin directly |
| `src/lib/settings.ts` | `UpdateChannel`, update settings, defaults, version bump |
| `src/lib/updater.ts` | Update info and download-event types shared by App and Settings |
| `src/vite-env.d.ts` | Vite `ImportMeta.env` types for development checks |
| `src/components/SettingsPanel.tsx` | Channel and auto-update controls, check-now action |
| `src/App.tsx` | Startup check, interval, update banner, install progress |
| `.github/workflows/release.yml` | Signing env, updater artifacts, `latest.json`, beta pointer |
| `README.md` | Note that AppImage is the auto-update path |

## References

- Tauri updater guide: <https://v2.tauri.app/plugin/updater/>
- Tauri updater JavaScript API: <https://v2.tauri.app/reference/javascript/updater/>
- Tauri GitHub pipeline: <https://v2.tauri.app/distribute/pipelines/github/>
- `tauri-action`: <https://github.com/tauri-apps/tauri-action>
