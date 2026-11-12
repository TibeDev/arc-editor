# CSS Audit

Audit of the Arc CSS codebase against `CSS_CLEANUP_GUIDE.md`. No application code or existing CSS was changed.

## Scope and method

Inspected every CSS file under `src/`, its import sites, JSX/TSX class usage, generated theme CSS in `src/settings.ts`, and dynamic class construction in `src/pluginRuntime.ts` and `src/PluginPanel.tsx`.

- CSS files: `styles.css`, `SettingsPanel.css`, `GithubPanel.css`, `GithubPanel.auth.css`, `GithubPanel.controls.css`, `GithubPanel.layout.css`, `GithubPanel.setup.css`, `GithubPanel.updates.css`, `PluginPanel.css`, `PluginPanel.docs.css`, `PluginPanel.folder.css`, `pluginExtensions.css`, `panel-layout.css`, `Select.css`.
- "Unused" below means no reference in `src/**/*.ts(x)` after excluding CSS and generated theme strings, and not produced by CodeMirror, xterm, the plugin runtime, or another library.
- The app has no native `<select>` elements. Dropdowns use `src/Select.tsx` and `.arc-select-*`.
- There is no frontend test runner. `npm run build` is the typecheck gate; runtime behavior must be checked with `npm run tauri dev`.

## Summary

1. **Confirmed unused CSS:** about 36 app class names have no source reference, plus several stale selector groups. `PluginPanel.folder.css` is entirely unused.
2. **Confirmed cascade conflicts:** the GitHub panel background is controlled inline, file-viewer width rules are overridden inline, the editor tab top border is cancelled, and the settings toggle has two competing implementations.
3. **Duplication:** shared buttons live in GitHub CSS but are used by Plugins and Theme Maker; plugin header/list rules are spread across three files; native-select styling duplicates the `Select` component.
4. **Naming:** generic action buttons still carry `github-*` names; the command palette uses `plugin-command-*`; `file-viewer` is actually the file explorer/sidebar.
5. **Structure:** most CSS is minified into very long lines, `styles.css` contains append-only override blocks, and media queries are fragmented across component files.

---

## 1. Confirmed unused CSS

### `src/styles.css`

