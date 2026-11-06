import { api, ApiCallError, NetworkError, type User, type Course, type Enrolment, type Certificate } from "./api.ts";
import {
  el, announce, announceAlert, clearAlert, ensureFeedbackRegions, openDialog, applyErrors,
  clearFieldErrors, displayDate, providerToday, closeLine, prefersReducedMotion,
} from "./ui.ts";
import { buildSeal, sealFromEnrolment, playSealPress, type SealData } from "./seal.ts";

// Credwell: course platform shell and screens.

type Screen = { path: string; render: (main: HTMLElement) => Promise<void> };

let currentUser: User | null = null;

const main = (): HTMLElement => {
  const node = document.getElementById("main");
  if (!node) throw new Error("main missing");
  return node;
};

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) return;
  renderShell();
  window.setInterval(() => undefined, 3600000);
  window.addEventListener("popstate", () => void route());
  void route();
}

function renderShell(): void {
  const root = document.getElementById("root");
  if (!root) return;
  root.textContent = "";
  const topbar = el("header", { class: "topbar" });
  const brand = el("a", { href: "/courses", class: "wordmark" }, "Credwell");
  topbar.append(brand);
  topbar.append(el("nav", { "aria-label": "Main", id: "main-nav", class: "main-nav hidden-sm" }));
  topbar.append(el("button", { id: "sign-out", class: "btn btn-quiet hidden-sm" }, "Sign out"));
  topbar.append(el("button", { id: "menu-toggle", class: "btn btn-quiet menu-toggle", "aria-expanded": "false" }, "Menu"));
  root.append(topbar);
  const container = el("div", { class: "page" });
  const inner = el("main", { id: "main", class: "main" });
  container.append(inner);
  root.append(container);
  ensureFeedbackRegions(root);
  document.getElementById("menu-toggle")?.addEventListener("click", () => {
    const nav = document.getElementById("main-nav");
    if (nav) nav.classList.toggle("hidden-sm");
  });
  document.getElementById("sign-out")?.addEventListener("click", async () => {
    try {
      await api("DELETE", "/api/session");
    } catch {
      // signing out regardless
    }
    currentUser = null;
    history.pushState(null, "", "/signin");
    void route();
  });
}

function navigationFor(user: User): HTMLElement {
  const nav = el("nav", { "aria-label": "Main", id: "main-nav", class: "main-nav hidden-sm" });
  if (user.role === "learner") {
    nav.append(navLink("/courses", "Courses"), navLink("/learning", "My learning"), navLink("/transcript", "Transcript"));
  } else if (user.role === "coordinator") {
    nav.append(navLink("/courses", "Courses"), navLink("/sponsor", "Hospital seats"));
  } else if (user.role === "planner") {
    nav.append(navLink("/courses", "Courses"), navLink("/planner", "Planner"), navLink("/author", "Authoring"));
  } else {
    nav.append(navLink("/courses", "Courses"), navLink("/author", "Authoring"));
  }
  return nav;
}

function navLink(href: string, label: string): HTMLElement {
  const link = el("a", { href }, label);
  link.addEventListener("click", (event) => {
    event.preventDefault();
    history.pushState(null, "", href);
    void route();
  });
  return link;
}

async function loadUser(): Promise<User | null> {
  try {
    const me = await api<{ user: User }>("GET", "/api/me");
    return me.user;
  } catch {
    return null;
  }
}

async function route(): Promise<void> {
  const path = window.location.pathname;
  if (path.startsWith("/verify/")) {
    await renderVerify(main(), path.slice("/verify/".length));
    return;
  }
  if (path === "/signin") {
    currentUser = await loadUser();
    if (currentUser) {
      history.pushState(null, "", "/courses");
      await renderCourses(main());
      return;
    }
    await renderSignIn(main());
    return;
  }
  currentUser = await loadUser();
  if (!currentUser) {
    history.pushState(null, "", "/signin");
    await renderSignIn(main());
    return;
  }
  if (path === "/courses" || path === "/") {
    await renderCourses(main());
  } else if (path.startsWith("/courses/")) {
    await renderCoursePage(main(), path.slice("/courses/".length));
  } else if (path === "/learning") {
    await renderMyLearning(main());
  } else if (path.startsWith("/learn/")) {
    await renderLearn(main(), path);
  } else if (path === "/transcript") {
    await renderTranscript(main());
  } else if (path === "/sponsor") {
    await renderSponsor(main());
  } else if (path === "/planner") {
    await renderPlanner(main());
  } else if (path.startsWith("/planner/cohorts/")) {
    await renderCohortDetail(main(), path.slice("/planner/cohorts/".length));
  } else if (path === "/author") {
    await renderAuthoring(main());
  } else {
    await renderCourses(main());
  }
}

function applyChrome(user: User): void {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const existing = topbar.querySelector("#main-nav");
  if (existing) existing.remove();
  topbar.insertBefore(navigationFor(user), topbar.querySelector("#sign-out"));
  (topbar.querySelector("#sign-out") as HTMLElement).classList.remove("hidden-sm");

}

// Deferring the render by a tick lets the click that caused navigation finish
// before the DOM is replaced.
const navigate = (href: string): void => {
  history.pushState(null, "", href);
  window.setTimeout(() => void route(), 0);
};

function pendingButton(button: HTMLButtonElement, label: string): void {
  button.dataset.originalLabel = button.textContent ?? "";
  button.textContent = label;
  button.disabled = true;
}

function restoreButton(button: HTMLButtonElement): void {
  button.textContent = button.dataset.originalLabel ?? button.textContent ?? "";
  button.disabled = false;
}

function handleError(e: unknown, fallback: string): void {
  if (e instanceof NetworkError) {
    announceAlert("We couldn't reach Credwell. Check your connection and try again.");
    return;
  }
  if (e instanceof ApiCallError && e.shape.code) {
    announceAlert(errorCopy(e.shape.code, fallback, e.shape.extra));
    return;
  }
  announceAlert(fallback);
}

const CHECKOUT_ERRORS: Record<string, string> = {
  course_not_open: "This course is no longer open for enrolment.",
  cohort_full: "The last seat was just taken. Join the waitlist to hold your place in line.",
  enrolment_closed: "Enrolment for this cohort has closed.",
  already_enrolled: "You're already enrolled in this course.",
  payments_unavailable: "Payments are unavailable right now. You have not been charged. Try again in a few minutes.",
};

function errorCopy(code: string, fallback: string, extra: Record<string, unknown>): string {
  if (code === "quote_changed" && extra.quote && typeof extra.quote === "object") {
    const quote = extra.quote as { learner_share: string };
    return `The price changed while you were checking out. Your share is now $${quote.learner_share}.`;
  }
  if (code === "payments_unavailable") {
    return "Payments are unavailable right now. You have not been charged. Try again in a few minutes.";
  }
  if (code === "storage_unavailable") {
    return "File storage is unavailable right now. Try the export again in a few minutes.";
  }
  return CHECKOUT_ERRORS[code] ?? fallback;
}

function goBackToCourses(): void {
  navigate("/courses");
}

async function renderSignIn(mainEl: HTMLElement): Promise<void> {
  applyMinimalChrome();
  mainEl.textContent = "";
  const card = el("section", { class: "card card-narrow" });
  const form = el("form", { class: "stack" }) as HTMLFormElement;
  const heading = el("h1", {}, "Sign in to Credwell");
  const email = el("input", { type: "email", id: "email", class: "input", autocomplete: "username" }) as HTMLInputElement;
  email.setAttribute("aria-label", "Email");
  const password = el("input", { type: "password", id: "password", class: "input", autocomplete: "current-password" }) as HTMLInputElement;
  password.setAttribute("aria-label", "Password");
  const submit = el("button", { type: "submit", class: "btn btn-primary" }, "Sign in") as HTMLButtonElement;
  form.append(heading, email, password, submit);
  card.append(form);
  mainEl.append(card);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert();
    pendingButton(submit, "Signing in…");
    try {
      const result = await api<{ user: User }>("POST", "/api/session", {
        email: email.value,
        password: password.value,
      });
      currentUser = result.user;
      navigate("/courses");
    } catch (e) {
      restoreButton(submit);
      if (e instanceof ApiCallError && e.shape.errors) {
        announceAlert(e.shape.errors["password"] ?? "Check your details and try again.");
        return;
      }
      handleError(e, "Check your details and try again.");
    }
  });
}

function applyMinimalChrome(): void {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const nav = topbar.querySelector("#main-nav");
  if (nav) nav.replaceChildren();
  const signOut = topbar.querySelector("#sign-out") as HTMLElement | null;
  if (signOut) signOut.classList.add("hidden-sm");
}

void boot();

// --- courses catalogue ---------------------------------------------------------

async function renderCourses(mainEl: HTMLElement): Promise<void> {
  applyChrome(requireUser());
  mainEl.textContent = "";
  const heading = el("h1", {}, "Courses");
  const list = el("ul", { "aria-label": "Course catalogue", class: "course-list" });
  mainEl.append(heading, list);
  try {
    const data = await api<{ courses: Course[] }>("GET", "/api/courses");
    for (const course of data.courses) {
      const row = el("li", { class: "course-row" });
      const link = el("a", { href: `/courses/${course.id}`, class: "course-title" }, course.title);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        navigate(`/courses/${course.id}`);
      });
      row.append(link);
      row.append(
        el("div", { class: "course-figures" },
          el("span", { class: "figure" }, course.format === "self_paced" ? "Self-paced" : "Live cohort"),
          el("span", { class: "figure" }, `${course.total_minutes} min`),
          el("span", { class: "figure" }, `${course.contact_hours} h`),
          el("span", { class: "figure" }, `$${course.list_price}`),
        ),
      );
      list.append(row);
    }
  } catch (e) {
    handleError(e, "We couldn't load the courses right now.");
  }
}

function requireUser(): User {
  if (!currentUser) throw new Error("unauthenticated");
  return currentUser;
}

// --- course page ---------------------------------------------------------------

type CohortChoice = { id: string; label: string; disabled: boolean; reason: string };

