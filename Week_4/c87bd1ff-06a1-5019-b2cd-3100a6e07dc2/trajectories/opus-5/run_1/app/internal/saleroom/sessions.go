package saleroom

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// SigninAttempt binds one sign-in to the browser that started it.
type SigninAttempt struct {
	State        string
	Verifier     string
	Nonce        string
	NextPath     string
	BrowserToken string
}

// StartSigninAttempt records a fresh state, PKCE verifier and nonce for one
// sign-in attempt and the token that binds it to the starting browser.
func (s *Saleroom) StartSigninAttempt(ctx context.Context, nextPath string) (SigninAttempt, error) {
	a := SigninAttempt{
		State:        newToken(),
		Verifier:     newToken(),
		Nonce:        newToken(),
		NextPath:     nextPath,
		BrowserToken: newToken(),
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO signin_attempts (state, verifier, nonce, next_path, browser_token)
		 VALUES ($1,$2,$3,$4,$5)`, a.State, a.Verifier, a.Nonce, a.NextPath, a.BrowserToken)
	if err != nil {
		return SigninAttempt{}, fmt.Errorf("record sign-in attempt: %w", err)
	}
	return a, nil
}

// ErrAttemptRefused marks a callback whose state is missing, unknown, already
// used, or bound to another browser.
var ErrAttemptRefused = errors.New("sign-in attempt refused")

// UseSigninAttempt claims an unused attempt bound to this browser, so a
// callback creates a session only once and only in the browser that started
// that attempt.
func (s *Saleroom) UseSigninAttempt(ctx context.Context, state, browserToken string) (SigninAttempt, error) {
	var a SigninAttempt
	err := s.pool.QueryRow(ctx,
		`UPDATE signin_attempts SET used_at = now()
		  WHERE state = $1 AND browser_token = $2 AND used_at IS NULL
		  RETURNING state, verifier, nonce, next_path, browser_token`,
		state, browserToken).Scan(&a.State, &a.Verifier, &a.Nonce, &a.NextPath, &a.BrowserToken)
	if errors.Is(err, pgx.ErrNoRows) {
		return SigninAttempt{}, ErrAttemptRefused
	}
	if err != nil {
		return SigninAttempt{}, fmt.Errorf("claim sign-in attempt: %w", err)
	}
	return a, nil
}

// UpsertPerson records the signed-in person. A seed person is matched by
// username the first time they sign in, which binds their Keycloak subject.
func (s *Saleroom) UpsertPerson(ctx context.Context, sub, username, fullName, email string,
	staffRoles []string) (string, error) {
	var id string
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT id FROM people WHERE sub = $1`, sub).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx,
				`UPDATE people SET sub = $1 WHERE username = $2 AND sub LIKE 'seed:%' RETURNING id`,
				sub, username).Scan(&id)
		}
		if errors.Is(err, pgx.ErrNoRows) {
			id = newID()
			_, err = tx.Exec(ctx,
				`INSERT INTO people (id, sub, username, full_name, email, staff_roles)
				 VALUES ($1,$2,$3,$4,$5,$6)`, id, sub, username, fullName, email, staffRoles)
			if err != nil {
				return fmt.Errorf("insert person: %w", err)
			}
			return nil
		}
		if err != nil {
			return fmt.Errorf("read person by subject: %w", err)
		}
		_, err = tx.Exec(ctx,
			`UPDATE people SET email = $2, staff_roles = $3,
			     full_name = CASE WHEN full_name = '' THEN $4 ELSE full_name END
			  WHERE id = $1`, id, email, staffRoles, fullName)
		if err != nil {
			return fmt.Errorf("update person: %w", err)
		}
		return nil
	})
	return id, err
}

// CreateSession opens a session carried by the browser's cookie. Sessions are
// stored in PostgreSQL, so every app process honours them.
func (s *Saleroom) CreateSession(ctx context.Context, personID string) (string, error) {
	id := newToken()
	_, err := s.pool.Exec(ctx,
		`INSERT INTO sessions (id, person_id) VALUES ($1,$2)`, id, personID)
	if err != nil {
		return "", fmt.Errorf("open session: %w", err)
	}
	return id, nil
}

// EndSession signs a person out everywhere at once.
func (s *Saleroom) EndSession(ctx context.Context, sessionID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE sessions SET ended_at = now() WHERE id = $1 AND ended_at IS NULL`, sessionID)
	if err != nil {
		return fmt.Errorf("end session: %w", err)
	}
	return nil
}

// SessionViewer reads the person a session cookie stands for, together with
// the roles and registration their desks depend on.
func (s *Saleroom) SessionViewer(ctx context.Context, sessionID string) (Viewer, error) {
	var v Viewer
	var staffRoles []string
	var paddle, limit *int
	var regRole, regStatus *string
	var ended *time.Time
	err := s.pool.QueryRow(ctx,
		`SELECT p.id, p.full_name, p.staff_roles, s.ended_at,
		        r.role, r.status, r.paddle, r.spending_limit
		   FROM sessions s
		   JOIN people p ON p.id = s.person_id
		   LEFT JOIN registrations r ON r.person_id = p.id
		  WHERE s.id = $1`, sessionID).Scan(
		&v.PersonID, &v.FullName, &staffRoles, &ended, &regRole, &regStatus, &paddle, &limit)
	if errors.Is(err, pgx.ErrNoRows) {
		return AnonymousViewer(), nil
	}
	if err != nil {
		return AnonymousViewer(), fmt.Errorf("read session: %w", err)
	}
	if ended != nil {
		return AnonymousViewer(), nil
	}
	v.SignedIn = true
	v.HasRole = map[string]bool{}
	v.Roles = []string{}
	for _, r := range staffRoles {
		v.HasRole[r] = true
		v.Roles = append(v.Roles, r)
	}
	if regRole != nil {
		v.RegRole = *regRole
		v.RegStatus = strOr(regStatus, "")
		v.Paddle = paddle
		v.SpendLimit = limit
		if !v.HasRole[*regRole] {
			v.HasRole[*regRole] = true
			v.Roles = append(v.Roles, *regRole)
		}
	}
	return v, nil
}
