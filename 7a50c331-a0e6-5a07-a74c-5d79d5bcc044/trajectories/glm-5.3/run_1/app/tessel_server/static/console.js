// Tessel console: tabs, sources, queries, search, explore, settings, toasts.
"use strict";

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function api(path, options) {
  options = options || {};
  options.headers = Object.assign({"Content-Type": "application/json"}, options.headers || {});
  return fetch(path, options).then(function (r) {
    if (r.status === 401) {
      var here = window.location.pathname + window.location.search;
      window.location.href = "/login?next=" + encodeURIComponent(here) + "&expired=1";
      throw new Error("signed out");
    }
    var ct = r.headers.get("Content-Type") || "";
    if (ct.indexOf("csv") !== -1) return r.text().then(function (t) { return {csv: t}; });
    return r.json().then(function (body) { return {status: r.status, body: body}; });
  });
}

/* toasts: newest on top, at most three, leaving after 6 seconds */
function toast(message, opts) {
  var host = $("#toasts");
  if (!host) return;
  while (host.children.length >= 3) host.removeChild(host.lastChild);
  var el = document.createElement("div");
  el.className = "toast" + (opts && opts.error ? " error" : "");
  el.setAttribute("role", "status");
  el.appendChild(document.createTextNode(message));
  var close = document.createElement("button");
  close.className = "close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", function () { leave(); });
  el.appendChild(close);
  host.insertBefore(el, host.firstChild);
  var timer = setTimeout(leave, 6000);
  function leave() {
    clearTimeout(timer);
    if (!el.parentNode) return;
    el.classList.add("leaving");
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
  }
}

function announce(line) {
  var live = $("#live");
  if (live) live.textContent = line;
}

function fieldError(id, message) {
  var el = typeof id === "string" ? $("#" + id) : id;
  if (el) { el.textContent = message || ""; el.hidden = !message; }
}

function busy(btn, on) {
  if (!btn) return;
  btn.setAttribute("aria-busy", String(on));
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = btn.dataset.wait ||
    "Working..."; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

function panelBusy(panel, on) {
  if (panel) panel.setAttribute("aria-busy", String(on));
}

function money(cents) {
  return (cents < 0 ? "-$" : "$") + Math.floor(Math.abs(cents) / 100).toLocaleString("en-US") +
    "." + String(Math.abs(cents) % 100).padStart(2, "0");
}

function errorMessage(body, fallback) {
  return (body && body.error && body.error.message) || fallback || "Something went wrong. Try again.";
}

/* console page state in the address */
function params() { return new URLSearchParams(window.location.search); }
function setParam(key, value) {
  var p = params();
  if (value === "" || value === null || value === undefined) p.delete(key);
  else p.set(key, value);
  var qs = p.toString();
  window.history.replaceState({}, "", window.location.pathname + (qs ? "?" + qs : ""));
}
function dbName() {
  var m = window.location.pathname.match(/^\/console\/db\/([^\/]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/* databases: create, delete, provisioning to ready */
(function databases() {
  if (!$("#db-table")) return;
  var form = $("#create-db-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = form.querySelector("button[type='submit']");
      var name = $("#new-db-name").value.trim();
      busy(btn, true);
      api("/api/v2/databases", {method: "POST", headers: {"API-Version": "2"},
        body: JSON.stringify({name: name})}).then(function (res) {
        busy(btn, false);
        if (res.body.success) {
          toast("Database created");
          announce("Database created");
          fieldError("create-db-error", "");
          $("#new-db-name").value = "";
          addRow(res.body.data);
          pollRow(res.body.data.name);
        } else {
          var msg = errorMessage(res.body);
          fieldError("create-db-error", msg);
          toast(msg, {error: true});
        }
      }).catch(function () { busy(btn, false);
        fieldError("create-db-error", "Something went wrong. Try again."); });
    });
  }

  function addRow(data) {
    var tbody = $("#db-table tbody");
    var tr = document.createElement("tr");
    tr.className = "db-row";
    tr.dataset.name = data.name;
    tr.dataset.status = data.status;
    tr.innerHTML = "<td><a class='inline' href='/console/db/" + encodeURIComponent(data.name) +
      "'>" + escapeHtml(data.name) + "</a></td><td><span class='badge js-status " +
      (data.status === "provisioning" ? "amber" : "") + "'>" + data.status +
      "</span></td><td>1</td><td>0</td><td>0</td><td>0</td><td>" +
      escapeHtml(data.created_at) + "</td><td></td>";
    var existing = tbody.querySelector("tr.db-row");
    if (existing) tbody.insertBefore(tr, existing);
    else tbody.appendChild(tr);
    tr.classList.add("flash");
  }

  function pollRow(name) {
    var timer = setInterval(function () {
      api("/api/v2/databases/status?database=" + encodeURIComponent(name),
        {headers: {"API-Version": "2"}}).then(function (res) {
        if (res.body.success && res.body.data.status === "ready") {
          clearInterval(timer);
          var row = $("tr.db-row[data-name='" + cssEscape(name) + "']");
          if (row) {
            var badge = row.querySelector(".js-status");
            badge.textContent = "ready";
            badge.classList.remove("amber");
            row.dataset.status = "ready";
            row.classList.add("flash");
          }
        }
      }).catch(function () { clearInterval(timer); });
    }, 500);
  }

  $$(".js-delete-db").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openDeleteDialog(btn.dataset.name, btn);
    });
  });

  function openDeleteDialog(name, opener) {
    var dialog = document.createElement("dialog");
    dialog.className = "delete-dialog";
    dialog.setAttribute("aria-labelledby", "del-title");
    dialog.innerHTML = "<h2 id='del-title'>Delete database " + escapeHtml(name) + "</h2>" +
      "<div class='field'><label for='del-confirm'>Type the database name to confirm</label>" +
      "<input id='del-confirm' class='input' autocomplete='off'></div>" +
      "<div class='toolbar'><button class='btn capsule primary' id='del-go' disabled>" +
      "Delete database</button><button class='btn capsule secondary' id='del-cancel'>" +
      "Cancel</button></div>";
    document.body.appendChild(dialog);
    var confirmInput = $("#del-confirm", dialog);
    var go = $("#del-go", dialog);
    confirmInput.addEventListener("input", function () {
      go.disabled = confirmInput.value !== name;
    });
    dialog.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
    function close() {
      dialog.close();
      document.body.removeChild(dialog);
      if (opener) opener.focus();
    }
    go.addEventListener("click", function () {
      api("/api/v2/databases", {method: "DELETE", headers: {"API-Version": "2"},
        body: JSON.stringify({database: name})}).then(function (res) {
        close();
        if (res.body.success) {
          toast("Database deleted");
          var row = $("tr.db-row[data-name='" + cssEscape(name) + "']");
          if (row) { row.classList.add("removing");
            setTimeout(function () { if (row.parentNode) row.parentNode.removeChild(row); }, 250); }
        } else { toast(errorMessage(res.body), {error: true}); }
      }).catch(function () { close(); toast("Something went wrong. Try again.", {error: true}); });
    });
    $("#del-cancel", dialog).addEventListener("click", close);
    dialog.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var focusables = $$("button, input, a", dialog);
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    dialog.showModal();
    confirmInput.focus();
  }

  var importOpen = $("#import-open");
  if (importOpen) {
    importOpen.addEventListener("click", function () {
      var panel = $("#import-panel");
      panel.hidden = !panel.hidden;
      importOpen.setAttribute("aria-expanded", String(!panel.hidden));
    });
    $("#import-go").addEventListener("click", function () {
      var btn = $("#import-go");
      var doc = $("#imp-doc").value;
      try { doc = JSON.parse(doc); } catch (e) {
        fieldError("import-error", "The document is not valid JSON"); return; }
      busy(btn, true);
      api("/api/v2/databases/import", {method: "POST", headers: {"API-Version": "2"},
        body: JSON.stringify({name: $("#imp-name").value.trim(), document: doc})})
        .then(function (res) {
          busy(btn, false);
          if (res.body.success) {
            toast("Database imported");
            setTimeout(function () { window.location.reload(); }, 600);
          } else { fieldError("import-error", errorMessage(res.body)); }
        }).catch(function () { busy(btn, false);
          fieldError("import-error", "Something went wrong. Try again."); });
    });
  }
})();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
  });
}
function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : s; }

