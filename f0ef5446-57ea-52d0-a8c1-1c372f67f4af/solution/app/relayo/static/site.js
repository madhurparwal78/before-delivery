// Relayo site behaviour. Applicant text is only ever written with textContent.

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function h(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    if (name === "text") node.textContent = value;
    else if (name === "className") node.className = value;
    else node.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

const ICONS = {
  alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01",
  check: "M20 6 9 17l-5-5",
  pause: "M9 5v14M15 5v14",
  play: "M7 4v16l13-8z",
  hourglass: "M6 2h12M6 22h12M7 2c0 6 10 6 10 10S7 16 7 22M17 2c0 6-10 6-10 10s10 4 10 10",
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", `icon icon-${name}`);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

function readRules() {
  const script = $("script[data-rules]");
  return script ? JSON.parse(script.textContent) : null;
}

// The counting rule and the email key, with the server's own White_Space list.
function trimWhiteSpace(value, whiteSpace) {
  const chars = [...value];
  let start = 0;
  let end = chars.length;
  while (start < end && whiteSpace.includes(chars[start])) start += 1;
  while (end > start && whiteSpace.includes(chars[end - 1])) end -= 1;
  return chars.slice(start, end).join("");
}

function normalised(value, rules) {
  return trimWhiteSpace(value.normalize("NFC"), rules.whiteSpace);
}

function codePoints(value) {
  return [...value].length;
}

function randomKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Header, cookie panel and focus visibility ------------------------------------------------------

const header = $(".site-header");
const cookiePanel = $("#cookie-panel");

function headerBottom() {
  return header ? header.getBoundingClientRect().bottom : 0;
}

function cookieTop() {
  if (cookiePanel && cookiePanel.open) {
    const top = cookiePanel.getBoundingClientRect().top;
    if (top > 0) return top;
  }
  return innerHeight;
}

function syncOffsets() {
  document.documentElement.style.setProperty("--header-h", `${header ? header.offsetHeight : 0}px`);
  const covering = cookiePanel && cookiePanel.open ? innerHeight - cookiePanel.getBoundingClientRect().top : 0;
  document.documentElement.style.setProperty("--cookie-h", `${Math.max(0, covering)}px`);
}

// Keep a focused control clear of the sticky header and the cookie panel.
function reveal(element) {
  syncOffsets();
  if (!element || element === document.body || element.closest(".site-header, .cookie-panel, dialog[open], .skip-link")) return;
  const box = element.getBoundingClientRect();
  const top = headerBottom() + 12;
  const bottom = cookieTop() - 12;
  if (box.top < top) window.scrollBy({ top: box.top - top, behavior: "instant" });
  else if (box.bottom > bottom) window.scrollBy({ top: Math.min(box.bottom - bottom, box.top - top), behavior: "instant" });
}

function focusAndReveal(element) {
  element.focus({ preventScroll: true });
  reveal(element);
}

function setUpFocusKeeping() {
  syncOffsets();
  new ResizeObserver(syncOffsets).observe(header);
  if (cookiePanel) new ResizeObserver(syncOffsets).observe(cookiePanel);
  addEventListener("resize", syncOffsets);
  document.addEventListener("focusin", (event) => {
    reveal(event.target);
    setTimeout(() => {
      if (document.activeElement === event.target) reveal(event.target);
    }, 0);
  });
}

function setUpHeader() {
  const agentsButton = $(".agents-toggle");
  const agentsMenu = $("#agents-menu");
  const agentsItem = $(".nav-agents");
  const menuButton = $(".menu-toggle");
  const siteMenu = $("#site-menu");

  const setAgents = (open, returnFocus = false) => {
    agentsButton.setAttribute("aria-expanded", String(open));
    agentsMenu.classList.toggle("is-open", open);
    if (!open && returnFocus) agentsButton.focus();
  };
  const setMenu = (open, returnFocus = false) => {
    menuButton.setAttribute("aria-expanded", String(open));
    siteMenu.classList.toggle("is-open", open);
    if (!open) setAgents(false);
    if (!open && returnFocus) menuButton.focus();
  };

  agentsButton.addEventListener("click", () => setAgents(agentsButton.getAttribute("aria-expanded") !== "true"));
  agentsItem.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && agentsButton.getAttribute("aria-expanded") === "true") {
      event.stopPropagation();
      setAgents(false, true);
    }
  });
  agentsItem.addEventListener("focusout", (event) => {
    if (!agentsItem.contains(event.relatedTarget)) setAgents(false);
  });
  menuButton.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  for (const target of [menuButton, siteMenu]) {
    target.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
        event.stopPropagation();
        setMenu(false, true);
      }
    });
  }
  document.addEventListener("click", (event) => {
    if (!agentsItem.contains(event.target)) setAgents(false);
    if (!header.contains(event.target)) setMenu(false);
  });
}

const COOKIE_NAME = "relayo_cookie_choice";
const COOKIE_CATEGORIES = ["performance", "functional", "targeting"];

function savedCookieChoice() {
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!entry) return null;
  const choice = {};
  for (const pair of entry.slice(COOKIE_NAME.length + 1).split("-")) {
    const [name, flag] = pair.split(".");
    if (COOKIE_CATEGORIES.includes(name)) choice[name] = flag === "1";
  }
  return choice;
}

