/* Crosshand Relay: screen composition. Each screen renders into #app. */

import {
  api, clear, el, fmtCutoff, fmtDate, fmtDateKey, fmtTime, fmtWeekday, homeFor, NAV_LINKS,
  navigate, seatCounterHtml, statusLabel, type Credential, type Invoice, type RequestRec,
  type Quote, type Seat, type User,
} from "./api.js";
import { errorMessage, errorFields, errorQuote, Poller, searchOnInput } from "./feedback.js";
import { renderBraid, renderRotationTable, seatByLabel, nameOf, takenWord, segments, segmentIndexAt, updateReadout } from "./braid.js";
import { groupByDay, mondayOf, openSeatCount, rowButton, shiftWeek, wireDayScroller, confirmedSeatCount, settingWord } from "./board.js";

const app = document.getElementById("app") as HTMLElement;
let user: User | null = null;
const pollers: Poller[] = [];

function stopPollers(): void {
  for (const p of pollers) p.stop();
  pollers.length = 0;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function setViewer(u: User | null): void {
  user = u;
}

export function currentViewer(): User | null {
  return user;
}

/* ------------------------------------------------------------------ shell */

export function renderShell(route: string): void {
  stopPollers();
  clear(app);
  if (!user) {
    renderSignIn();
    return;
  }
  const shell = el("div", { class: "frame" });
  const bar = el("header", { class: "topbar" });
  bar.append(el("a", { class: "wordmark", href: "#/", "aria-label": "Crosshand Relay" }, "Crosshand Relay"));
  const nav = el("nav", { "aria-label": "Main" });
  for (const [label, path] of NAV_LINKS[user.role]) {
    const link = el("a", { href: `#${path}` }, label);
    if (route === path || (path !== "/" && route.startsWith(path + "/"))) {
      link.setAttribute("aria-current", "page");
    }
    nav.append(link);
  }
  bar.append(nav);
  bar.append(el("span", { class: "who" }, user.display_name));
  bar.append(el("button", {
    class: "btn linklike",
    onclick: async () => {
      try {
        await api("DELETE", "/api/session");
      } catch { /* session may be gone */ }
      user = null;
      navigate("/signin");
      renderShell("/signin");
    },
  }, "Sign out"));
  const menuBtn = el("button", {
    class: "btn linklike menu-btn",
    "aria-expanded": "false",
    onclick: () => {
      const open = nav.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", String(open));
      if (open) (nav.querySelector("a") as HTMLElement).focus();
    },
  }, "Menu");
  bar.append(menuBtn);
  shell.append(bar);
  const page = el("main", { class: "page", id: "page" });
  shell.append(page);
  app.append(shell);
  renderRoute(route, page);
}

/* -------------------------------------------------------------- sign in */

function renderSignIn(): void {
  const wrap = el("div", { class: "signin-wrap" });
  const form = el("form", { "aria-label": "Sign in", class: "signin", onsubmit: "return false" }) as HTMLFormElement;
  form.append(el("a", { class: "wordmark", href: "#/signin" }, "Crosshand Relay"));
  form.append(el("h1", {}, "Sign in to Crosshand Relay"));
  const email = el("input", { id: "signin-email", type: "email", autocomplete: "username" }) as HTMLInputElement;
  const emailLabel = el("label", { for: "signin-email" }, "Email");
  const password = el("input", { id: "signin-password", type: "password", autocomplete: "current-password" }) as HTMLInputElement;
  const passwordLabel = el("label", { for: "signin-password" }, "Password");
  const alert = el("div", { role: "alert", "aria-live": "assertive", "aria-label": "Sign-in error", class: "status-line", hidden: "hidden" });
  const submit = el("button", { class: "btn", type: "submit" }, "Sign in");

  const doSignIn = async () => {
    submit.setAttribute("disabled", "disabled");
    alert.setAttribute("hidden", "hidden");
    try {
      const out = await api<{ user: User }>("POST", "/api/session", { email: email.value, password: password.value });
      user = out.user;
      navigate(homeFor(user.role));
      renderShell(homeFor(user.role));
      return;
    } catch (err) {
      const message = (err as { api?: { error?: { code?: string } } }).api?.error?.code === "invalid_credentials"
        ? "Email or password is incorrect."
        : errorMessage(err);
      alert.textContent = message;
      alert.removeAttribute("hidden");
    } finally {
      submit.removeAttribute("disabled");
    }
  };

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void doSignIn();
  });
  for (const field of [email, password]) {
    field.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        void doSignIn();
      }
    });
  }

  form.append(emailLabel, email, passwordLabel, password, submit, alert);
  wrap.append(form);
  app.append(wrap);
  email.focus();
}

/* ----------------------------------------------------------- job detail */

type PaneState = {
  requestId: string;
  minute: number;
  filling: Set<string>;
  lastRequest: RequestRec | null;
  opener: HTMLElement | null;
};

let paneState: PaneState | null = null;

export function openJobPane(requestId: string, opener: HTMLElement | null, slot?: HTMLElement): void {
  // one pane at a time: drop any existing floating pane first
  for (const existing of [...document.querySelectorAll(".pane")]) {
    if (existing !== slot) existing.remove();
  }
  const pane = slot ?? document.createElement("div");
  if (!slot) {
    pane.className = "pane";
    pane.setAttribute("role", "region");
    pane.setAttribute("aria-label", "Job detail");
    document.body.append(pane);
  }
  paneState = { requestId, minute: 0, filling: new Set(), lastRequest: null, opener };
  void refreshPane(pane);
}

export function closeJobPane(focusOpener: boolean): void {
  const opener = paneState?.opener ?? null;
  const pane = document.querySelector(".pane");
  if (pane) pane.remove();
  paneState = null;
  if (focusOpener) {
    if (opener && opener.isConnected) {
      opener.focus();
    } else {
      const page = document.getElementById("page");
      (page?.querySelector("h1") as HTMLElement | null)?.focus();
    }
  }
}

async function refreshPane(pane: HTMLElement): Promise<void> {
  if (!paneState) return;
  const id = paneState.requestId;
  let rec: RequestRec;
  try {
    rec = await api<RequestRec>("GET", `/api/requests/${id}`);
  } catch {
    // If the viewer can no longer read the request, keep the last view unchanged.
    if (paneState.lastRequest) return;
    closeJobPane(false);
    return;
  }
  if (!paneState || paneState.requestId !== id) return;
  // detect newly confirmed seats for this viewer to animate fills
  const prev = paneState.lastRequest;
  if (prev && user?.role === "interpreter") {
    for (const seat of rec.seats) {
      const before = prev.seats.find((s) => s.label === seat.label);
      if (seat.status === "confirmed" && before?.status !== "confirmed") {
        for (const seg of segments(rec.duration_minutes, rec.rotation_minutes, rec.team_size)) {
          paneState.filling.add(`${seat.label}:${seg.index}`);
        }
      }
    }
  }
  paneState.lastRequest = rec;
  // preserve live-region copy across the re-render
  const keep = new Map<string, string>();
  for (const label of ["Claim status", "Job status", "Request status"]) {
    const node = pane.querySelector(`[aria-label="${label}"]`);
    if (node?.textContent) keep.set(label, node.textContent);
  }
  renderPaneContents(pane, rec);
  for (const [label, text] of keep) {
    const node = pane.querySelector(`[aria-label="${label}"]`);
    if (node) node.textContent = text;
  }
}

