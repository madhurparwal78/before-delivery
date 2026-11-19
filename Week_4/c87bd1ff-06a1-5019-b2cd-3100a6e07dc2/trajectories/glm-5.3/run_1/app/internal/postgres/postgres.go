// Package postgres implements the store's Tx interface on PostgreSQL.
package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"gavelhouse/internal/store"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type DB struct {
	pool *sql.DB
}

func Open(url string) (*DB, error) {
	pool, err := sql.Open("pgx", url)
	if err != nil {
		return nil, fmt.Errorf("opening the database: %w", err)
	}
	pool.SetMaxOpenConns(30)
	pool.SetMaxIdleConns(30)
	return &DB{pool: pool}, nil
}

func (d *DB) Pool() *sql.DB { return d.pool }

func (d *DB) Ping(ctx context.Context) error {
	if err := d.pool.PingContext(ctx); err != nil {
		return fmt.Errorf("reaching the database: %w", err)
	}
	return nil
}

// WaitReady retries until the database answers, once a second.
func (d *DB) WaitReady(ctx context.Context) error {
	for {
		if err := d.Ping(ctx); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

func (d *DB) Now(ctx context.Context) (time.Time, error) {
	var t time.Time
	if err := d.pool.QueryRowContext(ctx, "SELECT now() AT TIME ZONE 'UTC'").Scan(&t); err != nil {
		return time.Time{}, fmt.Errorf("reading the clock: %w", err)
	}
	return t.UTC(), nil
}

func (d *DB) WithTx(ctx context.Context, fn func(ctx context.Context, tx store.Tx) error) error {
	conn, err := d.pool.Conn(ctx)
	if err != nil {
		return fmt.Errorf("reaching the database: %w", err)
	}
	defer conn.Close()
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return fmt.Errorf("opening the transaction: %w", err)
	}
	if err := fn(ctx, &Tx{tx: tx}); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func isNoRows(err error) bool { return errors.Is(err, sql.ErrNoRows) }

type Tx struct{ tx *sql.Tx }

// Now reads the database server's clock inside this transaction.
func (t *Tx) Now(ctx context.Context) (time.Time, error) {
	var now time.Time
	if err := t.tx.QueryRowContext(ctx, "SELECT now() AT TIME ZONE 'UTC'").Scan(&now); err != nil {
		return time.Time{}, fmt.Errorf("reading the clock: %w", err)
	}
	return now.UTC(), nil
}

func nullStr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullInt(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

// strPtr reads a nullable string column.
func strPtr(v any) *string {
	if v == nil {
		return nil
	}
	switch x := v.(type) {
	case string:
		s := x
		return &s
	case []byte:
		s := string(x)
		return &s
	}
	return nil
}

func intPtr(v any) *int {
	if v == nil {
		return nil
	}
	if n, ok := v.(int64); ok {
		i := int(n)
		return &i
	}
	return nil
}

func timePtr(v any) *time.Time {
	if v == nil {
		return nil
	}
	if t, ok := v.(time.Time); ok {
		u := t.UTC()
		return &u
	}
	return nil
}

func boolOf(v any) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

func intOf(v any) int {
	if n, ok := v.(int64); ok {
		return int(n)
	}
	return 0
}

func stringOf(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case []byte:
		return string(x)
	}
	return ""
}

// ---- sessions and people ----

func (t *Tx) UpsertPerson(ctx context.Context, p store.Person) error {
	_, err := t.tx.ExecContext(ctx, `INSERT INTO people (id, keycloak_sub, name) VALUES ($1,$2,$3)
		ON CONFLICT (keycloak_sub) DO UPDATE SET name = EXCLUDED.name`, p.ID, p.Sub, p.Name)
	if err != nil {
		return fmt.Errorf("saving the person: %w", err)
	}
	return nil
}

const personSelect = `SELECT p.id, p.keycloak_sub, p.name, p.created_at FROM people p WHERE p.keycloak_sub = $1`

func (t *Tx) GetPersonBySub(ctx context.Context, sub string) (*store.Person, error) {
	var id, name string
	var created time.Time
	err := t.tx.QueryRowContext(ctx, personSelect, sub).Scan(&id, &sub, &name, &created)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the person: %w", err)
	}
	return &store.Person{ID: id, Sub: sub, Name: name}, nil
}

func (t *Tx) CreateSession(ctx context.Context, token string, p store.Person) error {
	_, err := t.tx.ExecContext(ctx, `INSERT INTO sessions (token, person_id, keycloak_sub, name, roles) VALUES ($1,$2,$3,$4,$5)`,
		token, p.ID, p.Sub, p.Name, pqStringArray(p.Roles))
	if err != nil {
		return fmt.Errorf("saving the session: %w", err)
	}
	return nil
}

func (t *Tx) GetSession(ctx context.Context, token string) (*store.Person, error) {
	var personID, sub, name string
	var roles pqStringArray
	err := t.tx.QueryRowContext(ctx, `SELECT person_id, keycloak_sub, name, roles FROM sessions WHERE token = $1`, token).Scan(&personID, &sub, &name, &roles)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the session: %w", err)
	}
	return &store.Person{ID: personID, Sub: sub, Name: name, Roles: roles}, nil
}

