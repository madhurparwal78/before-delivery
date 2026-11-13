package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type SessionUser struct {
	ID    string
	Name  string
	Email string
	Role  string
}

// currentUser reads the session cookie and returns the signed-in user.
func currentUser(r *http.Request, db *sql.DB) (*SessionUser, error) {
	c, err := r.Cookie(SessionCookie)
	if err != nil {
		return nil, errNoSession
	}
	row := db.QueryRowContext(r.Context(),
		`SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND s.expires_at > now()`, c.Value)
	var u SessionUser
	if err := row.Scan(&u.ID, &u.Name, &u.Email, &u.Role); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errNoSession
		}
		return nil, err
	}
	return &u, nil
}

var errNoSession = errors.New("no session")

func createSession(w http.ResponseWriter, r *http.Request, db *sql.DB, userID string) error {
	token := randToken(32)
	now := time.Now().UTC()
	if _, err := db.ExecContext(r.Context(),
		`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)`,
		token, userID, now, now.Add(SessionTTL)); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(SessionTTL.Seconds()),
	})
	return nil
}

func destroySession(w http.ResponseWriter, r *http.Request, db *sql.DB) {
	if c, err := r.Cookie(SessionCookie); err == nil {
		_, _ = db.ExecContext(r.Context(), `DELETE FROM sessions WHERE token = $1`, c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: SessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
}

func randToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

// ciProject authenticates a bearer token and returns the project id, or a 404
// when the token belongs to another project.
func ciProject(r *http.Request, db *sql.DB, slug string) (string, error) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return "", errNoToken
	}
	token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	var projectID string
	err := db.QueryRowContext(r.Context(), `SELECT project_id FROM tokens WHERE token_hash = $1`, hashToken(token)).Scan(&projectID)
	if err != nil {
		return "", errNoToken
	}
	var slugOf string
	if err := db.QueryRowContext(r.Context(), `SELECT slug FROM projects WHERE id = $1`, projectID).Scan(&slugOf); err != nil {
		return "", errNoToken
	}
	if slugOf != slug {
		return "", errTokenWrongProject
	}
	return projectID, nil
}

var (
	errNoToken           = errors.New("no token")
	errTokenWrongProject = errors.New("token of another project")
)

// reviewerScope holds whether a reviewer can see a project.
func reviewerCanSeeProject(ctx context.Context, db *sql.DB, userID, projectID string) (bool, error) {
	var n int
	if err := db.QueryRowContext(ctx,
		`SELECT count(*) FROM reviewer_scopes WHERE reviewer_id = $1 AND project_id = $2`, userID, projectID).Scan(&n); err != nil {
		return false, err
	}
	return n > 0, nil
}

func projectIDBySlug(ctx context.Context, db *sql.DB, slug string) (string, error) {
	var id string
	err := db.QueryRowContext(ctx, `SELECT id FROM projects WHERE slug = $1`, slug).Scan(&id)
	return id, err
}

func newUUID() string { return uuid.NewString() }
