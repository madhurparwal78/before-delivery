import { PageCtx } from "../main";
import { h } from "../ui";
import { logoMark } from "../illustrations";
import { api, RequestError } from "../api";

export async function renderSignInPage(ctx: PageCtx): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  const params = new URLSearchParams(location.search);
  const nextPath = params.get("next") || "";

  const wrap = h("div", { class: "auth-wrap" });
  const card = h("div", { class: "auth-card" });
  const logo = h("div", { class: "logo" });
  logo.innerHTML = logoMark(26) + "<span>Interline Desk</span>";
  card.appendChild(logo);
  card.appendChild(h("h1", {}, "Sign in"));
  card.appendChild(h("p", { class: "sub" }, "Use the desk owner account or a reviewer access key."));

  const errBox = h("div", { class: "inline-err", role: "alert", hidden: true });
  const email = h("input", { class: "control", type: "email", autocomplete: "email", id: "email" }) as HTMLInputElement;
  const password = h("input", { class: "control", type: "password", autocomplete: "current-password", id: "password" }) as HTMLInputElement;
  const emailField = h("label", { class: "field" }, h("span", { class: "label" }, "Email"), email);
  const passField = h("label", { class: "field" }, h("span", { class: "label" }, "Password"), password);
  email.setAttribute("aria-label", "Email");
  password.setAttribute("aria-label", "Password");

  const submit = h("button", { class: "btn btn-primary btn-block", type: "submit" }, "Sign in");
  const form = h("form", { onSubmit: (ev: Event) => ev.preventDefault() }) as HTMLFormElement;
  form.addEventListener("submit", async (ev: Event) => {
    ev.preventDefault();
    errBox.hidden = true;
    submit.disabled = true;
    ctx.fb.setStatus("Signing you in.");
    try {
      const res = await api<{ user: { role: string } }>("/api/session", { method: "POST", json: { email: email.value.trim(), password: password.value } });
      ctx.fb.clearStatus();
      const role = res.user?.role;
      const dest = nextPath && nextPath.startsWith("/") ? nextPath : (role === "owner" ? "/desk" : "/review");
      history.replaceState(null, "", dest);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e) {
      submit.disabled = false;
      ctx.fb.clearStatus();
      const msg = e instanceof RequestError && e.status === 401 ? "That email and password don't match." : (e as Error).message;
      errBox.textContent = msg;
      errBox.hidden = false;
      ctx.fb.setProblem(msg);
      email.focus();
    }
  });
  form.appendChild(emailField);
  form.appendChild(passField);
  form.appendChild(errBox);
  form.appendChild(submit);
  card.appendChild(form);
  wrap.appendChild(card);
  main.appendChild(wrap);
  email.focus();
}

export async function renderNotFound(ctx: PageCtx, generic = false): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  const isOwner = ctx.user.role === "owner";
  const wrap = h("div", { class: "container", style: "padding-top:56px;padding-bottom:80px;display:flex;justify-content:center" });
  const card = h("div", { class: "card", style: "max-width:520px" });
  card.appendChild(h("h1", { style: "font-size:1.6em" }, generic ? "We couldn't find that page" : "We couldn't find that project"));
  card.appendChild(h("p", { class: "muted", style: "margin-top:8px" }, generic ? "It may have been erased, or the link is wrong." : "It may have been erased, or the link is wrong."));
  card.appendChild(h("a", { class: "btn btn-primary", style: "margin-top:20px", href: isOwner ? "/desk" : "/review" }, isOwner ? "Back to your desk" : "Back to your review queue"));
  wrap.appendChild(card);
  main.appendChild(wrap);
}
