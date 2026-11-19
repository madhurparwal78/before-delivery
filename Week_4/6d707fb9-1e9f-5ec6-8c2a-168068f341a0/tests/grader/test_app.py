from __future__ import annotations

import contextlib
import csv
import importlib
import io
import json
import os
import re
import secrets
import sys
import time
import unicodedata
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from conftest import (
    axe as kit_axe,
    click as kit_click,
    decode,
    difference,
    fill as kit_fill,
    layout,
    licence_allowed,
    pdf_text,
    same_origin,
    select as kit_select,
    session,
    shipped_packages,
    tab_order,
    tap as kit_tap,
    unique,
)
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

HTTP_TIMEOUT = 30
UI_WAIT_MS = 15000
REFRESH_WAIT_MS = 11000
OUTAGE_POLL_SECONDS = 45
TAB_LIMIT = 90
expect.set_options(timeout=UI_WAIT_MS)

PHONE = (375, 812)
TABLET = (768, 1024)
LAPTOP = (1280, 800)
SMALL = (320, 568)
LANDSCAPE = (812, 375)
BODY_LIMIT = 1_000_000
FILE_LIMIT = 5_000_000
WHOLE_LIMIT = 10_000_000
PAGE_SIZE = 25
REQUEST_LIMIT = 20
DOWNLOAD_LIMIT = 5
SHORT_REMINDER = 10
SHORT_CLOSURE = 20
SHORT_RATE_WINDOW = 30
ERASE_WITHIN = 5
TOUCH_MIN = 44
MOTION_MS = {160, 320, 640, 64000}
PAUSE_SECONDS = 0.3
INTRO_MS = 1600
NAME_FIRST_MS = 640
INTRO_LATE_MS = 4000
INTRO_SKIP_MARGIN_MS = 300
INTRO_ATTEMPTS = 3
LATE_ANSWER_SECONDS = 3
ADDRESS_WAIT_SECONDS = 10
STRATUM_MID_MS = 160
THIRD_CHOICE_JUMP = 0.02
TIMEOUT_DELAY_MS = 6500
STRIP_PASS_MS = 64000
UNKNOWN_ID = "not-a-real-id"
OTHER_SUPPLIER = "Zzz Other Supplier"
PASSWORD = "thread-count-2027"
NEW_PASSWORD = "new-thread-2027"
TITLE_TAIL = " — Fio Contado Desk"
ZONES = {"porto": "Europe/Lisbon", "izmir": "Europe/Istanbul", "hoChiMinhCity": "Asia/Ho_Chi_Minh", "cairo": "Africa/Cairo"}
TOWN_NAMES = {"porto": "Porto", "izmir": "Izmir", "hoChiMinhCity": "Ho Chi Minh City", "cairo": "Cairo"}
INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
PDF_BYTES = b"%PDF-1.4\n% evidence\n"
JPEG_BYTES = b"\xff\xd8\xff\xe0 evidence"
PNG_BYTES = b"\x89PNG\r\n\x1a\n evidence"

MEASURES = ["climate", "water", "fossilEnergy", "landUse", "freshwaterToxicity", "microfibres"]
MEASURE_NAMES = {"climate": "Climate", "water": "Water", "fossilEnergy": "Fossil energy", "landUse": "Land use", "freshwaterToxicity": "Freshwater toxicity", "microfibres": "Microfibres"}
UNITS = {"climate": "kg CO₂e", "water": "L", "fossilEnergy": "MJ", "landUse": "points", "freshwaterToxicity": "CTUe", "microfibres": "mg"}
STAGES = ["materials", "making", "transport", "use", "endOfLife"]
STAGE_NAMES = {"materials": "Materials", "making": "Making", "transport": "Transport", "use": "Use", "endOfLife": "End of life"}
FACTORS = {
    "organic-cotton": ("14.8", "4.02", "2840", "36.5", "0.0412", "318", "52"),
    "cotton": ("14.8", "5.91", "6120", "48.2", "0.0386", "742", "52"),
    "recycled-cotton": ("11.2", "1.87", "410", "21.4", "0.0041", "96", "61"),
    "linen": ("13.5", "2.64", "1180", "29.7", "0.0295", "204", "38"),
    "wool": ("17.6", "18.4", "3120", "44.9", "0.214", "512", "44"),
    "recycled-wool": ("12.3", "3.12", "640", "24.1", "0.0063", "118", "47"),
    "polyester": ("21.4", "3.24", "58", "71.6", "0.0009", "86", "410"),
    "recycled-polyester": ("19.8", "1.95", "41", "39.3", "0.0005", "64", "430"),
    "viscose": ("24.3", "4.77", "1420", "58.8", "0.0172", "377", "29"),
    "lyocell": ("19.1", "2.83", "890", "41.2", "0.0154", "142", "24"),
    "nylon": ("26.7", "7.31", "96", "96.4", "0.0011", "131", "385"),
    "elastane": ("31.2", "12.6", "210", "142", "0.0018", "268", "96"),
    "PT": (None, "0.0412", "0.118", "0.74", "0.000041", "0.021", "0"),
    "TR": (None, "0.124", "0.215", "1.62", "0.000085", "0.043", "0"),
    "VN": (None, "0.158", "0.264", "1.93", "0.000102", "0.057", "0"),
    "EG": (None, "0.131", "0.302", "1.81", "0.000076", "0.049", "0"),
    "IN": (None, "0.196", "0.341", "2.24", "0.000118", "0.072", "0"),
    "BD": (None, "0.172", "0.288", "2.07", "0.000109", "0.064", "0"),
    "sea": (None, "0.0107", "0.0042", "0.148", "0.000012", "0.0088", "0"),
    "road": (None, "0.105", "0.038", "1.48", "0.00021", "0.092", "0"),
    "rail": (None, "0.0281", "0.0113", "0.392", "0.000064", "0.021", "0"),
    "air": (None, "0.602", "0.176", "8.41", "0.00097", "0.33", "0"),
    "wash": (None, "0.0213", "14.2", "0.31", "0.000012", "0.0064", "3.8"),
    "disposal": (None, "0.0512", "0.84", "0.19", "0.000034", "1.27", "1.6"),
}
MATERIAL_NAMES = {"organic-cotton": "Organic cotton", "cotton": "Cotton", "recycled-cotton": "Recycled cotton", "linen": "Linen", "wool": "Wool", "recycled-wool": "Recycled wool", "polyester": "Polyester", "recycled-polyester": "Recycled polyester", "viscose": "Viscose", "lyocell": "Lyocell", "nylon": "Nylon", "elastane": "Elastane"}

ESTIMATE_KILOS = {"tshirt": "0.25", "shirt": "0.30", "jeans": "0.80", "coat": "1.20"}
ESTIMATE_FIBRES = {"organic-cotton": "3.10", "cotton": "4.15", "polyester": "3.24", "wool": "14.6"}
ESTIMATE_COUNTRIES = {"PT": "0.92", "TR": "1.35", "VN": "2.10", "EG": "1.74"}

ANSWER_COPY: dict[str, dict[str, Any]] = {
    "en": {"heading": "Your answers", "intro": "{label} asks about {style}.", "due": "Please answer by {due} 23:59:59 {town} time.", "steps": "Steps", "stepEnergy": "Energy", "stepWater": "Water", "stepOrigin": "Fibre origin", "stepEvidence": "Evidence", "stepSend": "Send", "energy": "Energy per kg of finished goods", "water": "Water in litres per kg of finished goods", "origin": "Country of fibre origin", "unit": "Unit", "gas": "m³ of natural gas", "close": "Close", "next": "Next", "back": "Back", "evidence": "Evidence file (PDF, JPEG or PNG)", "send": "Send answers", "working": "Working…", "sent": "Sent", "ended": "This page has ended.", "number": "That number isn't in the form this page uses, for example 1,250.5.", "fileType": "That file isn't a PDF, JPEG or PNG.", "tooBig": "That file is over 5,000,000 bytes.", "storeDown": "The file store is unavailable right now. Nothing was saved.", "problems": "Problems", "refresh": "Couldn't refresh. Trying again.", "empty": "Give an answer here.", "countries": ["Portugal", "Turkey", "Vietnam", "Egypt", "India", "Bangladesh"]},
    "fr": {"heading": "Vos réponses", "intro": "{label} pose des questions sur {style}.", "due": "Merci de répondre avant le {due} 23:59:59, heure de {town}.", "steps": "Étapes", "stepEnergy": "Énergie", "stepWater": "Eau", "stepOrigin": "Origine de la fibre", "stepEvidence": "Justificatif", "stepSend": "Envoi", "energy": "Énergie par kg de produit fini", "water": "Eau en litres par kg de produit fini", "origin": "Pays d'origine de la fibre", "unit": "Unité", "gas": "m³ de gaz naturel", "close": "Fermer", "next": "Suivant", "back": "Retour", "evidence": "Justificatif (PDF, JPEG ou PNG)", "send": "Envoyer les réponses", "working": "En cours…", "sent": "Envoyé", "ended": "Cette page est terminée.", "number": "Ce nombre n'est pas écrit comme il faut, par exemple 1 250,5.", "fileType": "Ce fichier n'est ni un PDF, ni un JPEG, ni un PNG.", "tooBig": "Ce fichier dépasse 5 000 000 octets.", "storeDown": "Le stockage des fichiers est indisponible pour le moment. Rien n'a été enregistré.", "problems": "Problèmes", "refresh": "Actualisation impossible. Nouvel essai en cours.", "empty": "Répondez ici.", "countries": ["Portugal", "Turquie", "Viêt Nam", "Égypte", "Inde", "Bangladesh"]},
    "tr": {"heading": "Yanıtlarınız", "intro": "{label}, {style} hakkında soruyor.", "due": "Lütfen {due} 23:59:59 ({town} saati) tarihine kadar yanıtlayın.", "steps": "Adımlar", "stepEnergy": "Enerji", "stepWater": "Su", "stepOrigin": "Elyaf kökeni", "stepEvidence": "Kanıt belgesi", "stepSend": "Gönderim", "energy": "Bitmiş ürünün kg'si başına enerji", "water": "Bitmiş ürünün kg'si başına litre su", "origin": "Elyafın menşe ülkesi", "unit": "Birim", "gas": "m³ doğal gaz", "close": "Kapat", "next": "İleri", "back": "Geri", "evidence": "Kanıt dosyası (PDF, JPEG veya PNG)", "send": "Yanıtları gönder", "working": "İşleniyor…", "sent": "Gönderildi", "ended": "Bu sayfanın süresi doldu.", "number": "Bu sayı doğru biçimde değil, örneğin 1.250,5.", "fileType": "Bu dosya PDF, JPEG veya PNG değil.", "tooBig": "Bu dosya 5.000.000 baytı aşıyor.", "storeDown": "Dosya deposu şu anda kullanılamıyor. Hiçbir şey kaydedilmedi.", "problems": "Sorunlar", "refresh": "Yenilenemedi. Yeniden deneniyor.", "empty": "Buraya bir yanıt girin.", "countries": ["Portekiz", "Türkiye", "Vietnam", "Mısır", "Hindistan", "Bangladeş"]},
    "ar": {"heading": "إجاباتك", "intro": "تسأل {label} عن {style}.", "due": "يرجى الإجابة قبل {due} 23:59:59 بتوقيت {town}.", "steps": "الخطوات", "stepEnergy": "الطاقة", "stepWater": "الماء", "stepOrigin": "منشأ الألياف", "stepEvidence": "مستند داعم", "stepSend": "الإرسال", "energy": "الطاقة لكل كيلوغرام من المنتج النهائي", "water": "الماء باللتر لكل كيلوغرام من المنتج النهائي", "origin": "بلد منشأ الألياف", "unit": "الوحدة", "gas": "م³ من الغاز الطبيعي", "close": "إغلاق", "next": "التالي", "back": "السابق", "evidence": "ملف المستند (PDF أو JPEG أو PNG)", "send": "إرسال الإجابات", "working": "جارٍ العمل…", "sent": "تم الإرسال", "ended": "انتهت هذه الصفحة.", "number": "هذا الرقم ليس بالصيغة الصحيحة، مثل ١٬٢٥٠٫٥.", "fileType": "هذا الملف ليس PDF أو JPEG أو PNG.", "tooBig": "يتجاوز هذا الملف ٥٬٠٠٠٬٠٠٠ بايت.", "storeDown": "مخزن الملفات غير متاح حاليًا. لم يُحفظ أي شيء.", "problems": "المشكلات", "refresh": "تعذر التحديث. جارٍ المحاولة مجددًا.", "empty": "أدخل إجابة هنا.", "countries": ["البرتغال", "تركيا", "فيتنام", "مصر", "الهند", "بنغلاديش"]},
}
MAIL_COPY = {
    "en": {"subject": "Facts needed for {label}", "reminder": "Reminder: facts needed for {label}", "greeting": "Hello {contact},", "ask": "{label} asks you for facts about {style}. Please answer on this private page:"},
    "fr": {"subject": "Informations demandées pour {label}", "reminder": "Rappel : informations demandées pour {label}", "greeting": "Bonjour {contact},", "ask": "{label} vous demande des informations sur {style}. Merci de répondre sur cette page privée :"},
    "tr": {"subject": "{label} için bilgi talebi", "reminder": "Hatırlatma: {label} için bilgi talebi", "greeting": "Merhaba {contact},", "ask": "{label}, {style} hakkında bilgi istiyor. Lütfen bu özel sayfadan yanıtlayın:"},
    "ar": {"subject": "معلومات مطلوبة من أجل {label}", "reminder": "تذكير: معلومات مطلوبة من أجل {label}", "greeting": "مرحبًا {contact}،", "ask": "تطلب منك {label} معلومات عن {style}. يرجى الإجابة في هذه الصفحة الخاصة:"},
}
PASSPORT_COPY = {
    "English": {"lang": "en", "words": ["Label", "Garment", "T-shirt", "Climate", "Water", "Fossil energy", "Land use", "Freshwater toxicity", "Microfibres", "Score 1,240 points (412 per 100 g)", "Edition 1", "Factor edition 2027.1", "Data quality C (0%)", "These figures are published sums. They are not a legal claim."]},
    "Français": {"lang": "fr", "words": ["Marque", "Vêtement", "T-shirt", "Climat", "Eau", "Énergie fossile", "Usage des sols", "Toxicité en eau douce", "Microfibres", "Score 1,240 points (412 pour 100 g)", "Édition 1", "Édition des facteurs 2027.1", "Qualité des données C (0%)", "Ces chiffres sont des sommes publiées. Ils ne constituent pas une affirmation légale."]},
    "Türkçe": {"lang": "tr", "words": ["Marka", "Giysi", "Tişört", "İklim", "Su", "Fosil enerji", "Arazi kullanımı", "Tatlı su toksisitesi", "Mikrolifler", "Puan 1,240 (100 g başına 412)", "1. sürüm", "Faktör sürümü 2027.1", "Veri kalitesi C (%0)", "Bu rakamlar yayımlanmış toplamlardır. Yasal bir iddia değildir."]},
    "العربية": {"lang": "ar", "words": ["العلامة", "الملبس", "قميص قصير", "المناخ", "الماء", "الطاقة الأحفورية", "استخدام الأراضي", "سمية المياه العذبة", "الألياف الدقيقة", "الدرجة 1,240 نقطة (412 لكل 100 غ)", "الإصدار 1", "إصدار العوامل 2027.1", "جودة البيانات C (0%)", "هذه الأرقام مجاميع منشورة وليست ادعاءً قانونيًا."]},
}

RECORDER = """
(() => {
  window.__motion = [];
  const clean = (n) => Math.round(n * 1000) / 1000;
  const declared = (a, timing) => {
    if (!a.transitionProperty) return Number(timing.duration);
    const style = getComputedStyle(a.effect.target, a.effect.pseudoElement || undefined);
    const names = style.transitionProperty.split(',').map((s) => s.trim());
    const times = style.transitionDuration.split(',').map((s) => s.trim());
    let at = names.lastIndexOf(a.transitionProperty);
    if (at < 0) at = names.lastIndexOf('all');
    if (at < 0) return Number(timing.duration);
    const value = times[at % times.length];
    return value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
  };
  const note = (target, property) => {
    if (!target || !target.getAnimations) return;
    for (const a of target.getAnimations({subtree: true})) {
      const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      if (!timing) continue;
      const duration = clean(declared(a, timing));
      if (duration >= 1) window.__motion.push({duration, target: a.effect.target, property});
    }
  };
  for (const kind of ['transitionrun', 'animationstart']) {
    document.addEventListener(kind, (event) => note(event.target, event.propertyName || event.animationName), true);
  }
  const original = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const made = original.call(this, keyframes, options);
    const duration = clean(Number(made.effect.getComputedTiming().duration));
    if (duration >= 1) window.__motion.push({duration, target: this, property: 'animate'});
    return made;
  };
})();
"""


INTRO_WATCH = """
(() => {
  const seen = window.__intro = {first: null, last: null, text: '', skipFocused: false, headingFocused: false, escaped: null};
  const named = (e) => !!e && (e.getAttribute('aria-label') || e.textContent || '').trim() === 'Skip intro';
  const showing = () => { const i = document.querySelector('[data-part="intro"]'); return i && i.getClientRects().length ? i : null; };
  document.addEventListener('focusin', (event) => {
    const t = event.target;
    if (t.matches('h1,[role=heading]')) { seen.headingFocused = true; return; }
    const i = showing();
    if (i && !named(t) && !i.contains(t)) seen.escaped = t.tagName + ' ' + (t.textContent || '').slice(0, 40);
  }, true);
  const look = () => {
    const i = showing();
    if (i) {
      const now = performance.now();
      seen.first = seen.first ?? now;
      seen.last = now;
      if (!seen.text.includes(i.textContent)) seen.text += ' ' + i.textContent;
      if (named(document.activeElement)) {
        seen.skipFocused = true;
        if (window.__pressSkip && document.readyState !== 'loading') document.activeElement.click();
      }
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
})();
"""
SEEK_STRATUM = """(el, at) => {
  const band = el.closest('[data-part="strata"]');
  for (const a of band.getAnimations({subtree: true})) { a.pause(); a.currentTime = at; }
  return el.getBoundingClientRect().width / band.getBoundingClientRect().width;
}"""


def _kit(name: str, service: str) -> Any:
    conftest = importlib.import_module("conftest")
    found = getattr(conftest, name, None)
    if found is not None:
        return found
    for module_name, module in list(sys.modules.items()):
        if service in module_name and getattr(module, name, None) is not None:
            return getattr(module, name)
    pytest.fail(f"the kit offers no {name} for {service}")


def s3(suffix: str = "") -> Any:
    client = _kit("S3", "minio")
    return client(suffix) if suffix else client()


def pg(suffix: str = "") -> Any:
    client = _kit("Postgres", "postgres")
    return client(suffix) if suffix else client()


def poll(check_fn: Callable[[], Any], contract: str, seconds: float = OUTAGE_POLL_SECONDS) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        found = check_fn()
        if found:
            return found
    pytest.fail(f"deadline passed waiting for: {contract}")


def want(response: httpx.Response, status: int, code: str | None = None) -> Any:
    assert response.status_code == status, f"{response.request.method} {response.request.url} answered {response.status_code}: {response.text[:400]}"
    body: Any = None
    if response.content and "json" in response.headers.get("content-type", ""):
        body = response.json()
    if code is not None:
        assert body["error"]["code"] == code, body
    return body


def error_message(response: httpx.Response) -> str:
    return response.json()["error"]["message"]


def identity() -> tuple[str, str]:
    first, second = unique("desk")
    return (second, first) if "@" in first else (first, second)


def fresh(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4().hex[:8]}"


def fresh_mail(domain: str = "yildiz-iplik.example") -> str:
    return f"{uuid.uuid4().hex[:12]}@{domain}"


def check_digit(body: str) -> str:
    total = sum(int(digit) * (3 if index % 2 else 1) for index, digit in enumerate(body))
    return str((10 - total % 10) % 10)


def gtin() -> str:
    body = "2" + f"{secrets.randbelow(10**11):011d}"
    return body + check_digit(body)


