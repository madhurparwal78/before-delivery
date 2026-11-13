"""Page content that is not stored: the programme and story chapters, the home service panels,
the privacy statement, the terms of participation and the six reference managers.

Each programme chapter ends on a link: its label by language, and its target beneath the language's prefix.
"""

PROGRAMME_CHAPTERS = [
    {
        "anchor": "nomination", "link_to": "/references", "link": {"en": "See what has been finished so far", "fi": "Katso, mitä on jo valmistunut"},
        "en": [
            "A reference starts when an installation is handed over. The project lead who delivered it can "
            "nominate it for the library, and so can the customer's own engineers.",
            "The desk reads the commissioning records, measures the results against the figures agreed at the "
            "start of the project and writes a first draft in plain language. Nothing is published at this stage.",
        ],
        "fi": [
            "Referenssi alkaa, kun toimitus luovutetaan. Sen toimittanut projektipäällikkö voi ehdottaa sitä "
            "kirjastoon, ja niin voivat myös asiakkaan omat insinöörit.",
            "Toimisto lukee käyttöönottoaineiston, vertaa tuloksia projektin alussa sovittuihin lukuihin "
            "ja kirjoittaa selkokielisen luonnoksen. Tässä vaiheessa mitään ei julkaista.",
        ],
    },
    {
        "anchor": "clearance", "link_to": "/notes", "link": {"en": "Read what a clearance covers", "fi": "Lue, mitä hyväksyntä kattaa"},
        "en": [
            "The customer reads the whole draft: the story, every result figure and the quote. They can correct "
            "anything, and they can say no.",
            "Before anything goes public, a steward at the desk records the customer's clearance: the first and "
            "the last day on which the story may be shown.",
        ],
        "fi": [
            "Asiakas lukee koko luonnoksen: tarinan, jokaisen tuloksen ja lainauksen. Hän voi korjata mitä "
            "tahansa, ja hän voi kieltäytyä.",
            "Ennen julkaisua toimiston vastuuhenkilö kirjaa asiakkaan hyväksynnän: ensimmäisen ja "
            "viimeisen päivän, jona tarinan saa näyttää.",
        ],
    },
    {
        "anchor": "duration", "link_to": "/references", "link": {"en": "See what is cleared today", "fi": "Katso, mitä on nyt hyväksytty"},
        "en": [
            "A clearance is a window, not a promise for ever. The story is public from its first day to its last, "
            "both included, counted in Helsinki dates.",
            "When the window closes, the story leaves the library that day, and the numbers of the stories after "
            "it close up. If the customer extends the window, the story comes back at the end of the library.",
        ],
        "fi": [
            "Hyväksyntä on aikaikkuna, ei ikuinen lupaus. Tarina on julkinen ensimmäisestä viimeiseen päiväänsä, "
            "molemmat mukaan lukien, Helsingin ajan mukaan.",
            "Kun ikkuna sulkeutuu, tarina poistuu kirjastosta samana päivänä ja sen jälkeiset numerot siirtyvät. "
            "Jos asiakas jatkaa ikkunaa, tarina palaa kirjaston loppuun.",
        ],
    },
    {
        "anchor": "changes", "link_to": "/contact", "link": {"en": "Ask the desk about a change", "fi": "Kysy toimistolta muutoksesta"},
        "en": [
            "A customer can ask for a change or for removal at any time. The desk takes a story down within one "
            "working day of the request.",
            "A story that leaves the library leaves completely: its address, its place in the filters and its "
            "number all go with it.",
        ],
        "fi": [
            "Asiakas voi pyytää muutosta tai poistoa milloin tahansa. Poistamme tarinan yhden työpäivän kuluessa "
            "pyynnöstä.",
            "Kirjastosta poistuva tarina poistuu kokonaan: sen osoite, paikka suodattimissa ja numero häviävät sen mukana.",
        ],
    },
]

PROGRAMME_QUOTE = {
    "en": ("A reference is only worth something if the customer would say the same thing to your face.",
           "Joonas Hirvi", "Head of the reference programme"),
    "fi": ("Referenssi on arvokas vain, jos asiakas sanoisi saman sinulle kasvokkain.",
           "Joonas Hirvi", "Referenssiohjelman johtaja"),
}

PROGRAMME_FIGURES = {
    "en": [("21 days", "for a customer to review a draft"), ("1 working day", "to take a story down on request"),
           ("2", "languages in the library")],
    "fi": [("21 päivää", "asiakkaalle luonnoksen tarkistamiseen"), ("1 työpäivä", "tarinan poistamiseen pyynnöstä"),
           ("2", "kieltä kirjastossa")],
}

