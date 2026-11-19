import { prefersReducedMotion, announce, focusScroll, setQueryParam } from "./util.js";
import { initCaseStudy } from "./case-study.js";
import { initEnquiryForm } from "./enquiry.js";
import { writeCarry, readCarry } from "./carry.js";
import { recordHeroFly, applyHeroFly, replaceMainWith } from "./spa.js";
const HEADER_HEIGHT = 64;
function headingFor(id) {
    const section = document.getElementById(id);
    if (!section)
        return null;
    return (section.querySelector("h1, h2") ?? section);
}
function jumpToSection(id) {
    const section = document.getElementById(id);
    const heading = headingFor(id);
    if (!section || !heading)
        return;
    const top = section.getBoundingClientRect().top + window.scrollY - HEADER_HEIGHT - 16;
    const settle = () => {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
    };
    if (prefersReducedMotion()) {
        window.scrollTo(0, Math.max(0, top));
        settle();
        return;
    }
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    window.setTimeout(settle, 600);
}
function initSkipLink() {
    document.querySelector(".skip-link")?.addEventListener("click", (event) => {
        event.preventDefault();
        const heading = document.querySelector("main h1");
        if (heading) {
            focusScroll(heading);
            heading.setAttribute("tabindex", "-1");
            heading.focus({ preventScroll: true });
        }
    });
}
function initSectionLinks() {
    document.addEventListener("click", (event) => {
        const link = event.target?.closest("a[href]");
        if (!link)
            return;
        const href = link.getAttribute("href") ?? "";
        if (href.startsWith("/#")) {
            if (window.location.pathname !== "/")
                return;
            event.preventDefault();
            const id = href.slice(2);
            jumpToSection(id);
            window.history.replaceState(null, "", `/#${id}`);
        }
        else if (href.startsWith("#") && href.length > 1) {
            const id = href.slice(1);
            if (!document.getElementById(id))
                return;
            event.preventDefault();
            jumpToSection(id);
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
        }
    });
}
function initHashLoad() {
    const id = window.location.hash.slice(1);
    if (!id)
        return;
    const section = document.getElementById(id);
    const heading = headingFor(id);
    if (!section || !heading)
        return;
    const top = section.getBoundingClientRect().top + window.scrollY - HEADER_HEIGHT - 16;
    window.scrollTo(0, Math.max(0, top));
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
}
const SECTION_IDS = ["about", "services", "work", "philosophy", "contact"];
function updateCurrentSection() {
    if (window.location.pathname !== "/")
        return;
    const probe = window.innerHeight * 0.4;
    let current = null;
    for (const id of SECTION_IDS) {
        const section = document.getElementById(id);
        if (!section)
            continue;
        const rect = section.getBoundingClientRect();
        if (rect.top <= probe && rect.bottom > probe)
            current = id;
    }
    const intro = document.getElementById("intro");
    if (intro) {
        const rect = intro.getBoundingClientRect();
        if (rect.top <= probe && rect.bottom > probe)
            current = null;
    }
    document.querySelectorAll('[aria-current="true"]').forEach((element) => element.removeAttribute("aria-current"));
    if (!current)
        return;
    document
        .querySelectorAll(`.main-nav a[href="/#${current}"], .menu-panel a[href="/#${current}"]`)
        .forEach((link) => link.setAttribute("aria-current", "true"));
}
function initCurrentSection() {
    let ticking = false;
    const onScroll = () => {
        if (ticking)
            return;
        ticking = true;
        window.requestAnimationFrame(() => {
            updateCurrentSection();
            ticking = false;
        });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    updateCurrentSection();
}
function initMenu() {
    const button = document.querySelector(".menu-button");
    const dialog = document.querySelector(".menu-dialog");
    if (!button || !dialog)
        return;
    const panel = dialog.querySelector(".menu-panel");
    if (!panel)
        return;
    const openMenu = () => {
        dialog.hidden = false;
        dialog.removeAttribute("data-closing");
        button.setAttribute("aria-expanded", "true");
        panel.querySelector("nav a")?.focus();
    };
    const closeMenu = () => {
        dialog.hidden = true;
        dialog.removeAttribute("data-closing");
        button.setAttribute("aria-expanded", "false");
        button.focus();
    };
    const requestClose = () => {
        if (prefersReducedMotion()) {
            closeMenu();
            return;
        }
        dialog.setAttribute("data-closing", "true");
        window.setTimeout(closeMenu, 280);
    };
    button.addEventListener("click", () => {
        if (dialog.hidden)
            openMenu();
    });
    panel.querySelector(".menu-close")?.addEventListener("click", requestClose);
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog)
            requestClose();
    });
    document.addEventListener("keydown", (event) => {
        if (dialog.hidden)
            return;
        if (event.key === "Escape") {
            event.preventDefault();
            requestClose();
            return;
        }
        if (event.key !== "Tab")
            return;
        const focusable = Array.from(dialog.querySelectorAll(".menu-panel a[href], .menu-panel button"));
        if (focusable.length === 0)
            return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === null)) {
            event.preventDefault();
            last.focus();
        }
        else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    });
    panel.querySelectorAll("nav a").forEach((link) => {
        link.addEventListener("click", () => {
            closeMenu();
            const href = link.getAttribute("href") ?? "";
            const id = href.startsWith("/#") ? href.slice(2) : href.slice(1);
            jumpToSection(id);
        });
    });
}
function initTabs(selector) {
    const tablist = document.querySelector(selector);
    if (!tablist)
        return;
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    if (tabs.length === 0)
        return;
    const select = (index, focus = true) => {
        tabs.forEach((tab, i) => {
            const selected = i === index;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
            const panel = tab.getAttribute("aria-controls");
            const element = panel ? document.getElementById(panel) : null;
            if (element)
                element.hidden = !selected;
        });
        if (focus)
            tabs[index]?.focus();
    };
    tablist.addEventListener("keydown", (event) => {
        const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
        const count = tabs.length;
        let next = null;
        if (event.key === "ArrowRight")
            next = (current + 1) % count;
        else if (event.key === "ArrowLeft")
            next = (current - 1 + count) % count;
        else if (event.key === "Home")
            next = 0;
        else if (event.key === "End")
            next = count - 1;
        if (next === null)
            return;
        event.preventDefault();
        select(next);
    });
    tablist.addEventListener("click", (event) => {
        const tab = event.target.closest('[role="tab"]');
        if (!tab)
            return;
        select(tabs.indexOf(tab), false);
    });
}
function initServices() {
    const buttons = Array.from(document.querySelectorAll(".service-button"));
    if (buttons.length === 0)
        return;
    const services = buttons.map((button) => button.closest(".service"));
    const animateHeight = (panel, opening) => {
        const duration = 320;
        if (prefersReducedMotion()) {
            if (opening) {
                panel.hidden = false;
            }
            else {
                panel.hidden = true;
            }
            return;
        }
        if (opening) {
            panel.hidden = false;
            panel.style.overflow = "hidden";
            panel.style.height = "0px";
            const target = panel.scrollHeight;
            const start = performance.now();
            const step = (now) => {
                const t = Math.min(1, (now - start) / duration);
                panel.style.height = `${target * (1 - Math.pow(1 - t, 3))}px`;
                if (t < 1) {
                    window.requestAnimationFrame(step);
                }
                else {
                    panel.style.height = "";
                    panel.style.overflow = "";
                }
            };
            window.requestAnimationFrame(step);
        }
        else {
            const startHeight = panel.scrollHeight;
            panel.style.overflow = "hidden";
            const start = performance.now();
            const step = (now) => {
                const t = Math.min(1, (now - start) / duration);
                panel.style.height = `${startHeight * Math.pow(1 - t, 3)}px`;
                if (t < 1) {
                    window.requestAnimationFrame(step);
                }
                else {
                    panel.hidden = true;
                    panel.style.height = "";
                    panel.style.overflow = "";
                }
            };
            window.requestAnimationFrame(step);
        }
    };
    buttons.forEach((button, index) => {
        button.addEventListener("click", () => {
            const isOpen = button.getAttribute("aria-expanded") === "true";
            const serviceId = services[index]?.dataset.service ?? "";
            if (isOpen) {
                button.setAttribute("aria-expanded", "false");
                const panel = services[index]?.querySelector(".service-panel");
                if (panel)
                    animateHeight(panel, false);
                setQueryParam("service", null);
            }
            else {
                buttons.forEach((other, otherIndex) => {
                    if (otherIndex !== index && other.getAttribute("aria-expanded") === "true") {
                        other.setAttribute("aria-expanded", "false");
                        const panel = services[otherIndex]?.querySelector(".service-panel");
                        if (panel)
                            animateHeight(panel, false);
                    }
                });
                button.setAttribute("aria-expanded", "true");
                const panel = services[index]?.querySelector(".service-panel");
                if (panel)
                    animateHeight(panel, true);
                setQueryParam("service", serviceId);
            }
        });
        button.addEventListener("keydown", (event) => {
            const count = buttons.length;
            let next = null;
            if (event.key === "ArrowDown")
                next = (index + 1) % count;
            else if (event.key === "ArrowUp")
                next = (index - 1 + count) % count;
            else if (event.key === "Home")
                next = 0;
            else if (event.key === "End")
                next = count - 1;
            if (next === null)
                return;
            event.preventDefault();
            buttons[next].focus();
        });
    });
    const openFocus = document.querySelector("[data-open-focus]");
    if (openFocus) {
        focusScroll(openFocus);
        openFocus.focus();
    }
}
function initWorkFilter() {
    const fieldset = document.querySelector(".work-filter");
    const list = document.querySelector(".work-list");
    const empty = document.querySelector("[data-empty]");
    if (!fieldset || !list)
        return;
    const radios = Array.from(fieldset.querySelectorAll('input[type="radio"]'));
    if (radios.length === 0)
        return;
    const labelFor = (value) => {
        if (value === "all")
            return null;
        const label = fieldset.querySelector(`input[value="${value}"]`)?.closest("label")?.textContent ?? "";
        return label.replace(/\(\d+\)/, "").trim();
    };
    const apply = (value, byUser) => {
        const name = labelFor(value);
        let visible = 0;
        Array.from(list.querySelectorAll(".work-item")).forEach((item) => {
            const match = value === "all" || item.dataset.category === value;
            item.hidden = !match;
            if (match)
                visible += 1;
        });
        list.hidden = visible === 0;
        if (empty) {
            empty.hidden = visible > 0;
            if (visible === 0 && name)
                empty.textContent = `No projects in ${name} yet.`;
        }
        if (!byUser)
            return;
        if (value === "all") {
            announce(`Showing ${visible} projects.`);
        }
        else if (visible === 0) {
            announce(`No projects in ${name} yet.`);
        }
        else if (visible === 1) {
            announce(`Showing 1 project in ${name}.`);
        }
        else {
            announce(`Showing ${visible} projects in ${name}.`);
        }
        setQueryParam("category", value === "all" ? null : value);
        const suffix = value === "all" ? "" : `?category=${value}`;
        Array.from(list.querySelectorAll("[data-work-link]")).forEach((link) => {
            const slug = link.closest(".work-item")?.dataset.project ?? "";
            link.setAttribute("href", `/work/${slug}${suffix}`);
        });
        if (!prefersReducedMotion() && visible > 0) {
            list.classList.remove("fade-in");
            void list.offsetWidth;
            list.classList.add("fade-in");
        }
    };
    radios.forEach((radio) => {
        radio.addEventListener("change", () => apply(radio.value, true));
    });
    fieldset.addEventListener("keydown", (event) => {
        const current = radios.findIndex((radio) => radio.checked);
        const count = radios.length;
        let next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown")
            next = (current + 1) % count;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
            next = (current - 1 + count) % count;
        if (next === null)
            return;
        event.preventDefault();
        radios[next].checked = true;
        apply(radios[next].value, true);
    });
}
function initReveals() {
    if (prefersReducedMotion()) {
        document.querySelectorAll(".reveal-heading").forEach((element) => {
            element.classList.remove("reveal-heading");
        });
        return;
    }
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add("is-revealed");
                observer.unobserve(entry.target);
            }
        }
    }, { rootMargin: "0px 0px -15% 0px" });
    document.querySelectorAll(".reveal-heading").forEach((heading) => observer.observe(heading));
}
function initCoverReveal() {
    if (prefersReducedMotion())
        return;
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting)
                continue;
            const cover = entry.target;
            const svg = cover.querySelector("svg");
            if (svg && !cover.querySelector(".cover-reveal")) {
                const wrap = document.createElement("span");
                wrap.className = "cover-reveal is-revealed";
                cover.insertBefore(wrap, svg);
                wrap.appendChild(svg);
            }
            observer.unobserve(cover);
        }
    }, { rootMargin: "0px 0px -10% 0px" });
    document.querySelectorAll(".work-cover").forEach((cover) => observer.observe(cover));
}
function initParallax() {
    const plate = document.querySelector("[data-parallax]");
    if (!plate || prefersReducedMotion())
        return;
    const update = () => {
        const shift = Math.round(0.25 * Math.min(window.scrollY, 800));
        plate.style.transform = `translateY(${shift}px)`;
    };
    window.addEventListener("scroll", update, { passive: true });
}
function initCount() {
    const counters = Array.from(document.querySelectorAll("[data-count]"));
    const tablist = document.querySelector('[role="tablist"][aria-label="Statistics"]');
    if (counters.length === 0 || !tablist)
        return;
    const run = () => {
        if (prefersReducedMotion()) {
            counters.forEach((element) => {
                element.textContent = Number(element.dataset.value).toLocaleString("en-US");
            });
            return;
        }
        const started = performance.now();
        const step = (now) => {
            const t = now - started;
            for (const element of counters) {
                const value = Number(element.dataset.value);
                if (t >= 1200) {
                    element.textContent = value.toLocaleString("en-US");
                }
                else {
                    const eased = 1 - Math.pow(1 - t / 1200, 3);
                    element.textContent = Math.round(value * eased).toLocaleString("en-US");
                }
            }
            if (t < 1200)
                window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                run();
                observer.disconnect();
            }
        }
    }, { threshold: 0.1 });
    observer.observe(tablist);
}
function initFocusClear() {
    document.addEventListener("focusin", (event) => {
        const element = event.target;
        if (element.closest(".site-header") || element.closest(".menu-dialog") || element.closest(".skip-link"))
            return;
        const rect = element.getBoundingClientRect();
        if (rect.top < HEADER_HEIGHT + 8) {
            window.requestAnimationFrame(() => {
                const current = element.getBoundingClientRect();
                if (current.top < HEADER_HEIGHT + 8) {
                    window.scrollTo(0, Math.max(0, current.top + window.scrollY - HEADER_HEIGHT - 8));
                }
            });
        }
    });
}
function initWorkLinks() {
    document.querySelectorAll("[data-work-link]").forEach((link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();
            const item = link.closest(".work-item");
            const slug = item?.dataset.project ?? "";
            const items = Array.from(document.querySelectorAll(".work-item"));
            const index = items.findIndex((candidate) => candidate.dataset.project === slug);
            writeCarry({ fromSlug: slug, tileIndex: index });
            const cover = item?.querySelector("[data-cover]") ?? null;
            if (cover)
                recordHeroFly(cover.getBoundingClientRect());
            void replaceMainWith(link.href).then(() => {
                const hero = document.querySelector("[data-hero]");
                if (hero)
                    applyHeroFly(hero);
                initCaseStudy();
            });
        });
    });
}
function initCategoryLinks() {
    document.querySelectorAll("[data-category-link]").forEach((link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();
            const category = link.dataset.categoryLink ?? "";
            const radio = document.querySelector(`.work-filter input[value="${category}"]`);
            if (radio && !radio.checked) {
                radio.checked = true;
                radio.dispatchEvent(new Event("change", { bubbles: true }));
            }
            setQueryParam("category", category);
            jumpToSection("work");
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#work`);
        });
    });
}
function initTypeLinks() {
    document.querySelectorAll("[data-type-link]").forEach((link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();
            const type = link.dataset.typeLink ?? "";
            setQueryParam("type", type);
            const radio = document.querySelector(`.enquiry-form input[value="${type}"]`);
            if (radio)
                radio.checked = true;
            jumpToSection("contact");
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#contact`);
            window.setTimeout(() => {
                document.querySelector("#name")?.focus();
            }, prefersReducedMotion() ? 0 : 620);
        });
    });
}
function initPopstate() {
    window.addEventListener("popstate", () => {
        if (window.location.pathname === "/") {
            void restoreHome();
            return;
        }
        if (window.location.pathname.startsWith("/work/")) {
            void replaceMainWith(window.location.href, false).then(() => {
                const newHero = document.querySelector("[data-hero]");
                if (newHero && !prefersReducedMotion()) {
                    newHero.classList.add("hero-slide-in-next");
                }
                initCaseStudy();
            });
        }
    });
}
function restoreHome() {
    return fetch(window.location.href)
        .then((response) => response.text())
        .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const newMain = doc.querySelector("main");
        const currentMain = document.querySelector("main");
        if (!newMain || !currentMain) {
            window.location.reload();
            return;
        }
        currentMain.replaceWith(newMain);
        document.title = doc.title;
        initTileRestore();
    });
}
function initTileRestore() {
    const carry = readCarry();
    if (!carry || window.location.pathname !== "/")
        return;
    const item = document.querySelector(`.work-item[data-project="${carry.fromSlug}"]`);
    const link = item?.querySelector("[data-work-link]");
    if (!item || !link)
        return;
    const rect = item.getBoundingClientRect();
    window.setTimeout(() => {
        item.scrollIntoView({ block: "start" });
        const top = rect.top + window.scrollY - HEADER_HEIGHT - 8;
        window.scrollTo(0, Math.max(0, top));
        link.focus({ preventScroll: true });
    }, prefersReducedMotion() ? 0 : 60);
}
function boot() {
    initSkipLink();
    initSectionLinks();
    initHashLoad();
    initCurrentSection();
    initMenu();
    initTabs(".stat-tabs");
    initTabs(".process-tabs");
    initServices();
    initWorkFilter();
    initReveals();
    initCoverReveal();
    initParallax();
    initCount();
    initFocusClear();
    initWorkLinks();
    initCategoryLinks();
    initTypeLinks();
    initPopstate();
    initTileRestore();
    initCaseStudy();
    initEnquiryForm();
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
}
else {
    boot();
}
