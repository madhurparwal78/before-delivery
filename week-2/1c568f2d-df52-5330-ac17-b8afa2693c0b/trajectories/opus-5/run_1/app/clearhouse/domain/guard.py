"""The published refusal order, in the order it is published."""
from .. import errors
from ..db import row
from ..errors import Refusal
from . import states

PREFERENCES = "preferences"
OWN_PIECE_INTENTS = ("transition:clear", "transition:publish")

INTENT_ROLES = {
    "create": states.MAKER,
    "edit_draft": states.MAKER,
    "review:licence": states.REVIEW_ROLE["licence"],
    "review:accessibility": states.REVIEW_ROLE["accessibility"],
    "ack": ("licence_reviewer",),
    "budget": states.LEAD,
    "pack": states.LEAD,
    PREFERENCES: None,
}
OWNER_ONLY_INTENTS = ("edit_draft",)


def visible_sql(account, alias="p"):
    """A maker never sees another account's draft. Decided here alone."""
    if account["role"] == "maker":
        return " and ({0}.state <> 'draft' or {0}.owner_id = %(viewer)s)".format(alias)
    return ""


def object_or_404(conn, object_id):
    if not row(conn, "select id from objects where id = %s", (object_id,)):
        raise errors.not_found()
    return object_id


def body_object(body):
    if not isinstance(body, dict):
        raise Refusal(400, errors.SEND_OBJECT)
    return body


def published_fields(body, allowed):
    for key in body:
        if key not in allowed:
            raise Refusal(400, "{} cannot be set here".format(key), field=key)
    return body


def _rules_for(intent):
    """The roles that may take this write, and whether it is the owner's alone."""
    if intent.startswith("transition:"):
        found = states.step(intent.split(":", 1)[1])
        return (found[2], found[3]) if found else ((), False)
    return INTENT_ROLES.get(intent, ()), intent in OWNER_ONLY_INTENTS


def may_act(account, intent, piece=None, licence_reviewer_id=None):
    if account["role"] == "auditor" and intent != PREFERENCES:
        raise Refusal(403, errors.ROLE_REFUSED)
    if piece is not None and piece["owner_id"] == account["id"] and (
        intent.startswith("review:") or intent in OWN_PIECE_INTENTS
    ):
        raise Refusal(403, errors.OWN_PIECE)
    if intent == "review:accessibility" and licence_reviewer_id == account["id"]:
        raise Refusal(403, errors.SECOND_REVIEWER)
    if intent == PREFERENCES:
        return
    roles, owner_only = _rules_for(intent)
    if not roles:
        # An action or review kind the tables do not name: the step check answers it.
        return
    if account["role"] not in roles:
        raise Refusal(403, errors.ROLE_REFUSED)
    if owner_only and piece is not None and piece["owner_id"] != account["id"]:
        raise Refusal(403, errors.ROLE_REFUSED)
