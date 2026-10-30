"""The state table. Every legal step for a piece is decided here."""

STATES = (
    "draft",
    "submitted",
    "in_review",
    "changes_requested",
    "cleared",
    "scheduled",
    "published",
    "withdrawn",
    "rejected",
)

ACTIONS = (
    "submit",
    "start_review",
    "clear",
    "reject",
    "revise",
    "schedule",
    "unschedule",
    "publish",
    "withdraw",
    "return_for_changes",
)

MAKER = ("maker",)
REVIEWERS = ("licence_reviewer", "access_reviewer")
LEAD = ("lead",)

# action: (from states, to state, roles, owner only, needs reason, needs day)
STEPS = {
    "submit": (("draft",), "submitted", MAKER, True, False, False),
    "start_review": (("submitted",), "in_review", REVIEWERS, False, False, False),
    "clear": (("in_review",), "cleared", LEAD, False, False, False),
    "return_for_changes": (
        ("in_review", "changes_requested"),
        "changes_requested",
        LEAD,
        False,
        True,
        False,
    ),
    "reject": (("in_review", "changes_requested"), "rejected", LEAD, False, True, False),
    "revise": (("changes_requested", "withdrawn"), "draft", MAKER, True, False, False),
    "schedule": (("cleared",), "scheduled", LEAD, False, False, True),
    "unschedule": (("scheduled",), "cleared", LEAD, False, False, False),
    "publish": (("scheduled",), "published", LEAD, False, False, False),
    "withdraw": (("published",), "withdrawn", LEAD, False, True, False),
}

REVIEW_KINDS = ("licence", "accessibility")
REVIEW_ROLE = {"licence": ("licence_reviewer",), "accessibility": ("access_reviewer",)}
REVIEW_STATE = "in_review"

LABELS = {
    "licence": "Licence",
    "accessibility": "Accessibility",
}


def step(action):
    return STEPS.get(action)


def allows(action, state):
    found = STEPS.get(action)
    return bool(found) and state in found[0]


def roles_for(action):
    found = STEPS.get(action)
    return found[2] if found else ()


def illegal(state):
    return "That is not a legal step from {}".format(state)


def review_to_state(result):
    return REVIEW_STATE if result == "pass" else "changes_requested"
