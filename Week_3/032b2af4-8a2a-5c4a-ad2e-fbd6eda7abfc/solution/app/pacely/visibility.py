"""The one visibility rule for activities.

Every route and every listing builds its query with `visible_to`, so whether an activity may be seen is decided here
and nowhere else. The SQL expects the activities table aliased `a` and its owner's athletes row aliased `o`.
"""

ACCEPTED_FOLLOWEES = "SELECT followee_id FROM follows WHERE follower_id = {viewer} AND status = 'accepted'"

VISIBLE = """(
    a.athlete_id = {viewer}
    OR (a.visibility <> 'only_me' AND (
        a.athlete_id IN (""" + ACCEPTED_FOLLOWEES + """)
        OR (a.visibility = 'everyone' AND NOT o.private)
    ))
)"""


def followees_of(viewer_param: str) -> str:
    """SQL subquery: the athletes the viewer follows with an accepted follow."""
    return ACCEPTED_FOLLOWEES.format(viewer=viewer_param)


def visible_to(viewer_param: str) -> str:
    """SQL condition: the activity is visible to the athlete bound at `viewer_param` (for example "$1")."""
    return VISIBLE.format(viewer=viewer_param)
