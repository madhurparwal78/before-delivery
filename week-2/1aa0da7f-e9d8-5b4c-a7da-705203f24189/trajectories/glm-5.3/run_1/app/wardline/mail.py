"""Mail outbox and SMTP worker (DP-77)."""
from __future__ import annotations

import smtplib
import threading
import time
from email.message import EmailMessage

from .config import Config
from .db import Database


class Mailer:
    def __init__(self, cfg: Config, db: Database):
        self.cfg = cfg
        self.db = db
        self.last_known_up = False
        self._lock = threading.Lock()

    def check(self) -> bool:
        try:
            with smtplib.SMTP(self.cfg.smtp_host, self.cfg.smtp_port, timeout=4) as smtp:
                smtp.noop()
            self.last_known_up = True
            return True
        except (OSError, smtplib.SMTPException):
            self.last_known_up = False
            return False

    def queue(self, cur, recipient: str, subject: str, body: str) -> None:
        cur.execute(
            "INSERT INTO mail_outbox (recipient, subject, body, status) VALUES (%s, %s, %s, 'pending')",
            (recipient, subject, body),
        )

    def _with_row(self, sql: str, params: tuple = ()) -> list[tuple] | None:
        conn = None
        try:
            conn = self.db.connect()
            cur = conn.cursor()
            cur.execute(sql, params)
            rows = cur.fetchall() if cur.description is not None else []
            conn.commit()
            return rows
        except Exception:
            if conn is not None:
                try:
                    conn.rollback()
                except Exception:
                    pass
            return None
        finally:
            if conn is not None:
                self.db.put(conn)

    def _claim_rows(self, worker: str) -> list[tuple[int, str, str, str]]:
        import datetime

        rows = self._with_row(
            "SELECT id, recipient, subject, body FROM mail_outbox "
            "WHERE status = 'pending' OR (status = 'claimed' AND claimed_at < %s) "
            "ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED",
            (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=60),),
        )
        if not rows:
            return []
        ids = [str(r[0]) for r in rows]
        conn = None
        try:
            conn = self.db.connect()
            cur = conn.cursor()
            for rid in ids:
                cur.execute(
                    "UPDATE mail_outbox SET status='claimed', claimed_by=%s, claimed_at=now() WHERE id=%s",
                    (worker, rid),
                )
            conn.commit()
        except Exception:
            if conn is not None:
                try:
                    conn.rollback()
                except Exception:
                    pass
        finally:
            if conn is not None:
                self.db.put(conn)
        return rows

    def _mark_sent(self, rid: int) -> None:
        self._with_row("UPDATE mail_outbox SET status='sent', sent_at=now() WHERE id=%s", (rid,))

    def _return_pending(self, rid: int) -> None:
        self._with_row("UPDATE mail_outbox SET status='pending' WHERE id=%s", (rid,))

    def _send_one(self, rid: int, recipient: str, subject: str, body: str) -> bool:
        msg = EmailMessage()
        msg["From"] = self.cfg.mail_from
        msg["To"] = recipient
        msg["Subject"] = subject
        msg.set_content(body)
        try:
            with smtplib.SMTP(self.cfg.smtp_host, self.cfg.smtp_port, timeout=10) as smtp:
                smtp.send_message(msg)
            self._mark_sent(rid)
            self.last_known_up = True
            return True
        except (OSError, smtplib.SMTPException):
            self.last_known_up = False
            self._return_pending(rid)
            return False

    def worker_loop(self, stop: threading.Event) -> None:
        worker = f"worker-{int(time.time())}-{id(self) % 10000}"
        while not stop.is_set():
            sent_any = False
            rows = self._claim_rows(worker)
            for rid, recipient, subject, body in rows:
                if self._send_one(rid, recipient, subject, body):
                    sent_any = True
            if not rows:
                stop.wait(2.0)
            elif not sent_any:
                stop.wait(2.0)
