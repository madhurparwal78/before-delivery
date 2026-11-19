// The challenge board: entries, enter a photo, filter with one request per pause.

import { el, announce, ensureStatusRegion, api, ApiCallError, param } from "../ui/core";
import { onLive } from "../live";

interface Entry { rank: number; player: string; handle: string; creature_name: string; total: number; tick: number; photo: string }
interface BoardAnswer { entries: Entry[]; total: number; shown: number }
interface PhotosAnswer { photos: { id: string; creature_name: string; island: number; total: number }[] }
interface MeAnswer { player: { id: string; name: string; confirmed: boolean } }

export function mountBoards(): void {
  ensureStatusRegion("Board status", "last5");
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = "";
  void build(main);
}

async function build(main: HTMLElement): Promise<void> {
  const island = Number(location.pathname.split("/").pop() ?? "1");
  const me = await api<MeAnswer>("GET", "/api/me").catch(() => null);
  const page = el("div", { class: "board-page" });
  page.append(el("h1", {}, "Challenge board"));
  main.append(page);

  const status = el("p", { "aria-hidden": "true", class: "sr-only", id: "board-count" });
  const table = el("table", { class: "challenge-table", role: "table", "aria-label": "Challenge board" });
  const thead = el("thead", {});
  const headRow = el("tr", {});
  for (const h of ["Rank", "Player", "Creature", "Score"]) {
    const th = el("th", { scope: "col", text: h });
    if (h === "Rank" || h === "Score") th.setAttribute("class", "num");
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);
  const tbody = el("tbody", {});
  table.append(tbody);
  page.append(table);
  page.append(status);

  const enterBtn = el("button", { class: "action", id: "enter-photo", text: "Enter a photo" });
  page.append(enterBtn);
  const filterInput = el("input", { type: "search", id: "filter-players", "aria-label": "Filter players", placeholder: "Filter players" });
  page.append(filterInput);

  const renderBoard = (answer: BoardAnswer, filterText: string | null) => {
    tbody.innerHTML = "";
    for (const e of answer.entries) {
      const tr = el("tr", {});
      const rank = el("td", { class: "num", text: String(e.rank) });
      const player = el("td", { text: e.player });
      const creature = el("td", { text: e.creature_name });
      const score = el("td", { class: "num", text: String(e.total) });
      tr.append(rank, player, creature, score);
      tbody.append(tr);
    }
    if (answer.entries.length === 0) {
      const tr = el("tr", {});
      const td = el("td", { colspan: "4", text: "No entries yet." });
      tr.append(td);
      tbody.append(tr);
    }
    if (filterText !== null) {
      announce("Board status", `Showing ${answer.shown} of ${answer.total} entries for “${filterText}”.`);
    } else {
      announce("Board status", answer.total === 1 ? "1 entry" : `${answer.total} entries`);
    }
  };

  let loadFailed = false;
  const load = async (filterText: string | null) => {
    try {
      const url = filterText !== null ? `/api/boards/${island}?player=${encodeURIComponent(filterText)}` : `/api/boards/${island}`;
      const answer = await api<BoardAnswer>("GET", url);
      loadFailed = false;
      renderBoard(answer, filterText);
    } catch {
      loadFailed = true;
      announce("Board status", "Couldn't load the board. Try again.");
    }
  };
  void load(null);

  // One request 250 ms after the last keystroke; older answers are ignored.
  let filterTimer = 0;
  let latestInput = "";
  let requestSeq = 0;
  filterInput.addEventListener("input", () => {
    latestInput = filterInput.value;
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(async () => {
      const mySeq = ++requestSeq;
      const text = latestInput;
      const url = `/api/boards/${island}?player=${encodeURIComponent(text)}`;
      const answer = await api<BoardAnswer>("GET", url).catch(() => null);
      if (mySeq !== requestSeq) return;
      if (!answer) {
        announce("Board status", "Couldn't load the board. Try again.");
        return;
      }
      renderBoard(answer, text);
    }, 250);
  });

  // Enter a photo by keyboard.
  const dialog = el("dialog", { id: "enter-dialog", "aria-label": "Enter a photo" });
  const body = el("div", { class: "dialog-body" });
  body.append(el("h3", {}, "Enter a photo"));
  const group = el("div", { role: "radiogroup", "aria-label": "Your photos", class: "radiogroup" });
  body.append(group);
  const actions = el("div", { class: "dialog-actions" });
  const submit = el("button", { class: "action", id: "enter-photo-submit", text: "Enter photo" });
  actions.append(submit);
  body.append(actions);
  dialog.append(body);
  page.append(dialog);

  enterBtn.addEventListener("click", async () => {
    const photos = await api<PhotosAnswer>("GET", "/api/me/photos").catch(() => null);
    if (!photos) {
      location.href = "/signin?next=%2Fboards%2F1";
      return;
    }
    const mine = photos.photos
      .filter(p => p.island === island)
      .sort((a, b) => b.total - a.total);
    group.innerHTML = "";
    for (const photo of mine) {
      const label = el("label", {});
      const radio = el("input", { type: "radio", name: "photo", value: photo.id });
      radio.setAttribute("aria-label", `${photo.creature_name} photo, ${photo.total}`);
      label.append(radio, document.createTextNode(`${photo.creature_name} photo, ${photo.total}`));
      group.append(label);
    }
    dialog.showModal();
    (group.querySelector("input") as HTMLInputElement | null)?.focus();
  });

  submit.addEventListener("click", async () => {
    const checked = dialog.querySelector<HTMLInputElement>("input[name='photo']:checked");
    if (!checked) return;
    try {
      const answer = await api<{ entry: Entry; created: boolean }>("POST", `/api/boards/${island}/entries`, { photo: checked.value });
      const name = me?.player.name ?? "You";
      announce("Board status", `Board updated. ${name} is now number ${answer.entry.rank}.`);
      dialog.close();
      enterBtn.focus();
      void load(filterInput.value || null);
    } catch (err) {
      if (err instanceof ApiCallError) announce("Board status", err.message);
    }
  });

  onLive(ev => {
    if (ev.kind === "board") {
      void load(filterInput.value || null);
    }
    if (ev.kind === "clock" && loadFailed) {
      // a failed load's message stays until a new load succeeds
    }
  });
  void param;
}
