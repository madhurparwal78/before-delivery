"""The one seed load. Every person, client and business here is invented."""

from .passwords import hash_password

OWNER_EMAIL = "owner@example.com"
OWNER_PASSWORD = "deku-demo-pw-2026"

CASE_STUDIES = (
    {
        "slug": "hollow-signal",
        "title": "Hollow Signal",
        "discipline": "3d-web",
        "summary": (
            "A launch film for a sound hardware brand, told as a single descent "
            "through red light."
        ),
        "challenge": (
            "Thrum Acoustics had one speaker, one launch window and no retail "
            "floor to stand on. Their earlier site read like a specification "
            "sheet: eleven tabs, a carousel nobody reached, and a bounce rate "
            "that peaked eight seconds in. They needed a first frame that made "
            "a stranger stop, and they needed it to run on a mid-range phone "
            "over hotel wifi.\n\n"
            "The product itself resists photography. It is a matte black "
            "cylinder. Every shot looked like every other shot, so the story "
            "had to come from light and movement rather than from the object."
        ),
        "approach": (
            "I treated the whole page as one continuous shot. The visitor never "
            "jumps between sections; they fall through a single shaft of red "
            "light, and the speaker assembles itself around them as they go. "
            "Scroll drives a timeline rather than a position, so the descent "
            "can be paused, reversed and re-read.\n\n"
            "The geometry is generated, not imported: eighteen extruded rings "
            "and a lathe profile, built at runtime from twelve numbers. That "
            "kept the payload under 180 kilobytes and let the art direction "
            "change in an afternoon. A second, flat render path carries the "
            "same narrative with CSS alone for anyone who asks for reduced "
            "motion or arrives without WebGL."
        ),
        "outcome": (
            "Median time on page moved from eight seconds to one minute "
            "fifty-two. Pre-orders filled the first production run eleven days "
            "before the launch window closed, and two distributors reached out "
            "citing the site rather than the product. The flat render path "
            "serves nine per cent of visitors and converts slightly better "
            "than the dimensional one, which told the client something useful "
            "about their audience."
        ),
        "stack": "Three.js, WebGL, GSAP, custom GLSL, Vite, progressive enhancement",
        "year": 2026,
        "featured": True,
        "position": 1,
        "published": True,
    },
    {
        "slug": "ember-ledger",
        "title": "Ember Ledger",
        "discipline": "ui-ux",
        "summary": (
            "A reckoning tool for small foundries, where every number carries "
            "the weight of a shift."
        ),
        "challenge": (
            "Ember Ledger kept the books for forty-odd metal foundries, and "
            "every one of them ran it on a tablet beside a furnace. The "
            "operators wore gloves. The screens were dirty. The old interface "
            "had been designed for a desk, with eleven-pixel labels and a "
            "date picker that needed a stylus.\n\n"
            "Worse, the numbers were ambiguous. A pour recorded at 14:02 could "
            "belong to the shift that started at 06:00 or the one that started "
            "at 14:00, and the old screens never said which. Three customers "
            "had closed a month with the wrong totals."
        ),
        "approach": (
            "I rebuilt the interface around the glove and the glance. Targets "
            "grew to sixty logical pixels, the type scale lost its bottom three "
            "steps, and every input became a stepper or a choice rather than a "
            "free-text field. Colour was dropped as a carrier of meaning, "
            "because the tablets sat under sodium lamps that flattened it.\n\n"
            "The ambiguity problem was a modelling problem, not a visual one. I "
            "gave every entry an explicit shift, derived once and shown in "
            "words on every row, and made the shift boundary a visible divider "
            "in the day view. Closing a month now reads back the shifts it will "
            "include before it commits."
        ),
        "outcome": (
            "Mis-filed pours went from roughly nine a week across the fleet to "
            "none in the first two months. Entry time per pour dropped by "
            "thirty-one per cent in timed sessions with six operators. Support "
            "calls about month-end totals stopped entirely, which freed the "
            "client's one support engineer to build their export pipeline."
        ),
        "stack": "React, TypeScript, Radix primitives, Playwright, PostgreSQL",
        "year": 2025,
        "featured": True,
        "position": 2,
        "published": True,
    },
    {
        "slug": "night-cartography",
        "title": "Night Cartography",
        "discipline": "frontend",
        "summary": (
            "An atlas of unlit places, rendered fast enough to pan with a "
            "thumb on a train."
        ),
        "challenge": (
            "The Dim Sky Register publishes measurements of night darkness from "
            "nine thousand volunteer stations. Their atlas was a single image "
            "tile server that cost more than their field work and fell over "
            "every time an article linked to it.\n\n"
            "The data is dense, slow-changing and deeply zoomable, and their "
            "readers are amateur astronomers who browse at midnight on phones "
            "with one bar of signal. Any solution that needed a round trip per "
            "pan was going to fail them."
        ),
        "approach": (
            "I moved the atlas to vector tiles generated once per publication "
            "and served as static files, then drew them on a canvas with a "
            "hand-written renderer. No map library: the whole interaction "
            "surface is pan, zoom and pick, and writing those three directly "
            "cost less than configuring a framework around them.\n\n"
            "Darkness is a continuous value, so I built a perceptual ramp and "
            "a redundant contour layer, meaning readers who cannot separate the "
            "ramp's steps still get the boundaries. Everything renders in a "
            "worker; the main thread only ever composites."
        ),
        "outcome": (
            "Tile hosting fell from four figures a month to the cost of a "
            "static bucket. First interactive paint on a throttled 3G profile "
            "is 1.4 seconds against the old atlas's 9.6. The register has since "
            "published two papers using screenshots from the atlas, and three "
            "regional groups run their own forks of the tile build."
        ),
        "stack": "Canvas 2D, Web Workers, vector tiles, Rollup, Lighthouse CI",
        "year": 2025,
        "featured": True,
        "position": 3,
        "published": True,
    },
    {
        "slug": "vanta-atelier",
        "title": "Vanta Atelier",
        "discipline": "3d-web",
        "summary": (
            "A dimensional showroom for a one-bench furniture maker who "
            "refuses to photograph her work."
        ),
        "challenge": (
            "Rune Halvard builds eleven pieces a year from blackened ash. She "
            "had turned down every photographer she met, because a photograph "
            "fixes one light and her surfaces are built to change under many. "
            "Her sales came entirely from a waiting list she could no longer "
            "answer.\n\n"
            "She wanted commissioners to understand the grain before they "
            "wrote to her, and she wanted no stock imagery, no lifestyle "
            "framing and no price list."
        ),
        "approach": (
            "We scanned four pieces and rebuilt them as low-polygon shells "
            "carrying high-resolution material response, so the browser carries "
            "geometry in kilobytes and spends its budget on light instead. The "
            "visitor controls a single lamp. Moving it is the whole "
            "interaction, and it is the thing she wanted to show.\n\n"
            "There is no catalogue. Each piece is one page, and each page ends "
            "with a single question: what room is this for? That answer goes "
            "straight into her inbox with the lamp position attached, so she "
            "knows which face of the piece the writer was looking at."
        ),
        "outcome": (
            "Her waiting list converted into eighteen qualified commission "
            "letters in the first quarter, against five in the whole previous "
            "year. She reports that conversations now start at the material "
            "rather than the price. The lamp-position data turned out to be the "
            "most useful thing we shipped: two pieces were redesigned around "
            "the faces people kept lighting."
        ),
        "stack": "Three.js, draco meshes, IBL probes, Astro, PostgreSQL",
        "year": 2024,
        "featured": False,
        "published": True,
        "position": 4,
    },
    {
        "slug": "low-tide-radio",
        "title": "Low Tide Radio",
        "discipline": "ui-ux",
        "summary": (
            "A listening interface for a coastal station whose schedule is set "
            "by the sea."
        ),
        "challenge": (
            "Low Tide Radio broadcasts from a harbour shed and shifts its "
            "programme with the tide table, so no two weeks look the same. "
            "Their listeners are fishers, swimmers and insomniacs who want to "
            "know one thing: what is on now, and what is next.\n\n"
            "The old site answered that with a seven-column grid that nobody "
            "could read on a phone in the dark, and it published times in a "
            "time zone that drifted twice a year."
        ),
        "approach": (
            "I threw the grid away. The interface is a single column with now "
            "at the top, next underneath, and the tide that caused the "
            "arrangement stated in plain words. Everything else is one tap "
            "away.\n\n"
            "Time was the real work. Every slot is stored against the station's "
            "own day and rendered in the listener's zone with the station's day "
            "named beside it, so a swimmer in another country can tell whether "
            "tonight means tonight. The player keeps working through tunnel "
            "signal loss by holding the last thirty seconds and rejoining "
            "quietly."
        ),
        "outcome": (
            "Sessions from phones rose by sixty-four per cent in three months "
            "and average listening length nearly doubled. The station's "
            "volunteers stopped fielding schedule questions on social media. "
            "The tide-derived schedule, which had been an internal spreadsheet, "
            "is now the station's most linked page."
        ),
        "stack": "Svelte, Media Session API, Temporal polyfill, PostgreSQL",
        "year": 2024,
        "featured": False,
        "position": 5,
        "published": True,
    },
    {
        "slug": "red-meridian",
        "title": "Red Meridian",
        "discipline": "frontend",
        "summary": (
            "A standing archive for a cartography collective, still being cut "
            "down to its bones."
        ),
        "challenge": (
            "The Red Meridian collective holds four decades of survey drawings "
            "and has outlived three content systems. Nothing is lost, but "
            "nothing is findable, and every previous attempt drowned in "
            "metadata fields nobody filled in."
        ),
        "approach": (
            "We are building the archive back to front: the reading page "
            "first, then the index, then the editing tools, with each step "
            "earning the next. Only four facets survived the first cut, and "
            "every one of them is derived from the drawing itself rather than "
            "typed by a volunteer."
        ),
        "outcome": (
            "In progress. The reading page is in front of eleven members for "
            "weekly review, and the first facet pass has already surfaced two "
            "hundred drawings that no living member knew the collective held."
        ),
        "stack": "Python, Flask, PostgreSQL full-text, server-rendered HTML",
        "year": 2026,
        "featured": False,
        "position": 6,
        "published": False,
    },
)

