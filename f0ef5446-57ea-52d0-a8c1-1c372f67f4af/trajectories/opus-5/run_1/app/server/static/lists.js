/* Relayo: category filters, press paging and the safe return to a list. */
(function () {
  "use strict";

  const RETURN_KEY = "relayo:return-focus";
  const LOADING = "Loading…";
  const OUTAGE = "This list is unavailable right now. Try again in a minute.";
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const data = readPageData();
  const nav = document.getElementById("filter-nav");
  const region = document.getElementById("list-region");
  const results = document.getElementById("results");
  const alertSlot = document.getElementById("list-alert");
  const paging = document.getElementById("paging");
  const previousButton = document.getElementById("press-previous");
  const moreButton = document.getElementById("press-more");
  const pageIndicator = document.getElementById("page-indicator");
  const backLink = document.getElementById("back-link");

  function readPageData() {
    const node = document.getElementById("page-data");
    if (!node) return {};
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (error) {
      return {};
    }
  }

  /* ---------- returning from a detail page ---------- */

  if (backLink) {
    backLink.addEventListener("click", function () {
      try {
        window.sessionStorage.setItem(
          RETURN_KEY,
          JSON.stringify({ list: data.list, slug: data.slug })
        );
      } catch (error) {
        /* a tab without session storage simply lands on the list */
      }
    });
  }

  function restoreReturnFocus() {
    if (!nav || !data.list) return;
    let wanted = null;
    try {
      const raw = window.sessionStorage.getItem(RETURN_KEY);
      if (raw) wanted = JSON.parse(raw);
      window.sessionStorage.removeItem(RETURN_KEY);
    } catch (error) {
      return;
    }
    if (!wanted || wanted.list !== data.list) return;
    const card = region.querySelector('[data-slug="' + cssEscape(wanted.slug) + '"]');
    const target = card || nav.querySelector("a");
    if (!target) return;
    target.focus();
    if (window.relayoEnsureVisible) window.relayoEnsureVisible(card || target);
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  /* ---------- shared list state ---------- */

  const state = {
    list: data.list || null,
    category: data.category === undefined ? null : data.category,
    page: data.page || 1,
    cursors: {},
    hasNext: Boolean(data.hasNext),
    sequence: 0,
    loading: false,
  };

  if (state.list === "press") {
    (data.cursors || []).forEach(function (cursor, position) {
      state.cursors[cursorKey(state.category, position + 1)] = cursor;
    });
  }

  function cursorKey(category, page) {
    return (category === null ? "" : category) + "|" + page;
  }

  function formatDate(value) {
    const parts = String(value).slice(0, 10).split("-");
    if (parts.length !== 3) return String(value);
    return Number(parts[2]) + " " + MONTHS[Number(parts[1]) - 1] + " " + parts[0];
  }

  function countCopy(count) {
    if (state.list === "integrations") {
      return count + (count === 1 ? " integration" : " integrations");
    }
    if (state.list === "blog") {
      return count + (count === 1 ? " article" : " articles");
    }
    return count + (count === 1 ? " press item" : " press items");
  }

  function announce(text) {
    if (results) results.textContent = text;
  }

  function clearAlert() {
    if (alertSlot) alertSlot.replaceChildren();
  }

  function showOutage() {
    if (!alertSlot) return;
    const box = document.createElement("div");
    box.className = "alert";
    box.setAttribute("role", "alert");
    box.textContent = OUTAGE;
    alertSlot.replaceChildren(box);
  }

  function listAddress(category, page) {
    const query = new URLSearchParams();
    if (category !== null && category !== undefined) query.set("category", category);
    if (state.list === "press" && page && page > 1) query.set("page", String(page));
    const base = state.list === "integrations" ? "/integrations"
      : state.list === "blog" ? "/blog" : "/press";
    const text = query.toString();
    return text ? base + "?" + text : base;
  }

  function markCurrent(category) {
    if (!nav) return;
    Array.prototype.forEach.call(nav.querySelectorAll("a"), function (link) {
      const url = new URL(link.getAttribute("href"), window.location.origin);
      const linkCategory = url.searchParams.get("category");
      const matches = (linkCategory === null ? null : linkCategory) ===
        (category === null || category === undefined ? null : category);
      if (matches) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }

  function setPagingDisabled(disabled) {
    [previousButton, moreButton].forEach(function (button) {
      if (!button) return;
      if (disabled) button.setAttribute("aria-disabled", "true");
      else button.removeAttribute("aria-disabled");
    });
  }

  function refreshPagingState() {
    if (!paging) return;
    if (previousButton) {
      if (state.page <= 1) previousButton.setAttribute("aria-disabled", "true");
      else previousButton.removeAttribute("aria-disabled");
    }
    if (moreButton) {
      if (!state.hasNext) moreButton.setAttribute("aria-disabled", "true");
      else moreButton.removeAttribute("aria-disabled");
    }
    if (pageIndicator) pageIndicator.textContent = "Page " + state.page;
  }

  async function fetchJson(path) {
    const response = await fetch(path, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("list request answered " + response.status);
    return response.json();
  }

  /* ---------- rendering ---------- */

  function emptyState() {
    const box = document.createElement("div");
    box.className = "empty-state";
    const line = document.createElement("p");
    const link = document.createElement("a");
    if (state.list === "integrations") {
      line.textContent = "No integrations match this category.";
      link.href = "/integrations";
      link.textContent = "Show all integrations";
    } else if (state.list === "blog") {
      line.textContent = "No articles match this category.";
      link.href = "/blog";
      link.textContent = "Show all articles";
    } else if (state.page > 1) {
      line.textContent = "No press items on this page.";
      link.href = "/press";
      link.textContent = "Show all press";
    } else {
      line.textContent = "No press items match this category.";
      link.href = "/press";
      link.textContent = "Show all press";
    }
    box.append(line, link);
    return box;
  }

  function returnTo() {
    return encodeURIComponent(listAddress(state.category, state.page));
  }

  function integrationCard(item) {
    const card = document.createElement("li");
    card.className = "card";
    const icon = document.createElement("img");
    icon.className = "card-icon";
    icon.src = item.icon_ref;
    icon.alt = "";
    icon.width = 48;
    icon.height = 48;
    const title = document.createElement("h2");
    title.className = "card-title";
    const link = document.createElement("a");
    link.href = "/integration/" + item.slug + "?from=" + returnTo();
    link.textContent = item.name;
    link.setAttribute("data-slug", item.slug);
    title.append(link);
    const meta = document.createElement("p");
    meta.className = "card-meta";
    meta.textContent = item.category;
    const text = document.createElement("p");
    text.className = "card-text";
    text.textContent = item.description;
    card.append(icon, title, meta, text);
    return card;
  }

  function articleCard(item) {
    const card = document.createElement("li");
    card.className = "card card-media";
    const cover = document.createElement("img");
    cover.className = "card-cover";
    cover.src = item.cover_ref;
    cover.alt = "";
    cover.width = 320;
    cover.height = 168;
    const meta = document.createElement("p");
    meta.className = "card-meta";
    meta.textContent = item.category;
    const title = document.createElement("h2");
    title.className = "card-title";
    const link = document.createElement("a");
    link.href = "/blog/" + item.slug + "?from=" + returnTo();
    link.textContent = item.title;
    link.setAttribute("data-slug", item.slug);
    title.append(link);
    const text = document.createElement("p");
    text.className = "card-text";
    text.textContent = item.summary;
    const byline = document.createElement("p");
    byline.className = "card-byline";
    byline.textContent =
      item.author + " · " + formatDate(item.published_at) + " · " + item.read_time + " min read";
    card.append(cover, meta, title, text, byline);
    return card;
  }

  function pressItem(item) {
    const entry = document.createElement("li");
    entry.className = "press-item";
    const dateLine = document.createElement("p");
    dateLine.className = "press-date";
    const time = document.createElement("time");
    time.setAttribute("datetime", item.date);
    time.textContent = formatDate(item.date);
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = item.category;
    dateLine.append(time, tag);
    const headline = document.createElement("h2");
    headline.className = "press-headline";
    const link = document.createElement("a");
    link.href = item.link;
    link.textContent = item.headline;
    headline.append(link);
    entry.append(dateLine, headline);
    return entry;
  }

  function renderItems(items) {
    if (!items.length) {
      region.replaceChildren(emptyState());
      return;
    }
    const list = document.createElement("ul");
    if (state.list === "press") {
      list.className = "press-list";
      list.id = "press-list";
      list.setAttribute("aria-label", "Press items");
      items.forEach(function (item) {
        list.append(pressItem(item));
      });
    } else if (state.list === "blog") {
      list.className = "card-grid";
      list.id = "article-list";
      list.setAttribute("aria-label", "Articles");
      items.forEach(function (item) {
        list.append(articleCard(item));
      });
    } else {
      list.className = "card-grid";
      list.id = "integration-list";
      list.setAttribute("aria-label", "Integrations");
      items.forEach(function (item) {
        list.append(integrationCard(item));
      });
    }
    region.replaceChildren(list);
  }

  /* ---------- loading ---------- */

  async function loadIntegrations(category) {
    const query = new URLSearchParams();
    if (category !== null) query.set("category", category);
    const text = query.toString();
    const payload = await fetchJson("/api/integrations" + (text ? "?" + text : ""));
    return { items: payload.items };
  }

  async function loadBlog(category) {
    const items = [];
    let cursor = null;
    for (;;) {
      const query = new URLSearchParams({ limit: "50" });
      if (category !== null) query.set("category", category);
      if (cursor) query.set("cursor", cursor);
      const payload = await fetchJson("/api/blog?" + query.toString());
      payload.items.forEach(function (item) {
        items.push(item);
      });
      if (!payload.next_cursor) break;
      cursor = payload.next_cursor;
    }
    return { items: items };
  }

  async function pressCursorFor(category, page) {
    if (page <= 1) return null;
    const known = state.cursors[cursorKey(category, page)];
    if (known !== undefined) return known;
    let cursor = null;
    for (let step = 1; step < page; step += 1) {
      const query = new URLSearchParams({ limit: "10" });
      if (category !== null) query.set("category", category);
      if (cursor) query.set("cursor", cursor);
      const payload = await fetchJson("/api/press?" + query.toString());
      state.cursors[cursorKey(category, step)] = cursor;
      if (!payload.next_cursor) return undefined;
      cursor = payload.next_cursor;
      state.cursors[cursorKey(category, step + 1)] = cursor;
    }
    return cursor;
  }

  async function loadPress(category, page) {
    const cursor = await pressCursorFor(category, page);
    if (cursor === undefined) return { items: [], hasNext: false };
    const query = new URLSearchParams({ limit: "10" });
    if (category !== null) query.set("category", category);
    if (cursor) query.set("cursor", cursor);
    const payload = await fetchJson("/api/press?" + query.toString());
    if (payload.next_cursor) {
      state.cursors[cursorKey(category, page + 1)] = payload.next_cursor;
    }
    return { items: payload.items, hasNext: Boolean(payload.next_cursor) };
  }

  async function show(category, page, options) {
    const settings = options || {};
    const ticket = (state.sequence += 1);
    state.category = category;
    state.page = page;
    state.loading = true;
    markCurrent(category);
    setPagingDisabled(true);
    clearAlert();
    announce(LOADING);
    if (region) region.setAttribute("data-loading", "true");

    let answer;
    try {
      if (state.list === "integrations") answer = await loadIntegrations(category);
      else if (state.list === "blog") answer = await loadBlog(category);
      else answer = await loadPress(category, page);
    } catch (error) {
      if (ticket !== state.sequence) return;
      state.loading = false;
      if (region) region.removeAttribute("data-loading");
      showOutage();
      announce(countCopy(0));
      refreshPagingState();
      return;
    }
    if (ticket !== state.sequence) return;

    state.loading = false;
    state.hasNext = Boolean(answer.hasNext);
    if (region) region.removeAttribute("data-loading");
    renderItems(answer.items);
    announce(countCopy(answer.items.length));
    if (paging) paging.hidden = state.list === "press" && !answer.items.length && page > 1;
    refreshPagingState();
    if (settings.focusFirstItem) {
      const first = region.querySelector(".press-headline a");
      if (first) {
        first.focus();
        if (window.relayoEnsureVisible) window.relayoEnsureVisible(first);
      }
    }
  }

  /* ---------- events ---------- */

  if (nav) {
    nav.addEventListener("click", function (event) {
      const link = event.target.closest("a");
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
      event.preventDefault();
      const url = new URL(link.getAttribute("href"), window.location.origin);
      const category = url.searchParams.get("category");
      link.focus();
      window.history.pushState({ category: category, page: 1 }, "", listAddress(category, 1));
      show(category, 1);
    });
  }

  if (moreButton) {
    moreButton.addEventListener("click", function () {
      if (moreButton.getAttribute("aria-disabled") === "true") return;
      const page = state.page + 1;
      window.history.pushState(
        { category: state.category, page: page },
        "",
        listAddress(state.category, page)
      );
      show(state.category, page, { focusFirstItem: true });
    });
  }

  if (previousButton) {
    previousButton.addEventListener("click", function () {
      if (previousButton.getAttribute("aria-disabled") === "true") return;
      const page = state.page - 1;
      window.history.pushState(
        { category: state.category, page: page },
        "",
        listAddress(state.category, page)
      );
      show(state.category, page, { focusFirstItem: true });
    });
  }

  if (nav || paging) {
    window.addEventListener("popstate", function () {
      const url = new URL(window.location.href);
      const category = url.searchParams.get("category");
      const rawPage = url.searchParams.get("page");
      const page = rawPage && /^[0-9]+$/.test(rawPage) ? Math.max(1, Number(rawPage)) : 1;
      show(category, page);
    });
  }

  if (state.list === "press" && data.rewrite) {
    window.history.replaceState(
      { category: state.category, page: 1 },
      "",
      listAddress(state.category, 1)
    );
  }

  if (region) restoreReturnFocus();
})();
