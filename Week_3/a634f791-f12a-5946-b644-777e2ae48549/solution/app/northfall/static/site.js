// Public routes: cookie notice, folded navigation, programme chapters, heading arrival,
// the promise-line hold, the story year marker and plates, the enquiry form and the copy buttons. Every page reads without it.
"use strict";

const calm = matchMedia("(prefers-reduced-motion: reduce)");
const DRIVE = { duration: 600, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };
const COOKIE_MARKER = "northfall.cookie-notice";
const COPY_LABEL_MS = 2000;
const root = document.documentElement;

// The reduced-motion preference is followed live: everything under way jumps to its end state.
const motionEnders = new Set();
calm.addEventListener("change", () => {
  if (!calm.matches) return;
  motionEnders.forEach((end) => end());
  document.getAnimations().forEach((animation) => animation.finish());
});

// ---------------------------------------------------------------- room for the header and the notice

// Focus and fragment scrolling keep clear of whatever the header and the open notice measure right now.
function setUpScrollRoom() {
  const header = document.querySelector(".masthead");
  const measure = () => root.style.setProperty("--header-height", `${header.getBoundingClientRect().height}px`);
  new ResizeObserver(measure).observe(header);
  measure();
}

// ---------------------------------------------------------------- cookie notice

function readMarker() {
  try {
    return localStorage.getItem(COOKIE_MARKER);
  } catch {
    return null;
  }
}

function setUpCookieNotice() {
  const notice = document.querySelector(".cookie-notice");
  if (readMarker()) return;
  notice.hidden = false;
  const room = new ResizeObserver(() => {
    root.style.setProperty("--notice-height", `${notice.offsetHeight + parseFloat(getComputedStyle(notice).bottom)}px`);
  });
  room.observe(notice);
  const rise = (from, to) => (calm.matches ? null : notice.animate(
    [{ transform: `translateY(${from})` }, { transform: `translateY(${to})` }], DRIVE));
  const rising = rise("120%", "0");

  const answer = (value) => {
    if (notice.inert) return;
    try {
      localStorage.setItem(COOKIE_MARKER, value);
    } catch {
      // Storage refused: the notice still closes for this page.
    }
    const held = notice.contains(document.activeElement);
    // Gone from the tab order and the accessibility tree from the moment closing starts.
    notice.inert = true;
    notice.setAttribute("aria-hidden", "true");
    room.disconnect();
    root.style.removeProperty("--notice-height");
    if (held) document.getElementById("main").focus({ preventScroll: true });
    rising?.cancel();
    const leaving = rise("0", "120%");
    const hide = () => { notice.hidden = true; };
    if (leaving) leaving.finished.then(hide, hide);
    else hide();
  };
  notice.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cookie-answer]");
    if (button) answer(button.dataset.cookieAnswer);
  });
  notice.addEventListener("keydown", (event) => {
    if (event.key === "Escape") answer("closed");
  });
}

// ---------------------------------------------------------------- folded navigation

function setUpMenu() {
  const button = document.querySelector(".menu-button");
  const navigation = document.getElementById("primary-navigation");
  const narrow = matchMedia("(max-width: 639px)");
  const setOpen = (open) => {
    button.setAttribute("aria-expanded", String(open));
    navigation.classList.toggle("is-open", open);
  };
  button.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") !== "true"));
  document.querySelector(".masthead").addEventListener("keydown", (event) => {
    if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      button.focus();
    }
  });
  narrow.addEventListener("change", () => setOpen(false));
}

// ---------------------------------------------------------------- programme chapters

// The drive curve, cubic-bezier(0.16, 1, 0.3, 1), solved for x by bisection.
function driveCurve(x) {
  const axis = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 20; step += 1) {
    const middle = (low + high) / 2;
    if (axis(middle, 0.16, 0.3) < x) low = middle;
    else high = middle;
  }
  return axis((low + high) / 2, 1, 1);
}