function setUpCookiePanel() {
  if (!cookiePanel) return;
  const settings = $("#cookie-settings");
  const settingsButton = $('[data-cookie-action="settings"]', cookiePanel);
  const confirmButton = $('[data-cookie-action="confirm"]', cookiePanel);
  const boxes = $$("[data-cookie-category]", cookiePanel);
  const reopenButtons = $$(".cookie-reopen");
  let reopenedFrom = null;

  const showSettings = () => {
    settings.hidden = false;
    confirmButton.hidden = false;
    settingsButton.setAttribute("aria-expanded", "true");
    syncOffsets();
  };
  const close = () => {
    cookiePanel.close();
    syncOffsets();
    if (reopenedFrom) reopenedFrom.focus();
    reopenedFrom = null;
  };
  const save = (choice) => {
    const value = COOKIE_CATEGORIES.map((name) => `${name}.${choice[name] ? 1 : 0}`).join("-");
    document.cookie = `${COOKIE_NAME}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
    close();
  };

  cookiePanel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-cookie-action]")?.dataset.cookieAction;
    if (action === "settings") showSettings();
    if (action === "reject") save({});
    if (action === "accept") save({ performance: true, functional: true, targeting: true });
    if (action === "confirm") save(Object.fromEntries(boxes.map((box) => [box.dataset.cookieCategory, box.checked])));
  });
  cookiePanel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (reopenedFrom) close();
  });
  cookiePanel.addEventListener("cancel", (event) => {
    if (!reopenedFrom) event.preventDefault();
  });
  for (const button of reopenButtons) {
    button.addEventListener("click", () => {
      const choice = savedCookieChoice() || {};
      for (const box of boxes) box.checked = Boolean(choice[box.dataset.cookieCategory]);
      reopenedFrom = button;
      showSettings();
      cookiePanel.show();
      syncOffsets();
      boxes[0].focus();
    });
  }
}

// Home: the before / during / after story, the use-case carousel, the tools strip ---------------

function setUpStory() {
  const story = $("[data-story]");
  if (!story) return;
  const steps = $$(".story-step", story);
  const panels = $$(".story-panel", story);
  const held = matchMedia("(min-width: 768px) and (prefers-reduced-motion: no-preference)");
  let current = 0;

  const show = (index) => {
    current = index;
    steps.forEach((step, n) => (n === index ? step.setAttribute("aria-current", "step") : step.removeAttribute("aria-current")));
    panels.forEach((panel, n) => panel.classList.toggle("is-current", n === index));
  };
  const update = () => {
    if (held.matches) {
      const box = story.getBoundingClientRect();
      const span = box.height - innerHeight;
      const progress = Math.min(1, Math.max(0, -box.top / span));
      story.style.setProperty("--progress", progress.toFixed(4));
      show(Math.min(2, Math.floor(progress * 3)));
      return;
    }
    const middle = innerHeight / 2;
    const crossing = panels.findIndex((panel) => {
      const box = panel.getBoundingClientRect();
      return box.top <= middle && box.bottom >= middle;
    });
    if (crossing >= 0 && crossing !== current) show(crossing);
  };

  if (!reducedMotion.matches && "IntersectionObserver" in window) {
    const reveal = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          reveal.unobserve(entry.target);
        }
      }
    }, { threshold: 0.2 });
    for (const panel of panels) {
      panel.classList.add("will-reveal");
      reveal.observe(panel);
    }
  }
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  held.addEventListener("change", update);
  update();
}

function setUpCarousel() {
  const carousel = $("[data-carousel]");
  if (!carousel) return;
  const viewport = $(".carousel-viewport", carousel);
  const track = $(".carousel-track", carousel);
  const slides = $$(".slide", carousel);
  const dots = $$(".dot", carousel);
  const previous = $("[data-carousel-prev]", carousel);
  const next = $("[data-carousel-next]", carousel);
  const status = $(".carousel-status", carousel);
  let index = 0;

  const go = (target) => {
    const bounded = Math.max(0, Math.min(slides.length - 1, target));
    if (bounded === index) return;
    index = bounded;
    track.style.setProperty("--index", String(index));
    slides.forEach((slide, n) => (slide.inert = n !== index));
    dots.forEach((dot, n) => dot.classList.toggle("is-current", n === index));
    previous.setAttribute("aria-disabled", String(index === 0));
    next.setAttribute("aria-disabled", String(index === slides.length - 1));
    status.textContent = `Use case ${index + 1} of ${slides.length}: ${slides[index].dataset.name}`;
  };

  previous.addEventListener("click", () => go(index - 1));
  next.addEventListener("click", () => go(index + 1));
  carousel.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") go(index - 1);
    if (event.key === "ArrowRight") go(index + 1);
  });
  let start = null;
  let last = null;
  viewport.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    start = last = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  viewport.addEventListener("touchmove", (event) => {
    const touch = event.touches[0];
    last = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  viewport.addEventListener("touchend", (event) => {
    if (!start) return;
    const touch = event.changedTouches[0];
    const end = touch ? { x: touch.clientX, y: touch.clientY } : last;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    start = null;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
  }, { passive: true });
}

function setUpStrip() {
  const toggle = $("[data-strip-toggle]");
  if (!toggle) return;
  const motion = $(".strip-motion");
  const label = $("span", toggle);
  toggle.addEventListener("click", () => {
    const paused = motion.classList.toggle("is-paused");
    label.textContent = paused ? "Play tool strip" : "Pause tool strip";
    toggle.querySelector("svg").replaceWith(icon(paused ? "play" : "pause"));
  });
}

// Lists: integrations, blog, press -----------------------------------------------------------------

const LISTS = {
  integrations: { api: "/api/integrations", noun: ["integration", "integrations"], listName: "Integrations",
    empty: ["No integrations match this category.", "Show all integrations", "/integrations"] },
  blog: { api: "/api/blog", noun: ["article", "articles"], listName: "Articles",
    empty: ["No articles match this category.", "Show all articles", "/blog"] },
  press: { api: "/api/press", noun: ["press item", "press items"], listName: "Press items",
    empty: ["No press items match this category.", "Show all press", "/press"] },
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];
const RETURN_KEY = "relayo-return";

function calendarDate(value) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function countText(count, noun) {
  return `${count} ${count === 1 ? noun[0] : noun[1]}`;
}

function emptyDrawing() {
  const template = $(".empty-drawing");
  if (template) return template.cloneNode(true);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = '<svg class="empty-drawing" viewBox="0 0 120 80" aria-hidden="true" focusable="false"><rect x="14" y="12" width="70" height="52" rx="10" fill="#fff" stroke="#c9d3e3" stroke-width="2"/><path d="M26 28h40M26 38h28M26 48h34" stroke="#dfe4ec" stroke-width="4" stroke-linecap="round"/><circle cx="86" cy="50" r="16" fill="#fff" stroke="#1d4ed8" stroke-width="3"/><path d="m97 61 10 10" stroke="#1d4ed8" stroke-width="4" stroke-linecap="round"/></svg>';
  return wrapper.firstChild;
}

function emptyState(message, linkText, href) {
  return h("div", { className: "empty-state" }, emptyDrawing(), h("p", { text: message }),
    h("a", { className: "btn btn-secondary", href, text: linkText }));
}

function detailHref(base, slug) {
  return `${base}/${slug}?from=${encodeURIComponent(location.pathname + location.search)}`;
}

function integrationCard(item) {
  return h("li", { className: "card card-hover", "data-slug": item.slug },
    h("div", { className: "icon-tile" }, h("img", { src: item.icon_ref, alt: "", width: "56", height: "56" })),
    h("h3", { className: "card-title" }, h("a", { className: "card-link", href: detailHref("/integration", item.slug), text: item.name })),
    h("p", { className: "card-meta", text: item.category }),
    h("p", { className: "card-text", text: item.description }));
}

function articleCard(item) {
  return h("li", { className: "card card-hover article-card", "data-slug": item.slug },
    h("div", { className: "cover-frame" }, h("img", { src: item.cover_ref, alt: "", width: "1200", height: "675", loading: "lazy" })),
    h("div", { className: "card-body" },
      h("p", { className: "card-meta", text: item.category }),
      h("h3", { className: "card-title" }, h("a", { className: "card-link", href: detailHref("/blog", item.slug), text: item.title })),
      h("p", { className: "card-text", text: item.summary }),
      h("p", { className: "card-byline" }, `${item.author} · `,
        h("time", { datetime: item.published_at, text: calendarDate(item.published_at) }), ` · ${item.read_time} min read`)));
}

function pressEntry(item) {
  return h("li", { className: "press-item" },
    h("p", { className: "press-meta" }, h("time", { datetime: item.date, text: calendarDate(item.date) }),
      h("span", { className: "tag", text: item.category })),
    h("a", { className: "press-headline", href: item.link, text: item.headline }));
}

function crossFade(area) {
  if (!reducedMotion.matches) area.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`list answered ${response.status}`);
  return response.json();
}

function setUpList(section) {
  const kind = section.dataset.list;
  const config = LISTS[kind];
  const nav = $(".filter-nav", section);
  const links = $$(".filter-link", nav);
  const results = $(".results", section);
  const area = $("[data-list-area]", section);
  const press = kind === "press";
  const cursors = new Map();
  let requestNumber = 0;
  let loading = false;

  const linkCategory = (link) => new URL(link.href).searchParams.get("category");
  const stateFromAddress = () => {
    const params = new URLSearchParams(location.search);
    const raw = params.get("page");
    return { category: params.get("category"), page: raw && /^[1-9][0-9]{0,4}$/.test(raw) ? Number(raw) : 1 };
  };
  const addressFor = (category, page = 1) => {
    const params = [];
    if (category !== null) params.push(`category=${encodeURIComponent(category)}`);
    if (page > 1) params.push(`page=${page}`);
    return location.pathname + (params.length ? `?${params.join("&")}` : "");
  };
  const markCurrent = (category) => {
    for (const link of links) {
      const own = linkCategory(link);
      const current = own === category || (own === null && (category === null || (press && category === "All")));
      if (current) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  const known = (category) => category === null || links.some((link) => linkCategory(link) === category)
    || (press && category === "All");

  if (press) {
    const initial = stateFromAddress();
    cursors.set(initial.category, JSON.parse(section.dataset.cursors));
  }

  const pressCursor = async (category, page) => {
    const opening = cursors.get(category) || [null];
    cursors.set(category, opening);
    while (opening.length < page) {
      const index = opening.length - 1;
      if (index > 0 && opening[index] === null) return undefined;
      const query = new URLSearchParams();
      if (category !== null) query.set("category", category);
      query.set("limit", "10");
      if (opening[index]) query.set("cursor", opening[index]);
      const data = await fetchJson(`${config.api}?${query}`);
      opening.push(data.next_cursor);
    }
    return opening[page - 1];
  };

  const render = (items, category, page, nextCursor) => {
    area.removeAttribute("aria-busy");
    area.replaceChildren();
    if (!items.length) {
      const [message, linkText, href] = config.empty;
      if (press && page > 1 && known(category)) area.append(emptyState("No press items on this page.", "Show all press", "/press"));
      else area.append(emptyState(message, linkText, href));
    } else if (kind === "integrations") {
      area.append(h("ul", { className: "card-grid", "aria-label": config.listName }, items.map(integrationCard)));
    } else if (kind === "blog") {
      area.append(h("ul", { className: "card-grid", "aria-label": config.listName }, items.map(articleCard)));
    } else {
      area.append(h("ul", { className: "press-list", "aria-label": config.listName }, items.map(pressEntry)),
        h("div", { className: "pager" },
          h("button", { className: "btn btn-secondary", type: "button", "data-pager": "previous",
            "aria-disabled": page === 1 ? "true" : null, text: "Previous" }),
          h("button", { className: "btn btn-secondary", type: "button", "data-pager": "next",
            "aria-disabled": nextCursor ? null : "true", text: "Load more" })));
      section.dataset.pageNumber = String(page);
    }
    results.textContent = countText(items.length, config.noun);
    crossFade(area);
  };

  const load = async (category, page, after) => {
    const mine = ++requestNumber;
    loading = true;
    markCurrent(category);
    results.textContent = "Loading…";
    area.setAttribute("aria-busy", "true");
    for (const button of $$("[data-pager]", area)) button.setAttribute("aria-disabled", "true");
    try {
      let items;
      let nextCursor = null;
      if (kind === "integrations") {
        const url = category === null ? config.api : `${config.api}?category=${encodeURIComponent(category)}`;
        items = (await fetchJson(url)).items;
      } else if (kind === "blog") {
        items = [];
        let cursor = null;
        do {
          const query = new URLSearchParams();
          if (category !== null) query.set("category", category);
          query.set("limit", "50");
          if (cursor) query.set("cursor", cursor);
          const data = await fetchJson(`${config.api}?${query}`);
          if (mine !== requestNumber) return;
          items.push(...data.items);
          cursor = data.next_cursor;
        } while (cursor);
      } else {
        const opening = await pressCursor(category, page);
        if (opening === undefined) {
          items = [];
        } else {
          const query = new URLSearchParams();
          if (category !== null) query.set("category", category);
          query.set("limit", "10");
          if (opening) query.set("cursor", opening);
          const data = await fetchJson(`${config.api}?${query}`);
          items = data.items;
          nextCursor = data.next_cursor;
          cursors.get(category)[page] = nextCursor;
        }
      }
      if (mine !== requestNumber) return;
      loading = false;
      render(items, category, page, nextCursor);
      if (after) after();
    } catch {
      if (mine !== requestNumber) return;
      loading = false;
      area.removeAttribute("aria-busy");
      area.replaceChildren(h("div", { className: "alert", role: "alert" }, icon("alert"),
        h("p", { text: "This list is unavailable right now. Try again in a minute." })));
      results.textContent = "";
    }
  };

  nav.addEventListener("click", (event) => {
    const link = event.target.closest(".filter-link");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const category = linkCategory(link);
    history.pushState({ list: kind }, "", addressFor(category));
    link.focus();
    load(category, 1);
  });

  section.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pager]");
    if (!button) return;
    if (loading || button.getAttribute("aria-disabled") === "true") return;
    const { category } = stateFromAddress();
    const page = Number(section.dataset.pageNumber || "1") + (button.dataset.pager === "next" ? 1 : -1);
    history.pushState({ list: kind }, "", addressFor(category, page));
    load(category, page, () => $(".press-list a", area)?.focus());
  });

  addEventListener("popstate", () => {
    const { category, page } = stateFromAddress();
    load(category, press ? page : 1);
  });

  if (press) {
    const params = new URLSearchParams(location.search);
    const raw = params.get("page");
    if (raw !== null && !/^[1-9][0-9]{0,4}$/.test(raw) || raw === "1") {
      history.replaceState(history.state, "", addressFor(params.get("category")));
    }
  }

  returnToCard(kind, section);
}

// Arriving back from a detail page: focus the card that was opened.
function returnToCard(kind, section) {
  let stored = null;
  try {
    stored = JSON.parse(sessionStorage.getItem(RETURN_KEY) || "null");
  } catch {
    stored = null;
  }
  if (!stored || stored.list !== kind) return;
  sessionStorage.removeItem(RETURN_KEY);
  const card = $$(".card[data-slug]", section).find((node) => node.dataset.slug === stored.slug);
  const target = card ? $(".card-link", card) : $(".filter-link", section);
  target.focus({ preventScroll: true });
  const box = (card || target).getBoundingClientRect();
  window.scrollBy({ top: box.top - headerBottom() - 24, behavior: "instant" });
}

function setUpReturnLink() {
  const back = $(".back-link[data-return-list]");
  if (!back) return;
  back.addEventListener("click", () => {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ list: back.dataset.returnList, slug: back.dataset.returnSlug }));
  });
}

// Partner application form -------------------------------------------------------------------------

const DRAFT_KEY = "relayo-partner-draft";
const FIELD_ORDER = ["first_name", "last_name", "work_email", "job_title", "company_name", "website", "company_type",
  "employee_band", "markets", "customer_segment", "partnership_interests", "goals", "consent"];
const GROUPS = ["markets", "partnership_interests"];

function setUpPartnerForm() {
  const form = $("[data-partner-form]");
  if (!form) return;
  const rules = readRules();
  const panel = $("[data-apply]");
  const formStatus = $("[data-form-status]");
  const summary = $("[data-error-summary]", form);
  const duplicateAlert = $("[data-duplicate-alert]", form);
  const outageAlert = $("[data-outage-alert]", form);
  const submitButton = $("[data-submit]", form);
  const counter = $("[data-goals-counter]", form);
  const goals = form.elements.goals;
  let draft = { values: null, key: null };
  let pending = false;

  const fieldControl = (name) => (GROUPS.includes(name) ? $(`#f-${name}`) : form.elements[name]);
  const focusTarget = (name) => (GROUPS.includes(name) ? $(`#f-${name} input`) : form.elements[name]);
  const fieldName = (name) => {
    if (GROUPS.includes(name)) return $(`#f-${name} legend`).textContent.trim();
    if (name === "consent") return $("#f-consent").closest("label").textContent.trim();
    return $(`label[for="f-${name}"]`).textContent.trim();
  };
  const readValues = () => {
    const values = {};
    for (const name of FIELD_ORDER) {
      if (GROUPS.includes(name)) values[name] = $$(`input[name="${name}"]`, form).filter((box) => box.checked).map((box) => box.value);
      else if (name === "consent") values[name] = form.elements.consent.checked;
      else values[name] = form.elements[name].value;
    }
    return values;
  };
  const writeValues = (values) => {
    for (const name of FIELD_ORDER) {
      if (!(name in values)) continue;
      if (GROUPS.includes(name)) {
        for (const box of $$(`input[name="${name}"]`, form)) box.checked = values[name].includes(box.value);
      } else if (name === "consent") form.elements.consent.checked = values[name] === true;
      else form.elements[name].value = values[name];
    }
  };
  const store = () => sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  const updateCounter = () => {
    counter.textContent = `${codePoints(normalised(goals.value, rules))} / ${rules.limits.goals}`;
  };

  try {
    const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
    if (saved && saved.values) {
      draft = saved;
      writeValues(saved.values);
    }
  } catch {
    sessionStorage.removeItem(DRAFT_KEY);
  }
  updateCounter();

  const onChange = () => {
    const values = readValues();
    if (JSON.stringify(values) !== JSON.stringify(draft.values)) {
      draft = { values, key: null };
      store();
    }
    updateCounter();
  };
  form.addEventListener("input", onChange);
  form.addEventListener("change", onChange);

  const clearErrors = () => {
    for (const name of FIELD_ORDER) {
      fieldControl(name).removeAttribute("aria-invalid");
      $(`#f-${name}-error`).replaceChildren();
    }
    summary.hidden = true;
    summary.replaceChildren();
    duplicateAlert.hidden = true;
    outageAlert.hidden = true;
  };
  const showErrors = (errors) => {
    const failing = FIELD_ORDER.filter((name) => errors[name]);
    for (const name of failing) {
      fieldControl(name).setAttribute("aria-invalid", "true");
      $(`#f-${name}-error`).replaceChildren(icon("alert"), h("span", { text: errors[name] }));
    }
    summary.replaceChildren(
      h("h3", { className: "error-summary-title" }, icon("alert"), "Please correct the fields below."),
      h("ul", {}, failing.map((name) => h("li", {},
        h("a", { href: `#f-${name}`, "data-target": name, text: `${fieldName(name)}: ${errors[name]}` })))));
    summary.hidden = false;
    if (failing.length) focusAndReveal(focusTarget(failing[0]));
  };
  summary.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-target]");
    if (!link) return;
    event.preventDefault();
    focusAndReveal(focusTarget(link.dataset.target));
  });

  const setPending = (busy) => {
    pending = busy;
    if (busy) {
      submitButton.setAttribute("aria-disabled", "true");
      submitButton.replaceChildren(icon("hourglass"), "Submitting your application…");
      formStatus.textContent = "Submitting your application…";
    } else {
      submitButton.removeAttribute("aria-disabled");
      submitButton.replaceChildren("Submit application");
      formStatus.textContent = "";
    }
  };

  const received = (values) => {
    sessionStorage.removeItem(DRAFT_KEY);
    const company = normalised(values.company_name, rules);
    const line = `Thank you, ${company}. Our partner team reviews every application and replies by email.`;
    const heading = h("h2", { className: "received-title", id: "received-title", tabindex: "-1" }, icon("check"), "Application received");
    panel.replaceChildren(h("section", { className: "received", "aria-labelledby": "received-title" }, heading, h("p", { text: line })));
    formStatus.textContent = line;
    focusAndReveal(heading);
  };

  const send = async (attempt = 0) => {
    const values = readValues();
    if (!draft.key || JSON.stringify(values) !== JSON.stringify(draft.values)) {
      draft = { values, key: randomKey() };
    }
    store();
    setPending(true);
    let response;
    let data = null;
    try {
      response = await fetch("/api/partner-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": draft.key, Accept: "application/json" },
        body: JSON.stringify(values),
      });
      data = await response.json().catch(() => null);
    } catch {
      response = null;
    }
    if (response && response.status === 409 && data?.error === "request_in_progress" && attempt < 3) {
      setTimeout(() => send(attempt + 1), 2000);
      return;
    }
    setPending(false);
    clearErrors();
    if (response && response.status === 201) {
      received(values);
    } else if (response && response.status === 422 && data?.error === "validation_failed") {
      showErrors(data.errors);
    } else if (response && response.status === 409 && data?.error === "duplicate_application") {
      duplicateAlert.hidden = false;
      focusAndReveal(duplicateAlert);
    } else {
      outageAlert.hidden = false;
      focusAndReveal(outageAlert);
    }
  };

  duplicateAlert.tabIndex = -1;
  outageAlert.tabIndex = -1;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!pending) send();
  });
  $("[data-retry]", form).addEventListener("click", () => {
    if (!pending) send();
  });
}

