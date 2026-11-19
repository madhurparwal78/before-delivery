import { apiJson, ApiFailure, renderBanners, watchStatus } from "./shared.js";

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const notice = document.getElementById("signin-notice") as HTMLElement;
  const form = document.getElementById("signin-form") as HTMLFormElement;
  const email = document.getElementById("email") as HTMLInputElement;
  const password = document.getElementById("password") as HTMLInputElement;
  const errorLine = document.getElementById("error-line") as HTMLElement;
  const btn = document.getElementById("signin-btn") as HTMLButtonElement;
  const bannerSlot = document.getElementById("banner-slot") as HTMLElement;

  // The session-ended notice shows when ended=1 is present.
  if (params.get("ended") === "1") {
    notice.hidden = false;
    notice.textContent = "Your session has ended. Sign in again to continue.";
  }

  // After sign-in, go to next when it is a same-origin path beginning /host.
  const next = params.get("next") ?? "/host";
  const isSameOriginHostPath = next.startsWith("/host") && !next.startsWith("//");
  const target = isSameOriginHostPath ? next : "/host";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorLine.textContent = "";
    btn.disabled = true;
    try {
      await apiJson("/api/host/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value.trim(), password: password.value }),
      });
      location.href = target;
    } catch (err) {
      btn.disabled = false;
      if (err instanceof ApiFailure && err.status === 401) {
        errorLine.textContent = "That email and password don't match.";
      } else {
        errorLine.textContent = "We couldn't sign you in. Please try again.";
      }
    }
  });

  watchStatus((s) => renderBanners(bannerSlot, s, false));
}

void main();