// A panel grows or shrinks from the height it has to its new one on the drive timing, frame by frame,
// so the chapters below are pushed down and never overlapped. `land` runs on the last frame.
const panelMotions = new Map();

function endPanelMotion(panel) {
  const motion = panelMotions.get(panel);
  if (!motion) return;
  cancelAnimationFrame(motion.frame);
  panelMotions.delete(panel);
  motionEnders.delete(motion.end);
}

function movePanel(panel, from, to, land) {
  endPanelMotion(panel);
  const finish = () => {
    endPanelMotion(panel);
    panel.style.height = "";
    panel.style.overflow = "";
    land();
  };
  if (calm.matches || from === to) {
    finish();
    return;
  }
  let start;
  const motion = { end: finish };
  const step = (time) => {
    start ??= time;
    const progress = Math.min((time - start) / DRIVE.duration, 1);
    if (progress === 1) {
      finish();
      return;
    }
    panel.style.height = `${from + (to - from) * driveCurve(progress)}px`;
    motion.frame = requestAnimationFrame(step);
  };
  panel.style.overflow = "hidden";
  panel.style.height = `${from}px`;
  panelMotions.set(panel, motion);
  motionEnders.add(finish);
  motion.frame = requestAnimationFrame(step);
}

function setChapterOpen(toggle, open) {
  const panel = document.getElementById(toggle.getAttribute("aria-controls"));
  toggle.setAttribute("aria-expanded", String(open));
  const from = panel.hidden ? 0 : panel.getBoundingClientRect().height;
  if (open) {
    panel.hidden = false;
    panel.inert = false;
    panel.removeAttribute("aria-hidden");
    panel.style.height = "";
    movePanel(panel, from, panel.scrollHeight, () => {});
  } else {
    // Out of the tab order and the accessibility tree from the moment closing starts.
    panel.inert = true;
    panel.setAttribute("aria-hidden", "true");
    movePanel(panel, from, 0, () => { panel.hidden = true; });
  }
}

function setUpChapters() {
  const toggles = [...document.querySelectorAll(".chapter-toggle")];
  if (!toggles.length) return;
  const languageSwitch = document.querySelector(".language-switch");
  const switchBase = languageSwitch.getAttribute("href");

  // With script running the first chapter starts open and the rest closed.
  toggles.slice(1).forEach((toggle) => {
    const panel = document.getElementById(toggle.getAttribute("aria-controls"));
    toggle.setAttribute("aria-expanded", "false");
    panel.hidden = true;
    panel.inert = true;
    panel.setAttribute("aria-hidden", "true");
  });
  document.querySelector(".chapters").classList.add("is-ready");

  const chapters = toggles.map((toggle) => toggle.closest(".chapter"));
  const chapterOfAddress = () => chapters.find((chapter) => `#${chapter.id}` === location.hash);
  const followAddress = (focus) => {
    languageSwitch.setAttribute("href", switchBase + location.hash);
    const chapter = chapterOfAddress();
    if (!chapter) return;
    const toggle = chapter.querySelector(".chapter-toggle");
    if (toggle.getAttribute("aria-expanded") !== "true") setChapterOpen(toggle, true);
    if (focus) toggle.focus({ preventScroll: true });
    chapter.scrollIntoView({ block: "start", behavior: "instant" });
  };

  toggles.forEach((toggle) => {
    toggle.addEventListener("click", () => setChapterOpen(toggle, toggle.getAttribute("aria-expanded") !== "true"));
  });

  let focusFollows = false;
  document.querySelector(".quick-nav").addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    if (link.hash === location.hash) {
      event.preventDefault();
      followAddress(true);
    } else {
      focusFollows = true;
    }
  });
  window.addEventListener("hashchange", () => {
    followAddress(focusFollows);
    focusFollows = false;
  });
  followAddress(false);
  window.addEventListener("load", () => followAddress(false), { once: true });
}

// ---------------------------------------------------------------- heading arrival, one line at a time

