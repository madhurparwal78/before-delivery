import { el, label, navigate, busy, showFieldError, aria } from "../dom";
import { api, errorText, fieldErrors }  from "../api";

export function navBar(active: string): HTMLElement {
  const links = el("nav", { className: "links", "aria-label": "Main", role: "navigation" });
  aria(links, { label: "Main" });
  links.setAttribute("role", "navigation");
  links.setAttribute("aria-label", "Main");
  links.append(
    el("a", { href: "/", text: "Product", className: active === "product" ? "active" : "" }),
    el("a", { href: "/pricing", text: "Pricing", className: active === "pricing" ? "active" : "" }),
    el("a", { href: "/login", text: "Sign in" }),
    el("a", { href: "/signup", className: "btn primary", text: "Start free trial", style: { textDecoration: "none" } }),
  );
  const bar = el("div", { className: "pub-nav" });
  bar.append(
    el("a", { href: "/", className: "brand" }, document.createTextNode("Orrery "), el("span", { className: "mark", text: "Studio" })),
    links,
  );
  return bar;
}

export function homeView(root: HTMLElement): void {
  root.append(navBar("product"));
  const grid = el("div", { className: "home-grid" });
  const rail = el("div", { className: "rail", "aria-hidden": "true" });
  rail.append(
    el("span", { className: "num", text: "01" }),
    el("span", { className: "num", text: "02" }),
    el("span", { className: "num", text: "03" }),
    el("span", { className: "num", text: "04" }),
    el("span", { className: "num", text: "05" }),
  );
  const content = el("div");
  content.append(
    el("h1", { text: "3D scenes your whole team can trace" }),
    el(
      "section",
      { className: "region", "aria-labelledby": "s1h" },
      el("h2", { id: "s1h", text: "What Orrery Studio is" }),
      el("p", { text: "A browser workspace where brand teams build interactive 3D launch scenes together. Every change is an attributed operation on an append-only log." }),
    ),
    el(
      "section",
      { className: "region", "aria-labelledby": "s2h" },
      el("h2", { id: "s2h", text: "How the operation-log rewind works" }),
      el("p", { text: "Drag the timeline playhead to any operation. The viewport re-renders the scene as it was, changed objects flash an outline, and restoring appends new operations without losing history." }),
    ),
    el(
      "section",
      { className: "region", "aria-labelledby": "s3h" },
      el("h2", { id: "s3h", text: "Agents under the same rules as people" }),
      el("p", { text: "Issue scoped agent tokens. Their batched operations share the same locks, undo and audit trail as any teammate." }),
    ),
    el(
      "section",
      { className: "region", "aria-labelledby": "s4h" },
      el("h2", { id: "s4h", text: "Plans" }),
      el("p", { text: "Team and Business plans, monthly or annual, with seats that prorate through the billing gateway." }),
      el("a", { href: "/pricing", className: "btn", text: "Compare plans" }),
    ),
    el(
      "section",
      { className: "region", "aria-labelledby": "s5h" },
      el("h2", { id: "s5h", text: "Start a trial" }),
      el("p", { text: "Fourteen days, no card, your own workspace in under a minute." }),
      el("a", { href: "/signup", className: "btn primary", text: "Start free trial" }),
    ),
  );
  grid.append(rail, content);
  root.append(el("div", { className: "wrap" }, grid));
}

const PLANS: Record<string, { name: string; monthly: number; annual: number; seats: number; seatMonthly: number; seatAnnual: number; tokens: string }> = {
  team: { name: "Team", monthly: 9600, annual: 96000, seats: 8, seatMonthly: 1200, seatAnnual: 12000, tokens: "Up to 5" },
  business: { name: "Business", monthly: 38000, annual: 380000, seats: 20, seatMonthly: 1600, seatAnnual: 16000, tokens: "Up to 25" },
};

