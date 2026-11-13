/* The private desk. Every row, button and expiry comes from the server. */
(function () {
  "use strict";

  var TOKEN_KEY = "northfall.desk-token";
  var ROLE_KEY = "northfall.desk-role";
  var MAX_FIGURES = 6;

  var TEXT_FIELDS = [
    ["title", "Title", "input"],
    ["summary", "Summary", "textarea"],
    ["challenge", "Challenge", "textarea"],
    ["work", "Work", "textarea"],
    ["sector", "Sector", "input"],
    ["customer", "Customer", "input"],
    ["title_fi", "Finnish title", "input"],
    ["body_fi", "Finnish body", "textarea"],
    ["quote", "Quote", "textarea"],
    ["quote_speaker", "Quote speaker", "input"],
    ["quote_role", "Quote role", "input"]
  ];

  var MESSAGES = {
    orderRefused: "The order could not be changed",
    unreachable: "The desk cannot be reached. Your change was not saved.",
    sessionEnded: "Your session has ended. Sign in to finish.",
    unsaved: "Unsaved changes. Press Escape again to discard.",
    saved: "Saved",
    enquiryDeleted: "Enquiry deleted"
  };

  var root = document.documentElement;
  var messages = document.querySelector("[data-desk-messages]");
  var signInPanel = document.querySelector("[data-signin-panel]");
  var signInForm = document.querySelector("[data-signin-form]");
  var signInAlert = document.querySelector("[data-signin-alert]");
  var signInButton = document.querySelector("[data-signin-submit]");
  var signInLabel = document.querySelector("[data-signin-label]");
  var work = document.querySelector("[data-desk-work]");
  var rowsList = document.querySelector("[data-desk-rows]");
  var editorColumn = document.querySelector("[data-editor-column]");
  var totalsLine = document.querySelector("[data-desk-totals]");
  var queueCount = document.querySelector("[data-queue-count]");
  var queueList = document.querySelector("[data-enquiry-rows]");
  var newButton = document.querySelector("[data-new-reference]");
  var referencesHeading = document.getElementById("desk-references-heading");
  var enquiriesHeading = document.getElementById("desk-enquiries-heading");
  var wideQuery = window.matchMedia("(min-width: 1100px)");
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  var state = {
    token: null,
    role: null,
    references: [],
    enquiries: [],
    editor: null,
    editorNode: null,
    pending: null,
    busy: {},
    escapeArmed: false
  };

  /* ---------- small helpers ---------- */

  function announce(text) {
    messages.textContent = "";
    window.setTimeout(function () {
      messages.textContent = text;
    }, 20);
  }

  function helsinkiText(stamp) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(stamp || "");
    if (!parts) return stamp || "";
    return (
      Number(parts[3]) + "." + Number(parts[2]) + "." + parts[1] + " " + parts[4] + ":" + parts[5]
    );
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function readToken() {
    try {
      state.token = window.sessionStorage.getItem(TOKEN_KEY);
      state.role = window.sessionStorage.getItem(ROLE_KEY);
    } catch (error) {
      state.token = null;
    }
  }

  function storeSession(token, role) {
    state.token = token;
    state.role = role;
    try {
      window.sessionStorage.setItem(TOKEN_KEY, token);
      window.sessionStorage.setItem(ROLE_KEY, role);
    } catch (error) {
      /* a tab that refuses storage simply signs in again on reload */
    }
  }

  function dropSession() {
    state.token = null;
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(ROLE_KEY);
    } catch (error) {
      /* nothing to clear */
    }
  }

  function call(method, path, body, extra) {
    var options = { method: method, headers: {} };
    if (state.token) options.headers.Authorization = "Bearer " + state.token;
    if (body !== undefined && body !== null) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    if (extra) {
      Object.keys(extra).forEach(function (name) {
        options.headers[name] = extra[name];
      });
    }
    return window
      .fetch(path, options)
      .then(function (response) {
        if (response.status === 204) return { status: 204, payload: {} };
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (payload) {
            return { status: response.status, payload: payload };
          });
      })
      .catch(function () {
        return { status: 0, payload: {} };
      });
  }

  /* ---------- focus by key, kept across list re-reads ---------- */

  function captureFocus() {
    var active = document.activeElement;
    if (!active || !active.getAttribute) return null;
    var key = active.getAttribute("data-focus-key");
    if (!key) return null;
    var mark = { key: key };
    if (active.selectionStart !== undefined && active.selectionStart !== null) {
      try {
        mark.start = active.selectionStart;
        mark.end = active.selectionEnd;
      } catch (error) {
        /* a field without a text selection keeps only its key */
      }
    }
    return mark;
  }

  function focusKey(key, mark) {
    var target = document.querySelector('[data-focus-key="' + key + '"]');
    if (!target) return false;
    target.focus();
    if (mark && mark.start !== undefined && target.setSelectionRange) {
      try {
        target.setSelectionRange(mark.start, mark.end);
      } catch (error) {
        /* a field that refuses a range keeps the caret where it landed */
      }
    }
    return true;
  }

  function restoreFocus(mark) {
    if (!mark) return;
    focusKey(mark.key, mark);
  }

  /* ---------- reading the desk ---------- */

  function refresh() {
    return Promise.all([
      call("GET", "/api/desk/references"),
      call("GET", "/api/desk/enquiries")
    ]).then(function (results) {
      var list = results[0];
      var queue = results[1];
      if (list.status === 401 || queue.status === 401) return "session";
      if (list.status !== 200 || queue.status !== 200) return "outage";
      state.references = list.payload;
      state.enquiries = queue.payload;
      render();
      return "ok";
    });
  }

  function rowFor(slug) {
    return state.references.filter(function (row) {
      return row.slug === slug;
    })[0];
  }

  /* ---------- rendering ---------- */

  function render() {
    var mark = captureFocus();
    renderRows();
    renderTotals();
    renderQueue();
    restoreFocus(mark);
  }

  function renderTotals() {
    var counts = { live: 0, withheld: 0, draft: 0, retired: 0 };
    state.references.forEach(function (row) {
      counts[row.state] += 1;
    });
    totalsLine.textContent =
      counts.live +
      " live, " +
      counts.withheld +
      " withheld, " +
      counts.draft +
      " drafts, " +
      counts.retired +
      " retired";
    queueCount.textContent = state.enquiries.length + " open enquiries";
  }

  function actionButton(label, name, key, handler) {
    var button = element("button", "desk-button", label);
    button.type = "button";
    button.setAttribute("aria-label", name);
    button.setAttribute("data-focus-key", key);
    button.addEventListener("click", handler);
    return button;
  }

  function renderRows() {
    rowsList.textContent = "";
    var liveCount = state.references.filter(function (row) {
      return row.live;
    }).length;

    state.references.forEach(function (row) {
      var item = element("li", "desk-row");
      item.setAttribute("data-slug", row.slug);
      var line = element("div", "desk-row-main");
      line.appendChild(
        element("span", "desk-row-ordinal", row.ordinal === null ? "not live" : String(row.ordinal))
      );
      line.appendChild(element("span", "desk-row-title", row.title));
      line.appendChild(element("span", "desk-row-sector", row.sector));
      line.appendChild(element("span", "desk-row-state", row.state));
      item.appendChild(line);

      var actions = element("div", "desk-row-actions");
      actions.appendChild(
        actionButton("Edit", "Edit " + row.title, "row:" + row.slug + ":edit", function () {
          openEditor(row.slug);
        })
      );
      if (row.state === "draft" || row.state === "retired") {
        actions.appendChild(
          actionButton("Publish", "Publish " + row.title, "row:" + row.slug + ":publish", function () {
            publish(row.slug);
          })
        );
        actions.appendChild(
          actionButton(
            "Preview link",
            "Make a preview link for " + row.title,
            "row:" + row.slug + ":preview",
            function () {
              mintPreview(row.slug);
            }
          )
        );
      } else {
        actions.appendChild(
          actionButton("Retire", "Retire " + row.title, "row:" + row.slug + ":retire", function () {
            retire(row.slug);
          })
        );
      }
      if (row.live) {
        var up = actionButton("Up", "Move " + row.title + " up", "row:" + row.slug + ":up", function () {
          move(row.slug, row.ordinal - 1);
        });
        var down = actionButton(
          "Down",
          "Move " + row.title + " down",
          "row:" + row.slug + ":down",
          function () {
            move(row.slug, row.ordinal + 1);
          }
        );
        up.disabled = row.ordinal <= 1;
        down.disabled = row.ordinal >= liveCount;
        actions.appendChild(up);
        actions.appendChild(down);
      }
      item.appendChild(actions);
      rowsList.appendChild(item);
    });

    placeEditor();
  }

  function placeEditor() {
    document.querySelectorAll("form.desk-editor").forEach(function (node) {
      if (node !== state.editorNode) node.remove();
    });
    if (!state.editorNode) {
      editorColumn.textContent = "";
      return;
    }
    var host = editorColumn;
    if (!wideQuery.matches && state.editor.slug) {
      var row = rowsList.querySelector('[data-slug="' + cssEscape(state.editor.slug) + '"]');
      if (row) host = row;
    }
    if (state.editorNode.parentNode !== host) {
      host.appendChild(state.editorNode);
    }
  }

  function cssEscape(value) {
    return value.replace(/["\\]/g, "\\$&");
  }

  function renderQueue() {
    queueList.textContent = "";
    state.enquiries.forEach(function (enquiry, position) {
      var item = element("li", "desk-enquiry");
      item.appendChild(element("span", "desk-enquiry-email", enquiry.email));
      item.appendChild(
        element(
          "span",
          "desk-enquiry-meta",
          (enquiry.reference || "no reference named") +
            (enquiry.phone ? " \u00b7 " + enquiry.phone : "")
        )
      );
      item.appendChild(element("span", "desk-enquiry-meta", helsinkiText(enquiry.created_at)));
      if (state.role === "steward") {
        item.appendChild(
          actionButton(
            "Delete",
            "Delete the enquiry from " + enquiry.email,
            "enquiry:" + enquiry.id + ":delete",
            function () {
              deleteEnquiry(enquiry.id, position);
            }
          )
        );
      }
      queueList.appendChild(item);
    });
  }

  /* ---------- the editor ---------- */

  function blankValues() {
    var values = {};
    TEXT_FIELDS.forEach(function (field) {
      values[field[0]] = "";
    });
    return values;
  }

  function openEditor(slug) {
    if (!slug) {
      state.editor = {
        slug: null,
        version: null,
        values: blankValues(),
        figures: [],
        hadFigures: false,
        clearance: { from: "", until: "" },
        baseline: null
      };
      state.editor.baseline = snapshot(state.editor);
      buildEditor();
      render();
      focusKey("field:title");
      return;
    }
    call("GET", "/api/desk/references/" + encodeURIComponent(slug)).then(function (result) {
      if (result.status === 401) {
        sessionEnded(null);
        return;
      }
      if (result.status !== 200) {
        announce(MESSAGES.unreachable);
        return;
      }
      var payload = result.payload;
      var values = blankValues();
      TEXT_FIELDS.forEach(function (field) {
        values[field[0]] = payload[field[0]] === null ? "" : payload[field[0]];
      });
      state.editor = {
        slug: payload.slug,
        version: payload.version,
        values: values,
        figures: payload.figures.map(function (figure) {
          return { label: figure.label, value: figure.value };
        }),
        hadFigures: payload.figures.length > 0,
        clearance: {
          from: payload.clearance_from || "",
          until: payload.clearance_until || ""
        },
        baseline: null
      };
      state.editor.baseline = snapshot(state.editor);
      buildEditor();
      render();
      focusKey("field:title");
    });
  }

  function snapshot(editor) {
    return JSON.stringify({ values: editor.values, figures: editor.figures });
  }

  function isDirty() {
    return state.editor && snapshot(state.editor) !== state.editor.baseline;
  }

  function closeEditor(focusFallback) {
    var slug = state.editor ? state.editor.slug : null;
    state.editor = null;
    state.editorNode = null;
    state.escapeArmed = false;
    editorColumn.textContent = "";
    render();
    if (focusFallback !== false) {
      if (!(slug && focusKey("row:" + slug + ":edit"))) {
        newButton.focus();
      }
    }
  }

  function field(name, label, kind, value, keyPrefix) {
    var wrapper = element("div", "field");
    var id = "editor-" + keyPrefix + "-" + name.replace(/[^a-z0-9]+/gi, "-");
    var labelNode = element("label", null, label);
    labelNode.setAttribute("for", id);
    var input = document.createElement(kind);
    input.id = id;
    if (kind === "input") input.type = "text";
    input.value = value;
    input.setAttribute("data-focus-key", keyPrefix + ":" + name);
    var error = element("p", "field-error");
    error.setAttribute("data-editor-error", name);
    error.id = id + "-error";
    input.setAttribute("aria-describedby", error.id);
    wrapper.appendChild(labelNode);
    wrapper.appendChild(input);
    wrapper.appendChild(error);
    return { wrapper: wrapper, input: input };
  }

  function buildEditor() {
    var editor = state.editor;
    var form = element("form", "desk-editor");
    form.setAttribute("aria-label", "Reference editor");
    form.setAttribute("novalidate", "novalidate");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
    });

    TEXT_FIELDS.forEach(function (spec) {
      var built = field(spec[1], spec[1], spec[2], editor.values[spec[0]], "field");
      built.input.setAttribute("data-focus-key", "field:" + spec[0]);
      built.input.addEventListener("input", function () {
        editor.values[spec[0]] = built.input.value;
      });
      form.appendChild(built.wrapper);
    });

    var figures = element("div", "desk-editor-figures");
    figures.setAttribute("data-figures", "");
    form.appendChild(figures);

    var count = element("p", "desk-figure-count");
    count.setAttribute("data-figure-count", "");
    form.appendChild(count);

    var addButton = element("button", "desk-button", "Add a figure");
    addButton.type = "button";
    addButton.setAttribute("data-focus-key", "figure:add");
    addButton.addEventListener("click", function () {
      if (editor.figures.length >= MAX_FIGURES) return;
      editor.figures.push({ label: "", value: "" });
      renderFigures(form);
      focusKey("figure:" + editor.figures.length + ":label");
    });
    form.appendChild(addButton);

    var saveButton = element(
      "button",
      "desk-button desk-button-strong",
      editor.slug ? "Save the reference" : "Create the draft"
    );
    saveButton.type = "button";
    saveButton.setAttribute("data-focus-key", "editor:save");
    saveButton.addEventListener("click", save);
    form.appendChild(saveButton);

    var window_ = element("div", "desk-clearance");
    if (state.role === "steward") {
      var from = field("Cleared from", "Cleared from", "input", editor.clearance.from, "clearance");
      from.input.setAttribute("data-focus-key", "clearance:clearance_from");
      from.input.addEventListener("input", function () {
        editor.clearance.from = from.input.value;
      });
      var until = field("Cleared until", "Cleared until", "input", editor.clearance.until, "clearance");
      until.input.setAttribute("data-focus-key", "clearance:clearance_until");
      until.input.addEventListener("input", function () {
        editor.clearance.until = until.input.value;
      });
      window_.appendChild(from.wrapper);
      window_.appendChild(until.wrapper);
      var windowButton = element("button", "desk-button", "Save the clearance window");
      windowButton.type = "button";
      windowButton.setAttribute("data-focus-key", "clearance:save");
      windowButton.addEventListener("click", saveClearance);
      window_.appendChild(windowButton);
    } else {
      window_.appendChild(
        element(
          "p",
          "desk-window-text",
          editor.clearance.from
            ? "Cleared from " + editor.clearance.from + " until " + editor.clearance.until
            : "No clearance window recorded"
        )
      );
    }
    form.appendChild(window_);

    form.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (isDirty() && !state.escapeArmed) {
        state.escapeArmed = true;
        announce(MESSAGES.unsaved);
        return;
      }
      closeEditor();
    });

    state.editorNode = form;
    renderFigures(form);
  }

  function renderFigures(form) {
    var editor = state.editor;
    var host = form.querySelector("[data-figures]");
    host.textContent = "";
    editor.figures.forEach(function (figure, index) {
      var position = index + 1;
      var row = element("div", "desk-figure-row");
      var label = field(
        "Figure " + position + " label",
        "Figure " + position + " label",
        "input",
        figure.label,
        "figure"
      );
      label.input.setAttribute("data-focus-key", "figure:" + position + ":label");
      label.input.addEventListener("input", function () {
        figure.label = label.input.value;
      });
      var value = field(
        "Figure " + position + " value",
        "Figure " + position + " value",
        "input",
        figure.value,
        "figure"
      );
      value.input.setAttribute("data-focus-key", "figure:" + position + ":value");
      value.input.addEventListener("input", function () {
        figure.value = value.input.value;
      });
      var remove = element("button", "desk-button", "Remove figure " + position);
      remove.type = "button";
      remove.setAttribute("data-focus-key", "figure:" + position + ":remove");
      remove.addEventListener("click", function () {
        editor.figures.splice(index, 1);
        renderFigures(form);
        if (!focusKey("figure:" + position + ":remove")) focusKey("figure:add");
      });
      row.appendChild(label.wrapper);
      row.appendChild(value.wrapper);
      row.appendChild(remove);
      host.appendChild(row);
    });
    form.querySelector("[data-figure-count]").textContent =
      "Figures " + editor.figures.length + " of " + MAX_FIGURES;
    var add = form.querySelector('[data-focus-key="figure:add"]');
    if (add) add.disabled = editor.figures.length >= MAX_FIGURES;
  }

  function clearEditorErrors() {
    if (!state.editorNode) return;
    state.editorNode.querySelectorAll("[data-editor-error]").forEach(function (node) {
      node.textContent = "";
    });
    state.editorNode.querySelectorAll("[aria-invalid]").forEach(function (node) {
      node.removeAttribute("aria-invalid");
    });
  }

  function showEditorErrors(errors, prefix) {
    clearEditorErrors();
    var first = null;
    Object.keys(errors).forEach(function (name) {
      var key = prefix === "clearance" ? "clearance:" + name : "field:" + name;
      if (name === "figures") key = "figure:1:label";
      var input = state.editorNode.querySelector('[data-focus-key="' + key + '"]');
      if (!input) return;
      var holder = input.parentNode.querySelector("[data-editor-error]");
      if (holder) holder.textContent = errors[name];
      input.setAttribute("aria-invalid", "true");
      if (!first) first = input;
    });
    if (first) first.focus();
  }

  /* ---------- actions ---------- */

  function guard(name, runner, pendingMessage) {
    if (state.busy[name]) return;
    state.busy[name] = true;
    if (pendingMessage) announce(pendingMessage);
    runner().then(
      function () {
        state.busy[name] = false;
      },
      function () {
        state.busy[name] = false;
      }
    );
  }

  function sessionEnded(pending) {
    dropSession();
    state.pending = pending;
    work.hidden = true;
    signInPanel.hidden = false;
    announce(MESSAGES.sessionEnded);
    document.getElementById("desk-email").focus();
  }

  function handleFailure(result, pending, focusAfter) {
    if (result.status === 401) {
      sessionEnded(pending);
      return true;
    }
    if (result.status === 0 || result.status === 503) {
      announce(MESSAGES.unreachable);
      if (focusAfter) focusAfter();
      return true;
    }
    return false;
  }

  function editorPayload() {
    var editor = state.editor;
    var body = {};
    TEXT_FIELDS.forEach(function (spec) {
      body[spec[0]] = editor.values[spec[0]];
    });
    if (editor.figures.length > 0 || editor.hadFigures) {
      body.figures = editor.figures;
    }
    return body;
  }

  function save() {
    if (!state.editor) return;
    var creating = !state.editor.slug;
    var body = editorPayload();
    var action = { kind: "save", creating: creating, slug: state.editor.slug, body: body };
    guard(
      "save",
      function () {
        return runSave(action);
      },
      "Saving\u2026"
    );
  }

  function runSave(action) {
    var editor = state.editor;
    var extra = {};
    if (!action.creating && editor && editor.version !== null) {
      extra["If-Match"] = '"' + editor.version + '"';
    }
    var request = action.creating
      ? call("POST", "/api/desk/references", action.body)
      : call("PATCH", "/api/desk/references/" + encodeURIComponent(action.slug), action.body, extra);

    return request.then(function (result) {
      if (handleFailure(result, action, function () {
          focusKey("editor:save");
        })) {
        return;
      }
      if (result.status === 403) {
        announce(result.payload.message);
        return;
      }
      if (result.status === 412) {
        announce(result.payload.message);
        focusKey("editor:save");
        return;
      }
      if (result.status === 422) {
        showEditorErrors(result.payload.errors || {}, "field");
        return;
      }
      if (result.status !== 200 && result.status !== 201) {
        announce(result.payload.message || MESSAGES.unreachable);
        return;
      }
      clearEditorErrors();
      if (action.creating) {
        editor.slug = result.payload.slug;
        editor.version = 1;
        editor.hadFigures = editor.figures.length > 0;
        editor.baseline = snapshot(editor);
        buildEditor();
        return refresh().then(function () {
          announce(MESSAGES.saved);
          focusKey("figure:add");
        });
      }
      editor.slug = result.payload.slug;
      editor.version = result.payload.version;
      editor.hadFigures = editor.figures.length > 0;
      editor.baseline = snapshot(editor);
      if (result.payload.clearance_voided) {
        editor.clearance = { from: "", until: "" };
      }
      var title = editor.values.title;
      return refresh().then(function () {
        announce(
          result.payload.clearance_voided
            ? "Saved. Record a new clearance window for " + title + "."
            : MESSAGES.saved
        );
        focusKey("editor:save");
      });
    });
  }

  function saveClearance() {
    if (!state.editor || !state.editor.slug) return;
    var action = {
      kind: "clearance",
      slug: state.editor.slug,
      body: {
        clearance_from: state.editor.clearance.from,
        clearance_until: state.editor.clearance.until
      }
    };
    guard(
      "clearance",
      function () {
        return runClearance(action);
      },
      "Saving\u2026"
    );
  }

  function runClearance(action) {
    return call(
      "PUT",
      "/api/desk/references/" + encodeURIComponent(action.slug) + "/clearance",
      action.body
    ).then(function (result) {
      if (handleFailure(result, action, function () {
          focusKey("clearance:save");
        })) {
        return;
      }
      if (result.status === 403) {
        announce(result.payload.message);
        return;
      }
      if (result.status === 422) {
        showEditorErrors(result.payload.errors || {}, "clearance");
        return;
      }
      if (result.status !== 200) {
        announce(result.payload.message || MESSAGES.unreachable);
        return;
      }
      clearEditorErrors();
      var title = state.editor ? state.editor.values.title : action.slug;
      return refresh().then(function () {
        announce("Clearance window saved for " + title);
        focusKey("clearance:save");
      });
    });
  }

  function publish(slug) {
    guard(
      "publish:" + slug,
      function () {
        return runPublish({ kind: "publish", slug: slug });
      },
      "Saving\u2026"
    );
  }

  function runPublish(action) {
    var title = (rowFor(action.slug) || {}).title || action.slug;
    return call("POST", "/api/desk/references/" + encodeURIComponent(action.slug) + "/publish").then(
      function (result) {
        if (handleFailure(result, action, function () {
            focusAfterRow(action.slug, "publish");
          })) {
          return;
        }
        if (result.status !== 200) {
          announce(result.payload.message || MESSAGES.unreachable);
          focusAfterRow(action.slug, "publish");
          return;
        }
        return refresh().then(function () {
          announce(title + " is published");
          focusAfterRow(action.slug, "retire");
        });
      }
    );
  }

  function retire(slug) {
    guard(
      "retire:" + slug,
      function () {
        return runRetire({ kind: "retire", slug: slug });
      },
      "Saving\u2026"
    );
  }

  function runRetire(action) {
    var title = (rowFor(action.slug) || {}).title || action.slug;
    return call("POST", "/api/desk/references/" + encodeURIComponent(action.slug) + "/retire").then(
      function (result) {
        if (handleFailure(result, action, function () {
            focusAfterRow(action.slug, "retire");
          })) {
          return;
        }
        if (result.status !== 200) {
          announce(result.payload.message || MESSAGES.unreachable);
          focusAfterRow(action.slug, "retire");
          return;
        }
        return refresh().then(function () {
          announce(title + " is retired");
          focusAfterRow(action.slug, "publish");
        });
      }
    );
  }

  function mintPreview(slug) {
    guard(
      "preview:" + slug,
      function () {
        return runPreview({ kind: "preview", slug: slug });
      },
      "Saving\u2026"
    );
  }

  function runPreview(action) {
    return call("POST", "/api/desk/references/" + encodeURIComponent(action.slug) + "/preview").then(
      function (result) {
        if (handleFailure(result, action, function () {
            focusAfterRow(action.slug, "preview");
          })) {
          return;
        }
        if (result.status !== 201) {
          announce(result.payload.message || MESSAGES.unreachable);
          focusAfterRow(action.slug, "preview");
          return;
        }
        var link =
          window.location.origin +
          "/references/" +
          encodeURIComponent(action.slug) +
          "?preview=" +
          result.payload.token;
        return refresh().then(function () {
          announce(
            "Preview link ready: " + link + " (expires " + helsinkiText(result.payload.expires_at) + ")"
          );
          focusAfterRow(action.slug, "preview");
        });
      }
    );
  }

  function move(slug, ordinal) {
    guard("move:" + slug, function () {
      return runMove({ kind: "move", slug: slug, ordinal: ordinal });
    });
  }

  function runMove(action) {
    var title = (rowFor(action.slug) || {}).title || action.slug;
    var pressed = action.ordinal < (rowFor(action.slug) || {}).ordinal ? "up" : "down";
    return call("PUT", "/api/desk/order", { slug: action.slug, ordinal: action.ordinal }).then(
      function (result) {
        if (handleFailure(result, action, function () {
            focusAfterRow(action.slug, pressed);
          })) {
          return;
        }
        if (result.status !== 200) {
          return refresh().then(function () {
            announce(MESSAGES.orderRefused);
            focusAfterRow(action.slug, pressed);
          });
        }
        var run = result.payload;
        var placed = run.filter(function (entry) {
          return entry.slug === action.slug;
        })[0];
        return refresh().then(function () {
          announce(
            title + " moved to position " + placed.ordinal + " of " + run.length
          );
          focusMoveButton(action.slug, pressed);
        });
      }
    );
  }

  function focusMoveButton(slug, pressed) {
    var other = pressed === "up" ? "down" : "up";
    var target = document.querySelector('[data-focus-key="row:' + slug + ":" + pressed + '"]');
    if (target && !target.disabled) {
      target.focus();
      return;
    }
    var fallback = document.querySelector('[data-focus-key="row:' + slug + ":" + other + '"]');
    if (fallback && !fallback.disabled) {
      fallback.focus();
      return;
    }
    focusAfterRow(slug, "edit");
  }

  function focusAfterRow(slug, action) {
    if (focusKey("row:" + slug + ":" + action)) return;
    if (focusKey("row:" + slug + ":edit")) return;
    referencesHeading.focus();
  }

  function deleteEnquiry(id, position) {
    guard(
      "enquiry:" + id,
      function () {
        return runDelete({ kind: "enquiry", id: id, position: position });
      },
      "Saving\u2026"
    );
  }

  function runDelete(action) {
    return call("DELETE", "/api/desk/enquiries/" + action.id).then(function (result) {
      if (handleFailure(result, action, function () {
          focusKey("enquiry:" + action.id + ":delete");
        })) {
        return;
      }
      if (result.status !== 204) {
        announce(result.payload.message || MESSAGES.unreachable);
        focusKey("enquiry:" + action.id + ":delete");
        return;
      }
      return refresh().then(function () {
        announce(MESSAGES.enquiryDeleted);
        var next = state.enquiries[action.position];
        if (!(next && focusKey("enquiry:" + next.id + ":delete"))) {
          enquiriesHeading.focus();
        }
      });
    });
  }

  /* ---------- sign in ---------- */

  function showWork() {
    signInPanel.hidden = true;
    work.hidden = false;
  }

  function resume() {
    var pending = state.pending;
    state.pending = null;
    var known = state.references.map(function (row) {
      return row.slug;
    });
    return refresh().then(function (outcome) {
      if (outcome !== "ok") return;
      var now = state.references.map(function (row) {
        return row.slug;
      });
      var sameProgramme =
        known.length === 0 ||
        now.some(function (slug) {
          return known.indexOf(slug) !== -1;
        });
      if (!pending) return;
      if (!sameProgramme) {
        state.editor = null;
        state.editorNode = null;
        editorColumn.textContent = "";
        render();
        return;
      }
      if (pending.kind === "save") return runSave(pending);
      if (pending.kind === "clearance") return runClearance(pending);
      if (pending.kind === "publish") return runPublish(pending);
      if (pending.kind === "retire") return runRetire(pending);
      if (pending.kind === "preview") return runPreview(pending);
      if (pending.kind === "move") return runMove(pending);
      if (pending.kind === "enquiry") return runDelete(pending);
      return undefined;
    });
  }

  signInForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (state.busy.signin) return;
    state.busy.signin = true;
    signInAlert.textContent = "";
    signInButton.disabled = true;
    signInLabel.textContent = "Signing in\u2026";
    call("POST", "/api/auth/login", {
      email: document.getElementById("desk-email").value,
      password: document.getElementById("desk-password").value
    }).then(function (result) {
      state.busy.signin = false;
      signInButton.disabled = false;
      signInLabel.textContent = "Sign in";
      if (result.status !== 200) {
        signInAlert.textContent = result.payload.message || MESSAGES.unreachable;
        return;
      }
      storeSession(result.payload.token, result.payload.role);
      document.getElementById("desk-password").value = "";
      showWork();
      if (state.pending) {
        resume();
        return;
      }
      refresh().then(function (outcome) {
        if (outcome === "ok") referencesHeading.focus();
      });
    });
  });

  newButton.addEventListener("click", function () {
    openEditor(null);
  });

  wideQuery.addEventListener("change", function () {
    var mark = captureFocus();
    placeEditor();
    restoreFocus(mark);
  });

  function applyMotionPreference() {
    root.classList.toggle("reduce-motion", motionQuery.matches);
  }

  motionQuery.addEventListener("change", applyMotionPreference);
  applyMotionPreference();

  readToken();
  if (state.token) {
    showWork();
    refresh().then(function (outcome) {
      if (outcome === "session") {
        dropSession();
        work.hidden = true;
        signInPanel.hidden = false;
      }
    });
  }
})();
