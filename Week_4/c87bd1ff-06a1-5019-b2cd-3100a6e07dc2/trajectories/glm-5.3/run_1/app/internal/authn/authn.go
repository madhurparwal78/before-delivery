// Package authn owns the Keycloak sign-in flow, sessions and PKCE attempts.
package authn

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gavelhouse/internal/keycloak"
	"gavelhouse/internal/store"
)

type Service struct {
	kc        *keycloak.Client
	db        *store.Store
	publicURL string
	secure    bool
}

func New(kc *keycloak.Client, db *store.Store, publicURL string, secure bool) *Service {
	return &Service{kc: kc, db: db, publicURL: publicURL, secure: secure}
}

const (
	cookieName    = "gavelhouse_session"
	attemptCookie = "gavelhouse_attempt"
)

// randomToken returns 256 bits of unguessable value, base64url.
func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand is required for unguessable sessions and cannot fail here.
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// hashToken gives a storeable digest of a secret so the raw value is only ever
// in the browser's cookie.
func hashToken(tok string) string {
	sum := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(sum[:])
}

// LandingFor gives the address a person goes to after signing in.
func LandingFor(roles []string, registration *store.Registration) string {
	switch {
	case has(roles, "specialist"):
		return "/desk/specialist"
	case has(roles, "cashier"):
		return "/desk/cashier"
	case has(roles, "admin"):
		return "/desk/admin"
	case has(roles, "consignor"):
		return "/consign"
	case has(roles, "bidder"):
		return "/bidder"
	default:
		return "/register"
	}
}

func has(roles []string, role string) bool {
	for _, r := range roles {
		if r == role {
			return true
		}
	}
	return false
}

// validReturnPath keeps the return address a same-origin path other than /.
func validReturnPath(next string) string {
	if next == "" || next == "/" {
		return ""
	}
	u, err := url.Parse(next)
	if err != nil || u.Host != "" || u.User != nil {
		return ""
	}
	if !strings.HasPrefix(u.Path, "/") || strings.HasPrefix(u.Path, "//") {
		return ""
	}
	return u.Path
}

// Start begins a sign-in attempt with fresh state, PKCE and a nonce, bound to
// the starting browser by an HttpOnly cookie.
func (a *Service) Start(w http.ResponseWriter, r *http.Request, next string) (string, bool) {
	state := randomToken()
	verifier := randomToken()
	nonce := randomToken()
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	returnPath := validReturnPath(next)

	err := a.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return err
		}
		return tx.InsertSigninAttempt(ctx, store.SigninAttempt{
			State:     state,
			Verifier:  verifier,
			Nonce:     nonce,
			ReturnTo:  returnPath,
			ExpiresAt: now.Add(10 * time.Minute),
		})
	})
	if err != nil {
		return "", false
	}
	http.SetCookie(w, &http.Cookie{
		Name:     attemptCookie,
		Value:    hashToken(state),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   a.secure,
		MaxAge:   600,
	})
	q := url.Values{}
	q.Set("client_id", a.kc.ClientID())
	q.Set("response_type", "code")
	q.Set("scope", "openid")
	q.Set("redirect_uri", a.redirectURI(r))
	q.Set("state", state)
	q.Set("nonce", nonce)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	return a.kc.AuthorizationEndpoint() + "?" + q.Encode(), true
}

func (a *Service) redirectURI(r *http.Request) string {
	if a.publicURL != "" {
		return strings.TrimSuffix(a.publicURL, "/") + "/auth/callback"
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if fwd := r.Header.Get("X-Forwarded-Proto"); fwd != "" {
		scheme = fwd
	}
	host := r.Host
	if fwd := r.Header.Get("X-Forwarded-Host"); fwd != "" {
		host = fwd
	}
	return fmt.Sprintf("%s://%s/auth/callback", scheme, host)
}

// Callback finishes the sign-in when the state matches an unused attempt bound
// to this browser, and creates the session only once.
func (a *Service) Callback(w http.ResponseWriter, r *http.Request, code, state string) (string, bool) {
	if code == "" || state == "" {
		return "", false
	}
	cookie, err := r.Cookie(attemptCookie)
	if err != nil || cookie.Value != hashToken(state) {
		return "", false
	}
	var landing string
	txErr := a.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		attempt, err := tx.TakeSigninAttempt(ctx, state)
		if err != nil {
			return err
		}
		if attempt == nil {
			return fmt.Errorf("the sign-in attempt is unknown or already used")
		}
		tok, err := a.kc.Exchange(code, a.redirectURI(r), attempt.Verifier)
		if err != nil {
			return fmt.Errorf("exchanging the code: %w", err)
		}
		info, err := a.kc.UserInfo(tok.AccessToken)
		if err != nil {
			return fmt.Errorf("reading the identity: %w", err)
		}
		person, err := tx.GetPersonBySub(ctx, info.Sub)
		if err != nil {
			return err
		}
		if person != nil && info.PreferredName != "" && person.Name == "" {
			// An earlier sign-in created an empty shell; prefer the seeded
			// record, which carries the registration.
			person = nil
		}
		if person == nil && info.PreferredName != "" {
			person, err = tx.GetPersonBySub(ctx, info.PreferredName)
			if err != nil {
				return err
			}
			if person != nil {
				if err := tx.RebindPerson(ctx, person.ID, info.Sub); err != nil {
					return err
				}
			}
		}
		if person == nil {
			person = &store.Person{ID: store.ID(), Sub: info.Sub, Roles: info.RealmRoles}
			if err := tx.UpsertPerson(ctx, *person); err != nil {
				return err
			}
		}
		person.Roles = info.RealmRoles
		if person.Name == "" {
			person.Name = info.Name
		}
		if person.Name == "" {
			person.Name = info.PreferredName
		}
		session := randomToken()
		if err := tx.CreateSession(ctx, hashToken(session), *person); err != nil {
			return err
		}
		landing = attempt.ReturnTo
		if landing == "" {
			reg, err := tx.GetRegistrationByPerson(ctx, person.ID)
			if err != nil {
				return err
			}
			landing = LandingFor(person.Roles, reg)
		}
		http.SetCookie(w, &http.Cookie{
			Name:     cookieName,
			Value:    session,
			Path:     "/",
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   a.secure,
		})
		return nil
	})
	if txErr != nil {
		log.Printf("gavelhouse: sign-in could not be completed: %v", txErr)
		return "", false
	}
	http.SetCookie(w, &http.Cookie{Name: attemptCookie, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: a.secure, MaxAge: -1})
	return landing, true
}

// Person reads the signed-in person from the session cookie.
func (a *Service) Person(ctx context.Context, r *http.Request) *store.Person {
	cookie, err := r.Cookie(cookieName)
	if err != nil || cookie.Value == "" {
		return nil
	}
	var person *store.Person
	_ = a.db.WithTx(ctx, func(ctx context.Context, tx store.Tx) error {
		p, err := tx.GetSession(ctx, hashToken(cookie.Value))
		if err != nil {
			return err
		}
		person = p
		return nil
	})
	return person
}

// SessionToken hashes to the stored session key, used to close live sockets.
func SessionToken(r *http.Request) string {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return ""
	}
	return hashToken(cookie.Value)
}

// SignOut ends the session everywhere at once and returns its hashed token.
func (a *Service) SignOut(w http.ResponseWriter, r *http.Request) string {
	cookie, err := r.Cookie(cookieName)
	if err != nil || cookie.Value == "" {
		return ""
	}
	token := hashToken(cookie.Value)
	_ = a.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		return tx.DeleteSession(ctx, token)
	})
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: a.secure, MaxAge: -1})
	return token
}