| Selector/class | Problem | Suggestion |
| --- | --- | --- |
| `.workspace-row`, `.workspace-row:hover`, `.workspace-row>span:nth-of-type(1)`, `.workspace-open` | Old workspace-header markup; no JSX uses these classes. | Remove the rules. Keep `.tree-row.drop-target-row` where it is grouped with `.workspace-header.drop-target-row`. |
| `.workspace-header`, `.workspace-header span`, `.workspace-header svg`, `.workspace-header:hover`, `.workspace-header.drop-target-row` | Same stale workspace-header UI. | Remove; preserve the live `.tree-row.drop-target-row` part of any grouped selector. |
| `.open-folder-row`, `.open-folder-row:hover`, `.viewer-empty`, `.viewer-empty button`, `.viewer-empty button:hover` | Old explorer CTA and empty state; current explorer uses the welcome screen and tree rows. | Remove. |
| `.editor-layout`, `.editor-layout.single`, `.editor-layout.vertical`, `.editor-layout.horizontal`, `.editor-layout.horizontal .editor-pane + .editor-pane` | Current layout uses `.split-container` and `.split-child`; no `.editor-layout` markup exists. | Remove the `.editor-layout` rules. Treat `.editor-pane + .editor-pane` as likely obsolete and verify before removing it separately. |
| `.breadcrumbs`, `.breadcrumbs span:first-child`, `.breadcrumbs span:last-child` | Old editor breadcrumb bar; no JSX. | Remove, including references in `src/settings.ts`. |
| `.save-button`, `.save-button:hover` | Old editor save button; no JSX. | Remove, including macOS and generated-theme references. |
| `.modal-backdrop`, `.confirm-dialog`, `.confirm-dialog h2`, `.confirm-dialog p`, `.confirm-dialog strong`, `.confirm-actions`, `.confirm-actions button`, `.confirm-actions button:hover`, `.confirm-actions .confirm-delete`, `.confirm-actions .confirm-delete:hover` | The app uses `window.confirm`; no modal markup exists. | Remove all base, macOS, glass, and generated-theme references. |
| `.settings-welcome`, `.settings-welcome:hover` | Old settings launcher variant; the used control is `.file-viewer-footer .settings-launch`. | Remove only the `.settings-welcome` parts from grouped rules. |
| `.theme-maker-save`, `.theme-maker-save button`, `.theme-maker-save button:hover`, `.theme-maker-save button:disabled`, `.theme-maker-save input` | Theme Maker now uses `.theme-maker-actions` with shared icon buttons; no `.theme-maker-save` markup exists. | Remove. |
| `.theme-maker-title`, `.theme-maker-title strong`, `.theme-maker-title span` | Theme Maker header no longer renders a title block. | Remove, including macOS and generated-theme references. |
| `.theme-preview-caption`, `.theme-preview-caption span:last-child` | Preview caption is not rendered by `ThemeMaker.tsx`. | Remove. |
| `.theme-color-row code` | Theme color rows now contain a swatch/picker, not a `<code>` value. | Remove. |
| `.theme-picker-channel`, `.theme-picker-channel span`, `.theme-picker-channel input`, `.theme-picker-channel b`, `.theme-picker-channel.channel-red input`, `.theme-picker-channel.channel-green input`, `.theme-picker-channel.channel-blue input`, `.channel-red`, `.channel-green`, `.channel-blue` | Current picker uses `.theme-picker-sv` and `.theme-picker-hue`, not RGB channel sliders. | Remove. When grouped with `.setting-field input[type="range"]`, remove only the `.theme-picker-channel` selectors and keep the range styles. |
| `.icon-tsx`, `.icon-jsx` | `FileIcon` maps both extensions to `.icon-react` (`src/App.tsx:676`). | Remove these two names from the shared icon-color selector; keep `.icon-ts`, `.icon-js`, and the other live icon classes. |
| `.plugin-docs-dialog` | Appears only in a `user-select` group; plugin docs are now inline content. | Remove it from the group. |

### `src/GithubPanel.css`

| Selector/class | Problem | Suggestion |
| --- | --- | --- |
| `.github-count`, `.github-meta-spacer`, `.github-overline`, `.github-repo-meta`, `.github-repo-summary`, `.github-repo-title`, `.github-repo-title > div`, `.github-repo-title strong` | Old repository summary UI; no JSX references these classes. | Remove the rules. Remove the names from grouped width/backdrop/glass selectors while keeping live names such as `.github-section`, `.github-commit-section`, and `.github-sync-row`. |
| `.github-footer`, `.github-footer svg` | Old panel footer; not rendered. | Remove all base and responsive references. |
| `.github-field select`, `.github-field select:focus`, and the corresponding parts of grouped input rules | The app uses the custom `Select` component, not a native select. | Remove only the select selectors; retain live input/textarea/create-branch selectors. |

### `src/GithubPanel.controls.css`

| Selector/class | Problem | Suggestion |
| --- | --- | --- |
| `.github-field select`, `.github-field select:hover:not(:disabled)`, `.github-field select:disabled`, `.github-field select option`, `.github-field select:focus-visible` | Entire native-select block is unused in the app. | Remove the block. Keep `.github-change input[type="checkbox"]` rules. |

### `src/SettingsPanel.css`

| Selector/class | Problem | Suggestion |
| --- | --- | --- |
| `.settings-main .setting-field select` in the shared input, focus, radius, border, and responsive groups | No native select is rendered inside Settings. | Remove only the select selectors from each group; keep the input, textarea, font family, and action selectors. |
| `.setting-toggle input` accent-color rule in `src/styles.css` | The input is a custom `appearance: none` switch, so `accent-color` has no visible effect. | Remove the rule when consolidating the toggle styles. |

### `src/PluginPanel.css`

