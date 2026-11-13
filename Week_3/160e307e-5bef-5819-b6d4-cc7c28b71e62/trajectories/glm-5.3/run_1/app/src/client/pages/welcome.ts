import { api, jsonFetch, mountOutageBanner, focusHeading, loadingEl, el, avatarSvg, pageStatus, type Me } from "../lib/app.js";
import { Modal } from "../lib/modal.js";

interface NameError {
  error: string;
  suggestions?: string[];
}

async function main(): Promise<void> {
  mountOutageBanner();
  const root = document.getElementById("root");
  if (root === null) return;
  root.appendChild(loadingEl());
  let me: Me;
  try {
    me = await api.me();
  } catch {
    root.textContent = "";
    root.appendChild(el("h1", {}, "Due Coin"));
    return;
  }
  api.invalidate();
  if (me.chosen) {
    window.location.replace("/");
    return;
  }
  root.textContent = "";
  render(root, me);
}

function render(root: HTMLElement, me: Me): void {
  const h1 = el("h1", { class: "display", style: "font-size:44px" }, "Pick a name");
  const form = el("div", { class: "form" });

  const nameLabel = el("label", { for: "name-input" }, "Name");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "name-input";
  nameInput.name = "name";
  nameInput.setAttribute("aria-label", "Name");
  nameInput.maxLength = 16;
  nameInput.autofocus = true;

  const errorAlert = el("div", { class: "error-alert", id: "name-error", role: "alert" });
  errorAlert.style.display = "none";

  const avatarLegend = el("span", { class: "avatar-legend" }, "Avatar");
  const grid = el("div", { class: "avatar-grid", role: "radiogroup", "aria-label": "Avatar" });
  const cells: HTMLInputElement[] = [];
  for (let n = 1; n <= 24; n++) {
    const cell = el("div", { class: "avatar-cell" });
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "avatar";
    input.id = `avatar-${n}`;
    input.value = String(n);
    input.setAttribute("aria-label", `Avatar ${n}`);
    if (n === 1) input.checked = true;
    const face = el("span", { class: "avatar-face" });
    face.appendChild(avatarSvg(n));
    input.addEventListener("change", () => {
      cells.forEach((c) => c.parentElement?.querySelector(".avatar-face")?.classList.remove("checked"));
      face.classList.add("checked");
    });
    cell.append(input, face);
    cells.push(input);
    grid.appendChild(cell);
  }

  const continueButton = el("button", { class: "btn btn-primary", type: "button" }, "Continue");
  const skipButton = el("button", { class: "btn", type: "button" }, "Skip");

  form.append(h1, nameLabel, nameInput, errorAlert, avatarLegend, grid, continueButton, skipButton);
  root.appendChild(form);

  const showError = (message: string, suggestions?: string[]) => {
    errorAlert.textContent = "";
    errorAlert.style.display = "flex";
    const text = el("span", {}, message);
    errorAlert.appendChild(text);
    if (suggestions !== undefined) {
      for (const suggestion of suggestions) {
        const button = el("button", { class: "btn suggestion", type: "button" }, suggestion);
        button.addEventListener("click", () => {
          nameInput.value = suggestion;
          nameInput.focus();
          errorAlert.style.display = "none";
        });
        errorAlert.appendChild(button);
      }
    }
    nameInput.setAttribute("aria-invalid", "true");
    nameInput.setAttribute("aria-describedby", "name-error");
  };

  const clearError = () => {
    errorAlert.style.display = "none";
    nameInput.removeAttribute("aria-invalid");
    nameInput.removeAttribute("aria-describedby");
  };

  const submit = async () => {
    const avatar = cells.find((c) => c.checked)?.value;
    continueButton.disabled = true;
    try {
      const { status, body } = await jsonFetch<NameError>("/api/me/name", {
        method: "POST",
        body: JSON.stringify({ name: nameInput.value, avatar: Number(avatar) }),
      });
      if (status === 200) {
        window.location.replace("/");
        return;
      }
      if (body.error === "NAME_TAKEN") {
        showError("That name is taken. Try one of these:", body.suggestions);
      } else if (body.error === "NAME_BLOCKED") {
        showError("That name isn't allowed. Try one of these:", body.suggestions);
      } else if (body.error === "NAME_INVALID") {
        showError("Use 3 to 16 letters, numbers or underscores.");
      } else if (body.error === "DATABASE_UNAVAILABLE") {
        pageStatus("Online play is unavailable right now. Pass and play still works.");
      } else {
        showError("Use 3 to 16 letters, numbers or underscores.");
      }
    } catch {
      pageStatus("Online play is unavailable right now. Pass and play still works.");
    }
    continueButton.disabled = false;
  };

  continueButton.addEventListener("click", () => void submit());
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  });
  nameInput.addEventListener("input", clearError);

  skipButton.addEventListener("click", async () => {
    skipButton.disabled = true;
    try {
      const { status } = await jsonFetch("/api/me/skip", { method: "POST" });
      if (status === 200) {
        window.location.replace("/");
        return;
      }
    } catch {
      // server unreachable
    }
    skipButton.disabled = false;
  });

  // Keyboard-only avatar selection inside the group.
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") {
      return;
    }
    e.preventDefault();
    const index = cells.findIndex((c) => c.checked);
    const columns = window.innerWidth < 768 ? 4 : window.innerWidth < 1280 ? 6 : 8;
    let next = index;
    if (e.key === "ArrowRight") next = Math.min(23, index + 1);
    if (e.key === "ArrowLeft") next = Math.max(0, index - 1);
    if (e.key === "ArrowDown") next = Math.min(23, index + columns);
    if (e.key === "ArrowUp") next = Math.max(0, index - columns);
    if (next !== index && cells[next] !== undefined) {
      cells[index].checked = false;
      cells[next].checked = true;
      cells[next].dispatchEvent(new Event("change"));
      cells[next].focus();
    }
  });

  // Database outage keeps the welcome reachable but explains itself.
  void Modal;
}

void main();
