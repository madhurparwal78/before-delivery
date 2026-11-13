"""The published wording, one table per language.

Every string a public page shows comes from here, so the Finnish surface renders
the published Finnish wording character for character.
"""

from __future__ import annotations

ENGLISH_MONTHS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

EN = {
    "locale": "en",
    "other_locale": "fi",
    "switch_label": "Suomi",
    "skip": "Skip to content",
    "wordmark": "Northfall",
    "wordmark_tail": "Reference Programme",
    "nav_name": "Primary",
    "nav": (
        ("references", "References"),
        ("programme", "Programme"),
        ("story", "Story"),
        ("notes", "Notes"),
    ),
    "enquire": "Enquire",
    "menu": "Menu",
    "sitemap": "Sitemap",
    "footer_privacy": "Privacy statement",
    "footer_terms": "Terms of participation",
    "cookie_region": "Cookie notice",
    "cookie_text": "Northfall uses cookies and similar technologies to understand traffic",
    "cookie_accept": "Accept",
    "cookie_close": "Close the cookie notice",
    "home_heading": "References you can check, from installations we actually finished",
    "home_sub": "Every story here is published with the customer's written agreement",
    "home_enquiry_link": "Start an enquiry",
    "home_index_link": "Read the references",
    "home_featured": "Featured references",
    "home_panels": "How the programme works",
    "index_heading": "The reference library",
    "sectors_name": "Sectors",
    "all_sectors": "All sectors",
    "index_empty": "No reference is cleared for publication at the moment",
    "index_empty_link": "Start an enquiry",
    "detail_enquiry_link": "Ask about this reference",
    "detail_challenge": "The challenge",
    "detail_work": "The work",
    "detail_results": "Result figures",
    "detail_customer": "Customer",
    "detail_sector": "Sector",
    "detail_ordinal": "Reference",
    "programme_heading": "How the programme works",
    "chapters_name": "Chapters",
    "chapter_titles": (
        "Nomination",
        "Clearance",
        "How long a clearance lasts",
        "Changes and removal",
    ),
    "story_heading": "The programme so far",
    "story_marker": "Years",
    "notes_heading": "Notes",
    "notes_count_one": "1 note",
    "notes_count_many": "{n} notes",
    "contact_heading": "Talk to the reference desk",
    "contact_directory": "Reference managers",
    "contact_form": "Send an enquiry",
    "label_email": "Work address",
    "label_phone": "Telephone",
    "label_reference": "Reference of interest",
    "label_agreed": "I agree to the privacy statement",
    "reference_none": "No particular reference",
    "submit": "Send the enquiry",
    "submit_pending": "Sending\u2026",
    "required_mark": "required",
    "optional_mark": "optional",
    "enquiry_success": "Thank you, the desk will reply from hello@example.com",
    "enquiry_refused": "Check the marked fields and send again.",
    "enquiry_outage": (
        "The desk cannot take enquiries right now. "
        "Nothing was sent; please try again shortly."
    ),
    "outage_page": "The reference desk is unavailable right now",
    "not_found_heading": "That page is not here",
    "not_found_home": "Home",
    "not_found_index": "References",
    "copy_label": "Click to copy address",
    "copy_done": "Copied to the clipboard",
    "copy_failed": "Copy not available",
    "preview_banner": "Preview: the reference is not published",
    "pending_translation": "This story has not been translated yet",
    "errors": {
        "email": "Enter a work address the desk can reply to",
        "agreed": "Tick the box to agree to the privacy statement",
        "phone": "Enter a telephone number of at least ten characters",
        "reference": "Choose a reference from the library",
    },
}

