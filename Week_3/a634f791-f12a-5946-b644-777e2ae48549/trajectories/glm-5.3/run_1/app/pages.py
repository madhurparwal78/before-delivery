"""The public pages and the desk page: server-rendered HTML on one origin."""

from __future__ import annotations

import datetime as dt
import os

import clock
import core
import db
import desk
import finnish
import queries
from api import json_response, METHOD_NOT_ALLOWED
from flask import Blueprint, Response, request, render_template

pages = Blueprint("pages", __name__)

PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:4173").rstrip("/")


def install_error_handlers(app) -> None:
    from api import not_found as api_not_found

    @app.errorhandler(404)
    def not_found_page(error):
        if request.path.startswith("/api"):
            return api_not_found()
        return _not_found_page(_page_language())

    @app.errorhandler(405)
    def method_not_allowed(error):
        allowed = list(getattr(error, "valid_methods", None) or [])
        allow = ", ".join(allowed) if allowed else "GET"
        return json_response(METHOD_NOT_ALLOWED, 405, headers={"Allow": allow})


def _page_language() -> str:
    return "fi" if request.path == "/fi" or request.path.startswith("/fi/") else "en"


def _not_found_page(language: str) -> Response:
    """The not-found page: the wordmark, the heading and the two links.
    It never touches the database, so it answers during an outage too."""
    chrome = {"lang": language, "path": request.path,
              "query": _raw_query(), "suffix": "", "other": "",
              "year": None}
    html = render_template("notfound.html", lang=language, chrome=chrome,
                           fi=finnish.FINNISH)
    return Response(html, status=404, mimetype="text/html")


# ------------------------------------------------------------------- chrome

def _raw_query() -> str:
    """The raw query string, byte for byte, correctly escaped for HTML."""
    raw = request.query_string.decode("latin-1")
    return raw


def _other_path(language: str, path: str) -> str:
    if language == "en":
        return "/fi" + path
    return path[3:] if path.startswith("/fi") else path


def _chrome(language: str, path: str = None):
    """The shared header, footer and language switch of every public route."""
    if path is None:
        path = request.path
    query = _raw_query()
    other = _other_path(language, path)
    suffix = ("?" + query) if query else ""
    return {
        "lang": language,
        "path": path,
        "query": query,
        "suffix": suffix,
        "other": other + suffix,
        "year": None,  # filled by each page from the service clock
    }


def _chrome_with_year(language: str, path: str, today: dt.date):
    chrome = _chrome(language, path)
    chrome["year"] = today.year
    return chrome


def _sector_echo(value: str) -> str:
    """The sector value from the address, escaped, with any NUL character or
    undecodable byte dropped from the echo."""
    if not isinstance(value, str):
        return ""
    cleaned = value.replace("\x00", "")
    return "".join(ch for ch in cleaned if not 0xD800 <= ord(ch) <= 0xDFFF)


def _current_nav(path: str) -> str | None:
    """The navigation marks exactly the current page (DP-41)."""
    tail = path[3:] if path.startswith("/fi") else path
    tail = tail.rstrip("/") or "/"
    for name in ("references", "programme", "story", "notes"):
        if tail == "/" + name or tail.startswith("/" + name + "/"):
            return name
    return None


def _render_db(template: str, language: str, path: str, work_fn=None, *,
               headers: dict | None = None, **kwargs):
    """Run a page's own database work inside the same connection as the
    chrome, so one page is one consistent read."""
    def work(conn):
        today = clock.now_today(conn)
        chrome = _chrome_with_year(language, path, today)
        page_data = dict(work_fn(conn, today)) if work_fn else {}
        page_data.update(kwargs)
        html = render_template(template, lang=language, chrome=chrome,
                               today=today, fi=finnish.FINNISH,
                               current_nav=_current_nav(path), **page_data)
        return Response(html, mimetype="text/html",
                        headers=headers or {})
    try:
        return db.run(work)
    except db.Unavailable:
        return Response(render_template("outage.html", lang=language,
                                        chrome=_chrome(language, path),
                                        fi=finnish.FINNISH),
                       status=503, mimetype="text/html")


# ------------------------------------------------------------------- routes