async function renderCoursePage(mainEl: HTMLElement, courseId: string): Promise<void> {
  const user = requireUser();
  applyChrome(user);
  mainEl.textContent = "";
  let course: Course;
  try {
    course = (await api<{ course: Course }>("GET", `/api/courses/${courseId}`)).course;
  } catch (e) {
    handleError(e, "We couldn't open this course.");
    goBackToCourses();
    return;
  }

  const heading = el("h1", {}, course.title);
  const layout = el("div", { class: "course-layout" });
  const left = el("div", { class: "course-left" });
  const right = el("div", { class: "course-right sticky" });
  layout.append(left, right);
  mainEl.append(heading, layout);

  left.append(el("p", { class: "summary" }, course.summary));
  const moduleList = el("ul", { "aria-label": "Modules", class: "module-list" });
  for (const module of course.modules ?? []) {
    const row = el("li", { class: "module-row" });
    const glyph = el("span", { class: "glyph glyph-unknown", "aria-hidden": "true" });
    row.append(
      glyph,
      el("span", { class: "module-title" }, module.title),
      el("span", { class: "figure" }, `${module.minutes} min`),
      el("span", { class: "figure" }, module.kind === "lesson" ? "Lesson" : "Evaluation"),
    );
    moduleList.append(row);
  }
  left.append(moduleList);

  // The seal sits in the right column the way a stamp sits on a document.
  const sealData: SealData = {
    state: "open",
    modules: (course.modules ?? []).map((m) => ({ id: m.id, title: m.title, minutes: m.minutes, status: "unverified" })),
    totalMinutes: course.total_minutes,
    verifiedCount: 0,
    hours: course.contact_hours,
    serial: null,
    issuedOn: null,
  };
  const seal = buildSeal(sealData);
  seal.svg.setAttribute("data-seal-state", "open");
  right.append(el("div", { class: "seal-wrap" }, seal.svg));

  const price = el("p", { class: "price" }, `$${course.list_price} · ${course.contact_hours} contact hours`);
  right.append(price);

  let myEnrolment: Enrolment | null = null;
  try {
    const enrolments = await api<{ enrolments: Enrolment[] }>("GET", "/api/me/enrolments");
    myEnrolment = enrolments.enrolments.find((e) => e.course_id === course.id) ?? null;
  } catch {
    myEnrolment = null;
  }

  const activeEnrolment =
    myEnrolment && myEnrolment.state !== "refunded" && myEnrolment.state !== "withdrawn" ? myEnrolment : null;
  if (activeEnrolment) {
    const continueLink = el("a", { href: `/learn/${activeEnrolment.id}/${firstUnverified(activeEnrolment)}`, class: "btn btn-primary" }, "Continue learning");
    continueLink.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(`/learn/${activeEnrolment.id}/${firstUnverified(activeEnrolment)}`);
    });
    right.append(continueLink);
  } else if (course.state === "withdrawn") {
    right.append(el("p", { class: "notice" }, "This course has been withdrawn and is no longer open for enrolment."));
  } else if (course.state === "published") {
    const cohortChoices: CohortChoice[] =
      course.format === "cohort"
        ? (course.cohorts ?? []).map((c) => ({
            id: c.id,
            label: c.name,
            disabled: !c.open || c.seats_remaining <= 0,
            reason: !c.open ? "Enrolment closed" : c.seats_remaining <= 0 ? "Full" : "",
          }))
        : [];
    const enrolButton = el("button", { class: "btn btn-primary" }, "Enrol") as HTMLButtonElement;
    right.append(enrolButton);
    if (course.format === "cohort") {
      const group = el("div", { role: "radiogroup", "aria-label": "Cohort", class: "cohort-group" });
      let selectedCohort: string | null = null;
      (course.cohorts ?? []).forEach((cohort, index) => {
        const label = el("label", { class: "cohort-choice" });
        const radio = el("input", {
          type: "radio",
          name: "cohort",
          value: cohort.id,
          disabled: !cohort.open || cohort.seats_remaining <= 0,
        }) as HTMLInputElement;
        if (index === 0 && !radio.disabled) {
          radio.checked = true;
          selectedCohort = cohort.id;
        }
        radio.addEventListener("change", () => {
          selectedCohort = cohort.id;
        });
        const info = el("span", {},
          el("span", { class: "cohort-name" }, cohort.name),
          el("span", { class: "cohort-line" }, `${displayDate(cohort.starts_on)} start`),
          el("span", { class: "cohort-line" }, closeLine(cohort.close_date)),
          el("span", { class: "cohort-line" }, `${cohort.seats_remaining} seats remaining`),
          !cohort.open || cohort.seats_remaining <= 0
            ? el("span", { class: "cohort-line cohort-reason" }, !cohort.open ? "Enrolment closed" : "Full")
            : null,
        );
        label.append(radio, info);
        group.append(label);
      });
      right.insertBefore(group, enrolButton);
      enrolButton.addEventListener("click", () => {
        if (!selectedCohort) {
          announceAlert("Choose a cohort to enrol.");
          return;
        }
        void openCheckout(course, selectedCohort);
      });
    } else {
      enrolButton.addEventListener("click", () => void openCheckout(course, null));
    }
  }

  void course;
}

function firstUnverified(enrolment: Enrolment | null): string {
  if (!enrolment) return "";
  const unverified = enrolment.modules.find((m) => m.status === "unverified");
  return unverified?.id ?? enrolment.modules[0]?.id ?? "";
}

const newIdempotencyKey = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

async function openCheckout(course: Course, cohortId: string | null): Promise<void> {
  clearAlert();
  let quote = null as null | { list_price: string; employer_share: string; learner_share: string; sponsor: string | null };
  try {
    quote = (await api<typeof quote>("GET", `/api/checkout/quote?course_id=${course.id}`)) as never;
  } catch (e) {
    handleError(e, "We couldn't load the checkout details.");
    return;
  }
  let key = newIdempotencyKey();
  let chosenCohort = cohortId;

  openDialog({
    title: "Checkout",
    content: (dialog, close) => {
      const rows = el("dl", { class: "money-rows" });
      const renderRows = (q: NonNullable<typeof quote>): void => {
        const priceRow = el("div", { class: "money-row" }, el("dt", {}, "List price"), el("dd", {}, `$${q.list_price}`));
        rows.replaceChildren(priceRow);
        if (q.employer_share !== "0.00") {
          rows.append(el("div", { class: "money-row" }, el("dt", {}, `Paid by ${q.sponsor ?? "your hospital"}`), el("dd", {}, `$${q.employer_share}`)));
        }
        rows.append(el("div", { class: "money-row" }, el("dt", {}, "Your share"), el("dd", {}, `$${q.learner_share}`)));
      };
      if (quote) renderRows(quote);
      const payButton = el("button", { class: "btn btn-primary" }, "Pay") as HTMLButtonElement;
      const refreshPayLabel = (learnerShare: string): void => {
        payButton.textContent = learnerShare === "0.00" ? "Confirm enrolment" : `Pay $${learnerShare}`;
      };
      if (quote) refreshPayLabel(quote.learner_share);
      const cancelButton = el("button", { class: "btn btn-quiet" }, "Cancel");
      cancelButton.addEventListener("click", close);
      const waitlistButton = el("button", { class: "btn btn-quiet", hidden: true }, "Join waitlist") as HTMLButtonElement;
      waitlistButton.addEventListener("click", async () => {
        pendingButton(waitlistButton, "Joining the waitlist…");
        try {
          const entry = await api<{ waitlist_entry: { position: number } }>(
            "POST",
            `/api/cohorts/${chosenCohort}/waitlist`,
          );
          announce(`You're number ${entry.waitlist_entry.position} on the waitlist.`);
          close();
          void route();
        } catch (e) {
          restoreButton(waitlistButton);
          if (e instanceof ApiCallError && e.shape.code === "seats_available") {
            announceAlert("A seat is open again. Choose Enrol to take it.");
            return;
          }
          handleError(e, "We couldn't join the waitlist.");
        }
      });
      dialog.append(
        el("h2", {}, "Checkout"),
        rows,
        payButton,
        waitlistButton,
        cancelButton,
      );

      payButton.addEventListener("click", async () => {
        if (payButton.disabled) return;
        clearAlert();
        if (!quote) return;
        pendingButton(payButton, "Recording your payment…");
        try {
          const result = await api<{ enrolment: Enrolment }>(
            "POST",
            "/api/checkout",
            { course_id: course.id, cohort_id: chosenCohort, quoted_learner_share: quote.learner_share },
            { idempotencyKey: key },
          );
          announce(`You're enrolled in ${course.title}.`);
          close();
          navigate(`/courses/${course.id}`);
        } catch (e) {
          restoreButton(payButton);
          if (e instanceof ApiCallError) {
            const shape = e.shape;
            if (shape.code === "cohort_full") {
              waitlistButton.hidden = false;
              announceAlert(CHECKOUT_ERRORS["cohort_full"] ?? "");
              return;
            }
            if (shape.code === "quote_changed" && shape.extra.quote) {
              const newQuote = shape.extra.quote as { list_price: string; employer_share: string; learner_share: string; sponsor: string | null };
              quote = newQuote;
              key = newIdempotencyKey();
              renderRows(newQuote);
              refreshPayLabel(newQuote.learner_share);
              announceAlert(`The price changed while you were checking out. Your share is now $${newQuote.learner_share}.`);
              payButton.focus();
              return;
            }
            if (shape.code === "payments_unavailable") {
              announceAlert("Payments are unavailable right now. You have not been charged. Try again in a few minutes.");
              return;
            }
            if (shape.code === "network" || shape.code === undefined) {
              announceAlert("We couldn't reach Credwell. Check your connection and try again.");
              return;
            }
            announceAlert(errorCopy(shape.code ?? "", "Checkout could not complete.", shape.extra));
            if (shape.code === "course_not_open" || shape.code === "already_enrolled" || shape.code === "enrolment_closed") {
              close();
              void route();
            }
            return;
          }
          announceAlert("We couldn't reach Credwell. Check your connection and try again.");
        }
      });
    },
  });
  void chosenCohort;
}

// --- my learning ---------------------------------------------------------------

async function renderMyLearning(mainEl: HTMLElement): Promise<void> {
  const user = requireUser();
  applyChrome(user);
  mainEl.textContent = "";
  mainEl.append(el("h1", {}, "My learning"));
  const list = el("ul", { class: "enrolment-list" });
  mainEl.append(list);
  try {
    const data = await api<{ enrolments: Enrolment[] }>("GET", "/api/me/enrolments");
    for (const enrolment of data.enrolments) {
      const row = el("li", { class: "enrolment-row" });
      const funding =
        enrolment.funding === "card"
          ? "Your card"
          : enrolment.funding === "co_pay"
            ? `Card + ${user.organisation?.name ?? "your hospital"}`
            : `${user.organisation?.name ?? "Hospital"} seat`;
      const bar = el("div", { role: "progressbar", "aria-valuenow": String(enrolment.progress_percent), "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": `${enrolment.course_title} progress`, class: "progress" },
        el("div", { class: "progress-fill", style: `width:${enrolment.progress_percent}%` }),
      );
      const actions = el("div", { class: "row-actions" });
      const active = enrolment.state !== "refunded" && enrolment.state !== "withdrawn";
      if (active) {
        const nextModule = firstUnverified(enrolment);
        const continueLink = el("a", { href: `/learn/${enrolment.id}/${nextModule}`, class: "btn btn-primary" }, "Continue");
        continueLink.addEventListener("click", (event) => {
          event.preventDefault();
          navigate(`/learn/${enrolment.id}/${nextModule}`);
        });
        actions.append(continueLink);
      }
      if (enrolment.certificate_id) {
        const sealLink = el("a", { href: `/learn/${enrolment.id}/seal`, class: "btn btn-quiet" }, "Your seal");
        sealLink.addEventListener("click", (event) => {
          event.preventDefault();
          navigate(`/learn/${enrolment.id}/seal`);
        });
        actions.append(sealLink);
      }
      if (active && (enrolment.state === "confirmed" || enrolment.state === "held") && enrolment.funding !== "seat") {
        const refundButton = el("button", { class: "btn btn-quiet" }, "Request refund") as HTMLButtonElement;
        refundButton.addEventListener("click", () => void openRefundRequest(enrolment));
        actions.append(refundButton);
      }
      row.append(
        el("div", { class: "enrolment-main" },
          el("span", { class: "course-title" }, enrolment.course_title),
          el("span", { class: "figure" }, `${enrolment.progress_percent}%`),
        ),
        el("div", { class: "enrolment-meta" },
          el("span", { class: "figure" }, stateLabel(enrolment.state)),
          el("span", { class: "figure" }, funding),
        ),
        bar,
        actions,
      );
      list.append(row);
    }
  } catch (e) {
    handleError(e, "We couldn't load your learning.");
  }
}

const STATE_LABELS: Record<string, string> = {
  held: "Held",
  confirmed: "Confirmed",
  completed: "Completed",
  certified: "Certified",
  refunded: "Refunded",
  withdrawn: "Withdrawn",
  draft: "Draft",
  in_review: "In review",
  published: "Published",
  withdrawn_course: "Withdrawn",
};

function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

async function openRefundRequest(enrolment: Enrolment): Promise<void> {
  clearAlert();
  openDialog({
    title: "Request a refund",
    content: (dialog, close) => {
      const reason = el("textarea", { class: "input", rows: "3" }) as HTMLTextAreaElement;
      reason.setAttribute("aria-label", "Reason");
      const send = el("button", { class: "btn btn-primary" }, "Send request") as HTMLButtonElement;
      const cancel = el("button", { class: "btn btn-quiet" }, "Cancel");
      cancel.addEventListener("click", close);
      dialog.append(el("h2", {}, "Request a refund"), reason, send, cancel);
      send.addEventListener("click", async () => {
        pendingButton(send, "Sending your request…");
        try {
          await api("POST", `/api/enrolments/${enrolment.id}/refund-request`, { reason: reason.value });
          announce("Refund requested. The nurse planner will review it.");
          close();
          void route();
        } catch (e) {
          restoreButton(send);
          if (e instanceof ApiCallError) {
            if (e.shape.errors && e.shape.errors["reason"]) {
              announceAlert(e.shape.errors["reason"]);
              return;
            }
            if (e.shape.status === 409) {
              announceAlert("This enrolment can't be refunded.");
              return;
            }
          }
          handleError(e, "We couldn't send your request.");
        }
      });
    },
  });
}

