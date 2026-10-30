// Ivo Kastrel: plain-JavaScript enhancements over the server-rendered pages.
const root = document.documentElement;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/* Motion toggle, reduced motion and the intro cover ------------------------------------------------------- */

const motionButton = document.querySelector(".motion-toggle");
const statement = document.querySelector(".statement");
const hero = document.getElementById("hero");
let slideFrame = 0;
let slide = "";

function finishIntro() {
  root.classList.remove("intro", "intro-lift");
}

// Read the scroll position every frame rather than on scroll events, which arrive late or not at all
// when a scroll lands between frames; the line then always matches where the page stands.
function slideStatement() {
  const progress = Math.min(scrollY / (hero.offsetTop + hero.offsetHeight), 1);
  const next = `${(-progress * innerWidth * 0.25).toFixed(2)}px`;
  if (next !== slide) statement.style.setProperty("--slide", (slide = next));
  slideFrame = requestAnimationFrame(slideStatement);
}

function followScroll() {
  cancelAnimationFrame(slideFrame);
  statement.style.removeProperty("--slide");
  slide = "";
  if (root.classList.contains("motion")) slideStatement();
}

function applyMotion() {
  const chosen = !root.classList.contains("motion-off");
  root.classList.toggle("motion", chosen && !reducedMotion.matches);
  motionButton?.setAttribute("aria-pressed", String(chosen));
  if (!root.classList.contains("motion")) finishIntro();
  if (statement) followScroll();
}

motionButton?.addEventListener("click", () => {
  const turningOff = !root.classList.contains("motion-off");
  root.classList.toggle("motion-off", turningOff);
  try {
    localStorage.setItem("ik-motion", turningOff ? "off" : "on");
  } catch {
    // Storage is blocked: the choice lasts for this page only.
  }
  applyMotion();
});
reducedMotion.addEventListener("change", applyMotion);
applyMotion();

if (root.classList.contains("intro")) {
  setTimeout(() => root.classList.add("intro-lift"), 900);
  setTimeout(finishIntro, 1700);
}

/* Split heading reveals, unveils and loops that run only in view ----------------------------------------- */

function splitWords(heading) {
  const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  let index = 0;
  for (const text of texts) {
    const fragment = document.createDocumentFragment();
    for (const part of text.textContent.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        fragment.append(part);
        continue;
      }
      const word = document.createElement("span");
      word.className = "word";
      word.style.setProperty("--i", String(Math.min(index, 8)));
      word.textContent = part;
      index += 1;
      fragment.append(word);
    }
    text.replaceWith(fragment);
  }
}

const revealer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add("is-in");
    revealer.unobserve(entry.target);
  }
}, { rootMargin: "0px 0px -8% 0px" });

for (const heading of document.querySelectorAll("[data-split]")) {
  splitWords(heading);
  revealer.observe(heading);
}
for (const element of document.querySelectorAll("[data-unveil]")) revealer.observe(element);

const liveWatcher = new IntersectionObserver((entries) => {
  for (const entry of entries) entry.target.classList.toggle("is-live", entry.isIntersecting);
});
for (const chapter of document.querySelectorAll("[data-live]")) liveWatcher.observe(chapter);

/* Menu ---------------------------------------------------------------------------------------------------- */

const menuButton = document.querySelector(".menu-button");
const mainNav = document.getElementById("main-nav");

function setMenu(open) {
  menuButton.setAttribute("aria-expanded", String(open));
  mainNav.classList.toggle("is-open", open);
}

if (menuButton) {
  menuButton.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  mainNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) setMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setMenu(false);
      menuButton.focus();
    }
  });
}

/* Inquiry forms (home, /contact and the Let's Connect panel) --------------------------------------------- */

const THANKS = "Thanks, your message is in. I reply within two working days.";

function clearInquiryErrors(form) {
  form.querySelector('[role="alert"]').replaceChildren();
  for (const field of form.querySelectorAll("[aria-invalid]")) field.removeAttribute("aria-invalid");
  for (const message of form.querySelectorAll(".field-error")) message.textContent = "";
}

