"""The site's pinned copy, in one place."""

from .fields import CASE_STUDY_NUMBER_LIMITS, CASE_STUDY_TEXT_LIMITS

SITE_NAME = "Ivo Kastrel"
DESCRIPTION = "Cinematic web experiences by a solo creative developer."

HOME_TITLE = (
    "Ivo Kastrel - Front-End Developer, UI/UX Designer and 3D Web Developer"
)
WORK_TITLE = "Ivo Kastrel - Work"
JOURNAL_TITLE = "Ivo Kastrel - Journal"
CONTACT_TITLE = "Ivo Kastrel - Contact"
STUDIO_LOGIN_TITLE = "Ivo Kastrel - Studio sign-in"
STUDIO_TITLE = "Ivo Kastrel - Studio"
NOT_FOUND_TITLE = "Ivo Kastrel - Nothing at this address"
OFFLINE_TITLE = "Ivo Kastrel - Briefly offline"

HERO_INTRODUCTION = (
    "I create digital experiences that aren't just seen, they're felt. From the "
    "first impression to the smallest interaction, I focus on making every "
    "experience clear, immersive, and memorable."
)
ROLE_STACK = ("VISUAL STORYTELLER", "UI/UX DESIGNER", "3D WEB DEVELOPER")
HERO_STATEMENT = "IT WAS ALWAYS GOING TO BE THIS WAY"
ABOUT_MANIFESTO = (
    "I don't build websites, I build experiences people enjoy exploring."
)
SERVICES_INTRO = (
    "Design attracts attention. Development brings it to life. I combine both to "
    "create websites that not only look exceptional but also feel fast, clear, "
    "and memorable."
)

SERVICES = (
    {
        "discipline": "ui-ux",
        "title": "UI/UX",
        "description": (
            "Interfaces built around the one thing a visitor came to do, then "
            "tested with the people who have to use them every day."
        ),
        "capabilities": (
            "Interface Design",
            "Design Systems",
            "Prototyping",
            "Usability Testing",
        ),
    },
    {
        "discipline": "3d-web",
        "title": "3D WEB",
        "description": (
            "Dimensional scenes that load fast, stay readable and fall back to a "
            "flat telling of the same story."
        ),
        "capabilities": (
            "Frontend Engineering",
            "Three.js / WebGL",
            "GSAP Animation",
            "Performance Optimization",
        ),
    },
    {
        "discipline": "frontend",
        "title": "FRONTEND",
        "description": (
            "Server-rendered pages that are correct before a single script runs, "
            "then improved by the scripts that do run."
        ),
        "capabilities": (
            "Semantic HTML",
            "Accessible Components",
            "Progressive Enhancement",
            "Core Web Vitals",
        ),
    },
)

PROCESS_STEPS = (
    {
        "number": "01",
        "title": "Discovery",
        "body": (
            "Every great story begins with understanding. I explore your vision, "
            "audience, and goals to uncover the foundation for an experience that "
            "feels authentic and unforgettable."
        ),
    },
    {
        "number": "02",
        "title": "Creative Direction",
        "body": (
            "Ideas take shape through thoughtful research, wireframes, visual "
            "exploration, motion concepts, and design systems."
        ),
    },
    {
        "number": "03",
        "title": "Digital Craftsmanship",
        "body": (
            "With strategy in place, I transform concepts into immersive "
            "experiences, with every line of code crafted for performance, "
            "accessibility, and lasting impact."
        ),
    },
    {
        "number": "04",
        "title": "Launch & Evolution",
        "body": (
            "A successful launch is only the beginning. I monitor, refine, and "
            "evolve the product to keep it relevant, engaging, and aligned with "
            "business goals."
        ),
    },
)

CLOSING_LINE_LEAD = (
    "From the First Idea to the Final Frame Every Step Is Crafted to Create an "
    "Unforgettable"
)
CLOSING_LINE_SCRIPT = "Digital Experience."

JOURNAL_INTRO = (
    "A collection of experiments, creative processes, front-end discoveries, and "
    "visual stories."
)
AWARDS_HEADING = "AWARDS & RECOGNITIONS"
AWARDS_INTRO = (
    "Forged in obsession, shaped in darkness, and recognized beyond the screen."
)
CONTACT_HEADING = "GET IN TOUCH"
CONTACT_LINE = "LET'S BE CREATIVE"

WORK_HINT = "Scroll down for more"
STATUS_PILL = "ONLINE"
BOTTOM_RAIL = ("TENSION", "IMMERSION", "IMPACT")
SOCIAL_LABELS = ("TIKTOK", "INSTAGRAM", "BEHANCE")

NAVIGATION = (
    {"label": "HOME", "href": "/"},
    {"label": "ABOUT", "href": "/#about"},
    {"label": "SERVICES", "href": "/#services"},
    {"label": "WORK", "href": "/work"},
    {"label": "BLOG", "href": "/journal"},
    {"label": "CONTACT US", "href": "/contact"},
)

PROJECT_TYPE_OPTIONS = (
    {"value": "", "label": "No preference"},
    {"value": "ui-ux", "label": "UI/UX"},
    {"value": "3d-web", "label": "3D WEB"},
    {"value": "frontend", "label": "FRONTEND"},
    {"value": "other", "label": "OTHER"},
)

DISCIPLINE_FILTERS = (
    {"label": "All", "value": None, "href": "/work"},
    {"label": "UI/UX", "value": "ui-ux", "href": "/work?discipline=ui-ux"},
    {"label": "3D WEB", "value": "3d-web", "href": "/work?discipline=3d-web"},
    {"label": "FRONTEND", "value": "frontend", "href": "/work?discipline=frontend"},
)

NOT_FOUND_HEADING = "Nothing at this address."
NOT_FOUND_LINK = "Back to the home page"
OFFLINE_MESSAGE = "The studio is briefly offline. Try again in a minute."

EMPTY_LIST = "Nothing here yet."
EMPTY_LIST_LINK = "See all work"

MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def calendar_date(value):
    """The stored calendar date, never shifted by a time zone."""
    return f"{MONTH_NAMES[value.month - 1]} {value.day}, {value.year}"


def catalogue_count(count):
    noun = "case study" if count == 1 else "case studies"
    return f"{count} {noun} shown."


def _editor_hints():
    """Each editor field prints its published limit beside it."""
    hints = {
        name: f"Up to {maximum} characters"
        for name, (_, maximum) in CASE_STUDY_TEXT_LIMITS.items()
    }
    title_minimum, title_maximum = CASE_STUDY_TEXT_LIMITS["title"]
    hints["title"] = f"{title_minimum} to {title_maximum} characters"
    hints["slug"] = (
        "Lowercase letters, digits and single hyphens, up to "
        f"{CASE_STUDY_TEXT_LIMITS['slug'][1]} characters"
    )
    for name, (minimum, maximum) in CASE_STUDY_NUMBER_LIMITS.items():
        hints[name] = f"A whole number from {minimum} to {maximum}"
    return hints


EDITOR_HINTS = _editor_hints()