function renderPaneContents(pane: HTMLElement, rec: RequestRec): void {
  if (!paneState) return;
  const heading = pane.querySelector("h2");
  const keepFocus = document.activeElement && pane.contains(document.activeElement)
    ? (document.activeElement as HTMLElement).id
    : null;
  clear(pane);
  const closeBtn = el("button", {
    class: "btn linklike",
    onclick: () => closeJobPane(true),
  }, "Close");
  closeBtn.setAttribute("aria-label", "Close job detail");
  pane.append(closeBtn);
  const h = el("h2", { tabindex: "-1" }, rec.reference);
  pane.append(h);

  // facts
  const facts = el("dl", { class: "facts" });
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" })
    .formatToParts(new Date(rec.starts_at))
    .find((p) => p.type === "timeZoneName")?.value ?? "";
  facts.append(el("dt", {}, "Date"), el("dd", {}, fmtDate(rec.starts_at)));
  facts.append(el("dt", {}, "Time window"), el("dd", {}, `${fmtTime(rec.starts_at)} to ${fmtTime(rec.ends_at)} ${zone}`));
  facts.append(el("dt", {}, "Setting"), el("dd", {}, settingWord(rec.setting)));
  facts.append(el("dt", {}, "Required credential"), el("dd", {}, rec.required_credential));
  facts.append(el("dt", {}, "City"), el("dd", {}, rec.city));
  if (rec.organisation) facts.append(el("dt", {}, "Organisation"), el("dd", {}, rec.organisation.name));
  if (rec.consumer_name !== undefined) {
    facts.append(el("dt", {}, "Consumer name"), el("dd", {}, rec.consumer_name));
    facts.append(el("dt", {}, "Street address"), el("dd", {}, rec.location_address ?? ""));
    facts.append(el("dt", {}, "Notes"), el("dd", {}, rec.notes ?? ""));
  }
  pane.append(facts);

  // seats list
  const seatsSection = el("section");
  seatsSection.append(el("h3", {}, "Seats"));
  const seatList = el("ul", { "aria-label": "Seats" });
  for (const seat of rec.seats) {
    const name = seat.status === "confirmed" ? (seat.interpreter?.display_name ?? "taken") : "open";
    seatList.append(el("li", { "aria-label": `Seat ${seat.label}: ${name}` },
      `Seat ${seat.label}: ${name}`,
    ));
  }
  seatsSection.append(seatList);
  pane.append(seatsSection);

  // braid
  const braidSection = el("section");
  const braid = renderBraid({
    request: rec,
    minute: paneState.minute,
    onMinute: (m) => {
      if (paneState) paneState.minute = m;
    },
    filling: paneState.filling,
    reducedMotion: prefersReducedMotion(),
  });
  braidSection.append(braid.root);
  pane.append(braidSection);

  // rotation table
  const tableSection = el("section");
  tableSection.append(renderRotationTable(rec));
  pane.append(tableSection);

  // role controls
  const controls = el("section");
  if (user?.role === "coordinator") {
    controls.append(coordinatorControls(rec));
    controls.append(historyBlock(rec));
  } else if (user?.role === "interpreter") {
    controls.append(interpreterControls(rec, braid.readout, braid.slider));
  } else if (user?.role === "client_scheduler") {
    controls.append(schedulerActions(rec));
  }
  pane.append(controls);

  if (keepFocus) {
    const again = pane.querySelector(`#${CSS.escape(keepFocus)}`) as HTMLElement | null;
    again?.focus();
  } else if (!heading) {
    h.focus();
  }
}

function statusRegion(id: string, label: string): { wrap: HTMLElement; node: HTMLElement } {
  const node = el("div", { id, role: "status", "aria-live": "polite", "aria-label": label, class: "status-line" });
  return { wrap: node, node };
}

/** Set copy in a live region inside the open pane, surviving re-renders. */
function setPaneStatus(label: string, text: string): void {
  const pane = document.querySelector(".pane") ?? document.getElementById("page");
  const node = pane?.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
  if (node) node.textContent = text;
}

function coordinatorControls(rec: RequestRec): HTMLElement {
  const section = el("div", {});
  const region = statusRegion("job-status", "Job status");

  const interval = el("input", {
    type: "number", min: 20, max: 30, step: 1, value: rec.rotation_minutes,
    id: "rotation-interval", "aria-label": "Rotation interval (minutes)",
  }) as HTMLInputElement;
  const teamRadios = el("div", { role: "radiogroup", "aria-label": "Team size" });
  const solo = el("input", { type: "radio", name: "team-size", id: "team-solo", value: "1" }) as HTMLInputElement;
  const duo = el("input", { type: "radio", name: "team-size", id: "team-duo", value: "2" }) as HTMLInputElement;
  if (rec.team_size === 1) solo.setAttribute("checked", "checked"); else duo.setAttribute("checked", "checked");
  teamRadios.append(
    el("label", { for: "team-solo" }, solo, "Solo"),
    el("label", { for: "team-duo" }, duo, "Team of two"),
  );
  const reason = el("input", {
    type: "text", id: "team-reason", "aria-label": "Reason for team change", placeholder: "Reason for team change",
  }) as HTMLInputElement;

  const defaultTeam = rec.duration_minutes > 60 ? 2 : 1;
  const reasonRow = el("div", { class: "field" }, reason);
  reasonRow.hidden = rec.team_size === defaultTeam;
  const syncReasonVisibility = () => {
    reasonRow.hidden = (solo.checked ? 1 : 2) === defaultTeam;
  };
  solo.addEventListener("change", syncReasonVisibility);
  duo.addEventListener("change", syncReasonVisibility);

  const save = el("button", { class: "btn secondary" }, "Save staffing");
  save.addEventListener("click", async () => {
    save.setAttribute("disabled", "disabled");
    region.node.textContent = "";
    try {
      const body: Record<string, unknown> = {
        rotation_minutes: Number(interval.value),
        team_size: solo.checked ? 1 : 2,
      };
      if (solo.checked ? 1 : 2 !== rec.team_size) body["team_reason"] = reason.value;
      await api<RequestRec>("PATCH", `/api/requests/${rec.id}/staffing`, body);
      region.node.textContent = "Staffing saved.";
      await refreshPane(paneHost());
    } catch (err) {
      const fields = errorFields(err);
      if (fields["team_reason"]) {
        region.node.textContent = fields["team_reason"];
        region.node.classList.add("alert");
      } else {
        region.node.textContent = errorMessage(err);
      }
    } finally {
      save.removeAttribute("disabled");
    }
  });

  const broadcast = el("button", { class: "btn" }, "Broadcast open seats");
  broadcast.addEventListener("click", async () => {
    broadcast.setAttribute("disabled", "disabled");
    region.node.textContent = "Sending open-seat emails…";
    try {
      const out = await api<{ emailed: number }>("POST", `/api/requests/${rec.id}/broadcast`, {});
      region.node.textContent = out.emailed > 0
        ? `Open-seat email sent to ${out.emailed} eligible interpreters.`
        : "No eligible interpreter is free for this job.";
      await refreshPane(paneHost());
    } catch (err) {
      region.node.textContent = errorMessage(err);
    } finally {
      broadcast.removeAttribute("disabled");
    }
  });

  const actual = el("input", {
    type: "number", min: 1, max: 720, step: 1, value: rec.actual_minutes ?? "",
    id: "actual-minutes", "aria-label": "Actual minutes",
  }) as HTMLInputElement;
  const complete = el("button", { class: "btn secondary" }, "Mark completed");
  complete.addEventListener("click", async () => {
    complete.setAttribute("disabled", "disabled");
    region.node.textContent = "";
    try {
      const out = await api<RequestRec>("POST", `/api/requests/${rec.id}/complete`, { actual_minutes: Number(actual.value) });
      region.node.textContent = `${out.reference} marked completed at ${out.actual_minutes} minutes.`;
      await refreshPane(paneHost());
    } catch (err) {
      const code = (err as { api?: { error?: { code?: string } } }).api?.error?.code;
      region.node.textContent = code === "invalid_transition"
        ? "This job can no longer be changed that way. The detail has been refreshed."
        : errorMessage(err);
      await refreshPane(paneHost());
    } finally {
      complete.removeAttribute("disabled");
    }
  });

  const canStaff = ["submitted", "half_staffed", "staffed"].includes(rec.status);
  const canComplete = ["half_staffed", "staffed"].includes(rec.status);
  const form = el("div", { class: "form" },
    el("div", { class: "field" }, el("label", { for: "rotation-interval" }, "Rotation interval (minutes)"), interval),
    teamRadios,
    reasonRow,
    el("div", { class: "actions" }, save, broadcast),
    canComplete ? el("div", { class: "field" }, el("label", { for: "actual-minutes" }, "Actual minutes"), actual) : el("span"),
    canComplete ? el("div", { class: "actions" }, complete) : el("span"),
  );
  if (!canStaff && !canComplete) form.setAttribute("aria-disabled", "true");
  section.append(form, region.wrap);
  return section;
}

