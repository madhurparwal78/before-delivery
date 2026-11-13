import { el, text as t, announce, bumpEpoch } from "./dom.js";
import { api } from "./api.js";
import { severityIcon } from "./part.js";
import { formatNumber, formatFixed } from "../shared/numbers.js";
import type { PageContext } from "./part.js";
import { Viewport, defaultPose } from "./viewport.js";

/** Home: hero with the measured headline, statements, gallery. */
export async function renderHome(ctx: PageContext): Promise<void> {
  const root = el("div", {});
  ctx.app.replaceChildren(root);

  // ----- hero -----
  const hero = el("section", { class: "home-hero" });
  const left = el("div", { class: "hero-left" });
  const h1 = el("h1", {}, t("Parts that fit the thing you measured."));
  left.append(
    el("div", { class: "mark-line" }),
    h1,
    el("p", { class: "lede" }, t("Open a shared part, set it to your measurements and check it against your printer or mill before you spend filament.")),
    el("a", { class: "button", href: "#gallery" }, t("Open the gallery")),
  );
  const right = el("div", { class: "hero-right" });
  const fragment = el("div", { class: "hero-fragment" });
  const heroViewport = el("div", { "data-ui": "hero-viewport", "data-eval-state": "settled", "data-epoch": "0" });
  heroViewport.append(el("div", { class: "solid-glow" }));
  const spanRow = el("div", { class: "hero-readout" });
  const spanLabel = el("label", { for: "hero-span" }, t("Span"));
  const spanField = el("div", { role: "spinbutton", id: "hero-span", tabindex: "0", "aria-valuenow": "84.67", "aria-valuemin": "40", "aria-valuemax": "400", "aria-valuetext": "84.67 millimetres", "aria-label": "Span" });
  spanField.textContent = "84.67";
  const readout = el("div", { "data-ui": "hero-readout" }, t("span 84.67\u202Fmm \u00b7 measured from the headline"));
  spanRow.append(spanLabel, spanField, readout);
  fragment.append(heroViewport, spanRow);
  right.append(fragment);
  hero.append(left, right);
  root.append(hero);

  // ----- statements -----
  const statements = el("section", { class: "statement-column" });
  const statementsData = [
    { copy: "Change a dimension. The solid rebuilds where you are looking.", kind: "dim" },
    { copy: "Run pre-flight. Thin walls and deep holes show before you print.", kind: "findings" },
    { copy: "Scrub the tape. See which operation made each wall.", kind: "tape" },
    { copy: "Compare revisions. Added and removed material, side by side.", kind: "compare" },
    { copy: "Pin a comment to the view. Everyone reviews the same solid.", kind: "comment" },
  ];
  for (const s of statementsData) {
    const row = el("div", { class: "statement-row" });
    row.append(el("p", {}, t(s.copy)));
    row.append(makeFragment(s.kind));
    statements.append(row);
  }
  root.append(statements);

  // ----- gallery -----
  const gallerySection = el("section", { class: "gallery-section", id: "gallery" });
  gallerySection.setAttribute("aria-label", "Gallery");
  gallerySection.append(el("h2", {}, t("Gallery")));
  const galleryLayout = el("div", { class: "gallery-layout" });
  const categories = el("div", { class: "categories" });
  const categoriesNav = el("nav", { "aria-label": "Categories" });
  categories.append(categoriesNav);
  const gridCol = el("div", {});
  const head = el("div", { class: "gallery-head" });
  const sortRow = el("div", { class: "sort-row" });
  const sortLabel = el("label", { for: "sort-by" }, t("Sort by"));
  const sortSelect = el("select", { id: "sort-by", "aria-label": "Sort by" });
  for (const opt of ["Featured", "Most liked", "Newest", "Name A\u2013Z"]) {
    const o = el("option", { value: opt });
    o.textContent = opt;
    sortSelect.append(o);
  }
  sortRow.append(sortLabel, sortSelect);
  head.append(el("span", { class: "muted" }, t("Parts rebuilt to your measurements")), sortRow);
  const grid = el("div", { "data-ui": "gallery-grid", "data-epoch": "0", role: "list", "aria-label": "Parts" });
  // Skeletons from first paint until the first parts response arrives.
  for (let i = 0; i < 12; i++) {
    grid.append(el("div", { "data-ui": "card-skeleton", class: "part-card-skeleton", "aria-hidden": "true" }));
  }
  const moreBtn = el("button", { hidden: "" }, t("Show more parts"));
  const statusLine = el("div", { class: "gallery-status-row" });
  const statusText = el("span", { role: "status", "aria-label": "Gallery" });
  statusLine.append(statusText);
  gridCol.append(head, grid, el("div", { class: "show-more-row" }, moreBtn), statusLine);
  galleryLayout.append(categories, gridCol);
  gallerySection.append(galleryLayout);
  root.append(gallerySection);

  // ----- hero measurement and rebuild (DP-55) -----
  const loadHero = async (): Promise<void> => {
    try {
    } catch { /* hero part is hidden when it fails */ }
    const values = { span: Number((spanField.textContent ?? "84.67")) };
    const res = await fetch("/api/evaluations", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ partSlug: "hero-cable-clip", values, seq: 1, viewerId: "hero" }),
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const json = await res.json() as { solid: { ops: Array<Record<string, number | string>> } | null; volume: number; bbox: number[]; geometryDigest: string };
    if (!json.solid) return;
    drawHeroSolid(json);
  };
  let heroVp: Viewport | null = null;
  const drawHeroSolid = (json: { solid: { ops: Array<Record<string, number | string>> } | null; volume: number; bbox: number[]; geometryDigest: string }): void => {
    if (!heroVp) {
      heroVp = new Viewport(heroViewport, defaultPose(json.bbox));
    }
    heroVp.setSolid(json.solid! as never);
    heroViewport.dataset.digest = json.geometryDigest;
    heroViewport.dataset.volume = formatFixed(json.volume, 2);
    heroViewport.dataset.bbox = json.bbox.join(",");
    bumpEpoch(heroViewport, "tinework:epoch:gallery:home");
  };
  void loadHero();

  // Measure the headline and set Span on load and on quiet resize.
  const measureHeadline = (): void => {
    const w = h1.getBoundingClientRect().width;
    const mm = w * 0.2645833;
    const clamped = Math.max(40, Math.min(400, mm));
    const rounded = Math.round(clamped * 100) / 100;
    spanField.textContent = String(rounded);
    spanField.setAttribute("aria-valuenow", String(rounded));
    spanField.setAttribute("aria-valuetext", `${rounded} millimetres`);
    readout.textContent = `span ${formatFixed(rounded, 2)}\u202Fmm \u00b7 measured from the headline`;
    void rebuildHero(rounded, false);
  };
  const rebuildHero = async (span: number, byHand: boolean): Promise<void> => {
    const res = await fetch("/api/evaluations", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ partSlug: "hero-cable-clip", values: { span }, seq: 2, viewerId: "hero" }),
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const json = await res.json();
    if (json.solid) drawHeroSolid(json as { solid: { ops: Array<Record<string, number | string>> }; volume: number; bbox: number[]; geometryDigest: string });
    if (byHand) readout.textContent = `span ${formatFixed(span, 2)}\u202Fmm \u00b7 set by hand`;
  };
  measureHeadline();
  let resizeTimer: number | null = null;
  window.addEventListener("resize", () => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      measureHeadline();
      resizeTimer = null;
    }, 200);
  });
  // Typing or arrowing Span rebuilds the clip.
  spanField.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "ArrowUp" || ke.key === "ArrowRight" || ke.key === "ArrowDown" || ke.key === "ArrowLeft" || ke.key === "Enter") {
      const v = Number(spanField.textContent ?? "84.67");
      const step = ke.key === "ArrowUp" || ke.key === "ArrowRight" ? 0.01 : ke.key === "ArrowDown" || ke.key === "ArrowLeft" ? -0.01 : 0;
      const next = Math.max(40, Math.min(400, Math.round((v + step) * 100) / 100));
      spanField.textContent = String(next);
      spanField.setAttribute("aria-valuenow", String(next));
      spanField.setAttribute("aria-valuetext", `${next} millimetres`);
      ke.preventDefault();
      void rebuildHero(next, true);
    }
  });

  // ----- gallery loading -----
  const state = { category: "", sort: "featured", cursor: "", parts: 0, first: true };
  const sortIds: Record<string, string> = { Featured: "featured", "Most liked": "liked", Newest: "newest", "Name A\u2013Z": "name" };
  const load = async (): Promise<void> => {
    const res = await api.gallery({ category: state.category || undefined, sort: state.sort, cursor: state.cursor || undefined });
    if (state.first) {
      grid.replaceChildren();
      state.first = false;
    }
    for (const p of res.parts) {
      grid.append(makeCard(p, ctx.me !== null));
      state.parts += 1;
    }
    moreBtn.hidden = res.nextCursor === null;
    moreBtn.dataset.cursor = res.nextCursor ?? "";
    // Category counts.
    categoriesNav.replaceChildren();
    const all = el("a", { href: "#gallery" }, t(`All parts (${res.total})`));
    if (!state.category) all.setAttribute("aria-current", "true");
    all.addEventListener("click", (e) => { e.preventDefault(); void resetAndLoad(""); });
    categoriesNav.append(all);
    for (const c of res.categories.filter((c2) => c2.slug !== "")) {
      const a = el("a", { href: "#gallery" }, t(`${c.name} (${c.count})`));
      if (state.category === c.slug) a.setAttribute("aria-current", "true");
      a.addEventListener("click", (e) => { e.preventDefault(); void resetAndLoad(c.slug); });
      categoriesNav.append(a);
    }
    statusText.textContent = `Showing ${state.parts} parts.`;
    announce("gallery-status", `Showing ${state.parts} parts.`);
    bumpEpoch(grid, "tinework:epoch:gallery:home");
  };
  const resetAndLoad = async (category: string): Promise<void> => {
    state.category = category;
    state.cursor = "";
    state.parts = 0;
    state.first = true;
    history.replaceState(null, "", `${location.pathname}?${new URLSearchParams({ ...(category ? { category } : {}), sort: state.sort }).toString()}`);
    await load();
  };
  sortSelect.addEventListener("change", () => {
    const label = (sortSelect as unknown as HTMLSelectElement).value;
    state.sort = sortIds[label] ?? "featured";
    state.cursor = "";
    state.parts = 0;
    state.first = true;
    void load();
  });
  moreBtn.addEventListener("click", () => {
    state.cursor = moreBtn.dataset.cursor ?? "";
    void load();
  });
  await load();
  // Live like counts.
  openGalleryStream(grid);
}

