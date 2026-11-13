package main

import (
	"bytes"
	"crypto/sha1"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"path"
	"strings"
)

//go:embed all:web
var webFiles embed.FS

//go:embed templates/*.html
var templateFiles embed.FS

var pageTemplates = template.Must(template.ParseFS(templateFiles, "templates/*.html"))

// navLink is one entry of the main navigation.
type navLink struct {
	Href, Label string
	Current     bool
}

// pageSpec is one signed-in screen: who may open it and the navigation entry it lives under.
type pageSpec struct {
	Page   string
	Title  string
	Access access
	Nav    string // href of the navigation entry this screen belongs to
}

var navEntries = []struct {
	Href, Label string
	Access      access
}{
	{"/oncall", "On call", accStaff}, {"/incidents", "Incidents", accStaff}, {"/schedules", "Schedules", accStaff},
	{"/policies", "Policies", accStaff}, {"/services", "Services", accStaff}, {"/integrations", "Integrations", accStaff},
	{"/webhooks", "Webhooks", accAdmin}, {"/status-desk", "Status desk", accLead}, {"/analytics", "Analytics", accStaff},
	{"/maintenance", "Maintenance", accAdmin}, {"/admin", "Admin", accAdmin}, {"/me", "Me", accAny},
}

// bootData is what a page learns at first paint.
type bootData struct {
	Page   string            `json:"page"`
	User   *userView         `json:"user,omitempty"`
	Seq    int64             `json:"seq"`
	Now    string            `json:"now"`
	Params map[string]string `json:"params,omitempty"`
	Zones  []string          `json:"zones,omitempty"`
}

func (a *App) registerPages() {
	staff := []pageSpec{
		{"oncall", "On call", accStaff, "/oncall"}, {"incidents", "Incidents", accStaff, "/incidents"},
		{"schedules", "Schedules", accStaff, "/schedules"}, {"policies", "Policies", accStaff, "/policies"},
		{"services", "Services", accStaff, "/services"}, {"integrations", "Integrations", accStaff, "/integrations"},
		{"webhooks", "Webhooks", accAdmin, "/webhooks"}, {"status-desk", "Status desk", accLead, "/status-desk"},
		{"analytics", "Analytics", accStaff, "/analytics"}, {"maintenance", "Maintenance", accAdmin, "/maintenance"},
		{"admin", "Admin", accAdmin, "/admin"}, {"me", "Me", accAny, "/me"},
	}
	for _, spec := range staff {
		a.mux.HandleFunc("GET /"+spec.Page, a.pageHandler(spec, nil))
	}
	for _, kind := range []struct {
		prefix string
		spec   pageSpec
	}{
		{"incidents", pageSpec{"incident", "Incident", accStaff, "/incidents"}},
		{"schedules", pageSpec{"schedule", "Schedule", accStaff, "/schedules"}},
		{"policies", pageSpec{"policy", "Policy", accStaff, "/policies"}},
		{"services", pageSpec{"service", "Service", accStaff, "/services"}},
		{"integrations", pageSpec{"integration", "Integration", accStaff, "/integrations"}},
		{"webhooks", pageSpec{"webhook", "Webhook", accAdmin, "/webhooks"}},
	} {
		a.mux.HandleFunc("GET /"+kind.prefix+"/{id}", a.pageHandler(kind.spec, []string{"id"}))
	}
	a.mux.HandleFunc("GET /sign-in", a.signInPage)
	a.mux.HandleFunc("GET /{$}", a.rootRedirect)
	a.mux.HandleFunc("GET /assets/", a.serveAsset)
	a.mux.HandleFunc("/", a.notFoundPage)
}

func (a *App) rootRedirect(w http.ResponseWriter, r *http.Request) {
	if _, err := a.authenticate(r); err != nil {
		http.Redirect(w, r, "/sign-in", http.StatusFound)
		return
	}
	http.Redirect(w, r, "/oncall", http.StatusFound)
}