TERMS = {
    "en": [
        "Taking part is free and voluntary. A customer may decline, change or withdraw a story at any time.",
        "Nothing is published without a recorded clearance window, and nothing stays public after it ends.",
        "Figures are published only as the customer cleared them; a changed figure is cleared again.",
    ],
    "fi": [
        "Osallistuminen on maksutonta ja vapaaehtoista. Asiakas voi kieltäytyä, muuttaa tai perua tarinan milloin tahansa.",
        "Mitään ei julkaista ilman kirjattua hyväksyntäikkunaa, eikä mikään jää julkiseksi sen päätyttyä.",
        "Luvut julkaistaan vain asiakkaan hyväksymässä muodossa; muuttunut luku hyväksytetään uudelleen.",
    ],
}

# Each chapter's photograph, with a 32 by 20 pixel copy of it inlined so the plate shows the picture
# softly before the lazy-loaded file arrives.
STORY_CHAPTERS = [
    {
        "years": ("2014", "2016"), "image": "story-harbour",
        "placeholder": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCAAUACADASIAAhEBAxEB/8QAGAAAAwEBAAAAAAAAAAAAAAAAAAMFBgT/xAAlEAACAgEEAgAHAAAAAAAAAAABAgADEQQFEiETMSJBQmKh0fH/xAAWAQEBAQAAAAAAAAAAAAAAAAABAAL/xAAXEQEBAQEAAAAAAAAAAAAAAAAAARJB/9oADAMBAAIRAxEAPwDMPo6aqs0akMT0a/nK2k0m3XcFIHJlxycY/Poylp22oEMSmUPWSJ02Ltr1tW16BWPLgGHWfYmdQ5sZVNqodLkcgFXIWzPZE5nNFa+Lylgv1AYE0+o0m3lX4X14OOgR+5J1W0K6lqcMPtjqdUlRUsbAGY1rG+PuEIIm2wknOIkO3jPeP7CEjH//2Q==",
        "en": ("A folder of case sheets", [
            "The programme began as a folder of single-page case sheets that sales engineers carried to meetings. "
            "Each sheet named a customer and a result, and few of the customers had read them.",
            "When a port operator asked to see the sheet about their own cranes, it was clear the folder had to "
            "change. From then on, every sheet went to its customer before it went anywhere else.",
        ], "Container cranes lit up along a port quay at night, their lights reflected in the dark water"),
        "fi": ("Kansiollinen tapauskuvauksia", [
            "Ohjelma alkoi kansiona yhden sivun tapauskuvauksia, joita myyntiinsinöörit veivät tapaamisiin. "
            "Jokaisessa mainittiin asiakas ja tulos, ja harva asiakas oli lukenut omaansa.",
            "Kun satamaoperaattori pyysi nähdä omista nostureistaan kirjoitetun kuvauksen, oli selvää, että "
            "kansion täytyi muuttua. Siitä lähtien jokainen kuvaus kävi ensin asiakkaalla.",
        ], "Valaistuja konttinostureita sataman laiturilla yöllä, valot heijastuvat tummaan veteen"),
    },
    {
        "years": ("2017", "2019"), "image": "story-dairy",
        "placeholder": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCAAUACADASIAAhEBAxEB/8QAGgAAAgIDAAAAAAAAAAAAAAAAAAUBBAIDBv/EACYQAAIBAwMDBAMAAAAAAAAAAAECAwAEEQUSMRMiQSFRkbGB0fD/xAAVAQEBAAAAAAAAAAAAAAAAAAABAP/EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAwDAQACEQMRAD8ArWetGWFojGiiM5VT68+3n5q/Dq13HazFYEkRTgsRjGRjFcxpsWZNoLRq3kDnH1T83dvFZ9GR+kmDghC2fUc/ukMLcAxDqLvZ+/EUuNueBxzSzU5Gjt3dWHSL9vfuZT7VF/JaiKR47kF93agDBsfHNJpA06bhwBgjFGnDS1iVow5zuDDzW7WPXpoSdoGOT/eKKKCVlN84kLMW38k5+6uaYiTvMsihlzx+aKKoa//Z",
        "en": ("Asking the customer first", [
            "Clearance became a step of its own. The desk sent each draft with its figures and asked the customer "
            "to correct anything they would not stand behind.",
            "Customers changed more than we expected: rounded numbers became exact ones, and several quotes were "
            "rewritten in the customer's own words. The stories got shorter and more believable.",
        ], "An automated bottling line, green bottles moving along a conveyor past stainless steel pipework"),
        "fi": ("Ensin kysytään asiakkaalta", [
            "Hyväksynnästä tuli oma vaiheensa. Lähetimme jokaisen luonnoksen lukuineen ja pyysimme asiakasta "
            "korjaamaan kaiken, minkä takana hän ei seisoisi.",
            "Asiakkaat muuttivat enemmän kuin odotimme: pyöristetyistä luvuista tuli tarkkoja, ja moni lainaus "
            "kirjoitettiin uudelleen asiakkaan omin sanoin.",
        ], "Automaattinen pullotuslinja, vihreät pullot kulkevat kuljettimella teräsputkistojen ohi"),
    },
    {
        "years": ("2020", "2022"), "image": "story-papermill",
        "placeholder": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCAAUACADASIAAhEBAxEB/8QAFwAAAwEAAAAAAAAAAAAAAAAAAAQFA//EACoQAAIBAwMDAQkBAAAAAAAAAAECAwARIQQFQQYSMXETFRYiMkJRYaHB/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AMxtu3bnI7aiZoWkyGibF75PaRjPFzUvU9G7hFMUiZJ4yLpIrWuPQ+KwGoeWLt0wKTKwClASEXn+0zHu25NqIkkmukRALAWL28Z/dBnremdwj7pmMESGwAMgF8cAU+uxJojATMZpe1XY8XPAHA9b3zR1FqNWZ4dSnyAKEKsA2PP+0lC2s0waSVZJ1H1MrFgQc2xnF6Cjo1Uw9vaoVQTYC3gUrtUa/EW3qVBVpblSAQcGiigodVge9iv2+zQdvHipEM0kMbNGxUo4ItzfFj+aKKD/2Q==",
        "en": ("Windows, not forever", [
            "A customer reorganised and asked for their story to come down for a year, then go back up. The "
            "programme had no way to say when a story was allowed to be public.",
            "We started recording a clearance window for every story: a first day and a last day. Stories now "
            "leave on time without anyone having to remember them.",
        ], "A black-and-white view down the aisle between two long paper machines, control desks in the foreground"),
        "fi": ("Ikkunat, ei ikuisuus", [
            "Eräs asiakas uudelleenorganisoitui ja pyysi tarinansa pois vuodeksi ja sitten takaisin. Ohjelmalla "
            "ei ollut tapaa sanoa, milloin tarina sai olla julkinen.",
            "Aloimme kirjata jokaiselle tarinalle hyväksyntäikkunan: ensimmäisen ja viimeisen päivän. Tarinat "
            "poistuvat nyt ajallaan ilman, että kenenkään tarvitsee muistaa niitä.",
        ], "Mustavalkoinen näkymä kahden pitkän paperikoneen välistä käytävää pitkin, ohjauspöydät etualalla"),
    },
    {
        "years": ("2023", "2026"), "image": "story-raildepot",
        "placeholder": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCAAUACADASIAAhEBAxEB/8QAGAAAAwEBAAAAAAAAAAAAAAAAAAEGBQP/xAAmEAABBAEEAQMFAAAAAAAAAAABAgMEEQAFEiExIhNBcTJCUYGR/8QAFgEBAQEAAAAAAAAAAAAAAAAAAgMB/8QAGREAAgMBAAAAAAAAAAAAAAAAAAMBAhMy/9oADAMBAAIRAxEAPwDbTFH4zoiPd8dGsnUajqTq7akt17hKNwH7zo3O1JaylEppXPO1q8ppYjnBRpjgd0MW1IePZARdD5zLEl9ICHJY9QV9gvFc0vUJw3FPiFNjnnJyyw4XUno+ovKZ3uJbdJVQ3iwOPYdZqQFLlkpdcVsr6U+I/gwwzRCmPqjtqDAS1weUjnrJiPqEpbhLjynCLoqNkfGGGBvI09H/2Q==",
        "en": ("A numbered library in two languages", [
            "The folder became a public library. Every cleared story takes the next number, and the numbers close "
            "up when a story leaves, so the count is always the truth.",
            "Finnish versions arrive one story at a time, once a customer has cleared the English text. A buyer "
            "can now check every claim we make against a customer who agreed to it.",
        ], "A snow-covered railway yard, parallel tracks and points fanning out between tall floodlight masts"),
        "fi": ("Numeroitu kirjasto kahdella kielellä", [
            "Kansiosta tuli julkinen kirjasto. Jokainen hyväksytty tarina saa seuraavan numeron, ja numerot "
            "siirtyvät tarinan poistuessa, joten määrä pitää aina paikkansa.",
            "Suomenkieliset versiot valmistuvat tarina kerrallaan, kun asiakas on hyväksynyt englanninkielisen "
            "tekstin.",
        ], "Luminen ratapiha, rinnakkaiset raiteet ja vaihteet haarautuvat korkeiden valaisinmastojen välissä"),
    },
]