def _query_sector() -> tuple:
    """With the parameter repeated, the first value is used. An empty value
    means no filter. A value whose echo drops every character still filters
    (it matches no live reference), so it reads as the same empty filter as
    an unknown sector (DP-57).

    Returns (echo, filtered): the echoed value and whether a filter applies.
    """
    value = request.args.get("sector")
    if value is None or value == "":
        return None, False
    return _sector_echo(value), True


def _index_work(conn, today, sector, fi: bool, filtered: bool):
    rows = queries.live_references(
        conn, "northfall", today, sector if filtered else None)
    sectors = queries.live_sectors(conn, "northfall", today)
    out = []
    for row in rows:
        figures = queries.figures_of(conn, row["id"])
        title = (row["title_fi"] or row["title"]) if fi else row["title"]
        out.append({"row": row, "figures": figures, "title": title})
    return {"references": out, "sectors": sectors,
            "sector": sector, "filtered": filtered}


def _home_work(conn, today, fi: bool):
    rows = queries.live_references(conn, "northfall", today)[:3]
    out = []
    for row in rows:
        figures = queries.figures_of(conn, row["id"])
        title = (row["title_fi"] or row["title"]) if fi else row["title"]
        out.append({"row": row, "figures": figures, "title": title})
    return {"references": out}


@pages.get("/")
def home():
    return _render_db("home.html", "en", "/",
                      lambda conn, today: _home_work(conn, today, False))


@pages.get("/fi")
@pages.get("/fi/")
def fi_home():
    return _render_db("home.html", "fi", "/fi",
                      lambda conn, today: _home_work(conn, today, True))


@pages.get("/references")
def references_index():
    echo, filtered = _query_sector()
    return _render_db("references.html", "en", "/references",
                      lambda conn, today: _index_work(conn, today, echo, False, filtered))


@pages.get("/fi/references")
def fi_references_index():
    echo, filtered = _query_sector()
    return _render_db("references.html", "fi", "/fi/references",
                      lambda conn, today: _index_work(conn, today, echo, True, filtered))


def _detail_page(language: str, slug: str):
    """One reference page: live, or a valid preview, or the not-found page.

    A redirect is never served for a preview read, and a valid preview is
    served uncacheable and unindexed.
    """
    def work(conn):
        today = clock.now_today(conn)
        programme_id = queries.programme_id_of(conn, "northfall")
        row = queries.reference_by_slug(conn, programme_id, slug)
        if row is None:
            redirect_row = queries.redirect_target(conn, programme_id, slug)
            if redirect_row is not None:
                return ("redirect", redirect_row["current_slug"], False)
            return None
        state = core.state_of(row, today)
        if state == core.LIVE:
            return ("detail", row, False)
        token = request.args.get("preview")
        if token and not row["published"] and row["retired_at"] is None:
            now = clock.now(conn)
            if desk.valid_preview(conn, row, token, now):
                return ("detail", row, True)
        return None

    try:
        result = db.run(work)
    except db.Unavailable:
        return Response(render_template("outage.html", lang=language,
                                        chrome=_chrome(language),
                                        fi=finnish.FINNISH),
                       status=503, mimetype="text/html")
    if result is None:
        return _not_found_page(language)
    kind, row, preview = result
    path_prefix = "/fi/references/" if language == "fi" else "/references/"
    if kind == "redirect":
        return _page_redirect(path_prefix + row)
    headers = {}
    if preview:
        headers = {"Cache-Control": "private, no-store",
                   "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer"}
    return _render_db(
        "detail.html", language, path_prefix + slug,
        lambda conn, today: {"row": row,
                             "figures": queries.figures_of(conn, row["id"]),
                             "preview": preview},
        headers=headers,
        preview_token=request.args.get("preview") if preview else None)


def _run_or_outage(fn):
    try:
        return db.run(fn)
    except db.Unavailable:
        return "outage"


def _page_redirect(target: str) -> Response:
    """One permanent hop that keeps the query string byte for byte and stays
    on the configured origin whatever the request headers claim."""
    suffix = ""
    if request.query_string:
        suffix = "?" + request.query_string.decode("latin-1")
    location = target + suffix
    if location.startswith("/"):
        location = PUBLIC_URL + location
    return Response(status=301, headers={"Location": location})


