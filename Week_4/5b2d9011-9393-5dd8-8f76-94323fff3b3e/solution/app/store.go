package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/url"
	"time"

	"github.com/lib/pq"
	"strings"
	"unicode/utf8"
)

// studioKeyHash is the SHA-256 of the seeded studio key; the key itself is never stored.
const studioKeyHash = "9f2774be6b08a38cc28841cf4fcefbf5753a682559a34dae41dc27d0834ce943"

type seedPrice struct {
	item  string
	price int
}

var seedPrices = []seedPrice{
	{"ammo_pack", 120},
	{"grenade", 200},
	{"med_kit", 150},
}

const seedPriceEffectiveLocal = "2026-01-01T00:00"

type seedSeries struct {
	id, title, mode, weekday, localTime, firstDate string
	weeks, capacity                                int
}

var seedSeriesList = []seedSeries{
	{"seed-friday-siege", "Friday Siege", modeSiege, "friday", "20:00", "2026-11-13", 8, 24},
	{"seed-sunday-convoy", "Sunday Convoy", modeConvoy, "sunday", "19:00", "2026-11-15", 4, 12},
}

const schemaSQL = `
CREATE TABLE IF NOT EXISTS studio (id int PRIMARY KEY, name text NOT NULL, zone text NOT NULL, key_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS players (id text PRIMARY KEY, callsign text NOT NULL, role text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, player_id text NOT NULL REFERENCES players(id), created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS settings (player_id text PRIMARY KEY REFERENCES players(id), body jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS price_changes (
  id text PRIMARY KEY, item text NOT NULL, price int NOT NULL, effective_local text NOT NULL,
  effective_at timestamptz NOT NULL, created_at timestamptz NOT NULL, UNIQUE (item, effective_at));
CREATE TABLE IF NOT EXISTS series (
  id text PRIMARY KEY, title text NOT NULL, mode text NOT NULL, weekday text NOT NULL, local_time text NOT NULL,
  first_date text NOT NULL, weeks int NOT NULL, capacity int NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS nights (
  id text PRIMARY KEY, series_id text NOT NULL REFERENCES series(id), title text NOT NULL, mode text NOT NULL,
  night_date text NOT NULL, scheduled_local_time text NOT NULL, starts_at timestamptz NOT NULL,
  capacity int NOT NULL, dst_note text NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS nights_date ON nights (night_date);
CREATE TABLE IF NOT EXISTS signups (
  id text PRIMARY KEY, night_id text NOT NULL REFERENCES nights(id), name text NOT NULL, email text NOT NULL,
  email_key text NOT NULL, viewer_zone text NOT NULL, created_at timestamptz NOT NULL, UNIQUE (night_id, email_key));
CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY, signup_id text NOT NULL REFERENCES signups(id), kind text NOT NULL, to_email text NOT NULL,
  subject text NOT NULL, body text NOT NULL, status text NOT NULL, attempts int NOT NULL DEFAULT 0,
  claimed_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL, UNIQUE (signup_id, kind));
CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY, code text NOT NULL, mode text NOT NULL, result text NOT NULL, waves_cleared int NOT NULL,
  night_id text, started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS matches_ended ON matches (ended_at DESC);
CREATE TABLE IF NOT EXISTS match_players (
  match_id text NOT NULL, seat int NOT NULL, player_id text NOT NULL, callsign text NOT NULL,
  score int NOT NULL, kills int NOT NULL, credits_earned int NOT NULL, best_lap_ms int, PRIMARY KEY (match_id, seat));
CREATE TABLE IF NOT EXISTS laps (
  id text PRIMARY KEY, match_id text NOT NULL, player_id text NOT NULL, callsign text NOT NULL,
  lap_ms int NOT NULL, set_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY, match_id text NOT NULL, account text NOT NULL, amount int NOT NULL, kind text NOT NULL,
  ref text NOT NULL, item text, unit_price int, at timestamptz NOT NULL);
`

type store struct {
	db    *sql.DB
	clock *wallClock
}

func openStore(databaseURL string, clock *wallClock) (*store, error) {
	dsn, err := withConnectTimeout(databaseURL)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	db.SetMaxOpenConns(24)
	db.SetConnMaxLifetime(5 * time.Minute)
	return &store{db: db, clock: clock}, nil
}

// storableID reports whether a client-supplied id can be stored in a Postgres text column: a NUL byte or invalid
// UTF-8 can name no row, so such ids are unknown (404) rather than a storage error (503).
func storableID(id string) bool {
	return utf8.ValidString(id) && !strings.ContainsRune(id, 0)
}

func newID(prefix string) string {
	buf := make([]byte, 12)
	rand.Read(buf) // crypto/rand.Read never returns an error
	return prefix + hex.EncodeToString(buf)
}