function showInquiryErrors(form, title, errors = {}) {
  const items = [];
  for (const [name, message] of Object.entries(errors)) {
    const field = form.elements.namedItem(name);
    field.setAttribute("aria-invalid", "true");
    document.getElementById(`${field.id}-error`).textContent = message;
    const link = document.createElement("a");
    link.href = `#${field.id}`;
    link.textContent = `${field.labels[0].textContent}: ${message}`;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      field.focus();
    });
    const item = document.createElement("li");
    item.append(link);
    items.push(item);
  }
  const heading = document.createElement("h3");
  heading.className = "form-errors-title";
  heading.textContent = title;
  const list = document.createElement("ul");
  list.append(...items);
  form.querySelector('[role="alert"]').replaceChildren(heading, ...(items.length ? [list] : []));
}

function resetInquiry(form) {
  form.reset();
  clearInquiryErrors(form);
  form.querySelector('[role="status"]').replaceChildren();
  form.querySelector("[data-fields]").hidden = false;
  form.querySelector(".submit").disabled = false;
}

async function sendInquiry(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector(".submit");
  const status = form.querySelector('[role="status"]');
  const inquiry = Object.fromEntries(new FormData(form));
  if (!inquiry.project_type) delete inquiry.project_type;
  clearInquiryErrors(form);
  submit.disabled = true;
  status.textContent = "Sending your message…";
  let response = null;
  try {
    response = await fetch("/api/inquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(inquiry),
    });
  } catch {
    // The network failed: reported below like an outage.
  }
  submit.disabled = false;
  status.replaceChildren();
  if (response?.ok) {
    form.querySelector("[data-fields]").hidden = true;
    const thanks = document.createElement("p");
    thanks.className = "thanks";
    thanks.tabIndex = -1;
    thanks.textContent = THANKS;
    status.append(thanks);
    thanks.focus();
  } else if (response?.status === 422) {
    showInquiryErrors(form, "Check the highlighted fields.", (await response.json()).errors);
  } else {
    showInquiryErrors(form, "Your message could not be sent. Try again in a minute.");
  }
}

for (const form of document.querySelectorAll("[data-inquiry]")) form.addEventListener("submit", sendInquiry);

/* Let's Connect panel: a modal dialog that keeps Tab inside and returns focus to its opener ----------------- */

const panel = document.getElementById("connect-panel");
let panelOpener = null;

function panelFocusables() {
  return [...panel.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].filter(
    (element) => element.tabIndex >= 0 && !element.disabled && !element.closest("[hidden]"));
}

if (panel) {
  for (const opener of document.querySelectorAll("[data-connect]")) {
    opener.addEventListener("click", () => {
      panelOpener = opener;
      resetInquiry(panel.querySelector("[data-inquiry]"));
      panel.showModal();
      panel.querySelector('[name="name"]').focus();
    });
  }
  panel.querySelector("[data-close]").addEventListener("click", () => panel.close());
  panel.addEventListener("close", () => panelOpener?.focus());
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      panel.close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = panelFocusables();
    const edge = event.shiftKey ? items[0] : items[items.length - 1];
    if (!items.includes(document.activeElement) || document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  });
}

/* Discipline filter: updates the list in place and keeps the address, Back and Forward in step ----------- */

const filterNav = document.querySelector("[data-filter]");

async function showCatalogue(url, remember) {
  try {
    const response = await fetch(url, { headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error(`catalogue answered ${response.status}`);
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const catalogue = page.querySelector("[data-catalogue]");
    for (const element of catalogue.querySelectorAll("[data-unveil]")) element.classList.add("is-in");
    document.querySelector("[data-catalogue]").replaceWith(catalogue);
    filterNav.replaceChildren(...page.querySelector("[data-filter]").childNodes);
    document.querySelector("[data-count]").textContent = page.querySelector("[data-count]").textContent;
    if (remember) history.pushState(null, "", response.url);
  } catch {
    location.assign(url);
  }
}

if (filterNav) {
  filterNav.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (link.href !== location.href) showCatalogue(link.href, true);
  });
  addEventListener("popstate", () => showCatalogue(location.href, false));
}
