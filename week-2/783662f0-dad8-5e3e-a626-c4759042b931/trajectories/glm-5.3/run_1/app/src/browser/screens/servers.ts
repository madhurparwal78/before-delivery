/** Your servers, the three-step checkout, and Billing. */

import { api, ApiError, errorFields } from "../lib/api.js";
import { h, clear, statusRegion, setStatus, asInput } from "../lib/dom.js";
import { registerRoute, navigate, currentMe, loadMe } from "../app.js";
import { stream } from "../lib/sse.js";
import { Copy } from "../../shared/copy.js";

registerRoute("/servers", (_params, render) => renderServers(render.main));
registerRoute("/servers/new", (_params, render) => renderRent(render.main));
registerRoute("/s/([^/]+)/billing", (params, render) => renderBilling(params[0]!, render.main));
registerRoute("/help", (_params, render) => renderHelp(render.main), true);

async function renderServers(main: HTMLElement): Promise<void> {
  clear(main);
  const me = currentMe();
  const list = h("ul", { "aria-label": "Servers" });
  for (const server of me?.servers ?? []) {
    list.append(
      h(
        "li",
        { class: "row-line" },
        h("a", { href: `/s/${server.slug}/billing`, onclick: (e: Event) => { e.preventDefault(); void navigate(`/s/${server.slug}/w/${server.worlds[0]?.slug ?? "home"}`); } }, server.name),
        h("span", {}, `${server.role === "owner" ? "Owner" : "Member"} · `),
        h("span", { class: "status-word" }, server.status_word)
      )
    );
  }
  main.append(
    h("h1", {}, "Your servers"),
    list,
    h("a", { href: "/servers/new", class: "button primary", onclick: (e: Event) => { e.preventDefault(); void navigate("/servers/new"); } }, "Rent a server")
  );
}

interface RentState {
  serverName: string;
  plan: "hamlet" | "borough" | "";
  step: number;
}

