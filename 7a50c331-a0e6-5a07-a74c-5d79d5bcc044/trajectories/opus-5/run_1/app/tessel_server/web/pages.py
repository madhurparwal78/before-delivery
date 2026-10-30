"""The public pages: landing, contact, sign in and the password pages."""
from .. import auth, db, httpbase, returnpath, textutil, totp, validate
from ..api.public import apply_reset, request_reset, sign_in
from ..domain import contact as contact_domain
from ..errors import TesselError
from . import content, markdown, render

SESSION_COOKIE = "tessel_session"
PENDING_MINUTES = 10

HERO_HEIGHT = 620
HERO_COLUMN = 150
HERO_NODE_HEIGHT = 30
HERO_MARGIN = 20


def _hero_depths():
    depth = {content.HERO_NODES[0]: 0}
    changed = True
    while changed:
        changed = False
        for parent, child in content.HERO_EDGES:
            if parent in depth and depth.get(child) != depth[parent] + 1:
                depth[child] = depth[parent] + 1
                changed = True
    return depth


def hero_layout():
    """A deterministic layered layout for the 21 hero nodes and 20 lines."""
    depth = _hero_depths()
    columns = {}
    for label in content.HERO_NODES:
        columns.setdefault(depth[label], []).append(label)
    boxes = {}
    for level, labels in columns.items():
        for index, label in enumerate(labels):
            width = min(148, max(66, int(7.0 * len(label)) + 18))
            centre_y = HERO_HEIGHT * (index + 1) / (len(labels) + 1)
            boxes[label] = {
                "label": label,
                "x": HERO_MARGIN + level * HERO_COLUMN,
                "y": round(centre_y - HERO_NODE_HEIGHT / 2, 1),
                "w": width,
                "h": HERO_NODE_HEIGHT,
                "cx": HERO_MARGIN + level * HERO_COLUMN + width / 2,
                "cy": round(centre_y, 1),
            }
    nodes = [boxes[label] for label in content.HERO_NODES]
    edges = []
    for parent, child in content.HERO_EDGES:
        start = boxes[parent]
        end = boxes[child]
        edges.append(
            {
                "x1": start["x"] + start["w"],
                "y1": start["cy"],
                "x2": end["x"],
                "y2": end["cy"],
            }
        )
    width = max(box["x"] + box["w"] for box in boxes.values()) + HERO_MARGIN
    return {"nodes": nodes, "edges": edges, "width": width, "height": HERO_HEIGHT}


def chart_geometry():
    ticks = []
    for index, label in enumerate(content.CHART_TICKS):
        ticks.append({"label": label, "x": 60 + index * 130})
    series = []
    for column, (name, _value, end_label) in enumerate(content.CHART_SERIES):
        points = []
        for index, row in enumerate(content.CHART_ROWS):
            value = float(row[column + 1].rstrip("%"))
            points.append((60 + index * 130, round(260 - (value - 30) / 65 * 230, 1)))
        series.append(
            {
                "name": name,
                "points": " ".join("%s,%s" % point for point in points),
                "end_x": points[-1][0] - 150,
                "end_y": points[-1][1] - 10,
                "end_label": end_label,
            }
        )
    return {"ticks": ticks, "series": series}


def _markdown_response(path):
    body = markdown.TWINS[path]()
    response = httpbase.Response(
        200, body.encode("utf-8"), content_type="text/markdown; charset=utf-8"
    )
    response.add("Vary", "Accept")
    for name, value in httpbase.HTML_SECURITY_HEADERS:
        response.add(name, value)
    return response


def landing(request):
    if request.wants_markdown():
        return _markdown_response("/")
    reader = markdown.reader_view("/") if request.param("view") == "ai" else None
    return httpbase.html(
        render.page(
            "landing.html",
            title=content.LANDING_TITLE,
            description=content.LANDING_DESCRIPTION,
            hero=hero_layout(),
            chart=chart_geometry(),
            page_path="/",
            reader=reader,
        )
    )


EMPTY_CONTACT = {"email": "", "message": ""}


def contact_page(request):
    if request.method == "POST":
        return _contact_post(request)
    if request.wants_markdown():
        return _markdown_response("/contact")
    reader = markdown.reader_view("/contact") if request.param("view") == "ai" else None
    return _contact_render(request, EMPTY_CONTACT, {}, None, False, reader, 200)


