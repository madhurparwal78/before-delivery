"""The event page at /downtime."""

from __future__ import annotations

from ..assets import CAPTIONS_PATH, FILM_PATH
from ..markup import Markup, fmt, join
from ..seed_data import KIND_LABELS, SCENARIOS
from . import icons
from .chrome import document, live_region

JOIN_EVENT_TARGET = "/signup?redirect=%2Fdowntime"

CHANT = "Strange & Unusual Activity"

TOPIC_PILLS = (
    "Alert Triaging",
    "Digital Forensics",
    "Threat Hunting",
    "Malware Analysis",
)

PERKS = (
    ("Join for FREE", "Junior to manager, anyone can join!"),
    ("Real-world Simulators", "Put your defensive skills to the test"),
    ("Rewards", "Win prizes worth over $40,000"),
    ("Certificate", "Earn an official proof of your skill set"),
)

HOW_TO_ENTER = (
    "Register an account on NightWard",
    "Tell your manager and colleagues",
    "Choose any one day between Thursday 22nd and Monday 26th October",
    "Complete in a few hours, or spread it across the 5 days!",
)

LEADERBOARD_PRIZES = (
    ("1st place team", "A full team training licence for a year, plus the trophy"),
    ("2nd place team", "Six months of team training licences"),
    ("3rd place team", "Three months of team training licences"),
)

RAFFLE_PRIZES = (
    "Mechanical keyboards for ten drawn players",
    "Noise-cancelling headphones for five drawn players",
    "Conference tickets for three drawn players",
    "NightWard swag bundles for fifty drawn players",
)

WEBINAR_CARD = (
    ("FREE LIVE WEBINAR FOR MANAGERS", "webinar-kicker"),
    ("Beyond the Comfort Zone", "webinar-title"),
    ("How mature security teams build readiness", "webinar-subtitle"),
    (
        "Built for security managers, this session maps the five habits that move "
        "a SOC team from scrambling in the dark to compounding capability.",
        "webinar-body",
    ),
    ("Monday 26 October • 3:00 PM GMT", "webinar-fact"),
    ("30 minutes", "webinar-fact"),
    ("Online • Virtual Classroom", "webinar-fact"),
    (
        "Speaker: Ilse Varga, Head of Content Engineering at NightWard",
        "webinar-fact",
    ),
)

BUSINESS_CARDS = (
    (
        "Breach Range Simulator",
        "Run your whole team through a live breach, then read the gaps.",
    ),
    ("Tailored CTFs", "A private event built on your stack and your threat model."),
    (
        "Tabletops & Simulators",
        "Decision drills for the people who carry the pager.",
    ),
)

TRUST_LOGOS = (
    "GRAVELIGHT STUDIOS",
    "NORTHWIND BANK",
    "ATLAS HEALTH",
    "KESTREL TELECOM",
    "MERIDIAN RETAIL",
    "HOLLOWAY ENERGY",
)