// --- module player and post-evaluation ------------------------------------------

async function renderLearn(mainEl: HTMLElement, path: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  const enrolmentId = parts[1] ?? "";
  const rest = parts.slice(2).join("/");
  if (rest === "evaluation") {
    await renderEvaluation(mainEl, enrolmentId);
    return;
  }
  if (rest === "seal") {
    await renderCompletion(mainEl, enrolmentId, false);
    return;
  }
  const moduleId = rest;
  await renderModulePlayer(mainEl, enrolmentId, moduleId);
}

async function renderModulePlayer(mainEl: HTMLElement, enrolmentId: string, moduleId: string): Promise<void> {
  const user = requireUser();
  applyChrome(user);
  mainEl.textContent = "";
  let enrolment: Enrolment;
  let moduleData: { module: { id: string; title: string; minutes: number; kind: string; body: string; question: { prompt: string; options: string[] } | null }; status: string };
  try {
    enrolment = (await api<{ enrolment: Enrolment }>("GET", `/api/enrolments/${enrolmentId}`)).enrolment;
    moduleData = await api<typeof moduleData>("GET", `/api/enrolments/${enrolmentId}/modules/${moduleId}`) as never;
  } catch {
    navigate("/learning");
    return;
  }
  const frame = el("div", { class: "learn-layout" });
  const nav = el("nav", { "aria-label": "Course modules", class: "module-nav" });
  for (const module of enrolment.modules) {
    const link = el("a", { href: `/learn/${enrolmentId}/${module.id}`, class: `module-nav-link ${module.id === moduleId ? "current" : ""}` }) as HTMLAnchorElement;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(`/learn/${enrolmentId}/${module.id}`);
    });
    link.append(
      el("span", { class: `glyph ${module.status === "verified" ? "glyph-verified" : "glyph-unknown"}`, "aria-hidden": "true" }),
      el("span", {}, module.title),
    );
    const status = el("span", { class: "module-status" }, module.status === "verified" ? "Verified" : "Not yet verified");
    link.append(status);
    nav.append(link);
  }
  const lesson = el("section", { "aria-label": "Lesson", class: "lesson" });
  const heading = el("h1", {}, moduleData.module.title);
  lesson.append(heading);
  lesson.append(el("p", { class: "figure" }, `${moduleData.module.minutes} min`));
  lesson.append(el("p", { class: "lesson-body" }, moduleData.module.body));
  frame.append(nav, lesson);
  mainEl.append(frame);

  if (moduleData.module.kind === "evaluation") {
    const evalLink = el("a", { href: `/learn/${enrolmentId}/evaluation`, class: "btn btn-primary" }, "Go to post-evaluation");
    evalLink.addEventListener("click", (event) => {
      event.preventDefault();
      navigate(`/learn/${enrolmentId}/evaluation`);
    });
    lesson.append(evalLink);
    return;
  }

  const question = moduleData.module.question;
  const group = el("div", { role: "radiogroup", "aria-label": question?.prompt ?? "Question", class: "choices" });
  const radios: HTMLInputElement[] = [];
  (question?.options ?? []).forEach((option, index) => {
    const label = el("label", { class: "choice" });
    const radio = el("input", { type: "radio", name: "answer", value: String(index) }) as HTMLInputElement;
    radios.push(radio);
    label.append(radio, el("span", {}, option));
    group.append(label);
  });
  const checkButton = el("button", { class: "btn btn-primary" }, "Check answer") as HTMLButtonElement;
  const nextLinkHolder = el("div", { class: "next-holder" });
  lesson.append(group, checkButton, nextLinkHolder);

  if (moduleData.status === "verified") {
    checkButton.disabled = true;
    checkButton.textContent = "Verified";
    appendNextLinks();
    return;
  }

  checkButton.addEventListener("click", async () => {
    clearAlert();
    const chosen = radios.findIndex((radio) => radio.checked);
    if (chosen === -1) {
      announceAlert("Choose an answer first.");
      return;
    }
    pendingButton(checkButton, "Checking…");
    try {
      await api("POST", `/api/enrolments/${enrolmentId}/modules/${moduleId}/answer`, { option_index: chosen });
      announce("Module verified.");
      moduleData.status = "verified";
      const glyph = nav.querySelector(`.module-nav-link[href="/learn/${enrolmentId}/${moduleId}"] .glyph`);
      glyph?.classList.replace("glyph-unknown", "glyph-verified");
      const status = nav.querySelector(`.module-nav-link[href="/learn/${enrolmentId}/${moduleId}"] .module-status`);
      if (status) status.textContent = "Verified";
      checkButton.textContent = "Verified";
      checkButton.disabled = true;
      appendNextLinks();
      const next = nextLinkHolder.querySelector<HTMLElement>(".btn");
      next?.focus();
    } catch (e) {
      restoreButton(checkButton);
      if (e instanceof ApiCallError) {
        if (e.shape.errors && e.shape.errors["option_index"]) {
          announceAlert(e.shape.errors["option_index"]);
          (radios[0]?.closest("label") ?? group).focus?.();
          return;
        }
      }
      handleError(e, "We couldn't check your answer.");
    }
  });

  function appendNextLinks(): void {
    nextLinkHolder.textContent = "";
    const allVerified = enrolment.modules.filter((m) => m.kind === "lesson").every((m) => m.status === "verified");
    const index = enrolment.modules.findIndex((m) => m.id === moduleId);
    const nextModule = enrolment.modules[index + 1];
    if (nextModule) {
      const link = el("a", { href: `/learn/${enrolmentId}/${nextModule.id}`, class: "btn btn-primary" }, nextModule.kind === "evaluation" ? "Go to post-evaluation" : "Next module");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        navigate(`/learn/${enrolmentId}/${nextModule.id}`);
      });
      nextLinkHolder.append(link);
    }
    if (allVerified) {
      const evalLink = el("a", { href: `/learn/${enrolmentId}/evaluation`, class: "btn btn-quiet" }, "Go to post-evaluation");
      evalLink.addEventListener("click", (event) => {
        event.preventDefault();
        navigate(`/learn/${enrolmentId}/evaluation`);
      });
      nextLinkHolder.append(evalLink);
    }
  }
}

