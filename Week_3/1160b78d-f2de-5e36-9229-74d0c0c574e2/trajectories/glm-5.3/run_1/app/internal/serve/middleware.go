package serve

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"switchlamp/internal/store"
)

const sessionCookie = "switchlamp_session"

// bodyLimit is the published request size limit.
const bodyLimit = 1_000_000

// intakeLimit is the larger intake limit.
const intakeLimit = 512_000

// readBody reads a JSON body under the published limits and error order.
func readBody(w http.ResponseWriter, r *http.Request, into any, limit int64) error {
	if r.ContentLength > limit {
		apiError(w, http.StatusRequestEntityTooLarge, "body_too_large")
		return errHandled
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		apiError(w, http.StatusBadRequest, "invalid_json")
		return errHandled
	}
	if int64(len(data)) > limit {
		apiError(w, http.StatusRequestEntityTooLarge, "body_too_large")
		return errHandled
	}
	if len(data) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, into); err != nil {
		apiError(w, http.StatusBadRequest, "invalid_json")
		return errHandled
	}
	return nil
}

var errHandled = errors.New("handled")

// auth resolves the signed-in person or API key for a request.
func (s *Server) auth(r *http.Request) (*SessionUser, error) {
	if key := bearerKey(r); key != "" {
		ctx := r.Context()
		sum := sha256.Sum256([]byte(key))
		hash := hex.EncodeToString(sum[:])
		var id, name, scope string
		var grace, revoked *time.Time
		var previous *string
		err := s.store.Pool().QueryRow(ctx, `SELECT id, name, scope, grace_ends_at, revoked_at, previous_hash
			FROM api_keys WHERE key_hash = $1 OR (previous_hash = $1 AND grace_ends_at > $2)`,
			hash, s.clock.Now()).Scan(&id, &name, &scope, &grace, &revoked, &previous)
		if err != nil {
			return nil, errInvalidKey
		}
		if revoked != nil {
			return nil, errInvalidKey
		}
		now := s.clock.Now()
		if grace != nil && !now.Before(*grace) && previous == nil {
			return nil, errInvalidKey
		}
		return &SessionUser{ID: id, Name: name, Role: "api", APIKey: true, Scope: scope}, nil
	}
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, errNoSession
	}
	ctx := r.Context()
	var userID string
	if err := s.store.Pool().QueryRow(ctx, `SELECT user_id FROM sessions WHERE token = $1`, c.Value).Scan(&userID); err != nil {
		return nil, errNoSession
	}
	u, err := s.store.User(ctx, userID)
	if err != nil {
		return nil, errNoSession
	}
	return &SessionUser{ID: u.ID, Name: u.Name, Role: u.Role, Timezone: u.Timezone, Email: u.Email, User: u}, nil
}

func bearerKey(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return ""
}

var (
	errNoSession  = errors.New("unauthenticated")
	errInvalidKey = errors.New("invalid_api_key")
)

// SessionUser is the resolved caller.
type SessionUser struct {
	ID       string
	Name     string
	Role     string
	Timezone string
	Email    string
	APIKey   bool
	Scope    string
	User     *store.UserRecord
}

// roleAtLeast reports whether the caller's role reaches the needed level.
func roleAtLeast(role, need string) bool {
	order := map[string]int{"stakeholder": 0, "responder": 1, "lead": 2, "admin": 3}
	return order[role] >= order[need]
}

// require wraps a handler with the published error precedence.
func (s *Server) require(need string, h func(w http.ResponseWriter, r *http.Request, u *SessionUser)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Cross-origin state changes are refused.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if origin := r.Header.Get("Origin"); origin != "" && !s.cfg.OriginAllowed(origin) {
				if r.URL.Path == "/api/events" || bearerKey(r) != "" {
					// Intake and bearer-key requests carry no cookie and are exempt.
				} else {
					apiError(w, http.StatusForbidden, "cross_origin")
					return
				}
			}
		}
		u, err := s.auth(r)
		if err != nil {
			if errors.Is(err, errInvalidKey) {
				apiError(w, http.StatusUnauthorized, "invalid_api_key")
				return
			}
			apiError(w, http.StatusUnauthorized, "unauthenticated")
			return
		}
		if u.APIKey {
			// A key outside its scope answers 403 at step 5.
			if !checkScope(u, r.Method) {
				apiError(w, http.StatusForbidden, "forbidden")
				return
			}
			h(w, r, u)
			return
		}
		if need != "" && !roleAtLeast(u.Role, need) {
			apiError(w, http.StatusForbidden, "forbidden")
			return
		}
		h(w, r, u)
	}
}

// checkScope enforces the API key's scope at step 5.
func checkScope(u *SessionUser, method string) bool {
	if !u.APIKey {
		return true
	}
	if method == http.MethodGet || method == http.MethodHead {
		return u.Scope == "read" || u.Scope == "write"
	}
	return u.Scope == "write"
}

// passwordHash is the stored bcrypt form.
func passwordHash(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func checkPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

func newToken() string {
	b := make([]byte, 24)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func hashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

// signToken signs an acknowledge link token: person, incident, assignment.
func (s *Server) signingSecret(ctx context.Context) []byte {
	v, err := s.store.MetaGet(ctx, "signing_secret")
	if err != nil {
		v = ""
	}
	if v == "" {
		secret := newToken() + newToken()
		if err := s.store.MetaSet(ctx, "signing_secret", secret); err == nil {
			return []byte(secret)
		}
		return []byte("switchlamp-dev-secret")
	}
	return []byte(v)
}

func (s *Server) signValue(ctx context.Context, parts ...string) string {
	mac := hmac.New(sha256.New, s.signingSecret(ctx))
	mac.Write([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(mac.Sum(nil))
}