FAQ = (
    (
        "What is Strange & Unusual Activity?",
        "Downtime's free five-day defensive security capture the flag event. A "
        "crew called Velvet Moth has broken into the network of the game studio "
        "Gravelight Studios, taken the unreleased build and stayed. You work "
        "eight scenarios to find out what is really going on.",
    ),
    (
        "When does it run?",
        "From Thursday 22 October 2026 at 4:00 PM UTC to Monday 26 October 2026 "
        "at 11:59 PM UTC. Join any day: there is no waiting room and no taking a "
        "number.",
    ),
    (
        "How long does it take?",
        "A few hours if you push, or spread it across the five days. You play at "
        "your own pace and your progress is kept.",
    ),
    (
        "How can I prepare for the simulators?",
        fmt(
            "Nothing to install and nothing to book. Bring a browser, a team and "
            'your note-taking habits, or warm up on our <a href="/hacktivities">'
            "hands-on labs</a>. The simulators explain themselves as you work.",
        ),
    ),
    (
        "How much does it cost?",
        "Nothing. Downtime is free for everyone, from junior analyst to manager.",
    ),
    (
        "How does scoring work?",
        "Each scenario carries fixed points: 500 for each simulator and for the "
        "tabletop, then 60, 80, 90, 100 and 120 for the five challenges. The "
        "first correct flag from your team scores those points once, so a full "
        "board is 1,950 points. There are no first-blood bonuses.",
    ),
    (
        "How do raffle tickets work?",
        "Raffle tickets are individual. You earn one for every scenario you "
        "complete yourself, even when a teammate solved it first, and two more "
        "for claiming the webinar bonus.",
    ),
    (
        "How is the winner decided?",
        "The team with the highest score when the event closes on Monday 26 "
        "October wins. If two teams tie, the one that completed first ranks "
        "higher. There are no first-blood bonuses.",
    ),
    (
        "What can we win?",
        "Leaderboard prizes go to the top-scoring teams, while raffle prizes are "
        "drawn from individual tickets. There is over $40,000 in prizes.",
    ),
    (
        "Do I get a certificate?",
        fmt(
            "Yes. Once your team has solved all eight scenarios, every current "
            "member can collect a certificate naming them, their team and the "
            'event. Our <a href="/certifications">certifications</a> go further.',
        ),
    ),
    (
        "Who is it for?",
        fmt(
            "Blue team defensive practitioners of any level: SOC analysts, threat "
            "hunters, incident responders, and the managers who back them. Whole "
            'teams can train together <a href="/business">for business</a>.',
        ),
    ),
    (
        "Do I need a team?",
        "No. A solo player enters as a team of one, and anyone holding the invite "
        "code can join later.",
    ),
    (
        "How big can a team be?",
        "A team holds up to twenty people, and a player is in one team at a time.",
    ),
    (
        "Can I be in more than one team?",
        "No, one team at a time. Leaving a team keeps your completions and "
        "tickets with you, while the points stay with the team.",
    ),
    (
        "Can colleagues from other companies or regions join my team?",
        "Yes. Anyone holding your invite code can join, wherever they work or live.",
    ),
    (
        "Will my company's name be on the leaderboard?",
        "Only the team name you choose is shown. Emails and player ids are never "
        "published.",
    ),
    (
        "When are winners announced?",
        "After the event closes on Monday 26 October, once the final leaderboard "
        "and the raffle draw are confirmed.",
    ),
)

POSTER = (
    "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3."
    "org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%209%22%3E%3Crect%20width%3D"
    "%2216%22%20height%3D%229%22%20fill%3D%22%2307090f%22%2F%3E%3Ccircle%20cx"
    "%3D%224%22%20cy%3D%223%22%20r%3D%221.1%22%20fill%3D%22%23c6ff2e%22%20"
    "opacity%3D%22.5%22%2F%3E%3Ccircle%20cx%3D%2212%22%20cy%3D%225%22%20r%3D"
    "%22.8%22%20fill%3D%22%2384a9ff%22%20opacity%3D%22.4%22%2F%3E%3C%2Fsvg%3E"
)


def _hero() -> Markup:
    dots = join(
        fmt('<span class="dot" style="--n:{}"></span>', index) for index in range(24)
    )
    return fmt(
        """
<section class="hero" data-hero>
  <div class="hero-spotlight" aria-hidden="true"></div>
  <div class="hero-floor" aria-hidden="true"></div>
  <canvas class="hero-tail" data-tail width="420" height="520" aria-hidden="true">
  </canvas>
  <div class="hero-inner">
    <h1 class="hero-title">
      <span class="visually-hidden">It's Downtime!</span>
      <span class="title-visual" aria-hidden="true">IT'S
        <span class="title-swap">
          <del class="title-show">SHOW</del>
          <svg class="title-scribble" viewBox="0 0 200 40" preserveAspectRatio="none"
            aria-hidden="true" focusable="false"><path d="M4 30C40 10 70 32 104 14
            138 0 168 26 196 10" fill="none" stroke="currentColor" stroke-width="6"
            stroke-linecap="round"/></svg>
          <span class="title-down">DOWN</span>
        </span>TIME!</span>
    </h1>
    <p class="hero-eyebrow">Thu 22nd to Mon 26th Oct. Join any day. Simulator-Led
      CTF Event.</p>
    <p class="start-badge">Starts Thursday 22 October, 4:00 PM UTC</p>
    <p class="hero-tagline">Bring a team, or brave it solo, to find out what's
      really going on inside a haunted network. Built for blue team defensive
      practitioners of any level, with prizes for top players.</p>
    <div class="hero-actions">
      <span class="join-wrap">
        <span class="join-glow" aria-hidden="true"></span>
        <span class="join-dots" aria-hidden="true">{dots}</span>
        <a class="button button-lime button-join" href="{join}">Join event</a>
      </span>
      <button type="button" class="button button-dark" data-create-team>Create a
        team</button>
    </div>
    <p class="hero-chant"><span>{chant}</span><span class="bullet"
      aria-hidden="true">&bull;</span><span>{chant}</span><span class="bullet"
      aria-hidden="true">&bull;</span><span class="chant-third">{chant}</span></p>
    <p class="hero-chant-note">say it three times and it shows up in your logs</p>
  </div>
</section>
""",
        dots=dots,
        join=JOIN_EVENT_TARGET,
        chant=CHANT,
    )


