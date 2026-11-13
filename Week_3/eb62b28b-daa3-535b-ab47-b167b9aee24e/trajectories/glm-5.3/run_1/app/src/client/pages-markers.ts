import { el, api } from "./dom.js";
import { publicHeader, announcementsRegion, loadSession } from "./shell.js";
import { navigate } from "./router.js";
import { DURATIONS, animate, prefersReducedMotion } from "./motion.js";

type MarkerCategory = {
  id: string;
  name: string;
  markers: { id: string; name: string; unit: string; decimals: number }[];
};

const CATEGORY_ORDER = ["metabolic", "heart", "hormones", "kidneyLiver", "nutrients", "inflammationBlood"];

export async function markersPage(): Promise<HTMLElement> {
  const session = await loadSession();
  const params = new URLSearchParams(window.location.search);
  const openFromUrl = (params.get("open") ?? "").split(",").filter(Boolean);
  const qFromUrl = params.get("q") ?? "";

  const main = el("main", { class: "page markers-page" });
  main.append(el("h1", { class: "page-title" }, "Marker catalog"));

  const search = el("input", {
    type: "search",
    id: "marker-search",
    class: "input",
    "aria-label": "Search markers",
    placeholder: "Search markers",
    value: qFromUrl,
  });

  const searchField = el("div", { class: "field" });
  searchField.append(search);
  main.append(searchField);

  const list = el("div", { class: "accordion-list" });
  main.append(list);

  let activeQuery = qFromUrl;
  let searchSeq = 0;
  let debounce = 0;

  const renderCatalog = async (query: string, openIds: string[]): Promise<void> => {
    const seq = ++searchSeq;
    const path = query ? `/api/markers?q=${encodeURIComponent(query)}` : "/api/markers";
    const result = await api<{ categories: MarkerCategory[] }>(path);
    if (seq !== searchSeq) return; // a later search answered first; drop this one
    if (!result.ok) return;
    list.replaceChildren();
    for (const categoryId of CATEGORY_ORDER) {
      const category = result.data.categories.find((c) => c.id === categoryId);
      if (!category) continue;
      list.append(accordionFor(category, openIds.includes(category.id)));
    }
  };

  const accordionFor = (category: MarkerCategory, startOpen: boolean): HTMLElement => {
    const button = el("button", {
      type: "button",
      class: "accordion-header",
      "aria-expanded": String(startOpen),
      "aria-controls": `panel-${category.id}`,
      id: `header-${category.id}`,
    }, category.name);
    const panel = el("div", {
      class: "accordion-panel",
      id: `panel-${category.id}`,
      role: "region",
      "aria-labelledby": `header-${category.id}`,
    });
    const listNode = el("ul", { class: "marker-list" });
    for (const marker of category.markers) {
      listNode.append(el("li", { class: "marker-item" }, `${marker.name} (${marker.unit})`));
    }
    panel.append(listNode);
    let open = startOpen;
    const setOpenState = (value: boolean, animateIt: boolean) => {
      open = value;
      button.setAttribute("aria-expanded", String(value));
      if (value) {
        panel.hidden = false;
        if (animateIt && !prefersReducedMotion()) {
          const from = 0;
          const to = panel.scrollHeight;
          animate(panel, [{ height: `${from}px`, overflow: "hidden" }, { height: `${to}px`, overflow: "hidden" }], DURATIONS.medium).finished.finally(() => {
            panel.style.height = "";
            panel.style.overflow = "";
          });
        }
      } else {
        if (animateIt && !prefersReducedMotion()) {
          const from = panel.scrollHeight;
          const animation = animate(panel, [{ height: `${from}px`, overflow: "hidden" }, { height: "0px", overflow: "hidden" }], DURATIONS.medium);
          // SR9: controls leave the Tab order the moment it starts closing.
          panel.querySelectorAll<HTMLElement>("a, button, input, select, textarea").forEach((node) => {
            node.setAttribute("tabindex", "-1");
          });
          animation?.finished.finally(() => {
            panel.hidden = true;
            panel.style.height = "";
            panel.style.overflow = "";
            panel.querySelectorAll<HTMLElement>("[tabindex='-1']").forEach((node) => {
              node.removeAttribute("tabindex");
            });
          });
        } else {
          panel.hidden = true;
        }
      }
    };
    if (!startOpen) {
      panel.hidden = true;
    }
    button.addEventListener("click", () => {
      const nextOpen = !open;
      const currentOpen = CATEGORY_ORDER.filter((id) => {
        const header = document.getElementById(`header-${id}`);
        return header?.getAttribute("aria-expanded") === "true";
      });
      const openList = nextOpen
        ? Array.from(new Set([...currentOpen, category.id]))
        : currentOpen.filter((id) => id !== category.id);
      setOpenState(nextOpen, true);
      const search = new URLSearchParams(window.location.search);
      search.set("open", openList.join(","));
      if (activeQuery) search.set("q", activeQuery);
      window.history.pushState({}, "", `/markers?${search.toString()}`);
    });
    return el("div", { class: "accordion" }, button, panel);
  };

  search.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(async () => {
      activeQuery = (search as HTMLInputElement).value.trim();
      const params = new URLSearchParams();
      const currentOpen = CATEGORY_ORDER.filter((id) => {
        const header = document.getElementById(`header-${id}`);
        return header?.getAttribute("aria-expanded") === "true";
      });
      if (currentOpen.length > 0) params.set("open", currentOpen.join(","));
      if (activeQuery) params.set("q", activeQuery);
      window.history.pushState({}, "", `/markers${params.toString() ? `?${params.toString()}` : ""}`);
      await renderCatalog(activeQuery, currentOpen);
    }, 300);
  });

  await renderCatalog(qFromUrl, openFromUrl);

  const seePlans = el("a", { href: "/plans", class: "button primary" }, "See plans");
  return el(
    "div",
    { class: "screen" },
    publicHeader(session),
    announcementsRegion(),
    main,
    el("div", { class: "bottom-bar" }, seePlans),
  );
}

