package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
)

const (
	sessionCookie = "yardline_session"
	// loginCookie ties a kept sign-in return path to the browser that started sign-in.
	loginCookie = "yardline_login"
)

// Identity is the signed-in person, built only from their own verified token.
type Identity struct {
	Username string
	Name     string
	Email    string
	Roles    map[string]bool
	Level    *float64
	CoachID  *string
	Topic    string
}

func (id *Identity) hasAnyRole(roles []string) bool {
	if len(roles) == 0 {
		for _, role := range realmRoles {
			if id.Roles[role] {
				return true
			}
		}
		return false
	}
	for _, role := range roles {
		if id.Roles[role] {
			return true
		}
	}
	return false
}

// pushTopic is the person's ntfy topic: players have their own private one, the desk and the manager share the
// desk's, and coaches have none.
func (id *Identity) pushTopic() *string {
	var topic string
	switch {
	case id.Roles[rolePlayer]:
		topic = id.Topic
	case id.Roles[roleDesk], id.Roles[roleManager]:
		topic = deskTopic
	default:
		return nil
	}
	return &topic
}

// authenticate checks the caller with Keycloak on every request: a bearer token, or the session behind the cookie.
// It returns nil for a caller who is not signed in.
func (a *App) authenticate(ctx context.Context, r *http.Request) (*Identity, error) {
	if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
		claims, err := a.keycloak.introspect(ctx, strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			return nil, fmt.Errorf("check bearer token: %w", err)
		}
		if claims == nil {
			return nil, nil
		}
		return a.identityFor(ctx, claims)
	}
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return nil, nil
	}
	claims, err := a.sessionClaims(ctx, cookie.Value)
	if err != nil {
		return nil, err
	}
	if claims == nil {
		return nil, nil
	}
	return a.identityFor(ctx, claims)
}

// sessionClaims checks the session's token with Keycloak, refreshing it once when it has lapsed. A session
// Keycloak has ended is deleted.
func (a *App) sessionClaims(ctx context.Context, sessionID string) (*tokenClaims, error) {
	var access, refresh string
	err := a.pool.QueryRow(ctx, "SELECT access_token, refresh_token FROM sessions WHERE id = $1", sessionID).Scan(&access, &refresh)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read session: %w", err)
	}
	claims, err := a.keycloak.introspect(ctx, access)
	if err != nil {
		return nil, fmt.Errorf("check session: %w", err)
	}
	if claims != nil {
		return claims, nil
	}
	tokens, err := a.keycloak.refresh(ctx, refresh)
	if errors.Is(err, errGrantRefused) {
		return nil, a.dropSession(ctx, sessionID)
	}
	if err != nil {
		return nil, fmt.Errorf("refresh session: %w", err)
	}
	if _, err := a.pool.Exec(ctx, "UPDATE sessions SET access_token = $2, refresh_token = $3 WHERE id = $1",
		sessionID, tokens.AccessToken, tokens.RefreshToken); err != nil {
		return nil, fmt.Errorf("store refreshed session: %w", err)
	}
	claims, err = a.keycloak.introspect(ctx, tokens.AccessToken)
	if err != nil {
		return nil, fmt.Errorf("check refreshed session: %w", err)
	}
	if claims == nil {
		return nil, a.dropSession(ctx, sessionID)
	}
	return claims, nil
}

