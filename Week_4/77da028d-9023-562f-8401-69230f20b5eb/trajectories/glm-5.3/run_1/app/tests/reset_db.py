"""Reset the database to a clean seed state for test runs (test helper only)."""
from __future__ import annotations

import os

import psycopg


def main() -> None:
    url = os.environ["DATABASE_URL"]
    conn = psycopg.connect(url, autocommit=True)
    conn.execute("DELETE FROM ledger.entries WHERE session_id IS NOT NULL")
    conn.execute("DELETE FROM ledger.sessions WHERE id NOT IN ('sess_heart_oct14', 'sess_orion_oct20')")
    conn.execute("DELETE FROM ledger.batches WHERE session_id NOT IN ('sess_heart_oct14', 'sess_orion_oct20')")
    conn.execute("DELETE FROM ledger.frames WHERE batch_id NOT IN ('batch_heart_ha1', 'batch_orion_r1')")
    conn.execute("DELETE FROM ledger.calibration_links WHERE batch_id NOT IN ('batch_heart_ha1', 'batch_orion_r1')")
    conn.execute("DELETE FROM ledger.idempotency WHERE true")
    conn.execute("DELETE FROM ledger.projects WHERE id NOT IN ('proj_heart_sho', 'proj_andromeda_lrgb', 'proj_veil_bicolour', 'proj_orion_hargb')")
    conn.execute("DELETE FROM ledger.entries WHERE project_id NOT IN ('proj_heart_sho', 'proj_andromeda_lrgb', 'proj_veil_bicolour', 'proj_orion_hargb')")
    conn.execute("DELETE FROM ledger.calibration_versions WHERE set_id IN (SELECT id FROM ledger.calibration_sets WHERE id NOT IN ('cal_darks300', 'cal_darks180', 'cal_flats_ha', 'cal_darks120'))")
    conn.execute("DELETE FROM ledger.calibration_sets WHERE id NOT IN ('cal_darks300', 'cal_darks180', 'cal_flats_ha', 'cal_darks120')")
    conn.execute("UPDATE ledger.calibration_sets SET version = 1")
    conn.execute("DELETE FROM ledger.calibration_versions WHERE version > 1")
    conn.execute("DELETE FROM ledger.share_links WHERE true")
    conn.execute("DELETE FROM ledger.locks WHERE true")
    conn.execute("DELETE FROM gateway.workspaces WHERE imager_id NOT IN ('imager_ines', 'imager_tomasz')")
    conn.execute("DELETE FROM sky_engine.plans WHERE true")
    conn.execute("DELETE FROM sky_engine.conditions WHERE true")
    conn.execute("DELETE FROM sky_engine.condition_headers WHERE true")
    conn.execute("DELETE FROM sky_engine.verdict_outbox WHERE true")
    conn.execute("DELETE FROM sky_engine.verdict_history WHERE true")
    conn.execute("DELETE FROM sky_engine.sites WHERE imager_id NOT IN ('imager_ines', 'imager_tomasz')")
    conn.execute("DELETE FROM sky_engine.horizons WHERE imager_id NOT IN ('imager_ines', 'imager_tomasz')")
    conn.execute("DELETE FROM push_dispatcher.pushes WHERE true")
    conn.execute("DELETE FROM push_dispatcher.reminder_sent WHERE true")
    conn.execute("DELETE FROM push_dispatcher.claimed WHERE true")

    from datetime import datetime, timezone

    from darkframe.common.migrate import _log_batch

    _log_batch(conn, "imager_ines", "proj_heart_sho", "sess_heart_oct14", "batch_heart_ha1", "Ha", 18000, datetime.now(timezone.utc))
    _log_batch(conn, "imager_tomasz", "proj_orion_hargb", "sess_orion_oct20", "batch_orion_r1", "R", 3600, datetime.now(timezone.utc))
    print("reset to seed state")


if __name__ == "__main__":
    main()
