// The claim page: redeems the key on load and offers one way back.

import { api, ApiCallError } from "./api.js";
import { h } from "./dom.js";

export function startClaim(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const token = params.get("token") ?? "";
  const main = h("main", { class: "claim-page" });
  const card = h("div", { class: "claim-card stamp-frame-card" });
  const status = h("p", { role: "status", "aria-label": "Notices", class: "claim-status", "data-notice-phase": "shown" });
  card.append(status);
  main.append(card);
  root.append(main);

  const notice = (text: string): void => {
    status.textContent = text;
  };
  const walkOn = (): void => {
    const btn = h("button", { class: "btn btn-primary" }, "Walk on Bramble");
    btn.addEventListener("click", () => (location.href = "/"));
    card.append(btn);
    btn.focus();
  };

  if (!token) {
    notice("This postbox key doesn't fit any postbox.");
    walkOn();
    return;
  }

  notice("Opening your postbox…");
  void (async () => {
    try {
      const res = await api<{ return_to: string; merged_guest: boolean }>("POST", "/api/auth/redeem", { token });
      notice("Save claimed. Your stamps travel with you now.");
      const returnTo = res.data.return_to;
      const label = returnTo === "/" ? "Walk on Bramble" : "Open the console";
      const btn = h("button", { class: "btn btn-primary" }, label);
      btn.addEventListener("click", () => {
        // The way back follows only the stored path, never a query parameter.
        if (returnTo === "/" || returnTo.startsWith("/console")) {
          location.href = returnTo;
        } else {
          location.href = "/";
        }
      });
      card.append(btn);
      btn.focus();
    } catch (err) {
      if (err instanceof ApiCallError) {
        const code = err.error.code;
        if (code === "link_expired") notice("This postbox key has expired. Ask for a new one.");
        else if (code === "link_used") notice("This postbox key was already used.");
        else if (code === "link_invalid") notice("This postbox key doesn't fit any postbox.");
        else notice("Something went wrong on Bramble.");
      } else {
        notice("Something went wrong on Bramble.");
      }
      walkOn();
    }
  })();
}