def _case_file() -> Markup:
    pills = join(fmt('<li class="pill">{}</li>', label) for label in TOPIC_PILLS)
    prizes = join(
        fmt("<li><strong>{}</strong> {}</li>", place, prize)
        for place, prize in LEADERBOARD_PRIZES
    )
    raffle = join(fmt("<li>{}</li>", prize) for prize in RAFFLE_PRIZES)
    steps = join(fmt("<li>{}</li>", step) for step in HOW_TO_ENTER)
    return fmt(
        """
<section class="case-file" id="case-file">
  <div class="case-file-grid">
    <div class="case-file-copy">
      <h2 class="section-title">Strange &amp; Unusual Activity
        <span class="lime">Detected</span></h2>
      <p class="case-story">Congratulations, you've been assigned the case! A crew
        called Velvet Moth has crashed a game studio's network, swiped the
        unreleased build and moved in. The help desk has filed it under
        "paranormal".</p>
      <p class="case-window">The event is open from Thursday 22 to Monday 26
        October. No waiting room, no taking a number, join the challenge at any
        time and play at your own pace.</p>
      <p class="case-raffle">Leaderboard prizes go to the top-scoring teams, while
        raffle prizes are drawn from individual tickets: you earn one for every
        challenge you complete, wherever your team ranks.</p>
      <ul class="pills">{pills}</ul>
      <button type="button" class="button button-outline" data-open-dialog="prizes">
        {trophy}View prizes</button>
      <figure class="briefing">
        <video class="briefing-film" data-film muted loop playsinline preload="none"
          poster="{poster}" width="640" height="360">
          <source src="{film}" type="video/webm">
          <track kind="captions" src="{captions}" srclang="en" label="English"
            default>
        </video>
        <figcaption class="briefing-caption">Moths circle park lights at night,
          standing in for the crew drawn to the studio network.</figcaption>
        <button type="button" class="button button-outline" data-film-toggle>Pause
          briefing</button>
      </figure>
    </div>
    <aside class="event-details card">
      <h3>Event details</h3>
      <p class="event-dates">Thursday 22nd to Monday 26th October 2026</p>
      <p class="event-hours">Starts 4:00 PM UTC &middot; Ends 11:59 PM UTC</p>
      <h4>How to enter</h4>
      <ol class="how-to-enter">{steps}</ol>
      <p class="event-nudge">Can't wait? Add it to your calendar and assemble the
        crew.</p>
      <a class="button button-lime" href="/api/event/calendar.ics"
        download="downtime.ics" data-calendar>Add to calendar</a>
    </aside>
  </div>
</section>
<dialog class="dialog" data-dialog="prizes" aria-labelledby="prizes-title">
  <div class="dialog-form">
    <h2 id="prizes-title">Prizes</h2>
    <h3>Leaderboard prizes</h3>
    <ul class="prize-list">{prizes}</ul>
    <h3>Raffle prizes</h3>
    <p class="prize-total">Over $40,000 in prizes</p>
    <ul class="prize-list">{raffle}</ul>
    <div class="dialog-actions">
      <button type="button" class="button button-lime" data-dialog-close>Close</button>
    </div>
    <button type="button" class="dialog-close" data-dialog-close
      aria-label="Close dialog">{cross}</button>
  </div>
</dialog>
""",
        pills=pills,
        trophy=icons.trophy(),
        poster=Markup(POSTER),
        film=FILM_PATH,
        captions=CAPTIONS_PATH,
        steps=steps,
        prizes=prizes,
        raffle=raffle,
        cross=icons.cross(),
    )