/* workspace sources tab */
(function sources() {
  var panel = $("#sources-panel");
  if (!panel) return;
  var db = dbName();
  var state = {collection: params().get("collection") || "default",
    sort: params().get("sort") || "id", filter: params().get("filter") || ""};

  api("/api/v2/databases/collections?database=" + encodeURIComponent(db),
    {headers: {"API-Version": "2"}}).then(function (res) {
    if (res.body.success) {
      var sel = $("#src-collection");
      sel.innerHTML = res.body.data.collections.map(function (c) {
        return "<option value='" + escapeHtml(c) + "'" + (c === state.collection ? " selected" :
          "") + ">" + escapeHtml(c) + "</option>";
      }).join("");
    }
  });

  function load() {
    panelBusy(panel, true);
    api("/api/v2/context/list", {method: "POST", headers: {"API-Version": "2"},
      body: JSON.stringify({database: db, collection: state.collection})})
      .then(function (res) {
        panelBusy(panel, false);
        if (!res.body.success) { fieldError("sources-empty",
          errorMessage(res.body)); return; }
        render(res.body.data.sources);
      }).catch(function () { panelBusy(panel, false); });
  }

  function render(list) {
    var canEdit = !!$("#ingest-open");
    var flt = (state.filter || "").toLowerCase();
    list = list.filter(function (s) {
      return !flt || s.id.toLowerCase().indexOf(flt) !== -1 ||
        s.title.toLowerCase().indexOf(flt) !== -1;
    });
    var key = state.sort.replace("-", "");
    var desc = state.sort.indexOf("-") === 0;
    list.sort(function (a, b) {
      var av = a[key], bv = b[key];
      var c = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
      return desc ? -c : c;
    });
    var tbody = $("#sources-body");
    tbody.innerHTML = list.map(function (s) {
      return "<tr data-id='" + escapeHtml(s.id) + "'><td>" + escapeHtml(s.id) + "</td><td>" +
        escapeHtml(s.title) + "</td><td>" + s.version + "</td><td>" + s.token_count +
        "</td><td>" + s.facts + "</td><td><span class='badge" +
        (s.indexing_status === "graph_creation" ? " amber'" : "'") + "'>" +
        (s.indexing_status === "graph_creation" ? "In write log" : "Indexed") +
        "</span></td><td>" + escapeHtml(s.ingested_at) + "</td><td>" +
        (canEdit ? "<button class='btn capsule secondary js-edit'>Edit</button> " +
          "<button class='btn capsule secondary js-delete-src'>Delete</button>" : "") +
        "</td></tr>";
    }).join("");
    $("#sources-empty").hidden = list.length > 0;
    $$(".js-delete-src", tbody).forEach(function (btn) {
      btn.addEventListener("click", function () { deleteSource(btn); });
    });
    $$(".js-edit", tbody).forEach(function (btn) {
      btn.addEventListener("click", function () { editSource(btn); });
    });
  }

  function deleteSource(btn) {
    var tr = btn.closest("tr");
    var id = tr.dataset.id;
    api("/api/v2/context", {method: "DELETE", headers: {"API-Version": "2"},
      body: JSON.stringify({database: db, collection: state.collection, id: id})})
      .then(function (res) {
        if (res.body.success) {
          toastWithUndo("Source deleted", id, tr);
        } else { toast(errorMessage(res.body), {error: true}); }
      }).catch(function () { toast("Something went wrong. Try again.", {error: true}); });
  }

  function toastWithUndo(message, id, tr) {
    var host = $("#toasts");
    while (host.children.length >= 3) host.removeChild(host.lastChild);
    var el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    var span = document.createElement("span");
    span.textContent = message;
    el.appendChild(span);
    var undo = document.createElement("button");
    undo.className = "btn capsule secondary";
    undo.textContent = "Undo";
    undo.addEventListener("click", function () {
      api("/api/v2/context/restore", {method: "POST", headers: {"API-Version": "2"},
        body: JSON.stringify({database: db, collection: state.collection, id: id})})
        .then(function (res) {
          if (res.body.success) { span.textContent = "Source restored"; load(); }
          else { toast(errorMessage(res.body), {error: true}); }
          undo.remove();
        });
    });
    el.appendChild(undo);
    var close = document.createElement("button");
    close.className = "close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    el.appendChild(close);
    host.insertBefore(el, host.firstChild);
    tr.classList.add("removing");
    setTimeout(function () { if (tr.parentNode) tr.parentNode.removeChild(tr); }, 250);
    setTimeout(function () {
      if (el.parentNode) {
        el.classList.add("leaving");
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
      }
    }, 6000);
    close.addEventListener("click", function () {
      el.classList.add("leaving");
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
    });
  }

  function editSource(btn) {
    var tr = btn.closest("tr");
    var id = tr.dataset.id;
    api("/api/v2/context/source?database=" + encodeURIComponent(db) +
      "&collection=" + encodeURIComponent(state.collection) + "&id=" + encodeURIComponent(id),
      {headers: {"API-Version": "2"}}).then(function (res) {
      if (!res.body.success) return;
      var s = res.body.data;
      openIngestRow(s, s.version);
    });
  }

  function openIngestRow(existing, ifVersion) {
    var panelEl = $("#sources-panel");
    var row = $("#ingest-row");
    if (!row) {
      row = document.createElement("form");
      row.id = "ingest-row";
      row.className = "card inline-form";
      row.innerHTML =
        "<div class='toolbar'><label>Collection <input class='input' id='ig-collection' " +
        "value='" + escapeHtml(state.collection) + "'></label>" +
        "<label>Source id <input class='input' id='ig-id'></label></div>" +
        "<div class='field'><label for='ig-title'>Title</label>" +
        "<input class='input' id='ig-title'><p class='field-error' id='ig-title-error' " +
        "role='alert' hidden></p></div>" +
        "<div class='field'><label for='ig-text'>Text</label>" +
        "<textarea class='input' id='ig-text' rows='4'></textarea></div>" +
        "<div class='facts-editor' id='ig-facts'></div>" +
        "<button type='button' class='btn capsule secondary' id='ig-add-fact'>Add fact</button>" +
        "<div class='toolbar'><button type='submit' class='btn capsule primary js-wait' " +
        "data-wait='Ingesting...'>Ingest</button></div>" +
        "<p class='field-error' id='ig-error' role='alert' hidden></p>";
      var head = panelEl.querySelector("table");
      panelEl.insertBefore(row, head);
      factRow(null);
      $("#ig-add-fact").addEventListener("click", function () { factRow(null); });
      row.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    }
    if (existing) {
      $("#ig-id").value = existing.id;
      $("#ig-title").value = existing.title;
      $("#ig-text").value = existing.text;
      var facts = $("#ig-facts");
      facts.innerHTML = "";
      existing.facts.forEach(function (f) { factRow(f); });
      row.dataset.ifVersion = String(ifVersion);
    } else {
      row.dataset.ifVersion = "";
    }
    $("#ig-title").focus();
  }

  function factRow(fact) {
    var wrap = document.createElement("div");
    wrap.className = "fact-row toolbar";
    wrap.innerHTML =
      "<label>Subject <input class='input f-subject'></label>" +
      "<label>Predicate <input class='input f-predicate'></label>" +
      "<label>Object <input class='input f-object'></label>" +
      "<label>Valid from <input class='input f-valid'></label>" +
      "<label>Reason <input class='input f-reason'></label>" +
      "<button type='button' class='btn capsule secondary f-remove'>Remove</button>";
    if (fact) {
      $(".f-subject", wrap).value = fact.subject;
      $(".f-predicate", wrap).value = fact.predicate;
      $(".f-object", wrap).value = fact.object;
      $(".f-valid", wrap).value = fact.valid_from;
      $(".f-reason", wrap).value = fact.reason || "";
    }
    $(".f-remove", wrap).addEventListener("click", function () { wrap.remove(); });
    $("#ig-facts").appendChild(wrap);
  }

  function submit() {
    var btn = $("#ingest-row button[type='submit']");
    var sources = [{
      id: $("#ig-id").value.trim() || null,
      title: $("#ig-title").value,
      text: $("#ig-text").value,
      facts: $$(".fact-row").map(function (row) {
        return {subject: $(".f-subject", row).value, predicate: $(".f-predicate", row).value,
          object: $(".f-object", row).value, valid_from: $(".f-valid", row).value,
          reason: $(".f-reason", row).value};
      }).filter(function (f) { return f.subject && f.predicate && f.object && f.valid_from; })
    }];
    if ($("#ingest-row").dataset.ifVersion) {
      sources[0].if_version = Number($("#ingest-row").dataset.ifVersion);
    }
    busy(btn, true);
    panelBusy(panel, true);
    api("/api/v2/context/ingest", {method: "POST", headers: {"API-Version": "2"},
      body: JSON.stringify({database: db, collection: $("#ig-collection").value || "default",
        sources: sources})}).then(function (res) {
      busy(btn, false);
      panelBusy(panel, false);
      if (res.body.success) {
        toast("Source ingested");
        announce("Source ingested");
        fieldError("ig-error", "");
        fieldError("ig-title-error", "");
        $("#ingest-row").dataset.ifVersion = "";
        load();
      } else {
        var err = res.body.error || {};
        if (err.field && err.field.indexOf("title") !== -1) {
          fieldError("ig-title-error", err.message);
        } else {
          fieldError("ig-error", err.message);
        }
      }
    }).catch(function () { busy(btn, false); panelBusy(panel, false);
      fieldError("ig-error", "Something went wrong. Try again."); });
  }

  var ingestOpen = $("#ingest-open");
  if (ingestOpen) {
    ingestOpen.addEventListener("click", function () { openIngestRow(null); });
  }

  $$(".sort-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.dataset.key;
      state.sort = state.sort === key ? "-" + key : key;
      setParam("sort", state.sort);
      $$(".sort-btn").forEach(function (b) {
        b.setAttribute("aria-sort",
          b === btn ? (state.sort.indexOf("-") === 0 ? "descending" : "ascending") : "none");
      });
      load();
    });
  });

  var filterInput = $("#src-filter");
  if (filterInput) {
    filterInput.value = state.filter;
    filterInput.addEventListener("input", function () {
      state.filter = filterInput.value;
      setParam("filter", state.filter);
      load();
    });
  }
  var colSel = $("#src-collection");
  if (colSel) colSel.addEventListener("change", function () {
    state.collection = colSel.value; setParam("collection", state.collection); load(); });
  load();
})();

