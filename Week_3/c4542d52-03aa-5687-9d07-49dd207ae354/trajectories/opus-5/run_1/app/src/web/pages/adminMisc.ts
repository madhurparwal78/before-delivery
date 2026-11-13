import type { LedgerEntry, LiveEvent, Person, Role, Tender } from "../../shared/types.js";
import { formatCount, formatInstant, formatMoney, formatPricePerShare } from "../../shared/format.js";
import { api, ApiFailure } from "../api.js";
import { announce, applySocketState, type Page, type PageContext } from "../app.js";
import { clear, el, liveButton } from "../dom.js";
import { ROLE_LABELS } from "../labels.js";
import { pacificToInstant } from "../pacific.js";

export function ledgerPage(context: PageContext): Page {
  async function draw(): Promise<void> {
    const result = await api<{ entries: LedgerEntry[] }>("/api/ledger");
    clear(context.main);
    const rows = result.entries.map((entry) =>
      el("tr", {}, [
        el("td", {}, [formatInstant(entry.at)]),
        el("td", {}, [entry.holder_name ?? ""]),
        el("td", {}, [entry.kind]),
        el("td", {}, [entry.class ?? ""]),
        el("td", {}, [formatCount(entry.shares_delta)]),
        el("td", {}, [formatCount(entry.options_delta)]),
        el("td", {}, [entry.reference ?? ""]),
      ]),
    );
    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, ["Every change to the register, newest first."]),
        el("div", { class: "column" }, [
          el("h1", { class: "chapter-title" }, ["Securities ledger"]),
          el("table", { class: "ledger-table", "aria-label": "Securities ledger" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { scope: "col" }, ["When"]),
                el("th", { scope: "col" }, ["Holder"]),
                el("th", { scope: "col" }, ["Entry"]),
                el("th", { scope: "col" }, ["Class"]),
                el("th", { scope: "col" }, ["Shares"]),
                el("th", { scope: "col" }, ["Options"]),
                el("th", { scope: "col" }, ["Reference"]),
              ]),
            ]),
            el("tbody", {}, rows),
          ]),
        ]),
      ]),
    );
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "cap_table") void draw();
    },
  };
}

