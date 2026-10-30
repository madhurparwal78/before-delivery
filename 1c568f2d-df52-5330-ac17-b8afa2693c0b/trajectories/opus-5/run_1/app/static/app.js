/* Clearhouse desk behaviour: dialogs, lists and writes. */
(function () {
  "use strict";

  var ALLOWED_LICENCES = ["CC0", "Public domain", "CC BY 4.0", "CC BY-SA 4.0"];
  var PAGE_SIZE = 60;
  var LIST_FAILURE = "Could not load that list";
  var OFFLINE = "The desk could not be reached. Your change was not saved";

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }
  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function announce(text) {
    var region = one("[data-desk-updates]");
    if (region) region.textContent = text;
  }

  var SAID = "#said=";

  function reloadSaying(text) {
    announce(text);
    window.history.replaceState(
      {}, "",
      window.location.pathname + window.location.search + SAID + encodeURIComponent(text)
    );
    window.location.reload();
  }

  if (window.location.hash.indexOf(SAID) === 0) {
    var said = decodeURIComponent(window.location.hash.slice(SAID.length));
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
    window.setTimeout(function () { announce(said); }, 50);
  }
  function money(cents) {
    return "$" + (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }
  function escapeText(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var ICON_PATHS = {
    check: "M5 13l4.5 4.5L19 7",
    cross: "M6 6l12 12 M18 6L6 18",
    dash: "M5 12h14"
  };

  function iconMarkup(name) {
    var legs = ICON_PATHS[name].split(" M").map(function (leg, index) {
      return '<path d="' + (index ? "M" + leg : leg) + '"/>';
    });
    return (
      '<svg class="icon icon-' + name + '" viewBox="0 0 24 24" width="20" height="20"' +
      ' fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"' +
      ' stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      legs.join("") + "</svg>"
    );
  }

  /* ---------- the one request helper ---------- */
  async function send(method, url, body) {
    var options = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    var response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      throw { offline: true, message: OFFLINE };
    }
    if (response.status === 204) return {};
    var payload = null;
    try {
      payload = await response.json();
    } catch (err) {
      payload = {};
    }
    if (!response.ok) {
      var error = payload.error || {};
      throw {
        status: response.status,
        message: error.message || "That could not be done",
        field: error.field,
        lines: error.lines,
        current: payload.current
      };
    }
    return payload;
  }

  /* ---------- refusals ---------- */
  function clearRefusal(panel) {
    all(".alert", panel).forEach(function (node) { node.remove(); });
    all("[aria-invalid='true']", panel).forEach(function (node) {
      node.removeAttribute("aria-invalid");
      node.removeAttribute("aria-describedby");
    });
    all(".field-error", panel).forEach(function (node) { node.remove(); });
    var summary = one("[data-error-summary]", panel);
    if (summary) {
      summary.hidden = true;
      one("ul", summary).innerHTML = "";
    }
  }

  function showRefusal(panel, failure, piece) {
    clearRefusal(panel);
    var alert = document.createElement("div");
    alert.className = "alert";
    alert.setAttribute("role", "alert");
    alert.appendChild(document.createTextNode(failure.message));
    if (failure.lines && failure.lines.length) {
      var list = document.createElement("ul");
      failure.lines.forEach(function (line) {
        var item = document.createElement("li");
        item.textContent = line;
        list.appendChild(item);
      });
      alert.appendChild(list);
    }
    if (failure.current) {
      var reload = document.createElement("button");
      reload.type = "button";
      reload.className = "button";
      reload.textContent = "Reload piece";
      reload.addEventListener("click", function () { window.location.reload(); });
      alert.appendChild(reload);
    }
    panel.insertBefore(alert, panel.firstChild);
    if (failure.field) {
      var field = one("[name='" + failure.field + "']", panel) ||
        one("[name='" + failure.field + "']", document);
      if (field) {
        if (!field.id) field.id = "field-" + failure.field;
        field.setAttribute("aria-invalid", "true");
        var note = document.createElement("p");
        note.className = "field-error";
        note.id = field.id + "-error";
        note.textContent = failure.message;
        field.setAttribute("aria-describedby", note.id);
        field.parentNode.appendChild(note);
      }
      var summary = one("[data-error-summary]", panel) || one("[data-error-summary]");
      if (summary) {
        var line = document.createElement("li");
        var link = document.createElement("a");
        link.href = field ? "#" + field.id : "#main";
        link.textContent = failure.message;
        line.appendChild(link);
        one("ul", summary).appendChild(line);
        summary.hidden = false;
      }
    }
    announce(failure.message);
    if (piece) void piece;
  }

  function panelOf(node) {
    return node.closest(".panel") || node.closest("dialog") || one("main");
  }

  function pending(button, text) {
    if (!button) return function () {};
    var was = button.textContent;
    button.textContent = text;
    button.disabled = true;
    return function () {
      button.textContent = was;
      button.disabled = false;
    };
  }

  /* ---------- dialogs ---------- */
  var openers = new WeakMap();

  function openDialog(dialog, opener) {
    if (!dialog) return;
    openers.set(dialog, opener || null);
    dialog.showModal();
    var first = one("input[type='radio']", dialog) ||
      one("input:not([type='hidden']), textarea, select", dialog) ||
      one("button", dialog);
    if (first) first.focus();
  }

  function closeDialog(dialog, saved) {
    if (!dialog || !dialog.open) return;
    var opener = openers.get(dialog) || null;
    dialog.classList.add("closing");
    var finish = function () {
      dialog.classList.remove("closing");
      if (dialog.open) dialog.close();
      if (opener && document.contains(opener)) {
        opener.focus();
      } else if (saved) {
        var heading = one("#piece-title");
        if (heading) heading.focus();
      }
    };
    window.setTimeout(finish, 120);
  }

  document.addEventListener("click", function (event) {
    var opener = event.target.closest("[data-open-dialog]");
    if (opener) {
      openDialog(document.getElementById(opener.getAttribute("data-open-dialog")), opener);
      return;
    }
    var closer = event.target.closest("[data-close-dialog]");
    if (closer) {
      closeDialog(closer.closest("dialog"), false);
    }
  });

  all("dialog").forEach(function (dialog) {
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      closeDialog(dialog, false);
    });
    dialog.addEventListener("keydown", function (event) {
      if (event.key !== "Tab") return;
      var focusable = all(
        "button:not([disabled]), input:not([disabled]), textarea, select, a[href]", dialog
      ).filter(function (node) { return node.offsetParent !== null; });
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  });

  /* ---------- drawn cut-outs, mirrored from the server ---------- */
  function boxOf(obj) {
    var longer = 96 + (obj.id * 53) % 125;
    var scale = longer / Math.max(obj.width, obj.height);
    return [
      Math.max(24, Math.round(obj.width * scale)),
      Math.max(24, Math.round(obj.height * scale))
    ];
  }

  function cutoutMarkup(obj, width, height, label) {
    var hue = (obj.id * 47) % 360;
    var size = Math.max(9, Math.min(14, Math.floor(width / 9)));
    var room = Math.floor(width / (size * 0.52));
    var title = obj.title.length <= room ? obj.title : obj.title.slice(0, room - 1) + "…";
    return (
      '<svg class="cutout-art" width="' + width + '" height="' + height + '" viewBox="0 0 ' +
      width + " " + height + '" ' +
      (label ? 'role="img" aria-label="' + escapeText(label) + '"' : 'aria-hidden="true"') +
      ' focusable="false">' +
      '<rect x="1" y="1" width="' + (width - 2) + '" height="' + (height - 2) + '" rx="' +
      (Math.min(width, height) * 0.16).toFixed(1) + '" fill="hsl(' + hue +
      ' 46% 86%)" stroke="hsl(' + hue + ' 40% 52%)" stroke-width="1.5"/>' +
      '<ellipse cx="' + (width / 2).toFixed(1) + '" cy="' + (height * 0.44).toFixed(1) +
      '" rx="' + (width * (obj.mask_w / 90)).toFixed(1) + '" ry="' +
      (height * (obj.mask_h / 90)).toFixed(1) + '" fill="hsl(' + hue + ' 44% 68%)"/>' +
      '<text x="' + (width / 2).toFixed(1) + '" y="' + (height - size * 0.9).toFixed(1) +
      '" text-anchor="middle" font-size="' + size +
      '" fill="#2b3038" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">' +
      escapeText(title) + "</text></svg>"
    );
  }

  function blockedMarkup(obj, width, height) {
    return (
      '<span class="cutout cutout-blocked"><svg class="cutout-art" width="' + width +
      '" height="' + height + '" viewBox="0 0 ' + width + " " + height +
      '" role="img" aria-label="' + escapeText(obj.title) +
      ', licence not cleared for reuse" focusable="false"><rect x="1" y="1" width="' +
      (width - 2) + '" height="' + (height - 2) +
      '" rx="10" fill="#ffffff" stroke="#9aa2ae" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      "</svg></span>"
    );
  }

  /* ---------- board placement ---------- */
  function columnCount(width) {
    if (width <= 600) return 1;
    if (width <= 800) return 2;
    if (width <= 1000) return 3;
    return Math.max(4, Math.floor(width / 280));
  }

  function layoutBoard(board) {
    if (!board) return;
    var items = all(".board-item", board);
    if (!items.length) return;
    var count = columnCount(window.innerWidth);
    var columns = [];
    var heights = [];
    for (var index = 0; index < count; index += 1) {
      var column = document.createElement("div");
      column.className = "board-column";
      columns.push(column);
      heights.push(0);
    }
    items.forEach(function (item) {
      var shortest = 0;
      for (var index = 1; index < count; index += 1) {
        if (heights[index] < heights[shortest]) shortest = index;
      }
      columns[shortest].appendChild(item);
      heights[shortest] += Number(item.getAttribute("data-h") || 120) + 70;
    });
    board.innerHTML = "";
    columns.forEach(function (column) { board.appendChild(column); });
  }

  /* ---------- lists ---------- */
  function placeholders(host, shape, count) {
    var markup = '<div class="placeholder-rows" aria-hidden="true">';
    for (var index = 0; index < count; index += 1) {
      markup += '<div class="placeholder ' + shape + '"></div>';
    }
    host.setAttribute("aria-busy", "true");
    host.innerHTML = markup + "</div>";
  }

  function listFailure(host, retry) {
    host.removeAttribute("aria-busy");
    host.innerHTML = '<p class="empty">' + LIST_FAILURE + "</p>";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "button";
    button.textContent = "Try again";
    button.addEventListener("click", retry);
    host.appendChild(button);
    announce(LIST_FAILURE);
  }

  /* ---------- sign out ---------- */
  var signOut = one("[data-sign-out]");
  if (signOut) {
    signOut.addEventListener("click", async function () {
      var done = pending(signOut, "Signing out…");
      try {
        await send("POST", "/api/auth/logout");
        window.location.href = "/wall";
      } catch (failure) {
        done();
        showRefusal(panelOf(signOut), failure);
      }
    });
  }

  /* ---------- sign in ---------- */
  var loginForm = one("[data-login]");
  if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var button = one("[data-login-submit]", loginForm);
      var summary = one("[data-error-summary]");
      summary.hidden = true;
      one("ul", summary).innerHTML = "";
      var done = pending(button, "Signing in…");
      try {
        await send("POST", "/api/auth/login", {
          email: loginForm.email.value,
          password: loginForm.password.value
        });
        window.location.href = loginForm.next.value || "/";
      } catch (failure) {
        done();
        var item = document.createElement("li");
        var link = document.createElement("a");
        link.href = failure.field === "password" ? "#password" : "#email";
        link.textContent = failure.message;
        item.appendChild(link);
        one("ul", summary).appendChild(item);
        summary.hidden = false;
        if (failure.field) {
          var field = one("#" + failure.field, loginForm);
          if (field) field.setAttribute("aria-invalid", "true");
        }
      }
    });
  }

  /* ---------- queue ---------- */
  var queueList = one("[data-list='queue']");
  if (queueList) {
    var queueState = {
      q: (one("[data-search='q']") || {}).value || "",
      sort: (one("[data-sort]") || {}).value || "newest",
      mine: !!(one("[data-toggle='mine']") || {}).checked,
      needs: !!(one("[data-toggle='needs']") || {}).checked,
      state: new URLSearchParams(window.location.search).get("state") || "",
      page: Number(new URLSearchParams(window.location.search).get("page") || 1)
    };

    var renderQueue = function (result) {
      queueList.removeAttribute("aria-busy");
      if (!result.rows.length) {
        var filtered = queueState.q || queueState.mine || queueState.needs || queueState.state;
        queueList.innerHTML = '<p class="empty">' +
          (filtered ? "No pieces match that search" : "Nothing is waiting. Submitted pieces appear here") +
          "</p>";
      } else {
        var markup = '<table class="queue-table"><caption class="visually-hidden">' +
          "Pieces this account may see</caption><thead><tr>" +
          "<th scope=\"col\">Title</th><th scope=\"col\">Maker</th><th scope=\"col\">State</th>" +
          "<th scope=\"col\">Licence review</th><th scope=\"col\">Accessibility review</th>" +
          "<th scope=\"col\" class=\"wide-only\">Fee</th>" +
          "<th scope=\"col\" class=\"wide-only\">Updated</th></tr></thead><tbody>";
        result.rows.forEach(function (piece) {
          markup += "<tr>" +
            '<td data-label="Title"><a href="/pieces/' + piece.id + '">' +
            escapeText(piece.title) + "</a></td>" +
            '<td data-label="Maker">' + escapeText(piece.owner.name) + "</td>" +
            '<td data-label="State"><span class="chip chip-' + piece.state + '">' +
            piece.state + "</span></td>" +
            '<td data-label="Licence review">' + markMarkup(piece.licence_review) + "</td>" +
            '<td data-label="Accessibility review">' + markMarkup(piece.accessibility_review) +
            "</td>" +
            '<td data-label="Fee" class="wide-only figure">' + money(piece.fee_cents) + "</td>" +
            '<td data-label="Updated" class="wide-only figure">' +
            escapeText(whenText(piece.updated_at)) + "</td></tr>";
        });
        queueList.innerHTML = markup + "</tbody></table>";
      }
      var counted = 0;
      Object.keys(result.counts).forEach(function (key) { counted += result.counts[key]; });
      all(".state-list .count").forEach(function (node) {
        var name = one(".state-name", node.parentNode).textContent.trim();
        if (result.counts[name] !== undefined) node.textContent = result.counts[name];
      });
      var line = one("[data-result-line]");
      if (line) {
        line.textContent = result.rows.length + " of " + counted + " pieces";
        announce(line.textContent);
      }
    };

    var loadQueue = function () {
      var params = new URLSearchParams();
      if (queueState.q) params.set("q", queueState.q);
      if (queueState.sort) params.set("sort", queueState.sort);
      if (queueState.mine) params.set("mine", "1");
      if (queueState.needs) params.set("needs", "1");
      if (queueState.state) params.set("state", queueState.state);
      if (queueState.page > 1) params.set("page", String(queueState.page));
      placeholders(queueList, "", 8);
      window.history.replaceState({}, "", "/?" + params.toString());
      send("GET", "/api/pieces?" + params.toString())
        .then(renderQueue)
        .catch(function () { listFailure(queueList, loadQueue); });
    };

    var search = one("[data-search='q']");
    if (search) {
      var timer = null;
      search.addEventListener("input", function () {
        var text = search.value.trim();
        if (text.length === 1) return;
        queueState.q = text;
        queueState.page = 1;
        window.clearTimeout(timer);
        timer = window.setTimeout(loadQueue, 180);
      });
    }
    var clearSearch = one("[data-clear-search='q']");
    if (clearSearch) {
      clearSearch.addEventListener("click", function () {
        search.value = "";
        queueState.q = "";
        loadQueue();
      });
    }
    var sorter = one("[data-sort]");
    if (sorter) {
      sorter.addEventListener("change", function () {
        queueState.sort = sorter.value;
        queueState.page = 1;
        loadQueue();
      });
    }
    all("[data-toggle]").forEach(function (toggle) {
      toggle.addEventListener("change", function () {
        queueState[toggle.getAttribute("data-toggle")] = toggle.checked;
        queueState.page = 1;
        loadQueue();
      });
    });
    var clearFilters = one("[data-clear-filters]");
    if (clearFilters) {
      clearFilters.addEventListener("click", function () {
        queueState.q = "";
        queueState.mine = false;
        queueState.needs = false;
        queueState.state = "";
        queueState.page = 1;
        if (search) search.value = "";
        all("[data-toggle]").forEach(function (toggle) { toggle.checked = false; });
        all(".state-list a").forEach(function (link) { link.classList.remove("on"); });
        loadQueue();
      });
    }
    var filtersToggle = one("[data-filters-toggle]");
    if (filtersToggle) {
      filtersToggle.addEventListener("click", function () {
        var sidebar = one("#queue-filters");
        var open = sidebar.classList.toggle("open");
        filtersToggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
  }

  function markMarkup(result) {
    if (result === "pass") {
      return '<span class="mark mark-pass">' + iconMarkup("check") + "Passed</span>";
    }
    if (result === "fail") {
      return '<span class="mark mark-fail">' + iconMarkup("cross") + "Failed</span>";
    }
    return '<span class="mark mark-none">' + iconMarkup("dash") + "Not yet</span>";
  }

  function whenText(iso) {
    if (!iso) return "";
    var moment = new Date(iso);
    if (document.documentElement.getAttribute("data-dates") === "absolute") {
      return iso.replace("T", " ").slice(0, 19);
    }
    var seconds = Math.max(0, Math.floor((Date.now() - moment.getTime()) / 1000));
    if (seconds < 60) return "just now";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.floor(hours / 24);
    if (days < 30) return days + (days === 1 ? " day ago" : " days ago");
    var months = Math.floor(days / 30);
    if (months < 12) return months + (months === 1 ? " month ago" : " months ago");
    var years = Math.floor(days / 365);
    return years + (years === 1 ? " year ago" : " years ago");
  }

  /* ---------- new piece ---------- */
  var newPiece = one("[data-new-piece]");
  if (newPiece) {
    var newPanel = one("[data-new-piece-panel]");
    newPiece.addEventListener("click", function () {
      newPanel.hidden = false;
      one("#new-title", newPanel).focus();
    });
    one("[data-save-new]", newPanel).addEventListener("click", async function (event) {
      var button = event.currentTarget;
      var done = pending(button, "Saving…");
      announce("Saving");
      try {
        var piece = await send("POST", "/api/pieces", {
          title: one("#new-title", newPanel).value,
          summary: one("#new-summary", newPanel).value,
          fee_cents: Math.round(Number(one("#new-fee", newPanel).value || 0) * 100)
        });
        window.location.href = "/pieces/" + piece.id + SAID + encodeURIComponent("Draft saved");
      } catch (failure) {
        done();
        showRefusal(newPanel, failure);
      }
    });
  }

  /* ---------- the piece desk ---------- */
  var desk = one(".desk");
  if (desk) {
    var pieceId = desk.getAttribute("data-piece");
    var version = function () { return Number(desk.getAttribute("data-version")); };
    var deskPanel = one(".desk-main", desk);

    var moved = function (piece) {
      reloadSaying(piece.title + " moved to " + piece.state);
    };

    var step = async function (button, action, reason, day) {
      var dialog = button.closest("dialog");
      var panel = dialog || deskPanel;
      clearRefusal(panel);
      var done = pending(button, "Saving…");
      var body = { version: version(), action: action };
      if (reason !== undefined) body.reason = reason;
      if (day !== undefined) body.day = day;
      try {
        var piece = await send("POST", "/api/pieces/" + pieceId + "/transition", body);
        if (dialog) closeDialog(dialog, true);
        moved(piece);
      } catch (failure) {
        done();
        showRefusal(panel, failure);
      }
    };

    all("[data-action]", document).forEach(function (button) {
      if (!button.closest(".desk") && !button.closest("dialog")) return;
      button.addEventListener("click", function () {
        var action = button.getAttribute("data-action");
        if (button.hasAttribute("data-needs-reason")) {
          var dialog = button.closest("dialog");
          step(button, action, one("textarea[name='reason']", dialog).value);
        } else {
          step(button, action);
        }
      });
    });

    var bookButton = one("[data-book-day]");
    if (bookButton) {
      bookButton.addEventListener("click", function () {
        step(bookButton, "schedule", undefined, one("#book-day").value);
      });
    }

    var saveDraft = one("[data-save-draft]", desk);
    if (saveDraft) {
      saveDraft.addEventListener("click", async function () {
        clearRefusal(deskPanel);
        var done = pending(saveDraft, "Saving…");
        announce("Saving");
        try {
          await send("PATCH", "/api/pieces/" + pieceId, {
            version: version(),
            title: one("#piece-title-field", desk).value,
            summary: one("#piece-summary-field", desk).value,
            fee_cents: Math.round(Number(one("#piece-fee-field", desk).value || 0) * 100)
          });
          reloadSaying("Draft saved");
        } catch (failure) {
          done();
          showRefusal(deskPanel, failure);
        }
      });
    }

    all("[data-save-review]").forEach(function (button) {
      button.addEventListener("click", async function () {
        var dialog = button.closest("dialog");
        var kind = dialog.getAttribute("data-review-kind");
        clearRefusal(dialog);
        var done = pending(button, "Saving…");
        var result = one("input[name='result-" + kind + "']:checked", dialog).value;
        try {
          var saved = await send("POST", "/api/pieces/" + pieceId + "/reviews", {
            version: version(),
            kind: kind,
            result: result,
            reason: one("#reason-" + kind, dialog).value || null
          });
          closeDialog(dialog, true);
          announce(
            (kind === "licence" ? "Licence" : "Accessibility") +
            " review recorded as " + (result === "pass" ? "passed" : "failed")
          );
          landStamp(kind, result, saved);
        } catch (failure) {
          done();
          showRefusal(dialog, failure);
        }
      });
    });

    var landStamp = function (kind, result, saved) {
      var slot = one("[data-review-slot='" + kind + "']", desk);
      if (slot) {
        var label = (kind === "licence" ? "Licence" : "Accessibility");
        one(".review-result", slot).innerHTML = markMarkup(result);
        var stamp = document.createElement("span");
        stamp.className = "stamp stamp-" + result + " landing";
        stamp.setAttribute("role", "img");
        stamp.setAttribute(
          "aria-label", label + " review " + (result === "pass" ? "passed" : "failed")
        );
        stamp.innerHTML = iconMarkup(result === "pass" ? "check" : "cross") +
          "<span>" + (result === "pass" ? "Passed" : "Failed") + "</span>";
        slot.appendChild(stamp);
      }
      desk.setAttribute("data-version", String(saved.piece.version));
      window.setTimeout(function () {
        reloadSaying(
          (kind === "licence" ? "Licence" : "Accessibility") + " review recorded as " +
          (result === "pass" ? "passed" : "failed")
        );
      }, 900);
    };

    var picker = one("#picker-dialog");
    if (picker) {
      var pickerBoard = one("[data-picker-board]", picker);
      var citedMessage = "0 objects cited";
      var cited = all("[data-cited] .cited").map(function (node) {
        return Number(node.getAttribute("data-object"));
      });
      var loadPicker = function (cursor) {
        placeholders(pickerBoard, "placeholder-card", 6);
        send("GET", "/api/objects?limit=24" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""))
          .then(function (result) {
            pickerBoard.removeAttribute("aria-busy");
            pickerBoard.innerHTML = "";
            var board = document.createElement("div");
            board.className = "board";
            result.objects.forEach(function (obj) {
              var size = boxOf(obj);
              var item = document.createElement("div");
              item.className = "board-item";
              item.setAttribute("data-h", String(size[1]));
              if (ALLOWED_LICENCES.indexOf(obj.license) === -1) {
                item.innerHTML = blockedMarkup(obj, size[0], size[1]) +
                  '<p class="board-caption">' + escapeText(obj.title) + "</p>" +
                  '<p class="board-blocked">Licence not cleared for reuse</p>';
              } else {
                item.innerHTML = '<button type="button" class="cutout picker-item" ' +
                  'data-pick="' + obj.id + '" aria-label="' + escapeText(obj.title) + '">' +
                  cutoutMarkup(obj, size[0], size[1], obj.title) + "</button>" +
                  '<p class="board-caption">' + escapeText(obj.title) + "</p>";
              }
              board.appendChild(item);
            });
            pickerBoard.appendChild(board);
            layoutBoard(board);
          })
          .catch(function () { listFailure(pickerBoard, function () { loadPicker(cursor); }); });
      };
      one("[data-open-dialog='picker-dialog']").addEventListener("click", function () {
        loadPicker(null);
      });
      pickerBoard.addEventListener("click", async function (event) {
        var pick = event.target.closest("[data-pick]");
        if (!pick) return;
        var objectId = Number(pick.getAttribute("data-pick"));
        if (cited.indexOf(objectId) === -1) cited.push(objectId);
        announce("Saving");
        try {
          var saved = await send("PUT", "/api/pieces/" + pieceId + "/objects", {
            version: version(),
            object_ids: cited
          });
          desk.setAttribute("data-version", String(saved.piece.version));
          citedMessage = saved.objects.length + " objects cited";
          announce(citedMessage);
        } catch (failure) {
          cited = cited.filter(function (id) { return id !== objectId; });
          showRefusal(picker, failure);
        }
      });
      picker.addEventListener("close", function () { reloadSaying(citedMessage); });
    }
  }

  /* ---------- catalogue ---------- */
  var catalogue = one(".catalogue");
  if (catalogue) {
    var board = one("[data-board]", catalogue);
    layoutBoard(board);
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        layoutBoard(one("[data-board]", catalogue));
      }, 150);
    });

    var walk = {
      seed: Number(catalogue.getAttribute("data-seed")) || 1,
      cursor: catalogue.getAttribute("data-cursor") || "",
      next: catalogue.getAttribute("data-next") || "",
      licence: catalogue.getAttribute("data-licence") || "",
      q: catalogue.getAttribute("data-q") || "",
      history: [],
      offset: 0
    };
    var host = one("[data-list='catalogue']", catalogue);

    var address = function () {
      var params = new URLSearchParams();
      params.set("seed", String(walk.seed));
      if (walk.cursor) params.set("cursor", walk.cursor);
      if (walk.licence) params.set("license", walk.licence);
      if (walk.q) params.set("q", walk.q);
      window.history.replaceState({}, "", "/catalogue?" + params.toString());
    };

    var loadBoard = function () {
      placeholders(host, "placeholder-card", 8);
      var params = new URLSearchParams();
      params.set("seed", String(walk.seed));
      params.set("limit", String(PAGE_SIZE));
      if (walk.cursor) params.set("cursor", walk.cursor);
      if (walk.licence) params.set("license", walk.licence);
      if (walk.q) params.set("q", walk.q);
      send("GET", "/api/objects?" + params.toString())
        .then(function (result) {
          host.removeAttribute("aria-busy");
          walk.next = result.nextCursor;
          if (!result.objects.length) {
            host.innerHTML = '<p class="empty">No objects match that search</p>';
          } else {
            var fresh = document.createElement("div");
            fresh.className = "board";
            fresh.setAttribute("data-board", "");
            var drawn = result.objects.map(function (obj) {
              var size = boxOf(obj);
              return { obj: obj, w: size[0], h: size[1] };
            });
            drawn.sort(function (left, right) { return right.w * right.h - left.w * left.h; });
            drawn.forEach(function (entry) {
              var item = document.createElement("div");
              item.className = "board-item";
              item.setAttribute("data-w", String(entry.w));
              item.setAttribute("data-h", String(entry.h));
              if (ALLOWED_LICENCES.indexOf(entry.obj.license) === -1) {
                item.innerHTML = blockedMarkup(entry.obj, entry.w, entry.h) +
                  '<p class="board-caption">' + escapeText(entry.obj.title) + "</p>" +
                  '<p class="board-blocked">Licence not cleared for reuse</p>';
              } else {
                item.innerHTML = '<a class="cutout" href="/catalogue/' + entry.obj.id +
                  '" aria-label="' + escapeText(entry.obj.title) + '">' +
                  cutoutMarkup(entry.obj, entry.w, entry.h, entry.obj.title) +
                  '<span class="cutout-strip"><span>' +
                  escapeText(entry.obj.artist || "Not recorded") + "</span><span>" +
                  escapeText(entry.obj.license) + "</span></span></a>" +
                  '<p class="board-caption">' + escapeText(entry.obj.title) + "</p>";
              }
              fresh.appendChild(item);
            });
            host.innerHTML = "";
            host.appendChild(fresh);
            layoutBoard(fresh);
          }
          var count = one("[data-count-line]", catalogue);
          if (count) {
            count.innerHTML = '<span class="figure">' + result.total +
              "</span> objects in the catalogue";
          }
          var showing = one("[data-showing]", catalogue);
          if (showing) {
            showing.innerHTML = 'Showing <span class="figure">' +
              (result.objects.length ? walk.offset + 1 : 0) +
              '</span> to <span class="figure">' + (walk.offset + result.objects.length) +
              '</span> of <span class="figure">' + result.total + "</span>";
          }
          var nextControl = one("[data-next-page]", catalogue);
          nextControl.textContent = result.wrap ? "End of catalogue" : "Next";
          nextControl.disabled = result.wrap;
          if (result.wrap) nextControl.setAttribute("data-wrapped", "1");
          else nextControl.removeAttribute("data-wrapped");
          one("[data-previous]", catalogue).disabled = walk.history.length === 0;
          address();
        })
        .catch(function () { listFailure(host, loadBoard); });
    };

    var shuffle = one("[data-shuffle]", catalogue);
    shuffle.addEventListener("click", function () {
      walk.seed = Math.floor(Math.random() * 2147483647) + 1;
      walk.cursor = "";
      walk.history = [];
      walk.offset = 0;
      loadBoard();
    });
    one("[data-licence-filter]", catalogue).addEventListener("change", function (event) {
      walk.licence = event.currentTarget.value;
      walk.cursor = "";
      walk.history = [];
      walk.offset = 0;
      loadBoard();
    });
    var objectSearch = one("[data-search='q']");
    if (objectSearch) {
      var catalogueTimer = null;
      objectSearch.addEventListener("input", function () {
        var text = objectSearch.value.trim();
        if (text.length === 1) return;
        walk.q = text;
        walk.cursor = "";
        walk.history = [];
        walk.offset = 0;
        window.clearTimeout(catalogueTimer);
        catalogueTimer = window.setTimeout(loadBoard, 200);
      });
      var clearObjects = one("[data-clear-search='q']");
      if (clearObjects) {
        clearObjects.addEventListener("click", function () {
          objectSearch.value = "";
          walk.q = "";
          walk.cursor = "";
          walk.history = [];
          walk.offset = 0;
          loadBoard();
        });
      }
    }
    one(".pager", catalogue).addEventListener("submit", function (event) {
      event.preventDefault();
    });
    var nextPage = one("[data-next-page]", catalogue);
    if (nextPage) {
      nextPage.addEventListener("click", function (event) {
        event.preventDefault();
        if (nextPage.getAttribute("data-wrapped") === "1") return;
        walk.history.push(walk.cursor);
        walk.offset += all(".board-item", catalogue).length;
        walk.cursor = walk.next;
        loadBoard();
      });
    }
    var previousPage = one("[data-previous]", catalogue);
    if (previousPage) {
      previousPage.addEventListener("click", function (event) {
        event.preventDefault();
        if (!walk.history.length) return;
        walk.cursor = walk.history.pop();
        walk.offset = Math.max(0, walk.offset - PAGE_SIZE);
        loadBoard();
      });
    }
  }

  /* ---------- object detail: acknowledge ---------- */
  var objectPage = one(".object-page");
  if (objectPage) {
    var contextPiece = objectPage.getAttribute("data-piece");
    var objectId = Number(objectPage.getAttribute("data-object"));
    all("[data-acknowledge]", objectPage).forEach(function (button) {
      button.addEventListener("click", async function () {
        var panel = panelOf(button);
        clearRefusal(panel);
        var done = pending(button, "Saving…");
        try {
          await send("POST", "/api/pieces/" + contextPiece + "/duplicate-acks", {
            object_id: objectId,
            duplicate_object_id: Number(button.getAttribute("data-acknowledge"))
          });
          reloadSaying("Duplicate acknowledged");
        } catch (failure) {
          done();
          showRefusal(panel, failure);
        }
      });
    });
  }

  /* ---------- schedule ---------- */
  var schedulePage = one(".schedule-page");
  if (schedulePage) {
    var bookDialog = one("#book-dialog");
    var unscheduleDialog = one("#unschedule-dialog");
    var chosenDay = null;
    var chosenPiece = null;
    var chosenTitle = "";
    all("[data-day]", schedulePage).forEach(function (cell) {
      cell.addEventListener("click", function () {
        chosenDay = cell.getAttribute("data-day");
        var booked = cell.getAttribute("data-booked");
        if (booked) {
          chosenTitle = (one(".day-title", cell) || {}).textContent || "";
          one("[data-unschedule-target]", unscheduleDialog).textContent = chosenDay;
          openDialog(unscheduleDialog, cell);
        } else {
          chosenPiece = null;
          one("[data-book-target]", bookDialog).textContent = chosenDay;
          openDialog(bookDialog, cell);
        }
      });
    });
    if (bookDialog) {
      all("[data-book-piece]", bookDialog).forEach(function (choice) {
        choice.addEventListener("click", function () {
          chosenPiece = Number(choice.getAttribute("data-book-piece"));
          chosenTitle = choice.textContent.trim();
          all("[data-book-piece]", bookDialog).forEach(function (other) {
            other.classList.remove("button-primary");
          });
          choice.classList.add("button-primary");
        });
      });
      one("[data-book-confirm]", bookDialog).addEventListener("click", async function (event) {
        var button = event.currentTarget;
        clearRefusal(bookDialog);
        if (!chosenPiece) {
          showRefusal(bookDialog, { message: "Choose a cleared piece first" });
          return;
        }
        var done = pending(button, "Saving…");
        try {
          await send("PUT", "/api/schedule/" + chosenDay, { piece_id: chosenPiece });
          reloadSaying(chosenTitle + " moved to scheduled");
        } catch (failure) {
          done();
          showRefusal(bookDialog, failure);
        }
      });
    }
    if (unscheduleDialog) {
      one("[data-unschedule-confirm]", unscheduleDialog)
        .addEventListener("click", async function (event) {
          var button = event.currentTarget;
          clearRefusal(unscheduleDialog);
          var done = pending(button, "Saving…");
          try {
            await send("DELETE", "/api/schedule/" + chosenDay);
            reloadSaying(chosenTitle + " moved to cleared");
          } catch (failure) {
            done();
            showRefusal(unscheduleDialog, failure);
          }
        });
    }
  }

  /* ---------- budget ---------- */
  var budgetPage = one(".budget-page");
  if (budgetPage) {
    var quarter = budgetPage.getAttribute("data-quarter");
    all("[data-budget-row]", budgetPage).forEach(function (row) {
      var amount = one("[data-amount]", row);
      all("[data-times]", row).forEach(function (button) {
        button.addEventListener("click", function () {
          var factor = Number(button.getAttribute("data-times"));
          amount.value = (Number(amount.value || 0) * factor).toFixed(2);
        });
      });
      one("[data-apply]", row).addEventListener("click", async function (event) {
        var button = event.currentTarget;
        clearRefusal(budgetPage);
        var done = pending(button, "Saving…");
        try {
          var figures = await send("PATCH", "/api/budget/" + quarter, {
            piece_id: Number(row.getAttribute("data-budget-row")),
            delta_cents: Math.round(Number(amount.value || 0) * 100),
            version: Number(row.getAttribute("data-version"))
          });
          var changed = figures.rows.filter(function (entry) {
            return String(entry.id) === row.getAttribute("data-budget-row");
          })[0];
          reloadSaying("Fee for " + changed.title + " is now " + money(changed.fee_cents));
        } catch (failure) {
          done();
          showRefusal(budgetPage, failure);
        }
      });
    });
    var resetFees = one("[data-reset-fees]");
    if (resetFees) {
      resetFees.addEventListener("click", async function () {
        var dialog = resetFees.closest("dialog");
        clearRefusal(dialog);
        var done = pending(resetFees, "Saving…");
        try {
          await send("PATCH", "/api/budget/" + quarter, { reset: true });
          reloadSaying("Every fee this quarter is back to its submitted value");
        } catch (failure) {
          done();
          showRefusal(dialog, failure);
        }
      });
    }
  }

  /* ---------- audit ---------- */
  var auditPage = one(".audit-page");
  if (auditPage) {
    var auditHost = one("[data-list='audit']", auditPage);
    var auditForm = one(".audit-filters", auditPage);
    var auditQuery = function () {
      var params = new URLSearchParams();
      [["piece", "piece"], ["actor", "actor"], ["to", "to"],
       ["from", "from"], ["until", "until"]].forEach(function (pair) {
        var field = one("#" + pair[0], auditForm);
        if (field && field.value) params.set(pair[1], field.value);
      });
      return params;
    };
    var renderAudit = function (result) {
      auditHost.removeAttribute("aria-busy");
      if (!result.rows.length) {
        auditHost.innerHTML = '<p class="empty">No entries match these filters</p>';
        return;
      }
      var markup = '<table class="audit-table"><caption class="visually-hidden">' +
        "Audit entries, newest first</caption><thead><tr><th scope=\"col\">When</th>" +
        "<th scope=\"col\">Piece</th><th scope=\"col\">Actor</th><th scope=\"col\">From</th>" +
        "<th scope=\"col\">To</th><th scope=\"col\">Reason</th></tr></thead><tbody>";
      result.rows.forEach(function (entry) {
        markup += "<tr>" +
          '<td data-label="When" class="figure">' + whenText(entry.created_at) + "</td>" +
          '<td data-label="Piece"><a href="/pieces/' + entry.piece_id + '">' +
          escapeText(entry.piece_title) + "</a></td>" +
          '<td data-label="Actor">' + escapeText(entry.actor.name) + "</td>" +
          '<td data-label="From">' + escapeText(entry.from_state || "—") + "</td>" +
          '<td data-label="To">' + escapeText(entry.to_state) + "</td>" +
          '<td data-label="Reason">' + escapeText(entry.reason || "") + "</td></tr>";
      });
      auditHost.innerHTML = markup + "</tbody></table>";
    };
    var loadAudit = function () {
      var params = auditQuery();
      placeholders(auditHost, "", 8);
      window.history.replaceState({}, "", "/audit?" + params.toString());
      send("GET", "/api/audit?" + params.toString())
        .then(renderAudit)
        .catch(function () { listFailure(auditHost, loadAudit); });
    };
    auditForm.addEventListener("submit", function (event) {
      event.preventDefault();
      loadAudit();
    });
    var exportLink = one(".audit-header .button", auditPage);
    auditForm.addEventListener("change", function () {
      var params = auditQuery().toString();
      exportLink.href = "/api/audit/export" + (params ? "?" + params : "");
    });
  }

  /* ---------- settings ---------- */
  var settingsPage = one(".settings-page");
  if (settingsPage) {
    var savePreference = async function (body) {
      clearRefusal(settingsPage);
      try {
        await send("PUT", "/api/preferences", body);
        announce("Preferences saved");
      } catch (failure) {
        showRefusal(settingsPage, failure);
      }
    };
    var rows = one("[data-pref='rows_per_page']", settingsPage);
    rows.addEventListener("change", function () {
      savePreference({ rows_per_page: Number(rows.value) });
    });
    all("input[data-pref='date_display']", settingsPage).forEach(function (radio) {
      radio.addEventListener("change", function () {
        if (radio.checked) savePreference({ date_display: radio.value });
      });
    });
    var contrast = one("button[data-pref='high_contrast']", settingsPage);
    contrast.addEventListener("click", function () {
      var wanted = contrast.getAttribute("aria-checked") !== "true";
      contrast.setAttribute("aria-checked", wanted ? "true" : "false");
      if (wanted) {
        document.documentElement.setAttribute("data-contrast", "on");
      } else {
        document.documentElement.removeAttribute("data-contrast");
      }
      savePreference({ high_contrast: wanted });
    });
    var exportPack = one("[data-export-pack]", settingsPage);
    if (exportPack) {
      exportPack.addEventListener("click", async function () {
        var done = pending(exportPack, "Saving…");
        try {
          var document_ = await send("GET", "/api/pack");
          var blob = new Blob([JSON.stringify(document_, null, 2)], { type: "application/json" });
          var link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = "clearhouse-pack.json";
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(link.href);
        } catch (failure) {
          showRefusal(settingsPage, failure);
        }
        done();
      });
    }
    var importPack = one("[data-import-pack]", settingsPage);
    if (importPack) {
      importPack.addEventListener("change", async function () {
        var file = importPack.files[0];
        if (!file) return;
        importPack.disabled = true;
        clearRefusal(settingsPage);
        try {
          var document_ = JSON.parse(await file.text());
          var result = await send("POST", "/api/pack", document_);
          announce("Imported " + result.imported + " pieces");
        } catch (failure) {
          showRefusal(settingsPage, failure.message ? failure : { message: "Send a JSON object" });
        }
        importPack.disabled = false;
        importPack.value = "";
      });
    }
  }
})();
