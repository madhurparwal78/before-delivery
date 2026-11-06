// Studio (contributor): my essays, and the essay editor with credits, frames, submission and withdrawal.
// Every save sends the version the form last read; a stale save keeps everything the person typed.
import { coopDate, coopTime, resolveWall } from "../shared/coop-time.js";
import { centsToDecimal, dollars, parseHundredths, percent } from "../shared/money.js";
import { attempt, call, failureText, get, type Answer } from "./api.js";
import { h, icon, replace, say } from "./dom.js";
import type { AppContext } from "./main.js";
import type { Essay } from "./types.js";
import { badge, ESSAY_STATE, KIND, mono, outageFrom, pageHead, statusLine } from "./ui.js";

const STALE = "This essay was changed elsewhere. Reload it before saving; your edits are still in the form.";
const STORAGE_DOWN = "Image storage is unreachable. Nothing was uploaded; try again shortly.";

interface Contributor {
  handle: string;
  name: string;
}

interface FrameBody {
  id: string;
  position: number;
  caption: string;
  filename?: string;
  essay_version: number;
}

const STATE_TONE: Record<string, string> = { embargoed: "embargo", in_review: "pending" };

export function mountStudio(root: HTMLElement, app: AppContext): () => void {
  const myHandle = app.user.contributor_handle ?? "";
  let contributors: Contributor[] = [];
  let essays: Essay[] = [];
  let editing: Essay | null = null;
  let version = 0;

  const listBody = h("div", { class: "studio-list-body" });
  const newButton = h("button", { type: "button", class: "button button-primary" }, icon("plus"), "New essay");
  const editor = h("div", { class: "studio-editor" });
  replace(root, pageHead("Studio", "Build an essay with your co-credits, set its embargo lift in co-op time and submit it to the desk."),
    h("div", { class: "studio" },
      h("section", { class: "studio-list", "aria-labelledby": "my-essays" },
        h("div", { class: "section-row" }, h("h2", { class: "section-title", id: "my-essays" }, "My essays"), newButton),
        listBody),
      editor));
  replace(editor, h("p", { class: "editor-placeholder" }, "Choose an essay from the list, or start a new one."));

  async function loadList(): Promise<void> {
    const answer = await attempt(() => get<{ essays: Essay[]; contributors: Contributor[] }>("/api/studio/essays"));
    outageFrom(answer);
    if (!answer?.ok || !answer.data) return;
    essays = answer.data.essays;
    contributors = answer.data.contributors;
    replace(listBody, essays.length ? h("ul", { class: "essay-list" }, ...essays.map((essay) => {
      const open = h("button", { type: "button", class: "button button-ghost" }, essay.state === "draft" ? "Edit" : "View");
      open.setAttribute("aria-label", `${essay.state === "draft" ? "Edit" : "View"} ${essay.title}`);
      open.addEventListener("click", () => showEditor(essay));
      return h("li", { class: "essay-item" },
        h("div", { class: "essay-item-head" },
          h("p", { class: "item-title" }, essay.title),
          badge(ESSAY_STATE[essay.state] ?? essay.state, STATE_TONE[essay.state] ?? "neutral")),
        h("p", { class: "item-meta" }, "Lift ", mono(essay.lift_display)),
        essay.licences?.length ? h("ul", { class: "licence-mini" }, ...essay.licences.map((l) => h("li", {},
          `${l.newsroom.name} · ${KIND[l.kind] ?? l.kind} · until `, mono(l.window_end_display), " · ", mono(dollars(l.amount_minor))))) : null,
        open);
    })) : h("p", { class: "item-meta" }, "No essays yet."));
  }

  function showEditor(essay: Essay | null): void {
    editing = essay;
    version = essay?.version ?? 0;
    replace(editor, buildForm(essay));
    (editor.querySelector<HTMLInputElement>("#essay-title"))?.focus();
  }

  function buildForm(essay: Essay | null): HTMLElement {
    const draft = !essay || essay.state === "draft";
    const status = statusLine("Essay status");
    const stale = h("p", { role: "alert", class: "stale-alert", hidden: true });
    const errors = new Map<string, HTMLElement>();
    const errorFor = (key: string): HTMLElement => {
      const el = h("p", { class: "field-error", id: `err-${key}`, hidden: true });
      errors.set(key, el);
      return el;
    };
    const input = (id: string, attrs: Record<string, string | number | boolean> = {}): HTMLInputElement =>
      h("input", { id, type: "text", autocomplete: "off", disabled: !draft, ...attrs });

    const title = input("essay-title", { maxlength: 160, value: essay?.title ?? "" });
    const caption = h("textarea", { id: "essay-caption", rows: 3, disabled: !draft });
    caption.value = essay?.caption ?? "";
    const lift = input("essay-lift", { placeholder: "YYYY-MM-DDTHH:mm", value: essay?.lift_local ?? "", inputmode: "numeric" });
    const liftPreview = h("div", { class: "lift-preview", "aria-live": "polite" });
    const exDays = input("essay-exclusive-days", { type: "number", min: 1, max: 14, step: 1, value: essay?.exclusive_days ?? "" });
    const stDays = input("essay-standard-days", { type: "number", min: 1, max: 30, step: 1, value: essay?.standard_days ?? "" });
    const money = (cents: number | undefined): string => (cents === undefined ? "" : centsToDecimal(cents));
    const exPrice = input("essay-exclusive-price", { inputmode: "decimal", placeholder: "450.00", value: money(essay?.exclusive_price_minor) });
    const stPrice = input("essay-standard-price", { inputmode: "decimal", placeholder: "450.00", value: money(essay?.standard_price_minor) });

    const showLift = (): void => {
      const resolved = resolveWall(lift.value.trim());
      if (!resolved) {
        replace(liftPreview);
        return;
      }
      const day = coopDate(lift.value.trim().slice(0, 10));
      replace(liftPreview, h("p", { class: "mono" }, `Lifts ${coopTime(resolved.at)}`),
        resolved.resolution === "first_occurrence" ? h("p", {}, `That time happens twice on ${day}; Saltprint uses the first.`)
          : resolved.resolution === "shifted_after_gap" ? h("p", {}, `That time doesn't exist on ${day}; Saltprint uses ${coopTime(resolved.at)}.`)
            : null);
    };
    lift.addEventListener("blur", showLift);
    if (essay) showLift();

    // Credits
    const rows = h("div", { class: "credit-rows" });
    const total = h("p", { class: "shares-total mono" });
    const credits: { select: HTMLSelectElement; share: HTMLInputElement }[] = [];
    const updateTotal = (): void => {
      const sum = credits.reduce((acc, c) => acc + (parseHundredths(c.share.value) ?? 0), 0);
      total.textContent = `Shares total ${percent(sum)}% of 100.00%`;
      total.classList.toggle("is-complete", sum === 10000);
    };
    const renumber = (): void => {
      [...rows.children].forEach((row, i) => {
        const n = i + 1;
        const [label, select, shareLabel, share, remove] = [row.querySelector(".credit-label"), row.querySelector("select"),
          row.querySelector(".share-label"), row.querySelector("input"), row.querySelector("button")];
        if (label) label.textContent = `Co-contributor ${n}`;
        if (shareLabel) shareLabel.textContent = `Share ${n} (percent)`;
        select?.setAttribute("id", `credit-${n}`);
        label?.setAttribute("for", `credit-${n}`);
        share?.setAttribute("id", `share-${n}`);
        shareLabel?.setAttribute("for", `share-${n}`);
        remove?.setAttribute("aria-label", `Remove co-contributor ${n}`);
      });
    };
    const addRow = (handle: string, split: number | null): HTMLSelectElement => {
      const select = h("select", { disabled: !draft },
        h("option", { value: "" }, "Choose a contributor"),
        ...contributors.map((c) => h("option", { value: c.handle, selected: c.handle === handle }, c.name)));
      const share = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", disabled: !draft,
        value: split === null ? "" : percent(split).replace(/\.00$/, "") });
      const remove = h("button", { type: "button", class: "button button-icon", disabled: !draft }, icon("x"));
      const row = h("div", { class: "credit-row" },
        h("div", { class: "field" }, h("label", { class: "credit-label" }), select),
        h("div", { class: "field field-share" }, h("label", { class: "share-label" }), share),
        remove);
      const entry = { select, share };
      credits.push(entry);
      share.addEventListener("input", updateTotal);
      remove.addEventListener("click", () => {
        credits.splice(credits.indexOf(entry), 1);
        row.remove();
        renumber();
        updateTotal();
        addCredit.focus();
      });
      rows.append(row);
      renumber();
      updateTotal();
      return select;
    };
    const addCredit = h("button", { type: "button", class: "button button-ghost", disabled: !draft }, icon("plus"), "Add co-contributor");
    addCredit.addEventListener("click", () => addRow("", null).focus());
    if (essay) for (const c of essay.credits) addRow(c.handle, c.split_bp ?? null);
    else addRow(myHandle, null);

    // Frames
    const frameList = h("ul", { class: "studio-frames" });
    const uploadStatus = statusLine("Upload status");
    const upload = h("input", { id: "frame-upload", type: "file", multiple: true, accept: "image/jpeg,image/png",
      disabled: !draft || !essay });
    const frames: FrameBody[] = (essay?.frames ?? []).map((f) => ({ ...f, essay_version: version }));
    const renderFrames = (): void => {
      replace(frameList, ...frames.map((frame) => {
        const cap = h("input", { type: "text", id: `frame-caption-${frame.id}`, value: frame.caption, disabled: !draft, maxlength: 500 });
        cap.addEventListener("change", () => void (async () => {
          const answer = await attempt(() => call<FrameBody>("PATCH", `/api/frames/${encodeURIComponent(frame.id)}`, { caption: cap.value }));
          if (answer?.ok && answer.data) {
            version = answer.data.essay_version;
            frame.caption = answer.data.caption;
          } else say(status, answer?.error?.fields?.caption ?? failureText(answer));
        })());
        const remove = h("button", { type: "button", class: "button button-icon", "aria-label": `Remove frame ${frame.position}`, disabled: !draft },
          icon("trash"));
        remove.addEventListener("click", () => void (async () => {
          const answer = await attempt(() => call("DELETE", `/api/frames/${encodeURIComponent(frame.id)}`));
          if (answer?.ok) {
            version = Number((answer.headers.get("etag") ?? "").replace(/"/g, "")) || version;
            frames.splice(frames.indexOf(frame), 1);
            frames.forEach((f, i) => { f.position = i + 1; });
            renderFrames();
          } else say(status, failureText(answer));
        })());
        return h("li", { class: "studio-frame" },
          h("img", { src: `/media/frames/${encodeURIComponent(frame.id)}/grid`, alt: "", width: 600, height: 600 }),
          h("label", { for: cap.id }, `Caption for frame ${frame.position}`), cap, remove);
      }));
    };
    renderFrames();
    upload.addEventListener("change", () => void (async () => {
      const files = [...(upload.files ?? [])];
      for (const file of files) {
        if (!editing) break;
        say(uploadStatus, `Uploading ${file.name}…`);
        const data = new FormData();
        data.append("file", file, file.name);
        const answer: Answer<FrameBody> | null = await attempt(() =>
          call<FrameBody>("POST", `/api/essays/${encodeURIComponent(editing?.id ?? "")}/frames`, data));
        if (answer?.ok && answer.data) {
          version = answer.data.essay_version;
          frames.push(answer.data);
          renderFrames();
          say(uploadStatus, `${file.name} uploaded.`);
        } else if (answer?.status === 503 && answer.error?.code === "storage_unavailable") {
          say(uploadStatus, STORAGE_DOWN);
          break;
        } else {
          say(uploadStatus, `${file.name}: ${answer?.error?.fields?.file ?? answer?.error?.fields?.caption ?? failureText(answer)}`);
        }
      }
      upload.value = "";
    })());

    // Save, submit, withdraw
    const save = h("button", { type: "submit", class: "button button-primary", disabled: !draft }, "Save draft");
    const submitReview = h("button", { type: "button", class: "button button-ghost", disabled: !draft || !essay }, "Submit for review");
    const withdraw = h("button", { type: "button", class: "button button-ghost",
      disabled: !essay || !(essay.state === "embargoed" || essay.state === "live") || essay.withdrawal_requested === true },
    "Request withdrawal");

    const fieldInputs: Record<string, HTMLElement> = {
      title, caption, lift_local: lift, exclusive_days: exDays, standard_days: stDays,
      exclusive_price_minor: exPrice, standard_price_minor: stPrice,
    };
    const clearErrors = (): void => {
      for (const [key, el] of errors) {
        el.hidden = true;
        el.textContent = "";
        const target = key === "credits" ? credits[0]?.select : fieldInputs[key];
        target?.removeAttribute("aria-describedby");
        target?.removeAttribute("aria-invalid");
      }
    };
    const showErrors = (fields: Record<string, string>): void => {
      let first: HTMLElement | null = null;
      for (const key of ["title", "caption", "lift_local", "exclusive_days", "standard_days", "exclusive_price_minor",
        "standard_price_minor", "credits", "frames"]) {
        const message = fields[key];
        const el = errors.get(key);
        if (!message || !el) continue;
        el.hidden = false;
        el.textContent = message;
        const target = key === "credits" ? credits[0]?.select ?? null : key === "frames" ? submitReview : fieldInputs[key] ?? null;
        if (target && key !== "frames") {
          target.setAttribute("aria-describedby", el.id);
          target.setAttribute("aria-invalid", "true");
        }
        first ??= target;
      }
      first?.focus();
    };

    const integerOr = (text: string): number | string => (/^\s*\d+\s*$/.test(text) ? Number(text) : text);
    const bodyOf = (): Record<string, unknown> => ({
      title: title.value,
      caption: caption.value,
      lift_local: lift.value.trim(),
      exclusive_days: integerOr(exDays.value),
      standard_days: integerOr(stDays.value),
      exclusive_price_minor: parseHundredths(exPrice.value) ?? exPrice.value,
      standard_price_minor: parseHundredths(stPrice.value) ?? stPrice.value,
      credits: credits.map((c) => ({ contributor: c.select.value, split_bp: parseHundredths(c.share.value) ?? c.share.value })),
    });

    const form = h("form", { class: "essay-form", "aria-label": "Essay details", novalidate: true },
      h("div", { class: "form-grid" },
        h("div", { class: "field field-wide" }, h("label", { for: "essay-title" }, "Title"), title, errorFor("title")),
        h("div", { class: "field field-wide" }, h("label", { for: "essay-caption" }, "Caption"), caption, errorFor("caption")),
        h("div", { class: "field field-wide" }, h("label", { for: "essay-lift" }, "Embargo lift (co-op time)"),
          h("p", { class: "field-help" }, "Year, month, day and 24-hour time in America/Chicago, e.g. 2026-11-20T08:00."),
          lift, liftPreview, errorFor("lift_local")),
        h("div", { class: "field" }, h("label", { for: "essay-exclusive-days" }, "Exclusive window days"), exDays, errorFor("exclusive_days")),
        h("div", { class: "field" }, h("label", { for: "essay-standard-days" }, "Standard window days"), stDays, errorFor("standard_days")),
        h("div", { class: "field" }, h("label", { for: "essay-exclusive-price" }, "Exclusive price (USD)"), exPrice, errorFor("exclusive_price_minor")),
        h("div", { class: "field" }, h("label", { for: "essay-standard-price" }, "Standard price (USD)"), stPrice, errorFor("standard_price_minor"))),
      h("fieldset", { class: "credits" },
        h("legend", {}, "Credits and split shares"),
        rows, total, errorFor("credits"), addCredit),
      h("div", { class: "form-actions" }, save));

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        clearErrors();
        stale.hidden = true;
        save.disabled = true;
        say(status, "Saving…");
        const answer = editing
          ? await attempt(() => call<Essay>("PATCH", `/api/essays/${encodeURIComponent(editing?.id ?? "")}`, bodyOf(),
            { "If-Match": `"${version}"` }))
          : await attempt(() => call<Essay>("POST", "/api/essays", bodyOf()));
        save.disabled = false;
        if (answer?.ok && answer.data) {
          editing = answer.data;
          version = answer.data.version;
          upload.disabled = false;
          submitReview.disabled = false;
          say(status, "Draft saved.");
          void loadList();
          return;
        }
        if (answer?.status === 412) {
          say(status, "");
          stale.textContent = STALE;
          stale.hidden = false;
          return;
        }
        say(status, answer?.status === 422 ? "" : failureText(answer));
        if (answer?.error?.fields) showErrors(answer.error.fields);
      })();
    });

    submitReview.addEventListener("click", () => void (async () => {
      if (!editing) return;
      clearErrors();
      submitReview.disabled = true;
      say(status, "Submitting…");
      const answer = await attempt(() => call<Essay>("POST", `/api/essays/${encodeURIComponent(editing?.id ?? "")}/submit`, {}));
      if (answer?.ok && answer.data) {
        editing = answer.data;
        version = answer.data.version;
        await loadList();
        const fresh = essays.find((e) => e.id === answer.data?.id) ?? answer.data;
        replace(editor, buildForm(fresh));
        say(editor.querySelector<HTMLElement>("[aria-label='Essay status']") ?? status, "Submitted. In review.");
        return;
      }
      submitReview.disabled = false;
      say(status, answer?.status === 422 ? "" : failureText(answer));
      if (answer?.error?.fields) showErrors(answer.error.fields);
    })());

    withdraw.addEventListener("click", () => void (async () => {
      if (!editing) return;
      withdraw.disabled = true;
      const answer = await attempt(() => call<Essay>("POST", `/api/essays/${encodeURIComponent(editing?.id ?? "")}/withdrawal-request`, {}));
      if (answer?.ok) {
        say(status, "Withdrawal requested.");
        void loadList();
      } else {
        withdraw.disabled = false;
        say(status, failureText(answer));
      }
    })());

    const notes = essay?.desk_notes ?? [];
    return h("section", { class: "editor-panel", "aria-labelledby": "editor-heading" },
      h("div", { class: "section-row" },
        h("h2", { class: "section-title", id: "editor-heading" }, essay ? essay.title : "New essay"),
        essay ? badge(ESSAY_STATE[essay.state] ?? essay.state, STATE_TONE[essay.state] ?? "neutral") : null),
      notes.length && essay?.state === "draft" ? h("div", { class: "desk-notes" },
        h("h3", { class: "ledger-subhead" }, "Desk notes"),
        ...notes.map((n) => h("p", {}, n.note, " ", h("span", { class: "mono item-meta" }, n.at_display)))) : null,
      stale, form,
      h("section", { class: "frames-panel", "aria-labelledby": "frames-heading" },
        h("h3", { class: "ledger-subhead", id: "frames-heading" }, "Frames"),
        h("label", { for: "frame-upload", class: "upload-label" }, icon("upload"), "Upload frames"),
        h("p", { class: "field-help" }, essay ? "JPEG or PNG, up to 25,000,000 bytes each, 24 frames per essay. Location data is removed from every copy newsrooms see."
          : "Save the draft first, then upload frames."),
        upload, uploadStatus, frameList, errorFor("frames")),
      h("div", { class: "form-actions" }, submitReview, withdraw),
      status);
  }

  // The editor needs the contributor list for its credit rows, so it waits for the first load.
  const firstLoad = loadList();
  newButton.addEventListener("click", () => void firstLoad.then(() => showEditor(null)));
  return () => undefined;
}
