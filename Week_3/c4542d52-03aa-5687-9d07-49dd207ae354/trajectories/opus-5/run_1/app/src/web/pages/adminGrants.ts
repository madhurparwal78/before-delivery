import type { Grant, LiveEvent, Person, Valuation } from "../../shared/types.js";
import { formatCount, formatDate, formatInstant, formatPricePerShare } from "../../shared/format.js";
import { api, ApiFailure } from "../api.js";
import { announce, announceOnce, applySocketState, navigate, type Page, type PageContext } from "../app.js";
import { clear, el, liveButton } from "../dom.js";
import { GRANT_STATE_WORDS } from "../labels.js";

interface ValuationView {
  valuations: Valuation[];
  current_id: string | null;
}

export function adminGrantsPage(context: PageContext): Page {
  let lapsedBand: HTMLElement | null = null;

  async function draw(): Promise<void> {
    const [grants, valuations] = await Promise.all([
      api<{ grants: Grant[] }>("/api/grants"),
      api<ValuationView>("/api/valuations"),
    ]);
    clear(context.main);
    const newGrant = liveButton("New grant", { class: "primary" });
    newGrant.addEventListener("click", () => {
      void (async () => {
        try {
          const grant = await api<Grant>("/api/grants", { method: "POST", body: {} });
          navigate(`/admin/grants/${grant.id}`);
        } catch (failure) {
          if (!(failure instanceof ApiFailure)) throw failure;
          announce(failure.message);
          await draw();
        }
      })();
    });

    const column = el("div", { class: "column" }, [el("h1", { class: "chapter-title" }, ["Grants"]), newGrant]);

    if (valuations.current_id === null) {
      const lapsed = valuations.valuations.find((valuation) => valuation.status === "lapsed");
      const copy =
        lapsed === undefined
          ? "Record a valuation before issuing grants."
          : `The current valuation lapsed on ${formatDate(lapsed.expires_on)}. Record a new valuation before issuing grants.`;
      lapsedBand = el("section", { class: "band band-ink lapsed-band" }, [el("p", {}, [copy])]);
      column.append(lapsedBand);
      announceOnce(`lapsed-${copy}`, copy);
    }

    if (grants.grants.length === 0) {
      column.append(el("section", { class: "band band-ink full" }, [el("p", {}, ["You hold no grants yet."])]));
    } else {
      const rows = grants.grants.map((grant) => {
        const cells = [
          el("td", {}, [el("a", { href: `/admin/grants/${grant.id}`, "data-route": "" }, [grant.id])]),
          el("td", {}, [grant.holder_name ?? ""]),
          el("td", {}, [grant.options === null ? "" : formatCount(grant.options)]),
          el("td", {}, [GRANT_STATE_WORDS[grant.state]]),
        ];
        const actions = el("td", {});
        if (grant.state === "approved") {
          const send = liveButton(`Send offer ${grant.id}`);
          send.addEventListener("click", () => {
            void (async () => {
              try {
                const offered = await api<Grant>(`/api/grants/${grant.id}/offer`, { method: "POST", body: {} });
                announce(`Offer for ${grant.id} sent. It lapses at ${formatInstant(offered.offer_expires_at ?? "")}.`);
              } catch (failure) {
                if (!(failure instanceof ApiFailure)) throw failure;
                announce(failure.message);
              }
              await draw();
            })();
          });
          actions.append(send);
        }
        cells.push(actions);
        return el("tr", {}, cells);
      });
      column.append(
        el("table", { class: "ledger-table", "aria-label": "Grants" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { scope: "col" }, ["Grant"]),
              el("th", { scope: "col" }, ["Holder"]),
              el("th", { scope: "col" }, ["Options"]),
              el("th", { scope: "col" }, ["State"]),
              el("th", { scope: "col" }, ["Offer"]),
            ]),
          ]),
          el("tbody", {}, rows),
        ]),
      );
    }

    context.main.append(
      el("div", { class: "axis-grid" }, [el("p", { class: "side-note" }, ["Every grant on the register."]), column]),
    );
    applySocketState();
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "grant_changed" || event.type === "valuation_changed" || event.type === "cap_table") {
        void draw();
      }
    },
  };
}

