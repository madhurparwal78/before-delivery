"""API registration."""

from __future__ import annotations

from . import (
    accrual,
    attendance,
    audit,
    cover,
    exports,
    homes,
    leave,
    rota,
    session,
    shifts,
    sickness,
)

BLUEPRINTS = (
    session.blueprint,
    shifts.blueprint,
    leave.blueprint,
    rota.blueprint,
    homes.blueprint,
    attendance.blueprint,
    cover.blueprint,
    sickness.blueprint,
    accrual.blueprint,
    exports.blueprint,
    audit.blueprint,
)


def register_api(app) -> None:
    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)
    audit.register_audit_guards(app)
