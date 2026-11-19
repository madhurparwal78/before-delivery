package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/lib/pq"
)

const sessionCookie = "gh_session"

// Registration is a person's bidder or consignor record.
type Registration struct {
	ID       string
	Role     string
	FullName string
	Status   string
	Paddle   *int
	Limit    *int
}

// Viewer is the signed-in person behind a request.
type Viewer struct {
	PersonID string
	Username string
	Display  string
	Roles    []string
	Reg      *Registration
}

func (v *Viewer) hasRole(role string) bool {
	for _, r := range v.Roles {
		if r == role {
			return true
		}
	}
	return false
}

func (v *Viewer) isStaff() bool {
	return v.hasRole("specialist") || v.hasRole("cashier") || v.hasRole("admin")
}

func (v *Viewer) name() string {
	if v.Reg != nil {
		return v.Reg.FullName
	}
	return v.Display
}

func (v *Viewer) paddle() int {
	if v.Reg != nil && v.Reg.Paddle != nil {
		return *v.Reg.Paddle
	}
	return 0
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("random source failed: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func (a *App) viewerFor(r *http.Request) (*Viewer, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return nil, nil
	}
	return a.viewerByToken(r.Context(), cookie.Value)
}

// sessionAlive says whether the session behind a token still exists; signing out deletes it.
func (a *App) sessionAlive(ctx context.Context, token string) (bool, error) {
	var alive bool
	if err := a.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM sessions WHERE token_hash = $1)`, tokenHash(token)).Scan(&alive); err != nil {
		return false, fmt.Errorf("check session: %w", err)
	}
	return alive, nil
}

func (a *App) viewerByToken(ctx context.Context, token string) (*Viewer, error) {
	v := &Viewer{}
	var (
		regID, regRole, regName, regStatus sql.NullString
		paddle, limit                      sql.NullInt64
	)
	err := a.db.QueryRowContext(ctx, `
		SELECT p.id, p.username, p.display_name, p.roles, r.id, r.role, r.full_name, r.status, r.paddle, r.spending_limit
		FROM sessions s JOIN people p ON p.id = s.person_id LEFT JOIN registrations r ON r.person_id = p.id
		WHERE s.token_hash = $1`, tokenHash(token)).
		Scan(&v.PersonID, &v.Username, &v.Display, pq.Array(&v.Roles), &regID, &regRole, &regName, &regStatus, &paddle, &limit)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load session: %w", err)
	}
	if regID.Valid {
		v.Reg = &Registration{ID: regID.String, Role: regRole.String, FullName: regName.String, Status: regStatus.String}
		if paddle.Valid {
			p := int(paddle.Int64)
			v.Reg.Paddle = &p
		}
		if limit.Valid {
			l := int(limit.Int64)
			v.Reg.Limit = &l
		}
	}
	return v, nil
}

func (r *Registration) json() map[string]any {
	if r == nil {
		return nil
	}
	return map[string]any{"id": r.ID, "role": r.Role, "status": r.Status, "paddle": r.Paddle, "spending_limit": r.Limit}
}

func (a *App) handleMe(c *reqCtx) error {
	if c.viewer == nil {
		return c.fail(errSignedOut)
	}
	roles := c.viewer.Roles
	if roles == nil {
		roles = []string{}
	}
	return c.json(200, map[string]any{"name": c.viewer.name(), "roles": roles, "registration": c.viewer.Reg.json()})
}

// safeNext keeps a return path only when it is a same-origin path other than "/".
func safeNext(next string) string {
	if next == "" || next == "/" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") ||
		strings.ContainsAny(next, "\\\r\n\t") {
		return ""
	}
	u, err := url.Parse(next)
	if err != nil || u.IsAbs() || u.Host != "" {
		return ""
	}
	return next
}

func attemptCookieName(id string) string { return "gh_att_" + id }

func (a *App) redirectURI(r *http.Request) string { return a.origin(r) + "/auth/callback" }

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !a.kc.available(r.Context()) {
		a.shell(w, r, http.StatusServiceUnavailable, map[string]any{"page": "signin-outage"})
		return
	}
	state, verifier, nonce := randomToken(32), randomToken(32), randomToken(16)
	id, bind := randomToken(8), randomToken(24)
	_, err := a.db.ExecContext(r.Context(), `
		INSERT INTO sign_in_attempts (state, id, bind, verifier, nonce, next_path) VALUES ($1, $2, $3, $4, $5, $6)`,
		state, id, bind, verifier, nonce, safeNext(r.URL.Query().Get("next")))
	if err != nil {
		logf("record sign-in attempt: %v", err)
		a.shell(w, r, http.StatusInternalServerError, map[string]any{"page": "error"})
		return
	}
	sum := sha256.Sum256([]byte(verifier))
	q := url.Values{
		"client_id": {a.cfg.clientID}, "redirect_uri": {a.redirectURI(r)}, "response_type": {"code"}, "scope": {"openid"},
		"state": {state}, "nonce": {nonce}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
	}
	http.SetCookie(w, &http.Cookie{Name: attemptCookieName(id), Value: bind, Path: "/auth", MaxAge: 600, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, a.cfg.issuerURL+"/protocol/openid-connect/auth?"+q.Encode(), http.StatusFound)
}

func (a *App) signInFailed(w http.ResponseWriter, r *http.Request) {
	a.shell(w, r, http.StatusBadRequest, map[string]any{"page": "signin-error"})
}

func (a *App) handleCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	state, code := r.URL.Query().Get("state"), r.URL.Query().Get("code")
	if state == "" || code == "" {
		a.signInFailed(w, r)
		return
	}
	var id, bind, verifier, nonce, next string
	err := a.db.QueryRowContext(ctx, `
		SELECT id, bind, verifier, nonce, next_path FROM sign_in_attempts
		WHERE state = $1 AND NOT used AND created_at > clock_timestamp() - interval '10 minutes'`, state).
		Scan(&id, &bind, &verifier, &nonce, &next)
	if err != nil {
		a.signInFailed(w, r)
		return
	}
	cookie, cerr := r.Cookie(attemptCookieName(id))
	if cerr != nil || cookie.Value != bind {
		a.signInFailed(w, r)
		return
	}
	res, err := a.db.ExecContext(ctx, `UPDATE sign_in_attempts SET used = true WHERE state = $1 AND NOT used`, state)
	if n, _ := res.RowsAffected(); err != nil || n != 1 {
		a.signInFailed(w, r)
		return
	}
	tokens, err := a.kc.exchange(ctx, code, verifier, a.redirectURI(r))
	if err != nil || tokens.access.Subject == "" || (tokens.id.Nonce != "" && tokens.id.Nonce != nonce) {
		a.signInFailed(w, r)
		return
	}
	viewer, token, err := a.startSession(ctx, tokens.access)
	if err != nil {
		logf("start session: %v", err)
		a.shell(w, r, http.StatusInternalServerError, map[string]any{"page": "error"})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: attemptCookieName(id), Value: "", Path: "/auth", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
	target := next
	if target == "" {
		target = landingFor(viewer)
	}
	http.Redirect(w, r, target, http.StatusFound)
}

// landingFor is the address a person starts on when sign-in carries no return path.
func landingFor(v *Viewer) string {
	for _, role := range []string{"specialist", "cashier", "admin", "bidder", "consignor"} {
		if v.hasRole(role) {
			return roleAddress[role]
		}
	}
	return "/register"
}

var roleAddress = map[string]string{
	"bidder": "/bidder", "consignor": "/consign",
	"specialist": "/desk/specialist", "cashier": "/desk/cashier", "admin": "/desk/admin",
}

// startSession finds or creates the person for a token and opens a session for them.
func (a *App) startSession(ctx context.Context, claims tokenClaims) (*Viewer, string, error) {
	roles := []string{}
	for _, r := range claims.RealmAccess.Roles {
		for _, known := range appRoles {
			if r == known {
				roles = append(roles, r)
			}
		}
	}
	display := claims.Name
	if display == "" {
		display = claims.Username
	}
	token := randomToken(32)
	var personID string
	err := a.tx(ctx, func(t *Tx) error {
		err := t.QueryRowContext(ctx, `
			UPDATE people SET sub = $1, display_name = $2, roles = $3
			WHERE id = COALESCE((SELECT id FROM people WHERE sub = $1), (SELECT id FROM people WHERE username = $4))
			RETURNING id`, claims.Subject, display, pq.Array(roles), claims.Username).Scan(&personID)
		if errors.Is(err, sql.ErrNoRows) {
			personID = newID("per_")
			_, err = t.ExecContext(ctx, `INSERT INTO people (id, sub, username, display_name, roles) VALUES ($1, $2, $3, $4, $5)`,
				personID, claims.Subject, claims.Username, display, pq.Array(roles))
		}
		if err != nil {
			return fmt.Errorf("record person: %w", err)
		}
		_, err = t.ExecContext(ctx, `INSERT INTO sessions (token_hash, person_id) VALUES ($1, $2)`, tokenHash(token), personID)
		if err != nil {
			return fmt.Errorf("record session: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	viewer, err := a.viewerByToken(ctx, token)
	if err != nil || viewer == nil {
		return nil, "", fmt.Errorf("reload session: %w", err)
	}
	return viewer, token, nil
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	if !a.sameOrigin(r) {
		writeAPIError(w, errForeignOrigin)
		return
	}
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		if _, err := a.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE token_hash = $1`, tokenHash(cookie.Value)); err != nil {
			logf("end session: %v", err)
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func writeAPIError(w http.ResponseWriter, e *apiError) {
	c := &reqCtx{w: w}
	c.fail(e)
}

var registrationRoles = map[string]bool{"bidder": true, "consignor": true}

func (a *App) handleRegister(c *reqCtx) error {
	v := c.viewer
	if v.isStaff() {
		return c.fail(errForbidden)
	}
	if v.Reg != nil {
		return c.fail(failure(409, "already_registered", "You are already registered."))
	}
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	role, _ := body["role"].(string)
	name, _ := body["full_name"].(string)
	phone, _ := body["phone"].(string)
	address, _ := body["address"].(string)
	fields := map[string]string{}
	if !registrationRoles[role] {
		fields["role"] = "Choose bid or consign."
	}
	if n := len([]rune(strings.TrimSpace(name))); n < 1 || n > 120 {
		fields["full_name"] = "Enter your full name."
	}
	if n := len([]rune(strings.TrimSpace(phone))); n < 6 || n > 30 {
		fields["phone"] = "Enter a phone number."
	}
	if n := len([]rune(strings.TrimSpace(address))); n < 1 || n > 300 {
		fields["address"] = "Enter your address."
	}
	if len(fields) > 0 {
		return c.fail(invalidFields(fields))
	}
	reg := &Registration{ID: newID("reg_"), Role: role, FullName: strings.TrimSpace(name), Status: registrationStart(role)}
	err := c.a.tx(c.r.Context(), func(t *Tx) error {
		var sub string
		if err := t.QueryRowContext(c.r.Context(), `SELECT COALESCE(sub, '') FROM people WHERE id = $1 FOR UPDATE`, v.PersonID).Scan(&sub); err != nil {
			return fmt.Errorf("lock person: %w", err)
		}
		_, err := t.ExecContext(c.r.Context(), `
			INSERT INTO registrations (id, person_id, role, full_name, phone, address, status) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			reg.ID, v.PersonID, role, reg.FullName, strings.TrimSpace(phone), strings.TrimSpace(address), reg.Status)
		if isUniqueViolation(err) {
			return failure(409, "already_registered", "You are already registered.")
		}
		if err != nil {
			return fmt.Errorf("record registration: %w", err)
		}
		if err := c.a.kc.addRealmRole(c.r.Context(), sub, role); err != nil {
			logf("record role in Keycloak: %v", err)
			return failure(503, "sign_in_unavailable", "Sign-in is unavailable right now. Try again shortly.")
		}
		if _, err := t.ExecContext(c.r.Context(), `UPDATE people SET roles = array_append(array_remove(roles, $2), $2) WHERE id = $1`, v.PersonID, role); err != nil {
			return fmt.Errorf("record role: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(201, map[string]any{
		"registration": (&Registration{ID: reg.ID, Role: role, Status: reg.Status}).json(),
		"landing":      roleAddress[role],
	})
}

// purgeAttempts drops sign-in attempts older than an hour.
func (a *App) purgeAttempts(ctx context.Context) {
	if _, err := a.db.ExecContext(ctx, `DELETE FROM sign_in_attempts WHERE created_at < clock_timestamp() - interval '1 hour'`); err != nil {
		logf("purge sign-in attempts: %v", err)
	}
}
