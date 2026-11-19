"""The scenario page at /downtime/scenarios/<slug>."""

from __future__ import annotations

from ..markup import Markup, fmt
from ..seed_data import KIND_LABELS, SCENARIOS, Scenario
from . import icons
from .chrome import document, live_region, solved_word


def _header(scenario: Scenario) -> Markup:
    return fmt(
        """
<p class="scenario-number" data-scenario-number>{number:02d}</p>
<h1 class="page-title" data-scenario-title>{title}</h1>
<p class="kind-label" data-scenario-kind>{kind}</p>
<p class="scenario-description" data-scenario-description>{description}</p>
<p class="scenario-points"><strong data-scenario-points>{points}</strong> XP</p>
""",
        number=scenario.number,
        title=scenario.title,
        kind=KIND_LABELS[scenario.kind],
        description=scenario.description,
        points=scenario.points,
    )


def render(scenario: Scenario) -> str:
    previous_scenario = SCENARIOS[scenario.number - 2] if scenario.number > 1 else None
    next_scenario = (
        SCENARIOS[scenario.number] if scenario.number < len(SCENARIOS) else None
    )
    body = fmt(
        """
<article class="scenario" data-scenario="{slug}" data-scenario-root>
  <div class="scenario-head">{head}</div>
  <p class="scenario-state" data-scenario-state></p>
  <p class="solved-badge" data-solved-badge hidden>{solved}</p>
  <form class="flag-form" data-flag-form>
    <label for="flag-field">Flag</label>
    <input id="flag-field" name="flag" type="text" autocomplete="off" data-flag-field>
    <button type="submit" class="button button-lime">{flag_icon}Submit flag</button>
  </form>
  {region}
  <nav class="scenario-steps" aria-label="Scenario steps">
    <button type="button" class="button button-outline" data-previous-scenario
      data-target="{previous}"{previous_state}>{arrow_left}Previous scenario</button>
    <button type="button" class="button button-outline" data-next-scenario
      data-target="{next}"{next_state}>Next scenario{arrow_right}</button>
  </nav>
</article>
""",
        slug=scenario.slug,
        head=_header(scenario),
        solved=solved_word("Solved", True),
        flag_icon=icons.flag(),
        region=live_region("Flag result"),
        previous=previous_scenario.slug if previous_scenario else "",
        previous_state=Markup("" if previous_scenario else " disabled"),
        next=next_scenario.slug if next_scenario else "",
        next_state=Markup("" if next_scenario else " disabled"),
        arrow_left=icons.arrow_left(),
        arrow_right=icons.arrow_right(),
    )
    return document(
        f"{scenario.title} | Downtime | NightWard",
        "scenario",
        body,
        body_class="page-scenario",
    )
