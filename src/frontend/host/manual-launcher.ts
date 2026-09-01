export interface VnLauncherCopy {
  label: string;
  title: string;
}

export function visualNovelLauncherCopy(active: boolean): VnLauncherCopy {
  return {
    label: active ? "Exit VN" : "Visual novel",
    title: active ? "Exit visual novel mode" : "Open visual novel mode",
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
  font-size: 0.68rem;
  font-weight: 850;
  letter-spacing: -0.03em;
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
  mark.textContent = "VN";
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
