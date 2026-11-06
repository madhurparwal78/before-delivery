#!/usr/bin/env python3
"""Download Google Fonts variable woff2 files."""
import re, urllib.request

UA = "Mozilla/5.0"

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=60).read()

def css_for(family):
    q = family.replace(" ", "+")
    return fetch("https://fonts.googleapis.com/css2?family=%s:wght@100..900&display=swap" % q).decode()

targets = [
    ("Fraunces", "fraunces-var.woff2"),
    ("Hanken Grotesk", "hanken-var.woff2"),
]
for family, out in targets:
    css = css_for(family)
    urls = re.findall(r"url\((https://fonts\.gstatic\.com/[^)]+)\)", css)
    if urls:
        data = fetch(urls[-1])
        open("/app/public-static/fonts/" + out, "wb").write(data)
        print(family, "wrote", out, len(data))
    else:
        print(family, "NO URLS", css[:200])