def _contact_render(request, values, errors, form_error, sent, reader, status):
    return httpbase.html(
        render.page(
            "contact.html",
            title=content.CONTACT_TITLE,
            description=content.CONTACT_DESCRIPTION,
            page_path="/contact",
            reader=reader,
            values=values,
            errors=errors,
            form_error=form_error,
            sent=sent,
        ),
        status=status,
    )


def _contact_post(request):
    form = request.form()
    values = {"email": form.get("email", ""), "message": form.get("message", "")}
    body = {
        "email": values["email"],
        "message": values["message"],
        "website": form.get("website", ""),
    }
    try:
        validate.scan_unstorable(body)
        email, message, website = contact_domain.validate_body(body)
        with db.tx() as cur:
            contact_domain.store(cur, email, message, website)
    except TesselError as refusal:
        errors = {}
        form_error = None
        if refusal.field in ("email", "message"):
            errors[refusal.field] = _contact_message(refusal)
        else:
            form_error = refusal.message
        return _contact_render(
            request, values, errors, form_error, False, None, refusal.status
        )
    return _contact_render(request, EMPTY_CONTACT, {}, None, True, None, 200)


def _contact_message(refusal):
    if refusal.field == "email":
        return "Enter a valid email address"
    return "Write between 10 and 4000 characters"


def _auth_page(request, **values):
    status = values.pop("status", 200)
    return httpbase.html(render.page("auth.html", **values), status=status)


def _pending_token(cur, member_id):
    token = auth.new_reset_token()
    cur.execute(
        "DELETE FROM pending_sign_ins WHERE member_id = %s", (member_id,)
    )
    cur.execute(
        """
        INSERT INTO pending_sign_ins (member_id, token_digest, created_at)
        VALUES (%s, %s, %s)
        """,
        (member_id, auth.digest(token), textutil.now()),
    )
    return token


def login_page(request):
    next_path = returnpath.safe_next(request.param("next"))
    notice = None
    if request.has_param("next"):
        notice = "Your session has ended. Sign in again."
    if request.param("reset") == "1":
        notice = "Your password was reset. Sign in with the new one."
    if request.method == "GET":
        pending = request.param("pending")
        if request.param("step") == "recovery" and pending:
            return _auth_page(
                request,
                title="Sign in - Tessel",
                heading="Two-step sign-in",
                page="login",
                stage="totp",
                recovery=True,
                pending=pending,
                next_path=next_path,
                values={"email": ""},
                errors={},
                notice=notice,
                error=None,
            )
        return _auth_page(
            request,
            title="Sign in - Tessel",
            heading="Sign in",
            page="login",
            stage="password",
            recovery=False,
            pending="",
            next_path=next_path,
            values={"email": request.param("email") or ""},
            errors={},
            notice=notice,
            error=None,
        )
    return _login_post(request, next_path, notice)


def _login_post(request, next_path, notice):
    form = request.form()
    if form.get("pending"):
        return _login_second_step(request, form, next_path)
    email = form.get("email", "")
    password = form.get("password", "")
    try:
        answer = sign_in(email, password, None, None)
    except TesselError as refusal:
        if refusal.code == "TOTP_REQUIRED":
            with db.tx() as cur:
                member = cur.one(
                    "SELECT id FROM members WHERE email = %s", (email.lower(),)
                )
                token = _pending_token(cur, member["id"])
            return _auth_page(
                request,
                title="Sign in - Tessel",
                heading="Two-step sign-in",
                page="login",
                stage="totp",
                recovery=False,
                pending=token,
                next_path=next_path,
                values={"email": email},
                errors={},
                notice=None,
                error=None,
            )
        return _auth_page(
            request,
            title="Sign in - Tessel",
            heading="Sign in",
            page="login",
            stage="password",
            recovery=False,
            pending="",
            next_path=next_path,
            values={"email": email},
            errors={},
            notice=notice,
            error=refusal.message,
            shake=True,
            status=refusal.status,
        )
    return _signed_in(answer["token"], next_path)


