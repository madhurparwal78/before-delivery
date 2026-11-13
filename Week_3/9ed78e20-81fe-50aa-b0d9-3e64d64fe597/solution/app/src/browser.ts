import { openDialog } from "./dialog.js";
import { londonInstant } from "./domain.js";
import type { ModelRoute, PublicClaim } from "./types.js";
document.documentElement.classList.add("enhanced");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const $ = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T | null => root.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T[] => [...root.querySelectorAll<T>(selector)];
function time(value: string, zone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(value))
    .replace(" at", ",");
}
$$<HTMLTimeElement>("[data-publication]").forEach((el) => {
  const value = el.dataset.publication!;
  // Each timestamp stays on one line, so a narrow column never strands part of a date.
  const part = (text: string): HTMLSpanElement => {
    const span = document.createElement("span");
    span.className = "nowrap";
    span.textContent = text;
    return span;
  };
  el.replaceChildren(
    "Published ",
    part(`${time(value)} your time`),
    " ",
    part(`(${time(value, "Europe/London")} London)`),
  );
});
const models = $<HTMLButtonElement>("[data-models]"),
  modelMenu = $(".models-menu"),
  modelList = $<HTMLTemplateElement>("[data-models-list]"),
  mobile = $<HTMLButtonElement>("[data-menu]"),
  primary = $(".primary");
function hideDisclosure(element: HTMLElement, hide: () => void): void {
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
  const finished = (): void => {
    hide();
    element.inert = false;
    element.removeAttribute("aria-hidden");
  };
  if (reduce.matches) {
    finished();
    return;
  }
  const duration = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--disclosure"),
  );
  void element
    .animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(6px)" },
      ],
      { duration, easing: "ease-out" },
    )
    .finished.then(finished, () => {});
}
function closePrimary(returnFocus = true): void {
  mobile?.setAttribute("aria-expanded", "false");
  if (primary) hideDisclosure(primary, () => primary.classList.remove("open"));
  if (returnFocus) mobile?.focus();
}
function closeMenus(returnFocus = true): void {
  if (models?.getAttribute("aria-expanded") === "true") {
    models.setAttribute("aria-expanded", "false");
    if (modelMenu)
      hideDisclosure(modelMenu, () => {
        modelMenu.hidden = true;
        modelMenu.replaceChildren();
      });
    if (returnFocus) models.focus();
  } else if (mobile?.getAttribute("aria-expanded") === "true")
    closePrimary(returnFocus);
}
models?.addEventListener("click", () => {
  if (models.getAttribute("aria-expanded") === "true") {
    closeMenus();
    return;
  }
  models.setAttribute("aria-expanded", "true");
  if (modelMenu) {
    modelMenu.getAnimations().forEach((animation) => animation.cancel());
    if (modelList) modelMenu.replaceChildren(modelList.content.cloneNode(true));
    modelMenu.hidden = false;
    modelMenu.inert = false;
    modelMenu.removeAttribute("aria-hidden");
  }
});
mobile?.addEventListener("click", () => {
  if (mobile.getAttribute("aria-expanded") === "true") {
    closePrimary();
    return;
  }
  mobile.setAttribute("aria-expanded", "true");
  if (primary) {
    primary.getAnimations().forEach((animation) => animation.cancel());
    primary.classList.add("open");
    primary.inert = false;
    primary.removeAttribute("aria-hidden");
  }
});

