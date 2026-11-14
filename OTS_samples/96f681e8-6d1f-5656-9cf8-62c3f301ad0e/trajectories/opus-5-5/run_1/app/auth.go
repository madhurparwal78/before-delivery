package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

const (
	sessionCookie  = "yl_session"
	preLoginCookie = "yl_pre"
)

type identity struct {
	Username  string
	Name      string
	Email     string
	Roles     []string
	Level     *float64
	CoachID   *string
	PushTopic *string
}

func (u *identity) has(role string) bool { return u != nil && slices.Contains(u.Roles, role) }

func (u *identity) hasAny(roles []string) bool {
	for _, r := range roles {
		if u.has(r) {
			return true
		}
	}
	return false
}

func hashToken(v string) string {
	sum := sha256.Sum256([]byte(v))
	return hex.EncodeToString(sum[:])
}

// safeReturnPath is the return-path rule: a same-origin path, checked both
// as given and after one round of percent-decoding.
func safeReturnPath(p string) bool {
	ok := func(s string) bool {
		if len(s) == 0 || s[0] != '/' {
			return false
		}
		if len(s) > 1 && (s[1] == '/' || s[1] == '\\') {
			return false
		}
		for _, r := range s {
			if r == '\\' || r < 0x20 || r == 0x7f {
				return false
			}
		}
		return true
	}
	decoded, err := url.PathUnescape(p)
	return err == nil && ok(p) && ok(decoded)
}

func setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: value, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: maxAge,
	})
}

func (a *app) handleLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !a.ready.Load() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "starting"})
		return
	}
	id, state, verifier := randomString(32), randomString(32), randomString(64)
	if _, err := a.db.Exec(r.Context(), `INSERT INTO pre_login (id, state, code_verifier, return_path) VALUES ($1, $2, $3, $4)`,
		hashToken(id), state, verifier, r.URL.Query().Get("return")); err != nil {
		log.Printf("login: %v", err)
		writeAPIError(w, fail("INTERNAL"))
		return
	}
	sum := sha256.Sum256([]byte(verifier))
	setCookie(w, preLoginCookie, id, 900)
	http.Redirect(w, r, a.kc.authCodeURL(state, base64.RawURLEncoding.EncodeToString(sum[:])), http.StatusFound)
}

