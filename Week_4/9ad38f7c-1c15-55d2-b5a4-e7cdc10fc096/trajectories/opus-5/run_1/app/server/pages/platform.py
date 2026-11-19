"""The platform home, the platform pages and the not-found page."""

from __future__ import annotations

from ..markup import fmt
from .chrome import document

PLATFORM_PAGES = {
    "/hacktivities": ("Hands-on hacktivities", "Practice on guided labs and rooms."),
    "/aisecurity": ("AI Upskilling", "Build and defend AI systems safely."),
    "/classrooms": ("For Education", "Classrooms for schools and universities."),
    "/pricing": ("Pricing", "Free forever, with paid plans for teams."),
    "/business": ("For Business", "Train and measure your security team."),
    "/certifications": ("Certifications", "Prove your skills with NightWard."),
    "/about": ("About NightWard", "Who we are and how we work."),
    "/glossary": ("Glossary", "Plain definitions of security terms."),
    "/cyber-security-careers": (
        "Careers in Cyber",
        "Paths into defensive security work.",
    ),
    "/community": (
        "Community",
        "Connect with 8+ million learners online or in person",
    ),
}


def home() -> str:
    body = fmt(
        """
<section class="platform-home">
  <h1 class="page-title">Anyone can learn cyber security with NightWard</h1>
  <p class="lede">Hands-on cyber security training through real-world scenarios</p>
  <div class="platform-actions">
    <a class="button button-lime" href="/signup">Join for FREE</a>
    <a class="button button-outline" href="/downtime">It's Downtime!</a>
  </div>
</section>
""",
    )
    return document(
        "NightWard: hands-on cyber security training",
        "platform",
        body,
        body_class="page-platform",
    )


def platform_page(path: str) -> str:
    heading, line = PLATFORM_PAGES[path]
    body = fmt(
        """
<section class="platform-page">
  <h1 class="page-title">{heading}</h1>
  <p class="lede">{line}</p>
  <a class="button button-outline" href="/downtime">Back to Downtime</a>
</section>
""",
        heading=heading,
        line=line,
    )
    return document(
        f"{heading} | NightWard", "platform", body, body_class="page-platform"
    )


def not_found() -> str:
    body = fmt(
        """
<section class="not-found">
  <h1 class="page-title">Page not found</h1>
  <p class="lede">That address is not part of this event.</p>
  <a class="button button-lime" href="/downtime">Go to the Downtime event page</a>
</section>
""",
    )
    return document(
        "Page not found | NightWard", "platform", body, body_class="page-platform"
    )
