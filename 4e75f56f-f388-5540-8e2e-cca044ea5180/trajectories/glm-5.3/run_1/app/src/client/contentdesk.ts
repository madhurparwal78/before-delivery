import { el, clear, field, formFieldError, announce, mountStatus } from "./ui.js";
import { api, ApiFailure } from "./api.js";
import { state, refreshMe, type Session } from "./state.js";
import { openSignInDialog } from "./authDialog.js";
import { renderSeats } from "./desk.js";

/**
 * The content desk: the event director's editor for the four content kinds,
 * with the live hands-on share recomputed on every keystroke before saving.
 */

type Kind = "sessions" | "hospitality" | "hotels" | "faq";

const HANDS_ON_ERROR = "Hands-on time must stay at least 30% of the agenda.";

/** t is total minutes, h is hands-on minutes; exactly 30% is allowed. */
export function handsOnShare(sessions: { minutes: number | string; format: string }[]): { h: number; t: number; p: string } {
  let h = 0;
  let t = 0;
  for (const s of sessions) {
    const minutes = typeof s.minutes === "string" ? (s.minutes.trim() === "" || Number.isNaN(Number(s.minutes)) ? 0 : Number(s.minutes)) : Number(s.minutes) || 0;
    t += minutes;
    if (s.format === "hands-on") h += minutes;
  }
  const p = t === 0 ? "0.0" : (Math.floor((h * 1000) / t) / 10).toFixed(1);
  return { h, t, p };
}

export function shareText(sessions: { minutes: number | string; format: string }[]): string {
  const { h, t, p } = handsOnShare(sessions);
  return `Hands-on ${h} of ${t} minutes (${p}%)`;
}

function signOutButton(onDone: () => Promise<void> | void): HTMLElement {
  const btn = el("button", { class: "btn btn-quiet" }, "Sign out");
  btn.addEventListener("click", async () => {
    await api("/api/auth/signout", { method: "POST" });
    await refreshMe();
    await onDone();
  });
  return btn;
}