document.addEventListener("click", (event) => {
  if (
    event.target instanceof Node &&
    !$(".models-disclosure")?.contains(event.target) &&
    models?.getAttribute("aria-expanded") === "true"
  )
    closeMenus(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenus();
});

const ease = "cubic-bezier(0.2, 0.65, 0.3, 1)";
const revealDuration = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--reveal"),
);
const reveals = $$<HTMLElement>("[data-reveal]");
if (reduce.matches) reveals.forEach((el) => (el.dataset.reveal = "done"));
else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement))
          return;
        const section = entry.target;
        observer.unobserve(section);
        void section
          .animate(
            [
              { opacity: 0, transform: "translateY(12px)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: revealDuration, easing: ease },
          )
          .finished.then(
            () => (section.dataset.reveal = "done"),
            () => (section.dataset.reveal = "done"),
          );
      });
    },
    // Sections stay visible until they are about to enter, then fade up as they arrive.
    { rootMargin: "0px 0px 15% 0px" },
  );
  reveals.forEach((el) => observer.observe(el));
  // Activating a control inside an entering section completes its reveal at once.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const section =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-reveal="pending"]')
          : null;
      section?.getAnimations().forEach((a) => a.finish());
    },
    true,
  );
  document.addEventListener("focusin", (event) => {
    const section =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-reveal="pending"]')
        : null;
    if (!section) return;
    const running = section.getAnimations();
    if (running.length) running.forEach((a) => a.finish());
    else {
      observer.unobserve(section);
      section.dataset.reveal = "done";
    }
  });
}
// The section rail marks the last section whose top has passed a reading line 30% down the viewport,
// or the first section while none has.
const railLinks = $$<HTMLAnchorElement>('nav[aria-label="Sections"] a');
if (railLinks.length) {
  const places = railLinks.flatMap((link) => {
    const target = document.getElementById(link.hash.slice(1));
    return target
      ? [{ section: target.closest("section") ?? target, link }]
      : [];
  });
  let frame = 0;
  const mark = (): void => {
    frame = 0;
    const line = innerHeight * 0.3;
    const passed = places.filter(
      (p) => p.section.getBoundingClientRect().top <= line,
    );
    const here = (passed[passed.length - 1] ?? places[0]).link;
    railLinks.forEach((link) =>
      link === here
        ? link.setAttribute("aria-current", "location")
        : link.removeAttribute("aria-current"),
    );
  };
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(mark);
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  mark();
}
const theses = $<HTMLOListElement>("ol.theses");
if (theses) {
  const items = [...theses.children].filter(
    (c): c is HTMLLIElement => c instanceof HTMLLIElement,
  );
  const track = (): void => {
    const box = theses.getBoundingClientRect();
    const middle = innerHeight / 2;
    // Layout offsets ignore the reveal transform, so progress stays monotonic while theses enter.
    const tops = items.map((item) => box.top + item.offsetTop);
    const last = items[items.length - 1];
    const end = box.top + last.offsetTop + last.offsetHeight;
    const progress = Math.min(
      1,
      Math.max(0, (middle - tops[0]) / (end - tops[0])),
    );
    theses.dataset.thesisProgress = progress.toFixed(2);
    theses.style.setProperty("--thesis-progress", progress.toFixed(4));
    let current = 0;
    tops.forEach((top, index) => {
      if (top <= middle) current = index;
    });
    items.forEach((item, index) => {
      if (index === current) item.dataset.current = "true";
      else item.removeAttribute("data-current");
    });
  };
  addEventListener("scroll", track, { passive: true });
  addEventListener("resize", track);
  track();
}
$$<HTMLButtonElement>("[data-open-dialog]").forEach((button) =>
  button.addEventListener("click", () => {
    const dialog = $<HTMLDialogElement>("#" + button.dataset.openDialog);
    if (dialog) openDialog(dialog, button);
  }),
);
const consoleStatus = $('[role="status"][aria-label="Console status"]');
function liveFor(form?: HTMLFormElement): HTMLElement | null {
  return form?.dataset.mode === "application"
    ? $('[role="status"][aria-label="Application status"]')
    : form?.dataset.mode === "resend"
      ? $('[role="status"][aria-label="Resend status"]')
      : form?.dataset.mode === "signin"
        ? $('[role="status"][aria-label="Sign-in status"]')
        : form?.dataset.mode === "withdraw-application"
          ? $('[role="status"][aria-label="Application status"]')
          : consoleStatus;
}
interface ErrorResponse {
  message?: string;
  fields?: Record<string, string>;
  content?: { id: string };
  requisition?: { id: string };
  application?: { role?: { title: string } };
  job?: { state: string; attempts: number };
}
async function perform(
  endpoint: string,
  data: Record<string, unknown> | FormData,
  button: HTMLButtonElement,
  form?: HTMLFormElement,
  method = "POST",
  success = "",
): Promise<void> {
  if (button.disabled) return;
  const live = liveFor(form);
  const mode = form?.dataset.mode;
  const pending =
    mode === "application"
      ? "Sending your application…"
      : mode === "resend"
        ? "Sending…"
        : mode === "signin"
          ? "Signing in…"
          : mode === "withdraw-application"
            ? "Withdrawing…"
            : "Saving…";
  if (live) live.textContent = pending;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (form)
    $$<HTMLElement>("[data-error]", form).forEach((e) => (e.textContent = ""));
  try {
    const headers: Record<string, string> = {};
    if (!(data instanceof FormData))
      headers["Content-Type"] = "application/json";
    const record = $<HTMLElement>("[data-record-version]");
    const version = button.dataset.version || record?.dataset.recordVersion;
    if (version) headers["If-Match"] = `"${version}"`;
    if (
      mode === "application" ||
      (endpoint.startsWith("/api/console/") &&
        endpoint !== "/api/console/session")
    )
      headers["Idempotency-Key"] = crypto.randomUUID();
    const request = (): Promise<Response> =>
      fetch(endpoint, {
        method,
        headers,
        body: data instanceof FormData ? data : JSON.stringify(data),
      });
    // One automatic retry after a dropped connection reuses the same key.
    const response = await request().catch((error: unknown) => {
      if (error instanceof TypeError) return request();
      throw error;
    });
    const body =
      response.status === 204 ? {} : ((await response.json()) as ErrorResponse);
    const etag = response.headers.get("ETag");
    if (etag && record) record.dataset.recordVersion = etag.replaceAll('"', "");
    if (!response.ok) {
      if (live)
        live.textContent =
          mode === "application" && response.status === 422
            ? "Please fix the highlighted fields."
            : body.message || "We could not complete that request.";
      if (body.fields && form) {
        for (const [key, message] of Object.entries(body.fields)) {
          const output = $<HTMLElement>(
            `[data-error="${CSS.escape(key)}"]`,
            form,
          );
          if (output) output.textContent = message;
          const field = form.elements.namedItem(key);
          if (field instanceof HTMLElement) {
            field.setAttribute("aria-invalid", "true");
            if (output) {
              output.id = output.id || `error-${key}`;
              field.setAttribute("aria-describedby", output.id);
            }
          }
        }
        const first = form.elements.namedItem(Object.keys(body.fields)[0]);
        if (first instanceof HTMLElement) first.focus();
      }
      if (response.status === 412 && live) {
        const reload = document.createElement("button");
        reload.type = "button";
        reload.textContent = "Reload";
        reload.addEventListener("click", () => location.reload());
        live.append(document.createTextNode(" "), reload);
      }
      return;
    }
    if (mode === "signin") {
      location.assign("/console");
      return;
    }
    if (mode === "application") {
      if (live)
        live.textContent = `Application received. Your receipt and tracking link are on their way to ${String(data instanceof FormData ? data.get("email") : "")}.`;
      return;
    }
    if (mode === "resend") {
      if (live) live.textContent = body.message || "";
      return;
    }
    if (mode === "withdraw-application") {
      const notice = "Your application has been withdrawn.";
      location.assign(
        location.pathname + "?notice=" + encodeURIComponent(notice),
      );
      return;
    }
    if (mode === "schedule") {
      const release = (data as Record<string, unknown>)
        .release_at_local as string;
      success = `Release scheduled for ${time(londonInstant(release, false), "Europe/London")} London.`;
    }
    if (button.dataset.inline !== undefined) {
      // The row already shows this record; update it where it stands.
      const row = button.closest("tr");
      const cell = (label: string): Element | null | undefined =>
        row?.querySelector(`[data-label="${label}"]`);
      const state = cell("State"),
        attempts = cell("Attempts");
      if (state && body.job) state.textContent = body.job.state;
      if (attempts && body.job)
        attempts.textContent = String(body.job.attempts);
      button.replaceWith("—");
      if (live) live.textContent = success;
      return;
    }
    let next = location.pathname;
    if (mode === "content" && body.content?.id)
      next = "/console/content/" + body.content.id;
    if (mode === "requisition" && body.requisition?.id)
      next = "/console/requisitions/" + body.requisition.id;
    location.assign(
      next + "?notice=" + encodeURIComponent(success || "Draft saved."),
    );
  } catch (error) {
    if (live)
      live.textContent =
        error instanceof SyntaxError
          ? "We could not complete that request."
          : "We couldn't reach Aldermoor. Check your connection and try again.";
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}
$$<HTMLFormElement>("form[data-endpoint]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = $<HTMLButtonElement>("button[type=submit]", form);
    if (!button) return;
    const fd = new FormData(form);
    const data: Record<string, unknown> = {};
    for (const [key, value] of fd)
      if (typeof value === "string") data[key] = value;
    if (form.dataset.mode === "content") {
      if (data.kind === "model") {
        try {
          const claims: unknown = JSON.parse(String(data.claims));
          if (!Array.isArray(claims))
            throw new Error("Claims must be an array");
          data.claims = claims;
        } catch {
          const live = liveFor(form);
          if (live)
            live.textContent =
              "Each claim needs an id, text, benchmark, evaluation date, comparator and stated difference.";
          return;
        }
      } else
        data.tags = String(data.tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      // An item's kind is fixed once created; editing sends only its editable fields.
      if (form.dataset.method === "PATCH") delete data.kind;
    }
    if (form.dataset.mode === "requisition")
      data.recruiters = String(data.recruiters || "")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    if (form.dataset.mode === "grant") {
      try {
        data.expires_at = londonInstant(String(data.expires_at));
      } catch {
        const live = liveFor(form);
        if (live) live.textContent = "Choose an expiry in the future.";
        return;
      }
    }
    void perform(
      form.dataset.endpoint!,
      form.dataset.mode === "application" ? fd : data,
      button,
      form,
      form.dataset.method || "POST",
      form.dataset.success || "",
    );
  });
});
$$<HTMLButtonElement>("[data-action]").forEach((button) =>
  button.addEventListener("click", () => {
    let data: Record<string, unknown> = {};
    if (button.dataset.body)
      data = JSON.parse(button.dataset.body) as Record<string, unknown>;
    void perform(
      button.dataset.action!,
      data,
      button,
      undefined,
      "POST",
      button.dataset.success || "",
    );
  }),
);
$<HTMLButtonElement>("[data-signout]")?.addEventListener("click", async () => {
  await fetch("/api/console/session", { method: "DELETE" });
  location.assign("/console/sign-in");
});
const serviceStatus = $('[role="status"][aria-label="Service status"]');
if (serviceStatus) {
  const check = async (): Promise<void> => {
    try {
      const response = await fetch("/api/ready");
      const ready = (await response.json()) as {
        dependencies: { storage: string; mail: string };
      };
      serviceStatus.textContent = [
        ready.dependencies.mail === "down"
          ? "Mail delivery is delayed. Messages are queued and will be sent when mail returns."
          : "",
        ready.dependencies.storage === "down"
          ? "File storage is unreachable. Applications, résumé downloads and samples are paused."
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    } catch {
      serviceStatus.textContent =
        "We couldn't reach Aldermoor. Check your connection and try again.";
    }
  };
  void check();
  setInterval(() => void check(), 15000);
}
$<HTMLButtonElement>("[data-verify-chain]")?.addEventListener(
  "click",
  async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!consoleStatus || button.disabled) return;
    consoleStatus.textContent = "Saving…";
    button.disabled = true;
    try {
      const response = await fetch("/api/console/audit/verify");
      const body = (await response.json()) as {
        valid?: boolean;
        entries?: number;
        first_invalid_seq?: number;
        message?: string;
      };
      consoleStatus.textContent = !response.ok
        ? body.message || ""
        : body.valid
          ? `Audit chain verified: ${body.entries} entries.`
          : `Audit chain broken at entry ${body.first_invalid_seq}.`;
    } catch {
      consoleStatus.textContent =
        "We couldn't reach Aldermoor. Check your connection and try again.";
    } finally {
      button.disabled = false;
    }
  },
);
const searchForm = $<HTMLFormElement>("form[data-search]");
if (searchForm) {
  const box = $<HTMLInputElement>('input[name="q"]', searchForm)!;
  const searchStatus = $('[role="status"][aria-label="Search status"]');
  searchForm.addEventListener("submit", () => {
    if (searchStatus) searchStatus.textContent = "Searching…";
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (
      event.key !== "/" ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      (target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
    )
      return;
    event.preventDefault();
    box.focus();
  });
}
$<HTMLFormElement>("[data-role-filters]")?.addEventListener(
  "change",
  (event) => {
    if (event.currentTarget instanceof HTMLFormElement)
      event.currentTarget.requestSubmit();
  },
);
$$<HTMLInputElement>('[name="release_at_local"]').forEach((input) =>
  input.addEventListener("input", () => {
    const preview = $<HTMLElement>(
      "[data-schedule-preview]",
      input.closest("form")!,
    );
    if (!preview) return;
    try {
      preview.textContent = `${time(londonInstant(input.value, false))} your time`;
    } catch {
      preview.textContent = "";
    }
  }),
);
$$<HTMLButtonElement>("[data-play]").forEach((button) =>
  button.addEventListener("click", () => {
    const audio = $<HTMLAudioElement>(
      `audio[data-audio="${button.dataset.play}"]`,
    );
    $$<HTMLAudioElement>("audio").forEach((other) => {
      if (other !== audio) other.pause();
    });
    if (audio)
      void audio.play().catch(() => {
        const region = $('[aria-label="Samples"]');
        if (region) {
          const notice = document.createElement("p");
          notice.className = "notice";
          notice.textContent =
            "Samples are unavailable right now. The recorded benchmarks above are unaffected.";
          region.append(notice);
        }
      });
  }),
);
$$<HTMLButtonElement>("[data-pause]").forEach((button) =>
  button.addEventListener("click", () =>
    $<HTMLAudioElement>(`audio[data-audio="${button.dataset.pause}"]`)?.pause(),
  ),
);
$$<HTMLElement>("[data-sequence]").forEach((sequence) => {
  const urls = JSON.parse(sequence.dataset.sequence!) as string[];
  let index = 0;
  const step = (delta: number): void => {
    index = (index + delta + urls.length) % urls.length;
    const img = $<HTMLImageElement>("img", sequence);
    if (img) {
      img.src = urls[index];
      img.alt = `Denoising sequence, frame ${index + 1}`;
    }
    const live = $<HTMLElement>('[aria-label="Frame position"]', sequence);
    if (live) live.textContent = `Frame ${index + 1} of ${urls.length}`;
  };
  $$<HTMLButtonElement>("[data-frame]", sequence).forEach((button) =>
    button.addEventListener("click", () =>
      step(button.dataset.frame === "next" ? 1 : -1),
    ),
  );
  $<HTMLElement>(".frame-view", sequence)?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        step(event.key === "ArrowRight" ? 1 : -1);
      }
    },
  );
});
const figure = $<HTMLElement>("figure[data-entered]");
const bars = figure ? $$<HTMLElement>("[data-row-id] .bar", figure) : [];
function completeEntry(): void {
  if (!figure || figure.dataset.entered === "true") return;
  const running = bars.flatMap((bar) => bar.getAnimations());
  if (running.length) running.forEach((a) => a.finish());
  else figure.dataset.entered = "true";
}
if (figure) {
  if (reduce.matches) figure.dataset.entered = "true";
  else {
    const entry = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        entry.disconnect();
        const growth = bars.map((bar, index) =>
          bar.animate(
            [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
            {
              duration: 500,
              delay: index * 60,
              easing: ease,
              fill: "backwards",
            },
          ),
        );
        void Promise.allSettled(growth.map((a) => a.finished)).then(
          () => (figure.dataset.entered = "true"),
        );
      },
      { rootMargin: "0px 0px 10% 0px" },
    );
    entry.observe(figure);
    figure.addEventListener("pointerdown", completeEntry);
    figure.addEventListener("focusin", completeEntry);
  }
}
const thumbnails = $$<HTMLElement>(".audio-sample, .frame-view");
if (thumbnails.length && !reduce.matches) {
  const fade = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      fade.disconnect();
      thumbnails.forEach((thumbnail, index) =>
        thumbnail.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 300,
          delay: index * 40,
          easing: ease,
          fill: "backwards",
        }),
      );
    },
    { threshold: 0.05 },
  );
  fade.observe(thumbnails[0].closest("section") || thumbnails[0]);
}
// Continuity is for opening an item from its list and going back; other navigations swap plainly.
interface PageSwap extends Event {
  viewTransition: { skipTransition(): void } | null;
  activation: { entry: { url: string } } | null;
}
const listOrDetail = (path: string): string[] | null => {
  const match = /^\/(models|news)(\/[^/]+)?$/.exec(path);
  return match ? [match[1], match[2] ? "detail" : "list"] : null;
};
addEventListener("pageswap", (event) => {
  const swap = event as PageSwap;
  if (!swap.viewTransition) return;
  const from = listOrDetail(location.pathname);
  const to = swap.activation
    ? listOrDetail(new URL(swap.activation.entry.url).pathname)
    : null;
  if (!from || !to || from[0] !== to[0] || from[1] === to[1])
    swap.viewTransition.skipTransition();
});
function initTether(): void {
  const route = $<HTMLElement>("[data-model]");
  if (!route) return;
  const model = JSON.parse(route.dataset.model!) as ModelRoute;
  const chart = $<HTMLElement>(".benchmark-chart", route)!;
  const tokens = getComputedStyle(document.documentElement);
  const lineDuration = parseFloat(tokens.getPropertyValue("--tether-line"));
  const fadeDuration = parseFloat(tokens.getPropertyValue("--tether-fade"));
  const line = $<SVGPathElement>(".tether-svg path", route)!;
  const bracket = $<HTMLElement>(".tether-bracket", route)!;
  const delta = $<HTMLElement>("[data-tether-delta]", route)!;
  const deltaLine = delta.closest<HTMLElement>(".delta-line")!;
  const live = $<HTMLElement>('[aria-label="Claim tether"]', route)!;
  const markers = $$<HTMLButtonElement>("[data-claim]", route);
  const rows = $$<HTMLElement>("[data-row-id]", route);
  let reversing = false;
  let pointer = { x: 0, y: 0 };
  let current: PublicClaim | null = null,
    pinned = false,
    serial = 0;
  let timers: number[] = [];
  let counter: number | undefined;
  const clear = (): void => {
    timers.forEach(clearTimeout);
    timers = [];
    if (counter) clearInterval(counter);
    counter = undefined;
    line.getAnimations().forEach((a) => a.cancel());
    delta.getAnimations().forEach((a) => a.cancel());
  };
  const later = (fn: () => void, ms: number): void => {
    timers.push(window.setTimeout(fn, ms));
  };
  const address = (id?: string): void => {
    const url = new URL(location.href);
    if (id) url.searchParams.set("claim", id);
    else url.searchParams.delete("claim");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  };
  const label = (claim: PublicClaim): string => {
    const mine = model.rows.find((r) => r.id === claim.model_row_id)!,
      other = model.rows.find((r) => r.id === claim.comparator_row_id)!;
    const evaluated = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(claim.eval_date));
    return `Claim ${claim.number}: ${claim.benchmark}, ${model.title} ${mine.score} versus ${other.subject_name} ${other.score}, evaluated ${evaluated}.`;
  };
  const geometry = (claim: PublicClaim): void => {
    const marker = markers.find((m) => m.dataset.claim === claim.id)!;
    const cited = rows.filter((r) =>
      [claim.model_row_id, claim.comparator_row_id].includes(r.dataset.rowId!),
    );
    const origin = route.getBoundingClientRect(),
      start = marker.getBoundingClientRect(),
      end = cited[0].getBoundingClientRect();
    // The leader leaves the marker's drawn square to the right, runs down the empty columns beside
    // the prose to the clear band above the chart, crosses to a spine in the gutter between the bar
    // tracks and the scores, and reaches each cited bar's settled end with a short leg.
    const inset = parseFloat(getComputedStyle(marker, "::before").top);
    const x = start.right - inset - origin.left,
      y = start.top + start.height / 2 - origin.top;
    const prose = marker.closest(".article-prose")!.getBoundingClientRect();
    const gutter = Math.min(prose.right + 24, origin.right - 8) - origin.left;
    const chartBox = chart.getBoundingClientRect();
    const band = chartBox.top - 24 - origin.top;
    const ends = cited
      .map((row) => {
        const bar = $<HTMLElement>(".bar", row)!;
        const box = bar.getBoundingClientRect();
        return {
          x: box.left + bar.offsetWidth - origin.left,
          y: box.top + box.height / 2 - origin.top,
        };
      })
      .sort((a, b) => a.y - b.y);
    const track = $<HTMLElement>(
      ".bar-track",
      cited[0],
    )!.getBoundingClientRect();
    const score = $<HTMLElement>(
      ".bar-score",
      cited[0],
    )!.getBoundingClientRect();
    const spine = (track.right + score.left) / 2 - origin.left;
    line.setAttribute(
      "d",
      `M ${x} ${y} H ${gutter} V ${band} H ${spine} V ${ends[ends.length - 1].y}` +
        ends.map((e) => ` M ${spine} ${e.y} H ${e.x}`).join(""),
    );
    const middle = (ends[0].y + ends[ends.length - 1].y) / 2;
    deltaLine.style.top = `${middle + origin.top - chartBox.top}px`;
    line.setAttribute("pathLength", "1");
    const last = cited[cited.length - 1].getBoundingClientRect();
    bracket.style.top = `${end.top - chartBox.top}px`;
    bracket.style.height = `${last.bottom - end.top}px`;
    bracket.innerHTML = `<span>Claim ${claim.number}</span>`;
  };
  const count = (value: string, reverse = false, instant = false): void => {
    const number = Number(value),
      decimals = value.split(".")[1]?.length || 0;
    const show = (n: number): void => {
      delta.textContent = (number >= 0 ? "+" : "") + n.toFixed(decimals);
    };
    if (instant) {
      delta.textContent = reverse ? "" : value;
      return;
    }
    delta.style.setProperty("--tether-count", String(reverse ? number : 0));
    const animation = delta.animate(
      [
        { "--tether-count": String(reverse ? number : 0) },
        { "--tether-count": String(reverse ? 0 : number) },
      ],
      { duration: lineDuration, easing: "ease-out", fill: "forwards" },
    );
    show(reverse ? number : 0);
    counter = window.setInterval(
      () =>
        show(
          Number(getComputedStyle(delta).getPropertyValue("--tether-count")),
        ),
      25,
    );
    later(() => {
      if (counter) clearInterval(counter);
      counter = undefined;
      delta.textContent = reverse ? "" : value;
      animation.cancel();
    }, lineDuration);
  };
  const reset = (instant = false, keepFocus = false): Promise<void> => {
    if (!current) return Promise.resolve();
    reversing = true;
    const old = current;
    const marker = markers.find((m) => m.dataset.claim === old.id)!;
    const ticket = ++serial;
    clear();
    live.textContent = `Claim ${old.number} released.`;
    pinned = false;
    const finish = (): void => {
      if (ticket !== serial) return;
      delta.textContent = "";
      delta.removeAttribute("href");
      chart.classList.remove("tethered");
      rows.forEach((r) => (r.dataset.cited = "true"));
      line.setAttribute("hidden", "");
      line.removeAttribute("data-tether-line");
      bracket.hidden = true;
      bracket.removeAttribute("data-tether-line");
      marker.setAttribute("aria-pressed", "false");
      address();
      current = null;
      reversing = false;
      if (keepFocus) marker.focus({ preventScroll: true });
    };
    if (instant || reduce.matches) {
      finish();
      return Promise.resolve();
    }
    count(old.delta, true);
    later(() => {
      chart.classList.remove("tethered");
      rows.forEach((r) => (r.dataset.cited = "true"));
    }, lineDuration);
    later(() => {
      if (!matchMedia("(max-width:719px)").matches)
        line.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }], {
          duration: lineDuration,
          easing: "ease-out",
          fill: "forwards",
        });
      else bracket.hidden = true;
    }, lineDuration + fadeDuration);
    return new Promise((resolve) =>
      later(
        () => {
          finish();
          resolve();
        },
        lineDuration * 2 + fadeDuration,
      ),
    );
  };
  const activate = (
    claim: PublicClaim,
    pin: boolean,
    instant = false,
  ): void => {
    clear();
    completeEntry();
    ++serial;
    current = claim;
    reversing = false;
    pinned = pin;
    address(claim.id);
    delta.setAttribute("href", `#row-${claim.model_row_id}`);
    markers.forEach((m) =>
      m.setAttribute("aria-pressed", String(m.dataset.claim === claim.id)),
    );
    const narrow = matchMedia("(max-width:719px)").matches;
    geometry(claim);
    line.toggleAttribute("hidden", narrow);
    line.removeAttribute("data-tether-line");
    bracket.hidden = !narrow;
    bracket.removeAttribute("data-tether-line");
    (narrow ? bracket : line).setAttribute("data-tether-line", claim.id);
    const noMotion = instant || reduce.matches;
    if (!noMotion && !narrow)
      line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: lineDuration,
        easing: "ease-out",
        fill: "forwards",
      });
    rows.forEach((r) => {
      r.dataset.cited = String(
        [claim.model_row_id, claim.comparator_row_id].includes(
          r.dataset.rowId!,
        ),
      );
    });
    chart.classList.add("tethered");
    count(claim.delta, false, noMotion);
    if (noMotion) live.textContent = label(claim);
    else
      later(
        () => (live.textContent = label(claim)),
        lineDuration + fadeDuration,
      );
    if (pin && !instant) {
      const bounds = chart.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > innerHeight)
        chart.scrollIntoView({
          behavior: reduce.matches ? "auto" : "smooth",
          block: "center",
        });
    }
  };
  markers.forEach((marker) => {
    const claim = model.claims.find((c) => c.id === marker.dataset.claim)!;
    marker.addEventListener("click", () => {
      if (current?.id === claim.id) {
        if (pinned) void reset(false, true);
        else pinned = true;
        return;
      }
      if (current) {
        void reset(true).then(() => activate(claim, true));
      } else activate(claim, true);
    });
    marker.addEventListener("pointerenter", (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (event.pointerType === "mouse" && !pinned && !reversing) {
        if (current && current.id !== claim.id)
          void reset(true).then(() => activate(claim, false));
        else if (!current) activate(claim, false);
      }
    });
  });
  document.addEventListener("pointermove", (event) => {
    if (event.clientX === pointer.x && event.clientY === pointer.y) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (current && !pinned && !reversing) {
      const marker = markers.find(
        (item) => item.dataset.claim === current!.id,
      )!;
      if (event.target instanceof Node && !marker.contains(event.target))
        void reset();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && current) {
      event.preventDefault();
      void reset(false, true);
    }
  });
  const updateGeometry = (): void => {
    if (!current) return;
    geometry(current);
    const narrow = matchMedia("(max-width:719px)").matches;
    line.toggleAttribute("hidden", narrow);
    bracket.hidden = !narrow;
    line.removeAttribute("data-tether-line");
    bracket.removeAttribute("data-tether-line");
    (narrow ? bracket : line).setAttribute("data-tether-line", current.id);
  };
  window.addEventListener("resize", updateGeometry);
  route.addEventListener("animationend", updateGeometry);
  void document.fonts.ready.then(updateGeometry);
  reduce.addEventListener("change", () => {
    if (current && reduce.matches) activate(current, pinned, true);
  });
  const requested = new URLSearchParams(location.search).get("claim");
  const claim = model.claims.find((c) => c.id === requested);
  if (claim) activate(claim, true, true);
}
initTether();