async function renderRent(main: HTMLElement): Promise<void> {
  clear(main);
  const state: RentState = { serverName: "", plan: "", step: 1 };
  const card = h("div", { class: "card" });
  const summary = h("aside", { class: "card" });
  const draw = (): void => {
    clear(card);
    clear(summary);
    const heading = h("h2", {}, `Step ${state.step} of 3: ${state.step === 1 ? "Name" : state.step === 2 ? "Plan" : "Review"}`);
    const status = statusRegion("Checkout status", "checkout-status");
    heading.id = "rent-heading";
    const next = h(
      "button",
      {
        class: "primary",
        onclick: async () => {
          if (state.step === 1) {
            if (state.serverName.trim() === "") {
              setStatus(status, "Enter a server name.");
              return;
            }
            state.step = 2;
          } else if (state.step === 2) {
            if (state.plan === "") {
              setStatus(status, "Choose a plan.");
              return;
            }
            state.step = 3;
          } else {
            const button = next;
            button.textContent = "Renting server";
            button.setAttribute("disabled", "");
            try {
              const key = `rent-${state.serverName}-${Date.now()}`;
              const res = await api<{ billing_url: string }>("/api/checkout", {
                method: "POST",
                idempotencyKey: key,
                body: { server_name: state.serverName, plan: state.plan },
              });
              await loadMe();
              await navigate(res.data.billing_url);
            } catch (err) {
              button.textContent = "Rent server";
              button.removeAttribute("disabled");
              if (err instanceof ApiError) {
                const fields = errorFields(err);
                setStatus(status, fields.server_name ?? fields.plan ?? (err.failure.error === "billing_unavailable" ? Copy.checkout.billingOutage : err.failure.message));
              }
            }
            return;
          }
          draw();
        },
      },
      state.step < 3 ? "Next" : "Rent server"
    );
    const back = state.step > 1
      ? h("button", {
          onclick: () => {
            state.step -= 1;
            draw();
          },
        }, "Back")
      : null;
    card.append(heading);
    if (state.step === 1) {
      const input = asInput(h("input", { type: "text", "aria-label": "Server name", value: state.serverName, oninput: (e: Event) => { state.serverName = (e.target as HTMLInputElement).value; } }));
      card.append(h("label", {}, "Server name"), input);
      setTimeout(() => input.focus(), 0);
    } else if (state.step === 2) {
      const group = h("div", { role: "radiogroup", "aria-label": "Plan" });
      for (const plan of [
        { id: "hamlet", label: "Hamlet, 6.00 USD a month", price: "6.00 USD a month", characters: 12, members: 6 },
        { id: "borough", label: "Borough, 12.00 USD a month", price: "12.00 USD a month", characters: 40, members: 20 },
      ]) {
        const radio = h("input", { type: "radio", name: "plan", id: `plan-${plan.id}`, value: plan.id, checked: state.plan === plan.id, onchange: () => { state.plan = plan.id as "hamlet" | "borough"; draw(); } });
        group.append(h("label", { for: `plan-${plan.id}` }, radio, plan.label));
      }
      card.append(group);
    } else {
      card.append(
        h("ul", {}, h("li", {}, `Server name: ${state.serverName}`), h("li", {}, `Plan: ${state.plan === "hamlet" ? "Hamlet" : "Borough"}`))
      );
    }
    card.append(h("div", { style: "display:flex; gap: 10px; margin-top: 14px" }, back, next), status);
    summary.append(
      h("h3", {}, "Summary"),
      h("p", {}, `${state.plan === "borough" ? "12.00" : state.plan === "hamlet" ? "6.00" : "—"} USD a month`),
      h("p", {}, `${state.plan === "borough" ? 40 : state.plan === "hamlet" ? 12 : "—"} characters`),
      h("p", {}, `${state.plan === "borough" ? 20 : state.plan === "hamlet" ? 6 : "—"} members`)
    );
  };
  draw();
  main.append(h("h1", {}, "Rent a server"), h("div", { class: "rail-layout" }, card, summary));
}

interface Billing {
  status: "pending_approval" | "active" | "past_due" | "suspended";
  status_word: string;
  plan: string;
  pending_plan: string | null;
  payment_pending: boolean;
  balance: string;
  provider_reachable: boolean;
}

function billingMessage(b: Billing, action: string): string {
  if (!b.provider_reachable) return Copy.billing.outage;
  if (action === "paid") return Copy.billing.confirmed;
  if (action === "plan-changed") return Copy.billing.planChanged(b.plan === "hamlet" ? "Hamlet" : "Borough");
  if (action === "pending") return Copy.billing.paymentPending;
  if (b.payment_pending) return Copy.billing.paymentPending;
  if (b.status === "pending_approval") return Copy.billing.pendingApproval;
  if (b.status === "past_due") return Copy.billing.pastDue("the grace deadline");
  if (b.status === "suspended") return Copy.billing.suspended;
  if (b.pending_plan !== null) return Copy.billing.pendingPlan(b.pending_plan === "hamlet" ? "Hamlet" : "Borough");
  return Copy.billing.active;
}

