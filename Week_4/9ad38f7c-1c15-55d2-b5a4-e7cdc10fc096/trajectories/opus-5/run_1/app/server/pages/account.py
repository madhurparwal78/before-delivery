"""The account pages at /signup and /login."""

from __future__ import annotations

from urllib.parse import quote

from ..markup import Markup, fmt
from .chrome import document, live_region


def _cross_link(target: str, label: str, redirect: str | None) -> Markup:
    suffix = f"?redirect={quote(redirect, safe='')}" if redirect else ""
    return fmt('<a href="{}{}">{}</a>', target, Markup(suffix), label)


def _field(name: str, label: str, kind: str, autocomplete: str) -> Markup:
    return fmt(
        """
<div class="field">
  <label for="{name}-field">{label}</label>
  <input id="{name}-field" name="{name}" type="{kind}" autocomplete="{autocomplete}"
    aria-describedby="{name}-error" data-field="{name}">
  <p class="field-error" id="{name}-error" data-field-error="{name}"></p>
</div>
""",
        name=Markup(name),
        label=label,
        kind=Markup(kind),
        autocomplete=Markup(autocomplete),
    )


def render(mode: str, redirect: str | None) -> str:
    signing_up = mode == "signup"
    fields = fmt(
        "{email}{display_name}{password}",
        email=_field("email", "Email", "email", "email"),
        display_name=(
            _field("display_name", "Display name", "text", "nickname")
            if signing_up
            else Markup("")
        ),
        password=_field(
            "password",
            "Password",
            "password",
            "new-password" if signing_up else "current-password",
        ),
    )
    body = fmt(
        """
<section class="account">
  <h1 class="page-title">{title}</h1>
  {region}
  <form class="account-form" data-account-form data-mode="{mode}" novalidate>
    {fields}
    <button type="submit" class="button button-lime">{submit}</button>
  </form>
  <p class="account-cross-link">{cross}</p>
</section>
""",
        title="Create your free account" if signing_up else "Log in",
        region=live_region("Account messages", "error-summary"),
        mode=Markup(mode),
        fields=fields,
        submit="Create account" if signing_up else "Log in",
        cross=(
            _cross_link("/login", "Log in", redirect)
            if signing_up
            else _cross_link("/signup", "Create account", redirect)
        ),
    )
    return document(
        "Create account | NightWard" if signing_up else "Log in | NightWard",
        "account",
        body,
        body_class="page-account",
    )