func (t *Tx) DeleteSession(ctx context.Context, token string) error {
	if _, err := t.tx.ExecContext(ctx, `DELETE FROM sessions WHERE token = $1`, token); err != nil {
		return fmt.Errorf("ending the session: %w", err)
	}
	return nil
}

func (t *Tx) DeleteSessionsOfPerson(ctx context.Context, personID string) error {
	if _, err := t.tx.ExecContext(ctx, `DELETE FROM sessions WHERE person_id = $1`, personID); err != nil {
		return fmt.Errorf("ending the sessions: %w", err)
	}
	return nil
}

// RebindPerson moves the Keycloak identity onto the seeded person's record,
// taking it over from any empty shell an earlier sign-in left behind.
func (t *Tx) RebindPerson(ctx context.Context, personID, sub string) error {
	// Clear the identity from any shell record so the unique key is free.
	if _, err := t.tx.ExecContext(ctx, `UPDATE people SET keycloak_sub = 'shell-' || id WHERE keycloak_sub = $1 AND name = ''`, sub); err != nil {
		return fmt.Errorf("joining the person: %w", err)
	}
	if _, err := t.tx.ExecContext(ctx, `UPDATE people SET keycloak_sub = $2 WHERE id = $1`, personID, sub); err != nil {
		return fmt.Errorf("joining the person: %w", err)
	}
	return nil
}

func (t *Tx) InsertSigninAttempt(ctx context.Context, a store.SigninAttempt) error {
	if _, err := t.tx.ExecContext(ctx, `INSERT INTO signin_attempts (state, verifier, nonce, return_to, expires_at)
		VALUES ($1,$2,$3,$4,$5)`, a.State, a.Verifier, a.Nonce, a.ReturnTo, a.ExpiresAt); err != nil {
		return fmt.Errorf("saving the sign-in attempt: %w", err)
	}
	return nil
}

// TakeSigninAttempt marks the attempt used and returns it, once only.
func (t *Tx) TakeSigninAttempt(ctx context.Context, state string) (*store.SigninAttempt, error) {
	var verifier, nonce, returnTo string
	var expires time.Time
	err := t.tx.QueryRowContext(ctx, `UPDATE signin_attempts SET used = TRUE
		WHERE state = $1 AND used = FALSE AND expires_at > now() AT TIME ZONE 'UTC'
		RETURNING verifier, nonce, return_to, expires_at`, state).
		Scan(&verifier, &nonce, &returnTo, &expires)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("taking the sign-in attempt: %w", err)
	}
	return &store.SigninAttempt{State: state, Verifier: verifier, Nonce: nonce, ReturnTo: returnTo, ExpiresAt: expires.UTC()}, nil
}

