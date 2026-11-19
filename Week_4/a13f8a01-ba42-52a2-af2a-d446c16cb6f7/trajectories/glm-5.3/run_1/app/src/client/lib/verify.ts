// The verification banner and account status, shown while unverified.
import { el, button } from "./dom.js";
import { Api, type User } from "./api.js";

export interface VerifyBanner {
  node: HTMLElement;
  refresh(user: User): void;
}

export function buildVerifyBanner(user: User | null): VerifyBanner {
  const region = el("div", { role: "region", "aria-label": "Verify your email", class: "panel" });
  const accountStatus = el("div", { role: "status", "aria-label": "Account status", class: "status" });
  const line = el("p");
  const resend = button("Resend link", {});
  region.appendChild(line);
  region.appendChild(resend);
  region.appendChild(accountStatus);

  const refresh = (u: User) => {
    if (u.verified) {
      region.setAttribute("hidden", "true");
      accountStatus.textContent = "Email verified. You can now save versions.";
      return;
    }
    region.removeAttribute("hidden");
    accountStatus.textContent = "";
    // The banner clears without a reload once the account is verified; the
    // live feed flips it, and refresh() keeps it honest on any render.
  };

  if (user && !user.verified) {
    line.textContent = `Check ${user.email} for a link to verify your account. Until then you can write and preview, but not save versions, publish, like or fork.`;
  }

  resend.addEventListener("click", async () => {
    accountStatus.textContent = "Sending…";
    try {
      await Api.post("/api/verify/resend");
      const me = await Api.get<{ user: User }>("/api/me");
      accountStatus.textContent = `Sent a new link to ${me.user.email}.`;
    } catch (err) {
      const code = (err as { error: string }).error;
      if (code === "mail_unavailable") {
        accountStatus.textContent = "Mail is unreachable, so the link was not sent. Try Resend link again in a moment.";
      } else if (code === "already_verified") {
        accountStatus.textContent = "Email verified. You can now save versions.";
        region.setAttribute("hidden", "true");
      } else {
        accountStatus.textContent = (err as { message: string }).message;
      }
    }
  });

  return { node: region, refresh };
}

// The unverified refusal copy, used by every status region that gets a 403.
export function unverifiedCopy(user: User | null): string {
  if (user && user.email) {
    return `Verify your email to do this. We sent a link to ${user.email}.`;
  }
  return "Verify your email to do this.";
}