FI = {
    "locale": "fi",
    "other_locale": "en",
    "switch_label": "English",
    "skip": "Siirry sis\u00e4lt\u00f6\u00f6n",
    "wordmark": "Northfall",
    "wordmark_tail": "Referenssiohjelma",
    "nav_name": "Primary",
    "nav": (
        ("references", "Referenssit"),
        ("programme", "Ohjelma"),
        ("story", "Tarina"),
        ("notes", "Muistiinpanot"),
    ),
    "enquire": "Tiedustele",
    "menu": "Valikko",
    "sitemap": "Sivukartta",
    "footer_privacy": "Tietosuojaseloste",
    "footer_terms": "Osallistumisen ehdot",
    "cookie_region": "Ev\u00e4steilmoitus",
    "cookie_text": (
        "Northfall k\u00e4ytt\u00e4\u00e4 ev\u00e4steit\u00e4 ja vastaavia tekniikoita "
        "liikenteen ymm\u00e4rt\u00e4miseen"
    ),
    "cookie_accept": "Hyv\u00e4ksy",
    "cookie_close": "Sulje ev\u00e4steilmoitus",
    "home_heading": (
        "Referenssej\u00e4, jotka voit tarkistaa, toimituksista, jotka todella "
        "saimme valmiiksi"
    ),
    "home_sub": "Jokainen tarina julkaistaan asiakkaan kirjallisella suostumuksella",
    "home_enquiry_link": "Aloita tiedustelu",
    "home_index_link": "Lue referenssit",
    "home_featured": "Nostetut referenssit",
    "home_panels": "N\u00e4in ohjelma toimii",
    "index_heading": "Referenssikirjasto",
    "sectors_name": "Toimialat",
    "all_sectors": "Kaikki toimialat",
    "index_empty": (
        "Yksik\u00e4\u00e4n referenssi ei ole t\u00e4ll\u00e4 hetkell\u00e4 "
        "hyv\u00e4ksytty julkaistavaksi"
    ),
    "index_empty_link": "Aloita tiedustelu",
    "detail_enquiry_link": "Kysy t\u00e4st\u00e4 referenssist\u00e4",
    "detail_challenge": "Haaste",
    "detail_work": "Ty\u00f6",
    "detail_results": "Tulosluvut",
    "detail_customer": "Asiakas",
    "detail_sector": "Toimiala",
    "detail_ordinal": "Referenssi",
    "programme_heading": "N\u00e4in ohjelma toimii",
    "chapters_name": "Luvut",
    "chapter_titles": (
        "Nime\u00e4minen",
        "Hyv\u00e4ksynt\u00e4",
        "Hyv\u00e4ksynn\u00e4n kesto",
        "Muutokset ja poistaminen",
    ),
    "story_heading": "Ohjelman vaiheet",
    "story_marker": "Vuodet",
    "notes_heading": "Muistiinpanot",
    "notes_count_one": "1 muistiinpano",
    "notes_count_many": "{n} muistiinpanoa",
    "contact_heading": "Keskustele referenssitoimiston kanssa",
    "contact_directory": "Referenssivastaavat",
    "contact_form": "L\u00e4het\u00e4 tiedustelu",
    "label_email": "Ty\u00f6osoite",
    "label_phone": "Puhelin",
    "label_reference": "Kiinnostava referenssi",
    "label_agreed": "Hyv\u00e4ksyn tietosuojaselosteen",
    "reference_none": "Ei mit\u00e4\u00e4n tietty\u00e4 referenssi\u00e4",
    "submit": "L\u00e4het\u00e4 tiedustelu",
    "submit_pending": "L\u00e4hetet\u00e4\u00e4n\u2026",
    "required_mark": "pakollinen",
    "optional_mark": "valinnainen",
    "enquiry_success": "Kiitos, toimisto vastaa osoitteesta hello@example.com",
    "enquiry_refused": "Tarkista merkityt kent\u00e4t ja l\u00e4het\u00e4 uudelleen.",
    "enquiry_outage": (
        "Toimisto ei voi juuri nyt ottaa vastaan tiedusteluja. "
        "Mit\u00e4\u00e4n ei l\u00e4hetetty; yrit\u00e4 pian uudelleen."
    ),
    "outage_page": "Referenssitoimisto ei ole juuri nyt k\u00e4ytett\u00e4viss\u00e4",
    "not_found_heading": "Sivua ei l\u00f6ydy",
    "not_found_home": "Etusivu",
    "not_found_index": "Referenssit",
    "copy_label": "Kopioi osoite",
    "copy_done": "Kopioitu leikep\u00f6yd\u00e4lle",
    "copy_failed": "Kopiointi ei onnistu",
    "preview_banner": "Esikatselu: referenssi\u00e4 ei ole julkaistu",
    "pending_translation": "T\u00e4m\u00e4 tarina on viel\u00e4 k\u00e4\u00e4nt\u00e4m\u00e4tt\u00e4",
    "errors": {
        "email": "Anna ty\u00f6osoite, johon toimisto voi vastata",
        "agreed": "Hyv\u00e4ksy tietosuojaseloste valitsemalla ruutu",
        "phone": "Anna v\u00e4hint\u00e4\u00e4n kymmenen merkin puhelinnumero",
        "reference": "Valitse referenssi kirjastosta",
    },
}

TABLES = {"en": EN, "fi": FI}


def table(locale: str) -> dict:
    return TABLES[locale]


def index_count(locale: str, count: int, sector: str | None) -> str:
    if locale == "fi":
        line = "1 hyv\u00e4ksytty referenssi" if count == 1 else f"{count} hyv\u00e4ksytty\u00e4 referenssi\u00e4"
        if sector is not None:
            line = f"{line} toimialalla {sector}"
        return line
    noun = "reference" if count == 1 else "references"
    line = f"{count} cleared {noun}"
    if sector is not None:
        line = f"{line} in {sector}"
    return line


def note_date(locale: str, published_on) -> str:
    if locale == "fi":
        return f"{published_on.day}.{published_on.month}.{published_on.year}"
    return f"{published_on.day} {ENGLISH_MONTHS[published_on.month - 1]} {published_on.year}"