async function renderEvaluation(mainEl: HTMLElement, enrolmentId: string): Promise<void> {
  const user = requireUser();
  applyChrome(user);
  mainEl.textContent = "";
  let enrolment: Enrolment;
  try {
    enrolment = (await api<{ enrolment: Enrolment }>("GET", `/api/enrolments/${enrolmentId}`)).enrolment;
  } catch {
    navigate("/learning");
    return;
  }
  const frame = el("div", { class: "learn-layout" });
  const lesson = el("section", { "aria-label": "Post-evaluation", class: "lesson" });
  lesson.append(el("h1", {}, "Post-evaluation"));

  const ratingGroup = el("div", { role: "radiogroup", "aria-label": "Overall rating", class: "choices" });
  const ratingRadios: HTMLInputElement[] = [];
  for (let i = 1; i <= 5; i += 1) {
    const label = el("label", { class: "choice" });
    const radio = el("input", { type: "radio", name: "rating", value: String(i) }) as HTMLInputElement;
    ratingRadios.push(radio);
    label.append(radio, el("span", {}, String(i)));
    ratingGroup.append(label);
  }
  const outcomesGroup = el("div", { role: "radiogroup", "aria-label": "Did this activity meet its stated outcomes?", class: "choices" });
  const outcomeRadios: HTMLInputElement[] = [];
  for (const value of ["Yes", "No"]) {
    const label = el("label", { class: "choice" });
    const radio = el("input", { type: "radio", name: "met_outcomes", value: value === "Yes" ? "true" : "false" }) as HTMLInputElement;
    outcomeRadios.push(radio);
    label.append(radio, el("span", {}, value));
    outcomesGroup.append(label);
  }
  const comments = el("textarea", { class: "input", rows: "3" }) as HTMLTextAreaElement;
  comments.setAttribute("aria-label", "Comments (optional)");
  const submit = el("button", { class: "btn btn-primary" }, "Submit evaluation") as HTMLButtonElement;
  const refreshDisabled = (): void => {
    const ratingChosen = ratingRadios.some((r) => r.checked);
    const outcomeChosen = outcomeRadios.some((r) => r.checked);
    submit.disabled = !(ratingChosen && outcomeChosen);
  };
  ratingRadios.forEach((r) => r.addEventListener("change", refreshDisabled));
  outcomeRadios.forEach((r) => r.addEventListener("change", refreshDisabled));
  refreshDisabled();

  lesson.append(ratingGroup, outcomesGroup, comments, submit);
  frame.append(lesson);
  mainEl.append(frame);

  submit.addEventListener("click", async () => {
    if (submit.disabled) return;
    clearAlert();
    pendingButton(submit, "Submitting your evaluation…");
    const rating = Number(ratingRadios.find((r) => r.checked)?.value ?? 0);
    const met = outcomeRadios.find((r) => r.checked)?.value === "true";
    try {
      const response = await fetch(`/api/enrolments/${enrolmentId}/evaluation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, met_outcomes: met, comment: comments.value }),
        credentials: "same-origin",
      });
      const body = (await response.json()) as { certificate: Certificate };
      if (response.status === 200 || response.status === 201) {
        announce(`Certificate sealed: ${body.certificate.contact_hours} contact hours, serial ${body.certificate.serial}`);
        sessionStorage.setItem(`credwell-seal-press-${enrolmentId}`, "1");
        navigate(`/learn/${enrolmentId}/seal`);
        return;
      }
      if (response.status === 202) {
        announce("Your evaluation is recorded. The certificate PDF is still being stored. Your hours appear on your transcript once it is sealed, and we'll email you then.");
        sessionStorage.setItem(`credwell-seal-press-${enrolmentId}`, "1");
        navigate(`/learn/${enrolmentId}/seal`);
        return;
      }
      restoreButton(submit);
      if (response.status === 409) {
        announceAlert("Finish every lesson before the post-evaluation.");
        return;
      }
      announceAlert("We couldn't submit your evaluation.");
    } catch {
      restoreButton(submit);
      announceAlert("We couldn't reach Credwell. Check your connection and try again.");
    }
  });
  void enrolment;
}

// --- completion screen ----------------------------------------------------------

async function renderCompletion(mainEl: HTMLElement, enrolmentId: string, replay: boolean): Promise<void> {
  const user = requireUser();
  applyChrome(user);
  mainEl.textContent = "";
  let enrolment: Enrolment;
  let certificate: Certificate | null = null;
  try {
    enrolment = (await api<{ enrolment: Enrolment }>("GET", `/api/enrolments/${enrolmentId}`)).enrolment;
    if (enrolment.certificate_id) {
      certificate = (await api<{ certificate: Certificate }>("GET", `/api/certificates/${enrolment.certificate_id}`)).certificate;
    }
  } catch {
    navigate("/learning");
    return;
  }

  // The press plays once, the first time this browser submits the evaluation.
  const pressKey = `credwell-seal-press-${enrolmentId}`;
  const fresh = !replay && sessionStorage.getItem(pressKey) === "1";
  if (fresh) sessionStorage.removeItem(pressKey);
  const heading = el("h1", { tabindex: "-1" }, "Your contact-hour seal");
  mainEl.append(heading);

  const layout = el("div", { class: "seal-layout" });
  const sealHolder = el("div", { class: "seal-holder" });
  const moduleHolder = el("div", { class: "seal-modules" });
  layout.append(sealHolder, moduleHolder);
  mainEl.append(layout);

  const statusRegion = el("p", { role: "status", "aria-live": "polite", "aria-label": "Seal status", class: "seal-status" });
  mainEl.append(statusRegion);

  const actions = el("div", { class: "seal-actions" });
  const shareButton = el("button", { class: "btn btn-primary" }, "Share with a verifier") as HTMLButtonElement;
  const downloadLink = el("a", { href: "#", class: "btn btn-quiet" }, "Download certificate PDF") as HTMLAnchorElement;
  actions.append(shareButton, downloadLink);
  mainEl.append(actions);

  const render = (cert: Certificate | null): void => {
    const sealData = sealFromEnrolment(enrolment, cert);
    const seal = buildSeal(sealData);
    seal.svg.setAttribute("data-seal-state", sealData.state);
    sealHolder.textContent = "";
    sealHolder.append(seal.svg);

    moduleHolder.textContent = "";
    const list = el("ul", { "aria-label": "Modules", class: "module-list" });
    for (const module of enrolment.modules) {
      list.append(
        el("li", { class: "module-row" },
          el("span", { class: `glyph ${module.status === "verified" ? "glyph-verified" : "glyph-unknown"}`, "aria-hidden": "true" }),
          el("span", { class: "module-title" }, module.title),
          el("span", { class: "module-status" }, module.status === "verified" ? "Verified" : "Not yet verified"),
        ),
      );
    }
    moduleHolder.append(list);

    if (cert === null || cert.state === "sealing") {
      statusRegion.textContent = "Certificate PDF pending";
      shareButton.disabled = true;
      downloadLink.classList.add("disabled");
      downloadLink.setAttribute("aria-disabled", "true");
      downloadLink.addEventListener("click", (event) => {
        if (downloadLink.classList.contains("disabled")) {
          event.preventDefault();
          announce("The certificate PDF is still being stored.");
        }
      });
    } else {
      statusRegion.textContent =
        cert.state === "revoked"
          ? "Certificate revoked."
          : `Certificate sealed: ${cert.contact_hours} contact hours, serial ${cert.serial}`;
      shareButton.disabled = cert.state !== "sealed";
      downloadLink.classList.remove("disabled");
      downloadLink.removeAttribute("aria-disabled");
      downloadLink.href = `/api/certificates/${cert.id}/pdf`;
    }

    if (fresh && cert !== null && cert.state !== "sealing" && !prefersReducedMotion()) {
      const showNow = el("button", { class: "btn btn-quiet" }, "Show result now") as HTMLButtonElement;
      const press = playSealPress(seal, sealData, () => {
        showNow.remove();
        if (shareButton.disabled) downloadLink.focus();
        else shareButton.focus();
      });
      showNow.addEventListener("click", () => {
        press.cancel();
        showNow.remove();
        if (shareButton.disabled) downloadLink.focus();
        else shareButton.focus();
      });
      actions.insertBefore(showNow, shareButton);
    } else {
      seal.numeral.textContent = sealData.hours;
    }
  };

  render(certificate);
  heading.focus();

  shareButton.addEventListener("click", () => {
    if (certificate) void openShareDialog(certificate);
  });

  // While the first PDF is pending the screen re-reads the certificate.
  if (certificate === null || certificate.state === "sealing") {
    const timer = window.setInterval(async () => {
      try {
        if (!enrolment.certificate_id) return;
        const cert = (await api<{ certificate: Certificate }>("GET", `/api/certificates/${enrolment.certificate_id}`)).certificate;
        if (cert.state === "sealed" || cert.state === "revoked") {
          window.clearInterval(timer);
          certificate = cert;
          render(cert);
          statusRegion.textContent = `Certificate sealed: ${cert.contact_hours} contact hours, serial ${cert.serial}`;
          announce(`Certificate sealed: ${cert.contact_hours} contact hours, serial ${cert.serial}`);
          if (!shareButton.disabled) shareButton.focus();
        }
      } catch {
        // next poll
      }
    }, 5000);
  }
}

// --- transcript and share dialog ------------------------------------------------

async function renderTranscript(mainEl: HTMLElement): Promise<void> {
  const user = requireUser();
  applyChrome(user);
  mainEl.textContent = "";
  mainEl.append(el("h1", {}, "Transcript"));
  try {
    const data = await api<{ certificates: Certificate[]; total_hours: string }>("GET", "/api/me/transcript");
    const wrap = el("div", { class: "table-wrap" });
    const table = el("table", { "aria-label": "Certificates", class: "table" });
    const thead = el("thead", {},
      el("tr", {},
        el("th", {}, "Course"), el("th", {}, "Serial"), el("th", {}, "Issued"), el("th", { class: "num" }, "Hours"), el("th", {}, "Status"),
      ),
    );
    const tbody = el("tbody");
    for (const cert of data.certificates) {
      const row = el("tr", {});
      const pending = cert.issued_on === null;
      const actions = el("div", { class: "row-actions" });
      if (cert.state === "sealed") {
        const share = el("button", { class: "btn btn-quiet" }, "Share") as HTMLButtonElement;
        share.addEventListener("click", () => void openShareDialog(cert));
        actions.append(share);
      }
      const view = el("a", { href: `/learn/${cert.enrolment_id}/seal`, class: "btn btn-quiet" }, "View seal");
      view.addEventListener("click", (event) => {
        event.preventDefault();
        navigate(`/learn/${cert.enrolment_id}/seal`);
      });
      actions.append(view);
      row.append(
        el("td", {}, cert.course_title, actions),
        el("td", {}, cert.serial),
        el("td", {}, pending ? "Pending" : displayDate(cert.issued_on)),
        el("td", { class: "num" }, cert.contact_hours),
        el("td", {}, cert.state === "sealing" ? "Pending" : cert.state === "sealed" ? "Sealed" : "Revoked"),
      );
      tbody.append(row);
    }
    table.append(thead, tbody);
    const total = el("p", { class: "totals" }, el("span", {}, "Total earned hours"), el("span", { class: "num" }, data.total_hours));
    wrap.append(table, total);
    mainEl.append(wrap);
  } catch (e) {
    handleError(e, "We couldn't load your transcript.");
  }
}

async function openShareDialog(certificate: Certificate): Promise<void> {
  clearAlert();
  let links: Array<{ id: string; url: string; state: string; expires_at: string }> = [];
  try {
    links = (await api<{ links: typeof links }>("GET", `/api/certificates/${certificate.id}/share-links`)).links;
    const active = links.find((l) => l.state === "active");
    if (!active) {
      const created = await api<{ link: { id: string; url: string; state: string; expires_at: string } }>(
        "POST",
        `/api/certificates/${certificate.id}/share-links`,
      );
      announce("Verification link ready. Anyone with this link can see this one certificate.");
      links = [created.link];
    }
  } catch (e) {
    handleError(e, "We couldn't open the share dialog.");
    return;
  }

  openDialog({
    title: "Share with a verifier",
    content: (dialog, close) => {
      const input = el("input", { class: "input", readonly: true }) as HTMLInputElement;
      input.setAttribute("aria-label", "Verification link");
      const current = links.find((l) => l.state === "active");
      input.value = current ? `${window.location.origin}${current.url}` : "No active link";
      const copyButton = el("button", { class: "btn btn-primary" }, "Copy link") as HTMLButtonElement;
      const newButton = el("button", { class: "btn btn-quiet" }, "Create new link") as HTMLButtonElement;
      const revokeButton = el("button", { class: "btn btn-quiet" }, "Revoke link") as HTMLButtonElement;
      const closeButton = el("button", { class: "btn btn-quiet" }, "Close") as HTMLButtonElement;
      closeButton.addEventListener("click", close);
      dialog.append(el("h2", {}, "Share with a verifier"), input, copyButton, newButton, revokeButton, closeButton);

      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(input.value);
          announce("Link copied.");
        } catch {
          announce("Link copied.");
        }
      });
      newButton.addEventListener("click", async () => {
        pendingButton(newButton, "Creating a link…");
        try {
          const created = await api<{ link: { id: string; url: string; state: string; expires_at: string } }>(
            "POST",
            `/api/certificates/${certificate.id}/share-links`,
          );
          links = [created.link, ...links];
          input.value = `${window.location.origin}${created.link.url}`;
          restoreButton(newButton);
          announce("Verification link ready. Anyone with this link can see this one certificate.");
        } catch (e) {
          restoreButton(newButton);
          if (e instanceof ApiCallError && e.shape.code === "certificate_not_sealed") {
            announceAlert("This certificate can be shared once its PDF is sealed.");
            return;
          }
          handleError(e, "We couldn't create a link.");
        }
      });
      revokeButton.addEventListener("click", async () => {
        const active = links.find((l) => l.state === "active");
        if (!active) return;
        pendingButton(revokeButton, "Revoking…");
        try {
          await api("DELETE", `/api/certificates/${certificate.id}/share-links/${active.id}`);
          links = links.map((l) => (l.id === active.id ? { ...l, state: "revoked" } : l));
          input.value = "No active link";
          restoreButton(revokeButton);
          announce("Link revoked. It no longer opens the certificate.");
        } catch (e) {
          restoreButton(revokeButton);
          handleError(e, "We couldn't revoke the link.");
        }
      });
    },
  });
}

// --- public verification page ----------------------------------------------------

async function renderVerify(mainEl: HTMLElement, token: string): Promise<void> {
  applyMinimalChrome();
  mainEl.textContent = "";
  try {
    const data = await api<{ certificate: import("./api.ts").VerificationCertificate }>("GET", `/api/verify/${token}`);
    const cert = data.certificate;
    const card = el("section", { class: "card card-narrow verify-card" });
    card.append(el("h1", {}, "Certificate verification"));
    card.append(el("p", { class: "provider" }, cert.provider));
    card.append(el("p", { class: "accreditation" }, cert.accreditation_statement));
    const list = el("dl", { class: "verify-list" });
    const addRow = (label: string, value: string): void => {
      list.append(el("div", { class: "verify-row" }, el("dt", {}, label), el("dd", {}, value)));
    };
    addRow("Nurse", cert.nurse_name);
    addRow("Course", cert.course_title);
    addRow("Contact hours", cert.contact_hours);
    addRow("Serial", cert.serial);
    addRow("Issued", displayDate(cert.issued_on));
    addRow("Status", cert.state === "revoked" ? "Revoked" : "Sealed");
    card.append(list);
    const download = el("a", { href: `/api/verify/${token}/pdf`, class: "btn btn-primary" }, "Download PDF");
    card.append(download);
    mainEl.append(card);
  } catch {
    mainEl.append(el("section", { class: "card card-narrow verify-card" },
      el("h1", {}, "Link not valid"),
      el("p", {}, "This verification link is not valid. It may have been revoked or expired."),
    ));
  }
}

// --- hospital seats (sponsor coordinator) -----------------------------------------

type SponsorLearner = { id: string; display_name: string; email: string; seats_held: number; hours_completed: string };

async function renderSponsor(mainEl: HTMLElement): Promise<void> {
  const user = requireUser();
  applyChrome(user);
  mainEl.textContent = "";
  mainEl.append(el("h1", {}, "Hospital seats"));
  const totals = el("section", { "aria-label": "Totals", class: "totals-strip" });
  const packsSection = el("section", { class: "sponsor-section" });
  const coverageSection = el("section", { class: "sponsor-section" });
  const searchSection = el("section", { class: "sponsor-section" });
  const reportSection = el("section", { class: "sponsor-section" });
  mainEl.append(totals, packsSection, coverageSection, searchSection, reportSection);

  // totals
  const renderTotals = (data: import("./api.ts").Dashboard): void => {
    totals.textContent = "";
    const cell = (label: string, value: string): HTMLElement =>
      el("div", { class: "totals-cell" }, el("span", { class: "totals-label" }, label), el("span", { class: "num" }, value));
    totals.append(
      cell("Seats purchased", String(data.seats_purchased)),
      cell("Assigned", String(data.seats_assigned)),
      cell("Available", String(data.seats_available)),
      cell("Expired", String(data.seats_expired)),
      cell("Completions", String(data.completions)),
      cell("Hours awarded", data.hours_awarded),
    );
  };

  const refreshTotals = async (): Promise<void> => {
    try {
      const data = await api<import("./api.ts").Dashboard>("GET", "/api/sponsor/dashboard");
      renderTotals(data);
    } catch (e) {
      handleError(e, "We couldn't load your totals.");
    }
  };
  await refreshTotals();

  // packs table
  packsSection.append(el("h2", {}, "Seat packs"));
  const buyButton = el("button", { class: "btn btn-primary" }, "Buy seats") as HTMLButtonElement;
  packsSection.append(buyButton);
  buyButton.addEventListener("click", () => void openBuySeats(refreshAll));
  const packsTableHolder = el("div", { class: "table-wrap" });
  packsSection.append(packsTableHolder);

  const renderPacks = async (): Promise<void> => {
    packsTableHolder.textContent = "";
    try {
      const data = await api<{ packs: Array<import("./api.ts").Pack> }>("GET", "/api/sponsor/packs");
      const table = el("table", { "aria-label": "Seat packs", class: "table" });
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "Course"), el("th", { class: "num" }, "Seats"), el("th", { class: "num" }, "Balance"),
        el("th", {}, "Expiry"), el("th", {}, "State"), el("th", {}, ""),
      )));
      const tbody = el("tbody");
      for (const pack of data.packs) {
        const row = el("tr", {});
        const actions = el("div", { class: "row-actions" });
        const assign = el("button", { class: "btn btn-quiet" }, "Assign seat") as HTMLButtonElement;
        assign.addEventListener("click", () => void openAssignSeat(pack, refreshAll));
        const ledgerButton = el("button", { class: "btn btn-quiet" }, "Show ledger") as HTMLButtonElement;
        ledgerButton.addEventListener("click", async () => {
          if (ledgerButton.textContent === "Show ledger") {
            const ledger = await loadLedger(pack.id);
            ledgerRow.textContent = "";
            ledgerRow.append(ledger);
            ledgerButton.textContent = "Hide ledger";
          } else {
            ledgerRow.textContent = "";
            ledgerButton.textContent = "Show ledger";
          }
        });
        actions.append(assign, ledgerButton);
        row.append(
          el("td", {}, pack.course_title, actions),
          el("td", { class: "num" }, String(pack.seats_purchased)),
          el("td", { class: "num" }, String(pack.balance)),
          el("td", {}, displayDate(pack.expires_at.slice(0, 10))),
          el("td", {}, pack.state === "expired" ? "Expired" : "Active"),
          el("td", {}, ""),
        );
        tbody.append(row);
        const ledgerRow = el("tr", { class: "ledger-row" });
        ledgerRow.append(el("td", { colspan: "6" }));
        tbody.append(ledgerRow);
      }
      table.append(tbody);
      packsTableHolder.append(table);
    } catch (e) {
      handleError(e, "We couldn't load your packs.");
    }
  };

  const loadLedger = async (packId: string): Promise<HTMLElement> => {
    const data = await api<{
      pack_id: string;
      balance: number;
      entries: Array<{ movement_id: string; kind: string; account: string; seats: number; assignment_id: string | null; posted_at: string }>;
    }>("GET", `/api/sponsor/packs/${packId}/ledger`);
    const wrap = el("div", { class: "ledger-wrap" });
    const table = el("table", { "aria-label": "Ledger", class: "table" });
    table.append(el("thead", {}, el("tr", {},
      el("th", {}, "Kind"), el("th", {}, "Account"), el("th", { class: "num" }, "Seats"), el("th", {}, "Posted"),
    )));
    const tbody = el("tbody");
    for (const entry of data.entries) {
      tbody.append(el("tr", {},
        el("td", {}, entry.kind),
        el("td", {}, entry.account),
        el("td", { class: "num" }, String(entry.seats)),
        el("td", {}, displayDate(entry.posted_at.slice(0, 10))),
      ));
    }
    table.append(tbody);
    wrap.append(table, el("p", { class: "totals" }, el("span", {}, "Balance"), el("span", { class: "num" }, String(data.balance))));
    return wrap;
  };

  // coverage
  coverageSection.append(el("h2", {}, "Tuition coverage"));
  const percent = el("input", { type: "number", class: "input", min: "0", max: "100", step: "0.01" }) as HTMLInputElement;
  percent.setAttribute("aria-label", "Tuition covered (%)");
  const effectiveFrom = el("input", { type: "date", class: "input" }) as HTMLInputElement;
  effectiveFrom.setAttribute("aria-label", "Effective from");
  effectiveFrom.value = providerToday();
  const saveCoverage = el("button", { class: "btn btn-primary" }, "Save coverage") as HTMLButtonElement;
  const scheduledLine = el("p", { class: "scheduled-line" });
  coverageSection.append(percent, effectiveFrom, saveCoverage, scheduledLine);
  const renderCoverage = async (): Promise<void> => {
    try {
      const data = await api<{ coverage: import("./api.ts").Coverage }>("GET", "/api/sponsor/dashboard");
      percent.value = data.coverage.coverage_percent;
      scheduledLine.textContent = data.coverage.scheduled
        ? `Scheduled: ${data.coverage.scheduled.coverage_percent}% from ${displayDate(data.coverage.scheduled.effective_on)}`
        : "";
    } catch {
      // next refresh
    }
  };
  await renderCoverage();
  saveCoverage.addEventListener("click", async () => {
    clearAlert();
    pendingButton(saveCoverage, "Saving…");
    try {
      const coverage = await api<import("./api.ts").Coverage>("PATCH", "/api/sponsor/coverage", {
        coverage_percent: percent.value,
        effective_on: effectiveFrom.value,
      });
      restoreButton(saveCoverage);
      if (coverage.scheduled) {
        announce(`Tuition coverage of ${coverage.scheduled.coverage_percent}% scheduled from ${displayDate(coverage.scheduled.effective_on)}.`);
      } else {
        announce("Tuition coverage saved.");
      }
      await refreshAll();
    } catch (e) {
      restoreButton(saveCoverage);
      if (e instanceof ApiCallError && e.shape.errors) {
        announceAlert(Object.values(e.shape.errors)[0] ?? "Check the coverage settings.");
        return;
      }
      handleError(e, "We couldn't save the coverage.");
    }
  });

  // nurse search
  searchSection.append(el("h2", {}, "Your nurses"));
  const search = el("input", { type: "search", class: "input", placeholder: "Search nurses" }) as HTMLInputElement;
  search.setAttribute("aria-label", "Search nurses");
  const searchError = el("p", { class: "field-error-holder" });
  const nursesHolder = el("div", { class: "table-wrap" });
  searchSection.append(search, searchError, nursesHolder);
  let searchTimer = 0;
  const runSearch = async (q: string): Promise<void> => {
    try {
      const data = await api<{ learners: SponsorLearner[] }>("GET", `/api/sponsor/learners?q=${encodeURIComponent(q)}`);
      searchError.textContent = "";
      nursesHolder.textContent = "";
      const table = el("table", { "aria-label": "Nurses", class: "table" });
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "Nurse"), el("th", {}, "Email"), el("th", { class: "num" }, "Seats held"), el("th", { class: "num" }, "Hours"),
      )));
      const tbody = el("tbody");
      for (const learner of data.learners) {
        const actions = el("div", { class: "row-actions" });
        const show = el("button", { class: "btn btn-quiet" }, "Show enrolments") as HTMLButtonElement;
        actions.append(show);
        const row = el("tr", {},
          el("td", {}, learner.display_name, actions),
          el("td", {}, learner.email),
          el("td", { class: "num" }, String(learner.seats_held)),
          el("td", { class: "num" }, learner.hours_completed),
        );
        show.addEventListener("click", async () => {
          if (show.textContent === "Show enrolments") {
            const detailRow = el("tr", { class: "ledger-row" });
            detailRow.append(el("td", { colspan: "4" }));
            row.after(detailRow);
            const holder = detailRow.querySelector("td") as HTMLElement;
            try {
              const record = await api<{ enrolments: Enrolment[]; certificates: Certificate[] }>(
                "GET",
                `/api/sponsor/learners/${learner.id}`,
              );
              holder.append(renderNurseEnrolments(record.enrolments, record.certificates, refreshAll));
            } catch (e) {
              holder.textContent = "We couldn't load this nurse's enrolments.";
              void e;
            }
            show.textContent = "Hide enrolments";
          } else {
            const detail = row.nextElementSibling;
            detail?.remove();
            show.textContent = "Show enrolments";
          }
        });
        tbody.append(row);
      }
      table.append(tbody);
      nursesHolder.append(table);
    } catch (e) {
      if (e instanceof ApiCallError && e.shape.errors && e.shape.errors["q"]) {
        searchError.textContent = e.shape.errors["q"];
        return;
      }
      handleError(e, "We couldn't search your nurses.");
    }
  };
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void runSearch(search.value), 250);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch(search.value);
    }
  });
  await runSearch("");

  // monthly report + export
  reportSection.append(el("h2", {}, "Compliance reporting"));
  const year = el("select", { class: "input" }) as HTMLSelectElement;
  year.setAttribute("aria-label", "Report year");
  const currentYear = Number(providerToday().slice(0, 4));
  for (let y = currentYear + 1; y >= currentYear - 4; y -= 1) {
    year.append(el("option", { value: String(y) }, String(y)));
  }
  year.value = String(currentYear);
  const monthlyHolder = el("div", { class: "table-wrap" });
  reportSection.append(year, monthlyHolder);

  const exportYear = el("input", { type: "date", class: "input" }) as HTMLInputElement;
  exportYear.setAttribute("aria-label", "From");
  const exportTo = el("input", { type: "date", class: "input" }) as HTMLInputElement;
  exportTo.setAttribute("aria-label", "To");
  exportYear.value = `${currentYear}-01-01`;
  exportTo.value = `${currentYear}-12-31`;
  const exportButton = el("button", { class: "btn btn-primary" }, "Export completions CSV") as HTMLButtonElement;
  const exportHolder = el("p", { class: "export-holder" });
  reportSection.append(exportYear, exportTo, exportButton, exportHolder);

  const renderMonthly = async (): Promise<void> => {
    monthlyHolder.textContent = "";
    try {
      const data = await api<{ year: string; months: Array<{ month: string; completions: number; hours: string }> }>(
        "GET",
        `/api/sponsor/reports/monthly?year=${year.value}`,
      );
      const table = el("table", { "aria-label": "Monthly hours", class: "table" });
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "Month"), el("th", { class: "num" }, "Completions"), el("th", { class: "num" }, "Hours"),
      )));
      const tbody = el("tbody");
      for (const month of data.months) {
        tbody.append(el("tr", {},
          el("td", {}, month.month),
          el("td", { class: "num" }, String(month.completions)),
          el("td", { class: "num" }, month.hours),
        ));
      }
      table.append(tbody);
      monthlyHolder.append(table);
    } catch (e) {
      if (e instanceof ApiCallError && e.shape.errors && e.shape.errors["year"]) {
        announceAlert(e.shape.errors["year"]);
        return;
      }
      handleError(e, "We couldn't load the monthly report.");
    }
  };
  year.addEventListener("change", () => void renderMonthly());
  await renderMonthly();

  exportButton.addEventListener("click", async () => {
    clearAlert();
    pendingButton(exportButton, "Preparing your CSV…");
    try {
      const data = await api<{ export: { id: string; rows: number; download_url: string } }>(
        "POST",
        "/api/sponsor/exports",
        { from: exportYear.value, to: exportTo.value },
      );
      restoreButton(exportButton);
      announce(`Export ready: ${data.export.rows} rows.`);
      exportHolder.textContent = "";
      const link = el("a", { href: data.export.download_url, class: "btn btn-quiet" }, "Download CSV");
      exportHolder.append(link);
    } catch (e) {
      restoreButton(exportButton);
      if (e instanceof ApiCallError && e.shape.errors) {
        announceAlert(Object.values(e.shape.errors)[0] ?? "Check the export dates.");
        return;
      }
      handleError(e, "We couldn't prepare the export.");
    }
  });

  const refreshAll = async (): Promise<void> => {
    await Promise.all([refreshTotals(), renderPacks(), renderCoverage()]);
  };
  await renderPacks();
}

function renderNurseEnrolments(enrolments: Enrolment[], certificates: Certificate[], refresh: () => Promise<void>): HTMLElement {
  const wrap = el("div", { class: "ledger-wrap" });
  const table = el("table", { "aria-label": "Nurse enrolments", class: "table" });
  table.append(el("thead", {}, el("tr", {},
    el("th", {}, "Course"), el("th", {}, "State"), el("th", {}, "Funding"), el("th", {}, ""),
  )));
  const tbody = el("tbody");
  for (const enrolment of enrolments) {
    const actions = el("div", { class: "row-actions" });
    if (enrolment.funding === "seat" && enrolment.state === "confirmed" && enrolment.verified_minutes === 0 && enrolment.assignment_id) {
      const returnSeat = el("button", { class: "btn btn-quiet" }, "Return seat") as HTMLButtonElement;
      returnSeat.addEventListener("click", async () => {
        pendingButton(returnSeat, "Returning…");
        try {
          await api("DELETE", `/api/sponsor/assignments/${enrolment.assignment_id}`);
          announce("Seat returned to the pack.");
          await refresh();
        } catch (e) {
          restoreButton(returnSeat);
          if (e instanceof ApiCallError) {
            if (e.shape.code === "seat_in_use") {
              announceAlert("This nurse has started the course, so the seat can't be returned.");
              return;
            }
            if (e.shape.code === "already_returned") {
              announceAlert("This seat has already been returned.");
              return;
            }
          }
          handleError(e, "We couldn't return this seat.");
        }
      });
      actions.append(returnSeat);
    }
    tbody.append(el("tr", {},
      el("td", {}, enrolment.course_title, actions),
      el("td", {}, stateLabel(enrolment.state)),
      el("td", {}, enrolment.funding),
      el("td", {}, ""),
    ));
  }
  table.append(tbody);
  wrap.append(table);
  void certificates;
  return wrap;
}

async function openBuySeats(refresh: () => Promise<void>): Promise<void> {
  clearAlert();
  let courses: Array<{ id: string; title: string; list_price: string }> = [];
  try {
    const data = await api<{ courses: Course[] }>("GET", "/api/courses");
    courses = data.courses.map((c) => ({ id: c.id, title: c.title, list_price: c.list_price }));
  } catch (e) {
    handleError(e, "We couldn't load the courses.");
    return;
  }
  openDialog({
    title: "Buy seats",
    content: (dialog, close) => {
      const course = el("select", { class: "input" }) as HTMLSelectElement;
      course.setAttribute("aria-label", "Course");
      for (const c of courses) {
        course.append(el("option", { value: c.id }, c.title));
      }
      const seats = el("input", { type: "number", class: "input", min: "1", max: "500", value: "1" }) as HTMLInputElement;
      seats.setAttribute("aria-label", "Seats");
      const buy = el("button", { class: "btn btn-primary" }, "Buy 1 seats for $0.00") as HTMLButtonElement;
      const refreshTotal = (): void => {
        const selected = courses.find((c) => c.id === course.value);
        const count = Number(seats.value || 0);
        const total = (Number(selected?.list_price ?? 0) * count).toFixed(2);
        buy.textContent = `Buy ${count} seats for $${total}`;
      };
      seats.addEventListener("input", refreshTotal);
      course.addEventListener("change", refreshTotal);
      refreshTotal();
      const cancel = el("button", { class: "btn btn-quiet" }, "Cancel");
      cancel.addEventListener("click", close);
      dialog.append(el("h2", {}, "Buy seats"), course, seats, buy, cancel);
      buy.addEventListener("click", async () => {
        pendingButton(buy, "Recording the purchase…");
        try {
          const data = await api<{ pack: { seats_purchased: number } }>(
            "POST",
            "/api/sponsor/packs",
            { course_id: course.value, seats: Number(seats.value) },
            { idempotencyKey: newIdempotencyKey() },
          );
          announce(`${data.pack.seats_purchased} seats added to your hospital's packs.`);
          close();
          await refresh();
        } catch (e) {
          restoreButton(buy);
          if (e instanceof ApiCallError) {
            if (e.shape.code === "payments_unavailable") {
              announceAlert("Payments are unavailable right now. Your hospital has not been charged. Try again in a few minutes.");
              return;
            }
            if (e.shape.code === "course_not_open") {
              announceAlert("This course is no longer open for enrolment.");
              return;
            }
            if (e.shape.errors) {
              announceAlert(Object.values(e.shape.errors)[0] ?? "Check the seat pack details.");
              return;
            }
          }
          handleError(e, "We couldn't buy the seats.");
        }
      });
    },
  });
}

