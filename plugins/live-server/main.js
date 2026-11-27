export function activate(api) {
  let running = false;

  const start = async (workspace, target) => {
    if (!workspace) {
      api.notify("Open a folder first.");
      return;
    }
    const root = target?.kind === "directory" ? `${workspace}/${target.path}` : workspace;
    const entry = target?.kind === "file" ? target.path : "";
    const server = await api.localServer.start(root, entry);
    running = true;
    await api.openUrl(server.url);
    api.notify(`Local server running at ${server.url}`);
  };

  api.registerAction({
    id: "toggle",
    label: "Live Server",
    title: "Start or stop Live Server",
    icon: "globe",
    onClick: async () => {
      if (running) {
        await api.localServer.stop();
        running = false;
        api.notify("Local server stopped.");
      } else {
        await start(api.workspace);
      }
    },
  });

  api.registerContextMenuItem({
    id: "open-in-server",
    label: "Open with Live Server",
    onClick: ({ workspace, target }) => start(workspace, target),
  });

  api.registerContextMenuItem({
    id: "open-in-preview",
    label: "Open in Web Preview",
    onClick: async ({ workspace, target }) => {
      if (!workspace) {
        api.notify("Open a folder first.");
        return;
      }
      const root =
        target?.kind === "directory" ? `${workspace}/${target.path}` : workspace;
      const entry = target?.kind === "file" ? target.path : "";
      const server = await api.localServer.start(root, entry);
      running = true;
      api.openPreview(server.url);
      api.notify(`Previewing ${server.url}`);
    },
  });

  return () => {
    if (running) void api.localServer.stop();
  };
}
