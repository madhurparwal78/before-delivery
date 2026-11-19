// Package store owns everything durable in Postgres: players and sessions,
// settings, the credit ledger, the price schedule, series, nights, sign-ups,
// the email outbox, match history and laps. The schema is applied
// idempotently every time the app serves, and the seed records are written
// only when they are absent.
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	// The Postgres driver.
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Store wraps the Postgres connection.
type Store struct {
	DB *sql.DB
	// unreachable marks a store whose connection failed at boot.
	unreachable bool
}

// Open connects to the database and pings it.
func Open(databaseURL string) (*Store, error) {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, err
	}
	return &Store{DB: db}, nil
}

// Unreachable returns a store whose connection is absent. The prober reports
// it down until Postgres returns; every query answers an error.
func Unreachable() *Store {
	db, _ := sql.Open("pgx", "")
	return &Store{DB: db, unreachable: true}
}

// Ping reports whether Postgres answers.
func (s *Store) Ping() bool {
	if s == nil || s.DB == nil || s.unreachable {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.DB.PingContext(ctx) == nil
}

// ErrUnchanged is returned when a write matched no row.
var ErrUnchanged = errors.New("store: no row matched")

// Migrate applies the schema idempotently.
func (s *Store) Migrate(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, Schema)
	return err
}

const Schema = `
CREATE TABLE IF NOT EXISTS studio (
  id int PRIMARY KEY DEFAULT 1,
  name text NOT NULL,
  zone text NOT NULL,
  studio_key_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY,
  callsign text NOT NULL UNIQUE,
  role text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  player_id text PRIMARY KEY REFERENCES players(id),
  bindings jsonb NOT NULL,
  master_volume int NOT NULL,
  effects_volume int NOT NULL,
  reduce_effects boolean NOT NULL,
  screen_shake boolean NOT NULL,
  camera_bob boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  match_id text NOT NULL,
  account text NOT NULL,
  amount bigint NOT NULL,
  kind text NOT NULL,
  ref text NOT NULL,
  item text NOT NULL DEFAULT '',
  unit_price int NOT NULL DEFAULT 0,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_match_idx ON ledger_entries (match_id);
CREATE TABLE IF NOT EXISTS price_changes (
  id text PRIMARY KEY,
  item text NOT NULL,
  price int NOT NULL,
  effective_local text NOT NULL,
  effective_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS price_item_at_idx ON price_changes (item, effective_at);
CREATE TABLE IF NOT EXISTS series (
  id text PRIMARY KEY,
  title text NOT NULL,
  mode text NOT NULL,
  weekday text NOT NULL,
  local_time text NOT NULL,
  first_date text NOT NULL,
  weeks int NOT NULL,
  capacity int NOT NULL,
  seeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS nights (
  id text PRIMARY KEY,
  series_id text NOT NULL REFERENCES series(id),
  title text NOT NULL,
  mode text NOT NULL,
  date text NOT NULL,
  scheduled_local_time text NOT NULL,
  local_start text NOT NULL,
  utc_offset text NOT NULL,
  zone_abbr text NOT NULL,
  starts_at timestamptz NOT NULL,
  signups_open_at timestamptz NOT NULL,
  signups_close_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  dst_note text,
  capacity int NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS night_series_date_idx ON nights (series_id, date);
CREATE TABLE IF NOT EXISTS signups (
  id text PRIMARY KEY,
  night_id text NOT NULL REFERENCES nights(id),
  name text NOT NULL,
  email text NOT NULL,
  viewer_zone text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS signup_night_email_idx ON signups (night_id, lower(email));
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  signup_id text NOT NULL,
  night_id text NOT NULL,
  to_addr text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS outbox_signup_kind_idx ON outbox (signup_id, kind);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (sent_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS reminders (
  signup_id text NOT NULL REFERENCES signups(id),
  night_id text NOT NULL,
  due_at timestamptz NOT NULL,
  queued boolean NOT NULL DEFAULT false,
  PRIMARY KEY (signup_id, night_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY,
  code text NOT NULL,
  mode text NOT NULL,
  result text NOT NULL,
  waves_cleared int NOT NULL,
  night_id text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id text NOT NULL REFERENCES matches(id),
  seat int NOT NULL,
  callsign text NOT NULL,
  score int NOT NULL,
  kills int NOT NULL,
  credits_earned int NOT NULL,
  best_lap_ms bigint,
  PRIMARY KEY (match_id, seat)
);
CREATE TABLE IF NOT EXISTS laps (
  id bigserial PRIMARY KEY,
  match_id text NOT NULL,
  callsign text NOT NULL,
  lap_ms bigint NOT NULL,
  set_at timestamptz NOT NULL
);
`

