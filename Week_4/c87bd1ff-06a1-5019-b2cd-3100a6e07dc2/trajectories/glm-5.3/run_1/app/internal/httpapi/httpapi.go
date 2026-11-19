// Package httpapi serves the JSON API, the HTML routes and the live socket.
package httpapi

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"gavelhouse/internal/authn"
	"gavelhouse/internal/live"
	"gavelhouse/internal/store"
)

type Server struct {
	cfg   Config
	db    *store.Store
	auth  *authn.Service
	hub   *live.Hub
	nowFn func() time.Time
}

type Config struct {
	PublicURL string
}

func New(cfg Config, db *store.Store, auth *authn.Service, hub *live.Hub) *Server {
	return &Server{cfg: cfg, db: db, auth: auth, hub: hub}
}

// Feed exposes this server's event projection to the live hub.
func (s *Server) Feed() live.Feed {
	return &feed{server: s}
}

// Handler builds the whole routing table.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)

	// Sign-in routes are HTML.
	mux.HandleFunc("GET /auth/login", s.html(s.login))
	mux.HandleFunc("GET /auth/callback", s.html(s.callback))
	mux.HandleFunc("POST /auth/logout", s.html(s.logout))

	mux.HandleFunc("GET /api/me", s.api(s.me, ""))

	mux.HandleFunc("POST /api/register", s.api(s.register, ""))
	mux.HandleFunc("GET /api/sales/current", s.publicAPI(s.currentSale))
	mux.HandleFunc("GET /api/sales/{id}/catalogue", s.publicAPI(s.catalogue))
	mux.HandleFunc("GET /api/lots/{id}", s.publicAPI(s.getLot))
	mux.HandleFunc("POST /api/lots/{id}/bids", s.api(s.placeBid, "bidder"))
	mux.HandleFunc("PUT /api/lots/{id}/watch", s.api(s.setWatch, ""))
	mux.HandleFunc("DELETE /api/lots/{id}/watch", s.api(s.unsetWatch, ""))

	mux.HandleFunc("GET /api/notices", s.api(s.notices, ""))
	mux.HandleFunc("GET /api/bidder/dashboard", s.api(s.bidderDashboard, "bidder"))
	mux.HandleFunc("GET /api/bidder/invoices/{id}", s.api(s.bidderInvoice, "bidder"))
	mux.HandleFunc("POST /api/bidder/offers/{id}/accept", s.api(s.acceptOffer, "bidder"))
	mux.HandleFunc("POST /api/bidder/offers/{id}/decline", s.api(s.declineOffer, "bidder"))

	mux.HandleFunc("POST /api/consign/lots", s.api(s.consign, "consignor"))
	mux.HandleFunc("GET /api/consign/lots", s.api(s.consignLots, "consignor"))
	mux.HandleFunc("GET /api/consign/lots/{id}", s.api(s.consignLot, "consignor"))
	mux.HandleFunc("POST /api/consign/lots/{id}/second-chance", s.api(s.secondChance, "consignor"))
	mux.HandleFunc("POST /api/consign/lots/{id}/leave-unsold", s.api(s.leaveUnsold, "consignor"))
	mux.HandleFunc("GET /api/consign/statements", s.api(s.consignStatements, "consignor"))
	mux.HandleFunc("GET /api/consign/statements/{id}", s.api(s.consignStatement, "consignor"))

	mux.HandleFunc("GET /api/desk/lots", s.api(s.deskLots, "specialist"))
	mux.HandleFunc("PUT /api/desk/lots/{id}/estimate", s.api(s.estimate, "specialist"))
	mux.HandleFunc("POST /api/desk/sales", s.api(s.createSale, "specialist"))
	mux.HandleFunc("GET /api/desk/sales", s.api(s.deskSales, "specialist"))
	mux.HandleFunc("PUT /api/desk/sales/{id}/lots", s.api(s.saleOrder, "specialist"))
	mux.HandleFunc("POST /api/desk/sales/{id}/publish", s.api(s.publishSale, "specialist"))

	mux.HandleFunc("GET /api/desk/invoices", s.api(s.deskInvoices, "cashier"))
	mux.HandleFunc("GET /api/desk/invoices/{id}", s.api(s.deskInvoice, "cashier"))
	mux.HandleFunc("POST /api/desk/invoices/{id}/payments", s.api(s.payment, "cashier"))

	mux.HandleFunc("GET /api/admin/registrations", s.api(s.adminRegistrations, "admin"))
	mux.HandleFunc("POST /api/admin/registrations/{id}/approve", s.api(s.approve, "admin"))
	mux.HandleFunc("GET /api/admin/lots/{id}/bids", s.api(s.adminBids, "admin"))
	mux.HandleFunc("POST /api/admin/bids/{id}/remove", s.api(s.removeBid, "admin"))
	mux.HandleFunc("GET /api/admin/statements", s.api(s.adminStatements, "admin"))
	mux.HandleFunc("POST /api/admin/statements/{id}/issue", s.api(s.issueStatement, "admin"))
	mux.HandleFunc("POST /api/admin/statements/{id}/correct", s.api(s.correctStatement, "admin"))

	mux.HandleFunc("GET /api/live", s.liveSocket)

	// The single-page app shell and static assets.
	mux.HandleFunc("GET /", s.serveSPA)

	return s.boundary(mux)
}

