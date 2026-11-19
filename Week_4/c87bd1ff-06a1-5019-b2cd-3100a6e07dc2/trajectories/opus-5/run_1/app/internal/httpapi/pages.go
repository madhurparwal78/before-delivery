package httpapi

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"net/http"
	"net/url"
	"strings"

	"gavelhouse/internal/saleroom"
)

//go:embed all:assets
var assetFS embed.FS

// publicRoutes are the addresses a signed-out visitor may open.
var publicRoutes = map[string]bool{"home": true, "catalogue": true, "lot": true}

// deskRoles maps each staff desk route to the realm role that owns it.
var deskRoles = map[string]string{
	"desk_specialist": "specialist",
	"desk_cashier":    "cashier",
	"desk_admin":      "admin",
}

// memberRoles maps each member route to the role that owns it.
var memberRoles = map[string]string{
	"bidder":            "bidder",
	"bidder_invoice":    "bidder",
	"consign":           "consignor",
	"consign_new":       "consignor",
	"consign_lot":       "consignor",
	"consign_statement": "consignor",
}

type pageRender struct {
	Status int
	Route  string
	Data   map[string]any
}

// routeOf reads the browser address into a route name and its id.
func routeOf(path string) (string, string) {
	switch path {
	case "/":
		return "home", ""
	case "/catalogue":
		return "catalogue", ""
	case "/register":
		return "register", ""
	case "/bidder":
		return "bidder", ""
	case "/consign":
		return "consign", ""
	case "/consign/new":
		return "consign_new", ""
	case "/desk/specialist":
		return "desk_specialist", ""
	case "/desk/cashier":
		return "desk_cashier", ""
	case "/desk/admin":
		return "desk_admin", ""
	}
	for _, r := range []struct{ prefix, route string }{
		{"/catalogue/", "catalogue"},
		{"/lots/", "lot"},
		{"/bidder/invoices/", "bidder_invoice"},
		{"/consign/lots/", "consign_lot"},
		{"/consign/statements/", "consign_statement"},
	} {
		if id, ok := strings.CutPrefix(path, r.prefix); ok && id != "" && !strings.Contains(id, "/") {
			return r.route, id
		}
	}
	return "not_found", ""
}

func (s *Server) handlePage(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/auth/") {
		writeError(w, http.StatusNotFound, "not_found", "That is not in this saleroom.", nil)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		s.renderPage(w, r, pageRender{Status: http.StatusNotFound, Route: "not_found"})
		return
	}
	route, id := routeOf(r.URL.Path)
	if route == "not_found" {
		s.renderPage(w, r, pageRender{Status: http.StatusNotFound, Route: "not_found"})
		return
	}
	v, _, err := s.viewerOf(r)
	if err != nil {
		fail(w, err)
		return
	}
	if !publicRoutes[route] && !v.SignedIn {
		next := r.URL.Path
		if r.URL.RawQuery != "" {
			next += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, "/auth/login?next="+url.QueryEscape(next), http.StatusFound)
		return
	}
	if want, ok := deskRoles[route]; ok && !v.HasRole[want] {
		s.renderPage(w, r, pageRender{Status: http.StatusForbidden, Route: "not_your_desk"})
		return
	}
	if want, ok := memberRoles[route]; ok && !v.HasRole[want] {
		if v.RegRole == "" {
			http.Redirect(w, r, "/register", http.StatusFound)
			return
		}
		s.renderPage(w, r, pageRender{Status: http.StatusForbidden, Route: "not_your_desk"})
		return
	}
	if route == "register" && v.RegRole != "" {
		landing := "/consign"
		if v.RegRole == "bidder" {
			landing = "/bidder"
		}
		http.Redirect(w, r, landing, http.StatusFound)
		return
	}
	data, err := s.pageData(r, v, route, id)
	if err != nil {
		if errors.Is(err, saleroom.ErrNotFound) {
			s.renderPage(w, r, pageRender{Status: http.StatusNotFound, Route: "not_found"})
			return
		}
		fail(w, err)
		return
	}
	s.renderPage(w, r, pageRender{Status: http.StatusOK, Route: route, Data: data})
}