| Selector/class | Problem | Suggestion |
| --- | --- | --- |
| `.plugin-intro` | Old plugin panel introduction; not rendered. | Remove. |
| `.plugin-help`, `.plugin-help h2`, `.plugin-help p`, `.plugin-help p code`, `.plugin-help pre`, `.plugin-help pre code` | Old inline help block replaced by the docs view. | Remove, including `.plugin-help` in the glass group. |
| `.plugin-toggle`, `.plugin-toggle input`, `.plugin-toggle input:checked`, `.plugin-toggle input:focus-visible`, `.plugin-toggle input:disabled` | Old checkbox toggle; plugins now use `.plugin-toggle-button`. | Remove. Do not remove `.plugin-toggle-button`. |

Do not remove `.plugin-view-grid`. It is generated dynamically by `plugin-view-${view}` in `src/PluginPanel.tsx:158`.

### `src/pluginExtensions.css`

| Selector/class | Problem | Suggestion |
| --- | --- | --- |
| `.plugin-docs-backdrop`, `.plugin-docs-dialog`, `.plugin-docs-dialog > header`, `.plugin-docs-dialog > header > div`, `.plugin-docs-dialog > header > div:first-child`, `.plugin-docs-dialog > header button`, `.plugin-docs-dialog > pre` | Plugin documentation is now rendered inline as `.plugin-docs-content`; no dialog markup exists. | Remove the dialog block and the stale `.plugin-docs-dialog` reference in `styles.css`. Keep `.plugin-command-backdrop` and `.plugin-command-dialog`, which are used by the command palette. |

### `src/PluginPanel.folder.css`

| Selector/class | Problem | Suggestion |
| --- | --- | --- |
| Entire file: `.plugin-folder-row`, `.plugin-folder-row > div`, `.plugin-folder-row span`, `.plugin-folder-row code`, `.plugin-folder-row .github-secondary` | No `.plugin-folder-row` markup exists. | Remove the file and its import in `src/PluginPanel.tsx:9`. |

### `src/settings.ts` generated theme CSS

The generated theme stylesheet also carries stale selectors. Because it is injected on every settings/theme change, these rules add noise even when they match nothing.

| Selector/class | Problem | Suggestion |
| --- | --- | --- |
| `.settings-field select` | Typo: the app class is `.setting-field`; this selector never matches. | Remove it. Do not "fix" it unless native selects are intentionally reintroduced. |
| `.setting-field select`, `.setting-field select option`, `.theme-maker-select-label select`, `.theme-maker-select-label select option`, `.theme-picker-channel input` | Native selects and the old channel picker are not used. | Remove only these selectors from generated rules. Keep the live setting/input/range selectors. |
| `.modal-backdrop`, `.confirm-dialog`, `.confirm-actions button`, `.confirm-actions button` in shared groups | Confirmation UI is `window.confirm`. | Remove the dead selectors from the generated rules. |
| `.breadcrumbs`, `.save-button`, `.save-button:hover`, `.settings-field select`, `.theme-maker-title span`, `.confirm-actions` | Stale app classes with no matching markup. | Remove from generated CSS. |

---

## 2. Confirmed cascade conflicts and overridden declarations

### GitHub panel background has three owners

- `src/GithubPanel.tsx:351` sets `backgroundColor: "var(--bg, #111315)"` inline.
- `src/GithubPanel.css` sets `.github-panel { background: var(--bg); }`.
- `src/GithubPanel.layout.css` sets `.github-panel { background: var(--panel, #151719); }`.
- `src/GithubPanel.css` also has a macOS `.app-shell.app-theme-macos .github-panel` background.

**Problem:** the inline style wins over every stylesheet rule, so all `.github-panel` background declarations, including the macOS variant, are dead. The CSS suggests a panel background that cannot currently appear.

**Suggestion:** choose one owner. If the inline background is intentional, remove the three CSS background declarations. If the CSS should control themes, remove the inline style and keep one base rule plus the macOS override.

### File-viewer responsive width rules are overridden inline

- `src/App.tsx:4556-4557` sets inline `width` and `flexBasis` from `settings.sidebarWidth`.
- `src/App.tsx:189` defines `MIN_VIEWER_WIDTH = 140`.
- `src/styles.css` sets `width: 244px`, `flex: 0 0 244px`, `min-width: 190px`, then a `@media (max-width: 760px)` width/flex-basis of `205px`, and later `min-width: 140px`.