export function buildContentDesk(root: HTMLElement): void {
  let kind: Kind = "sessions";
  let items: Record<string, unknown>[] = [];
  let selectedId: string | null = null;
  let deleting = false;

  async function load(): Promise<void> {
    await refreshMe();
    render();
    await loadKind();
  }

  async function loadKind(): Promise<void> {
    try {
      const res = await api<{ items: Record<string, unknown>[] }>(`/api/desk/content/${kind}`);
      items = res.items;
      if (kind === "sessions") {
        const sessions = items as unknown as Session[];
      sessions.sort((a, b) => Number(a.day) - Number(b.day) || Number(a.number) - Number(b.number));
      items = sessions as unknown as Record<string, unknown>[];
      }
    } catch {
      items = [];
    }
    renderKind();
  }

  function render(): void {
    clear(root);
    const me = state.me;
    const wrap = el("div", { class: "staff-page" });
    wrap.append(el("h1", { class: "chapter-title", id: "content-heading", tabindex: "-1" }, "Content desk"));
    if (!me) {
      wrap.append(el("p", { class: "lede" }, "Sign in as the event director to edit the programme."));
      const signIn = el("button", { class: "btn btn-live" }, "Sign in");
      signIn.addEventListener("click", () => openSignInDialog(signIn, load));
      wrap.append(signIn);
      root.append(wrap);
      return;
    }
    if (me.account.role !== "director") {
      wrap.append(el("p", { class: "hint" }, "This desk is for the event director."));
      wrap.append(signOutButton(load));
      root.append(wrap);
      return;
    }
    const tabs = el("div", { class: "content-tabs", role: "tablist", "aria-label": "Content" });
    for (const [k, label] of [["sessions", "Agenda"], ["hospitality", "Evenings"], ["hotels", "Hotels"], ["faq", "FAQ"]] as const) {
      const tab = el("button", {
        class: "tab",
        role: "tab",
        "aria-selected": String(kind === k),
        id: `content-tab-${k}`,
      }, label);
      tab.addEventListener("click", () => {
        kind = k;
        selectedId = null;
        deleting = false;
        load();
      });
      tabs.append(tab);
    }
    wrap.append(tabs);
    root.append(wrap);
  }

  let kindWrap: HTMLElement | null = null;

  function renderKind(): void {
    const page = document.querySelector(".staff-page");
    if (!page) return;
    const me = state.me;
    if (!me || me.account.role !== "director") return;
    page.querySelector(".content-live")?.remove();
    const live = el("div", { class: "content-live staff-cols" });

    const left = el("div", {});
    const right = el("div", {});

    const list = el("ul", { class: "item-list", "aria-label": listLabel(kind) });
    if (kind === "sessions") {
      for (const item of items as unknown as Session[]) {
        const btn = el("button", { class: "btn btn-quiet" }, `Session ${item.number}: ${item.title}`);
        btn.addEventListener("click", () => {
          if (deleting) deleting = false;
          selectedId = item.id;
          renderKind();
        });
        if (selectedId === item.id) btn.classList.add("btn-live");
        list.append(el("li", {}, btn));
      }
      const newBtn = el("button", { class: "btn" }, "New session");
      newBtn.addEventListener("click", () => {
        selectedId = null;
        deleting = false;
        renderKind();
      });
      list.append(el("li", {}, newBtn));
    } else {
      for (const item of items) {
        const title = String(item.title ?? item.name ?? item.question ?? "Untitled");
        const btn = el("button", { class: "btn btn-quiet" }, title);
        btn.addEventListener("click", () => {
          selectedId = String(item.id);
          deleting = false;
          renderKind();
        });
        if (selectedId === String(item.id)) btn.classList.add("btn-live");
        list.append(el("li", {}, btn));
      }
      const newBtn = el("button", { class: "btn" }, `New ${kind === "faq" ? "FAQ entry" : kind === "hotels" ? "hotel" : kind === "hospitality" ? "evening" : "session"}`);
      newBtn.addEventListener("click", () => {
        selectedId = null;
        deleting = false;
        renderKind();
      });
      list.append(el("li", {}, newBtn));
    }

    left.append(list);

    // The Seats region.
    const seats = el("div", { class: "seats-region", role: "region", "aria-label": "Seats" });
    renderSeats(seats);
    right.append(seats);

    mountStatus(right, "Desk updates");

    const form = el("form", { class: "content-form" });
    buildForm(form);
    right.append(form);

    live.append(left, right);
    page.append(live);
  }

  function listLabel(kind2: Kind): string {
    if (kind2 === "sessions") return "Sessions";
    if (kind2 === "hospitality") return "Evenings";
    if (kind2 === "hotels") return "Hotels";
    return "FAQ entries";
  }

  function announceDesk(message: string): void {
    announce("Desk updates", message);
  }

  interface FormState {
    values: Record<string, string>;
  }

  function buildForm(form: HTMLElement): void {
    clear(form);
    const editing = selectedId ? items.find((i) => String(i.id) === selectedId) : null;
    const values: Record<string, string> = {};
    for (const key of fieldNames(kind)) {
      const raw = editing ? editing[key] : null;
      values[key] = raw === null || raw === undefined ? "" : String(raw);
    }

    const inputs: Record<string, HTMLInputElement> = {};
    const errors: Record<string, HTMLElement> = {};

    if (kind === "sessions") {
      const share = el("div", { class: "share-status", role: "status", "aria-label": "Hands-on share", id: "share-status" });
      form.append(share);

      const projected = (): { minutes: number | string; format: string }[] => {
        const list = items.filter((i) => !deleting && selectedId !== null ? true : true) as unknown as Session[];
        const kept = deleting ? list.filter((i) => i.id !== selectedId) : list;
        const formValues = {
          minutes: inputs["minutes"]?.value ?? "",
          format: (form.querySelector<HTMLInputElement>("input[name='format']:checked"))?.value ?? values["format"] ?? "lecture",
        };
        if (selectedId && !deleting) {
          return kept.map((i) => (i.id === selectedId ? { ...i, minutes: formValues.minutes, format: formValues.format } : i));
        }
        if (!selectedId && !deleting) {
          return [...kept, { minutes: formValues.minutes, format: formValues.format }];
        }
        return kept;
      };

      const updateShare = () => {
        share.textContent = shareText(projected());
        const { h, t } = handsOnShare(projected());
        const ok = h * 10 >= t * 3;
        const minutesInput = inputs["minutes"];
        if (minutesInput) {
          minutesInput.setAttribute("aria-invalid", String(!ok));
          if (!ok) {
            minutesInput.setAttribute("aria-describedby", "minutes-error");
            if (!errors["minutes"]) {
              const err = formFieldError(HANDS_ON_ERROR);
              err.id = "minutes-error";
              errors["minutes"] = err;
              minutesInput.after(err);
            }
          } else if (errors["minutes"]) {
            errors["minutes"].remove();
            delete errors["minutes"];
            minutesInput.removeAttribute("aria-describedby");
          }
        }
      };

      for (const key of fieldNames(kind)) {
        const label = fieldLabels[key] ?? key;
        if (key === "format") {
          const radios = el("div", { class: "radios", role: "radiogroup", "aria-label": "Format" });
          const lecture = el("input", { type: "radio", name: "format", value: "lecture" }) as HTMLInputElement;
          const handsOn = el("input", { type: "radio", name: "format", value: "hands-on" }) as HTMLInputElement;
          if (values["format"] === "hands-on") handsOn.checked = true;
          else lecture.checked = true;
          radios.append(
            el("label", { class: "radiolabel" }, lecture, "Lecture"),
            el("label", { class: "radiolabel" }, handsOn, "Hands-on")
          );
          radios.addEventListener("change", updateShare);
          form.append(el("div", { class: "form-field" }, el("span", {}, "Format"), radios));
          continue;
        }
        const input = el("input", { type: "text", name: key, value: values[key] }) as HTMLInputElement;
        inputs[key] = input;
        if (key === "minutes") {
          input.addEventListener("input", updateShare);
        }
        form.append(field(label, input));
      }
      updateShare();
    } else {
      for (const key of fieldNames(kind)) {
        const label = fieldLabels[key] ?? key;
        const input = el("input", { type: "text", name: key, value: values[key] }) as HTMLInputElement;
        inputs[key] = input;
        form.append(field(label, input));
      }
    }

    const actions = el("div", { class: "hold-actions" });
    const save = el("button", { class: "btn btn-live", type: "submit" }, "Save");
    const del = el("button", { class: "btn btn-quiet", type: "button" }, "Delete");
    actions.append(save);
    if (selectedId) actions.append(del);

    if (deleting && kind === "sessions") {
      const confirm = el("button", { class: "btn btn-live", type: "button" }, "Confirm delete");
      const keep = el("button", { class: "btn", type: "button" }, "Keep session");
      confirm.addEventListener("click", async () => {
        try {
          await api(`/api/desk/content/sessions/${selectedId}`, { method: "DELETE" });
          selectedId = null;
          deleting = false;
          await loadKind();
          announceDesk("Saved. The public site shows it on the next load.");
        } catch (e) {
          if (e instanceof ApiFailure && e.body.errors?.minutes) {
            announceDesk(e.body.errors.minutes);
          }
        }
      });
      keep.addEventListener("click", () => {
        deleting = false;
        renderKind();
      });
      clear(actions);
      actions.append(confirm, keep);
    }

    del.addEventListener("click", () => {
      if (kind === "sessions") {
        deleting = true;
        renderKind();
        return;
      }
      void (async () => {
        await api(`/api/desk/content/${kind}/${selectedId}`, { method: "DELETE" });
        selectedId = null;
        await loadKind();
        announceDesk("Saved. The public site shows it on the next load.");
      })();
    });

    form.append(actions);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body: Record<string, unknown> = {};
      for (const key of fieldNames(kind)) {
        const value = inputs[key]?.value;
        if (key === "number" || key === "day" || key === "minutes" || key === "sort") {
          body[key] = Number(value ?? 0);
        } else {
          body[key] = value ?? "";
        }
      }
      if (kind === "sessions") {
        const checked = form.querySelector<HTMLInputElement>("input[name='format']:checked");
        body["format"] = checked?.value ?? "lecture";
      }
      try {
        if (selectedId && !deleting) {
          await api(`/api/desk/content/${kind}/${selectedId}`, { method: "PATCH", body: JSON.stringify(body) });
        } else {
          await api(`/api/desk/content/${kind}`, { method: "POST", body: JSON.stringify(body) });
        }
        selectedId = null;
        deleting = false;
        await loadKind();
        announceDesk("Saved. The public site shows it on the next load.");
      } catch (e) {
        if (e instanceof ApiFailure) {
          if (e.body.errors?.minutes === HANDS_ON_ERROR) {
            const minutesInput = inputs["minutes"];
            if (minutesInput && !errors["minutes"]) {
              minutesInput.setAttribute("aria-invalid", "true");
              const err = formFieldError(HANDS_ON_ERROR);
              err.id = "minutes-error";
              errors["minutes"] = err;
              minutesInput.after(err);
              minutesInput.setAttribute("aria-describedby", "minutes-error");
            }
          } else if (e.body.errors) {
            announceDesk(Object.values(e.body.errors)[0] ?? e.body.message);
          } else {
            announceDesk(e.body.message);
          }
        }
      }
    });
  }

  function fieldNames(kind2: Kind): string[] {
    if (kind2 === "sessions") return ["number", "day", "title", "format", "minutes", "outcomes"];
    if (kind2 === "hospitality") return ["title", "day", "starts_at", "venue", "tier", "description"];
    if (kind2 === "hotels") return ["name", "distance", "rate", "map_url"];
    return ["question", "answer", "sort"];
  }

  const fieldLabels: Record<string, string> = {
    number: "Number",
    day: "Day",
    title: "Title",
    format: "Format",
    minutes: "Minutes",
    outcomes: "Outcomes",
    starts_at: "Starts at",
    venue: "Venue",
    tier: "Tier",
    description: "Description",
    name: "Name",
    distance: "Distance",
    rate: "Rate",
    map_url: "Map URL",
    question: "Question",
    answer: "Answer",
    sort: "Sort",
  };

  load();
}