func (a *App) dropSession(ctx context.Context, sessionID string) error {
	if _, err := a.pool.Exec(ctx, "DELETE FROM sessions WHERE id = $1", sessionID); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

// identityFor records the person from their token and adds the club's own facts about them.
func (a *App) identityFor(ctx context.Context, claims *tokenClaims) (*Identity, error) {
	name := claims.Name
	if name == "" {
		name = claims.Username
	}
	email := claims.Email
	if email == "" {
		email = claims.Username + "@invalid"
	}
	id := &Identity{Username: claims.Username, Roles: claims.Roles}
	err := a.pool.QueryRow(ctx, `INSERT INTO people (username, name, email, is_player, push_topic) VALUES ($1, $2, $3, $4, $7)
		ON CONFLICT (username) DO UPDATE SET is_player = people.is_player OR EXCLUDED.is_player,
			name = CASE WHEN $5 THEN EXCLUDED.name ELSE people.name END,
			email = CASE WHEN $6 THEN EXCLUDED.email ELSE people.email END,
			push_topic = COALESCE(people.push_topic, EXCLUDED.push_topic)
		RETURNING name, email, level::float8, coach_id, push_topic`,
		claims.Username, name, email, claims.Roles[rolePlayer], claims.Name != "", claims.Email != "", newPushTopic()).
		Scan(&id.Name, &id.Email, &id.Level, &id.CoachID, &id.Topic)
	if err != nil {
		return nil, fmt.Errorf("record person %s: %w", claims.Username, err)
	}
	return id, nil
}

func (a *App) getMe(_ context.Context, rq *request) (result, error) {
	me := rq.me
	roles := []string{}
	for _, role := range realmRoles {
		if me.Roles[role] {
			roles = append(roles, role)
		}
	}
	var level *float64
	if me.Roles[rolePlayer] {
		level = me.Level
	}
	var coachID *string
	if me.Roles[roleCoach] {
		coachID = me.CoachID
	}
	return ok(map[string]any{"username": me.Username, "name": me.Name, "email": me.Email, "roles": roles,
		"level": level, "coach_id": coachID, "push_topic": me.pushTopic()}), nil
}

// ---- browser sign-in ----

// safeReturnPath is the one place the return-path rule is decided: a same-origin path, both as given and after one
// round of percent-decoding. Anything else returns to Home.
func safeReturnPath(path string) string {
	decoded, err := url.PathUnescape(path)
	if err != nil {
		return "/"
	}
	for _, candidate := range []string{path, decoded} {
		if !strings.HasPrefix(candidate, "/") || strings.HasPrefix(candidate, "//") || strings.ContainsRune(candidate, '\\') {
			return "/"
		}
		for _, r := range candidate {
			if r < 0x20 || r == 0x7f {
				return "/"
			}
		}
	}
	return path
}

// login keeps the return path on the server, tied to this browser by a pre-login cookie, and sends the browser to
// Keycloak.
func (a *App) login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	state := newToken()
	if _, err := a.pool.Exec(r.Context(), "INSERT INTO login_states (state, return_to) VALUES ($1, $2)",
		state, safeReturnPath(r.URL.Query().Get("return"))); err != nil {
		writeError(w, fmt.Errorf("start sign-in: %w", err))
		return
	}
	http.SetCookie(w, &http.Cookie{Name: loginCookie, Value: state, Path: "/auth/", MaxAge: 900, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, a.keycloak.authorizeURL(state, a.cfg.PublicURL+"/auth/callback"), http.StatusFound)
}

func (a *App) authCallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx := r.Context()
	var returnTo string
	state := r.URL.Query().Get("state")
	started, cookieErr := r.Cookie(loginCookie)
	http.SetCookie(w, &http.Cookie{Name: loginCookie, Value: "", Path: "/auth/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	if cookieErr != nil || started.Value != state {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	err := a.pool.QueryRow(ctx, "DELETE FROM login_states WHERE state = $1 RETURNING return_to", state).Scan(&returnTo)
	if err != nil || r.URL.Query().Get("code") == "" {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	tokens, err := a.keycloak.exchangeCode(ctx, r.URL.Query().Get("code"), a.cfg.PublicURL+"/auth/callback")
	if err != nil {
		log.Printf("sign-in code exchange: %v", err)
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	claims, err := a.keycloak.introspect(ctx, tokens.AccessToken)
	if err != nil || claims == nil {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	if _, err := a.identityFor(ctx, claims); err != nil {
		writeError(w, err)
		return
	}
	sessionID := newToken() + newToken()
	if _, err := a.pool.Exec(ctx, "INSERT INTO sessions (id, username, access_token, refresh_token) VALUES ($1, $2, $3, $4)",
		sessionID, claims.Username, tokens.AccessToken, tokens.RefreshToken); err != nil {
		writeError(w, fmt.Errorf("store session: %w", err))
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: sessionID, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, safeReturnPath(returnTo), http.StatusSeeOther)
}

// logout ends the session and the Keycloak session behind it, then sends the person home.
func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !a.sameOrigin(r) {
		writeError(w, fail(codeForbidden))
		return
	}
	ctx := r.Context()
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		var refresh string
		err := a.pool.QueryRow(ctx, "DELETE FROM sessions WHERE id = $1 RETURNING refresh_token", cookie.Value).Scan(&refresh)
		if err == nil {
			if endErr := a.keycloak.endSession(ctx, refresh); endErr != nil {
				log.Printf("end Keycloak session: %v", endErr)
			}
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
