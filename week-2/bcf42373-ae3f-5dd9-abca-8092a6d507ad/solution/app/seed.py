OWNER_EMAIL = "owner@example.com"
OWNER_PASSWORD = "deku-demo-pw-2026"

CASE_STUDIES = [
    {
        "slug": "hollow-signal", "title": "Hollow Signal", "discipline": "3d-web", "year": 2026,
        "featured": True, "position": 1, "published": True,
        "summary": "A launch film for a sound hardware brand, told as a single descent through red light.",
        "challenge": "Brightline Audio wanted its first studio monitor to feel heard before it was seen, on a page most visitors open with the sound off.",
        "approach": "A single scroll-driven descent: the speaker cone becomes a red tunnel, each chapter a frequency band, with every word readable when motion is off.",
        "outcome": "Pre-orders opened two weeks early and the launch page held visitors three times longer than the brand's previous release.",
        "stack": "Generated WebGL scenes, scroll-linked CSS reveals, a server-rendered product story",
    },
    {
        "slug": "ember-ledger", "title": "Ember Ledger", "discipline": "ui-ux", "year": 2025,
        "featured": True, "position": 2, "published": True,
        "summary": "A dark-mode banking dashboard where every number earns its place on the screen.",
        "challenge": "Corvane Credit Union members could not tell pending money from spent money on the old dashboard.",
        "approach": "A two-tone ledger with one warm accent for money that has moved and a quiet neutral for money that has not.",
        "outcome": "Support calls about pending balances fell by half in the first quarter after launch.",
        "stack": "Design system in tokens, accessible charts, keyboard-first tables",
    },
    {
        "slug": "night-cartography", "title": "Night Cartography", "discipline": "frontend", "year": 2025,
        "featured": True, "position": 3, "published": True,
        "summary": "An interactive night map of a city's late venues, fast on a phone with one bar of signal.",
        "challenge": "Lanternway needed a venue map that opened in under two seconds on crowded evening networks.",
        "approach": "Server-rendered venue lists first, a progressive map layer second, and no blocking scripts.",
        "outcome": "The map became the most shared page on the site within a month of launch.",
        "stack": "Server rendering, progressive enhancement, generated vector tiles",
    },
    {
        "slug": "vanta-atelier", "title": "Vanta Atelier", "discipline": "3d-web", "year": 2024,
        "featured": False, "position": 4, "published": True,
        "summary": "A rotating 3D lookbook for a tailoring house, stitched from light and shadow.",
        "challenge": "Vanta Atelier sold made-to-measure coats and wanted cloth to feel touchable through a screen.",
        "approach": "Procedural fabric shading, a slow orbit camera and a still fallback for every garment.",
        "outcome": "Appointment requests from the lookbook doubled over the season.",
        "stack": "Generated 3D scenes, WebGL with a static fallback, CSS transitions",
    },
    {
        "slug": "low-tide-radio", "title": "Low Tide Radio", "discipline": "ui-ux", "year": 2024,
        "featured": False, "position": 5, "published": True,
        "summary": "An independent radio app redesigned around one large play control and a live tide clock.",
        "challenge": "Low Tide Radio listeners lost the live stream inside a cluttered schedule screen.",
        "approach": "One dominant play control, a schedule that folds away, and captions for every spoken segment.",
        "outcome": "Average listening sessions grew by forty percent after the redesign.",
        "stack": "Interaction design, captioned audio player, responsive layout",
    },
    {
        "slug": "red-meridian", "title": "Red Meridian", "discipline": "frontend", "year": 2026,
        "featured": False, "position": 6, "published": False,
        "summary": "A private preview for a festival microsite still under embargo.",
        "challenge": "The festival lineup cannot be shown before the announcement.",
        "approach": "Built as a draft so nothing reaches the public index before the date.",
        "outcome": "Held as a draft until the client lifts the embargo.",
        "stack": "Server-rendered pages, generated artwork",
    },
]

