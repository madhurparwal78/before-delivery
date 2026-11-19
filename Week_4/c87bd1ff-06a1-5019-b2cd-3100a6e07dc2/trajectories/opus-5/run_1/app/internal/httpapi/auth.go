package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gavelhouse/internal/keycloak"
	"gavelhouse/internal/saleroom"
)

const (
	sessionCookie = "gh_session"
	signinCookie  = "gh_signin"
)

// keycloakProbeBudget keeps the sign-in page's answer inside three seconds
// while the realm is unreachable.
const keycloakProbeBudget = 2500 * time.Millisecond

// returnPath is the next value when it is a same-origin path other than "/".
// An absent next, a next of "/", and any other value all count as no return
// path.
func returnPath(next string) string {
	if next == "" || next == "/" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") {
		return ""
	}
	if strings.Contains(next, "\\") {
		return ""
	}
	return next
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.realm.Reachable(r.Context(), keycloakProbeBudget) {
		s.renderPage(w, r, pageRender{
			Status: http.StatusServiceUnavailable,
			Route:  "signin_outage",
		})
		return
	}
	attempt, err := s.room.StartSigninAttempt(r.Context(), returnPath(r.URL.Query().Get("next")))
	if err != nil {
		fail(w, err)
		return
	}
	s.setCookie(w, signinCookie, attempt.BrowserToken, 0)
	challenge := sha256.Sum256([]byte(attempt.Verifier))
	query := url.Values{
		"response_type":         {"code"},
		"client_id":             {s.cfg.AuthClientID},
		"redirect_uri":          {s.cfg.CallbackURL(s.ownOrigin(r))},
		"scope":                 {"openid profile email"},
		"state":                 {attempt.State},
		"nonce":                 {attempt.Nonce},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
	}
	http.Redirect(w, r, s.realm.AuthorizeURL()+"?"+query.Encode(), http.StatusFound)
}

func (s *Server) handleCallback(w http.ResponseWriter, r *http.Request) {
	browserToken := ""
	if c, err := r.Cookie(signinCookie); err == nil {
		browserToken = c.Value
	}
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	if state == "" || code == "" || browserToken == "" {
		s.signinFailed(w, r)
		return
	}
	attempt, err := s.room.UseSigninAttempt(r.Context(), state, browserToken)
	if err != nil {
		if errors.Is(err, saleroom.ErrAttemptRefused) {
			s.signinFailed(w, r)
			return
		}
		fail(w, err)
		return
	}
	identity, err := s.realm.Exchange(r.Context(), code, attempt.Verifier, s.cfg.CallbackURL(s.ownOrigin(r)))
	if err != nil || identity.Nonce != attempt.Nonce {
		s.signinFailed(w, r)
		return
	}
	personID, err := s.room.UpsertPerson(r.Context(), identity.Subject, identity.Username,
		identity.FullName, identity.Email, staffRolesFrom(identity.Roles))
	if err != nil {
		fail(w, err)
		return
	}
	sessionID, err := s.room.CreateSession(r.Context(), personID)
	if err != nil {
		fail(w, err)
		return
	}
	s.setCookie(w, sessionCookie, sessionID, 0)
	s.clearCookie(w, signinCookie)
	landing := attempt.NextPath
	if landing == "" {
		landing, err = s.landingFor(r, personID, identity.Roles)
		if err != nil {
			fail(w, err)
			return
		}
	}
	http.Redirect(w, r, landing, http.StatusFound)
}

func (s *Server) landingFor(r *http.Request, personID string, realmRoles []string) (string, error) {
	for _, role := range []string{"specialist", "cashier", "admin"} {
		if hasRole(realmRoles, role) {
			return "/desk/" + role, nil
		}
	}
	registration, err := s.room.LoadRegistration(r.Context(), personID)
	if err != nil {
		return "", err
	}
	if registration == nil {
		return "/register", nil
	}
	if registration.Role == "bidder" {
		return "/bidder", nil
	}
	return "/consign", nil
}

func staffRolesFrom(realmRoles []string) []string {
	out := []string{}
	for _, role := range []string{"specialist", "cashier", "admin"} {
		if hasRole(realmRoles, role) {
			out = append(out, role)
		}
	}
	return out
}

func hasRole(roles []string, want string) bool {
	for _, r := range roles {
		if r == want {
			return true
		}
	}
	return false
}

func (s *Server) signinFailed(w http.ResponseWriter, r *http.Request) {
	s.clearCookie(w, signinCookie)
	s.renderPage(w, r, pageRender{Status: http.StatusBadRequest, Route: "signin_error"})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		if err := s.room.EndSession(r.Context(), c.Value); err != nil {
			fail(w, err)
			return
		}
		s.hub.closeSession(c.Value)
	}
	s.clearCookie(w, sessionCookie)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *Server) setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

func (s *Server) clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// viewerOf reads the signed-in person behind a request.
func (s *Server) viewerOf(r *http.Request) (saleroom.Viewer, string, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return saleroom.AnonymousViewer(), "", nil
	}
	v, err := s.room.SessionViewer(r.Context(), c.Value)
	return v, c.Value, err
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	v, _, err := s.viewerOf(r)
	if err != nil {
		fail(w, err)
		return
	}
	if !v.SignedIn {
		writeError(w, http.StatusUnauthorized, "signed_out", "Sign in to use the saleroom.", nil)
		return
	}
	registration, err := s.room.LoadRegistration(r.Context(), v.PersonID)
	if err != nil {
		fail(w, err)
		return
	}
	var reg any
	if registration != nil {
		reg = map[string]any{
			"id":             registration.ID,
			"role":           registration.Role,
			"status":         registration.Status,
			"paddle":         nullableInt(registration.Paddle),
			"spending_limit": nullableInt(registration.SpendingLimit),
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"name":         v.FullName,
		"roles":        v.Roles,
		"registration": reg,
	})
}

func nullableInt(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

// RealmSeedUsers is the seed the realm is brought up with.
func RealmSeedUsers() []keycloak.SeedUser {
	out := make([]keycloak.SeedUser, 0, len(saleroom.SeedUsers))
	for _, u := range saleroom.SeedUsers {
		out = append(out, keycloak.SeedUser{
			Username: u.Username, Password: u.Password, Role: u.Role,
			FullName: u.FullName, Email: u.Email(),
		})
	}
	return out
}
