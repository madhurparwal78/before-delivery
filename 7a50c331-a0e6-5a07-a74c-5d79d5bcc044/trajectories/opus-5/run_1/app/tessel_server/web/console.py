"""The console pages, drawn from the member's session cookie."""
import json
import math
import secrets

from .. import audit, auth, db, httpbase, mailer, pricing, textutil, totp, validate
from ..domain import (
    cypher,
    databases,
    exports,
    feedback,
    graph,
    keys,
    members,
    search,
    sources,
    usage,
)
from ..errors import TesselError
from . import render

SESSION_COOKIE = "tessel_session"

TABS = (
    ("sources", "Sources"),
    ("graph", "Graph query"),
    ("search", "Search"),
    ("entity", "Entity"),
    ("stats", "Stats"),
    ("explore", "Explore"),
)

SOURCE_COLUMNS = (
    ("id", "ID"),
    ("title", "Title"),
    ("version", "Version"),
    ("token_count", "Tokens"),
    (None, "Facts"),
    (None, "Status"),
    ("ingested_at", "Ingested"),
)

EXAMPLES = (
    "MATCH (a {name: 'Atlas Launch'})-[:OWNED_BY]->(o) RETURN o.name",
    "MATCH (a)-[:BLOCKED_BY]->(b)-[:OWNED_BY]->(o) RETURN b.name, o.name",
    "MATCH (a)-[:OWNED_BY]->(o) RETURN count(*)",
)

GENERIC_FAILURE = "Something went wrong. Try again."


class Signout(Exception):
    """Raised when the session that drew a console page has ended."""


def actor_for(request):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    return auth.resolve_session(token)


def member_view(actor):
    return {
        "email": actor.email,
        "role": actor.role,
        "organization": actor.organization["name"],
    }


def _nonce():
    return secrets.token_hex(8)


def _base(actor, rail, toasts, announcement):
    return {
        "member": member_view(actor),
        "rail": rail,
        "toasts": toasts,
        "announcement": announcement,
        "nonce": _nonce(),
    }


def _html(name, status=200, **values):
    response = httpbase.html(render.page(name, **values), status=status)
    response.add("Cache-Control", "no-store")
    return response


def denied(actor):
    return _html(
        "console_message.html",
        status=403,
        title="No access - Tessel",
        message="You do not have access to this page",
        **_base(actor, "settings", [], None),
    )


def missing_database(actor):
    return _html(
        "console_message.html",
        status=404,
        title="Database not found - Tessel",
        message="Database not found",
        **_base(actor, "databases", [], None),
    )


def sign_out(request, actor):
    with db.tx() as cur:
        cur.execute(
            "UPDATE sessions SET revoked_at = %s WHERE id = %s",
            (textutil.now(), actor.member["session_id"]),
        )
    response = httpbase.redirect("/")
    response.clear_cookie(SESSION_COOKIE)
    response.add("Cache-Control", "no-store")
    return response


def _toast(text, kind="success", undo=None):
    return {"text": text, "kind": kind, "undo": undo}


# --- the database table -----------------------------------------------------


def _database_rows(cur, actor):
    rows = []
    for row in databases.listing(cur, actor):
        rows.append(
            {
                "name": row["name"],
                "status": databases.status_of(row),
                "collections": len(databases.collections(cur, row["id"])),
                "sources": cur.value(
                    "SELECT count(*) FROM sources WHERE database_id = %s AND NOT deleted",
                    (row["id"],),
                ),
                "wal_pending": row["last_lsn"] - row["indexed_lsn"],
                "index_generation": row["index_generation"],
                "created_at": textutil.format_timestamp(row["created_at"]),
                "flash": False,
            }
        )
    return rows


def database_table(request, actor):
    toasts = []
    errors = {}
    values = {"name": "", "document": "", "import_name": ""}
    announcement = None
    open_import = False
    if request.method == "POST":
        form = request.form()
        action = form.get("action")
        try:
            if action == "create-database":
                values["name"] = form.get("name", "")
                _create_database(actor, values["name"])
                toasts.append(_toast("Database created"))
                announcement = "Database created"
                values["name"] = ""
            elif action == "delete-database":
                _delete_database(actor, form.get("name", ""), form.get("confirm", ""))
                toasts.append(_toast("Database deleted"))
            elif action == "import-database":
                open_import = True
                values["document"] = form.get("document", "")
                values["import_name"] = form.get("name", "")
                _import_database(actor, values["import_name"], values["document"])
                toasts.append(_toast("Database created"))
                announcement = "Database created"
                values["document"] = ""
                values["import_name"] = ""
                open_import = False
        except TesselError as refusal:
            toasts.append(_toast(refusal.message, "error"))
            field = refusal.field or ""
            if action == "create-database":
                errors["name"] = refusal.message
            elif field.startswith("document"):
                errors["document"] = refusal.message
            else:
                errors["import_name"] = refusal.message
    with db.tx() as cur:
        rows = _database_rows(cur, actor)
    return _html(
        "console_databases.html",
        title="Databases - Tessel",
        databases=rows,
        provisioning=any(row["status"] == "provisioning" for row in rows),
        errors=errors,
        values=values,
        open_import=open_import,
        **_base(actor, "databases", toasts, announcement),
    )