function makeCard(p: { slug: string; title: string; author: { displayName: string }; category: string; likes: number; liked: boolean; head: { id: string; label: string; geometryDigest: string; volume: number; bbox: number[] } }, signedIn: boolean): HTMLElement {
  const card = el("div", { class: "part-card", "data-ui": "part-card", role: "listitem" });
  const thumb = el("a", { class: "thumb", href: `/parts/${p.slug}`, "aria-hidden": "true", tabindex: "-1" });
  const img = el("img", { src: `/api/solids/${p.head.geometryDigest}/thumbnail.svg`, alt: "" });
  thumb.append(img);
  const title = el("a", { class: "card-title", href: `/parts/${p.slug}` }, t(p.title));
  const meta = el("div", { class: "card-meta" }, t(`${p.author.displayName} \u00b7 ${p.category}`));
  const dims = el("div", { class: "card-meta" }, t(`${formatFixed(p.head.volume, 2)}\u202Fmm\u00b3 \u00b7 ${p.head.bbox.map((n) => formatNumber(n, 2)).join(" \u00d7 ")}\u202Fmm`));
  const likeBtn = el("button", { "aria-pressed": p.liked ? "true" : "false", "aria-label": `Like ${p.title}` });
  const likeCount = el("span", { "data-ui": "like-count" }, t(`${p.likes} ${p.likes === 1 ? "like" : "likes"}`));
  likeBtn.append(t("\u2665"), likeCount);
  if (!signedIn) likeBtn.setAttribute("aria-disabled", "true");
  likeBtn.addEventListener("click", async () => {
    if (!signedIn) return;
    const res = p.liked ? await api.unlike(p.slug) : await api.like(p.slug);
    p.liked = res.liked;
    p.likes = res.likes;
    likeBtn.setAttribute("aria-pressed", String(res.liked));
    likeCount.textContent = `${res.likes} ${res.likes === 1 ? "like" : "likes"}`;
  });
  const foot = el("div", { class: "card-foot" }, el("span", {}, t(p.head.label)), likeBtn);
  card.append(thumb, title, meta, dims, foot);
  return card;
}

