"""Members: adding, re-roling and removing, always keeping one owner."""
from .. import audit, auth, textutil
from ..errors import TesselError
from . import databases

ROLES = ("owner", "editor", "viewer")


def listing(cur, organization_id):
    return [
        {"email": row["email"], "role": row["role"]}
        for row in cur.all(
            "SELECT email, role FROM members WHERE organization_id = %s ORDER BY email",
            (organization_id,),
        )
    ]


def add(cur, actor, email, role, password):
    databases.lock_organization(cur, actor.organization_id)
    taken = cur.value("SELECT 1 FROM members WHERE email = %s", (email,))
    if taken:
        raise TesselError("MEMBER_EXISTS")
    cur.execute(
        """
        INSERT INTO members (organization_id, email, role, password_hash, created_at)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (
            actor.organization_id,
            email,
            role,
            auth.hash_password(password),
            textutil.now(),
        ),
    )
    audit.write(cur, actor.organization_id, actor.email, "member.add", email, role)
    return {"email": email, "role": role}


def _find(cur, organization_id, email):
    row = cur.one(
        """
        SELECT id, email, role FROM members
         WHERE organization_id = %s AND email = %s
        """,
        (organization_id, email.lower()),
    )
    if row is None:
        raise TesselError("MEMBER_NOT_FOUND")
    return row


def owner_count(cur, organization_id):
    return cur.value(
        "SELECT count(*) FROM members WHERE organization_id = %s AND role = 'owner'",
        (organization_id,),
    )


def set_role(cur, actor, email, role):
    databases.lock_organization(cur, actor.organization_id)
    row = _find(cur, actor.organization_id, email)
    if row["role"] == role:
        return {"email": row["email"], "role": role}
    if row["role"] == "owner" and owner_count(cur, actor.organization_id) <= 1:
        raise TesselError("LAST_OWNER")
    cur.execute("UPDATE members SET role = %s WHERE id = %s", (role, row["id"]))
    audit.write(
        cur,
        actor.organization_id,
        actor.email,
        "member.role",
        row["email"],
        "%s -> %s" % (row["role"], role),
    )
    return {"email": row["email"], "role": role}


def remove(cur, actor, email):
    databases.lock_organization(cur, actor.organization_id)
    row = _find(cur, actor.organization_id, email)
    if row["role"] == "owner" and owner_count(cur, actor.organization_id) <= 1:
        raise TesselError("LAST_OWNER")
    cur.execute("DELETE FROM members WHERE id = %s", (row["id"],))
    audit.write(cur, actor.organization_id, actor.email, "member.remove", row["email"])
    return {"removed": True}