def _create_database(actor, name):
    auth.require_role(actor, "owner")
    body = {"name": name}
    validate.scan_unstorable(body)
    checked = validate.pattern(
        body,
        "name",
        "name",
        validate.DATABASE_NAME,
        "Lowercase letters, digits and underscores; 3 to 32 characters; starts with a letter",
    )
    with db.tx() as cur:
        row = databases.create(cur, actor, checked)
        audit.write(cur, actor.organization_id, actor.email, "database.create", checked)
    return row


def _delete_database(actor, name, confirm):
    auth.require_role(actor, "owner")
    if confirm != name:
        raise TesselError("DATABASE_NOT_FOUND")
    with db.tx() as cur:
        row = databases.lookup(cur, actor, name)
        databases.lock_organization(cur, actor.organization_id)
        databases.delete(cur, row)
        audit.write(cur, actor.organization_id, actor.email, "database.delete", name)


def _import_database(actor, name, document):
    auth.require_role(actor, "owner")
    try:
        parsed = json.loads(document)
    except json.JSONDecodeError:
        raise TesselError("MALFORMED_JSON")
    body = {"name": name, "document": parsed}
    validate.scan_unknown(body, exports.IMPORT_SPEC)
    validate.scan_unstorable(body)
    checked, collections = exports.validate_import(body)
    with db.tx() as cur:
        exports.perform_import(cur, actor, checked, collections)


# --- the workspace ----------------------------------------------------------


def workspace(request, actor, name):
    with db.tx() as cur:
        try:
            row = databases.lookup(cur, actor, name)
        except TesselError:
            return missing_database(actor)
    tab = request.param("tab") or "sources"
    if tab not in dict(TABS):
        tab = "sources"
    if request.param("download") == "1" and request.param("job"):
        return _download_export(actor, request.param("job"))
    state = {
        "toasts": [],
        "errors": {},
        "announcement": None,
        "values": _empty_ingest(),
        "open_ingest": False,
        "flash_source": None,
        "compact_result": None,
        "job_id": request.param("job"),
    }
    if request.method == "POST":
        _workspace_action(request, actor, row, state)
        with db.tx() as cur:
            row = databases.lookup(cur, actor, name)
    return _render_workspace(request, actor, row, tab, state)


def _empty_ingest():
    return {
        "collection": "",
        "id": "",
        "title": "",
        "text": "",
        "if_version": "",
        "facts": [{"subject": "", "predicate": "", "object": "", "valid_from": "", "reason": ""}],
    }


def _read_ingest_form(form, request):
    facts = []
    subjects = request.form_list("fact_subject")
    predicates = request.form_list("fact_predicate")
    objects = request.form_list("fact_object")
    moments = request.form_list("fact_valid_from")
    reasons = request.form_list("fact_reason")
    for index in range(len(subjects)):
        facts.append(
            {
                "subject": subjects[index],
                "predicate": predicates[index] if index < len(predicates) else "",
                "object": objects[index] if index < len(objects) else "",
                "valid_from": moments[index] if index < len(moments) else "",
                "reason": reasons[index] if index < len(reasons) else "",
            }
        )
    return {
        "collection": form.get("collection", ""),
        "id": form.get("id", ""),
        "title": form.get("title", ""),
        "text": form.get("text", ""),
        "if_version": form.get("if_version", ""),
        "facts": facts or [{"subject": "", "predicate": "", "object": "", "valid_from": "", "reason": ""}],
    }


