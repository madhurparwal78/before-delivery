"""The certificate page at /downtime/certificate."""

from __future__ import annotations

from ..markup import fmt
from . import icons
from .chrome import document, live_region


def render() -> str:
    body = fmt(
        """
<section class="certificate-page" data-certificate-page>
  <h1 class="page-title">Certificate of completion</h1>
  {region}
  <div class="certificate card" data-certificate hidden>
    <p class="certificate-shield">{shield}</p>
    <p class="certificate-name" data-certificate-name></p>
    <p class="certificate-team" data-certificate-team></p>
    <p class="certificate-event" data-certificate-event></p>
    <p class="certificate-window">22 to 26 October 2026</p>
    <p class="certificate-time" data-certificate-time></p>
    <button type="button" class="button button-lime" data-download-certificate>
      Download certificate</button>
  </div>
</section>
""",
        region=live_region("Certificate status"),
        shield=icons.shield(64),
    )
    return document(
        "Certificate | Downtime | NightWard",
        "certificate",
        body,
        body_class="page-certificate",
    )