function paneHost(): HTMLElement {
  return document.querySelector(".pane") as HTMLElement;
}

function historyBlock(rec: RequestRec): HTMLElement {
  const section = el("div", {});
  section.append(el("h3", {}, "History"));
  const list = el("ul", { "aria-label": "History", class: "history" });
  for (const h of rec.history ?? []) {
    const at = new Date(h.at);
    const clock = fmtTime(h.at);
    const day = fmtDate(h.at);
    void at;
    list.append(el("li", {},
      el("span", { class: "when" }, `${clock} ${day}`),
      ` · ${h.actor} · ${h.action} · ${h.detail}`,
    ));
  }
  section.append(list);
  return section;
}

function interpreterControls(rec: RequestRec, readout: HTMLElement, slider: HTMLInputElement): HTMLElement {
  const section = el("div", {});
  const region = statusRegion("claim-status", "Claim status");
  const claimable = ["submitted", "half_staffed"].includes(rec.status);
  const actions = el("div", { class: "actions" });
  const buttons: HTMLButtonElement[] = [];
  if (claimable) {
    for (const seat of rec.seats) {
      if (seat.status !== "open") continue;
      const btn = el("button", { class: "btn" }, `Claim seat ${seat.label}`);
      btn.addEventListener("click", async () => {
        for (const b of buttons) b.setAttribute("disabled", "disabled");
        region.node.textContent = `Claiming seat ${seat.label}…`;
        // Nothing in the braid changes until the server answers.
        try {
          await api("POST", `/api/seats/${seat.id}/claim`, {});
          await refreshPane(paneHost());
          // after a win the segments fill one at a time and the copy lands after the re-render
          setPaneStatus("Claim status", `Seat ${seat.label} confirmed. Consumer details are now shown below.`);
          return;
        } catch (err) {
          const code = (err as { api?: { error?: { code?: string } } }).api?.error?.code;
          if (code === "seat_taken") {
            region.node.textContent = `Seat taken: another interpreter confirmed seat ${seat.label} first.`;
          } else if (code === "credential_invalid") {
            region.node.textContent = `Your ${rec.required_credential} credential isn't verified through this job's date.`;
          } else if (code === "schedule_conflict") {
            region.node.textContent = "You already hold a seat that overlaps this job.";
          } else {
            region.node.textContent = "This job is no longer taking claims.";
          }
          await refreshPane(paneHost());
          setPaneStatus("Claim status", region.node.textContent ?? "");
        } finally {
          for (const b of buttons) b.removeAttribute("disabled");
        }
      });
      buttons.push(btn);
      actions.append(btn);
    }
  }
  if (buttons.length === 0 && claimable) {
    region.node.textContent = "";
  }
  section.append(actions, region.wrap);
  void readout;
  void slider;
  return section;
}

function schedulerActions(rec: RequestRec, initialMessage?: string): HTMLElement {
  const section = el("div", {});
  const region = statusRegion("request-status", "Request status");
  if (initialMessage) region.node.textContent = initialMessage;
  const actions = el("div", { class: "actions" });
  if (rec.status === "draft") {
    const edit = el("a", { class: "btn secondary", href: `#/requests/${rec.id}/edit` }, "Edit draft");
    const submit = el("button", { class: "btn" }, "Submit request");
    submit.addEventListener("click", async () => {
      submit.setAttribute("disabled", "disabled");
      region.node.textContent = "";
      try {
        await api<RequestRec>("POST", `/api/requests/${rec.id}/submit`, {});
        region.node.textContent = "Request submitted. Seats are open for interpreters.";
        await refreshPane(paneHost());
      } catch (err) {
        region.node.textContent = errorMessage(err);
      } finally {
        submit.removeAttribute("disabled");
      }
    });
    actions.append(edit, submit);
  }
  if (["draft", "submitted", "half_staffed", "staffed"].includes(rec.status)) {
    const cancelBtn = el("button", { class: "btn danger" }, "Cancel booking");
    cancelBtn.addEventListener("click", async () => {
      try {
        const quote = await api<Quote>("GET", `/api/requests/${rec.id}/cancellation-quote`);
        openCancelDialog(rec, quote, region.node);
      } catch (err) {
        region.node.textContent = errorMessage(err);
      }
    });
    actions.append(cancelBtn);
  }
  section.append(actions, region.wrap);
  return section;
}

function openCancelDialog(rec: RequestRec, quote: Quote, statusNode: HTMLElement): void {
  const dlg = document.createElement("dialog");
  dlg.setAttribute("aria-label", "Cancel booking");
  const quoteBox = el("p", { class: "quote" }, quoteCopy(quote));
  const changed = el("p", { class: "field-error", hidden: "hidden" });
  const keep = el("button", { class: "btn secondary" }, "Keep booking");
  const confirm = el("button", { class: "btn danger" }, "Confirm cancellation");
  const close = (focusTarget: HTMLElement) => {
    dlg.close();
    dlg.remove();
    focusTarget.focus();
  };
  keep.addEventListener("click", () => close((document.querySelector(".pane .btn.danger") as HTMLElement) ?? document.body as HTMLElement));
  dlg.append(el("h3", {}, "Cancel booking"), quoteBox, changed, el("div", { class: "actions" }, confirm, keep));
  document.body.append(dlg);
  if (!prefersReducedMotion()) {
    dlg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 125, easing: "ease-out" });
  }
  dlg.showModal();
  keep.focus();

  // Escape closes the dialog and returns focus to Cancel booking
  dlg.addEventListener("cancel", (ev) => {
    ev.preventDefault();
    close((document.querySelector(".pane .btn.danger") as HTMLElement) ?? document.body as HTMLElement);
  });
  keep.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close((document.querySelector(".pane .btn.danger") as HTMLElement) ?? document.body as HTMLElement);
  });

  confirm.addEventListener("click", async () => {
    confirm.setAttribute("disabled", "disabled");
    try {
      const out = await api<{ request: RequestRec }>("POST", `/api/requests/${rec.id}/cancel`, { expected_fee: quote.fee }, { idempotencyKey: `cancel-${rec.id}-${Date.now()}` });
      statusNode.textContent = `${out.request.reference} cancelled. Fee: $${quote.fee}. A receipt is on its way by email.`;
      dlg.close();
      dlg.remove();
      await refreshPane(paneHost());
      void statusNode;
    } catch (err) {
      const q = errorQuote(err);
      if (q) {
        quote.fee = q.fee;
        quote.kind = q.kind;
        quoteBox.textContent = quoteCopy(q);
        changed.textContent = `The fee is now $${q.fee} because the free-cancellation window has closed. Review it and confirm again.`;
        changed.removeAttribute("hidden");
        confirm.removeAttribute("disabled");
        return;
      }
      statusNode.textContent = errorMessage(err);
      dlg.close();
      dlg.remove();
    } finally {
      confirm.removeAttribute("disabled");
    }
  });
}

