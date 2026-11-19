"""The team room at /downtime/team."""

from __future__ import annotations

from ..markup import fmt
from . import icons
from .chrome import document, live_region
from .event import team_dialogs


def render() -> str:
    body = fmt(
        """
<section class="team-room" data-team-room>
  <h1 class="page-title">Team room</h1>
  {region}
  <div class="team-room-body" data-room-body hidden>
    <h2 class="team-name" data-room-team-name></h2>
    <div class="team-code-row">
      <p class="team-code">Invite code <code data-room-code></code></p>
      <button type="button" class="button button-outline" data-copy-code>Copy
        code</button>
      <button type="button" class="button button-outline" data-copy-invite-link>Copy
        invite link</button>
      <button type="button" class="button button-outline" data-new-code
        hidden>New invite code</button>
    </div>
    <p class="team-score">Score <strong data-room-score>0</strong> XP</p>
    <h3>Members</h3>
    <ul class="member-list" data-room-members></ul>
    <h3>Scenarios</h3>
    <ul class="room-scenarios" data-room-scenarios></ul>
    <div class="room-actions">
      <button type="button" class="button button-outline" data-leave-team>Leave
        team</button>
      <a class="button button-lime" href="/downtime/certificate"
        data-certificate-link hidden>{shield}Collect your certificate</a>
    </div>
  </div>
  <div class="team-room-empty" data-room-empty hidden>
    <p>You are not in a team yet.</p>
    <div class="team-band-actions">
      <button type="button" class="button button-lime" data-create-team>Create a
        team</button>
      <button type="button" class="button button-outline" data-join-team>Join an
        existing team</button>
    </div>
  </div>
</section>
<dialog class="dialog" data-dialog="leave-team" aria-labelledby="leave-team-title">
  <div class="dialog-form">
    <h2 id="leave-team-title">Leave team</h2>
    <p>Your completions and raffle tickets stay with you. The points stay with the
      team.</p>
    <div class="dialog-actions">
      <button type="button" class="button button-lime" data-confirm-leave>Leave</button>
      <button type="button" class="button button-outline" data-dialog-close>Cancel
      </button>
    </div>
    <button type="button" class="dialog-close" data-dialog-close
      aria-label="Close dialog">{cross}</button>
  </div>
</dialog>
<dialog class="dialog" data-dialog="remove-member"
  aria-labelledby="remove-member-title">
  <div class="dialog-form">
    <h2 id="remove-member-title">Remove member</h2>
    <p data-remove-member-copy></p>
    <div class="dialog-actions">
      <button type="button" class="button button-lime" data-confirm-remove>Remove
      </button>
      <button type="button" class="button button-outline" data-dialog-close>Cancel
      </button>
    </div>
    <button type="button" class="dialog-close" data-dialog-close
      aria-label="Close dialog">{cross}</button>
  </div>
</dialog>
{dialogs}
""",
        region=live_region("Team messages"),
        shield=icons.shield(),
        cross=icons.cross(),
        dialogs=team_dialogs(),
    )
    return document(
        "Team room | Downtime | NightWard", "team", body, body_class="page-team"
    )
