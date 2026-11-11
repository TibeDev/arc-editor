# Arc Editor — Comprehensive Memory & Performance Optimization Audit

## Project information

**Main technology stack:**

- React 19
- TypeScript
- Vite
- CodeMirror 6
- Tauri 2
- Rust
- xterm.js
- JavaScript plugin system

## 1. Main objective

I want you to perform an extremely thorough memory and performance optimization audit of the entire Arc Editor application.

The biggest issue is that the application currently consumes approximately **500 MB of RAM**.

I want to investigate whether this can be significantly reduced without sacrificing functionality, stability, editing capabilities or the overall user experience.

Memory consumption is the highest priority, followed by:

1. CPU usage.
2. Rendering performance.
3. Startup time.
4. File loading and saving performance.
5. General application responsiveness.
6. Background resource consumption.

The goal is to make Arc as lightweight and efficient as reasonably possible while retaining all existing functionality.

However, there is one extremely important instruction:

**YOU DO NOT HAVE TO IMPLEMENT EVERY OPTIMIZATION YOU FIND OR INVESTIGATE.**

Your primary responsibility is to investigate the entire project, identify potential optimizations, determine whether they are applicable, evaluate their expected benefits and risks, and report your findings.

Only implement optimizations when there is sufficient evidence that they would provide a meaningful improvement.

Do not blindly modify code just because an optimization is theoretically possible.

I would rather have 10 well-researched and effective optimizations than 50 unnecessary code changes.

If something is already optimized, leave it alone.

If something cannot reasonably be improved, explain why.

If an optimization introduces unnecessary complexity or risks breaking existing functionality, do not implement it.

---

# PHASE 1 — Understand the entire application

Before making any changes, thoroughly inspect the repository.

Do not restrict your investigation to CodeMirror.

Understand how the entire application works, including:

- React component architecture.
- Application state management.
- CodeMirror editor initialization and lifecycle.
- Editor tabs and multiple editor groups.
- Split editor functionality.
- File content loading and caching.
- File explorer and directory tree.
- File system operations.
- Rust filesystem implementation.
- Filesystem watchers.
- xterm.js terminal implementation.
- Rust PTY implementation.
- Plugin runtime and plugin lifecycle.
- Live Server functionality.
- GitHub integration.
- Theme management.
- Settings management.
- Markdown rendering and previews.
- Prettier formatting.
- Tauri IPC communication.
- Application startup and initialization.
- Background tasks.
- Event listeners.
- Timers.
- Workers.
- Subscriptions.
- Any other functionality that might consume memory or CPU resources.

Pay particular attention to these files and directories:

- `src/App.tsx`
- `src/TerminalView.tsx`
- `src/terminalOutput.ts`
- `src/pluginRuntime.ts`
- `src/settings.ts`
- `src/SettingsPanel.tsx`
- `src/PluginPanel.tsx`
- `src/ThemeMaker.tsx`
- `src-tauri/src/`
- `src-tauri/Cargo.toml`
- `package.json`
- `plugins/`

Find and inspect other relevant files yourself.

The objective is to understand:

- Where memory is allocated.
- What keeps allocated objects alive.
- What gets unnecessarily recreated.
- What can be released earlier.
- What runs unnecessarily in the background.
- What causes unnecessary rendering.
- What causes unnecessary CPU usage.

Do not start implementing changes before understanding the relevant architecture.

---

# PHASE 2 — Establish a performance baseline

Before optimizing anything, measure the application's current performance.

I want a baseline that can be compared against the application after optimization.

Measure memory consumption in the following scenarios:

1. Immediately after application startup.
2. After opening a workspace.
3. After opening approximately 10 files.
4. After opening approximately 30 files.
5. After opening a large source file.
6. After opening multiple editor splits.
7. After opening multiple terminal tabs.
8. After opening and closing different application panels.
9. After closing several files.
10. After returning to an otherwise idle application.

Also investigate memory consumption when opening a large development workspace containing directories such as:

- `node_modules`
- `.git`
- `dist`
- `build`
- `target`
- `.next`
- `.cache`
- Other generated or dependency directories.

Use appropriate profiling tools.

### Frontend profiling

Investigate:

