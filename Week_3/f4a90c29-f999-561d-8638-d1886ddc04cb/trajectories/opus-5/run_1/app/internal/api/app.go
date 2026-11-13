package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// Assets holds the built front end, which the Go server serves. It never
// serves source files, the run manifest or any environment value.
var Assets fs.FS

// serveApp answers every address outside /api with the one built page, so the
// address alone decides the view.
func (s *Server) serveApp(w http.ResponseWriter, r *http.Request) {
	if Assets == nil {
		http.Error(w, "The front end is not built.", http.StatusInternalServerError)
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name != "" && name != "index.html" {
		if file, err := Assets.Open(name); err == nil {
			file.Close()
			setAssetHeaders(w, name)
			http.ServeFileFS(w, r, Assets, name)
			return
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFileFS(w, r, Assets, "index.html")
}

func setAssetHeaders(w http.ResponseWriter, name string) {
	switch path.Ext(name) {
	case ".js":
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	case ".css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	case ".woff2":
		w.Header().Set("Content-Type", "font/woff2")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
}
