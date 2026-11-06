"""API routes, registered on import."""

from wardline.routes import (
    audit,
    compartments,
    exhibits,
    files,
    links,
    redactions,
    releases,
)

__all__ = ["audit", "compartments", "exhibits", "files", "links", "redactions", "releases"]