/* graph query tab */
(function graphQuery() {
  var panel = $("#graph-panel");
  if (!panel) return;
  var db = dbName();
  var stmt = params().get("statement") || "";
  if (stmt) $("#gq-statement").value = stmt;
  var asOf = params().get("as_of") || "";
  if (asOf) $("#gq-as-of").value = asOf;

  function run() {
    var btn = $("#gq-run");
    var statement = $("#gq-statement").value;
    var as_of = $("#gq-as-of").value;
    setParam("statement", statement);
    setParam("as_of", as_of);
    busy(btn, true);
    panelBusy(panel, true);
    var body = {database: db, query_by: "cypher", cypher: statement};
    if (as_of) body.as_of = as_of;
    api("/api/v2/query", {method: "POST", headers: {"API-Version": "2"},
      body: JSON.stringify(body)}).then(function (res) {
      busy(btn, false);
      panelBusy(panel, false);
      if (res.body.success) {
        fieldError("gq-error", "");
        var data = res.body.data;
        $("#gq-head").innerHTML = "<tr>" + data.columns.map(function (c) {
          return "<th>" + escapeHtml(c) + "</th>"; }).join("") + "</tr>";
        $("#gq-body").innerHTML = data.rows.map(function (row) {
          return "<tr>" + row.map(function (v) {
            return "<td>" + escapeHtml(v === null ? "" : v) + "</td>"; }).join("") + "</tr>";
        }).join("");
        $("#gq-body").classList.add("results-stagger");
        $("#gq-served").textContent = "Served from index generation " +
          data.served_from.index_generation + " at LSN " + data.served_from.indexed_lsn +
          " plus " + data.served_from.wal_entries_applied + " pending write log entries";
        announce("Query answered: " + data.rows.length + " rows");
      } else {
        fieldError("gq-error", (res.body.error && res.body.error.code) + ": " +
          errorMessage(res.body));
      }
    }).catch(function () { busy(btn, false); panelBusy(panel, false);
      fieldError("gq-error", "Something went wrong. Try again."); });
  }
  $("#gq-run").addEventListener("click", run);
  $("#gq-statement").addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
  });
  $$(".example").forEach(function (b) {
    b.addEventListener("click", function () { $("#gq-statement").value = b.dataset.stmt; run(); });
  });
  if (stmt) run();
})();

