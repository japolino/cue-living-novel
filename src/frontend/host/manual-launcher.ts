export interface VnLauncherCopy {
  label: string;
  title: string;
}

export function visualNovelLauncherCopy(active: boolean): VnLauncherCopy {
  return {
    label: active ? "Exit Cue" : "Cue",
    title: active ? "Exit Cue" : "Open this chat in Cue",
  };
}

export interface VnHeaderLauncher {
  setActive(active: boolean): void;
  destroy(): void;
}

const LAUNCHER_CSS = `
:host {
  display: inline-flex;
  align-items: center;
  font: 14px/1 system-ui, sans-serif;
}

button {
  display: inline-flex;
  min-height: 2.25rem;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.22));
  border-radius: 999px;
  background: var(--lumiverse-fill-medium, rgba(255, 255, 255, 0.08));
  color: var(--lumiverse-text, #f5f5f7);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

button:hover {
  border-color: var(--lumiverse-primary, #a986ff);
  background: var(--lumiverse-fill-strong, rgba(255, 255, 255, 0.14));
}

button:focus-visible {
  outline: 3px solid var(--lumiverse-primary, #a986ff);
  outline-offset: 2px;
}

[data-vn-launcher-mark] {
  display: grid;
  width: 1.6rem;
  height: 1.6rem;
  place-items: center;
  border-radius: 0.4rem;
  background: var(--lumiverse-primary, #a986ff);
  color: var(--lumiverse-primary-contrast, #15101d);
}

@media (max-width: 560px) {
  button {
    min-width: 2.5rem;
    min-height: 2.5rem;
    justify-content: center;
    padding: 0.4rem;
  }

  [data-vn-launcher-label] {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
}
`;

export function createVnHeaderLauncher(
  mount: Element,
  onToggle: () => void,
): VnHeaderLauncher {
  const host = document.createElement("span");
  host.setAttribute("data-vn-header-launcher", "");
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = LAUNCHER_CSS;

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("data-vn-launcher", "");

  const mark = document.createElement("span");
  mark.setAttribute("data-vn-launcher-mark", "");
  mark.setAttribute("aria-hidden", "true");
  // An open book, as on the stage's empty card: the button's name is Cue.
  mark.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4.2C6.6 3.2 4.6 2.8 2.5 3v9.4c2.1-.2 4.1.2 5.5 1.2 1.4-1 3.4-1.4 5.5-1.2V3c-2.1-.2-4.1.2-5.5 1.2z" /><path d="M8 4.2v9.4" /></svg>';
  const label = document.createElement("span");
  label.setAttribute("data-vn-launcher-label", "");
  button.append(mark, label);
  root.append(style, button);
  mount.append(host);

  const setActive = (active: boolean): void => {
    const copy = visualNovelLauncherCopy(active);
    label.textContent = copy.label;
    button.title = copy.title;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(active));
  };

  button.addEventListener("click", onToggle);
  setActive(false);

  return {
    setActive,
    destroy() {
      button.removeEventListener("click", onToggle);
      host.remove();
    },
  };
}
