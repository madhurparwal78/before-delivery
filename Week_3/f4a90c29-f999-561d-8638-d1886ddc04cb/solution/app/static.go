package main

import (
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
)

const publicDir = "dist/public"

var pageRoutes = regexp.MustCompile(`^/(|signin|calendar|find|search|trash|sharing|zone-rules|prints|settings|events/[^/]+|share/[^/]+)$`)

// handlePage serves the built assets and the single-page shell; unknown addresses get the shell with 404.
func (s *Server) handlePage(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/assets/") {
		clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/assets/"))
		if strings.HasPrefix(clean, "..") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=3600")
		http.ServeFile(w, r, filepath.Join(publicDir, "assets", clean))
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		(&Req{S: s, W: w, R: r}).respondUnknownAPI()
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if !pageRoutes.MatchString(r.URL.Path) {
		w.WriteHeader(http.StatusNotFound)
	}
	http.ServeFile(&shellWriter{ResponseWriter: w, notFound: !pageRoutes.MatchString(r.URL.Path)}, r, filepath.Join(publicDir, "index.html"))
}

// shellWriter keeps the 404 status chosen above when ServeFile writes the shell.
type shellWriter struct {
	http.ResponseWriter
	notFound bool
}

func (w *shellWriter) WriteHeader(code int) {
	if w.notFound {
		return
	}
	w.ResponseWriter.WriteHeader(code)
}

func (rq *Req) respondUnknownAPI() {
	rq.S.finish(rq, apiErr(404, "not_found", "That could not be found."))
}
