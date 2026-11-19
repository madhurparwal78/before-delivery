// src/dialog.ts
function openDialog(dialog, opener) {
  dialog.showModal();
  let open = true;
  const focusable = () => [
    ...dialog.querySelectorAll(
      'button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]'
    )
  ].filter((el) => !el.hidden);
  const items = focusable();
  (items.find((el) => el.hasAttribute("autofocus")) || items[0] || dialog).focus();
  const cancelButtons = [
    ...dialog.querySelectorAll("[data-close-dialog]")
  ];
  const finish = () => {
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    cancelButtons.forEach(
      (button) => button.removeEventListener("click", onCloseClick)
    );
    dialog.close();
    if (opener.isConnected) opener.focus();
  };
  const close = () => {
    if (!open) return;
    open = false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const duration = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--disclosure"
      )
    );
    void dialog.animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(6px)" }
      ],
      { duration, easing: "ease-out" }
    ).finished.then(finish, finish);
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const list = focusable();
      if (!list.length) {
        event.preventDefault();
        return;
      }
      const edge = event.shiftKey ? list[0] : list[list.length - 1];
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? list[list.length - 1] : list[0]).focus();
      }
    }
  };
  const onCancel = (event) => {
    event.preventDefault();
    close();
  };
  const onCloseClick = (event) => {
    event.preventDefault();
    close();
  };
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  cancelButtons.forEach(
    (button) => button.addEventListener("click", onCloseClick)
  );
}

// src/errors.ts
var ApiError = class extends Error {
  constructor(status, error, message, fields, headers) {
    super(message);
    this.status = status;
    this.error = error;
    this.fields = fields;
    this.headers = headers;
  }
  toJSON() {
    return {
      error: this.error,
      message: this.message,
      ...this.fields ? { fields: this.fields } : {}
    };
  }
};
function fail(status, error, message, fields, headers) {
  throw new ApiError(status, error, message, fields, headers);
}
function validation(fields) {
  return fail(
    422,
    "validation_failed",
    "Please fix the highlighted fields.",
    fields
  );
}

// src/domain.ts
function londonInstant(local, future = true) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(local))
    validation({ release_at_local: "Use the form YYYY-MM-DDTHH:mm." });
  const complete = local.length === 16 ? local + ":00" : local;
  const naive = Date.parse(complete + "Z");
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 19) !== complete)
    validation({ release_at_local: "Use the form YYYY-MM-DDTHH:mm." });
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const candidates = [naive - 36e5, naive].filter(
    (t) => Number.isFinite(t) && fmt.format(new Date(t)).replace(" ", "T") === complete
  );
  if (!candidates.length)
    validation({
      release_at_local: "That time does not exist in London because the clocks go forward."
    });
  const instant = Math.min(...candidates);
  if (future && instant <= Date.now())
    validation({ release_at_local: "Choose a time in the future." });
  return new Date(instant).toISOString().replace(".000Z", "Z");
}