// pageData gathers everything a page shows in its first response, so the
// catalogue and each lot's bid history arrive complete.
func (s *Server) pageData(r *http.Request, v saleroom.Viewer, route, id string) (map[string]any, error) {
	ctx := r.Context()
	switch route {
	case "home", "catalogue":
		out, err := s.room.Catalogue(ctx, v, id)
		if errors.Is(err, saleroom.ErrNotFound) {
			return map[string]any{"sale": nil, "lots": []any{}, "seq": 0}, nil
		}
		return out, err
	case "lot":
		return s.room.Lot(ctx, v, id)
	case "register":
		return map[string]any{}, nil
	case "bidder":
		out, err := s.room.Dashboard(ctx, v)
		if err != nil {
			return nil, err
		}
		notices, err := s.room.Notices(ctx, v)
		if err != nil {
			return nil, err
		}
		out["notices"] = notices["notices"]
		return out, nil
	case "bidder_invoice":
		return s.room.Invoice(ctx, v, id)
	case "consign", "consign_new":
		out, err := s.room.ConsignorLots(ctx, v)
		if err != nil {
			return nil, err
		}
		statements, err := s.room.ConsignorStatements(ctx, v)
		if err != nil {
			return nil, err
		}
		out["statements"] = statements
		return out, nil
	case "consign_lot":
		return s.room.ConsignorLot(ctx, v, id)
	case "consign_statement":
		out, err := s.room.ConsignorStatement(ctx, v, id)
		if err != nil {
			return nil, err
		}
		statements, err := s.room.ConsignorStatements(ctx, v)
		if err != nil {
			return nil, err
		}
		out["statements"] = statements
		return out, nil
	case "desk_specialist":
		return s.specialistData(r)
	case "desk_cashier":
		return s.cashierData(r)
	case "desk_admin":
		return s.adminData(r)
	}
	return map[string]any{}, nil
}

func (s *Server) specialistData(r *http.Request) (map[string]any, error) {
	ctx := r.Context()
	out := map[string]any{}
	for _, state := range []string{"intake", "estimated", "placed"} {
		lots, err := s.room.DeskLots(ctx, state)
		if err != nil {
			return nil, err
		}
		out[state] = lots
	}
	sales, err := s.room.Sales(ctx)
	if err != nil {
		return nil, err
	}
	out["sales"] = sales
	seq, err := s.room.LatestSeq(ctx)
	if err != nil {
		return nil, err
	}
	out["seq"] = seq
	return out, nil
}

// cashierShow reads the Show filter out of the address. Any other value is
// shown as Unpaid.
func cashierShow(raw string) (string, string) {
	switch raw {
	case "paid":
		return "paid", "paid"
	case "all":
		return "all", ""
	default:
		return "unpaid", "issued"
	}
}

func (s *Server) cashierData(r *http.Request) (map[string]any, error) {
	show, status := cashierShow(r.URL.Query().Get("show"))
	invoices, err := s.room.DeskInvoices(r.Context(), status)
	if err != nil {
		return nil, err
	}
	defaults, err := s.room.DeskInvoices(r.Context(), "defaulted")
	if err != nil {
		return nil, err
	}
	seq, err := s.room.LatestSeq(r.Context())
	if err != nil {
		return nil, err
	}
	return map[string]any{"show": show, "invoices": invoices, "defaults": defaults, "seq": seq}, nil
}

func (s *Server) adminData(r *http.Request) (map[string]any, error) {
	ctx := r.Context()
	registrations, err := s.room.PendingRegistrations(ctx, "pending")
	if err != nil {
		return nil, err
	}
	lots, err := s.room.AdminOpenLots(ctx)
	if err != nil {
		return nil, err
	}
	statements, err := s.room.AdminStatements(ctx, "")
	if err != nil {
		return nil, err
	}
	seq, err := s.room.LatestSeq(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"registrations": registrations,
		"lots":          lots,
		"statements":    statements,
		"seq":           seq,
	}, nil
}

