"""Server-generated ids and tokens; seed ids are deterministic so each service can seed its own schema."""
import secrets
import uuid

SEED_NAMESPACE = uuid.UUID("5b0f6c2e-9d4a-4c1e-8f53-0a7d3e21b6c9")


def new_id() -> str:
    return uuid.uuid4().hex


def seed_id(name: str) -> str:
    return uuid.uuid5(SEED_NAMESPACE, name).hex


def workspace_key() -> str:
    return "dfk_" + secrets.token_hex(16)


def share_token() -> str:
    return secrets.token_urlsafe(32)
