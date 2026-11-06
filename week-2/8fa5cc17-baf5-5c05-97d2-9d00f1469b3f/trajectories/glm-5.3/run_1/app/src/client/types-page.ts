// The type page: the New type dialog and the grid of object cards.

import { api, apiFail, ApiFailure, type ObjectJson, type TypeJson, type BlockJson } from "./api.js";
import { h, clearChildren, openDialog, reducedMotion, alertMessage, clearAlert } from "./dom.js";
import { state, screens, mainEl, navigate, updateTopbarTitle } from "./app.js";
import { MOTION, QUIRE_CURVE } from "./constants.js";

export function openTypeScreen(typeId: string): void {
  const onEventLocal = (ev: Event): void => {
    const detail = (ev as CustomEvent).detail as { event: string; data: Record<string, unknown> };
    if (detail.event === "object.saved" || detail.event === "object.removed" || detail.event === "backlinks.changed") {
      void load();
    }
  };
  screens.current = {
    dispose: () => {
      document.removeEventListener("quire-event", onEventLocal);
      document.removeEventListener("quire-backlinks", onBacklinks);
    },
  };
  document.addEventListener("quire-event", onEventLocal);
  document.addEventListener("quire-backlinks", onBacklinks);
  let open = true;
  const load = async (): Promise<void> => {
    if (!open) return;
    let type: TypeJson | undefined = state.app?.types.find((t) => t.id === typeId);
    if (type === undefined) {
      notFound();
      return;
    }
    let objects: ObjectJson[] = [];
    try {
      const res = await api<{ objects: ObjectJson[] }>("GET", `/api/objects?type_id=${typeId}`);
      objects = res.objects.slice().sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0));
    } catch {
      // an unknown type shows not found
    }
    if (!open) return;
    render(type, objects);
  };
  function onBacklinks(): void {
    void load();
  }
  void load();
}

function notFound(): void {
  const main = mainEl();
  clearChildren(main);
  main.append(h("h1", { text: "We can't find that note." }));
}

function render(type: TypeJson, objects: ObjectJson[]): void {
  const main = mainEl();
  clearChildren(main);
  clearAlert();
  updateTopbarTitle(type.name);
  main.append(h("h1", { text: type.name }));
  if (type.name !== "Daily note") {
    main.append(h("button", { class: "new-object", onclick: () => openNewObjectDialog(type) }, `New ${type.name}`));
  }
  const grid = h("div", { class: "card-grid" });
  for (const object of objects) {
    grid.append(objectCard(object, type));
  }
  main.append(grid);
}

function objectCard(object: ObjectJson, type: TypeJson): HTMLElement {
  const numeral = h("span", { class: "card-numeral", "data-backlink-count": object.backlinks }, String(object.backlinks));
  const titleLink = h("a", { href: `/o/${object.id}`, class: "card-title", onclick: (e: MouseEvent) => { e.preventDefault(); void navigate(`/o/${object.id}`); } }, object.title);
  const front = h("div", { class: "card-face card-front", "data-card-face": "front" },
    h("div", { class: "card-front-row" }, titleLink, numeral),
    h("button", { class: "ghost card-flip", "aria-label": `Show properties of ${object.title}`, onclick: (e: Event) => flip(e, object, type) }, "Properties")
  );
  const back = h("div", { class: "card-face card-back", "data-card-face": "back", hidden: true },
    h("h3", {}, object.title),
    h("button", { class: "ghost card-flip", "aria-label": `Show front of ${object.title}`, onclick: (e: Event) => flip(e, object, type) }, "Show front")
  );
  const inner = h("div", { class: "card-inner", "data-card-inner": "" }, front, back);
  const article = h("article", { class: "object-card", "aria-label": object.title }, inner);
  return article;
}

interface FlipState {
  angle: number;
  turned: boolean;
}

const flipStates = new Map<string, FlipState>();

