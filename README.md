# Arc

Arc is a desktop workspace for web development. It puts your project files, code editor, terminal, browser preview, GitHub tools, and plugin/theme builder in one window.

## What you can do

- Open a project folder and browse, search, create, rename, move, copy, or delete its files.
- Edit JavaScript, TypeScript, JSX, TSX, HTML, CSS, SCSS, PHP, JSON, and Markdown with syntax highlighting. Preview images with zoom and pan.
- Work across multiple tabs and nested editor splits. Drag tabs between panes or drag a tab to a pane edge to create a split.
- Open terminal tabs in your project folder.
- Preview a dev server or workspace files in a web preview tab. Sites that refuse framing open in your browser.
- Use the GitHub panel to create or connect a repository, change branches, stage and commit files, and pull or push changes.
- Adjust editor, terminal, and interface settings. Choose a built-in theme, create a custom theme, or use transparency and an app background image.
- Import JavaScript plugins from ZIP archives or browse the community marketplace at [github.com/TibeDev/arc-plugins](https://github.com/TibeDev/arc-plugins). Arc includes a Linux-only XAMPP plugin.
- Build a plugin or theme with the Build tab wizard, which can launch a local AI agent or produce a prompt for any chat AI.
- Chat with OpenCode in the Agents workspace, with project trust, saved transcripts, approvals, and questions.
- Update from signed GitHub releases, on the Stable or Beta channel.

## Install on Omarchy

From the project folder, pass the downloaded or locally built AppImage to the installer:

```sh
./install-appimage.sh /path/to/Arc.AppImage
```

The script works with only the AppImage and this script. It copies Arc to `~/Applications/Arc.AppImage`, creates a launcher entry under `$XDG_DATA_HOME` (or `~/.local/share`), and needs no `sudo`. Search for Arc in the app launcher.

Installed AppImages update automatically. Arc checks for signed releases, replaces `~/Applications/Arc.AppImage` in place, and restarts. Choose Stable or Beta under **Settings → Updates**.

## Working in a project

Open a folder with `Ctrl+K`, then `Ctrl+O`. Use the file browser to open or manage files. Save with `Ctrl+S`; supported files can be formatted with Prettier on save or with `Alt+Shift+F`.

Open a terminal with `Ctrl+T`. Open a web preview with `Ctrl+Alt+P`, then enter a dev server URL such as `http://localhost:5173` or serve workspace files. Sites that refuse framing must open in your browser.

The GitHub panel needs Git and GitHub CLI (`gh`). Open the panel, sign in, then stage and commit changes or sync with a remote.

## Shortcuts

| Shortcut                    | Action                                  |
| --------------------------- | --------------------------------------- |
| `Ctrl+K`, then `Ctrl+O`     | Open a project folder                   |
| `Ctrl+N` / `Ctrl+Shift+N`   | Create a file / folder                  |
| `Ctrl+T`                    | Open a terminal                         |
| `Ctrl+Alt+P`                | Open a web preview                      |
| `Ctrl+Shift+P`              | Open the command palette                |
| `Ctrl+Shift+A`              | Toggle the Agents workspace             |
| `Ctrl+\\` / `Ctrl+Shift+\\` | Split editor vertically / horizontally  |
| `Ctrl+B`                    | Show or hide the file browser           |
| `Ctrl+Tab`                  | Switch to the next tab or pane          |
| `Ctrl+S` / `Ctrl+W`         | Save / save and close the active editor |
| `Ctrl+,`                    | Open Settings                           |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom app, or editor font size in code |
| `F2` / `Delete`             | Rename / delete the selected item       |
| `Alt+Shift+F`               | Format the active file                  |

On macOS, replace `Ctrl` with `Command`. `Alt+Shift+F` uses `Option+Shift+F`.

## Agents

Press `Ctrl+Shift+A` to open Agents. Add a project, grant trust, choose a provider, then start a chat. Arc supports OpenCode, Codex, Claude, Cursor, Grok, Antigravity, Muse Code, and Pi behind one workspace. OpenCode runs a loopback `opencode serve` process and pins 1.19.5 or newer 1.x. Codex runs `codex app-server` over stdio and needs a logged-in Codex CLI. The remaining providers run over the Agent Client Protocol and need the provider's own logged-in CLI (the `npx` fallbacks also need Node): Claude uses `claude-agent-acp` (fallback `npx @agentclientprotocol/claude-agent-acp`), Cursor uses `cursor-agent acp`, Grok uses `grok agent stdio` (fallback `npx @xai-official/grok agent stdio`), Antigravity uses `agy acp`, Muse Code uses `muse acp` with `MUSE_EXPERIMENTAL_ACP=on`, and Pi uses `npx pi-acp`. Log in with each provider's CLI before starting it in Arc. Arc does not install or upgrade providers. In Git projects, the first chat uses the project folder and later chats run in separate detached worktrees under Arc app data; use the branch icon on a chat to open its worktree in the editor.

Project trust is consent, not a sandbox: providers run commands with your OS user permissions. The default permission mode is Supervised, using each provider's native approval rules. Chats and transcripts stay in Arc app data; skills and MCP configuration stay provider-native. Conversations never move between providers; use a new chat to switch. Only one provider process runs at a time, and chats can be archived.

## Plugins, themes, and AI builds

Arc provides HTML-tag and PHP completion. Prettier formatting supports HTML, SVG, Vue, CSS, SCSS, JavaScript, TypeScript, JSON, Markdown, and YAML.

Import a plugin from **Plugins → Import plugin ZIP**. The ZIP must contain `plugin.json` and a self-contained `main.js`, either at its root or inside one folder. Arc rejects an import when either file is missing. Plugins can be enabled, disabled, and uninstalled, and can access Arc and workspace APIs, so install them only from sources you trust. See [`PLUGIN_API.md`](PLUGIN_API.md) for the API.

The **Build** tab walks you through a plugin or theme brief, then opens your configured terminal agent or exports a prompt for a free chat AI. Themes can also be created and edited in Theme Maker.
