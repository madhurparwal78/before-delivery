package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"path"
	"strings"
)

//go:embed all:web/dist
var distFiles embed.FS

// distFS is the built frontend; main refuses to start when it is missing.
var distFS, distErr = fs.Sub(distFiles, "web/dist")

var contentTypes = map[string]string{
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
	".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
}

// serveStatic serves the built frontend; the title, Nights and room routes all open the app.
func (s *server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	cache := "public, max-age=31536000, immutable"
	if name == "" || name == "nights" || strings.HasPrefix(name, "room/") && strings.Count(name, "/") == 1 {
		name, cache = "index.html", "no-cache"
	}
	body, err := fs.ReadFile(distFS, name)
	if err != nil || strings.HasPrefix(path.Base(name), ".") {
		http.NotFound(w, r)
		return
	}
	if kind, ok := contentTypes[path.Ext(name)]; ok {
		w.Header().Set("Content-Type", kind)
	}
	w.Header().Set("Cache-Control", cache)
	w.Header().Set("Content-Security-Policy",
		"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; script-src 'self'; frame-ancestors 'none'")
	if _, err := w.Write(body); err != nil {
		log.Printf("write %s: %v", name, err)
	}
}
