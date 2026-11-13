"""Outage behaviour: a server whose Postgres is unreachable.

This suite runs the real app in a subprocess against an address nothing
listens on, so it exercises the boot retry, the starting 503, the published
outage page and recovery without touching the dev Postgres service.
"""

import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def fetch(port, path, timeout=8):
    url = f"http://127.0.0.1:{port}{path}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


@pytest.fixture(scope="module")
def cut_off_server():
    """A server whose DATABASE_URL points at a port nothing listens on."""
    port = free_port()
    dead = free_port()
    env = dict(os.environ)
    env["DATABASE_URL"] = f"postgresql://nobody:nobody@127.0.0.1:{dead}/nothing"
    env["APP_PUBLIC_PORT"] = str(port)
    process = subprocess.Popen(
        [sys.executable, "-m", "gunicorn", "--bind", f"127.0.0.1:{port}",
         "--workers", "1", "--timeout", "30", "wsgi:app"],
        cwd=REPO, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    # wait for the listener
    for _ in range(60):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.5)
    yield port
    process.send_signal(signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def test_health_answers_starting_while_postgres_absent(cut_off_server):
    status, body = fetch(cut_off_server, "/api/health")
    assert status == 503
    assert b'"starting"' in body


def test_api_routes_answer_the_published_outage(cut_off_server):
    for path in ("/api/references", "/api/references/harbour-crane-retrofit",
                 "/api/sectors", "/api/notes", "/api/fi/references"):
        status, body = fetch(cut_off_server, path)
        assert status == 503, (path, status)
        assert b'{"message":"The reference desk is unavailable right now"}' == body
    # a desk call reports the same outage shape
    status, body = fetch(cut_off_server, "/api/desk/references")
    assert status == 503
    assert b"unavailable right now" in body


def test_pages_answer_the_outage_page(cut_off_server):
    for path in ("/", "/references", "/programme", "/story", "/contact"):
        status, body = fetch(cut_off_server, path)
        assert status == 503, (path, status)
        assert b"The reference desk is unavailable right now" in body
    for path in ("/fi", "/fi/references", "/fi/contact"):
        status, body = fetch(cut_off_server, path)
        assert status == 503, (path, status)
        assert "Referenssitoimisto ei ole juuri nyt käytettävissä".encode() in body


def test_what_keeps_working(cut_off_server):
    # unknown api paths keep the JSON 404
    status, body = fetch(cut_off_server, "/api/nope")
    assert status == 404
    assert body == b'{"message":"Not found"}'
    # unknown pages keep the not-found page
    status, body = fetch(cut_off_server, "/no-such")
    assert status == 404
    # /desk keeps answering 200
    status, body = fetch(cut_off_server, "/desk")
    assert status == 200
    # a 405 keeps its answer
    request = urllib.request.Request(
        f"http://127.0.0.1:{cut_off_server}/references", method="POST")
    try:
        urllib.request.urlopen(request, timeout=8)
        raise AssertionError("expected 405")
    except urllib.error.HTTPError as error:
        assert error.code == 405
        assert "GET" in error.headers["Allow"]
