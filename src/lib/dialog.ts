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
    overlay.style.zIndex = "500";
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

export function showArcPrompt(options: {
  title: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "arc-plugin-overlay";
    overlay.style.zIndex = "500";
    const panel = document.createElement("div");
    panel.className = "arc-plugin-modal arc-dialog";
    const title = document.createElement("div");
    title.className = "arc-dialog-title";
    title.textContent = options.title;
    const input = document.createElement("input");
    input.className = "arc-dialog-input";
    input.type = "text";
    input.value = options.value ?? "";
    input.placeholder = options.placeholder ?? "";
    const actions = document.createElement("div");
    actions.className = "arc-dialog-actions";
    const close = (value: string | null) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(value);
    };
    const submit = () => {
      const value = input.value.trim();
      if (value) close(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(null);
      if (event.key === "Enter") submit();
    };
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "action-button action-button--secondary";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => close(null));
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "action-button";
    confirm.textContent = options.confirmLabel ?? "Save";
    confirm.addEventListener("click", submit);
    document.addEventListener("keydown", onKey);
    actions.append(cancel, confirm);
    panel.append(title, input, actions);
    overlay.append(panel);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    document.body.append(overlay);
    input.focus();
    input.select();
  });
}