// Reviewer page ----------------------------------------------------------------------------------------

const TOKEN_KEY = "relayo-staff-token";
const STATUS_NAMES = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
const BERLIN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hourCycle: "h23",
});

function berlinTime(value) {
  const parts = Object.fromEntries(BERLIN.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} Berlin`;
}

function setUpReview() {
  const root = $("[data-review]");
  if (!root) return;
  const rules = readRules();
  const statusLine = $("[data-review-status]", root);
  const alerts = $("[data-review-alerts]", root);
  const form = $("[data-sign-in]", root);
  const emailBox = form.elements.email;
  const passwordBox = form.elements.password;
  const signInButton = $("[data-sign-in-button]", root);
  const signOutButton = $("[data-sign-out]", root);
  const queue = $("[data-queue]", root);
  const waits = new Map();
  let waitTimer = null;
  let openId = null;
  let dialog = null;
  let queueRequest = 0;

  const token = () => sessionStorage.getItem(TOKEN_KEY);
  const say = (text) => {
    statusLine.textContent = text;
  };
  const showAlert = (text, focus = false) => {
    const alert = h("div", { className: "alert", role: "alert", tabindex: "-1" }, icon("alert"), h("p", { text }));
    alerts.replaceChildren(alert);
    if (focus) alert.focus();
    return alert;
  };
  const clearAlerts = () => alerts.replaceChildren();
  const emailKey = () => normalised(emailBox.value, rules).toLowerCase();

  // Sign-in wait, kept per email key on the page's own clock.
  const remaining = (key) => {
    const deadline = waits.get(key);
    return deadline === undefined ? 0 : Math.ceil((deadline - Date.now()) / 1000);
  };
  const renderWait = () => {
    const key = emailKey();
    const left = remaining(key);
    const current = $(".wait-alert", alerts);
    if (left > 0) {
      const text = `Too many sign-in attempts. Try again in ${left} ${left === 1 ? "second" : "seconds"}.`;
      if (current) $("p", current).textContent = text;
      else {
        const alert = showAlert(text);
        alert.classList.add("wait-alert");
      }
      signInButton.setAttribute("aria-disabled", "true");
    } else {
      if (current) current.remove();
      signInButton.removeAttribute("aria-disabled");
    }
  };
  const tick = () => {
    clearTimeout(waitTimer);
    const key = emailKey();
    for (const [waiting] of waits) {
      if (remaining(waiting) <= 0) {
        waits.delete(waiting);
        if (waiting === key) say("You can sign in again.");
      }
    }
    renderWait();
    if (waits.size) waitTimer = setTimeout(tick, 200);
  };
  emailBox.addEventListener("input", () => {
    if (waits.size || $(".wait-alert", alerts)) renderWait();
  });

  const showSignIn = (message) => {
    sessionStorage.removeItem(TOKEN_KEY);
    closeDialog();
    queue.replaceChildren();
    queue.hidden = true;
    signOutButton.hidden = true;
    form.hidden = false;
    clearAlerts();
    if (message) say(message);
  };

  const withdraw = () => {
    queueRequest += 1;
    closeDialog();
    queue.replaceChildren();
    queue.hidden = true;
    openId = null;
    showAlert("Your account does not have access to partner applications.", true);
  };

  const viewFromAddress = (rewrite) => {
    const params = new URLSearchParams(location.search);
    let status = params.get("status");
    let sort = params.get("sort");
    let changed = false;
    if (status !== null && !(status in STATUS_NAMES)) {
      params.delete("status");
      status = null;
      changed = true;
    }
    if (sort !== null && sort !== "reply_due" && sort !== "submitted") {
      params.delete("sort");
      sort = null;
      changed = true;
    }
    if (changed && rewrite) history.replaceState(null, "", `/review${params.size ? `?${params}` : ""}`);
    return { status: status || "pending", sort: sort === "reply_due" ? "reply_due" : "submitted" };
  };
  const withParam = (name, value) => {
    const params = new URLSearchParams(location.search);
    if (value === null) params.delete(name);
    else params.set(name, value);
    return `/review${params.size ? `?${params}` : ""}`;
  };

  // Answers shared by every review request: 401 ends the session, 403 withdraws access.
  const reviewFetch = async (url, options = {}) => {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { Accept: "application/json", Authorization: `Bearer ${token()}`, ...(options.headers || {}) },
      });
    } catch {
      showAlert("Partner applications are unavailable right now. Try again in a minute.");
      return null;
    }
    if (response.status === 401) {
      showSignIn("Your session has ended. Sign in again.");
      return null;
    }
    if (response.status === 403) {
      withdraw();
      return null;
    }
    if (response.status >= 500) {
      showAlert("Partner applications are unavailable right now. Try again in a minute.");
      return null;
    }
    return response;
  };

  const viewNav = (label, entries, currentValue) => h("div", {},
    h("span", { className: "toolbar-label", "aria-hidden": "true", text: label }),
    h("nav", { "aria-label": label },
      h("ul", { className: "filter-list" }, entries.map(([value, text, href]) => h("li", {},
        h("a", { className: "filter-link", href, "data-view": value, "aria-current": value === currentValue ? "true" : null, text }))))));

  const renderQueue = (data, view) => {
    const toolbar = h("div", { className: "queue-toolbar" },
      viewNav("Queue order", [["submitted", "Newest first", withParam("sort", null)],
        ["reply_due", "Reply due first", withParam("sort", "reply_due")]], view.sort),
      viewNav("Application status", Object.entries(STATUS_NAMES).map(([value, text]) => [value, text, withParam("status", value)]), view.status),
      h("p", { className: "queue-counts", role: "status", "aria-label": "Queue counts",
        text: `${data.counts.pending} pending, ${data.counts.approved} approved, ${data.counts.rejected} rejected` }));
    let listing;
    if (!data.items.length) {
      listing = h("p", { className: "empty-view", tabindex: "-1", text: "No applications in this view." });
    } else {
      const columns = ["Company", "Applicant", "Work email", "Submitted", "Reply due", "Status"];
      listing = h("table", { className: "queue-table", role: "table", "aria-label": "Partner applications" },
        h("caption", { tabindex: "-1", text: `${STATUS_NAMES[view.status]} applications` }),
        h("thead", { role: "rowgroup" }, h("tr", { role: "row" }, columns.map((name) => h("th", { role: "columnheader", scope: "col", text: name })))),
        h("tbody", { role: "rowgroup" }, data.items.map((item) => h("tr", { role: "row" },
          h("td", { role: "cell", "data-label": "Company" },
            h("a", { href: `#application-${item.id}`, "data-open": String(item.id), text: item.company_name })),
          h("td", { role: "cell", "data-label": "Applicant", text: `${item.first_name} ${item.last_name}` }),
          h("td", { role: "cell", "data-label": "Work email", text: item.work_email }),
          h("td", { role: "cell", "data-label": "Submitted" }, h("span", { className: "time", text: berlinTime(item.created_at) })),
          h("td", { role: "cell", "data-label": "Reply due" }, h("span", { className: "time", text: berlinTime(item.reply_due_at) })),
          h("td", { role: "cell", "data-label": "Status" },
            h("span", { className: `badge badge-${item.status}`, text: STATUS_NAMES[item.status] }),
            item.status === "pending" ? h("div", { className: "row-actions" },
              h("button", { className: "btn btn-primary btn-sm", type: "button", "data-decide": "approve", "data-id": String(item.id),
                "data-company": item.company_name, text: `Approve ${item.company_name}` }),
              h("button", { className: "btn btn-secondary btn-sm", type: "button", "data-decide": "reject", "data-id": String(item.id),
                "data-company": item.company_name, text: `Reject ${item.company_name}` })) : null)))));
    }
    const details = $(".details", queue);
    queue.replaceChildren(toolbar, h("div", { className: `queue-layout${details ? "" : " no-details"}` },
      h("div", { className: "queue-listing" }, listing), details));
    queue.hidden = false;
  };

  const loadQueue = async () => {
    const view = viewFromAddress(true);
    const mine = ++queueRequest;
    const response = await reviewFetch(`/api/review/partner-applications?status=${view.status}&sort=${view.sort}`);
    if (!response || mine !== queueRequest) return null;
    if (!response.ok) {
      showAlert("Partner applications are unavailable right now. Try again in a minute.");
      return null;
    }
    const data = await response.json();
    if (mine !== queueRequest) return null;
    renderQueue(data, view);
    return data;
  };

  const detailRows = (item) => {
    const yes = (value) => (value ? "Yes" : "No");
    const rows = [
      ["First name", item.first_name], ["Last name", item.last_name], ["Work email", item.work_email],
      ["Job title", item.job_title], ["Company name", item.company_name], ["Website URL", item.website],
      ["Company type", item.company_type], ["Number of employees", item.employee_band],
      ["Primary markets served", item.markets.join(", ")], ["Primary customer segment", item.customer_segment],
      ["Partnership interests", item.partnership_interests.join(", ")], ["Partnership goals", item.goals],
      ["Consent", yes(item.consent)], ["Status", STATUS_NAMES[item.status]],
      ["Submitted", berlinTime(item.created_at)], ["Reply due", berlinTime(item.reply_due_at)],
      ["Reviewer", item.reviewer || "Not decided yet"],
      ["Decision time", item.decided_at ? berlinTime(item.decided_at) : "Not decided yet"],
      ["Internal note", item.decision_note || "None"],
    ];
    return h("dl", {}, rows.map(([term, value]) => h("div", {}, h("dt", { text: term }), h("dd", { text: value }))));
  };

  const loadDetails = async (id, focus) => {
    const response = await reviewFetch(`/api/review/partner-applications/${id}`);
    if (!response) return;
    if (!response.ok) {
      showAlert("Partner applications are unavailable right now. Try again in a minute.");
      return;
    }
    const item = await response.json();
    openId = id;
    const heading = h("h2", { tabindex: "-1", text: item.company_name });
    const outcome = item.outcome_email_status
      ? h("p", { className: "outcome-line", text: `Outcome email: ${item.outcome_email_status === "sent" ? "Sent" : "Queued"}` })
      : null;
    const panel = h("section", { className: "details", "aria-label": "Application details" },
      h("p", { className: "eyebrow", text: "Application details" }), heading, detailRows(item), outcome);
    const layout = $(".queue-layout", queue);
    if (!layout) return;
    $(".details", layout)?.remove();
    layout.classList.remove("no-details");
    layout.append(panel);
    if (focus) focusAndReveal(heading);
  };

  function closeDialog() {
    if (!dialog) return;
    const closing = dialog;
    dialog = null;
    if (closing.open) closing.close();
    closing.remove();
  }

  const openDecision = (button) => {
    closeDialog();
    const decision = button.dataset.decide;
    const id = button.dataset.id;
    const title = decision === "approve" ? "Approve application" : "Reject application";
    const note = h("textarea", { className: "input textarea", id: "decision-note", rows: "4",
      "aria-describedby": "decision-note-hint decision-note-error" });
    const error = h("p", { className: "field-error", id: "decision-note-error", "aria-live": "polite" });
    const confirm = h("button", { className: "btn btn-primary", type: "submit", text: "Confirm" });
    const cancel = h("button", { className: "btn btn-secondary", type: "button", text: "Cancel" });
    const box = h("dialog", { className: "decision-dialog", "aria-labelledby": "decision-title" },
      h("form", { className: "dialog-body", method: "dialog", novalidate: true },
        h("h2", { id: "decision-title", text: title }),
        h("p", { className: "dialog-sub", text: button.dataset.company }),
        h("label", { className: "field-label", for: "decision-note", text: "Internal note" }),
        note,
        h("p", { className: "hint", id: "decision-note-hint", text: `Up to ${rules.noteLimit} characters. Never sent to the applicant.` }),
        error,
        h("div", { className: "dialog-actions" }, cancel, confirm)));
    document.body.append(box);
    dialog = box;
    let saving = false;
    const finish = () => {
      closeDialog();
      if (button.isConnected) button.focus();
    };
    cancel.addEventListener("click", finish);
    box.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish();
    });
    $("form", box).addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      say("Saving decision…");
      error.replaceChildren();
      const response = await reviewFetch(`/api/review/partner-applications/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.value }),
      });
      saving = false;
      if (!response) return;
      const data = await response.json().catch(() => ({}));
      if (response.status === 422) {
        say("");
        const message = data.errors?.note || data.errors?.decision || "Please check the note.";
        error.replaceChildren(icon("alert"), h("span", { text: message }));
        note.setAttribute("aria-invalid", "true");
        note.focus();
        return;
      }
      closeDialog();
      if (response.status === 409) {
        say("");
        showAlert("This application was already decided.");
      } else if (response.ok) {
        clearAlerts();
        say(decision === "approve" ? "Application approved. The applicant will be emailed." : "Application rejected. The applicant will be emailed.");
      }
      const refreshed = await loadQueue();
      if (!refreshed) return;
      if (openId) await loadDetails(openId, false);
      if (!response.ok) return;
      const target = $(".queue-table caption", queue) || $(".empty-view", queue);
      if (target) focusAndReveal(target);
    });
    box.showModal();
    note.focus();
  };

  queue.addEventListener("click", (event) => {
    const viewLink = event.target.closest("a[data-view]");
    if (viewLink) {
      event.preventDefault();
      history.pushState(null, "", viewLink.getAttribute("href"));
      loadQueue();
      return;
    }
    const opener = event.target.closest("a[data-open]");
    if (opener) {
      event.preventDefault();
      loadDetails(opener.dataset.open, true);
      return;
    }
    const decide = event.target.closest("button[data-decide]");
    if (decide) openDecision(decide);
  });

  addEventListener("popstate", () => {
    if (token()) loadQueue();
  });

  const signedIn = () => {
    form.hidden = true;
    signOutButton.hidden = false;
    loadQueue();
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (signInButton.getAttribute("aria-disabled") === "true") return;
    for (const id of ["sign-in-email-error", "sign-in-password-error"]) $(`#${id}`).replaceChildren();
    const key = emailKey();
    say("Signing in…");
    signInButton.setAttribute("aria-disabled", "true");
    let response;
    let data = null;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: emailBox.value, password: passwordBox.value }),
      });
      data = await response.json().catch(() => null);
    } catch {
      response = null;
    }
    signInButton.removeAttribute("aria-disabled");
    say("");
    if (response && response.status === 200 && data?.access_token) {
      sessionStorage.setItem(TOKEN_KEY, data.access_token);
      clearAlerts();
      passwordBox.value = "";
      signedIn();
    } else if (response && response.status === 429) {
      const seconds = Math.max(1, Number(response.headers.get("Retry-After")) || 1);
      waits.set(key, Date.now() + seconds * 1000);
      clearAlerts();
      tick();
    } else if (response && response.status === 401) {
      showAlert("That email and password don't match.");
    } else if (response && response.status === 422 && data?.errors) {
      clearAlerts();
      for (const [name, message] of Object.entries(data.errors)) {
        $(`#sign-in-${name}-error`)?.replaceChildren(icon("alert"), h("span", { text: message }));
      }
    } else {
      showAlert("Sign-in is unavailable right now. Try again in a minute.");
    }
  });

  signOutButton.addEventListener("click", async () => {
    if (signOutButton.getAttribute("aria-disabled") === "true") return;
    say("Signing out…");
    signOutButton.setAttribute("aria-disabled", "true");
    let response;
    try {
      response = await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token()}` } });
    } catch {
      response = null;
    }
    signOutButton.removeAttribute("aria-disabled");
    say("");
    if (response && (response.status === 204 || response.status === 401)) {
      showSignIn("You have signed out.");
      emailBox.focus();
    } else {
      showAlert("Sign-out is unavailable right now. Try again in a minute.");
    }
  });

  if (token()) signedIn();
}

// Start ---------------------------------------------------------------------------------------------

setUpFocusKeeping();
setUpHeader();
setUpCookiePanel();
setUpStory();
setUpCarousel();
setUpStrip();
for (const section of $$("[data-list]")) setUpList(section);
setUpReturnLink();
setUpPartnerForm();
setUpReview();