function quoteCopy(quote: Quote): string {
  if (quote.kind === "early") {
    return `Free cancellation until ${fmtCutoff(quote.free_cancel_until)}. Cancelling now costs $0.00.`;
  }
  return `Late cancellation: $${quote.fee} (${quote.billable_minutes} minutes × ${quote.seats_charged} confirmed seats at $${quote.hourly_rate} per hour).`;
}

/* ------------------------------------------------------------- week board */

function renderBoard(page: HTMLElement, query: URLSearchParams): void {
  const todayKey = fmtDateKey(new Date().toISOString());
  const weekParam = query.get("week") ?? todayKey;
  const monday = mondayOf(weekParam);
  const jobParam = query.get("job");

  const region = el("div", { role: "region", "aria-label": "Week board" });
  const heading = el("h1", {}, `Week of ${labelFor(monday)}`);
  region.append(heading);

  const rail = el("aside", { class: "rail" });
  const prev = el("button", { class: "btn secondary" }, "Previous week");
  const next = el("button", { class: "btn secondary" }, "Next week");
  prev.addEventListener("click", () => navigate(`/board?week=${shiftWeek(monday, -1)}`));
  next.addEventListener("click", () => navigate(`/board?week=${shiftWeek(monday, 1)}`));
  rail.append(el("div", { class: "week-nav" }, prev, next));

  const daysNav = el("nav", { "aria-label": "Days" });
  const daysStrip = el("div", { class: "days-strip", role: "navigation", "aria-label": "Days" });
  const scroller = el("div", { class: "board-scroll" });

  const onlyOpen = el("input", { type: "checkbox", id: "only-open" });
  const onlyOpenLabel = el("label", { for: "only-open" }, onlyOpen, "Only jobs with an open seat");
  const filters = el("div", { class: "filters" }, onlyOpenLabel);
  region.append(filters);

  const board = el("div", { class: "board" });
  board.append(rail);

  let requests: RequestRec[] = [];

  const apply = async () => {
    try {
      const out = await api<{ requests: RequestRec[] }>("GET", "/api/requests?status=submitted,half_staffed,staffed,completed,invoiced,cancelled_early,cancelled_late");
      requests = out.requests;
    } catch {
      return;
    }
    draw();
  };

  const draw = () => {
    const filtered = onlyOpen.checked
      ? requests.filter((r) => ["submitted", "half_staffed"].includes(r.status))
      : requests;
    const days = groupByDay(filtered, monday);
    // keep the DOM stable: rows never reorder unless a start time changed
    for (const child of [...scroller.children]) scroller.removeChild(child);
    clear(daysNav);
    clear(daysStrip);
    const links: HTMLAnchorElement[] = [];
    for (const day of days) {
      const openCount = day.requests.filter((r) => ["submitted", "half_staffed"].includes(r.status)).reduce((acc, r) => acc + openSeatCount(r), 0);
      const link = el("a", { href: `#`, "data-day": day.dateKey },
        `${day.weekday} ${day.label}`,
        el("span", { class: "count" }, `${openCount} open`),
      );
      link.addEventListener("click", (ev) => ev.preventDefault());
      daysNav.append(link);
      daysStrip.append(link.cloneNode(true) as HTMLAnchorElement);
      links.push(link);
    }
    for (const day of days) {
      const col = el("section", { role: "region", "aria-label": `${day.weekday} ${day.label}`, class: "day-col", "data-day": day.dateKey });
      col.append(el("h3", {}, `${day.weekday} ${day.label}`));
      for (const r of day.requests) {
        const btn = rowButton(r, r.organisation?.name ?? "", (rec, source) => {
          navigate(`/board?week=${monday}&job=${rec.id}`);
          openJobPane(rec.id, source ?? null);
        });
        col.append(btn);
      }
      scroller.append(col);
    }
    wireDayScroller(scroller, links);
    const stripLinks = [...daysStrip.querySelectorAll("a")] as HTMLAnchorElement[];
    for (const link of stripLinks) {
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        const target = scroller.querySelector(`[data-day="${link.dataset.day}"]`) as HTMLElement | null;
        if (target) scroller.scrollTo({ left: target.offsetLeft - scroller.offsetLeft, behavior: "smooth" });
      });
    }
  };

  onlyOpen.addEventListener("change", draw);
  board.append(scroller);
  region.append(board);
  page.append(region);

  const poller = new Poller(apply);
  poller.start();
  pollers.push(poller);
  void apply().then(() => {
    if (!jobParam) return;
    const opener = scroller.querySelector(`[aria-label^="${jobParam}"]`) as HTMLElement | null;
    openJobPane(jobParam, opener);
  });
}

function labelFor(mondayKey: string): string {
  const parts = mondayKey.split("-").map((n) => Number(n));
  const date = new Date(Date.UTC(parts[0] ?? 2026, (parts[1] ?? 1) - 1, parts[2] ?? 1, 12));
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(date);
}

/* ----------------------------------------------------------- open seats */

function seatLine(rec: RequestRec, label: string): string {
  return `${settingWord(rec.setting)} · ${rec.required_credential} · ${fmtWeekday(rec.starts_at)}, ${fmtDate(rec.starts_at)} · ${fmtTime(rec.starts_at)} to ${fmtTime(rec.ends_at)} · ${rec.city} · Seat ${label}`;
}

function renderOpenSeats(page: HTMLElement, wide: boolean): void {
  const region = el("section", { "aria-label": "Open seats" });
  const h = el("h1", {}, "Open seats");
  const list = el("ul", { "aria-label": "Open seats", class: "item-list" });
  region.append(h, list);
  page.append(region);

  const apply = async () => {
    let out: { open_seats: Array<{ seat_id: string; seat_label: string; request: RequestRec }> };
    try {
      out = await api("GET", "/api/open-seats");
    } catch {
      return;
    }
    // stable: keep order by start time; only rebuild when data changed
    const sig = JSON.stringify(out.open_seats.map((s) => [s.seat_id, s.seat_label, s.request.status, s.request.seats.map((x) => x.status)]));
    if (sig === (list.dataset.sig ?? "")) return;
    list.dataset.sig = sig;
    clear(list);
    for (const s of out.open_seats) {
      const link = el("a", { href: `#/jobs/${s.request.id}?seat=${s.seat_id}` },
        el("span", { class: "ref" }, s.request.reference),
        el("span", { class: "line" }, seatLine(s.request, s.seat_label)),
      );
      list.append(el("li", {}, link));
    }
  };
  const poller = new Poller(apply);
  poller.start();
  pollers.push(poller);
  void apply();
  void wide;
}

function renderAssignments(page: HTMLElement): void {
  const region = el("section", { "aria-label": "My assignments" });
  const h = el("h1", {}, "My assignments");
  const list = el("ul", { "aria-label": "My assignments", class: "item-list" });
  region.append(h, list);
  page.append(region);

  const apply = async () => {
    let out: { assignments: Array<{ seat_id: string; seat_label: string; request: RequestRec }> };
    try {
      out = await api("GET", "/api/assignments");
    } catch {
      return;
    }
    const sig = JSON.stringify(out.assignments.map((s) => [s.seat_id, s.seat_label, s.request.status]));
    if (sig === (list.dataset.sig ?? "")) return;
    list.dataset.sig = sig;
    clear(list);
    for (const s of out.assignments) {
      const link = el("a", { href: `#/jobs/${s.request.id}?seat=${s.seat_id}` },
        el("span", { class: "ref" }, s.request.reference),
        el("span", { class: "line" }, seatLine(s.request, s.seat_label)),
      );
      list.append(el("li", {}, link));
    }
  };
  const poller = new Poller(apply);
  poller.start();
  pollers.push(poller);
  void apply();
}