function arrive(heading) {
  const text = heading.textContent.trim();
  const words = text.split(/\s+/);
  heading.textContent = "";
  const spans = words.map((word, index) => {
    const span = document.createElement("span");
    span.textContent = word;
    heading.append(span, index < words.length - 1 ? " " : "");
    return span;
  });
  const lines = [];
  let top = null;
  for (const span of spans) {
    if (span.offsetTop !== top) {
      lines.push([]);
      top = span.offsetTop;
    }
    lines.at(-1).push(span.textContent);
  }
  heading.textContent = "";
  const animations = lines.map((line, index) => {
    const mask = document.createElement("span");
    const inner = document.createElement("span");
    mask.className = "line-mask";
    inner.textContent = line.join(" ") + (index < lines.length - 1 ? " " : "");
    mask.append(inner);
    heading.append(mask);
    return inner.animate([{ transform: "translateY(110%)" }, { transform: "translateY(0)" }],
      { ...DRIVE, delay: index * 100, fill: "backwards" });
  });
  const settle = () => { heading.textContent = text; };
  Promise.all(animations.map((animation) => animation.finished)).then(settle, settle);
}

function setUpArrivals() {
  if (!calm.matches) document.querySelectorAll("[data-arrive]").forEach(arrive);
}

// ---------------------------------------------------------------- promise-line hold

// Over the first screen of scroll the promise line travels a quarter as far as the featured strip:
// it is pushed down by three quarters of the scroll, at every width. The room it travels into is reserved beneath it,
// so when the layout is stacked the strip rises to just below the line and never meets it. The offset is read every
// frame, so the line never shows the position of a frame already scrolled past, scrolling back retraces it exactly,
// and the preference applies at once. A keyboard stop inside the line sits in its own place in the flow.
const rowMargin = 48;

function setUpPromiseHold() {
  const hero = document.querySelector(".hero");
  if (!hero) return;
  const copy = hero.querySelector(".hero-copy");
  const strip = hero.querySelector(".featured");
  let shownShift = 0;
  let shownRoom = 0;
  let shownGap = 0;
  const place = () => {
    const copyBox = copy.getBoundingClientRect();
    const held = copyBox.top - shownShift;
    const tallestRow = Math.max(...[...strip.querySelectorAll("li")].map((row) => row.offsetHeight));
    const sheetEnd = held + scrollY + copyBox.height;
    const gap = calm.matches ? 0 : Math.ceil(Math.max(0, 3 * (tallestRow + rowMargin + sheetEnd - innerHeight)));
    if (gap !== shownGap) {
      strip.style.marginTop = gap ? `${gap}px` : "";
      shownGap = gap;
    }
    const stripEnd = strip.getBoundingClientRect().bottom;
    const travel = calm.matches ? 0 : Math.ceil(Math.max(innerHeight * 0.75, stripEnd - held));
    const room = calm.matches ? 0 : Math.ceil(held + travel + copyBox.height - stripEnd);
    const shift = hero.querySelector(":focus-visible") ? 0 : Math.min(Math.max(scrollY, 0) * 0.75, travel);
    if (room !== shownRoom) {
      strip.style.marginBottom = room ? `${room}px` : "";
      hero.style.setProperty("--hold-room", `${room}px`);
      hero.toggleAttribute("data-hold-room", room > 0);
      shownRoom = room;
    }
    if (shift !== shownShift) {
      copy.style.transform = shift ? `translateY(${shift}px)` : "";
      shownShift = shift;
    }
  };
  const frame = () => {
    place();
    requestAnimationFrame(frame);
  };
  hero.addEventListener("focusin", (event) => {
    place();
    if (event.target.matches(":focus-visible")) event.target.scrollIntoView({ block: "nearest" });
  });
  frame();
}

// ---------------------------------------------------------------- story year marker

