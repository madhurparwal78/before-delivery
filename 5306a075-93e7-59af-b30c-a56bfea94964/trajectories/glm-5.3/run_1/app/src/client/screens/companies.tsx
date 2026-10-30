import { api, ApiFailure } from "../api.js";
import { h, monthLabel } from "../dom.js";
import { feedback, openDialog, statusLabel } from "../ui.js";

/** Companies list and company page with requests (DP-29, DP-10, DP-34). */
export async function renderCompanies(
  _screen: HTMLElement,
  fail: (err: unknown) => void,
  companyId?: string,
): Promise<HTMLElement> {
  const root = h("div", null);
  if (companyId === undefined) {
    try {
      const result = await api.companies();
      root.appendChild(h("h2", null, "Companies"));
      const table = h("table", { "aria-label": "Companies" });
      table.appendChild(h("thead", null,
        h("tr", null,
          h("th", null, "Company"),
          h("th", null, "Domains"),
          h("th", null, "Contacts"),
          h("th", null, "Notes"),
        ),
      ));
      const tbody = h("tbody", null);
      for (const company of result.companies) {
        tbody.appendChild(h("tr", null,
          h("td", null, h("a", { href: `/companies/${company.id}`, "data-nav": true }, company.name)),
          h("td", null, company.domains.join(", ")),
          h("td", { class: "num" }, String(company.contacts.length)),
          h("td", { class: "num" }, String(company.noteCount)),
        ));
      }
      table.appendChild(tbody);
      root.appendChild(table);
    } catch (err) {
      fail(err);
    }
    return root;
  }

  try {
    const result = await api.company(companyId);
    const company = result.company;
    root.appendChild(h("h2", null, company.name));
    root.appendChild(h("p", null, company.domains.join(", ")));
    root.appendChild(
      h("button", {
        onclick: (event: MouseEvent) => openMergeDialog(event.currentTarget as HTMLElement),
      }, "Merge into…"),
    );

    const contacts = h("ul", null);
    for (const contact of company.contacts) {
      contacts.appendChild(h("li", null, `${contact.name} · ${contact.email}`));
    }
    root.appendChild(h("h3", null, "Contacts"));
    root.appendChild(contacts);

    // Requests: each feature this company asked for (DP-29).
    const requests = h("ul", { "aria-label": "Requests" });
    for (const request of company.requests) {
      requests.appendChild(
        h("li", null,
          h("a", { href: `/features/${request.featureId}`, "data-nav": true }, request.featureName),
          h("span", { class: "status-chip" },
            ` · ${statusLabel(request.status)}`,
          ),
          request.shipped && request.releaseName !== null && request.targetMonth !== null
            ? h("span", null, ` · Shipped in ${request.releaseName} · ${monthLabel(request.targetMonth)}`)
            : null,
        ),
      );
    }
    root.appendChild(h("h3", null, "Requests"));
    root.appendChild(requests);

    // The company's notes, drawn from the inbox lists (DP-34).
    const notesList = h("ul", null);
    root.appendChild(h("h3", null, "Notes"));
    root.appendChild(notesList);
    const contactNames = new Set(company.contacts.map((c) => c.name));
    const seen = new Set<string>();
    for (const status of ["unprocessed", "snoozed", "processed"]) {
      let cursor: string | null = null;
      for (let page = 0; page < 50; page++) {
        const result = await api.notes(status, 100, cursor);
        for (const item of result.notes) {
          if (contactNames.has(item.contactName ?? "") && !seen.has(item.id)) {
            seen.add(item.id);
            notesList.appendChild(
              h("li", null, h("a", { href: `/inbox/${item.id}`, "data-nav": true }, item.title),
                ` · ${statusLabel(item.status)}`),
            );
          }
        }
        cursor = result.nextCursor;
        if (cursor === null) break;
      }
    }
  } catch (err) {
    fail(err);
  }
  return root;
}

function openMergeDialog(opener: HTMLElement | null): void {
  openDialog(async (close) => {
    const wrap = h("div", { "aria-label": "Merge company" });
    wrap.appendChild(h("h2", null, "Merge company"));
    const select = h("select", { "aria-label": "Merge into" }) as HTMLSelectElement;
    const result = await api.companies();
    for (const company of result.companies) {
      select.appendChild(h("option", { value: company.id }, company.name));
    }
    const form = h(
      "form",
      {
        onsubmit: async (event: SubmitEvent) => {
          event.preventDefault();
          feedback?.saveStatus("Merging…");
          try {
            const sourceId = new URL(location.href).pathname.split("/").pop() ?? "";
            const sourceName = document.querySelector("h2")?.textContent ?? "";
            const merged = await api.merge(sourceId, select.value);
            feedback?.saveStatus(`Merged ${sourceName} into ${merged.company.name}.`);
            close();
            history.replaceState(null, "", "/companies");
            window.dispatchEvent(new PopStateEvent("popstate"));
          } catch (err) {
            feedback?.saveStatus("");
            if (err instanceof ApiFailure) {
              feedback?.alert(err.error.error.message);
            }
          }
        },
      },
      h("label", null, "Merge into"),
      select,
      h("div", { class: "dialog-actions" },
        h("button", { type: "submit", class: "primary" }, "Merge companies"),
        h("button", { type: "button", onclick: close }, "Cancel"),
      ),
    );
    wrap.appendChild(form);
    return wrap;
  }, opener);
}
