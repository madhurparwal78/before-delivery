"""The written content of the reading routes, in English and in Finnish.

Paragraph strings are authored here and hold their own markup, so a chapter body
can carry the link the programme route promises.
"""

from __future__ import annotations

MANAGERS = (
    {
        "name": "Aino Rask",
        "role": "Reference manager, ports and logistics",
        "email": "aino.rask@example.com",
        "phone": "+358 40 000 0101",
        "portrait": "portrait-aino-rask.svg",
        "alt": (
            "Illustrated portrait of Aino Rask, drawn in flat shapes: a person "
            "facing the viewer in front of a gantry crane outline."
        ),
    },
    {
        "name": "Mikael S\u00f6derholm",
        "role": "Reference manager, food and beverage",
        "email": "mikael.soderholm@example.com",
        "phone": "+358 40 000 0102",
        "portrait": "portrait-mikael-soderholm.svg",
        "alt": (
            "Illustrated portrait of Mikael S\u00f6derholm, drawn in flat shapes: a "
            "person facing the viewer in front of a row of filling-line bottles."
        ),
    },
    {
        "name": "Leena Varjo",
        "role": "Reference manager, pulp and paper",
        "email": "leena.varjo@example.com",
        "phone": "+358 40 000 0103",
        "portrait": "portrait-leena-varjo.svg",
        "alt": (
            "Illustrated portrait of Leena Varjo, drawn in flat shapes: a person "
            "facing the viewer in front of a paper reel and a drive cabinet."
        ),
    },
    {
        "name": "Tomas Brandt",
        "role": "Reference manager, rail",
        "email": "tomas.brandt@example.com",
        "phone": "+358 40 000 0104",
        "portrait": "portrait-tomas-brandt.svg",
        "alt": (
            "Illustrated portrait of Tomas Brandt, drawn in flat shapes: a person "
            "facing the viewer in front of converging rail tracks and a signal."
        ),
    },
    {
        "name": "Iiris Kallio",
        "role": "Reference manager, mining and minerals",
        "email": "iiris.kallio@example.com",
        "phone": "+358 40 000 0105",
        "portrait": "portrait-iiris-kallio.svg",
        "alt": (
            "Illustrated portrait of Iiris Kallio, drawn in flat shapes: a person "
            "facing the viewer in front of a quarry conveyor climbing to a tower."
        ),
    },
    {
        "name": "Joonas Hirvi",
        "role": "Head of the reference programme",
        "email": "joonas.hirvi@example.com",
        "phone": "+358 40 000 0106",
        "portrait": "portrait-joonas-hirvi.svg",
        "alt": (
            "Illustrated portrait of Joonas Hirvi, drawn in flat shapes: a person "
            "facing the viewer in front of a numbered row of reference cards."
        ),
    },
)

