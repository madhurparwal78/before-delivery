"""Page tests: the public surfaces, the Finnish mirror and the desk page."""

import re

import wsgi

from conftest import reset_store


def get(client, path):
    return client.get(path)


def test_home_page(client):
    response = client.get("/")
    html = response.get_text() if hasattr(response, "get_text") else response.data.decode()
    assert response.status_code == 200
    assert "References you can check, from installations we actually finished" in html
    assert "Every story here is published with the customer's written agreement" in html
    assert 'href="/contact"' in html and "Start an enquiry" in html
    assert 'href="/references"' in html and "Read the references" in html
    # the featured strip holds the first three live references
    assert "Harbour crane retrofit" in html
    assert "Dairy line rebuild" in html
    assert "Paper mill drive swap" in html
    # three service panels
    assert "Nominate an installation" in html
    assert "The customer clears the story" in html
    assert "Ask for a reference call" in html
    assert 'aria-label="Primary"' in html
    assert 'Skip to content' in html


def test_reference_index_page(client):
    response = client.get("/references")
    html = response.data.decode()
    assert response.status_code == 200
    assert "The reference library" in html
    assert "3 cleared references" in html
    # the sector filter holds live sectors only, in alphabetical order
    filter_nav = re.search(r'aria-label="Sectors"(.*?)</nav>', html, re.S).group(1)
    assert "All sectors" in filter_nav
    positions = [filter_nav.index(s) for s in ("food", "ports", "pulp")]
    assert positions == sorted(positions)
    assert "rail" not in filter_nav and "mining" not in filter_nav
    # one row per live reference, links naming the title
    assert html.count("index-row") == 3
    assert 'aria-current="true"' in html  # All sectors when unfiltered


def test_filtered_index_and_empty_state(client):
    response = client.get("/references?sector=food")
    html = response.data.decode()
    assert "1 cleared reference in food" in html
    assert "Dairy line rebuild" in html
    assert "Harbour crane retrofit" not in html
    response = client.get("/references?sector=nosuch")
    html = response.data.decode()
    assert "0 cleared references in nosuch" in html
    assert "No reference is cleared for publication at the moment" in html
    assert "Start an enquiry" in html
    # a withheld-only sector reads as the same empty filter
    response = client.get("/references?sector=rail")
    assert "No reference is cleared for publication" in response.data.decode()


def test_detail_page_head_and_body(client):
    response = client.get("/references/paper-mill-drive-swap")
    html = response.data.decode()
    assert response.status_code == 200
    assert "<title>Paper mill drive swap</title>" in html
    assert '<meta name="description"' in html
    assert "og:image" in html
    assert "Aspen Mills" in html
    assert "Hanna Lehto" in html
    assert "Maintenance manager" in html
    assert "Drives replaced" in html and "48" in html
    assert 'Ask about this reference' in html
    # figures as labelled pairs
    assert "figure-pair" in html


def test_detail_page_marks_english_in_finnish_pending(client):
    response = client.get("/fi/references/dairy-line-rebuild")
    html = response.data.decode()
    assert response.status_code == 200
    assert "Tämä tarina on vielä kääntämättä" in html
    assert 'lang="en"' in html


def test_finnish_detail_uses_finnish_body(client):
    response = client.get("/fi/references/harbour-crane-retrofit")
    html = response.data.decode()
    assert "Satamanosturin modernisointi" in html
    assert "Tämä tarina on vielä kääntämättä" not in html
    assert "Kiela Terminals" in html


def test_programme_page(client):
    response = client.get("/programme")
    html = response.data.decode()
    assert "How the programme works" in html
    assert 'aria-label="Chapters"' in html
    for fragment in ("nomination", "clearance", "duration", "changes"):
        assert 'id="' + fragment + '"' in html
    assert 'aria-controls="clearance-body"' in html
    assert "Nomination" in html and "Clearance" in html
    assert "How long a clearance lasts" in html
    assert "Changes and removal" in html
    assert "pull-quote" in html and "figure-pair" in html