export function adminTendersPage(context: PageContext): Page {
  const errors = new Map<string, HTMLElement>();

  function setError(name: string, message: string | null): void {
    const node = errors.get(name);
    if (node === undefined) return;
    node.hidden = message === null;
    node.textContent = message === null ? "" : `Error: ${message}`;
  }

  async function draw(): Promise<void> {
    const result = await api<{ tenders: Tender[] }>("/api/tenders");
    clear(context.main);
    errors.clear();

    const form = el("form", { class: "column form", "aria-label": "Open tender offer" }) as HTMLFormElement;
    const makeField = (id: string, label: string, name: string, hint?: string): HTMLInputElement => {
      const input = el("input", { type: "text", id }) as HTMLInputElement;
      const error = el("p", { class: "field-error", hidden: true });
      errors.set(name, error);
      const children: Array<Node | string> = [el("label", { for: id }, [label])];
      if (hint !== undefined) children.push(el("p", { class: "field-hint" }, [hint]));
      children.push(input, error);
      form.append(el("div", { class: "field" }, children));
      return input;
    };
    const title = makeField("tender-title", "Title", "title");
    const price = makeField("tender-price", "Price per share", "price_per_share");
    const cap = makeField("tender-cap", "Share cap", "share_cap");
    const closes = makeField("tender-closes", "Closes at", "closes_at", "YYYY-MM-DD HH:MM, Pacific time");
    const open = liveButton("Open tender", { class: "primary" });
    form.append(open);
    form.addEventListener("submit", (event) => event.preventDefault());

    open.addEventListener("click", () => {
      void (async () => {
        for (const name of errors.keys()) setError(name, null);
        try {
          const tender = await api<Tender>("/api/tenders", {
            method: "POST",
            body: {
              title: title.value,
              price_per_share: price.value,
              share_cap: Number(cap.value.replace(/[^\d]/g, "")),
              closes_at: pacificToInstant(closes.value),
            },
          });
          announce(`Tender ${tender.id} is open until ${formatInstant(tender.closes_at)}.`);
          await draw();
        } catch (failure) {
          if (!(failure instanceof ApiFailure)) throw failure;
          for (const [name, message] of Object.entries(failure.fields)) setError(name, message);
          announce(failure.message);
        }
      })();
    });

    const submissions = result.tenders.flatMap((tender) =>
      (tender.submissions ?? []).map((submission) =>
        el("tr", {}, [
          el("td", {}, [tender.id]),
          el("td", {}, [submission.holder_name]),
          el("td", {}, [formatCount(submission.shares)]),
          el("td", {}, [submission.allocation === null ? "" : formatCount(submission.allocation)]),
          el("td", {}, [submission.proceeds === null ? "" : formatMoney(submission.proceeds)]),
        ]),
      ),
    );

    const tenderRows = result.tenders.map((tender) =>
      el("tr", {}, [
        el("td", {}, [el("a", { href: `/tenders/${tender.id}`, "data-route": "" }, [tender.id])]),
        el("td", {}, [tender.title]),
        el("td", {}, [formatPricePerShare(tender.price_per_share)]),
        el("td", {}, [formatCount(tender.share_cap)]),
        el("td", {}, [formatInstant(tender.closes_at)]),
        el("td", {}, [tender.state]),
      ]),
    );

    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, ["One tender at a time, bought by Harbourline Secondary Partners."]),
        el("div", { class: "column" }, [
          el("h1", { class: "chapter-title" }, ["Tenders"]),
          form,
          el("table", { class: "ledger-table", "aria-label": "Tenders" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { scope: "col" }, ["Tender"]),
                el("th", { scope: "col" }, ["Title"]),
                el("th", { scope: "col" }, ["Price"]),
                el("th", { scope: "col" }, ["Cap"]),
                el("th", { scope: "col" }, ["Closes"]),
                el("th", { scope: "col" }, ["State"]),
              ]),
            ]),
            el("tbody", {}, tenderRows),
          ]),
          el("table", { class: "ledger-table", "aria-label": "Tender submissions" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { scope: "col" }, ["Tender"]),
                el("th", { scope: "col" }, ["Holder"]),
                el("th", { scope: "col" }, ["Shares"]),
                el("th", { scope: "col" }, ["Allocation"]),
                el("th", { scope: "col" }, ["Proceeds"]),
              ]),
            ]),
            el("tbody", {}, submissions),
          ]),
        ]),
      ]),
    );
    applySocketState();
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "tender_changed" || event.type === "tender_closed" || event.type === "tender_allocated") {
        void draw();
      }
    },
  };
}