/* ------------------------------------------------------------ job route */

function renderJobPage(page: HTMLElement, requestId: string): void {
  // interpreter-facing full page: the pane fills the content area
  const host = el("div", { class: "pane", role: "region", "aria-label": "Job detail", style: "position:static;width:auto;top:0;border:0" });
  page.append(host);
  openJobPane(requestId, null, host);
  const poller = new Poller(() => refreshPane(host));
  poller.start();
  pollers.push(poller);
}

/* ------------------------------------------------------------- requests */

function renderRequests(page: HTMLElement): void {
  const region = el("section", { "aria-label": "Requests" });
  region.append(el("h1", {}, "Requests"));
  const search = el("input", { type: "search", "aria-label": "Search requests", placeholder: "Reference or consumer name" }) as HTMLInputElement;
  const toolbar = el("div", { class: "toolbar" }, search);
  region.append(toolbar);
  const wrap = el("div", { class: "table-wrap" });
  region.append(wrap);
  page.append(region);

  let all: RequestRec[] = [];
  const draw = () => {
    const q = search.value.trim();
    const shown = all.filter((r) => !q || r.reference.toLowerCase().includes(q.toLowerCase()) || (r.consumer_name ?? "").toLowerCase().includes(q.toLowerCase()));
    shown.sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    clear(wrap);
    const table = el("table", { class: "grid cards", "aria-label": "Requests" });
    const thead = el("thead");
    thead.append(el("tr", {},
      el("th", {}, "Reference"), el("th", {}, "Date"), el("th", {}, "Time"),
      el("th", {}, "Setting"), el("th", {}, "Status"), el("th", {}, "Seats"),
    ));
    table.append(thead);
    const tbody = el("tbody");
    for (const r of shown) {
      const cancelled = r.status.startsWith("cancelled");
      const tr = el("tr", { class: cancelled ? "cancelled" : "" });
      tr.append(el("td", { "data-label": "Reference" },
        el("a", { href: `#/requests/${r.id}`, "aria-label": r.reference, class: "ref" }, r.reference)));
      tr.append(el("td", { class: "time", "data-label": "Date" }, fmtDate(r.starts_at)));
      tr.append(el("td", { class: "time", "data-label": "Time" }, fmtTime(r.starts_at)));
      tr.append(el("td", { "data-label": "Setting" }, settingWord(r.setting)));
      tr.append(el("td", { "data-label": "Status" },
        el("span", { class: "status-cell" }, statusLabel(r.status), seatCounterHtml(confirmedSeatCount(r), r.seats.length))));
      tr.append(el("td", { class: "num", "data-label": "Seats" }, `${confirmedSeatCount(r)}/${r.seats.length}`));
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
  };

  const apply = async () => {
    try {
      const out = await api<{ requests: RequestRec[] }>("GET", "/api/requests");
      all = out.requests;
      draw();
    } catch { /* keep the last list */ }
  };
  searchOnInput(search, draw);
  const poller = new Poller(apply);
  poller.start();
  pollers.push(poller);
  void apply();
}

/* --------------------------------------------------------- new request */

function requestForm(rec: RequestRec | null, region: HTMLElement): HTMLFormElement {
  const form = el("form", { "aria-label": "New request", onsubmit: "return false" }) as HTMLFormElement;
  const fields: Record<string, { input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; error: HTMLElement; label: string }> = {};
  const fieldOf = (name: string): { input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; error: HTMLElement; label: string } => {
    const found = fields[name];
    if (!found) throw new Error(`unknown field ${name}`);
    return found;
  };

  const setting = el("select", { id: "f-setting" }) as HTMLSelectElement;
  for (const [value, word] of [["medical", "Medical"], ["education", "Education"], ["legal", "Legal"]] as const) {
    setting.append(el("option", { value }, word));
  }
  if (rec) setting.value = rec.setting;

  const date = el("input", { id: "f-date", type: "text", placeholder: "YYYY-MM-DD", autocomplete: "off" }) as HTMLInputElement;
  const time = el("input", { id: "f-time", type: "text", placeholder: "h:mm AM/PM", autocomplete: "off" }) as HTMLInputElement;
  const duration = el("input", { id: "f-duration", type: "number", min: 30, max: 480, step: 1 }) as HTMLInputElement;
  const credential = el("select", { id: "f-credential" }) as HTMLSelectElement;
  for (const code of ["NIC", "CDI", "SC:L", "EIPA"]) {
    credential.append(el("option", { value: code }, code));
  }
  const consumer = el("input", { id: "f-consumer", type: "text" }) as HTMLInputElement;
  const address = el("input", { id: "f-address", type: "text" }) as HTMLInputElement;
  const city = el("input", { id: "f-city", type: "text" }) as HTMLInputElement;
  const notes = el("textarea", { id: "f-notes", rows: 3 }) as HTMLTextAreaElement;

  if (rec) {
    date.value = fmtDateKey(rec.starts_at);
    time.value = fmtTime(rec.starts_at);
    duration.value = String(rec.duration_minutes);
    credential.value = rec.required_credential;
    consumer.value = rec.consumer_name ?? "";
    address.value = rec.location_address ?? "";
    city.value = rec.city;
    notes.value = rec.notes ?? "";
  }

  const mk = (name: string, label: string, input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, hint?: string) => {
    const error = el("p", { class: "field-error", id: `err-${name}`, hidden: "hidden" });
    input.setAttribute("aria-describedby", `err-${name}`);
    const fieldEl = el("div", { class: "field" }, el("label", { for: input.id }, label), input);
    if (hint) fieldEl.append(el("span", { class: "hint" }, hint));
    fieldEl.append(error);
    form.append(fieldEl);
    fields[name] = { input, error, label };
  };

  mk("setting", "Setting", setting);
  mk("date", "Date", date, "YYYY-MM-DD");
  mk("time", "Start time", time, "h:mm AM/PM");
  mk("duration_minutes", "Duration (minutes)", duration);
  mk("required_credential", "Required credential", credential);
  mk("consumer_name", "Deaf consumer name", consumer);
  mk("location_address", "Street address", address);
  mk("city", "City", city);
  mk("notes", "Notes for interpreters", notes);

  const clearErrors = () => {
    for (const f of Object.values(fields)) {
      f.error.setAttribute("hidden", "hidden");
      f.input.removeAttribute("aria-invalid");
    }
  };

  const readStartsAt = (): string | null => {
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date.value.trim());
    if (!dateOk) {
      const f = fieldOf("date");
      f.error.textContent = "Enter the date as YYYY-MM-DD.";
      f.error.removeAttribute("hidden");
      f.input.setAttribute("aria-invalid", "true");
      return null;
    }
    const timeOk = /^(0?[1-9]|1[0-2]):[0-5]\d [AaPp][Mm]$/.test(time.value.trim());
    if (!timeOk) {
      const f = fieldOf("time");
      f.error.textContent = "Enter the time like 9:00 AM.";
      f.error.removeAttribute("hidden");
      f.input.setAttribute("aria-invalid", "true");
      return null;
    }
    const m = /^(0?[1-9]|1[0-2]):([0-5]\d) ([AaPp][Mm])$/.exec(time.value.trim());
    if (!m) return null;
    const hh = m[1];
    const mm = m[2];
    const ampm = m[3];
    let hour = Number(hh);
    if (ampm !== undefined && ampm.toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (ampm !== undefined && ampm.toLowerCase() === "am" && hour === 12) hour = 0;
    return `${date.value.trim()}T${String(hour).padStart(2, "0")}:${mm}`;
  };

  const payload = () => {
    const starts = readStartsAt();
    if (starts === null) return null;
    return {
      setting: setting.value,
      starts_at: starts,
      duration_minutes: Number(duration.value),
      required_credential: credential.value,
      consumer_name: consumer.value,
      location_address: address.value,
      city: city.value,
      notes: notes.value,
    };
  };

  const statusRegion = el("div", { role: "status", "aria-live": "polite", "aria-label": "Request status", class: "status-line" });

  const saveDraft = el("button", { class: "btn secondary", type: "button" }, "Save draft");
  const submitReq = el("button", { class: "btn", type: "button" }, "Submit request");

  const doAction = async (submit: boolean) => {
    clearErrors();
    statusRegion.classList.remove("alert");
    const body = payload();
    if (body === null) return;
    saveDraft.setAttribute("disabled", "disabled");
    submitReq.setAttribute("disabled", "disabled");
    try {
      if (rec) {
        await api<RequestRec>("PATCH", `/api/requests/${rec.id}`, body);
        if (submit) {
          await api<RequestRec>("POST", `/api/requests/${rec.id}/submit`, {});
          navigate(`/requests/${rec.id}?saved=submitted`);
          return;
        }
        navigate(`/requests/${rec.id}?saved=draft`);
        return;
      }
      const created = await api<RequestRec>("POST", "/api/requests", body);
      if (submit) {
        await api<RequestRec>("POST", `/api/requests/${created.id}/submit`, {});
        navigate(`/requests/${created.id}?saved=submitted`);
        return;
      }
      navigate(`/requests/${created.id}?saved=draft`);
    } catch (err) {
      const fieldsMap = errorFields(err);
      let shown = false;
      for (const [name, msg] of Object.entries(fieldsMap)) {
        const f = fields[name];
        if (!f) continue;
        f.error.textContent = msg;
        f.error.removeAttribute("hidden");
        f.input.setAttribute("aria-invalid", "true");
        shown = true;
      }
      if (!shown) {
        statusRegion.textContent = errorMessage(err);
        statusRegion.classList.add("alert");
      }
    } finally {
      saveDraft.removeAttribute("disabled");
      submitReq.removeAttribute("disabled");
    }
  };

  saveDraft.addEventListener("click", () => void doAction(false));
  submitReq.addEventListener("click", () => void doAction(true));
  form.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target instanceof HTMLElement && ev.target.tagName !== "TEXTAREA") {
      ev.preventDefault();
      void doAction(false);
    }
  });

  form.append(el("div", { class: "actions" }, saveDraft, submitReq), statusRegion);
  return form;
}

