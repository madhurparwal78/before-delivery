package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"path"
	"strings"
)

//go:embed all:web/dist
var distFS embed.FS

func (a *app) servePage(w http.ResponseWriter, r *http.Request) {
	dist, err := fs.Sub(distFS, "web/dist")
	if err != nil {
		log.Printf("assets: %v", err)
		writeAPIError(w, fail("INTERNAL"))
		return
	}
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if _, err := fs.Stat(dist, name); err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, dist, name)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeAPIError(w, fail("NOT_FOUND"))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if pageNeedsSignIn(r.URL.Path) && a.ready.Load() {
		user, err := a.identify(r.Context(), r)
		if err != nil {
			log.Printf("page identity: %v", err)
		}
		if user == nil {
			http.Redirect(w, r, "/login?return="+url.QueryEscape(r.URL.RequestURI()), http.StatusFound)
			return
		}
	}
	index, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		log.Printf("index: %v", err)
		writeAPIError(w, fail("INTERNAL"))
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if r.URL.Path != "/" && r.URL.Path != "/matches" && !pageNeedsSignIn(r.URL.Path) {
		w.WriteHeader(http.StatusNotFound)
	}
	_, _ = w.Write(index)
}