function flip(e: Event, object: ObjectJson, type: TypeJson): void {
  const article = (e.target as HTMLElement).closest(".object-card") as HTMLElement | null;
  if (article === null) return;
  const inner = article.querySelector("[data-card-inner]") as HTMLElement | null;
  if (inner === null) return;
  const st = flipStates.get(object.id) ?? { angle: 0, turned: false };
  const target = st.turned ? 0 : 180;
  st.turned = !st.turned;
  flipStates.set(object.id, st);
  // rebuild the back face content when turning to it
  if (st.turned) {
    const back = inner.querySelector('[data-card-face="back"]') as HTMLElement;
    clearChildren(back);
    back.append(h("h3", {}, object.title));
    const dl = h("dl", { class: "card-properties" });
    type.fields.forEach((f, k) => {
      const value = object.properties[f.name];
      let shown = "—";
      if (value !== null && value !== undefined) {
        if (f.kind === "relation") {
          shown = "";
          void api<{ objects: ObjectJson[] }>("GET", `/api/objects?type_id=${f.target_type_id}`).then((res) => {
            const target2 = res.objects.find((o) => o.id === value);
            shown = target2?.title ?? "—";
            const ddEl = dl.querySelector(`dd[data-field="${f.name}"]`);
            if (ddEl !== null) ddEl.textContent = shown;
          });
        } else {
          shown = String(value);
        }
      }
      dl.append(h("dt", {}, f.name), h("dd", { "data-field": f.name }, shown));
    });
    back.append(dl);
    back.append(h("button", { class: "ghost card-flip", "aria-label": `Show front of ${object.title}`, onclick: (ev: Event) => flip(ev, object, type) }, "Show front"));
    // stagger the rows in
    if (!reducedMotion()) {
      Array.from(dl.children).forEach((row, k) => {
        (row as HTMLElement).animate(
          [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: MOTION.rowFade, delay: MOTION.rowStaggerStart + MOTION.rowStaggerGap * k, easing: QUIRE_CURVE, fill: "backwards" }
        );
      });
    }
  }
  // faces: the one facing away is unavailable
  const front = inner.querySelector('[data-card-face="front"]') as HTMLElement;
  const back = inner.querySelector('[data-card-face="back"]') as HTMLElement;
  const applyAngle = (angle: number): void => {
    inner.style.transform = `perspective(900px) rotateY(${angle}deg)`;
    const frontVisible = angle <= 90;
    front.inert = !frontVisible;
    front.setAttribute("aria-hidden", String(!frontVisible));
    front.style.visibility = frontVisible ? "visible" : "hidden";
    back.inert = frontVisible;
    back.setAttribute("aria-hidden", String(frontVisible));
    back.style.visibility = frontVisible ? "hidden" : "visible";
  };
  if (reducedMotion()) {
    applyAngle(target);
    (st.turned ? back.querySelector("button") : front.querySelector("button"))?.focus();
    return;
  }
  // reversible interruption: animate from the current angle
  const from = st.angle;
  const duration = (Math.abs(target - from) / 180) * MOTION.cardTurn;
  const anim = inner.animate(
    [
      { transform: `perspective(900px) rotateY(${from}deg)` },
      { transform: `perspective(900px) rotateY(${target}deg)` },
    ],
    { duration, easing: QUIRE_CURVE, fill: "forwards" }
  );
  const startedAt = performance.now();
  let angle = from;
  const tick = (): void => {
    // approximate progress for face availability
    const p = Math.min(1, (performance.now() - startedAt) / duration);
    angle = from + (target - from) * p;
    applyAngle(angle);
    if (p < 1 && document.contains(article)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  anim.onfinish = () => {
    st.angle = target;
    flipStates.set(object.id, st);
    applyAngle(target);
    const focusTarget = st.turned ? back.querySelector("button") : front.querySelector("button");
    if (focusTarget !== null && focusTarget instanceof HTMLElement) focusTarget.focus();
  };
}

async function openNewObjectDialog(type: TypeJson): Promise<void> {
  const titleInput = h("input", { type: "text", "aria-label": "Title" });
  const create = h("button", {}, "Create");
  const error = h("div", { class: "field-error", "aria-live": "polite" });
  const dialog = h("div", { role: "dialog", "aria-label": `New ${type.name}`, class: "dialog" },
    h("h2", { text: `New ${type.name}` }),
    h("label", {}, "Title ", titleInput),
    error,
    create
  );
  const overlay = h("div", { class: "dialog-overlay" }, dialog);
  document.body.append(overlay);
  const handle = openDialog(overlay, document.activeElement as HTMLElement | null);
  dialog.addEventListener("dialog-close", () => {
    overlay.remove();
    handle.close();
  });
  const submit = async (): Promise<void> => {
    try {
      const res = await api<ObjectJson>("POST", "/api/objects", { type_id: type.id, title: titleInput.value });
      dialog.dispatchEvent(new CustomEvent("dialog-close"));
      void navigate(`/o/${res.id}`);
    } catch (e) {
      error.textContent = apiFail(e, "title");
    }
  };
  create.addEventListener("click", () => void submit());
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  });
  titleInput.focus();
}
