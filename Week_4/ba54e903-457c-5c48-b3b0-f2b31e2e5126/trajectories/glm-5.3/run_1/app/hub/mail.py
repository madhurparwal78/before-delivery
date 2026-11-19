"""Outbox email: queued with the change, delivered by a per-instance poller."""
from __future__ import annotations

import email.message
import email.policy
import smtplib
import threading
import time
from typing import Optional

from .config import Config
from .db import Database


class Mailer:
    def __init__(self, config: Config) -> None:
        self.config = config
        self._db: Optional[Database] = None
        self._stop = threading.Event()

    def bind(self, db: Database) -> None:
        self._db = db

    def _queue(self, conn, recipient: str, recipient_name: Optional[str], subject: str, body: str) -> None:
        """Insert into outbox inside the caller's transaction."""
        conn.execute(
            "INSERT INTO outbox (recipient, recipient_name, subject, body) VALUES (%s, %s, %s, %s)",
            (recipient, recipient_name, subject, body),
        )

    def queue(self, db: Database, recipient: str, recipient_name: Optional[str], subject: str, body: str) -> None:
        with db.session() as conn:
            self._queue(conn, recipient, recipient_name, subject, body)

    def start(self) -> None:
        thread = threading.Thread(target=self._run, daemon=True, name="hub-mail")
        thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                if self._db is not None and self._db.ready:
                    self._deliver_pending()
            except Exception:
                pass
            time.sleep(2)

    def _deliver_pending(self) -> None:
        assert self._db is not None
        claimed = []
        with self._db.session() as conn:
            rows = conn.execute(
                "SELECT id, recipient, recipient_name, subject, body FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 25"
            ).fetchall()
            for row in rows:
                # claim with a lease so several instances never double-send
                claim = conn.execute(
                    """UPDATE outbox SET sent_by = %s WHERE id = %s AND (sent_by IS NULL OR sent_by = %s)
                       RETURNING id""",
                    (self._instance_id(), row["id"], self._instance_id()),
                ).fetchone()
                if claim:
                    claimed.append(dict(row))
        for row in claimed:
            ok = self._send(row)
            if ok:
                with self._db.session() as conn:
                    conn.execute("UPDATE outbox SET sent_at = now() WHERE id = %s", (row["id"],))

    def _instance_id(self) -> int:
        import os
        return int(os.environ.get("HUB_INSTANCE_ID", "0")) + os.getpid()

    def _send(self, row: dict) -> bool:
        msg = email.message.EmailMessage(email.policy.SMTP)
        from_header = self.config.mail_from
        if "<" in from_header:
            display, _, addr = from_header.partition("<")
            msg["From"] = email.header.Header(f"{display.strip()} <{addr.rstrip('>')}>").encode()
        else:
            msg["From"] = from_header
        if row.get("recipient_name"):
            # RFC 2047 encoded display name; decodes to exactly one recipient
            name = email.header.Header(row["recipient_name"], "utf-8").encode()
            msg["To"] = f"{name} <{row['recipient']}>"
        else:
            msg["To"] = row["recipient"]
        msg["Subject"] = email.header.Header(row["subject"], "utf-8").encode()
        msg.set_content(row["body"])
        try:
            with smtplib.SMTP(self.config.smtp_host, self.config.smtp_port, timeout=10) as client:
                client.send_message(msg)
            return True
        except Exception:
            return False
