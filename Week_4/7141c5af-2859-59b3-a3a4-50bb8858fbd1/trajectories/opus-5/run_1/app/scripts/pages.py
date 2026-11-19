#!/usr/bin/env python3
"""Reads the server's first response for each page. Verification only."""
import re
import json
import urllib.request
import urllib.error
import http.cookiejar

BASE = "http://127.0.0.1:4173"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def get(path, follow=True):
    req = urllib.request.Request(BASE + path)
    try:
        if not follow:
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *a):
                    return None
            o = urllib.request.build_opener(NoRedirect, urllib.request.HTTPCookieProcessor(jar))
            with o.open(req, timeout=20) as r:
                return r.status, r.read().decode(), dict(r.headers)
        with opener.open(req, timeout=20) as r:
            return r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), dict(e.headers)


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    with opener.open(req, timeout=20) as r:
        return json.loads(r.read().decode())


def parts(html):
    title = re.search(r"<title>(.*?)</title>", html, re.S)
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S)
    lang = re.search(r'<html lang="([^"]*)" dir="([^"]*)"', html)
    return (
        title.group(1) if title else None,
        re.sub(r"\s+", " ", h1.group(1)).strip() if h1 else None,
        lang.groups() if lang else None,
    )


print("== public pages, first response ==")
for path in ["/", "/work", "/work?kind=leather", "/work/bentwood-armchair", "/work/slat-bench",
             "/enquire", "/sign-in", "/sign-up", "/nope", "/work/nope"]:
    status, html, _ = get(path)
    title, h1, lang = parts(html)
    print(f"{status} {path:34} title={title!r:46} h1={h1!r}")

status, html, _ = get("/")
print("\nhome line present:", "A conservator's desk in Turin" in html)
print("home headline:", "ONE CHAIR AT A TIME." in html)
print("mint tile figure:", "38.75 sq ft" in html)
status, html, _ = get("/work/bentwood-armchair")
print("case rail numbers:", re.findall(r'data-rail="([^"]+)"', html))
print("case sections:", re.findall(r'<h2 id="([^"]+)"', html))
print("shared drawing:", re.findall(r'data-part="case-drawing" data-case="([^"]+)" data-hero="([^"]+)"', html))
status, html, _ = get("/work?kind=fabric")
print("fabric filter shows:", re.findall(r'data-case-link="([^"]+)"', html))

print("\n== signed-out desk page ==")
status, _, headers = get("/pieces", follow=False)
print(status, headers.get("Location") or headers.get("location"))
status, _, headers = get("/pieces/1/condition", follow=False)
print(status, headers.get("Location") or headers.get("location"))

print("\n== signed-in desk pages ==")
post("/api/session", {"email": "agnese@bottega-semenza.example", "password": "tacks-and-hide-2027"})
for path in ["/pieces", "/pieces/1", "/pieces/1/condition", "/pieces/1/hide", "/pieces/1/estimate",
             "/pieces/1/collection", "/pieces/1/dossier", "/pieces/1/photographs",
             "/clients", "/clients/1", "/library", "/bench", "/workbook", "/rates",
             "/pieces/8", "/pieces/9999"]:
    status, html, _ = get(path)
    title, h1, _ = parts(html)
    print(f"{status} {path:26} title={title!r:46} h1={h1!r}")

print("\n== client page in four languages ==")
for piece, lang in [("1", "it"), ("2", "en"), ("4", "ja"), ("5", "ar")]:
    page = post(f"/api/pieces/{piece}/client-page", {})
    token = page["clientPage"]["address"].rsplit("/", 1)[-1]
    status, html, _ = get(f"/c/{token}")
    title, h1, langdir = parts(html)
    english_left = any(
        word in html for word in ["Your answer", "Before and after", "Your full name",
                                  "Condition notes", "No estimate yet."]
    ) if lang != "en" else False
    print(f"{status} {lang} lang/dir={langdir} h1={h1!r} title={title!r} englishLeft={english_left}")

print("\n== ended client page ==")
page = post("/api/pieces/1/client-page", {})
token = page["clientPage"]["address"].rsplit("/", 1)[-1]
urllib.request.Request(BASE)
req = urllib.request.Request(BASE + "/api/pieces/1/client-page", method="DELETE")
opener.open(req, timeout=20)
status, html, _ = get(f"/c/{token}")
title, h1, langdir = parts(html)
print(status, langdir, repr(h1), "C20 present:", "Questa pagina \u00e8 scaduta." in html)
status, html, _ = get("/c/unknown-token")
print("unknown token:", status, parts(html)[1])