/* search tab */
(function searchTab() {
  var panel = $("#search-panel");
  if (!panel) return;
  var db = dbName();
  var words = params().get("words") || "";
  if (words) $("#sr-words").value = words;

  function run() {
    var btn = $("#sr-go");
    var q = $("#sr-words").value;
    setParam("words", q);
    busy(btn, true);
    panelBusy(panel, true);
    api("/api/v2/query", {method: "POST", headers: {"API-Version": "2"},
      body: JSON.stringify({database: db, query_by: "text", query: q,
        collections: [$("#sr-collections").value],
        max_results: Number($("#sr-limit").value) || 5})}).then(function (res) {
      busy(btn, false);
      panelBusy(panel, false);
      if (res.body.success) {
        fieldError("sr-error", "");
        var results = res.body.data.results;
        var rid = res.body.data.request_id;
        $("#sr-results").innerHTML = results.map(function (r, i) {
          return "<div class='search-result'><p><strong>" + escapeHtml(r.id) + "</strong> " +
            "<span class='score'>" + r.score.toFixed(4) + "</span></p>" +
            "<p>" + escapeHtml(r.title) + "</p><p class='cap'>" + escapeHtml(r.snippet) +
            "</p><button class='btn capsule secondary js-not-useful' data-rid='" + rid +
            "' data-id='" + escapeHtml(r.id) + "'>Not useful</button>" +
            "<form class='fb-form' hidden><div class='field'><label>Rating" +
            "</label><select class='input fb-rating'><option>negative</option>" +
            "<option>neutral</option><option>positive</option></select></div>" +
            "<div class='field'><label>Comment</label>" +
            "<textarea class='input fb-comment' rows='2'></textarea></div>" +
            "<button type='button' class='btn capsule secondary fb-send'>Send feedback</button>" +
            "</form></div>";
        }).join("");
        $("#sr-results").classList.add("results-stagger");
        $("#sr-empty").hidden = results.length > 0;
        announce("Search found " + results.length + " sources");
        $$(".js-not-useful").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var form = btn.parentElement.querySelector(".fb-form");
            form.hidden = !form.hidden;
            if (!form.hidden) $(".fb-send", form).addEventListener("click", function () {
              api("/api/v2/feedback", {method: "POST", headers: {"API-Version": "2"},
                body: JSON.stringify({request_id: btn.dataset.rid,
                  feedback: $(".fb-comment", form).value,
                  rating: $(".fb-rating", form).value,
                  source: "user", metadata: {source_id: btn.dataset.id}})})
                .then(function (res) {
                  if (res.body.success) { toast("Feedback sent"); form.hidden = true; }
                  else { toast(errorMessage(res.body), {error: true}); }
                });
            });
          });
        });
      } else {
        fieldError("sr-error", errorMessage(res.body));
      }
    }).catch(function () { busy(btn, false); panelBusy(panel, false);
      fieldError("sr-error", "Something went wrong. Try again."); });
  }
  $("#sr-go").addEventListener("click", run);
  if (words) run();
})();