HOME_PANELS = {
    "en": (
        {
            "eyebrow": "One",
            "title": "Nominating an installation",
            "text": (
                "A project manager puts a finished installation forward once the "
                "handover is signed and the figures have settled. Nothing is "
                "written until the customer has been asked."
            ),
            "label": "How nomination works",
            "fragment": "nomination",
        },
        {
            "eyebrow": "Two",
            "title": "How a customer clears a story",
            "text": (
                "The customer reads the whole story, the result figures and any "
                "quote, and agrees in writing to the dates between which it may be "
                "public. Those dates are what keeps the library honest."
            ),
            "label": "How clearance works",
            "fragment": "clearance",
        },
        {
            "eyebrow": "Three",
            "title": "Asking for a reference call",
            "text": (
                "Some customers will take a call. Ask the desk and we will say who "
                "is willing, what they agreed to discuss and how long they have."
            ),
            "label": "Ask the reference desk",
            "fragment": None,
        },
    ),
    "fi": (
        {
            "eyebrow": "Yksi",
            "title": "Toimituksen nime\u00e4minen",
            "text": (
                "Projektip\u00e4\u00e4llikk\u00f6 esitt\u00e4\u00e4 valmista "
                "toimitusta ohjelmaan, kun luovutus on allekirjoitettu ja luvut "
                "ovat vakiintuneet. Mit\u00e4\u00e4n ei kirjoiteta ennen kuin "
                "asiakkaalta on kysytty."
            ),
            "label": "N\u00e4in nime\u00e4minen toimii",
            "fragment": "nomination",
        },
        {
            "eyebrow": "Kaksi",
            "title": "N\u00e4in asiakas hyv\u00e4ksyy tarinan",
            "text": (
                "Asiakas lukee koko tarinan, tulosluvut ja mahdollisen sitaatin "
                "ja hyv\u00e4ksyy kirjallisesti p\u00e4iv\u00e4m\u00e4\u00e4r\u00e4t, "
                "joiden v\u00e4lill\u00e4 se saa olla julkinen. Juuri ne "
                "p\u00e4iv\u00e4m\u00e4\u00e4r\u00e4t pit\u00e4v\u00e4t kirjaston "
                "rehellisen\u00e4."
            ),
            "label": "N\u00e4in hyv\u00e4ksynt\u00e4 toimii",
            "fragment": "clearance",
        },
        {
            "eyebrow": "Kolme",
            "title": "Referenssipuhelun pyyt\u00e4minen",
            "text": (
                "Osa asiakkaista suostuu puheluun. Kysy toimistolta, niin kerromme "
                "kuka on valmis keskustelemaan, mist\u00e4 h\u00e4n on sopinut "
                "puhuvansa ja kuinka paljon aikaa h\u00e4nell\u00e4 on."
            ),
            "label": "Kysy referenssitoimistolta",
            "fragment": None,
        },
    ),
}