@pages.get("/references/<slug>")
def references_detail(slug: str):
    return _detail_page("en", slug)


@pages.get("/fi/references/<slug>")
def fi_references_detail(slug: str):
    return _detail_page("fi", slug)


@pages.get("/programme")
def programme():
    return _render_db("programme.html", "en", "/programme",
                      lambda conn, today: {"chapters": CHAPTERS_EN,
                                           "quote": PULL_QUOTE_EN,
                                           "pairs": FIGURE_PAIRS_EN})


@pages.get("/fi/programme")
def fi_programme():
    return _render_db("programme.html", "fi", "/fi/programme",
                      lambda conn, today: {"chapters": CHAPTERS_FI,
                                           "quote": PULL_QUOTE_FI,
                                           "pairs": FIGURE_PAIRS_FI})


STORY_CHAPTERS_FI = [
    ("2014–2016", "2014-2016", "Ensimmäiset toimitukset",
     ["Northfall alkoi asentaa automaatiota satamiin ja meijereihin, ja "
      "ensimmäiset asiakkaat esittivät oikeutetun kysymyksen: kenelle muulle "
      "olette tehneet tämän? Referenssiohjelma alkoi valokuvakansiosta, ja "
      "siitä tuli jotain huolellisempaa.",
      "Opimme aikaisin, ettei ostaja halua esitettä; hän haluaa puhua työn "
      "tehneille ihmisille. Ensimmäiset referenssitarinat kirjoitettiin, jotta "
      "tuo keskustelu olisi mahdollinen.",
      "story-2014-2016",
      "Satamanosturin retrojuoksu yöllä, terminaalin aikataulun jatkuen työvalojen takana."]),
    ("2017–2019", "2017-2019", "Hyväksyntäikkuna",
     ["Kirjaston kasvaessa asiakkaat alkoivat kysyä vaikeampaa kysymystä: "
      "kuinka kauan saatte pitää tarinamme julkisena? Vastaukseksi tuli "
      "hyväksyntäikkuna, joka sovitaan kirjallisesti jokaisen asiakkaan kanssa.",
      "Vuodesta 2017 jokainen tarina on kantanut omat päivämääränsä, ja "
      "toimisto on oppinut vetämään tarinan pois sen ikkunan sulkeuduttua, "
      "jättämättä jälkeä.",
      "story-2017-2019",
      "Paperikoneen ajohalli kesken vaihdon, vanhat kaapit jo poistettuina ja uudet lattialla odottamassa."]),
    ("2020–2022", "2020-2022", "Numeroitu kirjasto",
     ["Kirjasto numeroitiin näyttöjärjestyksessä, jotta ostaja näki "
      "yhden silmäyksellä, kuinka monta valmista toimitusta oli "
      "hyväksytty julkaistavaksi, eikä numerot koskaan hyppää.",
      "Kun tarina poistuu kirjastosta, numerot sulkeutuvat. Kun se palaa, "
      "se ottaa seuraavan numeron jonon lopusta. Kirjaston laskema on "
      "siten aina totuus.",
      "story-2020-2022",
      "Mehilinjan uudet servokoneet käyttöönotossa meijerissä, pesupaneelit auki rivin päässä."]),
    ("2023–2026", "2023-2026", "Kaksi kieltä, yksi kirjasto",
     ["Kirjasto julkaistaan englanniksi ja suomeksi, koska asiakkaamme lukevat "
      "molempia. Jokainen suomenkielinen versio saapuu yksi referenssi kerrallaan, "
      "tarkistettuna asiakkaan kanssa kuten kaikki muukin.",
      "Tänään referenssitoimisto on työkalu: julkinen kirjasto, jonka ostaja voi "
      "tarkistaa, ja yksityinen toiminto, jossa jokainen tarina kirjoitetaan, "
      "järjestetään, esikatsellaan, julkaistaan ja joskus poistetaan.",
      "story-2023-2026",
      "Kylmävaraston automaattinen kuistikäytävä työssä, kuormalavat liikkeessä korkealla keräilypaikkojen yllä."]),
]


