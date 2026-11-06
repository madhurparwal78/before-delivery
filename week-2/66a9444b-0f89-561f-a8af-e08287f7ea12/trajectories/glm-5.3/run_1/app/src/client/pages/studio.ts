import { api, el, announce, problemText } from "../api.js";
import type { User } from "../api.js";

interface Entry {
  id: string;
  artist_id: number;
  artist_name: string;
  title: string;
  statement: string;
  discipline: string;
  medium: string;
  year: string;
  status: string;
  images: Array<{ id: string; width: number; height: number; display_url: string | null }>;
}

export async function renderStudio(root: HTMLElement): Promise<void> {
  const user = (await api<{ user: User }>("/api/me")).user;
  if (user.role !== "artist") {
    root.append(el("h1", { class: "section-head", text: "Studio" }));
    root.append(el("p", { text: "The studio is for artists." }));
    return;
  }
  const wrap = el("div", { class: "wrap" });
  wrap.append(el("h1", { class: "section-head", text: "Studio" }));
  const statusNode = el("div", { role: "status", "aria-label": "Studio status", text: "" });
  const list = el("ul", { "aria-label": "My entries" });
  const editor = el("div", { class: "panel", "aria-label": "Entry editor" });
  let entries: Entry[] = [];
  let selected: Entry | null = null;

  async function refresh(): Promise<void> {
    entries = (await api<{ entries: Entry[] }>("/api/entries")).entries;
    renderList();
  }

  function renderList(): void {
    list.replaceChildren();
    for (const entry of entries) {
      const li = el("li");
      const btn = el("button", { text: `${entry.title} — ${entry.status}`, "aria-label": `Open ${entry.title}` });
      btn.addEventListener("click", () => {
        selected = entry;
        renderEditor();
      });
      li.append(btn);
      list.append(li);
    }
  }

  function renderEditor(): void {
    editor.replaceChildren();
    const isNew = selected === null;
    const title = el("input", { type: "text", "aria-label": "Title", value: isNew ? "" : selected!.title }) as HTMLInputElement;
    const statement = el("textarea", { "aria-label": "Artist statement" }) as HTMLTextAreaElement;
    statement.value = isNew ? "" : selected!.statement;
    const discipline = el("select", { "aria-label": "Discipline" }) as HTMLSelectElement;
    for (const d of ["sound", "light", "performance", "moving-image", "code"]) {
      discipline.append(el("option", { value: d, text: d }));
    }
    discipline.value = isNew ? "sound" : selected!.discipline;
    const medium = el("input", { type: "text", "aria-label": "Medium", value: isNew ? "" : selected!.medium }) as HTMLInputElement;
    const year = el("input", { type: "text", "aria-label": "Year", value: isNew ? "" : selected!.year }) as HTMLInputElement;
    const titleLabel = el("label", { text: "Title" });
    titleLabel.append(title);
    const statementLabel = el("label", { text: "Artist statement" });
    statementLabel.append(statement);
    const disciplineLabel = el("label", { text: "Discipline" });
    disciplineLabel.append(discipline);
    const mediumLabel = el("label", { text: "Medium" });
    mediumLabel.append(medium);
    const yearLabel = el("label", { text: "Year" });
    yearLabel.append(year);

    const save = el("button", { text: "Save draft" });
    save.addEventListener("click", async () => {
      const body = { title: title.value, statement: statement.value, discipline: discipline.value, medium: medium.value, year: year.value };
      try {
        if (isNew) {
          selected = await api<Entry>("/api/entries", { method: "POST", body: JSON.stringify(body) });
          announce(statusNode, `${selected.title} saved.`);
        } else {
          selected = await api<Entry>(`/api/entries/${selected!.id}`, { method: "PATCH", body: JSON.stringify(body) });
          announce(statusNode, `${selected.title} saved.`);
        }
        await refresh();
      } catch (err) {
        announce(statusNode, problemText(err));
      }
    });

    const submitBtn = el("button", { text: "Submit for review" });
    submitBtn.addEventListener("click", async () => {
      if (!selected) return;
      try {
        const res = await api<{ entry: Entry }>(`/api/entries/${selected.id}/transitions`, {
          method: "POST",
          body: JSON.stringify({ to: "review" }),
        });
        announce(statusNode, `${res.entry.title} sent for review.`);
        selected = res.entry;
        await refresh();
      } catch (err) {
        announce(statusNode, problemText(err));
      }
    });

    const imageInput = el("input", { type: "file", "aria-label": "Artwork image" }) as HTMLInputElement;
    const uploadBtn = el("button", { text: "Upload image" });
    uploadBtn.addEventListener("click", async () => {
      if (!selected || !imageInput.files || imageInput.files.length === 0) {
        announce(statusNode, "Save the entry and choose an image first.");
        return;
      }
      announce(statusNode, "Uploading…");
      const form = new FormData();
      form.append("file", imageInput.files[0]);
      try {
        await api(`/api/entries/${selected.id}/images`, { method: "POST", body: form });
        announce(statusNode, "Image uploaded.");
        selected = await api<Entry>(`/api/entries/${selected.id}`);
        await refresh();
      } catch (err) {
        announce(statusNode, problemText(err));
      }
    });

    editor.append(titleLabel, statementLabel, disciplineLabel, mediumLabel, yearLabel, save, imageInput, uploadBtn, submitBtn);
    if (selected && selected.images.length > 0) {
      const imagesNode = el("div");
      for (const image of selected.images) {
        const readBtn = el("button", { text: `View image ${image.id}` });
        readBtn.addEventListener("click", async () => {
          const res = await api<{ url: string }>(`/api/entries/${selected!.id}/images/${image.id}/read`, { method: "POST" });
          window.open(res.url, "_blank");
        });
        imagesNode.append(readBtn);
      }
      editor.append(imagesNode);
    }
  }

  const newBtn = el("button", { text: "New entry" });
  newBtn.addEventListener("click", () => {
    selected = null;
    renderEditor();
  });

  wrap.append(newBtn, statusNode);
  const grid = el("div", { class: "two-col" });
  grid.append(list, editor);
  wrap.append(grid);
  root.append(wrap);
  await refresh();
  renderEditor();
}