STORY_QUOTE = {
    "en": ("The first time a customer corrected one of our figures, we knew the programme was working.",
           "Leena Varjo", "Reference manager, pulp and paper"),
    "fi": ("Kun asiakas ensimmäisen kerran korjasi yhden luvuistamme, tiesimme ohjelman toimivan.",
           "Leena Varjo", "Referenssipäällikkö, massa ja paperi"),
}

STORY_FIGURES = {
    "en": [("2014", "the first case sheet"), ("9 in 10", "customers who clear their story"),
           ("0", "stories published without a window")],
    "fi": [("2014", "ensimmäinen tapauskuvaus"), ("9/10", "asiakkaista hyväksyy tarinansa"),
           ("0", "tarinaa julkaistu ilman ikkunaa")],
}

SERVICE_PANELS = [
    {"href": "/programme#nomination", "enquiry": False,
     "en": ("Nominating an installation", "When a project is handed over, its project lead or the customer can "
            "nominate it. The desk drafts the story from the commissioning records.", "How nomination works"),
     "fi": ("Toimituksen ehdottaminen", "Kun projekti luovutetaan, projektipäällikkö tai asiakas voi ehdottaa sitä. "
            "Luonnos kirjoitetaan käyttöönottoaineiston pohjalta.", "Näin ehdottaminen toimii")},
    {"href": "/programme#clearance", "enquiry": False,
     "en": ("How a customer clears a story", "The customer reads the whole story, its figures and its quote, and "
            "agrees the dates between which it may be public.", "How clearance works"),
     "fi": ("Näin asiakas hyväksyy tarinan", "Asiakas lukee koko tarinan, sen luvut ja lainauksen, ja sopii "
            "päivät, joiden välillä se saa olla julkinen.", "Näin hyväksyntä toimii")},
    {"href": "/contact", "enquiry": True,
     "en": ("Asking for a reference call", "If a story is close to your own project, the desk can arrange a call "
            "with the customer who lived through it.", "Ask for a call"),
     "fi": ("Referenssipuhelun pyytäminen", "Jos tarina on lähellä omaa projektiasi, voimme järjestää puhelun "
            "asiakkaan kanssa, joka koki sen.", "Pyydä puhelu")},
]