@pages.get("/story")
def story():
    return _render_db("story.html", "en", "/story",
                      lambda conn, today: {"chapters": STORY_CHAPTERS_EN,
                                           "quote": PULL_QUOTE_EN,
                                           "pairs": FIGURE_PAIRS_EN})


@pages.get("/fi/story")
def fi_story():
    return _render_db("story.html", "fi", "/fi/story",
                      lambda conn, today: {"chapters": STORY_CHAPTERS_FI,
                                           "quote": PULL_QUOTE_FI,
                                           "pairs": FIGURE_PAIRS_FI})


def _notes_work(conn, today):
    rows = queries.notes(conn, "northfall")
    notes = []
    for n in rows:
        notes.append({"slug": n["slug"], "title": n["title"],
                      "preview": n["preview"], "published_on": n["published_on"]})
    return {"notes": notes}


@pages.get("/notes")
def notes_page():
    return _render_db("notes.html", "en", "/notes", _notes_work)


@pages.get("/fi/notes")
def fi_notes_page():
    return _render_db("notes.html", "fi", "/fi/notes", _notes_work)


MANAGERS = [
    ("Aino Rask", "Reference manager, ports and logistics",
     "aino.rask@example.com", "+358 40 000 0101", "portrait-aino-rask.png",
     "Portrait of Aino Rask, reference manager for ports and logistics."),
    ("Mikael Söderholm", "Reference manager, food and beverage",
     "mikael.soderholm@example.com", "+358 40 000 0102", "portrait-mikael-soderholm.png",
     "Portrait of Mikael Söderholm, reference manager for food and beverage."),
    ("Leena Varjo", "Reference manager, pulp and paper",
     "leena.varjo@example.com", "+358 40 000 0103", "portrait-leena-varjo.png",
     "Portrait of Leena Varjo, reference manager for pulp and paper."),
    ("Tomas Brandt", "Reference manager, rail",
     "tomas.brandt@example.com", "+358 40 000 0104", "portrait-tomas-brandt.png",
     "Portrait of Tomas Brandt, reference manager for rail."),
    ("Iiris Kallio", "Reference manager, mining and minerals",
     "iiris.kallio@example.com", "+358 40 000 0105", "portrait-iiris-kallio.png",
     "Portrait of Iiris Kallio, reference manager for mining and minerals."),
    ("Joonas Hirvi", "Head of the reference programme",
     "joonas.hirvi@example.com", "+358 40 000 0106", "portrait-joonas-hirvi.png",
     "Portrait of Joonas Hirvi, head of the reference programme."),
]


def _contact_work(conn, today, fi: bool):
    rows = queries.live_references(conn, "northfall", today)
    choices = []
    for row in rows:
        title = (row["title_fi"] or row["title"]) if fi else row["title"]
        choices.append({"slug": row["slug"], "title": title})
    return {"managers": MANAGERS, "choices": choices}


@pages.get("/contact")
def contact():
    return _render_db("contact.html", "en", "/contact",
                      lambda conn, today: _contact_work(conn, today, False))


@pages.get("/fi/contact")
def fi_contact():
    return _render_db("contact.html", "fi", "/fi/contact",
                      lambda conn, today: _contact_work(conn, today, True))


# --------------------------------------------------------------------- desk

@pages.get("/desk")
def desk_page():
    """The desk is a working surface; its data comes from the client's own
    calls under the account's bearer token."""
    return _render_no_db("desk.html")


def _render_no_db(template: str):
    html = render_template(template, lang="en", chrome=_chrome("en", "/desk"),
                           fi=finnish.FINNISH)
    return Response(html, mimetype="text/html")