class Desk:
    def __init__(self, base: str, cookie: str, assessor: dict, email: str, password: str, raw_cookie: str = ""):
        self.base, self.cookie, self.assessor, self.email, self.password, self.raw_cookie = base, cookie, assessor, email, password, raw_cookie

    @classmethod
    def _from(cls, base: str, response: httpx.Response, email: str, password: str) -> "Desk":
        raw = response.headers.get("set-cookie", "")
        found = re.search(r"fioSession=([^;]+)", raw)
        assert found, f"no fioSession cookie in {raw!r}"
        return cls(base, found.group(1), response.json()["assessor"], email, password, raw)

    @classmethod
    def sign_up(cls, base: str) -> "Desk":
        name, email = identity()
        response = httpx.post(f"{base}/api/sign-up", json={"name": name, "email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
        want(response, 201)
        return cls._from(base, response, email, PASSWORD)

    @classmethod
    def sign_in(cls, base: str, email: str, password: str = PASSWORD) -> "Desk":
        response = httpx.post(f"{base}/api/sign-in", json={"email": email, "password": password}, timeout=HTTP_TIMEOUT)
        want(response, 200)
        return cls._from(base, response, email, password)

    def call(self, method: str, path: str, **options: Any) -> httpx.Response:
        headers = {"Cookie": f"fioSession={self.cookie}", **options.pop("headers", {})}
        return httpx.request(method, f"{self.base}{path}", headers=headers, timeout=HTTP_TIMEOUT, **options)

    def get(self, path: str, **options: Any) -> httpx.Response:
        return self.call("GET", path, **options)

    def post(self, path: str, body: Any = None, **options: Any) -> httpx.Response:
        if body is not None:
            options["json"] = body
        return self.call("POST", path, **options)

    def patch(self, path: str, body: Any, **options: Any) -> httpx.Response:
        return self.call("PATCH", path, json=body, **options)

    def delete(self, path: str, **options: Any) -> httpx.Response:
        return self.call("DELETE", path, **options)


def make_label(desk: Desk, name: str | None = None) -> dict:
    body = {"name": name or fresh("Label"), "contactName": fresh("Rita"), "contactEmail": fresh_mail("porto-knit.example")}
    return want(desk.post("/api/labels", body), 201)


def make_style(desk: Desk, label_id: str, **fields: Any) -> dict:
    body = {"labelId": label_id, "name": fresh("Style"), "season": "AW27", "gtin": gtin(), **fields}
    return want(desk.post("/api/styles", body), 201)


TIER_TR = {"factory": "Yıldız İplik", "town": "Izmir", "country": "TR"}
TIER2_TR = {"factory": "Ege Dokuma", "town": "Izmir", "country": "TR"}
TIER3_IN = {"factory": "Surat Fibre Co-op", "town": "Surat", "country": "IN"}


def make_line(desk: Desk, style_id: str, material: str = "organic-cotton", grams: str = "250", tier1: Any = TIER_TR, tier2: Any = TIER2_TR, tier3: Any = TIER3_IN) -> dict:
    body = {"materialId": material, "massGrams": grams, "fibres": [{"name": MATERIAL_NAMES[material], "sharePercent": "100.0"}], "tier1": tier1, "tier2": tier2, "tier3": tier3}
    return want(desk.post(f"/api/styles/{style_id}/lines", body), 201)


class World:
    def __init__(self, desk: Desk, label: dict, style: dict, line: dict):
        self.desk, self.label, self.style, self.line = desk, label, style, line

    @property
    def sid(self) -> str:
        return self.style["id"]

    def fresh_style(self) -> dict:
        self.style = want(self.desk.get(f"/api/styles/{self.sid}"), 200)
        return self.style


def harbour(desk: Desk, **style_fields: Any) -> World:
    label = make_label(desk)
    style = make_style(desk, label["id"], **style_fields)
    line = make_line(desk, style["id"])
    want(desk.post(f"/api/styles/{style['id']}/legs", {"mode": "road", "km": "3200"}), 201)
    return World(desk, label, style, line)


def worked(desk: Desk, **style_fields: Any) -> tuple[World, dict]:
    world = harbour(desk, **style_fields)
    result = want(desk.post(f"/api/styles/{world.sid}/results"), 201)
    return world, result


def scored(desk: Desk, **style_fields: Any) -> tuple[World, dict]:
    world, result = worked(desk, **style_fields)
    want(desk.post(f"/api/styles/{world.sid}/score"), 200)
    return world, result


def published(desk: Desk, **style_fields: Any) -> tuple[World, dict]:
    world, _ = scored(desk, **style_fields)
    passport = want(desk.post(f"/api/styles/{world.sid}/passport"), 201)
    return world, passport


def server_now(base: str) -> datetime:
    body = want(httpx.get(f"{base}/api/estimate", params={"garment": "tshirt", "fibre": "organic-cotton", "country": "PT"}, timeout=HTTP_TIMEOUT), 200)
    return parse_instant(body["answeredAt"])


def parse_instant(value: str) -> datetime:
    assert INSTANT.match(value), value
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def wall_time(instant: str | datetime, zone: str = "Europe/Lisbon") -> str:
    moment = parse_instant(instant) if isinstance(instant, str) else instant
    return moment.astimezone(ZoneInfo(zone)).strftime("%H:%M")


def wall_date(instant: str | datetime, zone: str = "Europe/Lisbon") -> str:
    moment = parse_instant(instant) if isinstance(instant, str) else instant
    return moment.astimezone(ZoneInfo(zone)).strftime("%a %d %b %Y")


def date_form(instant: str | datetime, zone: str = "Europe/Lisbon") -> str:
    return re.sub(r" 0(\d) ", r" 0?\1 ", wall_date(instant, zone))


def due_date(base: str, days: int = 5, town: str = "izmir") -> str:
    return (server_now(base).astimezone(ZoneInfo(ZONES[town])) + timedelta(days=days)).strftime("%Y-%m-%d")


def token_of(address: str, kind: str = "a") -> str:
    found = re.search(rf"/{kind}/([^/\s\"'<>]+)", address)
    assert found, f"no /{kind}/ token in {address!r}"
    return found.group(1)


def ask(world: World, language: str = "tr", town: str = "izmir", supplier: str | None = None, questions: list[str] | None = None, line_id: str | None = None, due: str | None = None) -> dict:
    body = {"styleId": world.sid, "lineId": line_id or world.line["id"], "supplierName": supplier or fresh("Yıldız"), "contactName": fresh("Ayşe"), "contactEmail": fresh_mail(), "town": town, "language": language, "questions": questions or ["energy", "water", "fibreOrigin"], "dueDate": due or due_date(world.desk.base, town=town)}
    return want(world.desk.post("/api/requests", body), 201)


def page_get(base: str, token: str) -> httpx.Response:
    return httpx.get(f"{base}/api/a/{token}", timeout=HTTP_TIMEOUT)


def page_answer(base: str, token: str, body: dict) -> httpx.Response:
    return httpx.post(f"{base}/api/a/{token}/answers", json=body, timeout=HTTP_TIMEOUT)


def page_file(base: str, token: str, name: str, data: bytes, ctype: str = "application/octet-stream") -> httpx.Response:
    return httpx.post(f"{base}/api/a/{token}/evidence", files={"file": (name, data, ctype)}, timeout=HTTP_TIMEOUT)


def mails_now(mail: Any, address: str) -> list[dict]:
    addresses = _kit("addresses", "mailpit")
    return [m for m in mail.messages(settle=0.1) if address in addresses(m.get("To"))]


def mail_to(mail: Any, address: str, count: int = 1, seconds: float = OUTAGE_POLL_SECONDS) -> list[dict]:
    addresses = _kit("addresses", "mailpit")
    def found() -> list[dict] | None:
        hits = [m for m in mail.messages(settle=0.1) if address in addresses(m.get("To"))]
        return hits if len(hits) >= count else None
    return poll(found, f"{count} mail(s) to {address} in Mailpit", seconds)


def mail_text(message: dict) -> str:
    return _kit("text", "mailpit")(message)


def wm_url(entry: dict) -> str:
    return entry["path"] + (f"?{urlencode(entry['query'])}" if entry["query"] else "")


def wm_body(entry: dict) -> dict:
    return entry["json"]


def calls(wiremock: Any, path: str) -> int:
    return len(wiremock.requests(path))


def row_json(row_id: str, **override: str) -> dict:
    making, climate, water, fossil, land, toxicity, microfibres = FACTORS[row_id]
    row = {"id": row_id, "kind": "material", "climate": climate, "water": water, "fossil": fossil, "land": land, "toxicity": toxicity, "microfibres": microfibres}
    if making:
        row["makingMjPerKg"] = making
    row.update(override)
    return row


def stub_cotton_climate(wiremock: Any, climate: str) -> None:
    first_page_stub(wiremock, [row_json(key, **({"climate": climate} if key == "organic-cotton" else {})) for key in list(FACTORS)[:10]])


def half_up(value: Decimal, places: str) -> Decimal:
    return value.quantize(Decimal(places), rounding=ROUND_HALF_UP)


def display(value: Decimal) -> str:
    if value == 0:
        return "0"
    exponent = value.adjusted()
    if abs(value) < Decimal("0.001"):
        mantissa = half_up(value.scaleb(-exponent), "0.01")
        digits = str(abs(exponent)).translate(str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹"))
        return f"{mantissa} × 10⁻{digits}"
    rounded = value.quantize(Decimal(1).scaleb(exponent - 2), rounding=ROUND_HALF_UP)
    return f"{int(rounded):,}" if exponent >= 2 else f"{rounded:,f}"


def estimate_shown(garment: str, fibre: str, country: str) -> str:
    exact = Decimal(ESTIMATE_KILOS[garment]) * (Decimal(ESTIMATE_FIBRES[fibre]) + Decimal(ESTIMATE_COUNTRIES[country]))
    return f"{display(exact)} kg CO₂e"


def shows_figure(figure: Locator, shown: str) -> bool:
    return re.sub(r"\s", "", shown) in re.sub(r"\s", "", figure.inner_text())


def footprint(lines: list[dict], legs: list[tuple[str, str]], washes: int, table: dict | None = None) -> dict[str, dict[str, Decimal]]:
    rows = table or FACTORS
    out: dict[str, dict[str, Decimal]] = {}
    total_kg = sum((Decimal(line["grams"]) / 1000 for line in lines), Decimal(0))
    for index, measure in enumerate(MEASURES, start=1):
        materials = making = Decimal(0)
        for line in lines:
            kg = Decimal(line["grams"]) / 1000
            materials += kg * Decimal(rows[line["material"]][index])
            mj = Decimal(line.get("mj") or rows[line["material"]][0])
            if measure == "water" and line.get("water"):
                making += kg * Decimal(line["water"])
            else:
                making += kg * mj * Decimal(rows[line["country"]][index])
        transport = sum((total_kg / 1000 * Decimal(km) * Decimal(rows[mode][index]) for mode, km in legs), Decimal(0))
        out[measure] = {"materials": materials, "making": making, "transport": transport, "use": washes * Decimal(rows["wash"][index]), "endOfLife": total_kg * Decimal(rows["disposal"][index])}
    return out


def assert_measures(result_measures: list[dict], expected: dict[str, dict[str, Decimal]]) -> None:
    assert [m["measure"] for m in result_measures] == MEASURES or {m["measure"] for m in result_measures} == set(MEASURES)
    for entry in result_measures:
        stages = expected[entry["measure"]]
        total = sum(stages.values(), Decimal(0))
        assert Decimal(entry["total"]) == total, entry["measure"]
        assert entry["totalShown"] == f"{display(total)} {UNITS[entry['measure']]}"
        assert entry["unit"] == UNITS[entry["measure"]]
        shares = {stage: half_up(value / total * 100, "0.1") if total else Decimal("0.0") for stage, value in stages.items()}
        by_stage = {stage["stage"]: stage for stage in entry["stages"]}
        for stage, value in stages.items():
            assert Decimal(by_stage[stage]["value"]) == value, (entry["measure"], stage)
            assert by_stage[stage]["shown"] == display(value), (entry["measure"], stage)
            assert Decimal(by_stage[stage]["share"]) == shares[stage], (entry["measure"], stage)
        hottest = max(STAGES, key=lambda stage: (shares[stage], -STAGES.index(stage)))
        assert entry["hotspot"] == hottest, entry["measure"]


HARBOUR_LINES = [{"material": "organic-cotton", "grams": "250", "country": "TR"}]
HARBOUR_LEGS = [("road", "3200")]


def measure_of(result: dict, measure: str) -> dict:
    return next(entry for entry in result["measures"] if entry["measure"] == measure)


@contextmanager
def ui(browser: Browser, base: str, path: str | None = "/", *, desk: Desk | None = None, view: tuple[int, int] = LAPTOP, touch: bool = False, reduced: bool = False, locale: str | None = None, zone: str | None = None, ahead: timedelta | None = None) -> Iterator[Page]:
    options: dict[str, Any] = {"viewport": {"width": view[0], "height": view[1]}, "has_touch": touch, "reduced_motion": "reduce" if reduced else "no-preference"}
    if locale:
        options["locale"] = locale
    if zone:
        options["timezone_id"] = zone
    context = browser.new_context(**options)
    context.add_init_script(RECORDER)
    if desk:
        context.add_cookies([{"name": "fioSession", "value": desk.cookie, "url": base}])
    page = context.new_page()
    if ahead:
        page.clock.install(time=datetime.now(timezone.utc) + ahead)
    if path is not None:
        page.goto(base + path)
    try:
        yield page
    finally:
        context.close()


PRESS_WAIT_S = 15
PICK_WAIT_S = 10
ENTRANCE_WAIT_S = 10
RING_DIFF = 0.5
RING_BAND = 8
GONE_AT_ONCE_MS = 250
HOLD_OPEN_S = 0.8
LOAD_WAIT_MS = 8_000
ANNOUNCE_WAIT_S = 15
PRINT_WAIT_S = 10
DRAFT_WAIT_S = 2
SLOW_RATE = 0.05

NOT_SHOWN_WAIT_S = 15
PICK_REFUSAL_WAIT_MS = 2000
HEADER_PAST_PX = 25
HEADER_HOLD_S = 0.3
HEADER_WAIT_S = 10
OUTSIDE_X = 4
OUTSIDE_GAP = 8

FINISH_JS = """() => document.getAnimations().forEach(a => {
  if (a.effect && Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish(); })"""

PICK_JS = """e => {
  e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
  const at = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return null;
    const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return hit && (hit === el || el.contains(hit)) ? {x, y} : null;
  };
  const own = at(e);
  if (own) return own;
  const label = (e.labels && e.labels[0]) || e.closest('label');
  return label ? at(label) : null;
}"""

BOX_JS = """e => { const small = r => r.width <= 2 || r.height <= 2;
  const box = small(e.getBoundingClientRect()) && e.labels && e.labels[0] ? e.labels[0] : e;
  const r = box.getBoundingClientRect(); return {x: r.left, y: r.top, width: r.width, height: r.height}; }"""

WATCH_JS = """el => { el.__said = []; new MutationObserver(() => el.__said.push(el.textContent.trim()))
  .observe(el, {childList: true, characterData: true, subtree: true}); }"""

HEADER_PAINT_JS = """(e) => { const paint = (n, pseudo) => { const s = getComputedStyle(n, pseudo); return [s.backgroundColor, s.backgroundImage, s.opacity, s.backdropFilter].join('|'); };
  return [paint(e), paint(e, '::before'), paint(e, '::after'), ...[...e.children].map((c) => paint(c))].join(' '); }"""

ENTRANCE_JS = """el => {
  const finite = a => a.effect && a.effect.target && Number.isFinite(a.effect.getComputedTiming().endTime);
  const near = t => t === el || t.contains(el) || el.contains(t);
  const all = document.getAnimations().filter(finite);
  const nodes = [...new Set([el, ...all.map(a => a.effect.target).filter(near)])];
  const read = n => { const r = n.getBoundingClientRect(); return {left: r.left, top: r.top, width: r.width, height: r.height}; };
  all.forEach(a => { a.pause(); a.currentTime = 0; });
  const starts = nodes.map(read);
  all.forEach(a => a.finish());
  const ends = nodes.map(read);
  const moved = i => ['left', 'top', 'width', 'height'].some(k => Math.abs(starts[i][k] - ends[i][k]) > 1);
  let chosen = 0, area = -1;
  nodes.forEach((n, i) => { const size = ends[i].width * ends[i].height; if (moved(i) && size > area) { chosen = i; area = size; } });
  return {start: starts[chosen], end: ends[chosen]};
}"""

ANIMATED_JS = """el => document.getAnimations().some(a => { const t = a.effect && a.effect.target;
  return t && Number.isFinite(a.effect.getComputedTiming().endTime) && (t === el || t.contains(el) || el.contains(t)); })"""


class ScriptsByEvaluate:

    def __init__(self, page: Page) -> None:
        self.page = page

    def add_script_tag(self, path: str) -> None:
        self.page.evaluate(Path(path).read_text())

    def __getattr__(self, name: str) -> Any:
        return getattr(self.page, name)


def axe(page: Page) -> None:
    page.evaluate(FINISH_JS)
    kit_axe(ScriptsByEvaluate(page))


def pressing(locator: Locator, act: Callable[[], Any]) -> None:
    deadline = time.monotonic() + PRESS_WAIT_S
    refused: BaseException | None = None
    while time.monotonic() < deadline:
        try:
            act()
            return
        except (AssertionError, PlaywrightError) as error:
            refused = error
            if "obscured" in str(error):
                with contextlib.suppress(PlaywrightError):
                    locator.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})", timeout=2_000)
    assert refused is not None
    raise refused


def click(locator: Locator) -> None:
    pressing(locator, lambda: kit_click(locator))


def tap(locator: Locator) -> None:
    pressing(locator, lambda: kit_tap(locator))


def fill(locator: Locator, value: str) -> None:
    pressing(locator, lambda: kit_fill(locator, value))


def select(locator: Locator, choice: str) -> None:
    pressing(locator, lambda: kit_select(locator, choice))


def pick(choice: Locator, touch: bool = False, checked: bool = True) -> None:
    page = choice.page
    expect(choice).to_be_attached()
    point = poll(lambda: choice.evaluate(PICK_JS), "a hit target for the choice or its label", PICK_WAIT_S)
    (page.touchscreen.tap if touch else page.mouse.click)(point["x"], point["y"])
    if checked:
        expect(choice).to_be_checked()


def check(locator: Locator) -> None:
    if not locator.is_checked():
        pick(locator)


def loaded(page: Page) -> None:
    with contextlib.suppress(PlaywrightError):
        page.wait_for_load_state("networkidle", timeout=LOAD_WAIT_MS)


def hold_for(page: Page, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        page.evaluate("() => 0")


def say(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements", include_hidden=True)


def working(scope: Any, copy: str = "Working…") -> None:
    pending = scope.get_by_role("button", name=copy).first
    expect(pending).to_be_visible()
    expect(pending).to_contain_text(copy)
    assert pending.evaluate("(e) => e.disabled || e.getAttribute('aria-disabled') === 'true'"), "SR11: the pending button is not disabled"


def has_ring(page: Page) -> bool:
    if not page.evaluate("() => document.activeElement && document.activeElement !== document.body"):
        return False
    box = page.evaluate_handle("() => document.activeElement").as_element().evaluate(BOX_JS)
    view = page.viewport_size
    x0, y0 = max(0, box["x"] - RING_BAND), max(0, box["y"] - RING_BAND)
    clip = {"x": x0, "y": y0, "width": min(view["width"], box["x"] + box["width"] + RING_BAND) - x0,
            "height": min(view["height"], box["y"] + box["height"] + RING_BAND) - y0}
    if clip["width"] < 1 or clip["height"] < 1:
        return False
    page.mouse.move(1, 1)
    shown = decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    page.evaluate("() => { window.__ringFocus = document.activeElement; window.__ringFocus.blur(); }")
    hidden = decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    page.evaluate("() => window.__ringFocus.focus()")
    return difference(shown, hidden) > RING_DIFF


def entrance(page: Page, act: Callable[[], Any], target: Locator) -> dict:
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
    act()
    expect(target).to_be_attached()
    poll(lambda: target.evaluate(ANIMATED_JS), "the opening runs as a browser animation", ENTRANCE_WAIT_S)
    result = target.evaluate(ENTRANCE_JS)
    cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
    return result


def announced_twice(page: Page, act: Callable[[], Any]) -> None:
    region = say(page)
    expect(region).to_have_count(1)
    region.evaluate(WATCH_JS)
    act()
    poll(lambda: any(region.evaluate("el => el.__said")), "the first announcement", ANNOUNCE_WAIT_S)
    plain = lambda text: re.sub("[\u200b-\u200d\u2060\ufeff]", "", text)
    first = plain(region.evaluate("el => el.textContent.trim()"))
    assert first, "SR18: the announcement left the region empty"
    region.evaluate("el => { el.__said = []; }")
    act()
    poll(lambda: any(first in plain(said) for said in region.evaluate("el => el.__said")), f"SR18: {first!r} announced a second time", ANNOUNCE_WAIT_S)


def first_page_stub(wiremock: Any, rows: list[dict]) -> None:
    created = wiremock.client.post("/__admin/mappings", json={
        "priority": 1,
        "request": {"method": "GET", "urlPath": "/v2/factors", "queryParameters": {"edition": {"equalTo": "2027.1"}, "cursor": {"absent": True}}},
        "response": {"status": 200, "headers": {"Content-Type": "application/json"}, "jsonBody": {"edition": "2027.1", "nextCursor": "p2", "rows": rows}},
    })
    assert created.status_code == 201, created.text


def choose_material(panel: Locator, material: str) -> None:
    combo = panel.get_by_role("combobox", name="Material")
    fill(combo, material)
    option = panel.page.get_by_role("listbox", name="Materials").get_by_role("option", name=material, exact=True)
    expect(option).to_be_visible()
    click(option)


def pdf_words(data: bytes) -> str:
    return re.sub(r"\s", "", unicodedata.normalize("NFKC", pdf_text(data)))


def figure_words(value: str) -> str:
    return re.sub(r"\s", "", unicodedata.normalize("NFKC", value))


def squeezed_name(value: str) -> str:
    return re.sub(r"[\s_-]+", "", value).lower()


def spaced(page: Page) -> None:
    page.evaluate("(css) => { const sheet = new CSSStyleSheet(); sheet.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }", TEXT_SPACING)


def printed(page: Page) -> str:
    return re.sub(r"\s+", " ", page.locator("body").inner_text()).strip()


@pytest.fixture(autouse=True)
def provider_baseline() -> Iterator[None]:
    yield
    _kit("WireMock", "wiremock")()


def h1(page: Page) -> Locator:
    return page.get_by_role("heading", level=1)


def button(scope: Any, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def dialog(page: Page, name: str) -> Locator:
    return page.get_by_role("dialog", name=name, exact=True)


def announced(page: Page, copy: str | re.Pattern[str]) -> None:
    expect(say(page)).to_contain_text(copy)


def staged(page: Page, name: str, stage: str) -> Locator:
    return page.locator(f'[data-part="{name}"][data-stage="{stage}"]')


def part(page: Page, name: str) -> Locator:
    return page.locator(f'[data-part="{name}"]')


def settled(page: Page) -> None:
    page.evaluate(
        """async () => { await Promise.all(document.getAnimations().filter((a) => {
            const t = a.effect.getComputedTiming(); return t.iterations !== Infinity && t.duration < 64000;
        }).map((a) => a.finished.catch(() => null))); }"""
    )


def clear_motion(page: Page) -> None:
    page.evaluate("() => { window.__motion.length = 0; }")


def motion_log(page: Page) -> list[float]:
    return page.evaluate("() => window.__motion.map((m) => m.duration)")


def motion_in(locator: Locator) -> list[float]:
    return locator.first.evaluate("(el) => window.__motion.filter((m) => m.target && (el === m.target || el.contains(m.target))).map((m) => m.duration)")


def wait_refresh(page: Page) -> None:
    with page.expect_response(lambda r: r.request.method == "GET" and same_origin(r.url, page.url), timeout=REFRESH_WAIT_MS):
        pass


def focus_in(region: Locator) -> None:
    deadline = time.monotonic() + UI_WAIT_MS / 1000
    while time.monotonic() < deadline:
        if region.evaluate("(e) => e === document.activeElement || e.contains(document.activeElement)"):
            return
    pytest.fail("focus never landed inside the published region")


def hit(locator: Locator, view: tuple[int, int]) -> None:
    box = locator.bounding_box()
    assert box, "control has no box"
    assert box["x"] >= -1 and box["y"] >= -1 and box["x"] + box["width"] <= view[0] + 1 and box["y"] + box["height"] <= view[1] + 1, box
    assert locator.evaluate(
        """(el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!top && (el === top || el.contains(top) || top.contains(el)); }"""
    ), "something covers the control"


def tab_to(page: Page, target: Locator, backwards: bool = False) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Shift+Tab" if backwards else "Tab")
        if target.evaluate("(e) => e === document.activeElement"):
            if page.evaluate("() => ['A', 'BUTTON'].includes(document.activeElement.tagName)"):
                assert has_ring(page), "SR8: the focused control shows no focus ring"
            return
    pytest.fail("keyboard Tab never reached the published control")


def key_type(page: Page, target: Locator, value: str) -> None:
    tab_to(page, target)
    page.keyboard.press("Control+A")
    page.keyboard.type(value)


def labelled(scope: Any, name: str) -> Locator:
    return scope.get_by_label(re.compile(rf"^\s*{re.escape(name)}(?![a-z0-9-]|\s+[a-z0-9])"))


def word_not_shown(page: Page, word: str) -> None:
    found = page.get_by_text(re.compile(rf"(?<![^\W\d_]){re.escape(word)}(?![^\W\d_])"))
    poll(lambda: not any(found.nth(index).is_visible() for index in range(found.count())), f"{word!r} not showing", NOT_SHOWN_WAIT_S)


def problems(scope: Any, message: str, field: Locator) -> None:
    region = scope.get_by_role("region", name="Problems")
    link = region.get_by_role("link").filter(has_text=message)
    expect(link).to_be_visible()
    click(link)
    expect(field).to_be_focused()
    expect(field).to_have_attribute("aria-invalid", "true")


@contextmanager
def gate(page: Page, pattern: str, method: str = "POST") -> Iterator[Callable[[], None]]:
    held: list[Any] = []
    state = {"open": False}
    matcher = re.compile(pattern)
    def handler(route: Any) -> None:
        if route.request.method != method or state["open"]:
            route.fallback()
        else:
            held.append(route)
    def release() -> None:
        state["open"] = True
        while held:
            held.pop().fallback()
    page.route(matcher, handler)
    try:
        yield release
    finally:
        release()
        page.unroute(matcher, handler)


@contextmanager
def first_held(page: Page, pattern: str) -> Iterator[Callable[[], None]]:
    held: list[Any] = []
    state = {"seen": 0}
    matcher = re.compile(pattern)
    def handler(route: Any) -> None:
        state["seen"] += 1
        if state["seen"] == 1:
            held.append(route)
        else:
            route.fallback()
    def release() -> None:
        while held:
            try:
                held.pop().fallback()
            except PlaywrightError:
                pass
    page.route(matcher, handler)
    try:
        yield release
    finally:
        release()
        page.unroute(matcher, handler)


def intro_over(page: Page) -> bool:
    return not part(page, "intro").first.is_visible() and h1(page).evaluate("(e) => e === document.activeElement")


def intro_reached_heading(page: Page) -> bool:
    return not part(page, "intro").first.is_visible() and page.evaluate("() => window.__intro.headingFocused")


def skip_intro(page: Page) -> None:
    def ended() -> bool:
        if part(page, "intro").first.is_visible():
            page.keyboard.press("Escape")
        return intro_over(page)
    poll(ended, "the intro ending with focus on the level-one heading", UI_WAIT_MS / 1000)


def explore_closed(page: Page) -> None:
    expect(page.get_by_role("navigation", name="Explore")).to_have_count(0)
    expect(page.get_by_role("dialog", name="Explore")).to_have_count(0)


def tiles_out_of_tab_order(page: Page, explore: Locator, menu: Locator, presses: int) -> None:
    click(explore)
    expect(menu.get_by_role("link").first).to_be_visible()
    menu.get_by_role("link").evaluate_all("(links) => links.forEach((link) => { link.__tile = true; })")
    page.keyboard.press("Escape")
    expect(explore).to_be_focused()
    for _ in range(presses):
        page.keyboard.press("Tab")
        assert not page.evaluate("() => document.activeElement.__tile === true"), "a closed tile is in the Tab order"


def let_go(page: Page, release: Callable[[], None], pattern: str) -> None:
    matcher = re.compile(pattern)
    ended: list[str] = []
    def note(request: Any) -> None:
        if matcher.search(request.url):
            ended.append(request.url)
    page.on("requestfinished", note)
    page.on("requestfailed", note)
    release()
    deadline = time.monotonic() + LATE_ANSWER_SECONDS
    while time.monotonic() < deadline and not ended:
        page.evaluate("() => true")
    page.remove_listener("requestfinished", note)
    page.remove_listener("requestfailed", note)
    page.evaluate("() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))")


def query(page: Page) -> dict[str, list[str]]:
    return parse_qs(page.evaluate("() => location.search").lstrip("?"))


def address(page: Page, entries: int | None = None, **wanted: list[str] | None) -> None:
    def holds() -> bool:
        found = query(page)
        return all(found.get(key) == value for key, value in wanted.items()) and (entries is None or history(page) == entries)
    poll(holds, f"the address holding {wanted} with history length {entries}", ADDRESS_WAIT_SECONDS)


def history(page: Page) -> int:
    return page.evaluate("() => history.length")


def touch_targets(page: Page) -> None:
    small = page.evaluate(
        """(minimum) => {
          const out = [];
          for (const el of document.querySelectorAll('a[href],button,input,select,textarea,summary,[role=button],[role=menuitem],[role=link],[role=radio],[role=checkbox],[role=combobox],[role=slider]')) {
            if (el.closest('[inert],[aria-hidden="true"]')) continue;
            const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none') continue;
            if (el.tagName === 'A' && el.parentElement && el.parentElement.tagName === 'P' && el.parentElement.textContent.trim() !== el.textContent.trim()) continue;
            let box = el;
            const own = el.getBoundingClientRect();
            if (el.tagName === 'INPUT' && el.labels && el.labels[0] && (['radio', 'checkbox'].includes(el.type) || (el.type === 'file' && (own.width <= 2 || own.height <= 2)))) box = el.labels[0];
            const r = box.getBoundingClientRect();
            if (r.width <= 2 && r.height <= 2) continue;
            if (r.width < minimum - 0.5 || r.height < minimum - 0.5) out.push(`${el.tagName} ${(el.getAttribute('aria-label') || el.textContent || el.name || '').trim().slice(0, 40)} ${r.width}x${r.height}`);
          }
          return out;
        }""",
        TOUCH_MIN,
    )
    assert not small, f"touch targets under {TOUCH_MIN}px: {small}"


def no_cut_text(page: Page) -> None:
    cut = page.evaluate(
        """() => { const bad = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) continue;
            const owner = n.parentElement;
            if (!owner || !owner.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
            if (owner.closest('[aria-hidden="true"],[data-ui],[data-part="label-strip"],[data-part="estimate-figure"],[data-part="total-figure"],[data-part="stratum-figure"]')) continue;
            const range = document.createRange(); range.selectNodeContents(n);
            const text = range.getBoundingClientRect();
            if (text.width < 1 || text.height < 1) continue;
            const label = n.textContent.trim().slice(0, 40);
            if (getComputedStyle(owner).textOverflow === 'ellipsis' && owner.scrollWidth > owner.clientWidth + 1) { bad.push(label); continue; }
            let skipStatic = false, freeX = false, freeY = false;
            for (let box = owner; box && box !== document.body; box = box.parentElement) {
              const s = getComputedStyle(box);
              if (!(skipStatic && s.position === 'static')) {
                skipStatic = false;
                const x = s.overflowX === 'hidden' || s.overflowX === 'clip', y = s.overflowY === 'hidden' || s.overflowY === 'clip';
                if (x || y) {
                  const b = box.getBoundingClientRect();
                  if (b.width <= 2 || b.height <= 2) break;
                  if ((x && !freeX && (text.right > b.right + 1 || text.left < b.left - 1)) || (y && !freeY && (text.bottom > b.bottom + 1 || text.top < b.top - 1))) { bad.push(label); break; }
                }
                freeX = freeX || s.overflowX === 'auto' || s.overflowX === 'scroll';
                freeY = freeY || s.overflowY === 'auto' || s.overflowY === 'scroll';
              }
              if (s.position === 'fixed') break;
              if (s.position === 'absolute') skipStatic = true;
            }
          }
          return bad; }"""
    )
    assert not cut, f"SR16: text cut off: {cut}"


def fixed_bottom(locator: Locator, view: tuple[int, int]) -> None:
    expect(locator.first).to_be_visible()
    script = """(el) => { let n = el; while (n && n !== document.body) { if (getComputedStyle(n).position === 'fixed') return n.getBoundingClientRect().bottom; n = n.parentElement; } return null; }"""
    bars = [found for found in (candidate.evaluate(script) for candidate in locator.all()) if found is not None]
    assert bars, "the main action is not in a fixed bar"
    placed = bars[0]
    assert view[1] - 2 <= placed <= view[1] + 2, f"the bar bottom sits at {placed}"


def unobscured(page: Page) -> None:
    assert page.evaluate(
        """() => { const el = document.activeElement; if (!el || el === document.body) return true;
          const r = el.getBoundingClientRect(); const x = r.x + r.width / 2; const y = r.y + r.height / 2;
          if (y < 0 || y > innerHeight) return false;
          const top = document.elementFromPoint(x, y); if (!top) return false;
          const labels = el.labels ? [...el.labels] : [];
          return el === top || el.contains(top) || top.contains(el) || labels.some((l) => l === top || l.contains(top)); }"""
    ), "a bar covers the focused control"


def session_cookie_published(raw: str) -> None:
    attributes = raw.partition(";")[2].lower()
    for present in ("HttpOnly", "SameSite=Lax"):
        assert present.lower() in attributes, raw
    for absent in ("Secure", "Max-Age", "Expires"):
        assert absent.lower() not in attributes, raw


def api_edges(desk: Desk, path: str) -> None:
    response = httpx.post(f"{desk.base}{path}", content=b" " * (BODY_LIMIT + 1), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    want(response, 413, "too_large")
    response = httpx.post(f"{desk.base}{path}", content=b" " * BODY_LIMIT, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    want(response, 401, "not_signed_in")
    session = want(desk.get("/api/session"), 200)
    assert INSTANT.match(session["endsAt"]), session
    session_cookie_published(desk.raw_cookie)


def escape_panel(page: Page, panel: Locator) -> None:
    if panel.get_by_role("combobox", expanded=True).count():
        page.keyboard.press("Escape")
        expect(panel).to_be_visible()
    page.keyboard.press("Escape")


def walk_rules(browser: Browser, desk: Desk | None, base: str, path: str, opener: Callable[[Page], Locator], dialog_of: Callable[[Page], Locator], *, typed: Callable[[Locator], Locator] | None = None, refresh_line: str | None = "Couldn't refresh. Trying again.", view_key: bool = True, popover: bool = False) -> None:
    with ui(browser, base, path, desk=desk) as page:
        expect(h1(page)).to_be_visible()
        expect(page).to_have_title(re.compile(re.escape(TITLE_TAIL) + "$"))
        expect(say(page)).to_have_count(1)
        axe(page)
        open_control = opener(page)
        panel = dialog_of(page)
        open_control.focus()
        page.keyboard.press("Enter")
        expect(panel).to_be_visible()
        if not popover:
            focus_in(panel)
            assert not panel.evaluate("(e) => e === document.activeElement"), "focus must land on a control inside"
        settled(page)
        axe(page)
        if not popover:
            for key in ("Tab", "Shift+Tab"):
                for _ in range(12):
                    page.keyboard.press(key)
                    assert panel.evaluate("(e) => e.contains(document.activeElement)"), f"{key} left the open dialog"
        escape_panel(page, panel)
        expect(open_control).to_be_focused()
        page.keyboard.press("Enter")
        settled(page)
        hold_for(page, HOLD_OPEN_S)
        expect(panel).to_be_visible()
        if not popover:
            focus_in(panel)
        if refresh_line is not None:
            typed_field = None
            if typed:
                typed_field = typed(panel)
                typed_field.focus()
                page.keyboard.type("Kept")
                expect(typed_field).to_have_value(re.compile("Kept"))
            clear_motion(page)
            wait_refresh(page)
            wait_refresh(page)
            expect(panel).to_be_visible()
            assert not motion_in(panel), "the open panel played its opening again on a refresh"
            if typed_field is not None:
                expect(typed_field).to_be_focused()
                expect(typed_field).to_have_value(re.compile("Kept"))
            page.context.set_offline(True)
            expect(part(page, "refresh-line")).to_be_visible(timeout=REFRESH_WAIT_MS)
            expect(part(page, "refresh-line")).to_have_text(refresh_line)
            expect(panel).to_be_visible()
            page.context.set_offline(False)
            expect(part(page, "refresh-line")).to_be_hidden(timeout=REFRESH_WAIT_MS)
        panel.evaluate("(e) => { window.__closing = e; }")
        escape_panel(page, panel)
        expect(open_control).to_be_focused()
        for _ in range(2):
            page.keyboard.press("Tab")
            assert not page.evaluate("() => window.__closing.contains(document.activeElement)"), "SR9: a closing panel is still in the Tab order"
        settled(page)
        expect(panel).to_have_count(0) if panel.count() == 0 else expect(panel).to_be_hidden()
        assert motion_log(page) == [] or set(motion_log(page)) <= MOTION_MS, motion_log(page)
    with ui(browser, base, path, desk=desk, view=PHONE, touch=True) as page:
        expect(h1(page)).to_be_visible()
        layout(page)
        axe(page)
        opener(page).focus()
        page.keyboard.press("Enter")
        expect(dialog_of(page)).to_be_visible()
        settled(page)
        axe(page)
    with ui(browser, base, path, desk=desk, reduced=True) as page:
        expect(h1(page)).to_be_visible()
        opener(page).focus()
        page.keyboard.press("Enter")
        panel = dialog_of(page)
        expect(panel).to_be_visible()
        if not popover:
            focus_in(panel)
        escape_panel(page, panel)
        expect(panel).to_be_hidden(timeout=GONE_AT_ONCE_MS)
        assert not motion_log(page), "reduced motion must open and close at once"


def fill_style_dialog(panel: Locator, label: str, name: str, code: str | None = None, season: str = "AW27", code_gtin: str | None = None) -> str:
    number = code_gtin or gtin()
    select(panel.get_by_role("combobox", name="Label"), label)
    fill(labelled(panel, "Name"), name)
    if code:
        fill(labelled(panel, "Style code"), code)
    fill(labelled(panel, "Season"), season)
    fill(labelled(panel, "GTIN"), number)
    return number


def fill_material(panel: Locator, material: str = "Linen", grams: str | None = "300", share: str = "100.0") -> None:
    choose_material(panel, material)
    if grams is not None:
        check(panel.get_by_role("radio", name="Plain mass"))
        fill(labelled(panel, "Mass (g)"), grams)
    fill(labelled(panel, "Fibre 1 name"), material)
    fill(labelled(panel, "Fibre 1 share (%)"), share)


def fill_request(panel: Locator, world: World, supplier: str, contact_email: str, due: str, language: str = "Turkish", town: str = "Izmir") -> None:
    select(labelled(panel, "Style"), world.style["name"])
    select(labelled(panel, "Material line"), "Organic cotton (line 1)")
    fill(labelled(panel, "Supplier"), supplier)
    fill(labelled(panel, "Contact name"), "Ayşe Demir")
    fill(labelled(panel, "Contact email"), contact_email)
    select(labelled(panel, "Town"), town)
    select(labelled(panel, "Language"), language)
    for question, wanted in (("Energy", True), ("Water", False), ("Fibre origin", False)):
        box = panel.get_by_role("checkbox", name=question)
        if box.is_checked() != wanted:
            pick(box, checked=False)
        expect(box).to_be_checked(checked=wanted)
    fill(labelled(panel, "Due date"), due)


def answer_ui(page: Page, copy: dict, energy: str, water: str, country: int = 1, file: dict | None = None, press: Callable[[Locator], None] = click) -> None:
    fill(labelled(page, copy["energy"]), energy)
    press(button(page, copy["unit"]))
    sheet = dialog(page, copy["unit"])
    expect(sheet).to_be_visible()
    check(sheet.get_by_role("radio", name="kWh"))
    press(button(sheet, copy["close"]))
    press(button(page, copy["next"]))
    fill(labelled(page, copy["water"]), water)
    press(button(page, copy["next"]))
    select(labelled(page, copy["origin"]), copy["countries"][country])
    press(button(page, copy["next"]))
    if file:
        labelled(page, copy["evidence"]).set_input_files(file)
    press(button(page, copy["next"]))


def session_header(response: httpx.Response) -> dict[str, str]:
    return {"Cookie": "; ".join(item.split(";")[0] for item in response.headers.get_list("set-cookie"))}


def start_plain_desk(base: str) -> tuple[str, dict[str, str]]:
    name, email = identity()
    started = httpx.post(f"{base}/api/sign-up", json={"name": name, "email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert started.is_success, started.status_code
    return email, session_header(started)


def test_wf_desk_access_passwords(app_url: str) -> None:
    email, first = start_plain_desk(app_url)
    wrong_password = "not-the-password"
    assert httpx.post(f"{app_url}/api/sign-in", json={"email": email, "password": wrong_password}, timeout=HTTP_TIMEOUT).status_code == 401
    signed = httpx.post(f"{app_url}/api/sign-in", json={"email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert signed.is_success, signed.status_code
    other = session_header(signed)
    assert httpx.get(f"{app_url}/api/session", headers=other, timeout=HTTP_TIMEOUT).status_code == 200
    changed = httpx.post(f"{app_url}/api/password", headers=first, json={"currentPassword": PASSWORD, "newPassword": NEW_PASSWORD}, timeout=HTTP_TIMEOUT)
    assert changed.is_success, changed.status_code
    assert httpx.get(f"{app_url}/api/session", headers=other, timeout=HTTP_TIMEOUT).status_code == 401
    assert httpx.get(f"{app_url}/api/session", headers=first, timeout=HTTP_TIMEOUT).status_code == 200
    again = httpx.post(f"{app_url}/api/sign-in", json={"email": email, "password": NEW_PASSWORD}, timeout=HTTP_TIMEOUT)
    assert again.is_success, again.status_code
    assert httpx.post(f"{app_url}/api/sign-out", headers=first, timeout=HTTP_TIMEOUT).is_success
    assert httpx.get(f"{app_url}/api/session", headers=first, timeout=HTTP_TIMEOUT).status_code == 401


def test_wf_desk_access_sign_in_form(browser: Browser, app_url: str) -> None:
    email, _ = start_plain_desk(app_url)
    with ui(browser, app_url, "/sign-in") as page:
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(labelled(page, "Password"), PASSWORD)
        click(button(page, "Sign in"))
        expect(page).to_have_url(re.compile(r"/styles$"))
        assert page.context.request.get(f"{app_url}/api/session").status == 200
        assert page.context.request.post(f"{app_url}/api/sign-out").ok
        assert page.context.request.get(f"{app_url}/api/session").status == 401


def test_labels_on_one_desk(app_url: str) -> None:
    _, mine = start_plain_desk(app_url)
    _, theirs = start_plain_desk(app_url)
    body = {"name": fresh("Porto Knit"), "contactName": "Rita Lopes", "contactEmail": "rita@porto-knit.example"}
    made = httpx.post(f"{app_url}/api/labels", headers=mine, json=body, timeout=HTTP_TIMEOUT)
    assert made.is_success, made.status_code
    path = f"{app_url}/api/labels/{made.json()['id']}"
    assert httpx.get(path, headers=mine, timeout=HTTP_TIMEOUT).status_code == 200
    assert httpx.get(path, headers=theirs, timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.delete(path, headers=theirs, timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.patch(path, headers=mine, json={"name": fresh("Porto Knit Studio")}, timeout=HTTP_TIMEOUT).status_code == 200
    assert httpx.delete(path, headers=mine, timeout=HTTP_TIMEOUT).is_success
    assert httpx.get(path, headers=mine, timeout=HTTP_TIMEOUT).status_code == 404


def test_sign_up_and_sessions_strict(browser: Browser, app_url: str) -> None:
    name, email = identity()
    with ui(browser, app_url, "/sign-up") as page:
        fill(page.get_by_role("textbox", name="Name"), name)
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(labelled(page, "Password"), PASSWORD)
        click(button(page, "Start a desk"))
        expect(page).to_have_url(re.compile(r"/styles$"))
        expect(h1(page)).to_have_text("Styles")
        expect(h1(page)).to_be_focused()
        cookie = next(c["value"] for c in page.context.cookies() if c["name"] == "fioSession")
        first = Desk(app_url, cookie, {}, email, PASSWORD)
        assert want(first.get("/api/session"), 200)["assessor"]["email"] == email
        assert want(first.get("/api/labels"), 200)["labels"] == []
        taken = httpx.post(f"{app_url}/api/sign-up", json={"name": name, "email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
        want(taken, 409, "email_taken")
        short = httpx.post(f"{app_url}/api/sign-up", json={"name": name, "email": fresh_mail("example.test"), "password": "short"}, timeout=HTTP_TIMEOUT)
        want(short, 422, "validation_failed")
        wrong = httpx.post(f"{app_url}/api/sign-in", json={"email": email, "password": "not-the-password"}, timeout=HTTP_TIMEOUT)
        want(wrong, 401, "invalid_credentials")
        assert error_message(wrong) == "That email and password don't match."
        second = Desk.sign_in(app_url, email)
        want(second.get("/api/session"), 200)
        page.goto(f"{app_url}/labels")
        opener = button(page, "Change password")
        click(opener)
        panel = dialog(page, "Change password")
        fill(labelled(panel, "Current password"), PASSWORD)
        fill(labelled(panel, "New password"), NEW_PASSWORD)
        click(button(panel, "Save password"))
        announced(page, "Password changed.")
        expect(opener).to_be_focused()
        want(second.get("/api/session"), 401, "session_ended")
        want(first.get("/api/session"), 200)
    old = httpx.post(f"{app_url}/api/sign-in", json={"email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    want(old, 401, "invalid_credentials")
    third = Desk.sign_in(app_url, email, NEW_PASSWORD)
    want(third.post("/api/sign-out"), 204)
    want(third.get("/api/session"), 401, "session_ended")
    want(first.get("/api/session"), 200)


def test_sign_in_form_strict(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    with ui(browser, app_url, "/labels") as page:
        expect(page).to_have_url(re.compile(r"/sign-in\?next="))
        assert query(page)["next"] == ["/labels"]
        fill(page.get_by_role("textbox", name="Email"), desk.email)
        fill(labelled(page, "Password"), PASSWORD)
        click(button(page, "Sign in"))
        expect(page).to_have_url(re.compile(r"/labels$"))
    with ui(browser, app_url, "/sign-in") as page:
        expect(h1(page)).to_have_text("Sign in")
        fill(page.get_by_role("textbox", name="Email"), desk.email)
        fill(labelled(page, "Password"), "not-the-password")
        click(button(page, "Sign in"))
        announced(page, "That email and password don't match.")
        expect(page).to_have_url(re.compile(r"/sign-in"))
        fill(labelled(page, "Password"), PASSWORD)
        click(button(page, "Sign in"))
        expect(page).to_have_url(re.compile(r"/styles$"))
        expect(h1(page)).to_be_focused()
        expect(page).to_have_title("Styles" + TITLE_TAIL)
        assert page.context.request.get(f"{app_url}/api/session").status == 200
        page.reload()
        expect(h1(page)).to_have_text("Styles")
        click(button(page, "Sign out"))
        deadline_status = poll(lambda: page.context.request.get(f"{app_url}/api/session").status == 401, "GET /api/session answers 401 after Sign out", 15)
        assert deadline_status


def test_labels_strict(app_url: str) -> None:
    desk, other = Desk.sign_up(app_url), Desk.sign_up(app_url)
    body = {"name": fresh("Porto Knit"), "contactName": "Rita Lopes", "contactEmail": "rita@porto-knit.example"}
    label = want(desk.post("/api/labels", body), 201)
    assert (label["name"], label["contactName"], label["contactEmail"], label["state"]) == (body["name"], "Rita Lopes", "rita@porto-knit.example", "open")
    assert label["closedAt"] is None and label["eraseAt"] is None
    read = want(desk.get(f"/api/labels/{label['id']}"), 200)
    assert read["suppliers"] == [] and read["name"] == body["name"]
    assert label["id"] in [entry["id"] for entry in want(desk.get("/api/labels"), 200)["labels"]]
    new_name = fresh("Porto Knit Studio")
    assert want(desk.patch(f"/api/labels/{label['id']}", {"name": new_name}), 200)["name"] == new_name
    want(desk.post("/api/labels", {"name": "", "contactName": "x", "contactEmail": "y@example.test"}), 422, "validation_failed")
    unknown = desk.get(f"/api/labels/{UNKNOWN_ID}")
    foreign = other.get(f"/api/labels/{label['id']}")
    want(unknown, 404, "not_found")
    want(foreign, 404, "not_found")
    assert foreign.json() == other.get(f"/api/labels/{UNKNOWN_ID}").json()
    assert set(foreign.json()["error"]) == set(unknown.json()["error"])
    assert label["id"] not in [entry["id"] for entry in want(other.get("/api/labels"), 200)["labels"]]
    want(other.patch(f"/api/labels/{label['id']}", {"name": "Taken"}), 404, "not_found")
    want(other.delete(f"/api/labels/{label['id']}"), 404, "not_found")
    want(other.post("/api/styles", {"labelId": label["id"], "name": "x", "season": "AW27", "gtin": gtin()}), 404, "not_found")
    assert want(desk.get(f"/api/labels/{label['id']}"), 200)["name"] == new_name
    want(desk.delete(f"/api/labels/{label['id']}"), 204)
    want(desk.get(f"/api/labels/{label['id']}"), 404, "not_found")
    want(desk.delete(f"/api/labels/{label['id']}"), 404, "not_found")
    assert label["id"] not in [entry["id"] for entry in want(desk.get("/api/labels"), 200)["labels"]]


def test_delete_label_takes_everything(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, passport = published(desk)
    request = ask(world)
    token = token_of(request["answerAddress"])
    evidence = want(page_file(app_url, token, "a.pdf", PDF_BYTES), 201)
    key = f"evidence/{desk.assessor['id']}/{request['id']}/{evidence['evidenceId']}"
    assert s3().get(key) == PDF_BYTES
    assert want(desk.post(f"/api/labels/{world.label['id']}/close"), 200)["state"] == "closed"
    assert want(desk.post(f"/api/labels/{world.label['id']}/bring-back"), 200)["state"] == "open"
    assert s3().get(key) == PDF_BYTES, "a label brought back keeps its files"
    want(desk.delete(f"/api/labels/{world.label['id']}"), 204)
    want(desk.get(f"/api/styles/{world.sid}"), 404, "not_found")
    assert world.sid not in [row["id"] for row in want(desk.get("/api/styles", params={"q": world.style["name"]}), 200)["styles"]]
    want(httpx.get(f"{app_url}/api/passports/{passport['gtin']}", timeout=HTTP_TIMEOUT), 410, "withdrawn")
    poll(lambda: key not in s3().keys(f"evidence/{desk.assessor['id']}/"), "MinIO removed the deleted label's evidence")


def test_wf_public_site_screen_rules(browser: Browser, app_url: str) -> None:
    response = httpx.post(f"{app_url}/api/estimate", content=b" " * (BODY_LIMIT + 1), headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    want(response, 405, "method_not_allowed")
    assert "GET" in response.headers["allow"]
    estimate = want(httpx.get(f"{app_url}/api/estimate", params={"garment": "tshirt", "fibre": "organic-cotton", "country": "PT"}, timeout=HTTP_TIMEOUT), 200)
    assert INSTANT.match(estimate["answeredAt"])
    for view in (LAPTOP, PHONE):
        with ui(browser, app_url, "/", view=view, touch=view == PHONE) as page:
            skip_intro(page)
            expect(say(page)).to_have_count(1)
            layout(page)
            axe(page)
            explore = button(page, "Explore")
            explore.focus()
            page.keyboard.press("Enter")
            expect(page.get_by_role("button", name="Explore", exact=True, include_hidden=True)).to_have_attribute("aria-expanded", "true")
            menu = page.get_by_role("navigation", name="Explore") if view == LAPTOP else dialog(page, "Explore")
            expect(menu.get_by_role("link")).to_have_count(6)
            expect(menu.get_by_role("button")).to_have_count(0)
            settled(page)
            axe(page)
            page.keyboard.press("Escape")
            expect(explore).to_be_focused()
            page.keyboard.press("Enter")
            settled(page)
            expect(menu.get_by_role("link", name="Six measures")).to_be_visible()
            page.keyboard.press("Escape")
            settled(page)
            explore_closed(page)
        with ui(browser, app_url, "/questions", view=view, touch=view == PHONE) as page:
            layout(page)
            axe(page)
            question = button(page, "Who is the desk for?")
            click(question)
            expect(question).to_have_attribute("aria-expanded", "true")
            settled(page)
            axe(page)
    with ui(browser, app_url, "/questions", reduced=True) as page:
        question = button(page, "Who is the desk for?")
        click(question)
        expect(question).to_have_attribute("aria-expanded", "true")
        assert not motion_log(page), "reduced motion opens an accordion at once"
    sweep(browser, app_url, None, "/", lambda page: page.get_by_role("link", name="See the method"), None, skip_intro)
    sweep(browser, app_url, None, "/method")
    sweep(browser, app_url, None, "/questions")


def test_wf_public_site_keyboard(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/") as page:
        skip_intro(page)
        expect(h1(page)).to_be_focused()
        expect(h1(page)).to_have_text("Count every thread of a garment's footprint.")
        explore = button(page, "Explore")
        tab_to(page, explore)
        page.keyboard.press("Enter")
        expect(explore).to_be_focused()
        expect(explore).to_have_attribute("aria-expanded", "true")
        page.keyboard.press("Tab")
        menu = page.get_by_role("navigation", name="Explore")
        focus_in(menu)
        page.keyboard.press("Escape")
        expect(explore).to_be_focused()
        expect(explore).to_have_attribute("aria-expanded", "false")
        radio = page.get_by_role("radio", name="T-shirt")
        tab_to(page, radio)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        announced(page, "1.21 kg CO₂e")
        method = page.get_by_role("link", name="See the method")
        tab_to(page, method, backwards=True)
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/method$"))
        expect(h1(page)).to_be_focused()
        expect(h1(page)).to_have_text("How a footprint is worked out")
    with ui(browser, app_url, "/questions") as page:
        question = button(page, "Does the desk make a legal claim?")
        tab_to(page, question)
        page.keyboard.press("Enter")
        expect(question).to_have_attribute("aria-expanded", "true")
        address(page, q=["legal-claim"])
        expect(question).to_be_focused()
        page.keyboard.press("Enter")
        expect(question).to_have_attribute("aria-expanded", "false")
        address(page, q=None)


def test_wf_public_site_touch(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/", view=PHONE, touch=True) as page:
        skip_intro(page)
        expect(h1(page)).to_be_focused()
        fixed_bottom(page.get_by_role("link", name="See the method"), PHONE)
        touch_targets(page)
        expect(page.get_by_role("banner").get_by_role("link", name="Method", exact=True)).to_have_count(0)
        explore = button(page, "Explore")
        tap(explore)
        sheet = dialog(page, "Explore")
        expect(sheet).to_be_visible()
        expect(sheet.get_by_role("link", name="The five stages")).to_be_focused()
        for _ in range(8):
            page.keyboard.press("Tab")
            assert sheet.evaluate("(e) => e.contains(document.activeElement)")
        settled(page)
        box = sheet.bounding_box()
        assert box and box["y"] + box["height"] < PHONE[1], "the sheet must leave a band of page to tap"
        page.touchscreen.tap(PHONE[0] / 2, box["y"] + box["height"] + OUTSIDE_GAP)
        expect(explore).to_have_attribute("aria-expanded", "false")
        settled(page)
        explore_closed(page)
        pick(page.get_by_role("radio", name="Coat"), touch=True)
        announced(page, "4.82 kg CO₂e")
        address(page, garment=["coat"])
        layout(page)
    with ui(browser, app_url, "/questions", view=PHONE, touch=True) as page:
        touch_targets(page)
        question = button(page, "What happens with poor signal?")
        tap(question)
        expect(question).to_have_attribute("aria-expanded", "true")
        address(page, q=["poor-signal"])
        layout(page)


def test_wf_public_site_copy_precision(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, None) as page:
        answer = page.goto(f"{app_url}/no-such-address")
        assert answer and answer.status == 404
        expect(h1(page)).to_have_text("We couldn't find that page.")
        expect(page).to_have_title("We couldn't find that page." + TITLE_TAIL)
    for garment, kilo in ESTIMATE_KILOS.items():
        for fibre, fibre_value in ESTIMATE_FIBRES.items():
            for country, country_value in ESTIMATE_COUNTRIES.items():
                body = want(httpx.get(f"{app_url}/api/estimate", params={"garment": garment, "fibre": fibre, "country": country}, timeout=HTTP_TIMEOUT), 200)
                exact = Decimal(kilo) * (Decimal(fibre_value) + Decimal(country_value))
                assert Decimal(body["climate"]) == exact
                assert body["shown"] == f"{display(exact)} kg CO₂e"
    want(httpx.get(f"{app_url}/api/estimate", params={"garment": "hat", "fibre": "wool", "country": "PT"}, timeout=HTTP_TIMEOUT), 422)
    with ui(browser, app_url, "/?garment=jeans&fibre=wool&country=EG") as page:
        skip_intro(page)
        figure = part(page, "estimate-figure")
        poll(lambda: shows_figure(figure, estimate_shown("jeans", "wool", "EG")), "the deep-linked figure in the address", 15)


def test_intro(browser: Browser, app_url: str) -> None:
    intro_wait = (INTRO_MS + INTRO_LATE_MS) / 1000
    with ui(browser, app_url, None) as page:
        page.add_init_script(INTRO_WATCH)
        page.goto(app_url + "/", wait_until="commit")
        page.wait_for_function("() => window.__intro && window.__intro.first !== null")
        for _ in range(4):
            page.keyboard.press("Tab")
        poll(lambda: intro_reached_heading(page), "the intro ending by itself with focus on the level-one heading", intro_wait)
        seen = page.evaluate("() => window.__intro")
        for word in ("Materials", "Making", "Transport"):
            assert word in seen["text"], word
        assert seen["skipFocused"], "Skip intro never held focus"
        assert seen["escaped"] is None, f"the page behind must be inert: {seen['escaped']}"
        assert NAME_FIRST_MS <= seen["last"] - seen["first"] <= INTRO_MS + INTRO_LATE_MS, seen
        durations = set(motion_log(page))
        assert 640 in durations and 320 in durations, durations
        page.goto(app_url + "/")
        expect(h1(page)).to_be_visible()
        expect(part(page, "intro")).to_be_hidden()
        expect(button(page, "Skip intro")).to_have_count(0)
        assert page.evaluate("() => window.__intro.first") is None, "the intro played a second time"
    for _ in range(INTRO_ATTEMPTS):
        with ui(browser, app_url, None) as page:
            page.add_init_script(INTRO_WATCH)
            page.goto(app_url + "/", wait_until="commit")
            page.wait_for_function("() => window.__intro && window.__intro.skipFocused")
            page.keyboard.press("Escape")
            poll(lambda: intro_reached_heading(page), "Escape ending the intro with focus on the level-one heading", intro_wait)
            seen = page.evaluate("() => window.__intro")
            if seen["last"] - seen["first"] < INTRO_MS - INTRO_SKIP_MARGIN_MS:
                break
    else:
        pytest.fail("Escape never ended the intro before its own 1600 ms")
    for _ in range(INTRO_ATTEMPTS):
        with ui(browser, app_url, None) as page:
            page.add_init_script("window.__pressSkip = true;")
            page.add_init_script(INTRO_WATCH)
            page.goto(app_url + "/", wait_until="commit")
            page.wait_for_function("() => window.__intro && window.__intro.first !== null")
            poll(lambda: intro_reached_heading(page), "Skip intro ending the intro with focus on the level-one heading", intro_wait)
            seen = page.evaluate("() => window.__intro")
            if seen["last"] - seen["first"] < INTRO_MS - INTRO_SKIP_MARGIN_MS:
                break
    else:
        pytest.fail("Skip intro never ended the intro before its own 1600 ms")
    with ui(browser, app_url, "/method") as page:
        expect(h1(page)).to_be_visible()
        expect(part(page, "intro")).to_be_hidden()
    with ui(browser, app_url, "/", reduced=True) as page:
        expect(h1(page)).to_be_visible()
        expect(part(page, "intro")).to_be_hidden()
        expect(button(page, "Skip intro")).to_have_count(0)


def header_at_rest(page: Page, header: Locator) -> str:
    poll(lambda: page.evaluate("() => window.scrollY") == 0, "the page back at the top", HEADER_WAIT_S)
    seen: list[str] = []
    def steady() -> bool:
        hold_for(page, HEADER_HOLD_S)
        settled(page)
        seen.append(header.evaluate(HEADER_PAINT_JS))
        return len(seen) > 1 and seen[-1] == seen[-2]
    poll(steady, "the header's paint settling", HEADER_WAIT_S)
    return seen[-1]


def test_label_strip_header_underline(browser: Browser, app_url: str) -> None:
    names = ["Maré Alta", "Linho & Sal", "Atelier Noroeste", "Kade Studio", "Fio Norte", "Serra Knit", "Douro Denim", "Cais Workwear"]
    states = "(el) => el.getAnimations({subtree: true}).filter((a) => a.effect.getComputedTiming().iterations === Infinity || a.effect.getComputedTiming().duration === 64000).map((a) => a.playState)"
    with ui(browser, app_url, "/") as page:
        skip_intro(page)
        strip = page.get_by_role("region", name="Labels on the desk")
        for name in names:
            expect(strip).to_contain_text(name)
        expect(part(page, "label-strip")).to_have_count(1)
        assert strip.evaluate("(e) => e.tabIndex >= 0"), "the strip takes focus while it loops"
        strip.scroll_into_view_if_needed()
        assert strip.evaluate(states) and set(strip.evaluate(states)) == {"running"}
        durations = strip.evaluate("(el) => el.getAnimations({subtree: true}).map((a) => a.effect.getComputedTiming().duration)")
        assert STRIP_PASS_MS in durations, durations
        strip.hover()
        poll(lambda: set(strip.evaluate(states)) == {"paused"}, "the strip pauses while hovered", 10)
        h1(page).hover()
        poll(lambda: set(strip.evaluate(states)) == {"running"}, "the strip runs again after hover", 10)
        strip.focus()
        poll(lambda: set(strip.evaluate(states)) == {"paused"}, "the strip pauses while focused", 10)
        page.evaluate("() => document.activeElement.blur()")
        page.evaluate("() => window.scrollTo(0, 0)")
        header = page.get_by_role("banner")
        rest = header_at_rest(page, header)
        page.evaluate("(y) => window.scrollTo(0, y)", HEADER_PAST_PX)
        poll(lambda: header.evaluate(HEADER_PAINT_JS) != rest, "the header turns solid after 24 px", 10)
        settled(page)
        page.evaluate("() => window.scrollTo(0, 0)")
        poll(lambda: header.evaluate(HEADER_PAINT_JS) == rest, "the header is see-through at the top", 10)
        settled(page)
        link = page.get_by_role("banner").get_by_role("link", name="Method")
        clear_motion(page)
        link.hover()
        poll(lambda: 160 in motion_in(link), "the underline grows in 160 ms on hover", 10)
        h1(page).hover()
        settled(page)
        clear_motion(page)
        tab_to(page, link)
        poll(lambda: 160 in motion_in(link), "the underline grows in 160 ms on keyboard focus", 10)
    with ui(browser, app_url, "/", view=PHONE, touch=True) as page:
        skip_intro(page)
        strip = page.get_by_role("region", name="Labels on the desk")
        strip.scroll_into_view_if_needed()
        assert not strip.evaluate(states), "no loop at 375"
        for name in names:
            expect(strip).to_contain_text(name)
        layout(page)
    with ui(browser, app_url, "/", reduced=True) as page:
        strip = page.get_by_role("region", name="Labels on the desk")
        assert "running" not in strip.evaluate(states), "the strip stops under reduced motion"


def test_mega_menu(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/") as page:
        skip_intro(page)
        explore = button(page, "Explore")
        menu = page.get_by_role("navigation", name="Explore")
        tiles_out_of_tab_order(page, explore, menu, 25)
        click(explore)
        for tile in ("The five stages", "Six measures", "Questions", "Try one garment", "Sign in", "Start a desk"):
            expect(menu.get_by_role("link", name=tile)).to_be_visible()
        expect(explore).to_be_focused()
        page.keyboard.press("Escape")
        expect(explore).to_be_focused()
        expect(explore).to_have_attribute("aria-expanded", "false")
        click(explore)
        page.keyboard.press("Tab")
        focus_in(menu)
        page.keyboard.press("Escape")
        expect(explore).to_be_focused()
        click(explore)
        expect(explore).to_have_attribute("aria-expanded", "true")
        expect(menu).to_be_visible()
        settled(page)
        below = menu.bounding_box()
        page.mouse.click(OUTSIDE_X, min(below["y"] + below["height"] + OUTSIDE_GAP, LAPTOP[1] - OUTSIDE_X))
        expect(explore).to_have_attribute("aria-expanded", "false")
        settled(page)
        explore_closed(page)
    with ui(browser, app_url, "/", view=PHONE, touch=True) as page:
        skip_intro(page)
        tiles_out_of_tab_order(page, button(page, "Explore"), dialog(page, "Explore"), 12)
        expect(page.get_by_role("banner").get_by_role("link", name="Method")).to_have_count(0)


def test_questions(browser: Browser, app_url: str) -> None:
    published_questions = {"who-is-it-for": "Who is the desk for?", "legal-claim": "Does the desk make a legal claim?", "factors": "Where do the factors come from?", "supplier-accounts": "Do suppliers need an account?", "poor-signal": "What happens with poor signal?", "shopper": "What does a shopper see?"}
    with ui(browser, app_url, "/questions") as page:
        expect(h1(page)).to_have_text("Questions")
        for title in published_questions.values():
            expect(button(page, title)).to_have_attribute("aria-expanded", "false")
        legal, factors = button(page, published_questions["legal-claim"]), button(page, published_questions["factors"])
        names = tab_order(page, 8)
        assert "No. The desk stores" not in " ".join(names)
        expect(page.get_by_text("It gives no compliance advice.")).to_be_hidden()
        before = history(page)
        clear_motion(page)
        click(legal)
        expect(legal).to_have_attribute("aria-expanded", "true")
        assert 320 in motion_log(page) or poll(lambda: 320 in motion_log(page), "the accordion opens over 320 ms", 5)
        settled(page)
        expect(page.get_by_text("No. The desk stores, converts units, works out published sums and shows what the providers answered. It gives no compliance advice.")).to_be_visible()
        address(page, entries=before + 1, q=["legal-claim"])
        click(factors)
        expect(factors).to_have_attribute("aria-expanded", "true")
        expect(legal).to_have_attribute("aria-expanded", "false")
        address(page, entries=before + 2, q=["factors"])
        page.go_back()
        expect(legal).to_have_attribute("aria-expanded", "true")
        expect(factors).to_have_attribute("aria-expanded", "false")
        page.go_forward()
        expect(factors).to_have_attribute("aria-expanded", "true")
        click(factors)
        expect(factors).to_have_attribute("aria-expanded", "false")
        address(page, entries=before + 3, q=None)
        settled(page)
        page.go_back()
        expect(factors).to_have_attribute("aria-expanded", "true")
    with ui(browser, app_url, "/questions?q=shopper") as page:
        expect(button(page, published_questions["shopper"])).to_have_attribute("aria-expanded", "true")


def test_try_one_garment(browser: Browser, app_url: str) -> None:
    with ui(browser, app_url, "/") as page:
        skip_intro(page)
        panel = page.get_by_role("region", name="Try one garment")
        figure = part(page, "estimate-figure")
        poll(lambda: shows_figure(figure, "1.01 kg CO₂e"), "the start figure", 15)
        expect(panel.get_by_role("radio", name="T-shirt")).to_be_checked()
        before = history(page)
        started = time.monotonic()
        with page.expect_request(re.compile(r"/api/estimate\?")):
            check(panel.get_by_role("radio", name="Jeans"))
        assert time.monotonic() - started >= PAUSE_SECONDS, "the request went before the published pause"
        announced(page, "3.22 kg CO₂e")
        address(page, entries=before, garment=["jeans"], fibre=["organic-cotton"], country=["PT"])
        settled(page)
        clear_motion(page)
        with first_held(page, r"/api/estimate\?") as release:
            with page.expect_request(re.compile(r"garment=coat")):
                check(panel.get_by_role("radio", name="Coat"))
            select(panel.get_by_role("combobox", name="Main fibre"), "Wool")
            latest = estimate_shown("coat", "wool", "PT")
            announced(page, latest)
            poll(lambda: shows_figure(figure, latest), "the figure for the latest choice", 15)
            let_go(page, release, r"fibre=organic-cotton")
            settled(page)
            assert shows_figure(figure, latest), "an earlier answer overwrote the latest choice"
        assert 320 in motion_log(page), "rolling numerals run in 320 ms"
        address(page, fibre=["wool"])
    with ui(browser, app_url, "/", reduced=True) as page:
        check(page.get_by_role("radio", name="Shirt", exact=True))
        announced(page, "1.21 kg CO₂e")
        assert not motion_in(part(page, "estimate-figure"))


def test_method_layout(browser: Browser, app_url: str) -> None:
    expected = {(1100, 800): 5, (1280, 800): 5, (1099, 800): 2, (1024, 768): 2, (768, 1024): 2, (375, 812): 1}
    for size, columns in expected.items():
        with ui(browser, app_url, "/method", view=size) as page:
            xs = set()
            for stage in STAGE_NAMES.values():
                heading = page.get_by_role("heading", level=2, name=stage, exact=True)
                expect(heading).to_be_visible()
                xs.add(round(heading.bounding_box()["x"]))
            assert len(xs) == columns, f"{size}: {xs}"
            layout(page)
            expect(page.get_by_role("heading", level=2, name=re.compile("measures", re.I))).to_be_visible()


def test_wf_labels_and_styles_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    api_edges(desk, "/api/styles")
    label = make_label(desk)
    style = make_style(desk, label["id"])
    walk_rules(browser, desk, app_url, "/styles", lambda p: button(p, "New style"), lambda p: dialog(p, "New style"), typed=lambda d: labelled(d, "Name"))
    with ui(browser, app_url, "/styles", desk=desk) as page:
        frame = page.get_by_role("region", name="Styles table")
        assert frame.evaluate("(e) => e.tabIndex >= 0")
        actions = button(page, f"Actions for {style['name']}")
        actions.focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu")
        expect(menu.get_by_role("menuitem", name="Open")).to_be_focused()
        wait_refresh(page)
        expect(menu.get_by_role("menuitem", name="Open")).to_be_visible()
        axe(page)
        page.keyboard.press("Escape")
        expect(actions).to_be_focused()
    sweep_for(browser, app_url, "styles", "labels")
    with ui(browser, app_url, f"/labels/{label['id']}", desk=desk) as page:
        expect(h1(page)).to_have_text(label["name"])
        def rename() -> None:
            click(button(page, "Rename label"))
            panel = dialog(page, "Rename label")
            fill(panel.get_by_role("textbox", name="Name"), label["name"])
            click(button(panel, "Save name"))
            expect(panel).to_be_hidden()
        announced_twice(page, rename)


def test_wf_labels_and_styles_keyboard(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    make_style(desk, label["id"])
    name, number = fresh("Keyboard Tee"), gtin()
    with ui(browser, app_url, "/styles", desk=desk) as page:
        opener = button(page, "New style")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        panel = dialog(page, "New style")
        focus_in(panel)
        select(panel.get_by_role("combobox", name="Label"), label["name"])
        key_type(page, labelled(panel, "Name"), name)
        key_type(page, labelled(panel, "Season"), "AW27")
        wrong = number[:-1] + str((int(number[-1]) + 1) % 10)
        key_type(page, labelled(panel, "GTIN"), wrong)
        save = button(panel, "Save style")
        tab_to(page, save)
        page.keyboard.press("Enter")
        message = f"That GTIN's check digit should be {number[-1]}."
        focus_in(panel.get_by_role("region", name="Problems"))
        problems(panel, message, labelled(panel, "GTIN"))
        page.keyboard.press("Control+A")
        page.keyboard.type(number)
        tab_to(page, save)
        with gate(page, r"/api/styles$") as release:
            page.keyboard.press("Enter")
            working(panel)
            release()
        expect(page).to_have_url(re.compile(r"/styles/[^/]+$"))
        expect(h1(page)).to_have_text(name)
        expect(h1(page)).to_be_focused()
        announced(page, f"Style {name} added.")
    rows = want(desk.get("/api/styles", params={"q": name}), 200)["styles"]
    assert [row["gtin"] for row in rows] == [number]


def test_wf_labels_and_styles_touch(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    make_style(desk, label["id"])
    name = fresh("Touch Tee")
    with ui(browser, app_url, "/styles", desk=desk, view=PHONE, touch=True) as page:
        opener = button(page, "New style")
        fixed_bottom(opener, PHONE)
        touch_targets(page)
        expect(page.get_by_role("link", name="Passports")).to_have_count(0)
        tap(opener)
        panel = dialog(page, "New style")
        focus_in(panel)
        number = fill_style_dialog(panel, label["name"], name)
        unobscured(page)
        tap(button(panel, "Save style"))
        expect(h1(page)).to_have_text(name)
        expect(h1(page)).to_be_focused()
        page.goto(f"{app_url}/styles")
        actions = button(page, f"Actions for {name}")
        tap(actions)
        menu = page.get_by_role("menu")
        tap(menu.get_by_role("menuitem", name="Open"))
        expect(page).to_have_url(re.compile(r"/styles/[^/]+$"))
    assert want(desk.get("/api/styles", params={"q": name}), 200)["styles"][0]["gtin"] == number


def test_wf_labels_and_styles_copy_precision(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    folded_name, plain_name = "Coton Bio Éthique Tee", "Plain Tee"
    make_style(desk, label["id"], name=folded_name, gtin=gtin())
    make_style(desk, label["id"], name=plain_name, gtin=gtin())
    with ui(browser, app_url, "/styles", desk=desk) as page:
        click(button(page, "New style"))
        panel = dialog(page, "New style")
        fill_style_dialog(panel, label["name"], fresh("Tee"), code_gtin="4006381333932")
        click(button(panel, "Save style"))
        expect(panel.get_by_role("region", name="Problems")).to_contain_text("That GTIN's check digit should be 1.")
        fill(labelled(panel, "GTIN"), "123")
        click(button(panel, "Save style"))
        expect(panel.get_by_role("region", name="Problems")).to_contain_text("A GTIN has 13 digits.")
        page.keyboard.press("Escape")
        click(button(page, "Bring in catalogue"))
        catalogue = dialog(page, "Bring in catalogue")
        select(catalogue.get_by_role("combobox", name="Label"), label["name"])
        labelled(catalogue, "Catalogue file").set_input_files({"name": "catalogue.csv", "mimeType": "text/csv", "buffer": b"code,name\nHT,Tee\n"})
        click(button(catalogue, "Preview"))
        expect(catalogue).to_contain_text("The first row must be styleCode,name,season,gtin.")
        good = f"styleCode,name,season,gtin\nKA-1,{fresh('Tee')},AW27,4006381333932\n".encode()
        labelled(catalogue, "Catalogue file").set_input_files({"name": "catalogue.csv", "mimeType": "text/csv", "buffer": good})
        click(button(catalogue, "Preview"))
        table = catalogue.get_by_role("table", name="Catalogue preview")
        expect(table).to_contain_text("That GTIN's check digit should be 1.")
        announced(page, "Preview ready: 0 new, 0 matched, 1 refused.")
        page.keyboard.press("Escape")
        search = page.get_by_role("searchbox", name="Search styles")
        fill(search, "coton bio")
        page.keyboard.press("Enter")
        announced(page, "1 style shown.")
        expect(page.get_by_role("link", name=folded_name)).to_be_visible()
        expect(page.get_by_role("link", name=plain_name)).to_have_count(0)
        address(page, q=["coton bio"])
    extra_column = desk.post(f"/api/labels/{label['id']}/catalogue/preview", content=b"styleCode,name,season,gtin,colour\n", headers={"Content-Type": "text/csv"})
    want(extra_column, 422)
    assert error_message(extra_column) == "The first row must be styleCode,name,season,gtin."


def test_style_records(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    number = gtin()
    style = want(desk.post("/api/styles", {"labelId": label["id"], "name": fresh("Tee"), "season": "AW27", "gtin": number}), 201)
    assert (style["garment"], style["washes"], style["styleCode"], style["repairService"], style["rangeSize"], style["notes"], style["state"]) == ("tshirt", 30, None, None, None, None, "draft")
    assert style["newerFactors"] is None and style["version"] is not None and style["latestResult"] is None
    full = make_style(desk, label["id"], styleCode="HT-02", garment="coat", washes=12, repairService=True, rangeSize=5000, notes="Ask about dye house.")
    assert (full["styleCode"], full["garment"], full["washes"], full["repairService"], full["rangeSize"], full["notes"]) == ("HT-02", "coat", 12, True, 5000, "Ask about dye house.")
    bad = desk.post("/api/styles", {"labelId": label["id"], "name": "x", "season": "AW27", "gtin": "4006381333932"})
    want(bad, 422, "validation_failed")
    assert bad.json()["error"]["fields"]["gtin"] == "That GTIN's check digit should be 1." == error_message(bad)
    short = desk.post("/api/styles", {"labelId": label["id"], "name": "x", "season": "AW27", "gtin": "123"})
    assert short.json()["error"]["fields"]["gtin"] == "A GTIN has 13 digits."
    empty = desk.post("/api/styles", {"labelId": label["id"], "name": "", "season": "AW27", "gtin": gtin()})
    want(empty, 422)
    assert empty.json()["error"]["fields"]["name"] == "Give a value here."
    taken = desk.post("/api/styles", {"labelId": label["id"], "styleCode": "HT-02", "name": "x", "season": "AW27", "gtin": gtin()})
    want(taken, 422, "validation_failed")
    assert taken.json()["error"]["fields"]["styleCode"] == "That style code is already in this label."
    make_style(desk, make_label(desk)["id"], styleCode="HT-02")
    make_style(desk, label["id"], name="🧵" * 120)
    want(desk.post("/api/styles", {"labelId": label["id"], "name": "🧵" * 121, "season": "AW27", "gtin": gtin()}), 422)
    make_style(desk, label["id"], notes="🧵" * 2000)
    want(desk.post("/api/styles", {"labelId": label["id"], "name": "x", "season": "AW27", "gtin": gtin(), "notes": "n" * 2001}), 422)
    world, passport = published(desk)
    assert world.fresh_style()["state"] == "published"
    live = desk.post(f"/api/styles/{world.sid}/archive")
    want(live, 409, "conflict")
    assert error_message(live) == "Withdraw the passport before archiving."
    want(desk.post(f"/api/styles/{world.sid}/passport/withdraw"), 200)
    assert world.fresh_style()["state"] == "worked"
    assert want(desk.post(f"/api/styles/{world.sid}/archive"), 200)["state"] == "archived"
    frozen = desk.patch(f"/api/styles/{world.sid}", {"name": "New"})
    want(frozen, 409, "conflict")
    assert error_message(frozen) == "This style is archived."
    want(desk.post(f"/api/labels/{label['id']}/close"), 200)
    closed = desk.patch(f"/api/styles/{full['id']}", {"name": "New"})
    want(closed, 409, "conflict")
    assert error_message(closed) == "This label is closed. Bring it back first."
    assert passport["gtin"]


def test_styles_list_api(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    other = make_label(desk)
    originals = [make_style(desk, label["id"], name=f"Stitch {index:02d}", season="AW27")["id"] for index in range(PAGE_SIZE + 2)]
    first = want(desk.get("/api/styles", params={"label": label["id"]}), 200)
    assert len(first["styles"]) == PAGE_SIZE and first["nextCursor"]
    assert [row["name"] for row in first["styles"]] == sorted(row["name"] for row in first["styles"])
    make_style(desk, label["id"], name="Aardvark Before")
    make_style(desk, label["id"], name="Zebra After")
    second = want(desk.get("/api/styles", params={"label": label["id"], "cursor": first["nextCursor"]}), 200)
    seen = [row["id"] for row in first["styles"]] + [row["id"] for row in second["styles"]]
    assert len(seen) == len(set(seen)), "a page repeated a style"
    assert set(originals) <= set(seen), "a page skipped a style"
    world, _ = worked(desk)
    big = make_style(desk, world.label["id"], name="Big Coat", season="SS27")
    make_line(desk, big["id"], material="wool", grams="1200")
    want(desk.post(f"/api/styles/{big['id']}/results"), 201)
    none = make_style(desk, world.label["id"], name="Nothing Yet", season="SS27")
    climate = want(desk.get("/api/styles", params={"label": world.label["id"], "sort": "climate"}), 200)["styles"]
    assert [row["id"] for row in climate] == [world.sid, big["id"], none["id"]]
    assert climate[0]["climateShown"] == "2.20 kg CO₂e" and climate[2]["climateShown"] is None
    only = want(desk.get("/api/styles", params={"season": "SS27", "label": world.label["id"]}), 200)["styles"]
    assert {row["id"] for row in only} == {big["id"], none["id"]}
    state = want(desk.get("/api/styles", params={"state": "worked", "label": world.label["id"]}), 200)["styles"]
    assert {row["id"] for row in state} == {world.sid, big["id"]}
    for term in ("yildiz iplik", "YILDIZ İPLİK"):
        found = want(desk.get("/api/styles", params={"q": term, "label": world.label["id"]}), 200)["styles"]
        assert world.sid in [row["id"] for row in found], term
    assert climate[0]["suppliers"] == ["Yıldız İplik", "Ege Dokuma", "Surat Fibre Co-op"]
    named = make_style(desk, other["id"], name="Coton Bio Éthique")
    assert [row["id"] for row in want(desk.get("/api/styles", params={"q": "coton bio", "label": other["id"]}), 200)["styles"]] == [named["id"]]
    want(desk.post(f"/api/styles/{named['id']}/archive"), 200)
    assert want(desk.get("/api/styles", params={"label": other["id"]}), 200)["styles"] == []
    assert [row["id"] for row in want(desk.get("/api/styles", params={"label": other["id"], "state": "archived"}), 200)["styles"]] == [named["id"]]


def test_styles_list_address(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    stitches = [f"Stitch {index:02d}" for index in range(PAGE_SIZE + 2)]
    for index, stitch in enumerate(stitches):
        make_style(desk, label["id"], name=stitch, season="AW27" if index % 2 else "SS27")
    with ui(browser, app_url, "/styles", desk=desk) as page:
        expect(page.get_by_role("link", name=stitches[0])).to_be_visible()
        count = history(page)
        select(page.get_by_role("combobox", name="Season"), "SS27")
        announced(page, "14 styles shown.")
        address(page, entries=count + 1, season=["SS27"])
        select(page.get_by_role("combobox", name="Season"), "All seasons")
        expect(page.get_by_role("link", name=stitches[1])).to_be_visible()
        address(page, entries=count + 2, season=None)
        page.go_back()
        expect(page.get_by_role("link", name=stitches[1])).to_have_count(0)
        address(page, season=["SS27"])
        page.go_forward()
        expect(page.get_by_role("link", name=stitches[1])).to_be_visible()
        select(page.get_by_role("combobox", name="Sort by"), "Climate figure")
        expect(page).to_have_url(re.compile(r"sort=climate"))
        select(page.get_by_role("combobox", name="Sort by"), "Name")
        expect(page).to_have_url(re.compile(r"sort=name"))
        search = page.get_by_role("searchbox", name="Search styles")
        fill(search, "stitch")
        before = history(page)
        page.keyboard.press("Enter")
        address(page, entries=before + 1, q=["stitch"])
        next_page = button(page, "Next page")
        click(next_page)
        expect(page).to_have_url(re.compile(r"cursor="))
        cursor_url = page.url
        target = page.get_by_role("link", name=stitches[-1])
        expect(target).to_be_visible()
        target.scroll_into_view_if_needed()
        scrolled = page.evaluate("() => window.scrollY")
        click(target)
        expect(page).to_have_url(re.compile(r"/styles/[^/?]+$"))
        expect(h1(page)).to_have_text(stitches[-1])
        page.go_back()
        expect(page).to_have_url(cursor_url)
        expect(page.get_by_role("link", name=stitches[-1])).to_be_focused()
        assert abs(page.evaluate("() => window.scrollY") - scrolled) <= 2
        expect(page.get_by_role("link", name=stitches[0])).to_have_count(0)


def test_row_menu(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    styles = [make_style(desk, label["id"], name=f"Row {index:02d}") for index in range(9)]
    last = styles[-1]
    for view in (PHONE, LAPTOP):
        with ui(browser, app_url, "/styles", desk=desk, view=view, touch=view == PHONE) as page:
            actions = button(page, f"Actions for {last['name']}")
            actions.scroll_into_view_if_needed()
            actions.focus()
            page.keyboard.press("Enter")
            menu = page.get_by_role("menu")
            expect(menu.get_by_role("menuitem", name="Open")).to_be_focused()
            settled(page)
            for item in ("Open", "Duplicate", "Archive"):
                hit(menu.get_by_role("menuitem", name=item), view)
            page.keyboard.press("ArrowDown")
            expect(menu.get_by_role("menuitem", name="Duplicate")).to_be_focused()
            page.keyboard.press("ArrowUp")
            expect(menu.get_by_role("menuitem", name="Open")).to_be_focused()
            page.keyboard.press("Escape")
            expect(actions).to_be_focused()
            click(actions)
            expect(menu).to_be_visible()
            page.mouse.click(2, 2) if view == LAPTOP else page.touchscreen.tap(2, 120)
            expect(menu).to_have_count(0)
            click(actions)
            click(menu.get_by_role("menuitem", name="Open"))
            expect(page).to_have_url(re.compile(rf"/styles/{re.escape(last['id'])}$"))


def test_duplicate_and_archive(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk, styleCode="DA-1", notes="Keep me.", repairService=True, rangeSize=7)
    name = world.style["name"]
    with ui(browser, app_url, "/styles", desk=desk) as page:
        click(button(page, f"Actions for {name}"))
        click(page.get_by_role("menu").get_by_role("menuitem", name="Duplicate"))
        expect(h1(page)).to_have_text(f"{name} (copy)")
        expect(h1(page)).to_be_focused()
        announced(page, f"Style {name} (copy) added.")
        copy_id = urlparse(page.url).path.rsplit("/", 1)[-1]
        assert copy_id != world.sid
        copy = want(desk.get(f"/api/styles/{copy_id}"), 200)
        assert (copy["state"], copy["styleCode"], copy["latestResult"], copy["notes"], copy["repairService"], copy["rangeSize"], copy["gtin"]) == ("draft", None, None, "Keep me.", True, 7, world.style["gtin"])
        assert copy["score"] is None or copy["score"]["state"] == "none"
        lines = want(desk.get(f"/api/styles/{copy_id}/lines"), 200)["lines"]
        assert [(line["materialId"], line["massGrams"]) for line in lines] == [("organic-cotton", lines[0]["massGrams"])]
        assert Decimal(lines[0]["massGrams"]) == 250 and lines[0]["tier3"]["country"] == "IN"
        assert len(copy["legs"]) == 1 and want(desk.get(f"/api/styles/{copy_id}/results"), 200)["results"] == []
        page.goto(f"{app_url}/styles")
        click(button(page, f"Actions for {name} (copy)"))
        click(page.get_by_role("menu").get_by_role("menuitem", name="Archive"))
        announced(page, f"Style {name} (copy) archived.")
        expect(page.get_by_role("link", name=f"{name} (copy)")).to_have_count(0)
        expect(h1(page)).to_be_focused()
        wait_refresh(page)
        expect(h1(page)).to_be_focused()
    assert want(desk.get(f"/api/styles/{copy_id}"), 200)["state"] == "archived"


CATALOGUE_CASES = {"lf": ("", "\n"), "crlf": ("", "\r\n"), "bom_lf": ("\ufeff", "\n"), "bom_crlf": ("\ufeff", "\r\n")}


@pytest.mark.parametrize("bom,newline", list(CATALOGUE_CASES.values()), ids=list(CATALOGUE_CASES))
def test_catalogue(app_url: str, bom: str, newline: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    old_name = fresh("Old One")
    existing = make_style(desk, label["id"], styleCode="OLD-1", name=old_name)
    good = gtin()
    rows = ["styleCode,name,season,gtin", f'NEW-1,"Tee, Quoted",AW27,{good}', f"OLD-1,Other Name,AW27,{gtin()}", "BAD-1,Tee,AW27,4006381333932", "BAD-2,Tee,AW27,123", f"BAD-3,,AW27,{gtin()}", f"BAD-4,Tee,,{gtin()}", f"NEW-1,Tee Again,AW27,{gtin()}"]
    content = (bom + newline.join(rows) + newline).encode("utf-8")
    headers = {"Content-Type": "text/csv"}
    before = want(desk.get("/api/styles", params={"label": label["id"]}), 200)["styles"]
    preview = want(desk.post(f"/api/labels/{label['id']}/catalogue/preview", content=content, headers=headers), 200)
    assert (preview["newCount"], preview["matchedCount"], preview["refusedCount"]) == (1, 1, 5)
    by_row = {row["row"]: row for row in preview["rows"]}
    assert (by_row[2]["outcome"], by_row[2]["styleCode"], by_row[2]["name"], by_row[2]["reason"]) == ("new", "NEW-1", "Tee, Quoted", None)
    assert by_row[3]["outcome"] == "matched"
    assert (by_row[4]["outcome"], by_row[4]["reason"]) == ("refused", "That GTIN's check digit should be 1.")
    assert by_row[5]["reason"] == "A GTIN has 13 digits."
    assert by_row[6]["reason"] == "A name is needed."
    assert by_row[7]["reason"] == "A season is needed."
    assert by_row[8]["reason"] == "This style code is already on row 2."
    assert want(desk.get("/api/styles", params={"label": label["id"]}), 200)["styles"] == before
    saved = want(desk.post(f"/api/labels/{label['id']}/catalogue/save", content=content, headers=headers), 200)
    assert (saved["newCount"], saved["matchedCount"], saved["refusedCount"]) == (1, 1, 5)
    after = want(desk.get("/api/styles", params={"label": label["id"]}), 200)["styles"]
    assert {row["styleCode"] for row in after} == {"OLD-1", "NEW-1"}
    created = next(row for row in after if row["styleCode"] == "NEW-1")
    assert (created["name"], created["gtin"], created["garment"]) == ("Tee, Quoted", good, "tshirt")
    assert next(row for row in after if row["id"] == existing["id"])["name"] == old_name
    again = want(desk.post(f"/api/labels/{label['id']}/catalogue/save", content=content, headers=headers), 200)
    assert (again["newCount"], again["matchedCount"]) == (0, 2)
    assert {row["id"] for row in want(desk.get("/api/styles", params={"label": label["id"]}), 200)["styles"]} == {row["id"] for row in after}
    wrong = desk.post(f"/api/labels/{label['id']}/catalogue/preview", content=b"code,name\n", headers=headers)
    want(wrong, 422)
    assert error_message(wrong) == "The first row must be styleCode,name,season,gtin." and "fields" not in wrong.json()["error"]
    want(desk.post(f"/api/labels/{label['id']}/catalogue/preview", content=content, headers={"Content-Type": "application/json"}), 415, "unsupported_media_type")
    want(desk.post(f"/api/labels/{label['id']}/close"), 200)
    want(desk.post(f"/api/labels/{label['id']}/catalogue/save", content=content, headers=headers), 409)


def test_wf_bill_of_materials_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    api_edges(desk, f"/api/styles/{world.sid}/lines")
    walk_rules(browser, desk, app_url, f"/styles/{world.sid}/materials", lambda p: button(p, "Add material"), lambda p: dialog(p, "Add material"), typed=lambda d: labelled(d, "Fibre 1 name"))
    sweep_for(browser, app_url, "materials")
    with ui(browser, app_url, f"/styles/{world.sid}/materials", desk=desk) as page:
        expect(h1(page)).to_be_visible()
        def add_leg() -> None:
            click(button(page, "Add leg"))
            leg = dialog(page, "Add leg")
            select(labelled(leg, "Mode"), "Rail")
            fill(labelled(leg, "Distance (km)"), "450")
            click(button(leg, "Save leg"))
            expect(leg).to_be_hidden()
        announced_twice(page, add_leg)


def test_wf_bill_of_materials_keyboard(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    with ui(browser, app_url, f"/styles/{world.sid}/materials", desk=desk) as page:
        expect(h1(page)).to_have_text(f"Materials for {world.style['name']}")
        opener = button(page, "Add material")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        panel = dialog(page, "Add material")
        focus_in(panel)
        typed_share = "99.9"
        fill_material(panel, "Linen", "300", typed_share)
        save = button(panel, "Save material")
        tab_to(page, save)
        page.keyboard.press("Enter")
        message = f"The fibres add up to {typed_share}%. They must add up to 100.0%."
        expect(panel.get_by_role("region", name="Problems")).to_contain_text(message)
        focus_in(panel.get_by_role("region", name="Problems"))
        fill(labelled(panel, "Fibre 1 share (%)"), "100.0")
        tab_to(page, save)
        with gate(page, r"/api/styles/[^/]+/lines$") as release:
            page.keyboard.press("Enter")
            working(panel)
            release()
        expect(panel).to_be_hidden()
        expect(opener).to_be_focused()
        announced(page, "Linen added.")
        add_leg = button(page, "Add leg")
        tab_to(page, add_leg)
        page.keyboard.press("Enter")
        leg = dialog(page, "Add leg")
        select(labelled(leg, "Mode"), "Rail")
        key_type(page, labelled(leg, "Distance (km)"), "450")
        tab_to(page, button(leg, "Save leg"))
        page.keyboard.press("Enter")
        expect(add_leg).to_be_focused()
        announced(page, "Transport leg added.")
        wait_refresh(page)
        expect(add_leg).to_be_focused()
    lines = want(desk.get(f"/api/styles/{world.sid}/lines"), 200)["lines"]
    assert [line["materialId"] for line in lines] == ["organic-cotton", "linen"]
    assert [leg_row["mode"] for leg_row in world.fresh_style()["legs"]] == ["road", "rail"]


def test_wf_bill_of_materials_touch(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    make_line(desk, world.sid, material="linen", grams="100")
    with ui(browser, app_url, f"/styles/{world.sid}/materials", desk=desk, view=PHONE, touch=True) as page:
        opener = button(page, "Add material")
        fixed_bottom(opener, PHONE)
        touch_targets(page)
        tap(opener)
        panel = dialog(page, "Add material")
        expect(panel).to_be_visible()
        settled(page)
        box = panel.bounding_box()
        assert box and box["height"] >= PHONE[1] - 1, f"not a full-height sheet: {box}"
        touch_targets(page)
        fill_material(panel, "Wool", "120")
        tap(button(panel, "Save material"))
        announced(page, "Wool added.")
        linen = page.get_by_role("listitem", name="Linen")
        tap(button(linen, "Move up"))
        announced(page, "Linen moved to position 1 of 3.")
        layout(page)
    lines = want(desk.get(f"/api/styles/{world.sid}/lines"), 200)["lines"]
    assert [line["materialId"] for line in lines] == ["linen", "organic-cotton", "wool"]


def test_wf_bill_of_materials_copy_precision(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    with ui(browser, app_url, f"/styles/{world.sid}/materials", desk=desk) as page:
        click(button(page, "Add material"))
        panel = dialog(page, "Add material")
        choose_material(panel, "Linen")
        check(panel.get_by_role("radio", name="Fabric weight and area"))
        fill(labelled(panel, "Fabric weight (g/m²)"), "215")
        fill(labelled(panel, "Area (m²)"), "1.15")
        fill(labelled(panel, "Fibre 1 name"), "Linen")
        typed_share = "50.0"
        fill(labelled(panel, "Fibre 1 share (%)"), typed_share)
        click(button(panel, "Save material"))
        expect(panel.get_by_role("region", name="Problems")).to_contain_text(f"The fibres add up to {typed_share}%. They must add up to 100.0%.")
        fill(labelled(panel, "Fibre 1 share (%)"), "100.0")
        click(button(panel, "Save material"))
        expect(panel).to_be_hidden()
        expect(page.get_by_role("listitem", name="Linen")).to_contain_text("247.3 g")
        click(button(page, "Add material"))
        panel = dialog(page, "Add material")
        choose_material(panel, "Wool")
        check(panel.get_by_role("radio", name="Fabric weight and area"))
        fill(labelled(panel, "Fabric weight (g/m²)"), "165")
        fill(labelled(panel, "Area (m²)"), "1.47")
        fill(labelled(panel, "Fibre 1 name"), "Wool")
        fill(labelled(panel, "Fibre 1 share (%)"), "100.0")
        changed = want(desk.patch(f"/api/styles/{world.sid}", {"washes": 31}), 200)
        click(button(panel, "Save material"))
        expect(panel.get_by_role("region", name="Problems")).to_contain_text(f"This style was changed at {wall_time(changed['changedAt'])} Lisbon time elsewhere. Your changes are still here.")
        expect(labelled(panel, "Area (m²)")).to_have_value("1.47")
    line = want(desk.get(f"/api/styles/{world.sid}/lines"), 200)["lines"][1]
    assert Decimal(line["massGrams"]) == Decimal("247.25") and line["massShown"] == "247.3 g"


def test_exact_mass_and_fibres(app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    style = make_style(desk, make_label(desk)["id"])
    path = f"/api/styles/{style['id']}/lines"
    base = {"materialId": "cotton", "tier1": None, "tier2": None, "tier3": None}
    for weight, area, exact, shown in (("215", "1.15", "247.25", "247.3 g"), ("165", "1.47", "242.55", "242.6 g")):
        line = want(desk.post(path, {**base, "fabricWeightGsm": weight, "areaM2": area, "fibres": [{"name": "Cotton", "sharePercent": "100.0"}]}), 201)
        assert Decimal(line["massGrams"]) == Decimal(exact) and line["massShown"] == shown
    split = want(desk.post(path, {**base, "massGrams": "247.25", "fibres": [{"name": "Cotton", "sharePercent": "33.3"}, {"name": "Linen", "sharePercent": "66.7"}]}), 201)
    assert len(split["fibres"]) == 2 and split["massShown"] == "247.3 g"
    count = len(want(desk.get(path), 200)["lines"])
    off = desk.post(path, {**base, "massGrams": "250", "fibres": [{"name": "Cotton", "sharePercent": "33.3"}, {"name": "Linen", "sharePercent": "66.6"}]})
    want(off, 422, "validation_failed")
    assert off.json()["error"]["fields"]["fibres"] == f"The fibres add up to {Decimal('33.3') + Decimal('66.6')}%. They must add up to 100.0%."
    form = desk.post(path, {**base, "massGrams": "250", "fibres": [{"name": "Cotton", "sharePercent": "100"}]})
    want(form, 422)
    assert form.json()["error"]["fields"]["fibres.0.sharePercent"] == "Give each fibre share with one decimal."
    mass = desk.post(path, {**base, "fibres": [{"name": "Cotton", "sharePercent": "100.0"}]})
    want(mass, 422)
    assert mass.json()["error"]["fields"]["massGrams"] == "Give a fabric weight and area, or a plain mass."
    assert len(want(desk.get(path), 200)["lines"]) == count


def test_add_material_combobox(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    materials = want(desk.get("/api/materials"), 200)["materials"]
    assert {m["id"]: m["name"] for m in materials} == MATERIAL_NAMES
    assert [m["id"] for m in want(desk.get("/api/materials", params={"q": "lyocell"}), 200)["materials"]] == ["lyocell"]
    with ui(browser, app_url, f"/styles/{world.sid}/materials", desk=desk) as page:
        click(button(page, "Add material"))
        panel = dialog(page, "Add material")
        combo = panel.get_by_role("combobox", name="Material")
        listbox = page.get_by_role("listbox", name="Materials")
        with first_held(page, r"/api/materials\?.*q=wool") as release:
            combo.click()
            with page.expect_request(re.compile(r"q=wool")):
                combo.press_sequentially("wool")
            combo.fill("")
            combo.press_sequentially("lyo")
            expect(listbox.get_by_role("option", name="Lyocell")).to_be_visible()
            let_go(page, release, r"q=wool")
            settled(page)
            expect(listbox.get_by_role("option", name="Lyocell")).to_be_visible()
            expect(listbox.get_by_role("option", name="Wool", exact=True)).to_have_count(0)
        combo.fill("")
        combo.press_sequentially("cotton")
        expect(listbox.get_by_role("option", name="Recycled cotton")).to_be_visible()
        expect(combo).to_have_attribute("aria-expanded", "true")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        expect(panel).to_be_visible()
        assert combo.input_value() in ("Cotton", "Organic cotton", "Recycled cotton")
        combo.fill("")
        combo.press_sequentially("line")
        expect(listbox.get_by_role("option", name="Linen")).to_be_visible()
        page.keyboard.press("Escape")
        expect(listbox).to_be_hidden()
        expect(panel).to_be_visible()
        focus_in(panel)


def test_reordering_lines(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    style = make_style(desk, make_label(desk)["id"])
    sid = style["id"]
    linen = make_line(desk, sid, material="linen")
    make_line(desk, sid, material="wool")
    viscose = make_line(desk, sid, material="viscose")
    order = lambda: [line["materialId"] for line in want(desk.get(f"/api/styles/{sid}/lines"), 200)["lines"]]
    with ui(browser, app_url, f"/styles/{sid}/materials", desk=desk) as page:
        first = page.get_by_role("listitem", name="Linen")
        up = button(first, "Move up")
        expect(up).to_have_attribute("aria-disabled", "true")
        assert up.get_attribute("disabled") is None
        last_down = button(page.get_by_role("listitem", name="Viscose"), "Move down")
        expect(last_down).to_have_attribute("aria-disabled", "true")
        assert last_down.get_attribute("disabled") is None
        up.focus()
        expect(up).to_be_focused()
        page.keyboard.press("Enter")
        assert order() == ["linen", "wool", "viscose"]
        down = button(first, "Move down")
        down.focus()
        with gate(page, r"/move$") as release:
            page.keyboard.press("Enter")
            pending = first.get_by_role("button", name="Working…")
            expect(pending).to_have_attribute("aria-disabled", "true")
            assert pending.get_attribute("disabled") is None
            release()
        announced(page, "Linen moved to position 2 of 3.")
        expect(button(page.get_by_role("listitem", name="Linen"), "Move down")).to_be_focused()
        assert order() == ["wool", "linen", "viscose"]
        edit = button(page.get_by_role("listitem", name="Linen"), "Edit")
        edit.focus()
        page.keyboard.press("Alt+ArrowDown")
        announced(page, "Linen moved to position 3 of 3.")
        expect(button(page.get_by_role("listitem", name="Linen"), "Edit")).to_be_focused()
        page.keyboard.press("Alt+ArrowUp")
        announced(page, "Linen moved to position 2 of 3.")
        assert order() == ["wool", "linen", "viscose"]
        page.reload()
        wool_item, linen_item = page.get_by_role("listitem", name="Wool"), page.get_by_role("listitem", name="Linen")
        expect(wool_item).to_be_visible()
        expect(linen_item).to_be_visible()
        assert wool_item.bounding_box()["y"] < linen_item.bounding_box()["y"], "the order did not survive a reload"
    version = want(desk.get(f"/api/styles/{sid}/lines"), 200)["version"]
    moved = want(desk.post(f"/api/styles/{sid}/lines/{linen['id']}/move", {"direction": "down", "baseVersion": version}), 200)
    assert (moved["position"], moved["total"], moved["version"]) == (3, 3, moved["version"]) and moved["version"] > version
    stale = desk.post(f"/api/styles/{sid}/lines/{viscose['id']}/move", {"direction": "up", "baseVersion": version})
    want(stale, 412, "stale_edit")
    at_end = desk.post(f"/api/styles/{sid}/lines/{linen['id']}/move", {"direction": "down"})
    want(at_end, 409, "conflict")
    assert error_message(at_end) == "That line is already at the end."
    want(desk.post(f"/api/styles/{sid}/lines/{linen['id']}/move", {"direction": "down", "baseVersion": version}), 412, "stale_edit")
    want(desk.post(f"/api/styles/{sid}/lines/{linen['id']}/move", {"direction": "sideways"}), 422)


def test_stale_saves(browser: Browser, app_url: str, mail: Any) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    version = world.style["version"]
    current = world.fresh_style()["version"]
    assert current > version
    first_note = "First"
    want(desk.patch(f"/api/styles/{world.sid}", {"notes": first_note}), 200)
    stale = desk.patch(f"/api/styles/{world.sid}", {"notes": "Second", "baseVersion": current})
    want(stale, 412, "stale_edit")
    changed = world.fresh_style()
    assert error_message(stale) == f"This style was changed at {wall_time(changed['changedAt'])} Lisbon time elsewhere. Your changes are still here."
    assert changed["notes"] == first_note and changed["changedBy"] is None
    before = changed["version"]
    supplier = "Rua Fibres"
    request = ask(world, language="en", supplier=supplier)
    want(page_answer(app_url, token_of(request["answerAddress"]), {"energy": {"value": "4.35", "unit": "kWh"}, "water": {"value": "12.5"}, "fibreOrigin": "TR"}), 201)
    after = world.fresh_style()
    assert after["version"] > before and after["changedBy"] == supplier
    by_answer = desk.patch(f"/api/styles/{world.sid}", {"notes": "Third", "baseVersion": before})
    want(by_answer, 412, "stale_edit")
    assert error_message(by_answer) == f"This style was changed at {wall_time(after['changedAt'])} Lisbon time by {supplier}'s answer. Your changes are still here."
    want(desk.post(f"/api/styles/{world.sid}/legs", {"mode": "sea", "km": "1", "baseVersion": before}), 412, "stale_edit")
    want(desk.delete(f"/api/styles/{world.sid}/lines/{world.line['id']}", params={"baseVersion": before}), 412, "stale_edit")
    assert len(want(desk.get(f"/api/styles/{world.sid}/lines"), 200)["lines"]) == 1
    with ui(browser, app_url, f"/styles/{world.sid}/materials", desk=desk) as page:
        click(button(page, "Add material"))
        panel = dialog(page, "Add material")
        fill_material(panel, "Linen", "300")
        moved = want(desk.patch(f"/api/styles/{world.sid}", {"washes": 40}), 200)
        click(button(panel, "Save material"))
        region = panel.get_by_role("region", name="Problems")
        expect(region).to_contain_text(f"This style was changed at {wall_time(moved['changedAt'])} Lisbon time")
        focus_in(region)
        expect(labelled(panel, "Mass (g)")).to_have_value("300")
        wait_refresh(page)
        expect(region).to_contain_text("Your changes are still here.")
    assert len(want(desk.get(f"/api/styles/{world.sid}/lines"), 200)["lines"]) == 1


def test_wf_supplier_requests_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    ask(world)
    api_edges(desk, "/api/requests")
    walk_rules(browser, desk, app_url, "/requests", lambda p: button(p, "New request"), lambda p: dialog(p, "New request"), typed=lambda d: labelled(d, "Supplier"))
    with ui(browser, app_url, "/requests", desk=desk, view=PHONE, touch=True) as page:
        assert page.get_by_role("region", name="Requests table").evaluate("(e) => e.tabIndex >= 0")
    sweep_for(browser, app_url, "requests")
    supplier = ask(world)["supplierName"]
    with ui(browser, app_url, "/requests", desk=desk) as page:
        renew = button(page, f"New address for {supplier}")
        expect(renew).to_be_visible()
        announced_twice(page, lambda: click(renew))


def test_wf_supplier_requests_keyboard(browser: Browser, app_url: str, mail: Any) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    ask(world)
    supplier, email = fresh("Kuzey Fibres"), fresh_mail()
    with ui(browser, app_url, "/requests", desk=desk) as page:
        opener = button(page, "New request")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        panel = dialog(page, "New request")
        focus_in(panel)
        fill_request(panel, world, supplier, email, due_date(app_url))
        send = button(panel, "Send request")
        tab_to(page, send)
        with gate(page, r"/api/requests$") as release:
            page.keyboard.press("Enter")
            working(panel)
            release()
        expect(panel).to_be_hidden()
        expect(opener).to_be_focused()
        announced(page, f"Request sent to {supplier}.")
        first = mail_to(mail, email)[0]
        old_token = token_of(mail_text(first))
        fresh_address = button(page, f"New address for {supplier}")
        tab_to(page, fresh_address)
        page.keyboard.press("Enter")
        announced(page, f"New address sent to {supplier}.")
        expect(fresh_address).to_be_focused()
        want(page_get(app_url, old_token), 410, "page_ended")
        tokens = [token_of(mail_text(message)) for message in mail_to(mail, email, 2)]
        new_token = next(token for token in tokens if token != old_token)
        want(page_get(app_url, new_token), 200)
        end = button(page, f"End page for {supplier}")
        tab_to(page, end)
        page.keyboard.press("Enter")
        announced(page, f"Page ended for {supplier}.")
        want(page_get(app_url, new_token), 410, "page_ended")


def test_wf_supplier_requests_touch(browser: Browser, app_url: str, mail: Any) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    ask(world)
    supplier, email = fresh("Touch Fibres"), fresh_mail()
    with ui(browser, app_url, "/requests", desk=desk, view=PHONE, touch=True) as page:
        opener = button(page, "New request")
        fixed_bottom(opener, PHONE)
        tap(opener)
        panel = dialog(page, "New request")
        focus_in(panel)
        fill_request(panel, world, supplier, email, due_date(app_url))
        touch_targets(page)
        tap(button(panel, "Send request"))
        announced(page, f"Request sent to {supplier}.")
        token = token_of(mail_text(mail_to(mail, email)[0]))
        evidence = want(page_file(app_url, token, "a.png", PNG_BYTES), 201)
        want(page_answer(app_url, token, {"energy": {"value": "4,35", "unit": "kWh"}, "evidenceIds": [evidence["evidenceId"]]}), 201)
        show = button(page, f"Show answer for {supplier}")
        expect(show).to_be_visible()
        expect(page.get_by_role("region", name="Requests table")).to_contain_text("Answered", timeout=REFRESH_WAIT_MS)
        tap(show)
        expect(button(page, f"Download evidence 1 for {supplier}")).to_be_visible()
        wait_refresh(page)
        expect(button(page, f"Download evidence 1 for {supplier}")).to_be_visible()
        layout(page)


def test_wf_supplier_requests_copy_precision(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    far = ask(world, due=(server_now(app_url) + timedelta(days=40)).strftime("%Y-%m-%d"))
    assert parse_instant(far["endsAt"]) == parse_instant(far["sentAt"]) + timedelta(seconds=1209600)
    sent_local = parse_instant(far["sentAt"]).astimezone(ZoneInfo("Europe/Istanbul"))
    near_date = sent_local + timedelta(days=2)
    near = ask(world, due=near_date.strftime("%Y-%m-%d"))
    assert near["endsAt"] == near_date.replace(hour=23, minute=59, second=59, microsecond=0).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    today = ask(world, due=sent_local.strftime("%Y-%m-%d"))
    assert today["state"] == "sent"
    past = desk.post("/api/requests", {"styleId": world.sid, "lineId": world.line["id"], "supplierName": "Past", "contactName": "P", "contactEmail": fresh_mail(), "town": "izmir", "language": "en", "questions": ["energy"], "dueDate": (sent_local - timedelta(days=1)).strftime("%Y-%m-%d")})
    want(past, 422, "validation_failed")
    assert past.json()["error"]["fields"]["dueDate"] == "The due date must be today or later in Izmir."
    bad_date = desk.post("/api/requests", {"styleId": world.sid, "lineId": world.line["id"], "supplierName": "Past", "contactName": "P", "contactEmail": fresh_mail(), "town": "izmir", "language": "en", "questions": ["energy"], "dueDate": "29/03/2027"})
    assert bad_date.json()["error"]["fields"]["dueDate"] == "Give the date as YYYY-MM-DD."
    for _ in range(REQUEST_LIMIT - 3):
        ask(world)
    refused = desk.post("/api/requests", {"styleId": world.sid, "lineId": world.line["id"], "supplierName": "One More", "contactName": "P", "contactEmail": fresh_mail(), "town": "izmir", "language": "en", "questions": ["energy"], "dueDate": due_date(app_url)})
    want(refused, 429, "rate_limited")
    with ui(browser, app_url, "/requests", desk=desk) as page:
        click(button(page, "New request"))
        panel = dialog(page, "New request")
        typed_supplier = "One More"
        fill_request(panel, world, typed_supplier, fresh_mail(), due_date(app_url))
        click(button(panel, "Send request"))
        region = panel.get_by_role("region", name="Problems")
        expect(region).to_contain_text(re.compile(r"Too many requests for now\. You can send another at \d\d:\d\d Lisbon time\."))
        focus_in(region)
        expect(labelled(panel, "Supplier")).to_have_value(typed_supplier)


def _mail_style(desk: Desk) -> tuple[World, World]:
    world, _ = worked(desk)
    other = harbour(desk)
    ask(other, language="en", supplier=OTHER_SUPPLIER)
    return world, other


@pytest.mark.parametrize("language,town", [("en", "porto"), ("fr", "hoChiMinhCity"), ("tr", "izmir"), ("ar", "cairo")], ids=["en", "fr", "tr", "ar"])
def test_request_mail(app_url: str, mail: Any, wiremock: Any, language: str, town: str) -> None:
    desk = Desk.sign_up(app_url)
    world, other = _mail_style(desk)
    due = due_date(app_url, town=town)
    request = ask(world, language=language, town=town, supplier=fresh("Nur"), due=due)
    message = mail_to(mail, request["contactEmail"])[0]
    copy, labels = MAIL_COPY[language], world.label["name"]
    assert message["Subject"] == copy["subject"].format(label=labels)
    assert _kit("mail_from_address", "mailpit")() in _kit("addresses", "mailpit")(message["From"])
    assert addresses_named(message["From"]) == "Fio Contado Desk"
    body = mail_text(message)
    token = token_of(request["answerAddress"])
    expected = [copy["greeting"].format(contact=request["contactName"]), copy["ask"].format(label=labels, style=world.style["name"]), f"/a/{token}", ANSWER_COPY[language]["due"].format(due=due, town=TOWN_NAMES[town])]
    places = [body.find(piece) for piece in expected]
    assert all(place >= 0 for place in places), (places, body)
    assert places == sorted(places)
    assert not re.search(r"2\.20|kg CO₂e|1,140", body), "a footprint figure in the mail"
    assert other.label["name"] not in body and OTHER_SUPPLIER not in body and other.style["name"] not in body
    want(page_get(app_url, token), 200)


def addresses_named(field: Any) -> str:
    entry = field[0] if isinstance(field, list) else field
    return entry.get("Name", "") if isinstance(entry, dict) else str(entry)


def test_page_ends_at_edge(app_url: str) -> None:
    short = os.environ["APP_SHORT_URL"]
    desk = Desk.sign_up(short)
    world = harbour(desk)
    request = ask(world, language="fr")
    token = token_of(request["answerAddress"])
    ends = parse_instant(request["endsAt"])
    assert ends == parse_instant(request["sentAt"]) + timedelta(seconds=20)
    def step() -> bool:
        before = server_now(short)
        status = page_get(short, token).status_code
        after = server_now(short)
        if before >= ends:
            assert status == 410, f"at {before} (ends {ends}) the page answered {status}"
        if after < ends:
            assert status == 200, f"before the end {after} the page answered {status}"
        return status == 410 and before >= ends
    poll(step, "the answer page ended at endsAt")
    ended = page_get(short, token)
    want(ended, 410, "page_ended")
    assert error_message(ended) == ANSWER_COPY["fr"]["ended"]
    want(page_answer(short, token, {"energy": {"value": "1", "unit": "MJ"}}), 410, "page_ended")
    assert want(desk.get(f"/api/requests/{request['id']}"), 200)["state"] == "ended"


def test_page_lifetime_and_reminder(app_url: str, mail: Any) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    request = ask(world, language="ar", town="cairo", questions=["water"])
    old = token_of(request["answerAddress"])
    renewed = want(desk.post(f"/api/requests/{request['id']}/new-address"), 201)
    new = token_of(renewed["answerAddress"])
    assert new != old and renewed["state"] == "sent"
    document = httpx.get(f"{app_url}/a/{old}", timeout=HTTP_TIMEOUT)
    assert document.status_code == 410
    assert re.search(r'<html[^>]*lang="ar"', document.text) and re.search(r'<html[^>]*dir="rtl"', document.text)
    want(page_get(app_url, new), 200)
    assert want(desk.post(f"/api/requests/{request['id']}/end"), 200)["state"] == "ended"
    response = page_get(app_url, new)
    want(response, 410, "page_ended")
    assert error_message(response) == ANSWER_COPY["ar"]["ended"]
    again = want(desk.post(f"/api/requests/{request['id']}/new-address"), 201)
    want(page_answer(app_url, token_of(again["answerAddress"]), {"water": {"value": "12.5"}}), 201)
    want(desk.post(f"/api/requests/{request['id']}/end"), 409)
    want(desk.post(f"/api/requests/{request['id']}/new-address"), 409)
    short = os.environ["APP_SHORT_URL"]
    far_desk = Desk.sign_up(short)
    far = harbour(far_desk)
    waiting = ask(far, language="tr")
    answered = ask(far, language="tr", questions=["water"])
    want(page_answer(short, token_of(answered["answerAddress"]), {"water": {"value": "12,5"}}), 201)
    subject = MAIL_COPY["tr"]["reminder"].format(label=far.label["name"])
    reminders = lambda address: [m for m in mail_to(mail, address) if m["Subject"] == subject]
    poll(lambda: reminders(waiting["contactEmail"]), "one reminder within 5 seconds of the 10-second setting")
    state = want(far_desk.get(f"/api/requests/{waiting['id']}"), 200)
    assert state["state"] == "reminded"
    gap = (parse_instant(state["remindedAt"]) - parse_instant(state["sentAt"])).total_seconds()
    assert SHORT_REMINDER <= gap <= SHORT_REMINDER + ERASE_WITHIN, gap
    poll(lambda: want(far_desk.get(f"/api/requests/{waiting['id']}"), 200)["state"] == "ended", "the page ended by its short timer")
    assert len(reminders(waiting["contactEmail"])) == 1, "exactly one reminder"
    assert reminders(answered["contactEmail"]) == [], "an answered request gets no reminder"


def test_request_rate_limit(app_url: str, mail: Any) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    for _ in range(REQUEST_LIMIT - 1):
        ask(world)
    renewing = ask(world)
    body = {"styleId": world.sid, "lineId": world.line["id"], "supplierName": "Twenty One", "contactName": "T", "contactEmail": fresh_mail(), "town": "izmir", "language": "en", "questions": ["energy"], "dueDate": due_date(app_url)}
    refused = desk.post("/api/requests", body)
    want(refused, 429, "rate_limited")
    retry = int(refused.headers["retry-after"])
    assert retry > 0
    match = re.fullmatch(r"Too many requests for now\. You can send another at (\d\d:\d\d) Lisbon time\.", error_message(refused))
    assert match, error_message(refused)
    now = server_now(app_url)
    allowed = {wall_time(now + timedelta(seconds=retry + delta)) for delta in (-60, 0, 60)}
    assert match.group(1) in allowed
    want(desk.post(f"/api/requests/{renewing['id']}/new-address"), 429, "rate_limited")
    want(desk.post("/api/requests", {**body, "styleId": "unknown-style"}), 429, "rate_limited")
    other_session = Desk.sign_in(app_url, desk.email)
    want(other_session.post("/api/requests", body, headers={"X-Forwarded-For": "203.0.113.9"}), 429, "rate_limited")
    want(httpx.post(f"{app_url}/api/requests", json=body, timeout=HTTP_TIMEOUT), 401, "not_signed_in")
    other = Desk.sign_up(app_url)
    ask(harbour(other))
    assert not [m for m in mail.messages(settle=1.5) if body["contactEmail"] in _kit("addresses", "mailpit")(m.get("To"))]
    short = os.environ["APP_SHORT_URL"]
    quick = Desk.sign_up(short)
    far = harbour(quick)
    for _ in range(REQUEST_LIMIT):
        ask(far)
    stop = quick.post("/api/requests", {**body, "styleId": far.sid, "lineId": far.line["id"]})
    want(stop, 429, "rate_limited")
    assert int(stop.headers["retry-after"]) <= SHORT_RATE_WINDOW
    poll(lambda: quick.post("/api/requests", {**body, "styleId": far.sid, "lineId": far.line["id"], "contactEmail": fresh_mail()}).status_code == 201, "a new window takes requests again")


def test_answers_reach_open_screens(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    request = ask(world, language="tr", supplier=fresh("Yıldız"))
    with ui(browser, app_url, "/requests", desk=desk) as page, ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as style_page:
        table = page.get_by_role("region", name="Requests table")
        expect(table).to_contain_text("Sent")
        page.evaluate("() => { window.__same = true; }")
        style_page.evaluate("() => { window.__same = true; }")
        expect(part(style_page, "total-figure")).to_contain_text("2.20 kg CO₂e")
        answer = want(page_answer(app_url, token_of(request["answerAddress"]), {"energy": {"value": "4,35", "unit": "kWh"}, "water": {"value": "12,5"}, "fibreOrigin": "TR"}), 201)
        copy = f"{request['supplierName']} answered at {wall_time(answer['answeredAt'], 'Europe/Istanbul')} Izmir time."
        expect(say(page)).to_contain_text(copy, timeout=REFRESH_WAIT_MS)
        expect(table).to_contain_text("Answered")
        assert page.evaluate("() => window.__same"), "the screen reloaded"
        expect(part(style_page, "total-figure")).to_contain_text("2.23 kg CO₂e", timeout=REFRESH_WAIT_MS)
        expect(say(style_page)).to_contain_text(copy, timeout=REFRESH_WAIT_MS)
        assert style_page.evaluate("() => window.__same"), "the style screen reloaded"


def test_wf_answer_page_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    request = ask(world, language="fr")
    token = token_of(request["answerAddress"])
    big = httpx.post(f"{app_url}/api/a/{token}/evidence", files={"file": ("big.pdf", PDF_BYTES + b"x" * FILE_LIMIT, "application/pdf")}, timeout=HTTP_TIMEOUT)
    want(big, 413, "too_large")
    copy = ANSWER_COPY["fr"]
    walk_rules(browser, None, app_url, f"/a/{token}", lambda p: button(p, copy["unit"]), lambda p: dialog(p, copy["unit"]), refresh_line=copy["refresh"])
    body = want(page_get(app_url, token), 200)
    assert INSTANT.match(body["endsAt"])
    assert set(body) == {"language", "supplierName", "labelName", "styleName", "town", "townName", "questions", "dueDate", "endsAt", "state", "answeredAt"}
    sweep_for(browser, app_url, "answer")


def test_wf_answer_page_keyboard(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    request = ask(world, language="en", questions=["energy", "water"])
    copy = ANSWER_COPY["en"]
    with ui(browser, app_url, f"/a/{token_of(request['answerAddress'])}", view=PHONE) as page:
        expect(h1(page)).to_have_text(copy["heading"])
        rail = page.get_by_role("group", name=copy["steps"])
        energy_step = button(rail, copy["stepEnergy"])
        expect(energy_step).to_have_attribute("aria-current", "step")
        tab_to(page, energy_step)
        page.keyboard.press("ArrowRight")
        expect(button(rail, copy["stepWater"])).to_have_attribute("aria-current", "step")
        page.keyboard.press("End")
        expect(button(rail, copy["stepSend"])).to_have_attribute("aria-current", "step")
        page.keyboard.press("Home")
        expect(energy_step).to_have_attribute("aria-current", "step")
        names = tab_order(page, 1)
        assert names and names[0] != copy["stepWater"], "the rail is a single Tab stop"
        key_type(page, labelled(page, copy["energy"]), "4.35")
        unit = button(page, copy["unit"])
        tab_to(page, unit)
        page.keyboard.press("Enter")
        sheet = dialog(page, copy["unit"])
        expect(sheet).to_be_visible()
        focus_in(sheet)
        for _ in range(TAB_LIMIT):
            if page.evaluate("() => document.activeElement.matches('input[type=radio],[role=radio]')"):
                break
            page.keyboard.press("Tab")
        page.keyboard.press("Space")
        expect(sheet.get_by_role("radio", checked=True)).to_have_count(1)
        tab_to(page, button(sheet, copy["close"]))
        page.keyboard.press("Enter")
        expect(unit).to_be_focused()
        tab_to(page, button(page, copy["next"]))
        page.keyboard.press("Enter")
        key_type(page, labelled(page, copy["water"]), "12.5")
        tab_to(page, button(page, copy["next"]))
        page.keyboard.press("Enter")
        tab_to(page, button(page, copy["next"]))
        page.keyboard.press("Enter")
        send = button(page, copy["send"])
        tab_to(page, send)
        with gate(page, r"/answers$") as release:
            page.keyboard.press("Enter")
            working(page, copy["working"])
            word_not_shown(page, copy["sent"])
            release()
        expect(page.get_by_text(copy["sent"]).first).to_be_visible()
    state = want(desk.get(f"/api/requests/{request['id']}"), 200)
    assert state["state"] == "answered"


def test_wf_answer_page_touch(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    request = ask(world)
    copy = ANSWER_COPY["tr"]
    with ui(browser, app_url, f"/a/{token_of(request['answerAddress'])}", view=PHONE, touch=True) as page:
        next_button = button(page, copy["next"])
        fixed_bottom(next_button, PHONE)
        touch_targets(page)
        layout(page)
        answer_ui(page, copy, "4,35", "12,5", file={"name": "meter.png", "mimeType": "image/png", "buffer": PNG_BYTES}, press=tap)
        back = button(page, copy["back"])
        fixed_bottom(back, PHONE)
        tap(button(page, copy["send"]))
        expect(page.get_by_text(copy["sent"]).first).to_be_visible()
    state = want(desk.get(f"/api/requests/{request['id']}"), 200)
    assert state["state"] == "answered" and Decimal(state["answer"]["energyMjPerKg"]) == Decimal("15.66")
    ids = state["answer"]["evidenceIds"]
    assert len(ids) == 1
    assert s3().get(f"evidence/{desk.assessor['id']}/{request['id']}/{ids[0]}") == PNG_BYTES


def test_wf_answer_page_copy_precision(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    minio_down = os.environ["APP_MINIO_DOWN_URL"]
    down_desk = Desk.sign_up(minio_down)
    down_world = harbour(down_desk)
    for language, copy in ANSWER_COPY.items():
        due = due_date(app_url)
        request = ask(world, language=language, due=due)
        token = token_of(request["answerAddress"])
        with ui(browser, app_url, f"/a/{token}", view=PHONE, touch=True) as page:
            expect(h1(page)).to_have_text(copy["heading"])
            expect(page.locator("html")).to_have_attribute("lang", language)
            expect(page.locator("body")).to_contain_text(copy["intro"].format(label=world.label["name"], style=world.style["name"]))
            expect(page.locator("body")).to_contain_text(copy["due"].format(due=due, town="Izmir"))
            rail = page.get_by_role("group", name=copy["steps"], exact=True)
            for key in ("stepEnergy", "stepWater", "stepOrigin", "stepEvidence", "stepSend"):
                expect(button(rail, copy[key])).to_be_visible()
            fill(labelled(page, copy["energy"]), "1")
            click(button(page, copy["unit"]))
            sheet = dialog(page, copy["unit"])
            for unit in ("kWh", "MJ", copy["gas"]):
                expect(sheet.get_by_role("radio", name=unit, exact=True)).to_be_visible()
            check(sheet.get_by_role("radio", name="kWh"))
            click(button(sheet, copy["close"]))
            expect(button(page, copy["next"])).to_be_visible()
            click(button(rail, copy["stepWater"]))
            fill(labelled(page, copy["water"]), "1")
            expect(button(page, copy["back"])).to_be_visible()
            click(button(rail, copy["stepOrigin"]))
            origin = labelled(page, copy["origin"])
            for country in copy["countries"]:
                select(origin, country)
            click(button(rail, copy["stepEvidence"]))
            expect(labelled(page, copy["evidence"])).to_be_attached()
            click(button(rail, copy["stepSend"]))
            expect(button(page, copy["send"])).to_be_visible()
            page.context.set_offline(True)
            expect(part(page, "refresh-line")).to_be_visible(timeout=REFRESH_WAIT_MS)
            expect(part(page, "refresh-line")).to_have_text(copy["refresh"])
            page.context.set_offline(False)
            click(button(rail, copy["stepEvidence"]))
            for file, message in (({"name": "note.pdf", "mimeType": "application/pdf", "buffer": b"plain text"}, copy["fileType"]), ({"name": "big.pdf", "mimeType": "application/pdf", "buffer": PDF_BYTES + b"x" * FILE_LIMIT}, copy["tooBig"])):
                labelled(page, copy["evidence"]).set_input_files(file)
                shown = page.get_by_text(message, exact=False).first
                try:
                    expect(shown).to_be_visible(timeout=2000)
                except AssertionError:
                    click(button(rail, copy["stepSend"]))
                    click(button(page, copy["send"]))
                    expect(shown).to_be_visible()
                expect(page.get_by_role("region", name=copy["problems"], exact=True)).to_be_visible()
                click(button(rail, copy["stepEvidence"]))
        refused = page_answer(app_url, token, {"energy": {"value": "abc", "unit": "kWh"}, "water": {"value": ""}, "fibreOrigin": "TR"})
        want(refused, 422)
        assert refused.json()["error"]["fields"]["energy.value"] == copy["number"]
        assert refused.json()["error"]["fields"]["water.value"] == copy["empty"]
        assert error_message(page_file(app_url, token, "a.pdf", b"plain text")) == copy["fileType"]
        want(desk.post(f"/api/requests/{request['id']}/end"), 200)
        with ui(browser, app_url, None, view=PHONE) as page:
            document = page.goto(f"{app_url}/a/{token}")
            assert document and document.status == 410
            expect(h1(page)).to_have_text(copy["ended"])
            expect(page.locator("html")).to_have_attribute("lang", language)
        down = ask(down_world, language=language)
        response = page_file(minio_down, token_of(down["answerAddress"]), "a.pdf", PDF_BYTES)
        want(response, 503, "file_store_unavailable")
        assert error_message(response) == copy["storeDown"]
    request = ask(world, language="tr", questions=["energy"])
    token = token_of(request["answerAddress"])
    whole = want(httpx.post(f"{app_url}/api/a/{token}/evidence", files={"file": ("full.pdf", PDF_BYTES + b"x" * (FILE_LIMIT - len(PDF_BYTES)), "application/pdf")}, timeout=HTTP_TIMEOUT), 201)
    assert whole["sizeBytes"] == FILE_LIMIT
    sent = want(page_answer(app_url, token, {"energy": {"value": "1.250,5", "unit": "kWh"}, "evidenceIds": [whole["evidenceId"]]}), 201)
    assert Decimal(sent["energyValue"]) == Decimal("1250.5") and Decimal(sent["energyMjPerKg"]) == Decimal("1250.5") * Decimal("3.6")


def test_arabic_mirrored(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    arabic = ask(world, language="ar", town="cairo")
    document = httpx.get(f"{app_url}/a/{token_of(arabic['answerAddress'])}", timeout=HTTP_TIMEOUT)
    assert re.search(r'<html[^>]*lang="ar"', document.text) and re.search(r'<html[^>]*dir="rtl"', document.text)
    copy = ANSWER_COPY["ar"]
    with ui(browser, app_url, f"/a/{token_of(arabic['answerAddress'])}", view=PHONE, touch=True) as page:
        rail = page.get_by_role("group", name=copy["steps"])
        energy_step, water_step = button(rail, copy["stepEnergy"]), button(rail, copy["stepWater"])
        energy_box, water_box = energy_step.bounding_box(), water_step.bounding_box()
        assert energy_box and water_box and (water_box["x"] < energy_box["x"] or water_box["y"] > energy_box["y"]), "the rail is mirrored"
        energy_step.focus()
        page.keyboard.press("ArrowLeft")
        expect(water_step).to_have_attribute("aria-current", "step")
        page.keyboard.press("ArrowRight")
        expect(energy_step).to_have_attribute("aria-current", "step")
        field = labelled(page, copy["energy"])
        assert field.evaluate("(e) => getComputedStyle(e).direction") != "rtl"
        sheet = dialog(page, copy["unit"])
        moved = entrance(page, lambda unit=button(page, copy["unit"]): click(unit), sheet)
        assert moved["start"]["left"] < moved["end"]["left"] - 1, f"the Arabic Unit sheet comes from the left edge: {moved}"
    for language in ("en", "fr", "tr"):
        request = ask(world, language=language)
        with ui(browser, app_url, f"/a/{token_of(request['answerAddress'])}", view=PHONE, touch=True) as page:
            expect(page.locator("html")).to_have_attribute("lang", language)
            assert page.locator("html").get_attribute("dir") != "rtl"
            copy = ANSWER_COPY[language]
            rail = page.get_by_role("group", name=copy["steps"])
            energy_step = button(rail, copy["stepEnergy"])
            energy_step.focus()
            page.keyboard.press("ArrowRight")
            expect(button(rail, copy["stepWater"])).to_have_attribute("aria-current", "step")
            page.keyboard.press("ArrowLeft")
            moved = entrance(page, lambda unit=button(page, copy["unit"]): click(unit), dialog(page, copy["unit"]))
            assert moved["start"]["left"] > moved["end"]["left"] + 1, f"the sheet comes from the right edge: {moved}"


NUMBER_CASES = {
    "en_group": ("en", "1,250.5", "kWh", "1250.5", "4501.8"),
    "en_plain": ("en", "1250.5", "MJ", "1250.5", "1250.5"),
    "en_dot": ("en", "1.250", "kWh", "1.25", "4.5"),
    "fr_space": ("fr", "1 250,5", "kWh", "1250.5", "4501.8"),
    "fr_nbsp": ("fr", "1\u00a0250,5", "MJ", "1250.5", "1250.5"),
    "fr_narrow": ("fr", "1\u202f250,5", "MJ", "1250.5", "1250.5"),
    "tr_group": ("tr", "1.250,5", "kWh", "1250.5", "4501.8"),
    "tr_dot": ("tr", "1.250", "MJ", "1250", "1250"),
    "tr_float": ("tr", "4,35", "kWh", "4.35", "15.66"),
    "ar_indic": ("ar", "١٬٢٥٠٫٥", "MJ", "1250.5", "1250.5"),
    "ar_plain": ("ar", "1250.5", "m3", "1250.5", "47268.9"),
    "gas": ("en", "2", "m3", "2", "75.6"),
    "refuse_en_comma": ("en", "1.250,5", "kWh", None, None),
    "refuse_en_group": ("en", "12,50.5", "kWh", None, None),
    "refuse_fr": ("fr", "1,250.5", "kWh", None, None),
    "refuse_tr": ("tr", "1,250.5", "kWh", None, None),
    "refuse_ar": ("ar", "1,250.5", "kWh", None, None),
}


@pytest.mark.parametrize("language,typed,unit,value,megajoules", list(NUMBER_CASES.values()), ids=list(NUMBER_CASES))
def test_local_numbers(app_url: str, language: str, typed: str, unit: str, value: str | None, megajoules: str | None) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    request = ask(world, language=language, questions=["energy"])
    response = page_answer(app_url, token_of(request["answerAddress"]), {"energy": {"value": typed, "unit": unit}})
    if value is None:
        want(response, 422, "validation_failed")
        assert response.json()["error"]["fields"]["energy.value"] == ANSWER_COPY[language]["number"] == error_message(response)
        assert want(desk.get(f"/api/requests/{request['id']}"), 200)["state"] == "sent"
        assert want(desk.get(f"/api/styles/{world.sid}/lines"), 200)["lines"][0]["answeredFacts"] in (None, {}, {"energyMjPerKg": None, "waterLitresPerKg": None, "fibreOrigin": None})
        return
    body = want(response, 201)
    assert Decimal(body["energyValue"]) == Decimal(value) and body["energyUnit"] == unit
    assert Decimal(body["energyMjPerKg"]) == Decimal(megajoules)
    line = want(desk.get(f"/api/styles/{world.sid}/lines"), 200)["lines"][0]
    assert Decimal(line["answeredFacts"]["energyMjPerKg"]) == Decimal(megajoules)


def multipart(file_bytes: bytes, padding: int) -> tuple[bytes, dict[str, str]]:
    boundary = "fiocontadoboundary"
    start = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="e.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode()
    pad = f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="padding"\r\n\r\n'.encode()
    end = f"\r\n--{boundary}--\r\n".encode()
    fixed = len(start) + len(file_bytes) + len(pad) + len(end)
    return start + file_bytes + pad + b"p" * (padding - fixed) + end, {"Content-Type": f"multipart/form-data; boundary={boundary}"}


def test_evidence_files(app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    request = ask(world, language="en")
    token = token_of(request["answerAddress"])
    prefix = f"evidence/{desk.assessor['id']}/{request['id']}/"
    for name, data, declared in (("note.txt", PDF_BYTES, "text/plain"), ("photo.pdf", JPEG_BYTES, "application/pdf"), ("no-name", PNG_BYTES, "application/octet-stream")):
        made = want(page_file(app_url, token, name, data, declared), 201)
        assert made["sizeBytes"] == len(data) and made["fileName"] == name and made["contentType"]
        assert s3().get(prefix + made["evidenceId"]) == data, "not byte for byte"
    keys = set(s3().keys(prefix))
    for name, data, declared in (("fake.pdf", b"not a pdf at all", "application/pdf"), ("x.svg", b"<svg onload='alert(1)'></svg>", "image/svg+xml"), ("x.png", b"GIF89a....", "image/png")):
        refused = page_file(app_url, token, name, data, declared)
        want(refused, 415, "unsupported_media_type")
        assert error_message(refused) == ANSWER_COPY["en"]["fileType"]
    assert set(s3().keys(prefix)) == keys, "a refused file reached MinIO"
    full = PDF_BYTES + b"x" * (FILE_LIMIT - len(PDF_BYTES))
    limit = want(page_file(app_url, token, "full.pdf", full), 201)
    assert limit["sizeBytes"] == FILE_LIMIT
    assert s3().get(prefix + limit["evidenceId"]) == full
    want(page_file(app_url, token, "big.pdf", full + b"x"), 413, "too_large")
    want(page_file(app_url, "no-such-token", "big.pdf", full + b"x"), 413, "too_large")
    want(page_file(app_url, "no-such-token", "ok.pdf", PDF_BYTES), 404, "not_found")
    body, headers = multipart(full, WHOLE_LIMIT)
    assert len(body) == WHOLE_LIMIT
    want(httpx.post(f"{app_url}/api/a/{token}/evidence", content=body, headers=headers, timeout=HTTP_TIMEOUT), 201)
    body, headers = multipart(PDF_BYTES, WHOLE_LIMIT + 1)
    want(httpx.post(f"{app_url}/api/a/{token}/evidence", content=body, headers=headers, timeout=HTTP_TIMEOUT), 413, "too_large")
    download = desk.get(f"/api/evidence/{limit['evidenceId']}/file")
    assert download.status_code == 200 and download.content == full
    assert "attachment" in download.headers["content-disposition"].lower()
    foreign = Desk.sign_up(app_url)
    want(foreign.get(f"/api/evidence/{limit['evidenceId']}/file"), 404, "not_found")


def test_sent_once_and_drafts(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    request = ask(world, language="fr")
    token = token_of(request["answerAddress"])
    copy = ANSWER_COPY["fr"]
    with ui(browser, app_url, f"/a/{token}", view=PHONE, touch=True) as page:
        fill(labelled(page, copy["energy"]), "4,35")
        hold_for(page, DRAFT_WAIT_S)
        page.reload()
        click(button(page.get_by_role("group", name=copy["steps"]), copy["stepEnergy"]))
        expect(labelled(page, copy["energy"])).to_have_value("4,35")
        answer_ui(page, copy, "4,35", "12,5", file={"name": "e.pdf", "mimeType": "application/pdf", "buffer": PDF_BYTES})
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/answers") else None)
        with gate(page, r"/evidence$") as release_file:
            with gate(page, r"/answers$") as release_answer:
                send = button(page, copy["send"])
                send.dblclick()
                working(page, copy["working"])
                word_not_shown(page, copy["sent"])
                release_file()
                release_answer()
        expect(page.get_by_text(copy["sent"]).first).to_be_visible()
    state = want(desk.get(f"/api/requests/{request['id']}"), 200)
    assert state["state"] == "answered" and len(state["answer"]["evidenceIds"]) == 1
    version = world.fresh_style()["version"]
    results = want(desk.get(f"/api/styles/{world.sid}/results"), 200)["results"]
    replay = page_answer(app_url, token, {"energy": {"value": "9,99", "unit": "kWh"}})
    first_body = want(replay, 200)
    assert Decimal(first_body["energyMjPerKg"]) == Decimal("15.66") and first_body["answeredAt"] == state["answeredAt"]
    assert world.fresh_style()["version"] == version
    assert want(desk.get(f"/api/styles/{world.sid}/results"), 200)["results"] == results
    assert want(page_get(app_url, token), 200)["state"] == "answered"
    down = os.environ["APP_MINIO_DOWN_URL"]
    down_desk = Desk.sign_up(down)
    down_world = harbour(down_desk)
    down_request = ask(down_world, language="tr")
    down_copy = ANSWER_COPY["tr"]
    with ui(browser, down, f"/a/{token_of(down_request['answerAddress'])}", view=PHONE, touch=True) as page:
        answer_ui(page, down_copy, "4,35", "12,5", file={"name": "e.pdf", "mimeType": "application/pdf", "buffer": PDF_BYTES})
        send = button(page, down_copy["send"])
        refusal = page.get_by_text(down_copy["storeDown"]).first
        try:
            expect(refusal).to_be_visible(timeout=PICK_REFUSAL_WAIT_MS)
        except AssertionError:
            if send.count():
                click(send)
            expect(refusal).to_be_visible()
        word_not_shown(page, down_copy["sent"])
        page.reload()
        click(button(page.get_by_role("group", name=down_copy["steps"]), down_copy["stepEnergy"]))
        expect(labelled(page, down_copy["energy"])).to_have_value("4,35")
    assert want(down_desk.get(f"/api/requests/{down_request['id']}"), 200)["state"] == "sent"
    assert want(down_desk.get(f"/api/requests/{down_request['id']}"), 200)["answer"] is None


def book(desk: Desk, label_id: str, town: str = "izmir", date: str = "2027-03-29", at: str = "07:20", factory: str = "Yıldız İplik") -> dict:
    return want(desk.post("/api/visits", {"labelId": label_id, "factoryName": factory, "town": town, "localDate": date, "localTime": at}), 201)


def reading(desk: Desk, visit_id: str, meter: int, value: str, key: str | None = None, seconds_ago: int = 0, unit: str = "kWh", **extra: Any) -> httpx.Response:
    return desk.post(f"/api/visits/{visit_id}/readings", {"meter": meter, "value": value, "unit": unit, "secondsAgo": seconds_ago, **extra}, headers={"Request-Key": key or uuid.uuid4().hex})


def record_ui(page: Page, meter: str, value: str) -> None:
    fill(labelled(page, "Meter"), meter)
    fill(labelled(page, "Reading"), value)
    select(labelled(page, "Unit"), "kWh")
    click(button(page, "Record reading"))


def test_wf_factory_visits_screen_rules(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    visit = book(desk, label["id"])
    api_edges(desk, "/api/visits")
    walk_rules(browser, desk, app_url, "/visits", lambda p: button(p, "Book visit"), lambda p: dialog(p, "Book visit"), typed=lambda d: labelled(d, "Factory"))
    with ui(browser, app_url, f"/visits/{visit['id']}", desk=desk) as page:
        expect(part(page, "waiting-line")).to_have_text("All readings sent.")
        page.context.set_offline(True)
        hold_for(page, REFRESH_WAIT_MS / 1000)
        expect(h1(page)).to_have_text(f"Visit to {visit['factoryName']}")
        expect(part(page, "refresh-line")).to_be_hidden()
        expect(page.get_by_role("dialog")).to_have_count(0)
        page.context.set_offline(False)
    sweep_for(browser, app_url, "visits", "visit")
    with ui(browser, app_url, f"/visits/{visit['id']}", desk=desk) as page:
        expect(part(page, "waiting-line")).to_have_text("All readings sent.")
        values = iter(["100", "200"])
        def record() -> None:
            record_ui(page, "1", next(values))
        announced_twice(page, record)


def test_wf_factory_visits_keyboard(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    book(desk, label["id"])
    factory = fresh("Ege Dokuma")
    with ui(browser, app_url, "/visits", desk=desk) as page:
        tab_to(page, button(page, "Book visit"))
        page.keyboard.press("Enter")
        panel = dialog(page, "Book visit")
        focus_in(panel)
        key_type(page, labelled(panel, "Factory"), factory)
        select(labelled(panel, "Label"), label["name"])
        select(labelled(panel, "Town"), "Izmir")
        key_type(page, labelled(panel, "Date"), "2027-03-29")
        key_type(page, labelled(panel, "Local time"), "07.20")
        tab_to(page, button(panel, "Save visit"))
        page.keyboard.press("Enter")
        expect(panel.get_by_role("region", name="Problems")).to_contain_text("Give the time as HH:MM.")
        fill(labelled(panel, "Local time"), "07:20")
        tab_to(page, button(panel, "Save visit"))
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/visits/[^/]+$"))
        expect(h1(page)).to_have_text(f"Visit to {factory}")
        expect(h1(page)).to_be_focused()
        announced(page, f"Visit to {factory} booked.")
        expect(page.locator("body")).to_contain_text("Mon 29 Mar 2027, 07:20 Izmir time · 05:20 Lisbon time")
        key_type(page, labelled(page, "Meter"), "2")
        key_type(page, labelled(page, "Reading"), "14350")
        select(labelled(page, "Unit"), "kWh")
        record = button(page, "Record reading")
        tab_to(page, record)
        page.keyboard.press("Enter")
        expect(record).to_be_focused()
        announced(page, "Reading for meter 2 recorded.")
        visit_id = urlparse(page.url).path.rsplit("/", 1)[-1]
        readings = poll(lambda: want(desk.get(f"/api/visits/{visit_id}"), 200)["readings"], "the reading reaching the server", 15)
    assert [(r["meter"], Decimal(r["value"]), r["unit"]) for r in readings] == [(2, Decimal("14350"), "kWh")]


def test_wf_factory_visits_touch(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    visit = book(desk, label["id"])
    with ui(browser, app_url, "/visits", desk=desk, view=PHONE, touch=True) as page:
        fixed_bottom(button(page, "Book visit"), PHONE)
        touch_targets(page)
        layout(page)
        page.goto(f"{app_url}/visits/{visit['id']}")
        record = button(page, "Record reading")
        fixed_bottom(record, PHONE)
        touch_targets(page)
        fill(labelled(page, "Meter"), "1")
        fill(labelled(page, "Reading"), "100")
        select(labelled(page, "Unit"), "kWh")
        tap(record)
        announced(page, "Reading for meter 1 recorded.")
        expect(part(page, "waiting-line")).to_have_text("All readings sent.")
        poll(lambda: want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"], "the reading reaching the server", 15)
    assert len(want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"]) == 1


def test_wf_factory_visits_copy_precision(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    friday, monday = book(desk, label["id"], date="2027-03-26"), book(desk, label["id"], date="2027-03-29")
    friday_date, local, lisbon = "Fri 26 Mar 2027", "07:20", "04:20"
    assert friday["shown"] == f"{friday_date}, {local} Izmir time · {lisbon} Lisbon time"
    assert monday["shown"] == "Mon 29 Mar 2027, 07:20 Izmir time · 05:20 Lisbon time"
    first = want(reading(desk, monday["id"], 2, "14320"), 201)
    with ui(browser, app_url, f"/visits/{monday['id']}", desk=desk) as page:
        expect(part(page, "waiting-line")).to_have_text("All readings sent.")
        page.context.set_offline(True)
        record_ui(page, "2", "14400")
        expect(part(page, "waiting-line")).to_have_text("Offline — 1 reading waiting on this device.")
        record_ui(page, "3", "5")
        expect(part(page, "waiting-line")).to_have_text("Offline — 2 readings waiting on this device.")
        click(button(page, "Sign out"))
        announced(page, "2 readings are still waiting. Go back online to send them first.")
        expect(page).to_have_url(re.compile(rf"/visits/{re.escape(monday['id'])}$"))
        page.context.set_offline(False)
        expect(part(page, "waiting-line")).to_have_text("All readings sent.", timeout=REFRESH_WAIT_MS)
        record_ui(page, "2", "14000")
        recorded = want(desk.get(f"/api/visits/{monday['id']}"), 200)["readings"]
        last = max((r for r in recorded if r["meter"] == 2), key=lambda r: Decimal(r["value"]))
        name = f"Meter 2 reads lower than 14,400 kWh recorded at {wall_time(last['takenAt'], 'Europe/Istanbul')} Izmir time. Keep which?"
        expect(dialog(page, name)).to_be_visible(timeout=REFRESH_WAIT_MS)
        click(button(dialog(page, name), "Keep recorded"))
        expect(button(page, "Record reading")).to_be_focused()
    assert first["takenAt"]


def test_visit_clock_changes(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    friday = book(desk, label["id"], date="2027-03-26")
    assert (friday["at"], friday["lisbonDate"], friday["lisbonDayHours"]) == ("2027-03-26T04:20:00Z", "2027-03-26", 24)
    monday = book(desk, label["id"], date="2027-03-29")
    assert monday["at"] == "2027-03-29T04:20:00Z" and monday["shown"].endswith("· 05:20 Lisbon time")
    skipped = desk.post("/api/visits", {"labelId": label["id"], "factoryName": "F", "town": "porto", "localDate": "2027-03-28", "localTime": "01:30"})
    want(skipped, 422, "validation_failed")
    assert skipped.json()["error"]["fields"]["localTime"] == "That time doesn't exist in Porto on Sun 28 Mar 2027 because the clocks change."
    twice = book(desk, label["id"], town="porto", date="2027-10-31", at="01:30")
    assert parse_instant(twice["at"]) == datetime(2027, 10, 31, 0, 30, tzinfo=timezone.utc) and twice["lisbonDayHours"] == 25
    for date, hours, shown in (("2027-03-28", 23, "Sun 28 Mar 2027"), ("2027-10-31", 25, "Sun 31 Oct 2027"), ("2027-03-29", 24, "Mon 29 Mar 2027"), ("2028-03-26", 23, "Sun 26 Mar 2028"), ("2028-10-29", 25, "Sun 29 Oct 2028")):
        day = want(desk.get(f"/api/calendar/{date}"), 200)
        assert (day["date"], day["hours"], day["shown"]) == (date, hours, shown)
    assert twice["id"] in [v["id"] for v in want(desk.get(f"/api/calendar/{twice['localDate']}"), 200)["visits"]]
    bad_date = "31-10-2027"
    want(desk.get(f"/api/calendar/{bad_date}"), 422)
    book(desk, label["id"], town="porto", date="2027-03-28", at="10:00")
    with ui(browser, app_url, "/visits", desk=desk) as page:
        group = lambda shown, hours: f"{shown}, {hours} hours"
        expect(page.get_by_text(group("Sun 28 Mar 2027", 23))).to_be_visible()
        expect(page.get_by_text(group("Sun 31 Oct 2027", 25))).to_be_visible()
        expect(page.get_by_text(group("Mon 29 Mar 2027", 24))).to_have_count(0)


def test_visit_screen_ignores_device_clock(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    visit = book(desk, make_label(desk)["id"])
    with ui(browser, app_url, f"/visits/{visit['id']}", desk=desk, locale="de-DE", zone="Pacific/Auckland", ahead=timedelta(days=3)) as page:
        expect(page.locator("body")).to_contain_text(visit["shown"])
    with ui(browser, app_url, "/visits", desk=desk, locale="de-DE", zone="Pacific/Auckland", ahead=timedelta(days=3)) as page:
        expect(page.locator("body")).to_contain_text("Mon 29 Mar 2027")
    with ui(browser, app_url, f"/visits/{visit['id']}", desk=desk, ahead=timedelta(days=3)) as page:
        expect(part(page, "waiting-line")).to_have_text("All readings sent.")
        record_ui(page, "5", "100")
        poll(lambda: [r for r in want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"] if r["meter"] == 5], "the reading reaching the server", 15)
    taken = next(r for r in want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"] if r["meter"] == 5)
    assert abs((parse_instant(taken["takenAt"]) - server_now(app_url)).total_seconds()) < 3600, "takenAt follows the device clock"


def test_reading_keys(app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    visit = book(desk, make_label(desk)["id"])
    key = uuid.uuid4().hex
    before = server_now(app_url)
    first = reading(desk, visit["id"], 2, "14350", key=key, seconds_ago=42)
    body = want(first, 201)
    after = server_now(app_url)
    taken = parse_instant(body["takenAt"])
    assert before - timedelta(seconds=43) <= taken <= after - timedelta(seconds=41), (before, taken, after)
    assert (body["meter"], Decimal(body["value"]), body["unit"]) == (2, Decimal("14350"), "kWh")
    replay = reading(desk, visit["id"], 2, "14350", key=key, seconds_ago=42)
    assert replay.status_code == 201 and replay.json() == body
    assert len(want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"]) == 1
    want(reading(desk, visit["id"], 2, "14999", key=key, seconds_ago=42), 409, "key_reused")
    assert len(want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"]) == 1
    device_stamp = desk.post(f"/api/visits/{visit['id']}/readings", {"meter": 4, "value": "1", "unit": "kWh", "secondsAgo": 0, "takenAt": "2001-01-01T00:00:00Z"}, headers={"Request-Key": uuid.uuid4().hex})
    if device_stamp.status_code == 201:
        assert not device_stamp.json()["takenAt"].startswith("2001")
    unit = reading(desk, visit["id"], 2, "15000", unit="MJ")
    want(unit, 422, "validation_failed")
    assert unit.json()["error"]["fields"]["unit"] == "Meter 2 reads in kWh."


def test_readings_wait_on_device(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    visit = book(desk, make_label(desk)["id"])
    with ui(browser, app_url, f"/visits/{visit['id']}", desk=desk) as page:
        stored: list[tuple[str, Any]] = []
        bodies: list[Any] = []
        def sent(request: Any) -> None:
            if request.method == "POST" and request.url.endswith("/readings"):
                bodies.append(request.post_data_json)
        def answered(response: Any) -> None:
            if response.request.method == "POST" and response.url.endswith("/readings") and response.status == 201:
                stored.append((response.request.headers.get("request-key", ""), response.request.post_data_json))
        page.on("request", sent)
        page.on("response", answered)
        line = part(page, "waiting-line")
        expect(line).to_have_text("All readings sent.")
        page.context.set_offline(True)
        for meter, value in (("1", "100"), ("2", "200"), ("3", "300")):
            record_ui(page, meter, value)
        expect(line).to_have_text("Offline — 3 readings waiting on this device.")
        expect(page.get_by_role("dialog")).to_have_count(0)
        expect(h1(page)).to_be_visible()
        expect(part(page, "refresh-line")).to_be_hidden()
        click(button(page, "Sign out"))
        announced(page, "3 readings are still waiting. Go back online to send them first.")
        assert want(desk.get("/api/session"), 200)
        page.context.set_offline(False)
        expect(line).to_have_text("All readings sent.", timeout=REFRESH_WAIT_MS)
        first_by_key: dict[str, Any] = {}
        for key, body in stored:
            first_by_key.setdefault(key, body)
        assert all(first_by_key) and len(first_by_key) == 3, "each reading carries its own request key"
        assert [int(body["meter"]) for body in first_by_key.values()] == [1, 2, 3], "sent in the order taken"
        failing = re.compile(r"/readings$")
        page.route(failing, lambda route: route.abort() if route.request.method == "POST" else route.fallback())
        record_ui(page, "4", "400")
        expect(line).to_contain_text("1 reading waiting on this device.")
        page.reload()
        expect(line).to_contain_text("1 reading waiting on this device.")
        page.unroute(failing)
        expect(line).to_have_text("All readings sent.", timeout=REFRESH_WAIT_MS)
    readings = want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"]
    assert sorted(r["meter"] for r in readings) == [1, 2, 3, 4], "each reading stored once"
    assert all(body.get("takenAt") is None for body in bodies if body), "the device must not stamp takenAt"


def test_lower_reading(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    visit = book(desk, make_label(desk)["id"])
    first = want(reading(desk, visit["id"], 2, "14320"), 201)
    lower = reading(desk, visit["id"], 2, "14000")
    want(lower, 409, "lower_reading")
    assert Decimal(lower.json()["error"]["lastValue"]) == Decimal("14320") and lower.json()["error"]["lastAt"] == first["takenAt"]
    assert len(want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"]) == 1
    name = f"Meter 2 reads lower than 14,320 kWh recorded at {wall_time(first['takenAt'], 'Europe/Istanbul')} Izmir time. Keep which?"
    with ui(browser, app_url, f"/visits/{visit['id']}", desk=desk) as page:
        record_ui(page, "2", "14000")
        panel = dialog(page, name)
        expect(panel).to_be_visible(timeout=REFRESH_WAIT_MS)
        record_ui_outside = want(reading(desk, visit["id"], 7, "1"), 201)
        assert record_ui_outside["meter"] == 7
        expect(button(panel, "Keep recorded")).to_be_visible()
        click(button(panel, "Keep mine"))
        expect(button(page, "Record reading")).to_be_focused()
        poll(lambda: Decimal("14000") in [Decimal(r["value"]) for r in want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"]], "Keep mine stored the lower reading", 15)
        record_ui(page, "2", "13000")
        latest = next(r for r in want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"] if Decimal(r["value"]) == Decimal("14000"))
        panel = dialog(page, f"Meter 2 reads lower than 14,000 kWh recorded at {wall_time(latest['takenAt'], 'Europe/Istanbul')} Izmir time. Keep which?")
        expect(panel).to_be_visible(timeout=REFRESH_WAIT_MS)
        click(button(panel, "Keep recorded"))
        expect(button(page, "Record reading")).to_be_focused()
        expect(part(page, "waiting-line")).to_have_text("All readings sent.", timeout=REFRESH_WAIT_MS)
    values = [Decimal(r["value"]) for r in want(desk.get(f"/api/visits/{visit['id']}"), 200)["readings"]]
    assert Decimal("13000") not in values


def test_wf_footprint_and_factors_screen_rules(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    api_edges(desk, f"/api/styles/{world.sid}/results")
    walk_rules(browser, desk, app_url, f"/styles/{world.sid}", lambda p: p.get_by_role("radio", name="Climate"), lambda p: dialog(p, "Factors for Materials"), popover=True)
    sweep_for(browser, app_url, "style")
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        check_again = button(page, "Check for newer factors")
        expect(check_again).to_be_visible()
        announced_twice(page, lambda: click(check_again))


def test_wf_footprint_and_factors_keyboard(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        actions = button(page, "Work out footprint")
        action = actions.first
        tab_to(page, action)
        doubled = actions.count() > 1
        with gate(page, r"/results$") as release:
            page.keyboard.press("Enter")
            working(page)
            release()
        announced(page, "Footprint worked out with edition 2027.1.")
        if doubled:
            poll(lambda: page.evaluate("() => { const a = document.activeElement; return a.textContent.trim() === 'Work out footprint' || a.matches('h1'); }"), "focus on the pressed button, or the heading once the empty state has gone", UI_WAIT_MS / 1000)
        else:
            expect(action).to_be_focused()
        expect(part(page, "total-figure")).to_contain_text("2.20 kg CO₂e")
        climate = page.get_by_role("radio", name="Climate")
        tab_to(page, climate)
        page.keyboard.press("ArrowRight")
        water = page.get_by_role("radio", name="Water", exact=True)
        expect(water).to_be_checked()
        announced(page, "Water: 1,140 L, hotspot Materials.")
        page.keyboard.press("End")
        expect(page.get_by_role("radio", name="Microfibres")).to_be_checked()
        page.keyboard.press("Home")
        expect(climate).to_be_checked()
        page.keyboard.press("Enter")
        panel = dialog(page, "Factors for Materials")
        expect(panel).to_be_visible()
        page.keyboard.press("Escape")
        expect(climate).to_be_focused()
    assert len(want(desk.get(f"/api/styles/{world.sid}/results"), 200)["results"]) == 1


def test_wf_footprint_and_factors_touch(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk, view=PHONE, touch=True) as page:
        action = button(page, "Work out footprint")
        fixed_bottom(action, PHONE)
        touch_targets(page)
        expect(part(page, "strata")).to_be_hidden()
        tap(action.first)
        announced(page, "Footprint worked out with edition 2027.1.")
        strata = part(page, "stratum")
        expect(strata).to_have_count(5)
        boxes = [strata.nth(index).bounding_box() for index in range(5)]
        assert all(boxes) and all(boxes[index]["y"] < boxes[index + 1]["y"] for index in range(4)), "strata stack vertically at 375"
        tap(staged(page, "stratum", "making"))
        panel = dialog(page, "Factors for Making")
        expect(panel).to_contain_text("Turkey: 0.124 kg CO₂e per MJ")
        layout(page)
    assert want(desk.get(f"/api/styles/{world.sid}"), 200)["state"] == "worked"


def test_wf_footprint_and_factors_copy_precision(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world = harbour(desk)
    no_lines = make_style(desk, world.label["id"])
    empty = desk.post(f"/api/styles/{no_lines['id']}/results")
    want(empty, 422, "validation_failed")
    assert error_message(empty) == "Add a material line first." and "fields" not in empty.json()["error"]
    untiered = make_style(desk, world.label["id"])
    make_line(desk, untiered["id"], material="linen", tier1=None, tier2=None, tier3=None)
    start = calls(wiremock, "/v2/editions")
    missing = desk.post(f"/api/styles/{untiered['id']}/results")
    want(missing, 422, "validation_failed")
    assert error_message(missing) == "Tier 1 country is missing for Linen."
    assert calls(wiremock, "/v2/editions") == start, "refused before any call"
    first = want(desk.post(f"/api/styles/{world.sid}/results"), 201)
    assert measure_of(first, "climate")["totalShown"] == "2.20 kg CO₂e"
    assert measure_of(first, "landUse")["stages"][1]["shown"] == "3.15 × 10⁻⁴"
    assert calls(wiremock, "/v2/editions") == start + 1 and calls(wiremock, "/v2/factors") >= 3
    wiremock.fault("GET", "/v2/editions")
    down = desk.post(f"/api/styles/{world.sid}/results")
    want(down, 503, "factor_library_unavailable")
    assert error_message(down) == "The factor library is unavailable right now. The last result stays."
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        click(button(page, "Work out footprint"))
        announced(page, "The factor library is unavailable right now. The last result stays.")
        expect(part(page, "total-figure")).to_contain_text("2.20 kg CO₂e")
    wiremock.stub("GET", "/v2/editions", json={"editions": [{"edition": "2027.1", "validFrom": "2026-07-01"}]}, delay_ms=TIMEOUT_DELAY_MS)
    want(desk.post(f"/api/styles/{world.sid}/results"), 503, "factor_library_unavailable")
    assert [r["id"] for r in want(desk.get(f"/api/styles/{world.sid}/results"), 200)["results"]] == [first["id"]]


def test_library_reading_and_sums(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    editions, factors = calls(wiremock, "/v2/editions"), calls(wiremock, "/v2/factors")
    world, result = worked(desk)
    assert calls(wiremock, "/v2/editions") == editions + 1 and calls(wiremock, "/v2/factors") == factors + 3
    urls = [wm_url(entry) for entry in wiremock.requests("/v2/factors")][-3:]
    assert all("edition=2027.1" in url for url in urls)
    assert sorted(parse_qs(urlparse(url).query).get("cursor", [""])[0] for url in urls) == ["", "p2", "p3"]
    assert result["edition"] == "2027.1" and INSTANT.match(result["workedOutAt"])
    assert_measures(result["measures"], footprint(HARBOUR_LINES, HARBOUR_LEGS, 30))
    climate = measure_of(result, "climate")
    assert (climate["total"], climate["totalShown"], climate["hotspot"]) == (climate["total"], "2.20 kg CO₂e", "materials") and Decimal(climate["total"]) == Decimal("2.1996")
    assert [stage["shown"] for stage in climate["stages"]] == ["1.01", "0.459", "0.0840", "0.639", "0.0128"]
    assert [Decimal(stage["share"]) for stage in climate["stages"]] == [Decimal(share) for share in ("45.7", "20.9", "3.8", "29.1", "0.6")]
    assert measure_of(result, "water")["totalShown"] == "1,140 L"
    fossil = measure_of(result, "fossilEnergy")
    assert fossil["totalShown"] == "25.7 MJ" and fossil["hotspot"] == "use"
    land = measure_of(result, "landUse")
    assert land["totalShown"] == "0.0112 points" and land["stages"][1]["shown"] == "3.15 × 10⁻⁴"
    label = world.label["id"]
    style = make_style(desk, label, washes=12)
    weighted = {"materialId": "wool", "fabricWeightGsm": "165", "areaM2": "1.47", "fibres": [{"name": "Wool", "sharePercent": "100.0"}], "tier1": {"factory": "A", "town": "B", "country": "VN"}}
    want(desk.post(f"/api/styles/{style['id']}/lines", weighted), 201)
    make_line(desk, style["id"], material="elastane", grams="33.3", tier1={"factory": "C", "town": "D", "country": "BD"})
    want(desk.post(f"/api/styles/{style['id']}/legs", {"mode": "air", "km": "1234.5"}), 201)
    want(desk.post(f"/api/styles/{style['id']}/legs", {"mode": "sea", "km": "777"}), 201)
    mixed = want(desk.post(f"/api/styles/{style['id']}/results"), 201)
    assert_measures(mixed["measures"], footprint([{"material": "wool", "grams": "242.55", "country": "VN"}, {"material": "elastane", "grams": "33.3", "country": "BD"}], [("air", "1234.5"), ("sea", "777")], 12))
    stub_cotton_climate(wiremock, "5.00")
    fresh_result = want(desk.post(f"/api/styles/{world.sid}/results"), 201)
    assert Decimal(measure_of(fresh_result, "climate")["stages"][0]["value"]) == Decimal("1.25"), "the figure must come from the library's answer"
    kept = want(desk.get(f"/api/results/{result['id']}/factors", params={"measure": "climate", "stage": "materials"}), 200)
    assert kept["rows"] == [{"id": "organic-cotton", "kind": "material", "value": "4.02", "unit": "kg CO₂e per kg"}]
    read = want(desk.get(f"/api/results/{fresh_result['id']}/factors", params={"measure": "climate", "stage": "materials"}), 200)
    assert read["rows"] == [{"id": "organic-cotton", "kind": "material", "value": "5.00", "unit": "kg CO₂e per kg"}], "the new result must keep the rows just read"


def test_results_kept_for_good(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, first = worked(desk)
    assert (first["dataQualityPercent"], first["dataQualityGrade"], first["current"]) == (0, "C", True)
    frozen = {key: value for key, value in first.items() if key != "current"}
    second = want(desk.post(f"/api/styles/{world.sid}/results"), 201)
    assert second["id"] != first["id"]
    assert [r["id"] for r in want(desk.get(f"/api/styles/{world.sid}/results"), 200)["results"]] == [second["id"], first["id"]]
    library = calls(wiremock, "/v2/editions") + calls(wiremock, "/v2/factors")
    request = ask(world, language="en")
    want(page_answer(app_url, token_of(request["answerAddress"]), {"energy": {"value": "4.35", "unit": "kWh"}, "water": {"value": "12.5"}, "fibreOrigin": "TR"}), 201)
    results = want(desk.get(f"/api/styles/{world.sid}/results"), 200)["results"]
    assert len(results) == 3 and calls(wiremock, "/v2/editions") + calls(wiremock, "/v2/factors") == library
    newest = results[0]
    assert (newest["dataQualityPercent"], newest["dataQualityGrade"], newest["edition"]) == (100, "A", "2027.1")
    assert_measures(newest["measures"], footprint([{**HARBOUR_LINES[0], "mj": "15.66", "water": "12.5"}], HARBOUR_LEGS, 30))
    climate = measure_of(newest, "climate")
    assert Decimal(climate["stages"][1]["value"]) == Decimal("0.48546") and climate["stages"][1]["shown"] == "0.485" and climate["totalShown"] == "2.23 kg CO₂e"
    assert Decimal(measure_of(newest, "water")["stages"][1]["value"]) == Decimal("250") / 1000 * Decimal("12.5")
    assert world.fresh_style()["latestResult"]["id"] == newest["id"]
    assert world.fresh_style()["changedBy"] == request["supplierName"]
    reread = want(desk.get(f"/api/results/{first['id']}"), 200)
    assert {key: value for key, value in reread.items() if key != "current"} == frozen, "an earlier result changed"
    assert want(desk.get(f"/api/results/{newest['id']}"), 200)["current"] is True
    with ui(browser, app_url, f"/styles/{world.sid}?result={first['id']}", desk=desk) as page:
        expect(part(page, "total-figure")).to_contain_text("2.20 kg CO₂e")
        expect(page.locator("body")).to_contain_text("2027.1")
    two = make_style(desk, world.label["id"])
    left = make_line(desk, two["id"], material="linen", grams="250")
    make_line(desk, two["id"], material="wool", grams="250")
    want(desk.post(f"/api/styles/{two['id']}/results"), 201)
    pair = World(desk, world.label, two, left)
    half = ask(pair, language="en", questions=["fibreOrigin"])
    want(page_answer(app_url, token_of(half["answerAddress"]), {"fibreOrigin": "TR"}), 201)
    latest = want(desk.get(f"/api/styles/{two['id']}/results"), 200)["results"][0]
    assert (latest["dataQualityPercent"], latest["dataQualityGrade"]) == (50, "B")


def test_stage_strata(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        strata = part(page, "stratum")
        expect(strata).to_have_count(5)
        assert [strata.nth(i).get_attribute("data-stage") for i in range(5)] == STAGES
        assert [strata.nth(i).get_attribute("data-share") for i in range(5)] == ["45.7", "20.9", "3.8", "29.1", "0.6"]
        marker = part(page, "hotspot-marker")
        expect(marker).to_have_attribute("data-stage", "materials")
        page.evaluate("""() => { for (const name of ['stratum', 'hotspot-marker']) for (const e of document.querySelectorAll(`[data-part="${name}"]`)) e.__same = true; }""")
        same = """() => [...document.querySelectorAll('[data-part="stratum"],[data-part="hotspot-marker"]')].every((e) => e.__same === true)"""
        clear_motion(page)
        wait_refresh(page)
        wait_refresh(page)
        assert not motion_log(page), "a refresh with no new data started motion"
        assert page.evaluate(same), "a refresh replaced an element"
        pick(page.get_by_role("radio", name="Fossil energy"))
        announced(page, "Fossil energy: 25.7 MJ, hotspot Use.")
        expect(marker).to_have_attribute("data-stage", "use")
        fossil = footprint(HARBOUR_LINES, HARBOUR_LEGS, 30)["fossilEnergy"]
        expect(staged(page, "stratum", "materials")).to_have_attribute("data-share", str(half_up(fossil["materials"] / sum(fossil.values(), Decimal(0)) * 100, "0.1")))
        expect(staged(page, "stratum-figure", "use")).to_contain_text("9.30")
        poll(lambda: 320 in motion_in(strata.first) and 640 in motion_in(marker), "strata move in 320 ms and the marker in 640 ms", 10)
        assert page.evaluate(same), "choosing a measure replaced an element"
        settled(page)
        pick(page.get_by_role("radio", name="Climate"))
        settled(page)
        materials = staged(page, "stratum", "materials")
        exact = footprint(HARBOUR_LINES, HARBOUR_LEGS, 30)
        share_of = lambda measure: str(half_up(exact[measure]["materials"] / sum(exact[measure].values(), Decimal(0)) * 100, "0.1"))
        pick(page.get_by_role("radio", name="Microfibres"))
        expect(materials).to_have_attribute("data-share", share_of("microfibres"))
        midway = materials.evaluate(SEEK_STRATUM, STRATUM_MID_MS)
        pick(page.get_by_role("radio", name="Water", exact=True))
        expect(materials).to_have_attribute("data-share", share_of("water"))
        start = materials.evaluate(SEEK_STRATUM, 0)
        page.evaluate("() => document.getAnimations().filter((a) => a.playState === 'paused').forEach((a) => a.play())")
        assert abs(start - midway) < THIRD_CHOICE_JUMP, f"a third choice started at {start} of the band, not from {midway}"
        settled(page)
        pick(page.get_by_role("radio", name="Climate"))
        settled(page)
        clear_motion(page)
        request = ask(world, language="en", questions=["energy"])
        want(page_answer(app_url, token_of(request["answerAddress"]), {"energy": {"value": "4.35", "unit": "kWh"}}), 201)
        expect(part(page, "total-figure")).to_contain_text("2.23 kg CO₂e", timeout=REFRESH_WAIT_MS)
        poll(lambda: 320 in motion_in(strata.first) or 320 in motion_log(page), "an answer moves the strata", 10)
        assert page.evaluate(same), "an answer replaced an element"
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk, reduced=True) as page:
        pick(page.get_by_role("radio", name="Water", exact=True))
        expect(part(page, "hotspot-marker")).to_have_attribute("data-stage", "materials")
        assert not motion_log(page), "reduced motion changes at once"


def test_measures_composite(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    distinct = "4.0299"
    stub_cotton_climate(wiremock, distinct)
    world, result = worked(desk)
    kept = want(desk.get(f"/api/results/{result['id']}/factors", params={"measure": "climate", "stage": "materials"}), 200)
    assert kept["rows"] == [{"id": "organic-cotton", "kind": "material", "value": distinct, "unit": f"{UNITS['climate']} per kg"}]
    factors = want(desk.get(f"/api/results/{result['id']}/factors", params={"measure": "climate", "stage": "making"}), 200)
    assert factors["edition"] == "2027.1" and factors["rows"] == [{"id": "TR", "kind": "grid", "value": "0.124", "unit": "kg CO₂e per MJ"}]
    want(desk.get(f"/api/results/{result['id']}/factors", params={"measure": "nope", "stage": "making"}), 422)
    for view in (LAPTOP, PHONE):
        with ui(browser, app_url, f"/styles/{world.sid}", desk=desk, view=view, touch=view == PHONE) as page:
            climate = page.get_by_role("radio", name="Climate")
            tab_to(page, climate)
            names = tab_order(page, 1)
            assert names and names[0] not in MEASURE_NAMES.values(), "the measures take a single Tab stop"
            climate.focus()
            page.keyboard.press("ArrowRight")
            expect(page.get_by_role("radio", name="Water", exact=True)).to_be_checked()
            page.keyboard.press("ArrowLeft")
            expect(climate).to_be_checked()
            if view == PHONE:
                page.keyboard.press("ArrowDown")
                expect(page.get_by_role("radio", name="Water", exact=True)).to_be_checked()
                page.keyboard.press("ArrowUp")
                expect(climate).to_be_checked()
            page.keyboard.press("Enter")
            panel = dialog(page, "Factors for Materials")
            expect(panel).to_contain_text("Factor edition 2027.1")
            expect(panel).to_contain_text(f"{MATERIAL_NAMES['organic-cotton']}: {distinct} {UNITS['climate']} per kg")
            settled(page)
            hit(button(panel, "Next stage"), view)
            hit(button(panel, "Close"), view)
            click(button(panel, "Next stage"))
            making = dialog(page, "Factors for Making")
            expect(making).to_contain_text("Turkey: 0.124 kg CO₂e per MJ")
            click(button(making, "Next stage"))
            expect(dialog(page, "Factors for Transport")).to_contain_text("Road")
            expect(dialog(page, "Factors for Transport")).to_contain_text(f"{FACTORS['road'][1]} {UNITS['climate']} per tonne-km")
            click(button(dialog(page, "Factors for Transport"), "Next stage"))
            expect(dialog(page, "Factors for Use")).to_contain_text(f"Wash: {FACTORS['wash'][1]} {UNITS['climate']} per wash")
            page.keyboard.press("Escape")
            expect(page.get_by_role("dialog")).to_have_count(0)


def test_newer_factors(browser: Browser, app_url: str, wiremock: Any) -> None:
    spare = os.environ["APP_SPARE_URL"]
    desk = Desk.sign_up(spare)
    world, first = worked(desk)
    seen_before = world.fresh_style()["newerFactors"]
    base_editions = [{"edition": "2026.2", "validFrom": "2026-01-01"}, {"edition": "2027.1", "validFrom": "2026-07-01"}]
    wiremock.stub("GET", "/v2/editions", json={"editions": [*base_editions, {"edition": "2099.1", "validFrom": "2099-01-01"}]})
    editions, pages = calls(wiremock, "/v2/editions"), calls(wiremock, "/v2/factors")
    checked = want(desk.post("/api/factors/check"), 200)
    assert checked["newestInEffect"] == "2027.1" and INSTANT.match(checked["checkedAt"])
    assert calls(wiremock, "/v2/editions") == editions + 1 and calls(wiremock, "/v2/factors") == pages, "Check reads only the edition list"
    assert world.fresh_style()["newerFactors"] == seen_before, "a later validFrom shows nothing yet"
    assert want(desk.post(f"/api/styles/{world.sid}/results"), 201)["edition"] == "2027.1"
    wiremock.stub("GET", "/v2/editions", json={"editions": [*base_editions, {"edition": "2027.2", "validFrom": "2026-07-02"}]})
    with ui(browser, spare, f"/styles/{world.sid}", desk=desk, zone="Pacific/Auckland") as page:
        click(button(page, "Check for newer factors"))
        announced(page, "Newer factors available (2027.2).")
        expect(page.locator("body")).to_contain_text("Newer factors available (2027.2).")
    assert world.fresh_style()["newerFactors"] == "2027.2"
    assert want(desk.get(f"/api/results/{first['id']}"), 200)["edition"] == "2027.1", "an earlier result keeps its edition"
    wiremock.fault("GET", "/v2/editions")
    want(desk.post("/api/factors/check"), 503, "factor_library_unavailable")


def test_wf_scenarios_screen_rules(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    api_edges(desk, f"/api/styles/{world.sid}/scenarios")
    walk_rules(browser, desk, app_url, f"/styles/{world.sid}/scenarios", lambda p: button(p, "Save scenario"), lambda p: dialog(p, "Save scenario"), typed=lambda d: labelled(d, "Name"))
    sweep_for(browser, app_url, "scenarios")
    with ui(browser, app_url, f"/styles/{world.sid}/scenarios", desk=desk) as page:
        expect(h1(page)).to_be_visible()
        def save() -> None:
            click(button(page, "Save scenario"))
            panel = dialog(page, "Save scenario")
            fill(labelled(panel, "Name"), "Twice the same")
            click(button(panel, "Save"))
            expect(panel).to_be_hidden()
        announced_twice(page, save)


def test_wf_scenarios_keyboard(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    with ui(browser, app_url, f"/styles/{world.sid}/scenarios", desk=desk) as page:
        expect(h1(page)).to_have_text(f"Scenarios for {world.style['name']}")
        slider = page.get_by_role("slider", name=f"Recycled share for {MATERIAL_NAMES['organic-cotton']}")
        tab_to(page, slider)
        for _ in range(10):
            page.keyboard.press("ArrowRight")
        announced(page, "Scenario climate total 1.90 kg CO₂e.")
        expect(slider).to_be_focused()
        opener = button(page, "Save scenario")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        panel = dialog(page, "Save scenario")
        focus_in(panel)
        name = fresh("Half recycled")
        page.keyboard.type(name)
        tab_to(page, button(panel, "Save"))
        with gate(page, r"/scenarios$") as release:
            page.keyboard.press("Enter")
            working(panel)
            release()
        expect(opener).to_be_focused()
        announced(page, f"Scenario {name} saved.")
    saved = want(desk.get(f"/api/styles/{world.sid}/scenarios"), 200)["scenarios"]
    assert [s["name"] for s in saved] == [name]
    assert saved[0]["recycled"] == [{"lineId": world.line["id"], "percent": 50}]


def test_wf_scenarios_touch(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    with ui(browser, app_url, f"/styles/{world.sid}/scenarios", desk=desk, view=PHONE, touch=True) as page:
        fixed_bottom(button(page, "Save scenario"), PHONE)
        touch_targets(page)
        layout(page)
        frame = page.get_by_role("region", name="Comparison")
        assert frame.evaluate("(e) => e.tabIndex >= 0")
        select(page.get_by_role("combobox", name="Mode for leg 1"), "Sea")
        expect(page).to_have_url(re.compile(r"mode=0"))
        address(page, mode=["0:sea"])
        expect(frame).to_contain_text("−")
        tap(button(page, "Save scenario"))
        panel = dialog(page, "Save scenario")
        name = fresh("By sea")
        fill(labelled(panel, "Name"), name)
        tap(button(panel, "Save"))
        announced(page, f"Scenario {name} saved.")
    assert want(desk.get(f"/api/styles/{world.sid}/scenarios"), 200)["scenarios"][0]["legModes"] == [{"legIndex": 0, "mode": "sea"}]


def test_wf_scenarios_copy_precision(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, result = worked(desk)
    path = f"/api/styles/{world.sid}/scenarios"
    library = calls(wiremock, "/v2/editions") + calls(wiremock, "/v2/factors")
    line = world.line["id"]
    half = want(desk.post(f"{path}/preview", {"resultId": result["id"], "recycled": [{"lineId": line, "percent": 50}]}), 200)
    climate = next(m for m in half["measures"] if m["measure"] == "climate")
    assert Decimal(climate["total"]) == Decimal("1.8981") and climate["totalShown"] == f"1.90 {UNITS['climate']}" and climate["stages"][0]["shown"] == "0.704"
    assert next(d for d in half["differences"] if d["measure"] == "climate")["shown"] == "−0.302 kg CO₂e (−14%)"
    moved = want(desk.post(f"{path}/preview", {"resultId": result["id"], "factorySwaps": [{"lineId": line, "country": "IN"}]}), 200)
    rise = Decimal("3.7") * (Decimal(FACTORS["IN"][1]) - Decimal(FACTORS["TR"][1]))
    percent = half_up(rise / Decimal("2.1996") * 100, "1")
    assert next(d for d in moved["differences"] if d["measure"] == "climate")["shown"] == f"+{display(rise)} {UNITS['climate']} (+{percent}%)"
    same = want(desk.post(f"{path}/preview", {"resultId": result["id"]}), 200)
    assert next(d for d in same["differences"] if d["measure"] == "climate")["shown"] == "no change"
    swap = want(desk.post(f"{path}/preview", {"resultId": result["id"], "materialSwaps": [{"lineId": line, "materialId": "cotton"}], "legModes": [{"legIndex": 0, "mode": "rail"}]}), 200)
    assert_measures(swap["measures"], footprint([{"material": "cotton", "grams": "250", "country": "TR"}], [("rail", "3200")], 30))
    assert desk.post(f"{path}/preview", {"resultId": result["id"], "recycled": [{"lineId": "unknown", "percent": 50}]}).status_code in (404, 422)
    want(desk.post(f"{path}/preview", {"resultId": result["id"], "recycled": [{"lineId": line, "percent": 101}]}), 422)
    assert calls(wiremock, "/v2/editions") + calls(wiremock, "/v2/factors") == library, "a scenario calls no library"
    assert want(desk.get(f"/api/results/{result['id']}"), 200)["measures"] == result["measures"]
    newer = want(desk.post(f"/api/styles/{world.sid}/results"), 201)
    stale = desk.post(path, {"resultId": result["id"], "name": "Late"})
    want(stale, 412, "stale_edit")
    assert error_message(stale) == f"The baseline was worked out again at {wall_time(newer['workedOutAt'])} Lisbon time. Your scenario is still here."
    assert want(desk.get(path), 200)["scenarios"] == []


SCENARIO_ANSWER = r"/scenarios(/preview$|\?)"


def test_live_scenario_totals(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, result = worked(desk)
    with ui(browser, app_url, f"/styles/{world.sid}/scenarios", desk=desk) as page:
        expect(part(page, "ghost-stratum")).to_have_count(5)
        slider = page.get_by_role("slider", name=f"Recycled share for {MATERIAL_NAMES['organic-cotton']}")
        comparison = page.get_by_role("region", name="Comparison")
        entries = history(page)
        slider.focus()
        started = time.monotonic()
        with first_held(page, SCENARIO_ANSWER) as release:
            with page.expect_request(re.compile(SCENARIO_ANSWER)):
                page.keyboard.press("ArrowRight")
            assert time.monotonic() - started >= PAUSE_SECONDS, "the preview went before the published pause"
            for _ in range(9):
                page.keyboard.press("ArrowRight")
            announced(page, "Scenario climate total 1.90 kg CO₂e.")
            expect(comparison).to_contain_text("−0.302 kg CO₂e (−14%)")
            let_go(page, release, SCENARIO_ANSWER)
            settled(page)
            expect(comparison).to_contain_text("−0.302 kg CO₂e (−14%)")
        expect(part(page, "ghost-stratum")).to_have_count(5)
        recycled = f"{world.line['id']}:50"
        address(page, recycled=[recycled])
        assert history(page) > entries, "a committed change makes a history entry"
        before_mode = history(page)
        select(page.get_by_role("combobox", name="Mode for leg 1"), "Sea")
        address(page, entries=before_mode + 1, mode=["0:sea"])
        page.go_back()
        address(page, mode=None, recycled=[recycled])
        page.reload()
        announced_or_shown = page.get_by_role("region", name="Comparison")
        expect(announced_or_shown).to_contain_text("−0.302 kg CO₂e (−14%)")
        click(button(page, "Save scenario"))
        panel = dialog(page, "Save scenario")
        fill(labelled(panel, "Name"), "Half recycled")
        newer = want(desk.post(f"/api/styles/{world.sid}/results"), 201)
        click(button(panel, "Save"))
        region = panel.get_by_role("region", name="Problems")
        expect(region).to_contain_text(f"The baseline was worked out again at {wall_time(newer['workedOutAt'])} Lisbon time. Your scenario is still here.")
        focus_in(region)
        expect(labelled(panel, "Name")).to_have_value("Half recycled")
    assert want(desk.get(f"/api/results/{result['id']}"), 200)["id"] == result["id"]


SCORE_PATH = "/v1/textile/score"


def test_wf_textile_score_screen_rules(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = scored(desk)
    api_edges(desk, f"/api/styles/{world.sid}/score")
    walk_rules(browser, desk, app_url, f"/styles/{world.sid}", lambda p: p.get_by_role("radio", name="Climate"), lambda p: dialog(p, "Factors for Materials"), popover=True)
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        expect(page.locator("body")).to_contain_text("Score 1,240 points (412 per 100 g)")
        wait_refresh(page)
        expect(page.locator("body")).to_contain_text("Score 1,240 points (412 per 100 g)")
    sweep_for(browser, app_url, "style")
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        ask_again = button(page, "Ask for score")
        expect(ask_again).to_be_visible()
        announced_twice(page, lambda: click(ask_again))


def test_wf_textile_score_keyboard(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk, repairService=True, rangeSize=5000)
    start = calls(wiremock, SCORE_PATH)
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        action = button(page, "Ask for score")
        tab_to(page, action)
        with gate(page, r"/score$") as release:
            page.keyboard.press("Enter")
            working(page)
            expect(page.locator("body")).not_to_contain_text("Score 1,240 points")
            release()
        announced(page, "Score 1,240 points (412 per 100 g)")
        expect(action).to_be_focused()
    assert calls(wiremock, SCORE_PATH) == start + 1


def test_wf_textile_score_touch(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    wiremock.stub("POST", SCORE_PATH, json={"score": 987, "per100g": 321, "runId": "run-touch"})
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk, view=PHONE, touch=True) as page:
        touch_targets(page)
        action = button(page, "Ask for score")
        tap(action)
        announced(page, "Score 987 points (321 per 100 g)")
        layout(page)
    score = world.fresh_style()["score"]
    assert (score["state"], score["score"], score["per100g"], score["runId"]) == ("current", 987, 321, "run-touch")


def test_wf_textile_score_copy_precision(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    gap = make_style(desk, world.label["id"])
    make_line(desk, gap["id"], material="linen", tier3=None)
    start = calls(wiremock, SCORE_PATH)
    with ui(browser, app_url, f"/styles/{gap['id']}", desk=desk) as page:
        click(button(page, "Ask for score"))
        announced(page, "Fibre origin is missing for Linen.")
    assert calls(wiremock, SCORE_PATH) == start
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        click(button(page, "Ask for score"))
        announced(page, "Score 1,240 points (412 per 100 g)")
        expect(page.locator("body")).to_contain_text("Worst-case value used for repair service.")
        expect(page.locator("body")).to_contain_text("Worst-case value used for range size.")
        assert calls(wiremock, SCORE_PATH) == start + 1
        want(desk.patch(f"/api/styles/{world.sid}", {"washes": 31}), 200)
        expect(page.locator("body")).to_contain_text("Outdated", timeout=REFRESH_WAIT_MS)
        wiremock.fault("POST", SCORE_PATH)
        click(button(page, "Ask for score"))
        announced(page, "The score service is unavailable right now. Nothing changed.")
        expect(page.locator("body")).to_contain_text("Score 1,240 points (412 per 100 g)")
        wiremock.stub("POST", SCORE_PATH, status=429, headers={"Retry-After": "600"})
        click(button(page, "Ask for score"))
        expect(say(page)).to_contain_text(re.compile(r"The score service is busy\. You can try again at \d\d:\d\d Lisbon time\."))
        busy = world.fresh_style()["score"]
        announced(page, f"The score service is busy. You can try again at {wall_time(busy['busyUntil'])} Lisbon time.")


def test_score_rules(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    assert world.fresh_style()["score"] is None or world.fresh_style()["score"]["state"] == "none"
    path = f"/api/styles/{world.sid}/score"
    gap = make_style(desk, world.label["id"])
    make_line(desk, gap["id"], material="wool", tier2=None)
    start = calls(wiremock, SCORE_PATH)
    refused = desk.post(f"/api/styles/{gap['id']}/score")
    want(refused, 422, "validation_failed")
    assert error_message(refused) == f"Fibre origin is missing for {MATERIAL_NAMES['wool']}." and "fields" not in refused.json()["error"]
    assert calls(wiremock, SCORE_PATH) == start
    score = want(desk.post(path), 200)
    assert (score["state"], score["score"], score["per100g"], score["runId"], score["shown"]) == ("current", 1240, 412, "run-baseline", "Score 1,240 points (412 per 100 g)")
    assert set(score["worstCaseFacts"]) == {"repairService", "rangeSize"}
    sent = wm_body(wiremock.requests(SCORE_PATH)[-1])
    assert Decimal(sent.pop("massGrams")) == 250
    assert sent == {"gtin": world.style["gtin"], "garment": "tshirt", "washes": 30, "materials": [{"id": "organic-cotton", "sharePercent": "100.0", "tier1": "TR", "tier2": "TR", "tier3": "IN"}], "repairService": False, "rangeSize": 100000}
    assert calls(wiremock, SCORE_PATH) == start + 1
    want(desk.post(path), 200)
    assert calls(wiremock, SCORE_PATH) == start + 1, "the same inputs called twice"
    want(desk.patch(f"/api/styles/{world.sid}", {"washes": 31}), 200)
    assert world.fresh_style()["score"]["state"] == "outdated"
    wiremock.fault("POST", SCORE_PATH)
    want(desk.post(path), 503, "score_service_unavailable")
    kept = world.fresh_style()["score"]
    assert (kept["state"], kept["score"]) == ("outdated", 1240)
    wiremock.stub("POST", SCORE_PATH, status=500, json={})
    assert error_message(want_status(desk.post(path), 503)) == "The score service is unavailable right now. Nothing changed."
    wiremock.stub("POST", SCORE_PATH, json={"score": 1, "per100g": 1, "runId": "late"}, delay_ms=TIMEOUT_DELAY_MS)
    want(desk.post(path), 503, "score_service_unavailable")
    wiremock.stub("POST", SCORE_PATH, json={"score": 1240, "per100g": 412, "runId": "run-baseline"})
    want(desk.patch(f"/api/styles/{world.sid}", {"washes": 30}), 200)
    count = calls(wiremock, SCORE_PATH)
    assert want(desk.post(path), 200)["state"] == "current"
    assert calls(wiremock, SCORE_PATH) == count, "a stored score for that body needs no call"
    other_run = "run-other"
    wiremock.stub("POST", SCORE_PATH, json={"score": 2000, "per100g": 500, "runId": other_run})
    want(desk.patch(f"/api/styles/{world.sid}", {"washes": 40}), 200)
    assert want(desk.post(path), 200)["runId"] == other_run
    count = calls(wiremock, SCORE_PATH)
    want(desk.patch(f"/api/styles/{world.sid}", {"washes": 30}), 200)
    back = want(desk.post(path), 200)
    assert calls(wiremock, SCORE_PATH) == count, "the same inputs called twice"
    assert (back["state"], back["runId"], back["score"]) == ("current", "run-baseline", 1240), "a stored score for that body is shown"
    request = ask(world, language="en", questions=["water"])
    want(page_answer(app_url, token_of(request["answerAddress"]), {"water": {"value": "12.5"}}), 201)
    assert world.fresh_style()["score"]["state"] == "outdated"


def want_status(response: httpx.Response, status: int) -> httpx.Response:
    assert response.status_code == status, response.text[:300]
    return response


def test_score_busy_held_by_server(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    path = f"/api/styles/{world.sid}/score"
    wiremock.stub("POST", SCORE_PATH, status=429, headers={"Retry-After": "20"})
    first = desk.post(path)
    want(first, 503, "score_service_busy")
    until = first.json()["error"]["busyUntil"]
    assert INSTANT.match(until)
    assert error_message(first) == f"The score service is busy. You can try again at {wall_time(until)} Lisbon time."
    state = world.fresh_style()["score"]
    assert (state["state"], state["busyUntil"]) == ("busy", until)
    count = calls(wiremock, SCORE_PATH)
    want(desk.post(path), 503, "score_service_busy")
    assert calls(wiremock, SCORE_PATH) == count, "a call went before the busy instant"
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk, zone="Pacific/Auckland", ahead=timedelta(days=3)) as page:
        busy = f"The score service is busy. You can try again at {wall_time(until)} Lisbon time."
        loaded(page)
        if busy not in (page.locator("body").text_content() or ""):
            click(button(page, "Ask for score"))
        expect(page.locator("body")).to_contain_text(busy)
    after_run = "run-after"
    wiremock.stub("POST", SCORE_PATH, json={"score": 1240, "per100g": 412, "runId": after_run})
    poll(lambda: server_now(app_url) >= parse_instant(until), "the busy instant passing", OUTAGE_POLL_SECONDS)
    assert want(desk.post(path), 200)["runId"] == after_run
    assert calls(wiremock, SCORE_PATH) == count + 1


def test_wf_product_passports_screen_rules(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = published(desk)
    api_edges(desk, f"/api/styles/{world.sid}/passport")
    name = world.style["name"]
    walk_rules(browser, desk, app_url, "/passports", lambda p: button(p, f"Withdraw {name}"), lambda p: dialog(p, "Withdraw passport"))
    sweep_for(browser, app_url, "passports")
    sweep(browser, app_url, None, f"/p/{world.style['gtin']}")


def test_wf_product_passports_keyboard(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = scored(desk)
    number, name = world.style["gtin"], world.style["name"]
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        action = button(page, "Publish passport")
        tab_to(page, action)
        with gate(page, r"/passport$") as release:
            page.keyboard.press("Enter")
            working(page)
            release()
        announced(page, "Passport edition 1 published.")
        correction = button(page, "Publish correction")
        expect(correction).to_be_focused()
        page.keyboard.press("Enter")
        announced(page, "Passport edition 2 published.")
    assert want(httpx.get(f"{app_url}/api/passports/{number}", timeout=HTTP_TIMEOUT), 200)["edition"] == 2
    with ui(browser, app_url, "/passports", desk=desk) as page:
        table = page.get_by_role("region", name="Passports table")
        expect(table.get_by_role("link", name=f"{name} edition 1")).to_be_visible()
        expect(button(page, f"Withdraw {name}")).to_have_count(1)
        tab_to(page, button(page, f"Withdraw {name}"))
        page.keyboard.press("Enter")
        panel = dialog(page, "Withdraw passport")
        tab_to(page, button(panel, "Withdraw"))
        page.keyboard.press("Enter")
        announced(page, f"Passport for {name} withdrawn.")
        expect(h1(page)).to_be_focused()
    want(httpx.get(f"{app_url}/api/passports/{number}", timeout=HTTP_TIMEOUT), 410, "withdrawn")


def test_wf_product_passports_touch(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = scored(desk)
    number = world.style["gtin"]
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk, view=PHONE, touch=True) as page:
        tap(button(page, "Publish passport"))
        announced(page, "Passport edition 1 published.")
        page.goto(f"{app_url}/passports")
        touch_targets(page)
        layout(page)
    with ui(browser, app_url, f"/p/{number}", view=PHONE, touch=True) as page:
        expect(h1(page)).to_have_text(world.style["name"])
        touch_targets(page)
        layout(page)
        tap(page.get_by_role("navigation", name="Language").get_by_role("link", name="Français"))
        expect(page.locator("html")).to_have_attribute("lang", "fr")
        expect(page.locator("body")).to_contain_text("Marque")
    assert want(desk.get("/api/passports"), 200)["passports"][0]["gtin"] == number


def test_wf_product_passports_copy_precision(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, passport = published(desk)
    number = world.style["gtin"]
    with ui(browser, app_url, f"/p/{number}/e/1") as page:
        expect(h1(page)).to_have_text(world.style["name"])
        before = page.locator("body").inner_text()
        assert "2.20 kg CO₂e" in before
        expect(page.locator("body")).not_to_contain_text("Corrected")
        want(desk.patch(f"/api/styles/{world.sid}", {"washes": 60}), 200)
        newer = want(desk.post(f"/api/styles/{world.sid}/results"), 201)
        want(desk.post(f"/api/styles/{world.sid}/score"), 200)
        second = want(desk.post(f"/api/styles/{world.sid}/passport"), 201)
        page.reload()
        expect(h1(page)).to_have_text(world.style["name"])
        assert page.locator("body").inner_text() == before, "edition 1's page changed"
        page.goto(f"{app_url}/p/{number}")
        expect(page.locator("body")).to_contain_text(re.compile("Corrected " + date_form(second["publishedAt"])))
        expect(page.locator("body")).to_contain_text(measure_of(newer, "climate")["totalShown"])
    rival = harbour(Desk.sign_up(app_url), gtin=number)
    want(rival.desk.post(f"/api/styles/{rival.sid}/results"), 201)
    want(rival.desk.post(f"/api/styles/{rival.sid}/score"), 200)
    taken = rival.desk.post(f"/api/styles/{rival.sid}/passport")
    want(taken, 409, "gtin_taken")
    assert error_message(taken) == "A passport with this GTIN already exists."
    want(desk.post(f"/api/styles/{world.sid}/passport/withdraw"), 200)
    with ui(browser, app_url, None) as page:
        for address in (f"/p/{number}", f"/p/{number}/e/1"):
            document = page.goto(app_url + address)
            assert document and document.status == 410
            expect(h1(page)).to_have_text("This passport has been withdrawn.")
    assert passport["address"] == f"/p/{number}"


def test_published_fields_only(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = scored(desk, notes="Secret dye note for the desk.")
    request = ask(world, language="en", supplier="Hidden Supplier Co")
    want(desk.post(f"/api/styles/{world.sid}/passport"), 201)
    number = world.style["gtin"]
    forbidden = [request["contactName"], request["contactEmail"], "Secret dye note", world.label["contactEmail"], world.label["contactName"], "Hidden Supplier Co"]
    for language in ("en", "fr", "tr", "ar"):
        response = httpx.get(f"{app_url}/api/passports/{number}", params={"lang": language}, timeout=HTTP_TIMEOUT)
        body = want(response, 200)
        assert set(body) == {"gtin", "edition", "lang", "styleName", "labelName", "garment", "publishedAt", "correctedOn", "factorEdition", "dataQualityPercent", "dataQualityGrade", "scoreShown", "measures"}
        assert body["lang"] == language and body["correctedOn"] is None and body["factorEdition"] == "2027.1"
        assert all(set(m) == {"measure", "totalShown"} for m in body["measures"]) and len(body["measures"]) == 6
        assert not [word for word in forbidden if word in response.text]
    with ui(browser, app_url, f"/p/{number}") as page:
        for link, expected in PASSPORT_COPY.items():
            click(page.get_by_role("navigation", name="Language").get_by_role("link", name=link))
            expect(page.locator("html")).to_have_attribute("lang", expected["lang"])
            shown = page.locator("body")
            for word in expected["words"]:
                expect(shown).to_contain_text(word)
            assert not [word for word in forbidden if word in page.content()]
    seed = httpx.get(f"{app_url}/p/4006381333931", timeout=HTTP_TIMEOUT)
    assert seed.status_code == 200 and "Check dye house meter in spring." not in seed.text and "ayse@yildiz-iplik.example" not in seed.text


def test_editions_and_withdrawal(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    number = world.style["gtin"]
    refused = desk.post(f"/api/styles/{world.sid}/passport")
    want(refused, 409, "conflict")
    assert error_message(refused) == "Ask for a current score before publishing."
    want(desk.post(f"/api/styles/{world.sid}/score"), 200)
    first = want(desk.post(f"/api/styles/{world.sid}/passport"), 201)
    assert (first["edition"], first["state"], first["gtin"]) == (1, "published", number)
    assert world.fresh_style()["state"] == "published"
    edition_one = want(httpx.get(f"{app_url}/api/passports/{number}/editions/1", timeout=HTTP_TIMEOUT), 200)
    want(desk.patch(f"/api/styles/{world.sid}", {"washes": 60}), 200)
    outdated = desk.post(f"/api/styles/{world.sid}/passport")
    want(outdated, 409, "conflict")
    want(desk.post(f"/api/styles/{world.sid}/results"), 201)
    want(desk.post(f"/api/styles/{world.sid}/score"), 200)
    second = want(desk.post(f"/api/styles/{world.sid}/passport"), 201)
    assert second["edition"] == 2
    latest = want(httpx.get(f"{app_url}/api/passports/{number}", timeout=HTTP_TIMEOUT), 200)
    assert latest["edition"] == 2 and latest["correctedOn"] and latest["measures"] != edition_one["measures"]
    assert want(httpx.get(f"{app_url}/api/passports/{number}/editions/1", timeout=HTTP_TIMEOUT), 200) == edition_one
    want(httpx.get(f"{app_url}/api/passports/{number}/editions/9", timeout=HTTP_TIMEOUT), 404, "not_found")
    rows = want(desk.get("/api/passports"), 200)["passports"]
    assert sorted(row["edition"] for row in rows) == [1, 2]
    rival, _ = worked(Desk.sign_up(app_url), gtin=number)
    want(rival.desk.post(f"/api/styles/{rival.sid}/score"), 200)
    want(rival.desk.post(f"/api/styles/{rival.sid}/passport"), 409, "gtin_taken")
    assert want(desk.post(f"/api/styles/{world.sid}/passport/withdraw"), 200) == {"gtin": number, "state": "withdrawn"}
    gone = httpx.get(f"{app_url}/api/passports/{number}", timeout=HTTP_TIMEOUT)
    want(gone, 410, "withdrawn")
    assert error_message(gone) == "This passport has been withdrawn."
    want(httpx.get(f"{app_url}/api/passports/{number}/editions/1", timeout=HTTP_TIMEOUT), 410, "withdrawn")
    assert {row["state"] for row in want(desk.get("/api/passports"), 200)["passports"]} == {"withdrawn"}
    want(desk.post(f"/api/styles/{world.sid}/passport"), 409, "conflict")
    want(desk.post(f"/api/styles/{world.sid}/passport/withdraw"), 409)


def dossier_of(desk: Desk, world: World) -> dict:
    return want(desk.post(f"/api/styles/{world.sid}/dossiers"), 201)


def test_wf_dossier_and_sign_off_screen_rules(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    api_edges(desk, f"/api/styles/{world.sid}/dossiers")
    walk_rules(browser, desk, app_url, f"/labels/{world.label['id']}", lambda p: button(p, "Close label"), lambda p: dialog(p, "Close label"))
    walk_rules(browser, desk, app_url, f"/styles/{world.sid}", lambda p: p.get_by_role("radio", name="Climate"), lambda p: dialog(p, "Factors for Materials"), refresh_line=None, popover=True)
    sweep_for(browser, app_url, "label", "signoff")
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        make = button(page, "Make dossier")
        expect(make).to_be_visible()
        announced_twice(page, lambda: click(make))


def test_wf_dossier_and_sign_off_keyboard(browser: Browser, app_url: str, mail: Any, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    name = world.label["name"]
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        action = button(page, "Make dossier")
        tab_to(page, action)
        with gate(page, r"/dossiers$") as release:
            page.keyboard.press("Enter")
            working(page)
            word_not_shown(page, "Ready")
            release()
        announced(page, "Dossier ready.")
        expect(page.get_by_text(re.compile(r"\bReady\b")).first).to_be_visible()
        expect(action).to_be_focused()
        send = button(page, "Send sign-off page")
        tab_to(page, send)
        page.keyboard.press("Enter")
        announced(page, f"Sign-off page sent to {world.label['contactName']}.")
        expect(send).to_be_focused()
    assert mail_to(mail, world.label["contactEmail"])[0]["Subject"] == f"Dossier to sign off: {world.style['name']}"
    with ui(browser, app_url, f"/labels/{world.label['id']}", desk=desk) as page:
        tab_to(page, button(page, "Close label"))
        page.keyboard.press("Enter")
        panel = dialog(page, "Close label")
        tab_to(page, button(panel, "Close this label"))
        page.keyboard.press("Enter")
        expect(h1(page)).to_be_focused()
        closed = want(desk.get(f"/api/labels/{world.label['id']}"), 200)
        announced(page, re.compile(re.escape(f"Label {name} closed. It will be erased on ") + date_form(closed["eraseAt"]) + re.escape(f", {wall_time(closed['eraseAt'])} Lisbon time unless you bring it back.")))
        tab_to(page, button(page, "Bring back"))
        page.keyboard.press("Enter")
        tab_to(page, button(dialog(page, "Bring back"), "Bring back label"))
        page.keyboard.press("Enter")
        announced(page, f"Label {name} is back.")
        expect(h1(page)).to_be_focused()
    assert want(desk.get(f"/api/labels/{world.label['id']}"), 200)["state"] == "open"


def test_wf_dossier_and_sign_off_touch(browser: Browser, app_url: str, mail: Any, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    dossier = dossier_of(desk, world)
    want(desk.post(f"/api/dossiers/{dossier['id']}/sign-off-page"), 201)
    token = token_of(mail_text(mail_to(mail, world.label["contactEmail"])[0]), "s")
    with ui(browser, app_url, f"/s/{token}", view=PHONE, touch=True) as page:
        expect(h1(page)).to_have_text(f"Sign off {world.style['name']}")
        expect(page.get_by_role("link", name="Read the dossier")).to_be_visible()
        action = button(page, "Sign off")
        fixed_bottom(action, PHONE)
        touch_targets(page)
        tap(action)
        expect(page.locator("body")).to_contain_text("Type your name to sign off.")
        fill(page.get_by_role("textbox", name="Your name"), "Inês Barros")
        tap(action)
        announced(page, "Signed off by Inês Barros.")
    state = want(desk.get(f"/api/dossiers/{dossier['id']}"), 200)
    assert (state["state"], state["signedOffBy"]) == ("signedOff", "Inês Barros")
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk, view=PHONE, touch=True) as page:
        expect(page.locator("body")).to_contain_text(re.compile(re.escape(f"Signed off by {state['signedOffBy']} on ") + date_form(state["signedOffAt"])))


def test_wf_dossier_and_sign_off_copy_precision(browser: Browser, app_url: str, wiremock: Any) -> None:
    for env, copy in (("APP_GOTENBERG_DOWN_URL", "The dossier service is unavailable right now. Nothing was saved."), ("APP_MINIO_DOWN_URL", "The file store is unavailable right now. Nothing was saved.")):
        base = os.environ[env]
        desk = Desk.sign_up(base)
        world, _ = worked(desk)
        with ui(browser, base, f"/styles/{world.sid}", desk=desk) as page:
            click(button(page, "Make dossier"))
            announced(page, copy)
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    first = dossier_of(desk, world)
    address = want(desk.post(f"/api/dossiers/{first['id']}/sign-off-page"), 201)["signOffAddress"]
    second = dossier_of(desk, world)
    with ui(browser, app_url, f"/s/{token_of(address, 's')}") as page:
        fill(page.get_by_role("textbox", name="Your name"), "Inês Barros")
        click(button(page, "Sign off"))
        expect(page.locator("body")).to_contain_text(f"A newer dossier was made at {wall_time(second['madeAt'])} Lisbon time. Read it first.")
    edition_line = f"Factor edition {second['edition']}"
    assert re.sub(r"\s", "", edition_line) in re.sub(r"\s", "", pdf_text(desk.get(f"/api/dossiers/{second['id']}/file").content))
    results = desk.get(f"/api/styles/{world.sid}/results-file")
    assert '"2.20 kg CO₂e"' in results.text
    for _ in range(DOWNLOAD_LIMIT - 2):
        want_status(desk.get(f"/api/styles/{world.sid}/results-file"), 200)
    limited = desk.get(f"/api/styles/{world.sid}/results-file")
    want(limited, 429, "rate_limited")
    assert re.fullmatch(r"Too many downloads for now\. You can download another at \d\d:\d\d Lisbon time\.", error_message(limited))


def test_dossier_pdf(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, result = worked(desk)
    request = ask(world, language="en", questions=["water"])
    latest = result
    no_result = make_style(desk, world.label["id"])
    refused = desk.post(f"/api/styles/{no_result['id']}/dossiers")
    want(refused, 409, "conflict")
    assert error_message(refused) == "Work out the footprint first."
    dossier = dossier_of(desk, world)
    assert dossier["state"] == "ready" and dossier["edition"] == "2027.1" and dossier["resultId"] == latest["id"]
    stored = s3().get(f"dossiers/{desk.assessor['id']}/{dossier['id']}.pdf")
    served = want_status(desk.get(f"/api/dossiers/{dossier['id']}/file"), 200)
    assert served.headers["content-type"].startswith("application/pdf") and served.content == stored
    assert _kit("pdf_pages", "gotenberg")(stored) >= 1
    words = pdf_words(stored)
    for fact in (world.style["name"], "Factor edition 2027.1", "Data quality C (0%)"):
        assert figure_words(fact) in words, fact
    for measure in latest["measures"]:
        assert figure_words(measure["totalShown"]) in words, measure["totalShown"]
        for stage in measure["stages"]:
            assert figure_words(stage["shown"]) in words, stage["shown"]
    for secret in (request["contactName"], request["contactEmail"]):
        assert figure_words(secret) not in words
    replacement = dossier_of(desk, world)
    assert want(desk.get(f"/api/dossiers/{dossier['id']}"), 200)["state"] == "replaced"
    assert want(desk.get(f"/api/dossiers/{replacement['id']}"), 200)["state"] == "ready"
    for env, suffix, code in (("APP_GOTENBERG_DOWN_URL", "-render", "dossier_service_unavailable"), ("APP_MINIO_DOWN_URL", "-storage", "file_store_unavailable")):
        base = os.environ[env]
        down = Desk.sign_up(base)
        down_world, _ = worked(down)
        want(down.post(f"/api/styles/{down_world.sid}/dossiers"), 503, code)
        assert want(down.get(f"/api/styles/{down_world.sid}/dossiers"), 200)["dossiers"] == []
        if suffix == "-render":
            assert s3(suffix).keys(f"dossiers/{down.assessor['id']}/") == []


def test_private_sign_off(app_url: str, mail: Any, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    dossier = dossier_of(desk, world)
    page_info = want(desk.post(f"/api/dossiers/{dossier['id']}/sign-off-page"), 201)
    old = token_of(page_info["signOffAddress"], "s")
    message = mail_to(mail, world.label["contactEmail"])[0]
    body = mail_text(message)
    places = [found.start() if (found := re.search(piece, body)) else -1 for piece in (re.escape(f"Hello {world.label['contactName']},"), re.escape(f"Please read and sign off the dossier for {world.style['name']} on this private page:"), re.escape(f"/s/{old}"), "This page ends on " + date_form(page_info["endsAt"]) + re.escape(f", {wall_time(page_info['endsAt'])} Lisbon time."))]
    assert all(place >= 0 for place in places) and places == sorted(places), body
    reading_page = want(httpx.get(f"{app_url}/api/s/{old}", timeout=HTTP_TIMEOUT), 200)
    assert set(reading_page) == {"dossier", "endsAt"} and reading_page["dossier"]["styleName"] == world.style["name"]
    assert set(reading_page["dossier"]) == {"id", "state", "styleName", "edition", "dataQualityPercent", "dataQualityGrade", "measures", "madeAt", "signedOffBy", "signedOffAt"}
    before = httpx.get(f"{app_url}/api/s/{old}/file", timeout=HTTP_TIMEOUT)
    assert before.status_code == 200 and before.content[:4] == b"%PDF"
    new = token_of(want(desk.post(f"/api/dossiers/{dossier['id']}/sign-off-page"), 201)["signOffAddress"], "s")
    want(httpx.get(f"{app_url}/api/s/{old}", timeout=HTTP_TIMEOUT), 410, "page_ended")
    want(httpx.post(f"{app_url}/api/s/{old}/sign", json={"name": "Late"}, timeout=HTTP_TIMEOUT), 410, "page_ended")
    empty = httpx.post(f"{app_url}/api/s/{new}/sign", json={"name": ""}, timeout=HTTP_TIMEOUT)
    want(empty, 422)
    assert error_message(empty) == "Type your name to sign off."
    newer = dossier_of(desk, world)
    replaced = httpx.post(f"{app_url}/api/s/{new}/sign", json={"name": "Inês Barros"}, timeout=HTTP_TIMEOUT)
    want(replaced, 409, "newer_dossier")
    assert error_message(replaced) == f"A newer dossier was made at {wall_time(newer['madeAt'])} Lisbon time. Read it first."
    want(desk.post(f"/api/dossiers/{dossier['id']}/sign-off-page"), 409)
    latest = token_of(want(desk.post(f"/api/dossiers/{newer['id']}/sign-off-page"), 201)["signOffAddress"], "s")
    signed = want(httpx.post(f"{app_url}/api/s/{latest}/sign", json={"name": "Inês Barros"}, timeout=HTTP_TIMEOUT), 200)
    assert signed["signedOffBy"] == "Inês Barros" and signed["state"] == "signedOff"
    twice = httpx.post(f"{app_url}/api/s/{latest}/sign", json={"name": "Other"}, timeout=HTTP_TIMEOUT)
    want(twice, 409, "conflict")
    assert error_message(twice) == "This dossier is already signed off."
    short = os.environ["APP_SHORT_URL"]
    quick = Desk.sign_up(short)
    far, _ = worked(quick)
    sent = want(quick.post(f"/api/dossiers/{dossier_of(quick, far)['id']}/sign-off-page"), 201)
    token = token_of(sent["signOffAddress"], "s")
    ends = parse_instant(sent["endsAt"])
    def step() -> bool:
        before_read = server_now(short)
        status = httpx.get(f"{short}/api/s/{token}", timeout=HTTP_TIMEOUT).status_code
        if before_read >= ends:
            assert status == 410, f"the page answered {status} at {before_read}, ending {ends}"
        return status == 410
    poll(step, "the sign-off page ended at its instant")


def test_results_file(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    label = make_label(desk)
    risky_name, risky_notes, risky_mill, plain_mill = "-Risky Tee", "=1+1", "@Mill", "Plain Mill"
    style = make_style(desk, label["id"], name=risky_name, notes=risky_notes)
    make_line(desk, style["id"], tier1={"factory": risky_mill, "town": "Izmir", "country": "TR"}, tier2={"factory": plain_mill, "town": "Izmir", "country": "TR"}, tier3=None)
    want(desk.post(f"/api/styles/{style['id']}/legs", {"mode": "road", "km": "3200"}), 201)
    older = want(desk.post(f"/api/styles/{style['id']}/results"), 201)
    newer = want(desk.post(f"/api/styles/{style['id']}/results"), 201)
    response = want_status(desk.get(f"/api/styles/{style['id']}/results-file"), 200)
    assert response.headers["content-type"].lower().replace(" ", "") == "text/csv; charset=utf-8".replace(" ", "")
    raw = response.content
    assert not raw.startswith(b"\xef\xbb\xbf") and raw.endswith(b"\r\n")
    assert raw.count(b"\r\n") == 3 and b"\n" not in raw.replace(b"\r\n", b"")
    lines = raw.decode("utf-8").split("\r\n")[:-1]
    columns = "style,gtin,label,suppliers,notes,edition,workedOutAt,climate,water,fossilEnergy,landUse,freshwaterToxicity,microfibres,dataQualityPercent,dataQualityGrade".split(",")
    assert lines[0] == ",".join(f'"{column}"' for column in columns)
    assert all(line.startswith('"') and line.endswith('"') for line in lines)
    rows = list(csv.DictReader(io.StringIO("\n".join(lines))))
    assert [row["workedOutAt"] for row in rows] == [newer["workedOutAt"], older["workedOutAt"]]
    first = rows[0]
    assert first["style"] == f"'{risky_name}" and first["notes"] == f"'{risky_notes}" and first["suppliers"] == f"'{risky_mill}; {plain_mill}"
    assert first["gtin"] == style["gtin"] and first["label"] == label["name"] and first["edition"] == "2027.1"
    assert first["climate"] == measure_of(newer, "climate")["totalShown"] and first["water"] == measure_of(newer, "water")["totalShown"]
    assert (first["dataQualityPercent"], first["dataQualityGrade"]) == ("0", "C")


def test_download_limit(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    dossier = dossier_of(desk, world)
    token = token_of(want(desk.post(f"/api/dossiers/{dossier['id']}/sign-off-page"), 201)["signOffAddress"], "s")
    for _ in range(3):
        assert httpx.get(f"{app_url}/api/s/{token}/file", timeout=HTTP_TIMEOUT).status_code == 200
    for path in (f"/api/dossiers/{dossier['id']}/file", f"/api/styles/{world.sid}/results-file") * 2 + (f"/api/dossiers/{dossier['id']}/file",):
        want_status(desk.get(path), 200)
    refused = desk.get(f"/api/styles/{world.sid}/results-file")
    want(refused, 429, "rate_limited")
    assert int(refused.headers["retry-after"]) > 0
    want(Desk.sign_in(app_url, desk.email).get(f"/api/dossiers/{dossier['id']}/file", headers={"X-Forwarded-For": "203.0.113.9"}), 429, "rate_limited")
    assert httpx.get(f"{app_url}/api/s/{token}/file", timeout=HTTP_TIMEOUT).status_code == 200
    other, _ = worked(Desk.sign_up(app_url))
    want_status(other.desk.get(f"/api/styles/{other.sid}/results-file"), 200)
    short = os.environ["APP_SHORT_URL"]
    quick, _ = worked(Desk.sign_up(short))
    for _ in range(DOWNLOAD_LIMIT):
        want_status(quick.desk.get(f"/api/styles/{quick.sid}/results-file"), 200)
    want(quick.desk.get(f"/api/styles/{quick.sid}/results-file"), 429, "rate_limited")
    poll(lambda: quick.desk.get(f"/api/styles/{quick.sid}/results-file").status_code == 200, "a new download window", SHORT_RATE_WINDOW + 15)


def test_close_and_bring_back(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    token = token_of(ask(world, language="en", supplier="Back Supplier")["answerAddress"])
    sign = token_of(want(desk.post(f"/api/dossiers/{dossier_of(desk, world)['id']}/sign-off-page"), 201)["signOffAddress"], "s")
    label_id = world.label["id"]
    before = (want(desk.get(f"/api/labels/{label_id}"), 200), world.fresh_style(), want(desk.get(f"/api/styles/{world.sid}/lines"), 200))
    closed = want(desk.post(f"/api/labels/{label_id}/close"), 200)
    assert closed["state"] == "closed"
    assert parse_instant(closed["eraseAt"]) == parse_instant(closed["closedAt"]) + timedelta(seconds=2592000)
    assert world.sid in [row["id"] for row in want(desk.get("/api/styles", params={"label": label_id}), 200)["styles"]]
    write = desk.patch(f"/api/styles/{world.sid}", {"washes": 1})
    want(write, 409, "conflict")
    assert error_message(write) == "This label is closed. Bring it back first."
    want(desk.post(f"/api/styles/{world.sid}/results"), 409, "conflict")
    want(page_get(app_url, token), 410, "page_ended")
    want(httpx.get(f"{app_url}/api/s/{sign}", timeout=HTTP_TIMEOUT), 410, "page_ended")
    want(desk.post(f"/api/labels/{label_id}/close"), 409)
    back = want(desk.post(f"/api/labels/{label_id}/bring-back"), 200)
    assert back == before[0] or {key: back[key] for key in ("id", "name", "contactName", "contactEmail", "state", "closedAt", "eraseAt")} == {key: before[0][key] for key in ("id", "name", "contactName", "contactEmail", "state", "closedAt", "eraseAt")}
    assert want(desk.get(f"/api/labels/{label_id}"), 200) == before[0]
    assert world.fresh_style() == before[1] and want(desk.get(f"/api/styles/{world.sid}/lines"), 200) == before[2]
    want(page_get(app_url, token), 200)
    want(httpx.get(f"{app_url}/api/s/{sign}", timeout=HTTP_TIMEOUT), 200)
    want(desk.post(f"/api/labels/{label_id}/bring-back"), 409)


def test_reminder_waits_for_bring_back(app_url: str, mail: Any) -> None:
    short = os.environ["APP_SHORT_URL"]
    desk = Desk.sign_up(short)
    world = harbour(desk)
    request = ask(world, language="en")
    want(desk.post(f"/api/labels/{world.label['id']}/close"), 200)
    due = parse_instant(request["sentAt"]) + timedelta(seconds=SHORT_REMINDER + 1)
    poll(lambda: server_now(short) >= due, "the reminder falling due while closed", 20)
    subject = MAIL_COPY["en"]["reminder"].format(label=world.label["name"])
    assert not [m for m in mails_now(mail, request["contactEmail"]) if m["Subject"] == subject]
    want(desk.post(f"/api/labels/{world.label['id']}/bring-back"), 200)
    poll(lambda: [m for m in mails_now(mail, request["contactEmail"]) if m["Subject"] == subject], "the reminder after bringing back", 15)


def test_label_erased(browser: Browser, app_url: str, wiremock: Any) -> None:
    short = os.environ["APP_SHORT_URL"]
    desk = Desk.sign_up(short)
    world, passport = published(desk)
    request = ask(world, language="en", supplier="Gone Supplier")
    token = token_of(request["answerAddress"])
    evidence = want(page_file(short, token, "e.pdf", PDF_BYTES), 201)
    dossier = dossier_of(desk, world)
    sign = token_of(want(desk.post(f"/api/dossiers/{dossier['id']}/sign-off-page"), 201)["signOffAddress"], "s")
    store = s3("-short")
    evidence_key = f"evidence/{desk.assessor['id']}/{request['id']}/{evidence['evidenceId']}"
    dossier_key = f"dossiers/{desk.assessor['id']}/{dossier['id']}.pdf"
    assert store.get(evidence_key) == PDF_BYTES
    label_id = world.label["id"]
    with ui(browser, short, f"/labels/{label_id}", desk=desk) as page:
        closed = want(desk.post(f"/api/labels/{label_id}/close"), 200)
        assert parse_instant(closed["eraseAt"]) == parse_instant(closed["closedAt"]) + timedelta(seconds=SHORT_CLOSURE)
        ends = parse_instant(closed["eraseAt"])
        def erased() -> bool:
            state = want(desk.get(f"/api/labels/{label_id}"), 200)["state"]
            if state == "erased":
                assert evidence_key not in store.keys(f"evidence/{desk.assessor['id']}/") and dossier_key not in store.keys(f"dossiers/{desk.assessor['id']}/"), "Erased showed before MinIO confirmed"
            return state == "erased"
        poll(erased, "the label reaching Erased")
        assert server_now(short) <= ends + timedelta(seconds=ERASE_WITHIN + 10)
        announced_erased = say(page)
        expect(announced_erased).to_contain_text(f"Label {world.label['name']} erased.", timeout=REFRESH_WAIT_MS)
    remains = want(desk.get(f"/api/labels/{label_id}"), 200)
    assert remains["state"] == "erased" and remains["name"] == world.label["name"] and remains["id"] == label_id
    assert not remains.get("contactName") and not remains.get("contactEmail") and not remains.get("suppliers")
    want(desk.post(f"/api/labels/{label_id}/bring-back"), 409)
    want(desk.get(f"/api/styles/{world.sid}"), 404, "not_found")
    want(page_get(short, token), 404, "not_found")
    want(httpx.get(f"{short}/api/s/{sign}", timeout=HTTP_TIMEOUT), 404, "not_found")
    want(desk.get(f"/api/evidence/{evidence['evidenceId']}/file"), 404, "not_found")
    want(httpx.get(f"{short}/api/passports/{passport['gtin']}", timeout=HTTP_TIMEOUT), 410, "withdrawn")
    assert world.sid not in [row["id"] for row in want(desk.get("/api/styles"), 200)["styles"]]
    assert httpx.get(f"{short}/a/{token}", timeout=HTTP_TIMEOUT).status_code == 404
    observer = pg("_short")
    for table in observer.tables():
        quoted = ".".join(f'"{part_name}"' for part_name in table.split("."))
        for secret in (request["contactEmail"], world.label["contactEmail"]):
            hits = observer.rows(f"SELECT 1 AS hit FROM {quoted} t WHERE t::text LIKE '%{secret}%' LIMIT 1")
            assert not hits, f"{secret} survives in {table}"


def test_exact_seed(app_url: str) -> None:
    marta = Desk.sign_in(app_url, "marta@fio-contado.example", "desk-pass-2027")
    assert marta.assessor["name"] == "Marta Quintela"
    labels = {row["name"]: row for row in want(marta.get("/api/labels"), 200)["labels"]}
    assert {name: (row["contactName"], row["contactEmail"], row["state"]) for name, row in labels.items()} == {"Maré Alta": ("Inês Barros", "ines@mare-alta.example", "open"), "Linho & Sal": ("Tomás Leite", "tomas@linho-sal.example", "open"), "Atelier Noroeste": ("Clara Pinto", "clara@atelier-noroeste.example", "open")}
    suppliers = {s["name"]: (name, s["town"], s["language"], s["contactName"], s["contactEmail"]) for name, row in labels.items() for s in want(marta.get(f"/api/labels/{row['id']}"), 200)["suppliers"]}
    assert suppliers == {"Yıldız İplik": ("Maré Alta", "izmir", "tr", "Ayşe Demir", "ayse@yildiz-iplik.example"), "Coton Bio Éthique": ("Maré Alta", "hoChiMinhCity", "fr", "Camille Nguyen", "camille@coton-bio.example"), "Fiação do Ave": ("Atelier Noroeste", "porto", "en", "Rui Matos", "rui@fiacao-ave.example"), "Nile Delta Weaving": ("Linho & Sal", "cairo", "ar", "Salma Hassan", "salma@nile-delta.example")}
    rows = {row["name"]: row for row in want(marta.get("/api/styles"), 200)["styles"]}
    assert {name: (row["styleCode"], row["labelName"], row["season"], row["gtin"], row["garment"], row["state"]) for name, row in rows.items()} == {"Harbour Tee": ("HT-01", "Maré Alta", "AW27", "4006381333931", "tshirt", "published"), "Quay Shirt": ("QS-01", "Maré Alta", "AW27", "5600000000014", "shirt", "worked"), "Estuary Coat": ("EC-01", "Atelier Noroeste", "AW27", "5600000000021", "coat", "worked"), "Delta Jeans": ("DJ-01", "Linho & Sal", "SS27", "5600000000038", "jeans", "draft")}
    archived = want(marta.get("/api/styles", params={"state": "archived"}), 200)["styles"]
    assert [(row["name"], row["gtin"], row["styleCode"]) for row in archived] == [("Ribeira Polo", "5600000000045", "RP-01")]
    tee = want(marta.get(f"/api/styles/{rows['Harbour Tee']['id']}"), 200)
    assert (tee["washes"], tee["repairService"], tee["rangeSize"], tee["notes"]) == (30, False, 100000, "Check dye house meter in spring.")
    assert (tee["score"]["state"], tee["score"]["score"], tee["score"]["per100g"], tee["score"]["runId"]) == ("current", 1240, 412, "run-seed")
    tee_results = want(marta.get(f"/api/styles/{tee['id']}/results"), 200)["results"]
    assert [(r["edition"], r["workedOutAt"], r["dataQualityGrade"], r["dataQualityPercent"]) for r in tee_results] == [("2027.1", "2026-09-15T09:00:00Z", "C", 0), ("2026.2", "2026-03-10T09:00:00Z", "C", 0)]
    assert measure_of(tee_results[0], "climate")["totalShown"] == "2.20 kg CO₂e" and Decimal(measure_of(tee_results[1], "climate")["total"]) == Decimal("2.2105")
    assert measure_of(tee_results[1], "climate")["totalShown"] == "2.21 kg CO₂e"
    quay = want(marta.get(f"/api/styles/{rows['Quay Shirt']['id']}/results"), 200)["results"]
    assert [(r["edition"], r["dataQualityGrade"], r["dataQualityPercent"]) for r in quay] == [("2026.2", "A", 100)] and Decimal(measure_of(quay[0], "climate")["total"]) == Decimal("2.11836")
    coat = want(marta.get(f"/api/styles/{rows['Estuary Coat']['id']}/results"), 200)["results"]
    assert [r["edition"] for r in coat] == ["2027.1"] and Decimal(measure_of(coat[0], "climate")["total"]) == Decimal("23.707284")
    assert want(marta.get(f"/api/styles/{rows['Delta Jeans']['id']}/results"), 200)["results"] == []
    lines = want(marta.get(f"/api/styles/{rows['Quay Shirt']['id']}/lines"), 200)["lines"]
    assert lines[0]["materialId"] == "linen" and lines[0]["answeredFacts"]["fibreOrigin"] == "VN"
    assert {(r["supplierName"], r["styleName"], r["state"]) for r in want(marta.get("/api/requests"), 200)["requests"]} == {("Yıldız İplik", "Harbour Tee", "ended"), ("Coton Bio Éthique", "Quay Shirt", "answered")}
    assert [(p["gtin"], p["edition"], p["state"], p["publishedAt"]) for p in want(marta.get("/api/passports"), 200)["passports"]] == [("4006381333931", 1, "published", "2026-09-20T10:00:00Z")]
    dossiers = want(marta.get(f"/api/styles/{tee['id']}/dossiers"), 200)["dossiers"]
    assert [(d["state"], d["signedOffBy"], d["signedOffAt"], d["resultId"]) for d in dossiers] == [("signedOff", "Inês Barros", "2026-09-22T15:00:00Z", tee_results[0]["id"])]
    poll(lambda: s3().keys(f"dossiers/{marta.assessor['id']}/"), "the seed dossier PDF in MinIO", 30)
    visits = sorted(want(marta.get("/api/visits"), 200)["visits"], key=lambda v: v["localDate"])
    assert len(visits) == 2 and all((v["factoryName"], v["town"], v["localTime"], v["labelId"]) == ("Yıldız İplik", "izmir", "07:20", labels["Maré Alta"]["id"]) for v in visits)
    friday, monday = [datetime.strptime(v["localDate"], "%Y-%m-%d") for v in visits]
    assert friday.weekday() == 4 and monday - friday == timedelta(days=3)
    assert wall_time(visits[0]["at"]) != wall_time(visits[1]["at"]), "the visits sit each side of a clock change"
    assert all(want(marta.get(f"/api/visits/{v['id']}"), 200)["readings"] == [] for v in visits)
    iris = Desk.sign_in(app_url, "iris@fio-contado.example", "desk-pass-2027")
    assert iris.assessor["name"] == "Iris Vandeputte"
    assert [(r["name"], r["contactName"], r["contactEmail"]) for r in want(iris.get("/api/labels"), 200)["labels"]] == [("Kade Studio", "Jef Maes", "jef@kade-studio.example")]
    assert [(r["name"], r["season"], r["gtin"], r["garment"], r["state"]) for r in want(iris.get("/api/styles"), 200)["styles"]] == [("Kade Overshirt", "AW27", "5600000000069", "shirt", "draft")]
    assert want(iris.get("/api/requests"), 200)["requests"] == [] and want(iris.get("/api/visits"), 200)["visits"] == [] and want(iris.get("/api/passports"), 200)["passports"] == []
    fresh_desk = Desk.sign_up(app_url)
    assert want(fresh_desk.get("/api/styles"), 200)["styles"] == [] and want(fresh_desk.get("/api/labels"), 200)["labels"] == []


SWEEP_MAIN = {"styles": "New style", "style": "Work out footprint", "materials": "Add material", "scenarios": "Save scenario", "labels": "New label", "label": "Rename label", "requests": "New request", "visits": "Book visit", "visit": "Record reading", "passports": None, "answer": "Next", "signoff": "Sign off"}
SWEEP_DIALOG = {"styles": "New style", "materials": "Add material", "scenarios": "Save scenario", "labels": "New label", "label": "Rename label", "requests": "New request", "visits": "Book visit"}
TEXT_SPACING = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }"


def sweep_world(base: str) -> tuple[Desk, dict[str, str]]:
    desk = Desk.sign_up(base)
    long_label = "L" + uuid.uuid4().hex + "x" * 47
    long_style = "S" + uuid.uuid4().hex + "y" * 47
    label = make_label(desk, long_label)
    style = make_style(desk, label["id"], name=long_style)
    line = make_line(desk, style["id"])
    want(desk.post(f"/api/styles/{style['id']}/legs", {"mode": "road", "km": "3200"}), 201)
    world = World(desk, label, style, line)
    want(desk.post(f"/api/styles/{style['id']}/results"), 201)
    want(desk.post(f"/api/styles/{style['id']}/score"), 200)
    want(desk.post(f"/api/styles/{style['id']}/passport"), 201)
    request = ask(world, language="en")
    visit = book(desk, label["id"])
    sign = want(desk.post(f"/api/dossiers/{dossier_of(desk, world)['id']}/sign-off-page"), 201)
    return desk, {"styles": "/styles", "style": f"/styles/{style['id']}", "materials": f"/styles/{style['id']}/materials", "scenarios": f"/styles/{style['id']}/scenarios", "labels": "/labels", "label": f"/labels/{label['id']}", "requests": "/requests", "visits": "/visits", "visit": f"/visits/{visit['id']}", "passports": "/passports", "answer": f"/a/{token_of(request['answerAddress'])}", "signoff": f"/s/{token_of(sign['signOffAddress'], 's')}"}

def arrived(page: Page, arrive: Callable[[Page], None] | None) -> None:
    if arrive:
        arrive(page)
    expect(h1(page)).to_be_visible()
    loaded(page)
    settled(page)


def sweep(browser: Browser, base: str, desk: Desk | None, path: str, main: Callable[[Page], Locator] | None = None, opener: str | None = None, arrive: Callable[[Page], None] | None = None) -> None:
    with ui(browser, base, path, desk=desk, view=PHONE, touch=True) as page:
        arrived(page, arrive)
        layout(page)
        touch_targets(page)
        axe(page)
        no_cut_text(page)
        if main:
            fixed_bottom(main(page), PHONE)
        spaced(page)
        no_cut_text(page)
        if opener:
            click(button(page, opener))
            expect(dialog(page, opener)).to_be_visible()
            settled(page)
            axe(page)
            touch_targets(page)
    with ui(browser, base, path, desk=desk) as page:
        arrived(page, arrive)
        axe(page)
        no_cut_text(page)
        plain = printed(page)
        spaced(page)
        no_cut_text(page)
    with ui(browser, base, path, desk=desk, locale="de-DE", zone="Pacific/Auckland", ahead=timedelta(days=3)) as page:
        arrived(page, arrive)
        poll(lambda: printed(page) == plain, "SR14: the same visible text in another language, zone and clock", PRINT_WAIT_S)
    with ui(browser, base, path, desk=desk, view=SMALL, touch=True) as page:
        arrived(page, arrive)
        assert page.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth"), "SR15: sideways scroll at 320x568"
    with ui(browser, base, path, desk=desk, view=LANDSCAPE, touch=True) as page:
        arrived(page, arrive)
        if opener:
            click(button(page, opener))
            expect(dialog(page, opener)).to_be_visible()
            settled(page)
        for _ in range(14):
            page.keyboard.press("Tab")
            unobscured(page)


def sweep_for(browser: Browser, base: str, *keys: str) -> None:
    desk, routes = sweep_world(base)
    for key in keys:
        name = SWEEP_MAIN[key]
        sweep(browser, base, desk, routes[key], (lambda page, name=name: button(page, name)) if name else None, SWEEP_DIALOG.get(key))


@pytest.mark.parametrize("case", list(SWEEP_MAIN), ids=list(SWEEP_MAIN))
def test_route_sweep(browser: Browser, app_url: str, wiremock: Any, case: str) -> None:
    sweep_for(browser, app_url, case)


def test_motion_system(browser: Browser, app_url: str, wiremock: Any) -> None:
    with ui(browser, app_url, "/") as page:
        poll(lambda: intro_over(page), "the intro ending with focus on the level-one heading", (INTRO_MS + INTRO_LATE_MS) / 1000)
        click(button(page, "Explore"))
        page.keyboard.press("Escape")
        check(page.get_by_role("radio", name="Jeans"))
        announced(page, "3.22 kg CO₂e")
        settled(page)
        public = set(motion_log(page))
        assert {160, 320, 640} & public and public <= MOTION_MS, public
    desk = Desk.sign_up(app_url)
    world, _ = worked(desk)
    with ui(browser, app_url, f"/styles/{world.sid}", desk=desk) as page:
        pick(page.get_by_role("radio", name="Fossil energy"))
        expect(part(page, "hotspot-marker")).to_have_attribute("data-stage", "use")
        settled(page)
        click(staged(page, "stratum", "making"))
        expect(dialog(page, "Factors for Making")).to_be_visible()
        page.keyboard.press("Escape")
        settled(page)
        working = set(motion_log(page))
        assert {320, 640} <= working and working <= MOTION_MS, working
        page.emulate_media(reduced_motion="reduce")
        clear_motion(page)
        pick(page.get_by_role("radio", name="Water", exact=True))
        announced(page, "Water: 1,140 L, hotspot Materials.")
        assert not motion_log(page), "SR21 reduced motion applies with no reload"


def test_addresses_and_menu_sheet(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    label_name, factory = fresh("Porto Knit"), fresh("Ege Dokuma")
    first_label = make_label(desk)
    make_style(desk, first_label["id"])
    book(desk, first_label["id"])
    with ui(browser, app_url, "/labels", desk=desk) as page:
        click(button(page, "New label"))
        panel = dialog(page, "New label")
        fill(panel.get_by_role("textbox", name="Name", exact=True), label_name)
        fill(panel.get_by_role("textbox", name="Contact name"), "Rita Lopes")
        fill(panel.get_by_role("textbox", name="Contact email"), "rita@porto-knit.example")
        click(button(panel, "Save label"))
        expect(page).to_have_url(re.compile(r"/labels/[^/]+$"))
        expect(h1(page)).to_be_focused()
        expect(h1(page)).to_have_text(label_name)
        expect(page).to_have_title(label_name + TITLE_TAIL)
        announced(page, f"Label {label_name} added.")
        page.reload()
        expect(h1(page)).to_have_text(label_name)
        page.goto(f"{app_url}/visits")
        click(button(page, "Book visit"))
        panel = dialog(page, "Book visit")
        fill(labelled(panel, "Factory"), factory)
        select(labelled(panel, "Label"), label_name)
        select(labelled(panel, "Town"), "Izmir")
        fill(labelled(panel, "Date"), "2027-03-29")
        fill(labelled(panel, "Local time"), "07:20")
        click(button(panel, "Save visit"))
        expect(page).to_have_url(re.compile(r"/visits/[^/]+$"))
        expect(h1(page)).to_have_text(f"Visit to {factory}")
        expect(h1(page)).to_be_focused()
        expect(page).to_have_title(f"Visit to {factory}{TITLE_TAIL}")
        page.goto(f"{app_url}/styles")
        click(button(page, "New style"))
        panel = dialog(page, "New style")
        style_name = fresh("Tee")
        fill_style_dialog(panel, label_name, style_name)
        click(button(panel, "Save style"))
        expect(page).to_have_url(re.compile(r"/styles/[^/]+$"))
        expect(h1(page)).to_be_focused()
        expect(page).to_have_title(style_name + TITLE_TAIL)
        page.goto(page.url + "/materials")
        expect(h1(page)).to_have_text(f"Materials for {style_name}")
        for link in ("Styles", "Labels", "Requests", "Visits", "Passports"):
            expect(page.get_by_role("link", name=link, exact=True)).to_be_visible()
        expect(button(page, "Sign out")).to_be_visible()
        expect(button(page, "Menu")).to_have_count(0)
    for view in ((1099, 800), (1024, 768), TABLET, PHONE):
        with ui(browser, app_url, "/styles", desk=desk, view=view) as page:
            expect(h1(page)).to_be_visible()
            names = tab_order(page, 8)
            for hidden in ("Passports", "Sign out"):
                assert hidden not in names, f"closed Menu control {hidden} in the Tab order at {view}"
            expect(page.get_by_role("link", name="Passports")).to_have_count(0)
            opener = button(page, "Menu")
            click(opener)
            sheet = dialog(page, "Menu")
            expect(sheet.get_by_role("link", name="Passports")).to_be_visible()
            expect(button(sheet, "Sign out")).to_be_visible()
            page.keyboard.press("Escape")
            expect(opener).to_be_focused()
            settled(page)
            expect(page.get_by_role("link", name="Passports")).to_have_count(0)
    with ui(browser, app_url, "/passports") as page:
        expect(page).to_have_url(re.compile(r"/sign-in\?next="))


def test_session_ends_mid_form(browser: Browser, app_url: str) -> None:
    base = os.environ["APP_SESSION_URL"]
    desk = Desk.sign_up(base)
    make_label(desk)
    label_name = fresh("Draft Label")
    with ui(browser, base, "/labels", desk=desk) as page:
        click(button(page, "New label"))
        panel = dialog(page, "New label")
        fill(panel.get_by_role("textbox", name="Name", exact=True), label_name)
        poll(lambda: desk.get("/api/session").status_code == 401, "the 20-second session ending")
        want(desk.get("/api/session"), 401, "session_ended")
        click(button(panel, "Save label"))
        announced(page, "Your session ended. Sign in again to keep going — what you typed is still here.")
        expect(panel).to_be_visible()
        expect(panel.get_by_role("textbox", name="Name", exact=True)).to_have_value(label_name)
        click(page.get_by_role("link", name="Sign in again"))
        expect(page).to_have_url(re.compile(r"/sign-in"))
        fill(page.get_by_role("textbox", name="Email"), desk.email)
        fill(labelled(page, "Password"), PASSWORD)
        click(button(page, "Sign in"))
        expect(page).to_have_url(re.compile(r"/labels$"))
        reopened = dialog(page, "New label")
        expect(reopened).to_be_visible()
        expect(reopened.get_by_role("textbox", name="Name", exact=True)).to_have_value(label_name)
    assert label_name not in [row["name"] for row in want(Desk.sign_in(base, desk.email).get("/api/labels"), 200)["labels"]], "the refused save stored a label"


def snake_or_bad(value: Any, path: str = "") -> list[str]:
    bad: list[str] = []
    if isinstance(value, dict):
        for key, inner in value.items():
            if key == "fields":
                continue
            if not re.fullmatch(r"[a-z][a-zA-Z0-9]*", key):
                bad.append(f"{path}.{key}")
            if (key.endswith("At") or key == "busyUntil") and inner is not None and not INSTANT.match(str(inner)):
                bad.append(f"{path}.{key}={inner}")
            bad += snake_or_bad(inner, f"{path}.{key}")
    elif isinstance(value, list):
        for index, inner in enumerate(value):
            bad += snake_or_bad(inner, f"{path}[{index}]")
    return bad


def test_one_api_convention(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, result = scored(desk)
    style = world.sid
    want(desk.post(f"/api/styles/{style}/passport"), 201)
    for path in ("/api/session", "/api/labels", f"/api/labels/{world.label['id']}", "/api/styles", f"/api/styles/{style}", f"/api/styles/{style}/lines", f"/api/styles/{style}/results", "/api/passports", "/api/requests", "/api/visits", f"/api/passports/{world.style['gtin']}"):
        assert not snake_or_bad(want(desk.get(path), 200)), path
    assert want(httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT), 200) == {"status": "ok"}
    session_cookie_published(desk.raw_cookie)
    oversized = {"content": b" " * (BODY_LIMIT + 1), "headers": {"Content-Type": "application/json"}, "timeout": HTTP_TIMEOUT}
    want(httpx.get(f"{app_url}/api/nope", timeout=HTTP_TIMEOUT), 404, "not_found")
    want(httpx.post(f"{app_url}/api/nope", **oversized), 404, "not_found")
    wrong = httpx.put(f"{app_url}/api/labels", **oversized)
    want(wrong, 405, "method_not_allowed")
    assert "GET" in wrong.headers["allow"] and "POST" in wrong.headers["allow"]
    want(httpx.post(f"{app_url}/api/labels", **oversized), 413, "too_large")
    want(httpx.post(f"{app_url}/api/labels", content=b"name", headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT), 401, "not_signed_in")
    want(desk.call("PATCH", f"/api/styles/{UNKNOWN_ID}", content=b"{bad", headers={"Content-Type": "text/plain"}), 404, "not_found")
    want(desk.call("PATCH", f"/api/styles/{style}", content=b"{bad", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    want(desk.call("PATCH", f"/api/styles/{style}", content=b"{bad", headers={"Content-Type": "application/json"}), 400, "malformed_json")
    invalid = desk.patch(f"/api/styles/{style}", {"name": ""})
    want(invalid, 422, "validation_failed")
    assert set(invalid.json()) == {"error"} and error_message(invalid) == invalid.json()["error"]["fields"]["name"]
    assert "fields" not in desk.get(f"/api/styles/{UNKNOWN_ID}").json()["error"]
    archived = make_style(desk, world.label["id"])
    want(desk.patch(f"/api/styles/{archived['id']}", {"washes": 31}), 200)
    want(desk.post(f"/api/styles/{archived['id']}/archive"), 200)
    want(desk.patch(f"/api/styles/{archived['id']}", {"name": ""}), 422, "validation_failed")
    want(desk.patch(f"/api/styles/{archived['id']}", {"name": "Fine", "baseVersion": archived["version"]}), 409, "conflict")
    padded = json.dumps({"name": fresh("Full"), "contactName": "R", "contactEmail": "r@example.test"}).encode()
    want(desk.post("/api/labels", content=padded + b" " * (BODY_LIMIT - len(padded)), headers={"Content-Type": "application/json"}), 201)
    want(desk.post("/api/labels", content=padded + b" " * (BODY_LIMIT - len(padded) + 1), headers={"Content-Type": "application/json"}), 413, "too_large")
    want(desk.post(f"/api/labels/{world.label['id']}/catalogue/preview", content=b"x", headers={"Content-Type": "application/json"}), 415)
    wiremock.fault("GET", "/v2/editions")
    wiremock.fault("POST", SCORE_PATH)
    for response, code in ((desk.post(f"/api/styles/{style}/results"), "factor_library_unavailable"), (desk.post("/api/factors/check"), "factor_library_unavailable")):
        want(response, 503, code)
    assert result["id"] == want(desk.get(f"/api/styles/{style}"), 200)["latestResult"]["id"]


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[key], str) and manifest[key] for key in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [package.name for package in shipped_packages() if package.name not in notices]
    assert not missing, missing
    for font in ("Sora", "Noto Sans Arabic", "Noto Sans"):
        assert squeezed_name(font) in squeezed_name(notices), font


def test_if_licences() -> None:
    allowed = {"MIT", "MIT-0", "Apache-2.0", "BSD", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "ISC", "OFL-1.0", "OFL-1.1", "BlueOak-1.0.0"}
    refused = [(package.name, package.licence) for package in shipped_packages() if not licence_allowed(package.licence, allowed)]
    assert not refused, refused


def test_if_no_other_datastore() -> None:
    others = {"redis", "ioredis", "mongodb", "mongoose", "sqlite3", "better-sqlite3", "mysql", "mysql2", "memcached", "cassandra-driver"}
    assert not [package.name for package in shipped_packages() if package.name in others]


def test_if_same_origin_only(browser: Browser, app_url: str) -> None:
    desk = Desk.sign_up(app_url)
    make_label(desk)
    with ui(browser, app_url, None, desk=desk) as page:
        seen: list[str] = []
        page.on("request", lambda request: seen.append(request.url))
        for path in ("/", "/method", "/questions", "/styles", "/labels", "/requests"):
            page.goto(app_url + path)
            expect(h1(page)).to_be_visible()
        foreign = [url for url in seen if url.startswith("http") and not same_origin(url, app_url)]
        assert not foreign, foreign


def test_if_wiremock_untouched(app_url: str, wiremock: Any) -> None:
    desk = Desk.sign_up(app_url)
    world, result = worked(desk)
    want(desk.post(f"/api/styles/{world.sid}/score"), 200)
    assert result["edition"] == "2027.1"
    urls = [wm_url(entry) for entry in wiremock.requests()]
    assert urls
    assert all(urlparse(url).path in ("/v2/editions", "/v2/factors", SCORE_PATH) for url in urls), urls