**Problem:** the inline width/flex-basis override both the base and mobile CSS widths. The mobile `205px` rule is effectively dead, and the final `min-width: 140px` overrides the base `190px` minimum. The result is a confusing three-way width policy.

**Suggestion:** let one owner control width. Keep `min-width: 140px` only if the JS 140px resize limit is authoritative; remove the dead `190px` and the unused mobile width/flex declarations, or implement the responsive width in JS. Verify the intended behavior at the 760px breakpoint.

### Editor tab top accent border is cancelled

- Base `.editor-tab` has `border-top: 1px solid transparent`.
- `.editor-tab.active` sets `border-top-color`.
- A later rule sets `.editor-tab, .editor-tab.active { border-top: 0; }`.
- The Modern/macOS theme later sets only `border-top-color: var(--macos-accent)` on `.editor-tab.active`.

**Problem:** the later `border-top: 0` removes the border width/style, so the active tab top accent cannot render. The base and macOS `border-top-color` declarations are effectively dead.

**Suggestion:** remove the later `border-top: 0`, or explicitly restore the width/style in the active rule. Verify the intended active-tab treatment in both Classic and Modern themes.

### Settings toggle has two competing implementations

- `src/styles.css` defines `.setting-toggle input` as a 29x16 switch with a `::before` knob.
- `src/SettingsPanel.css` defines `.settings-panel .setting-toggle input[type="checkbox"]` as a 34x20 switch with an `::after` knob and a different checked position.

**Problem:** the more specific Settings rule overrides dimensions and colors, but the base `::before` pseudo-element still exists alongside the Settings `::after` knob. This is duplicated switch logic and risks a double-knob artifact or future visual drift.

**Suggestion:** keep one switch implementation. Either make the base `.setting-toggle` switch the shared control and remove the Settings override, or keep the Settings-specific switch and remove the base switch rules. Check both themes after consolidating.

### GitHub change checkbox styles overlap

- `src/GithubPanel.css` has `.github-change input { width: 13px; height: 13px; accent-color: #8f9cac; }`.
- `src/GithubPanel.controls.css` has `.github-change input[type="checkbox"]` with `width/height: 14px`, custom appearance, checked icon, hover, and focus styles.

**Problem:** the base width/height/accent-color declarations are overridden by the more specific type selector. The base rule is redundant.

**Suggestion:** remove the checkbox sizing/accent declarations from the base `.github-change input` rule or replace both with one consolidated checkbox rule.

### Collapsed resizer colors are dead

- `src/panel-layout.css:2-3` sets `.file-viewer-resizer.collapsed span` background.
- `src/styles.css:198-199` sets the same selectors with `!important`.

**Problem:** the `!important` rules always win, so the `panel-layout.css` declarations are dead.

**Suggestion:** keep the authoritative rule in one file and remove the duplicate. If the `!important` is no longer needed after consolidation, remove it and verify the cascade.

### Repeated patch blocks inside single files

Examples:

- `src/GithubPanel.css` defines base input/border/background rules, then later redefines border colors, input backgrounds, and focus colors for the same selectors.
- `src/PluginPanel.css` defines `.plugin-toggle-button` multiple times and defines `.plugin-list-wrap` twice.
- `src/styles.css` defines `.editor-pane` three times, `.terminal-stack` twice, `.editor-tab` several times, and `.cm-indent-guide` twice.

**Problem:** later patches override earlier declarations, so readers cannot tell which values are authoritative. Some earlier declarations are dead; others are still partially live, which makes deletion risky.

**Suggestion:** merge each selector's declarations into one rule while preserving the computed final values. Use `git diff`/DevTools to compare before and after. Do not reorder unrelated rules until the merged rules are verified.

### Generated theme CSS duplicates itself

`src/settings.ts` contains repeated declarations in the same generated stylesheet, for example:

- `.tab-strip, .editor-tab { background: ... }` appears twice.
- `.editor-tab.active { color: ... }` appears twice.
- `.editor-tab { color: ... }` appears in more than one rule.
- `.context-menu`/`.confirm-dialog`/`.settings-panel` background, border, and color declarations are split across several rules.

