import { api, el, link, button, announce, type Page, register, liveRegion } from "../pages.js";
import { ApiFail } from "../lib.js";
import { readApplyDraft, writeApplyDraft, clearApplyDraft } from "../stores.js";


const packageStatus = liveRegion("package", "Package announcements");
const applyStatus = liveRegion("application", "Application announcements");

interface PackageCard {
  slug: string;
  displayName: string;
  office: string;
  decision: string;
  coverPhotoUrl: string | null;
}

/** The private casting package, reachable only through its link. */
const packagePage: Page = {
  path: "/p/:token",
  title: () => "Casting package",
  render: async (main) => {
    const token = location.pathname.split("/")[2];
    try {
      const pkg = (await api(`/api/p/${token}`)) as { title: string; shortlistedCount: number; talent: PackageCard[] };
      main.appendChild(el("h1", undefined, pkg.title));
      const count = el("p", undefined, `${pkg.shortlistedCount} shortlisted`);
      main.appendChild(count);
      const grid = el("div", "grid-cards");
      for (const card of pkg.talent) {
        const article = el("article", "talent-card");
        article.setAttribute("aria-label", card.displayName);
        const img = document.createElement("img");
        img.className = "portrait";
        img.alt = `Portrait of ${card.displayName}`;
        img.src = card.coverPhotoUrl || "/placeholder.svg";
        article.appendChild(img);
        const body = el("div", "card-body");
        body.appendChild(el("h3", undefined, card.displayName));
        body.appendChild(el("p", "card-facts", card.office === "toronto" ? "Toronto" : "Vancouver"));
        const shortlist = toggleButton(card, "shortlisted", "Shortlist");
        const pass = toggleButton(card, "passed", "Pass");
        const group = el("div", "row");
        group.append(shortlist, pass);
        body.appendChild(group);
        article.appendChild(body);
        grid.appendChild(article);
      }
      main.appendChild(grid);
      const download = button("Download photos", async () => {
        download.disabled = true;
        const original = download.textContent;
        download.textContent = "Preparing photos…";
        try {
          const res = await fetch(`/api/p/${token}/photos.zip`);
          if (!res.ok) throw new Error("failed");
          const blob = await res.blob();
          triggerDownload(blob, "package.zip");
          announce(packageStatus, "Your download has started.");
        } catch (err) {
          const fail = err as { status?: number };
          announce(packageStatus, fail.status === 503
            ? "Photo storage is unreachable, so the download could not be prepared. Try again in a few minutes."
            : "The download could not be prepared. Try again.");
        } finally {
          download.disabled = false;
          download.textContent = original || "Download photos";
        }
      }, "primary");
      const bar = el("div", "sticky-bar");
      bar.append(el("span", undefined, `${pkg.shortlistedCount} shortlisted`), download);
      main.appendChild(bar);
      main.appendChild(packageStatus);
    } catch (err) {
      if (err instanceof ApiFail && err.status === 410) {
        const box = el("section");
        box.append(
          el("h1", undefined, "This package link no longer opens"),
          el("p", undefined, "Ask your Vesper & Rowe booker for a new link."),
        );
        main.appendChild(box);
        return;
      }
      throw err;
    }
  },
};

function toggleButton(card: PackageCard, decision: "shortlisted" | "passed", label: string): HTMLButtonElement {
  const token = location.pathname.split("/")[2];
  const btn = button(label, async () => {
    const pressed = btn.getAttribute("aria-pressed") === "true";
    const next = pressed ? "undecided" : decision;
    btn.setAttribute("aria-pressed", String(!pressed));
    try {
      const result = (await api(`/api/p/${token}/decisions/${card.slug}`, { method: "PUT", body: { decision: next } })) as { shortlistedCount: number };
      updateCount(result.shortlistedCount);
      const copy = next === "shortlisted" ? `Shortlisted ${card.displayName}.` : next === "passed" ? `Passed on ${card.displayName}.` : `Cleared your choice for ${card.displayName}.`;
      announce(packageStatus, copy);
    } catch (err) {
      btn.setAttribute("aria-pressed", String(pressed));
      const fail = err as ApiFail;
      if (fail.status === 410) {
        announce(packageStatus, fail.code === "link_expired"
          ? "This package link has expired, so your choice for " + card.displayName + " was not saved."
          : "This package link was revoked, so your choice for " + card.displayName + " was not saved.");
      } else if (fail.status === 404) {
        announce(packageStatus, `${card.displayName} is no longer in this package.`);
      }
    }
  });
  btn.setAttribute("aria-pressed", String(card.decision === decision));
  return btn;
}