PROGRAMME_CHAPTERS = {
    "en": (
        {
            "fragment": "nomination",
            "eyebrow": "Chapter one",
            "paragraphs": (
                "A reference begins as a nomination from the people who did the work. "
                "When a handover is signed, the project manager writes down what the "
                "installation was asked to do, what it now does, and which figures "
                "can be measured rather than claimed. That note goes to the reference "
                "desk, not to the library.",
                "The desk then asks the customer whether they are willing to be "
                "written about at all. Many are not, and that is the end of it. "
                "Nothing about a declined nomination appears anywhere, including in "
                "the numbers you can see on the "
                '<a href="{index}">reference library</a>.',
            ),
        },
        {
            "fragment": "clearance",
            "eyebrow": "Chapter two",
            "paragraphs": (
                "Clearance is the customer's written agreement to one particular "
                "account of their installation. They read the challenge as we have "
                "described it, the work as it was carried out, every result figure "
                "and, if they have given one, the quote with its speaker and role. "
                "They correct what is wrong before anything is published.",
                "Clearance is not a blanket permission. It covers the story in front "
                "of the customer and no other version of it. If the figures or the "
                "quote change afterwards, the clearance is spent and the story leaves "
                "the library until a new one is signed. The note "
                '<a href="{note}">What a clearance covers</a> sets out exactly which '
                "parts are included.",
            ),
        },
        {
            "fragment": "duration",
            "eyebrow": "Chapter three",
            "paragraphs": (
                "A clearance carries two dates: the first day the story may be "
                "public and the last. Both days count. On the last day the reference "
                "is still in the library; the day after, it is gone, and it goes "
                "without anyone pressing anything.",
                "Customers choose the length themselves. Two years is common, a "
                "single quarter happens when a reference is tied to a trade fair, "
                "and some customers set a window that opens later, after their own "
                "announcement. A story whose window has not opened yet is treated "
                "exactly like one whose window has closed: it is not in the "
                '<a href="{index}">library</a>, not in the sector filter, and not '
                "at any address.",
            ),
        },
        {
            "fragment": "changes",
            "eyebrow": "Chapter four",
            "paragraphs": (
                "A customer may narrow a window, end it, or withdraw a story "
                "entirely, and none of those requests needs a reason. The desk acts "
                "on the same working day. A withdrawn reference leaves every public "
                "surface at once, the numbering closes up behind it, and every "
                "address it ever held answers as though the page had never existed.",
                "We also withdraw a story ourselves when we change the part the "
                "customer cleared, and we keep it out of the library until they have "
                "read the new version and agreed to it. If the customer later signs a "
                "new clearance the reference comes back, last in the run, with a new "
                'number. <a href="{contact}">Write to the desk</a> and we will tell '
                "you which references are currently out and why, to the extent the "
                "customer has allowed us to say.",
            ),
        },
    ),
    "fi": (
        {
            "fragment": "nomination",
            "eyebrow": "Luku yksi",
            "paragraphs": (
                "Referenssi alkaa nime\u00e4misest\u00e4, jonka tekee ty\u00f6n "
                "tehnyt ryhm\u00e4. Kun luovutus on allekirjoitettu, "
                "projektip\u00e4\u00e4llikk\u00f6 kirjaa, mit\u00e4 toimitukselta "
                "pyydettiin, mit\u00e4 se nyt tekee ja mitk\u00e4 luvut voidaan "
                "mitata eik\u00e4 vain v\u00e4itt\u00e4\u00e4. Muistio menee "
                "referenssitoimistolle, ei kirjastoon.",
                "Toimisto kysyy sen j\u00e4lkeen asiakkaalta, haluaako h\u00e4n "
                "tulla kirjoitetuksi lainkaan. Moni ei halua, ja siihen asia "
                "p\u00e4\u00e4ttyy. Hyl\u00e4tyst\u00e4 nime\u00e4misest\u00e4 ei "
                "n\u00e4y miss\u00e4\u00e4n mit\u00e4\u00e4n, ei my\u00f6sk\u00e4\u00e4n "
                'luvuissa, jotka n\u00e4et <a href="{index}">referenssikirjastossa</a>.',
            ),
        },
        {
            "fragment": "clearance",
            "eyebrow": "Luku kaksi",
            "paragraphs": (
                "Hyv\u00e4ksynt\u00e4 on asiakkaan kirjallinen suostumus yhteen "
                "tiettyyn kuvaukseen h\u00e4nen toimituksestaan. H\u00e4n lukee "
                "haasteen niin kuin olemme sen kuvanneet, ty\u00f6n niin kuin se "
                "tehtiin, jokaisen tulosluvun ja mahdollisen sitaatin puhujineen ja "
                "rooleineen. H\u00e4n korjaa virheet ennen julkaisua.",
                "Hyv\u00e4ksynt\u00e4 ei ole yleisvaltuutus. Se koskee juuri sit\u00e4 "
                "tarinaa, joka asiakkaalla oli edess\u00e4\u00e4n, eik\u00e4 "
                "mit\u00e4\u00e4n toista versiota siit\u00e4. Jos luvut tai sitaatti "
                "muuttuvat j\u00e4lkeenp\u00e4in, hyv\u00e4ksynt\u00e4 on kulutettu "
                "ja tarina poistuu kirjastosta, kunnes uusi on allekirjoitettu. "
                'Muistiinpano <a href="{note}">What a clearance covers</a> kertoo '
                "tarkalleen, mitk\u00e4 osat kuuluvat hyv\u00e4ksynt\u00e4\u00e4n.",
            ),
        },
        {
            "fragment": "duration",
            "eyebrow": "Luku kolme",
            "paragraphs": (
                "Hyv\u00e4ksynn\u00e4ss\u00e4 on kaksi p\u00e4iv\u00e4m\u00e4\u00e4r\u00e4\u00e4: "
                "ensimm\u00e4inen p\u00e4iv\u00e4, jona tarina saa olla julkinen, ja "
                "viimeinen. Molemmat p\u00e4iv\u00e4t lasketaan mukaan. Viimeisen\u00e4 "
                "p\u00e4iv\u00e4n\u00e4 referenssi on vielä kirjastossa; seuraavana "
                "sit\u00e4 ei en\u00e4\u00e4 ole, eik\u00e4 kenenk\u00e4\u00e4n "
                "tarvitse painaa mit\u00e4\u00e4n.",
                "Asiakas valitsee keston itse. Kaksi vuotta on tavallinen, yksi "
                "vuosinelj\u00e4nnes tulee vastaan, kun referenssi liittyy "
                "messuihin, ja jotkut asettavat ikkunan, joka avautuu vasta "
                "my\u00f6hemmin oman tiedotteensa j\u00e4lkeen. Tarinaa, jonka ikkuna "
                "ei ole vielä avautunut, kohdellaan t\u00e4sm\u00e4lleen kuin sellaista, "
                'jonka ikkuna on sulkeutunut: se ei ole <a href="{index}">kirjastossa</a>, '
                "ei toimialasuodattimessa eik\u00e4 miss\u00e4\u00e4n osoitteessa.",
            ),
        },
        {
            "fragment": "changes",
            "eyebrow": "Luku nelj\u00e4",
            "paragraphs": (
                "Asiakas voi kapeuttaa ikkunaa, p\u00e4\u00e4tt\u00e4\u00e4 sen tai "
                "vet\u00e4\u00e4 tarinan kokonaan pois, eik\u00e4 mik\u00e4\u00e4n "
                "n\u00e4ist\u00e4 pyynn\u00f6ist\u00e4 vaadi perustelua. Toimisto "
                "toimii saman ty\u00f6p\u00e4iv\u00e4n aikana. Poistettu referenssi "
                "h\u00e4vi\u00e4\u00e4 kaikilta julkisilta pinnoilta kerralla, "
                "numerointi sulkeutuu sen j\u00e4lkeen\u00e4 ja jokainen osoite, "
                "joka sill\u00e4 on koskaan ollut, vastaa kuin sivua ei olisi "
                "ollutkaan.",
                "Poistamme tarinan my\u00f6s itse, kun muutamme sit\u00e4 osaa, jonka "
                "asiakas hyv\u00e4ksyi, ja pid\u00e4mme sen poissa kirjastosta, kunnes "
                "h\u00e4n on lukenut uuden version ja hyv\u00e4ksynyt sen. Jos asiakas "
                "my\u00f6hemmin allekirjoittaa uuden hyv\u00e4ksynn\u00e4n, referenssi "
                "palaa viimeiseksi jonoon uudella numerolla. "
                '<a href="{contact}">Kirjoita toimistolle</a>, niin kerromme, mitk\u00e4 '
                "referenssit ovat juuri nyt poissa ja miksi, siin\u00e4 m\u00e4\u00e4rin "
                "kuin asiakas on antanut meille luvan kertoa.",
            ),
        },
    ),
}