/* entity tab */
(function entityTab() {
  var panel = $("#entity-panel");
  if (!panel) return;
  var db = dbName();
  var name = params().get("entity") || "";
  if (name) $("#en-name").value = name;

  function run() {
    var btn = $("#en-go");
    var entity = $("#en-name").value;
    var as_of = $("#en-as-of").value;
    setParam("entity", entity);
    setParam("as_of", as_of);
    busy(btn, true);
    panelBusy(panel, true);
    var qs = "?database=" + encodeURIComponent(db) + "&entity=" + encodeURIComponent(entity);
    if (as_of) qs += "&as_of=" + encodeURIComponent(as_of);
    api("/api/v2/context/relations" + qs, {headers: {"API-Version": "2"}})
      .then(function (res) {
        busy(btn, false);
        panelBusy(panel, false);
        if (res.body.success) {
          fieldError("en-error", "");
          var d = res.body.data;
          if (!d.outgoing.length && !d.incoming.length) {
            $("#en-results").innerHTML = "";
            $("#en-empty").hidden = false;
            return;
          }
          $("#en-empty").hidden = true;
          $("#en-results").innerHTML = "<h2>Outgoing</h2>" + list(d.outgoing) +
            "<h2>Incoming</h2>" + list(d.incoming);
          $("#en-results").classList.add("results-stagger");
        } else { fieldError("en-error", errorMessage(res.body)); }
      }).catch(function () { busy(btn, false); panelBusy(panel, false);
        fieldError("en-error", "Something went wrong. Try again."); });
    function list(rels) {
      return "<ul>" + rels.map(function (r) {
        return "<li>" + escapeHtml(r.predicate) + " <a class='inline entity-link' href='#'>" +
          escapeHtml(r.other) + "</a> <span class='cap'>from " +
          escapeHtml(r.valid_from) + "</span> <span class='cap'>" +
          escapeHtml(r.reason || "") + "</span></li>";
      }).join("") + "</ul>";
    }
  }
  $("#en-go").addEventListener("click", run);
  $$("#en-results .entity-link").forEach(function (l) { l.addEventListener("click",
    function (e) { e.preventDefault(); }); });
  if (name) run();
})();

/* stats tab: compact and export */
(function statsTab() {
  var panel = $("#stats-panel");
  if (!panel) return;
  var db = dbName();
  var compact = $("#compact-go");
  if (compact) compact.addEventListener("click", function () {
    busy(compact, true);
    api("/api/v2/databases/compact", {method: "POST", headers: {"API-Version": "2"},
      body: JSON.stringify({database: db})}).then(function (res) {
      busy(compact, false);
      if (res.body.success) {
        var d = res.body.data;
        var line = d.folded_entries ?
          "Folded " + d.folded_entries + " entries into generation " + d.generation :
          "Nothing to fold";
        toast(line);
        announce(line);
      } else { toast(errorMessage(res.body), {error: true}); }
    }).catch(function () { busy(compact, false);
      toast("Something went wrong. Try again.", {error: true}); });
  });
  var exportBtn = $("#export-go");
  if (exportBtn) exportBtn.addEventListener("click", function () {
    api("/api/v2/databases/export", {method: "POST", headers: {"API-Version": "2"},
      body: JSON.stringify({database: db})}).then(function (res) {
      if (!res.body.success) { toast(errorMessage(res.body), {error: true}); return; }
      var job = res.body.data.job_id;
      toast("Export queued");
      var timer = setInterval(function () {
        api("/api/v2/jobs/" + job, {headers: {"API-Version": "2"}}).then(function (res2) {
          if (!res2.body.success) { clearInterval(timer); return; }
          var st = res2.body.data.status;
          if (st === "running") toast("Export running");
          if (st === "succeeded") {
            clearInterval(timer);
            toast("Export ready");
            announce("Export ready");
            var link = $("#export-download");
            link.href = "/api/v2/jobs/" + job + "/download";
            link.hidden = false;
            link.setAttribute("download", db + "-export.json");
          }
        });
      }, 400);
    }).catch(function () { toast("Something went wrong. Try again.", {error: true}); });
  });
})();