def test_story_page(client):
    response = client.get("/story")
    html = response.data.decode()
    assert "The programme so far" in html
    for span in ("2014-2016", "2017-2019", "2020-2022", "2023-2026"):
        assert span in html
    assert html.count("story-image") == 4
    assert 'alt="' in html
    assert 'width="1200" height="800"' in html


def test_notes_page(client):
    response = client.get("/notes")
    html = response.data.decode()
    assert "Notes" in html
    assert "2 notes" in html
    assert "What a clearance covers" in html
    assert "Why we number the library" in html
    # the draft note with no publication date does not appear
    assert "Translating the library" not in html
    # newest first
    assert html.index("14 September 2026") < html.index("2 June 2026")


def test_contact_page(client):
    response = client.get("/contact")
    html = response.data.decode()
    assert "Talk to the reference desk" in html
    for name in ("Aino Rask", "Mikael Söderholm", "Leena Varjo",
                 "Tomas Brandt", "Iiris Kallio", "Joonas Hirvi"):
        assert name in html
    assert html.count("copy-button") == 6
    assert '<label for="enquiry-email">Work address' in html
    assert '<label for="enquiry-phone">Telephone' in html
    assert '<label for="enquiry-reference">Reference of interest' in html
    assert '<label for="enquiry-agreed">I agree to the privacy statement' in html
    assert "No particular reference" in html
    assert 'role="status"' in html and 'role="alert"' in html
    assert "Dairy line rebuild" in html  # an enquiry choice


def test_finnish_surfaces_use_published_copy(client):
    response = client.get("/fi/references")
    html = response.data.decode()
    assert "Referenssikirjasto" in html
    assert "3 hyväksyttyä referenssiä" in html
    assert "Kaikki toimialat" in html
    assert "Toimialat" in html
    response = client.get("/fi/references?sector=food")
    html = response.data.decode()
    assert "1 hyväksytty referenssi" in html
    assert "toimialalla food" in html
    response = client.get("/fi")
    assert "Referenssejä, jotka voit tarkistaa" in response.data.decode()
    response = client.get("/fi/contact")
    html = response.data.decode()
    assert "Keskustele referenssitoimiston kanssa" in html
    assert "Työosoite" in html and "Puhelin" in html
    assert "Kiinnostava referenssi" in html
    assert "Hyväksyn tietosuojaselosteen" in html
    assert "Ei mitään tiettyä referenssiä" in html
    assert "Lähetä tiedustelu" in html
    assert "Kopioi osoite" in html
    response = client.get("/fi/programme")
    html = response.data.decode()
    assert "Näin ohjelma toimii" in html
    assert "Nimeäminen" in html and "Hyväksyntä" in html
    assert "Hyväksynnän kesto" in html and "Muutokset ja poistaminen" in html
    assert "Luvut" in html
    response = client.get("/fi/story")
    assert "Ohjelman vaiheet" in response.data.decode()
    response = client.get("/fi/notes")
    assert "Muistiinpanot" in response.data.decode()


def test_finnish_dates(client):
    response = client.get("/fi/notes")
    assert "14.9.2026" in response.data.decode()
    assert "14 September" not in response.data.decode()


def test_language_switch_keeps_route_query_and_declares(client):
    response = client.get("/references?sector=food&x=a%20b")
    html = response.data.decode()
    assert 'lang="en"' in html
    assert 'hreflang="fi" href="/fi/references?sector=food&amp;x=a%20b"' in html
    assert ">Suomi</span>" in html
    response = client.get("/fi/references?sector=food&x=a%20b")
    html = response.data.decode()
    assert 'hreflang="en" href="/references?sector=food&amp;x=a%20b"' in html
    assert ">English</span>" in html