func hashSecret(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// storageErr wraps a database failure so the HTTP layer answers it as 503.
func storageErr(err error) error {
	if err == nil || errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var apiErr *apiError
	if errors.As(err, &apiErr) {
		return err
	}
	return fmt.Errorf("%w: %v", errStorageDown, err)
}

func isUniqueViolation(err error) bool {
	var pgErr *pq.Error
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func ctxTimeout(seconds int) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), time.Duration(seconds)*time.Second)
}

// migrate applies the schema and seeds the studio records, idempotently, under an advisory lock.
func (s *store) migrate(ctx context.Context) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `SELECT pg_advisory_lock(727001)`); err != nil {
		return err
	}
	defer func() {
		if _, err := conn.ExecContext(context.Background(), `SELECT pg_advisory_unlock(727001)`); err != nil {
			log.Printf("migrate: releasing the schema lock: %v", err)
		}
	}()
	if _, err := conn.ExecContext(ctx, schemaSQL); err != nil {
		return err
	}
	now := s.clock.Now()
	if _, err := conn.ExecContext(ctx,
		`INSERT INTO studio (id, name, zone, key_hash) VALUES (1, $1, $2, $3) ON CONFLICT DO NOTHING`,
		studioName, studioZone, studioKeyHash); err != nil {
		return err
	}
	for _, c := range seedPriceChanges() {
		if _, err := conn.ExecContext(ctx,
			`INSERT INTO price_changes (id, item, price, effective_local, effective_at, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
			c.ID, c.Item, c.Price, c.EffectiveLocal, c.EffectiveAt, now); err != nil {
			return err
		}
	}
	for _, sr := range seedSeriesList {
		var present bool
		if err := conn.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM series WHERE id = $1)`, sr.id).Scan(&present); err != nil {
			return err
		}
		if present {
			continue
		}
		hour, minute, err := parseWallTime(sr.localTime)
		if err != nil {
			return err
		}
		first, err := time.Parse("2006-01-02", sr.firstDate)
		if err != nil {
			return err
		}
		spec := seriesSpec{title: sr.title, mode: sr.mode, weekday: sr.weekday, localTime: sr.localTime, hour: hour, minute: minute,
			firstDate: sr.firstDate, first: first, weeks: sr.weeks, capacity: sr.capacity}
		if err := insertSeries(ctx, conn, sr.id, spec, expandSeries(sr.id, spec, func(i int) string { return fmt.Sprintf("%s-%d", sr.id, i+1) }), now); err != nil {
			return err
		}
	}
	return nil
}

// seedPriceChanges are the seeded prices, each effective from 2026-01-01T00:00 studio time.
func seedPriceChanges() []priceChange {
	effective, _, _ := parseStudioLocal(seedPriceEffectiveLocal)
	changes := make([]priceChange, 0, len(seedPrices))
	for _, p := range seedPrices {
		changes = append(changes, priceChange{ID: "seed-price-" + p.item, Item: p.item, Price: p.price,
			EffectiveLocal: seedPriceEffectiveLocal, EffectiveAt: effective})
	}
	return changes
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func insertSeries(ctx context.Context, tx execer, id string, spec seriesSpec, nights []nightRow, now time.Time) error {
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO series (id, title, mode, weekday, local_time, first_date, weeks, capacity, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
		id, spec.title, spec.mode, spec.weekday, spec.localTime, spec.firstDate, spec.weeks, spec.capacity, now); err != nil {
		return err
	}
	for _, n := range nights {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO nights (id, series_id, title, mode, night_date, scheduled_local_time, starts_at, capacity, dst_note)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
			n.ID, n.SeriesID, n.Title, n.Mode, n.Date, n.ScheduledLocalTime, n.StartsAt, n.Capacity, n.DstNote); err != nil {
			return err
		}
	}
	return nil
}

func (s *store) ping(ctx context.Context) error { return s.db.PingContext(ctx) }

// ---- players, sessions, settings

type player struct {
	ID       string `json:"id"`
	Callsign string `json:"callsign"`
	Role     string `json:"role"`
}

func (s *store) studioKeyMatches(ctx context.Context, key string) (bool, error) {
	var stored string
	if err := s.db.QueryRowContext(ctx, `SELECT key_hash FROM studio WHERE id = 1`).Scan(&stored); err != nil {
		return false, storageErr(err)
	}
	return hashSecret(key) == stored, nil
}