function updateCount(count: number): void {
  const counts = document.querySelectorAll(".sticky-bar span, main > p");
  counts.forEach((node) => {
    if (/shortlisted/.test(node.textContent || "")) node.textContent = `${count} shortlisted`;
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

register(packagePage);

/** The new-face application: four steps plus the guardian step for minors. */
const applyPage: Page = {
  path: "/apply",
  title: () => "Apply",
  render: async (main) => {
    const params = new URLSearchParams(location.search);
    let step = Math.min(5, Math.max(1, Number(params.get("step") || 1)));
    main.appendChild(el("h1", undefined, "Apply to Vesper & Rowe"));
    const heading = el("h2", undefined, ["About you", "Your story", "Photos", "Guardian", "Review"][step - 1]);
    main.appendChild(heading);
    const draft = readApplyDraft();
    if (!draft) {
      const office = params.get("office") === "vancouver" ? "vancouver" : "toronto";
      const created = (await api("/api/applications", { body: { office } })) as { id: string; token: string };
      writeApplyDraft({ id: created.id, token: created.token, step: 1, values: {} });
    }
    const current = readApplyDraft();
    if (!current) return;
    if (current.step && !params.get("step")) step = current.step;
    await renderApplyStep(main, current, step);
  },
};

async function renderApplyStep(main: HTMLElement, draft: { id: string; token: string; values: Record<string, string>; step: number }, step: number): Promise<void> {
  const headers = { "X-Application-Token": draft.token };
  const info = (await api(`/api/applications/${draft.id}`, { method: "GET", headers })) as { minor: boolean; status: string; office: string };
  if (info.status !== "draft") {
    main.appendChild(el("p", undefined, info.minor
      ? "Application sent. We have emailed your guardian for consent and will review it once they approve."
      : "Application sent. Our scouts will be in touch by email."));
    return;
  }
  if (step === 4 && !info.minor) step = 5;
  const form = el("form");
  main.appendChild(form);
  const values = draft.values;

  const field = (name: string, label: string, type = "text", value = ""): void => {
    const wrap = el("div", "field");
    const l = el("label", undefined, label);
    l.setAttribute("for", `a-${name}`);
    const input = document.createElement("input");
    input.type = type;
    input.id = `a-${name}`;
    input.value = values[name] ?? value;
    input.addEventListener("input", () => {
      const fresh = readApplyDraft();
      if (fresh) {
        fresh.values[name] = input.value;
        writeApplyDraft(fresh);
      }
    });
    wrap.append(l, input);
    form.appendChild(wrap);
  };

  if (step === 1) {
    field("firstName", "First name");
    field("lastName", "Last name");
    field("email", "Email", "email");
    field("dateOfBirth", "Date of birth", "date");
    field("height", "Height");
    field("instagramFollowers", "Instagram followers", "number");
  } else if (step === 2) {
    field("bio", "Bio");
  } else if (step === 3) {
    for (const [slot, label] of [["front", "Front photo"], ["profile", "Profile photo"], ["full_length", "Full-length photo"], ["smile", "Smiling photo"]] as Array<[string, string]>) {
      const wrap = el("div", "field");
      const l = el("label", undefined, label);
      l.setAttribute("for", `a-${slot}`);
      const input = document.createElement("input");
      input.type = "file";
      input.id = `a-${slot}`;
      input.accept = "image/jpeg,image/png,image/webp";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`/api/applications/${draft.id}/photos/${slot}`, { method: "PUT", headers, body });
        if (res.ok) {
          announce(applyStatus, `${label} added.`);
        } else {
          const err = (await res.json()) as { error: string; limitBytes?: number; errors?: Record<string, string> };
          if (err.error === "too_large") announce(applyStatus, `That photo is larger than ${(err.limitBytes || 0).toLocaleString()} bytes.`);
          else if (err.errors?.file) announce(applyStatus, err.errors.file);
          else announce(applyStatus, "Photo storage is unreachable, so nothing was saved. Try again in a few minutes.");
        }
      });
      wrap.append(l, input);
      form.appendChild(wrap);
    }
  } else if (step === 4) {
    field("guardianName", "Guardian name");
    field("guardianEmail", "Guardian email", "email");
  }

  const actions = el("div", "row");
  if (step > 1) {
    actions.appendChild(button("Back", async () => {
      await goApplyStep(step - 1, draft);
    }));
  }
  if (step < 5) {
    actions.appendChild(button("Next", async () => {
      const fresh = readApplyDraft();
      if (fresh) {
        const payload: Record<string, unknown> = {};
        for (const key of ["firstName", "lastName", "email", "dateOfBirth", "height", "instagramFollowers", "bio", "guardianName", "guardianEmail"]) {
          if (fresh.values[key]) payload[key] = fresh.values[key];
        }
        if (payload.height) payload.height = { value: payload.height, unit: "cm" };
        try {
          const updated = (await api(`/api/applications/${draft.id}`, { method: "PATCH", headers, body: payload })) as { minor: boolean };
          fresh.step = step;
          writeApplyDraft(fresh);
          const nextStep = step === 3 && updated.minor ? 4 : step === 3 ? 5 : step + 1;
          if (step === 1 && !updated.minor) void nextStep;
          await goApplyStep(nextStep, fresh);
        } catch (err) {
          const fail = err as ApiFail;
          if (fail.status === 429) announce(applyStatus, `Too many requests from this connection. Try again in ${(fail.body.retryAfterSeconds as number) || 1} seconds.`);
          else if (fail.status === 422) announce(applyStatus, "Please fix the problems on this step.");
          else announce(applyStatus, "Something went wrong. Try again.");
        }
      }
    }, "primary"));
  } else {
    actions.appendChild(button("Send application", async () => {
      try {
        const result = (await api(`/api/applications/${draft.id}/submit`, { headers, body: {} })) as { status: string };
        clearApplyDraft();
        main.textContent = "";
        main.appendChild(el("h1", undefined, "Application sent"));
        main.appendChild(el("p", undefined, result.status === "awaiting_guardian"
          ? "Application sent. We have emailed your guardian for consent and will review it once they approve."
          : "Application sent. Our scouts will be in touch by email."));
      } catch (err) {
        const fail = err as ApiFail;
        if (fail.code === "already_submitted") announce(applyStatus, "This application was already sent.");
        else if (fail.status === 422) announce(applyStatus, "Please fix the problems on this step.");
        else announce(applyStatus, "Something went wrong. Try again.");
      }
    }, "primary"));
  }
  form.appendChild(actions);
  main.appendChild(applyStatus);
}