**Problem:** duplicated generated declarations increase the stylesheet string and make the theme cascade harder to reason about.

**Suggestion:** consolidate the generated rules by component and remove repeated declarations. This is safe when the final computed values are preserved.

---

## 3. Duplication and reuse opportunities

| Area | Problem | Suggestion |
| --- | --- | --- |
| Shared action buttons | `.github-primary`, `.github-secondary`, `.github-icon-button`, and `.plugin-icon-button` are defined in `GithubPanel.css`/`PluginPanel.css`, but are used by `GithubPanel.tsx`, `PluginPanel.tsx`, and `ThemeMaker.tsx`. Theme Maker must import GitHub and Plugin CSS to get its buttons. | Create a small shared control layer: a base action button, primary/secondary modifiers, and an icon-button class. Update all consumers and remove cross-component CSS imports where possible. Avoid merging controls that genuinely need different sizes or colors. |
| Plugin header actions | `.plugin-header-actions` is defined in `pluginExtensions.css`, `PluginPanel.css`, and `PluginPanel.docs.css` with different gaps and wrapping. `.plugin-header-actions > button` is also defined twice. | Keep one base definition in `PluginPanel.css`; scope docs-only overrides under the docs view. Remove the duplicate from `pluginExtensions.css`. |
| Plugin installed list | `.plugin-installed-list` is defined in `PluginPanel.css` and again in `PluginPanel.docs.css` for scrolling and padding. | Keep all list behavior in one place. If the scroll behavior is always desired, move it to `PluginPanel.css`; keep only docs-specific layout in the docs file. |
| Plugin header height | `.plugin-header` is defined in `PluginPanel.css` and redefined in `PluginPanel.docs.css` (`height: auto`, `min-height: 48px`). The docs rule affects the main plugin list too. | Scope docs header changes to the docs state or use a modifier class. Avoid global element changes from a feature-specific file. |
| Native selects versus `Select` | `styles.css`, `SettingsPanel.css`, `GithubPanel.css`, `GithubPanel.controls.css`, and generated theme CSS still style native `<select>` and `<option>`. The app uses `Select.tsx` and `.arc-select-*`. | Remove the native-select styling and let `Select.css` own dropdown appearance. Keep `Select.css` context rules for `.settings-main`, `.github-field`, and `.theme-maker-select-label`. |
| GitHub form controls | The same input recipe (full width, 30px minimum height, 6px/8px padding, 4px radius, dark background, inherited font) is repeated across `.github-field input`, `.github-identity-card input`, `.github-create-branch input`, `.github-commit-section textarea`, and `.github-commit-section input`. | Consolidate into a grouped selector or a shared `.field-control` class if the elements are always styled together. Only extract the truly identical declarations; keep container-specific borders/backgrounds separate. |
| Settings form controls | `.settings-main .setting-field` groups input, textarea, font family, and action styles with repeated height/padding/radius/background/color declarations. | Group the common declarations and keep type-specific exceptions. Do not merge action buttons with text inputs just because some properties match. |
| Scrollbar styling | `.plugin-installed-list` and `.plugin-docs-content` repeat the same scrollbar color/width recipe. Other scroll areas use different native scrollbars. | Define one scrollbar pattern for scrollable plugin panels or use a shared variable/class. Do not force it on the editor or terminal, which have separate behavior. |
| Glass/backdrop declarations | Backdrop-filter and `-webkit-` variants are repeated across `styles.css`, `SettingsPanel.css`, `PluginPanel.css`, `pluginExtensions.css`, and `Select.css`. Some use theme variables, others hardcode blur values. | Keep context-specific blur values, but group the paired declarations and document which surfaces use which transparency variable. Avoid one universal blur because the design intentionally varies surfaces. |
| Tab strip height | `.tab-strip` height and `.terminal-stack` top offset both use `34px`/`34px` magic numbers. | Introduce `--tab-strip-height: 34px` and use it for both. This keeps terminal positioning correct if the tab strip changes. |
| Hardcoded palette values | `styles.css`, `SettingsPanel.css`, `GithubPanel.*.css`, and generated theme CSS repeat values such as `#d5d9e0`, `#111315`, `#202429`, `#8ba5c2`, `#292d31`, and `#747980`, which duplicate existing root/theme tokens. | Map repeated colors to existing variables where the value is the same token. Do this incrementally and verify both Classic and Modern themes; not every hardcoded value is a theme token. |
| Radius/type/spacing values | Border radii range from 3px to 14px and font sizes from 8px to 18px without a documented scale. Some variation is intentional. | Introduce a small set of radius/type variables only for repeated values. Avoid a sweeping redesign; the goal is consistency, not visual change. |
| `!important` | 22 static declarations use `!important`, plus 33 in generated theme CSS. Most generated ones target CodeMirror/xterm internals; static ones include folder icons, macOS theme overrides, and the resizer. | Keep the CodeMirror/xterm overrides unless tested. Audit the static ones individually; remove `!important` where the cascade can be made deterministic by consolidating rules. Do not remove them in a batch. |