// ---- registrations ----

func (t *Tx) CreateRegistration(ctx context.Context, r store.Registration) error {
	_, err := t.tx.ExecContext(ctx, `INSERT INTO registrations (id, person_id, role, status, full_name, phone, address, paddle, spending_limit)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		r.ID, r.PersonID, r.Role, r.Status, r.FullName, r.Phone, r.Address, nullInt(r.Paddle), nullInt(r.SpendingLimit))
	if err != nil {
		return fmt.Errorf("saving the registration: %w", err)
	}
	return nil
}

func registrationFromRow(id, personID, role, status, fullName, phone, address string, paddle, limit any, created time.Time) *store.Registration {
	return &store.Registration{
		ID: id, PersonID: personID, Role: role, Status: status,
		FullName: fullName, Phone: phone, Address: address,
		Paddle: intPtr(paddle), SpendingLimit: intPtr(limit), CreatedAt: created,
	}
}

func (t *Tx) GetRegistrationByPerson(ctx context.Context, personID string) (*store.Registration, error) {
	var id, role, status, fullName, phone, address string
	var paddle, limit any
	var created time.Time
	err := t.tx.QueryRowContext(ctx, `SELECT id, person_id, role, status, full_name, phone, address, paddle, spending_limit, created_at
		FROM registrations WHERE person_id = $1`, personID).Scan(&id, &personID, &role, &status, &fullName, &phone, &address, &paddle, &limit, &created)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the registration: %w", err)
	}
	return registrationFromRow(id, personID, role, status, fullName, phone, address, paddle, limit, created), nil
}

func (t *Tx) GetRegistration(ctx context.Context, id string) (*store.Registration, error) {
	var personID, role, status, fullName, phone, address string
	var paddle, limit any
	var created time.Time
	err := t.tx.QueryRowContext(ctx, `SELECT id, person_id, role, status, full_name, phone, address, paddle, spending_limit, created_at
		FROM registrations WHERE id = $1`, id).Scan(&id, &personID, &role, &status, &fullName, &phone, &address, &paddle, &limit, &created)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the registration: %w", err)
	}
	return registrationFromRow(id, personID, role, status, fullName, phone, address, paddle, limit, created), nil
}

func (t *Tx) PendingRegistrations(ctx context.Context) ([]store.Registration, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT id, person_id, role, status, full_name, phone, address, paddle, spending_limit, created_at
		FROM registrations WHERE status = 'pending' AND role = 'bidder' ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("reading the pending registrations: %w", err)
	}
	defer rows.Close()
	var out []store.Registration
	for rows.Next() {
		var id, personID, role, status, fullName, phone, address string
		var paddle, limit any
		var created time.Time
		if err := rows.Scan(&id, &personID, &role, &status, &fullName, &phone, &address, &paddle, &limit, &created); err != nil {
			return nil, fmt.Errorf("reading a registration: %w", err)
		}
		out = append(out, *registrationFromRow(id, personID, role, status, fullName, phone, address, paddle, limit, created))
	}
	return out, rows.Err()
}

func (t *Tx) ApproveRegistration(ctx context.Context, id string, paddle, limit int) error {
	res, err := t.tx.ExecContext(ctx, `UPDATE registrations SET status = 'active', paddle = $2, spending_limit = $3 WHERE id = $1 AND status = 'pending'`, id, paddle, limit)
	if err != nil {
		return fmt.Errorf("approving the registration: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("approving the registration: it changed under us")
	}
	return nil
}

func (t *Tx) NextPaddle(ctx context.Context) (int, error) {
	var next int
	if err := t.tx.QueryRowContext(ctx, `SELECT nextval('paddle_seq')`).Scan(&next); err != nil {
		return 0, fmt.Errorf("giving the next paddle: %w", err)
	}
	return next, nil
}

// ---- sales ----

func (t *Tx) CreateSale(ctx context.Context, sale store.Sale) (store.Sale, error) {
	_, err := t.tx.ExecContext(ctx, `INSERT INTO sales (id, title, ends_at, first_lot_number, state) VALUES ($1,$2,$3,$4,$5)`,
		sale.ID, sale.Title, sale.EndsAt, sale.FirstLotNumber, sale.State)
	if err != nil {
		return store.Sale{}, fmt.Errorf("saving the sale: %w", err)
	}
	return sale, nil
}

func saleFromRow(id, title string, ends time.Time, first int, state string) store.Sale {
	return store.Sale{ID: id, Title: title, EndsAt: ends.UTC(), FirstLotNumber: first, State: state}
}

func (t *Tx) GetSale(ctx context.Context, id string) (*store.Sale, error) {
	var title, state string
	var ends time.Time
	var first int
	err := t.tx.QueryRowContext(ctx, `SELECT id, title, ends_at, first_lot_number, state FROM sales WHERE id = $1`, id).Scan(&id, &title, &ends, &first, &state)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the sale: %w", err)
	}
	s := saleFromRow(id, title, ends, first, state)
	return &s, nil
}

func (t *Tx) CurrentSale(ctx context.Context) (*store.Sale, error) {
	var id, title, state string
	var ends time.Time
	var first int
	err := t.tx.QueryRowContext(ctx, `SELECT id, title, ends_at, first_lot_number, state FROM sales
		WHERE state = 'open' ORDER BY ends_at ASC LIMIT 1`).Scan(&id, &title, &ends, &first, &state)
	if isNoRows(err) {
		var id2, title2, state2 string
		var ends2 time.Time
		var first2 int
		err := t.tx.QueryRowContext(ctx, `SELECT id, title, ends_at, first_lot_number, state FROM sales
			WHERE state = 'closed' ORDER BY ends_at DESC LIMIT 1`).Scan(&id2, &title2, &ends2, &first2, &state2)
		if isNoRows(err) {
			return nil, nil
		}
		if err != nil {
			return nil, fmt.Errorf("reading the sale: %w", err)
		}
		s := saleFromRow(id2, title2, ends2, first2, state2)
		return &s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the sale: %w", err)
	}
	s := saleFromRow(id, title, ends, first, state)
	return &s, nil
}

func (t *Tx) AllSales(ctx context.Context) ([]store.Sale, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT id, title, ends_at, first_lot_number, state FROM sales ORDER BY created_at DESC, id`)
	if err != nil {
		return nil, fmt.Errorf("reading the sales: %w", err)
	}
	defer rows.Close()
	var out []store.Sale
	for rows.Next() {
		var id, title, state string
		var ends time.Time
		var first int
		if err := rows.Scan(&id, &title, &ends, &first, &state); err != nil {
			return nil, fmt.Errorf("reading a sale: %w", err)
		}
		out = append(out, saleFromRow(id, title, ends, first, state))
	}
	return out, rows.Err()
}

func (t *Tx) SetSaleState(ctx context.Context, id, state string) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE sales SET state = $2 WHERE id = $1`, id, state); err != nil {
		return fmt.Errorf("updating the sale: %w", err)
	}
	return nil
}

func (t *Tx) SaleLotCount(ctx context.Context, saleID string) (int, error) {
	var n int
	if err := t.tx.QueryRowContext(ctx, `SELECT count(*) FROM lots WHERE sale_id = $1 AND state = 'placed'`, saleID).Scan(&n); err != nil {
		return 0, fmt.Errorf("counting the sale's lots: %w", err)
	}
	return n, nil
}

func (t *Tx) OpenSaleLotCount(ctx context.Context, saleID string, exceptLotID string) (int, error) {
	var n int
	if err := t.tx.QueryRowContext(ctx, `SELECT count(*) FROM lots WHERE sale_id = $1 AND state IN ('open','extended') AND id <> $2`, saleID, exceptLotID).Scan(&n); err != nil {
		return 0, fmt.Errorf("counting the sale's lots: %w", err)
	}
	return n, nil
}