export function pricingView(root: HTMLElement): void {
  root.append(navBar("pricing"));
  const page = el("div", { className: "page" });
  page.append(el("h1", { text: "Pricing" }));

  let period = "monthly";
  const group = el("div", { role: "radiogroup", "aria-label": "Billing period", className: "states-row" });
  const monthly = el("button", { role: "radio", "aria-checked": "true", text: "Monthly", className: "btn" });
  const annual = el("button", { role: "radio", "aria-checked": "false", text: "Annual", className: "btn" });
  monthly.setAttribute("aria-checked", "true");
  group.append(monthly, annual);
  const table = el("table", { className: "data", role: "table" });
  label(table, "Compare plans");
  table.setAttribute("aria-label", "Compare plans");
  const thead = el("thead");
  thead.append(
    el("tr", {}, el("th", {}), el("th", { text: "Team" }), el("th", { text: "Business" })),
  );
  const tbody = el("tbody");
  const rowPrice = el("tr");
  rowPrice.append(el("td", {}, el("strong", { text: "Price" })));
  const priceTeam = el("td", { className: "num" });
  const priceBusiness = el("td", { className: "num" });
  rowPrice.append(priceTeam, priceBusiness);
  const rowSeats = el("tr");
  rowSeats.append(el("td", {}, el("strong", { text: "Included seats" })), el("td", { className: "num", text: "8" }), el("td", { className: "num", text: "20" }));
  const rowExtra = el("tr");
  rowExtra.append(el("td", {}, el("strong", { text: "Extra seat" })));
  const extraTeam = el("td", { className: "num" });
  const extraBusiness = el("td", { className: "num" });
  rowExtra.append(extraTeam, extraBusiness);
  const rowTokens = el("tr");
  rowTokens.append(el("td", {}, el("strong", { text: "Agent tokens" })), el("td", { text: "Up to 5" }), el("td", { text: "Up to 25" }));
  const rowScheduled = el("tr");
  rowScheduled.append(el("td", {}, el("strong", { text: "Scheduled publishing" })), el("td", { text: "Included" }), el("td", { text: "Included" }));
  const rowReview = el("tr");
  rowReview.append(el("td", {}, el("strong", { text: "Review links" })), el("td", { text: "Included" }), el("td", { text: "Included" }));
  tbody.append(rowPrice, rowSeats, rowExtra, rowTokens, rowScheduled, rowReview);
  table.append(thead, tbody);

  const cta = el("a", { href: "/signup", className: "btn primary", text: "Start free trial" });
  label(cta, "Start free trial");

  function renderPrices(): void {
    const suffix = period === "monthly" ? "/ month" : "/ year";
    priceTeam.textContent = `$${(PLANS.team![period as "monthly" | "annual"] / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${suffix}`;
    priceBusiness.textContent = `$${(PLANS.business![period as "monthly" | "annual"] / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${suffix}`;
    extraTeam.textContent = `$${(PLANS.team![period === "monthly" ? "seatMonthly" : "seatAnnual"] / 100).toFixed(2)} ${suffix}`;
    extraBusiness.textContent = `$${(PLANS.business![period === "monthly" ? "seatMonthly" : "seatAnnual"] / 100).toFixed(2)} ${suffix}`;
    monthly.setAttribute("aria-checked", String(period === "monthly"));
    annual.setAttribute("aria-checked", String(period === "annual"));
  }

  monthly.addEventListener("click", () => {
    period = "monthly";
    renderPrices();
  });
  annual.addEventListener("click", () => {
    period = "annual";
    renderPrices();
  });
  monthly.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      period = "monthly";
      renderPrices();
    }
  });
  annual.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      period = "annual";
      renderPrices();
    }
  });
  renderPrices();

  page.append(group, table, el("div", { style: { marginTop: "20px" } }, cta));
  root.append(page);
}

function formStatus(root: HTMLElement): HTMLElement {
  const status = el("div", { className: "status", role: "status" });
  label(status, "Form status");
  root.append(status);
  return status;
}

