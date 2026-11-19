import { el, button, link, navigate, heading } from "../lib/dom.js";
import { Api, type Collection, type CollectionInfo, type PenSummary } from "../lib/api.js";
import { buildHeader, meSync } from "../lib/header.js";
import { PreviewStage } from "../lib/preview.js";

export async function collectionsPage(root: HTMLElement): Promise<void> {
  root.innerHTML = "";
  buildHeader(root);

  const wrap = el("div", { class: "split" });
  const stage = el("div", { class: "stage with-inset", "aria-hidden": "true" });
  const col = el("div", { class: "column" });
  const body = el("div", { class: "column-body" });
  body.appendChild(heading(1, "Collections"));

  const status = el("div", { role: "status", "aria-label": "Collection status", class: "status" });
  const newBtn = button("New collection", { class: "primary" }, async () => {
    const c = await Api.post<{ id: string }>("/api/collections", {});
    navigate(`/collections/${c.id}`);
  });
  body.appendChild(newBtn);
  body.appendChild(status);

  const list = el("ul", { class: "list", role: "list", "aria-label": "Your collections" });
  const cols = await Api.get<{ collections: CollectionInfo[] }>("/api/collections");
  if (cols.collections.length === 0) {
    const panel = el("div", { class: "panel" });
    panel.textContent = "No collections yet. Make one to keep related pens together.";
    body.appendChild(panel);
  } else {
    for (const c of cols.collections) {
      const li = el("li", { class: "listitem-row", role: "listitem" });
      li.appendChild(link(`/collections/${c.id}`, c.title, { class: "row-title" }));
      const meta = el("span", { class: "row-meta", text: `${c.count === 1 ? "1 pen" : `${c.count} pens`}` });
      li.appendChild(meta);
      list.appendChild(li);
    }
    body.appendChild(list);
  }
  col.appendChild(body);
  wrap.appendChild(stage);
  wrap.appendChild(col);
  root.appendChild(wrap);
}

