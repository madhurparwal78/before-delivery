"""Test fixtures: each test starts from the seeded store."""

import db
import pytest

import wsgi

SEED_SLUGS = ("harbour-crane-retrofit", "dairy-line-rebuild",
               "paper-mill-drive-swap", "rail-depot-signalling",
               "quarry-conveyor-upgrade")


def reset_store():
    """Bring the store back to the seed: no test sees another's writes."""
    def work(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM preview_link")
            cur.execute("DELETE FROM slug_redirect")
            cur.execute("DELETE FROM figure")
            cur.execute("DELETE FROM enquiry")
            cur.execute("DELETE FROM session")
            cur.execute("DELETE FROM reference_entry")
            cur.execute("DELETE FROM note")
            cur.execute("DELETE FROM service_clock")
            cur.execute("DELETE FROM seed_marker")
        conn.commit()
    db.run(work)
    wsgi._ready.clear()
    wsgi._ensure_boot()


@pytest.fixture()
def client():
    wsgi._ready.clear()
    wsgi._ensure_boot()
    yield wsgi.app.test_client()
    reset_store()


@pytest.fixture(autouse=True)
def reset_after(request):
    yield
    if "client" not in request.fixturenames:
        reset_store()