function renderNewRequest(page: HTMLElement): void {
  const region = el("section", { "aria-label": "New request" });
  region.append(el("h1", {}, "New request"));
  const form = requestForm(null, region);
  const wrap = el("div", { style: "grid-column: span 6" }, form);
  region.append(wrap);
  page.append(region);
}

async function renderEditRequest(page: HTMLElement, id: string): Promise<void> {
  const region = el("section", { "aria-label": "New request" });
  region.append(el("h1", {}, "New request"));
  page.append(region);
  let rec: RequestRec;
  try {
    rec = await api<RequestRec>("GET", `/api/requests/${id}`);
  } catch {
    page.append(notFoundBlock());
    return;
  }
  if (rec.status !== "draft") {
    navigate(`/requests/${id}`);
    return;
  }
  region.append(requestForm(rec, region));
}

async function renderRequestDetail(page: HTMLElement, id: string, saved?: string | null): Promise<void> {
  let rec: RequestRec;
  try {
    rec = await api<RequestRec>("GET", `/api/requests/${id}`);
  } catch {
    page.append(notFoundBlock());
    return;
  }
  const region = el("section");
  const head = el("div", { class: "toolbar" },
    el("h1", {}, rec.reference),
    el("span", { class: "status-cell" }, statusLabel(rec.status), seatCounterHtml(confirmedSeatCount(rec), rec.seats.length)),
  );
  region.append(head);

  const facts = el("dl", { class: "facts" });
  facts.append(el("dt", {}, "Date"), el("dd", {}, fmtDate(rec.starts_at)));
  facts.append(el("dt", {}, "Time"), el("dd", {}, `${fmtTime(rec.starts_at)} to ${fmtTime(rec.ends_at)}`));
  facts.append(el("dt", {}, "Setting"), el("dd", {}, settingWord(rec.setting)));
  facts.append(el("dt", {}, "Required credential"), el("dd", {}, rec.required_credential));
  facts.append(el("dt", {}, "City"), el("dd", {}, rec.city));
  if (rec.consumer_name !== undefined) {
    facts.append(el("dt", {}, "Consumer name"), el("dd", {}, rec.consumer_name));
    facts.append(el("dt", {}, "Street address"), el("dd", {}, rec.location_address ?? ""));
    facts.append(el("dt", {}, "Notes"), el("dd", {}, rec.notes ?? ""));
  }
  region.append(facts);

  if (rec.free_cancel_until) {
    const past = new Date(rec.free_cancel_until).getTime() <= Date.now();
    region.append(el("p", {},
      past
        ? `Free cancellation ended ${fmtCutoff(rec.free_cancel_until)}`
        : `Free cancellation until ${fmtCutoff(rec.free_cancel_until)}`,
    ));
  }

  const seatsSection = el("section");
  seatsSection.append(el("h3", {}, "Seats"));
  const seatList = el("ul", { "aria-label": "Seats" });
  for (const seat of rec.seats) {
    const name = seat.status === "confirmed" ? (seat.interpreter?.display_name ?? "taken") : "open";
    seatList.append(el("li", { "aria-label": `Seat ${seat.label}: ${name}` }, `Seat ${seat.label}: ${name}`));
  }
  seatsSection.append(seatList);
  region.append(seatsSection);

  // braid + rotation table, full width
  const braid = renderBraid({ request: rec, minute: 0, onMinute: () => {}, filling: new Set(), reducedMotion: prefersReducedMotion() });
  const braidSection = el("section");
  braidSection.append(braid.root);
  region.append(braidSection);
  const tableSection = el("section");
  tableSection.append(renderRotationTable(rec));
  region.append(tableSection);

  const actionsBlock = schedulerActions(
    rec,
    saved === "draft"
      ? "Draft saved."
      : saved === "submitted"
        ? "Request submitted. Seats are open for interpreters."
        : undefined,
  );
  region.append(actionsBlock);
  page.append(region);
  (head.querySelector("h1") as HTMLElement).focus?.();
}

/* ----------------------------------------------------------- credentials */