async function renderBilling(slug: string, main: HTMLElement): Promise<void> {
  clear(main);
  const heading = h("h1", {}, "Billing");
  const statusCard = h("div", { class: "card" });
  const status = statusRegion("Billing status", "billing-status");
  const statusWord = h("div", { class: "status-word" });
  let action = "";
  let billing: Billing | null = null;

  const drawStatus = (): void => {
    if (billing === null) return;
    clear(statusCard);
    statusWord.textContent = billing.status_word;
    statusCard.append(
      billing.provider_reachable ? h("p", { hidden: "true" }, Copy.billing.outage) : h("p", {}, Copy.billing.outage),
      statusWord,
      h("div", {}, `Plan: ${billing.plan === "hamlet" ? "Hamlet" : "Borough"}`),
      h("div", {}, `${billing.balance} USD due`)
    );
    setStatus(status, billingMessage(billing, action));
    if (status.parentElement === null) statusCard.append(status);
  };

  const reload = async (): Promise<void> => {
    const res = await api<Billing>(`/api/servers/${slug}/billing`);
    billing = res.data;
    drawStatus();
  };

  const approve = h(
    "button",
    {
      class: "primary",
      onclick: async () => {
        approve.textContent = "Asking the billing provider to take the payment.";
        action = "asking";
        drawStatus();
        try {
          const res = await api<Billing>(`/api/servers/${slug}/billing/payments`, { method: "POST", body: {} });
          billing = res.data;
          action = res.data.status === "active" && !res.data.payment_pending ? "paid" : "pending";
          drawStatus();
        } catch (err) {
          action = "";
          if (err instanceof ApiError) setStatus(status, err.failure.message);
        }
        setTimeout(reload, 10000);
      },
    },
    "Approve payment"
  );

  const planGroup = h("div", { role: "radiogroup", "aria-label": "Plan" });
  let planChoice: "hamlet" | "borough" = "hamlet";
  for (const plan of [
    { id: "hamlet", label: "Hamlet, 6.00 USD a month" },
    { id: "borough", label: "Borough, 12.00 USD a month" },
  ]) {
    planGroup.append(
      h("label", {}, h("input", { type: "radio", name: "billing-plan", value: plan.id, onchange: () => { planChoice = plan.id as "hamlet" | "borough"; } }), plan.label)
    );
  }
  const changePlan = h(
    "button",
    {
      onclick: async () => {
        action = "asking";
        drawStatus();
        try {
          const res = await api<Billing>(`/api/servers/${slug}/plan`, { method: "POST", body: { plan: planChoice } });
          billing = res.data;
          action = res.data.pending_plan === null ? "plan-changed" : "";
          drawStatus();
        } catch (err) {
          action = "";
          if (err instanceof ApiError) setStatus(status, err.failure.message);
        }
      },
    },
    "Change plan"
  );
  const statement = h("a", { href: `/api/servers/${slug}/billing/statement.csv`, class: "button" }, "Download statement");

  const left = h("div", {}, statusCard, approve);
  const right = h("div", {}, h("div", { class: "card" }, h("h3", {}, "Plan"), planGroup, changePlan), h("p", {}, statement));
  main.append(heading, h("div", { class: "rail-layout" }, left, right));
  await reload();
  setInterval(reload, 10000);
  stream(`/api/servers/${slug}/events`, {
    onEvent: () => {
      void reload();
    },
  });
}

async function renderHelp(main: HTMLElement): Promise<void> {
  clear(main);
  main.append(
    h("h1", {}, "Help"),
    h("h2", {}, "Keyboard shortcuts"),
    h(
      "table",
      { class: "plain" },
      h("tr", {}, h("th", {}, "Where"), h("th", {}, "Key"), h("th", {}, "Effect")),
      h("tr", {}, h("td", {}, "World map"), h("td", {}, "Shift+Arrow"), h("td", {}, "Walk the active character one tile")),
      h("tr", {}, h("td", {}, "World map or Tile inspector"), h("td", {}, "B"), h("td", {}, "Place a block")),
      h("tr", {}, h("td", {}, "World map or Tile inspector"), h("td", {}, "X"), h("td", {}, "Break a block")),
      h("tr", {}, h("td", {}, "World view"), h("td", {}, "F"), h("td", {}, "Enter or leave full screen")),
      h("tr", {}, h("td", {}, "World view"), h("td", {}, "I"), h("td", {}, "Open Inventory")),
      h("tr", {}, h("td", {}, "Any grid"), h("td", {}, "Arrow keys, Home, End"), h("td", {}, "Move one cell")),
      h("tr", {}, h("td", {}, "Replay board"), h("td", {}, "Left, Right, Home, End"), h("td", {}, "Step through moves"))
    )
  );
}
