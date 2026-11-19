import { el, heading, navigate } from "../lib/dom.js";
import { Api } from "../lib/api.js";

export async function verifyPage(root: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
  root.innerHTML = "";
  const wrap = el("div", { class: "split" });
  const stage = el("div", { class: "stage with-inset", "aria-hidden": "true" });
  const col = el("div", { class: "column" });
  const body = el("div", { class: "column-body" });

  const token = params.get("token") ?? "";
  let done = false;
  try {
    await Api.post("/api/verify", { token });
    body.appendChild(heading(1, "Your email is verified"));
    const p = el("p", { text: "You can now save versions, publish, like and fork." });
    body.appendChild(p);
    const toDash = el("button", { class: "primary" }, "Go to your dashboard");
    toDash.addEventListener("click", () => navigate("/dashboard"));
    body.appendChild(toDash);
    done = true;
  } catch (err) {
    const code = (err as { error: string }).error;
    if (code === "token_expired") {
      body.appendChild(heading(1, "This link has expired. Sign in and use Resend link to get a new one."));
    } else {
      body.appendChild(heading(1, "This link is not valid. It may have been used already."));
    }
  }
  if (!done) {
    const p = el("p", {}, "You can ");
    const a = el("a", { href: "/dashboard" }, "go to your dashboard");
    a.addEventListener("click", (e) => {
      e.preventDefault();
      navigate("/dashboard");
    });
    p.appendChild(a);
    p.appendChild(document.createTextNode(" and use Resend link."));
    body.appendChild(p);
  }
  col.appendChild(body);
  wrap.appendChild(stage);
  wrap.appendChild(col);
  root.appendChild(wrap);
}
