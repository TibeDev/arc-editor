type DialogButton = {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
};

export function showArcDialog(options: {
  title: string;
  message: string;
  buttons: DialogButton[];
}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "arc-plugin-overlay";
    const panel = document.createElement("div");
    panel.className = "arc-plugin-modal arc-dialog";
    const title = document.createElement("div");
    title.className = "arc-dialog-title";
    title.textContent = options.title;
    const message = document.createElement("div");
    message.className = "arc-dialog-message";
    message.textContent = options.message;
    const actions = document.createElement("div");
    actions.className = "arc-dialog-actions";
    const close = (value: string | null) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(null);
    };
    for (const button of options.buttons) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `action-button${button.primary ? "" : " action-button--secondary"}${button.danger ? " arc-dialog-danger" : ""}`;
      element.textContent = button.label;
      element.addEventListener("click", () => close(button.value));
      actions.append(element);
    }
    document.addEventListener("keydown", onKey);
    panel.append(title, message, actions);
    overlay.append(panel);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    document.body.append(overlay);
    actions.querySelector("button")?.focus();
  });
}