PROGRAMME_QUOTE = {
    "en": {
        "text": (
            "I said yes to the story and no to the photographs, and nobody argued "
            "with me about either."
        ),
        "speaker": "Satu Niemel\u00e4",
        "role": "Operations director, Kiela Terminals",
    },
    "fi": {
        "text": (
            "Sanoin kyll\u00e4 tarinalle ja ei valokuville, eik\u00e4 kukaan "
            "kiistellyt kummastakaan."
        ),
        "speaker": "Satu Niemel\u00e4",
        "role": "Operatiivinen johtaja, Kiela Terminals",
    },
}

PROGRAMME_FIGURES = {
    "en": (
        ("Nominations a year", "40"),
        ("Cleared for publication", "11"),
        ("Median clearance length", "24 months"),
    ),
    "fi": (
        ("Nime\u00e4misi\u00e4 vuodessa", "40"),
        ("Hyv\u00e4ksytty julkaistavaksi", "11"),
        ("Hyv\u00e4ksynn\u00e4n mediaanikesto", "24 kuukautta"),
    ),
}

STORY_CHAPTERS = {
    "en": (
        {
            "span": "2014\u20132016",
            "heading": "A folder of claims",
            "paragraphs": (
                "Northfall had been installing industrial automation for twenty "
                "years and had nothing a buyer could check. What existed was a sales "
                "folder: percentages with no method behind them, a photograph of a "
                "control room that belonged to a competitor's project, and three "
                "customer names used without anyone remembering who had agreed to it.",
                "The first thing we did was throw the folder away. The second was to "
                "write down, for every installation of the previous two years, which "
                "figures we could actually produce from a commissioning record. That "
                "list was much shorter than the folder, and it was the beginning of "
                "the programme.",
            ),
            "image": "story-2014.svg",
            "alt": (
                "A flat illustration of a cleared desk holding an open ring binder, "
                "a stack of loose pages pushed to one side and a single sheet of "
                "measured figures in the centre."
            ),
        },
        {
            "span": "2017\u20132019",
            "heading": "Asking properly",
            "paragraphs": (
                "We started asking customers for permission in writing, and "
                "discovered that we had been asking the wrong people. A site manager "
                "is glad to talk about a good installation; they are not the person "
                "who can agree to it being published, and putting them in that "
                "position was unfair.",
                "So clearance became a document with a name on it, a pair of dates "
                "and a list of exactly what it covered. Half of the nominations we "
                "brought forward in 2017 never reached the library, because the "
                "people with the authority to agree said no. That was not a failure "
                "of the programme. That was the programme working.",
                "By 2019 we had eight cleared references and a habit of asking first.",
            ),
            "image": "story-2017.svg",
            "alt": (
                "A flat illustration of two hands across a table, one offering a "
                "single-page agreement with two dates marked on it, the other "
                "holding a pen above the signature line."
            ),
        },
        {
            "span": "2020\u20132022",
            "heading": "The numbers that do not skip",
            "paragraphs": (
                "A customer in the food sector asked us to withdraw a story while "
                "they went through an acquisition. We took it down, and the library "
                "was left with a hole where reference four had been. Anyone could see "
                "that something had gone, and more than one visitor asked us what.",
                "That is when the library became a run of numbers that closes up. A "
                "reference takes the next number when it is cleared and gives it up "
                "when the clearance ends, and the ones behind it move forward. There "
                "is no gap to read anything into, because there is no gap.",
            ),
            "image": "story-2020.svg",
            "alt": (
                "A flat illustration of a numbered column of cards where one card "
                "has been lifted out and the cards below have slid up to close the "
                "space."
            ),
        },
        {
            "span": "2023\u20132026",
            "heading": "A library in two languages",
            "paragraphs": (
                "Most of our customers work in Finnish, and reading your own "
                "installation described in a second language is a small insult we "
                "had not thought about. We began writing cleared references in "
                "Finnish as well, one at a time, with the customer checking the "
                "Finnish text as carefully as the English.",
                "Translation is slower than we would like, and we will not use a "
                "machine for it, because a machine cannot be asked to agree to "
                "anything. Where the Finnish text is not ready yet, the Finnish page "
                "says so and shows the English, marked as English.",
                "The library now holds references from ports, food, pulp, rail and "
                "mining, and the oldest clearance still running was signed in 2023.",
            ),
            "image": "story-2023.svg",
            "alt": (
                "A flat illustration of two facing pages of the same reference, one "
                "set in English and one in Finnish, with a marker ribbon between them."
            ),
        },
    ),
    "fi": (
        {
            "span": "2014\u20132016",
            "heading": "Kansio v\u00e4itteit\u00e4",
            "paragraphs": (
                "Northfall oli asentanut teollisuusautomaatiota kaksikymment\u00e4 "
                "vuotta, eik\u00e4 meill\u00e4 ollut mit\u00e4\u00e4n, mink\u00e4 "
                "ostaja olisi voinut tarkistaa. Oli myyntikansio: prosentteja ilman "
                "menetelm\u00e4\u00e4, valokuva valvomosta, joka kuului kilpailijan "
                "projektiin, ja kolme asiakkaan nime\u00e4, joiden k\u00e4yt\u00f6st\u00e4 "
                "kukaan ei muistanut kenenk\u00e4\u00e4n sopineen.",
                "Ensimm\u00e4iseksi heitimme kansion pois. Toiseksi kirjasimme "
                "jokaisesta kahden edellisen vuoden toimituksesta, mitk\u00e4 luvut "
                "pystyimme todella tuottamaan k\u00e4ytt\u00f6\u00f6nottoaineistosta. "
                "Lista oli paljon kansiota lyhyempi, ja siit\u00e4 ohjelma alkoi.",
            ),
            "image": "story-2014.svg",
            "alt": (
                "Tasainen piirros tyhj\u00e4ksi raivatusta ty\u00f6p\u00f6yd\u00e4st\u00e4, "
                "jolla on avoin rengaskansio, syrj\u00e4\u00e4n ty\u00f6nnetty pino "
                "irtolehti\u00e4 ja keskell\u00e4 yksi arkki mitattuja lukuja."
            ),
        },
        {
            "span": "2017\u20132019",
            "heading": "Kysymme kunnolla",
            "paragraphs": (
                "Aloimme pyyt\u00e4\u00e4 asiakkailta kirjallista lupaa ja huomasimme, "
                "ett\u00e4 olimme kysyneet v\u00e4\u00e4rilt\u00e4 ihmisilt\u00e4. "
                "Ty\u00f6nj\u00e4rjest\u00e4j\u00e4 kertoo mielell\u00e4\u00e4n "
                "hyv\u00e4st\u00e4 toimituksesta, mutta h\u00e4n ei ole se, joka voi "
                "hyv\u00e4ksy\u00e4 sen julkaisemisen, ja h\u00e4nen asettaminen "
                "siihen asemaan oli ep\u00e4reilua.",
                "Niin hyv\u00e4ksynn\u00e4st\u00e4 tuli asiakirja, jossa on nimi, "
                "kaksi p\u00e4iv\u00e4m\u00e4\u00e4r\u00e4\u00e4 ja luettelo siit\u00e4, "
                "mit\u00e4 se tarkalleen kattaa. Puolet vuonna 2017 esitetyist\u00e4 "
                "nime\u00e4misist\u00e4 ei p\u00e4\u00e4tynyt kirjastoon, koska "
                "p\u00e4\u00e4t\u00f6svaltaiset ihmiset sanoivat ei. Se ei ollut "
                "ohjelman ep\u00e4onnistuminen. Se oli ohjelma toiminnassa.",
                "Vuonna 2019 meill\u00e4 oli kahdeksan hyv\u00e4ksytty\u00e4 "
                "referenssi\u00e4 ja tapa kysy\u00e4 ensin.",
            ),
            "image": "story-2017.svg",
            "alt": (
                "Tasainen piirros kahdesta k\u00e4dest\u00e4 p\u00f6yd\u00e4n yli: "
                "toinen ojentaa yhden sivun sopimusta, johon on merkitty kaksi "
                "p\u00e4iv\u00e4m\u00e4\u00e4r\u00e4\u00e4, toinen pit\u00e4\u00e4 "
                "kyn\u00e4\u00e4 allekirjoitusviivan yll\u00e4."
            ),
        },
        {
            "span": "2020\u20132022",
            "heading": "Numerot, jotka eiv\u00e4t hypp\u00e4\u00e4",
            "paragraphs": (
                "Elintarvikealan asiakas pyysi poistamaan tarinansa yrityskaupan "
                "ajaksi. Otimme sen pois, ja kirjastoon j\u00e4i reik\u00e4 siihen, "
                "miss\u00e4 referenssi nelj\u00e4 oli ollut. Kuka tahansa n\u00e4ki, "
                "ett\u00e4 jotain oli h\u00e4vinnyt, ja useampi kuin yksi vierailija "
                "kysyi mit\u00e4.",
                "Silloin kirjastosta tuli numerojono, joka sulkeutuu. Referenssi "
                "ottaa seuraavan numeron, kun se on hyv\u00e4ksytty, ja luovuttaa sen, "
                "kun hyv\u00e4ksynt\u00e4 p\u00e4\u00e4ttyy, ja sen takana olevat "
                "siirtyv\u00e4t eteenp\u00e4in. Ei ole aukkoa, josta lukea mit\u00e4\u00e4n, "
                "koska aukkoa ei ole.",
            ),
            "image": "story-2020.svg",
            "alt": (
                "Tasainen piirros numeroidusta korttipinosta, josta yksi kortti on "
                "nostettu pois ja alemmat kortit ovat liukuneet yl\u00f6s sulkemaan "
                "v\u00e4lin."
            ),
        },
        {
            "span": "2023\u20132026",
            "heading": "Kirjasto kahdella kielell\u00e4",
            "paragraphs": (
                "Suurin osa asiakkaistamme ty\u00f6skentelee suomeksi, ja oman "
                "toimituksensa lukeminen vieraalla kielell\u00e4 on pieni "
                "louk\u00e4us, jota emme olleet ajatelleet. Aloimme kirjoittaa "
                "hyv\u00e4ksytyt referenssit my\u00f6s suomeksi, yksi kerrallaan, ja "
                "asiakas tarkistaa suomenkielisen tekstin yht\u00e4 huolellisesti "
                "kuin englanninkielisen.",
                "K\u00e4\u00e4nt\u00e4minen on hitaampaa kuin haluaisimme, emmek\u00e4 "
                "k\u00e4yt\u00e4 siihen konetta, koska koneelta ei voi pyyt\u00e4\u00e4 "
                "suostumusta mihink\u00e4\u00e4n. Siell\u00e4 miss\u00e4 suomenkielinen "
                "teksti ei ole vielä valmis, suomenkielinen sivu kertoo sen ja "
                "n\u00e4ytt\u00e4\u00e4 englanninkielisen tekstin englanniksi merkittyn\u00e4.",
                "Kirjastossa on nyt referenssej\u00e4 satamista, elintarvikealalta, "
                "sellu- ja paperiteollisuudesta, raiteilta ja kaivoksista, ja vanhin "
                "voimassa oleva hyv\u00e4ksynt\u00e4 allekirjoitettiin vuonna 2023."
            ),
            "image": "story-2023.svg",
            "alt": (
                "Tasainen piirros saman referenssin kahdesta vastakkaisesta sivusta, "
                "toinen englanniksi ja toinen suomeksi, ja niiden v\u00e4liss\u00e4 "
                "kirjanmerkkinauha."
            ),
        },
    ),
}