// pageHandler serves a signed-in screen: the shell renders navigation, the live regions and the closing field; the
// page's script fills #root.
func (a *App) pageHandler(spec pageSpec, params []string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.starting(w) {
			return
		}
		if err := a.settle(r.Context()); err != nil {
			log.Printf("settle for page: %v", err)
		}
		actor, err := a.authenticate(r)
		if err != nil || actor.IsKey() {
			http.Redirect(w, r, "/sign-in", http.StatusFound)
			return
		}
		if roleRank[actor.Role] < spec.Access.rank() {
			target := "/oncall"
			if actor.Role == "stakeholder" {
				target = "/status"
			}
			http.Redirect(w, r, target, http.StatusFound)
			return
		}
		boot := bootData{Page: spec.Page, Seq: a.hub.Seq(), Now: formatInstant(a.clock.Now()), Params: map[string]string{},
			User: &userView{ID: actor.ID, Name: actor.Name, Email: actor.Email, Role: actor.Role, Timezone: actor.Zone}}
		for _, name := range params {
			boot.Params[name] = r.PathValue(name)
		}
		if spec.Page == "me" || spec.Page == "schedule" || spec.Page == "schedules" {
			boot.Zones = zoneNames
		}
		var needing int
		if actor.Role != "stakeholder" {
			needing, err = a.countNeeding(r, actor.ID)
			if err != nil {
				log.Printf("count notices: %v", err)
			}
		}
		nav := []navLink{}
		for _, entry := range navEntries {
			if roleRank[actor.Role] >= entry.Access.rank() {
				nav = append(nav, navLink{Href: entry.Href, Label: entry.Label, Current: entry.Href == spec.Nav})
			}
		}
		if actor.Role == "stakeholder" {
			nav = nil
		}
		a.renderPage(w, "shell.html", map[string]any{"Title": spec.Title, "Page": spec.Page, "Nav": nav,
			"Staff": actor.Role != "stakeholder", "Needing": needing, "Boot": boot.encode()})
	}
}

func (a *App) countNeeding(r *http.Request, userID string) (int, error) {
	var n int
	err := a.db.QueryRow(r.Context(), `select count(*) from incidents where status = 'triggered' and $1 = any(holders)`, userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count incidents needing a person: %w", err)
	}
	return n, nil
}

func (b bootData) encode() template.JS {
	encoded, err := json.Marshal(b)
	if err != nil {
		log.Printf("encode boot data: %v", err)
		return template.JS("{}")
	}
	return template.JS(encoded)
}

// signInPage is the yard entry screen; a signed-in visitor goes to /oncall.
func (a *App) signInPage(w http.ResponseWriter, r *http.Request) {
	if a.starting(w) {
		return
	}
	if _, err := a.authenticate(r); err == nil {
		http.Redirect(w, r, "/oncall", http.StatusFound)
		return
	}
	plate := template.HTML(`<img src="/assets/img/signin.jpg" alt="" width="1920" height="1080" fetchpriority="high">`)
	heading := template.HTML(`<h1 class="giant" aria-label="Switchlamp"><span>Switch</span><span>lamp</span></h1>`)
	a.renderPage(w, "entry.html", map[string]any{"Title": "Sign in · Switchlamp", "Page": "sign-in", "Plate": "night",
		"PlateHTML": plate, "Body": heading, "Head": template.HTML(`<link rel="stylesheet" href="/assets/css/pages/sign-in.css">`), "Boot": bootData{Page: "sign-in", Seq: a.hub.Seq(), Now: formatInstant(a.clock.Now())}.encode()})
}

// renderPage renders a named page template: the yard entry screen of the sign-in, status and acknowledge pages.
func (a *App) renderPage(w http.ResponseWriter, name string, data map[string]any) {
	var buf bytes.Buffer
	if err := pageTemplates.ExecuteTemplate(&buf, name, data); err != nil {
		log.Printf("render %s: %v", name, err)
		writeError(w, fmt.Errorf("render %s: %w", name, err))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(buf.Bytes())
}

func (a *App) notFoundPage(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, errNotFound())
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
		`<title>Not found · Switchlamp</title><link rel="stylesheet" href="/assets/css/app.css"></head>` +
		`<body class="plain"><main class="plain-band"><p class="sentence">We could not find that page.</p>` +
		`<p><a href="/status">Status page</a></p></main></body></html>`))
}

func (a *App) serveAsset(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/assets/")
	data, err := fs.ReadFile(webFiles, "web/"+name)
	if err != nil || strings.HasPrefix(path.Base(name), ".") {
		a.notFoundPage(w, r)
		return
	}
	sum := sha1.Sum(data)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "no-cache")
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	kind := mime.TypeByExtension(path.Ext(name))
	switch path.Ext(name) {
	case ".js", ".mjs":
		kind = "text/javascript"
	case ".woff2":
		kind = "font/woff2"
	}
	w.Header().Set("Content-Type", kind)
	_, _ = w.Write(data)
}
