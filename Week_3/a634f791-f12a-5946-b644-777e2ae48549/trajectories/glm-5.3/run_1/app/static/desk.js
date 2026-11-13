/* The reference desk: a working surface. Row state, move buttons and
   expiry text come only from server data; the browser never works out live
   or withheld from its own clock. Focus never falls to the page. */

(function () {
  "use strict";

  var SIGNIN_PANEL = document.getElementById("signin-panel");
  var SIGNIN_FORM = document.getElementById("signin-form");
  var SIGNIN_BUTTON = document.getElementById("signin-button");
  var SIGNIN_ERROR = document.getElementById("signin-error");
  var WORK = document.getElementById("desk-work");
  var MESSAGES = document.getElementById("desk-messages");
  var LIST = document.getElementById("desk-list");
  var QUEUE = document.getElementById("desk-queue");
  var TOTALS = document.getElementById("desk-totals");
  var ENQUIRY_TOTALS = document.getElementById("enquiry-totals");
  var NEW_REFERENCE = document.getElementById("new-reference");
  var EDITOR_SLOT = document.getElementById("editor-slot");
  var ROW_TEMPLATE = document.getElementById("desk-row-template");
  var ENQUIRY_TEMPLATE = document.getElementById("enquiry-row-template");
  var EDITOR_TEMPLATE = document.getElementById("editor-template");
  var FIGURE_TEMPLATE = document.getElementById("figure-template");

  var token = null;              // kept for the browser tab session only
  var role = null;
  var references = [];           // the server's own list, always the truth
  var enquiries = [];
  var editor = null;             // { slug, version, creating, figures }
  var pendingAction = null;      // an action caught by the session's end
  var busyRows = {};             // one request in flight per row or form

  /* The desk's focus target for each action is decided in one place: the
     row and editor actions find their own targets (the moved row's button,
     the new figure's label, the next enquiry's Delete), and the two fixed
     targets live here. */
  var focusTargets = {
    signIn: "references-heading",
    enquiriesHeading: "enquiries-heading"
  };

  /* ------------------------------------------------------------ messages
     The same message twice in a row is still a fresh change: the region
     empties first, then takes the text. Messages stay until the next
     action; no timer clears them. */

  function announce(text, isError) {
    MESSAGES.textContent = "";
    requestAnimationFrame(function () { MESSAGES.textContent = text; });
    MESSAGES.classList.toggle("error", Boolean(isError));
  }

  /* -------------------------------------------------------------- helper */

  function api(path, options) {
    options = options || {};
    options.headers = options.headers || {};
    if (token) options.headers["Authorization"] = "Bearer " + token;
    if (options.json !== undefined) {
      options.method = options.method || "POST";
      options.headers["Content-Type"] = "application/json";
      if (options.ifMatch) {
        options.headers["If-Match"] = '"' + options.ifMatch + '"';
        delete options.ifMatch;
      }
      options.body = JSON.stringify(options.json);
      delete options.json;
    }
    return fetch(path, options).then(function (response) {
      return response.text().then(function (text) {
        var data = null;
        if (text) {
          try { data = JSON.parse(text); } catch (error) { data = null; }
        }
        return { status: response.status, data: data };
      });
    });
  }

  function helsinkiTime(iso) {
    /* The server sends UTC instants; the desk shows Helsinki local time in
       the published form: day.month.year hours:minutes, no leading zero on
       day or month, two digits for hours and minutes. */
    var date = new Date(iso);
    var parts;
    try {
      parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Helsinki", day: "numeric", month: "numeric",
        year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
      }).formatToParts(date);
    } catch (error) {
      return date.toISOString();
    }
    var values = {};
    parts.forEach(function (part) {
      if (part.type !== "literal") values[part.type] = part.value;
    });
    return values.day + "." + values.month + "." + values.year + " "
      + values.hour + ":" + values.minute;
  }

  /* ------------------------------------------------------------- sign in */

  SIGNIN_FORM.addEventListener("submit", function (event) {
    event.preventDefault();
    if (SIGNIN_BUTTON.disabled) return;
    SIGNIN_BUTTON.disabled = true;
    SIGNIN_BUTTON.textContent = "Signing in…";
    SIGNIN_ERROR.hidden = true;
    api("/api/auth/login", {
      method: "POST",
      json: { email: SIGNIN_FORM.email.value, password: SIGNIN_FORM.password.value }
    }).then(function (result) {
      SIGNIN_BUTTON.disabled = false;
      SIGNIN_BUTTON.textContent = "Sign in";
      if (result.status !== 200) {
        SIGNIN_ERROR.textContent = (result.data && result.data.message)
          || "The address or password is not right";
        SIGNIN_ERROR.hidden = false;
        return;
      }
      token = result.data.token;
      role = result.data.role;
      if (pendingAction) {
        retryPending();
        return;
      }
      enterDesk();
    }).catch(function () {
      SIGNIN_BUTTON.disabled = false;
      SIGNIN_BUTTON.textContent = "Sign in";
      announce("The desk cannot be reached. Your change was not saved.", true);
    });
  });

  function enterDesk() {
    SIGNIN_PANEL.hidden = true;
    WORK.hidden = false;
    reload().then(function () {
      focusOn(focusTargets.signIn);
    });
  }

  function focusOn(id) {
    var node = document.getElementById(id);
    if (node) node.focus();
  }

  /* --------------------------------------------------------- list re-read
     A completed action on another row re-reads the list without losing
     the editor's typed values, caret position or row association. */

  function saveEditorState() {
    if (!editor) return null;
    var state = { caret: {} };
    var form = document.getElementById("reference-editor");
    if (!form) return state;
    form.querySelectorAll("[data-field]").forEach(function (input) {
      state[input.dataset.field] = input.value;
      state.caret[input.dataset.field] = input.selectionStart || 0;
    });
    form.querySelectorAll("[data-clearance]").forEach(function (input) {
      state["clearance." + input.dataset.clearance] = input.value;
    });
    var figures = [];
    form.querySelectorAll(".figure-edit").forEach(function (row) {
      figures.push({
        label: row.querySelector('[data-figure="label"]').value,
        value: row.querySelector('[data-figure="value"]').value
      });
    });
    state.figures = figures;
    if (document.activeElement) {
      if (document.activeElement.dataset.field) {
        state.focusField = document.activeElement.dataset.field;
      } else if (document.activeElement.dataset.clearance) {
        state.focusClearance = document.activeElement.dataset.clearance;
      }
    }
    return state;
  }

  function restoreEditorState(state) {
    if (!editor || !state) return;
    var form = document.getElementById("reference-editor");
    if (!form) return;
    Object.keys(state.caret || {}).forEach(function (key) {
      var input = form.querySelector('[data-field="' + key + '"]');
      if (!input) return;
      input.value = state[key];
      try { input.setSelectionRange(state.caret[key], state.caret[key]); }
      catch (error) { /* not a text field */ }
    });
    Object.keys(state).forEach(function (key) {
      if (key.indexOf("clearance.") !== 0) return;
      var input = form.querySelector(
        '[data-clearance="' + key.slice(11) + '"]');
      if (input) input.value = state[key];
    });
    (state.figures || []).forEach(function (figure, index) {
      var row = form.querySelectorAll(".figure-edit")[index];
      if (!row) return;
      row.querySelector('[data-figure="label"]').value = figure.label;
      row.querySelector('[data-figure="value"]').value = figure.value;
    });
    if (state.focusField) {
      var target = form.querySelector('[data-field="' + state.focusField + '"]');
      if (target) target.focus();
    } else if (state.focusClearance) {
      var clearanceTarget = form.querySelector(
        '[data-clearance="' + state.focusClearance + '"]');
      if (clearanceTarget) clearanceTarget.focus();
    }
  }

  function reload() {
    var saved = saveEditorState();
    return api("/api/desk/references").then(function (result) {
      if (result.status === 401) return sessionEnded();
      if (result.status === 503) {
        announce("The desk cannot be reached. Your change was not saved.", true);
        return;
      }
      references = result.data || [];
      return api("/api/desk/enquiries").then(function (enquiryResult) {
        if (enquiryResult.status === 401) return sessionEnded();
        enquiries = enquiryResult.data || [];
        render();
        if (editor) {
          // The editor follows its row: a slug change moves with it.
          var current = references.filter(function (r) { return r.slug === editor.slug; })[0];
          if (!current && editor.previousSlug) {
            current = references.filter(function (r) { return r.slug === editor.previousSlug; })[0];
          }
          if (current && current.slug !== editor.slug) {
            editor.slug = current.slug;
          }
          if (current) {
            editor.version = current.version || editor.version;
          }
          restoreEditorState(saved);
        }
        updateTotals();
      });
    });
  }

  /* -------------------------------------------------------------- render */

  function render() {
    renderList();
    renderQueue();
  }

  function renderList() {
    LIST.textContent = "";
    references.forEach(function (row) {
      var node = ROW_TEMPLATE.content.firstElementChild.cloneNode(true);
      node.dataset.slug = row.slug;
      node.dataset.state = row.state;
      node.querySelector('[data-slot="ordinal"]').textContent =
        row.live ? String(row.ordinal) : "not live";
      node.querySelector('[data-slot="title"]').textContent = row.title;
      node.querySelector('[data-slot="sector"]').textContent = row.sector;
      var stateSpan = node.querySelector('[data-slot="state"]');
      stateSpan.textContent = row.state;
      stateSpan.className = "desk-state " + row.state;
      node.querySelector('[data-slot="window"]').textContent =
        row.clearance_from ? (row.clearance_from + " – " + row.clearance_until) : "";

      var editButton = node.querySelector(".edit");
      editButton.textContent = "Edit";
      editButton.setAttribute("aria-label", "Edit " + row.title);
      editButton.addEventListener("click", function () { openEditor(row.slug); });

      var publishButton = node.querySelector(".publish");
      var retireButton = node.querySelector(".retire");
      var previewButton = node.querySelector(".preview");
      var upButton = node.querySelector(".move-up");
      var downButton = node.querySelector(".move-down");

      publishButton.setAttribute("aria-label", "Publish " + row.title);
      retireButton.setAttribute("aria-label", "Retire " + row.title);
      previewButton.setAttribute("aria-label", "Make a preview link for " + row.title);
      upButton.setAttribute("aria-label", "Move " + row.title + " up");
      downButton.setAttribute("aria-label", "Move " + row.title + " down");

      if (row.state === "draft" || row.state === "retired") {
        publishButton.textContent = "Publish";
        retireButton.remove();
        previewButton.textContent = "Preview link";
        upButton.remove();
        downButton.remove();
        publishButton.addEventListener("click", function () {
          rowAction(row, publishButton, "publish", "/publish", "POST",
            function () { return row.title + " is published"; },
            function () { focusRowButton(row.slug, "retire"); });
        });
        previewButton.addEventListener("click", function () {
          rowAction(row, previewButton, "preview", "/preview", "POST",
            function (data) {
              return "Preview link ready: " + previewLink(row.slug, data.token)
                + " (expires " + helsinkiTime(data.expires_at) + ")";
            }, null, true);
        });
      } else if (row.state === "live" || row.state === "withheld") {
        retireButton.textContent = "Retire";
        publishButton.remove();
        previewButton.remove();
        if (row.state === "live") {
          upButton.textContent = "Up";
          downButton.textContent = "Down";
          upButton.addEventListener("click", function () {
            moveRow(row, upButton, Math.max(1, row.ordinal - 1));
          });
          downButton.addEventListener("click", function () {
            moveRow(row, downButton, row.ordinal + 1);
          });
        } else {
          upButton.remove();
          downButton.remove();
        }
        retireButton.addEventListener("click", function () {
          rowAction(row, retireButton, "retire", "/retire", "POST",
            function () { return row.title + " is retired"; },
            function () { focusRowButton(row.slug, "publish"); });
        });
      }
      if (row.state === "live") {
        var liveRows = references.filter(function (r) { return r.state === "live"; });
        if (row.ordinal === 1) upButton.disabled = true;
        if (row.ordinal === liveRows.length) downButton.disabled = true;
      }
      LIST.appendChild(node);
    });
  }

  function previewLink(slug, tokenValue) {
    return "/references/" + slug + "?preview=" + tokenValue;
  }

  function focusRowButton(slug, className) {
    // The list is re-rendered by every completed action, so the button is
    // found in the fresh DOM by its row's slug.
    var node = LIST.querySelector('[data-slug="' + slug + '"]');
    if (!node) return;
    var button = node.querySelector("." + className);
    if (button) button.focus();
  }

  function renderQueue() {
    QUEUE.textContent = "";
    enquiries.forEach(function (enquiry) {
      var node = ENQUIRY_TEMPLATE.content.firstElementChild.cloneNode(true);
      node.dataset.id = enquiry.id;
      node.querySelector('[data-slot="email"]').textContent = enquiry.email;
      node.querySelector('[data-slot="reference"]').textContent =
        enquiry.reference || "—";
      node.querySelector('[data-slot="arrival"]').textContent =
        helsinkiTime(enquiry.created_at);
      if (role === "steward") {
        var deleteButton = node.querySelector(".delete");
        deleteButton.textContent = "Delete";
        deleteButton.setAttribute("aria-label",
          "Delete the enquiry from " + enquiry.email);
        deleteButton.addEventListener("click", function () {
          deleteEnquiry(enquiry, deleteButton, node);
        });
      } else {
        node.querySelector(".desk-actions").remove();
      }
      QUEUE.appendChild(node);
    });
  }

  function updateTotals() {
    var counts = { live: 0, withheld: 0, draft: 0, retired: 0 };
    references.forEach(function (row) { counts[row.state] += 1; });
    TOTALS.textContent = counts.live + " live, " + counts.withheld
      + " withheld, " + counts.draft + " drafts, " + counts.retired + " retired";
    ENQUIRY_TOTALS.textContent = enquiries.length + " open enquiries";
  }

  /* --------------------------------------------------------- desk actions
     While a call is in flight that row's or form's buttons refuse a second
     press; focus stays in the row or editor throughout. */

  function rowAction(row, button, key, path, method, successText, focusAfter,
                     created) {
    var rowKey = row.slug + ":" + key;
    if (busyRows[rowKey]) return;
    busyRows[rowKey] = true;
    button.disabled = true;
    var previous = button.textContent;
    button.textContent = "Saving…";
    api("/api/desk/references/" + row.slug + path, { method: method })
      .then(function (result) {
        busyRows[rowKey] = false;
        handleActionResult(result, button, previous, function (data) {
          announce(typeof successText === "function"
            ? successText(data) : successText);
        }, focusAfter, row);
      })
      .catch(function () {
        busyRows[rowKey] = false;
        button.disabled = false;
        button.textContent = previous;
        announce("The desk cannot be reached. Your change was not saved.", true);
      });
  }

  function handleActionResult(result, button, previous, onSuccess, focusAfter,
                              row) {
    if (result.status === 401) {
      pendingAction = { button: button, previous: previous, row: row,
                        focusAfter: focusAfter, retry: function () {} };
      sessionEnded();
      return;
    }
    if (result.status === 403 || result.status === 409 || result.status === 412
        || result.status === 422 || result.status === 503) {
      var message = (result.data && (result.data.message
        || firstError(result.data))) ||
        "The desk cannot be reached. Your change was not saved.";
      announce(message, true);
      reload().then(function () {
        if (focusAfter) {
          focusAfter();
        } else if (button && document.body.contains(button) && !button.disabled) {
          button.focus();
        } else if (row) {
          var node = LIST.querySelector('[data-slug="' + row.slug + '"] .edit');
          if (node) node.focus();
        }
      });
      return;
    }
    reload().then(function () {
      onSuccess(result.data);
      if (focusAfter) {
        focusAfter();
        return;
      }
      // The list is re-rendered, so the pressed button is found again in the
      // fresh DOM; if it no longer exists, the row's Edit button takes focus.
      if (row) {
        var node = LIST.querySelector('[data-slug="' + row.slug + '"]');
        var same = node && node.querySelector("." + buttonClassOf(button));
        if (same && !same.disabled) { same.focus(); return; }
        if (node) {
          var edit = node.querySelector(".edit");
          if (edit) { edit.focus(); return; }
        }
      }
      if (button && document.body.contains(button)) button.focus();
    });
  }

  function buttonClassOf(button) {
    var classes = ["publish", "retire", "preview", "move-up", "move-down", "edit"];
    for (var i = 0; i < classes.length; i += 1) {
      if (button.classList.contains(classes[i])) return classes[i];
    }
    return "edit";
  }

  function firstError(data) {
    if (!data || !data.errors) return null;
    var keys = Object.keys(data.errors);
    return keys.length ? data.errors[keys[0]] : null;
  }

  function moveRow(row, button, target) {
    var rowKey = row.slug + ":move";
    if (busyRows[rowKey]) return;
    busyRows[rowKey] = true;
    button.disabled = true;
    api("/api/desk/order", {
      method: "PUT",
      json: { slug: row.slug, ordinal: target }
    }).then(function (result) {
      busyRows[rowKey] = false;
      if (result.status === 401) {
        pendingAction = { row: row };
        sessionEnded();
        return;
      }
      if (result.status !== 200) {
        announce(result.status === 409
          ? "The order could not be changed"
          : ((result.data && result.data.message) || "The order could not be changed"), true);
        reload().then(function () {
          var node = LIST.querySelector('[data-slug="' + row.slug + '"]');
          if (node) {
            var up = node.querySelector(".move-up");
            if (up && !up.disabled) { up.focus(); return; }
            var edit = node.querySelector(".edit");
            if (edit) edit.focus();
          }
        });
        return;
      }
      var moved = (result.data || []).filter(function (item) {
        return item.slug === row.slug; })[0];
      var liveCount = (result.data || []).length;
      reload().then(function () {
        announce(row.title + " moved to position "
          + (moved ? moved.ordinal : target) + " of " + liveCount);
        var node = LIST.querySelector('[data-slug="' + row.slug + '"]');
        if (!node) return;
        var same = node.querySelector(
          button.classList.contains("move-up") ? ".move-up" : ".move-down");
        if (same && !same.disabled) { same.focus(); return; }
        var other = node.querySelector(
          button.classList.contains("move-up") ? ".move-down" : ".move-up");
        if (other && !other.disabled) other.focus();
      });
    }).catch(function () {
      busyRows[rowKey] = false;
      announce("The desk cannot be reached. Your change was not saved.", true);
    });
  }

  function deleteEnquiry(enquiry, button, node) {
    var key = "enquiry:" + enquiry.id;
    if (busyRows[key]) return;
    busyRows[key] = true;
    button.disabled = true;
    api("/api/desk/enquiries/" + enquiry.id, { method: "DELETE" })
      .then(function (result) {
        busyRows[key] = false;
        if (result.status === 401) { sessionEnded(); return; }
        if (result.status === 204) {
          announce("Enquiry deleted");
          var index = enquiries.indexOf(enquiry);
          reload().then(function () {
            var next = QUEUE.children[index];
            if (next) {
              var nextButton = next.querySelector(".delete");
              if (nextButton) { nextButton.focus(); return; }
            }
            focusOn(focusTargets.enquiriesHeading);
          });
          return;
        }
        announce((result.data && result.data.message)
          || "The desk cannot be reached. Your change was not saved.", true);
        reload();
      }).catch(function () {
        busyRows[key] = false;
        announce("The desk cannot be reached. Your change was not saved.", true);
      });
  }

  /* --------------------------------------------------------- new reference */

  NEW_REFERENCE.addEventListener("click", function () {
    openEditor(null);
  });

  /* ------------------------------------------------------------- editor */

  function openEditor(slug) {
    // An editor already open on this row keeps its typing: only the version
    // it holds is refreshed. A different row or a new draft mounts afresh.
    if (editor && editor.slug === slug && document.getElementById("reference-editor")) {
      api("/api/desk/references/" + slug).then(function (result) {
        if (result.status === 200 && editor && editor.slug === slug) {
          var form = document.getElementById("reference-editor");
          editor.version = result.data.version;
          editor.figures = result.data.figures || [];
          editor.hadFigures = (result.data.figures || []).length > 0;
          var heading = form && form.querySelector(".editor-heading");
          if (heading) heading.textContent = "Edit " + result.data.title;
        }
      });
      return;
    }
    editor = { slug: slug, version: null, creating: !slug, figures: [] };
    if (slug) {
      // The editor mounts at once from the detail read of the row, so the
      // form is complete before it can be typed into; nothing remounts under
      // the reader's hands afterwards.
      api("/api/desk/references/" + slug).then(function (result) {
        if (result.status === 200 && editor && editor.slug === slug) {
          editor.version = result.data.version;
          editor.figures = result.data.figures || [];
          editor.hadFigures = (result.data.figures || []).length > 0;
          mountEditor(result.data);
        }
      });
    } else {
      mountEditor({
        title: "", summary: "", challenge: "", work: "", sector: "",
        customer: "", quote: "", quote_speaker: "", quote_role: "",
        title_fi: "", body_fi: "", figures: []
      });
    }
  }

  function mountEditor(data) {
    EDITOR_SLOT.textContent = "";
    var form = EDITOR_TEMPLATE.content.firstElementChild.cloneNode(true);
    form.querySelector(".editor-heading").textContent =
      editor.creating ? "New reference" : ("Edit " + (data.title || ""));
    form.querySelectorAll("[data-field]").forEach(function (input) {
      var value = data[input.dataset.field];
      input.value = value === null || value === undefined ? "" : value;
    });
    form.querySelector("#save-reference").textContent = editor.creating
      ? "Create the draft" : "Save the reference";
    renderEditorFigures(form, editor.figures);
    var clearanceBox = form.querySelector("#clearance-box");
    if (role === "steward") {
      clearanceBox.hidden = false;
      var text = form.querySelector("#clearance-text");
      var current = references.filter(function (r) { return r.slug === editor.slug; })[0];
      if (current && current.clearance_from) {
        text.textContent = "Recorded window: " + current.clearance_from
          + " to " + current.clearance_until;
      } else {
        text.textContent = "No window recorded";
      }
    } else {
      clearanceBox.remove();
    }

    form.querySelector("#add-figure").addEventListener("click", function (event) {
      if (editorFigures(form).length >= 6) return;
      editor.figures = editorFigures(form);
      editor.figures.push({ label: "", value: "" });
      renderEditorFigures(form, editor.figures);
      updateFigureCount(form);
      var rows = form.querySelectorAll(".figure-edit");
      var label = rows[rows.length - 1].querySelector('[data-figure="label"]');
      label.focus();
      event.preventDefault();
    });

    form.querySelector("#save-reference").addEventListener("click", function () {
      saveReference(form);
    });
    form.querySelector("#close-editor").addEventListener("click", function () {
      closeEditor(false);
    });
    form.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeEditor(true);
    });

    EDITOR_SLOT.appendChild(form);
    form.querySelector('[data-field="' + (editor.creating ? "title" : "title") + '"]').focus();
    if (editor.creating) {
      form.querySelector("#ed-title").focus();
    }
    updateFigureCount(form);
  }

  function editorFigures(form) {
    var figures = [];
    form.querySelectorAll(".figure-edit").forEach(function (row) {
      figures.push({
        label: row.querySelector('[data-figure="label"]').value,
        value: row.querySelector('[data-figure="value"]').value
      });
    });
    return figures;
  }

  function renderEditorFigures(form, figures) {
    var holder = form.querySelector("#figures");
    holder.textContent = "";
    figures.forEach(function (figure, index) {
      var row = FIGURE_TEMPLATE.content.firstElementChild.cloneNode(true);
      row.querySelectorAll("[data-slot='n']").forEach(function (slot) {
        slot.textContent = index + 1;
      });
      row.querySelector('[data-figure="label"]').value = figure.label || "";
      row.querySelector('[data-figure="value"]').value = figure.value || "";
      row.querySelector(".remove-figure").addEventListener("click", function () {
        var current = editorFigures(form);
        current.splice(index, 1);
        editor.figures = current;
        renderEditorFigures(form, current);
        updateFigureCount(form);
        var rows = form.querySelectorAll(".figure-edit");
        if (rows.length) {
          var next = rows[Math.min(index, rows.length - 1)]
            .querySelector(".remove-figure");
          next.focus();
        } else {
          form.querySelector("#add-figure").focus();
        }
      });
      holder.appendChild(row);
    });
    var addButton = form.querySelector("#add-figure");
    addButton.disabled = figures.length >= 6;
  }

  function updateFigureCount(form) {
    var count = form.querySelectorAll(".figure-edit").length;
    form.querySelector("#figure-count").textContent = "Figures " + count + " of 6";
    form.querySelector("#add-figure").disabled = count >= 6;
  }

  function saveReference(form) {
    if (editor.busy) return;
    editor.busy = true;
    var button = form.querySelector("#save-reference");
    button.disabled = true;
    var previous = button.textContent;
    button.textContent = "Saving…";

    var payload = {};
    form.querySelectorAll("[data-field]").forEach(function (input) {
      payload[input.dataset.field] = input.value;
    });
    var figures = editorFigures(form);
    if (figures.length || editor.hadFigures) payload.figures = figures;

    var request;
    if (editor.creating) {
      request = api("/api/desk/references", { method: "POST", json: payload });
    } else {
      request = api("/api/desk/references/" + editor.slug, {
        method: "PATCH", json: payload, ifMatch: editor.version
      });
    }
    request.then(function (result) {
      editor.busy = false;
      button.disabled = false;
      button.textContent = previous;
      if (result.status === 401) {
        pendingAction = { form: form, saveReference: true };
        sessionEnded();
        return;
      }
      if (result.status === 201 || result.status === 200) {
        editor.previousSlug = editor.slug;
        editor.slug = result.data.slug;
        editor.version = result.data.version;
        editor.creating = false;
        button.textContent = "Save the reference";
        var saved = result.data.clearance_voided
          ? "Saved. Record a new clearance window for " + payload.title + "."
          : "Saved";
        reload().then(function () {
          announce(saved);
          button.focus();
          var heading = document.querySelector("#reference-editor .editor-heading");
          if (heading) heading.textContent = "Edit " + payload.title;
        });
        return;
      }
      var message = result.data && result.data.message;
      if (result.data && result.data.errors) {
        showEditorErrors(form, result.data.errors);
        announce(firstError({ errors: result.data.errors }), true);
      } else {
        announce(message || "The desk cannot be reached. Your change was not saved.", true);
      }
      if (result.status === 503) {
        announce("The desk cannot be reached. Your change was not saved.", true);
      }
    }).catch(function () {
      editor.busy = false;
      button.disabled = false;
      button.textContent = previous;
      announce("The desk cannot be reached. Your change was not saved.", true);
    });
  }

  function showEditorErrors(form, errors) {
    var first = null;
    form.querySelectorAll("[data-error]").forEach(function (slot) {
      var key = slot.dataset.error;
      var message = errors[key];
      var input = form.querySelector('[data-field="' + key + '"]');
      if (message) {
        slot.textContent = message;
        slot.hidden = false;
        if (input) {
          input.setAttribute("aria-invalid", "true");
          input.setAttribute("aria-describedby", slot.id || key + "-error");
          if (!first) first = input;
        }
      } else {
        slot.hidden = true;
        if (input) input.removeAttribute("aria-invalid");
      }
    });
    if (first) first.focus();
  }

  function closeEditor(withEscapeCheck) {
    var form = document.getElementById("reference-editor");
    if (!form) return;
    if (withEscapeCheck && editorUnsaved(form)) {
      if (!editor.warned) {
        editor.warned = true;
        announce("Unsaved changes. Press Escape again to discard.");
        return;
      }
    }
    var slug = editor ? editor.slug : null;
    editor = null;
    EDITOR_SLOT.textContent = "";
    reload().then(function () {
      if (slug) {
        var node = LIST.querySelector('[data-slug="' + slug + '"] .edit');
        if (node) { node.focus(); return; }
      }
      NEW_REFERENCE.focus();
    });
  }

  function editorUnsaved(form) {
    var fields = {};
    form.querySelectorAll("[data-field]").forEach(function (input) {
      fields[input.dataset.field] = input.value;
    });
    return Object.keys(fields).some(function (key) { return fields[key] !== ""; })
      || form.querySelectorAll(".figure-edit").length > 0;
  }

  /* --------------------------------------------------------- clearance */

  document.addEventListener("click", function (event) {
    var button = event.target.closest("#save-clearance");
    if (!button || !editor) return;
    event.preventDefault();
    var form = document.getElementById("reference-editor");
    var from = form.querySelector('[data-clearance="from"]').value;
    var until = form.querySelector('[data-clearance="until"]').value;
    button.disabled = true;
    var previous = button.textContent;
    button.textContent = "Saving…";
    api("/api/desk/references/" + editor.slug + "/clearance", {
      method: "PUT",
      json: { clearance_from: from, clearance_until: until }
    }).then(function (result) {
      button.disabled = false;
      button.textContent = previous;
      if (result.status === 401) {
        pendingAction = { clearance: true, from: from, until: until };
        sessionEnded();
        return;
      }
      if (result.status === 200) {
        reload().then(function () {
          announce("Clearance window saved for "
            + referenceTitle(editor.slug));
          button.focus();
        });
        return;
      }
      if (result.data && result.data.errors) {
        showEditorErrors(form, result.data.errors);
        announce(firstError({ errors: result.data.errors }), true);
      } else {
        announce((result.data && result.data.message)
          || "The desk cannot be reached. Your change was not saved.", true);
      }
    }).catch(function () {
      button.disabled = false;
      button.textContent = previous;
      announce("The desk cannot be reached. Your change was not saved.", true);
    });
  });

  function referenceTitle(slug) {
    var row = references.filter(function (r) { return r.slug === slug; })[0];
    return row ? row.title : slug;
  }

  /* ------------------------------------------------------ session endings */

  function sessionEnded() {
    token = null;
    role = null;
    // The editor, its typing and the list stay on screen; the sign-in panel
    // appears above them so the pending action can resume after sign-in.
    SIGNIN_PANEL.hidden = false;
    announce("Your session has ended. Sign in to finish.", true);
    SIGNIN_FORM.email.focus();
  }

  function retryPending() {
    var pending = pendingAction;
    pendingAction = null;
    if (!pending) return;
    if (pending.saveReference) {
      var form = document.getElementById("reference-editor");
      if (form) saveReference(form);
      return;
    }
    if (pending.clearance) {
      var clearanceForm = document.getElementById("reference-editor");
      if (clearanceForm) {
        clearanceForm.querySelector('[data-clearance="from"]').value = pending.from;
        clearanceForm.querySelector('[data-clearance="until"]').value = pending.until;
        var button = clearanceForm.querySelector("#save-clearance");
        if (button) button.click();
      }
      return;
    }
    if (pending.retry) pending.retry();
  }

  /* Reload in the same tab stays signed in; a new tab asks to sign in,
     because the token is kept for the tab session only. */
})();