// boundary applies the server boundary rules: origin, body size, content type.
func (s *Server) boundary(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && !s.sameOrigin(r, origin) {
			if r.Method == http.MethodGet {
				// A socket upgrade from another origin never upgrades.
				if strings.Contains(r.Header.Get("Upgrade"), "websocket") {
					writeError(w, 403, "forbidden_origin", "Requests must come from the saleroom.")
					return
				}
			} else {
				writeError(w, 403, "forbidden_origin", "Requests must come from the saleroom.")
				return
			}
		}
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete {
			if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "application/json") {
				writeError(w, 415, "unsupported_media_type", "Requests must be JSON.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) sameOrigin(r *http.Request, origin string) bool {
	if s.cfg.PublicURL != "" {
		return origin == s.cfg.PublicURL || origin == strings.TrimSuffix(s.cfg.PublicURL, "/")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if fwd := r.Header.Get("X-Forwarded-Proto"); fwd != "" {
		scheme = fwd
	}
	return origin == fmt.Sprintf("%s://%s", scheme, r.Host)
}

// ---- plumbing ----

// api wraps a JSON handler with session reading and error shaping.
func (s *Server) api(h func(w http.ResponseWriter, r *http.Request, person *store.Person) error, role string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 16385)
		if r.ContentLength > 16384 {
			writeError(w, 413, "payload_too_large", "That request is too large for the saleroom.")
			return
		}
		person := s.auth.Person(r.Context(), r)
		if person == nil {
			writeError(w, 401, "signed_out", "Please sign in to the saleroom.")
			return
		}
		if role != "" && !hasRole(person.Roles, role) {
			writeError(w, 403, "forbidden", "This desk belongs to another role.")
			return
		}
		if err := h(w, r, person); err != nil {
			s.writeErr(w, err)
		}
	}
}

// publicAPI serves a JSON route that also answers signed-out visitors, with the
// anonymous projection.
func (s *Server) publicAPI(h func(w http.ResponseWriter, r *http.Request, person *store.Person) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 16385)
		if r.ContentLength > 16384 {
			writeError(w, 413, "payload_too_large", "That request is too large for the saleroom.")
			return
		}
		person := s.auth.Person(r.Context(), r)
		if person == nil {
			person = &store.Person{}
		}
		if err := h(w, r, person); err != nil {
			s.writeErr(w, err)
		}
	}
}

func (s *Server) writeErr(w http.ResponseWriter, err error) {
	ce, ok := store.IsCoded(err)
	if !ok {
		log.Printf("gavelhouse: unexpected error: %v", err)
		writeError(w, 500, "unexpected", "Something went wrong in the saleroom. Try again.")
		return
	}
	body := map[string]any{"error": ce.Code, "message": ce.Message}
	if len(ce.Fields) > 0 {
		body["fields"] = ce.Fields
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(ce.Status)
	json.NewEncoder(w).Encode(body)
}

// html serves a route whose errors and bodies are HTML pages.
func (s *Server) html(h func(w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		h(w, r)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": code, "message": message})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(body)
}

func hasRole(roles []string, role string) bool {
	for _, r := range roles {
		if r == role {
			return true
		}
	}
	return false
}

func isStaff(roles []string) bool {
	return hasRole(roles, "specialist") || hasRole(roles, "cashier") || hasRole(roles, "admin")
}

// readBody decodes a JSON body, refusing the wrong shape.
func readBody(r *http.Request, into any) error {
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(into); err != nil {
		return store.Invalid(map[string]string{"body": "The details you entered are not right."})
	}
	return nil
}

func euroCentsFromString(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	}
	parts := strings.Split(s, ".")
	if len(parts) > 2 {
		return 0, false
	}
	euros, err := strconv.Atoi(parts[0])
	if err != nil || euros < 0 {
		return 0, false
	}
	cents := 0
	if len(parts) == 2 {
		frac := parts[1]
		if len(frac) == 0 || len(frac) > 2 {
			return 0, false
		}
		if len(frac) == 1 {
			frac += "0"
		}
		cents, err = strconv.Atoi(frac)
		if err != nil {
			return 0, false
		}
	}
	total := euros*100 + cents
	if neg {
		total = -total
	}
	return total, true
}
