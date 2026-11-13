"""The JSON API's route table."""
from __future__ import annotations

from typing import Any

from starlette.routing import Route

from ..state import AppState
from . import account, breaches, events, grant, holdings, meta, rules, steps
from .base import Handler, endpoint


def api_routes(state: AppState) -> list[Route]:
    def route(path: str, method: str, handler: Handler, **options: Any) -> Route:
        return Route(path, endpoint(state, handler, **options), methods=[method])

    return [
        Route("/api/health", meta.health(state), methods=["GET"]),
        Route("/api/status", meta.status(state), methods=["GET"]),
        route("/api/me", "GET", meta.me, allow_ended=True),
        route("/api/kinds", "GET", meta.kinds),
        route("/api/holdings", "GET", holdings.list_holdings, needs_view=True),
        route("/api/holdings", "POST", holdings.create_holding, owner_only=True),
        route("/api/holdings/{id}", "GET", holdings.read_holding, id_kind="holding"),
        route(
            "/api/holdings/{id}",
            "PATCH",
            holdings.update_holding,
            owner_only=True,
            id_kind="holding",
        ),
        route(
            "/api/holdings/{id}",
            "DELETE",
            holdings.delete_holding,
            owner_only=True,
            id_kind="holding",
        ),
        route("/api/rules", "GET", rules.list_rules, owner_only=True, needs_view=True),
        route("/api/rules", "POST", rules.create_rule, owner_only=True),
        route("/api/rules/order", "PUT", rules.reorder_rules, owner_only=True),
        route("/api/rules/preview", "POST", rules.preview_rules, owner_only=True),
        route("/api/rules/{id}", "PATCH", rules.update_rule, owner_only=True, id_kind="rule"),
        route("/api/rules/{id}", "DELETE", rules.delete_rule, owner_only=True, id_kind="rule"),
        route("/api/breaches", "GET", breaches.list_breaches, needs_view=True),
        route("/api/breaches", "POST", breaches.create_breach, owner_only=True),
        route("/api/breaches/preview", "POST", breaches.preview_breach, owner_only=True),
        route("/api/breaches/{id}", "GET", breaches.read_breach, id_kind="breach"),
        route(
            "/api/breaches/{id}",
            "PATCH",
            breaches.update_breach,
            owner_only=True,
            id_kind="breach",
        ),
        route(
            "/api/breaches/{id}",
            "DELETE",
            breaches.delete_breach,
            owner_only=True,
            id_kind="breach",
        ),
        route("/api/exposure", "GET", holdings.exposure, needs_view=True),
        route("/api/steps/{id}/done", "POST", steps.mark_done, owner_only=True, id_kind="step"),
        route("/api/steps/{id}/reopen", "POST", steps.reopen, owner_only=True, id_kind="step"),
        route("/api/grant", "GET", grant.read_grant, owner_only=True),
        route("/api/grant", "POST", grant.create_grant, owner_only=True),
        route("/api/grant", "PATCH", grant.narrow_grant, owner_only=True),
        route("/api/grant", "DELETE", grant.revoke_grant, owner_only=True),
        route(
            "/api/contact/grant",
            "GET",
            grant.read_contact_grant,
            contact_only=True,
            allow_ended=True,
        ),
        route("/api/account/password", "POST", account.change_password, owner_only=True),
        route("/api/events", "GET", events.events, touch=False),
    ]