- Chromium/WebView memory profiling where available.
- JavaScript heap snapshots.
- Allocation timelines.
- Retained objects.
- Detached DOM nodes.
- Event listener leaks.
- React component rendering.
- CodeMirror allocations.
- xterm.js allocations.

### Rust backend profiling

Investigate:

- Process memory.
- Heap allocations.
- Long-lived collections.
- Background threads.
- PTY processes.
- Filesystem watcher allocations.
- Buffer allocations.
- Channel and queue memory usage.

Use suitable tools for the operating system.

For example, on Linux, investigate `/proc`, `ps`, `smem` and suitable heap profiling tools.

On Windows and macOS, use equivalent tools where appropriate.

**Important:** Distinguish between:

- JavaScript heap.
- WebView memory.
- Native allocations.
- Rust allocations.
- GPU memory.
- Child-process memory.

Do not assume all memory consumption originates from JavaScript.

Create a baseline report with actual measurements and the most likely sources of memory consumption.

If an exact measurement cannot be obtained, clearly explain what was measured and what remains unknown.

---

# PHASE 3 — CodeMirror 6 optimization

This is one of the most important areas of investigation.

Arc uses CodeMirror 6, so thoroughly inspect its implementation and lifecycle.

## 3.1 EditorView lifecycle

Inspect how `EditorView` instances are created and destroyed in `EditorPane`.

Investigate:

- Whether editor instances are recreated unnecessarily.
- Whether React effects have unstable dependencies.
- Whether callback identity changes trigger editor recreation.
- Whether plugin extension changes recreate editors.
- Whether settings updates unnecessarily reconstruct extensions.
- Whether theme changes unnecessarily recreate editor state.
- Whether language changes cause unnecessary allocations.
- Whether editor instances remain alive after files are closed.
- Whether multiple editor groups create duplicate instances.
- Whether editor instances are properly destroyed when their owning groups disappear.

The current implementation uses `EditorView`, `EditorState` and `Compartment`.

Investigate whether the existing Compartment architecture can be used more effectively.

For example, investigate whether `Compartment.reconfigure()` can update editor configuration without destroying and recreating the entire editor.

Pay particular attention to:

- Theme.
- Tab size.
- Indentation settings.
- Word wrapping.
- Line numbers.
- Bracket matching.
- Autocompletion configuration.
- Language configuration.

Preserve:

- Editor state.
- Cursor positions.
- Selections.
- Undo history.
- Scroll positions.

## 3.2 Editor instance management

Investigate the `editorViews` Map.

Determine whether maintaining an `EditorView` for every opened file is necessary.

Consider investigating:

- Keeping only active editor instances mounted.
- Destroying inactive editor views while preserving document state.
- Recreating views from cached editor state when needed.
- Separating document state from DOM-backed EditorView instances.
- Reusing editor instances when switching tabs if architecturally appropriate.
- Preventing multiple editor views from unnecessarily representing the same document.

Do not blindly destroy editors to save memory if this causes history, selection or scroll state to disappear.

Determine the best balance between memory consumption and editor responsiveness.

## 3.3 Large file handling

Investigate CodeMirror performance with:

- Files containing 10,000 lines.
- Files containing 50,000 lines.
- Files containing 100,000+ lines.
- Minified JavaScript.
- Large JSON files.
- Large HTML files.
- Files containing very long individual lines.

Investigate whether expensive extensions are doing unnecessary work.

Pay particular attention to:

- Syntax highlighting.
- Parsing.
- Decorations.
- ViewPlugins.
- Autocompletion.
- Bracket matching.
- Selection highlighting.
- Indentation guides.
- Line numbers.
- Search functionality.

Determine whether expensive editor features should be simplified or disabled for exceptionally large documents.

Use sensible thresholds where appropriate.

Do not make the editor unusable just to save memory.

## 3.4 Indentation guides

Inspect `buildIndentGuides()` and `indentationGuides()`.

The current implementation calculates indentation decorations based on visible ranges and rebuilds decorations when the document or viewport changes.

Investigate:

- Whether decorations are unnecessarily recreated.
- Whether calculations can be incremental.
- Whether unchanged visible lines can reuse existing decorations.
- Whether unnecessary regular-expression operations can be reduced.
- Whether calculations can be restricted more efficiently.
- Whether the extension performs excessive work during scrolling and typing.

