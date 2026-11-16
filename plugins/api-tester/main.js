export function activate(api) {
  const state = {
    pass: 0,
    fail: 0,
    skip: 0,
    running: false,
    lines: [],
    panelLog: null,
    panelRoot: null,
    serviceValue: { value: 0 },
    configEvents: 0,
  };

  const output = api.ui.createOutputChannel("API Tester");
  const tempRoot = "api-tester-tmp";
  const disposables = [];
  const cleanups = [];

  function addCleanup(fn) {
    cleanups.push(fn);
    return fn;
  }

  function detailText(detail) {
    if (detail === undefined || detail === null) return "";
    if (typeof detail === "string") return detail;
    try { return JSON.stringify(detail); } catch { return String(detail); }
  }

  function record(kind, name, detail) {
    const line = `[${kind}] ${name}${detail ? ` — ${detailText(detail)}` : ""}`;
    state.lines.push(line);
    if (state.lines.length > 2000) state.lines.splice(0, state.lines.length - 2000);
    output.appendLine(line);
    if (kind === "PASS") state.pass += 1;
    else if (kind === "FAIL") state.fail += 1;
    else if (kind === "SKIP") state.skip += 1;
    const method = kind === "FAIL" ? "error" : kind === "SKIP" ? "warn" : "log";
    console[method](`[API Tester] ${line}`);
    renderLog();
    updateStatus();
  }

  function updateStatus() {
    const stateLabel = state.running ? "running" : `${state.pass} pass / ${state.fail} fail / ${state.skip} skip`;
    api.ui.updateStatusItem("status", { text: `API Tester: ${stateLabel}` });
  }

  function renderLog() {
    if (!state.panelLog) return;
    state.panelLog.textContent = state.lines.join("\n");
    state.panelLog.scrollTop = state.panelLog.scrollHeight;
  }

  async function test(name, fn) {
    try {
      const detail = await fn();
      record("PASS", name, detail);
      return true;
    } catch (error) {
      record("FAIL", name, error && error.message ? error.message : String(error));
      return false;
    }
  }

  function skip(name, reason) {
    record("SKIP", name, reason);
  }

  function expect(condition, message) {
    if (!condition) throw new Error(message || "Expectation failed.");
  }

  function expectMatch(value, pattern, message) {
    expect(pattern.test(String(value)), `${message || "Pattern mismatch"}: ${String(value)}`);
  }

  function wait(ms) {
    return new Promise((resolve) => api.timers.setTimeout(resolve, ms));
  }

  async function waitFor(predicate, timeoutMs = 3000, label = "condition") {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await predicate();
      if (value) return value;
      await wait(50);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  function withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const timer = api.timers.setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
      Promise.resolve(promise).then((value) => { api.timers.clearTimeout(timer); resolve(value); }, (error) => { api.timers.clearTimeout(timer); reject(error); });
    });
  }

  function requireWorkspace() {
    if (!api.workspace) throw new Error("Open a folder first.");
    return api.workspace;
  }

  async function ensureTemp() {
    requireWorkspace();
    if (!(await api.files.exists(tempRoot))) await api.files.createDirectory(tempRoot);
    return tempRoot;
  }

  function tempPath(name) {
    return `${tempRoot}/${name}`;
  }

  async function runGroup(label, fn) {
    if (state.running) {
      api.notify("API Tester is already running.");
      return;
    }
    state.running = true;
    state.pass = 0;
    state.fail = 0;
    state.skip = 0;
    record("INFO", `--- ${label} ---`);
    try {
      await fn();
    } catch (error) {
      record("FAIL", `${label} crashed`, error && error.message ? error.message : String(error));
    } finally {
      state.running = false;
      record("INFO", `--- ${label} finished: ${state.pass} pass / ${state.fail} fail / ${state.skip} skip ---`);
      api.notify(`API Tester: ${state.pass} pass, ${state.fail} fail, ${state.skip} skip`);
      updateStatus();
      api.app.openPanel("dashboard");
    }
  }

  const mcpServerScript = `#!/bin/sh
while IFS= read -r line; do
  id=$(printf '%s' "$line" | grep -o '"id":[0-9]*' | head -n1 | cut -d: -f2)
  method=$(printf '%s' "$line" | sed -n 's/.*"method":"\\([^"]*\\)".*/\\1/p' | head -n1)
  result=''
  case "$method" in
    initialize) result='{"protocolVersion":"2025-06-18","capabilities":{"tools":{},"resources":{},"prompts":{}},"serverInfo":{"name":"api-tester-mcp"}}' ;;
    tools/list) result='{"tools":[{"name":"echo","description":"Echo text","inputSchema":{"type":"object"}}]}' ;;
    tools/call) result='{"content":[{"type":"text","text":"echoed"}],"isError":false}' ;;
    resources/list) result='{"resources":[{"uri":"test://resource","name":"Test","mimeType":"text/plain"}]}' ;;
    resources/templates/list) result='{"resourceTemplates":[{"uriTemplate":"test://item/{id}","name":"Item"}]}' ;;
    resources/read) result='{"contents":[{"uri":"test://resource","mimeType":"text/plain","text":"resource body"}]}' ;;
    resources/subscribe) result='{}' ;;
    resources/unsubscribe) result='{}' ;;
    prompts/list) result='{"prompts":[{"name":"test-prompt","description":"Test prompt","arguments":[]}]}' ;;
    prompts/get) result='{"messages":[{"role":"user","content":{"type":"text","text":"prompt body"}}]}' ;;
    completion/complete) result='{"completion":{"values":["alpha","beta"]}}' ;;
    logging/setLevel) result='{}' ;;
    ping) result='{}' ;;
    *) if [ -n "$id" ]; then result='{}'; fi ;;
  esac
  if [ -n "$id" ] && [ -n "$result" ]; then
    printf '{"jsonrpc":"2.0","id":%s,"result":%s}\\n' "$id" "$result"
  fi
done`;

  const lspServerScript = `body='{"jsonrpc":"2.0","id":2,"result":{"capabilities":{}}}'
length=$(printf '%s' "$body" | wc -c | tr -d ' ')
printf 'Content-Length: %s\\r\\n\\r\\n%s' "$length" "$body"
cat`;

  async function writeScripts() {
    await ensureTemp();
    await api.files.write(tempPath("mcp-server.sh"), mcpServerScript);
    await api.files.write(tempPath("lsp-server.sh"), lspServerScript);
  }

  async function closeDiffOverlay() {
    await wait(120);
    const overlay = document.querySelector(".arc-plugin-overlay");
    if (!overlay) return false;
    const close = [...overlay.querySelectorAll("button")].find((button) => /close/i.test(button.textContent || ""));
    if (close) close.click();
    else overlay.remove();
    return true;
  }

  async function smokeTests() {
    await test("api.plugin metadata", () => {
      expect(api.plugin.id === "api-tester", "wrong plugin id");
      expect(api.plugin.name && api.plugin.version, "missing plugin metadata");
      return api.plugin.name;
    });
    await test("api.invoke", async () => {
      const path = await api.invoke("plugin_process_which", { executable: "sh" });
      expect(path === null || typeof path === "string", "invoke returned an unexpected value");
      return String(path);
    });
    await test("api.workspace / platform", () => {
      expect(typeof api.workspace === "string", "workspace is not a string");
      expect(["windows", "linux", "macos"].includes(api.platform), "unknown platform");
      return `${api.platform}, workspace=${api.workspace || "<none>"}`;
    });
    await test("api.supports", () => {
      expect(api.supports("process.spawn"), "process.spawn not advertised");
      expect(!api.supports("definitely.not.real"), "unknown capability advertised");
      return "capability checks work";
    });
    await test("api.disposables.add", () => {
      let disposed = false;
      const dispose = api.disposables.add(() => { disposed = true; });
      dispose();
      expect(disposed, "disposer did not run");
      return "disposer ran";
    });
    await test("api.timers.setTimeout / clearTimeout", async () => {
      let fired = false;
      const timer = api.timers.setTimeout(() => { fired = true; }, 20);
      expect(typeof timer === "number", "timer id is not a number");
      await wait(60);
      expect(fired, "timeout did not fire");
      const cancelled = api.timers.setTimeout(() => { throw new Error("cancelled timer fired"); }, 20);
      api.timers.clearTimeout(cancelled);
      return "timeout fired; cancellation accepted";
    });
    await test("api.timers.setInterval / clearInterval", async () => {
      let ticks = 0;
      const timer = api.timers.setInterval(() => { ticks += 1; }, 15);
      await wait(55);
      api.timers.clearInterval(timer);
      expect(ticks >= 1, "interval did not tick");
      const before = ticks;
      await wait(50);
      expect(ticks === before, "interval kept ticking after clear");
      return `${ticks} ticks`;
    });
    await test("api.lifecycle.onDeactivate / onShutdown", () => {
      const stopDeactivate = api.lifecycle.onDeactivate(() => console.log("[API Tester] deactivate handler ran"));
      const stopShutdown = api.lifecycle.onShutdown(() => console.log("[API Tester] shutdown handler ran"));
      disposables.push(stopDeactivate, stopShutdown);
      return "handlers registered";
    });
    await test("api.workers.create", async () => {
      const url = await api.assets.url("main.js");
      const worker = api.workers.create(url);
      expect(worker && typeof worker.terminate === "function", "worker was not created");
      worker.terminate();
      return "worker created and terminated";
    });
    await test("api.languages registry", () => {
      expect(api.languages && typeof api.languages.register === "function", "language registry missing");
      expect(typeof api.languages.registerGrammar === "function", "grammar registration missing");
      return "language registry available";
    });
    await test("api.paths join/resolve/relative/toUri/fromUri/basename/dirname/extname/normalize", async () => {
      const joined = api.paths.join("a", "b", "c.txt");
      expectMatch(joined, /a[\\/]b[\\/]c\.txt$/, "join failed");
      const resolved = await api.paths.resolve(api.workspace || ".", "a", "b.txt");
      const relative = api.paths.relative(api.workspace || ".", resolved);
      expect(relative.includes("b.txt"), "relative failed");
      const uri = api.paths.toUri(resolved);
      expect(api.paths.fromUri(uri) === resolved, "fromUri(toUri(x)) mismatch");
      expect(api.paths.basename(joined) === "c.txt", "basename failed");
      expectMatch(api.paths.dirname(joined), /a[\\/]b$/, "dirname failed");
      expect(api.paths.extname(joined) === ".txt", "extname failed");
      expect(!api.paths.normalize("a\\\\b").includes("\\\\"), "normalize failed");
      return uri;
    });
    await test("api.storage get/set/remove/clear", () => {
      api.storage.set("tester.key", { n: 1 });
      expect(api.storage.get("tester.key")?.n === 1, "storage get failed");
      api.storage.remove("tester.key");
      expect(api.storage.get("tester.key", null) === null, "storage remove failed");
      api.storage.set("tester.clear", true);
      api.storage.clear();
      expect(api.storage.get("tester.clear", null) === null, "storage clear failed");
      return "global storage works";
    });
    await test("api.storage.workspace get/set/remove/clear", () => {
      api.storage.workspace.set("ws.key", 42);
      expect(api.storage.workspace.get("ws.key") === 42, "workspace get failed");
      api.storage.workspace.remove("ws.key");
      expect(api.storage.workspace.get("ws.key", null) === null, "workspace remove failed");
      api.storage.workspace.set("ws.clear", true);
      api.storage.workspace.clear();
      expect(api.storage.workspace.get("ws.clear", null) === null, "workspace clear failed");
      return "workspace storage works";
    });
    await test("api.configuration get/update/onChanged", async () => {
      let changed = null;
      const stop = api.configuration.onChanged((event) => { changed = event; });
      disposables.push(stop);
      const value = api.configuration.get("autoRunSmoke", true);
      api.configuration.update("autoRunSmoke", !value);
      await wait(20);
      expect(changed && changed.key === "autoRunSmoke", "configuration change event missing");
      api.configuration.update("autoRunSmoke", value);
      return `value=${value}`;
    });
    await test("api.secrets set/get/delete", async () => {
      const key = `secret-${Date.now()}`;
      await api.secrets.set(key, "s3cret");
      expect(await api.secrets.get(key) === "s3cret", "secret read mismatch");
      await api.secrets.delete(key);
      expect(await api.secrets.get(key) === null, "secret was not deleted");
      return "OS credential store round-trip";
    });
    await test("api.settings get/update", () => {
      const before = api.settings.get();
      api.settings.update({ tabSize: before.tabSize });
      expect(api.settings.get().tabSize === before.tabSize, "settings update failed");
      return `tabSize=${before.tabSize}`;
    });
    await test("api.themes list/getColors/set/onChanged", () => {
      const themes = api.themes.list();
      expect(themes.length > 0, "no themes");
      const colors = api.themes.getColors();
      expect(Object.keys(colors).length > 0, "theme colors empty");
      const current = api.settings.get().selectedTheme;
      expect(api.themes.set(current), "could not select current theme");
      const stop = api.themes.onChanged(() => undefined);
      disposables.push(stop);
      return `${themes.length} themes`;
    });
    await test("api.plugins list/get/whenAvailable/onChanged", async () => {
      const list = api.plugins.list();
      const self = api.plugins.get("api-tester");
      expect(self && self.id === "api-tester", "self metadata missing");
      await withTimeout(api.plugins.whenAvailable("api-tester"), 1000, "plugins.whenAvailable");
      const stop = api.plugins.onChanged(() => undefined);
      disposables.push(stop);
      return `${list.length} installed`;
    });
    await test("api.services register/get/whenAvailable", async () => {
      const stop = api.services.register("api-tester:service", state.serviceValue);
      disposables.push(stop);
      expect(api.services.get("api-tester:service") === state.serviceValue, "services.get failed");
      expect(await api.services.whenAvailable("api-tester:service") === state.serviceValue, "services.whenAvailable failed");
      return "service round-trip";
    });
    await test("api.commands list/execute/onExecuted", async () => {
      let executed = null;
      const stop = api.commands.onExecuted((event) => { executed = event; });
      disposables.push(stop);
      await api.commands.execute("ping");
      await wait(20);
      expect(executed && executed.id.endsWith("ping") && executed.success, "command execution event missing");
      expect(api.commands.list().some((command) => command.id.endsWith("ping")), "commands.list missing ping");
      return "command executed";
    });
    await test("api.keybindings register/unregister", () => {
      const stop = api.keybindings.register("ping", "Ctrl+Alt+Shift+P", "apiTester.enabled");
      api.ui.setContext("apiTester.enabled", true);
      stop();
      api.keybindings.unregister("ping", "Ctrl+Alt+Shift+P");
      return "binding registered and removed";
    });
    await test("api.events on/emit", async () => {
      let payload = null;
      const stop = api.events.on("plugin:api-tester:ready", (value) => { payload = value; });
      disposables.push(stop);
      api.events.emit("ready", { at: Date.now() });
      await wait(10);
      expect(payload && payload.at, "plugin event did not arrive");
      return "plugin event delivered";
    });
    await test("api.icons register/get/unregister", () => {
      const stop = api.icons.register("tester", "<svg viewBox='0 0 16 16'><circle cx='8' cy='8' r='6'/></svg>");
      disposables.push(stop);
      expect(api.icons.get("tester"), "icon not registered");
      api.icons.unregister("tester");
      expect(api.icons.get("tester") === null, "icon not removed");
      return "icon lifecycle works";
    });
    await test("api.assets url/readText/readBytes/resolvePath", async () => {
      const url = await api.assets.url("main.js");
      expect(url.startsWith("blob:"), "asset URL is not a blob URL");
      const text = await api.assets.readText("main.js");
      expect(text.includes("export function activate"), "asset text missing");
      const bytes = await api.assets.readBytes("main.js");
      expect(bytes.length > 100, "asset bytes too small");
      const path = await api.assets.resolvePath("main.js");
      expect(path.includes("main.js"), "asset path missing");
      return `${bytes.length} bytes`;
    });
    await test("api.workspaceFolders get/onChanged", async () => {
      const folders = await api.workspaceFolders.get();
      const stop = api.workspaceFolders.onChanged(() => undefined);
      disposables.push(stop);
      return `${folders.length} folder(s)`;
    });
    await test("api.workspaceTrust isTrusted/onChanged", () => {
      const trusted = api.workspaceTrust.isTrusted();
      const stop = api.workspaceTrust.onChanged(() => undefined);
      disposables.push(stop);
      return `trusted=${trusted}`;
    });
    await test("api.clipboard readText/writeText/writeHtml", async () => {
      const value = `api-tester-${Date.now()}`;
      await api.clipboard.writeText(value);
      expect(await api.clipboard.readText() === value, "clipboard text mismatch");
      await api.clipboard.writeHtml("<strong>api tester</strong>", "api tester");
      return "clipboard round-trip";
    });
    await test("api.window read API", async () => {
      const focused = await api.window.isFocused();
      const visibility = api.window.getVisibility();
      const idle = api.window.getIdleTime();
      const stopFocus = api.window.onFocusChanged(() => undefined);
      const stopVisibility = api.window.onVisibilityChanged(() => undefined);
      disposables.push(stopFocus, stopVisibility);
      expect(typeof focused === "boolean", "isFocused result");
      expect(visibility && typeof visibility.visible === "boolean", "visibility result");
      expect(typeof idle === "number" && idle >= 0, "idle result");
      return `focused=${focused}, idle=${idle}ms`;
    });
    await test("api.app getState/setTitle/openPanel", () => {
      const before = api.app.getState();
      expect(before.settings, "app state missing settings");
      const title = document.title;
      api.app.setTitle("API Tester Running");
      expect(document.title === "API Tester Running", "title not changed");
      api.app.setTitle(title);
      api.app.openPanel("dashboard");
      return "app state and title work";
    });
    await test("api.terminal open/list/write/resize/close", async () => {
      const id = api.terminal.open();
      expect(id, "terminal did not open");
      const session = await waitFor(() => api.terminal.list().find((entry) => entry.id === id), 3000, "terminal in list");
      expect(session, "terminal missing from list");
      const retry = async (action) => {
        let lastError = null;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          try { return await action(); }
          catch (error) {
            lastError = error;
            if (!/not found/i.test(String(error))) throw error;
            await wait(100);
          }
        }
        throw lastError;
      };
      await retry(() => api.terminal.write(id, "printf api-terminal\\n"));
      await retry(() => api.terminal.resize(id, 80, 24));
      await retry(() => api.terminal.close(id));
      return `terminal ${id}`;
    });
    await test("api.openTerminal convenience", () => {
      const id = api.openTerminal();
      expect(typeof id === "string" || id === null, "openTerminal result");
      if (id) void api.terminal.close(id);
      return "openTerminal called";
    });
    await test("api.notify / api.ui.notify", () => {
      api.notify("API Tester smoke check");
      api.ui.notify("API Tester UI notify");
      return "notifications sent";
    });
    await test("api.diagnostics collection", async () => {
      let event = null;
      const stop = api.events.on("diagnostics:changed", (value) => { event = value; });
      disposables.push(stop);
      const collection = api.diagnostics.createCollection("api-tester");
      collection.set("file:///api-tester.txt", [{ severity: "warning", message: "test", from: 0, to: 1 }]);
      await wait(10);
      expect(event && event.name === "api-tester", "diagnostics event missing");
      collection.delete("file:///api-tester.txt");
      collection.clear();
      collection.dispose();
      return "diagnostics lifecycle works";
    });
    await test("api.languages registration", () => {
      return "language, providers, and grammar were registered during activation";
    });
    await test("api.editor event subscriptions", () => {
      const stops = [
        api.editor.onActiveChanged(() => undefined),
        api.editor.onContextChanged(() => undefined),
        api.editor.onSelectionChanged(() => undefined),
        api.editor.onDocumentOpened(() => undefined),
        api.editor.onDocumentClosed(() => undefined),
        api.editor.onDocumentChanged(() => undefined),
        api.editor.onDocumentSaved(() => undefined),
        api.editor.onWillSave(() => undefined),
      ];
      disposables.push(...stops);
      return `${stops.length} editor subscriptions`;
    });
    await test("api.editor content provider/custom editor registration", () => {
      const stopContent = api.editor.registerContentProvider("apitest-content", { read: async () => "virtual content" });
      const stopEditor = api.editor.registerCustomEditor("**/*.apitest-view", { mount(container) { container.textContent = "custom editor"; } });
      disposables.push(stopContent, stopEditor);
      return "registrations accepted";
    });
    await test("api.ui.createOutputChannel append/clear/dispose", () => {
      const channel = api.ui.createOutputChannel("API Tester Secondary");
      channel.append("a");
      channel.appendLine("b");
      channel.show();
      channel.clear();
      channel.dispose();
      return "output channel lifecycle works";
    });
    await test("api.ui.showProgress / showNotification", async () => {
      const result = await api.ui.showProgress({ title: "API Tester progress" }, async (report) => {
        report("halfway", 50);
        return 7;
      });
      const id = api.ui.showNotification("API Tester notification", { severity: "info", actions: [{ label: "Log", run: () => console.log("action") }] });
      expect(result === 7, "progress result mismatch");
      expect(id, "notification id missing");
      return "progress and notification work";
    });
  }

  async function fileTests() {
    if (!api.workspace) {
      skip("api.files (all)", "No workspace is open.");
      return;
    }
    await ensureTemp();
    const fileA = tempPath("a.txt");
    const fileB = tempPath("b.bin");
    const fileC = tempPath("c.txt");
    const fileD = tempPath("d.txt");
    const fileE = tempPath("sub/e.txt");
    const fileF = tempPath("trash.txt");
    const provider = {
      files: new Map([["virtual.txt", "virtual body"]]),
      read: async (path) => new TextEncoder().encode(provider.files.get(path.split(":").pop()) || ""),
      write: async (path, bytes) => { provider.files.set(path.split(":").pop(), new TextDecoder().decode(bytes)); },
      list: async () => [...provider.files.keys()].map((name) => ({ name, kind: "file" })),
    };
    const disposeProvider = api.files.registerProvider("apitest", provider);
    disposables.push(disposeProvider);

    await test("api.files createDirectory/exists", async () => {
      await api.files.createDirectory(tempPath("sub"));
      expect(await api.files.exists(tempRoot), "temp root missing");
      expect(await api.files.exists(tempPath("sub")), "sub directory missing");
      return tempRoot;
    });
    await test("api.files write/read", async () => {
      await api.files.write(fileA, "alpha");
      expect(await api.files.read(fileA) === "alpha", "text mismatch");
      return fileA;
    });
    await test("api.files writeBytes/readBytes", async () => {
      await api.files.writeBytes(fileB, new Uint8Array([1, 2, 3, 4]));
      const bytes = await api.files.readBytes(fileB);
      expect(bytes.length === 4 && bytes[2] === 3, "binary mismatch");
      return `${bytes.length} bytes`;
    });
    await test("api.files writeAtomic", async () => {
      await api.files.writeAtomic(fileC, "atomic");
      expect(await api.files.read(fileC) === "atomic", "atomic write failed");
      return fileC;
    });
    await test("api.files openReadStream", async () => {
      const stream = await api.files.openReadStream(fileA);
      const first = await stream.read(2);
      const rest = await stream.read(100);
      await stream.close();
      expect(new TextDecoder().decode(first) === "al", "first chunk mismatch");
      expect(new TextDecoder().decode(rest) === "pha", "rest chunk mismatch");
      return "read stream works";
    });
    await test("api.files openWriteStream", async () => {
      const stream = await api.files.openWriteStream(fileD);
      await stream.write(new TextEncoder().encode("stream-"));
      await stream.write(new TextEncoder().encode("write"));
      await stream.close();
      expect(await api.files.read(fileD) === "stream-write", "write stream mismatch");
      return "write stream works";
    });
    await test("api.files stat", async () => {
      const info = await api.files.stat(fileA);
      expect(info.isFile && !info.isDirectory && info.size >= 5, "stat fields wrong");
      return `${info.size} bytes`;
    });
    await test("api.files list/listRecursive", async () => {
      const flat = await api.files.list(tempRoot);
      const recursive = await api.files.listRecursive(tempRoot, { maxDepth: 4 });
      expect(flat.some((entry) => entry.name === "a.txt"), "list missing file");
      expect(recursive.some((entry) => entry.path.includes("sub")), "recursive missing sub");
      return `${flat.length} direct, ${recursive.length} recursive`;
    });
    await test("api.files find/searchText", async () => {
      await api.files.write(fileE, "needle in a haystack");
      const found = await api.files.find(`${tempRoot}/**/*.txt`);
      const hits = await api.files.searchText("needle", { include: `${tempRoot}/**` });
      expect(found.length > 0, "find returned nothing");
      expect(hits.some((hit) => hit.path.includes("e.txt")), "searchText missed needle");
      return `${found.length} files, ${hits.length} hits`;
    });
    await test("api.files copy/rename/move", async () => {
      await api.files.copy(fileA, tempPath("copy.txt"));
      await wait(150);
      await api.files.rename(tempPath("copy.txt"), tempPath("renamed.txt"));
      await api.files.move(tempPath("renamed.txt"), tempPath("sub/moved.txt"), { overwrite: true });
      expect(await api.files.read(tempPath("sub/moved.txt")) === "alpha", "move/copy content mismatch");
      return "copy, rename, move work";
    });
    await test("api.files watch", async () => {
      await ensureTemp();
      let event = null;
      const stop = api.files.watch(`${tempRoot}/**`, (value) => { event = value; });
      disposables.push(stop);
      await wait(100);
      await api.files.write(tempPath("watched.txt"), "watch me");
      await waitFor(() => event, 2500, "files.watch event");
      stop();
      return event.path;
    });
    await test("api.files registerProvider", async () => {
      expect(await api.files.read("apitest:virtual.txt") === "virtual body", "provider read failed");
      await api.files.write("apitest:virtual.txt", "updated");
      expect((await api.files.readBytes("apitest:virtual.txt")).length === 7, "provider write/readBytes failed");
      expect((await api.files.list("apitest:")).length === 1, "provider list failed");
      expect(await api.files.exists("apitest:virtual.txt"), "provider exists failed");
      return "virtual filesystem works";
    });
    await test("api.files trash", async () => {
      await api.files.write(fileF, "trash me");
      await api.files.trash(fileF);
      expect(!(await api.files.exists(fileF)), "file still exists after trash");
      return "trashed";
    });
    await test("api.files open/refresh", async () => {
      await api.files.open(fileA);
      await waitFor(() => api.editor.getContext()?.path?.endsWith("a.txt"), 3000, "files.open editor");
      await api.files.refresh();
      return "open and refresh work";
    });
    await test("api.files delete", async () => {
      const target = "arc-api-tester-delete-me.txt";
      await api.files.write(target, "bye");
      await wait(150);
      await api.files.delete(target);
      expect(!(await api.files.exists(target)), "delete failed");
      return "deleted";
    });
    await test("api.localServer start/stop", async () => {
      const server = await api.localServer.start(api.workspace);
      expect(server.url.startsWith("http://127.0.0.1:"), "unexpected local server URL");
      try {
        const response = await api.net.fetch(server.url);
        expect(response.status < 500, "local server request failed");
      } catch {
        const address = /^http:\/\/([^:]+):(\d+)/.exec(server.url);
        expect(address, "could not parse local server URL");
        const socket = await api.net.connectTcp(address[1], Number(address[2]), { timeoutMs: 3000 });
        let data = "";
        socket.onData((bytes) => { data += new TextDecoder().decode(bytes); });
        await socket.write(new TextEncoder().encode("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
        await waitFor(() => data.includes("HTTP/1."), 3000, "local server TCP response");
        await socket.close();
      }
      await api.localServer.stop();
      return server.url;
    });
  }

  async function editorTests() {
    if (!api.workspace) {
      skip("api.editor (all)", "No workspace is open.");
      return;
    }
    await ensureTemp();
    const file = tempPath("editor.txt");
    await api.files.write(file, "one\ntwo\nthree\n");
    const events = { opened: null, changed: null, saved: null, selection: null, active: null, context: null };
    const stops = [
      api.editor.onDocumentOpened((value) => { events.opened = value; }),
      api.editor.onDocumentChanged((value) => { events.changed = value; }),
      api.editor.onDocumentSaved((value) => { events.saved = value; }),
      api.editor.onSelectionChanged((value) => { events.selection = value; }),
      api.editor.onActiveChanged((value) => { events.active = value; }),
      api.editor.onContextChanged((value) => { events.context = value; }),
    ];
    disposables.push(...stops);
    await test("api.editor open/active/context", async () => {
      await api.editor.open(file);
      await waitFor(() => api.editor.getContext()?.path?.endsWith("editor.txt"), 3000, "editor open");
      expect(events.opened, "document opened event missing");
      expect(events.active || events.context, "active/context event missing");
      expect(api.editor.getActive()?.path?.endsWith("editor.txt"), "getActive mismatch");
      expect(api.editor.getLastActive()?.path?.endsWith("editor.txt"), "getLastActive mismatch");
      expect(api.editor.getLanguage(), "getLanguage is empty");
      expect(api.editor.getCursor(), "getCursor missing");
      expect(Array.isArray(api.editor.getSelections()), "getSelections result");
      expect(Array.isArray(api.editor.getVisibleRanges()), "getVisibleRanges result");
      return file;
    });
    await test("api.editor text edits", () => {
      api.editor.setText("alpha\nbeta\ngamma\n");
      expect(api.editor.getText().startsWith("alpha"), "setText failed");
      api.editor.insertText("!");
      expect(api.editor.getText().includes("!"), "insertText failed");
      api.editor.setSelection(0, 5);
      expect(api.editor.getSelection(), "getSelection failed");
      api.editor.replaceRange({ from: 0, to: 5 }, "ALPHA");
      expect(api.editor.getText().startsWith("ALPHA"), "replaceRange failed");
      api.editor.applyEdits([{ range: { from: 0, to: 0 }, text: "// header\n" }]);
      expect(api.editor.getText().startsWith("// header"), "applyEdits failed");
      api.editor.insertSnippet("const value = ${1:0};$0", { from: 0, to: 0 });
      expect(api.editor.getText().includes("const value = 0;"), "insertSnippet placeholder failed");
      api.editor.revealRange({ from: 0, to: 5 });
      return "text edit APIs work";
    });
    await test("api.editor applyWorkspaceEdit", async () => {
      await api.editor.applyWorkspaceEdit({ changes: { [file]: [{ range: { from: 0, to: 0 }, text: "// workspace\n" }] } });
      expect(api.editor.getText().startsWith("// workspace"), "applyWorkspaceEdit failed");
      return file;
    });
    await test("api.editor openAt/setLanguage/save", async () => {
      await api.editor.openAt(file, 1, 1);
      api.editor.setLanguage("markdown", file);
      await wait(80);
      expect(api.editor.getLanguage(file) === "markdown", "setLanguage failed");
      const saved = await api.editor.save(file);
      expect(saved, "save failed");
      await waitFor(() => events.saved, 2000, "document saved event");
      return "openAt, language, save work";
    });
    await test("api.editor decorations", () => {
      const type = api.editor.registerDecorationType({ className: "api-tester-decoration" });
      api.editor.setDecorations(type, [{ from: 0, to: 4 }]);
      api.editor.setDecorations(type, []);
      return type;
    });
    await test("api.editor openDiff", async () => {
      const absolute = await api.paths.resolve(api.workspace, file);
      const left = api.paths.toUri(absolute);
      const right = api.paths.toUri(absolute);
      const pending = api.editor.openDiff(left, right, "API Tester Diff");
      await wait(100);
      const overlay = document.querySelector(".arc-plugin-overlay");
      expect(overlay, "diff overlay did not open");
      await closeDiffOverlay();
      await pending;
      return "diff opened and closed";
    });
    await test("api.editor onWillSave", async () => {
      const stop = api.editor.onWillSave(({ content }) => `${content.trimEnd()}\n// will-save\n`);
      disposables.push(stop);
      await api.editor.save(file);
      const content = await api.files.read(file);
      expect(content.includes("// will-save"), "will-save handler not applied");
      stop();
      return "will-save applied";
    });
    await test("api.editor format/focus", async () => {
      api.editor.focus();
      await api.editor.format();
      return "format and focus completed";
    });
    await test("api.editor selection events", async () => {
      events.selection = null;
      events.changed = null;
      api.editor.insertText("!");
      api.editor.setSelection(0, 1);
      await waitFor(() => events.selection, 2000, "selection event");
      await waitFor(() => events.changed, 2000, "document changed event");
      return "selection/context events delivered";
    });
  }

  async function languageTests() {
    if (!api.workspace) {
      skip("api.languages.startServer", "No workspace is open.");
      return;
    }
    await writeScripts();
    const file = tempPath("sample.apitest");
    await api.files.write(file, "hello\nworld\n");
    await test("api.languages language registration and load", async () => {
      await api.editor.open(file);
      await waitFor(() => api.editor.getContext()?.path?.endsWith("sample.apitest"), 3000, "apitest open");
      const language = api.editor.getLanguage(file);
      expect(language && language.includes("apitest"), `language was ${language}`);
      return language;
    });
    await test("api.languages.startServer", async () => {
      const server = await api.languages.startServer({ command: "sh", args: [tempPath("lsp-server.sh")], cwd: api.workspace, language: "apitest" });
      const stop = server.onNotification(() => undefined);
      disposables.push(stop);
      expect(server && typeof server.request === "function", "LSP handle missing request()");
      await server.notify("textDocument/didOpen", { textDocument: { uri: api.paths.toUri(await api.paths.resolve(api.workspace, file)), languageId: "apitest", version: 1, text: "hello" } });
      await server.stop();
      return "initialized and stopped";
    });
    await test("language provider dispatch preparation", () => {
      return "providers were registered for language apitest and selector *";
    });
  }

  async function processTests() {
    if (!api.workspace) {
      skip("api.process / pty / ipc / net", "No workspace is open.");
      return;
    }
    await ensureTemp();
    await test("api.process which/exec/isRunning", async () => {
      const shell = await api.process.which("sh");
      expect(shell, "sh not found");
      const result = await api.process.exec("sh", ["-c", "printf out; printf err >&2; exit 3"]);
      expect(result.stdout === "out", "stdout mismatch");
      expect(result.stderr === "err", "stderr mismatch");
      expect(result.code === 3, "exit code mismatch");
      const running = await api.process.isRunning(["definitely-not-an-arc-test-process"]);
      expect(running === false, "isRunning false positive");
      return `${shell}, code=${result.code}`;
    });
    await test("api.process.spawn I/O and lifecycle", async () => {
      const proc = await api.process.spawn("sh", ["-c", "printf out; printf err >&2"]);
      let stdout = "";
      let stderr = "";
      let exited = false;
      let lastError = "";
      proc.onStdout((chunk) => { stdout += chunk; });
      proc.onStderr((chunk) => { stderr += chunk; });
      proc.onError((error) => { lastError = error; });
      proc.onExit(() => { exited = true; });
      await proc.closeStdin();
      await waitFor(() => exited, 2500, "process exit");
      expect(stdout === "out", `stdout=${stdout}`);
      expect(stderr === "err", `stderr=${stderr}`);
      expect(!lastError, `process error: ${lastError}`);
      await proc.stop();
      return "spawn, stdin close, streams, exit, stop work";
    });
    await test("api.pty.spawn", async () => {
      const pty = await api.pty.spawn("sh", ["-c", "printf pty-ok"]);
      let output = "";
      let exited = false;
      pty.onStdout((chunk) => { output += chunk; });
      pty.onExit(() => { exited = true; });
      await waitFor(() => exited || output.includes("pty-ok"), 3000, "pty output");
      expect(output.includes("pty-ok"), `pty output=${output}`);
      await pty.stop();
      return "pty spawn works";
    });
    await test("api.ipc.connectUnix error path", async () => {
      try {
        const socket = await api.ipc.connectUnix(tempPath("missing.sock"), { timeoutMs: 300 });
        await socket.close();
        throw new Error("connection unexpectedly succeeded");
      } catch (error) {
        if (/unexpectedly succeeded/.test(String(error))) throw error;
        return "rejected as expected";
      }
    });
    await test("api.ipc.connectPipe", async () => {
      try {
        const socket = await api.ipc.connectPipe("arc-api-tester-missing-pipe", { timeoutMs: 300 });
        await socket.close();
        throw new Error("connection unexpectedly succeeded");
      } catch (error) {
        if (/unexpectedly succeeded/.test(String(error))) throw error;
        return api.platform === "windows" ? "rejected as expected" : "Windows-only; rejected on this platform";
      }
    });
    await test("api.net listenHttp/fetch/download/connectTcp/connectEventSource", async () => {
      const server = await api.net.listenHttp(async (request) => {
        const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "x-arc-tester" };
        if (request.url.startsWith("/sse")) return { status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: "data: sse-ok\n\n" };
        return { status: 200, headers: { ...cors, "content-type": "text/plain", "x-arc-tester": "yes" }, body: `reply:${request.method}:${request.url}` };
      });
      try {
        const response = await api.net.fetch(`${server.url}/hello`, { timeoutMs: 3000 });
        expect(await response.text() === "reply:GET:/hello", "fetch body mismatch");
        expect(response.headers.get("x-arc-tester") === "yes", "fetch header mismatch");
        const downloaded = await api.net.download(`${server.url}/download`, tempPath("download.txt"));
        expect(downloaded.bytes > 0, "download bytes empty");
        expect((await api.files.read(tempPath("download.txt"))).startsWith("reply:GET:/download"), "download content mismatch");
        const address = /^http:\/\/([^:]+):(\d+)/.exec(server.url);
        expect(address, "could not parse server URL");
        const tcp = await api.net.connectTcp(address[1], Number(address[2]), { timeoutMs: 3000 });
        let socketData = "";
        tcp.onData((bytes) => { socketData += new TextDecoder().decode(bytes); });
        await tcp.write(new TextEncoder().encode("GET /tcp HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
        await waitFor(() => socketData.includes("reply:GET:/tcp"), 3000, "tcp data");
        await tcp.close();
        let sse = "";
        const source = api.net.connectEventSource(`${server.url}/sse`, { reconnect: false });
        source.onMessage((event) => { sse = event.data; });
        source.onError(() => undefined);
        await waitFor(() => sse === "sse-ok", 3000, "SSE event");
        source.close();
        expect(api.net.isOnline() === true || api.net.isOnline() === false, "isOnline result");
        const stopOnline = api.net.onOnlineChanged(() => undefined);
        disposables.push(stopOnline);
        return server.url;
      } finally {
        await server.close();
      }
    });
    skip("api.net.connectWebSocket", "Requires a reachable WebSocket server; no local test server is available.");
    await test("api.tasks registerProvider/run/onStarted/onFinished", async () => {
      let started = null;
      let finished = null;
      const stopStarted = api.tasks.onStarted((event) => { started = event; });
      const stopFinished = api.tasks.onFinished((event) => { finished = event; });
      disposables.push(stopStarted, stopFinished);
      const stopProvider = api.tasks.registerProvider("apitest", { provideTasks: async () => [{ label: "echo" }] });
      disposables.push(stopProvider);
      const run = await api.tasks.run({ executable: "sh", args: ["-c", "printf task-ok"] });
      await waitFor(() => finished, 3000, "task finished");
      expect(started, "task started event missing");
      expect(finished && finished.code === 0, "task exit code mismatch");
      await run.stop();
      return run.id;
    });
    await test("api.git read APIs", async () => {
      const repositories = await api.git.getRepositories();
      const status = await api.git.getStatus(repositories[0]).catch(() => null);
      const branch = await api.git.getBranch(repositories[0]).catch(() => null);
      const diff = await api.git.getDiff(repositories[0]).catch(() => "");
      const stop = api.git.onChanged(repositories[0] || "", () => undefined);
      disposables.push(stop);
      expect(Array.isArray(repositories), "repositories is not an array");
      expect(typeof diff === "string", "diff is not a string");
      return `${repositories.length} repo(s), branch=${branch ? branch.name : "<none>"}, status=${status ? "yes" : "no"}`;
    });
    await test("api.debug adapter lifecycle", async () => {
      let started = false;
      let stopped = false;
      const stopAdapter = api.debug.registerAdapter("apitest-debug", () => ({
        start: async () => { started = true; },
        stop: async () => { stopped = true; },
      }));
      disposables.push(stopAdapter);
      const sessions = [];
      const stopSession = api.debug.onSessionChanged((session) => sessions.push(session));
      disposables.push(stopSession);
      const session = await api.debug.start({ type: "apitest-debug", request: "launch" });
      expect(started, "adapter start not called");
      expect(api.debug.getActiveSession()?.id === session.id, "active session missing");
      await api.debug.stop(session.id);
      expect(stopped, "adapter stop not called");
      expect(sessions.length >= 1, "session change event missing");
      await session.stop();
      return session.id;
    });
    await test("api.auth provider/session", async () => {
      const stop = api.auth.registerProvider("apitest-auth", {
        getSessions: async () => null,
        createSession: async (scopes) => ({ token: "token", scopes }),
      });
      disposables.push(stop);
      const session = await api.auth.getSession("apitest-auth", ["read"], { createIfNone: true });
      expect(session && session.token === "token", "auth session missing");
      return session.scopes.join(",");
    });
    await test("api.links callback/uri handler", () => {
      const stop = api.links.registerUriHandler((uri) => console.log("[API Tester] uri", uri));
      disposables.push(stop);
      const callback = api.links.createCallbackUrl("oauth");
      expect(callback.includes("api-tester"), "callback URL missing plugin id");
      return callback;
    });
    const testController = api.tests.createController("unit", "API Tester Unit");
    await test("api.tests controller", async () => {
      let changed = null;
      const stop = api.events.on("tests:changed", (event) => { changed = event; });
      disposables.push(stop);
      testController.setItems([{ label: "sample", status: "passed" }]);
      testController.reportResult({ label: "sample", status: "passed" });
      await wait(20);
      expect(changed, "tests changed event missing");
      testController.dispose();
      return "controller reported items";
    });
  }

  async function mcpTests() {
    if (!api.workspace) {
      skip("api.mcp", "No workspace is open.");
      return;
    }
    await writeScripts();
    const script = tempPath("mcp-server.sh");
    let clientHandle = null;
    const stops = [];
    await test("api.mcp client lifecycle", async () => {
      const stopServerChanged = api.mcp.onServerChanged(() => undefined);
      const stopLog = api.mcp.onLog(() => undefined);
      const stopTools = api.mcp.onToolsChanged("client", () => undefined);
      const stopResources = api.mcp.onResourcesChanged("client", () => undefined);
      const stopPrompts = api.mcp.onPromptsChanged("client", () => undefined);
      const stopSampling = api.mcp.onSamplingRequest(() => null);
      const stopElicitation = api.mcp.onElicitationRequest(() => null);
      const stopAuthorization = api.mcp.onAuthorizationRequired(() => null);
      stops.push(stopServerChanged, stopLog, stopTools, stopResources, stopPrompts, stopSampling, stopElicitation, stopAuthorization);
      disposables.push(...stops);
      const stopRegister = api.mcp.registerServer("client", { type: "stdio", command: "sh", args: [script], cwd: api.workspace });
      disposables.push(stopRegister);
      expect(api.mcp.listServers().some((server) => server.id.endsWith("client")), "listServers missing client");
      expect(api.mcp.getServer("client"), "getServer missing client");
      clientHandle = await api.mcp.connect("client", { timeoutMs: 5000 });
      expect(clientHandle.capabilities, "connect did not negotiate capabilities");
      expect(api.mcp.getCapabilities("client"), "getCapabilities empty");
      expect(await api.mcp.ping("client", { timeoutMs: 3000 }), "ping failed");
      await api.mcp.setLogLevel("client", "info");
      const tools = await api.mcp.listTools("client");
      expect(tools && tools.tools && tools.tools.length > 0, "listTools empty");
      const toolResult = await api.mcp.callTool("client", "echo", { text: "hello" });
      expect(toolResult && toolResult.content, "callTool empty");
      const resources = await api.mcp.listResources("client");
      expect(resources && resources.resources, "listResources empty");
      const templates = await api.mcp.listResourceTemplates("client");
      expect(templates && templates.resourceTemplates, "listResourceTemplates empty");
      const resource = await api.mcp.readResource("client", "test://resource");
      expect(resource && resource.contents, "readResource empty");
      const prompts = await api.mcp.listPrompts("client");
      expect(prompts && prompts.prompts, "listPrompts empty");
      const prompt = await api.mcp.getPrompt("client", "test-prompt", {});
      expect(prompt && prompt.messages, "getPrompt empty");
      const completion = await api.mcp.complete("client", { type: "ref/prompt", name: "test-prompt" }, { name: "arg", value: "a" });
      expect(completion && completion.completion, "complete empty");
      await api.mcp.setRoots("client", [{ uri: api.paths.toUri(api.workspace), name: "workspace" }]);
      const stopSubscribe = api.mcp.subscribeResource("client", "test://resource", () => undefined);
      disposables.push(stopSubscribe);
      await api.mcp.disconnect("client");
      clientHandle = await api.mcp.restart("client");
      await api.mcp.disconnect("client");
      api.mcp.unregisterServer("client");
      return "stdio client lifecycle works";
    });
    await test("api.mcp exposure server", async () => {
      let exposureEvents = 0;
      const stopExposure = api.mcp.onExposureChanged(() => { exposureEvents += 1; });
      disposables.push(stopExposure);
      const stopTool = api.mcp.exposeTool({
        name: "echo",
        description: "Echo input",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      }, async (args) => `echo: ${args.text}`);
      const stopResource = api.mcp.exposeResource({ uri: "test://arc-resource", name: "Arc Resource", mimeType: "text/plain" }, async () => "resource body");
      const stopTemplate = api.mcp.exposeResourceTemplate({ uriTemplate: "test://arc-item/{id}", name: "Arc Item" }, async (uri, variables) => `item:${variables.id}`);
      const stopPrompt = api.mcp.exposePrompt({ name: "arc-prompt", description: "Arc prompt" }, async () => "prompt body");
      disposables.push(stopTool, stopResource, stopTemplate, stopPrompt);
      const exposure = await waitFor(() => {
        const value = api.mcp.getExposure();
        return value && value.serverUrl ? value : null;
      }, 5000, "MCP exposure server URL");
      expect(exposure.authorization, "MCP authorization missing");
      const post = async (message) => {
        const response = await api.net.fetch(exposure.serverUrl, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: exposure.authorization },
          body: JSON.stringify(message),
        });
        return JSON.parse(await response.text());
      };
      const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
      expect(initialized.result && initialized.result.capabilities, "exposure initialize failed");
      const tools = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      expect(tools.result.tools.some((tool) => tool.name.endsWith(":echo")), "exposed tool missing");
      const call = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "api-tester:echo", arguments: { text: "hello" } } });
      expect(call.result.content[0].text === "echo: hello", "exposed tool call failed");
      const resources = await post({ jsonrpc: "2.0", id: 4, method: "resources/list", params: {} });
      expect(resources.result.resources.length > 0, "exposed resource missing");
      const templates = await post({ jsonrpc: "2.0", id: 5, method: "resources/templates/list", params: {} });
      expect(templates.result.resourceTemplates.length > 0, "exposed template missing");
      const read = await post({ jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "test://arc-resource" } });
      expect(read.result.contents[0].text === "resource body", "exposed resource read failed");
      const prompts = await post({ jsonrpc: "2.0", id: 7, method: "prompts/list", params: {} });
      expect(prompts.result.prompts.some((prompt) => prompt.name.endsWith(":arc-prompt")), "exposed prompt missing");
      const prompt = await post({ jsonrpc: "2.0", id: 8, method: "prompts/get", params: { name: "api-tester:arc-prompt", arguments: {} } });
      expect(prompt.result.messages[0].content.text === "prompt body", "exposed prompt get failed");
      const ping = await post({ jsonrpc: "2.0", id: 9, method: "ping", params: {} });
      expect(ping.result !== undefined, "exposure ping failed");
      api.mcp.notifyResourceChanged("test://arc-resource");
      await wait(20);
      expect(exposureEvents >= 1, "exposure changed event missing");
      stopTool(); stopResource(); stopTemplate(); stopPrompt(); stopExposure();
      return exposure.serverUrl;
    });
  }

  async function dataTests() {
    await test("api.configuration.scope workspace update", async () => {
      api.configuration.update("workspaceScoped", "value", "workspace");
      await wait(10);
      expect(api.configuration.get("workspaceScoped") === "value", "workspace-scoped configuration failed");
      return "workspace scope";
    });
    await test("api.storage.secret isolation", async () => {
      api.storage.set("visible", 1);
      api.storage.clear();
      const key = `secret-${Date.now()}`;
      await api.secrets.set(key, "kept");
      expect(await api.secrets.get(key) === "kept", "storage.clear removed secret");
      await api.secrets.delete(key);
      return "secrets survive storage.clear";
    });
  }

  async function uiTests() {
    await test("api.ui action/status update", () => {
      api.ui.updateAction("open", { label: "API Tester (updated)" });
      api.ui.updateAction("open", { label: "API Tester" });
      api.ui.updateStatusItem("status", { text: "API Tester: testing" });
      updateStatus();
      return "action and status updates accepted";
    });
    await test("api.ui menu/tree/view registrations", () => {
      const stopMenu = api.ui.registerMenuItem("editor/context", { id: "api-tester-menu", label: "API Tester Menu", onClick: () => undefined });
      const stopSidebar = api.ui.registerSidebarView({ id: "api-tester-side", title: "API Tester Side", mount(container) { container.textContent = "sidebar"; } });
      const stopBottom = api.ui.registerBottomView({ id: "api-tester-bottom", title: "API Tester Bottom", mount(container) { container.textContent = "bottom"; } });
      const stopTab = api.ui.registerCustomTab({ id: "api-tester-tab", title: "API Tester Tab", mount(container) { container.textContent = "tab"; } });
      const stopTree = api.ui.registerTreeView({ id: "api-tester-tree", title: "API Tester Tree", getChildren: async (element) => element ? [] : [{ label: "node", children: true, element: "node", icon: "•" }], onSelect: () => undefined });
      api.ui.setViewBadge("api-tester-side", 3);
      api.ui.setViewBadge("api-tester-side", null);
      api.ui.focusView("api-tester-side");
      api.ui.closeView("api-tester-side");
      [stopMenu, stopSidebar, stopBottom, stopTab, stopTree].forEach((stop) => stop());
      return "menu, sidebar, bottom, tab, tree, badge, focus, close work";
    });
    await test("api.ui addStyles", () => {
      const stop = api.ui.addStyles(".api-tester-highlight{outline:1px solid orange}");
      expect(typeof stop === "function", "addStyles did not return a disposer");
      stop();
      return "style injected and removed";
    });
    await test("api.ui setContext", () => {
      api.ui.setContext("apiTester.ui", "ready");
      api.ui.setContext("apiTester.enabled", true);
      return "context values set";
    });
    await test("api.registerAction/updateAction", () => {
      api.ui.updateAction("open", { label: "API Tester", enabled: true });
      return "toolbar action updated";
    });
    await test("api.registerContextMenuItem", () => {
      return "context menu item registered during activation";
    });
  }

  async function manualUiTests() {
    await test("api.ui.showQuickPick", async () => {
      const picked = await api.ui.showQuickPick([{ label: "Pick me", value: "picked" }, { label: "Other", value: "other" }], { placeHolder: "API Tester quick pick" });
      expect(picked === "picked" || picked === "other" || picked === null, "quick pick result invalid");
      return String(picked);
    });
    await test("api.ui.showInputBox", async () => {
      const value = await api.ui.showInputBox({ prompt: "API Tester input", value: "default", placeHolder: "type here", validate: (input) => input ? null : "Required" });
      return String(value);
    });
    await test("api.ui.confirm", () => {
      const value = api.ui.confirm("API Tester: confirm dialog works?");
      return String(value);
    });
    await test("api.ui.prompt", () => {
      const value = api.ui.prompt("API Tester prompt", "default");
      return String(value);
    });
    await test("api.dialogs.openFile", async () => {
      const value = await api.dialogs.openFile({ multiple: false });
      return String(value);
    });
    await test("api.dialogs.openFolder", async () => {
      const value = await api.dialogs.openFolder();
      return String(value);
    });
    await test("api.dialogs.saveFile", async () => {
      const value = await api.dialogs.saveFile({ defaultPath: "api-tester.txt" });
      return String(value);
    });
    await test("api.openUrl", async () => {
      await api.openUrl("https://example.com");
      return "opened external URL";
    });
    await test("api.app.openSettings", () => { api.app.openSettings(); return "opened settings"; });
    await test("api.app.openGithub", () => { api.app.openGithub(); return "opened GitHub"; });
    await test("api.app.openPlugins", () => { api.app.openPlugins(); return "opened plugins"; });
    await test("api.app.openWorkspace", async () => { await api.app.openWorkspace(); return "workspace dialog opened"; });
  }

  async function windowTests() {
    await test("api.window.minimize/toggleMaximize", async () => {
      await api.window.minimize();
      await api.window.toggleMaximize();
      await api.window.toggleMaximize();
      return "minimize and maximize toggled";
    });
    await test("api.window.setSize/center", async () => {
      await api.window.setSize(1000, 700);
      await api.window.center();
      return "resized and centered";
    });
    await test("api.window.setFullscreen", async () => {
      await api.window.setFullscreen(true);
      await wait(300);
      await api.window.setFullscreen(false);
      return "fullscreen toggled";
    });
    await test("api.window.setAlwaysOnTop", async () => {
      await api.window.setAlwaysOnTop(true);
      await api.window.setAlwaysOnTop(false);
      return "always-on-top toggled";
    });
    skip("api.window.close", "Would exit Arc; run it manually when ready.");
  }

  async function cleanupTests() {
    if (!api.workspace) {
      skip("cleanup", "No workspace is open.");
      return;
    }
    try {
      if (await api.files.exists(tempRoot)) await api.files.trash(tempRoot);
      record("PASS", "cleanup", tempRoot);
    } catch (error) {
      record("FAIL", "cleanup", error && error.message ? error.message : String(error));
    }
  }

  api.ui.addStyles(`
    .api-tester{display:flex;flex-direction:column;gap:10px;height:100%;min-height:0;color:var(--text);font:11px/1.5 'JetBrains Mono',monospace}
    .api-tester h3{margin:0;font-size:12px}
    .api-tester .summary{color:var(--muted)}
    .api-tester .actions{display:flex;flex-wrap:wrap;gap:5px}
    .api-tester button{height:26px;padding:0 8px;border:1px solid var(--line);border-radius:3px;background:var(--panel);color:var(--text);font:inherit;font-size:10px;cursor:pointer}
    .api-tester button:hover{background:var(--selected)}
    .api-tester button.danger{border-color:#e06c75;color:#e06c75}
    .api-tester pre{min-height:0;flex:1;overflow:auto;margin:0;padding:10px;border:1px solid var(--line);border-radius:4px;background:var(--bg);white-space:pre-wrap;overflow-wrap:anywhere}
  `);

  api.ui.registerPanel({
    id: "dashboard",
    title: "API Tester",
    mount(container) {
      const root = document.createElement("div");
      root.className = "api-tester";
      const heading = document.createElement("h3");
      heading.textContent = "Arc Plugin API Tester";
      const summary = document.createElement("div");
      summary.className = "summary";
      summary.textContent = "Runs API checks and logs PASS / FAIL / SKIP. Open a workspace before file, editor, process, network, or MCP tests.";
      const actions = document.createElement("div");
      actions.className = "actions";
      const add = (label, fn, danger) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        if (danger) button.className = "danger";
        button.addEventListener("click", () => void fn());
        actions.append(button);
      };
      add("Smoke", () => runGroup("smoke", smokeTests));
      add("Files", () => runGroup("files", fileTests));
      add("Editor", () => runGroup("editor", editorTests));
      add("Language", () => runGroup("language", languageTests));
      add("Process / Network", () => runGroup("process and network", processTests));
      add("MCP", () => runGroup("MCP", mcpTests));
      add("Data / Storage", () => runGroup("data and storage", dataTests));
      add("UI", () => runGroup("UI", uiTests));
      add("Manual UI", () => runGroup("manual UI", manualUiTests));
      add("Window actions", () => runGroup("window actions", windowTests), true);
      add("Run all safe", () => runGroup("all safe", async () => {
        await smokeTests();
        await fileTests();
        await editorTests();
        await languageTests();
        await processTests();
        await mcpTests();
        await dataTests();
        await uiTests();
      }));
      add("Cleanup", () => runGroup("cleanup", cleanupTests), true);
      const log = document.createElement("pre");
      const updateSummary = () => {
        const next = `${state.pass} pass / ${state.fail} fail / ${state.skip} skip${state.running ? " — running…" : ""}`;
        if (summary.textContent !== next) summary.textContent = next;
      };
      const observer = new MutationObserver(updateSummary);
      root.append(heading, summary, actions, log);
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      container.replaceChildren(root);
      state.panelLog = log;
      state.panelRoot = root;
      renderLog();
      updateSummary();
      return () => {
        observer.disconnect();
        state.panelLog = null;
        state.panelRoot = null;
        container.replaceChildren();
      };
    },
  });

  api.registerAction({
    id: "open",
    label: "API Tester",
    title: "Open the Plugin API test dashboard",
    onClick: () => api.app.openPanel("dashboard"),
  });

  api.registerContextMenuItem({
    id: "run-smoke",
    label: "Run Plugin API Smoke Tests",
    onClick: () => runGroup("smoke", smokeTests),
  });

  api.ui.registerStatusItem({ id: "status", text: "API Tester: idle", position: "right", onClick: () => api.app.openPanel("dashboard") });
  api.ui.registerCommand({ id: "run-smoke", title: "API Tester: Run Smoke Tests", run: () => runGroup("smoke", smokeTests) });
  api.ui.registerCommand({ id: "run-all", title: "API Tester: Run All Safe Tests", run: () => runGroup("all safe", async () => {
    await smokeTests();
    await fileTests();
    await editorTests();
    await languageTests();
    await processTests();
    await mcpTests();
    await dataTests();
    await uiTests();
  }) });
  api.ui.registerCommand({ id: "run-mcp", title: "API Tester: Run MCP Tests", run: () => runGroup("MCP", mcpTests) });
  api.ui.registerCommand({ id: "run-window", title: "API Tester: Run Window Actions", run: () => runGroup("window actions", windowTests) });
  api.ui.registerCommand({ id: "run-manual", title: "API Tester: Run Manual UI Tests", run: () => runGroup("manual UI", manualUiTests) });
  api.ui.registerCommand({ id: "cleanup", title: "API Tester: Clean Test Files", run: () => runGroup("cleanup", cleanupTests) });
  api.ui.registerCommand({ id: "ping", title: "API Tester: Ping", run: () => api.ui.notify("API Tester ping") });

  api.ui.setContext("apiTester.enabled", false);

  api.configuration.register({
    id: "settings",
    title: "API Tester",
    properties: {
      autoRunSmoke: { type: "boolean", default: true, description: "Run smoke tests when the plugin activates." },
      workspaceScoped: { type: "string", default: "", description: "Workspace-scoped test value.", scope: "workspace" },
    },
  });

  api.icons.register("tester", "<svg viewBox='0 0 16 16'><path d='M3 2h10v12H3z' fill='none' stroke='currentColor'/><path d='M5 6h6M5 9h6M5 12h4' stroke='currentColor'/></svg>");

  api.services.register("api-tester:service", state.serviceValue);

  const disposeLanguage = api.languages.register({
    id: "apitest",
    name: "API Test Language",
    extensions: ["apitest"],
    filenames: ["apitest.conf"],
    load: () => {},
  });
  disposables.push(disposeLanguage);

  const providerDisposers = [
    api.languages.registerCompletionProvider({ language: "apitest" }, {
      provideCompletionItems: () => [{ label: "apiTest", type: "keyword" }],
    }),
    api.languages.registerHoverProvider({ language: "apitest" }, {
      provideHover: () => ({ text: "API Test hover content" }),
    }),
    api.languages.registerDefinitionProvider({ language: "apitest" }, {
      provideLocations: ({ path, offset }) => [{ path, from: offset, to: offset + 3, name: "definition" }],
    }),
    api.languages.registerReferenceProvider({ language: "apitest" }, {
      provideLocations: ({ path, word }) => [{ path, from: 0, to: word.length, name: "reference" }],
    }),
    api.languages.registerRenameProvider({ language: "apitest" }, {
      provideRename: ({ path, offset, newName }) => ({ changes: { [path]: [{ from: offset, to: offset + 3, text: newName }] } }),
    }),
    api.languages.registerFormattingProvider({ language: "apitest" }, {
      provideFormatting: ({ text }) => text.endsWith("\n") ? text : `${text}\n`,
    }),
    api.languages.registerCodeActionProvider({ language: "apitest" }, {
      provideRanges: () => [{ title: "API Test action", edit: { changes: {} } }],
    }),
    api.languages.registerCodeLensProvider({ language: "apitest" }, {
      provideRanges: () => [{ from: 0, label: "API Test lens", command: { id: "api-tester:ping" } }],
    }),
    api.languages.registerInlayHintsProvider({ language: "apitest" }, {
      provideRanges: () => [{ from: 0, label: ": api-test" }],
    }),
    api.languages.registerSignatureHelpProvider({ language: "apitest" }, {
      provideRanges: () => [{ label: "apiTest(value)" }],
    }),
    api.languages.registerDocumentSymbolProvider({ language: "apitest" }, {
      provideRanges: () => [{ name: "apiTestSymbol", from: 0, to: 8 }],
    }),
    api.languages.registerWorkspaceSymbolProvider({
      provideLocations: () => [{ path: tempPath("sample.apitest"), from: 0, to: 8, name: "apiTestWorkspaceSymbol" }],
    }),
    api.languages.registerSemanticTokensProvider({ language: "apitest" }, {
      provideRanges: () => [{ from: 0, to: 5, type: "keyword" }],
    }),
    api.languages.registerFoldingProvider({ language: "apitest" }, {
      provideFoldingRange: ({ line }) => ({ from: line, to: line + 2 }),
    }),
    api.languages.registerSelectionRangeProvider({ language: "apitest" }, {
      provideRanges: () => [{ from: 0, to: 20 }],
    }),
    api.languages.registerGrammar("apitest", {
      load: () => {},
      configuration: { comments: { lineComment: "#" }, brackets: [["(", ")"], ["[", "]"]], autoClosingPairs: [{ open: "(", close: ")" }, { open: "[", close: "]" }] },
      language: { tokenizer: { root: [[/#.*/, "comment"], [/[a-zA-Z_]\w*/, "keyword"]] } },
    }),
  ];
  disposables.push(...providerDisposers);

  const disposeContent = api.editor.registerContentProvider("apitest-content", { read: async () => "virtual content" });
  const disposeCustom = api.editor.registerCustomEditor("**/*.apitest-view", { mount(container) { container.textContent = "API Tester custom editor"; } });
  disposables.push(disposeContent, disposeCustom);

  const disposeDiagnostics = api.diagnostics.createCollection("api-tester");
  disposables.push(() => disposeDiagnostics.dispose());

  api.keybindings.register("run-smoke", "Ctrl+Alt+Shift+A", "apiTester.enabled");
  api.ui.setContext("apiTester.enabled", true);

  for (const dispose of disposables) addCleanup(dispose);

  if (api.configuration.get("autoRunSmoke", true)) {
    api.timers.setTimeout(() => { void runGroup("smoke", smokeTests); }, 900);
  }

  return () => {
    for (const cleanup of cleanups.reverse()) {
      try { cleanup(); } catch (error) { console.error("[API Tester] cleanup failed", error); }
    }
  };
}