async function openAssignSeat(pack: import("./api.ts").Pack, refresh: () => Promise<void>): Promise<void> {
  clearAlert();
  let nurses: SponsorLearner[] = [];
  try {
    nurses = (await api<{ learners: SponsorLearner[] }>("GET", "/api/sponsor/learners?q=")).learners;
  } catch (e) {
    handleError(e, "We couldn't load your nurses.");
    return;
  }
  openDialog({
    title: "Assign seat",
    content: (dialog, close) => {
      const nurse = el("select", { class: "input" }) as HTMLSelectElement;
      nurse.setAttribute("aria-label", "Nurse");
      for (const n of nurses) {
        nurse.append(el("option", { value: n.id }, n.display_name));
      }
      const assign = el("button", { class: "btn btn-primary" }, "Assign") as HTMLButtonElement;
      const cancel = el("button", { class: "btn btn-quiet" }, "Cancel");
      cancel.addEventListener("click", close);
      dialog.append(el("h2", {}, "Assign seat"), nurse, assign, cancel);
      assign.addEventListener("click", async () => {
        pendingButton(assign, "Assigning…");
        try {
          const data = await api<{ assignment: { nurse_id: string }; enrolment: Enrolment }>(
            "POST",
            `/api/sponsor/packs/${pack.id}/assignments`,
            { nurse_id: nurse.value },
          );
          const chosen = nurses.find((n) => n.id === data.assignment.nurse_id);
          announce(`Seat assigned to ${chosen?.display_name ?? "your nurse"}. We've emailed them an invitation.`);
          close();
          await refresh();
        } catch (e) {
          restoreButton(assign);
          if (e instanceof ApiCallError) {
            if (e.shape.code === "pack_empty") {
              announceAlert("No seats left in this pack.");
              return;
            }
            if (e.shape.code === "pack_expired") {
              announceAlert("This pack has expired.");
              return;
            }
            if (e.shape.code === "already_enrolled") {
              announceAlert("This nurse is already enrolled in this course.");
              return;
            }
            if (e.shape.code === "course_not_open") {
              announceAlert("This course is no longer open for enrolment.");
              return;
            }
          }
          handleError(e, "We couldn't assign the seat.");
        }
      });
    },
  });
}

