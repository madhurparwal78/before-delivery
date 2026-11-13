// public.ts — the landing page and sign in.

import { api } from "./api";
import { h, heading, button, textbox, statusLine } from "./dom";
import { navigate } from "./main";
import { state } from "./state";

export function renderLanding(app: HTMLElement): void {
  const main = h("main", { class: "landing" },
    heading(1, h("span", null, "Every clock in the firm,"), h("br", null), h("span", null, "agreeing to the second.")),
    h("p", { class: "sentence" }, "One shared calendar for New York, London and Auckland, where a weekly meeting never drifts and nothing goes through email."),
    h("div", { class: "landing-actions" },
      h("a", { href: "/signin", class: "btn accent" }, "Sign in"),
      h("a", { href: "#three-clocks", class: "text-link" }, "See the three clocks")
    ),
    h("section", { role: "Three clocks example", "aria-label": "Three clocks example", id: "three-clocks", class: "clocks-panel" },
      h("div", { class: "clock-row selected", "aria-label": "Partners' weekly, Tue 6 Oct 2026, 09:00 New York, 14:00 London, 02:00 Auckland" },
        h("span", { class: "ev-title" }, "Partners' weekly"),
        h("span", { class: "ev-date" }, "Tue 6 Oct 2026"),
        clockCell("09:00", "New York"),
        clockCell("14:00", "London"),
        clockCell("02:00", "Auckland"),
        h("span", { class: "pointer", "aria-hidden": "true" })
      ),
      h("div", { class: "clock-row", "aria-label": "Client readout, Tue 6 Oct 2026, 11:30 New York, 16:30 London, 04:30 Auckland" },
        h("span", { class: "ev-title" }, "Client readout"),
        h("span", { class: "ev-date" }, "Tue 6 Oct 2026"),
        clockCell("11:30", "New York"),
        clockCell("16:30", "London"),
        clockCell("04:30", "Auckland")
      )
    )
  );
  app.appendChild(main);
}

function clockCell(time: string, city: string): HTMLElement {
  const cell = h("div", { class: "clock-cell" });
  const stack = h("div", { class: "numeral-stack" });
  for (const ch of time) {
    stack.appendChild(h("span", { class: "digit" }, ch === ":" ? ":" : ch));
  }
  cell.append(stack, h("span", { class: "clock-city" }, city), h("span", { class: "clock-bar inside" }));
  return cell;
}

export function renderSignIn(app: HTMLElement): void {
  const email = textbox("Email", "");
  email.type = "email";
  const passcode = textbox("Passcode", "");
  passcode.type = "password";
  const err = h("p", { class: "form-error", role: "alert", hidden: "hidden" });
  const form = h("form", { class: "sign-in-form", onsubmit: async (e: Event) => {
    e.preventDefault();
    err.hidden = true;
    statusLine("Signing in...");
    try {
      const { data } = await api.signIn(email.value.trim(), passcode.value);
      state.me = data.person;
      await state.load();
      statusLine("");
      navigate("/calendar", {});
    } catch {
      err.hidden = false;
      err.textContent = "That email and passcode do not match.";
      statusLine("That email and passcode do not match.");
    }
  } },
    h("label", { for: "" }, "Email"),
    email,
    h("label", { for: "" }, "Passcode"),
    passcode,
    button("Sign in", { type: "submit", class: "btn accent" }, "Sign in"),
    err
  );
  app.appendChild(h("main", { class: "column" }, heading(1, "Sign in"), form));
}
