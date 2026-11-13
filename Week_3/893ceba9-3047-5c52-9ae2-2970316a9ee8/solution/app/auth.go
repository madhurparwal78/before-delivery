package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	sessionCookie = "desk_session"
	sessionTTL    = 12 * time.Hour
	roleOwner     = "owner"
	roleReviewer  = "reviewer"
)

// Principal is the signed-in user and the session the request came in on.
type Principal struct {
	User
	SessionID string
}

func hashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(h), nil
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (a *App) handleSignIn(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	ctx := r.Context()
	var u User
	var hash string
	err := a.pool.QueryRow(ctx, `SELECT id, name, email, role, password_hash FROM users u
		WHERE lower(email) = lower($1) AND (role = 'owner' OR EXISTS (SELECT 1 FROM reviewer_scopes s WHERE s.user_id = u.id))`,
		strings.TrimSpace(in.Email)).Scan(&u.ID, &u.Name, &u.Email, &u.Role, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		// Compare against a decoy hash so an unknown email takes as long as a wrong password; the result is always a mismatch.
		_ = bcrypt.CompareHashAndPassword(a.decoyHash, []byte(in.Password))
		return newErr(http.StatusUnauthorized, "invalid_credentials", "That email and password don't match.")
	}
	if err != nil {
		return fmt.Errorf("look up user: %w", err)
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		return newErr(http.StatusUnauthorized, "invalid_credentials", "That email and password don't match.")
	}
	token := randomString(52)
	expires := time.Now().UTC().Add(sessionTTL)
	if _, err := a.pool.Exec(ctx, "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)", tokenHash(token), u.ID, expires); err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Expires: expires, MaxAge: int(sessionTTL.Seconds())})
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
	return nil
}

func (a *App) handleSignOut(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	if _, err := a.pool.Exec(r.Context(), "DELETE FROM sessions WHERE id = $1", pr.SessionID); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (a *App) handleMe(w http.ResponseWriter, r *http.Request) error {
	pr, err := a.authn(r)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": pr.User})
	return nil
}

// authn finds the session a request belongs to, or answers 401.
func (a *App) authn(r *http.Request) (*Principal, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil, errUnauthenticated()
	}
	id := tokenHash(c.Value)
	pr := &Principal{SessionID: id}
	err = a.pool.QueryRow(r.Context(), `SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.id = $1 AND s.expires_at > $2`, id, time.Now().UTC()).Scan(&pr.ID, &pr.Name, &pr.Email, &pr.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errUnauthenticated()
	}
	if err != nil {
		return nil, fmt.Errorf("load session: %w", err)
	}
	return pr, nil
}

func (pr *Principal) isOwner() bool { return pr.Role == roleOwner }

func (pr *Principal) requireOwner() error {
	if !pr.isOwner() {
		return errForbidden()
	}
	return nil
}

// scopedProject finds a project the caller may see: any for the owner, only invited ones for a reviewer.
func (a *App) scopedProject(r *http.Request, pr *Principal, slug string) (*Project, error) {
	p, err := projectBySlug(r.Context(), a.pool, slug)
	if err != nil {
		return nil, err
	}
	if pr.isOwner() {
		return p, nil
	}
	var n int
	if err := a.pool.QueryRow(r.Context(), "SELECT count(*) FROM reviewer_scopes WHERE user_id = $1 AND project_id = $2", pr.ID, p.ID).Scan(&n); err != nil {
		return nil, fmt.Errorf("check reviewer scope: %w", err)
	}
	if n == 0 {
		return nil, errNotFound()
	}
	return p, nil
}

// ownerProject runs the precedence for owner-only project endpoints: 401, then 404, then 403.
func (a *App) ownerProject(r *http.Request) (*Principal, *Project, error) {
	pr, err := a.authn(r)
	if err != nil {
		return nil, nil, err
	}
	p, err := a.scopedProject(r, pr, r.PathValue("slug"))
	if err != nil {
		return nil, nil, err
	}
	if err := pr.requireOwner(); err != nil {
		return nil, nil, err
	}
	return pr, p, nil
}

// ownerBranch is ownerProject plus the branch named in the path.
func (a *App) ownerBranch(r *http.Request) (*Principal, *Project, *Branch, error) {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return nil, nil, nil, err
	}
	b, err := branchByName(r.Context(), a.pool, p.ID, r.PathValue("branch"))
	if err != nil {
		return nil, nil, nil, err
	}
	return pr, p, b, nil
}