export async function joinPage(): Promise<HTMLElement> {
  const session = await loadSession();
  const main = el("main", { class: "page join-page narrow" });
  main.append(el("h1", { class: "page-title" }, "Create your free account"));

  const form = el("form", { class: "form", novalidate: true });
  const name = el("input", { type: "text", id: "name", class: "input", "aria-label": "Full name", autocomplete: "name" });
  const email = el("input", { type: "email", id: "email", class: "input", "aria-label": "Email", autocomplete: "email" });
  const password = el("input", { type: "password", id: "password", class: "input", "aria-label": "Password", autocomplete: "new-password" });
  const dateOfBirth = el("input", { type: "text", id: "dateOfBirth", class: "input", "aria-label": "Date of birth", placeholder: "YYYY-MM-DD" });
  const sexGroup = el("div", { class: "radio-row", role: "radiogroup", "aria-label": "Sex" });
  const female = el("input", { type: "radio", name: "sex", id: "sex-female", value: "female" });
  const male = el("input", { type: "radio", name: "sex", id: "sex-male", value: "male" });
  sexGroup.append(
    el("label", { class: "radio-option", for: "sex-female" }, female, el("span", {}, "Female")),
    el("label", { class: "radio-option", for: "sex-male" }, male, el("span", {}, "Male"))
  );
  const state = el("select", { id: "state", class: "input", "aria-label": "Home state" });
  const statesResult = await api<{ states: { state: string; name: string }[] }>("/api/states");
  if (statesResult.ok) {
    for (const entry of statesResult.data.states) {
      state.append(el("option", { value: entry.state }, entry.name));
    }
  }
  const timeZone = el("select", { id: "timeZone", class: "input", "aria-label": "Local time" });
  for (const [value, label] of [
    ["newYork", "New York time"],
    ["chicago", "Chicago time"],
    ["denver", "Denver time"],
    ["phoenix", "Phoenix time"],
    ["losAngeles", "Los Angeles time"],
  ] as const) {
    timeZone.append(el("option", { value }, label));
  }
  const submit = el("button", { type: "submit", class: "button primary" }, "Create account");
  form.append(
    el("label", { class: "field-label", for: "name" }, "Full name"), name,
    el("label", { class: "field-label", for: "email" }, "Email"), email,
    el("label", { class: "field-label", for: "password" }, "Password"), password,
    el("label", { class: "field-label", for: "dateOfBirth" }, "Date of birth"), dateOfBirth,
    el("span", { class: "field-label" }, "Sex"), sexGroup,
    el("label", { class: "field-label", for: "state" }, "Home state"), state,
    el("label", { class: "field-label", for: "timeZone" }, "Local time"), timeZone,
    submit
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.setAttribute("disabled", "");
    const response = await api<{ member: unknown }>("/api/accounts", {
      method: "POST",
      body: JSON.stringify({
        name: (name as HTMLInputElement).value,
        email: (email as HTMLInputElement).value,
        password: (password as HTMLInputElement).value,
        dateOfBirth: (dateOfBirth as HTMLInputElement).value,
        sex: document.querySelector<HTMLInputElement>("input[name='sex']:checked")?.value ?? "",
        state: (state as HTMLSelectElement).value,
        timeZone: (timeZone as HTMLSelectElement).value,
      }),
    });
    submit.removeAttribute("disabled");
    if (response.ok) {
      navigate("/me");
      return;
    }
    const announcements = document.getElementById("announcements");
    announcements?.replaceChildren(el("p", {}, response.message || "Something went wrong."));
  });

  main.append(form);
  const bottom = el("button", { type: "button", class: "button primary", onclick: () => form.requestSubmit() }, "Create account");
  return el(
    "div",
    { class: "screen" },
    publicHeader(session),
    announcementsRegion(),
    main,
    el("div", { class: "bottom-bar" }, bottom),
  );
}

export async function signInPage(): Promise<HTMLElement> {
  const session = await loadSession();
  const main = el("main", { class: "page signin-page narrow" });
  main.append(el("h1", { class: "page-title" }, "Sign in"));
  const form = el("form", { class: "form", novalidate: true });
  const email = el("input", { type: "email", id: "email", class: "input", "aria-label": "Email", autocomplete: "email" });
  const password = el("input", { type: "password", id: "password", class: "input", "aria-label": "Password", autocomplete: "current-password" });
  const submit = el("button", { type: "submit", class: "button primary" }, "Sign in");
  form.append(
    el("label", { class: "field-label", for: "email" }, "Email"), email,
    el("label", { class: "field-label", for: "password" }, "Password"), password,
    submit
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.setAttribute("disabled", "");
    const response = await api<{ home: string }>("/api/session", {
      method: "POST",
      body: JSON.stringify({
        email: (email as HTMLInputElement).value,
        password: (password as HTMLInputElement).value,
      }),
    });
    submit.removeAttribute("disabled");
    if (response.ok) {
      const destination = new URLSearchParams(window.location.search).get("next") ?? response.data.home;
      navigate(destination);
      window.location.reload();
      return;
    }
    const announcements = document.getElementById("announcements");
    announcements?.replaceChildren(el("p", {}, response.message || "Something went wrong."));
  });
  main.append(form);
  const bottom = el("button", { type: "button", class: "button primary", onclick: () => form.requestSubmit() }, "Sign in");
  return el(
    "div",
    { class: "screen" },
    publicHeader(session),
    announcementsRegion(),
    main,
    el("div", { class: "bottom-bar" }, bottom),
  );
}
