"""The published API route table and the one request context."""
import re


class Route:
    def __init__(
        self,
        path,
        method,
        handler,
        role=None,
        session_only=False,
        idempotent=False,
        reads_body=False,
        rate_limited=False,
        versioned=None,
    ):
        self.rate_limited = rate_limited
        self.path = path
        self.method = method
        self.handler = handler
        self.role = role
        self.session_only = session_only
        self.idempotent = idempotent
        self.reads_body = reads_body
        self.versioned = path.startswith("/api/v2") if versioned is None else versioned

    @property
    def needs_credential(self):
        return self.role is not None or self.session_only


class Table:
    """Every published path with the methods it publishes."""

    def __init__(self):
        self.paths = []
        self.by_path = {}

    def add(self, route):
        if route.path not in self.by_path:
            pattern = "^" + re.sub(r"\{[a-z_]+\}", r"([^/]+)", route.path) + "$"
            self.by_path[route.path] = {"regex": re.compile(pattern), "methods": {}}
            self.paths.append(route.path)
        self.by_path[route.path]["methods"][route.method] = route

    def match(self, path):
        for template in self.paths:
            entry = self.by_path[template]
            found = entry["regex"].match(path)
            if found:
                return template, entry, list(found.groups())
        return None, None, None


class Context:
    """What a handler is given once every earlier check has passed."""

    def __init__(self, request, route, params):
        self.request = request
        self.route = route
        self.params = params
        self.actor = None
        self.body = None
        self.headers = {}
        self.idempotency_database_id = None

    @property
    def organization(self):
        return self.actor.organization