/* explore tab */
(function explore() {
  var panel = $("#explore-panel");
  if (!panel) return;
  var db = dbName();
  var state = {as_of: params().get("as_of") || "", node: params().get("node") || "",
    predicates: []};

  function load() {
    panelBusy(panel, true);
    var qs = "?database=" + encodeURIComponent(db);
    if (state.as_of) qs += "&as_of=" + encodeURIComponent(state.as_of);
    if (state.predicates.length) qs += "&predicates=" + state.predicates.join(",");
    api("/api/v2/context/graph" + qs, {headers: {"API-Version": "2"}}).then(function (res) {
      panelBusy(panel, false);
      if (!res.body.success) return;
      var d = res.body.data;
      render(d);
    });
  }

  function render(d) {
    var area = $("#ex-graph");
    var predicates = [];
    d.edges.forEach(function (e) {
      if (predicates.indexOf(e.predicate) === -1) predicates.push(e.predicate);
    });
    var predBox = $("#ex-preds");
    if (!predBox.dataset.built) {
      predBox.innerHTML = predicates.map(function (p) {
        return "<label class='pred-check'><input type='checkbox' value='" + escapeHtml(p) +
          "' checked> " + escapeHtml(p) + "</label>";
      }).join("") || "<p class='cap'>No predicates</p>";
      predBox.dataset.built = "1";
      $$("input", predBox).forEach(function (cb) {
        cb.addEventListener("change", function () {
          state.predicates = $$("input:checked", predBox).map(function (c) { return c.value; });
          setParam("predicates", state.predicates.join(","));
          load();
        });
      });
    }
    var empty = !d.edges.length;
    $("#ex-empty").hidden = !empty;
    area.innerHTML = d.nodes.map(function (n) {
      return "<button class='node-chip' data-name='" + escapeHtml(n) + "' data-key='" +
        escapeHtml(n.toLowerCase()) + "'>" + escapeHtml(n) + "</button>";
    }).join("");
    area.classList.add("results-stagger");
    $$(".node-chip", area).forEach(function (chip) {
      chip.addEventListener("click", function () { select(chip.dataset.name, chip); });
      chip.addEventListener("keydown", function (e) {
        var chips = $$(".node-chip", area);
        var i = chips.indexOf(chip);
        var next = null;
        if (e.key === "ArrowRight") next = chips[(i + 1) % chips.length];
        if (e.key === "ArrowLeft") next = chips[(i - 1 + chips.length) % chips.length];
        if (e.key === "Enter" || e.key === " ") { e.preventDefault();
          select(chip.dataset.name, chip); return; }
        if (next) { e.preventDefault(); next.focus(); }
      });
    });
    $("#ex-summary").textContent = d.nodes.length + " entities, " + d.edges.length +
      " relations";
    $("#ex-body").innerHTML = d.edges.map(function (e) {
      return "<tr><td>" + escapeHtml(e.subject) + "</td><td>" + escapeHtml(e.predicate) +
        "</td><td>" + escapeHtml(e.object) + "</td><td>" + escapeHtml(e.valid_from) +
        "</td><td>" + escapeHtml(e.source_id) + "</td></tr>";
    }).join("");
    if (state.node) {
      var chip = $(".node-chip[data-key='" + cssEscape(state.node.toLowerCase()) + "']", area);
      if (chip) select(state.node, chip, false);
    }
    var find = $("#ex-find");
    if (find && find.value) markMatches(find.value);
  }

  function select(name, chip, focus) {
    $$(".node-chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
    if (chip) chip.setAttribute("aria-pressed", "true");
    state.node = name;
    setParam("node", name);
    var inspect = $("#ex-inspect");
    inspect.hidden = false;
    inspect.innerHTML = "<h3>Inspect " + escapeHtml(name) + "</h3>";
    var qs = "?database=" + encodeURIComponent(db) + "&entity=" + encodeURIComponent(name);
    if (state.as_of) qs += "&as_of=" + encodeURIComponent(state.as_of);
    api("/api/v2/context/relations" + qs, {headers: {"API-Version": "2"}}).then(function (res) {
      if (!res.body.success) return;
      var d = res.body.data;
      function rels(list) {
        return list.map(function (r) {
          return "<p>" + escapeHtml(r.predicate) + " " + escapeHtml(r.other) + "</p>";
        }).join("") || "<p class='cap'>None</p>";
      }
      inspect.innerHTML = "<h3>Inspect " + escapeHtml(d.entity) + "</h3>" +
        "<h4>Outgoing</h4>" + rels(d.outgoing) + "<h4>Incoming</h4>" + rels(d.incoming);
    });
    if (focus !== false) inspect.focus && null;
  }

  function markMatches(text) {
    var q = text.toLowerCase();
    var chips = $$(".node-chip");
    var n = 0;
    chips.forEach(function (chip) {
      var hit = q && chip.dataset.name.toLowerCase().indexOf(q) !== -1;
      chip.classList.toggle("matched", hit);
      if (hit) n++;
    });
    $("#ex-match-count").textContent = n === 1 ? "1 matching entity" : n + " matching entities";
  }

  var find = $("#ex-find");
  if (find) find.addEventListener("input", function () { markMatches(find.value); });

  var slider = $("#ex-slider");
  function buildSlider() {
    api("/api/v2/context/graph?database=" + encodeURIComponent(db),
      {headers: {"API-Version": "2"}}).then(function (res) {
      if (!res.body.success) return;
      var facts = res.body.data;
      api("/api/v2/context/history?database=" + encodeURIComponent(db) +
        "&entity=&predicate=OWNED_BY", {headers: {"API-Version": "2"}}).catch(function () {});
    });
    // moments come from the history of all facts: use the graph edges
    api("/api/v2/context/graph?database=" + encodeURIComponent(db),
      {headers: {"API-Version": "2"}}).then(function (res) {
      if (!res.body.success) return;
      var moments = [];
      res.body.data.edges.forEach(function (e) {
        if (moments.indexOf(e.valid_from) === -1) moments.push(e.valid_from);
      });
      moments.sort();
      slider.min = 0;
      slider.max = moments.length;
      slider.value = moments.length;
      slider.dataset.moments = JSON.stringify(moments);
      function label() {
        var v = Number(slider.value);
        slider.setAttribute("aria-valuetext", v >= moments.length ? "now" : moments[v]);
      }
      label();
      slider.addEventListener("input", function () {
        var v = Number(slider.value);
        var t = v >= moments.length ? "" : moments[v];
        state.as_of = t;
        setParam("as_of", t);
        label();
        load();
      });
    });
  }
  buildSlider();
  load();
})();

/* settings: members, password, totp */
(function settings() {
  if (!$("#members-table")) return;

  var addForm = $("#add-member-form");
  if (addForm) {
    addForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = addForm.querySelector("button[type='submit']");
      busy(btn, true);
      api("/api/v2/members", {method: "POST", headers: {"API-Version": "2"},
        body: JSON.stringify({email: $("#am-email").value.trim(),
          role: $("#am-role").value, password: $("#am-password").value})})
        .then(function (res) {
          busy(btn, false);
          if (res.body.success) { toast("Member added"); window.location.reload(); }
          else { fieldError("add-member-error", errorMessage(res.body));
            toast(errorMessage(res.body), {error: true}); }
        }).catch(function () { busy(btn, false);
          fieldError("add-member-error", "Something went wrong. Try again."); });
    });
    $$(".role-select").forEach(function (sel) {
      sel.addEventListener("change", function () {
        api("/api/v2/members/" + encodeURIComponent(sel.dataset.email), {method: "PATCH",
          headers: {"API-Version": "2"}, body: JSON.stringify({role: sel.value})})
          .then(function (res) {
            if (res.body.success) toast("Role changed");
            else toast(errorMessage(res.body), {error: true});
          });
      });
    });
    $$(".js-remove-member").forEach(function (btn) {
      btn.addEventListener("click", function () {
        api("/api/v2/members/" + encodeURIComponent(btn.dataset.email), {method: "DELETE",
          headers: {"API-Version": "2"}}).then(function (res) {
          if (res.body.success) { toast("Member removed"); window.location.reload(); }
          else toast(errorMessage(res.body), {error: true});
        });
      });
    });
  }

  $("#logout-all").addEventListener("click", function () {
    api("/api/auth/logout-all", {method: "POST"}).then(function (res) {
      if (res.body.success) toast("Signed out everywhere");
    });
  });

  var pwForm = $("#pw-form");
  pwForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = pwForm.querySelector("button[type='submit']");
    if ($("#pw-new").value !== $("#pw-confirm").value) {
      $("#pw-mismatch").hidden = false;
      return;
    }
    $("#pw-mismatch").hidden = true;
    busy(btn, true);
    api("/api/auth/password", {method: "POST",
      body: JSON.stringify({current_password: $("#pw-current").value,
        new_password: $("#pw-new").value})}).then(function (res) {
      busy(btn, false);
      if (res.body.success) { toast("Password changed"); pwForm.reset(); }
      else { fieldError("pw-error", errorMessage(res.body)); }
    }).catch(function () { busy(btn, false);
      fieldError("pw-error", "Something went wrong. Try again."); });
  });

  var totpSetup = $("#totp-setup");
  var totpState = $("#totp-state");
  api("/api/me").then(function (res) {
    if (res.body.success) { totpState.textContent = "Off";
      if (totpSetup) totpSetup.hidden = false; }
  });
  if (totpSetup) {
    totpSetup.addEventListener("click", function () {
      api("/api/auth/totp/setup", {method: "POST"}).then(function (res) {
        if (!res.body.success) return;
        var d = res.body.data;
        var groups = d.secret.match(/.{4}/g).join(" ");
        $("#totp-key").textContent = groups;
        $("#totp-uri").textContent = d.otpauth_uri;
        $("#totp-setup-panel").hidden = false;
        totpSetup.hidden = true;
      });
    });
    $("#totp-enable").addEventListener("click", function () {
      api("/api/auth/totp/enable", {method: "POST",
        body: JSON.stringify({code: $("#totp-code").value})}).then(function (res) {
        if (res.body.success) {
          $("#totp-codes-list").textContent = res.body.data.recovery_codes.join(" ");
          $("#totp-codes").hidden = false;
          $("#totp-setup-panel").hidden = true;
          totpState.textContent = "On";
        } else {
          fieldError("totp-error", res.body.error && res.body.error.code === "BAD_TOTP" ?
            "That code is not valid" : errorMessage(res.body));
        }
      });
    });
  }
})();