def _perks() -> Markup:
    cards = join(
        fmt(
            '<li class="card perk"><h3>{}</h3><p>{}</p></li>',
            title,
            line,
        )
        for title, line in PERKS
    )
    return fmt('<section class="perks"><ul class="perk-grid">{}</ul></section>', cards)


def _team_band() -> Markup:
    return fmt(
        """
<section class="team-band" id="registration">
  <h2 class="section-title">Form your team</h2>
  <p>Nobody likes checking the attic alone!</p>
  <p>Prizes go to the teams at the top of the leaderboard, and because every
    challenge tests a different skill set, well-rounded professional teams have the
    advantage. Solo players can enter as a team of one.</p>
  <p>Raffle tickets are individual: you earn one for every challenge you complete,
    wherever your team ranks.</p>
  <div class="team-band-actions">
    <button type="button" class="button button-lime" data-create-team>Create a
      team</button>
    <button type="button" class="button button-outline" data-join-team>Join an
      existing team</button>
  </div>
  {region}
</section>
{dialogs}
""",
        region=live_region("Team messages"),
        dialogs=team_dialogs(),
    )


def team_dialogs() -> Markup:
    return fmt(
        """
<dialog class="dialog" data-dialog="create-team" aria-labelledby="create-team-title">
  <form class="dialog-form" data-create-team-form>
    <h2 id="create-team-title">Create a team</h2>
    <label for="team-name-field">Team name</label>
    <input id="team-name-field" name="name" type="text" autocomplete="off"
      data-team-name aria-describedby="team-name-error">
    <p class="field-error" id="team-name-error" data-field-error></p>
    <div class="dialog-actions">
      <button type="submit" class="button button-lime">Create team</button>
      <button type="button" class="button button-outline" data-dialog-close>Cancel
      </button>
    </div>
    <button type="button" class="dialog-close" data-dialog-close
      aria-label="Close dialog">{cross}</button>
  </form>
</dialog>
<dialog class="dialog" data-dialog="join-team" aria-labelledby="join-team-title">
  <form class="dialog-form" data-join-team-form>
    <h2 id="join-team-title">Join an existing team</h2>
    <label for="invite-code-field">Invite code</label>
    <input id="invite-code-field" name="invite_code" type="text" autocomplete="off"
      data-invite-code aria-describedby="invite-code-error">
    <p class="field-error" id="invite-code-error" data-field-error></p>
    <div class="dialog-actions">
      <button type="submit" class="button button-lime">Join team</button>
      <button type="button" class="button button-outline" data-dialog-close>Cancel
      </button>
    </div>
    <button type="button" class="dialog-close" data-dialog-close
      aria-label="Close dialog">{cross}</button>
  </form>
</dialog>
""",
        cross=icons.cross(),
    )


def _prop(kind: str) -> Markup:
    shapes = {
        "skull": '<circle cx="20" cy="18" r="13"/><rect x="13" y="29" width="14"'
        ' height="8" rx="3"/><circle cx="15" cy="16" r="3.2" fill="currentColor"/>'
        '<circle cx="25" cy="16" r="3.2" fill="currentColor"/>',
        "lily": '<path d="M20 36V18"/><path d="M20 18c-8-2-12-8-12-13 6 0 11 5 12 '
        '13Z"/><path d="M20 18c8-2 12-8 12-13-6 0-11 5-12 13Z"/>',
        "computer": '<rect x="5" y="8" width="30" height="20" rx="2"/>'
        '<path d="M16 34h8"/><path d="M20 28v6"/><path d="M11 14h10"/>',
        "ghost": '<path d="M8 36V18a12 12 0 0 1 24 0v18l-4-4-4 4-4-4-4 4Z"/>'
        '<circle cx="15" cy="18" r="2.4" fill="currentColor"/>'
        '<circle cx="25" cy="18" r="2.4" fill="currentColor"/>',
    }
    return fmt(
        '<svg class="prop prop-{}" viewBox="0 0 40 40" width="40" height="40"'
        ' aria-hidden="true" focusable="false" fill="none" stroke="currentColor"'
        ' stroke-width="1.6">{}</svg>',
        Markup(kind),
        Markup(shapes[kind]),
    )