export function grantFormPage(context: PageContext): Page {
  const grantId = context.params["id"] ?? "";
  let draftVersion = 1;
  let lastFieldId: string | null = null;
  let submitButton: HTMLButtonElement | null = null;

  const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const errors = new Map<string, HTMLElement>();

  function setError(name: string, message: string | null): void {
    const node = errors.get(name);
    if (node === undefined) return;
    if (message === null) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    node.hidden = false;
    node.textContent = `Error: ${message}`;
  }

  function showDraftChanged(): void {
    const existing = document.getElementById("draft-changed");
    if (existing !== null) existing.remove();
    const keep = el("button", { type: "button" }, ["Keep editing"]) as HTMLButtonElement;
    const region = el("section", { class: "band band-red", role: "region", "aria-label": "Draft changed", id: "draft-changed" }, [
      el("p", {}, ["This draft changed in another tab. The latest version is shown."]),
      keep,
    ]);
    const form = document.getElementById("issue-grant-form");
    if (form !== null) form.append(region);
    const close = (): void => {
      region.remove();
      const field = lastFieldId === null ? null : controls.get(lastFieldId);
      if (field !== undefined && field !== null) field.focus();
    };
    keep.addEventListener("click", close);
    region.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    keep.focus();
  }

  let saveChain: Promise<void> = Promise.resolve();
  let savesInFlight = 0;

  /** The form sends its saves one at a time, each carrying the version the last save returned. */
  function saveField(name: string, value: string | number | null): Promise<void> {
    saveChain = saveChain.then(
      () => sendSave(name, value),
      () => sendSave(name, value),
    );
    return saveChain;
  }

  async function sendSave(name: string, value: string | number | null): Promise<void> {
    lastFieldId = name;
    savesInFlight += 1;
    try {
      const updated = await api<Grant>(`/api/grants/${grantId}`, {
        method: "PATCH",
        body: { [name]: value, draft_version: draftVersion },
      });
      draftVersion = updated.draft_version;
      const saved = document.getElementById("draft-saved");
      if (saved !== null) saved.hidden = false;
    } catch (failure) {
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.code === "draft_outdated") {
        const latest = failure.body.grant;
        if (latest !== undefined) {
          draftVersion = latest.draft_version;
          fillFields(latest, name);
        }
        showDraftChanged();
        return;
      }
      const message = Object.values(failure.fields)[0] ?? failure.message;
      setError(name, message);
    } finally {
      savesInFlight -= 1;
    }
  }

  function fillFields(grant: Grant, force: string | null = null): void {
    for (const [name, control] of controls) {
      if (document.activeElement === control && name !== force) continue;
      if (name === "vesting_type") continue;
      const value =
        name === "holder_id"
          ? grant.holder_id ?? ""
          : name === "options"
            ? grant.options === null
              ? ""
              : String(grant.options)
            : name === "strike"
              ? grant.strike ?? ""
              : grant.vesting_start ?? "";
      control.value = value;
    }
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="vesting_type"]')) {
      radio.checked = radio.value === grant.vesting_type;
    }
  }

  function applyLapse(copy: string | null): void {
    const existing = document.getElementById("lapsed-band");
    if (submitButton !== null) submitButton.dataset["blocked"] = copy === null ? "false" : "true";
    if (copy === null) {
      if (existing !== null) existing.remove();
      applySocketState();
      return;
    }
    if (existing === null) {
      const form = document.getElementById("issue-grant-form");
      if (form !== null) {
        form.prepend(el("section", { class: "band band-ink lapsed-band", id: "lapsed-band" }, [el("p", {}, [copy])]));
      }
    }
    announceOnce(`lapse-${copy}`, copy);
    applySocketState();
  }

  async function checkValuation(): Promise<void> {
    const valuations = await api<ValuationView>("/api/valuations");
    if (valuations.current_id !== null) {
      applyLapse(null);
      return;
    }
    const lapsedValuation = valuations.valuations.find((valuation) => valuation.status === "lapsed");
    applyLapse(
      lapsedValuation === undefined
        ? "Record a valuation before issuing grants."
        : `The current valuation lapsed on ${formatDate(lapsedValuation.expires_on)}. Record a new valuation before issuing grants.`,
    );
  }

  async function submit(): Promise<void> {
    if (submitButton === null) return;
    submitButton.textContent = "Sending";
    try {
      await api<Grant>(`/api/grants/${grantId}/submit`, { method: "POST", body: {} });
      announce(`Grant ${grantId} sent to the board for approval.`);
      navigate("/admin/grants");
    } catch (failure) {
      submitButton.textContent = "Submit to board";
      if (!(failure instanceof ApiFailure)) throw failure;
      for (const name of controls.keys()) setError(name, null);
      if (failure.status === 422) {
        let focused = false;
        for (const [name, message] of Object.entries(failure.fields)) {
          setError(name, message);
          if (!focused) {
            controls.get(name)?.focus();
            focused = true;
          }
        }
        return;
      }
      announce(failure.message);
      if (failure.code === "valuation_lapsed") applyLapse(failure.message);
    }
  }

  async function draw(): Promise<void> {
    const [grant, people] = await Promise.all([
      api<Grant>(`/api/grants/${grantId}`),
      api<{ people: Person[] }>("/api/people"),
    ]);
    draftVersion = grant.draft_version;
    clear(context.main);
    controls.clear();
    errors.clear();

    if (grant.state !== "draft") {
      context.main.append(
        el("div", { class: "axis-grid" }, [
          el("p", { class: "side-note" }, [grant.id]),
          el("div", { class: "column" }, [
            el("h1", { class: "chapter-title" }, [grant.id]),
            el("p", { class: "state-word" }, [GRANT_STATE_WORDS[grant.state]]),
            el("div", { class: "labelled" }, [
              el("span", { class: "labelled-label" }, ["Holder"]),
              el("span", { class: "labelled-value" }, [grant.holder_name ?? ""]),
            ]),
            el("div", { class: "labelled" }, [
              el("span", { class: "labelled-label" }, ["Options"]),
              el("span", { class: "labelled-value" }, [grant.options === null ? "" : formatCount(grant.options)]),
            ]),
            el("div", { class: "labelled" }, [
              el("span", { class: "labelled-label" }, ["Strike price"]),
              el("span", { class: "labelled-value" }, [
                grant.strike === null ? "" : formatPricePerShare(grant.strike),
              ]),
            ]),
            el("div", { class: "labelled" }, [
              el("span", { class: "labelled-label" }, ["Vesting start"]),
              el("span", { class: "labelled-value" }, [
                grant.vesting_start === null ? "" : formatDate(grant.vesting_start),
              ]),
            ]),
          ]),
        ]),
      );
      applySocketState();
      return;
    }

    const holders = people.people.filter((person) => person.role === "option_holder");
    holders.sort((left, right) => left.name.localeCompare(right.name, "en"));
    const holderSelect = el("select", { id: "grant-holder", class: "live-action" }, [
      el("option", { value: "" }, ["Choose an option holder"]),
      ...holders.map((holder) =>
        el("option", { value: holder.id, selected: holder.id === grant.holder_id }, [holder.name]),
      ),
    ]) as HTMLSelectElement;
    const optionsInput = el("input", {
      type: "text",
      id: "grant-options",
      inputmode: "numeric",
      value: grant.options === null ? "" : String(grant.options),
    }) as HTMLInputElement;
    const strikeInput = el("input", {
      type: "text",
      id: "grant-strike",
      value: grant.strike ?? "",
    }) as HTMLInputElement;
    const startInput = el("input", {
      type: "text",
      id: "grant-start",
      value: grant.vesting_start ?? "",
      "aria-describedby": "grant-start-hint",
    }) as HTMLInputElement;

    controls.set("holder_id", holderSelect);
    controls.set("options", optionsInput);
    controls.set("strike", strikeInput);
    controls.set("vesting_start", startInput);

    const makeError = (name: string): HTMLElement => {
      const node = el("p", { class: "field-error", hidden: true });
      errors.set(name, node);
      return node;
    };

    const radios = (
      [
        ["standard", "4 years, 1-year cliff"],
        ["monthly", "4 years monthly, no cliff"],
      ] as const
    ).map(([value, label]) => {
      const radio = el("input", {
        type: "radio",
        name: "vesting_type",
        id: `vesting-${value}`,
        value,
        checked: grant.vesting_type === value,
      }) as HTMLInputElement;
      radio.addEventListener("change", () => void saveField("vesting_type", value));
      return el("div", { class: "radio" }, [radio, el("label", { for: `vesting-${value}` }, [label])]);
    });
    const radioGroup = el("div", { role: "radiogroup", "aria-label": "Vesting type", class: "radio-group" }, [
      ...radios,
      makeError("vesting_type"),
    ]);

    submitButton = liveButton("Submit to board", { class: "primary", id: "submit-to-board" });
    submitButton.addEventListener("click", () => void submit());
    const deleteButton = liveButton("Delete draft");
    deleteButton.addEventListener("click", () => {
      void (async () => {
        await api(`/api/grants/${grantId}`, { method: "DELETE" }).catch(() => undefined);
        navigate("/admin/grants");
      })();
    });

    const form = el("form", { class: "column form", id: "issue-grant-form", "aria-label": "Issue grant" }, [
      el("div", { class: "field" }, [
        el("label", { for: "grant-holder" }, ["Holder"]),
        holderSelect,
        makeError("holder_id"),
      ]),
      el("div", { class: "field" }, [
        el("label", { for: "grant-options" }, ["Options"]),
        optionsInput,
        makeError("options"),
      ]),
      el("div", { class: "field" }, [
        el("label", { for: "grant-strike" }, ["Strike price"]),
        strikeInput,
        makeError("strike"),
      ]),
      radioGroup,
      el("div", { class: "field" }, [
        el("label", { for: "grant-start" }, ["Vesting start"]),
        el("p", { class: "field-hint", id: "grant-start-hint" }, ["YYYY-MM-DD"]),
        startInput,
        makeError("vesting_start"),
      ]),
      el("p", { class: "draft-saved", id: "draft-saved", hidden: true }, ["Draft saved"]),
      el("div", { class: "actions" }, [submitButton, deleteButton]),
    ]) as HTMLFormElement;

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submit();
    });

    holderSelect.addEventListener("change", () => void saveField("holder_id", holderSelect.value || null));
    const debounce = new Map<string, number>();
    const typed = (name: string, control: HTMLInputElement, read: () => string | number | null): void => {
      control.addEventListener("input", () => {
        const existing = debounce.get(name);
        if (existing !== undefined) window.clearTimeout(existing);
        debounce.set(
          name,
          window.setTimeout(() => {
            const value = read();
            if (value === null) return;
            void saveField(name, value);
          }, 400),
        );
      });
      control.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void submit();
        }
      });
    };
    typed("options", optionsInput, () => {
      const value = Number(optionsInput.value.replace(/[^\d]/g, ""));
      return Number.isInteger(value) && value >= 1 ? value : null;
    });
    typed("strike", strikeInput, () => (/^\d+(\.\d{1,4})?$/.test(strikeInput.value) ? strikeInput.value : null));
    typed("vesting_start", startInput, () => (/^\d{4}-\d{2}-\d{2}$/.test(startInput.value) ? startInput.value : null));

    context.main.append(
      el("div", { class: "axis-grid" }, [el("p", { class: "side-note" }, [grant.id]), form]),
    );
    await checkValuation();
    applySocketState();
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "valuation_changed") {
        void checkValuation();
        return;
      }
      if (event.type === "grant_changed" && event.data["grant_id"] === grantId) {
        if (event.data["reason"] === "draft_saved") {
          const version = event.data["draft_version"];
          if (savesInFlight > 0) return;
          if (typeof version === "number" && version <= draftVersion) return;
          void api<Grant>(`/api/grants/${grantId}`).then((grant) => fillFields(grant));
          return;
        }
        void draw();
      }
    },
  };
}
