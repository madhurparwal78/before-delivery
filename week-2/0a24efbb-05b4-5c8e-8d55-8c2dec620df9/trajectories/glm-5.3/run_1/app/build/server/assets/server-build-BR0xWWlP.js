import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter, useNavigate, UNSAFE_withComponentProps, useLocation, useMatches, Outlet, Link, Meta, Links, Scripts, redirect, useSearchParams, useLoaderData, isRouteErrorResponse, UNSAFE_withErrorBoundaryProps, useRouteError, useNavigation, useRevalidator, data } from "react-router";
import { renderToPipeableStream } from "react-dom/server";
import { useState, useEffect, useRef } from "react";
const streamTimeout = 5e3;
function handleRequest(request, responseStatusCode, responseHeaders, routerContext) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders
    });
  }
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const timeoutId = setTimeout(() => abort(), streamTimeout + 1e3);
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(ServerRouter, { context: routerContext, url: request.url }),
      {
        onAllReady() {
          shellRendered = true;
          clearTimeout(timeoutId);
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("content-type", "text/html; charset=utf-8");
          resolve(
            new Response(stream, {
              status: responseStatusCode,
              headers: responseHeaders
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        }
      }
    );
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: handleRequest,
  streamTimeout
}, Symbol.toStringTag, { value: "Module" }));
const styles = "/assets/styles-Bb1t7YMH.css";
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  focusable: "false"
};
function ClockIcon(props) {
  return /* @__PURE__ */ jsxs("svg", { ...base, ...props, children: [
    /* @__PURE__ */ jsx("circle", { cx: "12", cy: "12", r: "8.5" }),
    /* @__PURE__ */ jsx("path", { d: "M12 7.5V12l3 2" })
  ] });
}
function CalendarIcon(props) {
  return /* @__PURE__ */ jsxs("svg", { ...base, ...props, children: [
    /* @__PURE__ */ jsx("rect", { x: "3.5", y: "5", width: "17", height: "15.5", rx: "2.5" }),
    /* @__PURE__ */ jsx("path", { d: "M3.5 9.5h17M8 2.8v4M16 2.8v4" })
  ] });
}
function CheckIcon(props) {
  return /* @__PURE__ */ jsx("svg", { ...base, ...props, children: /* @__PURE__ */ jsx("path", { d: "M4.5 12.5l5 5 10-11" }) });
}
function CrossIcon(props) {
  return /* @__PURE__ */ jsx("svg", { ...base, ...props, children: /* @__PURE__ */ jsx("path", { d: "M5.5 5.5l13 13M18.5 5.5l-13 13" }) });
}
function BarIcon(props) {
  return /* @__PURE__ */ jsx("svg", { ...base, ...props, children: /* @__PURE__ */ jsx("path", { d: "M4.5 12h15" }) });
}
function SlashIcon(props) {
  return /* @__PURE__ */ jsx("svg", { ...base, ...props, children: /* @__PURE__ */ jsx("path", { d: "M5 19L19 5" }) });
}
function ChevronDownIcon(props) {
  return /* @__PURE__ */ jsx("svg", { ...base, ...props, children: /* @__PURE__ */ jsx("path", { d: "M5.5 9.5L12 16l6.5-6.5" }) });
}
function ChevronIcon(props) {
  return /* @__PURE__ */ jsx("svg", { ...base, ...props, children: /* @__PURE__ */ jsx("path", { d: "M9.5 5.5L16 12l-6.5 6.5" }) });
}
function SearchIcon(props) {
  return /* @__PURE__ */ jsxs("svg", { ...base, ...props, children: [
    /* @__PURE__ */ jsx("circle", { cx: "10.8", cy: "10.8", r: "6.3" }),
    /* @__PURE__ */ jsx("path", { d: "M15.5 15.5L20.5 20.5" })
  ] });
}
function FilterIcon(props) {
  return /* @__PURE__ */ jsx("svg", { ...base, ...props, children: /* @__PURE__ */ jsx("path", { d: "M4 6.5h16M7 12h10M10 17.5h4" }) });
}
function BellIcon(props) {
  return /* @__PURE__ */ jsx("svg", { ...base, ...props, children: /* @__PURE__ */ jsx("path", { d: "M6 16.5v-6a6 6 0 0 1 12 0v6M4.5 16.5h15M10 20a2.2 2.2 0 0 0 4 0" }) });
}
function PlusIcon(props) {
  return /* @__PURE__ */ jsx("svg", { ...base, ...props, children: /* @__PURE__ */ jsx("path", { d: "M12 5v14M5 12h14" }) });
}
function DownloadIcon(props) {
  return /* @__PURE__ */ jsx("svg", { ...base, ...props, children: /* @__PURE__ */ jsx("path", { d: "M12 4v11m0 0l-4-4m4 4l4-4M4.5 19.5h15" }) });
}
const STATE_GLYPH = {
  pending: BarIcon,
  approved: CheckIcon,
  rejected: CrossIcon,
  cancelled: SlashIcon
};
const MARK_GLYPH = {
  recorded: CheckIcon,
  incomplete: ClockIcon,
  leave_approved: CalendarIcon,
  leave_pending: BarIcon,
  waiting: BellIcon
};
const MARK_LABEL = {
  recorded: "Attendance recorded",
  incomplete: "Attendance incomplete",
  leave_approved: "Leave approved",
  leave_pending: "Leave pending",
  waiting: "Correction waiting"
};
const STATE_LABEL = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled"
};
function SignOutButton() {
  const navigate = useNavigate();
  return /* @__PURE__ */ jsx(
    "button",
    {
      type: "button",
      className: "sign-out",
      id: "sign-out",
      onClick: async () => {
        try {
          await fetch("/api/session", { method: "DELETE" });
        } finally {
          navigate("/login?signed-out=1", { replace: true });
        }
      },
      children: "Sign out"
    }
  );
}
let listener = null;
function announce(kind, message) {
  if (listener) listener({ kind, message, at: Date.now() });
}
function LiveRegions() {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const [toast, setToast] = useState(null);
  useEffect(() => {
    listener = ({ kind, message, at }) => {
      const entry2 = { message, at };
      if (kind === "polite") {
        setPolite(message);
      } else {
        setAssertive(message);
      }
      setToast(entry2);
    };
    return () => {
      listener = null;
    };
  }, []);
  useEffect(() => {
    if (!toast) return void 0;
    const timer = setTimeout(() => setToast(null), 6e3);
    return () => clearTimeout(timer);
  }, [toast]);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("div", { role: "status", "aria-live": "polite", className: "visually-hidden", id: "polite-region", children: polite }),
    /* @__PURE__ */ jsx("div", { role: "alert", "aria-live": "assertive", className: "visually-hidden", id: "assertive-region", children: assertive }),
    toast && /* @__PURE__ */ jsxs("div", { className: `toast ${toast.dismissed ? "toast-out" : ""}`, role: "group", "aria-label": "Announcement", children: [
      /* @__PURE__ */ jsx("span", { children: toast.message }),
      /* @__PURE__ */ jsx("button", { type: "button", className: "toast-dismiss", "aria-label": "Dismiss", onClick: () => setToast(null), children: /* @__PURE__ */ jsx(CrossIcon, {}) })
    ] })
  ] });
}
const ROUTE_TABLE = [
  /^\/$/,
  /^\/login$/,
  /^\/requests$/,
  /^\/requests\/new$/,
  /^\/requests\/[^/]+$/,
  /^\/calendar$/,
  /^\/policy$/,
  /^\/share\/[^/]+$/
];
function isDeskRoute(pathname) {
  return ROUTE_TABLE.some((re) => re.test(pathname));
}
function isShareRoute(pathname) {
  return /^\/share\/[^/]+$/.test(pathname);
}
function isSafeNext(next) {
  if (typeof next !== "string" || next === "") return false;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return false;
  if (next.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(next)) return false;
  if (/:\/\//.test(next)) return false;
  const path = next.split("?")[0].split("#")[0];
  if (path === "/login" || isShareRoute(path)) return false;
  return isDeskRoute(path);
}
function encodeNext(next) {
  return encodeURIComponent(next);
}
const links = () => [{
  rel: "stylesheet",
  href: styles
}];
async function loader$7({
  request
}) {
  const {
    resolveViewer
  } = await import("./data.server-Bjfv_yW6.js").then((n) => n.d);
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (isShareRoute(pathname)) return {
    viewer: null,
    policyVersion: null
  };
  const resolved = await resolveViewer({
    cookies: parseCookies(request),
    headers: request.headers
  });
  if (pathname === "/login") {
    if (resolved.state === "ok") {
      const next = url.searchParams.get("next");
      const target = isSafeNext(next) ? next : "/requests";
      throw redirect(target, 303);
    }
    return {
      viewer: null,
      policyVersion: null
    };
  }
  if (pathname === "/") {
    throw redirect(resolved.state === "ok" ? "/requests" : "/login", 303);
  }
  if (resolved.state !== "ok") {
    if (isDeskRoute(pathname)) {
      const requested = request.url.replace(/^[a-z]+:\/\/[^/]+/, "");
      throw redirect(`/login?next=${encodeNext(requested)}`, 303);
    }
    return {
      viewer: null,
      policyVersion: null
    };
  }
  const {
    loadPolicyVersion
  } = await import("./data.server-Bjfv_yW6.js").then((n) => n.d);
  return {
    viewer: resolved.viewer,
    policyVersion: await loadPolicyVersion()
  };
}
function parseCookies(request) {
  const out = {};
  const header = request.headers.get("cookie");
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function initials(name) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function Breadcrumbs({
  queueQuery
}) {
  const matches = useMatches();
  const crumbs = [{
    label: "Desk",
    to: queueQuery ? `/requests?${queueQuery}` : "/requests"
  }];
  const last = [...matches].reverse().find((m) => m.data?.crumb || m.handle?.crumb);
  const crumb = last?.data?.crumb ?? last?.handle?.crumb;
  if (crumb) crumbs.push({
    label: crumb
  });
  if (crumbs.length === 1) crumbs.push({
    label: "Regularisation requests"
  });
  const focusRow = last?.data?.detail?.request?.id;
  return /* @__PURE__ */ jsx("nav", {
    "aria-label": "Breadcrumb",
    id: "breadcrumb",
    children: /* @__PURE__ */ jsx("ol", {
      children: crumbs.map((c, i) => /* @__PURE__ */ jsxs("li", {
        children: [i > 0 && /* @__PURE__ */ jsx(ChevronIcon, {
          "aria-hidden": "true"
        }), c.to ? /* @__PURE__ */ jsx(Link, {
          to: c.to,
          state: focusRow ? {
            focusRow
          } : void 0,
          children: c.label
        }) : /* @__PURE__ */ jsx("span", {
          "aria-current": "page",
          children: c.label
        })]
      }, i))
    })
  });
}
function Layout({
  children
}) {
  return /* @__PURE__ */ jsxs("html", {
    lang: "en",
    children: [/* @__PURE__ */ jsxs("head", {
      children: [/* @__PURE__ */ jsx("meta", {
        charSet: "utf-8"
      }), /* @__PURE__ */ jsx("meta", {
        name: "viewport",
        content: "width=device-width, initial-scale=1"
      }), /* @__PURE__ */ jsx(Meta, {}), /* @__PURE__ */ jsx(Links, {})]
    }), /* @__PURE__ */ jsxs("body", {
      children: [children, /* @__PURE__ */ jsx(Scripts, {})]
    })]
  });
}
const root = UNSAFE_withComponentProps(function Root() {
  const location = useLocation();
  const matches = useMatches();
  const shared = location.pathname.startsWith("/share/");
  const data2 = [...matches].reverse().find((m) => m.data)?.data || {};
  const viewer = data2.viewer;
  const policyVersion = data2.policyVersion;
  const queueQuery = data2.queueQuery;
  const roleLine = viewer?.role === "admin" ? "People operations" : viewer ? viewer.role === "manager" ? "Manager" : "Employee" : null;
  if (shared) {
    return /* @__PURE__ */ jsx(Outlet, {});
  }
  return /* @__PURE__ */ jsxs(Fragment, {
    children: [/* @__PURE__ */ jsxs("header", {
      id: "banner",
      children: [/* @__PURE__ */ jsx("a", {
        className: "brand",
        href: "/requests",
        children: "Rostara"
      }), viewer && /* @__PURE__ */ jsx(Breadcrumbs, {
        queueQuery
      }), viewer && /* @__PURE__ */ jsxs("div", {
        className: "banner-right",
        children: [/* @__PURE__ */ jsxs("span", {
          className: "who",
          children: [/* @__PURE__ */ jsx("span", {
            className: "initials",
            "aria-hidden": "true",
            children: initials(viewer.name)
          }), /* @__PURE__ */ jsxs("span", {
            className: "who-lines",
            children: [/* @__PURE__ */ jsx("span", {
              className: "who-name",
              children: viewer.name
            }), /* @__PURE__ */ jsx("span", {
              className: "role-line",
              children: roleLine
            })]
          })]
        }), /* @__PURE__ */ jsx(SignOutButton, {})]
      })]
    }), /* @__PURE__ */ jsx("main", {
      id: "main",
      children: /* @__PURE__ */ jsx(Outlet, {})
    }), /* @__PURE__ */ jsxs("footer", {
      id: "contentinfo",
      children: ["Rostara attendance desk. Policy version ", policyVersion ?? "1", "."]
    }), /* @__PURE__ */ jsx(LiveRegions, {})]
  });
});
const route0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Layout,
  default: root,
  links,
  loader: loader$7
}, Symbol.toStringTag, { value: "Module" }));
const home = UNSAFE_withComponentProps(function Home() {
  return null;
});
const route1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: home
}, Symbol.toStringTag, { value: "Module" }));
async function loader$6({
  request
}) {
  const {
    loadSession
  } = await import("./sessions-BB3wZhcQ.js");
  const header = request.headers.get("cookie") || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) cookies[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const token = cookies.rostara_session;
  if (!token) return {
    ended: false
  };
  const loaded = await loadSession(decodeURIComponent(token));
  return {
    ended: !loaded || loaded.kind !== "ok"
  };
}
const login = UNSAFE_withComponentProps(function Login() {
  const [params] = useSearchParams();
  const data2 = useLoaderData();
  const notice = params.get("signed-out") === "1" ? "You are signed out." : data2.ended ? "Your session has ended. Sign in again." : null;
  return /* @__PURE__ */ jsxs("div", {
    className: "login-wrap",
    children: [/* @__PURE__ */ jsx("h1", {
      children: "Sign in to Rostara"
    }), notice && /* @__PURE__ */ jsx("p", {
      className: "status-line",
      role: "status",
      children: notice
    }), /* @__PURE__ */ jsx(LoginForm, {})]
  });
});
function LoginForm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [workAddress, setWorkAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const next = params.get("next");
  const safeNext = isSafeNext(next) ? next : null;
  const alertRef = useRef(null);
  useEffect(() => {
    if (error && alertRef.current) alertRef.current.focus();
  }, [error]);
  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          work_address: workAddress,
          password
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "The desk could not reach the server. Try again.");
        setPassword("");
        return;
      }
      navigate(safeNext || "/requests", {
        replace: true
      });
    } catch {
      setError("The desk could not reach the server. Try again.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }
  return /* @__PURE__ */ jsxs("form", {
    className: "login-form",
    onSubmit,
    noValidate: true,
    children: [error && /* @__PURE__ */ jsx("p", {
      className: "form-error",
      role: "alert",
      tabIndex: -1,
      ref: alertRef,
      children: error
    }), /* @__PURE__ */ jsxs("div", {
      className: "field",
      children: [/* @__PURE__ */ jsx("label", {
        htmlFor: "work_address",
        children: "Work address"
      }), /* @__PURE__ */ jsx("input", {
        id: "work_address",
        name: "work_address",
        type: "email",
        autoComplete: "username",
        value: workAddress,
        onChange: (e) => setWorkAddress(e.target.value),
        required: true
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "field",
      children: [/* @__PURE__ */ jsx("label", {
        htmlFor: "password",
        children: "Password"
      }), /* @__PURE__ */ jsx("input", {
        id: "password",
        name: "password",
        type: "password",
        autoComplete: "current-password",
        value: password,
        onChange: (e) => setPassword(e.target.value),
        required: true
      })]
    }), /* @__PURE__ */ jsx("button", {
      type: "submit",
      className: "primary",
      disabled: busy,
      children: busy ? "Signing in" : "Sign in"
    })]
  });
}
const route2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: login,
  loader: loader$6
}, Symbol.toStringTag, { value: "Module" }));
function StateChip({ state, animate }) {
  const Glyph = STATE_GLYPH[state] || STATE_GLYPH.pending;
  return /* @__PURE__ */ jsxs("span", { className: `chip chip-${state}${animate ? " chip-settle" : ""}`, children: [
    /* @__PURE__ */ jsx(Glyph, { className: "chip-glyph" }),
    /* @__PURE__ */ jsx("span", { children: STATE_LABEL[state] || state })
  ] });
}
const TYPE_CODES = ["missed_in", "missed_out", "offsite", "whole_day", "night_shift"];
const TYPE_LABELS = {
  missed_in: "Sign in was not recorded",
  missed_out: "Sign out was not recorded",
  offsite: "Worked away from the workplace",
  whole_day: "Whole day worked but not recorded",
  night_shift: "Night shift recorded against the wrong day"
};
function canonicalQueueQuery(q) {
  const parts = [];
  if (q.state && q.state !== "all") parts.push(`state=${encodeURIComponent(q.state)}`);
  if (q.type) parts.push(`type=${encodeURIComponent(q.type)}`);
  if (q.person) parts.push(`person=${encodeURIComponent(q.person)}`);
  if (q.month) parts.push(`month=${encodeURIComponent(q.month)}`);
  if (q.q) parts.push(`q=${encodeURIComponent(q.q)}`);
  if (q.sort) parts.push(`sort=${encodeURIComponent(q.sort)}`);
  if (q.page && q.page > 1) parts.push(`page=${q.page}`);
  return parts.join("&");
}
function queueHref(q, extraPath = "") {
  const qs = canonicalQueueQuery(q);
  return extraPath + (qs ? `?${qs}` : "");
}
function FilterSheet({ viewer, queue, onClose }) {
  const q = queue?.parsedQuery || {};
  const navigate = useNavigate();
  const dialogRef = useRef(null);
  const [type, setType] = useState(q.type || "");
  const [person, setPerson] = useState(q.person || "");
  const [month, setMonth] = useState(q.month || "");
  useEffect(() => {
    const first = dialogRef.current?.querySelector("select, input, button");
    first?.focus();
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  function trapFocus(e) {
    const sheet = dialogRef.current;
    if (!sheet) return;
    const focusables = sheet.querySelectorAll("select, input, button, a[href]");
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.key === "Tab") {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  function apply() {
    navigate(queueHref({
      state: q.state || "all",
      type: type || void 0,
      person: person || void 0,
      month: month || void 0,
      q: q.q,
      sort: q.sort,
      page: 1
    }), { replace: true });
    onClose();
  }
  function clear() {
    setType("");
    setPerson("");
    setMonth("");
    navigate(queueHref({ state: q.state || "all", page: 1 }), { replace: true });
    onClose();
  }
  const canFilterPerson = viewer.role !== "employee";
  const people = queue?.scopePeople || [];
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: dialogRef,
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "sheet-heading",
      className: "filter-sheet",
      onKeyDown: trapFocus,
      children: [
        /* @__PURE__ */ jsx("h2", { id: "sheet-heading", children: "Narrow the queue" }),
        /* @__PURE__ */ jsxs("div", { className: "field", children: [
          /* @__PURE__ */ jsx("label", { htmlFor: "filter-type", children: "Correction" }),
          /* @__PURE__ */ jsxs("select", { id: "filter-type", value: type, onChange: (e) => setType(e.target.value), children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "Any correction" }),
            TYPE_CODES.map((t) => /* @__PURE__ */ jsx("option", { value: t, children: TYPE_LABELS[t] }, t))
          ] })
        ] }),
        canFilterPerson && /* @__PURE__ */ jsxs("div", { className: "field", children: [
          /* @__PURE__ */ jsx("label", { htmlFor: "filter-person", children: "Person" }),
          /* @__PURE__ */ jsxs("select", { id: "filter-person", value: person, onChange: (e) => setPerson(e.target.value), children: [
            /* @__PURE__ */ jsx("option", { value: "", children: "Anyone in scope" }),
            people.map((p) => /* @__PURE__ */ jsx("option", { value: p.work_address, children: p.name }, p.id))
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "field", children: [
          /* @__PURE__ */ jsx("label", { htmlFor: "filter-month", children: "Month" }),
          /* @__PURE__ */ jsx(
            "input",
            {
              id: "filter-month",
              type: "text",
              value: month,
              onChange: (e) => setMonth(e.target.value),
              "aria-describedby": "filter-month-help"
            }
          ),
          /* @__PURE__ */ jsx("p", { className: "help", id: "filter-month-help", children: "Year and month, for example 2026-10" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "sheet-actions", children: [
          /* @__PURE__ */ jsx("button", { type: "button", className: "secondary", onClick: apply, children: "Apply filters" }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "secondary", onClick: clear, children: "Clear filters" }),
          /* @__PURE__ */ jsx("button", { type: "button", className: "secondary", onClick: onClose, children: "Close" })
        ] })
      ]
    }
  );
}
const REASON_MIN = 20;
function DraftRow({ cancelHref = "/requests" }) {
  const navigate = useNavigate();
  const [day, setDay] = useState("");
  const [type, setType] = useState("");
  const [claimedIn, setClaimedIn] = useState("");
  const [claimedOut, setClaimedOut] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(null);
  const idemKeyRef = useRef(null);
  if (!idemKeyRef.current) {
    idemKeyRef.current = crypto.randomUUID();
  }
  const needsIn = type === "missed_in" || type === "offsite" || type === "whole_day" || type === "night_shift";
  const needsOut = type === "missed_out" || type === "offsite" || type === "whole_day" || type === "night_shift";
  function cellError(field) {
    if (field === "day" && !day) return "This is required.";
    if (field === "day" && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "This is required.";
    if (field === "type" && !type) return "This is required.";
    if (field === "claimed_in" && needsIn && !claimedIn) return "This is required.";
    if (field === "claimed_out" && needsOut && !claimedOut) return "This is required.";
    if (field === "reason") {
      if (!reason) return "This is required.";
      if (graphemes(reason) < REASON_MIN) return `This needs at least ${REASON_MIN} characters.`;
    }
    return null;
  }
  function validate() {
    const fields = ["day", "type", "claimed_in", "claimed_out", "reason"];
    const out = {};
    for (const f of fields) {
      const e = cellError(f);
      if (e) out[f] = e;
    }
    setErrors(out);
    const count = Object.keys(out).length;
    if (count > 0) {
      announce("assertive", `Fields needing attention: ${count}.`);
      const first = fields.find((f) => out[f]);
      document.getElementById(`draft-${first}`)?.focus();
      return false;
    }
    return true;
  }
  async function send() {
    if (!validate() || busy) return;
    setBusy(true);
    setEnded(null);
    try {
      const body = {
        day,
        correction_type: type,
        claimed_in: needsIn || claimedIn ? claimedIn || null : null,
        claimed_out: needsOut || claimedOut ? claimedOut || null : null,
        reason
      };
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idemKeyRef.current
        },
        body: JSON.stringify(body)
      });
      const data2 = await res.json().catch(() => ({}));
      if (res.status === 401 && data2.error === "Your session has ended. Sign in again.") {
        setEnded(data2.error);
        return;
      }
      if (!res.ok) {
        setErrors((prev) => ({ ...prev, [data2.field || "reason"]: data2.error }));
        announce("assertive", data2.error || "The desk could not reach the server. Try again.");
        if (data2.field) document.getElementById(`draft-${data2.field}`)?.focus();
        return;
      }
      announce("assertive", `Correction for ${data2.day} is waiting for a decision.`);
      navigate(`/requests/${data2.id}`, { replace: true });
    } catch {
      announce("assertive", "The desk could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("tr", { className: "draft-row", children: [
      /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsx(StateCell, {}) }),
      /* @__PURE__ */ jsx("td", { className: "cell-person", children: "—" }),
      /* @__PURE__ */ jsxs("td", { children: [
        /* @__PURE__ */ jsx("label", { htmlFor: "draft-day", className: "visually-hidden", children: "Day to correct" }),
        /* @__PURE__ */ jsx("input", { id: "draft-day", type: "date", value: day, onChange: (e) => {
          setDay(e.target.value);
          setErrors((p) => ({ ...p, day: null }));
        }, "aria-invalid": !!errors.day, "aria-describedby": errors.day ? "draft-day-error" : void 0 }),
        errors.day && /* @__PURE__ */ jsx("span", { className: "cell-error", id: "draft-day-error", children: errors.day })
      ] }),
      /* @__PURE__ */ jsxs("td", { children: [
        /* @__PURE__ */ jsx("label", { htmlFor: "draft-type", className: "visually-hidden", children: "Correction type" }),
        /* @__PURE__ */ jsxs("select", { id: "draft-type", value: type, onChange: (e) => {
          setType(e.target.value);
          setErrors((p) => ({ ...p, type: null }));
        }, "aria-invalid": !!errors.type, "aria-describedby": errors.type ? "draft-type-error" : void 0, children: [
          /* @__PURE__ */ jsx("option", { value: "", children: "Correction type" }),
          TYPE_CODES.map((t) => /* @__PURE__ */ jsx("option", { value: t, children: TYPE_LABELS[t] }, t))
        ] }),
        errors.type && /* @__PURE__ */ jsx("span", { className: "cell-error", id: "draft-type-error", children: errors.type })
      ] }),
      /* @__PURE__ */ jsx("td", { children: /* @__PURE__ */ jsxs("div", { className: "draft-times", children: [
        /* @__PURE__ */ jsx("label", { htmlFor: "draft-in", className: "visually-hidden", children: "Claimed sign in" }),
        /* @__PURE__ */ jsx("input", { id: "draft-in", type: "time", value: claimedIn, onChange: (e) => {
          setClaimedIn(e.target.value);
          setErrors((p) => ({ ...p, claimed_in: null }));
        }, "aria-invalid": !!errors.claimed_in, "aria-describedby": errors.claimed_in ? "draft-in-error" : void 0 }),
        /* @__PURE__ */ jsx("label", { htmlFor: "draft-out", className: "visually-hidden", children: "Claimed sign out" }),
        /* @__PURE__ */ jsx("input", { id: "draft-out", type: "time", value: claimedOut, onChange: (e) => {
          setClaimedOut(e.target.value);
          setErrors((p) => ({ ...p, claimed_out: null }));
        }, "aria-invalid": !!errors.claimed_out, "aria-describedby": errors.claimed_out || type === "night_shift" ? "draft-out-error" : void 0 }),
        errors.claimed_in && /* @__PURE__ */ jsx("span", { className: "cell-error", id: "draft-in-error", children: errors.claimed_in }),
        errors.claimed_out && /* @__PURE__ */ jsx("span", { className: "cell-error", id: "draft-out-error", children: errors.claimed_out }),
        type === "night_shift" && !errors.claimed_out && /* @__PURE__ */ jsx("span", { className: "help", id: "draft-out-error", children: "Ends the following day." })
      ] }) }),
      /* @__PURE__ */ jsx("td", { className: "cell-times", children: "—" }),
      /* @__PURE__ */ jsx("td", { className: "cell-raised", children: "—" }),
      /* @__PURE__ */ jsxs("td", { children: [
        /* @__PURE__ */ jsx("button", { type: "button", className: "primary", onClick: send, disabled: busy, children: busy ? "Sending for approval" : "Send for approval" }),
        /* @__PURE__ */ jsx("a", { href: cancelHref, className: "draft-discard", children: "Discard draft" })
      ] })
    ] }),
    /* @__PURE__ */ jsx("tr", { className: "draft-reason-row", children: /* @__PURE__ */ jsxs("td", { colSpan: 8, children: [
      /* @__PURE__ */ jsx("label", { htmlFor: "draft-reason", className: "draft-reason-label", children: "Reason" }),
      /* @__PURE__ */ jsx(
        "textarea",
        {
          id: "draft-reason",
          value: reason,
          rows: 2,
          onChange: (e) => setReason(e.target.value),
          "aria-describedby": "draft-reason-help",
          "aria-invalid": !!errors.reason
        }
      ),
      /* @__PURE__ */ jsx("p", { className: "help", id: "draft-reason-help", children: "Twenty to 280 characters. Each emoji counts as one. Your manager reads this." }),
      errors.reason && /* @__PURE__ */ jsx("span", { className: "cell-error", role: "alert", children: errors.reason }),
      busy && /* @__PURE__ */ jsx("span", { className: "status-line", role: "status", children: "Sending for approval" }),
      ended && /* @__PURE__ */ jsxs("span", { className: "ended-line", role: "alert", children: [
        ended,
        " ",
        /* @__PURE__ */ jsx("a", { href: `/login?next=${encodeURIComponent("/requests/new")}`, children: "Sign in again" })
      ] })
    ] }) })
  ] });
}
function StateCell() {
  return /* @__PURE__ */ jsx("span", { className: "chip chip-draft", children: "Draft" });
}
function graphemes(text) {
  const trimmed = text.replace(/^[\s\u0085]+|[\s\u0085]+$/g, "");
  if (typeof Intl.Segmenter === "function") {
    let n = 0;
    for (const _ of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(trimmed)) n++;
    return n;
  }
  return [...trimmed].length;
}
function NotFoundPage({ withChrome }) {
  return /* @__PURE__ */ jsxs("div", { className: `answer-page${withChrome ? "" : " bare"}`, children: [
    /* @__PURE__ */ jsx("h1", { children: "That page does not exist" }),
    /* @__PURE__ */ jsx("p", { children: "The link may be out of date. Go back to the desk." }),
    withChrome && /* @__PURE__ */ jsx("p", { children: /* @__PURE__ */ jsx("a", { href: "/requests", children: "Go back to the desk" }) })
  ] });
}
function WrongRolePage() {
  return /* @__PURE__ */ jsxs("div", { className: "answer-page", children: [
    /* @__PURE__ */ jsx("h1", { children: "Your role does not have access to this page." }),
    /* @__PURE__ */ jsx("p", { children: /* @__PURE__ */ jsx("a", { href: "/requests", children: "Go back to the desk" }) })
  ] });
}
function BadQueryPage() {
  return /* @__PURE__ */ jsxs("div", { className: "answer-page", children: [
    /* @__PURE__ */ jsx("h1", { children: "That filter is not one the queue understands." }),
    /* @__PURE__ */ jsx("p", { children: /* @__PURE__ */ jsx("a", { href: "/requests", children: "Clear filters" }) })
  ] });
}
function SharedGonePage() {
  return /* @__PURE__ */ jsxs("div", { className: "answer-page bare", children: [
    /* @__PURE__ */ jsx("p", { className: "brand-line", children: "Rostara" }),
    /* @__PURE__ */ jsx("h1", { children: "This shared month is no longer available" }),
    /* @__PURE__ */ jsx("p", { children: "Ask the person who shared it for a new link." })
  ] });
}
function RouteErrorBoundary({ error, signedIn, share }) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  if (share) {
    if (status === 410) return /* @__PURE__ */ jsx(SharedGonePage, {});
    return /* @__PURE__ */ jsx(NotFoundPage, { withChrome: false });
  }
  if (status === 403) return /* @__PURE__ */ jsx(WrongRolePage, {});
  if (status === 400) return /* @__PURE__ */ jsx(BadQueryPage, {});
  if (status === 404) return /* @__PURE__ */ jsx(NotFoundPage, { withChrome: true });
  if (status === 401) {
    return /* @__PURE__ */ jsxs("div", { className: "answer-page", children: [
      /* @__PURE__ */ jsx("h1", { children: "Sign in to continue." }),
      /* @__PURE__ */ jsx("p", { children: /* @__PURE__ */ jsx("a", { href: "/login", children: "Sign in" }) })
    ] });
  }
  return /* @__PURE__ */ jsxs("div", { className: "answer-page", children: [
    /* @__PURE__ */ jsx("h1", { children: "The desk could not complete that. Try again." }),
    /* @__PURE__ */ jsx("p", { children: /* @__PURE__ */ jsx("a", { href: "/requests", children: "Go back to the desk" }) })
  ] });
}
const handle$3 = {
  crumb: "Regularisation requests"
};
const ErrorBoundary$4 = UNSAFE_withErrorBoundaryProps(function ErrorBoundary() {
  return /* @__PURE__ */ jsx(RouteErrorBoundary, {
    error: useRouteError(),
    signedIn: true
  });
});
async function loader$5({
  request
}) {
  const {
    viewerFromRequest,
    loadQueue
  } = await import("./data.server-Bjfv_yW6.js").then((n) => n.d);
  const {
    ApiError
  } = await import("./errors-DELaVzSn.js");
  const viewer = await viewerFromRequest(request);
  if (!viewer) throw data(null, {
    status: 401
  });
  let queue;
  try {
    queue = await loadQueue(viewer, new URL(request.url));
  } catch (err) {
    if (err instanceof ApiError) {
      throw data(null, {
        status: err.status
      });
    }
    return {
      viewer,
      queue: null,
      failed: true
    };
  }
  return {
    viewer,
    queue,
    failed: false
  };
}
const STATE_CHIPS = ["all", "pending", "approved", "rejected", "cancelled"];
const CHIP_LABEL = {
  all: "All",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled"
};
const SORT_OPTIONS = [{
  value: "",
  label: "Waiting first"
}, {
  value: "day",
  label: "Day, newest first"
}, {
  value: "raised",
  label: "Raised, oldest first"
}, {
  value: "person",
  label: "Person, A to Z"
}];
const requests_layout = UNSAFE_withComponentProps(function RequestsLayout() {
  const {
    viewer,
    queue,
    failed
  } = useLoaderData();
  const matches = useMatches();
  const childActive = matches.some((m) => m.id === "routes/requests.$id" || m.id === "routes/requests.new");
  const childId = matches.some((m) => m.id === "routes/requests.$id");
  const showDraft = matches.some((m) => m.id === "routes/requests.new");
  const navigation = useNavigation();
  const loading = navigation.state !== "idle";
  const [openRow, setOpenRow] = useState(null);
  const revalidator = useRevalidator();
  const didReRead = useRef(false);
  useEffect(() => {
    if (!didReRead.current) {
      didReRead.current = true;
      revalidator.revalidate();
    }
  }, [revalidator]);
  return /* @__PURE__ */ jsxs("div", {
    className: "requests-page",
    children: [childId && /* @__PURE__ */ jsx(Outlet, {}), /* @__PURE__ */ jsxs("div", {
      className: "queue-side",
      children: [showDraft && /* @__PURE__ */ jsx("h1", {
        className: "draft-heading",
        children: "Raise a correction"
      }), childActive ? /* @__PURE__ */ jsx("h2", {
        id: "queue-heading",
        tabIndex: -1,
        children: "Regularisation requests"
      }) : /* @__PURE__ */ jsx("h1", {
        id: "queue-heading",
        tabIndex: -1,
        children: "Regularisation requests"
      }), /* @__PURE__ */ jsx(QueueControls, {
        viewer,
        queue,
        showDraft
      }), failed ? /* @__PURE__ */ jsxs("div", {
        className: "panel empty-panel",
        role: "group",
        children: [/* @__PURE__ */ jsx("p", {
          children: "The queue could not be loaded. Try again."
        }), /* @__PURE__ */ jsx("a", {
          className: "button secondary",
          href: ".",
          role: "button",
          children: "Try again"
        })]
      }) : /* @__PURE__ */ jsx(QueueTable, {
        viewer,
        queue,
        loading,
        openRow,
        setOpenRow,
        showDraft,
        childActive,
        draftCancelHref: queueHref({
          state: queue?.parsedQuery?.state || "all",
          ...queue?.parsedQuery || {},
          page: 1
        })
      })]
    }), !childId && /* @__PURE__ */ jsx(Outlet, {})]
  });
});
function QueueControls({
  viewer,
  queue,
  showDraft
}) {
  const q = queue?.parsedQuery || {
    state: "all",
    page: 1
  };
  const navigate = useNavigate();
  const canRaise = viewer.role !== "admin" && !showDraft;
  function applyQuery(next) {
    navigate(queueHref({
      ...q,
      ...next,
      page: 1
    }), {
      replace: true
    });
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "queue-controls",
    children: [/* @__PURE__ */ jsx(StateChipGroup, {
      value: q.state || "all",
      onApply: (state) => applyQuery({
        state
      })
    }), /* @__PURE__ */ jsx(SearchReasons, {
      value: q.q || "",
      onApply: (text) => applyQuery({
        q: text || void 0
      })
    }), /* @__PURE__ */ jsx("label", {
      className: "sort-label",
      htmlFor: "sort",
      children: "Sort"
    }), /* @__PURE__ */ jsx("select", {
      id: "sort",
      value: q.sort || "",
      onChange: (e) => applyQuery({
        sort: e.target.value || void 0
      }),
      children: SORT_OPTIONS.map((o) => /* @__PURE__ */ jsx("option", {
        value: o.value,
        children: o.label
      }, o.value))
    }), /* @__PURE__ */ jsx(FilterSheetButton, {
      viewer,
      queue
    }), canRaise && /* @__PURE__ */ jsxs(Link, {
      className: "button primary raise-link",
      to: "/requests/new",
      children: [/* @__PURE__ */ jsx(PlusIcon, {}), " Raise a correction"]
    })]
  });
}
function FilterSheetButton({
  viewer,
  queue
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  return /* @__PURE__ */ jsxs(Fragment, {
    children: [/* @__PURE__ */ jsxs("button", {
      type: "button",
      className: "button secondary",
      ref: buttonRef,
      onClick: () => setOpen(true),
      children: [/* @__PURE__ */ jsx(FilterIcon, {}), " Filters"]
    }), open && /* @__PURE__ */ jsx(FilterSheet, {
      viewer,
      queue,
      onClose: () => {
        setOpen(false);
        buttonRef.current?.focus();
      }
    })]
  });
}
function StateChipGroup({
  value,
  onApply
}) {
  const refs = useRef({});
  const [focused, setFocused] = useState(null);
  function focusChip(name) {
    const el = refs.current[name];
    if (el) {
      el.focus();
      setFocused(name);
    }
  }
  function onKeyDown(e) {
    const idx = STATE_CHIPS.indexOf(focused ?? value);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusChip(STATE_CHIPS[(idx + 1) % STATE_CHIPS.length]);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusChip(STATE_CHIPS[(idx - 1 + STATE_CHIPS.length) % STATE_CHIPS.length]);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusChip("all");
    } else if (e.key === "End") {
      e.preventDefault();
      focusChip("cancelled");
    }
  }
  return /* @__PURE__ */ jsx("div", {
    role: "radiogroup",
    "aria-label": "Request state",
    className: "chip-group",
    onKeyDown,
    children: STATE_CHIPS.map((state) => {
      const checked = (value || "all") === state;
      return /* @__PURE__ */ jsxs("label", {
        className: `chip-radio${checked ? " checked" : ""}`,
        children: [/* @__PURE__ */ jsx("input", {
          type: "radio",
          name: "request-state",
          value: state,
          checked,
          ref: (el) => {
            refs.current[state] = el;
          },
          onFocus: () => setFocused(state),
          onChange: () => onApply(state),
          tabIndex: checked ? 0 : -1
        }), CHIP_LABEL[state]]
      }, state);
    })
  });
}
function SearchReasons({
  value,
  onApply
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  return /* @__PURE__ */ jsxs("form", {
    className: "search-form",
    role: "search",
    onSubmit: (e) => {
      e.preventDefault();
      onApply(text.trim());
    },
    children: [/* @__PURE__ */ jsx("label", {
      htmlFor: "queue-search",
      className: "visually-hidden",
      children: "Search reasons"
    }), /* @__PURE__ */ jsx(SearchIcon, {
      className: "search-glyph"
    }), /* @__PURE__ */ jsx("input", {
      id: "queue-search",
      type: "search",
      placeholder: "Search reasons",
      value: text,
      onChange: (e) => setText(e.target.value)
    })]
  });
}
function QueueTable({
  viewer,
  queue,
  loading,
  openRow,
  setOpenRow,
  showDraft,
  childActive,
  draftCancelHref
}) {
  const location = useLocation();
  const selectedId = childActive ? Number(location.pathname.split("/")[2]) : null;
  const rows = queue?.rows || [];
  const matched = queue?.matched ?? 0;
  const total = queue?.total ?? 0;
  const page = queue?.page ?? 1;
  const pages = queue?.pages ?? 1;
  const q = queue?.parsedQuery || {
    state: "all",
    page: 1
  };
  useNavigate();
  const navigation = useNavigation();
  useEffect(() => {
    const rowId = location.state?.focusRow;
    if (rowId && !childActive) {
      const el = document.getElementById(`open-request-${rowId}`);
      if (el) {
        el.focus();
      } else {
        document.getElementById("queue-heading")?.focus();
      }
    } else if (location.state?.fromPager) {
      document.getElementById("queue-heading")?.focus();
    }
  }, [location, childActive]);
  useEffect(() => {
    if (navigation.state === "loading") announce("polite", "Loading requests");
  }, [navigation.state]);
  if (loading && rows.length === 0) {
    return /* @__PURE__ */ jsx("p", {
      className: "empty-line",
      children: "Loading requests"
    });
  }
  const emptyWording = matched === 0 && total === 0 ? viewer.role === "employee" ? "You have not raised a correction yet." : viewer.role === "manager" ? "Nothing is waiting on you. Your reports have no open requests." : "No corrections have been raised in this company yet." : matched === 0 ? "filters" : null;
  return /* @__PURE__ */ jsxs("div", {
    className: "table-panel",
    children: [/* @__PURE__ */ jsxs("table", {
      className: "queue-table",
      children: [/* @__PURE__ */ jsxs("caption", {
        className: "table-caption",
        children: [matched, " of ", total, " requests"]
      }), /* @__PURE__ */ jsx("thead", {
        children: /* @__PURE__ */ jsxs("tr", {
          children: [/* @__PURE__ */ jsx("th", {
            scope: "col",
            children: "State"
          }), /* @__PURE__ */ jsx("th", {
            scope: "col",
            children: "Person"
          }), /* @__PURE__ */ jsx("th", {
            scope: "col",
            children: "Day"
          }), /* @__PURE__ */ jsx("th", {
            scope: "col",
            children: "Correction"
          }), /* @__PURE__ */ jsx("th", {
            scope: "col",
            children: "Claimed"
          }), /* @__PURE__ */ jsx("th", {
            scope: "col",
            children: "Recorded"
          }), /* @__PURE__ */ jsx("th", {
            scope: "col",
            children: "Raised"
          }), /* @__PURE__ */ jsx("th", {
            scope: "col",
            children: "Action"
          })]
        })
      }), /* @__PURE__ */ jsxs("tbody", {
        children: [showDraft && /* @__PURE__ */ jsx(DraftRow, {
          cancelHref: draftCancelHref || "/requests"
        }), rows.map((row) => /* @__PURE__ */ jsx(RequestRow, {
          row,
          open: openRow === row.id,
          selected: selectedId === row.id,
          onToggle: () => setOpenRow(openRow === row.id ? null : row.id),
          q
        }, row.id))]
      })]
    }), emptyWording === "filters" && /* @__PURE__ */ jsxs("div", {
      className: "empty-panel",
      children: [/* @__PURE__ */ jsx("p", {
        children: "No requests match these filters. Clear them to see the full queue."
      }), /* @__PURE__ */ jsx("a", {
        className: "button secondary",
        href: queueHref({
          state: "all",
          page: 1
        }),
        children: "Clear filters"
      })]
    }), emptyWording && emptyWording !== "filters" && /* @__PURE__ */ jsx("p", {
      className: "empty-panel",
      children: emptyWording
    }), /* @__PURE__ */ jsx(Pager, {
      page,
      pages,
      q
    })]
  });
}
function RequestRow({
  row,
  open,
  onToggle,
  q,
  selected
}) {
  const cls = `queue-row row-state-${row.state}${selected ? " row-selected" : ""}`;
  const href = `/requests/${row.id}?${canonicalQueueQuery(q)}`;
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (open && !detail) {
      fetch(`/api/requests/${row.id}`).then((r) => r.json()).then((d) => setDetail(d)).catch(() => {
      });
    }
  }, [open, row.id]);
  return /* @__PURE__ */ jsxs(Fragment, {
    children: [/* @__PURE__ */ jsxs("tr", {
      className: `queue-row ${cls}`,
      children: [/* @__PURE__ */ jsx("td", {
        children: /* @__PURE__ */ jsx(StateChip, {
          state: row.state
        })
      }), /* @__PURE__ */ jsx("td", {
        className: "cell-person",
        children: row.person
      }), /* @__PURE__ */ jsx("td", {
        className: "cell-day",
        children: row.day
      }), /* @__PURE__ */ jsx("td", {
        className: "cell-type",
        children: TYPE_LABELS[row.correction_type]
      }), /* @__PURE__ */ jsx("td", {
        className: "cell-times",
        children: formatClaim(row)
      }), /* @__PURE__ */ jsx("td", {
        className: "cell-times",
        children: formatRecorded(row)
      }), /* @__PURE__ */ jsx("td", {
        className: "cell-raised",
        children: row.raised_at.slice(0, 10)
      }), /* @__PURE__ */ jsxs("td", {
        className: "cell-action",
        children: [/* @__PURE__ */ jsx(Link, {
          id: `open-request-${row.id}`,
          className: "row-open",
          to: href,
          state: {
            focusRow: row.id
          },
          children: row.person
        }), /* @__PURE__ */ jsxs("button", {
          type: "button",
          className: "row-expand",
          "aria-expanded": open,
          "aria-controls": `row-detail-${row.id}`,
          onClick: onToggle,
          children: [/* @__PURE__ */ jsxs("span", {
            className: "visually-hidden",
            children: ["Show details for request ", row.id]
          }), /* @__PURE__ */ jsx(ChevronDownIcon, {
            className: open ? "chevron-open" : ""
          })]
        })]
      })]
    }), open && /* @__PURE__ */ jsx("tr", {
      className: "row-detail",
      id: `row-detail-${row.id}`,
      children: /* @__PURE__ */ jsxs("td", {
        colSpan: 8,
        children: [/* @__PURE__ */ jsx("p", {
          className: "row-reason",
          children: row.reason
        }), detail?.audit?.length > 0 && /* @__PURE__ */ jsx("ul", {
          className: "row-trail",
          children: detail.audit.map((a) => /* @__PURE__ */ jsxs("li", {
            children: [a.actor, " ", a.verb.replace("_", " "), " on ", a.occurred_at.slice(0, 10)]
          }, a.seq))
        })]
      })
    })]
  });
}
function formatClaim(row) {
  const t = [row.claimed_in, row.claimed_out].filter(Boolean).join("–");
  return t || "—";
}
function formatRecorded(row) {
  if (!row.recorded_in && !row.recorded_out) return "—";
  const inPart = row.recorded_in ? londonTime(row.recorded_in) : "—";
  const outPart = row.recorded_out ? londonTime(row.recorded_out) : "—";
  return `${inPart}–${outPart}`;
}
function londonTime(iso) {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
function Pager({
  page,
  pages,
  q
}) {
  const navigate = useNavigate();
  if (pages <= 1) return /* @__PURE__ */ jsxs("p", {
    className: "pager-line",
    children: ["Page ", page, " of ", pages]
  });
  const prevHref = queueHref({
    ...q,
    page: Math.max(1, page - 1)
  });
  const nextHref = queueHref({
    ...q,
    page: Math.min(pages, page + 1)
  });
  const go = (href, targetPage) => {
    navigate(href, {
      replace: true,
      state: {
        fromPager: true
      }
    });
    announce("polite", `Page ${targetPage} of ${pages}`);
  };
  return /* @__PURE__ */ jsxs("nav", {
    "aria-label": "Pages",
    className: "pager",
    children: [/* @__PURE__ */ jsx("a", {
      href: prevHref,
      "aria-label": "Previous page",
      onClick: (e) => {
        e.preventDefault();
        go(prevHref, Math.max(1, page - 1));
      },
      children: "Previous page"
    }), /* @__PURE__ */ jsxs("span", {
      children: ["Page ", page, " of ", pages]
    }), /* @__PURE__ */ jsx("a", {
      href: nextHref,
      "aria-label": "Next page",
      onClick: (e) => {
        e.preventDefault();
        go(nextHref, Math.min(pages, page + 1));
      },
      children: "Next page"
    })]
  });
}
const route3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary: ErrorBoundary$4,
  default: requests_layout,
  handle: handle$3,
  loader: loader$5
}, Symbol.toStringTag, { value: "Module" }));
const requests_index = UNSAFE_withComponentProps(function RequestsIndex() {
  return null;
});
const route4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: requests_index
}, Symbol.toStringTag, { value: "Module" }));
const handle$2 = {
  crumb: "Raise a correction"
};
const requests_new = UNSAFE_withComponentProps(function RequestsNew() {
  return null;
});
const route5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: requests_new,
  handle: handle$2
}, Symbol.toStringTag, { value: "Module" }));
function parseDay(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const y = Number(day.slice(0, 4));
  const mo = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  if (mo < 1 || mo > 12) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { year: y, month: mo, day: d };
}
function isValidMonth(month) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  return parseDay(`${month}-01`) !== null;
}
function dayToUtcDate(day) {
  const { year, month, day: d } = parseDay(day);
  return new Date(Date.UTC(year, month - 1, d));
}
function addDays(day, n) {
  const dt = dayToUtcDate(day);
  dt.setUTCDate(dt.getUTCDate() + n);
  return businessDayOfUtc(dt);
}
function businessDayOfUtc(dt) {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function daysInMonth(month) {
  const { year, month: mo } = parseDay(`${month}-01`);
  return new Date(Date.UTC(year, mo, 0)).getUTCDate();
}
function addMonths(month, n) {
  const { year, month: mo } = parseDay(`${month}-01`);
  const d = new Date(Date.UTC(year, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function formatTimestamp(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function monthName(month) {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1];
}
function daysOfMonth(month) {
  const n = daysInMonth(month);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(`${month}-${String(i).padStart(2, "0")}`);
  return out;
}
async function loader$4({
  request,
  params
}) {
  const {
    viewerFromRequest,
    loadDetail
  } = await import("./data.server-Bjfv_yW6.js").then((n) => n.d);
  const viewer = await viewerFromRequest(request);
  if (!viewer) throw data(null, {
    status: 401
  });
  if (!/^[1-9][0-9]*$/.test(params.id) || params.id.length > 19 || params.id.length === 19 && params.id > "9223372036854775807") {
    throw data(null, {
      status: 404
    });
  }
  try {
    const detail = await loadDetail(viewer, Number(params.id));
    return {
      viewer,
      detail,
      crumb: `Correction for ${detail.request.day}`
    };
  } catch {
    throw data(null, {
      status: 404
    });
  }
}
const requests_$id = UNSAFE_withComponentProps(function RequestDetail() {
  const {
    viewer,
    detail
  } = useLoaderData();
  const location = useLocation();
  const revalidator = useRevalidator();
  const [current, setCurrent] = useState(detail);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState(null);
  const [ended, setEnded] = useState(null);
  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [current.request.id]);
  useEffect(() => {
    setCurrent(detail);
    setNote("");
    setAlert(null);
  }, [detail]);
  const request = current.request;
  const day = request.day;
  const mayDecide = viewer.role !== "admin" && request.state === "pending" && request.person !== viewer.name;
  const mayWithdraw = request.state === "pending" && isRaiser(viewer, current);
  async function decide(outcome) {
    if (busy) return;
    setBusy(true);
    announce("polite", "Saving decision");
    try {
      const res = await fetch(`/api/requests/${request.id}/decision`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          outcome,
          note: note || null
        })
      });
      const data2 = await res.json().catch(() => ({}));
      if (res.ok) {
        setCurrent((c) => ({
          ...c,
          request: data2
        }));
        announce("assertive", outcome === "approve" ? `Correction approved. The attendance record for ${day} now reads the claimed times.` : "Correction rejected.");
        headingRef.current?.focus();
        await revalidator.revalidate();
        return;
      }
      if (res.status === 409) {
        announce("assertive", data2.error);
        const fresh = await fetch(`/api/requests/${request.id}`).then((r) => r.json());
        setCurrent(fresh);
        setAlert(null);
        headingRef.current?.focus();
        await revalidator.revalidate();
        return;
      }
      if (res.status === 401 && data2.error === "Your session has ended. Sign in again.") {
        setEnded(data2.error);
        return;
      }
      setAlert(data2.error || "The desk could not reach the server. Try again.");
      announce("assertive", data2.error || "The desk could not reach the server. Try again.");
    } catch {
      setAlert("The desk could not reach the server. Try again.");
      announce("assertive", "The desk could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    if (busy) return;
    setBusy(true);
    announce("polite", "Withdrawing request");
    try {
      const res = await fetch(`/api/requests/${request.id}/cancel`, {
        method: "POST"
      });
      const data2 = await res.json().catch(() => ({}));
      if (res.ok) {
        setCurrent((c) => ({
          ...c,
          request: data2
        }));
        announce("assertive", "Request withdrawn. That day is free to claim again.");
        headingRef.current?.focus();
        await revalidator.revalidate();
        return;
      }
      if (res.status === 409) {
        announce("assertive", data2.error);
        const fresh = await fetch(`/api/requests/${request.id}`).then((r) => r.json());
        setCurrent(fresh);
        headingRef.current?.focus();
        await revalidator.revalidate();
        return;
      }
      if (res.status === 401 && data2.error === "Your session has ended. Sign in again.") {
        setEnded(data2.error);
        return;
      }
      setAlert(data2.error || "The desk could not reach the server. Try again.");
    } catch {
      setAlert("The desk could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const backHref = `/requests?${location.search ? location.search.slice(1) : ""}`;
  return /* @__PURE__ */ jsxs("section", {
    className: "detail-pane",
    "aria-labelledby": "detail-heading",
    children: [/* @__PURE__ */ jsxs("h1", {
      id: "detail-heading",
      ref: headingRef,
      tabIndex: -1,
      children: ["Correction for ", day]
    }), /* @__PURE__ */ jsx("p", {
      className: "detail-state",
      children: /* @__PURE__ */ jsx(StateChip, {
        state: request.state
      })
    }), /* @__PURE__ */ jsxs("p", {
      className: "raised-by",
      children: ["Raised by ", request.person, ", reporting to ", request.manager ?? "nobody"]
    }), viewer.role === "admin" && current.contact && /* @__PURE__ */ jsxs("div", {
      className: "contact-block",
      children: [/* @__PURE__ */ jsx("h2", {
        children: "Contact on file"
      }), /* @__PURE__ */ jsxs("p", {
        children: ["Phone ", current.contact.phone]
      }), /* @__PURE__ */ jsx("p", {
        children: current.contact.private_note
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "evidence",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "evidence-block",
        children: [/* @__PURE__ */ jsx("h2", {
          children: "What the clock recorded"
        }), /* @__PURE__ */ jsx(PunchLine, {
          label: "Sign in",
          instant: current.evidence.recorded_in
        }), /* @__PURE__ */ jsx(PunchLine, {
          label: "Sign out",
          instant: current.evidence.recorded_out
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "evidence-block",
        children: [/* @__PURE__ */ jsx("h2", {
          children: "What is claimed"
        }), /* @__PURE__ */ jsx("p", {
          children: TYPE_LABELS[request.correction_type]
        }), /* @__PURE__ */ jsxs("p", {
          children: [request.claimed_in || "Not recorded", request.claimed_in && request.claimed_out && " – ", request.claimed_out ? request.correction_type === "night_shift" ? `${request.claimed_out} on ${addDays(day, 1)}` : request.claimed_out : ""]
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "evidence-block",
        children: [/* @__PURE__ */ jsx("h2", {
          children: "Leave that day"
        }), current.leave ? /* @__PURE__ */ jsxs("p", {
          children: [current.leave.label, ", ", current.leave.status]
        }) : /* @__PURE__ */ jsx("p", {
          children: "No leave recorded"
        })]
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "reason-block",
      children: [/* @__PURE__ */ jsx("h2", {
        children: "Reason given"
      }), /* @__PURE__ */ jsx("p", {
        className: "pane-prose",
        children: request.reason
      })]
    }), mayDecide && /* @__PURE__ */ jsxs("div", {
      className: "decision-controls",
      children: [/* @__PURE__ */ jsx("label", {
        htmlFor: "decision-note",
        children: "Note"
      }), /* @__PURE__ */ jsx("textarea", {
        id: "decision-note",
        rows: 2,
        value: note,
        onChange: (e) => setNote(e.target.value),
        "aria-describedby": "decision-note-help"
      }), /* @__PURE__ */ jsx("p", {
        className: "help",
        id: "decision-note-help",
        children: "Required when rejecting. At least ten characters."
      }), alert && /* @__PURE__ */ jsx("p", {
        className: "form-error",
        role: "alert",
        children: alert
      }), ended && /* @__PURE__ */ jsxs("p", {
        className: "form-error",
        role: "alert",
        children: [ended, " ", /* @__PURE__ */ jsx(Link, {
          to: `/login?next=${encodeURIComponent(location.pathname + location.search)}`,
          children: "Sign in again"
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "decision-buttons",
        children: [/* @__PURE__ */ jsx("button", {
          type: "button",
          className: "primary",
          onClick: () => decide("approve"),
          disabled: busy,
          children: "Approve"
        }), /* @__PURE__ */ jsx("button", {
          type: "button",
          className: "secondary",
          onClick: () => decide("reject"),
          disabled: busy,
          children: "Reject"
        })]
      }), busy && /* @__PURE__ */ jsx("p", {
        className: "status-line",
        role: "status",
        children: "Saving decision"
      })]
    }), mayWithdraw && /* @__PURE__ */ jsxs("div", {
      className: "decision-controls",
      children: [alert && /* @__PURE__ */ jsx("p", {
        className: "form-error",
        role: "alert",
        children: alert
      }), ended && /* @__PURE__ */ jsxs("p", {
        className: "form-error",
        role: "alert",
        children: [ended, " ", /* @__PURE__ */ jsx(Link, {
          to: `/login?next=${encodeURIComponent(location.pathname + location.search)}`,
          children: "Sign in again"
        })]
      }), /* @__PURE__ */ jsx("button", {
        type: "button",
        className: "secondary",
        onClick: withdraw,
        disabled: busy,
        children: "Withdraw"
      }), busy && /* @__PURE__ */ jsx("p", {
        className: "status-line",
        role: "status",
        children: "Withdrawing request"
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "trail-block",
      children: [/* @__PURE__ */ jsx("h2", {
        children: "What happened"
      }), current.audit.length === 0 ? /* @__PURE__ */ jsx("p", {
        className: "pane-prose",
        children: "Nothing has been decided yet."
      }) : /* @__PURE__ */ jsx("ul", {
        className: "trail-list pane-prose",
        children: current.audit.map((a) => /* @__PURE__ */ jsxs("li", {
          children: [a.actor, " ", a.verb.replace("_", " "), " on ", a.occurred_at.slice(0, 10), a.note ? ` — ${a.note}` : ""]
        }, a.seq))
      })]
    }), /* @__PURE__ */ jsx("p", {
      className: "detail-back",
      children: /* @__PURE__ */ jsx(Link, {
        to: backHref,
        state: {
          focusRow: request.id
        },
        children: "Back to the queue"
      })
    })]
  });
});
function PunchLine({
  label,
  instant
}) {
  const time = instant ? new Date(instant).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }) : null;
  return /* @__PURE__ */ jsxs("p", {
    children: [label, ": ", time ?? "Not recorded"]
  });
}
function isRaiser(viewer, detail) {
  return detail.request.work_address === viewer.work_address;
}
const route6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: requests_$id,
  loader: loader$4
}, Symbol.toStringTag, { value: "Module" }));
const MARKS = Object.entries(MARK_LABEL);
function MonthGrid({ month, days }) {
  const firstWeekday = (new Date(Date.UTC(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)) - 1,
    1
  )).getUTCDay() + 6) % 7;
  const leading = [];
  if (firstWeekday > 0) {
    const prevMonth = addMonths(month, -1);
    const prevDays = daysInMonth(prevMonth);
    for (let i = firstWeekday - 1; i >= 0; i--) {
      leading.push({ day: `${prevMonth}-${String(prevDays - i).padStart(2, "0")}`, out: true });
    }
  }
  const trailing = [];
  const total = leading.length + days.length;
  const rows = Math.ceil(total / 7);
  const trailingCount = rows * 7 - total;
  if (trailingCount > 0) {
    const nextMonth = addMonths(month, 1);
    for (let i = 1; i <= trailingCount; i++) {
      trailing.push({ day: `${nextMonth}-${String(i).padStart(2, "0")}`, out: true });
    }
  }
  const cells = [...leading, ...days.map((d) => ({ ...d, out: false })), ...trailing];
  return /* @__PURE__ */ jsxs("table", { className: "month-grid", children: [
    /* @__PURE__ */ jsxs("caption", { children: [
      monthName(month),
      " ",
      month.slice(0, 4)
    ] }),
    /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsx("tr", { children: WEEKDAYS.map((w) => /* @__PURE__ */ jsx("th", { scope: "col", abbr: w, children: w }, w)) }) }),
    /* @__PURE__ */ jsx("tbody", { children: chunk(cells, 7).map((week, i) => /* @__PURE__ */ jsx("tr", { children: week.map((cell) => {
      if (cell.out) {
        const d = Number(cell.day.slice(8, 10));
        const mon = MONTH_NAMES[Number(cell.day.slice(5, 7)) - 1].slice(0, 3);
        return /* @__PURE__ */ jsx("td", { className: "out-of-month", children: /* @__PURE__ */ jsxs("span", { children: [
          d,
          " ",
          mon
        ] }) }, cell.day);
      }
      const counts = cell.counts || {};
      return /* @__PURE__ */ jsxs("td", { className: "in-month", children: [
        /* @__PURE__ */ jsx("span", { className: "day-number", children: Number(cell.day.slice(8, 10)) }),
        MARKS.map(([key, label]) => {
          const n = counts[key] || 0;
          if (n === 0) return null;
          const Glyph = MARK_GLYPH[key];
          return /* @__PURE__ */ jsxs("span", { className: "cell-mark", children: [
            /* @__PURE__ */ jsx(Glyph, { className: "mark-glyph" }),
            /* @__PURE__ */ jsxs("span", { className: "mark-word", children: [
              label,
              ": ",
              n
            ] })
          ] }, key);
        })
      ] }, cell.day);
    }) }, i)) })
  ] });
}
function MarkLegend() {
  return /* @__PURE__ */ jsxs("div", { className: "legend", children: [
    /* @__PURE__ */ jsx("h2", { children: "What the marks mean" }),
    /* @__PURE__ */ jsx("ul", { children: MARKS.map(([key, label]) => {
      const Glyph = MARK_GLYPH[key];
      return /* @__PURE__ */ jsxs("li", { children: [
        /* @__PURE__ */ jsx(Glyph, { className: "mark-glyph" }),
        /* @__PURE__ */ jsx("span", { children: label })
      ] }, key);
    }) })
  ] });
}
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
const handle$1 = {
  crumb: "Team calendar"
};
const ErrorBoundary$3 = UNSAFE_withErrorBoundaryProps(function ErrorBoundary2() {
  return /* @__PURE__ */ jsx(RouteErrorBoundary, {
    error: useRouteError(),
    signedIn: true
  });
});
async function loader$3({
  request
}) {
  const {
    viewerFromRequest,
    loadCalendar,
    loadPolicyVersion
  } = await import("./data.server-Bjfv_yW6.js").then((n) => n.d);
  const viewer = await viewerFromRequest(request);
  if (!viewer) throw data(null, {
    status: 401
  });
  if (viewer.role === "employee") throw data(null, {
    status: 403
  });
  const url = new URL(request.url);
  let month = url.searchParams.get("month") || "";
  if (!month) {
    const {
      query
    } = await import("./pg-C3ev9-Vg.js");
    const rows = await query("SELECT seeded_on FROM employer WHERE id = 1");
    month = rows[0].seeded_on.toISOString().slice(0, 7);
  }
  const person = url.searchParams.get("person") || "";
  const calendar2 = await loadCalendar(viewer, month, person);
  return {
    viewer,
    ...calendar2,
    policyVersion: await loadPolicyVersion()
  };
}
const calendar = UNSAFE_withComponentProps(function Calendar() {
  const {
    viewer,
    month,
    days,
    people
  } = useLoaderData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [person, setPerson] = useState(params.get("person") || "");
  const [monthInput, setMonthInput] = useState(month);
  const [sharedLink, setSharedLink] = useState(null);
  const [linkError, setLinkError] = useState(null);
  const [busy, setBusy] = useState(false);
  const narrowed = people.find((p) => p.work_address === person);
  const canShare = !!narrowed && (viewer.role === "admin" || viewer.role === "manager");
  function show() {
    const next = new URLSearchParams();
    if (monthInput) next.set("month", monthInput);
    if (person) next.set("person", person);
    setSharedLink(null);
    navigate(`/calendar?${next.toString()}`, {
      replace: true
    });
  }
  async function share() {
    if (busy || !narrowed) return;
    setBusy(true);
    setLinkError(null);
    announce("polite", "Creating shared link");
    try {
      const res = await fetch("/api/share-links", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          person_id: narrowed.id,
          month
        })
      });
      const data2 = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLinkError(data2.error || "The desk could not reach the server. Try again.");
        announce("assertive", data2.error || "The desk could not reach the server. Try again.");
        return;
      }
      setSharedLink(data2);
      const expires = data2.expires_at.replace("T", " ").slice(0, 16);
      announce("assertive", `Shared link created. It works until ${expires}. Any earlier link for this month no longer works.`);
      requestAnimationFrame(() => {
        const el = document.getElementById("shared-link-field");
        el?.focus();
        el?.select();
      });
    } catch {
      setLinkError("The desk could not reach the server. Try again.");
      announce("assertive", "The desk could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!sharedLink) return;
    setBusy(true);
    announce("polite", "Revoking link");
    try {
      const res = await fetch(`/api/share-links/${sharedLink.id}`, {
        method: "DELETE"
      });
      if (res.status === 204) {
        setSharedLink(null);
        announce("assertive", "Shared link revoked.");
        document.getElementById("share-month")?.focus();
      } else {
        const data2 = await res.json().catch(() => ({}));
        announce("assertive", data2.error || "The desk could not reach the server. Try again.");
        if (res.status === 409) setSharedLink(null);
      }
    } catch {
      announce("assertive", "The desk could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "calendar-page",
    children: [/* @__PURE__ */ jsx("h1", {
      children: "Team calendar"
    }), /* @__PURE__ */ jsxs("div", {
      className: "month-steps",
      children: [/* @__PURE__ */ jsx("a", {
        href: `/calendar?month=${addMonths(month, -1)}${person ? `&person=${encodeURIComponent(person)}` : ""}`,
        children: "Previous month"
      }), /* @__PURE__ */ jsxs("span", {
        className: "month-name",
        children: [monthName(month), " ", month.slice(0, 4)]
      }), /* @__PURE__ */ jsx("a", {
        href: `/calendar?month=${addMonths(month, 1)}${person ? `&person=${encodeURIComponent(person)}` : ""}`,
        children: "Next month"
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "calendar-narrow",
      children: [/* @__PURE__ */ jsx("label", {
        htmlFor: "calendar-person",
        children: "Person"
      }), /* @__PURE__ */ jsxs("select", {
        id: "calendar-person",
        value: person,
        onChange: (e) => {
          setPerson(e.target.value);
          setSharedLink(null);
        },
        children: [/* @__PURE__ */ jsx("option", {
          value: "",
          children: "Everyone in scope"
        }), people.map((p) => /* @__PURE__ */ jsx("option", {
          value: p.work_address,
          children: p.name
        }, p.id))]
      }), /* @__PURE__ */ jsx("label", {
        htmlFor: "calendar-month",
        className: "visually-hidden",
        children: "Month"
      }), /* @__PURE__ */ jsx("input", {
        id: "calendar-month",
        type: "text",
        className: "calendar-month-input",
        value: monthInput,
        onChange: (e) => {
          setMonthInput(e.target.value);
          setSharedLink(null);
        },
        "aria-label": "Month"
      }), /* @__PURE__ */ jsx("button", {
        type: "button",
        className: "primary",
        onClick: show,
        children: "Show"
      }), canShare && /* @__PURE__ */ jsx("button", {
        type: "button",
        className: "secondary",
        id: "share-month",
        onClick: share,
        disabled: busy,
        children: "Share this month"
      })]
    }), linkError && /* @__PURE__ */ jsx("p", {
      className: "form-error",
      role: "alert",
      children: linkError
    }), sharedLink && /* @__PURE__ */ jsxs("div", {
      className: "shared-link-row",
      children: [/* @__PURE__ */ jsx("label", {
        htmlFor: "shared-link-field",
        children: "Shared link"
      }), /* @__PURE__ */ jsx("input", {
        id: "shared-link-field",
        type: "text",
        readOnly: true,
        value: `${window.location?.origin || ""}/share/${sharedLink.token}`
      }), /* @__PURE__ */ jsx("button", {
        type: "button",
        className: "secondary",
        onClick: revoke,
        disabled: busy,
        children: "Revoke link"
      })]
    }), /* @__PURE__ */ jsx(MonthGrid, {
      month,
      days
    }), /* @__PURE__ */ jsx(MarkLegend, {})]
  });
});
const route7 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary: ErrorBoundary$3,
  default: calendar,
  handle: handle$1,
  loader: loader$3
}, Symbol.toStringTag, { value: "Module" }));
const handle = {
  crumb: "Correction policy"
};
const ErrorBoundary$2 = UNSAFE_withErrorBoundaryProps(function ErrorBoundary3() {
  return /* @__PURE__ */ jsx(RouteErrorBoundary, {
    error: useRouteError(),
    signedIn: true
  });
});
async function loader$2({
  request
}) {
  const {
    viewerFromRequest,
    loadPolicyFull
  } = await import("./data.server-Bjfv_yW6.js").then((n) => n.d);
  const viewer = await viewerFromRequest(request);
  if (!viewer) throw data(null, {
    status: 401
  });
  if (viewer.role !== "admin") throw data(null, {
    status: 403
  });
  const full = await loadPolicyFull();
  return {
    viewer,
    ...full,
    policyVersion: full.policy.version
  };
}
const policy = UNSAFE_withComponentProps(function Policy() {
  const {
    policy: policy2,
    history,
    trail
  } = useLoaderData();
  const revalidator = useRevalidator();
  const [form, setForm] = useState({
    monthly_cap: policy2.monthly_cap,
    lookback_days: policy2.lookback_days,
    enabled_types: policy2.enabled_types,
    require_note_on_approve: policy2.require_note_on_approve
  });
  const [changingVersion, setChangingVersion] = useState(policy2.version);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState(null);
  const [callout, setCallout] = useState(null);
  const saveRef = useRef(null);
  async function save() {
    if (busy) return;
    setBusy(true);
    setFieldError(null);
    announce("polite", "Saving policy");
    try {
      const res = await fetch("/api/policy", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": `"${changingVersion}"`
        },
        body: JSON.stringify(form)
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setChangingVersion(body.version);
        setCallout(null);
        announce("assertive", `Policy version ${body.version} is now in force.`);
        await revalidator.revalidate();
        saveRef.current?.focus();
        return;
      }
      if (res.status === 412) {
        setCallout(`Version ${body.version} was saved by ${body.created_by}. Your changes are still in the form.`);
        const fresh = await fetch("/api/policy").then((r) => r.json());
        setChangingVersion(fresh.version);
        announce("assertive", body.error);
        await revalidator.revalidate();
        saveRef.current?.focus();
        return;
      }
      if (body.field) setFieldError(body.field);
      announce("assertive", body.error || "The desk could not reach the server. Try again.");
      if (body.field === "enabled_types") {
        document.getElementById("type-missed_in")?.focus();
      } else if (body.field) {
        document.getElementById(`policy-${body.field}`)?.focus();
      }
    } catch {
      announce("assertive", "The desk could not reach the server. Try again.");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "policy-page",
    children: [/* @__PURE__ */ jsx("h1", {
      children: "Correction policy"
    }), callout && /* @__PURE__ */ jsx("p", {
      className: "callout",
      role: "note",
      children: callout
    }), /* @__PURE__ */ jsxs("form", {
      className: "policy-form",
      onSubmit: (e) => {
        e.preventDefault();
        setConfirmOpen(true);
      },
      children: [/* @__PURE__ */ jsxs("fieldset", {
        children: [/* @__PURE__ */ jsx("legend", {
          children: "Corrections allowed per person each month, and the lookback"
        }), /* @__PURE__ */ jsxs("div", {
          className: "field",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "policy-monthly_cap",
            children: "Corrections allowed per person each month"
          }), /* @__PURE__ */ jsx("input", {
            id: "policy-monthly_cap",
            type: "number",
            min: 0,
            max: 10,
            value: form.monthly_cap,
            onChange: (e) => setForm({
              ...form,
              monthly_cap: e.target.value
            }),
            "aria-invalid": fieldError === "monthly_cap",
            "aria-describedby": fieldError === "monthly_cap" ? "policy-monthly_cap-error" : void 0
          }), fieldError === "monthly_cap" && /* @__PURE__ */ jsx("p", {
            className: "help error",
            id: "policy-monthly_cap-error",
            role: "alert",
            children: "monthly_cap must be a whole number from 0 to 10."
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "field",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "policy-lookback_days",
            children: "How many days back a correction may reach"
          }), /* @__PURE__ */ jsx("input", {
            id: "policy-lookback_days",
            type: "number",
            min: 1,
            max: 90,
            value: form.lookback_days,
            onChange: (e) => setForm({
              ...form,
              lookback_days: e.target.value
            }),
            "aria-invalid": fieldError === "lookback_days",
            "aria-describedby": fieldError === "lookback_days" ? "policy-lookback_days-error" : void 0
          }), fieldError === "lookback_days" && /* @__PURE__ */ jsx("p", {
            className: "help error",
            id: "policy-lookback_days-error",
            role: "alert",
            children: "lookback_days must be a whole number from 1 to 90."
          })]
        })]
      }), /* @__PURE__ */ jsxs("fieldset", {
        "aria-invalid": fieldError === "enabled_types",
        "aria-describedby": fieldError === "enabled_types" ? "policy-enabled_types-error" : void 0,
        children: [/* @__PURE__ */ jsx("legend", {
          children: "Corrections people may raise"
        }), TYPE_CODES.map((t) => /* @__PURE__ */ jsxs("label", {
          className: "check-line",
          children: [/* @__PURE__ */ jsx("input", {
            id: `type-${t}`,
            type: "checkbox",
            checked: form.enabled_types.includes(t),
            "aria-invalid": fieldError === "enabled_types",
            onChange: (e) => {
              setForm({
                ...form,
                enabled_types: e.target.checked ? TYPE_CODES.filter((c) => form.enabled_types.includes(c) || c === t) : form.enabled_types.filter((c) => c !== t)
              });
            }
          }), TYPE_LABELS[t]]
        }, t)), fieldError === "enabled_types" && /* @__PURE__ */ jsx("p", {
          className: "help error",
          id: "policy-enabled_types-error",
          role: "alert",
          children: "At least one correction type must stay available."
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "field",
        children: [/* @__PURE__ */ jsxs("label", {
          className: "check-line",
          children: [/* @__PURE__ */ jsx("input", {
            id: "policy-require_note_on_approve",
            type: "checkbox",
            checked: form.require_note_on_approve,
            "aria-invalid": fieldError === "require_note_on_approve",
            onChange: (e) => setForm({
              ...form,
              require_note_on_approve: e.target.checked
            })
          }), "Require a note when approving"]
        }), fieldError === "require_note_on_approve" && /* @__PURE__ */ jsx("p", {
          className: "help error",
          role: "alert",
          children: "require_note_on_approve must be true or false."
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "field",
        children: [/* @__PURE__ */ jsxs("label", {
          className: "check-line",
          htmlFor: "policy-self_approval",
          children: [/* @__PURE__ */ jsx("input", {
            id: "policy-self_approval",
            type: "checkbox",
            role: "switch",
            checked: false,
            disabled: true,
            "aria-describedby": "policy-self-help"
          }), "Allow managers to approve their own corrections"]
        }), /* @__PURE__ */ jsx("p", {
          className: "help",
          id: "policy-self-help",
          children: "Not available. Self approval is refused by this product."
        })]
      }), /* @__PURE__ */ jsx("button", {
        type: "submit",
        className: "primary",
        ref: saveRef,
        disabled: busy,
        children: "Save new version"
      }), busy && /* @__PURE__ */ jsx("p", {
        className: "status-line",
        role: "status",
        children: "Saving policy"
      })]
    }), confirmOpen && /* @__PURE__ */ jsx(ConfirmDialog, {
      version: changingVersion + 1,
      onSave: save,
      onClose: () => {
        setConfirmOpen(false);
        saveRef.current?.focus();
      }
    }), /* @__PURE__ */ jsxs("section", {
      className: "policy-history",
      children: [/* @__PURE__ */ jsx("h2", {
        children: "Previous versions"
      }), /* @__PURE__ */ jsxs("table", {
        className: "history-table",
        children: [/* @__PURE__ */ jsx("caption", {
          className: "visually-hidden",
          children: "Policy version history"
        }), /* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            children: [/* @__PURE__ */ jsx("th", {
              scope: "col",
              children: "Version"
            }), /* @__PURE__ */ jsx("th", {
              scope: "col",
              children: "Cap"
            }), /* @__PURE__ */ jsx("th", {
              scope: "col",
              children: "Lookback"
            }), /* @__PURE__ */ jsx("th", {
              scope: "col",
              children: "Saved by"
            }), /* @__PURE__ */ jsx("th", {
              scope: "col",
              children: "Saved at"
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          children: history.map((v) => /* @__PURE__ */ jsxs("tr", {
            children: [/* @__PURE__ */ jsx("td", {
              children: v.version
            }), /* @__PURE__ */ jsx("td", {
              children: v.monthly_cap
            }), /* @__PURE__ */ jsx("td", {
              children: v.lookback_days
            }), /* @__PURE__ */ jsx("td", {
              children: v.created_by
            }), /* @__PURE__ */ jsx("td", {
              children: v.created_at.slice(0, 10)
            })]
          }, v.version))
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "policy-trail",
      children: [/* @__PURE__ */ jsx("h2", {
        children: "Whole trail"
      }), /* @__PURE__ */ jsx("p", {
        children: /* @__PURE__ */ jsxs("a", {
          href: "/api/trail.csv",
          className: "trail-download",
          children: [/* @__PURE__ */ jsx(DownloadIcon, {}), " Download trail"]
        })
      }), /* @__PURE__ */ jsx("ul", {
        className: "trail-list",
        children: trail.map((a) => /* @__PURE__ */ jsxs("li", {
          children: [a.seq, ". ", a.actor, " ", a.verb.replace("_", " "), " on ", a.occurred_at.slice(0, 10), a.note ? ` — ${a.note}` : ""]
        }, a.seq))
      })]
    })]
  });
});
function ConfirmDialog({
  version,
  onSave,
  onClose
}) {
  const dialogRef = useRef(null);
  return /* @__PURE__ */ jsxs("div", {
    ref: dialogRef,
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "confirm-heading",
    className: "confirm-dialog",
    onKeyDown: (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const focusables = dialogRef.current.querySelectorAll("button");
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    children: [/* @__PURE__ */ jsx("h2", {
      id: "confirm-heading",
      children: "Save this policy?"
    }), /* @__PURE__ */ jsxs("p", {
      children: ["This appends version ", version, ". Requests already waiting stay waiting."]
    }), /* @__PURE__ */ jsxs("div", {
      className: "sheet-actions",
      children: [/* @__PURE__ */ jsx("button", {
        type: "button",
        className: "secondary",
        autoFocus: true,
        onClick: onSave,
        children: "Save"
      }), /* @__PURE__ */ jsx("button", {
        type: "button",
        className: "secondary",
        onClick: onClose,
        children: "Keep editing"
      })]
    })]
  });
}
const route8 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary: ErrorBoundary$2,
  default: policy,
  handle,
  loader: loader$2
}, Symbol.toStringTag, { value: "Module" }));
async function loader$1({
  params
}) {
  const {
    loadShareMonth
  } = await import("./data.server-Bjfv_yW6.js").then((n) => n.d);
  const result = await loadShareMonth(params.token || "");
  if (result.kind === "unknown") throw data(null, {
    status: 404
  });
  if (result.kind === "dead") throw data(null, {
    status: 410
  });
  return {
    share: result
  };
}
const ErrorBoundary$1 = UNSAFE_withErrorBoundaryProps(function ErrorBoundary4() {
  return /* @__PURE__ */ jsx(RouteErrorBoundary, {
    error: useRouteError(),
    share: true
  });
});
const share_$token = UNSAFE_withComponentProps(function SharedMonth() {
  const {
    share
  } = useLoaderData();
  const month = share.month;
  return /* @__PURE__ */ jsxs(Fragment, {
    children: [/* @__PURE__ */ jsx("header", {
      className: "share-banner",
      children: /* @__PURE__ */ jsx("p", {
        className: "brand",
        children: "Rostara"
      })
    }), /* @__PURE__ */ jsxs("main", {
      id: "main",
      className: "share-main",
      children: [/* @__PURE__ */ jsxs("h1", {
        children: [share.name, ", ", monthName(month), " ", month.slice(0, 4)]
      }), /* @__PURE__ */ jsx(MonthGrid, {
        month,
        days: share.days
      }), /* @__PURE__ */ jsx(MarkLegend, {})]
    }), /* @__PURE__ */ jsx("footer", {
      className: "share-footer",
      children: "Rostara attendance desk. Shared read-only."
    })]
  });
});
const route9 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary: ErrorBoundary$1,
  default: share_$token,
  loader: loader$1
}, Symbol.toStringTag, { value: "Module" }));
async function loader() {
  throw data(null, {
    status: 404
  });
}
const ErrorBoundary5 = UNSAFE_withErrorBoundaryProps(function ErrorBoundary6() {
  return /* @__PURE__ */ jsx(RouteErrorBoundary, {
    error: useRouteError()
  });
});
const splat = UNSAFE_withComponentProps(function Splat() {
  return null;
});
const route10 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary: ErrorBoundary5,
  default: splat,
  loader
}, Symbol.toStringTag, { value: "Module" }));
const serverManifest = { "entry": { "module": "/assets/entry.client-CoZ2SVXr.js", "imports": ["/assets/jsx-runtime-D_zvdyIk.js", "/assets/chunk-6KYCQHYJ-CW14n2Oe.js"], "css": [] }, "routes": { "root": { "id": "root", "parentId": void 0, "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/root-CalCWvS1.js", "imports": ["/assets/jsx-runtime-D_zvdyIk.js", "/assets/chunk-6KYCQHYJ-CW14n2Oe.js", "/assets/icons-C4ykedoB.js", "/assets/LiveRegions-BL3OF-Wt.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/home": { "id": "routes/home", "parentId": "root", "path": "/", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/home-BWzvHCEp.js", "imports": ["/assets/chunk-6KYCQHYJ-CW14n2Oe.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/login": { "id": "routes/login", "parentId": "root", "path": "/login", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/login-B7ZuO4fj.js", "imports": ["/assets/chunk-6KYCQHYJ-CW14n2Oe.js", "/assets/jsx-runtime-D_zvdyIk.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/requests.layout": { "id": "routes/requests.layout", "parentId": "root", "path": "/requests", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": true, "module": "/assets/requests.layout-Bd3dnrw8.js", "imports": ["/assets/chunk-6KYCQHYJ-CW14n2Oe.js", "/assets/jsx-runtime-D_zvdyIk.js", "/assets/StateChip-BDdJjSAm.js", "/assets/queue-query-CAlf8DTm.js", "/assets/LiveRegions-BL3OF-Wt.js", "/assets/icons-C4ykedoB.js", "/assets/ErrorPages-CCoxEvta.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/requests.index": { "id": "routes/requests.index", "parentId": "routes/requests.layout", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/requests.index-D3QVYUAk.js", "imports": ["/assets/chunk-6KYCQHYJ-CW14n2Oe.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/requests.new": { "id": "routes/requests.new", "parentId": "routes/requests.layout", "path": "new", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/requests.new-DvANvxp_.js", "imports": ["/assets/chunk-6KYCQHYJ-CW14n2Oe.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/requests.$id": { "id": "routes/requests.$id", "parentId": "routes/requests.layout", "path": ":id", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/requests._id-CjmzpRPf.js", "imports": ["/assets/chunk-6KYCQHYJ-CW14n2Oe.js", "/assets/jsx-runtime-D_zvdyIk.js", "/assets/StateChip-BDdJjSAm.js", "/assets/LiveRegions-BL3OF-Wt.js", "/assets/queue-query-CAlf8DTm.js", "/assets/time-CFpi837H.js", "/assets/icons-C4ykedoB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/calendar": { "id": "routes/calendar", "parentId": "root", "path": "/calendar", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": true, "module": "/assets/calendar-DsijW-Og.js", "imports": ["/assets/chunk-6KYCQHYJ-CW14n2Oe.js", "/assets/jsx-runtime-D_zvdyIk.js", "/assets/LiveRegions-BL3OF-Wt.js", "/assets/ErrorPages-CCoxEvta.js", "/assets/MonthGrid-BgfbgWUS.js", "/assets/time-CFpi837H.js", "/assets/icons-C4ykedoB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/policy": { "id": "routes/policy", "parentId": "root", "path": "/policy", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": true, "module": "/assets/policy-BAmmZvoP.js", "imports": ["/assets/chunk-6KYCQHYJ-CW14n2Oe.js", "/assets/jsx-runtime-D_zvdyIk.js", "/assets/LiveRegions-BL3OF-Wt.js", "/assets/ErrorPages-CCoxEvta.js", "/assets/icons-C4ykedoB.js", "/assets/queue-query-CAlf8DTm.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/share.$token": { "id": "routes/share.$token", "parentId": "root", "path": "/share/:token", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": true, "module": "/assets/share._token-CNQf1_I1.js", "imports": ["/assets/chunk-6KYCQHYJ-CW14n2Oe.js", "/assets/jsx-runtime-D_zvdyIk.js", "/assets/ErrorPages-CCoxEvta.js", "/assets/MonthGrid-BgfbgWUS.js", "/assets/time-CFpi837H.js", "/assets/icons-C4ykedoB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/splat": { "id": "routes/splat", "parentId": "root", "path": "*", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": true, "module": "/assets/splat-DCI8HDRu.js", "imports": ["/assets/chunk-6KYCQHYJ-CW14n2Oe.js", "/assets/jsx-runtime-D_zvdyIk.js", "/assets/ErrorPages-CCoxEvta.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 } }, "url": "/assets/manifest-b66b3f5b.js", "version": "b66b3f5b", "sri": void 0 };
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = { "unstable_optimizeDeps": false, "v8_passThroughRequests": false, "v8_trailingSlashAwareDataRequests": false, "unstable_previewServerPrerendering": false, "v8_middleware": false, "v8_splitRouteModules": false, "v8_viteEnvironmentApi": false };
const ssr = true;
const isSpaMode = false;
const prerender = [];
const routeDiscovery = { "mode": "lazy", "manifestPath": "/__manifest" };
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  "root": {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0
  },
  "routes/home": {
    id: "routes/home",
    parentId: "root",
    path: "/",
    index: void 0,
    caseSensitive: void 0,
    module: route1
  },
  "routes/login": {
    id: "routes/login",
    parentId: "root",
    path: "/login",
    index: void 0,
    caseSensitive: void 0,
    module: route2
  },
  "routes/requests.layout": {
    id: "routes/requests.layout",
    parentId: "root",
    path: "/requests",
    index: void 0,
    caseSensitive: void 0,
    module: route3
  },
  "routes/requests.index": {
    id: "routes/requests.index",
    parentId: "routes/requests.layout",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route4
  },
  "routes/requests.new": {
    id: "routes/requests.new",
    parentId: "routes/requests.layout",
    path: "new",
    index: void 0,
    caseSensitive: void 0,
    module: route5
  },
  "routes/requests.$id": {
    id: "routes/requests.$id",
    parentId: "routes/requests.layout",
    path: ":id",
    index: void 0,
    caseSensitive: void 0,
    module: route6
  },
  "routes/calendar": {
    id: "routes/calendar",
    parentId: "root",
    path: "/calendar",
    index: void 0,
    caseSensitive: void 0,
    module: route7
  },
  "routes/policy": {
    id: "routes/policy",
    parentId: "root",
    path: "/policy",
    index: void 0,
    caseSensitive: void 0,
    module: route8
  },
  "routes/share.$token": {
    id: "routes/share.$token",
    parentId: "root",
    path: "/share/:token",
    index: void 0,
    caseSensitive: void 0,
    module: route9
  },
  "routes/splat": {
    id: "routes/splat",
    parentId: "root",
    path: "*",
    index: void 0,
    caseSensitive: void 0,
    module: route10
  }
};
const allowedActionOrigins = false;
export {
  dayToUtcDate as a,
  allowedActionOrigins as b,
  assetsBuildDirectory as c,
  daysOfMonth as d,
  basename as e,
  formatTimestamp as f,
  entry as g,
  future as h,
  isValidMonth as i,
  isSpaMode as j,
  publicPath as k,
  routes as l,
  ssr as m,
  prerender as p,
  routeDiscovery as r,
  serverManifest as s
};