def _trail() -> Markup:
    props = ("skull", "lily", "computer", "ghost")
    blocks = join(
        fmt(
            """
<li class="trail-block {side}" style="--i:{index}">
  <article class="card block-card">
    <span class="block-dashes" aria-hidden="true">-----</span>
    <h3 class="block-title"><a href="/downtime/scenarios/{slug}">{title}</a></h3>
    <p class="kind-label">{kind}</p>
    <p class="block-description">{description}</p>
    <p class="block-state" data-block-state="{slug}"></p>
  </article>
  <span class="trail-orb" data-orb style="--i:{index}">
    <span class="orb-number">{number:02d}</span>
  </span>
  {prop}
</li>
""",
            side=Markup("block-left" if scenario.number % 2 else "block-right"),
            index=scenario.number - 1,
            slug=scenario.slug,
            title=scenario.title,
            kind=KIND_LABELS[scenario.kind],
            description=scenario.description,
            number=scenario.number,
            prop=_prop(props[(scenario.number - 1) % len(props)]),
        )
        for scenario in SCENARIOS
    )
    return fmt(
        """
<section class="trail" data-trail>
  <h2 class="section-title">Things are about to get strange. Here's what's waiting
    for you inside the SOC</h2>
  <p>Every room is a mission. Every mission builds a skill.</p>
  <p>Complete all and go from padawan to cyber operative.</p>
  <div class="trail-track" aria-hidden="true">
    <svg class="trail-svg" viewBox="0 0 200 2400" preserveAspectRatio="none"
      aria-hidden="true" focusable="false">
      <path class="trail-base" d="M100 0C40 150 160 300 100 450 40 600 160 750 100
        900 40 1050 160 1200 100 1350 40 1500 160 1650 100 1800 40 1950 160 2100 100
        2400" fill="none" stroke="currentColor" stroke-width="10"
        stroke-linecap="round"/>
      <path class="trail-draw" d="M100 0C40 150 160 300 100 450 40 600 160 750 100
        900 40 1050 160 1200 100 1350 40 1500 160 1650 100 1800 40 1950 160 2100 100
        2400" fill="none" stroke="currentColor" stroke-width="10"
        stroke-linecap="round"/>
    </svg>
  </div>
  <ol class="trail-blocks">{blocks}</ol>
</section>
""",
        blocks=blocks,
    )


def _webinar() -> Markup:
    card = join(
        fmt('<p class="{}">{}</p>', Markup(css_class), line)
        for line, css_class in WEBINAR_CARD
    )
    return fmt(
        """
<section class="webinar" id="webinar">
  <p class="tag">Exclusive bonus</p>
  <h2 class="section-title">Invite your manager to our exclusive webinar. They get
    the readiness playbook, you get +2 raffle tickets.</h2>
  <div class="card webinar-card">{card}</div>
  <div class="webinar-share">
    <h3>Share the webinar with your manager</h3>
    <button type="button" class="button button-outline" data-copy-webinar>Copy
      link</button>
    <p class="hint">Copy the link or post it wherever they'll see it</p>
  </div>
  <div class="webinar-claim">
    <p>Enter the flag shared during the webinar to claim 2 extra raffle tickets.</p>
    <form class="webinar-form" data-webinar-form hidden>
      <label for="webinar-flag-field">Webinar flag</label>
      <input id="webinar-flag-field" name="flag" type="text" autocomplete="off"
        data-webinar-flag>
      <button type="submit" class="button button-lime">Claim tickets</button>
    </form>
    <a class="button button-outline" data-webinar-login
      href="/login?redirect=%2Fdowntime%23webinar">Log in to submit flag</a>
  </div>
  {region}
</section>
""",
        card=card,
        region=live_region("Webinar messages"),
    )