function setUpYearMarker() {
  const marker = document.querySelector(".year-marker-span");
  if (!marker) return;
  const observer = new IntersectionObserver((entries) => {
    const crossing = entries.filter((entry) => entry.isIntersecting).at(-1);
    if (crossing) marker.textContent = crossing.target.dataset.years;
  }, { rootMargin: "-50% 0px -50% 0px" });
  document.querySelectorAll(".story-chapter").forEach((chapter) => observer.observe(chapter));
}

// ---------------------------------------------------------------- story plates

// Each plate keeps the candidate it loaded first: a passing resize (a capture, a rotated tablet) would otherwise
// make the browser re-pick from srcset and abandon the request it already had in flight.
function pinStoryPlates() {
  for (const img of document.querySelectorAll(".plate img[srcset]")) {
    const pin = () => {
      img.src = img.currentSrc;
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
    };
    if (img.complete && img.currentSrc) pin();
    else img.addEventListener("load", pin, { once: true });
  }
}

// ---------------------------------------------------------------- enquiry form

function setUpEnquiryForm() {
  const form = document.querySelector(".enquiry-form");
  if (!form) return;
  const copy = JSON.parse(form.dataset.copy);
  const button = form.querySelector('button[type="submit"]');
  const label = button.querySelector(".button-label");
  const alert = form.querySelector(".form-alert");
  const status = document.querySelector(".confirmation");
  const fields = { email: form.elements.email, phone: form.elements.phone, reference: form.elements.reference, agreed: form.elements.agreed };
  let sending = false;

  // Field messages change only when a send gets an answer about them, and carry the page's own wording.
  const markFields = (errors) => {
    for (const [name, field] of Object.entries(fields)) {
      const message = form.querySelector(`[data-error-for="${name}"]`);
      if (name in errors) {
        field.setAttribute("aria-invalid", "true");
        message.textContent = copy.errors[name];
      } else {
        field.removeAttribute("aria-invalid");
        message.textContent = "";
      }
    }
  };

  const showConfirmation = (replyTo) => {
    status.textContent = copy.thanks.replace("{reply_to}", replyTo);
    status.tabIndex = -1;
    form.remove();
    status.focus();
  };

  const rest = () => {
    button.disabled = false;
    label.textContent = copy.send;
    sending = false;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    sending = true;
    alert.textContent = "";
    button.disabled = true;
    label.textContent = copy.sending;
    const body = { email: fields.email.value, agreed: fields.agreed.checked };
    if (fields.phone.value) body.phone = fields.phone.value;
    if (fields.reference.value) body.reference = fields.reference.value;
    let response = null;
    try {
      response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      response = null;
    }
    if (response?.status === 201) {
      showConfirmation((await response.json()).reply_to);
      return;
    }
    rest();
    if (response?.status === 422) {
      const { errors } = await response.json();
      alert.textContent = copy.refused;
      markFields(errors);
      fields[Object.keys(fields).find((name) => name in errors)]?.focus();
    } else {
      alert.textContent = copy.outage;
      button.focus();
    }
  });
}

// ---------------------------------------------------------------- copy buttons

function setUpCopyButtons() {
  document.querySelectorAll(".copy-address").forEach((button) => {
    const label = button.querySelector(".button-label");
    const resting = label.textContent;
    const address = button.closest(".card").querySelector("[data-address]");
    let timer = null;
    button.addEventListener("click", async () => {
      // The label's period runs from the latest activation.
      clearTimeout(timer);
      timer = setTimeout(() => { label.textContent = resting; }, COPY_LABEL_MS);
      try {
        await navigator.clipboard.writeText(address.textContent);
        label.textContent = button.dataset.copied;
      } catch {
        label.textContent = button.dataset.refused;
        getSelection().selectAllChildren(address);
      }
    });
  });
}

setUpScrollRoom();
setUpCookieNotice();
setUpMenu();
setUpChapters();
setUpArrivals();
setUpPromiseHold();
setUpYearMarker();
pinStoryPlates();
setUpEnquiryForm();
setUpCopyButtons();