def _workspace_action(request, actor, row, state):
    form = request.form()
    action = form.get("action")
    try:
        if action == "ingest":
            state["values"] = _read_ingest_form(form, request)
            state["open_ingest"] = True
            result = _ingest(actor, row, state["values"])
            state["toasts"].append(_toast("Source ingested"))
            state["announcement"] = "Source ingested"
            state["flash_source"] = result["id"]
            state["values"] = _empty_ingest()
            state["open_ingest"] = False
        elif action == "delete-source":
            auth.require_role(actor, "editor")
            collection = form.get("collection", databases.DEFAULT_COLLECTION)
            source_id = form.get("id", "")
            with db.tx() as cur:
                sources.delete(cur, row, collection, source_id)
            state["toasts"].append(
                _toast(
                    "Source deleted",
                    undo={
                        "action": "/console/db/%s?tab=sources" % row["name"],
                        "fields": {
                            "action": "restore-source",
                            "collection": collection,
                            "id": source_id,
                        },
                    },
                )
            )
        elif action == "restore-source":
            auth.require_role(actor, "editor")
            collection = form.get("collection", databases.DEFAULT_COLLECTION)
            source_id = form.get("id", "")
            with db.tx() as cur:
                databases.require_ready(row)
                sources.restore(cur, row, collection, source_id)
            state["toasts"].append(_toast("Source restored"))
            state["flash_source"] = source_id
        elif action == "compact":
            auth.require_role(actor, "editor")
            with db.tx() as cur:
                databases.require_ready(row)
                answer = databases.compact(cur, row["id"])
            if answer["folded_entries"]:
                line = "Folded %d entries into generation %d" % (
                    answer["folded_entries"],
                    answer["generation"],
                )
            else:
                line = "Nothing to fold"
            state["compact_result"] = line
            state["announcement"] = line
            state["toasts"].append(_toast(line))
        elif action == "export":
            auth.require_role(actor, "owner")
            with db.tx() as cur:
                databases.require_ready(row)
                answer = exports.request_export(cur, actor, row)
            state["job_id"] = answer["job_id"]
            state["toasts"].append(_toast("Export queued"))
        elif action == "feedback":
            _send_feedback(actor, form)
            state["toasts"].append(_toast("Feedback sent"))
    except TesselError as refusal:
        state["toasts"].append(_toast(refusal.message, "error"))
        if refusal.code == "VERSION_CONFLICT":
            state["errors"]["title"] = refusal.message
        elif refusal.field:
            state["errors"][refusal.field] = refusal.message
            tail = refusal.field.split(".")[-1]
            if tail in ("title", "text", "collection"):
                state["errors"][tail] = refusal.message


def _ingest(actor, row, values):
    auth.require_role(actor, "editor")
    source = {
        "title": values["title"],
        "text": values["text"],
        "facts": [
            fact
            for fact in values["facts"]
            if any(fact[key] for key in ("subject", "predicate", "object", "valid_from", "reason"))
        ],
    }
    if values["id"]:
        source["id"] = values["id"]
    if values["if_version"]:
        source["if_version"] = int(values["if_version"])
    body = {"database": row["name"], "sources": [source]}
    if values["collection"]:
        body["collection"] = values["collection"]
    for fact in source["facts"]:
        fact["reason"] = fact.get("reason", "")
    validate.scan_unstorable(body)
    _, collection, parsed = sources.validate_ingest(body)
    with db.tx() as cur:
        databases.require_ready(row)
        results = sources.perform_ingest(cur, row, collection, parsed)
    return results[0]


def _send_feedback(actor, form):
    body = {
        "request_id": form.get("request_id", ""),
        "feedback": form.get("feedback") or "Not useful",
        "rating": form.get("rating") or None,
    }
    tags = (form.get("tags") or "").strip()
    if tags:
        body["metadata"] = {
            "tag_%d" % index: value.strip()
            for index, value in enumerate(tags.split(","))
            if value.strip()
        }
    validate.scan_unknown(body, feedback.SPEC)
    validate.scan_unstorable(body)
    parsed = feedback.validate_body(body)
    with db.tx() as cur:
        feedback.store(cur, actor.organization_id, *parsed)


def _download_export(actor, job_id):
    with db.tx() as cur:
        job = exports.read_job(cur, actor, job_id)
        if exports.job_status(job) != "succeeded":
            raise TesselError("JOB_NOT_FINISHED")
        document = cur.value(
            "SELECT document FROM export_jobs WHERE id = %s", (job["id"],)
        )
    response = httpbase.Response(
        200, document.encode("utf-8"), content_type="application/json; charset=utf-8"
    )
    response.add(
        "Content-Disposition",
        'attachment; filename="%s-export.json"' % job["database_name"],
    )
    response.add("Cache-Control", "no-store")
    return response


def _sort_state(sort):
    field = sort.lstrip("-")
    state = {}
    links = {}
    for key, _label in SOURCE_COLUMNS:
        if key is None:
            continue
        if key == field:
            state[key] = "descending" if sort.startswith("-") else "ascending"
            links[key] = key if sort.startswith("-") else "-" + key
        else:
            state[key] = "none"
            links[key] = key
    return state, links


