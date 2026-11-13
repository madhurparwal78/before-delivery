package main

import (
	"embed"
	"net/http"
	"strings"
)

//go:embed public/index.html
var embeddedIndex []byte

var _ = embed.FS{}

// servePage gives the app shell for every in-app address, with the fonts and
// scripts from the same origin only.
func (a *App) servePage(w http.ResponseWriter, r *http.Request) {
	// the run manifest, source and environment are never served
	switch r.URL.Path {
	case "/run.json", "/go.mod", "/go.sum", "/package.json", "/package-lock.json",
		"/.env", "/esbuild.mjs", "/tsconfig.json":
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") || strings.Contains(r.URL.Path, "..") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(embeddedIndex)
}
