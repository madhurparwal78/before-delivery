"""The one home of the activity visibility rule."""

ACTIVITY_SOURCE = """
    FROM activities a
    JOIN athletes owner ON owner.id = a.athlete_id
"""

#: True when the viewer may see the activity row `a` owned by `owner`.
VISIBLE_TO_VIEWER = """(
    a.athlete_id = %(viewer_id)s
    OR (
        a.visibility <> 'only_me'
        AND (
            EXISTS (
                SELECT 1 FROM follows f
                WHERE f.follower_id = %(viewer_id)s
                  AND f.followee_id = a.athlete_id
                  AND f.status = 'accepted'
            )
            OR (a.visibility = 'everyone' AND NOT owner.private)
        )
    )
)"""