Optimize this feature only if profiling identifies a meaningful opportunity.

Preserve its appearance and functionality.

## 3.5 CodeMirror extensions

Audit every built-in extension.

Identify extensions that:

- Allocate unnecessary objects.
- Perform expensive work on every document update.
- Perform unnecessary DOM operations.
- Recalculate decorations too frequently.
- Retain references longer than necessary.
- Duplicate existing functionality.
- Could be loaded conditionally.

Investigate whether features can be loaded only when needed.

Keep language loading lazy.

Avoid loading unnecessary language packages for files that are not currently being edited.

---

# PHASE 4 — File content management and memory

Investigate the entire file-loading and caching architecture.

Pay particular attention to:

- `fileContents`
- `openFiles`
- `editorViews`
- Any other Maps, Sets, arrays or caches containing file data.

The application stores file contents in memory, which could become a significant source of memory consumption.

Investigate:

1. Whether file contents are duplicated between React state, Maps and CodeMirror documents.
2. Whether multiple copies of the same document exist.
3. Whether closed files remain cached indefinitely.
4. Whether inactive tabs retain unnecessary document objects.
5. Whether large files are read completely when they do not need to be.
6. Whether files are unnecessarily reread from disk.
7. Whether file contents are copied repeatedly during state updates.
8. Whether saving creates unnecessary temporary copies.
9. Whether external filesystem changes create unnecessary document copies.
10. Whether the application retains references to closed documents.

Investigate the possibility of implementing:

- Lazy loading.
- Memory-aware caching.
- Cache eviction for inactive documents.
- Avoiding duplicate strings.
- Preserving unsaved changes.
- Separating persisted disk state from editor state.
- Releasing document references when files are closed.

If appropriate, investigate an LRU cache or another memory-aware caching strategy.

However, do not implement cache eviction simply because it sounds useful.

Determine whether the existing cache is actually contributing significantly to memory consumption.

Never discard unsaved changes.

---

# PHASE 5 — React architecture and rendering

Inspect the React architecture for unnecessary rendering and retained component state.

The main application currently has substantial functionality concentrated in `App.tsx`.

Investigate whether this causes unnecessary rendering across unrelated parts of the application.

Look for:

- Large components containing unrelated state.
- Components rerendering when unrelated state changes.
- Expensive calculations inside component rendering.
- Unstable callback references.
- Unstable object and array references.
- Expensive derived state.
- Repeated filtering and mapping operations.
- Unnecessary state duplication.
- Effects running more frequently than necessary.
- Components retaining large objects through closures.
- Components that should be memoized.

Pay particular attention to:

- Editor panes.
- File explorer.
- Terminal panels.
- Settings.
- Plugin panels.
- Theme management.
- GitHub panel.

Investigate whether:

- `React.memo`
- `useMemo`
- `useCallback`
- Better state isolation.
- Smaller independent components.
- Dedicated custom hooks.

Would provide measurable benefits.

Do not add memoization everywhere.

Do not perform a massive architectural rewrite simply for code organization.

The objective is measurable performance improvement.

---

# PHASE 6 — Plugin system optimization

Inspect `src/pluginRuntime.ts` thoroughly.

It is a substantial part of the codebase and deserves special attention.

Investigate:

- Whether every built-in plugin is loaded at startup.
- Whether plugin source code is unnecessarily loaded into memory.
- Whether plugin initialization is lazy.
- Whether disabled plugins still allocate resources.
- Whether plugin panels remain mounted while hidden.
- Whether plugin editors register unnecessary CodeMirror extensions.
- Whether plugins retain references after being disabled.
- Whether plugin subscriptions are properly disposed.
- Whether timers and intervals are cleared.
- Whether plugin workers are terminated.
- Whether plugin event listeners are removed.
- Whether plugin processes are properly stopped.
- Whether plugin-specific caches grow indefinitely.

The current implementation uses eager `import.meta.glob` imports for built-in plugin sources.

Investigate whether this can be changed to lazy loading without breaking plugin installation or functionality.

Investigate whether plugin source strings remain in memory unnecessarily.

Consider a clear plugin lifecycle:

1. Plugin discovered.
2. Plugin loaded only when needed.
3. Plugin activated.
4. Plugin deactivated when appropriate.
5. Plugin resources disposed.
6. Plugin fully unloaded when appropriate.

Make sure disabled plugins do not consume unnecessary resources.

Keep the plugin API compatible with existing plugins wherever possible.

Determine whether lazy loading actually reduces memory consumption or simply moves allocations to a later point.

---

# PHASE 7 — Terminal and PTY optimization

Arc uses xterm.js in the frontend and Rust PTY functionality in the backend.

Investigate both sides.

### Frontend

Investigate:

- Terminal instance creation.
- Terminal disposal.
- Terminal scrollback memory.
- Terminal output buffering.
- Output subscriptions.
- Event listeners.
- Resize observers.
- FitAddon.
- DOM retention.
- Hidden terminal behavior.
- Terminal recreation when settings change.

Pay particular attention to `TerminalView.tsx` and `terminalOutput.ts`.

The current implementation creates terminal instances when active and disposes of frontend terminal instances when inactive.

Investigate whether this lifecycle is optimal.

### Backend

Investigate:

- PTY lifecycle.
- Background processes.
- Output buffers.
- Terminal output event delivery.
- Unused terminal sessions.
- Thread allocations.
- Channel buffering.
- Unbounded collections.
- Repeated string allocations.
- Excessive IPC messages.

Pay particular attention to `terminalScrollback`.

Large scrollback buffers can consume considerable memory when several terminals are open.

Investigate appropriate defaults and configurable limits.

Investigate whether terminal output is buffered unnecessarily in `terminalOutput.ts`.

Ensure inactive terminals do not create unnecessary frontend rendering work.

However, preserve background terminal functionality.

A hidden terminal must not unexpectedly lose its running shell or output.

Investigate batching terminal output where appropriate instead of sending excessive IPC messages for every small output chunk.

---

# PHASE 8 — Rust backend optimization

Perform a thorough Rust memory and performance audit.

Inspect all modules under `src-tauri/src/`.

Look for:

- Unnecessary cloning.
- Excessive `String` allocations.
- Unnecessary `Vec` allocations.
- Unbounded collections.
- Large buffers retained unnecessarily.
- Inefficient filesystem operations.
- Excessive directory traversal.
- Repeated metadata lookups.
- Unnecessary serialization and deserialization.
- Excessive Tauri event emissions.
- Long-lived threads.
- Unnecessary background tasks.
- Memory retained after closing terminals or plugins.
- Inefficient synchronization.
- Locks held for too long.
- Unnecessary `Arc` references.
- Unnecessary `Mutex` usage.
- Inefficient channels.
- Unbounded message queues.

Investigate whether `Cow`, references, iterators, `Bytes` or more efficient data structures are appropriate.

Do not optimize Rust code based on assumptions.

Profile before making significant changes.

Pay particular attention to:

- Filesystem watcher.
- PTY implementation.
- Plugin process management.
- Local HTTP server.
- File operations.
- Workspace management.

Investigate whether any long-lived resources are being retained unnecessarily.

---

# PHASE 9 — Filesystem watcher optimization

Investigate the Rust filesystem watcher implementation.

Arc can be used with very large development projects, so filesystem monitoring must be efficient.

Investigate:

- How many directories are watched.
- Whether ignored directories are actually excluded.
- Whether large generated directories are traversed.
- Whether directory trees are scanned repeatedly.
- Whether watcher events are unnecessarily duplicated.
- Whether event queues can grow without limits.
- Whether large event batches are processed inefficiently.
- Whether file metadata is repeatedly queried.
- Whether created and removed directories trigger excessive work.
- Whether workspace switching releases old watchers.
- Whether watchers are correctly destroyed.

Check handling of common directories:

- `node_modules`
- `.git`
- `dist`
- `build`
- `target`
- `.next`
- `.cache`
- Other generated directories.

Respect project-specific ignore rules and existing user configuration.

Investigate efficient filtering, debouncing and event batching.

The watcher must still correctly detect relevant file changes.

---

# PHASE 10 — Lazy loading and dependency optimization

Inspect the frontend bundle and all dependencies.

