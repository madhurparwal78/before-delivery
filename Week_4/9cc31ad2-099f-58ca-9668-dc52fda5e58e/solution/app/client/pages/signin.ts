import { errorCode, get, send, type ApiError } from "../api";
import { h } from "../dom";
import { fmtCoins } from "../format";
import type { PageContext } from "../router";
import { loadMe, me } from "../session";
import { renderShell } from "../shell";
import { openDialog } from "../ui/dialog";
import type { Garage } from "../types";

const EMAIL_ERROR = "Enter a valid email address.";
const MAIL_OUTAGE = "We couldn't send the email right now. Try again in a minute.";

function emailForm(main: HTMLElement): void {
  const status = h("p", { role: "status", "aria-label": "Sign-in status", class: "status-line" });
  const summary = h("div", { class: "error-summary", role: "alert", hidden: true });
  const fieldError = h("p", { id: "email-error", class: "field-error" });
  const email = h("input", { type: "email", id: "email", name: "email", autocomplete: "email", "aria-describedby": "email-error" });
  const submit = h("button", { type: "submit", class: "primary" }, "Send sign-in link");
  const form = h("form", { class: "signin", novalidate: true },
    h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Save your garage"), h("h1", null, "Sign in"))),
    h("p", null, "We email you a link. Opening it saves this garage to your address, so it is there on any device."),
    summary,
    h("div", { class: "field" }, h("label", { class: "label", for: "email" }, "Email"), email, fieldError),
    h("div", null, submit),
    status);
  main.append(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    submit.textContent = "Sending…";
    status.textContent = "";
    summary.hidden = true;
    fieldError.textContent = "";
    email.removeAttribute("aria-invalid");
    const address = email.value.trim();
    const result = await send("POST", "/v1/auth/links", { email: address }).catch(() => null);
    submit.disabled = false;
    submit.textContent = "Send sign-in link";
    if (result?.status === 202) {
      status.textContent = `Check ${address} for your sign-in link.`;
    } else if (result?.status === 422) {
      summary.hidden = false;
      summary.replaceChildren(h("a", { href: "#email", onclick: (e: Event) => { e.preventDefault(); email.focus(); } }, EMAIL_ERROR));
      fieldError.textContent = EMAIL_ERROR;
      email.setAttribute("aria-invalid", "true");
      summary.querySelector("a")?.focus();
    } else {
      status.textContent = MAIL_OUTAGE;
    }
  });
}

async function redeem(main: HTMLElement, token: string): Promise<void> {
  const status = h("p", { role: "status", "aria-label": "Sign-in status", class: "status-line" }, "Signing you in…");
  main.append(
    h("div", { class: "signin" },
      h("div", { class: "page-head" }, h("div", null, h("p", { class: "kicker" }, "Save your garage"), h("h1", null, "Sign in"))),
      status));
  const deviceGarage = me()?.guest ? (await get<Garage>("/v1/garage")).data : null;

  const finish = async (keep?: "device" | "account") => {
    const result = await send<{ email: string } | ApiError>("POST", "/v1/auth/redeem", keep ? { token, keep } : { token });
    if (result.status === 200) {
      await loadMe();
      status.textContent = `Signed in as ${(result.data as { email: string }).email}. Your garage is saved.`;
    } else if (errorCode(result) === "GARAGE_CHOICE_REQUIRED") {
      choose((result.data as ApiError).error.message);
    } else {
      status.replaceChildren("This sign-in link has expired or was already used. ",
        h("a", { href: "/sign-in" }, "Send a new one"), ".");
    }
  };

  const choose = (accountSummary: string) => {
    const device = h("button", { type: "button", class: "primary" }, "Keep this device's garage");
    const account = h("button", { type: "button" }, "Keep my account's garage");
    const handle = openDialog({
      title: "Keep which garage?",
      body: [
        h("p", null, "Both garages have progress. Choose the one to keep; the other is retired."),
        h("div", { class: "garage-choice" },
          h("p", { class: "mono" }, `This device's garage has ${fmtCoins(deviceGarage?.balance ?? 0)} coins, ${deviceGarage?.cars.length ?? 0} ${deviceGarage?.cars.length === 1 ? "car" : "cars"}.`),
          h("p", { class: "mono" }, accountSummary)),
      ],
      actions: [device, account],
      initialFocus: device,
    });
    const pick = (keep: "device" | "account") => {
      handle.close();
      void finish(keep);
    };
    device.addEventListener("click", () => pick("device"));
    account.addEventListener("click", () => pick("account"));
  };
  await finish();
}

export async function signinPage(ctx: PageContext): Promise<void> {
  document.title = "Kerbline — Sign in";
  const main = renderShell(me() !== null, ["Email", "Link", "Saved"]);
  const token = ctx.url.pathname.split("/")[2];
  if (token) await redeem(main, decodeURIComponent(token));
  else emailForm(main);
}