STORY_QUOTE = {
    "en": {
        "text": (
            "The programme got useful the day we accepted that half of our best work "
            "would never be written about."
        ),
        "speaker": "Joonas Hirvi",
        "role": "Head of the reference programme",
    },
    "fi": {
        "text": (
            "Ohjelmasta tuli hy\u00f6dyllinen sin\u00e4 p\u00e4iv\u00e4n\u00e4, kun "
            "hyv\u00e4ksyimme, ettei puolesta parhaasta ty\u00f6st\u00e4mme koskaan "
            "kirjoiteta."
        ),
        "speaker": "Joonas Hirvi",
        "role": "Referenssiohjelman johtaja",
    },
}

STORY_FIGURES = {
    "en": (
        ("Years of the programme", "12"),
        ("References published in all", "27"),
        ("Still cleared today", "11"),
    ),
    "fi": (
        ("Ohjelman vuodet", "12"),
        ("Julkaistuja referenssej\u00e4 kaikkiaan", "27"),
        ("Edelleen hyv\u00e4ksyttyn\u00e4", "11"),
    ),
}

LEGAL = {
    "privacy": {
        "en": {
            "heading": "Privacy statement",
            "paragraphs": (
                "The reference desk keeps the work address you send us, the "
                "telephone number if you give one, the reference you named and the "
                "moment your enquiry arrived. We keep it so that a person can reply "
                "to you, and for no other purpose.",
                "We do not sell anything and we do not pass your address to anyone "
                "outside the reference desk. The site sets no advertising or "
                "analytics cookie. The only thing it remembers in your browser is "
                "whether you have answered the cookie notice.",
                "Write to the desk at hello@example.com to ask what we hold about "
                "you, or to ask us to delete it.",
            ),
        },
        "fi": {
            "heading": "Tietosuojaseloste",
            "paragraphs": (
                "Referenssitoimisto s\u00e4ilytt\u00e4\u00e4 l\u00e4hett\u00e4m\u00e4si "
                "ty\u00f6osoitteen, puhelinnumeron jos annat sen, nime\u00e4m\u00e4si "
                "referenssin ja hetken, jona tiedustelusi saapui. S\u00e4ilyt\u00e4mme "
                "ne, jotta ihminen voi vastata sinulle, eik\u00e4 mihink\u00e4\u00e4n "
                "muuhun tarkoitukseen.",
                "Emme myy mit\u00e4\u00e4n emmek\u00e4 luovuta osoitettasi "
                "kenellek\u00e4\u00e4n referenssitoimiston ulkopuolelle. Sivusto ei "
                "aseta mainos- tai analytiikkaev\u00e4stett\u00e4. Ainoa asia, jonka "
                "se muistaa selaimessasi, on se oletko vastannut "
                "ev\u00e4steilmoitukseen.",
                "Kirjoita toimistolle osoitteeseen hello@example.com, jos haluat "
                "tiet\u00e4\u00e4 mit\u00e4 sinusta on tallennettu tai haluat sen "
                "poistettavan.",
            ),
        },
    },
    "terms": {
        "en": {
            "heading": "Terms of participation",
            "paragraphs": (
                "A customer takes part in the reference programme by signing a "
                "clearance: a written agreement to one named account of their "
                "installation, between two dates. The agreement lists the challenge, "
                "the work, every result figure and any quote with its speaker and "
                "role.",
                "A clearance may be narrowed, ended or withdrawn at any time, without "
                "a reason and without a notice period. The desk acts on the same "
                "working day, and the reference leaves every public surface.",
                "Northfall does not publish a customer's name, logo, photographs or "
                "figures outside the cleared story, and does not reuse a cleared "
                "story in material the customer has not seen.",
            ),
        },
        "fi": {
            "heading": "Osallistumisen ehdot",
            "paragraphs": (
                "Asiakas osallistuu referenssiohjelmaan allekirjoittamalla "
                "hyv\u00e4ksynn\u00e4n: kirjallisen suostumuksen yhteen nimettyyn "
                "kuvaukseen toimituksestaan, kahden p\u00e4iv\u00e4m\u00e4\u00e4r\u00e4n "
                "v\u00e4lill\u00e4. Sopimuksessa luetellaan haaste, ty\u00f6, jokainen "
                "tulosluku ja mahdollinen sitaatti puhujineen ja rooleineen.",
                "Hyv\u00e4ksynt\u00e4\u00e4 voi kapeuttaa, se voidaan "
                "p\u00e4\u00e4tt\u00e4\u00e4 tai vet\u00e4\u00e4 pois milloin tahansa, "
                "ilman perustelua ja ilman irtisanomisaikaa. Toimisto toimii saman "
                "ty\u00f6p\u00e4iv\u00e4n aikana, ja referenssi poistuu kaikilta "
                "julkisilta pinnoilta.",
                "Northfall ei julkaise asiakkaan nime\u00e4, logoa, valokuvia tai "
                "lukuja hyv\u00e4ksytyn tarinan ulkopuolella eik\u00e4 k\u00e4yt\u00e4 "
                "hyv\u00e4ksytty\u00e4 tarinaa materiaalissa, jota asiakas ei ole "
                "n\u00e4hnyt.",
            ),
        },
    },
}