function renderCredentialsReview(page: HTMLElement, status: string): void {
  const region = el("section", { "aria-label": "Credentials" });
  region.append(el("h1", {}, "Credentials"));
  const tabs = el("div", { class: "toolbar" });
  for (const [label, value] of [["Awaiting review", "uploaded"], ["Verified", "verified"], ["Expired", "expired"], ["All", "all"]] as const) {
    const b = el("button", { class: "btn linklike" + (status === value ? " secondary" : ""), "aria-pressed": status === value ? "true" : "false" }, label);
    b.addEventListener("click", () => {
      navigate(`/credentials?status=${value}`);
    });
    tabs.append(b);
  }
  region.append(tabs);
  const statusRegion = el("div", { role: "status", "aria-live": "polite", "aria-label": "Review status", class: "status-line" });
  region.append(statusRegion);
  const wrap = el("div", { class: "table-wrap" });
  region.append(wrap);
  page.append(region);

  const apply = async () => {
    let out: { credentials: Array<Credential & { interpreter: { id: string; display_name: string; full_name: string } }> };
    try {
      out = await api("GET", `/api/credentials?status=${status}`);
    } catch {
      return;
    }
    const sig = JSON.stringify(out.credentials.map((c) => [c.id, c.status]));
    if (sig === (wrap.dataset.sig ?? "")) return;
    wrap.dataset.sig = sig;
    clear(wrap);
    const table = el("table", { class: "grid cards", "aria-label": "Credentials awaiting review" });
    const thead = el("thead");
    thead.append(el("tr", {},
      el("th", {}, "Interpreter"), el("th", {}, "Type"), el("th", {}, "Uploaded"),
      el("th", {}, "File"), el("th", {}, "Expiry date"), el("th", {}, "Action"),
    ));
    table.append(thead);
    const tbody = el("tbody");
    for (const c of out.credentials) {
      const tr = el("tr", {});
      tr.append(el("td", { "data-label": "Interpreter" }, c.interpreter.display_name));
      tr.append(el("td", { "data-label": "Type" }, c.credential_type));
      tr.append(el("td", { class: "time", "data-label": "Uploaded" }, fmtDate(c.uploaded_at)));
      const viewBtn = el("button", { class: "btn linklike" }, "View file");
      viewBtn.setAttribute("aria-label", `View file for ${c.interpreter.display_name} ${c.credential_type}`);
      viewBtn.addEventListener("click", async () => {
        try {
          const outUrl = await api<{ url: string }>("GET", `/api/credentials/${c.id}/file`);
          window.open(outUrl.url, "_blank", "noopener");
        } catch (err) {
          statusRegion.textContent = errorMessage(err);
        }
      });
      const fileCell = el("td", { "data-label": "File" }, viewBtn);
      tr.append(fileCell);
      const expiry = el("input", { type: "text", placeholder: "YYYY-MM-DD" }) as HTMLInputElement;
      expiry.setAttribute("aria-label", `Expiry date for ${c.interpreter.display_name} ${c.credential_type}`);
      tr.append(el("td", { "data-label": "Expiry date" }, expiry));
      const verifyBtn = el("button", { class: "btn secondary" }, "Verify");
      verifyBtn.setAttribute("aria-label", `Verify ${c.interpreter.display_name} ${c.credential_type}`);
      verifyBtn.addEventListener("click", async () => {
        verifyBtn.setAttribute("disabled", "disabled");
        statusRegion.classList.remove("alert");
        try {
          const outCred = await api<Credential>("POST", `/api/credentials/${c.id}/verify`, { expires_on: expiry.value });
          statusRegion.textContent = `Verified ${outCred.credential_type} for ${c.interpreter.display_name}, valid through ${fmtDate(outCred.expires_on + "T12:00:00Z")}.`;
          wrap.dataset.sig = "";
          await apply();
        } catch (err) {
          statusRegion.textContent = errorMessage(err);
          statusRegion.classList.add("alert");
        } finally {
          verifyBtn.removeAttribute("disabled");
        }
      });
      tr.append(el("td", { "data-label": "Action" }, verifyBtn));
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
  };
  const poller = new Poller(apply);
  poller.start();
  pollers.push(poller);
  void apply();
}

function renderProfile(page: HTMLElement): void {
  const region = el("section", { "aria-label": "Profile" });
  region.append(el("h1", {}, "Profile"));

  // upload form
  const form = el("form", { "aria-label": "Upload certificate", onsubmit: "return false" }) as HTMLFormElement;
  const type = el("select", { id: "u-type" }) as HTMLSelectElement;
  for (const code of ["NIC", "CDI", "SC:L", "EIPA"]) type.append(el("option", { value: code }, code));
  type.setAttribute("aria-label", "Credential type");
  const file = el("input", { id: "u-file", type: "file" }) as HTMLInputElement;
  const fileLabel = el("label", { for: "u-file" }, "Certificate file");
  fileLabel.setAttribute("aria-label", "Certificate file");
  const uploadBtn = el("button", { class: "btn", type: "button" }, "Upload certificate");
  const statusRegion = el("div", { role: "status", "aria-live": "polite", "aria-label": "Upload status", class: "status-line" });

  uploadBtn.addEventListener("click", async () => {
    const f = file.files?.[0];
    uploadBtn.setAttribute("disabled", "disabled");
    statusRegion.classList.remove("alert");
    statusRegion.textContent = "Uploading certificate…";
    try {
      const fd = new FormData();
      fd.append("credential_type", type.value);
      fd.append("file", f ?? new Blob());
      const res = await fetch("/api/me/credentials", { method: "POST", body: fd, credentials: "same-origin" });
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : {};
      if (!res.ok) {
        const code = parsed?.error?.code;
        if (code === "payload_too_large") statusRegion.textContent = "That file is over 5,000,000 bytes. Choose a smaller file.";
        else if (code === "unsupported_type") statusRegion.textContent = "Upload a PDF, PNG or JPEG file.";
        else if (code === "storage_unavailable") statusRegion.textContent = "Certificate storage is unreachable. Nothing was saved or opened; try again in a few minutes.";
        else statusRegion.textContent = parsed?.error?.message ?? "Upload failed.";
        statusRegion.classList.add("alert");
      } else {
        statusRegion.textContent = "Certificate uploaded. A coordinator will verify it.";
        await refreshTable();
      }
    } catch {
      statusRegion.textContent = "Couldn't reach Crosshand Relay. Check your connection and try again.";
      statusRegion.classList.add("alert");
    } finally {
      uploadBtn.removeAttribute("disabled");
    }
  });

  form.append(
    el("div", { class: "field" }, el("label", { for: "u-type" }, "Credential type"), type),
    el("div", { class: "field" }, fileLabel, file),
    el("div", { class: "actions" }, uploadBtn),
    statusRegion,
  );
  region.append(form);

  // my credentials table
  const tableWrap = el("div", { class: "table-wrap" });
  const refreshTable = async () => {
    let out: { credentials: Credential[] };
    try {
      out = await api("GET", "/api/me/credentials");
    } catch {
      return;
    }
    clear(tableWrap);
    const table = el("table", { class: "grid cards", "aria-label": "My credentials" });
    const thead = el("thead");
    thead.append(el("tr", {},
      el("th", {}, "Type"), el("th", {}, "Status"), el("th", {}, "Expires"), el("th", {}, "Uploaded"),
    ));
    table.append(thead);
    const tbody = el("tbody");
    for (const c of out.credentials) {
      const word = c.status === "uploaded" ? "Uploaded" : c.status === "verified" ? "Verified" : "Expired";
      tbody.append(el("tr", {},
        el("td", { "data-label": "Type" }, c.credential_type),
        el("td", { "data-label": "Status" }, word),
        el("td", { class: "time", "data-label": "Expires" }, c.expires_on ?? "—"),
        el("td", { class: "time", "data-label": "Uploaded" }, fmtDate(c.uploaded_at)),
      ));
    }
    table.append(tbody);
    tableWrap.append(table);
  };
  region.append(tableWrap);
  page.append(region);
  void refreshTable();
}

/* -------------------------------------------------------------- billing */

function renderBilling(page: HTMLElement): void {
  const region = el("section", { "aria-label": "Billing" });
  region.append(el("h1", {}, "Billing"));
  const statusRegion = el("div", { role: "status", "aria-live": "polite", "aria-label": "Billing status", class: "status-line" });
  region.append(statusRegion);
  const wrap = el("div", { class: "table-wrap" });
  region.append(wrap);
  page.append(region);

  const apply = async () => {
    let out: { requests: RequestRec[] };
    try {
      out = await api("GET", "/api/requests?status=completed");
    } catch {
      return;
    }
    const ready = out.requests.filter((r) => r.status === "completed");
    const sig = JSON.stringify(ready.map((r) => [r.id, r.status, r.actual_minutes]));
    if (sig === (wrap.dataset.sig ?? "") && wrap.childElementCount > 0) return;
    wrap.dataset.sig = sig;
    clear(wrap);
    const table = el("table", { class: "grid cards", "aria-label": "Ready to close" });
    const thead = el("thead");
    thead.append(el("tr", {},
      el("th", {}, "Reference"), el("th", {}, "Organisation"), el("th", {}, "Date"),
      el("th", {}, "Seats"), el("th", {}, "Actual minutes"), el("th", {}, "Action"),
    ));
    table.append(thead);
    const tbody = el("tbody");
    for (const r of ready) {
      const closeBtn = el("button", { class: "btn" }, "Close");
      closeBtn.setAttribute("aria-label", `Close ${r.reference}`);
      closeBtn.addEventListener("click", async () => {
        closeBtn.setAttribute("disabled", "disabled");
        statusRegion.classList.remove("alert");
        statusRegion.textContent = `Closing ${r.reference}…`;
        try {
          const out2 = await api<{ request: RequestRec; invoice: Invoice }>("POST", `/api/requests/${r.id}/close`, {}, { idempotencyKey: `close-${r.id}-${crypto.randomUUID()}` });
          if (out2.invoice.billing_status === "pending") {
            statusRegion.textContent = `${out2.invoice.request_reference} closed at $${out2.invoice.amount}. Invoice pending: it posts to billing automatically once the billing system responds.`;
          } else {
            statusRegion.textContent = `${out2.invoice.request_reference} invoiced at $${out2.invoice.amount}.`;
          }
          wrap.dataset.sig = "";
          await apply();
        } catch (err) {
          statusRegion.textContent = errorMessage(err);
        }
      });
      tbody.append(el("tr", {},
        el("td", { "data-label": "Reference" }, el("span", { class: "ref" }, r.reference)),
        el("td", { "data-label": "Organisation" }, r.organisation?.name ?? ""),
        el("td", { class: "time", "data-label": "Date" }, fmtDate(r.starts_at)),
        el("td", { class: "num", "data-label": "Seats" }, `${confirmedSeatCount(r)}/${r.seats.length}`),
        el("td", { class: "num", "data-label": "Actual minutes" }, String(r.actual_minutes ?? "")),
        el("td", { "data-label": "Action" }, closeBtn),
      ));
    }
    table.append(tbody);
    wrap.append(table);
  };
  const poller = new Poller(apply);
  poller.start();
  pollers.push(poller);
  void apply();
}

function renderInvoices(page: HTMLElement): void {
  const region = el("section", { "aria-label": "Invoices" });
  region.append(el("h1", {}, "Invoices"));
  const search = el("input", { type: "search", "aria-label": "Search invoices", placeholder: "Reference" }) as HTMLInputElement;
  const exportLink = el("a", { class: "btn secondary", href: "/api/invoices.csv" }, "Export CSV");
  const toolbar = el("div", { class: "toolbar" }, search, exportLink);
  region.append(toolbar);
  const wrap = el("div", { class: "table-wrap" });
  region.append(wrap);
  page.append(region);

  const apply = async () => {
    const q = search.value.trim();
    let out: { invoices: Invoice[] };
    try {
      out = await api("GET", `/api/invoices?q=${encodeURIComponent(q)}`);
    } catch {
      return;
    }
    const sig = JSON.stringify(out.invoices.map((i) => [i.id, i.billing_status, i.killbill_invoice_id]));
    if (sig === (wrap.dataset.sig ?? "") && wrap.childElementCount > 0) return;
    wrap.dataset.sig = sig;
    clear(wrap);
    const table = el("table", { class: "grid cards", "aria-label": "Invoices" });
    const thead = el("thead");
    thead.append(el("tr", {},
      el("th", {}, "Reference"), el("th", {}, "Organisation"), el("th", {}, "Kind"),
      el("th", { class: "num" }, "Billable minutes"), el("th", { class: "num" }, "Seats"),
      el("th", {}, "Rate"), el("th", {}, "Amount"), el("th", {}, "Billing status"), el("th", {}, "Kill Bill invoice"),
    ));
    table.append(thead);
    const tbody = el("tbody");
    for (const inv of out.invoices) {
      tbody.append(el("tr", {},
        el("td", { "data-label": "Reference" }, inv.request_reference),
        el("td", { "data-label": "Organisation" }, inv.organisation.name),
        el("td", { "data-label": "Kind" }, inv.kind === "interpreting" ? "Interpreting" : "Late cancellation"),
        el("td", { class: "num", "data-label": "Billable minutes" }, String(inv.billable_minutes)),
        el("td", { class: "num", "data-label": "Seats" }, String(inv.seats)),
        el("td", { class: "num", "data-label": "Rate" }, inv.hourly_rate),
        el("td", { class: "num", "data-label": "Amount" }, inv.amount),
        el("td", { "data-label": "Billing status" }, inv.billing_status === "pending" ? "Invoice pending" : "Posted"),
        el("td", { "data-label": "Kill Bill invoice" }, inv.killbill_invoice_id ?? ""),
      ));
    }
    table.append(tbody);
    wrap.append(table);
    exportLink.setAttribute("href", `/api/invoices.csv?q=${encodeURIComponent(q)}`);
  };
  searchOnInput(search, () => void apply());
  const poller = new Poller(apply);
  poller.start();
  pollers.push(poller);
  void apply();
}

function notFoundBlock(): HTMLElement {
  return el("div", { class: "not-found" },
    el("h1", {}, "Request not found"),
    el("p", {}, "This request doesn't exist or isn't available to you."),
  );
}

/* --------------------------------------------------------------- router */

export async function renderRoute(route: string, page: HTMLElement): Promise<void> {
  const [rawPath, search] = route.split("?");
  const path = rawPath ?? "/";
  const query = new URLSearchParams(search ?? "");
  switch (true) {
    case path === "/board":
      renderBoard(page, query);
      return;
    case path === "/open-seats":
      renderOpenSeats(page, true);
      return;
    case path === "/assignments":
      renderAssignments(page);
      return;
    case /^\/jobs\/[^/]+$/.test(path): {
      const id = path.split("/")[2] ?? "";
      renderJobPage(page, id);
      return;
    }
    case path === "/credentials":
      renderCredentialsReview(page, query.get("status") ?? "uploaded");
      return;
    case path === "/profile":
      renderProfile(page);
      return;
    case path === "/requests":
      renderRequests(page);
      return;
    case path === "/requests/new":
      renderNewRequest(page);
      return;
    case /^\/requests\/[^/]+\/edit$/.test(path): {
      const id = path.split("/")[2] ?? "";
      await renderEditRequest(page, id);
      return;
    }
    case /^\/requests\/[^/]+$/.test(path): {
      const id = path.split("/")[2] ?? "";
      await renderRequestDetail(page, id, query.get("saved"));
      return;
    }
    case path === "/billing":
      renderBilling(page);
      return;
    case path === "/invoices":
      renderInvoices(page);
      return;
    case path === "/":
      if (user) {
        navigate(homeFor(user.role));
        return;
      }
      renderSignIn();
      return;
    case path === "/signin":
      if (user) {
        navigate(homeFor(user.role));
        return;
      }
      renderSignIn();
      return;
    default:
      page.append(notFoundBlock());
      return;
  }
}