---

## 4. Naming issues

| Class/file | Problem | Suggestion |
| --- | --- | --- |
| `.github-primary`, `.github-secondary`, `.github-icon-button` | Generic action buttons are named after the GitHub panel but are reused by Plugin Manager and Theme Maker. | Rename to shared names such as `.action-button`, `.action-button--primary`, `.action-button--secondary`, `.icon-button`. Update every TSX reference and the CSS context selectors. |
| `.plugin-icon-button` | Sounds plugin-specific but is used by Theme Maker and the plugin panel. It is also a sizing modifier layered on GitHub button classes. | Move it to the shared control layer and give it a generic name, or make it a size modifier such as `.icon-button--compact`. |
| `.plugin-command-backdrop`, `.plugin-command-dialog` | These are the core command palette, not a plugin feature. They live in `pluginExtensions.css` and are used by `App.tsx:5019`. | Rename to `.command-palette-backdrop`/`.command-palette-dialog` and move the rules to the command palette's owning CSS. Update the TSX. |
| `.file-viewer`, `.show-viewer` | The element is the file explorer/sidebar, not a content viewer. | Consider `.file-explorer`/`.sidebar` and `.show-file-explorer`. This is a broad rename: update `App.tsx` click-away selectors (`target.closest('.file-viewer')`), aria labels, and all CSS. |
| `.app-theme-macos` | User-facing name is "Modern"; the class and persisted setting value are `macos`. | Optional: rename only the CSS class to `.app-theme-modern` while keeping the persisted `appTheme: "macos"` value for compatibility. Do not rename the setting without a migration. |
| `panel-layout.css` | The file contains file-viewer sizing, theme-picker positioning, macOS settings/editor overrides, and drop-target rules, not just panel layout. | Rename to a more accurate `layout-overrides.css` or move each rule to its owning component file. |
| `GithubPanel.layout.css` | Contains base GitHub header/heading/panel styles and feedback width, not only layout. | Merge the base rules into `GithubPanel.css`; keep a separate file only for genuinely layout-specific or responsive rules. |

---

## 5. Structure and readability

1. **Minified source formatting.** Most CSS is compressed into extremely long lines: `GithubPanel.css` has a 7.8 KB line, `PluginPanel.css` a 3.9 KB line, and `styles.css` a 3.2 KB line. `Select.css` is normally formatted, while `SettingsPanel.css` is mostly compressed. This makes review and conflict detection difficult.
   - Suggestion: run Prettier over CSS, or adopt one-rule-per-line consistently. Formatting creates a large diff and should be a separate commit from behavior changes.

2. **`styles.css` is an append-only override stack.** It contains base component rules, theme-maker rules, Classic/macOS theme patches, glass patches, and user-select rules. Later blocks repeatedly override earlier ones (editor tabs, panes, terminal, file viewer, theme picker).
   - Suggestion: add clear section banners and merge duplicate selectors into their original component sections. If desired, extract Theme Maker/theme-picker rules into `ThemeMaker.css` and theme/glass patches into a theme file. This is optional; do not rewrite the architecture just for file count.