async function goApplyStep(step: number, draft: { id: string; token: string; values: Record<string, string>; step: number }): Promise<void> {
  draft.step = step;
  writeApplyDraft(draft);
  const { go } = await import("../app.js");
  await go(`/apply?step=${step}`);
}

register(applyPage);

/** Guardian consent. */
const consentPage: Page = {
  path: "/consent/:token",
  title: () => "Guardian consent",
  render: async (main) => {
    const token = location.pathname.split("/")[2];
    try {
      const info = (await api(`/api/consents/${token}`)) as { applicantFirstName: string; office: string };
      main.appendChild(el("h1", undefined, `Consent for ${info.applicantFirstName}`));
      main.appendChild(el("p", undefined, `${info.applicantFirstName} has applied to Vesper & Rowe Talent in ${info.office === "toronto" ? "Toronto" : "Vancouver"}. A guardian must approve before we review the application.`));
      const actions = el("div", "row");
      actions.append(
        button("Approve application", async () => {
          await decide("approve");
        }, "primary"),
        button("Decline application", async () => {
          await decide("decline");
        }),
      );
      main.appendChild(actions);
    } catch (err) {
      if (err instanceof ApiFail && err.status === 410) {
        const box = el("section");
        box.append(el("h1", undefined, "This consent link no longer works"), el("p", undefined, "Ask Vesper & Rowe to send a new link if you still need to decide."));
        main.appendChild(box);
        return;
      }
      throw err;
    }

    async function decide(decision: "approve" | "decline"): Promise<void> {
      try {
        await api(`/api/consents/${token}`, { body: { decision } });
        main.textContent = "";
        main.appendChild(el("h1", undefined, decision === "approve" ? "Thank you. You approved the application." : "You declined the application."));
        if (decision === "decline") main.appendChild(el("p", undefined, "We will not contact them again."));
      } catch (err) {
        const fail = err as ApiFail;
        if (fail.status === 410) {
          main.textContent = "";
          main.appendChild(el("h1", undefined, "This consent link no longer works"));
          main.appendChild(el("p", undefined, "Ask Vesper & Rowe to send a new link if you still need to decide."));
        }
      }
    }
  },
};

register(consentPage);