Look for packages that are unnecessarily loaded during startup.

Pay attention to:

- Prettier.
- Individual Prettier plugins.
- CodeMirror language packages.
- Markdown rendering.
- GitHub functionality.
- Settings panels.
- Theme maker.
- Plugin functionality.
- Terminal functionality.
- Icons.
- Other large dependencies.

The application already uses dynamic imports in several places.

Investigate whether lazy loading can be extended to other expensive functionality.

Ensure that:

- Features load when first needed.
- Previously loaded modules are reused.
- Unnecessary features are not initialized at startup.
- Large dependencies are not duplicated in the bundle.
- Dead code is removed where appropriate.
- Dependencies are not replaced simply because another package is smaller.

Generate and inspect a production bundle analysis.

Identify the largest JavaScript chunks and their dependencies.

Determine whether bundle optimization would meaningfully improve startup time or runtime memory.

Remember that smaller bundle size does not automatically mean lower runtime memory consumption.

---

# PHASE 11 — Dedicated memory leak investigation

Perform a dedicated memory leak investigation.

This is extremely important.

Look for:

- Event listeners without cleanup.
- Tauri listeners without unlisten calls.
- CodeMirror views without destruction.
- xterm instances without disposal.
- ResizeObservers without disconnection.
- MutationObservers without disconnection.
- Timers without cleanup.
- Intervals without cleanup.
- Workers that remain alive.
- Plugin resources without disposal.
- Unreleased closures.
- Detached DOM elements.
- References retained in Maps and Sets.
- Subscriptions that remain active after components unmount.
- Rust channels and threads that never terminate.

Use heap snapshots where possible.

Perform repeated operations:

1. Open a file.
2. Close the file.
3. Repeat.
4. Open a terminal.
5. Close its frontend view.
6. Repeat.
7. Open a plugin panel.
8. Close it.
9. Repeat.
10. Switch workspaces.
11. Repeat.

Observe whether memory returns close to its previous level.

Some memory may remain allocated by the WebView or runtime even after objects are released.

Distinguish between:

- Actual retained objects.
- Memory reserved for reuse.
- Garbage collection timing.
- Native memory retained by the runtime.
- GPU allocations.

Fix actual leaks where justified.

---

# PHASE 12 — General performance optimizations

After investigating memory issues, investigate general performance.

Optimize where meaningful:

- Startup time.
- Workspace opening.
- File explorer rendering.
- Large directory trees.
- File searching.
- File opening.
- File saving.
- CodeMirror initialization.
- Syntax highlighting.
- Terminal rendering.
- Plugin initialization.
- GitHub panel loading.
- Theme changes.
- Settings changes.
- Tauri IPC communication.

Avoid unnecessary synchronous work on the main thread.

Investigate moving expensive operations to Rust or Web Workers where appropriate.

Investigate virtualization for large lists.

Avoid rendering thousands of unnecessary DOM elements.

Use debouncing or batching for expensive operations where appropriate.

Only implement changes with a reasonable expected benefit.

---

# PHASE 13 — Additional high-priority investigation targets

These recommendations are particularly important for Arc.

However, they are investigation targets, not mandatory implementation tasks.

**You are NOT required to implement every optimization described here. Your responsibility is to investigate whether each optimization is applicable to Arc, determine its potential benefits and risks, and report your findings.**

## 13.1 CodeMirror EditorView recreation

Investigate whether Arc unnecessarily creates and destroys CodeMirror `EditorView` instances.

Pay particular attention to the `EditorPane` implementation in `App.tsx`.

Inspect the dependencies of its React effects, especially:

- `onActivate`
- `onChange`
- `pluginEditorExtensions`
- Other callbacks and configuration objects.

Determine whether unstable references cause unnecessary editor recreation.

Investigate whether:

- Existing EditorViews can be reused.
- Existing EditorStates can be preserved independently of EditorViews.
- CodeMirror Compartments can update configurations without recreating editors.
- Inactive editor views can be destroyed while retaining document state.
- Multiple editor groups unnecessarily duplicate editor instances.
- EditorViews are properly disposed of when tabs and groups are closed.

Do not automatically implement these changes.

First establish whether the current implementation actually has this problem.

If the existing lifecycle is already efficient, leave it alone.