func (a *app) handleCallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	target := "/"
	defer func() { http.Redirect(w, r, target, http.StatusSeeOther) }()
	cookie, err := r.Cookie(preLoginCookie)
	if err != nil || !a.ready.Load() {
		return
	}
	setCookie(w, preLoginCookie, "", -1)
	var state, verifier, returnPath string
	err = a.db.QueryRow(r.Context(), `DELETE FROM pre_login WHERE id = $1 AND created_at > now() - interval '1 hour'
		RETURNING state, code_verifier, return_path`, hashToken(cookie.Value)).Scan(&state, &verifier, &returnPath)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("callback: %v", err)
		}
		return
	}
	q := r.URL.Query()
	if q.Get("state") != state || q.Get("code") == "" {
		return
	}
	ts, err := a.kc.exchangeCode(r.Context(), q.Get("code"), verifier)
	if err != nil {
		log.Printf("callback exchange: %v", err)
		return
	}
	user, err := a.kc.verify(r.Context(), ts.AccessToken)
	if err != nil || user == nil {
		log.Printf("callback verify: %v", err)
		return
	}
	if err := a.recordUser(r.Context(), user); err != nil {
		log.Printf("callback user: %v", err)
		return
	}
	sid := randomString(40)
	if _, err := a.db.Exec(r.Context(), `INSERT INTO web_session (id, username, access_token, refresh_token, id_token, access_expires_at)
		VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
		hashToken(sid), user.Username, ts.AccessToken, ts.RefreshToken, ts.IDToken, ts.ExpiresIn); err != nil {
		log.Printf("callback session: %v", err)
		return
	}
	setCookie(w, sessionCookie, sid, 0)
	if safeReturnPath(returnPath) {
		target = returnPath
	}
}

func (a *app) handleLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if cookie, err := r.Cookie(sessionCookie); err == nil && a.ready.Load() {
		if crossOrigin(r) {
			writeAPIError(w, fail("FORBIDDEN"))
			return
		}
		var refreshToken string
		err := a.db.QueryRow(r.Context(), `DELETE FROM web_session WHERE id = $1 RETURNING refresh_token`,
			hashToken(cookie.Value)).Scan(&refreshToken)
		if err == nil {
			if err := a.kc.logout(r.Context(), refreshToken); err != nil {
				log.Printf("logout: %v", err)
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("logout: %v", err)
		}
	}
	setCookie(w, sessionCookie, "", -1)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// identify returns the caller's verified identity, or nil when signed out.
func (a *app) identify(ctx context.Context, r *http.Request) (*identity, error) {
	if h := r.Header.Get("Authorization"); h != "" {
		token, ok := strings.CutPrefix(h, "Bearer ")
		if !ok {
			return nil, nil
		}
		user, err := a.kc.verify(ctx, token)
		if err != nil || user == nil {
			return nil, err
		}
		return user, a.recordUser(ctx, user)
	}
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, nil
	}
	sid := hashToken(cookie.Value)
	var access, refresh string
	var fresh bool
	err = a.db.QueryRow(ctx, `SELECT access_token, refresh_token, access_expires_at > now() + interval '5 seconds'
		FROM web_session WHERE id = $1`, sid).Scan(&access, &refresh, &fresh)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read session: %w", err)
	}
	var user *identity
	if fresh {
		if user, err = a.kc.verify(ctx, access); err != nil {
			return nil, err
		}
	}
	if user == nil {
		ts, err := a.kc.refresh(ctx, refresh)
		if errors.Is(err, errTokenRejected) {
			_, err = a.db.Exec(ctx, `DELETE FROM web_session WHERE id = $1`, sid)
			return nil, err
		}
		if err != nil {
			return nil, err
		}
		if user, err = a.kc.verify(ctx, ts.AccessToken); err != nil || user == nil {
			return nil, err
		}
		if _, err := a.db.Exec(ctx, `UPDATE web_session SET access_token = $2, refresh_token = $3,
			access_expires_at = now() + make_interval(secs => $4) WHERE id = $1`,
			sid, ts.AccessToken, ts.RefreshToken, ts.ExpiresIn); err != nil {
			return nil, fmt.Errorf("update session: %w", err)
		}
	}
	return user, a.recordUser(ctx, user)
}

// recordUser keeps the club's copy of a signed-in person in step with their token.
func (a *app) recordUser(ctx context.Context, u *identity) error {
	if _, err := a.db.Exec(ctx, `INSERT INTO app_user (username, name, email, roles, push_topic)
		VALUES ($1, $2, $3, $4, CASE WHEN 'player' = ANY($4::text[]) THEN $5 END)
		ON CONFLICT (username) DO UPDATE SET name = excluded.name, email = excluded.email, roles = excluded.roles,
			push_topic = COALESCE(app_user.push_topic, excluded.push_topic)
		WHERE (app_user.name, app_user.email, app_user.roles) IS DISTINCT FROM (excluded.name, excluded.email, excluded.roles)
			OR (app_user.push_topic IS NULL AND excluded.push_topic IS NOT NULL)`,
		u.Username, u.Name, u.Email, u.Roles, newPushTopic()); err != nil {
		return fmt.Errorf("record user: %w", err)
	}
	var level *float64
	if err := a.db.QueryRow(ctx, `SELECT level::float8, coach_id, push_topic FROM app_user WHERE username = $1`,
		u.Username).Scan(&level, &u.CoachID, &u.PushTopic); err != nil {
		return fmt.Errorf("read user: %w", err)
	}
	u.Level = level
	return nil
}

func crossOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	return err != nil || u.Host != r.Host
}

// pageNeedsSignIn lists the pages a signed-out visitor is sent to sign in for.
func pageNeedsSignIn(path string) bool {
	switch {
	case path == "/courts", path == "/me", path == "/desk", path == "/coach", path == "/manager":
		return true
	case strings.HasPrefix(path, "/share/") && len(path) > len("/share/") && !strings.Contains(path[len("/share/"):], "/"):
		return true
	case strings.HasPrefix(path, "/bookings/") && len(path) > len("/bookings/") && !strings.Contains(path[len("/bookings/"):], "/"):
		return true
	}
	return false
}