CHAPTERS_EN = [
    ("nomination", "Nomination", "Chapter 01",
     ["When an installation is finished, the reference desk asks the "
      "customer to nominate the project for the library. A nomination names "
      "the customer, the sector and the work that was actually delivered, "
      "and nothing goes further until the customer says yes to that first "
      "step.",
      "A curator then sits down with the people who ran the project and "
      "writes the story: the challenge the customer faced, the work we "
      "carried out, and the figures the installation now produces. The "
      "story is checked with the customer line by line, because a buyer "
      "will read it as a claim about what Northfall can deliver."]),
    ("clearance", "Clearance", "Chapter 02",
     ["Before any story is published, the customer who lived through it "
      "reads it and clears it in writing. The clearance covers the story "
      "text, the result figures and the customer quote as one package, so "
      "a buyer can trust that every published word was agreed.",
      "A clearance window is then recorded by a steward: the pair of dates "
      "between which the customer has agreed that the story may be public. "
      "The window belongs to the story, and the desk holds it so the "
      "library never publishes a story outside its customer's agreement."]),
    ("duration", "How long a clearance lasts", "Chapter 03",
     ["A story appears in the library only while its clearance window "
      "contains today, counted by the calendar in Helsinki and inclusive "
      "at both ends. A window that ends today keeps the story public for "
      "all of today, and a window that starts today makes it public today.",
      "The day after a window closes, the story leaves every public page "
      "at the next request. Its address answers not found, the count on "
      "the index drops, the numbers close up, and nothing on the site "
      "reveals that the story ever existed. A steward can reopen the "
      "window at any time, and the story then returns exactly as it was, "
      "at the end of the run."]),
    ("changes", "Changes and removal", "Chapter 04",
     ["If a customer asks for a change, the story leaves the library at "
      "once and the change is made. A changed figure, quote or customer "
      "name needs a new clearance, because the package the customer agreed "
      "to is no longer the package being published.",
      "A customer can also ask for the story to be retired, and a curator "
      "or steward retires it from the desk. A retired story answers not "
      "found at every address it has ever held, and no trace of it remains "
      "on any public page. It can be restored later, and it then returns "
      "with everything it had, last in the run."]),
]

CHAPTERS_FI = [
    ("nomination", "Nimeäminen", "Luku 01",
     ["Kun toimitus on valmis, referenssitoimisto pyytää asiakasta nimeämään "
      "kohteen referenssikirjastoon. Nimeäminen kertoo asiakkaan, toimialan "
      "ja tehdyn työn, eikä mikään etene ennen kuin asiakas antaa siihen "
      "suostumuksensa.",
      "Kuraattori kirjoittaa sitten projektin ihmisten kanssa tarinan: "
      "asiakkaan haasteen, tehdyn työn ja luvut, joita asennus nyt tuottaa. "
      "Tarkistus käydään läpi asiakkaan kanssa rivi riviltä, koska ostaja "
      "lukee tarinan väitteenä siitä, mitä Northfall osaa toimittaa."]),
    ("clearance", "Hyväksyntä", "Luku 02",
     ["Ennen kuin tarina julkaistaan, asiakas lukee sen ja hyväksyy sen "
      "kirjallisesti. Hyväksyntä kattaa tarinatekstin, tulosluvut ja "
      "asiakkaan lainauksen yhtenä kokonaisuutena, joten ostaja voi "
      "luottaa, että jokainen julkaistu sana on sovittu.",
      "Vastaava kirjaa sitten hyväksyntäikkunan: päivämääräparin, jonka "
      "välillä asiakas on suostunut tarinan julkaisemiseen. Ikkuna kuuluu "
      "tarinaan, ja toimisto pitää sitä yllä, jotta kirjasto ei koskaan "
      "julkaise tarinaa asiakkaan suostumuksen ulkopuolella."]),
    ("duration", "Hyväksynnän kesto", "Luku 03",
     ["Tarina näkyy kirjastossa vain, kun sen hyväksyntäikkuna sisältää "
      "tämän päivän, Helsingin kalenterilla laskettuna ja molemmin puolin "
      "päättyvänä. Ikkuna, joka päättyy tänään, pitää tarinan julkisena "
      "koko tänään, ja ikkuna, joka alkaa tänään, tekee siitä julkisen "
      "tänään.",
      "Ikkunan sulkeuduttua tarina poistuu kaikilta julkisilta sivuilta "
      "seuraavassa pyynnössä. Sen osoite vastaa, ettei sivua ole, "
      "kirjaston laskuma pienenee, numerot sulkeutuvat, eikä mikään "
      "paljasta, että tarina on joskus ollut olemassa. Vastaava voi "
      "avata ikkunan uudelleen, ja tarina palaa silloin ennallaan, "
      "jonon loppuun."]),
    ("changes", "Muutokset ja poistaminen", "Luku 04",
     ["Jos asiakas pyytää muutosta, tarina poistuu kirjastosta heti ja "
      "muutos tehdään. Muuttunut luku, lainaus tai asiakkaan nimi vaatii "
      "uuden hyväksynnän, koska asiakkaan hyväksymä kokonaisuus ei ole "
      "enää julkaistava kokonaisuus.",
      "Asiakas voi myös pyytää tarinan poistamista, ja kuraattori tai "
      "vastaava poistaa sen toimistosta. Poistettu tarina vastaa, ettei "
      "sivua ole, jokaisessa osoitteessa, jossa se on koskaan ollut, eikä "
      "jälkeä jää millekään julkiselle sivulle. Sen voi palauttaa myöhemmin, "
      "ja se palaa silloin kaikella sillä, mitä sillä oli, jonon loppuun."]),
]