## 13.2 File content caching and document retention

Investigate the memory implications of:

- `fileContents`
- `editorViews`
- `openFiles`
- Other document-related Maps, Sets or caches.

Determine:

- How many copies of each document can exist simultaneously.
- Whether document strings are duplicated.
- Whether CodeMirror retains documents after tabs are closed.
- Whether inactive documents remain unnecessarily cached.
- Whether large files create disproportionately high memory usage.
- Whether closed files are actually released from memory.
- Whether editor state and persisted file contents can be managed more efficiently.

Investigate the possibility of:

- Memory-aware caching.
- LRU cache eviction.
- Lazy document loading.
- Releasing inactive EditorViews.
- Separating document state from DOM-backed editor instances.
- Avoiding duplicate document representations.

Preserve unsaved changes, undo history, cursor positions and scroll positions wherever applicable.

Do not introduce cache eviction merely because it sounds useful.

Determine whether the existing cache is actually contributing significantly to memory consumption.

## 13.3 Plugin runtime and eager loading

Investigate `src/pluginRuntime.ts`, which is a particularly large part of the codebase.

The current implementation uses eager `import.meta.glob` imports for built-in plugin sources.

Determine:

- Whether every plugin source is loaded at application startup.
- Whether disabled plugins still consume memory.
- Whether plugin initialization creates unnecessarily retained objects.
- Whether plugins can be loaded only when needed.
- Whether plugin source strings remain in memory unnecessarily.
- Whether plugin resources are properly released after deactivation.
- Whether plugin panels remain mounted when they are not being used.
- Whether plugin workers, timers and subscriptions are properly disposed of.

Investigate the possibility of lazy plugin loading.

Preserve plugin compatibility and the existing plugin API.

Determine whether changing the loading architecture would actually reduce memory usage or only move allocations to a later point.

## 13.4 React state and component architecture

Investigate whether the current application architecture causes excessive rendering or retains unnecessary state.

Pay particular attention to the large `App.tsx` component.

Determine whether unrelated application state changes cause expensive editor, terminal or file explorer rerenders.

Investigate whether:

- State can be isolated more effectively.
- Expensive derived values are recalculated unnecessarily.
- Large objects are retained through callbacks and closures.
- Component unmounting properly releases resources.
- Memoization would provide measurable benefits.
- Separating specific application responsibilities would improve memory management.

Do not perform a large architectural rewrite unless there is a measurable reason.

---

# PHASE 14 — Implementation rules

Follow these rules throughout the audit and optimization process.

1. Do not remove existing features to reduce memory consumption.
2. Do not replace CodeMirror with Monaco or another editor.
3. Do not replace Tauri or Rust.
4. Do not rewrite the application from scratch.
5. Do not introduce large new dependencies without justification.
6. Do not make speculative changes without identifying a potential benefit.
7. Do not introduce data loss.
8. Do not break unsaved document handling.
9. Do not break editor splits or tabs.
10. Do not break terminal persistence.
11. Do not break plugins.
12. Do not break filesystem watching.
13. Do not break themes or settings.
14. Do not break existing keyboard shortcuts.
15. Do not sacrifice editing responsiveness for lower memory usage.
16. Do not simply hide memory usage by changing reporting or measurement methods.
17. Do not implement optimizations solely because they are mentioned in this prompt.
18. Do not introduce unnecessary architectural complexity.
19. Do not make unrelated code changes.
20. Do not claim improvements without measurements or a clearly documented limitation.

Prefer small, isolated, measurable improvements.

Keep the code maintainable.

If an optimization requires a significant architectural change, explain why before implementing it.

---

# PHASE 15 — Testing

After implementing justified optimizations, test the entire application.

At minimum, verify the following.

## Editor

- Open files.
- Close files.
- Switch tabs.
- Open multiple tabs.
- Open multiple splits.
- Move tabs between splits.
- Change languages.
- Change themes.
- Change editor settings.
- Edit large files.
- Save files.
- Restore unsaved changes.
- Undo and redo.
- External file changes.
- Formatting.

## Terminal

- Open multiple terminals.
- Switch between terminals.
- Hide and show terminals.
- Verify background shells continue running.
- Verify terminal output is not lost.
- Resize terminals.
- Change terminal settings.