export function peoplePage(context: PageContext): Page {
  const errors = new Map<string, HTMLElement>();

  function setError(name: string, message: string | null): void {
    const node = errors.get(name);
    if (node === undefined) return;
    node.hidden = message === null;
    node.textContent = message === null ? "" : `Error: ${message}`;
  }

  async function draw(): Promise<void> {
    const result = await api<{ people: Person[] }>("/api/people");
    clear(context.main);
    errors.clear();

    const rows = result.people.map((entry) => {
      const roleSelect = el(
        "select",
        { "aria-label": `Role for ${entry.name}`, class: "live-action" },
        (["board_member", "option_holder", "investor"] as Role[]).map((role) =>
          el("option", { value: role, selected: entry.role === role }, [ROLE_LABELS[role]]),
        ),
      ) as HTMLSelectElement;
      roleSelect.addEventListener("change", () => {
        void (async () => {
          try {
            await api(`/api/people/${entry.id}`, { method: "PATCH", body: { role: roleSelect.value } });
            announce(`${entry.name} is now ${ROLE_LABELS[roleSelect.value as Role]}.`);
          } catch (failure) {
            if (!(failure instanceof ApiFailure)) throw failure;
            announce(failure.message);
          }
          await draw();
        })();
      });
      const remove = liveButton(`Remove access for ${entry.name}`);
      remove.addEventListener("click", () => {
        void (async () => {
          try {
            await api(`/api/people/${entry.id}/remove-access`, { method: "POST", body: {} });
            announce(`Access removed for ${entry.name}.`);
          } catch (failure) {
            if (!(failure instanceof ApiFailure)) throw failure;
            announce(failure.message);
          }
          await draw();
        })();
      });
      const departure = liveButton(`Record departure for ${entry.name}`);
      departure.addEventListener("click", () => {
        void (async () => {
          try {
            const updated = await api<{ person: Person }>(`/api/people/${entry.id}/departure`, {
              method: "POST",
              body: {},
            });
            announce(
              `Departure recorded for ${entry.name}. Their exercise window ends at ${formatInstant(updated.person.departure?.window_ends_at ?? "")}.`,
            );
          } catch (failure) {
            if (!(failure instanceof ApiFailure)) throw failure;
            announce(failure.message);
          }
          await draw();
        })();
      });
      return el("tr", {}, [
        el("td", {}, [entry.name]),
        el("td", {}, [entry.email]),
        el("td", {}, [ROLE_LABELS[entry.role]]),
        el("td", {}, [entry.access]),
        el("td", {}, [roleSelect]),
        el("td", {}, [remove, departure]),
      ]);
    });

    const form = el("form", { class: "column form", "aria-label": "Add person" }) as HTMLFormElement;
    const makeField = (id: string, label: string, name: string, type = "text"): HTMLInputElement => {
      const input = el("input", { type, id }) as HTMLInputElement;
      const error = el("p", { class: "field-error", hidden: true });
      errors.set(name, error);
      form.append(el("div", { class: "field" }, [el("label", { for: id }, [label]), input, error]));
      return input;
    };
    const name = makeField("person-name", "Name", "name");
    const email = makeField("person-email", "Email", "email");
    const roleError = el("p", { class: "field-error", hidden: true });
    errors.set("role", roleError);
    const roleSelect = el(
      "select",
      { id: "person-role", class: "live-action" },
      (["board_member", "option_holder", "investor"] as Role[]).map((role) =>
        el("option", { value: role, selected: role === "option_holder" }, [ROLE_LABELS[role]]),
      ),
    ) as HTMLSelectElement;
    form.append(
      el("div", { class: "field" }, [el("label", { for: "person-role" }, ["Role"]), roleSelect, roleError]),
    );
    const password = makeField("person-password", "Initial password", "password", "password");
    const add = liveButton("Add person", { class: "primary" });
    form.append(add);
    form.addEventListener("submit", (event) => event.preventDefault());
    add.addEventListener("click", () => {
      void (async () => {
        for (const key of errors.keys()) setError(key, null);
        try {
          await api<{ person: Person }>("/api/people", {
            method: "POST",
            body: {
              name: name.value,
              email: email.value,
              role: roleSelect.value,
              password: password.value,
            },
          });
          announce(`${name.value} added as ${ROLE_LABELS[roleSelect.value as Role]}.`);
          await draw();
        } catch (failure) {
          if (!(failure instanceof ApiFailure)) throw failure;
          for (const [key, message] of Object.entries(failure.fields)) setError(key, message);
          announce(failure.message);
        }
      })();
    });

    context.main.append(
      el("div", { class: "axis-grid" }, [
        el("p", { class: "side-note" }, ["Everyone who can open the register."]),
        el("div", { class: "column" }, [
          el("h1", { class: "chapter-title" }, ["People"]),
          el("table", { class: "ledger-table", "aria-label": "People" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { scope: "col" }, ["Name"]),
                el("th", { scope: "col" }, ["Email"]),
                el("th", { scope: "col" }, ["Role"]),
                el("th", { scope: "col" }, ["Access"]),
                el("th", { scope: "col" }, ["Change role"]),
                el("th", { scope: "col" }, ["Actions"]),
              ]),
            ]),
            el("tbody", {}, rows),
          ]),
          form,
        ]),
      ]),
    );
    applySocketState();
  }

  return {
    render: draw,
    onEvent(event: LiveEvent): void {
      if (event.type === "person_changed") void draw();
    },
  };
}
