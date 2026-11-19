from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import re
import struct
import threading
import time
import uuid
import zlib
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    Postgres,
    S3,
    addresses,
    advance,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    tab_order,
    tap,
    text,
)

GRADING_KEY = os.environ.get("GRADING_KEY", "gf-grading-4c8e17")
OUTAGE_URL_ENV = "APP_MINIO_DOWN_URL"
HTTP_TIMEOUT = 60.0
UI_WAIT_S = 20
STEP_MS = 200
POLL_MS = 300
MAIL_WAIT_S = 30
MAIL_POLL_S = 0.3
SCRUB_SETTLE_MS = 1500
LIVE_SLACK_S = 1
DEVICE_CLOCK = "2030-01-01T00:00:00Z"

APP_DIR = Path("/app")
START = "2026-03-02T08:00:00.000Z"
TODAY = "2026-03-02"
LIVE_S = 2
MAIL_QUIET_S = 6
HEALTH_MAX_S = 1
LINK_TTL_S = 300
PROOF_MAX_BYTES = 5242880
DERIVATIVE_MAX_BYTES = 10485760
BODY_LIMIT = 100000
INVITE_TTL_H = 72
WEIGHT_DELAY_MS = 300
WEIGHT_EASE_MS = 500
FADE_MAX_MS = 500
TARGET_PX = 44
STAGE_PX = 2700
CARD_PX = 500
CARD_SHRUNK_PX = 416
FIELD_START_PX = 70
FIELD_MID_PX = 195
FIELD_WIDE_PX = 394
ABOUT = 0.3
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
PHONE_REVIEW = (390, 844)
ANA_GRANT_END = "2026-04-15T21:59:59.999Z"
ANA_ENGAGEMENT_OVER = "2026-04-15T22:00:00.000Z"
ZERO_HASH = "0" * 64

OPENING = "Quenby & Co. is not a mood board. It is a set of rules, each with a name you can cite."
PROMISE_HEAD = "Every colour, letter, mark and move here is a rule with an identifier."
TILES = ["Logo", "Voice", "Colour", "Typography", "Iconography", "Motion", "Library", "Rule index"]
FULL_LOCK = "Logo — Full lock"
TAB = "Logo — Tab"
LIBRARY_ORDER = [
    "Harbour photograph", "Logo 1998", "Logo — Full lock", "Logo — Tab", "Menu UI icon",
    "Parcel spot icon", "Pin pictogram", "Rebrand teaser illustration", "Storefront photograph",
]
ANA_BADGES = {
    "Logo — Tab": "Available",
    "Logo — Full lock": "Request required", "Menu UI icon": "Request required",
    "Parcel spot icon": "Request required", "Pin pictogram": "Request required",
    "Harbour photograph": "Restricted", "Storefront photograph": "Restricted",
    "Rebrand teaser illustration": "Restricted", "Logo 1998": "Retired",
}
AUDIT_KEYS = ["sequence", "occurredAt", "actorId", "actorRole", "action", "resourceType",
              "resourceId", "requestId", "before", "after", "outcome"]
CARD_KEYS = {"assetId", "variantId", "cardName", "classLabel", "licenceName", "badge", "reason",
             "successorName", "canRequest", "requestReason", "openRequestId", "derivatives", "grant"}
CARD_GRANT_KEYS = {"id", "status", "statusLabel", "notBefore", "notAfter", "conditions"}
DERIVATIVE_KEYS = {"id", "fileName", "format", "width", "height"}
GRANT_KEYS = {"id", "status", "statusLabel", "holder", "cardName", "requestId", "notBefore",
              "notAfter", "cap", "conditions", "revokedReason"}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
SWATCHES = [
    ("Ember", "Ember 700", "A3341F", "6.84:1", "AA", "2.63:1", "Fail"),
    ("Ember", "Ember 300", "F2A08C", "2.06:1", "Fail", "8.72:1", "AAA"),
    ("Saffron", "Saffron 700", "9A5B00", "5.43:1", "AA", "3.31:1", "AA Large"),
    ("Saffron", "Saffron 300", "F7C266", "1.63:1", "Fail", "11.01:1", "AAA"),
    ("Meadow", "Meadow 700", "2F6B2A", "6.45:1", "AA", "2.79:1", "Fail"),
    ("Meadow", "Meadow 300", "A9D99A", "1.61:1", "Fail", "11.20:1", "AAA"),
    ("Lagoon", "Lagoon 700", "00666B", "6.75:1", "AA", "2.67:1", "Fail"),
    ("Lagoon", "Lagoon 300", "7FD3D0", "1.73:1", "Fail", "10.39:1", "AAA"),
    ("Harbour", "Harbour 700", "1F4E8C", "8.31:1", "AAA", "2.16:1", "Fail"),
    ("Harbour", "Harbour 300", "9DBDF0", "1.91:1", "Fail", "9.39:1", "AAA"),
    ("Iris", "Iris 700", "5B3A9E", "8.26:1", "AAA", "2.18:1", "Fail"),
    ("Iris", "Iris 300", "C6B2F0", "1.90:1", "Fail", "9.44:1", "AAA"),
    ("Orchid", "Orchid 700", "8E2C77", "7.56:1", "AAA", "2.38:1", "Fail"),
    ("Orchid", "Orchid 300", "EDA8DC", "1.87:1", "Fail", "9.62:1", "AAA"),
    ("Clay", "Clay 700", "7A4A33", "7.36:1", "AAA", "2.44:1", "Fail"),
    ("Clay", "Clay 300", "E0B9A0", "1.81:1", "Fail", "9.95:1", "AAA"),
    ("Moss", "Moss 700", "4F5A1E", "7.46:1", "AAA", "2.41:1", "Fail"),
    ("Moss", "Moss 300", "CFD88E", "1.51:1", "Fail", "11.87:1", "AAA"),
    ("Stone", "Stone 700", "4D4A55", "8.66:1", "AAA", "2.08:1", "Fail"),
    ("Stone", "Stone 300", "C9C6CF", "1.69:1", "Fail", "10.67:1", "AAA"),
]
WHEEL_ORDER = ["Ember", "Saffron", "Meadow", "Lagoon", "Harbour", "Iris", "Orchid", "Clay", "Moss", "Stone"]
SLIDING_PROPS = {"transform", "translate", "top", "left", "right", "bottom"}

SEED_JSON = r"""
{
  "organisations": [
    {"key": "quenby", "name": "Quenby & Co.", "kind": "brand", "territory": "DE"},
    {"key": "lumen", "name": "Studio Lumen", "kind": "agency", "territory": "DE",
     "engagement": {"startsOn": "2026-01-05", "endsOn": "2026-04-15", "territories": ["DE", "AT", "CH"]}},
    {"key": "fathom", "name": "Fathom Collective", "kind": "agency", "territory": "NL",
     "engagement": {"startsOn": "2026-02-01", "endsOn": "2026-12-31", "territories": ["NL", "BE"]}},
    {"key": "brightwell", "name": "Brightwell Agency", "kind": "agency", "territory": "DE",
     "engagement": {"startsOn": "2025-09-01", "endsOn": "2026-03-01", "territories": ["DE"]}},
    {"key": "ledger", "name": "The Morning Ledger", "kind": "press", "territory": "FR"}
  ],
  "principals": [
    {"key": "olu", "email": "olu@quenby.example", "displayName": "Olu Mensah", "role": "owner", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "bea", "email": "bea@quenby.example", "displayName": "Bea Lindqvist", "role": "brand_reviewer", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "cai", "email": "cai@quenby.example", "displayName": "Cai Brennan", "role": "brand_reviewer", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "leo", "email": "leo@quenby.example", "displayName": "Leo Varga", "role": "legal_reviewer", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "ari", "email": "ari@quenby.example", "displayName": "Ari Novak", "role": "author", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "emi", "email": "emi@quenby.example", "displayName": "Emi Takahashi", "role": "employee", "password": "rulehouse-demo-1", "organisation": "quenby"},
    {"key": "ana", "email": "ana@studiolumen.example", "displayName": "Ana Ferreira", "role": "agency", "password": "rulehouse-demo-1", "organisation": "lumen"},
    {"key": "finn", "email": "finn@fathom.example", "displayName": "Finn de Vries", "role": "agency", "password": "rulehouse-demo-1", "organisation": "fathom"},
    {"key": "bram", "email": "bram@brightwell.example", "displayName": "Bram Koster", "role": "agency", "password": "rulehouse-demo-1", "organisation": "brightwell"},
    {"key": "pia", "email": "pia@morningledger.example", "displayName": "Pia Laurent", "role": "press", "password": "rulehouse-demo-1", "organisation": "ledger"}
  ],
  "groups": [
    {"key": "press-list", "name": "Press list", "members": ["pia"]}
  ],
  "licences": [
    {"key": "mark", "name": "Mark licence",
     "permittedApplications": ["internal_comms", "social", "press_article", "event", "film", "packaging", "co_brand", "merchandise", "partnership"],
     "prohibitedApplications": [], "audiences": ["employee", "agency"], "territories": ["worldwide"], "excludedTerritories": [],
     "defaultDurationDays": 90, "modificationPermitted": false, "attributionRequired": false},
    {"key": "general", "name": "General licence",
     "permittedApplications": ["internal_comms", "social", "press_article", "event", "film", "packaging", "co_brand", "partnership"],
     "prohibitedApplications": ["merchandise"], "audiences": ["employee", "agency"], "territories": ["worldwide"], "excludedTerritories": [],
     "defaultDurationDays": 365, "modificationPermitted": true, "attributionRequired": false},
    {"key": "editorial", "name": "Editorial licence",
     "permittedApplications": ["internal_comms", "social", "press_article"],
     "prohibitedApplications": [], "audiences": ["employee", "press"], "territories": ["worldwide"], "excludedTerritories": ["FR"],
     "defaultDurationDays": 30, "modificationPermitted": false, "attributionRequired": true},
    {"key": "press", "name": "Press licence",
     "permittedApplications": ["internal_comms", "press_article"],
     "prohibitedApplications": [], "audiences": ["employee", "press"], "territories": ["worldwide"], "excludedTerritories": [],
     "defaultDurationDays": 30, "modificationPermitted": false, "attributionRequired": true}
  ],
  "assets": [
    {"key": "logo", "name": "Logo", "class": "mark", "state": "released", "licence": "mark", "successor": null, "derivatives": [],
     "variants": [
       {"key": "full_lock", "derivatives": [
         {"fileName": "logo-full-lock.svg", "format": "svg", "width": 800, "height": 320},
         {"fileName": "logo-full-lock-1600.png", "format": "png", "width": 1600, "height": 640}]},
       {"key": "tab", "derivatives": [
         {"fileName": "logo-tab.svg", "format": "svg", "width": 320, "height": 320},
         {"fileName": "logo-tab-512.png", "format": "png", "width": 512, "height": 512}]}]},
    {"key": "logo-1998", "name": "Logo 1998", "class": "mark", "state": "retired", "licence": "mark", "successor": "logo", "variants": [],
     "derivatives": [{"fileName": "logo-1998.png", "format": "png", "width": 600, "height": 240}]},
    {"key": "parcel", "name": "Parcel spot icon", "class": "spot_icon", "state": "released", "licence": "general", "successor": null, "variants": [],
     "derivatives": [{"fileName": "parcel-120.png", "format": "png", "width": 120, "height": 120}]},
    {"key": "courier", "name": "Courier spot icon", "class": "spot_icon", "state": "draft", "licence": "general", "successor": null, "variants": [],
     "derivatives": [{"fileName": "courier-128.png", "format": "png", "width": 128, "height": 128}]},
    {"key": "pin", "name": "Pin pictogram", "class": "pictogram", "state": "released", "licence": "general", "successor": null, "variants": [],
     "derivatives": [{"fileName": "pin-64.png", "format": "png", "width": 64, "height": 64}]},
    {"key": "menu", "name": "Menu UI icon", "class": "ui_icon", "state": "released", "licence": "general", "successor": null, "variants": [],
     "derivatives": [{"fileName": "menu-24.svg", "format": "svg", "width": 24, "height": 24}]},
    {"key": "harbour-photo", "name": "Harbour photograph", "class": "photograph", "state": "released", "licence": "editorial", "successor": null, "variants": [],
     "derivatives": [{"fileName": "harbour-1600.png", "format": "png", "width": 1600, "height": 1067}]},
    {"key": "storefront", "name": "Storefront photograph", "class": "photograph", "state": "released", "licence": "press", "successor": null, "variants": [],
     "derivatives": [{"fileName": "storefront-1600.png", "format": "png", "width": 1600, "height": 1067}]},
    {"key": "rebrand-teaser", "name": "Rebrand teaser illustration", "class": "illustration", "state": "restricted", "licence": "general", "successor": null, "variants": [],
     "derivatives": [{"fileName": "rebrand-teaser-1200.png", "format": "png", "width": 1200, "height": 800}]}
  ],
  "requests": [
    {"key": "r-ana-tab", "requester": "ana", "asset": "logo", "variant": "tab", "applicationClass": "social", "territories": ["DE"],
     "campaignStartsOn": "2026-02-02", "campaignEndsOn": "2026-06-30", "citedRules": ["logo.variants.tab"], "note": "Spring social posts.",
     "state": "granted", "submittedAt": "2026-02-01T09:00:00.000Z", "escalation": null, "conditions": [],
     "stages": [
       {"kind": "brand", "assignee": "bea", "decision": "approve", "decidedAt": "2026-02-02T09:30:00.000Z", "comment": null},
       {"kind": "brand", "assignee": "cai", "decision": "approve", "decidedAt": "2026-02-02T10:00:00.000Z", "comment": null}]},
    {"key": "r-finn-pin", "requester": "finn", "asset": "pin", "variant": null, "applicationClass": "event", "territories": ["NL"],
     "campaignStartsOn": "2026-03-10", "campaignEndsOn": "2026-04-30", "citedRules": ["iconography.pictogram.size"], "note": "Trade fair signage.",
     "state": "granted", "submittedAt": "2026-02-26T10:00:00.000Z", "escalation": null,
     "conditions": [{"kind": "proof_required", "value": null, "addedBy": "bea"}],
     "stages": [{"kind": "brand", "assignee": "bea", "decision": "approve", "decidedAt": "2026-02-27T10:00:00.000Z", "comment": null}]},
    {"key": "r-finn-tab", "requester": "finn", "asset": "logo", "variant": "tab", "applicationClass": "social", "territories": ["NL"],
     "campaignStartsOn": "2026-03-05", "campaignEndsOn": "2026-05-31", "citedRules": ["logo.variants.tab"], "note": "Launch posts.",
     "state": "under_review", "submittedAt": "2026-03-02T07:00:00.000Z", "escalation": null, "conditions": [],
     "stages": [
       {"kind": "brand", "assignee": "cai", "decision": null, "decidedAt": null, "comment": null},
       {"kind": "brand", "assignee": null, "decision": null, "decidedAt": null, "comment": null}]},
    {"key": "r-bram-parcel", "requester": "bram", "asset": "parcel", "variant": null, "applicationClass": "packaging", "territories": ["DE"],
     "campaignStartsOn": "2026-03-01", "campaignEndsOn": "2026-09-30", "citedRules": ["iconography.spot.size"], "note": "Gift box sleeve.",
     "state": "under_review", "submittedAt": "2026-02-28T16:00:00.000Z", "escalation": null, "conditions": [],
     "stages": [{"kind": "brand", "assignee": "bea", "decision": null, "decidedAt": null, "comment": null}]}
  ],
  "grants": [
    {"key": "g-ana-tab", "holder": {"principal": "ana"}, "asset": "logo", "variant": "tab", "request": "r-ana-tab",
     "notBefore": "2026-02-02", "notAfter": "2026-04-15", "status": "active"},
    {"key": "g-finn-parcel", "holder": {"principal": "finn"}, "asset": "parcel", "variant": null, "request": null, "conditions": [],
     "notBefore": "2026-02-10", "notAfter": "2026-08-31", "status": "active"},
    {"key": "g-press-storefront", "holder": {"group": "press-list"}, "asset": "storefront", "variant": null, "request": null, "conditions": [],
     "notBefore": "2026-02-20", "notAfter": "2026-03-21", "status": "active"},
    {"key": "g-finn-pin", "holder": {"principal": "finn"}, "asset": "pin", "variant": null, "request": "r-finn-pin",
     "notBefore": null, "notAfter": "2026-04-30", "status": "pending_proof"}
  ],
  "chapters": [
    {"slug": "logo", "title": "Logo", "versions": [
      {"number": 1, "state": "superseded", "author": "ari", "publishedAt": "2026-01-12T09:00:00.000Z",
       "intro": "The Quenby mark is three stacked trapezoids. It comes in two locks.",
       "statements": [
         {"identifier": "logo.variants.full-lock", "text": "Use the Full lock for partnerships, co-branding and film."},
         {"identifier": "logo.variants.tab", "text": "Use the Tab alone when the symbol starts the layout."},
         {"identifier": "logo.clear-space.half", "text": "Keep clear space of half the symbol height around the mark."}],
       "assets": ["logo", "logo-1998"], "withdrawn": []},
      {"number": 2, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "The Quenby mark is three stacked trapezoids. It comes in two locks, and each lock has its own rules.",
       "statements": [
         {"identifier": "logo.variants.full-lock", "text": "Use the Full lock for partnerships, co-branding and film."},
         {"identifier": "logo.variants.tab", "text": "Use the Tab alone when the symbol starts the layout."},
         {"identifier": "logo.clear-space.minimum", "text": "Keep clear space of at least 1x the symbol height on every side."},
         {"identifier": "logo.colour.no-recolour", "text": "Show the mark in Harbour 700, ink or white only."}],
       "assets": ["logo"], "withdrawn": [{"identifier": "logo.clear-space.half", "replacedBy": "logo.clear-space.minimum"}]}]},
    {"slug": "colour", "title": "Colour", "versions": [
      {"number": 1, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "Ten colour families, each published with its contrast against white and ink.",
       "statements": [
         {"identifier": "colour.contrast.body-text", "text": "Body text meets a contrast of at least 4.5:1 against its ground."},
         {"identifier": "colour.fields.ink", "text": "Text on a 300 field colour is always set in ink."},
         {"identifier": "colour.accent.harbour", "text": "Harbour 700 is the only accent colour."}],
       "assets": [], "withdrawn": []}]},
    {"slug": "typography", "title": "Typography", "versions": [
      {"number": 1, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "Quenby & Co. sets type in the reader's own system face.",
       "statements": [
         {"identifier": "typography.weight.range", "text": "Display type runs from weight 250 to 900; body text sits at 400."},
         {"identifier": "typography.figures.tabular", "text": "Numbers in tables use tabular figures."}],
       "assets": [], "withdrawn": []}]},
    {"slug": "iconography", "title": "Iconography", "versions": [
      {"number": 1, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "Three icon classes, each with a fixed size.",
       "statements": [
         {"identifier": "iconography.spot.size", "text": "Spot icons are 120 x 120 pixels."},
         {"identifier": "iconography.pictogram.size", "text": "Pictograms are 64 x 64 pixels."},
         {"identifier": "iconography.ui.size", "text": "UI icons are 24 x 24 pixels."}],
       "assets": ["parcel", "pin", "menu"], "withdrawn": []},
      {"number": 2, "state": "draft", "author": "ari", "publishedAt": null,
       "intro": "Three icon classes, each with a fixed size, and a new courier icon.",
       "statements": [
         {"identifier": "iconography.spot.size", "text": "Spot icons are 120 x 120 pixels."},
         {"identifier": "iconography.pictogram.size", "text": "Pictograms are 64 x 64 pixels."},
         {"identifier": "iconography.ui.size", "text": "UI icons are 24 x 24 pixels."},
         {"identifier": "iconography.spot.courier", "text": "Use the Courier spot icon for delivery updates."}],
       "assets": ["parcel", "courier", "pin", "menu"], "withdrawn": []}]},
    {"slug": "motion", "title": "Motion", "versions": [
      {"number": 1, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "Things arrive quickly and settle softly.",
       "statements": [
         {"identifier": "motion.curve.panel-open", "text": "Panels open on the standard easing curve with control values 0.30, 0.00, 0.20, 1.00."},
         {"identifier": "motion.timeline.length", "text": "Title sequences finish within 12 seconds."}],
       "assets": [], "withdrawn": []}]},
    {"slug": "voice", "title": "Voice", "versions": [
      {"number": 1, "state": "published", "author": "ari", "publishedAt": "2026-02-02T09:00:00.000Z",
       "intro": "We write the way we would say it across a counter.",
       "statements": [
         {"identifier": "voice.tone.plain", "text": "Write in plain words, one idea per sentence."},
         {"identifier": "voice.name.ampersand", "text": "Write the name as Quenby & Co., with the ampersand."}],
       "assets": [], "withdrawn": []}]}
  ],
  "audit": []
}
"""

EXPECTED_IDS_JSON = r"""
{
  "organisations": {"quenby": "org_quenby", "lumen": "org_lumen", "fathom": "org_fathom", "brightwell": "org_brightwell", "ledger": "org_ledger"},
  "principals": {"olu": "usr_olu", "bea": "usr_bea", "cai": "usr_cai", "leo": "usr_leo", "ari": "usr_ari", "emi": "usr_emi", "ana": "usr_ana", "finn": "usr_finn", "bram": "usr_bram", "pia": "usr_pia"},
  "groups": {"press-list": "grp_press-list"},
  "licences": {"mark": "lic_mark", "general": "lic_general", "editorial": "lic_editorial", "press": "lic_press"},
  "assets": {"logo": "ast_logo", "logo-1998": "ast_logo-1998", "parcel": "ast_parcel", "courier": "ast_courier", "pin": "ast_pin", "menu": "ast_menu", "harbour-photo": "ast_harbour-photo", "storefront": "ast_storefront", "rebrand-teaser": "ast_rebrand-teaser"},
  "variants": {"logo/full_lock": "var_logo_full_lock", "logo/tab": "var_logo_tab"},
  "derivatives": {
    "logo/logo-full-lock.svg": "drv_logo_1", "logo/logo-full-lock-1600.png": "drv_logo_2",
    "logo/logo-tab.svg": "drv_logo_3", "logo/logo-tab-512.png": "drv_logo_4",
    "logo-1998/logo-1998.png": "drv_logo-1998_1", "parcel/parcel-120.png": "drv_parcel_1",
    "courier/courier-128.png": "drv_courier_1", "pin/pin-64.png": "drv_pin_1", "menu/menu-24.svg": "drv_menu_1",
    "harbour-photo/harbour-1600.png": "drv_harbour-photo_1", "storefront/storefront-1600.png": "drv_storefront_1",
    "rebrand-teaser/rebrand-teaser-1200.png": "drv_rebrand-teaser_1"},
  "requests": {"r-ana-tab": "REQ-0001", "r-finn-pin": "REQ-0002", "r-finn-tab": "REQ-0003", "r-bram-parcel": "REQ-0004"},
  "grants": {"g-ana-tab": "GR-0001", "g-finn-parcel": "GR-0002", "g-press-storefront": "GR-0003", "g-finn-pin": "GR-0004"},
  "versions": {"logo/1": "ver_logo_1", "logo/2": "ver_logo_2", "colour/1": "ver_colour_1", "typography/1": "ver_typography_1", "iconography/1": "ver_iconography_1", "iconography/2": "ver_iconography_2", "motion/1": "ver_motion_1", "voice/1": "ver_voice_1"}
}
"""


def seed_body() -> dict[str, Any]:
    return json.loads(SEED_JSON)


def grading_headers() -> dict[str, str]:
    return {"X-Grading-Key": GRADING_KEY}


@dataclass
class World:
    base: str
    cookie_name: str
    sessions: dict[str, str]
    ids: dict[str, Any]
    now: str
    clients: dict[Any, httpx.Client] = field(default_factory=dict)

    def as_(self, who: str | None = None) -> httpx.Client:
        if who not in self.clients:
            cookies = {self.cookie_name: self.sessions[who]} if who else {}
            self.clients[who] = httpx.Client(base_url=self.base, cookies=cookies, timeout=HTTP_TIMEOUT)
        return self.clients[who]

    def clock(self, minutes: int | None = None, to: str | None = None) -> str:
        body: dict[str, Any] = {"advanceMinutes": minutes} if minutes is not None else {"setTo": to}
        r = httpx.post(f"{self.base}/api/grading/clock", json=body, headers=grading_headers(), timeout=HTTP_TIMEOUT)
        assert r.status_code == 200, f"POST /api/grading/clock answered {r.status_code}: {r.text}"
        return r.json()["now"]

    def close(self) -> None:
        for c in self.clients.values():
            c.close()