PULL_QUOTE_EN = ("A reference library only earns trust if every story in it "
                 "is one the customer has agreed to, for exactly as long as "
                 "they agreed to it.", "Joonas Hirvi", "Head of the reference programme")
PULL_QUOTE_FI = ("Referenssikirjasto ansaitsee luottamuksen vain, jos jokainen "
                 "tarina siinä on asiakkaan hyväksymä ja juuri niin kauan kuin "
                 "asiakas on sen hyväksynyt.", "Joonas Hirvi",
                 "Referenssiohjelman johtaja")

FIGURE_PAIRS_EN = [("4", "cleared stories in the library today"),
                   ("100 %", "of them checked with the customer"),
                   ("2", "languages, one library")]
FIGURE_PAIRS_FI = [("4", "hyväksyttyä tarinaa kirjastossa tänään"),
                   ("100 %", "niistä on tarkistettu asiakkaan kanssa"),
                   ("2", "kieltä, yksi kirjasto")]

STORY_CHAPTERS_EN = [
    ("2014–2016", "2014-2016", "The first installations",
     ["Northfall began installing automation in ports and dairies, and the "
      "first customers asked a fair question: who else has you done this "
      "for? The reference programme began as a folder of photographs, and "
      "it became something more careful.",
      "We learned early that a buyer does not want a brochure; they want "
      "to speak to the people who ran the work. The first reference "
      "stories were written to make that conversation possible.",
      "story-2014-2016",
      "A harbour crane retrofit in progress at night, with the terminal's arrival schedule running behind the work lights."]),
    ("2017–2019", "2017-2019", "The clearance window",
     ["As the library grew, customers began to ask a harder question: how "
      "long may you keep our story public? The answer became the "
      "clearance window, agreed in writing with each customer.",
      "From 2017 every story carried its own pair of dates, and the desk "
      "learned to withdraw a story the day its window closed, with no "
      "trace left behind.",
      "story-2017-2019",
      "A paper machine's drive bay mid-swap, with old cabinets already removed and the new ones waiting on the floor."]),
    ("2020–2022", "2020-2022", "The numbered library",
     ["The library was numbered in display order so a buyer could see at a "
      "glance how many finished installations had been cleared for "
      "publication, and the numbers never skip.",
      "When a story leaves the library, the numbers close up. When it "
      "returns, it takes the next number at the end of the run. The count "
      "on the index is therefore always the truth.",
      "story-2020-2022",
      "A filling line's new servo machines being commissioned in a dairy, with the clean-in-place panels open at the end of the row."]),
    ("2023–2026", "2023-2026", "Two languages, one library",
     ["The library is published in English and in Finnish, because our "
      "customers read in both. Each Finnish version arrives one reference "
      "at a time, checked with the customer like everything else.",
      "Today the reference desk is a working product: a public library a "
      "buyer can check, and a private desk where every story is drafted, "
      "ordered, previewed, published and, one day, withdrawn.",
      "story-2023-2026",
      "A cold store's automated crane aisle at work, with pallets in motion high above the picking stations below."]),
]