def test_unknown_address_answers_not_found_page(client):
    response = client.get("/no-such-address-here")
    assert response.status_code == 404
    html = response.data.decode()
    assert "That page is not here" in html
    assert 'href="/"' in html and 'href="/references"' in html
    response = client.get("/fi/no-such-address-here")
    assert response.status_code == 404
    html = response.data.decode()
    assert "Sivua ei löydy" in html
    assert "Etusivu" in html and "Referenssit" in html
    # doubled Finnish addresses answer not found
    assert client.get("/fi/fi/references").status_code == 404
    assert client.get("/fi/desk").status_code == 404


def test_not_found_never_redirects(client):
    response = client.get("/references/no-such-thing")
    assert response.status_code == 404
    assert response.headers.get("Location") is None


def test_withheld_reference_absent_everywhere(client):
    for path in ("/references", "/", "/api/references", "/api/sectors",
                 "/fi/references"):
        body = client.get(path).data.decode()
        assert "Rail depot signalling" not in body, path
    assert "rail" not in client.get("/references").data.decode()
    response = client.get("/references/rail-depot-signalling")
    assert response.status_code == 404
    response = client.get("/fi/references/rail-depot-signalling")
    assert response.status_code == 404
    # not in the enquiry choices either
    html = client.get("/contact").data.decode()
    assert "Rail depot signalling" not in html


def test_page_head_meta_and_footer(client):
    response = client.get("/references")
    html = response.data.decode()
    assert 'rel="alternate"' in html
    assert "Northfall Reference Programme" in html
    assert "Privacy statement" in html
    assert "Terms of participation" in html
    # every public route repeated in the footer
    for href in ('href="/"', 'href="/references"', 'href="/programme"',
                 'href="/story"', 'href="/notes"', 'href="/contact"'):
        assert href in html


def test_desk_page_serves_sign_in_panel(client):
    response = client.get("/desk")
    assert response.status_code == 200
    html = response.data.decode()
    assert 'aria-label="Sign in"' in html
    assert "Email" in html and "Password" in html
    assert 'id="desk-messages"' in html
    assert 'role="status"' in html


def test_cookie_notice_present_but_hidden(client):
    response = client.get("/")
    html = response.data.decode()
    assert "Northfall uses cookies and similar technologies" in html
    assert 'aria-label="Cookie notice"' in html
    assert "Accept" in html and "Close the cookie notice" in html


def test_no_video_or_cross_origin_assets(client):
    for path in ("/", "/references", "/references/harbour-crane-retrofit",
                 "/programme", "/story", "/notes", "/contact", "/desk"):
        html = client.get(path).data.decode()
        assert "<video" not in html
        assert "http://" not in re.sub(r"<!--.*?-->", "", html, flags=re.S).replace(
            "http://127.0.0.1:4173", "").replace("https://", "")
        assert "https://" not in html
        for match in re.findall(r'(?:src|href)="([^"]+)"', html):
            if match.startswith(("mailto:", "tel:", "#", "/")):
                continue
            assert not match.startswith("http"), (path, match)


def test_reflow_width_present_in_css(client):
    response = client.get("/static/app.css")
    assert response.status_code == 200
    css = response.data.decode()
    assert "max-width: 1099px" in css
    assert "max-width: 639px" in css
    assert "@media (min-width: 640px)" in css
    assert "prefers-reduced-motion" in css


def test_head_answers_like_get_on_pages(client):
    response = client.head("/")
    assert response.status_code == 200
    assert response.data == b""
    response = client.head("/references")
    assert response.status_code == 200


def test_page_method_not_allowed(client):
    response = client.post("/references")
    assert response.status_code == 405
    assert "GET" in response.headers["Allow"]


def test_head_links_present(client):
    response = client.get("/static/fonts/SourceSerif4.ttf")
    assert response.status_code == 200
    assert response.data[:4] == b"\x00\x01\x00\x00"
    response = client.get("/static/fonts/Archivo.ttf")
    assert response.status_code == 200
    response = client.get("/static/img/social-card.png")
    assert response.status_code == 200
    assert response.data[:8] == b"\x89PNG\r\n\x1a\n"
    response = client.get("/static/app.js")
    assert response.status_code == 200
    response = client.get("/static/desk.js")
    assert response.status_code == 200
