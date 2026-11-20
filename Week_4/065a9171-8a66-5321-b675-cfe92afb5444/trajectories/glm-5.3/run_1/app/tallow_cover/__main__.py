"""Tallow Cover server: schema, seed, background sweeps, HTTP boundary."""
import threading
import time

from . import api_core, api_leave, api_ops, api_records, domain, mailer, repo
from .config import Config
from .idem import KeyedAction
from .storage import Storage
from .store import Store
from .web import HttpApp, serve


def build_app(config=None, store=None):
    config = config or Config()
    store = store or Store(config)
    store.config = config
    store.setup()
    app_mailer = mailer.Mailer(config)
    app_storage = Storage(config)
    app = HttpApp(store, config, app_mailer, app_storage, None)
    app.keyed = KeyedAction(store)
    api_core.register(app)
    api_leave.register(app)
    api_ops.register(app)
    api_records.register(app)
    return app


def sweep_forever(app):
    """The background sweep: escalation, fit notes, mail, held uploads, health."""
    store = app.store
    while True:
        conn = None
        try:
            conn = store.connect()
            sweep_escalation(conn, app)
            sweep_sickness(conn)
            app.mailer.drain(conn)
            drain_uploads(conn, app)
            app.storage.probe()
            app.mailer.probe()
            app.keyed.sweep(conn)
        except Exception:
            import traceback
            traceback.print_exc()
        finally:
            if conn is not None:
                try:
                    store.release(conn)
                except Exception:
                    pass
        time.sleep(5)


def sweep_escalation(conn, app):
    """Still submitted after the delay: escalate and email the home manager."""
    rows = conn.execute(
        "select id from leave_requests where status = 'submitted'"
        " and submitted_at is not null"
        " and submitted_at + make_interval(secs => $1) <= now()",
        [app.config.escalation_after_seconds])
    from . import decode as dc
    from .store import new_id
    for r in rows:
        request_id = dc.s(r[0])
        conn.execute("BEGIN")
        try:
            row = repo.fetch_leave_request(conn, request_id)
            if row is None or row["status"] != "submitted":
                conn.execute("COMMIT")
                continue
            conn.execute("update leave_requests set status = 'escalated'"
                         " where id = $1", [request_id])
            requester = repo.get_person(conn, row["requester_id"])
            manager_rows = conn.execute(
                "select id from people where role = 'unit_manager' and home_id = $1"
                " and is_home_manager order by id limit 1", [row["home_id"]])
            if manager_rows:
                manager = repo.get_person(conn, dc.s(manager_rows[0][0]))
                unit_rows = conn.execute(
                    "select name from units where id = $1", [row["unit_id"]]) \
                    if row["unit_id"] else []
                unit_name = dc.s(unit_rows[0][0]) if unit_rows else "No unit"
                subject = (f"Leave request awaiting decision: {requester['display_name']},"
                           f" {domain.date_label(row['start_date'])} to"
                           f" {domain.date_label(row['end_date'])}")
                submitted = domain.iso_instant(row["submitted_at"])
                body = (f"{requester['display_name']} ({unit_name}) has a "
                        f"{TYPE_LABEL[row['type']].lower()} request from "
                        f"{domain.date_label(row['start_date'])} to "
                        f"{domain.date_label(row['end_date'])}, submitted {submitted},"
                        f" awaiting a decision.")
                mailer.queue_email(conn, manager["email"],
                                   mailer.build_subject(subject), body)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")


def sweep_sickness(conn):
    repo.sweep_all_sickness(conn)


def drain_uploads(conn, app):
    """Held fit notes and exports reach storage when it returns."""
    from . import decode as dc
    rows = conn.execute("select id, kind, object_key, content_type, bytes from uploads")
    for r in rows:
        upload_id, kind, object_key = dc.s(r[0]), dc.s(r[1]), dc.s(r[2])
        content_type = dc.s(r[3])
        payload = r[4]
        if isinstance(payload, (bytes, bytearray)) and payload[:2] in (b"\\x", "\\x"):
            payload = bytes.fromhex(payload[2:].decode("ascii"))
        if app.storage.put(object_key, content_type, payload):
            conn.execute("delete from uploads where id = $1", [upload_id])
            if kind == "fit_note":
                conn.execute("update sickness set fit_note_storage = 'stored'"
                             " where fit_note_storage_key = $1", [object_key])
            else:
                conn.execute("update exports set storage = 'stored'"
                             " where object_key = $1", [object_key])


TYPE_LABEL = {"annual": "Annual leave", "unpaid": "Unpaid leave",
              "compassionate": "Compassionate leave"}


def main():
    config = Config()
    app = build_app(config)
    thread = threading.Thread(target=sweep_forever, args=(app,), daemon=True)
    thread.start()
    httpd = serve(app, "0.0.0.0", config.public_port)
    print(f"Tallow Cover serving on port {config.public_port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