def _render_workspace(request, actor, row, tab, state):
    name = row["name"]
    can_write = actor.at_least("editor")
    values = state["values"]
    with db.tx() as cur:
        collection_names = databases.collections(cur, row["id"])
        collection = request.param("collection") or databases.DEFAULT_COLLECTION
        if collection not in collection_names:
            collection = databases.DEFAULT_COLLECTION
        view = dict(
            _base(actor, "databases", state["toasts"], state["announcement"]),
            title="%s - Tessel" % name,
            database={"name": name, "status": databases.status_of(row)},
            tabs=TABS,
            tab=tab,
            tab_index=[key for key, _ in TABS].index(tab),
            can_write=can_write,
            collections=collection_names,
            collection=collection,
            errors=state["errors"],
            values=values,
            open_ingest=state["open_ingest"] or bool(request.param("edit")),
            flash_source=state["flash_source"],
            compact_result=state["compact_result"],
            source_columns=SOURCE_COLUMNS,
            examples=EXAMPLES,
            sources=[],
            sort="id",
            sort_state={},
            sort_links={},
            filter_text="",
            statement="",
            as_of_text="",
            query_result=None,
            query_error=None,
            words="",
            search_limit=5,
            search_results=[],
            search_done=False,
            search_error=None,
            search_request_id="",
            entity_name="",
            entity_done=False,
            entity=None,
            stat_cards=(),
            job=None,
            explore=None,
        )
        if tab == "sources":
            _fill_sources(cur, request, row, collection, view, state)
        elif tab == "graph":
            _fill_graph_query(cur, request, actor, row, view)
        elif tab == "search":
            _fill_search(cur, request, actor, row, collection, view)
        elif tab == "entity":
            _fill_entity(cur, request, row, view)
        elif tab == "stats":
            _fill_stats(cur, actor, row, view, state)
        elif tab == "explore":
            view["explore"] = _explore_view(cur, request, row)
    return _html("console_workspace.html", **view)


def _fill_sources(cur, request, row, collection, view, state):
    sort = request.param("sort") or "id"
    field = sort.lstrip("-")
    if field not in ("id", "title", "version", "token_count", "ingested_at"):
        sort, field = "id", "id"
    filter_text = request.param("filter") or ""
    listed = sources.listing(cur, row, collection)
    if filter_text:
        needle = filter_text.lower()
        listed = [
            item
            for item in listed
            if needle in item["id"].lower() or needle in item["title"].lower()
        ]
    listed.sort(key=lambda item: item[field], reverse=sort.startswith("-"))
    view["sources"] = listed
    view["sort"] = sort
    view["filter_text"] = filter_text
    view["sort_state"], view["sort_links"] = _sort_state(sort)
    edit = request.param("edit")
    if edit and not state["open_ingest"]:
        try:
            found = sources.single(cur, row, collection, edit)
        except TesselError:
            return
        view["values"] = {
            "collection": collection,
            "id": found["id"],
            "title": found["title"],
            "text": found["text"],
            "if_version": str(found["version"]),
            "facts": [
                {
                    "subject": "",
                    "predicate": "",
                    "object": "",
                    "valid_from": "",
                    "reason": "",
                }
            ],
        }


def _fill_graph_query(cur, request, actor, row, view):
    statement = request.param("statement") or ""
    as_of_text = request.param("as_of") or ""
    view["statement"] = statement
    view["as_of_text"] = as_of_text
    if not statement.strip():
        return
    moment = textutil.parse_timestamp(as_of_text) if as_of_text else textutil.now()
    if moment is None:
        view["query_error"] = {
            "code": "VALIDATION_ERROR",
            "message": "Write a UTC moment as YYYY-MM-DDTHH:MM:SSZ",
        }
        return
    try:
        answer = cypher.run(cur, row, statement, moment)
    except TesselError as refusal:
        view["query_error"] = {"code": refusal.code, "message": refusal.message}
        return
    request_id = request.request_id
    feedback.record_query(cur, request_id, actor.organization_id, row["id"])
    view["query_result"] = {
        "columns": answer["columns"],
        "rows": answer["rows"],
        "served_from": {
            "index_generation": row["index_generation"],
            "indexed_lsn": row["indexed_lsn"],
            "wal_entries_applied": row["last_lsn"] - row["indexed_lsn"],
        },
    }
    view["announcement"] = "Query answered: %d rows" % len(answer["rows"])


def _fill_search(cur, request, actor, row, collection, view):
    words = request.param("words") or ""
    limit_text = request.param("limit") or "5"
    view["words"] = words
    view["search_limit"] = limit_text
    if not words.strip():
        return
    if not limit_text.isdigit() or not 1 <= int(limit_text) <= 20:
        view["search_error"] = "This field must be between 1 and 20"
        return
    chosen = request.param("collections") or collection
    try:
        results = search.run(cur, row, words, [chosen], int(limit_text))
    except TesselError as refusal:
        view["search_error"] = refusal.message
        return
    feedback.record_query(cur, request.request_id, actor.organization_id, row["id"])
    view["search_done"] = True
    view["search_request_id"] = request.request_id
    view["search_results"] = [
        dict(result, score_text="%.4f" % result["score"]) for result in results
    ]
    view["announcement"] = "Search found %d sources" % len(results)