// src/browser.ts
document.documentElement.classList.add("enhanced");
var reduce = matchMedia("(prefers-reduced-motion: reduce)");
var $ = (selector, root = document) => root.querySelector(selector);
var $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
function time(value, zone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value)).replace(" at", ",");
}
$$("[data-publication]").forEach((el) => {
  const value = el.dataset.publication;
  const part = (text) => {
    const span = document.createElement("span");
    span.className = "nowrap";
    span.textContent = text;
    return span;
  };
  el.replaceChildren(
    "Published ",
    part(`${time(value)} your time`),
    " ",
    part(`(${time(value, "Europe/London")} London)`)
  );
});
var models = $("[data-models]");
var modelMenu = $(".models-menu");
var modelList = $("[data-models-list]");
var mobile = $("[data-menu]");
var primary = $(".primary");
function hideDisclosure(element, hide) {
  element.inert = true;
  element.setAttribute("aria-hidden", "true");
  const finished = () => {
    hide();
    element.inert = false;
    element.removeAttribute("aria-hidden");
  };
  if (reduce.matches) {
    finished();
    return;
  }
  const duration = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--disclosure")
  );
  void element.animate(
    [
      { opacity: 1, transform: "translateY(0)" },
      { opacity: 0, transform: "translateY(6px)" }
    ],
    { duration, easing: "ease-out" }
  ).finished.then(finished, () => {
  });
}
function closePrimary(returnFocus = true) {
  mobile?.setAttribute("aria-expanded", "false");
  if (primary) hideDisclosure(primary, () => primary.classList.remove("open"));
  if (returnFocus) mobile?.focus();
}
function closeMenus(returnFocus = true) {
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
  if (event.target instanceof Node && !$(".models-disclosure")?.contains(event.target) && models?.getAttribute("aria-expanded") === "true")
    closeMenus(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenus();
});
var ease = "cubic-bezier(0.2, 0.65, 0.3, 1)";
var revealDuration = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--reveal")
);
var reveals = $$("[data-reveal]");
if (reduce.matches) reveals.forEach((el) => el.dataset.reveal = "done");
else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || !(entry.target instanceof HTMLElement))
          return;
        const section = entry.target;
        observer.unobserve(section);
        void section.animate(
          [
            { opacity: 0, transform: "translateY(12px)" },
            { opacity: 1, transform: "none" }
          ],
          { duration: revealDuration, easing: ease }
        ).finished.then(
          () => section.dataset.reveal = "done",
          () => section.dataset.reveal = "done"
        );
      });
    },
    // Sections stay visible until they are about to enter, then fade up as they arrive.
    { rootMargin: "0px 0px 15% 0px" }
  );
  reveals.forEach((el) => observer.observe(el));
  document.addEventListener(
    "pointerdown",
    (event) => {
      const section = event.target instanceof Element ? event.target.closest('[data-reveal="pending"]') : null;
      section?.getAnimations().forEach((a) => a.finish());
    },
    true
  );
  document.addEventListener("focusin", (event) => {
    const section = event.target instanceof Element ? event.target.closest('[data-reveal="pending"]') : null;
    if (!section) return;
    const running = section.getAnimations();
    if (running.length) running.forEach((a) => a.finish());
    else {
      observer.unobserve(section);
      section.dataset.reveal = "done";
    }
  });
}
var railLinks = $$('nav[aria-label="Sections"] a');
if (railLinks.length) {
  const places = railLinks.flatMap((link) => {
    const target = document.getElementById(link.hash.slice(1));
    return target ? [{ section: target.closest("section") ?? target, link }] : [];
  });
  let frame = 0;
  const mark = () => {
    frame = 0;
    const line = innerHeight * 0.3;
    const passed = places.filter(
      (p) => p.section.getBoundingClientRect().top <= line
    );
    const here = (passed[passed.length - 1] ?? places[0]).link;
    railLinks.forEach(
      (link) => link === here ? link.setAttribute("aria-current", "location") : link.removeAttribute("aria-current")
    );
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(mark);
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  mark();
}
var theses = $("ol.theses");
if (theses) {
  const items = [...theses.children].filter(
    (c) => c instanceof HTMLLIElement
  );
  const track = () => {
    const box = theses.getBoundingClientRect();
    const middle = innerHeight / 2;
    const tops = items.map((item) => box.top + item.offsetTop);
    const last = items[items.length - 1];
    const end = box.top + last.offsetTop + last.offsetHeight;
    const progress = Math.min(
      1,
      Math.max(0, (middle - tops[0]) / (end - tops[0]))
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
$$("[data-open-dialog]").forEach(
  (button) => button.addEventListener("click", () => {
    const dialog = $("#" + button.dataset.openDialog);
    if (dialog) openDialog(dialog, button);
  })
);
var consoleStatus = $('[role="status"][aria-label="Console status"]');
function liveFor(form) {
  return form?.dataset.mode === "application" ? $('[role="status"][aria-label="Application status"]') : form?.dataset.mode === "resend" ? $('[role="status"][aria-label="Resend status"]') : form?.dataset.mode === "signin" ? $('[role="status"][aria-label="Sign-in status"]') : form?.dataset.mode === "withdraw-application" ? $('[role="status"][aria-label="Application status"]') : consoleStatus;
}
async function perform(endpoint, data, button, form, method = "POST", success = "") {
  if (button.disabled) return;
  const live = liveFor(form);
  const mode = form?.dataset.mode;
  const pending = mode === "application" ? "Sending your application\u2026" : mode === "resend" ? "Sending\u2026" : mode === "signin" ? "Signing in\u2026" : mode === "withdraw-application" ? "Withdrawing\u2026" : "Saving\u2026";
  if (live) live.textContent = pending;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (form)
    $$("[data-error]", form).forEach((e) => e.textContent = "");
  try {
    const headers = {};
    if (!(data instanceof FormData))
      headers["Content-Type"] = "application/json";
    const record = $("[data-record-version]");
    const version = button.dataset.version || record?.dataset.recordVersion;
    if (version) headers["If-Match"] = `"${version}"`;
    if (mode === "application" || endpoint.startsWith("/api/console/") && endpoint !== "/api/console/session")
      headers["Idempotency-Key"] = crypto.randomUUID();
    const request = () => fetch(endpoint, {
      method,
      headers,
      body: data instanceof FormData ? data : JSON.stringify(data)
    });
    const response = await request().catch((error) => {
      if (error instanceof TypeError) return request();
      throw error;
    });
    const body = response.status === 204 ? {} : await response.json();
    const etag = response.headers.get("ETag");
    if (etag && record) record.dataset.recordVersion = etag.replaceAll('"', "");
    if (!response.ok) {
      if (live)
        live.textContent = mode === "application" && response.status === 422 ? "Please fix the highlighted fields." : body.message || "We could not complete that request.";
      if (body.fields && form) {
        for (const [key, message] of Object.entries(body.fields)) {
          const output = $(
            `[data-error="${CSS.escape(key)}"]`,
            form
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
        location.pathname + "?notice=" + encodeURIComponent(notice)
      );
      return;
    }
    if (mode === "schedule") {
      const release = data.release_at_local;
      success = `Release scheduled for ${time(londonInstant(release, false), "Europe/London")} London.`;
    }
    if (button.dataset.inline !== void 0) {
      const row = button.closest("tr");
      const cell = (label) => row?.querySelector(`[data-label="${label}"]`);
      const state = cell("State"), attempts = cell("Attempts");
      if (state && body.job) state.textContent = body.job.state;
      if (attempts && body.job)
        attempts.textContent = String(body.job.attempts);
      button.replaceWith("\u2014");
      if (live) live.textContent = success;
      return;
    }
    let next = location.pathname;
    if (mode === "content" && body.content?.id)
      next = "/console/content/" + body.content.id;
    if (mode === "requisition" && body.requisition?.id)
      next = "/console/requisitions/" + body.requisition.id;
    location.assign(
      next + "?notice=" + encodeURIComponent(success || "Draft saved.")
    );
  } catch (error) {
    if (live)
      live.textContent = error instanceof SyntaxError ? "We could not complete that request." : "We couldn't reach Aldermoor. Check your connection and try again.";
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}
$$("form[data-endpoint]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = $("button[type=submit]", form);
    if (!button) return;
    const fd = new FormData(form);
    const data = {};
    for (const [key, value] of fd)
      if (typeof value === "string") data[key] = value;
    if (form.dataset.mode === "content") {
      if (data.kind === "model") {
        try {
          const claims = JSON.parse(String(data.claims));
          if (!Array.isArray(claims))
            throw new Error("Claims must be an array");
          data.claims = claims;
        } catch {
          const live = liveFor(form);
          if (live)
            live.textContent = "Each claim needs an id, text, benchmark, evaluation date, comparator and stated difference.";
          return;
        }
      } else
        data.tags = String(data.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      if (form.dataset.method === "PATCH") delete data.kind;
    }
    if (form.dataset.mode === "requisition")
      data.recruiters = String(data.recruiters || "").split(",").map((e) => e.trim()).filter(Boolean);
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
      form.dataset.endpoint,
      form.dataset.mode === "application" ? fd : data,
      button,
      form,
      form.dataset.method || "POST",
      form.dataset.success || ""
    );
  });
});
$$("[data-action]").forEach(
  (button) => button.addEventListener("click", () => {
    let data = {};
    if (button.dataset.body)
      data = JSON.parse(button.dataset.body);
    void perform(
      button.dataset.action,
      data,
      button,
      void 0,
      "POST",
      button.dataset.success || ""
    );
  })
);
$("[data-signout]")?.addEventListener("click", async () => {
  await fetch("/api/console/session", { method: "DELETE" });
  location.assign("/console/sign-in");
});
var serviceStatus = $('[role="status"][aria-label="Service status"]');
if (serviceStatus) {
  const check = async () => {
    try {
      const response = await fetch("/api/ready");
      const ready = await response.json();
      serviceStatus.textContent = [
        ready.dependencies.mail === "down" ? "Mail delivery is delayed. Messages are queued and will be sent when mail returns." : "",
        ready.dependencies.storage === "down" ? "File storage is unreachable. Applications, r\xE9sum\xE9 downloads and samples are paused." : ""
      ].filter(Boolean).join(" ");
    } catch {
      serviceStatus.textContent = "We couldn't reach Aldermoor. Check your connection and try again.";
    }
  };
  void check();
  setInterval(() => void check(), 15e3);
}
$("[data-verify-chain]")?.addEventListener(
  "click",
  async (event) => {
    const button = event.currentTarget;
    if (!consoleStatus || button.disabled) return;
    consoleStatus.textContent = "Saving\u2026";
    button.disabled = true;
    try {
      const response = await fetch("/api/console/audit/verify");
      const body = await response.json();
      consoleStatus.textContent = !response.ok ? body.message || "" : body.valid ? `Audit chain verified: ${body.entries} entries.` : `Audit chain broken at entry ${body.first_invalid_seq}.`;
    } catch {
      consoleStatus.textContent = "We couldn't reach Aldermoor. Check your connection and try again.";
    } finally {
      button.disabled = false;
    }
  }
);
var searchForm = $("form[data-search]");
if (searchForm) {
  const box = $('input[name="q"]', searchForm);
  const searchStatus = $('[role="status"][aria-label="Search status"]');
  searchForm.addEventListener("submit", () => {
    if (searchStatus) searchStatus.textContent = "Searching\u2026";
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
      return;
    event.preventDefault();
    box.focus();
  });
}
$("[data-role-filters]")?.addEventListener(
  "change",
  (event) => {
    if (event.currentTarget instanceof HTMLFormElement)
      event.currentTarget.requestSubmit();
  }
);
$$('[name="release_at_local"]').forEach(
  (input) => input.addEventListener("input", () => {
    const preview = $(
      "[data-schedule-preview]",
      input.closest("form")
    );
    if (!preview) return;
    try {
      preview.textContent = `${time(londonInstant(input.value, false))} your time`;
    } catch {
      preview.textContent = "";
    }
  })
);
$$("[data-play]").forEach(
  (button) => button.addEventListener("click", () => {
    const audio = $(
      `audio[data-audio="${button.dataset.play}"]`
    );
    $$("audio").forEach((other) => {
      if (other !== audio) other.pause();
    });
    if (audio)
      void audio.play().catch(() => {
        const region = $('[aria-label="Samples"]');
        if (region) {
          const notice = document.createElement("p");
          notice.className = "notice";
          notice.textContent = "Samples are unavailable right now. The recorded benchmarks above are unaffected.";
          region.append(notice);
        }
      });
  })
);
$$("[data-pause]").forEach(
  (button) => button.addEventListener(
    "click",
    () => $(`audio[data-audio="${button.dataset.pause}"]`)?.pause()
  )
);
$$("[data-sequence]").forEach((sequence) => {
  const urls = JSON.parse(sequence.dataset.sequence);
  let index = 0;
  const step = (delta) => {
    index = (index + delta + urls.length) % urls.length;
    const img = $("img", sequence);
    if (img) {
      img.src = urls[index];
      img.alt = `Denoising sequence, frame ${index + 1}`;
    }
    const live = $('[aria-label="Frame position"]', sequence);
    if (live) live.textContent = `Frame ${index + 1} of ${urls.length}`;
  };
  $$("[data-frame]", sequence).forEach(
    (button) => button.addEventListener(
      "click",
      () => step(button.dataset.frame === "next" ? 1 : -1)
    )
  );
  $(".frame-view", sequence)?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        step(event.key === "ArrowRight" ? 1 : -1);
      }
    }
  );
});
var figure = $("figure[data-entered]");
var bars = figure ? $$("[data-row-id] .bar", figure) : [];
function completeEntry() {
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
        const growth = bars.map(
          (bar, index) => bar.animate(
            [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
            {
              duration: 500,
              delay: index * 60,
              easing: ease,
              fill: "backwards"
            }
          )
        );
        void Promise.allSettled(growth.map((a) => a.finished)).then(
          () => figure.dataset.entered = "true"
        );
      },
      { rootMargin: "0px 0px 10% 0px" }
    );
    entry.observe(figure);
    figure.addEventListener("pointerdown", completeEntry);
    figure.addEventListener("focusin", completeEntry);
  }
}
var thumbnails = $$(".audio-sample, .frame-view");
if (thumbnails.length && !reduce.matches) {
  const fade = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      fade.disconnect();
      thumbnails.forEach(
        (thumbnail, index) => thumbnail.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 300,
          delay: index * 40,
          easing: ease,
          fill: "backwards"
        })
      );
    },
    { threshold: 0.05 }
  );
  fade.observe(thumbnails[0].closest("section") || thumbnails[0]);
}
var listOrDetail = (path) => {
  const match = /^\/(models|news)(\/[^/]+)?$/.exec(path);
  return match ? [match[1], match[2] ? "detail" : "list"] : null;
};
addEventListener("pageswap", (event) => {
  const swap = event;
  if (!swap.viewTransition) return;
  const from = listOrDetail(location.pathname);
  const to = swap.activation ? listOrDetail(new URL(swap.activation.entry.url).pathname) : null;
  if (!from || !to || from[0] !== to[0] || from[1] === to[1])
    swap.viewTransition.skipTransition();
});
function initTether() {
  const route = $("[data-model]");
  if (!route) return;
  const model = JSON.parse(route.dataset.model);
  const chart = $(".benchmark-chart", route);
  const tokens = getComputedStyle(document.documentElement);
  const lineDuration = parseFloat(tokens.getPropertyValue("--tether-line"));
  const fadeDuration = parseFloat(tokens.getPropertyValue("--tether-fade"));
  const line = $(".tether-svg path", route);
  const bracket = $(".tether-bracket", route);
  const delta = $("[data-tether-delta]", route);
  const deltaLine = delta.closest(".delta-line");
  const live = $('[aria-label="Claim tether"]', route);
  const markers = $$("[data-claim]", route);
  const rows = $$("[data-row-id]", route);
  let reversing = false;
  let pointer = { x: 0, y: 0 };
  let current = null, pinned = false, serial = 0;
  let timers = [];
  let counter;
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
    if (counter) clearInterval(counter);
    counter = void 0;
    line.getAnimations().forEach((a) => a.cancel());
    delta.getAnimations().forEach((a) => a.cancel());
  };
  const later = (fn, ms) => {
    timers.push(window.setTimeout(fn, ms));
  };
  const address = (id) => {
    const url = new URL(location.href);
    if (id) url.searchParams.set("claim", id);
    else url.searchParams.delete("claim");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  };
  const label = (claim2) => {
    const mine = model.rows.find((r) => r.id === claim2.model_row_id), other = model.rows.find((r) => r.id === claim2.comparator_row_id);
    const evaluated = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(claim2.eval_date));
    return `Claim ${claim2.number}: ${claim2.benchmark}, ${model.title} ${mine.score} versus ${other.subject_name} ${other.score}, evaluated ${evaluated}.`;
  };
  const geometry = (claim2) => {
    const marker = markers.find((m) => m.dataset.claim === claim2.id);
    const cited = rows.filter(
      (r) => [claim2.model_row_id, claim2.comparator_row_id].includes(r.dataset.rowId)
    );
    const origin = route.getBoundingClientRect(), start = marker.getBoundingClientRect(), end = cited[0].getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(marker, "::before").top);
    const x = start.right - inset - origin.left, y = start.top + start.height / 2 - origin.top;
    const prose = marker.closest(".article-prose").getBoundingClientRect();
    const gutter = Math.min(prose.right + 24, origin.right - 8) - origin.left;
    const chartBox = chart.getBoundingClientRect();
    const band = chartBox.top - 24 - origin.top;
    const ends = cited.map((row) => {
      const bar = $(".bar", row);
      const box = bar.getBoundingClientRect();
      return {
        x: box.left + bar.offsetWidth - origin.left,
        y: box.top + box.height / 2 - origin.top
      };
    }).sort((a, b) => a.y - b.y);
    const track = $(
      ".bar-track",
      cited[0]
    ).getBoundingClientRect();
    const score = $(
      ".bar-score",
      cited[0]
    ).getBoundingClientRect();
    const spine = (track.right + score.left) / 2 - origin.left;
    line.setAttribute(
      "d",
      `M ${x} ${y} H ${gutter} V ${band} H ${spine} V ${ends[ends.length - 1].y}` + ends.map((e) => ` M ${spine} ${e.y} H ${e.x}`).join("")
    );
    const middle = (ends[0].y + ends[ends.length - 1].y) / 2;
    deltaLine.style.top = `${middle + origin.top - chartBox.top}px`;
    line.setAttribute("pathLength", "1");
    const last = cited[cited.length - 1].getBoundingClientRect();
    bracket.style.top = `${end.top - chartBox.top}px`;
    bracket.style.height = `${last.bottom - end.top}px`;
    bracket.innerHTML = `<span>Claim ${claim2.number}</span>`;
  };
  const count = (value, reverse = false, instant = false) => {
    const number = Number(value), decimals = value.split(".")[1]?.length || 0;
    const show = (n) => {
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
        { "--tether-count": String(reverse ? 0 : number) }
      ],
      { duration: lineDuration, easing: "ease-out", fill: "forwards" }
    );
    show(reverse ? number : 0);
    counter = window.setInterval(
      () => show(
        Number(getComputedStyle(delta).getPropertyValue("--tether-count"))
      ),
      25
    );
    later(() => {
      if (counter) clearInterval(counter);
      counter = void 0;
      delta.textContent = reverse ? "" : value;
      animation.cancel();
    }, lineDuration);
  };
  const reset = (instant = false, keepFocus = false) => {
    if (!current) return Promise.resolve();
    reversing = true;
    const old = current;
    const marker = markers.find((m) => m.dataset.claim === old.id);
    const ticket = ++serial;
    clear();
    live.textContent = `Claim ${old.number} released.`;
    pinned = false;
    const finish = () => {
      if (ticket !== serial) return;
      delta.textContent = "";
      delta.removeAttribute("href");
      chart.classList.remove("tethered");
      rows.forEach((r) => r.dataset.cited = "true");
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
      rows.forEach((r) => r.dataset.cited = "true");
    }, lineDuration);
    later(() => {
      if (!matchMedia("(max-width:719px)").matches)
        line.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }], {
          duration: lineDuration,
          easing: "ease-out",
          fill: "forwards"
        });
      else bracket.hidden = true;
    }, lineDuration + fadeDuration);
    return new Promise(
      (resolve) => later(
        () => {
          finish();
          resolve();
        },
        lineDuration * 2 + fadeDuration
      )
    );
  };
  const activate = (claim2, pin, instant = false) => {
    clear();
    completeEntry();
    ++serial;
    current = claim2;
    reversing = false;
    pinned = pin;
    address(claim2.id);
    delta.setAttribute("href", `#row-${claim2.model_row_id}`);
    markers.forEach(
      (m) => m.setAttribute("aria-pressed", String(m.dataset.claim === claim2.id))
    );
    const narrow = matchMedia("(max-width:719px)").matches;
    geometry(claim2);
    line.toggleAttribute("hidden", narrow);
    line.removeAttribute("data-tether-line");
    bracket.hidden = !narrow;
    bracket.removeAttribute("data-tether-line");
    (narrow ? bracket : line).setAttribute("data-tether-line", claim2.id);
    const noMotion = instant || reduce.matches;
    if (!noMotion && !narrow)
      line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: lineDuration,
        easing: "ease-out",
        fill: "forwards"
      });
    rows.forEach((r) => {
      r.dataset.cited = String(
        [claim2.model_row_id, claim2.comparator_row_id].includes(
          r.dataset.rowId
        )
      );
    });
    chart.classList.add("tethered");
    count(claim2.delta, false, noMotion);
    if (noMotion) live.textContent = label(claim2);
    else
      later(
        () => live.textContent = label(claim2),
        lineDuration + fadeDuration
      );
    if (pin && !instant) {
      const bounds = chart.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > innerHeight)
        chart.scrollIntoView({
          behavior: reduce.matches ? "auto" : "smooth",
          block: "center"
        });
    }
  };
  markers.forEach((marker) => {
    const claim2 = model.claims.find((c) => c.id === marker.dataset.claim);
    marker.addEventListener("click", () => {
      if (current?.id === claim2.id) {
        if (pinned) void reset(false, true);
        else pinned = true;
        return;
      }
      if (current) {
        void reset(true).then(() => activate(claim2, true));
      } else activate(claim2, true);
    });
    marker.addEventListener("pointerenter", (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (event.pointerType === "mouse" && !pinned && !reversing) {
        if (current && current.id !== claim2.id)
          void reset(true).then(() => activate(claim2, false));
        else if (!current) activate(claim2, false);
      }
    });
  });
  document.addEventListener("pointermove", (event) => {
    if (event.clientX === pointer.x && event.clientY === pointer.y) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (current && !pinned && !reversing) {
      const marker = markers.find(
        (item) => item.dataset.claim === current.id
      );
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
  const updateGeometry = () => {
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