func (s *store) createSession(ctx context.Context, callsign, role string) (token string, p player, err error) {
	p = player{ID: newID("p_"), Callsign: callsign, Role: role}
	token = newID("t_") + newID("")
	now := s.clock.Now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", player{}, storageErr(err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `INSERT INTO players (id, callsign, role, created_at) VALUES ($1,$2,$3,$4)`, p.ID, p.Callsign, p.Role, now); err != nil {
		return "", player{}, storageErr(err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO sessions (token_hash, player_id, created_at) VALUES ($1,$2,$3)`, hashSecret(token), p.ID, now); err != nil {
		return "", player{}, storageErr(err)
	}
	return token, p, storageErr(tx.Commit())
}

func (s *store) sessionPlayer(ctx context.Context, token string) (player, bool, error) {
	var p player
	err := s.db.QueryRowContext(ctx,
		`SELECT p.id, p.callsign, p.role FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = $1`,
		hashSecret(token)).Scan(&p.ID, &p.Callsign, &p.Role)
	if errors.Is(err, sql.ErrNoRows) {
		return player{}, false, nil
	}
	return p, err == nil, storageErr(err)
}

func (s *store) deleteSession(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = $1`, hashSecret(token))
	return storageErr(err)
}

func (s *store) loadSettings(ctx context.Context, playerID string) (string, bool, error) {
	var body string
	err := s.db.QueryRowContext(ctx, `SELECT body::text FROM settings WHERE player_id = $1`, playerID).Scan(&body)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return body, err == nil, storageErr(err)
}

func (s *store) saveSettings(ctx context.Context, playerID, body string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO settings (player_id, body) VALUES ($1, $2::jsonb)
		 ON CONFLICT (player_id) DO UPDATE SET body = EXCLUDED.body`, playerID, body)
	return storageErr(err)
}

// ---- price schedule

type priceChange struct {
	ID             string
	Item           string
	Price          int
	EffectiveLocal string
	EffectiveAt    time.Time
}

func (s *store) priceSchedule(ctx context.Context) ([]priceChange, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, item, price, effective_local, effective_at FROM price_changes ORDER BY item, effective_at`)
	if err != nil {
		return nil, storageErr(err)
	}
	defer rows.Close()
	var out []priceChange
	for rows.Next() {
		var c priceChange
		if err := rows.Scan(&c.ID, &c.Item, &c.Price, &c.EffectiveLocal, &c.EffectiveAt); err != nil {
			return nil, storageErr(err)
		}
		out = append(out, c)
	}
	return out, storageErr(rows.Err())
}

func (s *store) priceChangeExists(ctx context.Context, item string, at time.Time) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM price_changes WHERE item = $1 AND effective_at = $2)`, item, at).Scan(&exists)
	return exists, storageErr(err)
}

func (s *store) insertPriceChange(ctx context.Context, c priceChange) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO price_changes (id, item, price, effective_local, effective_at, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		c.ID, c.Item, c.Price, c.EffectiveLocal, c.EffectiveAt, s.clock.Now())
	if isUniqueViolation(err) {
		return fail("price_change_exists")
	}
	return storageErr(err)
}

func (s *store) priceChangeByID(ctx context.Context, id string) (priceChange, bool, error) {
	var c priceChange
	if !storableID(id) {
		return c, false, nil
	}
	err := s.db.QueryRowContext(ctx, `SELECT id, item, price, effective_local, effective_at FROM price_changes WHERE id = $1`, id).
		Scan(&c.ID, &c.Item, &c.Price, &c.EffectiveLocal, &c.EffectiveAt)
	if errors.Is(err, sql.ErrNoRows) {
		return c, false, nil
	}
	return c, err == nil, storageErr(err)
}

func (s *store) deletePriceChange(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM price_changes WHERE id = $1`, id)
	return storageErr(err)
}

// ---- history, laps and ledger persistence

type matchRecord struct {
	ID, Code, Mode, Result string
	WavesCleared           int
	NightID                string
	StartedAt, EndedAt     time.Time
	Players                []matchPlayerRecord
}

type matchPlayerRecord struct {
	Seat          int
	PlayerID      string
	Callsign      string
	Score, Kills  int
	CreditsEarned int
	BestLapMs     *int
}

func (s *store) saveMatch(ctx context.Context, m matchRecord) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var night any
	if m.NightID != "" {
		night = m.NightID
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO matches (id, code, mode, result, waves_cleared, night_id, started_at, ended_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
		m.ID, m.Code, m.Mode, m.Result, m.WavesCleared, night, m.StartedAt, m.EndedAt); err != nil {
		return err
	}
	for _, p := range m.Players {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO match_players (match_id, seat, player_id, callsign, score, kills, credits_earned, best_lap_ms)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
			m.ID, p.Seat, p.PlayerID, p.Callsign, p.Score, p.Kills, p.CreditsEarned, p.BestLapMs); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type lapRecord struct {
	ID, MatchID, PlayerID, Callsign string
	LapMs                           int
	SetAt                           time.Time
}

func (s *store) saveLap(ctx context.Context, l lapRecord) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO laps (id, match_id, player_id, callsign, lap_ms, set_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
		l.ID, l.MatchID, l.PlayerID, l.Callsign, l.LapMs, l.SetAt)
	return err
}

