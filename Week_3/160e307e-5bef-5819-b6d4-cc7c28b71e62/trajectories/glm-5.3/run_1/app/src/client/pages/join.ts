import { api, jsonFetch, mountOutageBanner, loadingEl, el, pageStatus, type Me } from "../lib/app.js";

async function main(): Promise<void> {
  mountOutageBanner();
  const root = document.getElementById("root");
  if (root === null) return;
  root.appendChild(loadingEl());
  let me: Me | null = null;
  try {
    me = await api.me();
  } catch {
    me = null;
  }
  api.invalidate();
  root.textContent = "";

  const codeMatch = /^\/join\/([A-Za-z0-9]+)$/.exec(window.location.pathname);
  if (codeMatch !== null) {
    renderJoinByLink(root, me, codeMatch[1].toUpperCase());
    return;
  }
  renderJoinByCode(root);
}

function renderJoinByLink(root: HTMLElement, me: Me | null, code: string): void {
  const page = el("div", { class: "page" });
  const h1 = el("h1", {}, `Join room ${code}`);
  const nameLabel = el("label", { for: "join-name" }, "Your name");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "join-name";
  nameInput.value = me?.name ?? "";
  nameInput.setAttribute("aria-label", "Your name");
  const join = el("button", { class: "btn btn-primary" }, "Join");
  const form = el("div", { class: "form" });
  form.append(h1, nameLabel, nameInput, join);
  page.appendChild(form);
  root.appendChild(page);

  join.addEventListener("click", async () => {
    if (me !== null && nameInput.value.trim() !== "" && nameInput.value !== me.name) {
      await jsonFetch("/api/me/name", {
        method: "POST",
        body: JSON.stringify({ name: nameInput.value.trim() }),
      });
    }
    const res = await jsonFetch<{ error?: string }>(`/api/rooms/${code}/join`, { method: "POST" });
    if (res.status === 200) {
      window.location.href = `/room/${code}`;
      return;
    }
    if (res.body.error === "ROOM_FULL") {
      renderFull(root);
      return;
    }
    if (res.body.error === "ROOM_CLOSED") {
      renderClosed(root, "This room has closed");
      return;
    }
    if (res.body.error === "ROOM_NOT_FOUND") {
      renderClosed(root, "Room not found");
      return;
    }
    pageStatus("Online play is unavailable right now. Pass and play still works.");
  });
}

function renderJoinByCode(root: HTMLElement): void {
  const page = el("div", { class: "page" });
  const h1 = el("h1", {}, "Join with a code");
  const group = el("div", { class: "code-inputs", role: "group", "aria-label": "Room code" });
  const boxes: HTMLInputElement[] = [];
  for (let i = 0; i < 6; i++) {
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 1;
    input.id = `code-${i}`;
    input.setAttribute("aria-label", `Character ${i + 1} of 6`);
    group.appendChild(input);
    boxes.push(input);
  }
  const join = el("button", { class: "btn btn-primary" }, "Join");
  const home = el("a", { class: "btn", href: "/" }, "Home");
  const form = el("div", { class: "form" });
  form.append(h1, group, join, home);
  page.appendChild(form);
  root.appendChild(page);

  const goToRoom = async (code: string) => {
    const res = await jsonFetch<{ error?: string }>(`/api/rooms/${code}/join`, { method: "POST" });
    if (res.status === 200) {
      window.location.href = `/room/${code}`;
      return;
    }
    if (res.body.error === "ROOM_FULL") {
      renderFull(root);
      return;
    }
    if (res.body.error === "ROOM_CLOSED") {
      renderClosed(root, "This room has closed");
      return;
    }
    renderClosed(root, "Room not found");
  };

  join.addEventListener("click", () => {
    const code = boxes.map((b) => b.value).join("");
    if (code.length === 6) void goToRoom(code.toUpperCase());
  });

  boxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      box.value = box.value.toUpperCase();
      if (box.value.length === 1 && i < 5) boxes[i + 1].focus();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && box.value === "" && i > 0) {
        e.preventDefault();
        boxes[i - 1].value = "";
        boxes[i - 1].focus();
      }
      if (e.key === "Enter" && box.value !== "") {
        const code = boxes.map((b) => b.value).join("");
        if (code.length === 6) void goToRoom(code.toUpperCase());
      }
    });
    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text") ?? "";
      const chars = text.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
      for (let j = 0; j < 6; j++) {
        boxes[j].value = chars[j] ?? "";
      }
      const focusAt = Math.min(5, chars.length - 1);
      if (chars.length > 0) boxes[focusAt].focus();
    });
  });
  boxes[0].focus();
}

function renderFull(root: HTMLElement): void {
  root.textContent = "";
  const page = el("div", { class: "page" });
  const h1 = el("h1", {}, "Room full");
  const copy = el("p", {}, "This room already has two players.");
  const home = el("a", { class: "btn", href: "/" }, "Home");
  page.append(h1, copy, home);
  root.appendChild(page);
}

function renderClosed(root: HTMLElement, message: string): void {
  root.textContent = "";
  const page = el("div", { class: "page" });
  page.append(el("h1", {}, message), el("a", { class: "btn", href: "/" }, "Home"));
  root.appendChild(page);
}

void main();