def _fill_entity(cur, request, row, view):
    entity = request.param("entity") or ""
    as_of_text = request.param("as_of") or ""
    view["entity_name"] = entity
    view["as_of_text"] = as_of_text
    if not entity.strip():
        return
    moment = textutil.parse_timestamp(as_of_text) if as_of_text else textutil.now()
    if moment is None:
        view["search_error"] = "Write a UTC moment as YYYY-MM-DDTHH:MM:SSZ"
        return
    outgoing, incoming = graph.relations(cur, row["id"], entity, moment)
    predicates = []
    for item in outgoing:
        if item["predicate"] not in predicates:
            predicates.append(item["predicate"])
    history = [
        (predicate, graph.history(cur, row["id"], entity, predicate))
        for predicate in predicates
    ]
    view["entity_done"] = True
    view["entity"] = {"outgoing": outgoing, "incoming": incoming, "history": history}


def _fill_stats(cur, actor, row, view, state):
    figures = databases.stats(cur, row)
    view["stat_cards"] = (
        ("Sources", pricing.format_count(figures["sources"])),
        ("Facts", pricing.format_count(figures["facts"])),
        ("Entities", pricing.format_count(figures["entities"])),
        ("Last LSN", pricing.format_count(figures["last_lsn"])),
        ("Indexed LSN", pricing.format_count(figures["indexed_lsn"])),
        ("WAL pending", pricing.format_count(figures["wal_pending"])),
        ("Index generation", pricing.format_count(figures["index_generation"])),
        ("Tokens ingested", pricing.format_count(figures["tokens_ingested"])),
        ("Storage bytes", pricing.format_count(figures["storage_bytes"])),
    )
    if state["job_id"] and actor.role == "owner":
        try:
            job = exports.read_job(cur, actor, state["job_id"])
        except TesselError:
            return
        answer = exports.job_answer(job)
        view["job"] = answer
        if answer["status"] == "succeeded":
            view["announcement"] = "Export ready"


def _explore_view(cur, request, row):
    moments = graph.valid_from_moments(cur, row["id"])
    present = graph.predicates_present(cur, row["id"])
    checked = request.params("predicates") or list(present)
    as_of_text = request.param("as_of") or ""
    index_text = request.param("as_of_index")
    if index_text and index_text.isdigit() and not as_of_text:
        index = min(int(index_text), len(moments))
        as_of_text = "" if index == len(moments) else moments[index]
    moment = textutil.parse_timestamp(as_of_text) if as_of_text else textutil.now()
    if moment is None:
        moment = textutil.now()
        as_of_text = ""
    slider_index = len(moments)
    for position, value in enumerate(moments):
        if textutil.parse_timestamp(value) <= moment:
            slider_index = position
    if as_of_text == "":
        slider_index = len(moments)
    nodes, edges = graph.graph(cur, row["id"], moment, checked or None)
    find = request.param("find") or ""
    matched = set()
    if find:
        needle = find.lower()
        matched = {name for name in nodes if needle in name.lower()}
    selected = request.param("node") or ""
    inspect = None
    if selected:
        outgoing, incoming = graph.relations(cur, row["id"], selected, moment)
        allowed = set(checked or present)
        inspect = {
            "outgoing": [item for item in outgoing if item["predicate"] in allowed],
            "incoming": [item for item in incoming if item["predicate"] in allowed],
        }
    layout = _ring_layout(nodes, matched)
    places = {node["name"]: node for node in layout}
    lines = [
        {
            "x1": places[edge["subject"]]["cx"],
            "y1": places[edge["subject"]]["cy"],
            "x2": places[edge["object"]]["cx"],
            "y2": places[edge["object"]]["cy"],
        }
        for edge in edges
    ]
    if find:
        match_line = (
            "1 matching entity" if len(matched) == 1 else "%d matching entities" % len(matched)
        )
    else:
        match_line = ""
    return {
        "moments": moments,
        "predicates": present,
        "checked": checked,
        "find": find,
        "node": selected,
        "inspect": inspect,
        "nodes": nodes,
        "edges": edges,
        "layout": layout,
        "lines": lines,
        "match_line": match_line,
        "slider_index": slider_index,
        "slider_text": as_of_text or "now",
        "as_of_param": as_of_text,
    }


