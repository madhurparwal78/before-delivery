"""Sign a person in through the realm's own page, as a browser would."""
from __future__ import annotations

import html
import os
import re

import httpx

BASE = f"http://127.0.0.1:{os.environ.get('APP_PUBLIC_PORT', '4173')}"
FORM_ACTION = re.compile(r'<form[^>]+id="kc-form-login"[^>]+action="([^"]+)"')


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=BASE, follow_redirects=False, timeout=20)


async def sign_in(
    session: httpx.AsyncClient, email: str, password: str, next_path: str | None = None
) -> httpx.Response:
    """Returns the response of the callback redirect."""
    target = "/auth/login" + (f"?next={next_path}" if next_path else "")
    start = await session.get(target)
    assert start.status_code == 302, (start.status_code, start.text[:300])
    realm_page = await session.get(start.headers["location"])
    assert realm_page.status_code == 200, realm_page.status_code
    match = FORM_ACTION.search(realm_page.text)
    assert match, realm_page.text[:600]
    posted = await session.post(
        html.unescape(match.group(1)),
        data={"username": email, "password": password, "credentialId": ""},
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert posted.status_code in (302, 303), (posted.status_code, posted.text[:400])
    return await session.get(posted.headers["location"])


async def prepare(
    session: httpx.AsyncClient, email: str, password: str, next_path: str | None = None
) -> str:
    """Take a sign-in up to, but not including, the callback. Returns the callback URL."""
    target = "/auth/login" + (f"?next={next_path}" if next_path else "")
    start = await session.get(target)
    realm_page = await session.get(start.headers["location"])
    if realm_page.status_code in (302, 303):
        return realm_page.headers["location"]
    match = FORM_ACTION.search(realm_page.text)
    assert match, realm_page.text[:600]
    posted = await session.post(
        html.unescape(match.group(1)),
        data={"username": email, "password": password, "credentialId": ""},
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert posted.status_code in (302, 303), (posted.status_code, posted.text[:300])
    return posted.headers["location"]


async def choose_password(
    session: httpx.AsyncClient, email: str, temporary_password: str, new_password: str
) -> httpx.Response:
    """Sign in with a temporary password and answer the realm's update-password screen."""
    target = "/auth/login"
    start = await session.get(target)
    realm_page = await session.get(start.headers["location"])
    match = FORM_ACTION.search(realm_page.text)
    assert match, realm_page.text[:600]
    posted = await session.post(
        html.unescape(match.group(1)),
        data={"username": email, "password": temporary_password, "credentialId": ""},
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    while posted.status_code in (302, 303):
        posted = await session.get(posted.headers["location"])
    assert posted.status_code == 200, (posted.status_code, posted.text[:300])
    form = re.search(r'<form[^>]+action="([^"]+)"', posted.text)
    assert form, posted.text[:800]
    updated = await session.post(
        html.unescape(form.group(1)),
        data={"password-new": new_password, "password-confirm": new_password},
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert updated.status_code in (302, 303), (updated.status_code, updated.text[:400])
    return await session.get(updated.headers["location"])