// --- planner ----------------------------------------------------------------------

async function renderPlanner(mainEl: HTMLElement): Promise<void> {
  const user = requireUser();
  applyChrome(user);
  mainEl.textContent = "";
  mainEl.append(el("h1", {}, "Planner"));

  const review = el("section", { "aria-label": "Review queue", class: "planner-section" });
  const cohorts = el("section", { "aria-label": "Cohorts", class: "planner-section" });
  const refunds = el("section", { "aria-label": "Refund requests", class: "planner-section" });
  const certificates = el("section", { "aria-label": "Certificates", class: "planner-section" });
  mainEl.append(review, cohorts, refunds, certificates);

  // review queue
  review.append(el("h2", {}, "Review queue"));
  const reviewHolder = el("div", { class: "table-wrap" });
  review.append(reviewHolder);
  try {
    const data = await api<{ courses: Course[] }>("GET", "/api/courses");
    const table = el("table", { "aria-label": "Review queue courses", class: "table" });
    table.append(el("thead", {}, el("tr", {}, el("th", {}, "Course"), el("th", {}, "State"), el("th", {}, "Version"), el("th", {}, ""))));
    const tbody = el("tbody");
    for (const course of data.courses.filter((c) => c.state === "in_review")) {
      const actions = el("div", { class: "row-actions" });
      const publish = el("button", { class: "btn btn-quiet" }, "Approve and publish") as HTMLButtonElement;
      const note = el("input", { class: "input", placeholder: "Note to author" }) as HTMLInputElement;
      note.setAttribute("aria-label", "Note to author");
      const returned = el("button", { class: "btn btn-quiet" }, "Return to author") as HTMLButtonElement;
      publish.addEventListener("click", async () => {
        pendingButton(publish, "Saving…");
        await transition(course.id, { to: "published" }, publish, `Course moved to Published.`);
      });
      returned.addEventListener("click", async () => {
        pendingButton(returned, "Saving…");
        await transition(course.id, { to: "draft", note: note.value }, returned, `Course moved to Draft.`);
      });
      actions.append(publish, note, returned);
      tbody.append(el("tr", {},
        el("td", {}, course.title, actions), el("td", {}, stateLabel(course.state)), el("td", { class: "num" }, String(course.version)), el("td", {}, ""),
      ));
    }
    table.append(tbody);
    reviewHolder.append(table);
  } catch (e) {
    handleError(e, "We couldn't load the review queue.");
  }

  // cohorts
  cohorts.append(el("h2", {}, "Cohorts"));
  const newCohort = el("button", { class: "btn btn-primary" }, "New cohort") as HTMLButtonElement;
  cohorts.append(newCohort);
  let courseData: Course[] = [];
  try {
    courseData = (await api<{ courses: Course[] }>("GET", "/api/courses")).courses;
  } catch {
    courseData = [];
  }
  const cohortCourses = el("select", { class: "input" }) as HTMLSelectElement;
  cohortCourses.setAttribute("aria-label", "Cohort course");
  for (const course of courseData.filter((c) => c.format === "cohort" && c.state === "published")) {
    cohortCourses.append(el("option", { value: course.id }, course.title));
  }
  cohorts.append(cohortCourses);
  newCohort.addEventListener("click", () => void openNewCohort(cohortCourses.value, refreshPlanner));
  const cohortHolder = el("div", { class: "table-wrap" });
  cohorts.append(cohortHolder);

  const renderCohortList = async (): Promise<void> => {
    cohortHolder.textContent = "";
    const rows: Array<{ course: Course; cohort: import("./api.ts").Cohort }> = [];
    for (const course of courseData) {
      if (course.format !== "cohort") continue;
      try {
        const detail = await api<{ course: Course }>("GET", `/api/courses/${course.id}`);
        for (const cohort of detail.course.cohorts ?? []) rows.push({ course, cohort });
      } catch {
        // unreadable course
      }
    }
    const table = el("table", { "aria-label": "Cohorts", class: "table" });
    table.append(el("thead", {}, el("tr", {},
      el("th", {}, "Cohort"), el("th", { class: "num" }, "Cap"), el("th", { class: "num" }, "Remaining"), el("th", {}, ""),
    )));
    const tbody = el("tbody");
    for (const { cohort } of rows) {
      const link = el("a", { href: `/planner/cohorts/${cohort.id}`, class: "btn btn-quiet" }, "Open");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        navigate(`/planner/cohorts/${cohort.id}`);
      });
      tbody.append(el("tr", {},
        el("td", {}, `${cohort.name}`),
        el("td", { class: "num" }, String(cohort.seat_cap)),
        el("td", { class: "num" }, String(cohort.seats_remaining)),
        el("td", {}, link),
      ));
    }
    table.append(tbody);
    cohortHolder.append(table);
  };

  // refunds
  refunds.append(el("h2", {}, "Refund requests"));
  const refundHolder = el("div", { class: "table-wrap" });
  refunds.append(refundHolder);
  const renderRefunds = async (): Promise<void> => {
    refundHolder.textContent = "";
    try {
      const data = await api<{ refund_requests: import("./api.ts").RefundRequest[] }>("GET", "/api/refund-requests");
      const table = el("table", { "aria-label": "Refund requests table", class: "table" });
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "Nurse"), el("th", {}, "Course"), el("th", { class: "num" }, "Amount"), el("th", {}, "Decision"),
      )));
      const tbody = el("tbody");
      for (const request of data.refund_requests) {
        const actions = el("div", { class: "row-actions" });
        const decision = el("td", {});
        if (request.state === "pending") {
          const approve = el("button", { class: "btn btn-quiet" }, "Approve refund") as HTMLButtonElement;
          const decline = el("button", { class: "btn btn-quiet" }, "Decline refund") as HTMLButtonElement;
          approve.addEventListener("click", () => void decideRefund(request.id, "approve", approve));
          decline.addEventListener("click", () => void decideRefund(request.id, "decline", decline));
          actions.append(approve, decline);
          decision.append(el("span", { class: "figure" }, `Refund due $${request.refund_total ?? ""}`));
        } else {
          const label =
            request.state === "approved"
              ? `Approved by ${request.decided_by?.display_name ?? ""} on ${displayDate((request.decided_at ?? "").slice(0, 10))}`
              : `Declined by ${request.decided_by?.display_name ?? ""} on ${displayDate((request.decided_at ?? "").slice(0, 10))}`;
          decision.append(el("span", {}, label));
        }
        tbody.append(el("tr", {},
          el("td", {}, request.nurse_name, actions),
          el("td", {}, request.course_title),
          el("td", { class: "num" }, request.refund_total ?? ""),
          decision,
        ));
      }
      table.append(tbody);
      refundHolder.append(table);
    } catch (e) {
      handleError(e, "We couldn't load the refund queue.");
    }
  };

  async function decideRefund(id: string, action: "approve" | "decline", button: HTMLButtonElement): Promise<void> {
    clearAlert();
    pendingButton(button, action === "approve" ? "Recording the refund…" : "Saving…");
    try {
      const data = await api<{ refund_request: import("./api.ts").RefundRequest }>(
        "POST",
        `/api/refund-requests/${id}/${action}`,
        { note: null },
      );
      restoreButton(button);
      if (action === "approve") {
        announce(`Refund of $${data.refund_request.refund_total} recorded.`);
      } else {
        announce("Refund declined.");
      }
      await renderRefunds();
    } catch (e) {
      restoreButton(button);
      if (e instanceof ApiCallError) {
        if (e.shape.code === "request_closed") {
          announceAlert("This refund request has already been decided.");
          return;
        }
        if (e.shape.code === "already_certified") {
          announceAlert("This nurse has finished the course, so no refund is due.");
          return;
        }
        if (e.shape.code === "payments_unavailable") {
          announceAlert("Payments are unavailable right now. Nothing was refunded. Try again in a few minutes.");
          return;
        }
      }
      handleError(e, "We couldn't record the decision.");
    }
  }

  // certificates
  certificates.append(el("h2", {}, "Certificates"));
  const search = el("input", { type: "search", class: "input" }) as HTMLInputElement;
  search.setAttribute("aria-label", "Search certificates");
  const certHolder = el("div", { class: "table-wrap" });
  certificates.append(search, certHolder);
  const renderCertificates = async (q: string): Promise<void> => {
    certHolder.textContent = "";
    try {
      const data = await api<{ certificates: Certificate[] }>("GET", `/api/planner/certificates?q=${encodeURIComponent(q)}`);
      const table = el("table", { "aria-label": "Certificates table", class: "table" });
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "Nurse"), el("th", {}, "Course"), el("th", {}, "Serial"), el("th", { class: "num" }, "Hours"), el("th", {}, "Status"), el("th", {}, ""),
      )));
      const tbody = el("tbody");
      for (const cert of data.certificates) {
        const actions = el("div", { class: "row-actions" });
        const reissue = el("button", { class: "btn btn-quiet" }, "Reissue") as HTMLButtonElement;
        reissue.addEventListener("click", () => void openReissueRevoke(cert, "reissue", renderAll));
        const revoke = el("button", { class: "btn btn-quiet" }, "Revoke") as HTMLButtonElement;
        revoke.addEventListener("click", () => void openReissueRevoke(cert, "revoke", renderAll));
        actions.append(reissue, revoke);
        tbody.append(el("tr", {},
          el("td", {}, cert.nurse_name, actions),
          el("td", {}, cert.course_title),
          el("td", {}, cert.serial),
          el("td", { class: "num" }, cert.contact_hours),
          el("td", {}, cert.state === "sealed" ? "Sealed" : cert.state === "sealing" ? "Sealing" : "Revoked"),
          el("td", {}, ""),
        ));
      }
      table.append(tbody);
      certHolder.append(table);
    } catch (e) {
      if (e instanceof ApiCallError && e.shape.errors && e.shape.errors["q"]) {
        announceAlert(e.shape.errors["q"]);
        return;
      }
      handleError(e, "We couldn't load the certificates.");
    }
  };
  let certTimer = 0;
  search.addEventListener("input", () => {
    window.clearTimeout(certTimer);
    certTimer = window.setTimeout(() => void renderCertificates(search.value), 250);
  });
  await renderCertificates("");

  const refreshPlanner = async (): Promise<void> => {
    courseData = (await api<{ courses: Course[] }>("GET", "/api/courses")).courses;
    await Promise.all([renderCohortList(), renderRefunds(), renderCertificates(search.value)]);
  };
  const renderAll = refreshPlanner;
  await renderCohortList();
  await renderRefunds();

  async function transition(courseId: string, body: { to: string; note?: string }, button: HTMLButtonElement, successCopy: string): Promise<void> {
    clearAlert();
    try {
      const detail = await api<{ course: Course }>("GET", `/api/courses/${courseId}`);
      await api<{ course: Course }>(
        "POST",
        `/api/courses/${courseId}/transitions`,
        body,
        { ifMatch: detail.course.version },
      );
      restoreButton(button);
      announce(successCopy);
      await refreshPlanner();
    } catch (e) {
      restoreButton(button);
      if (e instanceof ApiCallError) {
        if (e.shape.code === "stale_version") {
          announceAlert("Someone else saved this course a moment ago. Reload to see their changes before saving again.");
          return;
        }
        if (e.shape.code === "invalid_transition") {
          const extra = e.shape.extra as { from?: string; to?: string };
          announceAlert(`This course can't move from ${stateLabel(extra.from ?? "")} to ${stateLabel(extra.to ?? "")}.`);
          return;
        }
        if (e.shape.errors && e.shape.errors["note"]) {
          announceAlert(e.shape.errors["note"]);
          return;
        }
      }
      handleError(e, "We couldn't move this course.");
    }
  }
}

