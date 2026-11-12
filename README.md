# Arc

Arc is a desktop workspace for web development. It puts your project files, code editor, terminal, browser preview, and GitHub tools in one window.

## What you can do

- Open a project folder and browse, search, create, rename, move, copy, or delete its files.
- Edit JavaScript, TypeScript, JSX, TSX, HTML, CSS, SCSS, PHP, JSON, and Markdown with syntax highlighting.
- Work across multiple tabs and nested editor splits. Drag tabs between panes or drag a tab to a pane edge to create a split.
- Open terminal tabs in your project folder.
- Preview a project with Live Server. Arc serves the workspace locally and reloads the page when files change.
- Use the GitHub panel to create or connect a repository, change branches, stage and commit files, and pull or push changes.
- Adjust editor and terminal settings, choose a built-in color theme, or create a custom theme.
- Install local JavaScript plugins. Arc includes Live Server and a Linux-only XAMPP plugin.

## Install on Omarchy

From the project folder, pass the downloaded or locally built AppImage to the installer:

```sh
./install-appimage.sh /path/to/Arc.AppImage
```

The script works with only the AppImage and this script. It copies Arc to `~/Applications/Arc.AppImage`, creates a launcher entry under `$XDG_DATA_HOME` (or `~/.local/share`), and needs no `sudo`. Search for Arc in the app launcher.

Installed AppImages update automatically. Arc checks for signed releases, replaces `~/Applications/Arc.AppImage` in place, and restarts. Choose Stable or Beta under **Settings → Updates**.

## Working in a project

Open a folder with `Ctrl+K`, then `Ctrl+O`. Use the file browser to open or manage files. Save with `Ctrl+S`; supported files can be formatted with Prettier on save or with `Alt+Shift+F`.

Open a terminal with `Ctrl+T`. Start Live Server from the plugin toolbar or file context menu to preview the current project in a browser.

The GitHub panel needs Git and GitHub CLI (`gh`). Open the panel, sign in, then stage and commit changes or sync with a remote.

## Shortcuts

| Shortcut                    | Action                                  |
| --------------------------- | --------------------------------------- |
| `Ctrl+K`, then `Ctrl+O`     | Open a project folder                   |
| `Ctrl+N` / `Ctrl+Shift+N`   | Create a file / folder                  |
| `Ctrl+T`                    | Open a terminal                         |
| `Ctrl+Shift+P`              | Open the command palette                |
| `Ctrl+\\` / `Ctrl+Shift+\\` | Split editor vertically / horizontally  |
| `Ctrl+B`                    | Show or hide the file browser           |
| `Ctrl+S` / `Ctrl+W`         | Save / save and close the active editor |
| `F2` / `Delete`             | Rename / delete the selected item       |
| `Alt+Shift+F`               | Format the active file                  |

On macOS, replace `Ctrl` with `Command`. `Alt+Shift+F` uses `Option+Shift+F`.

## Editor and plugins

Arc provides HTML-tag and PHP completion. It does not include language-server support yet. Prettier formatting supports HTML, SVG, Vue, CSS, SCSS, JavaScript, TypeScript, JSON, Markdown, and YAML.

Install a plugin from **Plugins → Install from folder**. A plugin folder needs `plugin.json` and a self-contained `main.js`. Plugins can access Arc and workspace APIs, so install them only from sources you trust. See [`PLUGIN_API.md`](PLUGIN_API.md) for the API.
