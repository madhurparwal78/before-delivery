package serve

import (
	"html/template"
	"net/http"
	"strings"
	staticpkg "switchlamp/internal/serve/static"
)

// pageData carries what every page needs.
type pageData struct {
	Title string
	User  *SessionUser
	Body  template.HTML
	Zone  string
}

// renderAckPage writes one of the five published white pages.
func renderAckPage(w http.ResponseWriter, heading, sentence, button string) {
	body := struct{ Heading, Sentence, Button string }{heading, sentence, button}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	ackTemplate.Execute(w, body)
}

var ackTemplate = template.Must(template.New("ack").Parse(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Heading}}</title>
<link rel="stylesheet" href="/static/css/switchlamp.css">
</head>
<body class="white-page">
<main class="ack-page">
<h1>{{.Heading}}</h1>
<p>{{.Sentence}}</p>
{{if .Button}}
<form method="post">
<button type="submit">{{.Button}}</button>
</form>
{{end}}
</main>
</body>
</html>`))

// escapeHTML renders text safely outside a template.
func escapeHTML(s string) template.HTML { return template.HTML(template.HTMLEscapeString(s)) }

// pageRouter serves the API, the pages and the static files, and the 404 shape.
func (s *Server) pageRouter(api *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		// The feed path holds /calendar/<token>.ics, whose token cannot be a
		// single wildcard segment, so it is matched on the raw path.
		if strings.HasPrefix(r.URL.Path, "/calendar/") {
			s.handleCalendarFeed(w, r)
			return
		}
		switch r.URL.Path {
		case "/static/css/switchlamp.css", "/static/js/app.js":
			s.staticFile(w, r)
		case "/static/img/plate-dusk.png", "/static/img/plate-mobile-dusk.png":
			w.Header().Set("Content-Type", "image/png")
			w.Write(staticpkg.PlateDusk)
		case "/static/img/plate-night.png", "/static/img/plate-mobile-night.png":
			w.Header().Set("Content-Type", "image/png")
			w.Write(staticpkg.PlateNight)
		case "/static/fonts/DarkerGrotesque.ttf":
			w.Header().Set("Content-Type", "font/ttf")
			w.Write(staticpkg.FontDarkerGrotesque)
		case "/static/fonts/Lexend.ttf":
			w.Header().Set("Content-Type", "font/ttf")
			w.Write(staticpkg.FontLexend)
		case "/static/fonts/ChivoMono.ttf":
			w.Header().Set("Content-Type", "font/ttf")
			w.Write(staticpkg.FontChivoMono)
		default:
			api.ServeHTTP(w, r)
		}
	})
}

func (s *Server) staticFile(w http.ResponseWriter, r *http.Request) {
	// Assets never carry secrets.
	switch r.URL.Path {
	case "/static/css/switchlamp.css":
		w.Header().Set("Content-Type", "text/css")
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Write(staticpkg.CSS)
	case "/static/js/app.js":
		w.Header().Set("Content-Type", "application/javascript")
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Write(staticpkg.JS)
	case "/static/img/plate-dusk.png", "/static/img/plate-mobile-dusk.png":
		w.Header().Set("Content-Type", "image/png")
		w.Write(staticpkg.PlateDusk)
	case "/static/img/plate-night.png", "/static/img/plate-mobile-night.png":
		w.Header().Set("Content-Type", "image/png")
		w.Write(staticpkg.PlateNight)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}