def _ring_layout(names, matched):
    layout = []
    total = max(1, len(names))
    for index, name in enumerate(names):
        angle = 2 * math.pi * index / total - math.pi / 2
        cx = 50 + 34 * math.cos(angle)
        cy = 50 + 36 * math.sin(angle)
        layout.append(
            {
                "name": name,
                "cx": round(cx, 2),
                "cy": round(cy, 2),
                "left": round(cx, 2),
                "top": round(cy, 2),
                "matched": name in matched,
            }
        )
    return layout


# --- settings ---------------------------------------------------------------


def settings_page(request, actor):
    toasts = []
    errors = {}
    values = {"email": ""}
    totp_setup_view = None
    recovery_codes = None
    if request.method == "POST":
        form = request.form()
        action = form.get("action")
        try:
            if action == "add-member":
                values["email"] = form.get("email", "")
                _add_member(actor, values["email"], form.get("role", ""), form.get("password", ""))
                toasts.append(_toast("Member added"))
                values["email"] = ""
            elif action == "set-role":
                _set_role(actor, form.get("email", ""), form.get("role", ""))
                toasts.append(_toast("Role changed"))
            elif action == "remove-member":
                _remove_member(actor, form.get("email", ""))
                toasts.append(_toast("Member removed"))
            elif action == "logout-all":
                _logout_all(actor)
                raise Signout()
            elif action == "change-password":
                _change_password(actor, form)
                toasts.append(_toast("Password changed"))
            elif action == "totp-setup":
                totp_setup_view = _totp_setup(actor)
            elif action == "totp-enable":
                recovery_codes = _totp_enable(actor, form.get("code", ""))
                toasts.append(_toast("Two-step sign-in is on"))
            elif action == "totp-disable":
                _totp_disable(actor, form.get("code", ""))
                toasts.append(_toast("Two-step sign-in is off"))
        except TesselError as refusal:
            toasts.append(_toast(refusal.message, "error"))
            if refusal.field:
                errors[refusal.field] = refusal.message
            elif refusal.code == "BAD_CREDENTIALS":
                errors["current_password"] = refusal.message
            elif refusal.code in ("BAD_TOTP", "TOTP_ALREADY_ON", "TOTP_NOT_ON"):
                errors["code"] = refusal.message
        except ValueError as mismatch:
            toasts.append(_toast(str(mismatch), "error"))
            errors["confirm"] = str(mismatch)
    with db.tx() as cur:
        listed = members.listing(cur, actor.organization_id)
        state = cur.one(
            "SELECT totp_enabled FROM members WHERE id = %s", (actor.member["id"],)
        )
    if actor.role != "owner":
        listed = [row for row in listed if row["email"] == actor.email]
    return _html(
        "console_settings.html",
        title="Settings - Tessel",
        members=listed,
        errors=errors,
        values=values,
        totp_on=state["totp_enabled"],
        totp_setup=totp_setup_view,
        recovery_codes=recovery_codes,
        **_base(actor, "settings", toasts, None),
    )


def _add_member(actor, email, role, password):
    auth.require_role(actor, "owner")
    body = {"email": email, "role": role, "password": password}
    validate.scan_unstorable(body)
    checked = validate.email(body, "email", "email")
    chosen = validate.choice(body, "role", "role", members.ROLES)
    secret = validate.password(body, "password", "password")
    with db.tx() as cur:
        members.add(cur, actor, checked, chosen, secret)
    mailer.member_added(checked, actor.organization["name"], chosen)


def _set_role(actor, email, role):
    auth.require_role(actor, "owner")
    chosen = validate.choice({"role": role}, "role", "role", members.ROLES)
    with db.tx() as cur:
        members.set_role(cur, actor, email, chosen)


def _remove_member(actor, email):
    auth.require_role(actor, "owner")
    with db.tx() as cur:
        members.remove(cur, actor, email)


def _logout_all(actor):
    with db.tx() as cur:
        rows = cur.all(
            """
            UPDATE sessions SET revoked_at = %s
             WHERE member_id = %s AND revoked_at IS NULL RETURNING id
            """,
            (textutil.now(), actor.member["id"]),
        )
        audit.write(
            cur,
            actor.organization_id,
            actor.email,
            "session.logout_all",
            actor.email,
            str(len(rows)),
        )


