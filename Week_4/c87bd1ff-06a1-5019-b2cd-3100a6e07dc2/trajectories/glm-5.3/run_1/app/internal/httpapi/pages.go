package httpapi

import (
	"fmt"
	"html/template"
	"net/http"
	"strings"
)

var shellTmpl = template.Must(template.New("shell").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gavelhouse</title>
<link rel="stylesheet" href="/assets/app.css">
<script defer src="/assets/app.js"></script>
</head>
<body>
<div id="app" aria-busy="true"></div>
<div id="status" role="status" aria-live="polite" class="visually-hidden"></div>
<div id="banner" hidden></div>
</body>
</html>`))

// serveSPA serves the app shell for every browser address, and 404 otherwise.
func (s *Server) serveSPA(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && !isAppPath(r.URL.Path) {
		w.WriteHeader(404)
		fmt.Fprint(w, notFoundPage)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	shellTmpl.Execute(w, nil)
}

const notFoundPage = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Not in this sale — Gavelhouse</title>
<link rel="stylesheet" href="/assets/app.css"></head><body><main class="error-page">
<p class="display-line">NOT IN THIS SALE</p>
<p>That page is not in the saleroom.</p>
</main></body></html>`

// isAppPath lists every address the single-page shell takes.
func isAppPath(p string) bool {
	switch {
	case p == "/", p == "/catalogue", p == "/register", p == "/bidder", p == "/consign", p == "/consign/new":
		return true
	case strings.HasPrefix(p, "/catalogue/"):
		return true
	case strings.HasPrefix(p, "/lots/"):
		return true
	case strings.HasPrefix(p, "/consign/lots/"):
		return true
	case strings.HasPrefix(p, "/consign/statements/"):
		return true
	case strings.HasPrefix(p, "/bidder/invoices/"):
		return true
	case p == "/desk/specialist", p == "/desk/cashier", p == "/desk/admin":
		return true
	case p == "/auth/error":
		return true
	}
	return false
}

// health answers the run manifest's health check.
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// login starts the Keycloak sign-in, or answers 503 during an outage.
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	next := r.URL.Query().Get("next")
	if !s.db.KeycloakHealthy() {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(503)
		fmt.Fprint(w, outagePage)
		return
	}
	target, ok := s.auth.Start(w, r, next)
	if !ok {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(503)
		fmt.Fprint(w, outagePage)
		return
	}
	http.Redirect(w, r, target, 302)
}

const outagePage = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in unavailable — Gavelhouse</title>
<link rel="stylesheet" href="/assets/app.css"></head>
<body><main class="error-page"><div role="alert" class="alert">
<p>Sign-in is unavailable right now. If you are already signed in, you can carry on bidding.</p>
</div></main></body></html>`

// callback finishes the sign-in, or answers 400 with the error page.
func (s *Server) callback(w http.ResponseWriter, r *http.Request) {
	landing, ok := s.auth.Callback(w, r, r.URL.Query().Get("code"), r.URL.Query().Get("state"))
	if !ok {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(400)
		fmt.Fprint(w, signinErrorPage)
		return
	}
	http.Redirect(w, r, landing, 302)
}

const signinErrorPage = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in could not be completed — Gavelhouse</title>
<link rel="stylesheet" href="/assets/app.css"></head>
<body><main class="error-page">
<h1>Sign-in could not be completed</h1>
<p>Please start again from the saleroom. <a href="/auth/login">Sign in again</a></p>
</main></body></html>`

// logout ends the session everywhere at once and closes its sockets.
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	token := s.auth.SignOut(w, r)
	s.hub.CloseSession(token)
	http.Redirect(w, r, "/", 303)
}

// liveSocket upgrades one page socket and replays from the given sequence.
func (s *Server) liveSocket(w http.ResponseWriter, r *http.Request) {
	var since int64
	if raw := r.URL.Query().Get("since"); raw != "" {
		var n int64
		if _, err := fmt.Sscanf(raw, "%d", &n); err == nil {
			since = n
		}
	}
	person := s.auth.Person(r.Context(), r)
	s.hub.Attach(w, r, since, person)
}
