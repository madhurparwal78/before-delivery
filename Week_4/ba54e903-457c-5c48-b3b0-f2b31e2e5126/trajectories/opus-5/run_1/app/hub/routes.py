"""The only paths this server answers."""

from __future__ import annotations

from .api import accounts, attachments, billing, communities, content, inbox
from .api import invites, live_api, messages, roles, search
from .app import route
from . import pages

NO = "no"
YES = "yes"
OPTIONAL = "optional"


def register() -> None:
    # accounts
    route("/api/health", {"GET": (accounts.health, NO)}, "api")
    route("/api/auth/signup", {"POST": (accounts.signup, NO)}, "api")
    route("/api/auth/login", {"POST": (accounts.login, NO)}, "api")
    route("/api/auth/logout", {"POST": (accounts.logout, YES)}, "api")
    route("/api/auth/verify-email", {"POST": (accounts.verify_email, NO)}, "api")
    route(
        "/api/auth/resend-confirmation",
        {"POST": (accounts.resend_confirmation, YES)},
        "api",
    )
    route(
        "/api/users/@me",
        {"GET": (accounts.read_me, YES), "PATCH": (accounts.patch_me, YES)},
        "api",
    )
    route("/api/users/@me/password", {"POST": (accounts.change_password, YES)}, "api")

    # communities
    route(
        "/api/servers",
        {"GET": (communities.list_servers, NO), "POST": (communities.create_server, YES)},
        "api",
    )
    route(
        "/api/servers/{slug}",
        {
            "GET": (communities.read_server, OPTIONAL),
            "PATCH": (communities.patch_server, YES),
        },
        "api",
    )
    route("/api/servers/{slug}/join", {"POST": (communities.join_server, YES)}, "api")
    route(
        "/api/servers/{slug}/membership",
        {
            "PATCH": (communities.patch_membership, YES),
            "DELETE": (communities.leave_server, YES),
        },
        "api",
    )
    route("/api/servers/{slug}/members", {"GET": (communities.list_members, YES)}, "api")
    route("/api/servers/{slug}/bans", {"GET": (communities.list_bans, YES)}, "api")
    route(
        "/api/servers/{slug}/bans/{user_id}",
        {"PUT": (communities.ban_member, YES), "DELETE": (communities.unban_member, YES)},
        "api",
    )
    route(
        "/api/servers/{slug}/members/{user_id}/timeout",
        {"PUT": (communities.set_timeout, YES)},
        "api",
    )

    # roles, overwrites and permissions
    route(
        "/api/servers/{slug}/roles",
        {"GET": (roles.list_roles, YES), "POST": (roles.create_role, YES)},
        "api",
    )
    route(
        "/api/roles/{role_id}",
        {"PATCH": (roles.patch_role, YES), "DELETE": (roles.delete_role, YES)},
        "api",
    )
    route(
        "/api/servers/{slug}/members/{user_id}/roles/{role_id}",
        {"PUT": (roles.assign_role, YES), "DELETE": (roles.unassign_role, YES)},
        "api",
    )
    route("/api/channels/{channel_id}/overwrites", {"GET": (roles.list_overwrites, YES)}, "api")
    route(
        "/api/channels/{channel_id}/overwrites/{target_type}/{target_id}",
        {"PUT": (roles.put_overwrite, YES), "DELETE": (roles.delete_overwrite, YES)},
        "api",
    )
    route(
        "/api/channels/{channel_id}/permissions",
        {"GET": (roles.read_channel_permissions, YES)},
        "api",
    )

    # invites
    route(
        "/api/servers/{slug}/invites",
        {"GET": (invites.list_invites, YES), "POST": (invites.create_invite, YES)},
        "api",
    )
    route(
        "/api/invites/{code}",
        {"GET": (invites.read_invite, NO), "DELETE": (invites.revoke_invite, YES)},
        "api",
    )
    route("/api/invites/{code}/accept", {"POST": (invites.accept_invite, YES)}, "api")

    # messages
    route(
        "/api/servers/{slug}/messages/search",
        {"GET": (search.search_messages, YES)},
        "api",
    )
    route("/api/servers/{slug}/read-states", {"GET": (inbox.read_states, YES)}, "api")
    route("/api/channels/{channel_id}/ack", {"POST": (inbox.acknowledge, YES)}, "api")
    route(
        "/api/channels/{channel_id}/messages",
        {"GET": (messages.read_messages, YES), "POST": (messages.post_message, YES)},
        "api",
    )
    route(
        "/api/messages/{message_id}",
        {
            "PATCH": (messages.patch_message, YES),
            "DELETE": (messages.delete_message, YES),
        },
        "api",
    )
    route("/api/messages/{message_id}/replies", {"GET": (messages.read_replies, YES)}, "api")
    route(
        "/api/messages/{message_id}/reactions/{emoji}",
        {"PUT": (messages.add_reaction, YES), "DELETE": (messages.remove_reaction, YES)},
        "api",
    )
    route("/api/attachments", {"POST": (attachments.upload, YES)}, "api")
    route("/api/live", {"GET": (live_api.live, YES)}, "api")

    # notifications
    route("/api/notifications", {"GET": (inbox.list_notifications, YES)}, "api")
    route("/api/notifications/{id}/read", {"POST": (inbox.read_notification, YES)}, "api")
    route(
        "/api/notifications/read-all",
        {"POST": (inbox.read_all_notifications, YES)},
        "api",
    )

    # membership and billing
    route("/api/membership/tiers", {"GET": (billing.read_tiers, NO)}, "api")
    route("/api/membership/checkout", {"POST": (billing.checkout, YES)}, "api")
    route("/api/membership", {"DELETE": (billing.cancel_membership, YES)}, "api")

    # trending, safety, support, analytics
    route("/api/trending-games", {"GET": (content.trending_games, OPTIONAL)}, "api")
    route("/api/games/{slug}", {"GET": (content.read_game, OPTIONAL)}, "api")
    route("/api/safety/articles", {"GET": (content.safety_articles, NO)}, "api")
    route("/api/support/tickets", {"POST": (content.create_ticket, NO)}, "api")
    route("/api/analytics/pageview", {"POST": (content.page_view, NO)}, "api")

    # media, sitemap, robots and the favicon
    route("/media/{attachment_id}", {"GET": (attachments.serve_media, NO)}, "plain")
    route("/sitemap.xml", {"GET": (pages.sitemap, NO)}, "plain")
    route("/robots.txt", {"GET": (pages.robots, NO)}, "plain")
    route("/favicon.ico", {"GET": (pages.favicon, NO)}, "plain")

    # pages
    for path, handler in pages.PAGE_ROUTES:
        route(path, {"GET": (handler, NO)}, "page")


register()
