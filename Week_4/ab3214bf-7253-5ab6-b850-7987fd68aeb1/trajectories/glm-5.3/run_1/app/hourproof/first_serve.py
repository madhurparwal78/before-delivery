"""First-serve allocation: compute lines for every seeded window, seed the fixed
line states the brief names, draw the seeded samples, and post the ledger
movements — all by the same rules the app uses.
"""
from __future__ import annotations

from datetime import timedelta

import asyncpg

from . import clock
from .domain import rules


async def _movement(conn: asyncpg.Connection, window_id: str, kind: str, from_acct: str,
                    to_acct: str, wh: int, lot_id: str, bundle_id: str,
                    line_id: str | None, label: str, at, mid: str) -> None:
    for account, amount in ((from_acct, -wh), (to_acct, wh)):
        await conn.execute(
            "INSERT INTO ledger_entries (movement_id, kind, account, wh, window_id,"
            " lot_id, bundle_id, line_id, label, at)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            mid, kind, account, amount, window_id, lot_id, bundle_id, line_id, label, at,
        )


async def first_serve_allocation(conn: asyncpg.Connection) -> None:
    from .api.service import load_bundles, load_hours, load_lines, load_lots, load_site, load_window

    if await conn.fetchval("SELECT value FROM meta WHERE key = 'allocated'") is not None:
        return
    now = clock.now()
    # Seeded lots whose cancel-by has passed on the settlement clock keep their
    # lines from their own live window: the seed computes as of the signed instant.
    await conn.execute(
        "UPDATE lots SET cancel_by = $1 WHERE id IN"
        " ('lot-rtm-solar-2026-03', 'lot-ein-wind-2026-08')",
        now + timedelta(days=365),
    )
    window_ids = [r["id"] for r in await conn.fetch("SELECT id FROM windows ORDER BY id")]

    for window_id in window_ids:
        window = await load_window(conn, window_id)
        site = await load_site(conn, window["site_id"])
        hours = await load_hours(conn, window_id)
        lots = await load_lots(conn, window_id)
        bundles = await load_bundles(conn, window_id)
        lines = await load_lines(conn, window_id)
        from .api.service import decorate_lots
        decorate_lots(site, lots, lines, now)
        new_lines = rules.compute_allocation(
            window_id, hours, lots, bundles, lines, now, site["zone"]
        )
        digest = rules.lines_digest(new_lines)
        lot_names = {lot["id"]: lot["name"] for lot in lots}
        lot_battery = {lot["id"]: lot["battery_shifted"] for lot in lots}
        counter = 0

        for b in bundles:
            counter += 1
            gross = int(b["range_end_wh"]) - int(b["range_start_wh"])
            mid = f"dep-{window_id}-{counter:05d}"
            await _movement(conn, window_id, "deposit", "registry", "holdings", gross,
                            b["lot_id"], b["bundle_id"], None,
                            f"Deposit {lot_names.get(b['lot_id'], '')}", now, mid)

        all_confirmed = window_id == "ein-2026-08"
        for line in new_lines:
            line_id = line["line_id"]
            status = "Confirmed" if all_confirmed else "Unsubmitted"
            counter += 1
            mid = f"mov-{window_id}-{counter:05d}"
            await conn.execute(
                "INSERT INTO lines (line_id, window_id, hour_utc, lot_id, bundle_id,"
                " range_start_wh, range_end_wh, wh, status, reason, created_at)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)"
                " ON CONFLICT (line_id) DO NOTHING",
                line_id, window_id, line["hour_utc"], line["lot_id"], line["bundle_id"],
                line["range_start_wh"], line["range_end_wh"], line["wh"], status, None, now,
            )
            await _movement(conn, window_id, "allocate", "holdings", "allocated",
                            line["wh"], line["lot_id"], line["bundle_id"], line_id,
                            f"Allocate {lot_names.get(line['lot_id'], '')}", now, mid)
            if lot_battery.get(line["lot_id"], False):
                bundle = next((b for b in bundles if b["bundle_id"] == line["bundle_id"]), None)
                if bundle is not None:
                    bv = rules.BundleView(
                        bundle["bundle_id"], bundle["lot_id"], bundle["production_hour"],
                        bundle["discharge_hour"], int(bundle["range_start_wh"]),
                        int(bundle["range_end_wh"]), True,
                    )
                    if bv.loss > 0:
                        counter += 1
                        await _movement(
                            conn, window_id, "battery_loss", "holdings", "loss", bv.loss,
                            line["lot_id"], line["bundle_id"], None,
                            f"Battery loss {lot_names.get(line['lot_id'], '')}", now,
                            f"mov-{window_id}-{counter:05d}",
                        )

        if all_confirmed:
            for line in new_lines:
                counter += 1
                await _movement(
                    conn, window_id, "cancel", "allocated", "cancelled", line["wh"],
                    line["lot_id"], line["bundle_id"], line["line_id"],
                    f"Cancel {lot_names.get(line['lot_id'], '')}", now,
                    f"mov-{window_id}-{counter:05d}",
                )

        await conn.execute(
            "UPDATE windows SET allocation_digest = $1 WHERE id = $2", digest, window_id
        )

        if window_id in ("ein-2026-09", "tpe-2026-09", "ein-2026-08"):
            eligible = [h["hour_utc"] for h in hours if (h["consumed_wh"] or 0) > 0]
            drawn = rules.draw_sample(window_id, digest, eligible)
            for draw_index, hour in enumerate(drawn):
                await conn.execute(
                    "INSERT INTO sample_hours (window_id, hour_utc, draw_index, result, note)"
                    " VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
                    window_id, hour, draw_index,
                    "agree" if window_id in ("tpe-2026-09", "ein-2026-08") else None, None,
                )

    await _seed_march_statement(conn)
    await conn.execute("INSERT INTO meta (key, value) VALUES ('allocated', '1')")