def _change_password(actor, form):
    body = {
        "current_password": form.get("current_password", ""),
        "new_password": form.get("new_password", ""),
    }
    validate.scan_unstorable(body)
    current = validate.string(body, "current_password", "current_password", 1, 200)
    fresh = validate.password(body, "new_password", "new_password")
    if form.get("confirm", "") != fresh:
        raise ValueError("The passwords do not match")
    with db.tx() as cur:
        member = cur.one(
            "SELECT id, password_hash FROM members WHERE id = %s", (actor.member["id"],)
        )
    if not auth.verify_password(current, member["password_hash"]):
        raise TesselError("BAD_CREDENTIALS")
    with db.tx() as cur:
        cur.execute(
            "UPDATE members SET password_hash = %s WHERE id = %s",
            (auth.hash_password(fresh), member["id"]),
        )
        cur.execute(
            """
            UPDATE sessions SET revoked_at = %s
             WHERE member_id = %s AND revoked_at IS NULL AND id <> %s
            """,
            (textutil.now(), member["id"], actor.member["session_id"]),
        )
        cur.execute(
            """
            UPDATE reset_tokens SET cancelled_at = %s
             WHERE member_id = %s AND used_at IS NULL AND cancelled_at IS NULL
            """,
            (textutil.now(), member["id"]),
        )
        audit.write(
            cur, actor.organization_id, actor.email, "member.password", actor.email
        )


def _totp_setup(actor):
    with db.tx() as cur:
        enabled = cur.value(
            "SELECT totp_enabled FROM members WHERE id = %s", (actor.member["id"],)
        )
        if enabled:
            raise TesselError("TOTP_ALREADY_ON")
        secret = totp.new_secret()
        cur.execute(
            "UPDATE members SET totp_pending_secret = %s WHERE id = %s",
            (secret, actor.member["id"]),
        )
    grouped = " ".join(secret[index : index + 4] for index in range(0, len(secret), 4))
    return {"grouped": grouped, "uri": totp.otpauth_uri(actor.email, secret)}


def _totp_enable(actor, code):
    with db.tx() as cur:
        member = cur.one(
            """
            SELECT id, totp_enabled, totp_pending_secret, totp_last_step
              FROM members WHERE id = %s FOR UPDATE
            """,
            (actor.member["id"],),
        )
        if member["totp_enabled"]:
            raise TesselError("TOTP_ALREADY_ON")
        secret = member["totp_pending_secret"]
        step = totp.matching_step(secret, code, member["totp_last_step"]) if secret else None
        if step is None:
            raise TesselError("BAD_TOTP")
        cur.execute(
            """
            UPDATE members
               SET totp_enabled = true, totp_secret = %s, totp_pending_secret = NULL,
                   totp_last_step = %s
             WHERE id = %s
            """,
            (secret, step, member["id"]),
        )
        cur.execute("DELETE FROM recovery_codes WHERE member_id = %s", (member["id"],))
        codes = [auth.new_recovery_code() for _ in range(totp.RECOVERY_CODE_COUNT)]
        for value in codes:
            cur.execute(
                "INSERT INTO recovery_codes (member_id, code_digest) VALUES (%s, %s)",
                (member["id"], auth.digest(value)),
            )
        audit.write(cur, actor.organization_id, actor.email, "member.totp_on", actor.email)
    return codes


def _totp_disable(actor, code):
    with db.tx() as cur:
        member = cur.one(
            """
            SELECT id, totp_enabled, totp_secret, totp_last_step
              FROM members WHERE id = %s FOR UPDATE
            """,
            (actor.member["id"],),
        )
        if not member["totp_enabled"]:
            raise TesselError("TOTP_NOT_ON")
        step = totp.matching_step(member["totp_secret"], code, member["totp_last_step"])
        spent = False
        if step is None:
            rows = cur.all(
                """
                SELECT id, code_digest FROM recovery_codes
                 WHERE member_id = %s AND used_at IS NULL
                """,
                (member["id"],),
            )
            for item in rows:
                if item["code_digest"] == auth.digest(code):
                    cur.execute(
                        "UPDATE recovery_codes SET used_at = %s WHERE id = %s",
                        (textutil.now(), item["id"]),
                    )
                    spent = True
        if step is None and not spent:
            raise TesselError("BAD_TOTP")
        cur.execute(
            """
            UPDATE members
               SET totp_enabled = false, totp_secret = NULL, totp_pending_secret = NULL,
                   totp_last_step = NULL
             WHERE id = %s
            """,
            (member["id"],),
        )
        cur.execute("DELETE FROM recovery_codes WHERE member_id = %s", (member["id"],))
        audit.write(cur, actor.organization_id, actor.email, "member.totp_off", actor.email)


