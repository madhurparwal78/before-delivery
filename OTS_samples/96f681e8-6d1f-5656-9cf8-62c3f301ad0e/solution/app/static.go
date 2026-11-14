package main

import (
	"html/template"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const webDir = "web/dist"

// memberPages need a signed-in person; the rest of the known pages are open to everyone.
var memberPages = []string{"/courts", "/me", "/share/", "/bookings/", "/desk", "/coach", "/manager"}

var openPages = []string{"/", "/matches"}

func isMemberPage(path string) bool {
	for _, page := range memberPages {
		if path == page || (strings.HasSuffix(page, "/") && strings.HasPrefix(path, page) && len(path) > len(page)) {
			return true
		}
	}
	return false
}

func isOpenPage(path string) bool {
	for _, page := range openPages {
		if path == page {
			return true
		}
	}
	return false
}

// servePage serves the built frontend: assets as files, every known page as the app shell, and any other
// address as the shell with a 404 so the app can say it could not find the page.
func (a *App) servePage(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if strings.HasPrefix(path, "/assets/") {
		file := filepath.Join(webDir, filepath.Clean("/"+path))
		if info, err := os.Stat(file); err == nil && !info.IsDir() {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, file)
			return
		}
		writeError(w, fail(codeNotFound))
		return
	}
	status := http.StatusOK
	switch {
	case isMemberPage(path):
		// Signed out, the shell itself sends the visitor to sign-in, returning here (App.tsx SignInRedirect).
		if _, err := a.authenticate(r.Context(), r); err != nil {
			writeError(w, err)
			return
		}
	case isOpenPage(path):
	default:
		status = http.StatusNotFound
	}
	shell, err := os.ReadFile(filepath.Join(webDir, "index.html"))
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if _, err := w.Write(shell); err != nil {
		log.Printf("write page: %v", err)
	}
}

// serverPage points a sign-in server address that was opened on the club's own address back to that server.
var serverPage = template.Must(template.New("sign-in-server").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in page · Marlowe Yard Padel Club</title>
<style>body{margin:0;padding:24px 16px;font:16px/1.5 system-ui,sans-serif;color:#0f1630;background:#fff}a{color:#1d3fd8}</style>
</head>
<body>
<main>
<h1 style="font-size:1.25rem">This page lives on the club's sign-in server</h1>
<p><a href="{{.}}">Open it on the sign-in server</a></p>
</main>
</body>
</html>
`))

func (a *App) signInServerPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if err := serverPage.Execute(w, a.keycloak.origin()+r.URL.RequestURI()); err != nil {
		log.Printf("write sign-in server page: %v", err)
	}
}