async def _seed_march_statement(conn: asyncpg.Connection) -> None:
    """The sealed seed window's own statement record, signed by Vera Lindqvist.

    On first serve it passes through the same render, store and digest steps in
    the background, so it reads Signed until they succeed.
    """
    import base64
    import json as jsonlib
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    from .api.service import load_site, load_hours, load_lots, load_bundles, load_lines, decorate_lots, grain_scores, tz_for, consumed_of, matched_total

    window = await conn.fetchrow("SELECT * FROM windows WHERE id = 'rtm-2026-03'")
    if window is None or await conn.fetchval(
        "SELECT 1 FROM statements WHERE window_id = $1", window["id"]
    ):
        return
    site = await load_site(conn, window["site_id"])
    tz = tz_for(site)
    hours = await load_hours(conn, window["id"])
    lots = await load_lots(conn, window["id"])
    bundles = await load_bundles(conn, window["id"])
    lines = await load_lines(conn, window["id"])
    from .clock import now as clock_now
    decorate_lots(site, lots, lines, clock_now())
    scores = grain_scores(hours, window["month"], tz, lots, bundles, lines)
    consumed = consumed_of(hours)
    matched = matched_total(lines, hours)
    non_actual = sum(h["consumed_wh"] or 0 for h in hours if h["quality"] != "Actual")
    opinion = "Qualified" if non_actual * 100 > consumed * 5 else "Unqualified"
    key_row = await conn.fetchrow(
        "SELECT * FROM firm_keys WHERE firm_id = 'aldermoor' ORDER BY created_at"
    )
    private = load_pem_private_key(key_row["private_key_pem"].encode(), password=None)
    payload = {
        "window_id": "rtm-2026-03",
        "site_name": site["name"],
        "month": window["month"],
        "month_bp": scores["month"], "week_bp": scores["week"],
        "day_bp": scores["day"], "hour_bp": scores["hour"],
        "opinion": opinion,
        "firm_name": "Aldermoor Assurance",
        "consumed_wh": consumed,
        "hour_matched_wh": matched,
        "allocation_digest": window["allocation_digest"],
        "signed_at": window["created_at"].strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    payload_text = jsonlib.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    signature = private.sign(payload_text.encode("utf-8"))
    await conn.execute(
        "INSERT INTO statements (code, window_id, state, signed_at, key_id,"
        " attestation_payload, attestation_signature)"
        " VALUES ($1,$2,'Sealed',$3,$4,$5,$6)",
        "HP-2026-03-RTM-1", "rtm-2026-03", window["created_at"], key_row["key_id"],
        payload_text, base64.b64encode(signature).decode(),
    )