type ledgerRecord struct {
	ID, MatchID, Account string
	Amount               int
	Kind, Ref            string
	Item                 string
	UnitPrice            int
	At                   time.Time
}

func (s *store) saveLedgerEntry(ctx context.Context, e ledgerRecord) error {
	var item, unit any
	if e.Item != "" {
		item, unit = e.Item, e.UnitPrice
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO ledger_entries (id, match_id, account, amount, kind, ref, item, unit_price, at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
		e.ID, e.MatchID, e.Account, e.Amount, e.Kind, e.Ref, item, unit, e.At)
	return err
}

type historyMatch struct {
	ID, Code, Mode, Result string
	WavesCleared           int
	NightID                sql.NullString
	StartedAt, EndedAt     time.Time
	Players                []matchPlayerRecord
}

func (s *store) history(ctx context.Context, limit int) ([]historyMatch, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, code, mode, result, waves_cleared, night_id, started_at, ended_at FROM matches
		 ORDER BY ended_at DESC, id LIMIT $1`, limit)
	if err != nil {
		return nil, storageErr(err)
	}
	defer rows.Close()
	var out []historyMatch
	ids := []string{}
	for rows.Next() {
		var m historyMatch
		if err := rows.Scan(&m.ID, &m.Code, &m.Mode, &m.Result, &m.WavesCleared, &m.NightID, &m.StartedAt, &m.EndedAt); err != nil {
			return nil, storageErr(err)
		}
		out = append(out, m)
		ids = append(ids, m.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, storageErr(err)
	}
	if len(ids) == 0 {
		return out, nil
	}
	prows, err := s.db.QueryContext(ctx,
		`SELECT match_id, seat, player_id, callsign, score, kills, credits_earned, best_lap_ms
		 FROM match_players WHERE match_id = ANY($1) ORDER BY match_id, seat`, pq.Array(ids))
	if err != nil {
		return nil, storageErr(err)
	}
	defer prows.Close()
	byMatch := map[string][]matchPlayerRecord{}
	for prows.Next() {
		var id string
		var p matchPlayerRecord
		var best sql.NullInt64
		if err := prows.Scan(&id, &p.Seat, &p.PlayerID, &p.Callsign, &p.Score, &p.Kills, &p.CreditsEarned, &best); err != nil {
			return nil, storageErr(err)
		}
		if best.Valid {
			v := int(best.Int64)
			p.BestLapMs = &v
		}
		byMatch[id] = append(byMatch[id], p)
	}
	for i := range out {
		out[i].Players = byMatch[out[i].ID]
	}
	return out, storageErr(prows.Err())
}

type lapBoardRow struct {
	Rank     int
	Callsign string
	LapMs    int
	SetAt    time.Time
	MatchID  string
}

// lapBoard lists each callsign's best lap, fastest first, ties by the earlier set_at.
func (s *store) lapBoard(ctx context.Context, limit int) ([]lapBoardRow, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT callsign, lap_ms, set_at, match_id FROM (
		   SELECT DISTINCT ON (callsign) callsign, lap_ms, set_at, match_id FROM laps
		   ORDER BY callsign, lap_ms, set_at) best
		 ORDER BY lap_ms, set_at, callsign LIMIT $1`, limit)
	if err != nil {
		return nil, storageErr(err)
	}
	defer rows.Close()
	var out []lapBoardRow
	for rows.Next() {
		var r lapBoardRow
		if err := rows.Scan(&r.Callsign, &r.LapMs, &r.SetAt, &r.MatchID); err != nil {
			return nil, storageErr(err)
		}
		r.Rank = len(out) + 1
		out = append(out, r)
	}
	return out, storageErr(rows.Err())
}

// liveNightID is the night of the given mode that is live at the instant, or empty.
func (s *store) liveNightID(ctx context.Context, mode string, at time.Time) (string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+nightColumns+` FROM nights n WHERE n.mode = $1 AND n.starts_at <= $2 AND n.starts_at > $3 ORDER BY n.starts_at`,
		mode, at, at.Add(-nightLength))
	if err != nil {
		return "", storageErr(err)
	}
	defer rows.Close()
	for rows.Next() {
		n, err := scanNight(rows)
		if err != nil {
			return "", storageErr(err)
		}
		if status, _ := n.status(at); status == "live" {
			return n.ID, nil
		}
	}
	return "", storageErr(rows.Err())
}

// withConnectTimeout bounds how long a connection attempt may hang while Postgres is down, and
// speaks plain TCP to the provided service.
func withConnectTimeout(rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("DATABASE_URL: %w", err)
	}
	q := u.Query()
	if q.Get("connect_timeout") == "" {
		q.Set("connect_timeout", "3")
	}
	if q.Get("sslmode") == "" {
		q.Set("sslmode", "disable")
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}