## Plugins

- Enable plugins.
- Disable plugins.
- Open plugin panels.
- Close plugin panels.
- Verify plugin cleanup.
- Verify plugin functionality.

## Workspace

- Open a workspace.
- Switch workspaces.
- Open large directories.
- Modify files externally.
- Rename files.
- Delete files.
- Create directories.
- Verify filesystem watching.

## Other functionality

- GitHub integration.
- Live Server.
- Theme management.
- Settings.
- Markdown preview.

Run existing tests and the production build.

Add targeted regression tests for any bugs discovered during optimization.

---

# PHASE 16 — Final memory benchmarks

Once the investigation and any justified optimizations are complete, repeat the exact same measurements from Phase 2.

Compare the results.

Create a table containing:

| Scenario               | Before | After | Improvement |
| ---------------------- | -----: | ----: | ----------: |
| Application startup    |        |       |             |
| Workspace opened       |        |       |             |
| 10 open files          |        |       |             |
| 30 open files          |        |       |             |
| Large file             |        |       |             |
| Multiple editor splits |        |       |             |
| Multiple terminals     |        |       |             |
| Idle application       |        |       |             |

Use actual measurements.

Do not invent benchmark results.

If certain measurements cannot be reproduced reliably, explain why.

I want to know:

- How much RAM was saved.
- Which optimizations contributed most.
- Which problems were discovered.
- Which problems were fixed.
- Which problems remain.
- Whether CPU usage improved.
- Whether startup time improved.
- Whether editing responsiveness improved.

Make sure before-and-after measurements use the same operating system, build configuration, workload and measurement methodology wherever possible.

---

# PHASE 17 — Final report

When finished, provide a detailed report containing the following sections.

## 1. Original problems

Explain what was consuming the most memory and why.

## 2. Investigation results

List all investigated areas and classify each as:

- Applicable.
- Already optimized.
- Not applicable.
- Needs further investigation.

## 3. Changes implemented

List every meaningful optimization and the files changed.

Explain why each change was necessary.

## 4. Optimizations intentionally not implemented

List the optimizations you investigated but decided not to implement.

Explain why they were unnecessary, risky, ineffective or unsupported by evidence.

## 5. Memory improvements

Provide actual before-and-after measurements.

## 6. Performance improvements

Explain improvements to CPU usage, startup time, rendering and responsiveness.

## 7. Architecture changes

Explain any changes to:

- Editor lifecycle.
- Document caching.
- React state.
- Plugin lifecycle.
- Terminal handling.
- Rust backend architecture.
- Filesystem watchers.

## 8. Remaining problems

List anything that could not be fixed and explain why.

## 9. Future recommendations

Suggest additional optimizations that could be investigated in the future.

---

# Final priorities

If you need to prioritize the investigation, use this order:

1. Find and fix actual memory leaks.
2. Investigate CodeMirror EditorView lifecycle and memory management.
3. Investigate file content caching and document retention.
4. Investigate React rendering and application state architecture.
5. Investigate plugin loading and lifecycle.
6. Investigate terminal and PTY memory consumption.
7. Investigate Rust backend allocations and filesystem watchers.
8. Investigate lazy loading and dependency management.
9. Investigate CPU usage and general application responsiveness.

# Final instructions

I want you to investigate Arc as a complete desktop application.

Do not assume CodeMirror is responsible for all 500 MB of RAM consumption.

Investigate:

- The WebView.
- React.
- CodeMirror.
- Rust backend.
- Plugins.
- Terminals.
- Filesystem monitoring.
- Dependencies.
- Background processes.
- All other relevant components.

**Investigate broadly, implement selectively, and measure the results.**

You are not required to implement every optimization in this prompt.

You are required to investigate whether each optimization could reasonably be applied to Arc and determine whether implementing it would provide a meaningful benefit.

If something is already optimized, document that.

If something is not applicable, explain why.

If something is potentially beneficial but cannot be verified, document it as a recommendation.

Only make changes that are justified.

The final result should be a significantly more memory-efficient Arc Editor with a clean, maintainable implementation and no unnecessary loss of functionality.

The current approximately 500 MB RAM usage is the problem I want to solve.
