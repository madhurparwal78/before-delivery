/* Directory page: search, chips, paging, address, latest input wins (DP-42, DP-87). */
"use strict";
(() => {
  const grid = document.getElementById("cardsGrid");
  const count = document.getElementById("dirResults");
  const searchBox = document.getElementById("dirSearch");
  const chipBar = document.getElementById("chipBar");
  const emptyResult = document.getElementById("emptyResult");
  const pager = document.getElementById("pager");
  if (!grid) return;

  const CATEGORIES = ["gaming", "entertainment", "education", "music", "science-and-tech"];
  let inputToken = 0;

  function readState() {
    const params = new URLSearchParams(location.search);
    return {
      q: params.get("q") || "",
      category: params.get("category") || "all",
      page: Math.max(1, parseInt(params.get("page") || "1", 10) || 1),
    };
  }

  function writeAddress(state, replace) {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.category !== "all") params.set("category", state.category);
    if (state.page > 1) params.set("page", String(state.page));
    const url = "/servers" + (params.toString() ? "?" + params.toString() : "");
    if (replace) history.replaceState(state, "", url);
    else history.pushState(state, "", url);
  }

  const fmt = (n) => n.toLocaleString("en-US");

  function renderCard(c) {
    const article = document.createElement("article");
    article.className = "card";
    const heading = document.createElement("h2");
    const link = document.createElement("a");
    link.href = `/servers/${c.slug}`;
    link.textContent = c.name;
    heading.appendChild(link);
    const banner = document.createElement("img");
    banner.className = "banner-img";
    banner.src = c.splash_url;
    banner.alt = "";
    banner.loading = "lazy";
    banner.width = 640; banner.height = 360;
    const iconWrap = document.createElement("div");
    iconWrap.className = "card-icon-wrap";
    const icon = document.createElement("img");
    icon.className = "card-icon";
    icon.src = c.icon_url;
    icon.alt = `${c.name} icon`;
    icon.loading = "lazy";
    icon.width = 62; icon.height = 62;
    iconWrap.appendChild(icon);
    const body = document.createElement("div");
    body.className = "card-body";
    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent = c.description;
    const counts = document.createElement("div");
    counts.className = "counts";
    const online = document.createElement("span");
    online.textContent = `${fmt(c.presence_count)} Online`;
    const members = document.createElement("span");
    members.textContent = `${fmt(c.member_count)} Members`;
    counts.append(online, members);
    body.append(heading, desc);
    if (c.verified) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Verified";
      body.appendChild(badge);
    } else if (c.partnered) {
      const badge = document.createElement("span");
      badge.className = "badge partnered";
      badge.textContent = "Partnered";
      body.appendChild(badge);
    }
    body.append(counts);
    article.append(banner, iconWrap, body);
    return article;
  }

  function syncControls(state) {
    if (searchBox) searchBox.value = state.q;
    if (chipBar) {
      for (const chip of chipBar.querySelectorAll(".chip")) {
        chip.setAttribute("aria-pressed", String(chip.dataset.cat === state.category));
      }
    }
  }

  function renderPager(state, total) {
    if (!pager) return;
    pager.textContent = "";
    const perPage = 12;
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    if (state.page > 1) {
      const prev = document.createElement("a");
      prev.href = "#";
      prev.textContent = "Previous page";
      prev.setAttribute("aria-label", "Previous page");
      prev.addEventListener("click", (e) => {
        e.preventDefault();
        change({ page: state.page - 1 }, false);
      });
      pager.appendChild(prev);
    }
    if (state.page < lastPage) {
      const next = document.createElement("a");
      next.href = "#";
      next.textContent = "Next page";
      next.setAttribute("aria-label", "Next page");
      next.addEventListener("click", (e) => {
        e.preventDefault();
        change({ page: state.page + 1 }, false);
      });
      pager.appendChild(next);
    }
  }

  let debounceTimer = null;
  async function load(state) {
    const token = ++inputToken;
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.category !== "all") params.set("category", state.category);
    params.set("page", String(state.page));
    params.set("per_page", "12");
    try {
      const resp = await fetch("/api/servers?" + params.toString(), {
        headers: HUB.state.token ? { Authorization: "Bearer " + HUB.state.token } : {},
      });
      const data = await resp.json();
      if (token !== inputToken) return;  // latest input wins
      grid.textContent = "";
      for (const c of data.data || []) grid.appendChild(renderCard(c));
      if (count) count.textContent = `${fmt(data.total || 0)} ${data.total === 1 ? "community" : "communities"}`;
      if (emptyResult) emptyResult.hidden = (data.total || 0) > 0;
      renderPager(state, data.total || 0);
      syncControls(state);
    } catch (err) {
      if (count) count.textContent = "Communities could not be loaded. Try again.";
    }
  }

  function change(patch, replace) {
    const state = readState();
    Object.assign(state, patch);
    writeAddress(state, replace);
    load(state);
  }

  async function loadChipCounts() {
    if (!chipBar) return;
    try {
      const resp = await fetch("/api/servers?per_page=50", {
        headers: HUB.state.token ? { Authorization: "Bearer " + HUB.state.token } : {},
      });
      const data = await resp.json();
      const counts = { all: data.total || 0 };
      for (const c of data.data || []) counts[c.category] = (counts[c.category] || 0) + 1;
      for (const chip of chipBar.querySelectorAll(".chip")) {
        const span = chip.querySelector("[data-count]");
        if (span) span.textContent = String(counts[chip.dataset.cat] || 0);
      }
    } catch (err) { /* counts stay at zero */ }
  }

  if (searchBox) {
    searchBox.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const value = searchBox.value.trim();
      debounceTimer = setTimeout(() => change({ q: value, page: 1 }, true), 120);
    });
  }
  if (chipBar) {
    chipBar.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      change({ category: chip.dataset.cat, page: 1 }, false);
    });
  }
  const reset = document.getElementById("resetFilters");
  if (reset) reset.addEventListener("click", () => {
    history.pushState({ q: "", category: "all", page: 1 }, "", "/servers");
    load({ q: "", category: "all", page: 1 });
  });

  window.addEventListener("popstate", () => {
    const state = readState();
    syncControls(state);
    load(state);
  });

  loadChipCounts();
  const initial = readState();
  syncControls(initial);
  load(initial);
})();
