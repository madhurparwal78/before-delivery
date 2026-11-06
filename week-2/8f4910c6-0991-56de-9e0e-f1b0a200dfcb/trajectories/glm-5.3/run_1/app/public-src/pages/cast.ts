import { api, el, link, button, announce, type Page, register, liveRegion } from "../pages.js";
import { readTray, writeTray, readCastDraft, writeCastDraft, clearCastDraft } from "../stores.js";
import { ApiFail, buildForm, problemsRegion, renderProblems, focusElement, readValues, type FieldSpec } from "../lib.js";

const castStatus = liveRegion("cast", "Cast announcements");

/** The tray with reorder and remove. */
const trayPage: Page = {
  path: "/tray",
  title: () => "Your tray",
  render: async (main) => {
    main.appendChild(el("h1", undefined, "Your tray"));
    const list = el("ul");
    list.setAttribute("aria-label", "Tray");
    const tray = readTray();
    tray.forEach((item, index) => {
      const li = el("li");
      li.setAttribute("aria-label", item.displayName);
      const name = link(`/talent/${item.slug}`, item.displayName);
      li.appendChild(name);
      const up = button("Up", () => move(index, -1));
      const down = button("Down", () => move(index, 1));
      const remove = button("Remove", () => removeAt(index));
      li.append(up, down, remove);
      list.appendChild(li);
    });
    main.appendChild(list);
    const start = link("/cast-request?step=1", "Start cast request", "btn");
    start.classList.add("primary");
    main.appendChild(start);
    main.appendChild(castStatus);
  },
};

function move(index: number, delta: number): void {
  const tray = readTray();
  const target = index + delta;
  if (target < 0 || target >= tray.length) return;
  const [item] = tray.splice(index, 1);
  tray.splice(target, 0, item);
  writeTray(tray);
  announce(castStatus, `Moved ${item.displayName} to position ${target + 1} of ${tray.length}.`);
  void rerender();
}

function removeAt(index: number): void {
  const tray = readTray();
  const [item] = tray.splice(index, 1);
  writeTray(tray);
  announce(castStatus, `Removed ${item.displayName}. ${tray.length} in tray.`);
  void rerender();
}

async function rerender(): Promise<void> {
  const { go } = await import("../app.js");
  await go(location.pathname + location.search);
}

register(trayPage);

/** The four-step cast request, step in the address. */
const castRequest: Page = {
  path: "/cast-request",
  title: () => "Cast request",
  render: async (main, params) => {
    const step = Math.min(4, Math.max(1, Number(params.get("step") || 1)));
    const draft = readCastDraft();
    const values = draft?.values || {};
    main.appendChild(el("h1", undefined, "Cast request"));
    const heading = el("h2", undefined, ["Your tray", "Your details", "The job", "Review and send"][step - 1]);
    heading.id = `cast-step-${step}`;
    main.appendChild(heading);

    const form = el("form") as HTMLFormElement;
    const problems = problemsRegion();
    form.appendChild(problems);

    const tray = readTray();
    if (step === 1) {
      const list = el("ul");
      for (const item of tray) {
        const li = el("li", undefined, item.displayName);
        li.setAttribute("aria-label", item.displayName);
        list.appendChild(li);
      }
      form.appendChild(list);
    }

    const fields: FieldSpec[] = [];
    if (step === 2) {
      fields.push(
        { name: "name", label: "Your name", value: values.name || "", required: true },
        { name: "company", label: "Company", value: values.company || "", required: true },
        { name: "email", label: "Email", type: "email", value: values.email || "", required: true },
      );
    }
    if (step === 3) {
      fields.push(
        { name: "office", label: "Office", type: "radio", options: [["toronto", "Toronto"], ["vancouver", "Vancouver"]], value: values.office || "toronto", required: true },
        { name: "shootDate", label: "Shoot date", type: "date", value: values.shootDate || "" },
      );
    }
    if (step === 4) {
      fields.push({ name: "brief", label: "Brief", type: "textarea", value: values.brief || "", required: true });
    }

    const state = {
      values,
      errors: {},
      keepDraft: (kept: Record<string, string>) => {
        const existing = readCastDraft();
        writeCastDraft({
          key: existing?.key || randomKey(),
          step,
          values: { ...values, ...kept },
        });
      },
    };

    const actions = el("div", "row");
    if (step > 1) {
      const back = button("Back", async () => {
        await goStep(step - 1);
      });
      actions.appendChild(back);
    }
    if (step < 4) {
      const next = button("Next", async () => {
        const current = readValues(form, fields);
        await state.keepDraft(current);
        try {
          await api("/api/cast-requests/checks", { body: { step, draft: { ...values, ...current, talentSlugs: tray.map((t) => t.slug) } } });
          await goStep(step + 1);
        } catch (err) {
          if (err instanceof ApiFail && err.status === 422) {
            applyStepErrors(problems, form, fields, err.body);
          }
        }
      }, "primary");
      actions.appendChild(next);
    } else {
      const send = button("Send cast request", async () => {
        const current = readValues(form, fields);
        await state.keepDraft(current);
        try {
          const key = draft?.key || randomKey();
          const result = (await api("/api/cast-requests", {
            headers: { "Idempotency-Key": key },
            body: {
              name: values.name || "",
              company: values.company || "",
              email: values.email || "",
              office: values.office || "toronto",
              shootDate: values.shootDate || null,
              brief: current.brief,
              talentSlugs: tray.map((t) => t.slug),
            },
          })) as { reference: string };
          clearCastDraft();
          writeTray([]);
          const confirmation = el("section");
          confirmation.append(
            el("h2", undefined, "Cast request sent"),
            el("p", undefined, `Cast request ${result.reference} sent. A booker in ${values.office === "vancouver" ? "Vancouver" : "Toronto"} will reply by email.`),
          );
          main.textContent = "";
          main.appendChild(confirmation);
          focusElement(confirmation.querySelector("h2") as HTMLElement);
        } catch (err) {
          if (err instanceof ApiFail && err.status === 422) {
            applyStepErrors(problems, form, fields, err.body);
          } else if (err instanceof ApiFail) {
            announce(castStatus, copyForError(err));
          }
        }
      }, "primary");
      actions.appendChild(send);
    }
    if (fields.length > 0) buildForm(form, fields, state, () => {});
    form.appendChild(actions);
    main.appendChild(form);
    main.appendChild(castStatus);
    focusElement(heading);
  },
};

function randomKey(): string {
  return Array.from({ length: 24 }, () => Math.random().toString(36)[2] || "0").join("");
}

function applyStepErrors(problems: HTMLElement, form: HTMLFormElement, fields: FieldSpec[], body: Record<string, unknown>): void {
  const errors = (body.errors as Record<string, string>) || {};
  renderProblems(problems, errors, form, fields);
  const first = Object.keys(errors)[0];
  if (first) {
    const target = form.querySelector<HTMLElement>(`#f-${first}`) || form.querySelector<HTMLElement>(`input[name="f-${first}"]`);
    target?.focus();
  }
}

function copyForError(err: ApiFail): string {
  if (err.status === 429) {
    const retry = (err.body.retryAfterSeconds as number) || 1;
    return `Too many requests from this connection. Try again in ${retry} seconds.`;
  }
  return "Something went wrong. Try again.";
}

async function goStep(step: number): Promise<void> {
  const { go } = await import("../app.js");
  await go(`/cast-request?step=${step}`);
}

register(castRequest);