def reset_and_seed(base: str, body: dict[str, Any] | None = None) -> World:
    r = httpx.post(f"{base}/api/grading/reset", headers=grading_headers(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"POST /api/grading/reset answered {r.status_code}: {r.text}"
    r = httpx.post(f"{base}/api/grading/seed", json=body if body is not None else seed_body(),
                   headers=grading_headers(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"POST /api/grading/seed answered {r.status_code}: {r.text}"
    data = r.json()
    return World(base=base, cookie_name=data["cookieName"], sessions=data["sessions"], ids=data["ids"], now=data["now"])


@pytest.fixture
def world(app_url: str) -> Iterator[World]:
    w = reset_and_seed(app_url.rstrip("/"))
    yield w
    w.close()


def iso_shift(ts: str, **delta: float) -> str:
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00")) + timedelta(**delta)
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def err(r: httpx.Response, status: int, code: str | set[str], message: str | None = None) -> dict[str, Any]:
    assert r.status_code == status, f"expected {status}, got {r.status_code}: {r.text}"
    body = r.json()
    assert set(body) == {"error", "message"}, f"error body keys {sorted(body)}; expected error and message"
    if isinstance(code, set):
        assert body["error"] in code, body
    else:
        assert body["error"] == code, body
    if message is not None:
        assert body["message"] == message, body
    return body


NOT_FOUND = {"error": "not_found", "message": "Not found"}
NEXT_DAY = iso_shift(START, hours=24)[:10]
REQ_NEW = f"REQ-{len(seed_body()['requests']) + 1:04d}"
REQ_NEXT = f"REQ-{len(seed_body()['requests']) + 2:04d}"
REQ_AFTER = f"REQ-{len(seed_body()['requests']) + 3:04d}"
GR_NEW = f"GR-{len(seed_body()['grants']) + 1:04d}"
V_ICON2 = "ver_iconography_2"
OVERRIDE_DATE = "2026-06-01"
REVOKE_REASON = "Engagement scope changed."
CHANGES_COMMENT = "Use the NL territory only."
INVITEE_NAME = "Ines Invitee"
SEARCH_PROBE = "PHOTO"
NO_MATCH_PROBE = "zzz"
PARCEL = "Parcel spot icon"
MENU_ICON = "Menu UI icon"
LOGO_1998 = "Logo 1998"
HARBOUR = "Harbour photograph"
STOREFRONT = "Storefront photograph"
PARCEL_FILE = "parcel-120.png"
PENDING = "Pending review"
REJECTED = "Rejected"
DARK_NAME = "proof-dark.png"
DARK_REASON = "Too dark to check clear space."
ARTWORK_NAME = "artwork.png"
EXACT_NAME = "exact.jpg"


def art(name: str, badge: str) -> str:
    return f"{name}, {badge}"


def sentence(n: int, *active: str) -> str:
    base = "1 asset" if n == 1 else f"{n} assets"
    return base + "".join(f", {a}" for a in active)
PROOF_PREFIX = "proofs/" + "GR-0004" + "/"


def route(*parts: str) -> str:
    return "/api/" + "/".join(parts)


def deriv_key(asset: str, variant: str, name: str) -> str:
    return "/".join(["derivatives", asset, variant, name])


def _berlin(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ZoneInfo("Europe/Berlin"))


def fmt_date(iso: str) -> str:
    dt = _berlin(iso)
    return f"{dt.day} {dt:%b} {dt.year}"


def fmt_time(iso: str) -> str:
    return _berlin(iso).strftime("%H:%M")


def fmt_stamp(iso: str) -> str:
    return f"{fmt_date(iso)} {fmt_time(iso)}"


def png_bytes(width: int, height: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\x00\x00\x00" * width for _ in range(height))
    return PNG_SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def png_size(data: bytes) -> tuple[int, int]:
    assert data[:8] == PNG_SIGNATURE, "served bytes are not a PNG"
    w, h = struct.unpack(">II", data[16:24])
    return w, h


def pdf_bytes() -> bytes:
    return b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def request_body(asset: str, variant: str | None, application: str, territories: list[str], end: str,
                 rules: list[str], start: str = TODAY, key: str | None = None, note: str = "",
                 submit: bool = True) -> dict[str, Any]:
    return {"idempotencyKey": key or idempotency_key(), "assetId": asset, "variantId": variant,
            "applicationClass": application, "territories": list(territories), "campaignStartsOn": start,
            "campaignEndsOn": end, "citedRules": list(rules), "note": note, "submit": submit}


ANA_COBRAND = ("ast_logo", "var_logo_full_lock", "co_brand", ["DE"], "2026-06-30", ["logo.variants.full-lock"])
FINN_MENU = ("ast_menu", None, "social", ["NL"], "2026-12-31", ["iconography.ui.size"])


def create(world: World, who: str, *args: Any, **kw: Any) -> dict[str, Any]:
    r = world.as_(who).post("/api/requests", json=request_body(*args, **kw))
    assert r.status_code == 201, f"POST /api/requests answered {r.status_code}: {r.text}"
    return r.json()


def detail(world: World, who: str, rid: str) -> dict[str, Any]:
    r = world.as_(who).get(f"/api/requests/{rid}")
    assert r.status_code == 200, f"GET /api/requests/{rid} as {who}: {r.status_code} {r.text}"
    return r.json()


def open_stage(d: dict[str, Any]) -> int:
    for s in d["stages"]:
        if s["decision"] is None:
            return s["n"]
    pytest.fail(f"{d['id']} has no undecided stage")


def holder_key(d: dict[str, Any]) -> str:
    return d["holder"]["id"].removeprefix("usr_")


def decide(world: World, who: str, rid: str, n: int, decision: str, comment: str | None = None) -> httpx.Response:
    return world.as_(who).post(f"/api/requests/{rid}/stages/{n}/decision", json={"decision": decision, "comment": comment})


def approve_open(world: World, rid: str) -> dict[str, Any]:
    d = detail(world, "olu", rid)
    who = holder_key(d)
    r = decide(world, who, rid, open_stage(d), "approve")
    assert r.status_code == 200, r.text
    return r.json()


def library(world: World, who: str, params: Any = None) -> dict[str, Any]:
    r = world.as_(who).get("/api/library", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def cards(world: World, who: str) -> dict[str, dict[str, Any]]:
    return {c["cardName"]: c for c in library(world, who)["cards"]}


def audit(world: World, who: str = "olu", **params: str) -> list[dict[str, Any]]:
    r = world.as_(who).get("/api/audit", params=params or None)
    assert r.status_code == 200, r.text
    return r.json()["records"]


def upload_proof(world: World, who: str, grant: str, name: str, data: bytes, mime: str = "image/png") -> httpx.Response:
    return world.as_(who).post(f"/api/grants/{grant}/proofs", files={"file": (name, data, mime)})


def canonical(rec: dict[str, Any]) -> str:
    parts = []
    for k in AUDIT_KEYS:
        parts.append(json.dumps(k) + ":" + json.dumps(rec[k], sort_keys=True, separators=(",", ":"), ensure_ascii=False))
    return "{" + ",".join(parts) + "}"


def record_hash(previous: str, rec: dict[str, Any]) -> str:
    return hashlib.sha256((previous + "\n" + canonical(rec)).encode("utf-8")).hexdigest()


def together(*calls: Callable[[], Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls))
    results: list[Any] = [None] * len(calls)

    def run(i: int, fn: Callable[[], Any]) -> None:
        barrier.wait(timeout=HTTP_TIMEOUT)
        results[i] = fn()

    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=HTTP_TIMEOUT)
    assert all(r is not None for r in results), "a concurrent call never answered"
    return results


def matching(messages: list[dict[str, Any]], address: str, subject: str) -> list[dict[str, Any]]:
    out = []
    for m in messages:
        to = [a.lower() for a in addresses(m.get("To"))]
        if address.lower() in to and m.get("Subject") == subject:
            out.append(m)
    return out


def mail_to(mail: Any, address: str, subject: str, expected: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    found: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        found = matching(mail.messages(0, settle=MAIL_POLL_S), address, subject)
        if len(found) >= expected:
            return found
    pytest.fail(f"Mailpit holds {len(found)} message(s) to {address} with subject {subject!r}; expected {expected}")


def quiet_mail(mail: Any, address: str, subject: str) -> list[dict[str, Any]]:
    return matching(mail.messages(0, settle=MAIL_QUIET_S), address, subject)


@contextmanager
def browse(browser: Browser, world: World, who: str | None = None, path: str = "/",
           size: tuple[int, int] = DESKTOP, reduced: str = "no-preference",
           device_clock: str | None = None) -> Iterator[Page]:
    with open_app(browser, world.base + "/rules", reduced_motion=reduced) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if device_clock is not None:
            page.clock.set_fixed_time(device_clock)
        if who is not None:
            page.context.add_cookies([{"name": world.cookie_name, "value": world.sessions[who], "url": world.base}])
        page.goto(world.base + path)
        yield page


def eventually(page: Page | None, check: Callable[[], Any], what: str, seconds: float = UI_WAIT_S) -> float:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            check()
            return time.monotonic()
        except AssertionError as exc:
            last = exc
            if page is not None:
                advance(page, STEP_MS)
    pytest.fail(f"{what} (last failure: {last})")


def live(page: Page, check: Callable[[], Any], what: str) -> None:
    eventually(page, check, f"{what} within {LIVE_S} s over the live channel", seconds=LIVE_S + LIVE_SLACK_S)


def page_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Page status")


def wait_status(page: Page, copy_text: str) -> None:
    eventually(page, lambda: expect(page_status(page)).to_have_text(copy_text, timeout=POLL_MS),
               f"status \"Page status\" never read {copy_text!r}")


def wait_url(page: Page, pattern: str) -> None:
    eventually(page, lambda: expect(page).to_have_url(re.compile(pattern), timeout=POLL_MS),
               f"browser never reached a URL matching {pattern}")


def focus_inside(container: Locator) -> bool:
    return bool(container.evaluate("c => c.contains(document.activeElement)"))


def box(locator: Locator) -> dict[str, float]:
    b = locator.bounding_box()
    assert b is not None, f"{locator} has no layout box"
    return b


def safe_box(locator: Locator) -> dict[str, float] | None:
    try:
        return locator.bounding_box(timeout=POLL_MS)
    except Exception:
        return None


def visible_width(b: dict[str, float] | None, viewport_width: float) -> float:
    if b is None:
        return 0.0
    return max(0.0, min(b["x"] + b["width"], viewport_width) - max(b["x"], 0.0))


OPACITY_JS = """el => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; }"""
ANIMS_JS = """root => (root.getAnimations ? root.getAnimations({subtree: true}) : (document.getAnimations ? document.getAnimations() : [])).map(a => {
  const props = new Set();
  const kf = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
  for (const f of kf) for (const k of Object.keys(f)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k);
  if (a.transitionProperty) props.add(a.transitionProperty);
  const t = a.effect ? a.effect.getComputedTiming() : {};
  return {props: Array.from(props), duration: Number(t.duration) || 0};
})"""
PAGE_ANIMS_JS = """() => document.getAnimations().map(a => {
  const props = new Set();
  const kf = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
  for (const f of kf) for (const k of Object.keys(f)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k);
  if (a.transitionProperty) props.add(a.transitionProperty);
  return Array.from(props);
})"""
GLYPH_JS = """a => { const r = a.getBoundingClientRect();
  const g = Array.from(a.getElementsByTagName('svg')).map(s => s.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0)
    .sort((x, y) => y.width * y.height - x.width * x.height)[0];
  return {tile: {x: r.x, y: r.y, w: r.width, h: r.height}, glyph: g ? {x: g.x, y: g.y, w: g.width, h: g.height} : null}; }"""


def opacity(locator: Locator) -> float:
    return float(locator.evaluate(OPACITY_JS))


def scroll_to(page: Page, y: int) -> None:
    page.evaluate("y => window.scrollTo(0, y)", y)
    advance(page, SCRUB_SETTLE_MS)


def monotone(values: list[float], rising: bool, what: str, tol: float = 1.0) -> None:
    for a, b in zip(values, values[1:]):
        if rising:
            assert b >= a - tol, f"{what} moved backwards: {values}"
        else:
            assert b <= a + tol, f"{what} moved backwards: {values}"


def near(value: float, target: float, what: str) -> None:
    assert target * (1 - ABOUT) <= value <= target * (1 + ABOUT), f"{what} is {value:.0f} px; expected about {target} px"


def touch_drag(page: Page, start: tuple[float, float], end: tuple[float, float], steps: int = 8) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": start[0], "y": start[1]}]})
    for i in range(1, steps + 1):
        x = start[0] + (end[0] - start[0]) * i / steps
        y = start[1] + (end[1] - start[1]) * i / steps
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def release_gate(gate: Any) -> None:
    if hasattr(gate, "release"):
        gate.release()
    else:
        gate()


def test_health_reports_ok(app_url: str) -> None:
    r = httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == {"status": "ok"}


def test_grading_routes_and_app_clock(world: World) -> None:
    base = world.base
    for path, body in (("/api/grading/reset", None), ("/api/grading/seed", seed_body()),
                       ("/api/grading/clock", {"advanceMinutes": 1}),
                       ("/api/grading/audit/tamper", {"sequence": 1, "after": {}})):
        missing = httpx.post(base + path, json=body, timeout=HTTP_TIMEOUT)
        assert missing.status_code == 404 and missing.json() == NOT_FOUND, f"{path} without key: {missing.text}"
        wrong = httpx.post(base + path, json=body, headers={"X-Grading-Key": "not-the-key"}, timeout=HTTP_TIMEOUT)
        assert wrong.status_code == 404 and wrong.json() == NOT_FOUND, f"{path} with wrong key: {wrong.text}"

    assert world.ids == json.loads(EXPECTED_IDS_JSON)
    assert world.cookie_name == "rulehouse_session"
    assert world.now == START
    me = world.as_("finn").get("/api/me")
    assert me.status_code == 200 and me.json()["principal"]["id"] == "usr_finn"

    err(httpx.post(base + "/api/grading/seed", json=seed_body(), headers=grading_headers(), timeout=HTTP_TIMEOUT),
        409, "seed_conflict", "Reset before seeding.")

    assert world.clock(minutes=90) == iso_shift(START, minutes=90)
    before_midnight = iso_shift(START, hours=14, minutes=59)
    assert world.clock(to=before_midnight) == before_midnight
    me = world.as_("emi").get("/api/me").json()
    assert me["today"] == TODAY and me["now"] == before_midnight
    assert me["timeZone"] == "Europe/Berlin" and me["weightAnnounceDelayMs"] == WEIGHT_DELAY_MS
    world.clock(minutes=1)
    me = world.as_("emi").get("/api/me").json()
    assert me["today"] == NEXT_DAY, "the business date must follow Europe/Berlin, not UTC"

    r = httpx.post(base + "/api/grading/reset", headers=grading_headers(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"now": START}
    err(world.as_("emi").get("/api/me"), 401, "unauthenticated")
    err(httpx.post(base + "/api/session", json={"email": "olu@quenby.example", "password": "rulehouse-demo-1"},
                   timeout=HTTP_TIMEOUT), 422, "invalid_credentials")
    bad = seed_body()
    bad["principals"][0]["key"] = "Not A Key"
    err(httpx.post(base + "/api/grading/seed", json=bad, headers=grading_headers(), timeout=HTTP_TIMEOUT), 422, "seed_invalid")
    reseeded = reset_and_seed(base)
    assert reseeded.now == START
    reseeded.close()


def test_wf_cross_cutting_signin(browser: Browser, world: World) -> None:
    base = world.base
    r = httpx.post(base + "/api/session", json={"email": "emi@quenby.example", "password": "rulehouse-demo-1"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    assert r.json()["principal"] == {"id": "usr_emi", "displayName": "Emi Takahashi", "role": "employee", "organisationId": "org_quenby"}
    cookie_header = r.headers.get("set-cookie", "")
    assert cookie_header.startswith("rulehouse_session=")
    assert "HttpOnly".lower() in cookie_header.lower() and "SameSite=Lax".lower() in cookie_header.lower()
    err(httpx.post(base + "/api/session", json={"email": "emi@quenby.example", "password": "wrong-password-0"},
                   timeout=HTTP_TIMEOUT), 422, "invalid_credentials", "Email or password is incorrect.")
    value = r.cookies.get("rulehouse_session")
    with httpx.Client(base_url=base, cookies={"rulehouse_session": value}, timeout=HTTP_TIMEOUT) as c:
        assert c.get("/api/me").status_code == 200
        assert c.delete("/api/session").status_code == 204
        err(c.get("/api/me"), 401, "unauthenticated", "Sign in to continue.")

    with browse(browser, world, path="/library") as anon:
        wait_url(anon, r"/signin$")

    with browse(browser, world, path="/signin") as page:
        fill(page.get_by_role("textbox", name="Email"), "emi@quenby.example")
        fill(page.get_by_label("Password", exact=True), "wrong-password-0")
        click(page.get_by_role("button", name="Sign in"))
        eventually(page, lambda: expect(page.get_by_role("alert").filter(has_text="Email or password is incorrect.")).to_be_visible(timeout=POLL_MS),
                   "wrong password never showed the invalid_credentials alert")
        fill(page.get_by_label("Password", exact=True), "rulehouse-demo-1")
        with held(page, "**/api/session") as gate:
            click(page.get_by_role("button", name="Sign in"))
            expect(page.get_by_role("button", name="Signing in")).to_be_disabled()
            release_gate(gate)
        eventually(page, lambda: expect(page).not_to_have_url(re.compile(r"/signin$"), timeout=POLL_MS), "sign-in never left /signin")
        assert page.request.get(base + "/api/me").status == 200
        page.goto(base + "/library")
        sign_out = page.get_by_role("button", name="Sign out")
        expect(sign_out).to_be_visible()
        click(sign_out)
        eventually(page, lambda: _assert_status(page.request.get(base + "/api/me").status, 401), "sign-out did not end the session")


def _assert_status(actual: int, expected: int) -> None:
    assert actual == expected, f"status {actual}; expected {expected}"


def test_wf_cross_cutting_invitation(browser: Browser, world: World, mail: Any) -> None:
    mail.clear()
    email = f"invitee-{uuid.uuid4().hex[:8]}@fathom.example"
    olu = world.as_("olu")
    err(olu.post("/api/invitations", json={"email": "ana@studiolumen.example", "displayName": "Ana Again", "role": "agency",
                                           "organisationId": "org_lumen"}), 409, "already_registered", "ana@studiolumen.example already has an account.")
    err(olu.post("/api/invitations", json={"email": "not-an-email", "displayName": "Nobody", "role": "agency",
                                           "organisationId": "org_fathom"}), 422, "email_invalid", "Enter a valid email address.")
    r = olu.post("/api/invitations", json={"email": email, "displayName": INVITEE_NAME, "role": "agency", "organisationId": "org_fathom"})
    assert r.status_code == 201, r.text
    assert r.json()["email"] == email
    msg = mail_to(mail, email, "Your Rulehouse invitation")[0]
    assert mail_from_address() in addresses(msg.get("From"))
    body = text(msg)
    expiry = iso_shift(START, hours=INVITE_TTL_H)
    assert f"This link works once and expires on {fmt_date(expiry)} at {fmt_time(expiry)}." in body
    match = re.search(r"/activate/([^\s]+)", body)
    assert match, "invitation mail carries no /activate/<token> link"
    token = match.group(1).rstrip(".")
    info = httpx.get(f"{world.base}/api/invitations/{token}", timeout=HTTP_TIMEOUT)
    assert info.status_code == 200 and info.json() == {"email": email, "displayName": INVITEE_NAME}
    err(httpx.post(f"{world.base}/api/invitations/{token}/activate", json={"password": "short-pass"}, timeout=HTTP_TIMEOUT),
        422, "weak_password", "Password must be at least 12 characters.")

    with browse(browser, world, path=f"/activate/{token}") as page:
        expect(page.get_by_role("heading", level=1, name="Activate your account")).to_be_visible()
        fill(page.get_by_label("Password", exact=True), "activation-pass-1")
        click(page.get_by_role("button", name="Activate account"))
        wait_url(page, r"/library$")
        expect(page.get_by_role("button", name="Sign out")).to_be_visible()
        me = page.request.get(world.base + "/api/me").json()
        assert me["principal"]["role"] == "agency" and me["principal"]["organisationId"] == "org_fathom"
        page.goto(f"{world.base}/activate/{token}")
        expect(page.get_by_text("This invitation link is no longer valid.")).to_be_visible()
    err(httpx.get(f"{world.base}/api/invitations/{token}", timeout=HTTP_TIMEOUT), 410, "invitation_invalid",
        "This invitation link is no longer valid.")

    later = f"late-{uuid.uuid4().hex[:8]}@fathom.example"
    assert olu.post("/api/invitations", json={"email": later, "displayName": "Lou Late", "role": "press",
                                              "organisationId": "org_ledger"}).status_code == 201
    late_token = re.search(r"/activate/([^\s]+)", text(mail_to(mail, later, "Your Rulehouse invitation")[0])).group(1).rstrip(".")
    world.clock(minutes=INVITE_TTL_H * 60 + 1)
    err(httpx.get(f"{world.base}/api/invitations/{late_token}", timeout=HTTP_TIMEOUT), 410, "invitation_invalid")
    assert quiet_mail(mail, "ana@studiolumen.example", "Your Rulehouse invitation") == [], "a refused invitation still mailed"


def test_error_order_and_shape(world: World) -> None:
    anon = world.as_(None)
    err(anon.get("/api/requests/REQ-9999"), 401, "unauthenticated", "Sign in to continue.")
    err(anon.post(route("requests", "REQ-0004", "stages", "1", "decision"), json={"decision": "approve", "comment": None}), 401, "unauthenticated")
    hidden = decide(world, "finn", "REQ-0004", 1, "approve")
    unknown = decide(world, "finn", "REQ-9999", 1, "approve")
    assert hidden.status_code == unknown.status_code == 404 and hidden.json() == unknown.json() == NOT_FOUND
    err(decide(world, "leo", "REQ-0004", 1, "reject", None), 403, "not_stage_holder", "Only Bea Lindqvist or an owner can decide this stage.")
    err(decide(world, "olu", "REQ-0001", 1, "reject", None), 409, {"already_decided", "wrong_state"})
    err(decide(world, "bea", "REQ-0004", 1, "reject", None), 422, "reason_required", "Give a reason.")
    err(world.as_("bea").post("/api/requests/REQ-0004/stages/1/decision", content=b"{not json",
                              headers={"content-type": "application/json"}), 422, "invalid_body", "Request body is not valid JSON.")
    assert detail(world, "olu", "REQ-0004")["state"] == "under_review"
    bad = request_body("ast_menu", None, "social", ["FR"], "2026-03-05", ["iconography.ui.size"], start="2026-03-10")
    err(world.as_("ana").post("/api/requests", json=bad), 422, "territory_invalid",
        "Territories must be within your engagement: DE, AT, CH.")
    def padded(total: int) -> bytes:
        base_obj = {"email": "emi@quenby.example", "password": "rulehouse-demo-1", "pad": ""}
        raw = json.dumps(base_obj, separators=(",", ":"))
        base_obj["pad"] = "x" * (total - len(raw))
        out = json.dumps(base_obj, separators=(",", ":")).encode()
        assert len(out) == total
        return out
    exact = anon.post("/api/session", content=padded(BODY_LIMIT), headers={"content-type": "application/json"})
    assert exact.status_code == 200, f"a body of exactly {BODY_LIMIT} bytes must be accepted: {exact.status_code}"
    err(anon.post("/api/session", content=padded(BODY_LIMIT + 1), headers={"content-type": "application/json"}),
        413, "too_large", "Request body is too large.")
    err(world.as_("emi").delete("/api/session", headers={"Origin": "http://elsewhere.example"}),
        403, "cross_origin", "Requests must come from this site.")
    assert world.as_("emi").get("/api/me").status_code == 200


def test_invisible_resources_answer_not_found(browser: Browser, world: World) -> None:
    proof = upload_proof(world, "finn", "GR-0004", "fair-proof.png", png_bytes(8, 8))
    assert proof.status_code == 201, proof.text
    pid = proof.json()["id"]
    probes = [
        ("finn", "/api/requests/REQ-0001"), ("ana", "/api/requests/REQ-0003"), ("emi", "/api/requests/REQ-0001"),
        ("finn", "/api/grants/GR-0001"), ("bram", "/api/grants/GR-0004"), ("ana", f"/api/proofs/{pid}/content"),
        ("emi", route("versions", V_ICON2)), ("leo", route("versions", V_ICON2)),
        ("ana", "/api/queue"), ("emi", "/api/queue"), ("ari", "/api/queue"),
        ("ana", "/api/admin/assets"), ("leo", "/api/admin/assets"),
        ("bea", "/api/audit"), ("ana", "/api/audit/verify"),
        ("finn", "/api/requests/REQ-9999"), ("finn", "/api/grants/GR-9999"),
    ]
    for who, path in probes:
        r = world.as_(who).get(path)
        assert r.status_code == 404 and r.json() == NOT_FOUND, f"GET {path} as {who}: {r.status_code} {r.text}"
    r = world.as_("ana").post("/api/audit", json={})
    assert r.status_code == 404 and r.json() == NOT_FOUND
    hidden_asset = world.as_("ana").post("/api/requests", json=request_body("ast_nowhere", None, "social", ["DE"], "2026-04-01",
                                                                           ["logo.variants.tab"]))
    assert hidden_asset.status_code == 404 and hidden_asset.json() == NOT_FOUND
    assert world.as_("bea").get(f"/api/proofs/{pid}/content").status_code == 200
    assert world.as_("ari").get(route("versions", V_ICON2)).status_code == 200

    for who, path in (("ana", "/queue"), ("leo", "/admin/assets"), ("emi", "/admin/audit"), ("bea", "/admin/grants"),
                      ("finn", "/requests/REQ-0001")):
        with browse(browser, world, who=who, path=path) as page:
            expect(page.get_by_role("heading", level=1, name="Not found")).to_be_visible()
    with browse(browser, world, who="leo", path="/admin/audit") as page:
        expect(page.get_by_role("table", name="Audit log")).to_be_visible()


ROLE_CASES = {
    "invite": {"who": "ana", "method": "POST", "path": "/api/invitations", "status": 403, "codes": {"forbidden"}, "audited": False,
               "json": {"email": "role-probe@fathom.example", "displayName": "Role Probe", "role": "agency", "organisationId": "org_fathom"}},
    "engagement": {"who": "bea", "method": "PUT", "path": "/api/organisations/org_lumen/engagement", "status": 403,
                   "codes": {"forbidden"}, "audited": False, "json": {"endsOn": "2026-05-01"}},
    "add_derivative": {"who": "emi", "method": "POST", "path": "/api/assets/ast_courier/derivatives", "status": 403,
                       "codes": {"forbidden"}, "audited": False, "file": True, "asset": ("ast_courier", "draft")},
    "remove_derivative": {"who": "ana", "method": "DELETE", "path": "/api/derivatives/drv_courier_1", "status": 403,
                          "codes": {"forbidden"}, "audited": False, "asset": ("ast_courier", "draft")},
    "release": {"who": "bea", "method": "POST", "path": "/api/assets/ast_courier/release", "status": 403, "codes": {"forbidden"},
                "audited": True, "asset": ("ast_courier", "draft")},
    "restrict": {"who": "leo", "method": "POST", "path": "/api/assets/ast_parcel/restrict", "status": 403, "codes": {"forbidden"},
                 "audited": True, "asset": ("ast_parcel", "released")},
    "retire": {"who": "cai", "method": "POST", "path": "/api/assets/ast_parcel/retire", "status": 403, "codes": {"forbidden"},
               "audited": True, "json": {"successorAssetId": "ast_pin"}, "asset": ("ast_parcel", "released")},
    "revoke": {"who": "ana", "method": "POST", "path": "/api/grants/GR-0001/revoke", "status": 403, "codes": {"forbidden"},
               "audited": True, "json": {"reason": "Self revoke attempt."}},
    "decide": {"who": "finn", "method": "POST", "path": "/api/requests/REQ-0003/stages/1/decision", "status": 403,
               "codes": {"forbidden", "not_stage_holder"}, "audited": True, "json": {"decision": "approve", "comment": None}},
    "condition": {"who": "finn", "method": "POST", "path": "/api/requests/REQ-0003/conditions", "status": 403,
                  "codes": {"forbidden", "not_stage_holder"}, "audited": True, "json": {"kind": "no_recolour", "value": None}},
    "proof_accept": {"who": "finn", "method": "POST", "path": "/api/proofs/{proof}/accept", "status": 403, "codes": {"forbidden"},
                     "audited": False, "setup": "proof"},
    "create_request": {"who": "emi", "method": "POST", "path": "/api/requests", "status": 403, "codes": {"forbidden"},
                       "audited": False, "json": {"idempotencyKey": "role-probe-key", "assetId": "ast_menu", "variantId": None,
                                                  "applicationClass": "social", "territories": ["DE"], "campaignStartsOn": "2026-03-02",
                                                  "campaignEndsOn": "2026-04-01", "citedRules": ["iconography.ui.size"], "note": "",
                                                  "submit": True}},
    "start_version": {"who": "bea", "method": "POST", "path": "/api/chapters/voice/versions", "status": 403, "codes": {"forbidden"},
                      "audited": True},
    "approve_version": {"who": "ari", "method": "POST", "path": "/api/versions/ver_iconography_2/approve", "status": 403,
                        "codes": {"forbidden"}, "audited": True},
    "publish": {"who": "bea", "method": "POST", "path": "/api/versions/ver_logo_2/publish", "status": 403, "codes": {"forbidden"},
                "audited": True},
    "republish": {"who": "ari", "method": "POST", "path": "/api/chapters/logo/republish", "status": 403, "codes": {"forbidden"},
                  "audited": True, "json": {"version": 1}},
    "link_issue": {"who": "pia", "method": "POST", "path": "/api/derivatives/drv_harbour-photo_1/link", "status": 403,
                   "codes": {"download_not_allowed"}, "message": "Not licensed in FR.", "audited": True},
    "invisible_version": {"who": "leo", "method": "POST", "path": "/api/versions/ver_iconography_2/approve", "status": 404,
                          "codes": {"not_found"}, "audited": False, "setup": "submit_version"},
    "invisible_grant": {"who": "finn", "method": "POST", "path": "/api/grants/GR-0001/proofs", "status": 404,
                        "codes": {"not_found"}, "audited": False, "file": True},
}


@pytest.mark.parametrize("case", list(ROLE_CASES), ids=list(ROLE_CASES))
def test_role_table_refusals(world: World, case: str) -> None:
    spec = ROLE_CASES[case]
    who = spec["who"]
    path = spec["path"]
    if spec.get("setup") == "proof":
        up = upload_proof(world, "finn", "GR-0004", "role-proof.png", png_bytes(8, 8))
        assert up.status_code == 201, up.text
        path = path.format(proof=up.json()["id"])
    if spec.get("setup") == "submit_version":
        assert world.as_("ari").post(route("versions", V_ICON2, "submit")).status_code == 200
    kwargs: dict[str, Any] = {}
    if "json" in spec:
        kwargs["json"] = spec["json"]
    if spec.get("file"):
        kwargs["files"] = {"file": ("probe-120.png", png_bytes(120, 120), "image/png")}
    r = world.as_(who).request(spec["method"], path, **kwargs)
    codes = spec["codes"]
    body = err(r, spec["status"], codes if len(codes) > 1 else next(iter(codes)), spec.get("message"))
    if spec["status"] == 403 and body["error"] == "forbidden":
        assert body["message"] == "You can't do that."
    if "asset" in spec:
        asset_id, state = spec["asset"]
        assets = {a["id"]: a for a in world.as_("olu").get("/api/admin/assets").json()["assets"]}
        assert assets[asset_id]["state"] == state, f"a refused call changed {asset_id}"
    mine = [rec for rec in audit(world) if rec["actorId"] == f"usr_{who}"]
    if spec["status"] == 404:
        assert mine == [], f"a 404 wrote audit records: {mine}"
    elif spec["audited"]:
        denied = [rec for rec in mine if rec["outcome"] == "denied"]
        assert len(denied) == 1, f"expected one denied record for {who}, got {mine}"
        assert denied[0]["before"] is None and denied[0]["after"] is None


def test_rulebook_assembly_scrubs_with_scroll(browser: Browser, world: World) -> None:
    w, h = DESKTOP
    with browse(browser, world, path="/", size=DESKTOP) as page:
        heading = page.get_by_role("heading", level=1, include_hidden=True).first
        card = page.get_by_role("region", name="Brand promise")
        statement = card.get_by_text(re.compile(r"Every colour"))

        def shown(loc: Locator) -> float:
            if loc.count() == 0:
                return 0.0
            return float(loc.first.evaluate(
                """el => { const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return 0;
                  let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n);
                    if (s.display === 'none' || s.visibility === 'hidden') return 0; o *= parseFloat(s.opacity); } return o; }"""))
        nav = page.get_by_role("navigation", name="Chapters")
        colour = nav.get_by_role("link", name="Colour", exact=True)
        logo = nav.get_by_role("link", name="Logo", exact=True)

        def measure(p: float) -> dict[str, float]:
            scroll_to(page, round(STAGE_PX * p))
            cb = safe_box(card)
            run_js = """([rgb, fromRight]) => { const W = window.innerWidth, H = window.innerHeight; let n = 0;
              for (let i = 0; i < W; i += 2) { const x = fromRight ? W - 1 - i : i; let el = document.elementFromPoint(x, H / 2); let hit = false;
                for (; el; el = el.parentElement) { if (getComputedStyle(el).backgroundColor === rgb) { hit = true; break; } }
                if (!hit) break; n += 2; } return n; }"""
            to_rgb = lambda h: f"rgb({int(h[0:2], 16)}, {int(h[2:4], 16)}, {int(h[4:6], 16)})"
            saffron_300, lagoon_300 = to_rgb(SWATCHES[3][2]), to_rgb(SWATCHES[7][2])
            return {"p": p, "heading": shown(heading), "statement": shown(statement) if p >= 0.25 else 1.0,
                    "card": cb["width"] if cb else 0.0, "cardcx": (cb["x"] + cb["width"] / 2) if cb else -1.0,
                    "colour": float(page.evaluate(run_js, [saffron_300, False])),
                    "logo": float(page.evaluate(run_js, [lagoon_300, True]))}

        forward = [measure(p) for p in (0.0, 0.1, 0.2, 0.25, 0.35, 0.5, 0.6, 0.75, 0.85, 0.95)]
        by = {m["p"]: m for m in forward}
        assert by[0.0]["heading"] >= 0.9, "the opening statement must be visible at progress 0"
        assert by[0.2]["heading"] <= 0.1, "the opening statement must be faded out by progress 0.2"
        monotone([m["heading"] for m in forward if m["p"] <= 0.2], False, "opening statement opacity", tol=0.02)
        near(by[0.35]["card"], CARD_PX, "brand promise card at progress 0.35")
        assert abs(by[0.35]["cardcx"] - w / 2) <= w * 0.05, "the card must sit centred on the pinned stage"
        assert by[0.35]["statement"] >= 0.9 and by[0.75]["statement"] <= 0.1, "the card drops its statement by 0.75"
        near(by[0.75]["card"], CARD_SHRUNK_PX, "brand promise card at progress 0.75")
        near(by[0.25]["colour"], FIELD_START_PX + (FIELD_MID_PX - FIELD_START_PX) / 6, "Colour field at progress 0.25")
        near(by[0.5]["colour"], FIELD_MID_PX, "Colour field at progress 0.5")
        near(by[0.5]["logo"], FIELD_MID_PX, "Logo field at progress 0.5")
        near(by[0.75]["colour"], FIELD_WIDE_PX, "Colour field at progress 0.75")
        steps = [m for m in forward if 0.25 <= m["p"] <= 0.95]
        monotone([m["card"] for m in steps], False, "card width while scrolling down")
        monotone([m["colour"] for m in forward if 0.2 <= m["p"] <= 0.75], True, "Colour field width while scrolling down")
        monotone([m["logo"] for m in forward if 0.2 <= m["p"] <= 0.75], True, "Logo field width while scrolling down")

        scroll_to(page, STAGE_PX)
        for label in TILES:
            b = box(nav.get_by_role("link", name=label, exact=True))
            assert b["x"] >= -1 and b["y"] >= -1 and b["x"] + b["width"] <= w + 1 and b["y"] + b["height"] <= h + 1, \
                f"tile {label} is outside the viewport at progress 1"

        backward = [measure(p) for p in (0.95, 0.85, 0.75, 0.6, 0.5, 0.35, 0.25, 0.2, 0.0)]
        monotone([m["card"] for m in backward if 0.25 <= m["p"] <= 0.95], True, "card width while scrolling back")
        monotone([m["colour"] for m in backward if 0.2 <= m["p"] <= 0.75], False, "Colour field width while scrolling back")
        assert backward[-1]["heading"] >= 0.9, "scrolling back to the top must restore the opening statement"


STACK_CASES = {"reduced-desktop": (DESKTOP, "reduce"), "phone": (PHONE, "no-preference")}


@pytest.mark.parametrize("case", ["reduced-desktop", "phone"], ids=["reduced-desktop", "phone"])
def test_reduced_motion_and_phone_stacking(browser: Browser, world: World, case: str) -> None:
    size, reduced = STACK_CASES[case]
    with browse(browser, world, path="/", size=size, reduced=reduced) as page:
        heading = page.get_by_role("heading", level=1, name=OPENING)
        card = page.get_by_role("region", name="Brand promise")
        nav = page.get_by_role("navigation", name="Chapters")

        def doc_y(loc: Locator) -> float:
            return box(loc)["y"] + float(page.evaluate("() => window.scrollY"))

        before = [doc_y(x) for x in (heading, card, nav)]
        assert before[0] < before[1] < before[2], f"sections are not stacked in order: {before}"
        page.evaluate("() => window.scrollTo(0, 300)")
        advance(page, STEP_MS)
        after = [doc_y(x) for x in (heading, card, nav)]
        for a, b in zip(before, after):
            assert abs(a - b) <= 2, "a section stayed fixed or sticky while scrolling"

        nav.scroll_into_view_if_needed()
        start_box = box(nav)
        anims = nav.evaluate(ANIMS_JS)
        for a in anims:
            assert set(a["props"]) <= {"opacity"}, f"section entrance animates {a['props']}; only opacity is allowed"
            assert a["duration"] <= FADE_MAX_MS, f"section fade lasts {a['duration']} ms"
        settle(nav)
        end_box = box(nav)
        assert abs(start_box["x"] - end_box["x"]) <= 1 and abs(start_box["y"] - end_box["y"]) <= 1, "the section slid into place"
        assert opacity(nav) >= 0.99
        page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        advance(page, STEP_MS)
        for props in page.evaluate(PAGE_ANIMS_JS):
            assert not (set(props) & SLIDING_PROPS), f"a sliding animation ran: {props}"

        page.evaluate("() => window.scrollTo(0, 0)")
        cue = page.get_by_role("button", name="Jump to chapters")
        cue.focus()
        page.keyboard.press("Enter")
        logo = nav.get_by_role("link", name="Logo", exact=True)
        eventually(page, lambda: expect(logo).to_be_focused(timeout=POLL_MS), "Jump to chapters did not focus the Logo tile")


BREAKPOINT_CASES = {"375": PHONE, "768": TABLET, "1280": DESKTOP}


def _cluster(values: list[float], tol: float = 2.0) -> int:
    out: list[float] = []
    for v in sorted(values):
        if not out or v - out[-1] > tol:
            out.append(v)
    return len(out)


@pytest.mark.parametrize("width_id", ["375", "768", "1280"], ids=["375", "768", "1280"])
def test_published_breakpoint_layouts(browser: Browser, world: World, width_id: str) -> None:
    size = BREAKPOINT_CASES[width_id]
    desktop = size[0] >= TABLET[0]
    with browse(browser, world, path="/", size=size, reduced="reduce") as page:
        layout(page)
        nav = page.get_by_role("navigation", name="Chapters")
        links = {t: nav.get_by_role("link", name=t, exact=True) for t in TILES}
        boxes = {t: box(l) for t, l in links.items()}
        x = {t: b["x"] for t, b in boxes.items()}
        y = {t: b["y"] for t, b in boxes.items()}

        def same(a: float, b: float) -> bool:
            return abs(a - b) <= 2

        if desktop:
            assert _cluster(list(x.values())) == 4, f"expected four mosaic columns, got lefts {x}"
            for a, b in (("Logo", "Iconography"), ("Voice", "Motion"), ("Colour", "Library"), ("Typography", "Rule index")):
                assert same(x[a], x[b]), f"{a} and {b} must share a column"
            assert x["Logo"] < x["Voice"] < x["Colour"] < x["Typography"]
            assert same(y["Logo"], y["Voice"]) and same(y["Voice"], y["Colour"]) and same(y["Colour"], y["Typography"])
            assert same(y["Iconography"], y["Motion"]) and same(y["Motion"], y["Library"])
            assert y["Rule index"] > y["Typography"] + 2 and y["Iconography"] > y["Logo"] + 2
            top_limit, col = boxes["Voice"]["y"] + boxes["Voice"]["height"], boxes["Voice"]
        else:
            assert _cluster(list(x.values())) == 2, f"expected two mosaic columns, got lefts {x}"
            for a in ("Colour", "Iconography", "Library"):
                assert same(x[a], x["Logo"]), f"{a} must sit in the first phone column"
            for a in ("Typography", "Motion", "Rule index"):
                assert same(x[a], x["Voice"]), f"{a} must sit in the second phone column"
            assert same(y["Logo"], y["Voice"]) and same(y["Colour"], y["Typography"]) and same(y["Library"], y["Rule index"])
            assert y["Motion"] > y["Iconography"] + 2, "the Quenby mark tile sits above Motion beside Iconography"
            top_limit, col = boxes["Typography"]["y"] + boxes["Typography"]["height"], boxes["Motion"]
        marks = page.get_by_role("img", name="Quenby & Co. mark")
        slot_ok = False
        for i in range(marks.count()):
            b = marks.nth(i).bounding_box()
            if not b:
                continue
            cx, cy = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
            if col["x"] - 2 <= cx <= col["x"] + col["width"] + 2 and top_limit - 2 <= cy <= boxes["Motion"]["y"] + 2:
                slot_ok = True
        assert slot_ok, "no Quenby mark tile found in its published mosaic slot"
        for t, l in links.items():
            g = l.evaluate(GLYPH_JS)
            assert g["glyph"] is not None, f"tile {t} has no inline vector glyph"
            tile, glyph = g["tile"], g["glyph"]
            assert glyph["y"] + glyph["h"] > tile["y"] + tile["h"] / 2, f"tile {t} glyph is not in the lower area"
            assert glyph["w"] * glyph["h"] >= 0.04 * tile["w"] * tile["h"], f"tile {t} glyph is not oversized"
            glyph_cx, tile_cx = glyph["x"] + glyph["w"] / 2, tile["x"] + tile["w"] / 2
            if t == "Logo":
                assert (glyph_cx > tile_cx) if desktop else (glyph_cx < tile_cx), "big Quenby mark glyph anchored on the wrong side"
            if t == "Typography":
                assert glyph_cx > tile_cx, "letterform specimen glyph must sit bottom right"
            if t == "Voice":
                assert glyph["w"] >= 0.3 * tile["w"], "voice quote glyph must span from its opening to its closing marks"
            if t == "Motion":
                shapes = l.evaluate("a => Array.from(a.getElementsByTagName('svg')).reduce((n, s) => n + s.getElementsByTagName('*').length, 0)")
                assert shapes >= 3, "easing handle glyph must draw a curve and two handles"
        links["Logo"].focus()
        assert tab_order(page, 7) == TILES[1:], "tile Tab order differs from the published reading order"

    with browse(browser, world, who="bea", path="/queue", size=size) as page:
        if desktop:
            expect(page.get_by_role("table", name="Review queue")).to_be_visible()
            expect(page.get_by_role("list", name="Review queue")).to_have_count(0)
        else:
            expect(page.get_by_role("list", name="Review queue")).to_be_visible()
            expect(page.get_by_role("table", name="Review queue")).to_have_count(0)
        expect(page.get_by_role("link", name="REQ-0004")).to_be_visible()
        layout(page)


def test_wf_variant_request_keyboard_happy(browser: Browser, world: World) -> None:
    with browse(browser, world, who="ana", path="/library", device_clock=DEVICE_CLOCK) as page:
        full = page.get_by_role("article", name=f"{FULL_LOCK}, Request required")
        expect(full).to_be_visible()
        expect(page.get_by_role("article", name=f"{TAB}, Available")).to_be_visible()
        expect(full.get_by_role("button", name="Download", exact=True)).to_have_accessible_description("Request use to download.")
        opener = full.get_by_role("button", name="Request use")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=f"Request {FULL_LOCK}")
        expect(dialog).to_be_visible()
        assert focus_inside(dialog), "the dialog must move focus to its first field"
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()

        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        page.evaluate("() => { window.__firstField = document.activeElement; }")
        page.keyboard.press("Shift+Tab")
        assert focus_inside(dialog), "Shift+Tab from the first field escaped the dialog"
        page.keyboard.press("Tab")
        assert page.evaluate("() => document.activeElement === window.__firstField"), "Tab from the last control did not wrap"

        expect(dialog.get_by_label("Campaign start")).to_have_value(TODAY)
        expect(dialog.get_by_role("group", name="Territories").get_by_role("checkbox", name="DE")).to_be_checked()
        application = dialog.get_by_role("combobox", name="Application")
        application.focus()
        select(application, "Co-brand")
        end = dialog.get_by_label("Campaign end")
        end.focus()
        fill(end, "2026-06-30")
        expect(dialog.get_by_role("status", name="Request notices")).to_have_text(
            "Your engagement ends on 15 Apr 2026, so any grant will end by then.")
        rules = dialog.get_by_role("group", name="Cited rules")
        for ident in ("logo.variants.full-lock", "logo.colour.no-recolour"):
            box_ = rules.get_by_role("checkbox", name=ident, exact=True)
            box_.focus()
            page.keyboard.press("Space")
            expect(box_).to_be_checked()
        dialog.get_by_role("button", name="Submit request").focus()
        page.keyboard.press("Enter")
        wait_url(page, rf"/requests/{REQ_NEW}$")
        expect(page.get_by_role("heading", level=1, name=REQ_NEW)).to_be_visible()
        expect(page.get_by_role("status", name="Request state")).to_have_text("Under review")
        expect(page.get_by_text("Held by Bea Lindqvist")).to_be_visible()
        expect(page.get_by_text(f"Due {fmt_stamp(iso_shift(START, hours=72))}")).to_be_visible()
        cited = page.get_by_role("list", name="Cited rules")
        expect(cited.get_by_role("link", name="logo.variants.full-lock")).to_have_attribute("href", re.compile(r"/rules/logo\.variants\.full-lock$"))
        expect(cited.get_by_role("link", name="logo.colour.no-recolour")).to_be_visible()
    d = detail(world, "ana", REQ_NEW)
    assert d["state"] == "under_review" and d["holder"]["displayName"] == "Bea Lindqvist"
    assert d["applicationClass"] == "co_brand" and d["campaignEndsOn"] == "2026-06-30" and d["variantId"] == "var_logo_full_lock"
    assert {c["identifier"] for c in d["citedRules"]} == {"logo.variants.full-lock", "logo.colour.no-recolour"}
    assert d["deadline"] == "2026-03-05T08:00:00.000Z" and len(d["stages"]) == 3


def test_wf_variant_request_grant_scope(browser: Browser, world: World) -> None:
    ana = cards(world, "ana")
    assert list(ana) == LIBRARY_ORDER
    assert ana[TAB]["badge"] == "Available" and ana[TAB]["variantId"] == "var_logo_tab"
    assert ana[FULL_LOCK]["badge"] == "Request required" and ana[FULL_LOCK]["reason"] == "Request use to download."
    assert {d["fileName"] for d in ana[TAB]["derivatives"]} == {"logo-tab.svg", "logo-tab-512.png"}
    assert ana[FULL_LOCK]["derivatives"] == []
    assert "Logo" not in ana, "the base asset with variants must not get its own card"
    err(world.as_("ana").post(route("derivatives", "drv_logo_1", "link")), 403, "download_not_allowed", "Request use to download.")
    assert world.as_("ana").post(route("derivatives", "drv_logo_3", "link")).status_code == 201
    err(world.as_("ana").post("/api/requests", json=request_body("ast_logo-1998", None, "social", ["DE"], "2026-04-01", ["logo.variants.tab"])),
        409, "not_requestable", "Logo 1998 cannot be requested: Retired. Use Logo instead.")
    err(world.as_("finn").post("/api/requests", json=request_body("ast_logo", "var_logo_tab", "social", ["NL"], "2026-05-31", ["logo.variants.tab"])),
        409, "duplicate_open_request", "You already have REQ-0003 open.")
    with browse(browser, world, who="ana", path="/library") as page:
        tab = page.get_by_role("article", name=f"{TAB}, Available")
        expect(tab.get_by_role("button", name="Download logo-tab.svg")).to_be_visible()
        expect(tab.get_by_role("button", name="Download logo-tab-512.png")).to_be_visible()
        full = page.get_by_role("article", name=f"{FULL_LOCK}, Request required")
        expect(full.get_by_role("button", name="Download", exact=True)).to_be_disabled()
        expect(page.get_by_role("button", name="Download logo-full-lock.svg")).to_have_count(0)
    with browse(browser, world, who="finn", path="/library") as page:
        tab = page.get_by_role("article", name=f"{TAB}, Request required")
        expect(tab.get_by_role("button", name="Request use")).to_be_disabled()
        expect(tab).to_contain_text("You already have REQ-0003 open.")


def test_wf_variant_request_routing(world: World, mail: Any) -> None:
    mail.clear()
    req = create(world, "ana", *ANA_COBRAND)
    rid = req["id"]
    assert rid == REQ_NEW and req["holder"]["displayName"] == "Bea Lindqvist"
    assert "stageReason" not in req, "the requester must not receive the stage reason"
    assert detail(world, "bea", rid)["stageReason"] == "Stage 1 of 3: first brand review (mark asset)."
    other = create(world, "finn", *FINN_MENU)
    assert other["holder"]["displayName"] == "Cai Brennan", "Cai holds fewer open stages than Bea"
    assert detail(world, "cai", other["id"])["stageReason"] == "Stage 1 of 1: brand review."
    assert decide(world, "bea", rid, 1, "approve").status_code == 200
    d = detail(world, "cai", rid)
    assert d["state"] == "under_review" and d["holder"]["displayName"] == "Cai Brennan"
    assert d["stageReason"] == "Stage 2 of 3: second brand review (mark asset)."
    assert decide(world, "cai", rid, 2, "approve").status_code == 200
    d = detail(world, "leo", rid)
    assert d["holder"]["displayName"] == "Leo Varga" and d["stageReason"] == "Stage 3 of 3: legal review (Co-brand)."
    assert d["escalation"] is None
    for who, email, reason in (("bea", "bea@quenby.example", "Stage 1 of 3: first brand review (mark asset)."),
                               ("cai", "cai@quenby.example", "Stage 2 of 3: second brand review (mark asset)."),
                               ("leo", "leo@quenby.example", "Stage 3 of 3: legal review (Co-brand).")):
        m = mail_to(mail, email, f"Review needed: {rid} {FULL_LOCK}")[0]
        assert reason in text(m)


def test_wf_variant_request_escalation(browser: Browser, app_url: str, mail: Any) -> None:
    body = seed_body()
    body["principals"] = [p for p in body["principals"] if p["key"] != "cai"]
    for r in body["requests"]:
        for s in r["stages"]:
            if s["assignee"] == "cai":
                s["assignee"] = "bea"
    w = reset_and_seed(app_url.rstrip("/"), body)
    try:
        mail.clear()
        rid = create(w, "ana", *ANA_COBRAND)["id"]
        assert decide(w, "bea", rid, 1, "approve").status_code == 200
        d = detail(w, "ana", rid)
        assert d["holder"]["displayName"] == "Olu Mensah" and d["escalation"] == "no_eligible_reviewer"
        assert d["stages"][1]["assigneeName"] == "Olu Mensah"
        assigned = [r for r in audit(w, requestId=rid) if r["action"] == "request.assigned"]
        assert assigned[-1]["after"] == {"escalation": "no_eligible_reviewer", "holder": "usr_olu"}
        assert assigned[-1]["before"] == {"holder": "usr_bea"}
        assert "Stage 2 of 3: second brand review (mark asset)." in text(mail_to(mail, "olu@quenby.example", f"Review needed: {rid} {FULL_LOCK}")[0])
        with browse(browser, w, who="ana", path=f"/requests/{rid}") as page:
            expect(page.get_by_text("Held by Olu Mensah")).to_be_visible()
            expect(page.get_by_text("Escalated: no eligible reviewer")).to_be_visible()
    finally:
        w.close()


def test_wf_approval_chain_three_sessions(browser: Browser, world: World, mail: Any) -> None:
    mail.clear()
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    with browse(browser, world, who="ana", path=f"/requests/{rid}") as ana:
        expect(ana.get_by_role("status", name="Request state")).to_have_text("Under review")
        for who in ("bea", "cai"):
            with browse(browser, world, who=who, path=f"/requests/{rid}") as rp:
                panel = rp.get_by_role("region", name="Decision")
                expect(panel).to_be_visible()
                click(panel.get_by_role("button", name="Approve", exact=True))
                wait_status(rp, "Decision saved.")
        with browse(browser, world, who="leo", path=f"/requests/{rid}") as lp:
            panel = lp.get_by_role("region", name="Decision")
            select(panel.get_by_role("combobox", name="Condition"), "Clear space")
            fill(panel.get_by_role("textbox", name="Condition value"), "1")
            click(panel.get_by_role("button", name="Add condition"))
            wait_status(lp, "Condition added.")
            select(panel.get_by_role("combobox", name="Condition"), "No recolour")
            click(panel.get_by_role("button", name="Add condition"))
            eventually(lp, lambda: expect(lp.get_by_text("Do not recolour the mark.").first).to_be_visible(timeout=POLL_MS),
                       "the no-recolour condition never appeared")
            expect(panel).to_contain_text("Grant will end on 15 Apr 2026 (engagement end)")
            click(panel.get_by_role("button", name="Approve", exact=True))
            wait_status(lp, "Decision saved.")
        live(ana, lambda: expect(ana.get_by_role("status", name="Request state")).to_have_text("Granted", timeout=POLL_MS),
             "Ana's request page never turned Granted")
        grant = ana.get_by_role("region", name="Grant")
        expect(grant).to_contain_text("Ends 15 Apr 2026")
        expect(grant).to_contain_text("Keep clear space of 1x the symbol height on every side.")
        expect(grant).to_contain_text("Do not recolour the mark.")
        expect(ana.get_by_text(f"{rid} is now Granted.").first).to_be_attached()
    d = detail(world, "ana", rid)
    gid = d["grant"]["id"]
    assert d["state"] == "granted" and gid == GR_NEW
    g = world.as_("ana").get(route("grants", gid)).json()
    assert g["status"] == "active" and g["notBefore"] == TODAY and g["notAfter"] == "2026-04-15" and g["cap"] == "engagement end"
    m = mail_to(mail, "ana@studiolumen.example", f"Granted: {rid} until 15 Apr 2026")[0]
    body = text(m)
    for line in (f"Grant {gid} on {FULL_LOCK}", "Ends 15 Apr 2026", "Status: Active",
                 "Keep clear space of 1x the symbol height on every side.", "Do not recolour the mark.",
                 f"/requests/{rid}"):
        assert line in body, f"grant mail lacks {line!r}"


def test_wf_approval_chain_grant_window(browser: Browser, world: World, mail: Any) -> None:
    mail.clear()
    menu = create(world, "finn", *FINN_MENU)["id"]
    menu_holder = holder_key(detail(world, "olu", menu))
    preview = detail(world, menu_holder, menu)["grantPreview"]
    assert preview == {"notBefore": TODAY, "notAfter": "2026-12-31", "cap": "campaign end", "zeroLength": False}
    full = create(world, "finn", "ast_logo", "var_logo_full_lock", "social", ["NL"], "2026-12-31", ["logo.variants.full-lock"])["id"]
    full_preview = detail(world, holder_key(detail(world, "olu", full)), full)["grantPreview"]
    assert full_preview["notAfter"] == "2026-05-31" and full_preview["cap"] == "licence term"
    r = world.as_(menu_holder).post(f"/api/requests/{menu}/conditions", json={"kind": "expiry_override", "value": OVERRIDE_DATE})
    assert r.status_code == 201, r.text
    assert detail(world, menu_holder, menu)["grantPreview"]["cap"] == "expiry override"
    approve_open(world, menu)
    g = world.as_("finn").get(f"/api/grants/{detail(world, 'finn', menu)['grant']['id']}").json()
    assert (g["notBefore"], g["notAfter"], g["cap"], g["status"]) == (TODAY, OVERRIDE_DATE, "expiry override", "active")

    err(decide(world, "cai", "REQ-0004", 1, "approve"), 403, "not_stage_holder", "Only Bea Lindqvist or an owner can decide this stage.")
    err(decide(world, "bram", "REQ-0004", 1, "approve"), 403, {"forbidden", "not_stage_holder"})
    assert detail(world, "bea", "REQ-0004")["grantPreview"] == {"notBefore": TODAY, "notAfter": "2026-03-01",
                                                               "cap": "engagement end", "zeroLength": True}
    with browse(browser, world, who="bea", path="/requests/REQ-0004") as page:
        panel = page.get_by_role("region", name="Decision")
        expect(panel).to_contain_text("This grant would end on 1 Mar 2026, before it starts. Approving records the decision but grants nothing.")
        click(panel.get_by_role("button", name="Approve", exact=True))
        wait_status(page, "Decision saved.")
    d = detail(world, "bram", "REQ-0004")
    assert d["grant"]["status"] == "zero_length" and d["grant"]["statusLabel"] == "Zero-length"
    assert d["grant"]["notAfter"] == "2026-03-01" and d["grant"]["notBefore"] == TODAY
    bram_mail = [m for m in mail.messages(0, settle=MAIL_POLL_S) if "bram@brightwell.example" in [a.lower() for a in addresses(m.get("To"))]]
    deadline = time.monotonic() + MAIL_WAIT_S
    while not any("This grant ended before it started, so nothing can be downloaded." in text(m) for m in bram_mail) and time.monotonic() < deadline:
        bram_mail = [m for m in mail.messages(0, settle=MAIL_POLL_S) if "bram@brightwell.example" in [a.lower() for a in addresses(m.get("To"))]]
    assert any(m.get("Subject", "").startswith("Decision on REQ-0004: ") and
               "This grant ended before it started, so nothing can be downloaded." in text(m) for m in bram_mail), \
        "zero-length decision mail missing"
    records = audit(world, requestId="REQ-0004")
    minted = [r for r in records if r["action"] == "grant.minted"]
    assert len(minted) == 1 and minted[0]["actorId"] == "usr_bea" and minted[0]["before"] is None
    assert minted[0]["after"] == {"notAfter": "2026-03-01", "notBefore": TODAY, "status": "zero_length"}
    for actor in ("usr_cai", "usr_bram"):
        denied = [r for r in records if r["actorId"] == actor and r["outcome"] == "denied"]
        assert len(denied) == 1 and denied[0]["before"] is None and denied[0]["after"] is None


CONDITION_CASES = {
    "clear_space": {"kind": "clear_space", "value": "1.5", "bad": "3", "bad_message": "Clear space must be 0.5, 1, 1.5 or 2.",
                    "text": "Keep clear space of 1.5x the symbol height on every side.", "until": "31 Dec 2026", "status": "Active"},
    "no_recolour": {"kind": "no_recolour", "value": None, "bad": None, "bad_message": None,
                    "text": "Do not recolour the mark.", "until": "31 Dec 2026", "status": "Active"},
    "attribution": {"kind": "attribution", "value": "Photo by Quenby & Co.", "bad": "", "bad_message": "Attribution needs a credit line.",
                    "text": "Credit line: Photo by Quenby & Co.", "until": "31 Dec 2026", "status": "Active"},
    "proof_required": {"kind": "proof_required", "value": None, "bad": None, "bad_message": None,
                       "text": "Upload final artwork for approval before use.", "until": "31 Dec 2026", "status": "Pending proof"},
    "territory": {"kind": "territory", "value": "NL, BE", "bad": "", "bad_message": "Territory needs at least one country code.",
                  "text": "Use only in: NL, BE", "until": "31 Dec 2026", "status": "Active"},
    "expiry_override": {"kind": "expiry_override", "value": "2026-06-01", "bad": "June", "bad_message": "Expiry override needs a date as YYYY-MM-DD.",
                        "text": "Use ends on 1 Jun 2026.", "until": "1 Jun 2026", "status": "Active"},
}


@pytest.mark.parametrize("kind", list(CONDITION_CASES), ids=list(CONDITION_CASES))
def test_conditions_display_text(world: World, mail: Any, kind: str) -> None:
    case = CONDITION_CASES[kind]
    mail.clear()
    rid = create(world, "finn", *FINN_MENU)["id"]
    holder = holder_key(detail(world, "olu", rid))
    client = world.as_(holder)
    if case["bad"] is not None:
        err(client.post(f"/api/requests/{rid}/conditions", json={"kind": case["kind"], "value": case["bad"]}),
            422, "condition_invalid", case["bad_message"])
        assert detail(world, "finn", rid)["conditions"] == []
    r = client.post(f"/api/requests/{rid}/conditions", json={"kind": case["kind"], "value": case["value"]})
    assert r.status_code == 201, r.text
    assert r.json()["kind"] == case["kind"] and r.json()["text"] == case["text"]
    assert [c["text"] for c in detail(world, "finn", rid)["conditions"]] == [case["text"]]
    approve_open(world, rid)
    d = detail(world, "finn", rid)
    gid = d["grant"]["id"]
    g = world.as_("finn").get(f"/api/grants/{gid}").json()
    assert g["conditions"] == [{"kind": case["kind"], "text": case["text"]}]
    assert g["statusLabel"] == case["status"]
    body = text(mail_to(mail, "finn@fathom.example", f"Granted: {rid} until {case['until']}")[0])
    assert case["text"] in body and f"Status: {case['status']}" in body
    err(world.as_("olu").post(f"/api/requests/{rid}/conditions", json={"kind": "no_recolour", "value": None}),
        409, "wrong_state", f"{rid} is already Granted.")


def test_live_channel_updates(browser: Browser, world: World) -> None:
    with browse(browser, world, who="bea", path="/queue") as queue, \
            browse(browser, world, who="ana", path="/library") as lib, \
            browse(browser, world, who="leo", path="/admin/grants") as grants:
        expect(queue.get_by_role("link", name="REQ-0004")).to_be_visible()
        rid = create(world, "finn", *FINN_MENU)["id"]
        live(queue, lambda: expect(queue.get_by_role("status", name="Queue updates")).to_have_text(f"{rid} added to your queue.", timeout=POLL_MS),
             "queue never announced the new stage")
        expect(queue.get_by_role("link", name=rid)).to_be_visible()
        with browse(browser, world, who="finn", path=f"/requests/{rid}") as req:
            expect(req.get_by_role("status", name="Request state")).to_have_text("Under review")
            r = decide(world, "bea", rid, 1, "reject", "Use the Tab variant instead.")
            assert r.status_code == 200
            live(req, lambda: expect(req.get_by_role("status", name="Request state")).to_have_text("Rejected", timeout=POLL_MS),
                 "the request page never showed Rejected")
            expect(req.get_by_text(f"{rid} is now Rejected.").first).to_be_attached()
        live(queue, lambda: expect(queue.get_by_role("status", name="Queue updates")).to_have_text(f"{rid} left your queue.", timeout=POLL_MS),
             "queue never announced the stage leaving")
        expect(lib.get_by_role("article", name=f"{TAB}, Available")).to_be_visible()
        assert world.as_("olu").post(route("assets", "ast_logo", "restrict")).status_code == 200
        live(lib, lambda: expect(lib.get_by_role("article", name=f"{TAB}, Restricted")).to_be_visible(timeout=POLL_MS),
             "the open library never changed the Tab badge")
        row = grants.get_by_role("table", name="Grants").get_by_role("row").filter(has_text="GR-0002")
        expect(row).to_be_visible()
        assert world.as_("olu").post(route("grants", "GR-0002", "revoke"), json={"reason": "Contract paused."}).status_code == 200
        live(grants, lambda: expect(row).to_contain_text("Revoked", timeout=POLL_MS), "the admin grants table never showed Revoked")


BADGE_EXAMPLES = [
    ("ana", "Logo 1998", "Retired", "Retired. Use Logo instead."),
    ("emi", "Rebrand teaser illustration", "Restricted", "Restricted by the brand team."),
    ("pia", "Harbour photograph", "Restricted", "Not licensed in FR."),
    ("ana", "Storefront photograph", "Restricted", "Not licensed for agencies."),
    ("bram", "Parcel spot icon", "Restricted", "Your engagement ended on 1 Mar 2026."),
    ("ana", "Logo — Tab", "Available", None),
    ("pia", "Storefront photograph", "Available", None),
    ("emi", "Logo — Full lock", "Available", None),
    ("ana", "Logo — Full lock", "Request required", "Request use to download."),
    ("pia", "Menu UI icon", "Restricted", "Not licensed for press contacts."),
]


def test_wf_three_viewers_badges(browser: Browser, world: World) -> None:
    seen = {who: cards(world, who) for who in ("ana", "emi", "pia", "bram", "finn")}
    for who, name, badge, reason in BADGE_EXAMPLES:
        c = seen[who][name]
        assert (c["badge"], c["reason"]) == (badge, reason), f"{who} / {name}: {c['badge']} {c['reason']!r}"
    assert {n: c["badge"] for n, c in seen["ana"].items()} == ANA_BADGES
    assert all(c["badge"] == "Available" for n, c in seen["emi"].items() if n not in ("Logo 1998", "Rebrand teaser illustration"))
    assert seen["ana"][FULL_LOCK]["canRequest"] is True and seen["ana"][FULL_LOCK]["requestReason"] is None
    assert seen["finn"][TAB]["canRequest"] is False and seen["finn"][TAB]["requestReason"] == "You already have REQ-0003 open."
    assert seen["finn"]["Pin pictogram"]["requestReason"] == "Upload your proof for GR-0004 first."
    assert all(c["canRequest"] is False for c in seen["pia"].values()) and all(c["canRequest"] is False for c in seen["emi"].values())

    with browse(browser, world, who="ana", path="/library", device_clock=DEVICE_CLOCK) as page:
        expect(page.get_by_role("article", name=f"{TAB}, Available")).to_be_visible()
        expect(page.get_by_role("article", name=art(LOGO_1998, "Retired"))).to_contain_text("Retired. Use Logo instead.")
    world.clock(to=ANA_GRANT_END)
    assert cards(world, "ana")[TAB]["badge"] == "Available", "the grant window includes the last millisecond of notAfter"
    world.clock(to=ANA_ENGAGEMENT_OVER)
    tab = cards(world, "ana")[TAB]
    assert (tab["badge"], tab["reason"]) == ("Restricted", "Your engagement ended on 15 Apr 2026.")
    with browse(browser, world, who="ana", path="/library", device_clock="2026-03-02T09:00:00Z") as page:
        card = page.get_by_role("article", name=f"{TAB}, Restricted")
        expect(card).to_be_visible()
        expect(card).to_contain_text("Your engagement ended on 15 Apr 2026.")


def test_wf_three_viewers_projection(browser: Browser, world: World) -> None:
    for who in ("ana", "finn", "bram", "pia"):
        for c in library(world, who)["cards"]:
            assert set(c) == CARD_KEYS, f"{who} card {c['cardName']} keys {sorted(c)}"
            for d in c["derivatives"]:
                assert set(d) == DERIVATIVE_KEYS
            if c["badge"] != "Available":
                assert c["derivatives"] == []
            if c["grant"] is not None:
                assert set(c["grant"]) == CARD_GRANT_KEYS
                for cond in c["grant"]["conditions"]:
                    assert set(cond) == {"kind", "text"}
        grants = world.as_(who).get("/api/grants").json()["grants"]
        for g in grants:
            assert set(g) == GRANT_KEYS, f"{who} grant keys {sorted(g)}"
            assert set(g["holder"]) == {"type", "id", "displayName"}
    own = {who: {g["id"] for g in world.as_(who).get("/api/grants").json()["grants"]} for who in ("ana", "finn", "bram", "pia")}
    assert own == {"ana": {"GR-0001"}, "finn": {"GR-0002", "GR-0004"}, "bram": set(), "pia": {"GR-0003"}}
    ana = cards(world, "ana")
    assert {n for n, c in ana.items() if c["grant"]} == {TAB} and ana[TAB]["grant"]["id"] == "GR-0001"
    assert ana[TAB]["openRequestId"] is None and ana["Parcel spot icon"]["grant"] is None
    finn = cards(world, "finn")
    assert finn[TAB]["openRequestId"] == "REQ-0003" and finn[TAB]["grant"] is None
    assert finn["Parcel spot icon"]["grant"]["id"] == "GR-0002"
    pin = finn["Pin pictogram"]["grant"]
    assert pin["id"] == "GR-0004" and pin["status"] == "pending_proof"
    assert pin["conditions"] == [{"kind": "proof_required", "text": "Upload final artwork for approval before use."}]
    assert cards(world, "bram")["Parcel spot icon"]["openRequestId"] == "REQ-0004"
    assert cards(world, "pia")["Storefront photograph"]["grant"]["id"] == "GR-0003"
    with browse(browser, world, who="ana", path="/library") as page:
        expect(page.get_by_role("article", name=art(PARCEL, "Request required"))).to_be_visible()
        expect(page.get_by_text("GR-0002")).to_have_count(0)
        expect(page.get_by_text("REQ-0003")).to_have_count(0)


def test_wf_three_viewers_filters(browser: Browser, world: World) -> None:
    with browse(browser, world, who="ana", path="/library") as page:
        results = page.get_by_role("status", name="Library results")
        articles = page.get_by_role("article")
        expect(results).to_have_text("9 assets")
        expect(articles).to_have_count(9)
        for i, name in enumerate(LIBRARY_ORDER):
            expect(articles.nth(i)).to_have_accessible_name(f"{name}, {ANA_BADGES[name]}")
        filters = page.get_by_role("group", name="Filters")
        klass = filters.get_by_role("combobox", name="Class")
        klass.focus()
        select(klass, "Mark")
        expect(results).to_have_text(sentence(3, "Mark"))
        available = filters.get_by_role("checkbox", name="Available")
        available.focus()
        page.keyboard.press("Space")
        expect(results).to_have_text(sentence(1, "Mark", "Available"))
        expect(articles).to_have_count(1)
        expect(page.get_by_role("article", name=f"{TAB}, Available")).to_be_visible()
        page.keyboard.press("Space")
        select(klass, "All classes")
        expect(results).to_have_text("9 assets")
        search = filters.get_by_role("searchbox", name="Search assets")
        search.focus()
        page.keyboard.type(SEARCH_PROBE)
        expect(results).to_have_text(f'2 assets, matching "{SEARCH_PROBE}"')
        expect(page.get_by_role("article", name=art(HARBOUR, "Restricted"))).to_be_visible()
        expect(page.get_by_role("article", name=art(STOREFRONT, "Restricted"))).to_be_visible()
        fill(search, "")
        search.focus()
        page.keyboard.type(NO_MATCH_PROBE)
        expect(results).to_have_text(f'0 assets, matching "{NO_MATCH_PROBE}"')
        expect(page.get_by_text("No assets match these filters.")).to_be_visible()
    assert library(world, "ana", {"class": "mark", "availability": "Available"})["count"] == 1
    both = library(world, "ana", [("availability", "Request required"), ("availability", "Restricted")])
    assert both["count"] == 7 and {c["badge"] for c in both["cards"]} == {"Request required", "Restricted"}
    assert library(world, "ana", {"class": "Mark"})["count"] == 0, "class takes the key, never the label"
    assert library(world, "ana", {"q": "spot"})["count"] == 1


def test_wf_link_death_expiry_edges(browser: Browser, world: World) -> None:
    with browse(browser, world, who="finn", path="/library") as page:
        card = page.get_by_role("article", name=art(PARCEL, "Available"))
        click(card.get_by_role("button", name=f"Download {PARCEL_FILE}"))
        again = card.get_by_role("link", name="Download again: parcel-120.png")
        eventually(page, lambda: expect(again).to_be_visible(timeout=POLL_MS), "no Download again link after issuing")
        expect(card).to_contain_text(f"Link expires at {fmt_time(iso_shift(START, seconds=LINK_TTL_S))}")
        href = again.get_attribute("href") or ""
    assert re.search(r"/dl/[^/]+$", href), f"issued link {href!r} is not a /dl/<token> URL"
    url = href if href.startswith("http") else world.base + href
    got = httpx.get(url, timeout=HTTP_TIMEOUT)
    assert got.status_code == 200
    assert got.headers["content-disposition"] == f'attachment; filename="{PARCEL_FILE}"'
    assert png_size(got.content) == (120, 120)
    assert got.content == S3().get(deriv_key("ast_parcel", "base", "parcel-120.png"))

    issued = world.as_("finn").post(route("derivatives", "drv_parcel_1", "link"))
    assert issued.status_code == 201
    expires = issued.json()["expiresAt"]
    assert expires == iso_shift(START, seconds=LINK_TTL_S)
    link = world.base + issued.json()["url"]
    token_start = link.rfind("/") + 1
    mid = token_start + (len(link) - token_start) // 2
    tampered = link[:mid] + ("A" if link[mid] != "A" else "B") + link[mid + 1:]
    bad = httpx.get(tampered, timeout=HTTP_TIMEOUT)
    assert bad.status_code == 404 and "Not found" in bad.text
    world.clock(to=expires)
    assert httpx.get(link, timeout=HTTP_TIMEOUT).status_code == 200, "a link is valid until it is past its expiry"
    world.clock(to=iso_shift(expires, seconds=1))
    gone = httpx.get(link, timeout=HTTP_TIMEOUT)
    assert gone.status_code == 410 and "This link has expired." in gone.text

    world.clock(to=iso_shift(ANA_GRANT_END, minutes=-2))
    tab = world.as_("ana").post(route("derivatives", "drv_logo_4", "link"))
    assert tab.status_code == 201
    tab_link = world.base + tab.json()["url"]
    world.clock(to=ANA_GRANT_END)
    assert httpx.get(tab_link, timeout=HTTP_TIMEOUT).status_code == 200
    world.clock(to=iso_shift(ANA_GRANT_END, seconds=1))
    late = httpx.get(tab_link, timeout=HTTP_TIMEOUT)
    assert late.status_code == 404 and "Not found" in late.text


def test_wf_link_death_revocation(browser: Browser, world: World, mail: Any) -> None:
    mail.clear()
    with browse(browser, world, who="ana", path="/library") as ana:
        card = ana.get_by_role("article", name=f"{TAB}, Available")
        click(card.get_by_role("button", name="Download logo-tab-512.png"))
        again = card.get_by_role("link", name="Download again: logo-tab-512.png")
        eventually(ana, lambda: expect(again).to_be_visible(timeout=POLL_MS), "no Download again link")
        href = again.get_attribute("href") or ""
        url = href if href.startswith("http") else world.base + href
        assert httpx.get(url, timeout=HTTP_TIMEOUT).status_code == 200
        err(world.as_("leo").post(route("grants", "GR-0001", "revoke"), json={"reason": ""}), 422, "reason_required", "Give a reason.")
        with browse(browser, world, who="leo", path="/admin/grants") as leo:
            click(leo.get_by_role("button", name="Revoke GR-0001"))
            dialog = leo.get_by_role("dialog", name="Revoke GR-0001")
            fill(dialog.get_by_role("textbox", name="Reason"), REVOKE_REASON)
            click(dialog.get_by_role("button", name="Revoke grant"))
            wait_status(leo, "GR-0001 revoked.")
        live(ana, lambda: expect(ana.get_by_role("article", name=f"{TAB}, Request required")).to_be_visible(timeout=POLL_MS),
             "Ana's library never changed the Tab badge after revocation")
    gone = httpx.get(url, timeout=HTTP_TIMEOUT)
    assert gone.status_code == 404 and "Not found" in gone.text
    g = world.as_("ana").get(route("grants", "GR-0001")).json()
    assert g["status"] == "revoked" and g["revokedReason"] == REVOKE_REASON
    err(world.as_("olu").post(route("grants", "GR-0001", "revoke"), json={"reason": "Again."}), 409, "wrong_state", "GR-0001 is Revoked.")
    assert REVOKE_REASON in text(mail_to(mail, "ana@studiolumen.example", "Grant GR-0001 revoked")[0])


def test_wf_proof_upload_checks(browser: Browser, world: World) -> None:
    jpeg = b"\xff\xd8\xff" + b"\x00" * (PROOF_MAX_BYTES - 3)
    r = upload_proof(world, "finn", "GR-0004", EXACT_NAME, jpeg, "image/jpeg")
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["status"] == "pending_review" and first["fileName"] == EXACT_NAME
    assert len(S3().get(f"{PROOF_PREFIX}{first['id']}")) == PROOF_MAX_BYTES
    err(upload_proof(world, "finn", "GR-0004", "second.png", png_bytes(4, 4)), 409, "wrong_state")
    assert world.as_("bea").post(f"/api/proofs/{first['id']}/reject", json={"reason": "Too dark."}).status_code == 200
    err(upload_proof(world, "finn", "GR-0004", "big.txt", b"x" * (PROOF_MAX_BYTES + 1), "text/plain"),
        422, "proof_type", "Proof must be a PNG, JPEG or PDF file.")
    keys_before = S3().keys(PROOF_PREFIX)
    good = png_bytes(16, 16)
    with browse(browser, world, who="finn", path="/requests/REQ-0002") as page:
        proofs = page.get_by_role("region", name="Proofs")
        field_ = proofs.get_by_label("Proof file")
        upload = proofs.get_by_role("button", name="Upload proof")
        field_.set_input_files({"name": ARTWORK_NAME, "mimeType": "image/png", "buffer": b"plain words, not an image"})
        click(upload)
        eventually(page, lambda: expect(proofs.get_by_role("alert")).to_have_text("Proof must be a PNG, JPEG or PDF file.", timeout=POLL_MS),
                   "a renamed text file was not refused")
        field_.set_input_files({"name": "huge.png", "mimeType": "image/png",
                                "buffer": PNG_SIGNATURE + b"\x00" * (PROOF_MAX_BYTES + 1 - len(PNG_SIGNATURE))})
        click(upload)
        eventually(page, lambda: expect(proofs.get_by_role("alert")).to_have_text("Proof must be 5 MB or smaller.", timeout=POLL_MS),
                   "an oversized PNG was not refused")
        assert S3().keys(PROOF_PREFIX) == keys_before, "a refused proof reached storage"
        field_.set_input_files({"name": ARTWORK_NAME, "mimeType": "image/png", "buffer": good})
        with held(page, "**" + route("grants", "GR-0004", "proofs")) as gate:
            click(upload)
            expect(proofs.get_by_role("button", name="Uploading")).to_be_disabled()
            release_gate(gate)
        wait_status(page, "Proof uploaded. Waiting for review.")
        expect(proofs).to_contain_text(f"{ARTWORK_NAME} — {PENDING}")
    new_keys = [k for k in S3().keys(PROOF_PREFIX) if k not in keys_before]
    assert len(new_keys) == 1 and S3().get(new_keys[0]) == good, "the accepted proof is not the stored object"


def test_wf_proof_review_live(browser: Browser, world: World) -> None:
    first = upload_proof(world, "finn", "GR-0004", DARK_NAME, png_bytes(8, 8))
    assert first.status_code == 201
    with browse(browser, world, who="finn", path="/requests/REQ-0002") as finn:
        proofs = finn.get_by_role("region", name="Proofs")
        expect(proofs).to_contain_text(f"{DARK_NAME} — {PENDING}")
        with browse(browser, world, who="bea", path="/requests/REQ-0002") as bea:
            fill(bea.get_by_role("textbox", name="Proof rejection reason"), DARK_REASON)
            click(bea.get_by_role("button", name="Reject proof"))
            wait_status(bea, "Proof rejected.")
            live(finn, lambda: expect(proofs).to_contain_text(f"{DARK_NAME} — {REJECTED}", timeout=POLL_MS), "Finn never saw the rejection")
            expect(proofs).to_contain_text(DARK_REASON)
            second = upload_proof(world, "finn", "GR-0004", "proof-final.pdf", pdf_bytes(), "application/pdf")
            assert second.status_code == 201
            pid = second.json()["id"]
            world.clock(minutes=24 * 60)
            bea.reload()
            click(bea.get_by_role("button", name="Accept proof"))
            wait_status(bea, "Proof accepted.")
        live(finn, lambda: expect(finn.get_by_role("region", name="Grant")).to_contain_text("Active", timeout=POLL_MS),
             "Finn's grant never turned Active")
    g = world.as_("finn").get(route("grants", "GR-0004")).json()
    assert g["status"] == "active" and g["notBefore"] == NEXT_DAY
    assert cards(world, "finn")["Pin pictogram"]["badge"] == "Available"
    act = [r for r in audit(world) if r["action"] == "grant.activated"]
    assert act and act[-1]["after"] == {"notBefore": NEXT_DAY, "status": "active"} and act[-1]["actorId"] == "usr_bea"
    for who, method, path in (("ana", "GET", f"/api/proofs/{pid}/content"), ("ana", "POST", f"/api/proofs/{pid}/accept"),
                              ("bram", "POST", route("grants", "GR-0004", "proofs"))):
        kw = {"files": {"file": ("x.png", png_bytes(2, 2), "image/png")}} if path.endswith("/proofs") else {}
        r = world.as_(who).request(method, path, **kw)
        assert r.status_code == 404 and r.json() == NOT_FOUND, f"{method} {path} as {who}: {r.text}"
    assert world.as_("bea").get(f"/api/proofs/{pid}/content").content == pdf_bytes()
    err(upload_proof(world, "finn", "GR-0004", "late.png", png_bytes(2, 2)), 409, "wrong_state")


def test_wf_proof_storage_outage(browser: Browser, world: World) -> None:
    base = os.environ[OUTAGE_URL_ENV].rstrip("/")
    started = time.monotonic()
    h = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
    assert time.monotonic() - started <= HEALTH_MAX_S + LIVE_SLACK_S
    assert h.status_code == 200 and h.json() == {"status": "unavailable"}
    w = World(base=base, cookie_name=world.cookie_name, sessions=world.sessions, ids=world.ids, now=world.now)
    try:
        err(upload_proof(w, "finn", "GR-0004", "p.png", png_bytes(4, 4)), 503, "storage_unavailable",
            "Proof storage is unavailable. Your request is unchanged.")
        err(w.as_("finn").post(route("derivatives", "drv_parcel_1", "link")), 503, "storage_unavailable", "Downloads are unavailable right now.")
        err(w.as_("olu").post(route("assets", "ast_rebrand-teaser", "release")), 503, "storage_unavailable", "Storage is unavailable. Nothing was changed.")
        err(w.as_("olu").post(route("assets", "ast_courier", "derivatives"), files={"file": ("c-120.png", png_bytes(120, 120), "image/png")}),
            503, "storage_unavailable", "Storage is unavailable. Nothing was changed.")
        assets = {a["id"]: a for a in w.as_("olu").get("/api/admin/assets").json()["assets"]}
        assert assets["ast_courier"]["state"] == "draft" and len(assets["ast_courier"]["derivatives"]) == 1
        assert assets["ast_rebrand-teaser"]["state"] == "restricted"
        assert w.as_(None).get("/api/chapters").status_code == 200
        assert library(w, "ana")["count"] == 9
        q = w.as_("cai").get("/api/queue")
        assert q.status_code == 200 and [r["requestId"] for r in q.json()["rows"]] == ["REQ-0003"]
        assert detail(w, "finn", "REQ-0002")["grant"]["status"] == "pending_proof"
        with browse(browser, w, who="finn", path="/requests/REQ-0002") as page:
            proofs = page.get_by_role("region", name="Proofs")
            proofs.get_by_label("Proof file").set_input_files({"name": "ok.png", "mimeType": "image/png", "buffer": png_bytes(4, 4)})
            click(proofs.get_by_role("button", name="Upload proof"))
            eventually(page, lambda: expect(proofs.get_by_role("alert")).to_have_text(
                "Proof storage is unavailable. Your request is unchanged.", timeout=POLL_MS), "proof outage copy missing")
            page.goto(base + "/library")
            card = page.get_by_role("article", name=art(PARCEL, "Available"))
            click(card.get_by_role("button", name=f"Download {PARCEL_FILE}"))
            eventually(page, lambda: expect(card.get_by_role("alert")).to_have_text("Downloads are unavailable right now.", timeout=POLL_MS),
                       "download outage copy missing")
    finally:
        w.close()


def fix_courier(world: World) -> None:
    assert world.as_("olu").delete(route("derivatives", "drv_courier_1")).status_code == 204
    up = world.as_("olu").post(route("assets", "ast_courier", "derivatives"), files={"file": ("courier-120.png", png_bytes(120, 120), "image/png")})
    assert up.status_code == 201, up.text
    assert world.as_("olu").post(route("assets", "ast_courier", "release")).status_code == 200


def test_wf_publication_size_contract(browser: Browser, world: World) -> None:
    good = png_bytes(120, 120)
    with browse(browser, world, who="olu", path="/admin/assets") as page:
        click(page.get_by_role("button", name="Release Courier spot icon"))
        eventually(page, lambda: expect(page.get_by_role("alert").filter(
            has_text="Cannot release: courier-128.png is 128 x 128; a Spot icon must be 120 x 120.")).to_be_visible(timeout=POLL_MS),
            "size_contract line missing")
        assets = {a["id"]: a for a in world.as_("olu").get("/api/admin/assets").json()["assets"]}
        assert assets["ast_courier"]["state"] == "draft"
        click(page.get_by_role("button", name="Remove courier-128.png"))
        wait_status(page, "courier-128.png removed.")
        err(world.as_("olu").post(route("assets", "ast_courier", "release")), 422, "no_derivatives", "Cannot release: Courier spot icon has no derivatives.")
        err(world.as_("olu").post(route("assets", "ast_courier", "derivatives"), files={"file": ("notes.png", b"just text", "image/png")}),
            422, "derivative_type", "Derivative must be a PNG or SVG file.")
        err(world.as_("olu").post(route("assets", "ast_courier", "derivatives"),
                                  files={"file": ("big.png", PNG_SIGNATURE + b"\x00" * DERIVATIVE_MAX_BYTES, "image/png")}),
            413, "too_large", "Request body is too large.")
        page.get_by_label("Add derivative to Courier spot icon").set_input_files(
            {"name": "courier-120.png", "mimeType": "image/png", "buffer": good})
        wait_status(page, "courier-120.png added.")
        assert S3().get(deriv_key("ast_courier", "base", "courier-120.png")) == good
        drv = [d for d in world.as_("olu").get("/api/admin/assets").json()["assets"] if d["id"] == "ast_courier"][0]["derivatives"]
        assert [(d["fileName"], d["width"], d["height"]) for d in drv] == [("courier-120.png", 120, 120)]
        click(page.get_by_role("button", name="Release Courier spot icon"))
        wait_status(page, "Courier spot icon released.")
    assets = {a["id"]: a for a in world.as_("olu").get("/api/admin/assets").json()["assets"]}
    assert assets["ast_courier"]["state"] == "released"
    assert any(r["action"] == "asset.released" and r["after"] == {"state": "released"} and r["before"] == {"state": "draft"}
               for r in audit(world))


def test_wf_publication_blocked_then_published(browser: Browser, world: World) -> None:
    assert world.as_("ari").post(route("versions", V_ICON2, "submit")).status_code == 200
    assert world.as_("bea").post(route("versions", V_ICON2, "approve")).status_code == 200
    err(world.as_("ari").post(route("versions", V_ICON2, "publish")), 403, "forbidden")
    err(world.as_("bea").post(route("versions", V_ICON2, "publish")), 403, "forbidden")
    assert world.as_("leo").post(route("versions", V_ICON2, "publish")).json() == NOT_FOUND
    with browse(browser, world, who="olu", path="/editor/iconography") as page:
        click(page.get_by_role("button", name="Publish version 2", exact=True))
        eventually(page, lambda: expect(page.get_by_role("alert").filter(
            has_text="Cannot publish version 2: Courier spot icon is draft.")).to_be_visible(timeout=POLL_MS), "publish_blocked copy missing")
        assert world.as_(None).get(route("chapters", "iconography")).json()["version"] == 1
        fix_courier(world)
        click(page.get_by_role("button", name="Publish version 2", exact=True))
        wait_status(page, "Version 2 published.")
        ch = world.as_(None).get(route("chapters", "iconography")).json()
        assert ch["version"] == 2 and "iconography.spot.courier" in [s["identifier"] for s in ch["statements"]]
        assert world.as_(None).get(route("versions", "ver_iconography_1")).json()["state"] == "superseded"
        page.reload()
        click(page.get_by_role("button", name="Republish version 1"))
        wait_status(page, "Version 3 published from version 1.")
    ch = world.as_(None).get(route("chapters", "iconography")).json()
    assert ch["version"] == 3 and ch["intro"] == "Three icon classes, each with a fixed size."
    states = {v["number"]: v["state"] for v in world.as_("olu").get(route("chapters", "iconography", "versions")).json()["versions"]}
    assert states[2] == "superseded" and states[3] == "published" and list(states.values()).count("published") == 1
    pubs = [r for r in audit(world) if r["action"] == "chapter.published"]
    assert pubs[-2]["after"] == {"state": "published", "version": 2} and pubs[-2]["before"] == {"state": "approved"}
    assert pubs[-1]["after"] == {"republishedFrom": 1, "state": "published", "version": 3} and pubs[-1]["before"] is None
    with browse(browser, world, path="/chapters/iconography") as anon:
        expect(anon.get_by_text("Version 3, published 2 Mar 2026")).to_be_visible()


NEW_VOICE_INTRO = "We write the way we would say it across a counter, briefly."


def test_wf_publication_author_to_reader(browser: Browser, world: World) -> None:
    with browse(browser, world, who="ari", path="/editor/voice") as page:
        click(page.get_by_role("button", name="Start version 2"))
        intro = page.get_by_role("textbox", name="Introduction")
        eventually(page, lambda: expect(intro).to_be_visible(timeout=POLL_MS), "draft form never opened")
        fill(intro, NEW_VOICE_INTRO)
        click(page.get_by_role("button", name="Save draft"))
        wait_status(page, "Draft saved.")
        v = [x for x in world.as_("ari").get(route("chapters", "voice", "versions")).json()["versions"] if x["number"] == 2][0]
        stmts = [{"identifier": "voice.tone.plain", "text": "Write in plain words, one idea per sentence."}]
        put = lambda rev, s: world.as_("ari").put(f"/api/versions/{v['id']}", json={"revision": rev, "intro": NEW_VOICE_INTRO,
                                                                                    "statements": s, "assetIds": [], "withdrawn": []})
        err(put(v["revision"] - 1, stmts), 409, "stale_version", "This draft changed since you opened it. Reload to see the latest.")
        err(put(v["revision"], [{"identifier": "typography.weight.extra", "text": "x"}]), 422, "identifier_prefix",
            "typography.weight.extra must start with voice.")
        err(put(v["revision"], [{"identifier": "Voice.Tone.Plain", "text": "x"}]), 422, "identifier_invalid",
            "Voice.Tone.Plain is not a valid rule identifier.")
        click(page.get_by_role("button", name="Submit for review"))
        wait_status(page, "Version 2 submitted for review.")
        expect(page.get_by_role("list", name="Versions")).to_contain_text("Version 2 — in review")
    with browse(browser, world, who="bea", path="/editor/voice") as page:
        click(page.get_by_role("button", name="Approve version 2"))
        wait_status(page, "Version 2 approved.")
    with browse(browser, world, who="olu", path="/editor/voice") as page:
        click(page.get_by_role("button", name="Publish version 2", exact=True))
        wait_status(page, "Version 2 published.")
    ch = world.as_(None).get(route("chapters", "voice")).json()
    assert ch["version"] == 2 and ch["intro"] == NEW_VOICE_INTRO
    with browse(browser, world, path="/chapters/voice") as anon:
        expect(anon.get_by_role("heading", level=1, name="Voice")).to_be_visible()
        expect(anon.get_by_text("Version 2, published 2 Mar 2026")).to_be_visible()
        expect(anon.get_by_text(NEW_VOICE_INTRO)).to_be_visible()
        expect(anon.get_by_role("list", name="Rules").get_by_role("listitem")).to_have_count(2)
    with browse(browser, world, path="/", reduced="reduce") as home:
        expect(home.get_by_role("navigation", name="Chapters").get_by_role("link", name="Voice", exact=True)).to_have_accessible_description("v2 · 2 rules")


def test_wf_statements_rule_link_focus(browser: Browser, world: World) -> None:
    with browse(browser, world, who="ana", path="/requests/REQ-0001") as page:
        link = page.get_by_role("list", name="Cited rules").get_by_role("link", name="logo.variants.tab")
        link.focus()
        page.keyboard.press("Enter")
        wait_url(page, r"/rules/logo\.variants\.tab$")
        expect(page.get_by_role("heading", level=1, name="Logo")).to_be_visible()
        eventually(page, lambda: _assert_status(1 if page.evaluate("() => document.activeElement && document.activeElement.id") == "logo.variants.tab" else 0, 1),
                   "the statement list item was not focused")
        item = page.get_by_role("list", name="Rules").get_by_role("listitem").filter(has_text="Use the Tab alone when the symbol starts the layout.")
        b = box(item)
        assert 0 <= b["y"] and b["y"] + b["height"] <= DESKTOP[1], "the focused statement is not scrolled into view"
    body = lambda rules: request_body("ast_menu", None, "social", ["DE"], "2026-04-01", rules)
    err(world.as_("ana").post("/api/requests", json=body([])), 422, "rules_required", "Cite at least one rule.")
    err(world.as_("ana").post("/api/requests", json=body(["logo.clear-space.half"])), 422, "rule_unknown", "logo.clear-space.half is not a live rule.")
    err(world.as_("ana").post("/api/requests", json=body(["logo.nope.x"])), 422, "rule_unknown", "logo.nope.x is not a live rule.")


def test_wf_statements_withdrawn_rule(browser: Browser, world: World) -> None:
    r = world.as_(None).get(route("rules", "logo.clear-space.half")).json()
    assert r == {"identifier": "logo.clear-space.half", "status": "withdrawn", "withdrawnInVersion": 2, "replacedBy": "logo.clear-space.minimum"}
    assert world.as_(None).get(route("rules", "logo.nope.x")).json() == NOT_FOUND
    with browse(browser, world, path="/rules/logo.clear-space.half") as page:
        expect(page.get_by_text("This rule was withdrawn in version 2. It is replaced by logo.clear-space.minimum.")).to_be_visible()
        click(page.get_by_role("link", name="logo.clear-space.minimum"))
        wait_url(page, r"/rules/logo\.clear-space\.minimum$")
        page.goto(world.base + "/rules/logo.nope.x")
        expect(page.get_by_role("heading", level=1, name="Not found")).to_be_visible()
        page.goto(world.base + "/rules")
        expect(page.get_by_role("link", name="logo.variants.tab")).to_be_visible()
        expect(page.get_by_role("link", name="logo.clear-space.half")).to_have_count(0)


def test_wf_deadlines_timers(browser: Browser, world: World, mail: Any) -> None:
    mail.clear()
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    fast = create(world, "finn", *FINN_MENU)["id"]
    assert detail(world, "ana", rid)["deadline"] == "2026-03-05T08:00:00.000Z"
    world.clock(to=iso_shift("2026-03-04T14:00:00.000Z", minutes=-1))
    assert quiet_mail(mail, "bea@quenby.example", f"Deadline soon: {rid}") == []
    mail_to(mail, "olu@quenby.example", f"Deadline missed: {fast} is now yours")
    mail_to(mail, "finn@fathom.example", f"Decision on {fast}: Expired")
    fr = audit(world, requestId=fast)
    seq = {r["action"]: r["sequence"] for r in fr}
    assert seq["request.escalated"] < seq["request.expired"], "a clock jump must fire timers in time order"
    world.clock(to="2026-03-04T14:00:00.000Z")
    assert f"Due {fmt_stamp(iso_shift(START, hours=72))}" in text(mail_to(mail, "bea@quenby.example", f"Deadline soon: {rid}")[0])
    world.clock(to=iso_shift("2026-03-05T08:00:00.000Z", minutes=-1))
    assert detail(world, "olu", rid)["holder"]["displayName"] == "Bea Lindqvist"
    world.clock(to="2026-03-05T08:00:00.000Z")
    d = detail(world, "olu", rid)
    assert d["holder"]["displayName"] == "Olu Mensah" and d["escalation"] == "deadline_missed"
    assert "Bea Lindqvist" in text(mail_to(mail, "olu@quenby.example", f"Deadline missed: {rid} is now yours")[0])
    world.clock(to=iso_shift("2026-03-08T08:00:00.000Z", minutes=-1))
    assert detail(world, "ana", rid)["state"] == "under_review"
    world.clock(to="2026-03-08T08:00:00.000Z")
    assert detail(world, "ana", rid)["state"] == "expired"
    mail_to(mail, "ana@studiolumen.example", f"Decision on {rid}: Expired")
    assert len(quiet_mail(mail, "bea@quenby.example", f"Deadline soon: {rid}")) == 1, "the warning must fire once"
    recs = {r["action"]: r for r in audit(world, requestId=rid)}
    assert recs["request.escalated"]["after"] == {"escalation": "deadline_missed", "holder": "usr_olu"}
    assert recs["request.escalated"]["before"] == {"holder": "usr_bea"} and recs["request.escalated"]["actorId"] == "system"
    assert recs["request.expired"]["before"] == {"state": "under_review"} and recs["request.expired"]["after"] == {"state": "expired"}
    with browse(browser, world, who="ana", path=f"/requests/{rid}") as page:
        expect(page.get_by_role("status", name="Request state")).to_have_text("Expired")


def test_wf_deadlines_queue_order(browser: Browser, world: World) -> None:
    rid = create(world, "ana", "ast_logo", "var_logo_full_lock", "social", ["DE"], "2026-04-10", ["logo.variants.full-lock"])["id"]
    rows = world.as_("bea").get("/api/queue").json()["rows"]
    assert [r["requestId"] for r in rows] == [rid, "REQ-0004"]
    with browse(browser, world, who="bea", path="/queue") as page:
        table = page.get_by_role("table", name="Review queue")
        a, b = box(table.get_by_role("link", name=rid)), box(table.get_by_role("link", name="REQ-0004"))
        assert a["y"] < b["y"], "queue rows are not ordered by deadline"
        expect(table.get_by_role("row").filter(has_text=rid)).to_contain_text(fmt_stamp(iso_shift(START, hours=24)))
        expect(table.get_by_role("row").filter(has_text="REQ-0004")).to_contain_text("3 Mar 2026 17:00")
    with browse(browser, world, who="olu", path="/queue", device_clock=DEVICE_CLOCK) as olu, \
            browse(browser, world, who="cai", path="/queue") as cai:
        expect(olu.get_by_text("Nothing is waiting for you.")).to_be_visible()
        expect(cai.get_by_role("link", name="REQ-0003")).to_be_visible()
        world.clock(to="2026-03-03T07:00:00.000Z")
        live(olu, lambda: expect(olu.get_by_role("status", name="Queue updates")).to_have_text("REQ-0003 added to your queue.", timeout=POLL_MS),
             "Olu's queue never announced the breached stage")
        expect(olu.get_by_role("table", name="Review queue").get_by_role("row").filter(has_text="REQ-0003")).to_contain_text("Escalated: deadline missed")
        live(cai, lambda: expect(cai.get_by_role("status", name="Queue updates")).to_have_text("REQ-0003 left your queue.", timeout=POLL_MS),
             "Cai's queue never announced the stage leaving")
    row = [r for r in world.as_("olu").get("/api/queue").json()["rows"] if r["requestId"] == "REQ-0003"][0]
    assert row["escalation"] == "deadline_missed"


def test_wf_races_concurrent_decisions(browser: Browser, world: World) -> None:
    bea, olu = world.as_("bea"), world.as_("olu")
    r1, r2 = together(lambda: decide(world, "bea", "REQ-0004", 1, "approve"),
                      lambda: decide(world, "olu", "REQ-0004", 1, "reject", "No."))
    assert sorted([r1.status_code, r2.status_code]) == [200, 409], f"{r1.text} / {r2.text}"
    winner, loser = (("Bea Lindqvist", "Approved", "usr_bea"), r2) if r1.status_code == 200 else (("Olu Mensah", "Rejected", "usr_olu"), r1)
    err(loser, 409, "already_decided", f"Already decided by {winner[0]}: {winner[1]}.")
    decided = [r for r in audit(world, requestId="REQ-0004") if r["action"] == "request.decided"]
    assert len(decided) == 1 and decided[0]["actorId"] == winner[2]
    assert world.as_("finn").post(route("requests", "REQ-0003", "withdraw")).json()["state"] == "withdrawn"
    err(decide(world, "cai", "REQ-0003", 1, "approve"), 409, "withdrawn", "REQ-0003 was withdrawn by Finn de Vries.")
    err(world.as_("finn").post(route("requests", "REQ-0003", "withdraw")), 409, "wrong_state", "REQ-0003 is already Withdrawn.")

    with browse(browser, world, who="ana", path="/library") as page:
        click(page.get_by_role("article", name=art(MENU_ICON, "Request required")).get_by_role("button", name="Request use"))
        dialog = page.get_by_role("dialog", name="Request Menu UI icon")
        check_box = dialog.get_by_role("group", name="Cited rules").get_by_role("checkbox", name="iconography.ui.size", exact=True)
        check_box.check()
        fill(dialog.get_by_label("Campaign end"), "2026-04-01")
        dialog.get_by_role("button", name="Submit request").dblclick()
        wait_url(page, rf"/requests/{REQ_NEW}$")
    assert world.as_("ana").get(route("requests", REQ_NEXT)).json() == NOT_FOUND, "a double press created a second request"
    key = idempotency_key()
    a, b = together(lambda: world.as_("ana").post("/api/requests", json=request_body(*ANA_COBRAND, key=key)),
                    lambda: world.as_("ana").post("/api/requests", json=request_body(*ANA_COBRAND, key=key)))
    assert a.status_code == b.status_code == 201 and a.json()["id"] == b.json()["id"] == REQ_NEXT
    assert world.as_("ana").get(route("requests", REQ_AFTER)).json() == NOT_FOUND
    other = request_body(*ANA_COBRAND, key=key)
    other["note"] = "Different body."
    err(world.as_("ana").post("/api/requests", json=other), 409, "idempotency_conflict",
        "This submission key was already used for a different request.")


def test_wf_races_retirement(browser: Browser, world: World, mail: Any) -> None:
    mail.clear()
    link = world.as_("finn").post(route("derivatives", "drv_parcel_1", "link")).json()["url"]
    err(world.as_("bea").post(route("assets", "ast_parcel", "retire"), json={"successorAssetId": "ast_pin"}), 403, "forbidden")
    for bad in ("ast_courier", "ast_rebrand-teaser"):
        err(world.as_("olu").post(route("assets", "ast_parcel", "retire"), json={"successorAssetId": bad}), 422, "successor_invalid",
            "Choose a released successor asset.")
    with browse(browser, world, who="olu", path="/admin/assets") as page:
        click(page.get_by_role("button", name="Retire Parcel spot icon"))
        dialog = page.get_by_role("dialog", name="Retire Parcel spot icon")
        select(dialog.get_by_role("combobox", name="Successor"), "Pin pictogram")
        click(dialog.get_by_role("button", name="Retire asset"))
        wait_status(page, "Parcel spot icon retired.")
    d = detail(world, "bram", "REQ-0004")
    assert d["state"] == "rejected" and d["stages"][0]["comment"] == "Asset retired. Use Pin pictogram instead."
    dec = [r for r in audit(world, requestId="REQ-0004") if r["action"] == "request.decided"][0]
    assert dec["actorId"] == "system" and dec["actorRole"] == "system"
    c = cards(world, "finn")["Parcel spot icon"]
    assert (c["badge"], c["reason"], c["successorName"]) == ("Retired", "Retired. Use Pin pictogram instead.", "Pin pictogram")
    assert httpx.get(world.base + link, timeout=HTTP_TIMEOUT).status_code == 404
    err(world.as_("olu").post(route("assets", "ast_parcel", "retire"), json={"successorAssetId": "ast_pin"}), 409, "wrong_state",
        "Parcel spot icon is retired.")
    assert "Asset retired. Use Pin pictogram instead." in text(mail_to(mail, "bram@brightwell.example", "Decision on REQ-0004: Rejected")[0])
    with browse(browser, world, who="finn", path="/library") as page:
        expect(page.get_by_role("article", name=art(PARCEL, "Retired"))).to_contain_text("Pin pictogram")


def test_wf_audit_chain(world: World) -> None:
    assert record_hash(ZERO_HASH, json.loads('{"sequence":1,"occurredAt":"2026-03-02T08:00:00.000Z","actorId":"usr_ana","actorRole":"agency","action":"request.submitted","resourceType":"request","resourceId":"REQ-0001","requestId":"REQ-0001","before":null,"after":{"state":"routed"},"outcome":"success"}')) \
        == "8c66733454bcd3e060ccbf2d713f1d94e8ccfc8d30c42bcc2a1259db4f7b3c4e"
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    assert decide(world, "bea", rid, 1, "approve").status_code == 200
    recs = audit(world)
    assert [r["sequence"] for r in recs] == list(range(1, len(recs) + 1))
    prev = ZERO_HASH
    for r in recs:
        assert r["previousHash"] == prev and r["recordHash"] == record_hash(prev, r), f"record {r['sequence']} hash mismatch"
        prev = r["recordHash"]
    s, a, d, a2 = recs[0], recs[1], recs[2], recs[3]
    assert (s["action"], s["actorId"], s["actorRole"], s["before"], s["after"], s["requestId"], s["occurredAt"]) == \
        ("request.submitted", "usr_ana", "agency", None, {"state": "routed"}, rid, START)
    assert (a["action"], a["actorId"], a["before"], a["after"]) == ("request.assigned", "system", {"state": "routed"},
                                                                   {"holder": "usr_bea", "state": "under_review"})
    assert (d["action"], d["actorId"], d["actorRole"], d["after"]) == ("request.decided", "usr_bea", "brand_reviewer",
                                                                      {"decision": "approve", "stage": 1, "state": "under_review"})
    assert a2["before"] == {"holder": "usr_bea"} and a2["after"] == {"holder": "usr_cai"}
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        for path in ("/api/audit", "/api/audit/1"):
            err(world.as_("olu").request(method, path, json={}), 405, "method_not_allowed", "The audit log cannot be changed.")
    assert audit(world) == recs
    assert audit(world, who="leo") == recs
    assert world.as_("olu").get("/api/audit/verify").json() == {"ok": True, "records": len(recs), "brokenAt": None}
    assert httpx.post(world.base + "/api/grading/audit/tamper", json={"sequence": 2, "after": {}}, timeout=HTTP_TIMEOUT).status_code == 404
    t = httpx.post(world.base + "/api/grading/audit/tamper", json={"sequence": 2, "after": {"holder": "usr_cai"}},
                   headers=grading_headers(), timeout=HTTP_TIMEOUT)
    assert t.status_code == 200 and t.json() == {"sequence": 2}
    v = world.as_("olu").get("/api/audit/verify").json()
    assert v["ok"] is False and v["brokenAt"] == 2


def test_wf_audit_screen(browser: Browser, world: World) -> None:
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    for who in ("ana", "bea"):
        assert world.as_(who).get("/api/audit", params={"requestId": rid}).json() == NOT_FOUND
    with browse(browser, world, who="ana", path="/admin/audit") as page:
        expect(page.get_by_role("heading", level=1, name="Not found")).to_be_visible()
    with browse(browser, world, who="olu", path="/admin/audit") as page:
        fill(page.get_by_role("textbox", name="Request id"), rid)
        click(page.get_by_role("button", name="Apply filters"))
        table = page.get_by_role("table", name="Audit log")
        submitted = table.get_by_role("row").filter(has_text="Ana Ferreira")
        eventually(page, lambda: expect(submitted).to_have_count(1, timeout=POLL_MS), "filtered audit table lacks the submission row")
        for cell in (fmt_stamp(START), f"request {rid}", "none", "state: routed"):
            expect(submitted).to_contain_text(cell)
        assigned = table.get_by_role("row").filter(has_text="System")
        cells = [[ln.strip() for ln in c.strip().splitlines() if ln.strip()] for c in assigned.first.get_by_role("cell").all_inner_texts()]
        assert ["holder: usr_bea", "state: under_review"] in cells and ["state: routed"] in cells, f"assigned row cells {cells}"
        total = world.as_("olu").get("/api/audit/verify").json()["records"]
        click(page.get_by_role("button", name="Verify chain"))
        status = page.get_by_role("status", name="Chain status")
        eventually(page, lambda: expect(status).to_have_text(f"Chain verified: {total} records.", timeout=POLL_MS), "verify text missing")
        httpx.post(world.base + "/api/grading/audit/tamper", json={"sequence": 1, "after": {"state": "granted"}},
                   headers=grading_headers(), timeout=HTTP_TIMEOUT)
        click(page.get_by_role("button", name="Verify chain"))
        eventually(page, lambda: expect(status).to_have_text("Chain broken at record 1.", timeout=POLL_MS), "broken record not named")
        fill(page.get_by_role("textbox", name="Request id"), "REQ-9999")
        click(page.get_by_role("button", name="Apply filters"))
        eventually(page, lambda: expect(page.get_by_text("No audit records match.")).to_be_visible(timeout=POLL_MS), "empty state missing")


DURATIONS_JS = "f => f.getAnimations({subtree: true}).map(a => Number(a.effect.getComputedTiming().duration) || 0)"


def test_wf_weight_and_colour_weight_slider(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/chapters/typography") as page:
        slider = page.get_by_role("slider", name="Weight")
        figure = page.get_by_role("figure", name="Weight specimen")
        specimen = figure.get_by_text("Quenby & Co. sets every letter by rule.")
        announce = page.get_by_role("status", name="Weight announcement")
        expect(slider).to_have_value("400")
        slider.focus()
        for key, value in (("ArrowRight", "401"), ("PageUp", "451"), ("End", "900"), ("ArrowRight", "900"),
                           ("Home", "250"), ("ArrowLeft", "250"), ("PageDown", "250"), ("PageUp", "300")):
            page.keyboard.press(key)
            expect(slider).to_have_value(value)
            expect(page.get_by_text(f"Weight {value}", exact=True).first).to_be_visible()
        settle(figure)
        assert page.evaluate("el => getComputedStyle(el).fontWeight", specimen.element_handle()) == "300"
        page.keyboard.press("ArrowRight")
        durations = figure.evaluate(DURATIONS_JS)
        assert any(abs(d - WEIGHT_EASE_MS) <= 1 for d in durations), f"weight transition durations {durations}"
        current = int(slider.input_value())
        advance(page, WEIGHT_DELAY_MS - 1)
        expect(announce).not_to_have_text(f"Weight {current}", timeout=POLL_MS)
        advance(page, 1)
        expect(announce).to_have_text(f"Weight {current}")
        page.keyboard.press("ArrowRight")
        advance(page, 200)
        page.keyboard.press("ArrowRight")
        advance(page, 200)
        expect(announce).not_to_have_text(re.compile(rf"Weight ({current + 1}|{current + 2})"), timeout=POLL_MS)
        advance(page, 100)
        expect(announce).to_have_text(f"Weight {current + 2}")
    with browse(browser, world, path="/chapters/typography", reduced="reduce") as page:
        page.get_by_role("slider", name="Weight").focus()
        page.keyboard.press("ArrowRight")
        durations = page.get_by_role("figure", name="Weight specimen").evaluate(DURATIONS_JS)
        assert all(d == 0 for d in durations), f"reduced motion still transitions: {durations}"


def test_wf_weight_and_colour_palette_wheel(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/chapters/colour") as page:
        wheel = page.get_by_role("group", name="Palette wheel")
        buttons = {f: wheel.get_by_role("button", name=f"{f} family") for f in WHEEL_ORDER}
        g = box(wheel)
        cx, cy = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
        angles = {}
        for f, b in buttons.items():
            bb = box(b)
            ang = math.degrees(math.atan2(bb["x"] + bb["width"] / 2 - cx, cy - (bb["y"] + bb["height"] / 2)))
            angles[f] = (ang + 18) % 360
        assert sorted(WHEEL_ORDER, key=angles.get) == WHEEL_ORDER, f"discs are not clockwise from the top: {angles}"
        assert [t for t in wheel.get_by_role("button").evaluate_all("bs => bs.map(b => b.tabIndex)") if t >= 0] == [0]
        buttons["Ember"].focus()
        for key, fam in (("ArrowRight", "Saffron"), ("ArrowDown", "Meadow"), ("ArrowLeft", "Saffron"), ("ArrowUp", "Ember"),
                         ("ArrowUp", "Stone"), ("ArrowRight", "Ember")):
            page.keyboard.press(key)
            expect(buttons[fam]).to_be_focused()
        table = page.get_by_role("table", name="Swatches")
        data_rows = table.get_by_role("row").filter(has_not=page.get_by_role("columnheader"))
        status = page.get_by_role("status", name="Swatch filter")
        page.keyboard.press("Enter")
        expect(wheel.get_by_role("button", name="Ember family", pressed=True)).to_be_visible()
        expect(status).to_have_text("2 swatches in Ember")
        expect(data_rows).to_have_count(2)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        expect(status).to_have_text("2 swatches in Saffron")
        expect(wheel.get_by_role("button", name="Ember family", pressed=True)).to_have_count(0)
        click(page.get_by_role("button", name="Show all families"))
        expect(status).to_have_text("20 swatches")
        expect(data_rows).to_have_count(20)
        for fam, name, hexv, ow, owr, oi, oir in SWATCHES:
            cells = data_rows.filter(has_text=name).evaluate("r => Array.from(r.children).map(c => c.textContent.trim())")
            assert cells == [name, f"#{hexv}", ow, owr, oi, oir], f"swatch row {cells}"
        rating_line = "Ratings are measured against White FFFFFF and Ink 17161C."
        shown = re.sub(r"\b[0-9A-F]{6}\b", lambda m: f"#{m.group(0)}", rating_line)
        expect(page.get_by_text(shown)).to_be_visible()
        tap(buttons["Iris"])
        expect(status).to_have_text("2 swatches in Iris")


AT_ONE = {"Opacity": "0.50", "Scale": "0.87", "Offset X": "-30.00", "Offset Y": "16.00", "Rotate": "-5.00", "Blur": "4.00"}
AT_FIVE = {"Opacity": "1.00", "Scale": "1.00", "Offset X": "0.00", "Offset Y": "0.00", "Rotate": "-1.00", "Blur": "0.00"}


def test_wf_motion_timeline(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/chapters/motion") as page:
        tracks = page.get_by_role("list", name="Tracks").get_by_role("listitem")
        expect(tracks).to_have_text(["Opacity, 4 keyframes", "Scale, 3 keyframes", "Offset X, 4 keyframes",
                                     "Offset Y, 3 keyframes", "Rotate, 3 keyframes", "Blur, 4 keyframes"])
        head = page.get_by_role("slider", name="Playhead")
        values = page.get_by_role("table", name="Values at playhead")

        def readout(t: str) -> None:
            expect(page.get_by_text(f"{t} / 00:12", exact=True)).to_be_visible()

        def table_is(expected: dict[str, str]) -> None:
            for prop, val in expected.items():
                row = values.get_by_role("row").filter(has=page.get_by_text(prop, exact=True))
                expect(row.get_by_text(val, exact=True)).to_be_visible()

        readout("00:00")
        head.focus()
        page.keyboard.press("ArrowRight")
        readout("00:01")
        table_is(AT_ONE)
        page.keyboard.press("End")
        readout("00:12")
        page.keyboard.press("Home")
        page.keyboard.press("PageUp")
        readout("00:04")
        page.keyboard.press("ArrowRight")
        readout("00:05")
        table_is(AT_FIVE)
        prop, when = "Offset X", "00:08"
        click(page.get_by_role("button", name=f"{prop} keyframe at {when}"))
        readout("00:08")
        expect(head).to_have_value("8")
        tl = page.get_by_role("group", name="Timeline")
        tl.scroll_into_view_if_needed()
        b = box(tl)
        ty = b["y"] + b["height"] / 2
        page.mouse.move(b["x"] + b["width"] * 3 / 12, ty)
        page.mouse.down()
        page.mouse.move(b["x"] + b["width"] * 9 / 12, ty, steps=6)
        page.mouse.up()
        readout("00:09")
        tap(tl)
        readout("00:06")
        head.focus()
        page.keyboard.press("Home")
        click(page.get_by_role("button", name="Play", exact=True))
        expect(page.get_by_role("button", name="Pause", exact=True)).to_be_visible()
        advance(page, 3000)
        readout("00:03")
        advance(page, 15000)
        readout("00:12")
    with browse(browser, world, path="/chapters/motion", reduced="reduce") as page:
        click(page.get_by_role("button", name="Play", exact=True))
        expect(page.get_by_text("00:12 / 00:12", exact=True)).to_be_visible()


def curve(x1: str, y1: str, x2: str, y2: str) -> str:
    return "cubic" + "-" + "bezier" + f"({x1}, {y1}, {x2}, {y2})"


def test_wf_motion_curve_editor(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/chapters/motion") as page:
        h1 = page.get_by_role("button", name="Handle 1", exact=True)
        h2 = page.get_by_role("button", name="Handle 2", exact=True)
        printed = page.get_by_role("status", name="Printed curve")
        expect(h1).to_have_accessible_description("x 0.30, y 0.00")
        expect(h2).to_have_accessible_description("x 0.20, y 1.00")
        expect(printed).to_have_text(curve("0.30", "0.00", "0.20", "1.00"))
        h1.focus()
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("Shift+ArrowDown")
        expect(h1).to_have_accessible_description("x 0.40, y -0.10")
        expect(printed).to_have_text(curve("0.40", "-0.10", "0.20", "1.00"))
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowUp")
        expect(h1).to_have_accessible_description("x 0.41, y -0.09")
        h2.focus()
        for _ in range(3):
            page.keyboard.press("Shift+ArrowLeft")
        for _ in range(6):
            page.keyboard.press("Shift+ArrowUp")
        expect(h2).to_have_accessible_description("x 0.00, y 1.50")
        click(page.get_by_role("button", name="Reset curve"))
        expect(printed).to_have_text(curve("0.30", "0.00", "0.20", "1.00"))
        editor = page.get_by_role("group", name="Curve editor")
        editor.scroll_into_view_if_needed()
        g = box(editor)
        vw, vh = DESKTOP
        hb = box(h1)
        page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
        page.mouse.down()
        page.mouse.move(min(vw - 1, g["x"] + g["width"] + 40), max(1, g["y"] - 40), steps=8)
        page.mouse.up()
        expect(h1).to_have_accessible_description("x 1.00, y 1.50")
        hb = box(h2)
        touch_drag(page, (hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2),
                   (max(1, g["x"] - 40), min(vh - 1, g["y"] + g["height"] + 40)))
        expect(h2).to_have_accessible_description("x 0.00, y -0.50")
        expect(printed).to_have_text(curve("1.00", "1.50", "0.00", "-0.50"))
        click(page.get_by_role("button", name="Reset curve"))
        expect(printed).to_have_text(curve("0.30", "0.00", "0.20", "1.00"))


def test_wf_phone_review_bottom_sheet(browser: Browser, world: World) -> None:
    vw, vh = PHONE_REVIEW
    with browse(browser, world, who="finn", path="/requests/REQ-0003") as finn, \
            browse(browser, world, who="cai", path="/queue", size=PHONE_REVIEW) as cai:
        expect(finn.get_by_text("Held by Cai Brennan")).to_be_visible()
        queue = cai.get_by_role("list", name="Review queue")
        link = queue.get_by_role("link", name="REQ-0003")
        assert box(link)["height"] >= TARGET_PX and box(link)["width"] >= TARGET_PX
        tap(link)
        wait_url(cai, r"/requests/REQ-0003$")
        decide_btn = cai.get_by_role("button", name="Decide")
        db = box(decide_btn)
        assert db["width"] >= TARGET_PX and db["height"] >= TARGET_PX and db["y"] > vh / 2 and db["y"] + db["height"] <= vh + 1
        tap(decide_btn)
        sheet = cai.get_by_role("dialog", name="Decide REQ-0003")
        expect(sheet).to_be_visible()
        settle(sheet)
        sb = box(sheet)
        assert sb["y"] >= vh / 3 - 1 and sb["y"] + sb["height"] <= vh + 1, f"sheet geometry {sb}"
        assert focus_inside(sheet)
        cai.keyboard.press("Shift+Tab")
        assert focus_inside(sheet), "Shift+Tab escaped the bottom sheet"
        for role in ("button", "textbox", "combobox"):
            controls = sheet.get_by_role(role)
            for i in range(controls.count()):
                cb = box(controls.nth(i))
                assert cb["width"] >= TARGET_PX and cb["height"] >= TARGET_PX, f"{role} {i} is {cb['width']}x{cb['height']}"
        tap(sheet.get_by_role("button", name="Approve", exact=True))
        wait_status(cai, "Decision saved.")
        expect(sheet).to_have_count(0)
        live(finn, lambda: expect(finn.get_by_text("Held by Bea Lindqvist")).to_be_visible(timeout=POLL_MS),
             "Finn's desktop page never showed the next holder")
    d = detail(world, "finn", "REQ-0003")
    assert d["stages"][0]["decision"] == "approve" and d["stages"][0]["decidedByName"] == "Cai Brennan"


def test_wf_phone_review_changes_requested(browser: Browser, world: World, mail: Any) -> None:
    mail.clear()
    assert decide(world, "cai", "REQ-0003", 1, "approve").status_code == 200
    err(decide(world, "bea", "REQ-0003", 2, "request_changes", None), 422, "comment_required", "Say what needs to change.")
    with browse(browser, world, who="bea", path="/requests/REQ-0003") as page:
        panel = page.get_by_role("region", name="Decision")
        fill(panel.get_by_role("textbox", name="Comment"), CHANGES_COMMENT)
        click(panel.get_by_role("button", name="Request changes"))
        wait_status(page, "Decision saved.")
    d = detail(world, "finn", "REQ-0003")
    assert d["state"] == "changes_requested" and d["holder"]["displayName"] == "Finn de Vries"
    assert CHANGES_COMMENT in text(mail_to(mail, "finn@fathom.example", "Decision on REQ-0003: Changes requested")[0])
    paused_at = "2026-03-03T09:00:00.000Z"
    world.clock(to=paused_at)
    d = detail(world, "finn", "REQ-0003")
    assert d["holder"]["displayName"] == "Finn de Vries" and d["escalation"] is None
    assert quiet_mail(mail, "olu@quenby.example", "Deadline missed: REQ-0003 is now yours") == []
    with browse(browser, world, who="finn", path="/requests/REQ-0003") as page:
        click(page.get_by_role("button", name="Resubmit request"))
        wait_status(page, "REQ-0003 resubmitted.")
    d = detail(world, "finn", "REQ-0003")
    assert d["state"] == "under_review" and d["holder"]["displayName"] == "Bea Lindqvist"
    assert d["stages"][0]["decision"] == "approve" and d["stages"][1]["assigneeName"] == "Bea Lindqvist"
    assert d["stages"][1]["decision"] is None and d["deadline"] == iso_shift(paused_at, hours=24)
    err(world.as_("finn").post(route("requests", "REQ-0003", "resubmit"), json={}), 409, "wrong_state", "REQ-0003 is already Under review.")


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}


def test_if_run_manifest() -> None:
    data = json.loads((APP_DIR / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(data.get(k), str) and data[k].strip(), f"run.json {k} missing"


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from notices: {missing}"


def test_if_licence_allowlist() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad}"


def test_if_no_extra_datastore(world: World) -> None:
    names = [p.name.lower() for p in shipped_packages()]
    banned = [b.lower() for b in ("SQLite", "Redis")]
    assert not [n for n in names if any(b in n for b in banned)], names
    assert Postgres().tables(), "no tables in PostgreSQL"
    assert S3().keys("derivatives/"), "no derivative objects in MinIO"


def test_if_no_foreign_assets(browser: Browser, world: World) -> None:
    seen: list[tuple[str, str]] = []
    with browse(browser, world, who="ana", path="/") as page:
        page.on("request", lambda req: seen.append((req.url, req.resource_type)))
        for path in ("/", "/chapters/typography", "/chapters/motion", "/chapters/colour", "/library"):
            page.goto(world.base + path)
            page.wait_for_load_state("load")
    for url, kind in seen:
        scheme = urlparse(url).scheme
        if scheme in ("data", "blob", "about"):
            continue
        if scheme in ("ws", "wss"):
            assert urlparse(url).netloc == urlparse(world.base).netloc, url
        else:
            assert same_origin(url, world.base), f"cross-origin request {url}"
        assert kind != "font", f"font loaded: {url}"


def test_if_service_config_unchanged(world: World) -> None:
    assert world.cookie_name == "rulehouse_session"
    me = world.as_("emi").get("/api/me").json()
    assert me["timeZone"] == "Europe/Berlin" and me["weightAnnounceDelayMs"] == WEIGHT_DELAY_MS
    link = world.as_("emi").post(route("derivatives", "drv_menu_1", "link")).json()
    assert link["expiresAt"] == iso_shift(START, seconds=LINK_TTL_S)
    err(upload_proof(world, "finn", "GR-0004", "big.png", PNG_SIGNATURE + b"\x00" * PROOF_MAX_BYTES),
        413, "proof_too_large", "Proof must be 5 MB or smaller.")


def test_if_lockfile_used() -> None:
    lock = json.loads((APP_DIR / "package-lock.json").read_text())
    assert lock, "package-lock.json is empty"
    install = json.loads((APP_DIR / "run.json").read_text())["install"]
    assert re.search(r"\bnpm\s+(ci|install|i)\b", install), f"install does not use npm: {install}"


GA_INK_HEX = "17161C"
GA_FOCUS_OUTLINE_PX = 2
GA_FOCUS_OFFSET_PX = 3
GA_LIVE_RULES = 16
GA_LUMEN_TERRITORIES = ["DE", "AT", "CH"]
GA_MENU_END = "2026-04-01"
GA_CHANGES_NOTE = "Cite the clear-space rule as well."
GA_PIA_REASONS = [
    ("Harbour photograph", "Restricted", "Not licensed in FR."),
    ("Logo — Tab", "Restricted", "Not licensed for press contacts."),
    ("Rebrand teaser illustration", "Restricted", "Restricted by the brand team."),
    ("Logo 1998", "Retired", "Retired. Use Logo instead."),
]
GA_TEASER = "Rebrand teaser illustration"
GA_TEASER_FILE = "rebrand-teaser-1200.png"
GA_ME_STATUS_JS = "() => fetch('/api/me', {credentials: 'same-origin'}).then(r => r.status)"
GA_OUTLINE_JS = """e => { const s = getComputedStyle(e);
  return {style: s.outlineStyle, width: s.outlineWidth, offset: s.outlineOffset, color: s.outlineColor}; }"""
GA_CHOICE_JS = """e => { if (e.tagName === 'SELECT') { const o = e.selectedOptions[0]; return o ? (o.label || o.text || '').trim() : ''; }
  return (('value' in e && e.value) ? String(e.value) : (e.textContent || '')).trim(); }"""
GA_LIVE_REGIONS_JS = """(els, name) => els.map(e => {
  const by = (e.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)
    .map(id => ((document.getElementById(id) || {}).textContent || '').trim()).join(' ');
  const label = (e.getAttribute('aria-label') || by || '').replace(/\\s+/g, ' ').trim();
  const live = e.getAttribute('aria-live') || (e.getAttribute('role') === 'alert' ? 'assertive' : '');
  return {name: label, live: live, text: (e.textContent || '').replace(/\\s+/g, ' ').trim()};
}).filter(r => r.name === name)"""


def _ga_rgb(hex6: str) -> str:
    return f"rgb({int(hex6[0:2], 16)}, {int(hex6[2:4], 16)}, {int(hex6[4:6], 16)})"


def _ga_me_status(page: Page) -> int:
    try:
        return int(page.evaluate(GA_ME_STATUS_JS))
    except Exception as exc:
        raise AssertionError(f"in-page GET /api/me did not answer: {exc}") from exc


def _ga_min_target(locator: Locator) -> None:
    b = box(locator)
    assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX, \
        f"{locator} is {b['width']:.0f}x{b['height']:.0f} px; phone controls must be at least {TARGET_PX}x{TARGET_PX}"


def _ga_choice(locator: Locator) -> str:
    return str(locator.evaluate(GA_CHOICE_JS))


def _ga_is_focused(locator: Locator) -> bool:
    return bool(locator.evaluate("e => e === document.activeElement"))


def _ga_announced(page: Page, name: str, sentence_text: str) -> None:
    regions = page.evaluate(
        "name => (" + GA_LIVE_REGIONS_JS + ")(Array.from(document.querySelectorAll('[aria-live], [role=alert]')), name)", name)
    assert len(regions) == 1, f"expected one live region named {name!r}, found {regions}"
    assert regions[0]["live"] == "assertive", f"live region {name!r} is {regions[0]['live']!r}, not assertive"
    assert sentence_text in regions[0]["text"], f"live region {name!r} reads {regions[0]['text']!r}"


def test_wf_cross_cutting_keyboard_signin_nav(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/signin") as page:
        page.get_by_role("textbox", name="Email").focus()
        page.keyboard.type("ana@studiolumen.example")
        page.get_by_label("Password", exact=True).focus()
        page.keyboard.type("rulehouse-demo-1")
        page.get_by_role("button", name="Sign in").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(page).not_to_have_url(re.compile(r"/signin$"), timeout=POLL_MS),
                   "pressing Enter on Sign in never left /signin")
        page.goto(world.base + "/library")
        nav = page.get_by_role("navigation", name="Main")
        expect(nav.get_by_role("link", name="Library", exact=True)).to_be_visible()
        expect(nav.get_by_role("link", name="My requests", exact=True)).to_be_visible()
        expect(nav.get_by_role("link", name="Queue", exact=True)).to_have_count(0)
        expect(nav.get_by_role("link", name="Admin", exact=True)).to_have_count(0)
        page.get_by_role("button", name="Sign out").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: _assert_status(_ga_me_status(page), 401), "pressing Enter on Sign out did not end the session")
        page.goto(world.base + "/library")
        wait_url(page, r"/signin$")


def test_wf_cross_cutting_focus_outline(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/", reduced="reduce") as page:
        nav = page.get_by_role("navigation", name="Chapters")
        logo = nav.get_by_role("link", name="Logo", exact=True)
        voice = nav.get_by_role("link", name="Voice", exact=True)
        page.get_by_role("button", name="Jump to chapters").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(logo).to_be_focused(timeout=POLL_MS), "Jump to chapters did not focus the Logo tile")
        page.keyboard.press("Tab")
        expect(voice).to_be_focused()
        settle(voice)
        ring = voice.evaluate(GA_OUTLINE_JS)
        assert ring["style"] not in ("none", "hidden"), f"focused tile has no outline: {ring}"
        assert ring["width"] == f"{GA_FOCUS_OUTLINE_PX}px", f"focus outline width {ring['width']}"
        assert ring["offset"] == f"{GA_FOCUS_OFFSET_PX}px", f"focus outline offset {ring['offset']}"
        assert ring["color"] == _ga_rgb(GA_INK_HEX), f"focus outline colour {ring['color']} is not the brand ink"


def test_wf_cross_cutting_phone_cue_tap(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/", size=PHONE) as page:
        nav = page.get_by_role("navigation", name="Chapters")
        logo = nav.get_by_role("link", name="Logo", exact=True)
        cue = page.get_by_role("button", name="Jump to chapters")
        _ga_min_target(cue)
        tap(cue)
        eventually(page, lambda: expect(logo).to_be_focused(timeout=POLL_MS), "tapping Jump to chapters did not focus the Logo tile")
        _ga_min_target(logo)
        page.keyboard.press("Tab")
        expect(nav.get_by_role("link", name="Voice", exact=True)).to_be_focused()


def test_wf_variant_request_dialog_semantics(browser: Browser, world: World) -> None:
    with browse(browser, world, who="ana", path="/library") as page:
        opener = page.get_by_role("article", name=art(FULL_LOCK, "Request required")).get_by_role("button", name="Request use")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=f"Request {FULL_LOCK}")
        expect(dialog).to_be_visible()
        assert _ga_choice(dialog.get_by_role("combobox", name="Application")) == "Social", "Application must default to Social"
        territories = dialog.get_by_role("group", name="Territories")
        expect(territories.get_by_role("checkbox")).to_have_count(len(GA_LUMEN_TERRITORIES))
        for code in GA_LUMEN_TERRITORIES:
            expect(territories.get_by_role("checkbox", name=code)).to_have_count(1)
        cited = dialog.get_by_role("group", name="Cited rules")
        expect(cited.get_by_role("checkbox")).to_have_count(GA_LIVE_RULES)
        expect(cited.get_by_role("checkbox", name="logo.clear-space.minimum", exact=True)).not_to_be_checked()
        expect(cited.get_by_role("checkbox", name="logo.clear-space.half", exact=True)).to_have_count(0)
        dialog.get_by_role("button", name="Cancel", exact=True).focus()
        page.keyboard.press("Enter")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()


def test_wf_variant_request_phone_tap(browser: Browser, world: World) -> None:
    with browse(browser, world, who="ana", path="/library", size=PHONE) as page:
        opener = page.get_by_role("article", name=art(MENU_ICON, "Request required")).get_by_role("button", name="Request use")
        _ga_min_target(opener)
        tap(opener)
        dialog = page.get_by_role("dialog", name=f"Request {MENU_ICON}")
        expect(dialog).to_be_visible()
        fill(dialog.get_by_label("Campaign end"), GA_MENU_END)
        rule = dialog.get_by_role("group", name="Cited rules").get_by_role("checkbox", name="iconography.ui.size", exact=True)
        rule.focus()
        page.keyboard.press("Space")
        expect(rule).to_be_checked()
        submit = dialog.get_by_role("button", name="Submit request")
        _ga_min_target(submit)
        _ga_min_target(dialog.get_by_role("button", name="Cancel", exact=True))
        tap(submit)
        wait_url(page, rf"/requests/{REQ_NEW}$")
        expect(page.get_by_role("status", name="Request state")).to_have_text("Under review")
        expect(page.get_by_text("Held by Bea Lindqvist")).to_be_visible()
        expect(page.get_by_text(f"Due {fmt_stamp(iso_shift(START, hours=24))}")).to_be_visible()


def test_wf_approval_chain_keyboard_queue_decision(browser: Browser, world: World) -> None:
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    with browse(browser, world, who="bea", path="/queue") as page:
        link = page.get_by_role("table", name="Review queue").get_by_role("link", name=rid)
        expect(link).to_be_visible()
        link.focus()
        page.keyboard.press("Enter")
        wait_url(page, rf"/requests/{rid}$")
        heading = page.get_by_role("heading", level=1, name=rid)
        eventually(page, lambda: expect(heading).to_be_focused(timeout=POLL_MS), "the request page did not focus its level-1 heading")
        panel = page.get_by_role("region", name="Decision")
        comment = panel.get_by_role("textbox", name="Comment")
        expect(comment).to_be_visible()
        for _ in range(60):
            if _ga_is_focused(comment):
                break
            page.keyboard.press("Tab")
        expect(comment).to_be_focused()
        approve = panel.get_by_role("button", name="Approve", exact=True)
        for target in (approve, panel.get_by_role("button", name="Reject", exact=True),
                       panel.get_by_role("button", name="Request changes", exact=True),
                       panel.get_by_role("combobox", name="Condition"),
                       panel.get_by_role("textbox", name="Condition value"),
                       panel.get_by_role("button", name="Add condition")):
            page.keyboard.press("Tab")
            expect(target).to_be_focused()
        for _ in range(5):
            page.keyboard.press("Shift+Tab")
        expect(approve).to_be_focused()
        page.keyboard.press("Enter")
        wait_status(page, "Decision saved.")
        live(page, lambda: expect(page.get_by_text("Held by Cai Brennan")).to_be_visible(timeout=POLL_MS),
             "the request page never showed the second brand holder")


def test_wf_approval_chain_changes_requested_live(browser: Browser, world: World) -> None:
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    with browse(browser, world, who="ana", path=f"/requests/{rid}") as ana, \
            browse(browser, world, who="bea", path=f"/requests/{rid}") as bea:
        state = ana.get_by_role("status", name="Request state")
        expect(state).to_have_text("Under review")
        expect(ana.get_by_role("button", name="Resubmit request")).to_have_count(0)
        panel = bea.get_by_role("region", name="Decision")
        fill(panel.get_by_role("textbox", name="Comment"), GA_CHANGES_NOTE)
        click(panel.get_by_role("button", name="Request changes", exact=True))
        wait_status(bea, "Decision saved.")
        live(ana, lambda: _ga_announced(ana, "Request updates", f"{rid} is now Changes requested."),
             "Ana's assertive Request updates region never announced the change")
        expect(state).to_have_text("Changes requested")
        expect(ana.get_by_text("Held by Ana Ferreira")).to_be_visible()
        expect(ana.get_by_role("button", name="Resubmit request")).to_be_visible()


def test_wf_approval_chain_reduced_sheet(browser: Browser, world: World) -> None:
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    approve_open(world, rid)
    approve_open(world, rid)
    assert holder_key(detail(world, "olu", rid)) == "leo", "the third stage of a Co-brand mark request goes to Leo"
    with browse(browser, world, who="leo", path=f"/requests/{rid}", size=PHONE_REVIEW, reduced="reduce") as page:
        decide_btn = page.get_by_role("button", name="Decide")
        tap(decide_btn)
        sheet = page.get_by_role("dialog", name=f"Decide {rid}")
        expect(sheet).to_be_visible()
        first = box(sheet)
        for a in sheet.evaluate(ANIMS_JS):
            assert not (set(a["props"]) & SLIDING_PROPS), f"the bottom sheet slides under reduced motion: {a['props']}"
        advance(page, FADE_MAX_MS)
        settle(sheet)
        last = box(sheet)
        assert abs(first["x"] - last["x"]) <= 1 and abs(first["y"] - last["y"]) <= 1, f"the sheet moved from {first} to {last}"
        expect(sheet).to_contain_text("Grant will end on 15 Apr 2026 (engagement end)")
        assert focus_inside(sheet), "the sheet must move focus to its first field"
        page.keyboard.press("Escape")
        expect(sheet).to_have_count(0)
        expect(decide_btn).to_be_focused()


def test_wf_three_viewers_press_reasons(browser: Browser, world: World) -> None:
    with browse(browser, world, who="pia", path="/library") as page:
        expect(page.get_by_role("status", name="Library results")).to_have_text("9 assets")
        for name, badge, reason in GA_PIA_REASONS:
            download = page.get_by_role("article", name=art(name, badge)).get_by_role("button", name="Download", exact=True)
            expect(download).to_be_disabled()
            expect(download).to_have_accessible_description(reason)
            download.focus()
            expect(download).to_be_focused()
        expect(page.get_by_role("article", name=art(STOREFRONT, "Available")).get_by_role(
            "button", name="Download storefront-1600.png")).to_be_visible()
        expect(page.get_by_role("button", name="Request use")).to_have_count(0)


def test_wf_three_viewers_release_live(browser: Browser, world: World) -> None:
    with browse(browser, world, who="emi", path="/library") as emi, \
            browse(browser, world, who="ana", path="/library") as ana, \
            browse(browser, world, who="olu", path="/admin/assets") as olu:
        expect(emi.get_by_role("article", name=art(GA_TEASER, "Restricted"))).to_be_visible()
        expect(ana.get_by_role("article", name=art(GA_TEASER, "Restricted"))).to_be_visible()
        click(olu.get_by_role("button", name=f"Release {GA_TEASER}"))
        wait_status(olu, f"{GA_TEASER} released.")
        live(emi, lambda: expect(emi.get_by_role("article", name=art(GA_TEASER, "Available"))).to_be_visible(timeout=POLL_MS),
             "Emi's open library never turned the teaser Available")
        expect(emi.get_by_role("article", name=art(GA_TEASER, "Available")).get_by_role(
            "button", name=f"Download {GA_TEASER_FILE}")).to_be_visible()
        live(ana, lambda: expect(ana.get_by_role("article", name=art(GA_TEASER, "Request required"))).to_be_visible(timeout=POLL_MS),
             "Ana's open library never turned the teaser Request required")
        expect(ana.get_by_role("article", name=art(GA_TEASER, "Request required")).get_by_role(
            "button", name="Request use")).to_be_enabled()


GB_VERSION_N = 2
GB_REVOKE_REASON = "Parcel work moved in-house."
GB_PROOF_NAME = "sign-mockup.png"
GB_PROOF_REASON = "Pin is cropped at the edge."
GB_PHONE_PROOF = "fair-sign.pdf"
GB_VERSION_COMMENT = "Name the courier icon size."
GB_SEED_LIVE_RULES = 16
GB_RULE_HREFS_JS = r"""() => Array.from(document.querySelectorAll('a[href]'))
  .map(a => new URL(a.href, location.href).pathname)
  .filter(p => /^\/rules\/[^/]+$/.test(p))
  .map(p => decodeURIComponent(p.slice('/rules/'.length)))"""


def _gb_seen(page: Page, locator: Locator, what: str) -> None:
    eventually(page, lambda: expect(locator).to_be_visible(timeout=POLL_MS), what)


def _gb_focused(page: Page, locator: Locator, what: str) -> None:
    eventually(page, lambda: expect(locator).to_be_focused(timeout=POLL_MS), what)


def _gb_live_rules() -> list[str]:
    out: list[str] = []
    for chapter in seed_body()["chapters"]:
        for version in chapter["versions"]:
            if version["state"] == "published":
                out.extend(s["identifier"] for s in version["statements"])
    return out


def _gb_absolute(world: World, href: str) -> str:
    return href if href.startswith("http") else world.base + href


def test_wf_link_death_keyboard_download_expires(browser: Browser, world: World) -> None:
    expires = iso_shift(START, seconds=LINK_TTL_S)
    with browse(browser, world, who="emi", path="/library") as page:
        card = page.get_by_role("article", name=art(MENU_ICON, "Available"))
        button = card.get_by_role("button", name="Download menu-24.svg")
        _gb_seen(page, button, "Emi's Menu UI icon card has no Download menu-24.svg button")
        button.focus()
        page.keyboard.press("Enter")
        again = card.get_by_role("link", name="Download again: menu-24.svg")
        _gb_seen(page, again, "Enter on the focused download button issued no link")
        expect(card).to_contain_text(f"Link expires at {fmt_time(expires)}")
        href = again.get_attribute("href") or ""
        assert re.search(r"/dl/[^/]+$", href), f"issued link {href!r} is not a /dl/<token> URL"
        world.clock(to=iso_shift(expires, seconds=1))
        page.goto(_gb_absolute(world, href))
        expect(page.get_by_text("This link has expired.").first).to_be_visible()


def test_wf_link_death_revoke_dialog_keyboard(browser: Browser, world: World) -> None:
    with browse(browser, world, who="finn", path="/library") as finn, \
            browse(browser, world, who="olu", path="/admin/grants") as olu:
        _gb_seen(finn, finn.get_by_role("article", name=art(PARCEL, "Available")), "Finn's Parcel card is not Available at start")
        opener = olu.get_by_role("button", name="Revoke GR-0002", exact=True)
        _gb_seen(olu, opener, "the grants screen has no Revoke GR-0002 button")
        opener.focus()
        olu.keyboard.press("Enter")
        dialog = olu.get_by_role("dialog", name="Revoke GR-0002")
        reason = dialog.get_by_role("textbox", name="Reason")
        _gb_focused(olu, reason, "the revoke dialog did not move focus to Reason")
        olu.keyboard.press("Escape")
        eventually(olu, lambda: expect(dialog).to_have_count(0, timeout=POLL_MS), "Escape did not close the revoke dialog")
        _gb_focused(olu, opener, "closing the revoke dialog did not return focus to its opener")
        olu.keyboard.press("Enter")
        _gb_focused(olu, reason, "the reopened revoke dialog did not focus Reason")
        olu.keyboard.type(GB_REVOKE_REASON)
        dialog.get_by_role("button", name="Revoke grant").focus()
        olu.keyboard.press("Enter")
        wait_status(olu, "GR-0002 revoked.")
        live(finn, lambda: expect(finn.get_by_role("article", name=art(PARCEL, "Request required"))).to_be_visible(timeout=POLL_MS),
             "Finn's open library never changed the Parcel badge after revocation")
    g = world.as_("finn").get(route("grants", "GR-0002")).json()
    assert g["status"] == "revoked" and g["revokedReason"] == GB_REVOKE_REASON


def test_wf_link_death_engagement_end_description(browser: Browser, world: World) -> None:
    world.clock(to=iso_shift(ANA_GRANT_END, minutes=-2))
    with browse(browser, world, who="ana", path="/library") as page:
        card = page.get_by_role("article", name=art(TAB, "Available"))
        _gb_seen(page, card, "Ana's Tab card is not Available two minutes before her engagement ends")
        click(card.get_by_role("button", name="Download logo-tab.svg"))
        again = card.get_by_role("link", name="Download again: logo-tab.svg")
        _gb_seen(page, again, "no Download again link after issuing")
        url = _gb_absolute(world, again.get_attribute("href") or "")
        world.clock(to=ANA_ENGAGEMENT_OVER)
        restricted = page.get_by_role("article", name=art(TAB, "Restricted"))
        live(page, lambda: expect(restricted).to_be_visible(timeout=POLL_MS), "Ana's open library never turned the Tab card Restricted")
        disabled = restricted.get_by_role("button", name="Download", exact=True)
        expect(disabled).to_be_disabled()
        expect(disabled).to_have_accessible_description("Your engagement ended on 15 Apr 2026.")
        disabled.focus()
        _gb_focused(page, disabled, "the disabled Download button must stay focusable")
        page.goto(url)
        expect(page.get_by_text("Not found", exact=True).first).to_be_visible()


def test_wf_proof_keyboard_reject_saving(browser: Browser, world: World) -> None:
    up = upload_proof(world, "finn", "GR-0004", GB_PROOF_NAME, png_bytes(8, 8))
    assert up.status_code == 201, up.text
    pid = up.json()["id"]
    with browse(browser, world, who="bea", path="/requests/REQ-0002") as page:
        reason = page.get_by_role("textbox", name="Proof rejection reason")
        _gb_seen(page, reason, "Bea's request page has no Proof rejection reason field")
        reason.focus()
        page.keyboard.type(GB_PROOF_REASON)
        page.get_by_role("button", name="Reject proof", exact=True).focus()
        with held(page, f"**/api/proofs/{pid}/reject") as gate:
            page.keyboard.press("Enter")
            expect(page.get_by_role("button", name="Saving", exact=True)).to_be_disabled()
            release_gate(gate)
        wait_status(page, "Proof rejected.")
    proof = [p for p in detail(world, "finn", "REQ-0002")["proofs"] if p["id"] == pid][0]
    assert (proof["status"], proof["statusLabel"], proof["reason"]) == ("rejected", REJECTED, GB_PROOF_REASON)
    assert detail(world, "finn", "REQ-0002")["grant"]["status"] == "pending_proof"


def test_wf_proof_phone_tap_upload(browser: Browser, world: World) -> None:
    with browse(browser, world, who="finn", path="/requests/REQ-0002", size=PHONE) as page:
        proofs = page.get_by_role("region", name="Proofs")
        upload = proofs.get_by_role("button", name="Upload proof")
        _gb_seen(page, upload, "the phone request page has no Upload proof button")
        proofs.get_by_label("Proof file").set_input_files({"name": GB_PHONE_PROOF, "mimeType": "application/pdf", "buffer": pdf_bytes()})
        b = box(upload)
        assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX, f"Upload proof is {b['width']}x{b['height']} on a phone"
        tap(upload)
        wait_status(page, "Proof uploaded. Waiting for review.")
        eventually(page, lambda: expect(proofs).to_contain_text(f"{GB_PHONE_PROOF} — {PENDING}", timeout=POLL_MS),
                   "the tapped upload never listed the proof as Pending review")
        expect(page.get_by_role("region", name="Grant")).to_contain_text("Pending proof")
    proofs_api = detail(world, "finn", "REQ-0002")["proofs"]
    assert [(p["fileName"], p["status"]) for p in proofs_api] == [(GB_PHONE_PROOF, "pending_review")]


def test_wf_publication_keyboard_request_changes(browser: Browser, world: World) -> None:
    assert world.as_("ari").post(route("versions", V_ICON2, "submit")).status_code == 200
    with browse(browser, world, who="bea", path="/editor/iconography") as page:
        comment = page.get_by_role("textbox", name="Review comment")
        _gb_seen(page, comment, "Bea's editor has no Review comment field for the version in review")
        comment.focus()
        page.keyboard.type(GB_VERSION_COMMENT)
        page.get_by_role("button", name=f"Request changes to version {GB_VERSION_N}", exact=True).focus()
        page.keyboard.press("Enter")
        wait_status(page, "Changes requested on version 2.")
        versions = page.get_by_role("list", name="Versions")
        eventually(page, lambda: expect(versions).to_contain_text("Version 2 — draft", timeout=POLL_MS),
                   "the version list never showed version 2 back in draft")
        expect(versions).to_contain_text("Version 1 — published")
    states = {v["number"]: v["state"] for v in world.as_("ari").get(route("chapters", "iconography", "versions")).json()["versions"]}
    assert states == {1: "published", 2: "draft"}
    recs = [r for r in audit(world) if r["action"] == "chapter.changes_requested"]
    assert len(recs) == 1 and recs[0]["actorId"] == "usr_bea"
    assert recs[0]["before"] == {"state": "in_review"} and recs[0]["after"] == {"comment": GB_VERSION_COMMENT, "state": "draft"}


def test_wf_publication_keyboard_publish_tile_lines(browser: Browser, world: World) -> None:
    assert world.as_("ari").post(route("versions", V_ICON2, "submit")).status_code == 200
    assert world.as_("bea").post(route("versions", V_ICON2, "approve")).status_code == 200
    fix_courier(world)
    with browse(browser, world, who="olu", path="/editor/iconography") as page:
        publish = page.get_by_role("button", name="Publish version 2", exact=True)
        _gb_seen(page, publish, "Olu's editor has no Publish version 2 button")
        publish.focus()
        page.keyboard.press("Enter")
        wait_status(page, "Version 2 published.")
        versions = page.get_by_role("list", name="Versions")
        eventually(page, lambda: expect(versions).to_contain_text("Version 2 — published", timeout=POLL_MS),
                   "the version list never showed version 2 published")
        expect(versions).to_contain_text("Version 1 — superseded")
    assert world.as_(None).get("/api/chapters").json()["liveRuleCount"] == GB_SEED_LIVE_RULES + 1
    with browse(browser, world, path="/", reduced="reduce") as home:
        nav = home.get_by_role("navigation", name="Chapters")
        expect(nav.get_by_role("link", name="Iconography", exact=True)).to_have_accessible_description("v2 · 4 rules")
        expect(nav.get_by_role("link", name="Rule index", exact=True)).to_have_accessible_description(f"{GB_SEED_LIVE_RULES + 1} rules")


def test_wf_statements_rule_index_keyboard(browser: Browser, world: World) -> None:
    live_ids = _gb_live_rules()
    assert len(live_ids) == GB_SEED_LIVE_RULES
    with browse(browser, world, path="/rules") as page:
        target = page.get_by_role("link", name="iconography.pictogram.size")
        _gb_seen(page, target, "the rule index has no iconography.pictogram.size link")
        assert sorted(set(page.evaluate(GB_RULE_HREFS_JS))) == sorted(live_ids), "the rule index must link exactly the live identifiers"
        target.focus()
        page.keyboard.press("Enter")
        wait_url(page, r"/rules/iconography\.pictogram\.size$")
        expect(page.get_by_role("heading", level=1, name="Iconography", exact=True)).to_be_visible()
        item = page.get_by_role("list", name="Rules").get_by_role("listitem").filter(has_text="Pictograms are 64 x 64 pixels.")
        _gb_focused(page, item, "the iconography.pictogram.size statement was not focused")
        expect(item).to_have_attribute("id", "iconography.pictogram.size")
        expect(page).to_have_url(re.compile(r"/rules/iconography\.pictogram\.size$"))


def test_wf_statements_phone_tap_replacement(browser: Browser, world: World) -> None:
    vh = PHONE[1]
    with browse(browser, world, path="/rules/logo.clear-space.half", size=PHONE) as page:
        replacement = page.get_by_role("link", name="logo.clear-space.minimum")
        _gb_seen(page, replacement, "the withdrawal notice has no replacement link")
        tap(replacement)
        wait_url(page, r"/rules/logo\.clear-space\.minimum$")
        expect(page.get_by_role("heading", level=1, name="Logo", exact=True)).to_be_visible()
        item = page.get_by_role("list", name="Rules").get_by_role("listitem").filter(
            has_text="Keep clear space of at least 1x the symbol height on every side.")
        _gb_focused(page, item, "the logo.clear-space.minimum statement was not focused after the tap")
        expect(item).to_have_attribute("id", "logo.clear-space.minimum")

        def in_view() -> None:
            b = box(item)
            assert b["y"] >= 0 and b["y"] + b["height"] <= vh, f"focused statement at {b} is outside the phone viewport"

        eventually(page, in_view, "the focused statement was not scrolled into view on the phone")


def test_wf_statements_dialog_cites_live_rules(browser: Browser, world: World) -> None:
    live_ids = _gb_live_rules()
    with browse(browser, world, who="ana", path="/library") as page:
        opener = page.get_by_role("article", name=art(MENU_ICON, "Request required")).get_by_role("button", name="Request use")
        _gb_seen(page, opener, "Ana's Menu UI icon card has no Request use button")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Request Menu UI icon")
        _gb_seen(page, dialog, "Enter on Request use did not open the request dialog")
        rules = dialog.get_by_role("group", name="Cited rules")
        expect(rules.get_by_role("checkbox")).to_have_count(len(live_ids))
        for ident in live_ids:
            expect(rules.get_by_role("checkbox", name=ident, exact=True)).to_have_count(1)
        expect(rules.get_by_role("checkbox", name="logo.clear-space.half", exact=True)).to_have_count(0)
        cite = rules.get_by_role("checkbox", name="iconography.ui.size", exact=True)
        cite.focus()
        page.keyboard.press("Space")
        expect(cite).to_be_checked()
        page.keyboard.press("Space")
        expect(cite).not_to_be_checked()


GC_COBRAND_WARN = "2026-03-04T14:00:00.000Z"
GC_COBRAND_BREACH = "2026-03-05T08:00:00.000Z"
GC_BEA_DUE = "3 Mar 2026 17:00"
GC_AUDIT_COLUMNS = ["Time", "Actor", "Resource", "Before", "After"]
GC_RETIRED_COMMENT = "Asset retired. Use Pin pictogram instead."
GC_REJECT_PROBE = "Too late to matter."
GC_TAMPERED_AFTER = {"decision": "reject", "stage": 1, "state": "rejected"}

GC_ROWS_JS = """t => {
  const rows = Array.from(t.querySelectorAll('tr, [role=row]'));
  const isHead = r => { const cs = Array.from(r.children);
    return cs.length > 0 && (!!r.closest('thead') || cs.every(c => c.tagName === 'TH') || cs.some(c => c.getAttribute('role') === 'columnheader')); };
  const head = rows.find(isHead);
  if (!head) return [];
  const names = Array.from(head.children).map(c => c.innerText.replace(/\\s+/g, ' ').trim());
  return rows.filter(r => !isHead(r)).map(r => Object.fromEntries(Array.from(r.children).map((c, i) =>
    [names[i] || String(i), c.innerText.split('\\n').map(s => s.trim()).filter(Boolean)])));
}"""
GC_ASSERTIVE_JS = """msg => Array.from(document.querySelectorAll('[aria-live="assertive"], [role="alert"]'))
  .some(e => (e.textContent || '').includes(msg))"""


def _gc_stale(page: Page, url: str) -> None:
    page.route_web_socket(re.compile(r"/api/live"), lambda ws: None)
    page.goto(url)


def _gc_tab_until(page: Page, target: Locator, what: str, limit: int = 40) -> None:
    for _ in range(limit):
        page.keyboard.press("Tab")
        if target.evaluate("e => e === document.activeElement"):
            return
    pytest.fail(f"Tab never reached {what} within {limit} presses")


def _gc_rows(table: Locator) -> list[dict[str, list[str]]]:
    return table.evaluate(GC_ROWS_JS)


def _gc_find_row(page: Page, table: Locator, what: str, **want: list[str]) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}

    def check() -> None:
        rows = _gc_rows(table)
        hits = [r for r in rows if all(r.get(k) == v for k, v in want.items())]
        assert len(hits) == 1, f"{what}: rows seen {rows}"
        found.clear()
        found.update(hits[0])

    eventually(page, check, what)
    return found


def _gc_filter_audit(page: Page, rid: str) -> Locator:
    field_ = page.get_by_role("textbox", name="Request id", exact=True)
    field_.focus()
    page.keyboard.type(rid)
    expect(field_).to_have_value(rid)
    page.get_by_role("button", name="Apply filters").focus()
    page.keyboard.press("Enter")
    return page.get_by_role("table", name="Audit log")


def _gc_assertive(page: Page, message: str) -> None:
    assert page.evaluate(GC_ASSERTIVE_JS, message), f"{message!r} was not announced in an assertive live region"


def test_wf_deadlines_breach_live_two_sessions(browser: Browser, world: World) -> None:
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    due = f"Due {fmt_stamp(GC_COBRAND_BREACH)}"
    with browse(browser, world, who="ana", path=f"/requests/{rid}") as ana, \
            browse(browser, world, who="bea", path=f"/requests/{rid}") as bea:
        expect(ana.get_by_text("Held by Bea Lindqvist").first).to_be_visible()
        expect(ana.get_by_text(due).first).to_be_visible()
        expect(ana.get_by_text("Escalated: deadline missed")).to_have_count(0)
        expect(bea.get_by_role("region", name="Decision")).to_be_visible()
        world.clock(to=GC_COBRAND_BREACH)
        live(ana, lambda: expect(ana.get_by_text("Held by Olu Mensah").first).to_be_visible(timeout=POLL_MS),
             "Ana's request page never showed the owner as holder")
        expect(ana.get_by_text("Escalated: deadline missed").first).to_be_visible()
        expect(ana.get_by_text(due).first).to_be_visible()
        expect(ana.get_by_role("status", name="Request state")).to_have_text("Under review")
        live(bea, lambda: expect(bea.get_by_role("region", name="Decision")).to_have_count(0, timeout=POLL_MS),
             "Bea's page kept the decision panel after the stage moved to the owner")
        expect(bea.get_by_text("Held by Olu Mensah").first).to_be_visible()


def test_wf_deadlines_queue_keyboard_path(browser: Browser, world: World) -> None:
    with browse(browser, world, who="bea", path="/queue") as page:
        link = page.get_by_role("table", name="Review queue").get_by_role("link", name="REQ-0004")
        expect(link).to_be_visible()
        _gc_tab_until(page, link, "the REQ-0004 queue link")
        page.keyboard.press("Enter")
        wait_url(page, r"/requests/REQ-0004$")
        heading = page.get_by_role("heading", level=1, name="REQ-0004")
        eventually(page, lambda: expect(heading).to_be_focused(timeout=POLL_MS), "the request page did not focus its level-1 heading")
        expect(page.get_by_text(f"Due {GC_BEA_DUE}").first).to_be_visible()
        panel = page.get_by_role("region", name="Decision")
        _gc_tab_until(page, panel.get_by_role("textbox", name="Comment", exact=True), "the Comment field")
        for control in (panel.get_by_role("button", name="Approve", exact=True),
                        panel.get_by_role("button", name="Reject", exact=True),
                        panel.get_by_role("button", name="Request changes", exact=True),
                        panel.get_by_role("combobox", name="Condition", exact=True),
                        panel.get_by_role("textbox", name="Condition value", exact=True),
                        panel.get_by_role("button", name="Add condition", exact=True)):
            page.keyboard.press("Tab")
            expect(control).to_be_focused()


def test_wf_deadlines_phone_queue_tap(browser: Browser, world: World) -> None:
    rid = create(world, "ana", "ast_logo", "var_logo_full_lock", "social", ["DE"], "2026-04-10", ["logo.variants.full-lock"])["id"]
    stamp = fmt_stamp(iso_shift(START, hours=24))
    with browse(browser, world, who="bea", path="/queue", size=PHONE) as page:
        queue = page.get_by_role("list", name="Review queue")
        first, second = queue.get_by_role("link", name=rid), queue.get_by_role("link", name="REQ-0004")
        expect(first).to_be_visible()
        expect(second).to_be_visible()
        assert box(first)["y"] < box(second)["y"], "phone queue cards are not ordered by deadline"
        expect(queue.get_by_role("listitem").filter(has=page.get_by_role("link", name=rid)).first).to_contain_text(stamp)
        expect(queue.get_by_role("listitem").filter(has=page.get_by_role("link", name="REQ-0004")).first).to_contain_text(GC_BEA_DUE)
        tap(first)
        wait_url(page, rf"/requests/{rid}$")
        expect(page.get_by_role("heading", level=1, name=rid)).to_be_visible()
        expect(page.get_by_text(f"Due {stamp}").first).to_be_visible()
        expect(page.get_by_text("Held by Bea Lindqvist").first).to_be_visible()


def test_wf_races_stale_owner_refused(browser: Browser, world: World) -> None:
    with browse(browser, world, who="cai", path="/requests/REQ-0003") as cai, \
            browse(browser, world, who="olu", path="/rules") as olu:
        _gc_stale(olu, world.base + "/requests/REQ-0003")
        panel = olu.get_by_role("region", name="Decision")
        comment = panel.get_by_role("textbox", name="Comment", exact=True)
        expect(comment).to_be_visible()
        comment.focus()
        olu.keyboard.type(GC_REJECT_PROBE)
        click(cai.get_by_role("region", name="Decision").get_by_role("button", name="Approve", exact=True))
        wait_status(cai, "Decision saved.")
        olu.keyboard.press("Tab")
        expect(panel.get_by_role("button", name="Approve", exact=True)).to_be_focused()
        olu.keyboard.press("Tab")
        expect(panel.get_by_role("button", name="Reject", exact=True)).to_be_focused()
        olu.keyboard.press("Enter")
        eventually(olu, lambda: expect(panel.get_by_role("alert")).to_have_text("Already decided by Cai Brennan: Approved.", timeout=POLL_MS),
                   "the losing decision never showed the already_decided message")
    d = detail(world, "olu", "REQ-0003")
    assert d["stages"][0]["decision"] == "approve" and d["stages"][0]["decidedByName"] == "Cai Brennan"
    assert d["state"] == "under_review" and d["holder"]["displayName"] == "Bea Lindqvist"
    assert len([r for r in audit(world, requestId="REQ-0003") if r["action"] == "request.decided"]) == 1


def test_wf_races_withdraw_then_stale_decide(browser: Browser, world: World) -> None:
    with browse(browser, world, who="finn", path="/requests/REQ-0003") as finn, \
            browse(browser, world, who="cai", path="/rules") as cai:
        _gc_stale(cai, world.base + "/requests/REQ-0003")
        panel = cai.get_by_role("region", name="Decision")
        expect(panel).to_be_visible()
        withdraw = finn.get_by_role("button", name="Withdraw request")
        with held(finn, "**" + route("requests", "REQ-0003", "withdraw")) as gate:
            withdraw.focus()
            finn.keyboard.press("Enter")
            expect(finn.get_by_role("button", name="Saving")).to_be_disabled()
            release_gate(gate)
        wait_status(finn, "REQ-0003 withdrawn.")
        eventually(finn, lambda: expect(finn.get_by_role("status", name="Request state")).to_have_text("Withdrawn", timeout=POLL_MS),
                   "Finn's page never showed Withdrawn")
        expect(finn.get_by_text("Held by Finn de Vries").first).to_be_visible()
        panel.get_by_role("button", name="Approve", exact=True).focus()
        cai.keyboard.press("Enter")
        eventually(cai, lambda: expect(panel.get_by_role("alert")).to_have_text("REQ-0003 was withdrawn by Finn de Vries.", timeout=POLL_MS),
                   "the decision after withdrawal never showed the withdrawn message")
    assert detail(world, "finn", "REQ-0003")["state"] == "withdrawn"
    assert [r for r in audit(world, requestId="REQ-0003") if r["action"] == "request.decided"] == []


def test_wf_races_retire_keyboard_live(browser: Browser, world: World) -> None:
    with browse(browser, world, who="bram", path="/requests/REQ-0004") as bram, \
            browse(browser, world, who="olu", path="/admin/assets") as olu:
        expect(bram.get_by_role("status", name="Request state")).to_have_text("Under review")
        opener = olu.get_by_role("button", name="Retire Parcel spot icon")
        opener.focus()
        olu.keyboard.press("Enter")
        dialog = olu.get_by_role("dialog", name="Retire Parcel spot icon")
        successor = dialog.get_by_role("combobox", name="Successor")
        expect(successor).to_be_focused()
        olu.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        olu.keyboard.press("Enter")
        expect(successor).to_be_focused()
        select(successor, "Pin pictogram")
        dialog.get_by_role("button", name="Retire asset").focus()
        olu.keyboard.press("Enter")
        wait_status(olu, "Parcel spot icon retired.")
        live(bram, lambda: expect(bram.get_by_role("status", name="Request state")).to_have_text("Rejected", timeout=POLL_MS),
             "Bram's request page never turned Rejected")
        eventually(bram, lambda: _gc_assertive(bram, "REQ-0004 is now Rejected."), "the rejection was never announced")
        expect(bram.get_by_text("Held by Bram Koster").first).to_be_visible()


def test_wf_audit_cells_by_header(browser: Browser, world: World) -> None:
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    assert decide(world, "bea", rid, 1, "approve").status_code == 200
    with browse(browser, world, who="olu", path="/admin/audit") as page:
        table = _gc_filter_audit(page, rid)
        for name in GC_AUDIT_COLUMNS:
            expect(table.get_by_role("columnheader", name=name, exact=True)).to_have_count(1)
        decided = _gc_find_row(page, table, "the decision row", Actor=["Bea Lindqvist"])
        assert decided["Time"] == [fmt_stamp(START)] and decided["Resource"] == [f"request {rid}"]
        assert decided["Before"] == ["state: under_review"]
        assert decided["After"] == ["decision: approve", "stage: 1", "state: under_review"]
        routed = _gc_find_row(page, table, "the second-stage assignment row", Actor=["System"], Before=["holder: usr_bea"])
        assert routed["After"] == ["holder: usr_cai"] and routed["Resource"] == [f"request {rid}"]
        submitted = _gc_find_row(page, table, "the submission row", Actor=["Ana Ferreira"])
        assert submitted["Before"] == ["none"] and submitted["After"] == ["state: routed"]


def test_wf_audit_verify_keyboard(browser: Browser, world: World) -> None:
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    assert decide(world, "bea", rid, 1, "approve").status_code == 200
    total = world.as_("olu").get("/api/audit/verify").json()["records"]
    seq = [r for r in audit(world, requestId=rid) if r["action"] == "request.decided"][0]["sequence"]
    assert 1 < seq < total, "the tampered record must sit inside the chain"
    with browse(browser, world, who="olu", path="/admin/audit") as page:
        status = page.get_by_role("status", name="Chain status")
        with held(page, "**/api/audit/verify") as gate:
            page.get_by_role("button", name="Verify chain").focus()
            page.keyboard.press("Enter")
            expect(page.get_by_role("button", name="Checking chain")).to_be_disabled()
            release_gate(gate)
        eventually(page, lambda: expect(status).to_have_text(f"Chain verified: {total} records.", timeout=POLL_MS),
                   "the verified sentence never appeared")
        t = httpx.post(world.base + "/api/grading/audit/tamper", json={"sequence": seq, "after": GC_TAMPERED_AFTER},
                       headers=grading_headers(), timeout=HTTP_TIMEOUT)
        assert t.status_code == 200, t.text
        page.get_by_role("button", name="Verify chain").focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(status).to_have_text(f"Chain broken at record {seq}.", timeout=POLL_MS),
                   "verification did not name the tampered middle record")


def test_wf_audit_escalation_row_legal(browser: Browser, world: World) -> None:
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    world.clock(to=GC_COBRAND_WARN)
    world.clock(to=GC_COBRAND_BREACH)
    with browse(browser, world, who="leo", path="/admin/audit") as page:
        table = _gc_filter_audit(page, rid)
        row = _gc_find_row(page, table, "the escalation row", After=["escalation: deadline_missed", "holder: usr_olu"])
        assert row["Time"] == [fmt_stamp(GC_COBRAND_BREACH)], row
        assert row["Actor"] == ["System"] and row["Resource"] == [f"request {rid}"]
        assert row["Before"] == ["holder: usr_bea"]


def test_wf_audit_retirement_row(browser: Browser, world: World) -> None:
    r = world.as_("olu").post(route("assets", "ast_parcel", "retire"), json={"successorAssetId": "ast_pin"})
    assert r.status_code == 200, r.text
    with browse(browser, world, who="olu", path="/admin/audit") as page:
        table = _gc_filter_audit(page, "REQ-0004")
        _gc_find_row(page, table, "the retirement decision row", Actor=["System"], Before=["state: under_review"],
                     After=[f"comment: {GC_RETIRED_COMMENT}", "decision: reject", "stage: 1", "state: rejected"],
                     Resource=["request REQ-0004"], Time=[fmt_stamp(START)])


GD_WEIGHT_MIN = 250
GD_WEIGHT_MAX = 900
GD_WEIGHT_START = 400
GD_WEIGHT_PAGE = 50
GD_TIMELINE_END = 12
GD_PLAYHEAD_PAGE = 4
GD_KEYFRAMES = {
    "Opacity": [(0, 0), (2, 1), (10, 1), (12, 0)],
    "Scale": [(0, 0.8), (3, 1), (12, 1)],
    "Offset X": [(0, -40), (4, 0), (8, 0), (12, 40)],
    "Offset Y": [(0, 24), (3, 0), (12, 0)],
    "Rotate": [(0, -6), (6, 0), (12, 6)],
    "Blur": [(0, 8), (2, 0), (10, 0), (12, 4)],
}
GD_PLOT_PX = 320
GD_Y_SPAN = 2.0
GD_DRAG_TO = (0.75, 0.25)
GD_SNAP_TOL = 0.02
GD_REPLAY_MS = 1000
GD_UI_SETTLE_MS = 400
GD_REJECT_REASON = "The Tab is cropped too tightly."
GD_CHANGES_COMMENT = "Show the Tab at its full clear space."
GD_TERRITORY = "NL"

GD_REGION_BOXES_JS = """r => { const o = r.getBoundingClientRect();
  return Array.from(r.querySelectorAll('*')).map(e => { const b = e.getBoundingClientRect();
    return [b.x - o.x, b.y - o.y, b.width, b.height]; }); }"""
GD_SLIDING_ANIMS_JS = """() => document.getAnimations().map(a => {
  const props = new Set();
  const kf = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : [];
  for (const f of kf) for (const k of Object.keys(f)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k);
  if (a.transitionProperty) props.add(a.transitionProperty);
  const t = a.effect ? a.effect.getComputedTiming() : {};
  return {props: Array.from(props), duration: Number(t.duration) || 0};
}).filter(a => a.duration > 1)"""
GD_LIVE_REGIONS_JS = r"""name => {
  const text = n => (n && n.textContent || '').replace(/\s+/g, ' ').trim();
  const labelOf = e => e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => text(document.getElementById(id))).join(' ');
  const live = n => n.getAttribute('aria-live') || (n.getAttribute('role') === 'alert' ? 'assertive' : '');
  return Array.from(document.querySelectorAll('[aria-label], [aria-labelledby]')).filter(e => labelOf(e).replace(/\s+/g, ' ').trim() === name).map(e => {
    const nodes = [e, ...e.querySelectorAll('[aria-live], [role="alert"]')];
    for (let a = e.parentElement; a; a = a.parentElement) nodes.push(a);
    return {live: nodes.some(n => live(n) === 'assertive') ? 'assertive' : 'other', text: text(e)};
  });
}"""


def _gd_mmss(seconds: int) -> str:
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def _gd_value_at(prop: str, t: int) -> str:
    frames = GD_KEYFRAMES[prop]
    for (t0, v0), (t1, v1) in zip(frames, frames[1:]):
        if t0 <= t <= t1:
            v = v0 + (v1 - v0) * (t - t0) / (t1 - t0)
            hundredths = math.floor(v * 100 + 0.5 + 1e-9)
            return f"{hundredths / 100:.2f}"
    pytest.fail(f"{prop} has no keyframe segment around {t} s")


def _gd_values_table_is(page: Page, t: int) -> None:
    values = page.get_by_role("table", name="Values at playhead")
    for prop in GD_KEYFRAMES:
        row = values.get_by_role("row").filter(has=page.get_by_text(prop, exact=True))
        expect(row.get_by_text(_gd_value_at(prop, t), exact=True)).to_be_visible()


def _gd_readout(page: Page, t: int) -> None:
    expect(page.get_by_text(f"{_gd_mmss(t)} / {_gd_mmss(GD_TIMELINE_END)}", exact=True)).to_be_visible()


def _gd_weight_is(page: Page, n: int) -> None:
    expect(page.get_by_role("slider", name="Weight")).to_have_value(str(n))
    expect(page.get_by_text(f"Weight {n}", exact=True).first).to_be_visible()


def _gd_same_boxes(a: list[list[float]], b: list[list[float]], tol: float = 2.0) -> bool:
    return len(a) == len(b) and all(abs(x - y) <= tol for ra, rb in zip(a, b) for x, y in zip(ra, rb))


def _gd_announced(page: Page, name: str, sentence_text: str) -> None:
    regions = page.evaluate(GD_LIVE_REGIONS_JS, name)
    assert any(r["live"] == "assertive" and sentence_text in r["text"] for r in regions), \
        f"no assertive live region named {name!r} announces {sentence_text!r}: {regions}"


def test_wf_weight_and_colour_page_keys_clamp(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/chapters/typography") as page:
        slider = page.get_by_role("slider", name="Weight")
        figure = page.get_by_role("figure", name="Weight specimen")
        specimen = figure.get_by_text("Quenby & Co. sets every letter by rule.")
        assert slider.evaluate("e => [e.type, e.min, e.max]") == ["range", str(GD_WEIGHT_MIN), str(GD_WEIGHT_MAX)]
        _gd_weight_is(page, GD_WEIGHT_START)
        slider.focus()
        page.keyboard.press("PageDown")
        _gd_weight_is(page, GD_WEIGHT_START - GD_WEIGHT_PAGE)
        settle(figure)
        assert page.evaluate("el => getComputedStyle(el).fontWeight", specimen.element_handle()) == str(GD_WEIGHT_START - GD_WEIGHT_PAGE)
        page.keyboard.press("End")
        page.keyboard.press("PageDown")
        _gd_weight_is(page, GD_WEIGHT_MAX - GD_WEIGHT_PAGE)
        near_top = GD_WEIGHT_MAX - 20
        for _ in range(near_top - (GD_WEIGHT_MAX - GD_WEIGHT_PAGE)):
            page.keyboard.press("ArrowRight")
        _gd_weight_is(page, near_top)
        page.keyboard.press("PageUp")
        _gd_weight_is(page, GD_WEIGHT_MAX)
        page.keyboard.press("Home")
        near_bottom = GD_WEIGHT_MIN + 20
        for _ in range(near_bottom - GD_WEIGHT_MIN):
            page.keyboard.press("ArrowRight")
        _gd_weight_is(page, near_bottom)
        page.keyboard.press("PageDown")
        _gd_weight_is(page, GD_WEIGHT_MIN)
        settle(figure)
        assert page.evaluate("el => getComputedStyle(el).fontWeight", specimen.element_handle()) == str(GD_WEIGHT_MIN)


def test_wf_weight_and_colour_phone_wheel_taps(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/chapters/colour", size=PHONE) as page:
        wheel = page.get_by_role("group", name="Palette wheel")
        status = page.get_by_role("status", name="Swatch filter")
        table = page.get_by_role("table", name="Swatches")
        data_rows = table.get_by_role("row").filter(has_not=page.get_by_role("columnheader"))
        show_all = page.get_by_role("button", name="Show all families")
        for fam in WHEEL_ORDER:
            b = box(wheel.get_by_role("button", name=f"{fam} family", exact=True))
            assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX, f"{fam} disc is {b['width']}x{b['height']} on a phone"
        sb = box(show_all)
        assert sb["width"] >= TARGET_PX and sb["height"] >= TARGET_PX, f"Show all families is {sb['width']}x{sb['height']} on a phone"
        tap(wheel.get_by_role("button", name="Lagoon family", exact=True))
        expect(wheel.get_by_role("button", name="Lagoon family", pressed=True)).to_be_visible()
        expect(status).to_have_text("2 swatches in Lagoon")
        expect(data_rows).to_have_text([re.compile("Lagoon 700"), re.compile("Lagoon 300")])
        tap(wheel.get_by_role("button", name="Moss family", exact=True))
        expect(status).to_have_text("2 swatches in Moss")
        expect(wheel.get_by_role("button", name="Moss family", pressed=True)).to_be_visible()
        expect(wheel.get_by_role("button", name="Lagoon family", pressed=True)).to_have_count(0)
        expect(data_rows).to_have_text([re.compile("Moss 700"), re.compile("Moss 300")])
        tap(show_all)
        expect(status).to_have_text("20 swatches")
        expect(data_rows).to_have_count(len(SWATCHES))
        expect(wheel.get_by_role("button", pressed=True)).to_have_count(0)


def test_wf_weight_and_colour_wheel_semantics(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/chapters/colour") as page:
        wheel = page.get_by_role("group", name="Palette wheel")
        status = page.get_by_role("status", name="Swatch filter")
        table = page.get_by_role("table", name="Swatches")
        expect(table.get_by_role("columnheader")).to_have_text(["Name", "Hex", "On white", "Rating", "On ink", "Rating"])
        data_rows = table.get_by_role("row").filter(has_not=page.get_by_role("columnheader"))
        last = WHEEL_ORDER[-1]
        wheel.get_by_role("button", name=f"{WHEEL_ORDER[0]} family", exact=True).focus()
        page.keyboard.press("ArrowLeft")
        expect(wheel.get_by_role("button", name=f"{last} family", exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        expect(status).to_have_text(f"2 swatches in {last}")
        for fam in WHEEL_ORDER:
            expect(wheel.get_by_role("button", name=f"{fam} family", exact=True, pressed=(fam == last))).to_have_count(1)
        expect(data_rows).to_have_count(2)
        for fam, name, hexv, ow, owr, oi, oir in SWATCHES:
            if fam != last:
                continue
            cells = data_rows.filter(has_text=name).evaluate("r => Array.from(r.children).map(c => c.textContent.trim())")
            assert cells == [name, f"#{hexv}", ow, owr, oi, oir], f"filtered swatch row {cells}"
        page.get_by_role("button", name="Show all families").focus()
        page.keyboard.press("Enter")
        expect(status).to_have_text("20 swatches")
        expect(data_rows).to_have_count(len(SWATCHES))
        for fam in WHEEL_ORDER:
            expect(wheel.get_by_role("button", name=f"{fam} family", exact=True, pressed=False)).to_have_count(1)


def test_wf_motion_playhead_page_keys_and_keyframes(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/chapters/motion") as page:
        head = page.get_by_role("slider", name="Playhead")
        head.focus()
        page.keyboard.press("End")
        page.keyboard.press("ArrowLeft")
        _gd_readout(page, GD_TIMELINE_END - 1)
        expect(head).to_have_value(str(GD_TIMELINE_END - 1))
        _gd_values_table_is(page, GD_TIMELINE_END - 1)
        page.keyboard.press("PageUp")
        _gd_readout(page, GD_TIMELINE_END)
        page.keyboard.press("Home")
        for _ in range(GD_PLAYHEAD_PAGE - 1):
            page.keyboard.press("ArrowRight")
        _gd_readout(page, GD_PLAYHEAD_PAGE - 1)
        page.keyboard.press("PageDown")
        _gd_readout(page, 0)
        expect(head).to_have_value("0")
        for prop, frames in GD_KEYFRAMES.items():
            for t, _v in frames:
                expect(page.get_by_role("button", name=f"{prop} keyframe at {_gd_mmss(t)}", exact=True)).to_have_count(1)
        target = GD_KEYFRAMES["Blur"][2][0]
        page.get_by_role("button", name=f"Blur keyframe at {_gd_mmss(target)}", exact=True).focus()
        page.keyboard.press("Enter")
        _gd_readout(page, target)
        expect(head).to_have_value(str(target))
        _gd_values_table_is(page, target)


def test_wf_motion_curve_touch_snap_then_shift_clamp(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/chapters/motion") as page:
        h1 = page.get_by_role("button", name="Handle 1", exact=True)
        printed = page.get_by_role("status", name="Printed curve")
        page.get_by_role("group", name="Curve editor").scroll_into_view_if_needed()
        expect(h1).to_have_accessible_description("x 0.30, y 0.00")
        hb = box(h1)
        sx, sy = hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2
        tx = sx + (GD_DRAG_TO[0] - 0.30) * GD_PLOT_PX
        ty = sy - (GD_DRAG_TO[1] - 0.00) * GD_PLOT_PX / GD_Y_SPAN
        touch_drag(page, (sx, sy), (tx, ty))
        pattern = re.escape(curve("@X", "@Y", "0.20", "1.00")).replace("@X", r"(-?\d\.\d\d)").replace("@Y", r"(-?\d\.\d\d)")
        found: dict[str, str] = {}

        def snapped() -> None:
            m = re.fullmatch(pattern, printed.inner_text(timeout=POLL_MS).strip())
            assert m, f"Printed curve does not show Handle 2 unchanged and two-decimal Handle 1 values: {printed.inner_text()!r}"
            assert abs(float(m.group(1)) - GD_DRAG_TO[0]) <= GD_SNAP_TOL and abs(float(m.group(2)) - GD_DRAG_TO[1]) <= GD_SNAP_TOL, \
                f"touch drag landed at {m.groups()}, expected about {GD_DRAG_TO}"
            found["x"], found["y"] = m.group(1), m.group(2)

        eventually(page, snapped, "the touch drag never moved Handle 1 to the mapped interior point")
        expect(h1).to_have_accessible_description(f"x {found['x']}, y {found['y']}")
        expect(h1).to_have_accessible_name("Handle 1")
        h1.focus()
        for _ in range(3):
            page.keyboard.press("Shift+ArrowRight")
        for _ in range(13):
            page.keyboard.press("Shift+ArrowUp")
        expect(h1).to_have_accessible_description("x 1.00, y 1.50")
        expect(printed).to_have_text(curve("1.00", "1.50", "0.20", "1.00"))


def test_wf_motion_replay_reduced_motion(browser: Browser, world: World) -> None:
    with browse(browser, world, path="/chapters/motion", reduced="reduce") as page:
        region = page.get_by_role("region", name="Curve demo")
        region.scroll_into_view_if_needed()
        page.get_by_role("button", name="Replay").focus()
        page.keyboard.press("Enter")
        advance(page, 16)
        at_once = region.evaluate(GD_REGION_BOXES_JS)
        durations = region.evaluate(DURATIONS_JS)
        assert all(d <= 1 for d in durations), f"Replay still animates under reduced motion: {durations}"
        advance(page, GD_REPLAY_MS + 200)
        settle(region)
        later = region.evaluate(GD_REGION_BOXES_JS)
        assert at_once, "region \"Curve demo\" holds no block element"
        assert _gd_same_boxes(at_once, later), "under reduced motion the demo block kept moving after Replay"
    with browse(browser, world, path="/chapters/motion") as page:
        region = page.get_by_role("region", name="Curve demo")
        region.scroll_into_view_if_needed()
        page.get_by_role("button", name="Replay").focus()
        page.keyboard.press("Enter")
        early = [region.evaluate(GD_REGION_BOXES_JS)]
        for step in (100, 200):
            advance(page, step)
            early.append(region.evaluate(GD_REGION_BOXES_JS))
        assert any(not _gd_same_boxes(s, at_once) for s in early), \
            "without reduced motion Replay jumped straight to the end instead of moving the block over one second"


def test_wf_phone_review_sheet_keyboard_escape(browser: Browser, world: World) -> None:
    with browse(browser, world, who="cai", path="/queue", size=PHONE_REVIEW) as page:
        link = page.get_by_role("list", name="Review queue").get_by_role("link", name="REQ-0003")
        link.focus()
        page.keyboard.press("Enter")
        wait_url(page, r"/requests/REQ-0003$")
        heading = page.get_by_role("heading", level=1, name="REQ-0003")
        eventually(page, lambda: expect(heading).to_be_focused(timeout=POLL_MS), "the request page did not focus its heading")
        decide_btn = page.get_by_role("button", name="Decide")
        decide_btn.focus()
        page.keyboard.press("Enter")
        sheet = page.get_by_role("dialog", name="Decide REQ-0003")
        comment = sheet.get_by_role("textbox", name="Comment")
        eventually(page, lambda: expect(comment).to_be_focused(timeout=POLL_MS), "the bottom sheet did not focus its first field")
        for i in range(12):
            page.keyboard.press("Tab")
            assert focus_inside(sheet), f"Tab press {i + 1} escaped the bottom sheet"
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(sheet).to_have_count(0, timeout=POLL_MS), "Escape did not close the bottom sheet")
        eventually(page, lambda: expect(decide_btn).to_be_focused(timeout=POLL_MS), "focus did not return to Decide")
        assert detail(world, "cai", "REQ-0003")["stages"][0]["decision"] is None, "closing the sheet recorded a decision"
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(comment).to_be_focused(timeout=POLL_MS), "the reopened sheet did not focus Comment")
        page.keyboard.type(GD_REJECT_REASON)
        sheet.get_by_role("button", name="Reject", exact=True).focus()
        page.keyboard.press("Enter")
        wait_status(page, "Decision saved.")
        expect(sheet).to_have_count(0)
    d = detail(world, "cai", "REQ-0003")
    assert d["state"] == "rejected" and d["stages"][0]["decision"] == "reject"
    assert d["stages"][0]["comment"] == GD_REJECT_REASON


def test_wf_phone_review_changes_live_announced(browser: Browser, world: World) -> None:
    with browse(browser, world, who="finn", path="/requests/REQ-0003") as finn, \
            browse(browser, world, who="cai", path="/requests/REQ-0003", size=PHONE_REVIEW) as cai:
        expect(finn.get_by_role("status", name="Request state")).to_have_text("Under review")
        tap(cai.get_by_role("button", name="Decide"))
        sheet = cai.get_by_role("dialog", name="Decide REQ-0003")
        expect(sheet).to_be_visible()
        comment = sheet.get_by_role("textbox", name="Comment")
        tap(comment)
        comment.fill(GD_CHANGES_COMMENT)
        tap(sheet.get_by_role("button", name="Request changes", exact=True))
        wait_status(cai, "Decision saved.")
        live(finn, lambda: expect(finn.get_by_role("status", name="Request state")).to_have_text("Changes requested", timeout=POLL_MS),
             "Finn's desktop page never showed Changes requested")
        expect(finn.get_by_text("Held by Finn de Vries")).to_be_visible()
        eventually(finn, lambda: _gd_announced(finn, "Request updates", "REQ-0003 is now Changes requested."),
                   "Finn's page never announced the change assertively", seconds=LIVE_S + LIVE_SLACK_S)
        expect(finn.get_by_role("button", name="Resubmit request")).to_be_visible()
    d = detail(world, "finn", "REQ-0003")
    assert d["state"] == "changes_requested" and d["stages"][0]["comment"] == GD_CHANGES_COMMENT


def test_wf_phone_review_sheet_reduced_motion(browser: Browser, world: World) -> None:
    with browse(browser, world, who="cai", path="/requests/REQ-0003", size=PHONE_REVIEW, reduced="reduce") as cai:
        tap(cai.get_by_role("button", name="Decide"))
        sheet = cai.get_by_role("dialog", name="Decide REQ-0003")
        expect(sheet).to_be_visible()
        first = box(sheet)
        slides = [a for a in cai.evaluate(GD_SLIDING_ANIMS_JS) if set(a["props"]) & SLIDING_PROPS]
        assert not slides, f"the bottom sheet slides under reduced motion: {slides}"
        advance(cai, GD_UI_SETTLE_MS)
        settle(sheet)
        after = box(sheet)
        assert abs(first["y"] - after["y"]) <= 1 and abs(first["x"] - after["x"]) <= 1, f"sheet moved from {first} to {after}"
        select(sheet.get_by_role("combobox", name="Condition"), "Territory")
        value = sheet.get_by_role("textbox", name="Condition value")
        tap(value)
        value.fill(GD_TERRITORY)
        tap(sheet.get_by_role("button", name="Add condition"))
        shown = f"Use only in: {GD_TERRITORY}"
        eventually(cai, lambda: expect(cai.get_by_text(shown).first).to_be_attached(timeout=POLL_MS),
                   "the territory condition text never appeared")
    d = detail(world, "cai", "REQ-0003")
    assert [(c["kind"], c["text"]) for c in d["conditions"]] == [("territory", f"Use only in: {GD_TERRITORY}")]


GE_DESK_TARGET_PX = 32


def _ge_desk_target(locator: Locator) -> None:
    b = box(locator)
    assert b["height"] >= GE_DESK_TARGET_PX, \
        f"{locator} is {b['height']:.0f} px tall; desktop controls must be at least {GE_DESK_TARGET_PX} px tall"


def test_wf_variant_request_phone_dialog_checkboxes(browser: Browser, world: World) -> None:
    with browse(browser, world, who="ana", path="/library", size=PHONE) as page:
        opener = page.get_by_role("article", name=art(MENU_ICON, "Request required")).get_by_role("button", name="Request use")
        tap(opener)
        dialog = page.get_by_role("dialog", name=f"Request {MENU_ICON}")
        expect(dialog).to_be_visible()
        territories = dialog.get_by_role("group", name="Territories").get_by_role("checkbox")
        expect(territories.first).to_be_visible()
        for i in range(territories.count()):
            _ga_min_target(territories.nth(i))
        rule = dialog.get_by_role("group", name="Cited rules").get_by_role("checkbox", name="iconography.ui.size", exact=True)
        rule.scroll_into_view_if_needed()
        _ga_min_target(rule)
        tap(rule)
        expect(rule).to_be_checked()
        fill(dialog.get_by_label("Campaign end"), GA_MENU_END)
        tap(dialog.get_by_role("button", name="Submit request"))
        wait_url(page, rf"/requests/{REQ_NEW}$")
        expect(page.get_by_role("status", name="Request state")).to_have_text("Under review")


def test_wf_approval_chain_desktop_queue_targets(browser: Browser, world: World) -> None:
    rid = create(world, "ana", *ANA_COBRAND)["id"]
    with browse(browser, world, who="bea", path="/queue") as page:
        link = page.get_by_role("table", name="Review queue").get_by_role("link", name=rid, exact=True)
        _gb_seen(page, link, f"Bea's desktop queue has no {rid} link")
        _ge_desk_target(link)
        click(link)
        wait_url(page, rf"/requests/{rid}$")
        expect(page.get_by_role("heading", level=1, name=rid)).to_be_visible()
        panel = page.get_by_role("region", name="Decision")
        for name in ("Approve", "Reject", "Request changes"):
            _ge_desk_target(panel.get_by_role("button", name=name, exact=True))
        click(panel.get_by_role("button", name="Approve", exact=True))
        wait_status(page, "Decision saved.")
    decided = [r for r in audit(world, requestId=rid) if r["action"] == "request.decided"]
    assert len(decided) == 1 and decided[0]["actorId"] == "usr_bea"


def test_wf_three_viewers_phone_badge_filters(browser: Browser, world: World) -> None:
    available_n = sum(1 for badge in ANA_BADGES.values() if badge == "Available")
    with browse(browser, world, who="ana", path="/library", size=PHONE) as page:
        results = page.get_by_role("status", name="Library results")
        expect(results).to_have_text("9 assets")
        filters = page.get_by_role("group", name="Filters")
        for badge in ("Available", "Request required", "Restricted", "Retired"):
            _ga_min_target(filters.get_by_role("checkbox", name=badge, exact=True))
        available = filters.get_by_role("checkbox", name="Available", exact=True)
        tap(available)
        expect(available).to_be_checked()
        expect(results).to_have_text(sentence(available_n, "Available"))
        expect(page.get_by_role("article", name=f"{TAB}, Available")).to_be_visible()


def test_wf_link_death_phone_download_again_target(browser: Browser, world: World) -> None:
    expires = iso_shift(START, seconds=LINK_TTL_S)
    with browse(browser, world, who="emi", path="/library", size=PHONE) as page:
        card = page.get_by_role("article", name=art(MENU_ICON, "Available"))
        button = card.get_by_role("button", name="Download menu-24.svg")
        _gb_seen(page, button, "Emi's Menu UI icon card has no Download menu-24.svg button")
        _ga_min_target(button)
        tap(button)
        again = card.get_by_role("link", name="Download again: menu-24.svg")
        _gb_seen(page, again, "a tap on the download button issued no link")
        expect(card).to_contain_text(f"Link expires at {fmt_time(expires)}")
        _ga_min_target(again)


def test_wf_statements_desktop_rule_link_targets(browser: Browser, world: World) -> None:
    with browse(browser, world, who="ana", path="/requests/REQ-0001") as page:
        cited = page.get_by_role("list", name="Cited rules").get_by_role("link", name="logo.variants.tab", exact=True)
        _gb_seen(page, cited, "REQ-0001 lists no logo.variants.tab link")
        _ge_desk_target(cited)
        click(cited)
        wait_url(page, r"/rules/logo\.variants\.tab$")
        expect(page.get_by_role("heading", level=1, name="Logo")).to_be_visible()
        page.goto(world.base + "/rules/logo.clear-space.half")
        replacement = page.get_by_role("link", name="logo.clear-space.minimum", exact=True)
        _gb_seen(page, replacement, "the withdrawn rule page has no replacement link")
        _ge_desk_target(replacement)
        click(replacement)
        wait_url(page, r"/rules/logo\.clear-space\.minimum$")


def test_wf_races_phone_decide_then_late_decider(browser: Browser, world: World) -> None:
    with browse(browser, world, who="bea", path="/queue", size=PHONE_REVIEW) as page:
        link = page.get_by_role("list", name="Review queue").get_by_role("link", name="REQ-0004", exact=True)
        _gb_seen(page, link, "Bea's phone queue has no REQ-0004 link")
        _ga_min_target(link)
        tap(link)
        wait_url(page, r"/requests/REQ-0004$")
        tap(page.get_by_role("button", name="Decide"))
        sheet = page.get_by_role("dialog", name="Decide REQ-0004")
        expect(sheet).to_be_visible()
        approve = sheet.get_by_role("button", name="Approve", exact=True)
        _ga_min_target(approve)
        tap(approve)
        wait_status(page, "Decision saved.")
    err(decide(world, "olu", "REQ-0004", 1, "reject", "No."), 409, {"already_decided", "wrong_state"})
    decided = [r for r in audit(world, requestId="REQ-0004") if r["action"] == "request.decided"]
    assert len(decided) == 1 and decided[0]["actorId"] == "usr_bea"


def test_wf_deadlines_desktop_queue_links_by_due(browser: Browser, world: World) -> None:
    rid = create(world, "ana", "ast_logo", "var_logo_full_lock", "social", ["DE"], "2026-04-10", ["logo.variants.full-lock"])["id"]
    with browse(browser, world, who="bea", path="/queue") as page:
        table = page.get_by_role("table", name="Review queue")
        first = table.get_by_role("link", name=rid, exact=True)
        second = table.get_by_role("link", name="REQ-0004", exact=True)
        _gb_seen(page, first, f"Bea's desktop queue has no {rid} link")
        assert box(first)["y"] < box(second)["y"], "queue rows are not ordered by deadline"
        _ge_desk_target(first)
        _ge_desk_target(second)
        click(first)
        wait_url(page, rf"/requests/{rid}$")
        expect(page.get_by_text(f"Due {fmt_stamp(iso_shift(START, hours=24))}")).to_be_visible()