export function signupView(root: HTMLElement): void {
  root.append(navBar(""));
  const col = el("div", { className: "panel form-col" });
  col.append(el("h1", { text: "Start your trial" }));
  const form = el("form", { role: "form" });
  form.setAttribute("aria-label", "Start your trial");

  const fields: Record<string, HTMLInputElement> = {};
  function field(name: string, labelText: string, type = "text"): void {
    const input = el("input", { type, id: `su-${name}` }) as HTMLInputElement;
    const wrap = el("div", { className: "field" });
    const lbl = el("label", { for: input.id, text: labelText });
    wrap.append(lbl, input);
    fields[name] = input;
    form.append(wrap);
  }
  field("workspaceName", "Workspace name");
  field("name", "Your name");
  field("email", "Work email", "email");
  field("password", "Password", "password");

  const zones = (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf("timeZone");
  const tzComboWrap = el("div", { className: "field" });
  const tzCombo = el("select", { id: "su-tz", "aria-label": "Time zone" }) as HTMLSelectElement;
  for (const zone of zones) {
    const opt = el("option", { value: zone, text: zone }) as HTMLOptionElement;
    if (zone === "UTC") opt.selected = true;
    tzCombo.append(opt);
  }
  tzComboWrap.append(el("label", { for: "su-tz", text: "Time zone" }), tzCombo);
  form.append(tzComboWrap);

  const status = formStatus(form);
  const submit = el("button", { className: "btn primary", type: "submit", text: "Start 14-day trial" });
  form.append(submit);
  col.append(form);
  root.append(el("div", { className: "wrap" }, col));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = busy(submit);
    b.start();
    setStatusText(status, "");
    try {
      await api("/api/signup", {
        method: "POST",
        body: {
          workspaceName: fields.workspaceName!.value,
          name: fields.name!.value,
          email: fields.email!.value,
          password: fields.password!.value,
          timeZone: tzCombo.value,
        },
      });
      navigate("/app");
    } catch (err) {
      const errors = fieldErrors(err);
      for (const [path, message] of Object.entries(errors)) {
        const input = ({ workspaceName: fields.workspaceName, name: fields.name, email: fields.email, password: fields.password } as Record<string, HTMLInputElement>)[path];
        if (input) showFieldError(input, message);
      }
      const body = (err as { body?: Record<string, unknown> }).body;
      if (body?.error === "email_taken") {
        setStatusText(status, "That email already has a workspace. Sign in instead.", true);
      } else if (Object.keys(errors).length === 0) {
        setStatusText(status, errorText(err), true);
      } else {
        const first = Object.values(errors)[0];
        setStatusText(status, typeof first === "string" ? first : errorText(err), true);
      }
    } finally {
      b.end();
    }
  });
}

function setStatusText(status: HTMLElement, text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

export function loginView(root: HTMLElement): void {
  root.append(navBar(""));
  const col = el("div", { className: "panel form-col" });
  col.append(el("h1", { text: "Sign in" }));
  const form = el("form", {});
  form.setAttribute("aria-label", "Sign in");
  const email = el("input", { type: "email", id: "li-email" }) as HTMLInputElement;
  const password = el("input", { type: "password", id: "li-password" }) as HTMLInputElement;
  const emailWrap = el("div", { className: "field" }, el("label", { for: email.id, text: "Email" }), email);
  const passwordWrap = el("div", { className: "field" }, el("label", { for: password.id, text: "Password" }), password);
  const status = formStatus(form);
  const submit = el("button", { className: "btn primary", type: "submit", text: "Sign in" });
  form.append(emailWrap, passwordWrap, submit);
  col.append(form);
  root.append(el("div", { className: "wrap" }, col));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = busy(submit);
    b.start();
    setStatusText(status, "Signing in…");
    try {
      await api("/api/auth/login", { method: "POST", body: { email: email.value, password: password.value } });
      navigate("/app");
    } catch (err) {
      setStatusText(status, "Email or password is incorrect.", true);
    } finally {
      b.end();
    }
  });
}

export async function inviteView(root: HTMLElement, token: string): Promise<void> {
  root.append(navBar(""));
  const col = el("div", { className: "panel form-col" });
  let workspaceName = "this workspace";
  try {
    const info = (await api(`/api/invites/${token}`)) as { workspace: { name: string }; email: string };
    workspaceName = info.workspace.name;
  } catch {
    col.append(el("p", { className: "status error", text: "This invitation is no longer valid." }));
    root.append(el("div", { className: "wrap" }, col));
    return;
  }
  col.append(el("h1", { text: `Join ${workspaceName}` }));
  const form = el("form", {});
  form.setAttribute("aria-label", `Join ${workspaceName}`);
  const name = el("input", { type: "text", id: "iv-name" }) as HTMLInputElement;
  const password = el("input", { type: "password", id: "iv-password" }) as HTMLInputElement;
  form.append(
    el("div", { className: "field" }, el("label", { for: name.id, text: "Your name" }), name),
    el("div", { className: "field" }, el("label", { for: password.id, text: "Password" }), password),
  );
  const status = formStatus(form);
  const submit = el("button", { className: "btn primary", type: "submit", text: `Join ${workspaceName}` });
  form.append(submit);
  col.append(form);
  root.append(el("div", { className: "wrap" }, col));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = busy(submit);
    b.start();
    setStatusText(status, "");
    try {
      await api(`/api/invites/${token}/accept`, { method: "POST", body: { name: name.value, password: password.value } });
      navigate("/app");
    } catch (err) {
      const body = (err as { body?: Record<string, unknown> }).body;
      if (body?.error === "email_taken") {
        setStatusText(status, "That email already has a workspace. Sign in instead.", true);
      } else {
        setStatusText(status, errorText(err), true);
      }
    } finally {
      b.end();
    }
  });
}