JOURNAL_ENTRIES = (
    {
        "slug": "motion-beyond-animation",
        "title": "Motion Beyond Animation",
        "published_on": "2026-07-01",
        "published": True,
        "excerpt": (
            "Animation is decoration until it carries a fact. Here is the test "
            "I run before a single keyframe is allowed to ship."
        ),
        "body": (
            "There is a question I ask of every moving thing I build, and it "
            "is not whether the easing feels nice. It is this: if I froze this "
            "motion at any frame, would the page still tell the truth? Motion "
            "that fails that question is decoration, and decoration is the "
            "first thing to break on a slow device.\n\n"
            "The motions that survive the question all do one of three jobs. "
            "They say where something came from, so a panel that rises from the "
            "bottom edge teaches you where it will go when you dismiss it. They "
            "say what is related, so two words that arrive together are read "
            "together. Or they say the system is alive, which is the only "
            "honest use for a loop. Everything else is a flourish wearing a "
            "job title.\n\n"
            "That third job is where most sites overspend. A loop is a promise "
            "that something is happening, and if nothing is happening the "
            "promise is a lie that costs battery. I allow myself a handful of "
            "loops on a page, each tied to a real state, and I stop them when "
            "their region leaves the viewport. The discipline is not "
            "aesthetic. It is that a loop you cannot justify is a loop you "
            "cannot debug.\n\n"
            "The last part of the test is the substitute. Every motion I ship "
            "has a still version that a visitor can reach by asking their "
            "operating system for less movement, and I build the still version "
            "first. If the page is not complete and readable when nothing "
            "moves, the motion was never an enhancement. It was the "
            "architecture, and the architecture was wrong."
        ),
    },
    {
        "slug": "the-psychology-of-dark-interfaces",
        "title": "The Psychology of Dark Interfaces",
        "published_on": "2026-06-14",
        "published": True,
        "excerpt": (
            "A dark page is not a light page inverted. It changes what the eye "
            "trusts, and it punishes thin contrast without mercy."
        ),
        "body": (
            "Dark interfaces get chosen for the wrong reason. Someone wants "
            "the work to look serious, inverts the palette, and discovers two "
            "weeks later that their body copy has gone muddy and their brand "
            "colour has stopped being readable. The problem is not taste. It is "
            "that light and dark grounds behave differently in the eye.\n\n"
            "On a near-black field, a bright shape blooms. Thin strokes read "
            "thinner than they measure, so a typeface at its lightest weight, "
            "which looks elegant on white, can dissolve. I compensate by "
            "letting size carry the weight: the largest words are the thinnest, "
            "and anything at body size holds a regular weight and a generous "
            "measure. That is a rule I break only when I am willing to test "
            "the result on a cheap panel in daylight.\n\n"
            "Saturated colour is the second trap. A deep red that sings against "
            "white sits at almost the same luminance as black, and the contrast "
            "ratio collapses. So the deep accent gets structural work — rules, "
            "fills, enormous script words — and never a sentence. Where a "
            "sentence has to be red, it is a lighter red chosen by measurement "
            "rather than by eye.\n\n"
            "The reward for all that restraint is attention. A dark page has "
            "almost no competing brightness, so the one thing you light up is "
            "the thing people look at. On a white page you direct attention by "
            "adding; on a black page you direct it by withholding. That is a "
            "harder discipline and a much better one."
        ),
    },
    {
        "slug": "designing-experiences-not-websites",
        "title": "Designing Experiences, Not Websites",
        "published_on": "2026-05-22",
        "published": True,
        "excerpt": (
            "Clients ask for pages. What they want is the feeling someone "
            "carries away. Those are different briefs."
        ),
        "body": (
            "Almost every brief I receive is written as a list of pages. Home, "
            "about, services, work, contact. It is a reasonable way to describe "
            "a budget and a terrible way to describe a result, because nobody "
            "has ever left a site remembering its page count. They leave "
            "remembering one moment, and usually it is a moment nobody "
            "specified.\n\n"
            "So the first thing I do with a page list is ask what the visitor "
            "should be able to say ten seconds after arriving. Not what they "
            "should know — what they should be willing to say out loud. The "
            "answers are short and often uncomfortable: this person is "
            "expensive, this is for me, these people are serious about sound. "
            "That sentence becomes the thing the first frame has to earn, and "
            "it reorders the page list immediately.\n\n"
            "Working this way makes the hard calls easier. A section that "
            "cannot be traced to the sentence gets cut rather than argued "
            "about, and the sections that survive get room they would never "
            "have had in a fair division of the page. It also changes what "
            "counts as finished: a page is finished when it is fast and "
            "correct, but an experience is finished when a stranger reacts the "
            "way the sentence predicted.\n\n"
            "The last benefit is the one clients notice. When the brief is a "
            "feeling rather than a layout, a redesign is not a rebuild. We can "
            "change the whole visual language and keep the thing that works, "
            "because the thing that works was never the layout."
        ),
    },
    {
        "slug": "unfinished-light",
        "title": "Unfinished Light",
        "published_on": "2026-08-03",
        "published": False,
        "excerpt": (
            "Notes toward a piece about the hour before a launch, when the "
            "work is done and nothing is settled yet."
        ),
        "body": (
            "This one is not ready. I am keeping it here because the hour "
            "before a launch is the most honest hour in the whole practice, and "
            "I have never managed to write about it without reaching for "
            "drama.\n\n"
            "What actually happens is quiet. The work is done. The checks pass. "
            "There is nothing left to build and some hours left to wait, and in "
            "that gap every decision you made comes back to be looked at once "
            "more without the shelter of a deadline.\n\n"
            "I want to describe that without making it sound heroic, because it "
            "is not. It is the ordinary cost of caring about a thing that will "
            "be judged in ten seconds by someone who owes you nothing. More "
            "when I have found the shape of it."
        ),
    },
)