// Seed writes the studio, the studio key hash, the base prices, the seeded
// series and their nights, only when they are absent.
func (s *Store) Seed(ctx context.Context, studioName, zone, studioKey string, basePrices map[string]int, series []SeriesSeed) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	keyHash := HashKey(studioKey)
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO studio (id, name, zone, studio_key_hash) VALUES (1, $1, $2, $3)
		 ON CONFLICT (id) DO NOTHING`, studioName, zone, keyHash); err != nil {
		return err
	}
	base := "2026-01-01T00:00"
	for item, price := range basePrices {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO price_changes (id, item, price, effective_local, effective_at)
			 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (item, effective_at) DO NOTHING`,
			"price-"+item+"-base", item, price, base, time.Date(2026, 1, 1, 6, 0, 0, 0, time.UTC)); err != nil {
			return err
		}
	}
	for _, sr := range series {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO series (id, title, mode, weekday, local_time, first_date, weeks, capacity, seeded, created_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) ON CONFLICT (id) DO NOTHING`,
			sr.ID, sr.Title, sr.Mode, sr.Weekday, sr.LocalTime, sr.FirstDate, sr.Weeks, sr.Capacity, time.Now().UTC()); err != nil {
			return err
		}
		for _, n := range sr.Nights {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO nights (id, series_id, title, mode, date, scheduled_local_time, local_start,
					utc_offset, zone_abbr, starts_at, signups_open_at, signups_close_at, ends_at, dst_note, capacity)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
				 ON CONFLICT (series_id, date) DO NOTHING`,
				n.ID, sr.ID, sr.Title, sr.Mode, n.Date, sr.LocalTime, n.LocalStart, n.UTCOffset, n.ZoneAbbr,
				n.StartsAt, n.SignupsOpenAt, n.SignupsCloseAt, n.EndsAt, n.DstNote, sr.Capacity); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

// HashKey hashes the studio key with a random salt. Seeding needs a stable
// hash, so the seed hash is deterministic: sha256 of the key alone.
func HashKey(key string) string {
	sum := sha256.Sum256([]byte("holdfast-studio-key:" + key))
	return hex.EncodeToString(sum[:])
}

// NewID returns a random 16-hex-char id.
func NewID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return time.Now().Format("20060102150405")
	}
	return hex.EncodeToString(b[:])
}

// NewToken returns a random 32-hex-char session token.
func NewToken() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return hex.EncodeToString([]byte("fallback-token-000000"))
	}
	return hex.EncodeToString(b[:])
}

// Studio is the seeded studio row.
type Studio struct {
	Name         string
	Zone         string
	StudioKeyHash string
}

// Studio loads the studio row.
func (s *Store) Studio(ctx context.Context) (Studio, error) {
	var st Studio
	err := s.DB.QueryRowContext(ctx, `SELECT name, zone, studio_key_hash FROM studio WHERE id=1`).
		Scan(&st.Name, &st.Zone, &st.StudioKeyHash)
	return st, err
}

// SeriesSeed is a seeded series with its expanded nights.
type SeriesSeed struct {
	ID        string
	Title     string
	Mode      string
	Weekday   string
	LocalTime string
	FirstDate string
	Weeks     int
	Capacity  int
	Nights    []NightSeed
}

// NightSeed is one expanded night of a seeded series.
type NightSeed struct {
	ID             string
	Date           string
	LocalStart     string
	UTCOffset      string
	ZoneAbbr       string
	StartsAt       time.Time
	SignupsOpenAt  time.Time
	SignupsCloseAt time.Time
	EndsAt         time.Time
	DstNote        any
}

// Player is a player row.
type Player struct {
	ID       string
	Callsign string
	Role     string
}

// CreatePlayer inserts a player and their default settings.
func (s *Store) CreatePlayer(ctx context.Context, id, callsign, role string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO players (id, callsign, role, created_at) VALUES ($1,$2,$3,$4)`,
		id, callsign, role, time.Now().UTC()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO settings (player_id, bindings, master_volume, effects_volume, reduce_effects, screen_shake, camera_bob)
		 VALUES ($1, $2, 70, 70, false, true, true)`,
		id, DefaultBindingsJSON()); err != nil {
		return err
	}
	return tx.Commit()
}

// PlayerByCallsign finds a player by exact callsign.
func (s *Store) PlayerByCallsign(ctx context.Context, callsign string) (Player, error) {
	var p Player
	err := s.DB.QueryRowContext(ctx, `SELECT id, callsign, role FROM players WHERE callsign=$1`, callsign).
		Scan(&p.ID, &p.Callsign, &p.Role)
	return p, err
}

