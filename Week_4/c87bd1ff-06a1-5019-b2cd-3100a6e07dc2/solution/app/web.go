package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

//go:embed all:web/dist
var distFS embed.FS

var dist = mustSub(distFS, "web/dist")

func mustSub(f embed.FS, dir string) fs.FS {
	sub, err := fs.Sub(f, dir)
	if err != nil {
		panic("embedded front end: " + err.Error())
	}
	return sub
}

var shellTemplate = func() []byte {
	raw, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		panic("embedded front end has no index.html: " + err.Error())
	}
	return raw
}()

var bootMarker = []byte("<!--boot-->")

// shell answers with the HTML page and the boot data the front end starts from.
func (a *App) shell(w http.ResponseWriter, r *http.Request, status int, boot map[string]any) {
	if _, ok := boot["me"]; !ok {
		if v, err := a.viewerFor(r); err == nil {
			boot["me"] = meJSON(v)
		}
	}
	boot["status"] = status
	raw, err := json.Marshal(boot)
	if err != nil {
		logf("encode boot data: %v", err)
		raw = []byte(`{"status":500}`)
	}
	raw = bytes.ReplaceAll(raw, []byte("<"), []byte(`<`))
	page := bytes.Replace(shellTemplate, bootMarker, append(append([]byte(`<script id="boot" type="application/json">`), raw...), []byte(`</script>`)...), 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(page)
}

func meJSON(v *Viewer) any {
	if v == nil {
		return nil
	}
	roles := v.Roles
	if roles == nil {
		roles = []string{}
	}
	return map[string]any{"name": v.name(), "roles": roles, "registration": v.Reg.json()}
}

type pageRule struct {
	pattern *regexp.Regexp
	role    string // "" public, "signed-in", or a role
	check   string // "sale", "lot", "invoice", "own-lot", "statement" for an id that must exist
}

var pageRules = []pageRule{
	{regexp.MustCompile(`^/$`), "", ""},
	{regexp.MustCompile(`^/catalogue$`), "", ""},
	{regexp.MustCompile(`^/catalogue/([^/]+)$`), "", "sale"},
	{regexp.MustCompile(`^/lots/([^/]+)$`), "", "lot"},
	{regexp.MustCompile(`^/register$`), "signed-in", ""},
	{regexp.MustCompile(`^/bidder$`), "bidder", ""},
	{regexp.MustCompile(`^/bidder/invoices/([^/]+)$`), "bidder", "invoice"},
	{regexp.MustCompile(`^/consign$`), "consignor", ""},
	{regexp.MustCompile(`^/consign/new$`), "consignor", ""},
	{regexp.MustCompile(`^/consign/lots/([^/]+)$`), "consignor", "own-lot"},
	{regexp.MustCompile(`^/consign/statements/([^/]+)$`), "consignor", "statement"},
	{regexp.MustCompile(`^/desk/specialist$`), "specialist", ""},
	{regexp.MustCompile(`^/desk/cashier$`), "cashier", ""},
	{regexp.MustCompile(`^/desk/admin$`), "admin", ""},
}

func (a *App) handlePage(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if strings.HasPrefix(path, "/api/") {
		writeAPIError(w, errNotFound)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeAPIError(w, failure(405, "method_not_allowed", "That method is not allowed here."))
		return
	}
	if len(path) > 1 {
		path = strings.TrimRight(path, "/")
	}
	for _, rule := range pageRules {
		m := rule.pattern.FindStringSubmatch(path)
		if m == nil {
			continue
		}
		viewer, err := a.viewerFor(r)
		if err != nil {
			logf("page session: %v", err)
			a.shell(w, r, http.StatusInternalServerError, map[string]any{"page": "error"})
			return
		}
		if rule.role != "" && viewer == nil {
			next := path
			if r.URL.RawQuery != "" {
				next += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, "/auth/login?next="+url.QueryEscape(next), http.StatusFound)
			return
		}
		if rule.role != "" && rule.role != "signed-in" && !viewer.hasRole(rule.role) {
			a.shell(w, r, http.StatusForbidden, map[string]any{"page": "forbidden"})
			return
		}
		if rule.check != "" {
			ok, err := a.pageTargetExists(r, rule.check, m[1], viewer)
			if err != nil {
				logf("page lookup: %v", err)
				a.shell(w, r, http.StatusInternalServerError, map[string]any{"page": "error"})
				return
			}
			if !ok {
				a.shell(w, r, http.StatusNotFound, map[string]any{"page": "not-found"})
				return
			}
		}
		a.shell(w, r, http.StatusOK, map[string]any{"page": "app"})
		return
	}
	a.shell(w, r, http.StatusNotFound, map[string]any{"page": "not-found"})
}

func (a *App) pageTargetExists(r *http.Request, check, id string, v *Viewer) (bool, error) {
	var query string
	args := []any{id}
	switch check {
	case "sale":
		query, args = `SELECT EXISTS (SELECT 1 FROM sales WHERE id = $1 AND NOT (state = ANY($2)))`, []any{id, pqStrings(saleFlow.from("publish"))}
	case "lot":
		query, args = `SELECT EXISTS (SELECT 1 FROM lots WHERE id = $1 AND NOT (state = ANY($2)))`, []any{id, pqStrings(lotsOnDesk)}
	case "invoice":
		query, args = `SELECT EXISTS (SELECT 1 FROM invoices WHERE id = $1 AND person_id = $2)`, []any{id, v.PersonID}
	case "own-lot":
		query, args = `SELECT EXISTS (SELECT 1 FROM lots WHERE id = $1 AND consignor_id = $2)`, []any{id, v.PersonID}
	case "statement":
		query, args = `SELECT EXISTS (SELECT 1 FROM statements WHERE id = $1 AND consignor_id = $2 AND NOT (status = ANY($3)))`, []any{id, v.PersonID, pqStrings(statementsDraft)}
	}
	var ok bool
	if err := a.db.QueryRowContext(r.Context(), query, args...).Scan(&ok); err != nil {
		return false, fmt.Errorf("check page target: %w", err)
	}
	return ok, nil
}

// serveAsset serves built front-end files (scripts, styles and fonts) only.
func (a *App) serveAsset(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.FileServerFS(dist).ServeHTTP(w, r)
}