JOURNAL_ENTRIES = [
    {
        "slug": "motion-beyond-animation", "title": "Motion Beyond Animation",
        "published_on": "2026-07-01", "published": True,
        "excerpt": "Why the best motion on a page is the motion that explains something.",
        "body": (
            "Motion is a sentence, not a decoration. A word that rises out of a soft blur tells the reader where "
            "to look next, and a panel that climbs from the bottom edge says that something new has arrived.\n\n"
            "I start every motion study with the still frame. If the page does not read when nothing moves, no "
            "choreography will rescue it, so every reveal on this site begins from a readable resting state.\n\n"
            "Then I ask what each movement means. A chapter arriving, a camera moving on, a studio that is "
            "online: three meanings, three gestures, and nothing that loops for its own sake.\n\n"
            "Finally I take it all away. A reader who asks for stillness should lose the drama and nothing else, "
            "which is the most honest test of whether the motion was ever carrying the story."
        ),
    },
    {
        "slug": "the-psychology-of-dark-interfaces", "title": "The Psychology of Dark Interfaces",
        "published_on": "2026-06-14", "published": True,
        "excerpt": "Black is not empty. It is the stage the work stands on.",
        "body": (
            "A dark field narrows attention. Light text on near-black reads like a voice in a quiet room, and the "
            "eye goes where the light is.\n\n"
            "That focus is earned with restraint. One accent colour, used for hairlines and the largest words, "
            "keeps the darkness feeling deliberate rather than gloomy.\n\n"
            "The danger is contrast. A beautiful deep red is unreadable as body copy on black, so it belongs to "
            "borders, bands and glows, never to the sentences a visitor has to read.\n\n"
            "Done well, a dark interface feels like the moment before a film starts: the room goes quiet, and "
            "whatever appears next has your full attention."
        ),
    },
    {
        "slug": "designing-experiences-not-websites", "title": "Designing Experiences, Not Websites",
        "published_on": "2026-05-22", "published": True,
        "excerpt": "A website is a place a person passes through. Design the passage.",
        "body": (
            "Start with the moment a visitor arrives and the moment they leave, then design everything between "
            "as one continuous scene.\n\n"
            "The chapters of a page are acts in a film. Each one should hand the visitor to the next, with a "
            "change of pace that feels intentional rather than accidental.\n\n"
            "Navigation is part of the story too. A case study that knows its place in the catalogue, and offers "
            "the one before and the one after, keeps people moving instead of searching.\n\n"
            "When the passage is right, nobody notices the structure. They only remember how it felt to move "
            "through it."
        ),
    },
    {
        "slug": "unfinished-light", "title": "Unfinished Light",
        "published_on": "2026-08-03", "published": False,
        "excerpt": "Notes on lighting scenes that are not finished yet.",
        "body": (
            "Some scenes refuse to settle. The light is almost right, and almost is the hardest place to stop.\n\n"
            "This entry collects the experiments that did not ship, and why each one taught me something.\n\n"
            "It stays unpublished until the last of them has an ending."
        ),
    },
]

RECOGNITIONS = [
    {"award": "Developer Award", "issuer": "Juried Web Annual", "awarded_on": "2026-09-26", "position": 1},
    {"award": "Site of the Day", "issuer": "Juried Web Annual", "awarded_on": "2026-09-12", "position": 2},
    {"award": "Honorable Mention", "issuer": "Juried Web Annual", "awarded_on": "2026-08-30", "position": 3},
]

FIGURES = [
    {"value": "10+", "label": "Brands served",
     "caption": "Each one different. Each one demanding something sharper.", "position": 1},
    {"value": "25+", "label": "Projects shipped", "caption": "Each one pushed beyond the obvious.", "position": 2},
    {"value": "6+", "label": "Years of practice", "caption": "Learning fast. Moving faster.", "position": 3},
]