def _leaderboard() -> Markup:
    return fmt(
        """
<section class="leaderboard" id="leaderboard">
  <h2 class="section-title">{trophy}Live Leaderboard</h2>
  <p class="lede">See who's making moves while everyone else waits.</p>
  <div class="leaderboard-grid">
    <div class="leaderboard-main">
      <div class="table-wrap">
        <table class="board-table" data-board-table>
          <caption>Live Leaderboard</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Team</th>
              <th scope="col" class="sim-column">SOC Simulator</th>
              <th scope="col" class="sim-column">TH Simulator</th>
              <th scope="col" class="sim-column">Tabletop</th>
              <th scope="col">Challenges</th>
              <th scope="col">Points</th>
            </tr>
          </thead>
          <tbody data-board-rows></tbody>
        </table>
      </div>
      <nav class="board-pages" aria-label="Leaderboard pages">
        <button type="button" class="page-button" data-board-previous>
          {arrow_left}Previous</button>
        <span class="page-numbers" data-board-numbers></span>
        <button type="button" class="page-button" data-board-next>Next
          {arrow_right}</button>
      </nav>
      <p class="page-line" data-board-line></p>
      {region}
    </div>
    <div class="activity">
      <h3>Activity feed</h3>
      <ul class="feed" aria-label="Activity feed" data-feed></ul>
    </div>
  </div>
</section>
""",
        trophy=icons.trophy(),
        arrow_left=icons.arrow_left(),
        arrow_right=icons.arrow_right(),
        region=live_region("Leaderboard updates"),
    )


def _closing() -> Markup:
    pixels = join(
        fmt('<span class="pixel" style="--n:{}"></span>', index) for index in range(72)
    )
    cards = join(
        fmt(
            '<li class="card business-card"><h3>{}</h3><p>{}</p>'
            '<a class="button button-outline" href="/business">Explore {}</a></li>',
            title,
            line,
            title,
        )
        for title, line in BUSINESS_CARDS
    )
    marquee = join(
        fmt('<li class="trust-logo">{}</li>', name) for name in TRUST_LOGOS * 2
    )
    return fmt(
        """
<section class="count-band">
  <div class="pixels" aria-hidden="true">{pixels}</div>
  <h2 class="section-title">1,384+ security teams already signed up</h2>
  <p class="count-nudge">What are you waiting for?</p>
</section>
<section class="business-band">
  <h2 class="section-title">Dig up your team's capability gaps before something
    darker does</h2>
  <ul class="business-grid">{cards}</ul>
</section>
<section class="trust" aria-label="Trusted by">
  <ul class="trust-marquee">{marquee}</ul>
</section>
""",
        pixels=pixels,
        cards=cards,
        marquee=marquee,
    )


def _faq() -> Markup:
    items = join(
        fmt(
            """
<li class="faq-item">
  <h3><button type="button" class="faq-question" aria-expanded="false"
    aria-controls="faq-answer-{index}" id="faq-question-{index}">{question}</button></h3>
  <div class="faq-answer" id="faq-answer-{index}" role="region"
    aria-labelledby="faq-question-{index}" hidden><p>{answer}</p></div>
</li>
""",
            index=index,
            question=question,
            answer=answer,
        )
        for index, (question, answer) in enumerate(FAQ, start=1)
    )
    return fmt(
        '<section class="faq" id="faq"><h2 class="section-title">FAQs</h2>'
        '<ul class="faq-list">{}</ul></section>',
        items,
    )


def render() -> str:
    body = fmt(
        "{hero}{case}{perks}{team}{trail}{webinar}{board}{closing}{faq}",
        hero=_hero(),
        case=_case_file(),
        perks=_perks(),
        team=_team_band(),
        trail=_trail(),
        webinar=_webinar(),
        board=_leaderboard(),
        closing=_closing(),
        faq=_faq(),
    )
    return document(
        "It's Downtime! Strange & Unusual Activity | NightWard",
        "event",
        body,
        body_class="page-event",
    )