/** Sign-in, forgot password, reset, invitation accept. */
export function registerAccountPages(registerPage: (page: Page) => void, goHome: (path: string) => Promise<void>): void {
  const signIn: Page = {
    path: "/sign-in",
    title: () => "Sign in",
    render: (main) => {
      main.appendChild(el("h1", undefined, "Sign in"));
      const status = liveRegion("account", "Account announcements");
      const form = el("form");
      const emailField = el("div", "field");
      const emailLabel = el("label", undefined, "Email");
      emailLabel.setAttribute("for", "s-email");
      const email = document.createElement("input");
      email.type = "email";
      email.id = "s-email";
      emailLabel.setAttribute("for", "s-email");
      emailField.append(emailLabel, email);
      const passwordField = el("div", "field");
      const passwordLabel = el("label", undefined, "Password");
      const password = document.createElement("input");
      password.type = "password";
      password.id = "s-password";
      password.setAttribute("aria-label", "Password");
      passwordField.append(passwordLabel, password);
      const submit = button("Sign in", async () => {
        submit.textContent = "Signing in…";
        submit.disabled = true;
        try {
          const result = (await api("/api/session", { body: { email: email.value, password: password.value } })) as { member: { role: string }; home: string };
          const { setSession } = await import("../app.js");
          setSession(result.member as { id: string; name: string; role: string; office: string; talentId: string | null });
          await goHome(result.home);
        } catch (err) {
          submit.textContent = "Sign in";
          submit.disabled = false;
          const fail = err as ApiFail;
          announce(status, fail.code === "invalid_credentials" ? "That email and password do not match." : "Sign in failed. Try again.");
        }
      }, "primary");
      form.append(emailField, passwordField, submit);
      main.appendChild(form);
      main.appendChild(link("/forgot-password", "Forgot password?"));
      main.appendChild(status);
      email.focus();
    },
  };
  registerPage(signIn);

  const forgot: Page = {
    path: "/forgot-password",
    title: () => "Forgot password",
    render: (main) => {
      main.appendChild(el("h1", undefined, "Forgot password"));
      const status = liveRegion("account-forgot", "Account announcements");
      const form = el("form");
      const label = el("label", undefined, "Email");
      const email = document.createElement("input");
      email.type = "email";
      email.id = "fp-email";
      label.setAttribute("for", "fp-email");
      const send = button("Send reset link", async () => {
        send.textContent = "Sending…";
        try {
          const result = (await api("/api/password-resets", { body: { email: email.value } })) as { message: string };
          announce(status, result.message);
        } finally {
          send.textContent = "Send reset link";
          send.disabled = false;
        }
      }, "primary");
      form.append(label, email, send);
      main.appendChild(form);
      main.appendChild(status);
    },
  };
  registerPage(forgot);

  const reset: Page = {
    path: "/reset/:token",
    title: () => "Set a new password",
    render: (main) => {
      const token = location.pathname.split("/")[2];
      main.appendChild(el("h1", undefined, "Set a new password"));
      const status = liveRegion("account-reset", "Account announcements");
      const form = el("form");
      const label = el("label", undefined, "New password");
      const password = document.createElement("input");
      password.type = "password";
      password.id = "rp-password";
      password.setAttribute("aria-label", "New password");
      label.setAttribute("for", "rp-password");
      const set = button("Set password", async () => {
        try {
          const result = (await api(`/api/password-resets/${token}`, { body: { password: password.value } })) as { member: { role: string }; home: string };
          const { setSession } = await import("../app.js");
          setSession(result.member as { id: string; name: string; role: string; office: string; talentId: string | null });
          await goHome(result.home);
        } catch (err) {
          const fail = err as ApiFail;
          announce(status, fail.code === "link_used" ? "This link was already used. Ask for a new one." : "Could not set the password. Try again.");
        }
      }, "primary");
      form.append(label, password, set);
      main.appendChild(form);
      main.appendChild(status);
    },
  };
  registerPage(reset);

  const invite: Page = {
    path: "/invite/:token",
    title: () => "Set your password",
    render: (main) => {
      const token = location.pathname.split("/")[2];
      main.appendChild(el("h1", undefined, "Set your password"));
      const status = liveRegion("account-invite", "Account announcements");
      const form = el("form");
      const label = el("label", undefined, "New password");
      const password = document.createElement("input");
      password.type = "password";
      password.id = "iv-password";
      password.setAttribute("aria-label", "New password");
      label.setAttribute("for", "iv-password");
      const set = button("Set password", async () => {
        try {
          const result = (await api(`/api/invitations/${token}/accept`, { body: { password: password.value } })) as { member: { role: string }; home: string };
          const { setSession } = await import("../app.js");
          setSession(result.member as { id: string; name: string; role: string; office: string; talentId: string | null });
          await goHome(result.home);
        } catch (err) {
          const fail = err as ApiFail;
          announce(status, fail.code === "link_used" ? "This invitation was already used. Ask for a new one." : "Could not accept the invitation. Try again.");
        }
      }, "primary");
      form.append(label, password, set);
      main.appendChild(form);
      main.appendChild(status);
    },
  };
  registerPage(invite);
}


