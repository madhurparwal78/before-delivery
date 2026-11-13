"""Recovery without restart, in one process.

The pool is pointed at an address nothing listens on, then back at the real
database; the app answers the outage and then serves again with no restart,
and the seed is applied exactly once.
"""

import db
import wsgi


def test_outage_then_recovery_without_restart(client):
    # the app serves normally
    assert client.get("/api/health").status_code == 200

    # Postgres becomes unreachable: every database route answers the outage
    real_url = db.DATABASE_URL
    db.DATABASE_URL = "postgresql://nobody:nobody@127.0.0.1:59999/nothing"
    db.reset_pool()
    try:
        health = client.get("/api/health")
        assert health.status_code == 503
        assert health.get_json() == {"status": "starting"}
        response = client.get("/api/references")
        assert response.status_code == 503
        assert response.get_json() == {
            "message": "The reference desk is unavailable right now"}
        page = client.get("/programme")
        assert page.status_code == 503
        assert b"The reference desk is unavailable right now" in page.data
        fi_page = client.get("/fi/contact")
        assert fi_page.status_code == 503
        assert ("Referenssitoimisto ei ole juuri nyt käytettävissä"
                .encode() in fi_page.data)
        # unknown paths keep their answers, and the desk page keeps answering
        assert client.get("/api/nope").status_code == 404
        assert client.get("/no-such").status_code == 404
        assert client.get("/desk").status_code == 200
    finally:
        db.DATABASE_URL = real_url

    # Postgres returns: the first request after health reports ok succeeds,
    # with no app restart, and the seed was not re-applied
    db.reset_pool()
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.get_json() == {"status": "ok"}
    references = client.get("/api/references")
    assert references.status_code == 200
    slugs = [row["slug"] for row in references.get_json()]
    assert slugs == ["harbour-crane-retrofit", "dairy-line-rebuild",
                     "paper-mill-drive-swap"]

    def count_rows(table):
        def work(conn):
            with conn.cursor() as cur:
                cur.execute(f"SELECT count(*) AS n FROM {table}")
                return cur.fetchone()["n"]
        return db.run(work)

    assert count_rows("account") == 3
    assert count_rows("reference_entry") == 6
    assert count_rows("service_clock") == 1