export async function collectionPage(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const id = params.get("collection") ?? "";
  root.innerHTML = "";
  buildHeader(root);

  const wrap = el("div", { class: "split" });
  const stage = el("div", { class: "stage with-inset" });
  const stageInner = el("div", { class: "stage-inner" });
  stage.appendChild(stageInner);
  const preview = new PreviewStage(stageInner);

  const col = el("div", { class: "column" });
  const body = el("div", { class: "column-body" });

  const status = el("div", { role: "status", "aria-label": "Collection status", class: "status" });
  const title = el("input", { type: "text", value: "" });
  title.setAttribute("aria-label", "Collection title");
  title.style.minWidth = "20ch";
  body.appendChild(title);
  body.appendChild(status);

  const list = el("ul", { class: "list", role: "list", "aria-label": "Collection pens" });
  body.appendChild(list);
  const emptyPanel = el("div", { class: "panel", hidden: "true" });
  emptyPanel.textContent = "This collection is empty. Add a pen with the box above.";
  body.appendChild(emptyPanel);

  const addBox = el("div", { class: "combobox-row" });
  const addLabel = el("label", { text: "Add a pen" });
  const addInput = el("input", { type: "text", placeholder: "Add a pen" });
  addInput.setAttribute("aria-label", "Add a pen");
  addInput.setAttribute("role", "combobox");
  addInput.setAttribute("aria-expanded", "false");
  addInput.setAttribute("aria-controls", "collection-add-listbox");
  const listBox = el("ul", { class: "listbox", id: "collection-add-listbox", role: "listbox", hidden: "true" });
  addLabel.appendChild(addInput);
  addBox.appendChild(addLabel);
  addBox.appendChild(listBox);
  body.appendChild(addBox);

  const controls = el("div", { style: "display:flex; gap: 8px; margin-top: 12px" });
  const deleteBtn = button("Delete collection", { class: "danger" }, async () => {
    await Api.del(`/api/collections/${id}`);
    navigate("/collections");
  });
  controls.appendChild(deleteBtn);
  body.appendChild(controls);

  col.appendChild(body);
  wrap.appendChild(stage);
  wrap.appendChild(col);
  root.appendChild(wrap);

  let current: Collection | null = null;
  let myPens: PenSummary[] = [];

  const refresh = async () => {
    current = await Api.get<Collection>(`/api/collections/${id}`);
    myPens = (await Api.get<{ pens: PenSummary[] }>("/api/pens")).pens;
    title.value = current.title;
    list.innerHTML = "";
    if (current.pens.length === 0) {
      emptyPanel.removeAttribute("hidden");
    } else {
      emptyPanel.setAttribute("hidden", "true");
      current.pens.forEach((pen, i) => {
        const row = el("li", { class: "listitem-row", role: "listitem", tabindex: "-1" });
        const onFocus = () => {
          void preview.renderPen(pen.id, pen.head, []);
        };
        const titleLink = link(`/pen/${pen.id}`, pen.title, { class: "row-title" });
        titleLink.addEventListener("keydown", (e) => {
          if (e.altKey && e.key === "ArrowUp" && i > 0) {
            e.preventDefault();
            void move(pen.id, i - 1);
          } else if (e.altKey && e.key === "ArrowDown" && i < current!.pens.length - 1) {
            e.preventDefault();
            void move(pen.id, i + 1);
          }
        });
        row.appendChild(titleLink);
        const remove = button(`Remove ${pen.title}`, {}, async () => {
          await Api.del(`/api/collections/${id}/pens/${pen.id}`);
          await refresh();
        });
        row.appendChild(remove);
        row.addEventListener("focusin", onFocus);
        row.addEventListener("mouseenter", onFocus);
        list.appendChild(row);
      });
      const first = current.pens[0]!;
      void preview.renderPen(first.id, first.head, []);
    }
  };

  const move = async (penId: string, toIndex: number) => {
    if (!current) return;
    const order = current.pens.map((p) => p.id);
    const from = order.indexOf(penId);
    if (from < 0) return;
    order.splice(from, 1);
    order.splice(toIndex, 0, penId);
    await Api.patch(`/api/collections/${id}`, { order });
    await refresh();
    const pen = current.pens[toIndex];
    status.textContent = `Moved ${pen?.title ?? ""} to position ${toIndex + 1} of ${current.pens.length}`;
    const row = list.children[toIndex] as HTMLElement | undefined;
    const focusTarget = row?.querySelector("a");
    (focusTarget as HTMLElement | null)?.focus();
  };

  title.addEventListener("change", async () => {
    if (!current) return;
    await Api.patch(`/api/collections/${id}`, { title: title.value });
    status.textContent = "";
  });

  // Add-a-pen combobox: filters the owner's pens, Enter adds.
  let highlighted = -1;
  let filtered: PenSummary[] = [];
  const updateBox = () => {
    const q = addInput.value.trim().toLowerCase();
    filtered = myPens.filter((p) => p.title.toLowerCase().includes(q));
    listBox.innerHTML = "";
    filtered.forEach((p, i) => {
      const li = el("li", { class: "option", role: "option", "aria-selected": i === highlighted ? "true" : "false", text: p.title });
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        void addPen(p);
      });
      listBox.appendChild(li);
    });
    listBox.setAttribute("hidden", filtered.length === 0 ? "true" : "false");
    addInput.setAttribute("aria-expanded", filtered.length > 0 ? "true" : "false");
  };

  const addPen = async (pen: PenSummary) => {
    if (!current) return;
    try {
      await Api.post(`/api/collections/${id}/pens`, { pen_id: pen.id });
      status.textContent = `Added ${pen.title}`;
    } catch (err) {
      const code = (err as { error: string }).error;
      if (code === "duplicate") {
        status.textContent = `${pen.title} is already in this collection.`;
      }
    }
    addInput.value = "";
    listBox.setAttribute("hidden", "true");
    await refresh();
  };

  addInput.addEventListener("input", () => {
    highlighted = -1;
    updateBox();
  });
  addInput.addEventListener("keydown", (e) => {
    if (listBox.getAttribute("hidden") === "true") {
      if (e.key === "Enter") e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      highlighted = e.key === "ArrowDown" ? Math.min(highlighted + 1, filtered.length - 1) : Math.max(highlighted - 1, 0);
      updateBox();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pen = filtered[highlighted >= 0 ? highlighted : 0];
      if (pen) void addPen(pen);
    } else if (e.key === "Escape") {
      listBox.setAttribute("hidden", "true");
    }
  });

  await refresh();
  void meSync();
}
