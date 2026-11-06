/* The filtered lists: integrations, blog and press. The list, the current
   marker, the address and the Results announcement always follow the last
   choice; a superseded response never renders or announces. Detail pages
   set their return link from the from parameter under the return rule. */
(function () {
  "use strict";

  function byId(id) { return document.getElementById(id); }

  /* Detail pages: the safe return address. */

  var backLink = byId("back-to-list");
  if (backLink) {
    var base = window.location.pathname.indexOf("/blog/") === 0 ?
      "/blog" : "/integrations";
    var from = new URLSearchParams(window.location.search).get("from");
    var safe = Boolean(from) &&
      from.indexOf("\\") === -1 &&
      !/[\x00-\x1f\x7f]/.test(from) &&
      from.indexOf("//") !== 0 &&
      !/^[a-z][a-z0-9+.-]*:/i.test(from) &&
      (from === base || from.indexOf(base + "?") === 0);
    backLink.href = safe ? from : base;
    return;
  }

  var section = document.querySelector("[data-list]");
  if (!section) { return; }

  var kind = section.getAttribute("data-list");
  var nav = byId("category-nav");
  var results = byId("results-status");
  var listNode = byId(kind === "press" ? "press-list" :
    kind === "blog" ? "articles-list" : "integrations-list");
  var outage = byId("list-outage");
  var empty = byId("list-empty");
  var pageEmpty = byId("page-empty");
  var paging = byId("press-paging");
  var path = kind === "press" ? "/press" : kind === "blog" ? "/blog" :
    "/integrations";
  var apiPath = kind === "press" ? "/api/press" : kind === "blog" ?
    "/api/blog" : "/api/integrations";
  var noun = kind === "press" ? "press item" :
    kind === "blog" ? "article" : "integration";
  var listBase = kind === "blog" ? "/blog" : "/integrations";

  var state = { category: null, page: 1 };
  var cursors = { 1: null };
  var token = 0;
  var busy = false;
  var focusAfterLoad = false;

  function plural(count) {
    return count === 1 ? noun : noun + "s";
  }

  function announce(text) { results.textContent = text; }

  function addressFor(category, page) {
    var params = new URLSearchParams();
    if (category) { params.set("category", category); }
    if (kind === "press" && page > 1) { params.set("page", String(page)); }
    var query = params.toString();
    return path + (query ? "?" + query : "");
  }

  function markCurrent() {
    nav.querySelectorAll("a").forEach(function (link) {
      var value = link.getAttribute("data-category");
      var isAll = value === "All" || value === "All Integrations";
      var matches = state.category === null ? isAll : value === state.category;
      if (matches) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function setPagingDisabled(disabled) {
    if (!paging) { return; }
    byId("press-previous").setAttribute("aria-disabled",
      disabled ? "true" : "false");
    byId("press-load-more").setAttribute("aria-disabled",
      disabled ? "true" : "false");
  }

  function fetchPage(cursor) {
    var params = [];
    if (state.category) {
      params.push("category=" + encodeURIComponent(state.category));
    }
    if (kind === "press") {
      params.push("limit=10");
      if (cursor) {
        params.push("cursor=" + encodeURIComponent(cursor));
      }
    }
    var url = apiPath + (params.length ? "?" + params.join("&") : "");
    return fetch(url).then(function (response) {
      if (!response.ok) { throw new Error("list failed"); }
      return response.json();
    });
  }

  function loadAll() {
    /* The blog shows every public article in the chosen category. */
    var run = token;
    var collected = [];
    var cursor = null;
    function step() {
      var params = [];
      if (state.category) {
        params.push("category=" + encodeURIComponent(state.category));
      }
      params.push("limit=50");
      if (cursor) {
        params.push("cursor=" + encodeURIComponent(cursor));
      }
      return fetch(apiPath + "?" + params.join("&")).then(function (r) {
        if (!r.ok) { throw new Error("list failed"); }
        return r.json();
      }).then(function (payload) {
        collected = collected.concat(payload.items);
        if (payload.next_cursor) {
          cursor = payload.next_cursor;
          return step();
        }
        return collected;
      });
    }
    return step().then(function (items) {
      if (run !== token) { return; }
      return items;
    });
  }

  function cardNode(item, label) {
    var li = document.createElement("li");
    var link = document.createElement("a");
    link.className = "card";
    if (kind === "press") {
      link.href = item.link;
      var date = document.createElement("p");
      date.className = "hint";
      date.textContent = item.date;
      link.appendChild(date);
    } else {
      link.href = (kind === "blog" ? "/blog/" : "/integration/") + item.slug +
        "?from=" + encodeURIComponent(addressFor(state.category, state.page));
      link.dataset.slug = item.slug;
      if (kind === "integrations") {
        var icon = document.createElement("img");
        icon.src = item.icon_ref;
        icon.alt = "";
        icon.className = "card-icon";
        icon.style.height = "72px";
        icon.loading = "lazy";
        link.appendChild(icon);
      }
      if (kind === "blog") {
        var meta = document.createElement("p");
        meta.className = "hint";
        meta.textContent = item.author + " · " + item.published_at + " · " +
          item.read_time + " min read";
        link.appendChild(meta);
      }
    }
    var title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = label;
    link.appendChild(title);
    if (kind === "blog") {
      var summary = document.createElement("p");
      summary.textContent = item.summary;
      link.appendChild(summary);
    }
    li.appendChild(link);
    return li;
  }

  function clearStates() {
    outage.hidden = true;
    empty.hidden = true;
    if (pageEmpty) { pageEmpty.hidden = true; }
  }

  function render(items) {
    clearStates();
    listNode.textContent = "";
    items.forEach(function (item) {
      listNode.appendChild(cardNode(item, kind === "press" ?
        item.headline : kind === "blog" ? item.title : item.name));
    });
    announce(items.length + " " + plural(items.length));
  }

  function showOutage() {
    listNode.textContent = "";
    clearStates();
    outage.hidden = false;
    if (paging) { paging.hidden = false; }
    announce("0 " + plural(0));
  }

  function knownCategory(value) {
    var found = false;
    nav.querySelectorAll("a").forEach(function (link) {
      if (link.getAttribute("data-category") === value) { found = true; }
    });
    return found;
  }

  function showEmpty() {
    listNode.textContent = "";
    clearStates();
    empty.hidden = false;
    if (paging) { paging.hidden = true; }
    announce("0 " + plural(0));
  }

  function showPageEmpty() {
    listNode.textContent = "";
    clearStates();
    pageEmpty.hidden = false;
    paging.hidden = true;
    announce("0 " + plural(0));
  }

  function load() {
    var run = ++token;
    announce("Loading…");
    busy = true;
    setPagingDisabled(true);
    var promise;
    if (kind === "blog") {
      promise = loadAll().then(function (items) {
        return { items: items };
      });
    } else {
      promise = fetchPage(cursors[state.page]);
    }
    promise.then(function (payload) {
      if (run !== token) { return; }
      busy = false;
      setPagingDisabled(false);
      if (focusAfterLoad) {
        focusAfterLoad = false;
        var firstLink = listNode.querySelector("a");
        if (firstLink) { firstLink.focus(); }
      }
      if (kind === "press") {
        var items = payload.items;
        cursors[state.page + 1] = payload.next_cursor;
        if (state.page > 1 && !items.length) {
          showPageEmpty();
          return;
        }
        if (!items.length && state.category &&
            !knownCategory(state.category)) {
          showEmpty();
          return;
        }
        render(items);
        if (paging) { paging.hidden = false; }
        byId("press-previous").setAttribute("aria-disabled",
          state.page === 1 ? "true" : "false");
        byId("press-load-more").setAttribute("aria-disabled",
          payload.next_cursor ? "false" : "true");
      } else {
        if (!payload.items.length && state.category &&
            !knownCategory(state.category)) {
          showEmpty();
          return;
        }
        render(payload.items);
      }
    }).catch(function () {
      if (run !== token) { return; }
      busy = false;
      setPagingDisabled(false);
      showOutage();
    });
  }

  function readAddress() {
    var params = new URLSearchParams(window.location.search);
    state.category = params.get("category");
    if (state.category === "All" || state.category === "All Integrations") {
      state.category = null;
    }
    state.page = 1;
    cursors = { 1: null };
    if (kind === "press") {
      var raw = params.get("page");
      if (raw !== null) {
        var value = parseInt(raw, 10);
        if (raw === "1" || !/^\d+$/.test(raw) || value < 2) {
          params.delete("page");
          var rewritten = window.location.pathname +
            (params.toString() ? "?" + params.toString() : "");
          window.history.replaceState({}, "", rewritten);
        } else {
          state.page = value;
          /* Walk the cursors up to the page the address names. */
          var cursor = null;
          for (var page = 2; page < state.page; page += 1) {
            var data = fetchPageSync(cursor, page);
            cursor = data;
          }
          cursors[state.page] = cursor;
        }
      }
    }
  }

  function fetchPageSync(cursor, page) {
    /* Synchronous cursor walk for a direct page address. */
    var params = [];
    if (state.category) {
      params.push("category=" + encodeURIComponent(state.category));
    }
    params.push("limit=10");
    if (cursor) { params.push("cursor=" + encodeURIComponent(cursor)); }
    var request = new XMLHttpRequest();
    request.open("GET", apiPath + "?" + params.join("&"), false);
    request.send(null);
    if (request.status !== 200) { return null; }
    try {
      return JSON.parse(request.responseText).next_cursor;
    } catch (err) {
      return null;
    }
  }

  function focusCard(slug) {
    var link = listNode.querySelector('[data-slug="' + slug + '"]');
    if (!link) {
      var first = nav.querySelector("a");
      if (first) { first.focus(); }
      return;
    }
    link.focus();
    var header = document.querySelector(".site-header");
    var headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    var box = link.getBoundingClientRect();
    if (box.top < headerBottom || box.bottom > window.innerHeight) {
      window.scrollTo({
        top: window.scrollY + box.top - headerBottom - 12,
        behavior: "auto",
      });
    }
  }

  nav.addEventListener("click", function (event) {
    var link = event.target.closest("a");
    if (!link) { return; }
    event.preventDefault();
    if (busy) { return; }
    var value = link.getAttribute("data-category");
    state.category = (value === "All" || value === "All Integrations") ?
      null : value;
    state.page = 1;
    cursors = { 1: null };
    markCurrent();
    window.history.pushState({}, "",
      addressFor(state.category, state.page));
    load();
  });

  window.addEventListener("popstate", function () {
    readAddress();
    markCurrent();
    load();
  });

  if (kind === "press") {
    byId("press-load-more").addEventListener("click", function () {
      if (busy) { return; }
      var button = byId("press-load-more");
      if (button.getAttribute("aria-disabled") === "true") { return; }
      state.page += 1;
      window.history.pushState({}, "",
        addressFor(state.category, state.page));
      focusAfterLoad = true;
      load();
    });
    byId("press-previous").addEventListener("click", function () {
      if (busy) { return; }
      var button = byId("press-previous");
      if (button.getAttribute("aria-disabled") === "true") { return; }
      state.page = Math.max(1, state.page - 1);
      window.history.pushState({}, "",
        addressFor(state.category, state.page));
      focusAfterLoad = true;
      load();
    });
  }

  /* Remember the opened card, so the list page returns focus to it. */

  listNode.addEventListener("click", function (event) {
    var link = event.target.closest("a[data-slug]");
    if (!link || !link.dataset.slug) { return; }
    try {
      sessionStorage.setItem("relayo-return-card",
        JSON.stringify({ list: listBase, slug: link.dataset.slug }));
    } catch (err) { /* storage unavailable */ }
  });

  var remembered = null;
  try {
    remembered = JSON.parse(sessionStorage.getItem("relayo-return-card"));
  } catch (err) { remembered = null; }
  var focusSlug = null;
  if (remembered && remembered.list === listBase && remembered.slug) {
    focusSlug = remembered.slug;
    try { sessionStorage.removeItem("relayo-return-card"); } catch (err) {}
  }

  readAddress();
  markCurrent();
  load();
  if (focusSlug) {
    /* Wait for the list to render, then move focus to the card. */
    var tries = 0;
    var timer = window.setInterval(function () {
      var link = listNode.querySelector('[data-slug="' + focusSlug + '"]');
      tries += 1;
      if (link) {
        window.clearInterval(timer);
        focusCard(focusSlug);
      } else if (tries > 40) {
        window.clearInterval(timer);
      }
    }, 50);
  }
}());