def _login_second_step(request, form, next_path):
    code = form.get("code", "")
    recovery = form.get("mode") == "recovery"
    with db.tx() as cur:
        row = cur.one(
            """
            SELECT p.id, m.id AS member_id, m.email, m.totp_secret, m.totp_last_step
              FROM pending_sign_ins p JOIN members m ON m.id = p.member_id
             WHERE p.token_digest = %s
            """,
            (auth.digest(form["pending"]),),
        )
    if row is None:
        return _auth_page(
            request,
            title="Sign in - Tessel",
            heading="Sign in",
            page="login",
            stage="password",
            recovery=False,
            pending="",
            next_path=next_path,
            values={"email": ""},
            errors={},
            notice=None,
            error="Email or password is incorrect",
            shake=True,
            status=401,
        )
    accepted = False
    if recovery:
        with db.tx() as cur:
            rows = cur.all(
                """
                SELECT id, code_digest FROM recovery_codes
                 WHERE member_id = %s AND used_at IS NULL
                """,
                (row["member_id"],),
            )
            for item in rows:
                if item["code_digest"] == auth.digest(code):
                    cur.execute(
                        "UPDATE recovery_codes SET used_at = %s WHERE id = %s",
                        (textutil.now(), item["id"]),
                    )
                    accepted = True
    else:
        step = totp.matching_step(row["totp_secret"], code, row["totp_last_step"])
        if step is not None:
            accepted = True
            with db.tx() as cur:
                cur.execute(
                    "UPDATE members SET totp_last_step = %s WHERE id = %s",
                    (step, row["member_id"]),
                )
    if not accepted:
        with db.tx() as cur:
            auth.record_failed_sign_in(cur, row["email"])
        return _auth_page(
            request,
            title="Sign in - Tessel",
            heading="Two-step sign-in",
            page="login",
            stage="totp",
            recovery=recovery,
            pending=form["pending"],
            next_path=next_path,
            values={"email": row["email"]},
            errors={"code": "That code is not valid"},
            notice=None,
            error="That code is not valid",
            shake=True,
            status=401,
        )
    with db.tx() as cur:
        cur.execute("DELETE FROM pending_sign_ins WHERE id = %s", (row["id"],))
        auth.clear_sign_in_attempts(cur, row["email"])
        token = auth.issue_session(cur, row["member_id"])
    return _signed_in(token, next_path)


def _signed_in(token, next_path):
    response = httpbase.redirect(next_path)
    response.set_cookie(SESSION_COOKIE, token)
    response.add("Cache-Control", "no-store")
    return response


def forgot_page(request):
    if request.method == "GET":
        return _auth_page(
            request,
            title="Forgot password - Tessel",
            heading="Reset your password",
            page="forgot",
            values={"email": ""},
            errors={},
            notice=None,
            error=None,
            sent=False,
        )
    form = request.form()
    body = {"email": form.get("email", "")}
    try:
        validate.scan_unstorable(body)
        request_reset(validate.email(body, "email", "email"))
    except TesselError:
        return _auth_page(
            request,
            title="Forgot password - Tessel",
            heading="Reset your password",
            page="forgot",
            values={"email": form.get("email", "")},
            errors={"email": "Enter a valid email address"},
            notice=None,
            error=None,
            sent=False,
            status=400,
        )
    return _auth_page(
        request,
        title="Forgot password - Tessel",
        heading="Reset your password",
        page="forgot",
        values={"email": ""},
        errors={},
        notice=None,
        error=None,
        sent=True,
    )


def reset_page(request):
    if request.method == "GET":
        token = request.param("token") or ""
        invalid = not _reset_token_live(token)
        return _auth_page(
            request,
            title="Set a new password - Tessel",
            heading="Set a new password",
            page="reset",
            values={"token": token},
            errors={},
            notice=None,
            error="This reset link is no longer valid" if invalid else None,
            token_invalid=invalid,
        )
    form = request.form()
    token = form.get("token", "")
    password = form.get("password", "")
    confirm = form.get("confirm", "")
    if password != confirm:
        return _auth_page(
            request,
            title="Set a new password - Tessel",
            heading="Set a new password",
            page="reset",
            values={"token": token},
            errors={"confirm": "The passwords do not match"},
            notice=None,
            error=None,
            token_invalid=False,
            status=400,
        )
    try:
        validate.password({"password": password}, "password", "password")
        apply_reset(token, password)
    except TesselError as refusal:
        invalid = refusal.code == "RESET_TOKEN_INVALID"
        return _auth_page(
            request,
            title="Set a new password - Tessel",
            heading="Set a new password",
            page="reset",
            values={"token": token},
            errors={} if invalid else {"password": refusal.message},
            notice=None,
            error=refusal.message if invalid else None,
            token_invalid=invalid,
            status=refusal.status,
        )
    return httpbase.redirect("/login?reset=1")


def _reset_token_live(token):
    if not token:
        return False
    with db.tx() as cur:
        return bool(
            cur.value(
                """
                SELECT 1 FROM reset_tokens
                 WHERE token_digest = %s AND used_at IS NULL AND cancelled_at IS NULL
                """,
                (auth.digest(token),),
            )
        )