/* keys page */
(function keys() {
  if (!$("#keys-table")) return;
  $("#k-scope").addEventListener("change", function () {
    $("#k-dbs-wrap").hidden = $("#k-scope").value !== "chosen";
  });
  $("#key-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("#key-form button[type='submit']");
    var body = {name: $("#k-name").value.trim(), role: $("#k-role").value};
    if ($("#k-scope").value === "chosen") {
      body.databases = Array.from($("#k-dbs").selectedOptions).map(function (o) { return o.value; });
      if (!body.databases.length) { fieldError("key-error",
        "Choose at least one database"); return; }
    }
    busy(btn, true);
    api("/api/v2/keys", {method: "POST", headers: {"API-Version": "2"},
      body: JSON.stringify(body)}).then(function (res) {
      busy(btn, false);
      if (res.body.success) {
        var d = res.body.data;
        var box = $("#key-secret");
        $("#key-secret-value").textContent = d.secret;
        box.hidden = false;
        toast("API key created");
        setTimeout(function () { window.location.reload(); }, 1500);
      } else { fieldError("key-error", errorMessage(res.body)); }
    }).catch(function () { busy(btn, false);
      fieldError("key-error", "Something went wrong. Try ago."); });
  });
  $$(".js-rotate-key").forEach(function (btn) {
    btn.addEventListener("click", function () {
      api("/api/v2/keys/" + btn.dataset.id + "/rotate", {method: "POST",
        headers: {"API-Version": "2"}}).then(function (res) {
        if (res.body.success) {
          $("#key-secret-value").textContent = res.body.data.secret;
          $("#key-secret").hidden = false;
          toast("API key rotated");
        } else { toast(errorMessage(res.body), {error: true}); }
      });
    });
  });
  $$(".js-revoke-key").forEach(function (btn) {
    btn.addEventListener("click", function () {
      api("/api/v2/keys/" + btn.dataset.id, {method: "DELETE", headers: {"API-Version": "2"}})
        .then(function (res) {
          if (res.body.success) { toast("API key revoked"); window.location.reload(); }
          else { toast(errorMessage(res.body), {error: true}); }
        });
    });
  });
})();