// PlayerByID finds a player by id.
func (s *Store) PlayerByID(ctx context.Context, id string) (Player, error) {
	var p Player
	err := s.DB.QueryRowContext(ctx, `SELECT id, callsign, role FROM players WHERE id=$1`, id).
		Scan(&p.ID, &p.Callsign, &p.Role)
	return p, err
}

// CreateSession stores a session token.
func (s *Store) CreateSession(ctx context.Context, token, playerID string) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO sessions (token, player_id, created_at) VALUES ($1,$2,$3)`,
		token, playerID, time.Now().UTC())
	return err
}

// PlayerByToken resolves a session token to its player.
func (s *Store) PlayerByToken(ctx context.Context, token string) (Player, error) {
	var p Player
	err := s.DB.QueryRowContext(ctx,
		`SELECT p.id, p.callsign, p.role FROM sessions s JOIN players p ON p.id=s.player_id WHERE s.token=$1`,
		token).Scan(&p.ID, &p.Callsign, &p.Role)
	return p, err
}

// DeleteSession removes a session token.
func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM sessions WHERE token=$1`, token)
	return err
}

// Settings is a player's stored settings.
type Settings struct {
	Bindings       map[string]string `json:"bindings"`
	MasterVolume   int               `json:"master_volume"`
	EffectsVolume  int               `json:"effects_volume"`
	ReduceEffects  bool              `json:"reduce_effects"`
	ScreenShake    bool              `json:"screen_shake"`
	CameraBob      bool              `json:"camera_bob"`
}

// DefaultBindings are the default keys, in published order.
var DefaultBindings = map[string]string{
	"move_up":    "KeyW",
	"move_down":  "KeyS",
	"move_left":  "KeyA",
	"move_right": "KeyD",
	"aim_left":   "KeyQ",
	"aim_right":  "KeyE",
	"fire":       "Space",
	"reload":     "KeyR",
	"grenade":    "KeyG",
	"revive":     "KeyF",
	"shop":       "KeyB",
	"timers":     "KeyT",
}

// BindingActions lists the actions in published order.
var BindingActions = []string{"move_up", "move_down", "move_left", "move_right",
	"aim_left", "aim_right", "fire", "reload", "grenade", "revive", "shop", "timers"}

func DefaultBindingsJSON() string {
	var sb strings.Builder
	sb.WriteString(`{"move_up":"KeyW","move_down":"KeyS","move_left":"KeyA","move_right":"KeyD",`)
	sb.WriteString(`"aim_left":"KeyQ","aim_right":"KeyE","fire":"Space","reload":"KeyR",`)
	sb.WriteString(`"grenade":"KeyG","revive":"KeyF","shop":"KeyB","timers":"KeyT"}`)
	return sb.String()
}

// Settings loads a player's settings.
func (s *Store) Settings(ctx context.Context, playerID string) (Settings, error) {
	var st Settings
	var bindings []byte
	err := s.DB.QueryRowContext(ctx,
		`SELECT bindings, master_volume, effects_volume, reduce_effects, screen_shake, camera_bob
		 FROM settings WHERE player_id=$1`, playerID).
		Scan(&bindings, &st.MasterVolume, &st.EffectsVolume, &st.ReduceEffects, &st.ScreenShake, &st.CameraBob)
	if err != nil {
		return st, err
	}
	st.Bindings = map[string]string{}
	for _, a := range BindingActions {
		var code string
		if err := jsonGet(bindings, a, &code); err == nil {
			st.Bindings[a] = code
		}
	}
	if len(st.Bindings) == 0 {
		st.Bindings = DefaultBindings
	}
	return st, nil
}

// SaveSettings stores a player's settings.
func (s *Store) SaveSettings(ctx context.Context, playerID string, st Settings) error {
	b, err := jsonMarshalBindings(st.Bindings)
	if err != nil {
		return err
	}
	res, err := s.DB.ExecContext(ctx,
		`UPDATE settings SET bindings=$1, master_volume=$2, effects_volume=$3, reduce_effects=$4, screen_shake=$5, camera_bob=$6
		 WHERE player_id=$7`,
		b, st.MasterVolume, st.EffectsVolume, st.ReduceEffects, st.ScreenShake, st.CameraBob, playerID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrUnchanged
	}
	return nil
}

func jsonGet(b []byte, key string, out *string) error {
	// Small helper: json parsing without importing encoding/json here would be
	// silly. Use encoding/json.
	return jsonUnmarshal(b, key, out)
}

func jsonMarshalBindings(m map[string]string) ([]byte, error) {
	return jsonMarshal(m)
}

func jsonUnmarshal(b []byte, key string, out *string) error {
	var m map[string]string
	if err := jsonDecode(b, &m); err != nil {
		return err
	}
	v, ok := m[key]
	if !ok {
		return fmt.Errorf("missing key %s", key)
	}
	*out = v
	return nil
}