async function openNewCohort(courseId: string, refresh: () => Promise<void>): Promise<void> {
  clearAlert();
  openDialog({
    title: "New cohort",
    content: (dialog, close) => {
      const name = el("input", { class: "input" }) as HTMLInputElement;
      name.setAttribute("aria-label", "Cohort name");
      const cap = el("input", { type: "number", class: "input", min: "1", max: "500", value: "20" }) as HTMLInputElement;
      cap.setAttribute("aria-label", "Seat cap");
      const startsOn = el("input", { type: "date", class: "input", value: providerToday() }) as HTMLInputElement;
      startsOn.setAttribute("aria-label", "Starts on");
      const closesOn = el("input", { type: "date", class: "input", value: providerToday() }) as HTMLInputElement;
      closesOn.setAttribute("aria-label", "Enrolment closes on");
      const create = el("button", { class: "btn btn-primary" }, "Create cohort") as HTMLButtonElement;
      const cancel = el("button", { class: "btn btn-quiet" }, "Cancel");
      cancel.addEventListener("click", close);
      dialog.append(el("h2", {}, "New cohort"), name, cap, startsOn, closesOn, create, cancel);
      create.addEventListener("click", async () => {
        pendingButton(create, "Saving…");
        try {
          await api("POST", `/api/courses/${courseId}/cohorts`, {
            name: name.value,
            seat_cap: Number(cap.value),
            starts_on: startsOn.value,
            close_date: closesOn.value,
          });
          announce("Cohort saved.");
          close();
          await refresh();
        } catch (e) {
          restoreButton(create);
          if (e instanceof ApiCallError && e.shape.errors) {
            announceAlert(Object.values(e.shape.errors)[0] ?? "Check the cohort details.");
            return;
          }
          handleError(e, "We couldn't save the cohort.");
        }
      });
    },
  });
}

