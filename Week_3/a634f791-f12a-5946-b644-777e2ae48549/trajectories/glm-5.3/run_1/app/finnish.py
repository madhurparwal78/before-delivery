"""The published Finnish strings, in one place.

Every Finnish surface renders these strings character for character. The API
stays in English; a Finnish page maps each ``errors`` key to this table and
never shows the API's English message.
"""

FINNISH = {
    # navigation and chrome
    "nav_references": "Referenssit",
    "nav_programme": "Ohjelma",
    "nav_story": "Tarina",
    "nav_notes": "Muistiinpanot",
    "skip": "Siirry sisältöön",
    "enquire": "Tiedustele",
    "menu": "Valikko",
    "language_switch": "English",
    "count_one": "1 hyväksytty referenssi",
    "count_many": "{n} hyväksyttyä referenssiä",
    "count_filtered": "toimialalla {sector}",
    "home_heading": "Referenssejä, jotka voit tarkistaa, toimituksista, jotka todella saimme valmiiksi",
    "home_sub": "Jokainen tarina julkaistaan asiakkaan kirjallisella suostumuksella",
    "home_start": "Aloita tiedustelu",
    "home_read": "Lue referenssit",
    "index_heading": "Referenssikirjasto",
    "filter_nav": "Toimialat",
    "filter_all": "Kaikki toimialat",
    "detail_enquire": "Kysy tästä referenssistä",
    "programme_heading": "Näin ohjelma toimii",
    "chapters_nav": "Luvut",
    "chapter_nomination": "Nimeäminen",
    "chapter_clearance": "Hyväksyntä",
    "chapter_duration": "Hyväksynnän kesto",
    "chapter_changes": "Muutokset ja poistaminen",
    "story_heading": "Ohjelman vaiheet",
    "notes_heading": "Muistiinpanot",
    "contact_heading": "Keskustele referenssitoimiston kanssa",
    "label_work_address": "Työosoite",
    "label_telephone": "Puhelin",
    "label_reference": "Kiinnostava referenssi",
    "label_agreed": "Hyväksyn tietosuojaselosteen",
    "first_choice": "Ei mitään tiettyä referenssiä",
    "submit": "Lähetä tiedustelu",
    "submit_sending": "Lähetetään…",
    "error_email": "Anna työosoite, johon toimisto voi vastata",
    "error_agreed": "Hyväksy tietosuojaseloste valitsemalla ruutu",
    "error_phone": "Anna vähintään kymmenen merkin puhelinnumero",
    "error_reference": "Valitse referenssi kirjastosta",
    "refusal": "Tarkista merkityt kentät ja lähetä uudelleen.",
    "success": "Kiitos, toimisto vastaa osoitteesta hello@example.com",
    "outage": "Toimisto ei voi juuri nyt ottaa vastaan tiedusteluja. Mitään ei lähetetty; yritä pian uudelleen.",
    "outage_page": "Referenssitoimisto ei ole juuri nyt käytettävissä",
    "not_found_heading": "Sivua ei löydy",
    "not_found_home": "Etusivu",
    "not_found_index": "Referenssit",
    "empty_index": "Yksikään referenssi ei ole tällä hetkellä hyväksytty julkaistavaksi",
    "preview_banner": "Esikatselu: referenssiä ei ole julkaistu",
    "copy_button": "Kopioi osoite",
    "copy_copied": "Kopioitu leikepöydälle",
    "copy_refused": "Kopiointi ei onnistu",
    "cookie_region": "Evästeilmoitus",
    "cookie_text": "Northfall käyttää evästeitä ja vastaavia tekniikoita liikenteen ymmärtämiseen",
    "cookie_accept": "Hyväksy",
    "cookie_close": "Sulje evästeilmoitus",
    "pending_note": "Tämä tarina on vielä kääntämättä",
}

# Map of API ``errors`` keys to the published Finnish wording.
FI_ERROR_KEYS = {
    "email": "error_email",
    "agreed": "error_agreed",
    "phone": "error_phone",
    "reference": "error_reference",
    "body": "error_email",  # unreachable on the page: body errors never reach the form
}


def fi(key: str, **kwargs) -> str:
    if key == "count":
        if kwargs.get("n") == 1:
            return FINNISH["count_one"]
        return FINNISH["count_many"].format(n=kwargs["n"])
    text = FINNISH[key]
    if kwargs:
        text = text.format(**kwargs)
    return text