const pageShell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gavelhouse · Harrow &amp; Gilt Auctioneers</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header class="chrome">
<a class="wordmark" href="/">Gavelhouse</a>
<div class="chrome-actions">%s</div>
</header>
<div id="banner"></div>
<div id="updates" role="status" aria-live="polite" aria-label="Saleroom updates" class="sr-only"></div>
<main id="app">%s</main>
<script id="bootstrap" type="application/json">%s</script>
<script type="module" src="/assets/main.js"></script>
</body>
</html>
`

// staticBody is the published wording of the pages that carry no record: the
// not-found and not-your-desk pages and the two sign-in pages. The server
// writes them, so they are complete in the first response.
func staticBody(route string) string {
	switch route {
	case "not_found":
		return emptyStateBody("page-not-found", "NOT IN THIS SALE", "That page is not in the saleroom.")
	case "not_your_desk":
		return emptyStateBody("page-not-your-desk", "NOT YOUR DESK", "This desk belongs to another role.")
	case "signin_error":
		return `<section class="page page-signin-error"><div class="notice-page">` +
			`<h1>Sign-in could not be completed</h1>` +
			`<p><span>Please start again from the saleroom. </span>` +
			`<a class="action" href="/auth/login">Sign in again</a></p></div></section>`
	case "signin_outage":
		return `<section class="page page-signin-outage"><div class="notice-page">` +
			`<div class="banner" role="alert">Sign-in is unavailable right now. ` +
			`If you are already signed in, you can carry on bidding.</div>` +
			`</div></section>`
	}
	return ""
}

func emptyStateBody(class, line, sentence string) string {
	return `<section class="page ` + class + `"><section class="empty">` +
		`<p class="empty-line">` + line + `</p>` +
		`<p class="empty-sentence">` + sentence + `</p></section></section>`
}

func (s *Server) renderPage(w http.ResponseWriter, r *http.Request, p pageRender) {
	v, _, err := s.viewerOf(r)
	if err != nil {
		log.Println("httpapi: read viewer for page:", err)
	}
	actions := `<a class="signin" href="/auth/login?next=` + html.EscapeString(url.QueryEscape(currentPath(r))) + `">Sign in</a>`
	if v.SignedIn {
		actions = `<form method="post" action="/auth/logout"><button type="submit">Sign out</button></form>`
	}
	bootstrap := map[string]any{
		"route":  p.Route,
		"id":     routeID(r),
		"data":   p.Data,
		"viewer": viewerBootstrap(v),
		"durations": map[string]any{
			"lot_gap":      s.cfg.LotGapSeconds,
			"soft_close":   s.cfg.SoftCloseSeconds,
			"offer":        s.cfg.OfferSeconds,
			"watch_notice": s.cfg.WatchNoticeSeconds,
		},
	}
	raw, err := json.Marshal(bootstrap)
	if err != nil {
		raw = []byte(`{"route":"not_found"}`)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(p.Status)
	_, _ = fmt.Fprintf(w, pageShell, actions, staticBody(p.Route), safeJSON(raw))
}

func currentPath(r *http.Request) string {
	path := r.URL.Path
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	return path
}

func routeID(r *http.Request) string {
	_, id := routeOf(r.URL.Path)
	return id
}

// safeJSON keeps the bootstrap payload from closing its own script element.
func safeJSON(raw []byte) string {
	return strings.ReplaceAll(string(raw), "<", `\u003c`)
}

func viewerBootstrap(v saleroom.Viewer) map[string]any {
	return map[string]any{
		"signed_in":      v.SignedIn,
		"name":           v.FullName,
		"roles":          v.Roles,
		"registration":   v.RegRole,
		"status":         v.RegStatus,
		"paddle":         nullableInt(v.Paddle),
		"spending_limit": nullableInt(v.SpendLimit),
	}
}

// handleAsset serves the built front end and the two font families. Nothing
// else is served as a static file.
func (s *Server) handleAsset(w http.ResponseWriter, r *http.Request) {
	name := "assets/" + r.PathValue("path")
	if strings.Contains(name, "..") {
		s.renderPage(w, r, pageRender{Status: http.StatusNotFound, Route: "not_found"})
		return
	}
	data, err := assetFS.ReadFile(name)
	if err != nil {
		s.renderPage(w, r, pageRender{Status: http.StatusNotFound, Route: "not_found"})
		return
	}
	w.Header().Set("Content-Type", contentTypeOf(name))
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func contentTypeOf(name string) string {
	switch {
	case strings.HasSuffix(name, ".js"):
		return "text/javascript; charset=utf-8"
	case strings.HasSuffix(name, ".css"):
		return "text/css; charset=utf-8"
	case strings.HasSuffix(name, ".ttf"):
		return "font/ttf"
	case strings.HasSuffix(name, ".txt"):
		return "text/plain; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}
