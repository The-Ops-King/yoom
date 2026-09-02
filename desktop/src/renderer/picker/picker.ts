import type { PickerPayload, SourceInfo } from "../../shared/ipc";

const api = window.__yoomPicker;

const grid = document.getElementById("grid") as HTMLUListElement;
const tabScreen = document.getElementById("tab-screen") as HTMLButtonElement;
const tabWindow = document.getElementById("tab-window") as HTMLButtonElement;
const cancelButton = document.getElementById("cancel") as HTMLButtonElement;
const audioNote = document.getElementById("audio-note") as HTMLParagraphElement;

let all: SourceInfo[] = [];
let tab: "screen" | "window" = "screen";
let selected = 0;

function visible(): SourceInfo[] {
  return all.filter((s) => s.kind === tab);
}

function render(): void {
  const items = visible();
  tabScreen.setAttribute("aria-selected", String(tab === "screen"));
  tabWindow.setAttribute("aria-selected", String(tab === "window"));
  grid.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = tab === "screen" ? "No screens found" : "No windows found";
    grid.append(empty);
    return;
  }

  selected = Math.min(selected, items.length - 1);

  items.forEach((source, index) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(index === selected));

    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.src = source.thumb;
    thumb.alt = "";
    li.append(thumb);

    const label = document.createElement("div");
    label.className = "label";
    if (source.icon) {
      const icon = document.createElement("img");
      icon.src = source.icon;
      icon.alt = "";
      label.append(icon);
    }
    const name = document.createElement("span");
    name.textContent = source.name;
    label.append(name);
    li.append(label);

    li.addEventListener("click", () => {
      selected = index;
      choose();
    });
    li.addEventListener("mouseenter", () => {
      selected = index;
      render();
    });

    grid.append(li);
  });

  grid.children[selected]?.scrollIntoView({ block: "nearest" });
}

function choose(): void {
  const source = visible()[selected];
  if (source) api?.choose(source.id);
}

tabScreen.addEventListener("click", () => {
  tab = "screen";
  selected = 0;
  render();
});
tabWindow.addEventListener("click", () => {
  tab = "window";
  selected = 0;
  render();
});
cancelButton.addEventListener("click", () => api?.cancel());

window.addEventListener("keydown", (event) => {
  const items = visible();
  if (event.key === "Escape") {
    event.preventDefault();
    api?.cancel();
  } else if (event.key === "Enter") {
    event.preventDefault();
    choose();
  } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    selected = Math.min(items.length - 1, selected + (event.key === "ArrowDown" ? 2 : 1));
    render();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    selected = Math.max(0, selected - (event.key === "ArrowUp" ? 2 : 1));
    render();
  } else if (event.key === "Tab") {
    event.preventDefault();
    tab = tab === "screen" ? "window" : "screen";
    selected = 0;
    render();
  }
});

api?.onSources((payload: PickerPayload) => {
  all = payload.sources;
  tab = payload.tab;
  selected = 0;
  audioNote.hidden = !payload.audioRequested;
  render();
});
