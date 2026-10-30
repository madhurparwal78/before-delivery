"""The markdown twin of each public page, the way a software agent reads it."""
from decimal import ROUND_HALF_UP, Decimal

from . import content

NAVIGATION = "## Navigation"


def _front_matter(title, description):
    return ["---", 'title: "%s"' % title, "description: %s" % description, "---", ""]


def _tail():
    lines = ["---", "", NAVIGATION]
    for label, href in content.NAVIGATION_TAIL:
        lines.append("- [%s](%s)" % (label, href))
    return lines


def landing():
    lines = _front_matter(content.LANDING_TITLE, content.LANDING_DESCRIPTION)
    lines += [
        "# " + content.HERO_HEADING,
        "",
        content.HERO_TEXT_ONE,
        "",
        content.HERO_TEXT_TWO,
        "",
        "[Sign up](/login)",
        "[Talk to us](/contact)",
        "",
        "## Trusted by teams building world-class agents",
        "",
        ", ".join(content.LOGOS),
        "",
        "## The GraphDB purpose-built for agents",
        "",
    ]
    for card in content.FEATURE_CARDS:
        lines.append("### " + card["title"])
        lines.append("")
        if card.get("figure"):
            lines.append("%s - %s" % (card["figure"], card["caption"]))
            lines.append("")
        if card.get("tiers"):
            lines.append(", ".join(card["tiers"]))
            lines.append("")
    lines += ["## Architecture", "", content.ARCHITECTURE_LINE, "", "### Orchestration", ""]
    for item in content.ORCHESTRATION_PANEL:
        lines.append(
            "- %s%s" % (item["label"], ": " + item["detail"] if item["detail"] else "")
        )
    lines += ["", "### Graph core", ""]
    for item in content.CORE_PANEL:
        lines.append(
            "- %s%s" % (item["label"], ": " + item["detail"] if item["detail"] else "")
        )
    lines.append("")
    for name, note in content.TIERS:
        lines.append("- %s %s" % (name, note))
    lines += ["", "## What do you use graphs for?", ""]
    for case in content.USE_CASES:
        lines += ["### " + case["name"], "", case["description"], "", "#### " + case["heading"], ""]
        for point in case["points"]:
            lines.append("- " + point)
        lines.append("")
    lines += ["## SOTA for agent applications", ""]
    for figure, caption, label in content.BENCHMARKS:
        lines.append("- %s %s (%s)" % (figure, caption, label))
    lines += ["", "## Accuracy vs context length", ""]
    lines.append("Conversation tokens: " + ", ".join(content.CHART_TICKS))
    lines.append("")
    for name, value, label in content.CHART_SERIES:
        lines.append("- %s ends at %s" % (name, label))
    lines += ["", "## Similarity isn't relevance", ""]
    for tab in content.COMPARISON_TABS:
        lines += ["### " + tab["name"], ""]
        for left, right in tab["pairs"]:
            lines.append("- %s -> %s" % (left, right))
        lines.append("")
    lines += ["## Pricing", ""]
    for plan in content.PLANS:
        lines += ["### %s" % plan["name"], "", plan["price"], ""]
        for point in plan["points"]:
            lines.append("- " + point)
        lines.append("")
    lines += [
        "### Estimate your bill",
        "",
        "Storage (GB) and Tokens ingested per month (millions) give the Ship and Scale "
        "monthly estimates.",
        "",
        "## Common questions",
        "",
    ]
    for question, answer in content.FAQS:
        lines += ["### " + question, "", answer, ""]
    lines += ["## What teams say", ""]
    for handle, _initials, quote in content.TESTIMONIALS:
        lines.append("- %s: %s" % (handle, quote))
    lines += ["", content.FOOTER_MISSION, "", content.COPYRIGHT, ""]
    lines += _tail()
    return "\n".join(lines) + "\n"


def contact():
    lines = _front_matter(content.CONTACT_TITLE, content.CONTACT_DESCRIPTION)
    lines += [
        "# " + content.CONTACT_HEADING,
        "",
        content.CONTACT_LINE,
        "",
        "[Book a call](/contact#contact-form)",
        "",
        "## Agent benchmarks",
        "",
    ]
    for figure, name in content.CONTACT_METRICS:
        lines.append("- [%s %s Read results](/#benchmarks)" % (figure, name))
    lines += [
        "",
        "## Open source",
        "",
        "[tessel-labs/tessel](/#faq)",
        "",
        "## Included with Enterprise",
        "",
    ]
    for item in content.CONTACT_ENTERPRISE:
        lines.append("- " + item)
    lines += [
        "",
        "## Send us a message",
        "",
        "Work email and Message, then Send message.",
        "",
        content.FOOTER_MISSION,
        "",
        content.COPYRIGHT,
        "",
    ]
    lines += _tail()
    return "\n".join(lines) + "\n"


TWINS = {"/": landing, "/contact": contact}


def size_label(text):
    kilobytes = Decimal(len(text.encode("utf-8"))) / Decimal(1024)
    return str(kilobytes.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def token_label(text):
    tokens = len(text) // 4
    if tokens < 1000:
        return str(tokens)
    tenths = (tokens * 10) // 1000
    return "%d.%dk" % (tenths // 10, tenths % 10)


def reader_view(path):
    text = TWINS[path]()
    return {
        "size": size_label(text),
        "tokens": token_label(text),
        "lines": list(enumerate(text.split("\n"), start=1)),
    }