function openGalleryStream(grid: HTMLElement): void {
  const es = new EventSource("/api/events?parts=*");
  es.addEventListener("like", (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as { partSlug: string; likes: number };
    for (const card of Array.from(grid.querySelectorAll('[data-ui="part-card"]'))) {
      const link = card.querySelector(".card-title") as HTMLAnchorElement | null;
      if (!link) continue;
      const slug = link.getAttribute("href")?.split("/").pop();
      if (slug === data.partSlug) {
        const count = card.querySelector('[data-ui="like-count"]');
        if (count) count.textContent = `${data.likes} ${data.likes === 1 ? "like" : "likes"}`;
      }
    }
  });
}

function makeFragment(kind: string): HTMLElement {
  const f = el("div", { class: "fragment" });
  if (kind === "dim") {
    const spin = el("div", { role: "spinbutton", "aria-label": "Width", tabindex: "0", "aria-valuenow": "60", "aria-valuetext": "60.0 millimetres" });
    spin.textContent = "60.0";
    const toggle = el("div", { role: "radiogroup", "aria-label": "Units" });
    const mm = el("button", { role: "radio", "aria-checked": "true" }, t("mm"));
    const inch = el("button", { role: "radio", "aria-checked": "false" }, t("in"));
    toggle.append(mm, inch);
    f.append(el("div", { class: "dim-field" }, el("label", {}, t("Width")), spin, toggle));
  } else if (kind === "findings") {
    for (let i = 0; i < 3; i++) {
      const sev = i === 0 ? "Blocking" : i === 1 ? "Advisory" : "Pass";
      const row = el("div", { class: "finding-row" });
      const s = el("span", { class: `sev sev-${sev}` });
      s.innerHTML = severityIcon(sev);
      s.append(t(sev));
      row.append(s, el("span", { class: "muted" }, t(i === 0 ? "Wall beside Hole 1 is 1.2 mm" : i === 1 ? "Wall beside Hole 2 is 1.2 mm" : "Every check passed")));
      f.append(row);
    }
  } else if (kind === "tape") {
    const tape = el("div", { role: "slider", "aria-label": "Build tape", tabindex: "0", class: "tape", "aria-valuemin": "0", "aria-valuemax": "12", "aria-valuenow": "12", "aria-valuetext": "Operation 12 of 12 \u00b7 join \u00b7 boss" });
    tape.style.height = "44px";
    const track = el("div", { class: "tape-track" });
    track.style.position = "absolute";
    track.style.inset = "8px 0";
    for (let i = 0; i <= 12; i++) {
      const tick = el("div", { class: "tick" });
      tick.style.left = `${(i / 12) * 100}%`;
      track.append(tick);
    }
    const playhead = el("div", { class: "playhead" });
    playhead.style.left = "100%";
    track.append(playhead);
    tape.append(track);
    f.append(tape);
  } else if (kind === "compare") {
    const swatch = el("div", { style: "display:flex;gap:8px;align-items:center" });
    swatch.append(
      el("span", { style: "width:28px;height:28px;background:rgba(53,211,232,0.35);border:1px solid #35d3e8;border-radius:4px;display:inline-block" }),
      el("span", { style: "width:28px;height:28px;border:1px dashed #8a9bad;border-radius:4px;display:inline-block;background:repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(138,155,173,0.35) 3px,rgba(138,155,173,0.35) 6px)" }),
      el("span", { class: "muted", style: "margin-left:8px" }, t("+1.70 cm\u00b3 \u00b7 \u22120.42 cm\u00b3")),
    );
    f.append(swatch);
  } else {
    const pin = el("div", { style: "position:relative;height:110px" });
    pin.innerHTML = `<svg viewBox="0 0 200 110" width="100%" height="110" aria-hidden="true"><rect x="40" y="30" width="120" height="50" fill="none" stroke="#35d3e8" stroke-width="1.4"/><circle cx="130" cy="42" r="4" fill="#35d3e8"/><path d="M130 46v14" stroke="#35d3e8" stroke-width="1.2" stroke-dasharray="3 3"/></svg>`;
    const bubble = el("div", { class: "muted", style: "font-size:12px" }, t("\u201CThe wall beside Hole 1 is thin here.\u201D \u2014 Ines Calloway"));
    f.append(pin, bubble);
  }
  return f;
}