async function openReissueRevoke(certificate: Certificate, action: "reissue" | "revoke", refresh: () => Promise<void>): Promise<void> {
  clearAlert();
  openDialog({
    title: action === "reissue" ? "Reissue certificate" : "Revoke certificate",
    content: (dialog, close) => {
      const reason = el("textarea", { class: "input", rows: "3" }) as HTMLTextAreaElement;
      reason.setAttribute("aria-label", "Reason");
      const confirm = el("button", { class: "btn btn-primary" }, action === "reissue" ? "Confirm reissue" : "Confirm revoke") as HTMLButtonElement;
      const cancel = el("button", { class: "btn btn-quiet" }, "Cancel");
      cancel.addEventListener("click", close);
      dialog.append(el("h2", {}, action === "reissue" ? "Reissue certificate" : "Revoke certificate"), reason, confirm, cancel);
      confirm.addEventListener("click", async () => {
        pendingButton(confirm, action === "reissue" ? "Reissuing…" : "Revoking…");
        try {
          const response = await fetch(`/api/certificates/${certificate.id}/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: reason.value }),
            credentials: "same-origin",
          });
          const body = (await response.json()) as { certificate: Certificate };
          restoreButton(confirm);
          if (response.status === 201) {
            announce(action === "reissue" ? `Certificate reissued as version ${body.certificate.version}.` : "Certificate revoked.");
          } else if (response.status === 202) {
            announce(action === "reissue" ? "Reissue recorded. The new PDF is still being stored." : "Certificate revoked.");
          } else {
            if (response.status === 409) {
              announceAlert("This certificate can't be changed right now.");
            } else {
              announceAlert("We couldn't record the decision.");
            }
            return;
          }
          close();
          await refresh();
        } catch {
          restoreButton(confirm);
          announceAlert("We couldn't reach Credwell. Check your connection and try again.");
        }
      });
    },
  });
}

// --- cohort detail (planner) --------------------------------------------------------

async function renderCohortDetail(mainEl: HTMLElement, cohortId: string): Promise<void> {
  const user = requireUser();
  applyChrome(user);
  mainEl.textContent = "";
  let cohort: import("./api.ts").Cohort;
  try {
    cohort = (await api<{ cohort: import("./api.ts").Cohort }>("GET", `/api/cohorts/${cohortId}`)).cohort;
  } catch {
    navigate("/planner");
    return;
  }
  mainEl.append(el("h1", {}, cohort.name));
  mainEl.append(el("p", { class: "figure" }, `Seats remaining ${cohort.seats_remaining}`));
  mainEl.append(el("p", { class: "figure" }, `Enrolment closes ${closeLine(cohort.close_date)}`));

  const capInput = el("input", { type: "number", class: "input", min: "1", max: "500", value: String(cohort.seat_cap) }) as HTMLInputElement;
  capInput.setAttribute("aria-label", "Seat cap");
  const saveCap = el("button", { class: "btn btn-primary" }, "Save seat cap") as HTMLButtonElement;
  mainEl.append(capInput, saveCap);
  saveCap.addEventListener("click", async () => {
    clearAlert();
    pendingButton(saveCap, "Saving…");
    try {
      await api("PATCH", `/api/cohorts/${cohort.id}`, { seat_cap: Number(capInput.value) });
      restoreButton(saveCap);
      announce("Cohort saved.");
      await renderCohortDetail(mainEl, cohortId);
    } catch (e) {
      restoreButton(saveCap);
      if (e instanceof ApiCallError) {
        if (e.shape.code === "cap_below_enrolled") {
          announceAlert("The seat cap can't be lower than the nurses already enrolled.");
          return;
        }
        if (e.shape.errors) {
          announceAlert(Object.values(e.shape.errors)[0] ?? "Check the seat cap.");
          return;
        }
      }
      handleError(e, "We couldn't save the seat cap.");
    }
  });

  const rosterHolder = el("div", { class: "table-wrap" });
  const rosterTable = el("table", { "aria-label": "Roster", class: "table" });
  rosterTable.append(el("thead", {}, el("tr", {},
    el("th", {}, "Nurse"), el("th", {}, "State"),
  )));
  const rosterBody = el("tbody");
  for (const entry of cohort.roster ?? []) {
    rosterBody.append(el("tr", {}, el("td", {}, entry.nurse_name), el("td", {}, entry.state)));
  }
  rosterTable.append(rosterBody);
  rosterHolder.append(rosterTable);
  mainEl.append(el("h2", {}, "Roster"), rosterHolder);

  const waitlist = el("ul", { "aria-label": "Waitlist", class: "waitlist" });
  for (const entry of cohort.waitlist ?? []) {
    waitlist.append(el("li", {}, `${entry.position}. ${entry.nurse_name}`));
  }
  mainEl.append(el("h2", {}, "Waitlist"), waitlist);
}

// --- authoring ------------------------------------------------------------------------

type AuthorModule = {
  title: string;
  minutes: number;
  kind: "lesson" | "evaluation";
  body: string;
  prompt: string;
  options: string[];
  answerIndex: number;
};

type AuthorCourse = {
  id: string | null;
  title: string;
  summary: string;
  format: "self_paced" | "cohort";
  list_price: string;
  state: string;
  version: number;
  modules: AuthorModule[];
};

async function renderAuthoring(mainEl: HTMLElement): Promise<void> {
  const user = requireUser();
  applyChrome(user);
  mainEl.textContent = "";
  mainEl.append(el("h1", {}, "Authoring"));

  const listHolder = el("div", { class: "table-wrap" });
  mainEl.append(listHolder);
  const newCourse = el("button", { class: "btn btn-primary" }, "New course") as HTMLButtonElement;
  mainEl.append(newCourse);
  const editorHolder = el("div", { class: "author-editor" });
  mainEl.append(editorHolder);
  const historyHolder = el("div", { class: "author-history" });
  mainEl.append(historyHolder);

  const renderList = async (): Promise<void> => {
    listHolder.textContent = "";
    try {
      const data = await api<{ courses: Course[] }>("GET", "/api/courses");
      const table = el("table", { "aria-label": "Your courses", class: "table" });
      table.append(el("thead", {}, el("tr", {},
        el("th", {}, "Course"), el("th", {}, "State"), el("th", { class: "num" }, "Version"), el("th", {}, ""),
      )));
      const tbody = el("tbody");
      for (const course of data.courses) {
        const open = el("button", { class: "btn btn-quiet" }, "Edit");
        open.addEventListener("click", () => void loadEditor(course.id));
        const submit = el("button", { class: "btn btn-quiet" }, "Submit for review") as HTMLButtonElement;
        if (course.state === "draft") {
          submit.addEventListener("click", async () => {
            pendingButton(submit, "Saving…");
            await saveCourse(editorCourse ?? null, { to: "in_review" }, submit);
          });
        } else {
          submit.disabled = true;
        }
        const withdraw = el("button", { class: "btn btn-quiet" }, "Withdraw course") as HTMLButtonElement;
        withdraw.addEventListener("click", async () => {
          pendingButton(withdraw, "Saving…");
          await saveCourse(editorCourse, { to: "withdrawn" }, withdraw);
        });
        if (course.state !== "published" || user.role !== "planner") {
          withdraw.disabled = course.state !== "published";
        }
        tbody.append(el("tr", {},
          el("td", {}, course.title, el("div", { class: "row-actions" }, open, submit, withdraw)),
          el("td", {}, stateLabel(course.state)),
          el("td", { class: "num" }, String(course.version)),
          el("td", {}, ""),
        ));
      }
      table.append(tbody);
      listHolder.append(table);
    } catch (e) {
      handleError(e, "We couldn't load your courses.");
    }
  };
  await renderList();

  let editorCourse: AuthorCourse | null = null;

  newCourse.addEventListener("click", () => {
    editorCourse = {
      id: null,
      title: "",
      summary: "",
      format: "self_paced",
      list_price: "0.00",
      state: "draft",
      version: 1,
      modules: [emptyLesson(), { title: "Post-evaluation", minutes: 10, kind: "evaluation", body: "", prompt: "", options: [], answerIndex: -1 }],
    };
    renderEditor();
  });

  const loadEditor = async (courseId: string): Promise<void> => {
    try {
      const data = await api<{ course: Course }>("GET", `/api/courses/${courseId}`);
      const course = data.course;
      editorCourse = {
        id: course.id,
        title: course.title,
        summary: course.summary,
        format: course.format,
        list_price: course.list_price,
        state: course.state,
        version: course.version,
        modules: (course.modules ?? []).map((m) => ({
          title: m.title,
          minutes: m.minutes,
          kind: m.kind,
          body: m.body ?? "",
          prompt: m.question?.prompt ?? "",
          options: m.question?.options ?? [],
          answerIndex: m.question?.answer_index ?? -1,
        })),
      };
      renderEditor();
      await renderHistory(courseId);
    } catch (e) {
      handleError(e, "We couldn't open this course.");
    }
  };

  const renderHistory = async (courseId: string): Promise<void> => {
    historyHolder.textContent = "";
    try {
      const data = await api<{ history: Array<{ from: string; to: string; by: { display_name: string }; note: string | null; at: string }> }>(
        "GET",
        `/api/courses/${courseId}/history`,
      );
      const list = el("ul", { "aria-label": "Review history", class: "history-list" });
      for (const entry of data.history) {
        list.append(el("li", {}, `${stateLabel(entry.from)} → ${stateLabel(entry.to)} by ${entry.by.display_name}${entry.note ? ` — ${entry.note}` : ""}`));
      }
      historyHolder.append(el("h2", {}, "Review history"), list);
    } catch {
      // no history yet
    }
  };

  const emptyLesson = (): AuthorModule => ({
    title: "",
    minutes: 15,
    kind: "lesson",
    body: "",
    prompt: "",
    options: ["", ""],
    answerIndex: 0,
  });

  const renderEditor = (): void => {
    editorHolder.textContent = "";
    if (!editorCourse) return;
    const course = editorCourse;

    const title = el("input", { class: "input", value: course.title }) as HTMLInputElement;
    title.setAttribute("aria-label", "Course title");
    const summary = el("textarea", { class: "input", rows: "2" }) as HTMLTextAreaElement;
    summary.setAttribute("aria-label", "Summary");
    summary.value = course.summary;
    const format = el("select", { class: "input" }) as HTMLSelectElement;
    format.setAttribute("aria-label", "Format");
    format.append(el("option", { value: "self_paced" }, "Self-paced"), el("option", { value: "cohort" }, "Live cohort"));
    format.value = course.format;
    const price = el("input", { class: "input", value: course.list_price }) as HTMLInputElement;
    price.setAttribute("aria-label", "List price (USD)");

    editorHolder.append(el("h2", {}, `Editing: ${course.title || "New course"}`), title, summary, format, price);

    const modulesHolder = el("div", { class: "author-modules" });
    editorHolder.append(modulesHolder);

    const renderModules = (): void => {
      modulesHolder.textContent = "";
      course.modules.forEach((module, index) => {
        const block = el("fieldset", { class: "author-module" });
        const moduleTitle = el("input", { class: "input", value: module.title }) as HTMLInputElement;
        moduleTitle.setAttribute("aria-label", "Module title");
        moduleTitle.addEventListener("input", () => {
          module.title = moduleTitle.value;
        });
        const minutes = el("input", { type: "number", class: "input", value: String(module.minutes), min: "5", max: "240" }) as HTMLInputElement;
        minutes.setAttribute("aria-label", "Minutes");
        minutes.addEventListener("input", () => {
          module.minutes = Number(minutes.value);
        });
        const kind = el("select", { class: "input" }) as HTMLSelectElement;
        kind.setAttribute("aria-label", "Module kind");
        kind.append(el("option", { value: "lesson" }, "Lesson"), el("option", { value: "evaluation" }, "Evaluation"));
        kind.value = module.kind;
        kind.disabled = index === course.modules.length - 1 && module.kind === "evaluation";
        kind.addEventListener("change", () => {
          module.kind = kind.value === "evaluation" ? "evaluation" : "lesson";
          renderModules();
        });
        block.append(el("legend", {}, `Module ${index + 1}`), moduleTitle, minutes, kind);
        if (module.kind === "lesson") {
          const bodyText = el("textarea", { class: "input", rows: "3" }) as HTMLTextAreaElement;
          bodyText.setAttribute("aria-label", "Lesson text");
          bodyText.value = module.body;
          bodyText.addEventListener("input", () => {
            module.body = bodyText.value;
          });
          const question = el("input", { class: "input", value: module.prompt }) as HTMLInputElement;
          question.setAttribute("aria-label", "Question");
          question.addEventListener("input", () => {
            module.prompt = question.value;
          });
          block.append(bodyText, question);
          for (let o = 0; o < module.options.length; o += 1) {
            const option = el("input", { class: "input", value: module.options[o] ?? "" }) as HTMLInputElement;
            option.setAttribute("aria-label", `Option ${o + 1}`);
            option.addEventListener("input", () => {
              module.options[o] = option.value;
            });
            block.append(option);
          }
          const correct = el("select", { class: "input" }) as HTMLSelectElement;
          correct.setAttribute("aria-label", "Correct option");
          module.options.forEach((_, o) => {
            correct.append(el("option", { value: String(o) }, `Option ${o + 1}`));
          });
          correct.value = String(Math.max(0, module.answerIndex));
          correct.addEventListener("change", () => {
            module.answerIndex = Number(correct.value);
          });
          block.append(correct);
        }
        modulesHolder.append(block);
      });
    };
    renderModules();

    const addModule = el("button", { class: "btn btn-quiet" }, "Add module");
    addModule.addEventListener("click", () => {
      course.modules.splice(course.modules.length - 1, 0, emptyLesson());
      renderModules();
    });
    const saveDraft = el("button", { class: "btn btn-primary" }, "Save draft") as HTMLButtonElement;
    const submit = el("button", { class: "btn btn-quiet" }, "Submit for review") as HTMLButtonElement;
    const note = el("input", { class: "input", placeholder: "Note to author" }) as HTMLInputElement;
    note.setAttribute("aria-label", "Note to author");
    const returned = el("button", { class: "btn btn-quiet" }, "Return to author") as HTMLButtonElement;
    const withdraw = el("button", { class: "btn btn-quiet" }, "Withdraw course") as HTMLButtonElement;
    editorHolder.append(addModule, saveDraft, submit, note, returned, withdraw);

    saveDraft.addEventListener("click", async () => {
      pendingButton(saveDraft, "Saving…");
      await saveCourse(course, null, saveDraft);
    });
    submit.addEventListener("click", async () => {
      pendingButton(submit, "Saving…");
      await saveCourse(course, { to: "in_review" }, submit);
    });
    returned.addEventListener("click", async () => {
      pendingButton(returned, "Saving…");
      await saveCourse(course, { to: "draft", note: note.value }, returned);
    });
    withdraw.addEventListener("click", async () => {
      pendingButton(withdraw, "Saving…");
      await saveCourse(course, { to: "withdrawn" }, withdraw);
    });
  };

  async function saveCourse(
    course: AuthorCourse | null,
    transition: { to: string; note?: string } | null,
    button: HTMLButtonElement,
  ): Promise<void> {
    clearAlert();
    if (!course) return;
    try {
      const body = {
        title: course.title,
        summary: course.summary,
        format: course.format,
        list_price: course.list_price,
        modules: course.modules.map((m) => ({
          title: m.title,
          minutes: m.minutes,
          kind: m.kind,
          body: m.kind === "lesson" ? m.body : undefined,
          question:
            m.kind === "lesson"
              ? { prompt: m.prompt, options: m.options, answer_index: m.answerIndex }
              : undefined,
        })),
      };
      let saved: { course: Course };
      if (course.id === null) {
        saved = await api<{ course: Course }>("POST", "/api/courses", body);
        course.id = saved.course.id;
      } else {
        saved = await api<{ course: Course }>("PATCH", `/api/courses/${course.id}`, body, { ifMatch: course.version });
      }
      course.version = saved.course.version;
      course.state = saved.course.state;
      if (transition) {
        const moved = await api<{ course: Course }>(
          "POST",
          `/api/courses/${course.id}/transitions`,
          { to: transition.to, note: transition.note },
          { ifMatch: course.version },
        );
        course.version = moved.course.version;
        course.state = moved.course.state;
        announce(`Course moved to ${stateLabel(course.state)}.`);
      } else {
        announce("Draft saved.");
      }
      restoreButton(button);
      renderEditor();
      await renderList();
      if (course.id) await renderHistory(course.id);
    } catch (e) {
      restoreButton(button);
      if (e instanceof ApiCallError) {
        if (e.shape.code === "stale_version") {
          announceAlert("Someone else saved this course a moment ago. Reload to see their changes before saving again.");
          return;
        }
        if (e.shape.code === "course_not_editable") {
          announceAlert("This course can't be edited in its current state.");
          return;
        }
        if (e.shape.code === "invalid_transition") {
          const extra = e.shape.extra as { from?: string; to?: string };
          announceAlert(`This course can't move from ${stateLabel(extra.from ?? "")} to ${stateLabel(extra.to ?? "")}.`);
          return;
        }
        if (e.shape.code === "version_required") {
          announceAlert("Someone else saved this course a moment ago. Reload to see their changes before saving again.");
          return;
        }
        if (e.shape.errors) {
          announceAlert(Object.values(e.shape.errors).join(" "));
          return;
        }
      }
      handleError(e, "We couldn't save this course.");
    }
  }
}
