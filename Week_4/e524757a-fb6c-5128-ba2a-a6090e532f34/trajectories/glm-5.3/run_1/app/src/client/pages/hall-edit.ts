// The hall editor: reorder, caption, public switch, save.

import { el, announce, ensureStatusRegion, api, ApiCallError, setFigure, likesText } from "../ui/core";
import { onLive } from "../live";

interface HallAnswer { hall: { handle: string; public: boolean; frames: { frame: number; caption: string; photo: string; likes: number }[] } }
interface PhotosAnswer { photos: { id: string; creature_name: string; island: number; total: number }[] }

export function mountHallEdit(): void {
  ensureStatusRegion("Gallery status", "last5");
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = "";
  void build(main);
}

async function build(main: HTMLElement): Promise<void> {
  const hall = await api<HallAnswer>("GET", "/api/me/hall").catch(() => null);
  const photos = await api<PhotosAnswer>("GET", "/api/me/photos").catch(() => null);
  if (!hall || !photos) {
    location.href = "/signin?next=%2Fhall";
    return;
  }
  const page = el("div", { class: "hall-page" });
  page.append(el("h1", {}, "Your hall"));

  const columns = el("div", { class: "hall-columns" });
  const left = el("section", { "aria-label": "Hall order" });
  const orderList = el("ul", { class: "hall-order-list", role: "list", "aria-label": "Hall order", id: "hall-order" });
  const frames = hall.hall.frames.slice();

  const redraw = () => {
    orderList.innerHTML = "";
    frames.forEach((frame, index) => {
      const li = el("li", { tabindex: "0", "aria-label": `Frame ${index + 1}` });
      li.setAttribute("role", "listitem");
      const img = el("img", { src: `/api/photos/${frame.photo}/image`, alt: "Hung photo", style: "width:64px;height:48px;object-fit:cover;border-radius:4px" });
      const label = el("span", { class: "frame-label", text: `Frame ${index + 1}` });
      const likes = el("figure", { "data-figure": "likes", "aria-hidden": "true", text: likesText(frame.likes) });
      const caption = el("input", {
        type: "text", value: frame.caption, maxlength: "140",
        "aria-label": `Caption for photo in frame ${index + 1}`, style: "min-width:120px"
      });
      caption.addEventListener("change", () => { frame.caption = caption.value; });
      const up = el("button", { text: "Move up", "aria-label": "Move photo up" });
      up.addEventListener("click", () => move(index, -1));
      const down = el("button", { text: "Move down", "aria-label": "Move photo down" });
      down.addEventListener("click", () => move(index, 1));
      li.append(img, label, likes, caption, up, down);
      li.addEventListener("keydown", ev => {
        if (!ev.altKey) return;
        if (ev.key === "ArrowUp") { ev.preventDefault(); move(index, -1, li); }
        if (ev.key === "ArrowDown") { ev.preventDefault(); move(index, 1, li); }
      });
      orderList.append(li);
    });
  };

  const move = (index: number, delta: number, li?: HTMLElement) => {
    const target = index + delta;
    if (target < 0 || target >= frames.length) return;
    const [frame] = frames.splice(index, 1);
    frames.splice(target, 0, frame);
    redraw();
    const moved = orderList.children[target] as HTMLElement | undefined;
    (moved ?? li)?.focus();
    announce("Gallery status", `Photo moved to frame ${target + 1} of ${frames.length}.`);
  };
  redraw();

  const switchRow = el("div", { class: "switch-row" });
  const pub = el("input", { type: "checkbox", id: "public-hall", role: "switch", "aria-label": "Public hall" });
  pub.checked = hall.hall.public;
  pub.addEventListener("change", async () => {
    try {
      await api("PUT", "/api/me/hall", { public: pub.checked });
      announce("Gallery status", pub.checked ? "Hall is now public." : "Hall is now private.");
    } catch (err) {
      if (err instanceof ApiCallError) announce("Gallery status", err.message);
    }
  });
  const pubLabel = el("label", {}, "Public hall");
  pubLabel.setAttribute("for", "public-hall");
  switchRow.append(pub, pubLabel);

  const save = el("button", { class: "action", id: "save-hall", text: "Save hall" });
  save.addEventListener("click", async () => {
    announce("Gallery status", "Saving hall…");
    try {
      await api("PUT", "/api/me/hall", {
        frames: frames.map((f, i) => ({ photo: f.photo, caption: f.caption, frame: i + 1 }))
      });
      announce("Gallery status", "Hall saved.");
    } catch (err) {
      if (err instanceof ApiCallError) announce("Gallery status", err.message);
    }
  });

  left.append(orderList, switchRow, save);
  columns.append(left);

  const right = el("section", { "aria-label": "Your photos" });
  right.append(el("h2", {}, "Your photos"));
  const list = el("ul", { class: "hall-photos-list", role: "list", "aria-label": "Your photos" });
  for (const photo of photos.photos) {
    const li = el("li", {});
    li.append(el("img", { src: `/api/photos/${photo.id}/image`, alt: `${photo.creature_name} photo` }));
    const hang = el("button", { text: `Hang ${photo.creature_name} photo` });
    hang.addEventListener("click", () => {
      if (frames.length >= 12) {
        announce("Gallery status", "A hall holds 12 photos.");
        return;
      }
      frames.push({ frame: frames.length + 1, caption: "", photo: photo.id, likes: 0 });
      redraw();
      announce("Gallery status", `${photo.creature_name} photo moved to frame ${frames.length} of ${frames.length}.`);
    });
    li.append(hang);
    list.append(li);
  }
  right.append(list);
  columns.append(right);
  page.append(columns);
  main.append(page);

  onLive(ev => {
    const p = ev.payload as Record<string, unknown>;
    if (ev.kind === "like") {
      const photoId = String(p.photo_id);
      const idx = frames.findIndex(f => f.photo === photoId);
      if (idx >= 0) {
        frames[idx].likes = Number(p.likes);
        const fig = orderList.children[idx]?.querySelector("[data-figure='likes']");
        if (fig) setFigure(fig as HTMLElement, Number(p.likes), likesText);
        announce("Gallery status", `${String(p.visitor)} liked your photo.`);
      }
    }
  });
}
