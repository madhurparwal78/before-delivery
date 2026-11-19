"""The seed workspaces. Every person, site and camera here is invented."""

from __future__ import annotations

from typing import Any

SEED_MARKER = "darkframe-seed-v1"
MASTER_FILENAME = "master.fits"
MASTER_CONTENT_TYPE = "application/octet-stream"


def master_bytes(set_name: str) -> bytes:
    return f"DARKFRAME-SEED-MASTER {set_name}".encode("ascii")


def _ines_horizon() -> list[int]:
    altitudes = [15] * 72
    for index in range(18, 28):
        altitudes[index] = 35
    for index in range(30, 42):
        altitudes[index] = 8
    return altitudes


SEED_IMAGERS: list[dict[str, Any]] = [
    {
        "imager_id": "img_ines_okafor",
        "name": "Ines Okafor",
        "key": "dfk_ines_7c41a9e2",
        "site": {
            "label": "Back garden",
            "latitude": 52.2053,
            "longitude": 0.1218,
            "elevation_m": 15,
            "time_zone": "Europe/London",
            "min_altitude_deg": 25,
            "push_topic": "darkframe-ines-5d2e",
        },
        "horizon": _ines_horizon(),
        "reminder": {"enabled": True, "local_time": "18:00"},
        "projects": [
            {
                "id": "prj_seed_heart_nebula",
                "name": "Heart Nebula in SHO",
                "target_name": "IC 1805",
                "ra_deg": 38.175,
                "dec_deg": 61.45,
                "state": "active",
                "allotments": {"Ha": 36000, "OIII": 36000, "SII": 36000},
            },
            {
                "id": "prj_seed_andromeda",
                "name": "Andromeda LRGB",
                "target_name": "M31",
                "ra_deg": 10.6847,
                "dec_deg": 41.2690,
                "state": "active",
                "allotments": {"L": 21600, "R": 7200, "G": 7200, "B": 7200},
            },
            {
                "id": "prj_seed_veil",
                "name": "Veil bicolour",
                "target_name": "NGC 6960",
                "ra_deg": 311.4083,
                "dec_deg": 30.7167,
                "state": "draft",
                "allotments": {"Ha": 28800, "OIII": 28800},
            },
        ],
        "calibration_sets": [
            {
                "id": "cal_seed_darks_300",
                "name": "Darks 300 s gain 100 at -10 C",
                "kind": "dark",
                "camera": "Umbra 26M",
                "gain": 100,
                "offset": 50,
                "exposure_s": 300,
                "temperature_c": -10.0,
                "binning": 1,
                "filter": None,
                "frame_count": 40,
                "captured_days_ago": 75,
                "status": "ready",
            },
            {
                "id": "cal_seed_darks_180",
                "name": "Darks 180 s gain 100 at -10 C (old)",
                "kind": "dark",
                "camera": "Umbra 26M",
                "gain": 100,
                "offset": 50,
                "exposure_s": 180,
                "temperature_c": -10.0,
                "binning": 1,
                "filter": None,
                "frame_count": 40,
                "captured_days_ago": 200,
                "status": "ready",
            },
            {
                "id": "cal_seed_flats_ha",
                "name": "Flats Ha",
                "kind": "flat",
                "camera": "Umbra 26M",
                "gain": 100,
                "offset": 50,
                "exposure_s": None,
                "temperature_c": -10.0,
                "binning": 1,
                "filter": "Ha",
                "frame_count": 30,
                "captured_days_ago": 10,
                "status": "ready",
            },
        ],
        "sessions": [
            {
                "id": "ses_seed_heart_1014",
                "project_id": "prj_seed_heart_nebula",
                "state": "logged",
                "observing_date": "2026-10-14",
                "started_at": "2026-10-14T21:05:00+01:00",
                "notes": "Oak blocked the east until 22:40. Dew heater on 3.",
                "batches": [
                    {
                        "id": "bat_seed_heart_ha",
                        "filter": "Ha",
                        "sub_count": 60,
                        "exposure_s": 300,
                        "camera": "Umbra 26M",
                        "gain": 100,
                        "offset": 50,
                        "temperature_c": -10.0,
                        "binning": 1,
                        "calibration": {
                            "dark": "cal_seed_darks_300",
                            "flat": "cal_seed_flats_ha",
                        },
                    }
                ],
            }
        ],
    },
    {
        "imager_id": "img_tomasz_brandt",
        "name": "Tomasz Brandt",
        "key": "dfk_tomasz_3e8b52d0",
        "site": {
            "label": "Rooftop",
            "latitude": 37.1773,
            "longitude": -3.5986,
            "elevation_m": 690,
            "time_zone": "Europe/Madrid",
            "min_altitude_deg": 20,
            "push_topic": "darkframe-tomasz-91af",
        },
        "horizon": [10] * 72,
        "reminder": {"enabled": False, "local_time": "18:00"},
        "projects": [
            {
                "id": "prj_seed_orion",
                "name": "Orion Nebula HaRGB",
                "target_name": "M42",
                "ra_deg": 83.8221,
                "dec_deg": -5.3911,
                "state": "active",
                "allotments": {"Ha": 14400, "R": 3600, "G": 3600, "B": 3600},
            }
        ],
        "calibration_sets": [
            {
                "id": "cal_seed_darks_120",
                "name": "Darks 120 s gain 0 at 0 C",
                "kind": "dark",
                "camera": "Umbra 6M",
                "gain": 0,
                "offset": 10,
                "exposure_s": 120,
                "temperature_c": 0.0,
                "binning": 1,
                "filter": None,
                "frame_count": 25,
                "captured_days_ago": 30,
                "status": "ready",
            }
        ],
        "sessions": [
            {
                "id": "ses_seed_orion_1020",
                "project_id": "prj_seed_orion",
                "state": "logged",
                "observing_date": "2026-10-20",
                "started_at": "2026-10-21T01:10:00+02:00",
                "notes": "Neighbour's floodlight on until 01:00.",
                "batches": [
                    {
                        "id": "bat_seed_orion_r",
                        "filter": "R",
                        "sub_count": 30,
                        "exposure_s": 120,
                        "camera": "Umbra 6M",
                        "gain": 0,
                        "offset": 10,
                        "temperature_c": 0.0,
                        "binning": 1,
                        "calibration": {},
                    }
                ],
            }
        ],
    },
]