3. **Cross-component CSS imports.** `ThemeMaker.tsx` imports `GithubPanel.css`, `PluginPanel.css`, and `SettingsPanel.css`; `PluginPanel.tsx` imports `GithubPanel.css`. This is how shared buttons work today, but it gives Theme Maker a dependency on unrelated component styles.
   - Suggestion: create a shared `controls.css` for action/icon buttons and shared control tokens, imported by the components that use them. Keep component-specific CSS in the component file.

4. **Media queries are fragmented.** There are 13 media queries across the files, including repeated 600px and 760px breakpoints in `GithubPanel.css`, `GithubPanel.layout.css`, and `GithubPanel.updates.css`, plus 640px, 720px, 850px, and 900px elsewhere.
   - Suggestion: group responsive rules at the end of each component file and document the breakpoints. Merge duplicate breakpoints in GitHub files where they serve the same component.

5. **Generated theme CSS and static CSS both own colors.** Static CSS supplies Classic defaults and a large set of hardcoded colors; `themeCss()` injects another layer of overrides. This is the root cause of many dead color declarations in theme-aware components.
   - Short term: remove dead selectors and duplicate declarations.
   - Longer term (optional): let static CSS consume theme variables for repeated tokens, so generated CSS only sets variables where possible. CodeMirror/xterm token overrides may still need generated rules.

6. **Layer ordering is ad hoc.** `z-index` values include 1, 2, 3, 12, 20, 30, 40, 60, 70, 80, 1000, 10000, 120, and 130. The drop-target overlay in particular escalates from 1000 to 10000 in the Modern theme.
   - Suggestion: document a small layer scale (base content, sidebar, tabs, floating menus, modals, plugins, drag overlay) and reuse it. Do not change values without checking the affected overlays.

---

## 6. Suggested cleanup order

1. **Remove unambiguous dead code:** delete `PluginPanel.folder.css` and its import; remove the stale plugin/docs/confirm/workspace/theme classes; remove native-select blocks. Remove only dead names from grouped selectors.
2. **Resolve the confirmed cascade conflicts:** GitHub panel background ownership, file-viewer width policy, editor-tab border, settings toggle duplication, GitHub checkbox duplication, resizer colors.
3. **Consolidate duplicate declarations:** merge the repeated patch blocks in `GithubPanel.css`, `PluginPanel.css`, and `styles.css`; deduplicate generated theme CSS.
4. **Rename shared controls:** action/icon buttons and command-palette classes first, because they are reused across components. Rename `file-viewer` last because it has JS selectors and aria labels.
5. **Format and section:** run Prettier/one-rule-per-line as a separate commit, then add section banners and regroup media queries.
6. **Verify at runtime:** run `npm run build`, then `npm run tauri dev` and check the affected areas manually.

---

## 7. Verification and false positives

Do not remove these merely because they lack literal class references:

- `.arc-semantic-*` classes are generated dynamically in `src/pluginRuntime.ts:3149`.
- `.plugin-view-grid` is generated by `plugin-view-${view}` in `src/PluginPanel.tsx:158`.
- `.untracked` is a real status class produced from the Rust status string and lowercased in the GitHub panel.
- `.cm-*` and `.xterm-*` classes are produced by CodeMirror and xterm.
- `.org`/`.w3` matches are URL/regex artifacts, not app classes.
- External plugins run in the same DOM and could theoretically reuse generic class names, but those classes are not a supported styling API. Confirm with a runtime smoke test before removing dead app selectors.

Classes that appear in markup but have no CSS rules are not findings here; for example `.github-changes` and `.window-resize-handles` are wrappers without styling.

Recommended runtime checks after cleanup:

- Resize the file explorer at desktop and below 760px; confirm the minimum width and persisted width behavior.
- Check editor tabs in Classic and Modern themes, including the active tab accent.
- Check Settings toggles in Classic and Modern themes.
- Check GitHub panel backgrounds in Classic, Modern, and glass modes; verify the inline/CSS ownership change.
- Check plugin list/grid, plugin docs, install/uninstall confirmations, and the command palette.
- Check Theme Maker save/create/open-folder controls and the color picker popover.
- Run `npm run build` to catch type errors from renamed classes/imports.
