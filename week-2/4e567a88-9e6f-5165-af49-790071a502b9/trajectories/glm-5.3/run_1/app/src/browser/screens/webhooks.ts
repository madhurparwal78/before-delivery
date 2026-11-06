// The Webhooks screen: endpoints, signing secret, delivery log, re-enable.
import type { AppCtx } from "../main.js";
import type { Endpoint, Delivery } from "../types.js";
import { api, h, clear, notice, alertNotice, openDialog, stateWord } from "../lib.js";

export function renderWebhooks(ctx: AppCtx): void {
  const { main } = ctx;
  clear(main);
  const teamBar = h("div", {});
  const urlInput = h("input", { type: "text", "aria-label": "Endpoint URL" }) as HTMLInputElement;
  const endpointsWrap = h("div", { class: "table-wrap" });
  main.append(
    h("div", { class: "screen-title" }, h("h1", { text: "Webhooks" })),
    teamBar,
    h("section", { class: "panel" },
      h("header", {}, h("h2", { text: "Endpoints" })),
      h("div", { class: "panel-body" },
        h("form", {
          "aria-label": "Add endpoint",
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const btn = (e.target as HTMLFormElement).querySelector("button") as HTMLButtonElement;
            btn.textContent = "Checking address…";
            btn.disabled = true;
            const res = await api<{ endpoint: Endpoint }>("POST", "/api/webhook-endpoints", { url: urlInput.value });
            btn.textContent = "Add endpoint";
            btn.disabled = false;
            if (res.status === 201) {
              showSecret(res.body.endpoint.secret ?? "");
              void refresh();
            } else if (res.status === 409) {
              alertNotice(res.body.error?.message ?? "This team already has 5 endpoints.");
            } else if (res.status === 422) {
              const fields = (res.body as unknown as { error: { fields?: Record<string, string> } }).error.fields ?? {};
              alertNotice(fields.url ?? res.body.error?.message ?? "Fix the highlighted fields.");
            } else {
              alertNotice(res.body.error?.message ?? "The endpoint could not be added.");
            }
          },
        },
          h("div", { class: "inline-fields" },
            h("div", { class: "field" }, h("label", { text: "Endpoint URL" }), urlInput),
            h("div", { class: "field" }, h("button", { class: "btn", type: "submit", text: "Add endpoint" })),
          ),
        ),
        endpointsWrap,
      ),
    ),
  );

  if (ctx.member.role === "admin") {
    const sel = h("select", { "aria-label": "Team" }) as HTMLSelectElement;
    for (const t of ctx.teams) sel.append(h("option", { value: t.id, text: t.name, selected: t.id === ctx.selectedTeam() ? true : undefined }));
    sel.addEventListener("change", () => { ctx.onTeamChange(sel.value); void refresh(); });
    teamBar.append(h("div", { class: "toolbar" }, h("div", { class: "field" }, h("label", { text: "Team" }), sel)));
  }

  function showSecret(secret: string): void {
    let handle: { close(): void } | null = null;
    handle = openDialog({
      label: "Signing secret",
      build(root) {
        root.append(
          h("header", {}, h("h2", { text: "Signing secret" }),
            h("button", { class: "btn btn-ghost", text: "Done", onclick: () => handle?.close() })),
          h("div", { class: "dialog-body" },
            h("p", { text: "Endpoint added. Copy the signing secret now; it is shown once." }),
            h("p", { class: "num", text: secret }),
            h("div", { class: "dialog-actions" },
              h("button", { class: "btn", text: "Copy secret", onclick: async () => {
                await navigator.clipboard.writeText(secret).catch(() => undefined);
                notice("Signing secret copied.");
              } }),
            ),
          ),
        );
      },
    });
  }

  function showDeliveries(endpoint: Endpoint): void {
    let handle: { close(): void } | null = null;
    handle = openDialog({
      label: `Deliveries for ${endpoint.url}`,
      build(root) {
        root.append(
          h("header", {}, h("h2", { text: `Deliveries for ${endpoint.url}` }),
            h("button", { class: "btn btn-ghost", text: "Close", onclick: () => handle?.close() })),
          h("div", { class: "dialog-body" },
            h("div", { class: "table-wrap" }, h("table", { "aria-label": "Deliveries" },
              h("thead", {}, h("tr", {},
                h("th", { text: "Event" }), h("th", { text: "Type" }), h("th", { text: "Job" }),
                h("th", { text: "Attempt" }), h("th", { text: "At" }), h("th", { text: "Status" }), h("th", { text: "Outcome" }),
              )),
              h("tbody", {}),
            ))),
        );
        void api<{ deliveries: Delivery[] }>("GET", `/api/webhook-endpoints/${endpoint.id}/deliveries`).then((res) => {
          if (res.status !== 200) return;
          const tbody = root.querySelector("tbody") as HTMLElement;
          for (const d of res.body.deliveries) {
            tbody.append(h("tr", {},
              h("td", { class: "num", text: d.event_id }),
              h("td", { text: d.event_type }),
              h("td", { class: "num", text: d.job_id }),
              h("td", { class: "num", text: String(d.attempt) }),
              h("td", { class: "num", text: d.attempted_at }),
              h("td", { class: "num", text: d.status_code === null ? "—" : String(d.status_code) }),
              h("td", { text: d.outcome }),
            ));
          }
        });
      },
    });
  }

  async function refresh(): Promise<void> {
    const query = ctx.member.role === "admin" ? `?team=${ctx.selectedTeam() ?? ""}` : "";
    const res = await api<{ endpoints: Endpoint[] }>("GET", `/api/webhook-endpoints${query}`);
    if (res.status !== 200) return;
    clear(endpointsWrap);
    if (res.body.endpoints.length === 0) {
      endpointsWrap.append(h("div", { class: "empty-note", text: "No endpoints yet." }));
      return;
    }
    const table = h("table", { "aria-label": "Endpoints" },
      h("thead", {}, h("tr", {},
        h("th", { text: "URL" }), h("th", { text: "State" }), h("th", { text: "Consecutive failures" }),
        h("th", { text: "Created by" }), h("th", { text: "Actions" }),
      )),
      h("tbody", {}),
    );
    const tbody = table.querySelector("tbody") as HTMLElement;
    for (const ep of res.body.endpoints) {
      const actions = h("td", {},
        h("button", { class: "link-btn", text: "Deliveries", "aria-label": `Deliveries for ${ep.url}`, onclick: () => showDeliveries(ep) }),
      );
      if (ctx.member.role === "admin" && ep.state === "disabled") {
        actions.append(h("button", {
          class: "link-btn", text: "Re-enable", "aria-label": `Re-enable ${ep.url}`,
          onclick: async () => {
            const r = await api<{ endpoint: Endpoint }>("POST", `/api/webhook-endpoints/${ep.id}/enable`);
            if (r.status === 200) {
              notice("Endpoint re-enabled.");
              void refresh();
            } else {
              alertNotice(r.body.error?.message ?? "That endpoint is not disabled.");
            }
          },
        }));
      }
      actions.append(h("button", {
        class: "link-btn", text: "Remove", "aria-label": `Remove ${ep.url}`,
        onclick: async () => {
          const r = await api("DELETE", `/api/webhook-endpoints/${ep.id}`);
          if (r.status === 204) void refresh();
          else alertNotice((r.body as unknown as { error: { message: string } }).error?.message ?? "The remove failed.");
        },
      }));
      tbody.append(h("tr", {},
        h("td", { class: "num", text: ep.url }),
        h("td", { text: stateWord(ep.state) }),
        h("td", { class: "num", text: String(ep.consecutive_failures) }),
        h("td", { text: ep.created_by.name }),
        actions,
      ));
    }
    endpointsWrap.append(table);
  }

  void refresh();
  const timer = window.setInterval(() => void refresh(), 3000);
  const obs = new MutationObserver(() => {
    if (!document.body.contains(main)) {
      window.clearInterval(timer);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}