RECOGNITIONS = (
    {
        "award": "Developer Award",
        "issuer": "Juried Web Annual",
        "awarded_on": "2026-09-26",
        "position": 1,
    },
    {
        "award": "Site of the Day",
        "issuer": "Juried Web Annual",
        "awarded_on": "2026-09-12",
        "position": 2,
    },
    {
        "award": "Honorable Mention",
        "issuer": "Juried Web Annual",
        "awarded_on": "2026-08-30",
        "position": 3,
    },
)

FIGURES = (
    {
        "value": "10+",
        "label": "Brands served",
        "caption": "Each one different. Each one demanding something sharper.",
        "position": 1,
    },
    {
        "value": "25+",
        "label": "Projects shipped",
        "caption": "Each one pushed beyond the obvious.",
        "position": 2,
    },
    {
        "value": "6+",
        "label": "Years of practice",
        "caption": "Learning fast. Moving faster.",
        "position": 3,
    },
)


def load_seed(cursor):
    """Insert the whole seed. The caller holds the seed lock."""
    cursor.execute(
        "INSERT INTO accounts (email, password_hash, role) VALUES (%s, %s, 'owner')",
        (OWNER_EMAIL, hash_password(OWNER_PASSWORD)),
    )
    for case_study in CASE_STUDIES:
        cursor.execute(
            """
            INSERT INTO case_studies (
                slug, title, discipline, summary, challenge, approach, outcome,
                stack, year, featured, position, published, published_at
            ) VALUES (
                %(slug)s, %(title)s, %(discipline)s, %(summary)s, %(challenge)s,
                %(approach)s, %(outcome)s, %(stack)s, %(year)s, %(featured)s,
                %(position)s, %(published)s,
                CASE WHEN %(published)s THEN now() END
            )
            """,
            case_study,
        )
    for entry in JOURNAL_ENTRIES:
        cursor.execute(
            """
            INSERT INTO journal_entries (
                slug, title, excerpt, body, published_on, published
            ) VALUES (
                %(slug)s, %(title)s, %(excerpt)s, %(body)s, %(published_on)s,
                %(published)s
            )
            """,
            entry,
        )
    for recognition in RECOGNITIONS:
        cursor.execute(
            """
            INSERT INTO recognitions (award, issuer, awarded_on, position)
            VALUES (%(award)s, %(issuer)s, %(awarded_on)s, %(position)s)
            """,
            recognition,
        )
    for figure in FIGURES:
        cursor.execute(
            """
            INSERT INTO figures (value, label, caption, position)
            VALUES (%(value)s, %(label)s, %(caption)s, %(position)s)
            """,
            figure,
        )
