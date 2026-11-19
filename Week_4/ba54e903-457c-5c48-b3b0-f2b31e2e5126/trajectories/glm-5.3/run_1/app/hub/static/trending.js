/* Trending page: weeks, categories, address, latest input wins (DP-45, DP-73, DP-94). */
"use strict";
(() => {
  const label = document.getElementById("weekLabel");
  const prev = document.getElementById("prevWeek");
  const next = document.getElementById("nextWeek");
  const cats = document.getElementById("gameCats");
  const featured = document.getElementById("featuredCard");
  const list = document.getElementById("rankedList");
  const empty = document.getElementById("trendingEmpty");
  if (!featured) return;

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  let token = 0;

  function weekLabel(week) {
    const [y, m, d] = week.split("-").map(Number);
    return `Week of ${MONTHS[m - 1]} ${d}, ${y}`;
  }

  function readState() {
    const params = new URLSearchParams(location.search);
    return { week: params.get("week") || "", category: params.get("category") || "all" };
  }

  function writeAddress(state, replace) {
    const params = new URLSearchParams();
    if (state.week) params.set("week", state.week);
    if (state.category !== "all") params.set("category", state.category);
    const url = "/trending-games" + (params.toString() ? "?" + params.toString() : "");
    if (replace) history.replaceState(state, "", url);
    else history.pushState(state, "", url);
  }

  const fmt = (n) => n.toLocaleString("en-US");

  function changeText(value) {
    const sign = value > 0 ? "+" : (value < 0 ? "" : "");
    const cls = value > 0 ? "change-up" : (value < 0 ? "change-down" : "change-flat");
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = `${sign}${value}%`;
    return span;
  }

  function communityBlock(game) {
    const wrap = document.createElement("div");
    if (game.community) {
      const count = document.createElement("span");
      count.textContent = `${fmt(game.community.member_count)} Members`;
      wrap.appendChild(count);
      const link = document.createElement("a");
      link.href = `/servers/${game.community.slug}`;
      link.textContent = "Join community";
      wrap.append(" ", link);
    } else {
      wrap.textContent = "Community not available.";
    }
    return wrap;
  }

  function fillCard(card, game) {
    card.textContent = "";
    const rank = document.createElement("p");
    rank.textContent = `#${game.rank}`;
    const cover = document.createElement("img");
    cover.src = game.cover_url;
    cover.alt = `${game.name} cover art`;
    cover.width = 480; cover.height = 270;
    const title = document.createElement("h2");
    const link = document.createElement("a");
    link.href = `/game/${game.slug}`;
    link.textContent = game.name;
    title.appendChild(link);
    const plays = document.createElement("p");
    plays.append("Plays ", changeText(game.plays_change_pct));
    const streams = document.createElement("p");
    streams.append("Streams ", changeText(game.streams_change_pct));
    const community = communityBlock(game);
    card.append(rank, cover, title, plays, streams, community);
  }

  function fillRow(li, game) {
    li.textContent = "";
    const rank = document.createElement("span");
    rank.className = "game-rank";
    rank.textContent = `#${game.rank}`;
    const cover = document.createElement("img");
    cover.src = game.cover_url;
    cover.alt = `${game.name} cover art`;
    cover.width = 64; cover.height = 36;
    const name = document.createElement("a");
    name.href = `/game/${game.slug}`;
    name.textContent = game.name;
    const plays = changeText(game.plays_change_pct);
    const streams = changeText(game.streams_change_pct);
    li.append(rank, cover, name, plays, streams);
  }

  function syncControls(state) {
    if (cats) {
      for (const chip of cats.querySelectorAll(".chip")) {
        chip.setAttribute("aria-pressed", String(chip.dataset.cat === state.category));
      }
    }
  }

  async function load(state) {
    const my = ++token;
    const params = new URLSearchParams();
    if (state.week) params.set("week", state.week);
    if (state.category !== "all") params.set("category", state.category);
    try {
      const resp = await fetch("/api/trending-games" + (params.toString() ? "?" + params.toString() : ""), {
        headers: HUB.state.token ? { Authorization: "Bearer " + HUB.state.token } : {},
      });
      if (!resp.ok) throw new Error("refused");
      const data = await resp.json();
      if (my !== token) return;
      label.textContent = weekLabel(data.week_date);
      prev.disabled = !data.prev_week_date;
      next.disabled = !data.next_week_date;
      const games = data.games || [];
      featured.hidden = games.length === 0;
      list.textContent = "";
      if (empty) empty.hidden = games.length > 0;
      if (games.length) {
        fillCard(featured, games[0]);
        for (const game of games.slice(1)) {
          const li = document.createElement("li");
          fillRow(li, game);
          list.appendChild(li);
        }
      }
      state.week = data.week_date;
      syncControls(state);
    } catch (err) {
      // a refused address value shows the default view
      history.replaceState({}, "", "/trending-games");
      load({ week: "", category: "all" });
    }
  }

  function change(patch, replace) {
    const state = readState();
    Object.assign(state, patch);
    writeAddress(state, replace);
    load(state);
  }

  prev.addEventListener("click", () => change({ week: prev.dataset.week || "" }, false));
  next.addEventListener("click", () => change({ week: next.dataset.week || "" }, false));
  if (cats) {
    cats.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      change({ category: chip.dataset.cat }, false);
    });
  }
  window.addEventListener("popstate", () => {
    const state = readState();
    syncControls(state);
    load(state);
  });

  const initial = readState();
  load(initial);
})();