def keys_page(request, actor):
    if actor.role != "owner":
        return denied(actor)
    toasts = []
    errors = {}
    values = {"name": ""}
    fresh_secret = None
    if request.method == "POST":
        form = request.form()
        action = form.get("action")
        try:
            if action == "create-key":
                values["name"] = form.get("name", "")
                chosen = request.form_list("databases") if form.get("scope") == "chosen" else None
                fresh_secret = _create_key(actor, values["name"], form.get("role", ""), chosen)
                toasts.append(_toast("API key created"))
                values["name"] = ""
            elif action == "rotate-key":
                fresh_secret = _rotate_key(actor, form.get("id", ""))
                toasts.append(_toast("API key rotated"))
            elif action == "revoke-key":
                _revoke_key(actor, form.get("id", ""))
                toasts.append(_toast("API key revoked"))
        except TesselError as refusal:
            toasts.append(_toast(refusal.message, "error"))
            if refusal.field:
                errors[refusal.field.split(".")[0]] = refusal.message
    with db.tx() as cur:
        listed = keys.listing(cur, actor.organization_id)
        detailed = [keys.detail(cur, actor.organization_id, item["id"]) for item in listed]
        names = [row["name"] for row in databases.listing(cur, actor)]
    return _html(
        "console_keys.html",
        title="API keys - Tessel",
        keys=detailed,
        database_names=names,
        errors=errors,
        values=values,
        fresh_secret=fresh_secret,
        **_base(actor, "settings", toasts, None),
    )


def _create_key(actor, name, role, chosen):
    body = {"name": name, "role": role}
    validate.scan_unstorable(body)
    checked = validate.string(body, "name", "name", 1, 60)
    chosen_role = validate.choice(body, "role", "role", keys.KEY_ROLES)
    with db.tx() as cur:
        scope = keys.resolve_scope(cur, actor.organization_id, chosen)
        answer = keys.create(cur, actor, checked, chosen_role, scope)
    return answer["secret"]


def _rotate_key(actor, key_id):
    with db.tx() as cur:
        answer, name = keys.rotate(cur, actor, key_id)
        recipients = databases.owner_emails(cur, actor.organization_id)
    mailer.key_rotated(recipients, name)
    return answer["secret"]


def _revoke_key(actor, key_id):
    with db.tx() as cur:
        name = keys.revoke(cur, actor, key_id)
        recipients = databases.owner_emails(cur, actor.organization_id)
    mailer.key_revoked(recipients, name)


def billing_page(request, actor):
    if actor.role != "owner":
        return denied(actor)
    toasts = []
    plan_error = None
    if request.method == "POST":
        form = request.form()
        if form.get("action") == "set-plan":
            try:
                plan = validate.choice(
                    {"plan": form.get("plan", "")}, "plan", "plan", pricing.PLANS
                )
                with db.tx() as cur:
                    current, changed = databases.switch_plan(cur, actor, plan)
                    recipients = (
                        databases.owner_emails(cur, actor.organization_id) if changed else []
                    )
                if changed:
                    mailer.plan_changed(recipients, actor.organization["name"], plan)
                toasts.append(_toast("Plan is now %s" % pricing.PLAN_LABEL[current]))
            except TesselError as refusal:
                plan_error = refusal.message
                toasts.append(_toast(refusal.message, "error"))
    with db.tx() as cur:
        organization = cur.one(
            "SELECT id, name, plan FROM organizations WHERE id = %s",
            (actor.organization_id,),
        )
        bill = usage.bill(cur, organization)
        series = usage.daily(cur, actor.organization_id)
    largest = max([day["tokens"] for day in series["days"]] + [0])
    today = textutil.format_day(textutil.now())
    days = [
        {
            "day": day["day"],
            "tokens": day["tokens"],
            "height": round(day["tokens"] * 100 / largest, 2) if largest else 0,
            "today": day["day"] == today,
        }
        for day in series["days"]
    ]
    return _html(
        "console_billing.html",
        title="Billing - Tessel",
        plan_label=pricing.PLAN_LABEL[organization["plan"]],
        usage=bill,
        daily={"month": series["month"], "days": days},
        plan_error=plan_error,
        **_base(actor, "settings", toasts, None),
    )


def audit_page(request, actor):
    if actor.role != "owner":
        return denied(actor)
    action = request.param("action") or ""
    actor_filter = request.param("actor") or ""
    cursor = request.param("cursor") or None
    filter_error = None
    events = []
    next_cursor = None
    try:
        checked = audit.validate_action(action)
        with db.tx() as cur:
            events, next_cursor = audit.read_page(
                cur, actor.organization_id, audit.PAGE_DEFAULT, cursor, checked, actor_filter or None
            )
    except TesselError as refusal:
        filter_error = refusal.message
    return _html(
        "console_audit.html",
        title="Audit log - Tessel",
        events=events,
        next_cursor=next_cursor,
        action=action,
        actor=actor_filter,
        actions=audit.ACTIONS,
        filter_error=filter_error,
        **_base(actor, "settings", [], None),
    )