PRIVACY = {
    "en": [
        "When you send an enquiry, the desk keeps your work address, the telephone number and the reference you "
        "chose, if you gave them, and the time it arrived.",
        "We use them only to answer you. An enquiry is deleted once it is answered, and nothing you send is shared "
        "with the customers in the library without your agreement.",
        "The site keeps one marker in your browser recording your answer to the cookie notice, and nothing else.",
    ],
    "fi": [
        "Kun lähetät tiedustelun, toimisto säilyttää työosoitteesi sekä antamasi puhelinnumeron, valitsemasi "
        "referenssin ja saapumisajan.",
        "Käytämme niitä vain vastataksemme sinulle. Tiedustelu poistetaan, kun siihen on vastattu, eikä mitään "
        "jaeta kirjaston asiakkaille ilman suostumustasi.",
        "Sivusto tallentaa selaimeesi vain yhden merkinnän vastauksestasi evästeilmoitukseen.",
    ],
}

MANAGERS = [
    {"name": "Aino Rask", "address": "aino.rask@example.com", "line": "+358 40 000 0101", "portrait": "portrait-aino",
     "en": "Reference manager, ports and logistics", "fi": "Referenssipäällikkö, satamat ja logistiikka"},
    {"name": "Mikael Söderholm", "address": "mikael.soderholm@example.com", "line": "+358 40 000 0102",
     "portrait": "portrait-mikael",
     "en": "Reference manager, food and beverage", "fi": "Referenssipäällikkö, elintarvikkeet ja juomat"},
    {"name": "Leena Varjo", "address": "leena.varjo@example.com", "line": "+358 40 000 0103", "portrait": "portrait-leena",
     "en": "Reference manager, pulp and paper", "fi": "Referenssipäällikkö, massa ja paperi"},
    {"name": "Tomas Brandt", "address": "tomas.brandt@example.com", "line": "+358 40 000 0104", "portrait": "portrait-tomas",
     "en": "Reference manager, rail", "fi": "Referenssipäällikkö, raideliikenne"},
    {"name": "Iiris Kallio", "address": "iiris.kallio@example.com", "line": "+358 40 000 0105", "portrait": "portrait-iiris",
     "en": "Reference manager, mining and minerals", "fi": "Referenssipäällikkö, kaivokset ja mineraalit"},
    {"name": "Joonas Hirvi", "address": "joonas.hirvi@example.com", "line": "+358 40 000 0106", "portrait": "portrait-joonas",
     "en": "Head of the reference programme", "fi": "Referenssiohjelman johtaja"},
]