/** The dashboard. */
export async function renderDashboard(ctx: PageContext): Promise<void> {
  const data = await api.dashboard();
  const root = el("div", {});
  ctx.app.replaceChildren(root);
  root.append(el("h1", {}, t("Dashboard")));

  const myParts = el("section", { class: "dash-section", "aria-label": "My parts" });
  myParts.append(el("h2", {}, t("My parts")));
  if (data.parts.length === 0) {
    const empty = el("p", { class: "empty-state" }, t("You have no parts yet."));
    empty.append(el("a", { href: "/" }, t("Browse the gallery")));
    myParts.append(empty);
  } else {
    for (const p of data.parts) {
      const row = el("div", { class: "dash-row" });
      const img = el("img", { src: "", alt: "" }) as HTMLImageElement;
      img.style.visibility = "hidden";
      row.append(img);
      const link = el("a", { class: "dash-title", href: `/parts/${p.slug}` }, t(p.title));
      row.append(link, el("span", { class: "dash-meta" }, t(`${p.head.label} \u00b7 ${p.revisionCount} revisions \u00b7 ${p.likes} ${p.likes === 1 ? "like" : "likes"}`)));
      myParts.append(row);
      // Thumbnails load from the head digest.
      void api.part(p.slug).then((full) => {
        img.src = `/api/solids/${full.revision.geometryDigest}/thumbnail.svg`;
        img.alt = `${p.title}, ${p.head.label}`;
        img.style.visibility = "";
      }).catch(() => {
        img.replaceWith(el("div", { class: "muted", style: "width:72px;height:50px;display:flex;align-items:center;justify-content:center;font-size:11px" }, t("Preview unavailable")));
      });
    }
  }
  root.append(myParts);

  const roomsSection = el("section", { class: "dash-section", "aria-label": "Review rooms" });
  roomsSection.append(el("h2", {}, t("Review rooms")));
  if (data.rooms.length === 0) {
    roomsSection.append(el("p", { class: "empty-state" }, t("No review rooms yet.")));
  } else {
    for (const room of data.rooms) {
      const row = el("div", { class: "dash-row" });
      const state = room.state.charAt(0).toUpperCase() + room.state.slice(1);
      row.append(
        el("a", { class: "dash-title", href: `/rooms/${room.id}` }, t(room.title)),
        el("span", { class: "dash-meta" }, t(`${state} \u00b7 Approvals ${room.approvals} of ${room.requiredApprovals}`)),
      );
      roomsSection.append(row);
    }
  }
  root.append(roomsSection);

  const likedSection = el("section", { class: "dash-section", "aria-label": "Liked parts" });
  likedSection.append(el("h2", {}, t("Liked parts")));
  if (data.liked.length === 0) {
    likedSection.append(el("p", { class: "empty-state" }, t("You have not liked any parts yet.")));
  } else {
    for (const p of data.liked) {
      const row = el("div", { class: "dash-row" });
      row.append(el("a", { class: "dash-title", href: `/parts/${p.slug}` }, t(p.title)), el("span", { class: "dash-meta" }, t(p.author)));
      likedSection.append(row);
    }
  }
  root.append(likedSection);
}