/* billing page */
(function billing() {
  if (!$("#plan-ship") && !$("#plan-scale")) return;
  function switchPlan(plan, btn) {
    busy(btn, true);
    api("/api/v2/org/plan", {method: "PUT", headers: {"API-Version": "2"},
      body: JSON.stringify({plan: plan})}).then(function (res) {
      busy(btn, false);
      if (res.body.success) { toast("Plan switched"); window.location.reload(); }
      else { fieldError("plan-error", errorMessage(res.body));
        toast(errorMessage(res.body), {error: true}); }
    }).catch(function () { busy(btn, false);
      fieldError("plan-error", "Something went wrong. Try again."); });
  }
  var ship = $("#plan-ship");
  if (ship) ship.addEventListener("click", function () { switchPlan("ship", ship); });
  var scale = $("#plan-scale");
  if (scale) scale.addEventListener("click", function () { switchPlan("scale", scale); });
})();

/* audit page */
(function audit() {
  if (!$("#audit-table")) return;
  var cursor = null;
  var filters = {action: params().get("action") || "", actor: params().get("actor") || ""};

  function load(more) {
    var btn = $("#audit-more");
    if (more) busy(btn, true);
    var qs = "?limit=20";
    if (filters.action) qs += "&action=" + encodeURIComponent(filters.action);
    if (filters.actor) qs += "&actor=" + encodeURIComponent(filters.actor);
    if (more && cursor) qs += "&cursor=" + encodeURIComponent(cursor);
    api("/api/v2/audit" + qs, {headers: {"API-Version": "2"}}).then(function (res) {
      if (more) busy(btn, false);
      if (!res.body.success) return;
      var events = res.body.data.events;
      cursor = res.body.data.next_cursor;
      $("#audit-more").hidden = !cursor;
      $("#audit-empty").hidden = events.length > 0 || !more;
      var rows = events.map(function (e) {
        return "<tr><td>" + escapeHtml(e.at) + "</td><td>" + escapeHtml(e.actor) +
          "</td><td>" + escapeHtml(e.action) + "</td><td>" + escapeHtml(e.target) +
          "</td><td>" + escapeHtml(e.detail) + "</td></tr>";
      }).join("");
      if (more) $("#audit-body").insertAdjacentHTML("beforeend", rows);
      else { $("#audit-body").innerHTML = rows;
        $("#audit-body").classList.add("results-stagger"); }
    });
  }
  $("#audit-more").addEventListener("click", function () { load(true); });
  $("#au-action").addEventListener("change", function () {
    filters.action = $("#au-action").value; setParam("action", filters.action); load(false); });
  $("#au-actor").addEventListener("input", function () {
    filters.actor = $("#au-actor").value; setParam("actor", filters.actor); load(false); });
  load(false);
})();
