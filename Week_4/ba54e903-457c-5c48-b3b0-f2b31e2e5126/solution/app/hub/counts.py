"""Derived community counts, computed at read time so nothing stored can drift.

Use inside a query that aliases ``communities`` as ``k``.
"""

MEMBER_COUNT = "(k.member_baseline + (SELECT count(*) FROM memberships ms WHERE ms.community_id = k.id))"
PRESENCE_COUNT = (
    "(k.online_baseline + (SELECT count(*) FROM memberships ms JOIN members mm ON mm.id = ms.member_id "
    "WHERE ms.community_id = k.id AND mm.status IN ('online', 'idle', 'dnd')))"
)
