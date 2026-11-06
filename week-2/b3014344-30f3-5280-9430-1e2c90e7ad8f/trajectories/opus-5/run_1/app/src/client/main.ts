import { COPY } from "../shared/copy.js";
import { api, pageData, prefersReducedMotion, qs, qsa, trapDialog, type ErrorBody } from "./dom.js";
import { initPricing } from "./pricing.js";
import { initCheckout } from "./checkout.js";
import { initPlan } from "./plan.js";
import { initFiles } from "./files.js";
import { initStudio } from "./studio.js";

const OPENED_CARD_KEY = "pampero-opened-case";

function initClock(): void {
  const timer = qs<HTMLElement>("[data-studio-clock]");
  const serverInstant = timer?.dataset.now;
  if (!timer || !serverInstant) return;
  const offsetMatch = /([+-]\d{2}):(\d{2})$/.exec(serverInstant);
  const offsetMinutes = offsetMatch
    ? (offsetMatch[1]?.startsWith("-") ? -1 : 1) *
      (Number(offsetMatch[1]?.slice(1)) * 60 + Number(offsetMatch[2]))
    : -180;
  const serverTime = new Date(serverInstant).getTime();
  const localStart = Date.now();
  const paint = (): void => {
    const studioNow = new Date(serverTime + (Date.now() - localStart) + offsetMinutes * 60_000);
    const hours = studioNow.getUTCHours().toString().padStart(2, "0");
    const minutes = studioNow.getUTCMinutes().toString().padStart(2, "0");
    const seconds = studioNow.getUTCSeconds().toString().padStart(2, "0");
    timer.textContent = `Studio time ${hours}:${minutes}:${seconds}`;
  };
  paint();
  window.setInterval(paint, 1000);
}

function initDrawer(): void {
  const drawer = qs<HTMLElement>("[data-menu-drawer]");
  const openButton = qs<HTMLButtonElement>("[data-menu-open]");
  if (!drawer || !openButton) return;
  const dialog = trapDialog(drawer);
  openButton.addEventListener("click", () => dialog.open());
  qs<HTMLButtonElement>("[data-menu-close]", drawer)?.addEventListener("click", () => dialog.close());
}

function initSignIn(): void {
  const form = qs<HTMLFormElement>("[data-sign-in]");
  if (!form) return;
  const error = qs<HTMLElement>("[data-sign-in-error]", form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (error) error.hidden = true;
    const result = await api<{ user: { role: string } } & ErrorBody>("/api/session", {
      method: "POST",
      body: {
        email: qs<HTMLInputElement>('[name="email"]', form)?.value ?? "",
        password: qs<HTMLInputElement>('[name="password"]', form)?.value ?? "",
      },
    });
    if (result.status === 200) {
      const next = form.dataset.next;
      if (next) {
        window.location.assign(next);
        return;
      }
      window.location.assign(result.body.user.role === "studio_owner" ? "/studio" : "/portal");
      return;
    }
    if (error) {
      error.hidden = false;
      error.textContent = COPY.signInFailed;
    }
  });
}

function initInviteForm(): void {
  const form = qs<HTMLFormElement>("[data-invite-form]");
  if (!form) return;
  const error = qs<HTMLElement>("[data-invite-error]", form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (error) error.hidden = true;
    const result = await api<{ projectId: string } & ErrorBody>(
      `/api/invites/${form.dataset.token}/accept`,
      {
        method: "POST",
        body: {
          name: qs<HTMLInputElement>('[name="name"]', form)?.value ?? "",
          password: qs<HTMLInputElement>('[name="password"]', form)?.value ?? "",
        },
      },
    );
    if (result.status === 201) {
      window.location.assign(`/portal/projects/${result.body.projectId}`);
      return;
    }
    if (error) {
      error.hidden = false;
      error.textContent = Object.values(result.body.fields ?? {})[0] ?? result.body.message;
    }
  });
}

/** The activated card lifts out of the deck before the case study's own route takes over. */
function initCaseStudyOpen(): void {
  for (const link of qsa<HTMLAnchorElement>("[data-case-link]")) {
    link.addEventListener("click", (event) => {
      const slug = link.dataset.caseLink ?? "";
      window.sessionStorage.setItem(OPENED_CARD_KEY, slug);
      if (prefersReducedMotion()) return;
      event.preventDefault();
      const card = link.closest<HTMLElement>("[data-case-card]");
      card?.classList.add("case-opening");
      window.setTimeout(() => window.location.assign(link.href), 660);
    });
  }

  const data = pageData<{ page?: string }>();
  if (data?.page === "case-study") {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      window.location.assign("/#work");
    });
  }

  const stored = window.sessionStorage.getItem(OPENED_CARD_KEY);
  if (stored && qs<HTMLElement>('[data-section="work"]')) {
    const link = qs<HTMLAnchorElement>(`[data-case-link="${stored}"]`);
    if (link) {
      window.sessionStorage.removeItem(OPENED_CARD_KEY);
      const restore = (): void => {
        link.closest<HTMLElement>("[data-case-card]")?.scrollIntoView({ block: "center" });
        link.focus();
      };
      restore();
      window.addEventListener("load", restore, { once: true });
      window.setTimeout(restore, 120);
    }
  }
}

async function initScene(): Promise<void> {
  const container = qs<HTMLElement>("[data-scene]");
  if (!container) return;
  try {
    const module = await import("./scene.js");
    module.startScene(container);
  } catch {
    container.dataset.sceneMode = "still";
  }
}

/** Under reduced motion the sheet never tilts, whatever the server rendered. */
function initSheetMotion(): void {
  if (!prefersReducedMotion()) return;
  for (const region of qsa<HTMLElement>("[data-quote]")) region.dataset.tilt = "0";
}

function start(): void {
  initSheetMotion();
  initClock();
  initDrawer();
  initSignIn();
  initInviteForm();
  initPricing();
  initCheckout();
  initPlan();
  initFiles();
  initStudio();
  initCaseStudyOpen();
  void initScene();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
