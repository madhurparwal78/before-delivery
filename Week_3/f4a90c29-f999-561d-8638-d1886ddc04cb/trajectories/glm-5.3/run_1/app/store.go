package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store wraps Postgres. All product state lives here.
type Store struct {
	pool *pgxpool.Pool
	mu   sync.Mutex
}

func OpenStore(ctx context.Context, url string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 16
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// Ping reports whether Postgres answers.
func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

// Tx runs fn inside a serialisable transaction so the one place each domain
// rule lives also decides it under concurrency.
func (s *Store) Tx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
	}()
	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

// applySchema is idempotent.
func (s *Store) ApplySchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, schemaSQL)
	return err
}

// Person queries ----------------------------------------------------------

type Person struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Email        string  `json:"email"`
	Role         string  `json:"role"`
	Office       string  `json:"-"`
	Zone         string  `json:"zone"`
	City         string  `json:"city"`
	WeekStart    string  `json:"week_start"`
	HideWeekends bool    `json:"hide_weekends"`
	CustomDays   int     `json:"custom_days"`
	SecondZone   *string `json:"second_zone"`
}

const personCols = `p.id, p.name, p.email, p.role, p.office, p.zone,
  coalesce(ps.week_start,'monday'), coalesce(ps.hide_weekends,false), coalesce(ps.custom_days,4),
  ps.second_zone`

func scanPerson(row pgx.Row) (*Person, error) {
	p := &Person{}
	var second *string
	if err := row.Scan(&p.ID, &p.Name, &p.Email, &p.Role, &p.Office, &p.Zone,
		&p.WeekStart, &p.HideWeekends, &p.CustomDays, &second); err != nil {
		return nil, err
	}
	p.SecondZone = second
	if z, ok := zoneByName[p.Zone]; ok {
		p.City = z.City
	}
	return p, nil
}

func (s *Store) PersonByID(ctx context.Context, id string) (*Person, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+personCols+` FROM people p
	  LEFT JOIN person_settings ps ON ps.person_id = p.id WHERE p.id = $1`, id)
	p, err := scanPerson(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return p, err
}

func (s *Store) PersonByEmail(ctx context.Context, email string) (*Person, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+personCols+` FROM people p
	  LEFT JOIN person_settings ps ON ps.person_id = p.id WHERE lower(p.email) = lower($1)`, email)
	p, err := scanPerson(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return p, err
}

func (s *Store) AllPeople(ctx context.Context) ([]*Person, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+personCols+` FROM people p
	  LEFT JOIN person_settings ps ON ps.person_id = p.id ORDER BY p.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Person
	for rows.Next() {
		p, err := scanPerson(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Session ------------------------------------------------------------------

func (s *Store) CreateSession(ctx context.Context, token, personID string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO sessions (token, person_id) VALUES ($1,$2)`, token, personID)
	return err
}

func (s *Store) SessionPerson(ctx context.Context, token string) (*Person, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+personCols+` FROM sessions s
	  JOIN people p ON p.id = s.person_id
	  LEFT JOIN person_settings ps ON ps.person_id = p.id
	  WHERE s.token = $1`, token)
	p, err := scanPerson(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return p, err
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token = $1`, token)
	return err
}

// Calendars ----------------------------------------------------------------

type Calendar struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	OwnerID          *string `json:"owner_id"`
	Colour           string  `json:"colour"`
	ReadOnly         bool    `json:"-"`
	DefaultReminders []int   `json:"default_reminders"`
	Level            string  `json:"level"`
}

func scanCalendar(row pgx.Row) (*Calendar, error) {
	c := &Calendar{}
	if err := row.Scan(&c.ID, &c.Name, &c.OwnerID, &c.Colour, &c.ReadOnly); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) CalendarByID(ctx context.Context, id string) (*Calendar, error) {
	row := s.pool.QueryRow(ctx, `SELECT id, name, owner_id, colour, readonly FROM calendars WHERE id = $1`, id)
	c, err := scanCalendar(row)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return c, err
}

func (s *Store) CalendarDefaultReminders(ctx context.Context, id string) ([]int, error) {
	rows, err := s.pool.Query(ctx, `SELECT minutes FROM calendar_default_reminders WHERE calendar_id = $1 ORDER BY minutes`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var m int
		if err := rows.Scan(&m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) SetCalendarDefaultReminders(ctx context.Context, tx pgx.Tx, id string, minutes []int) error {
	if _, err := tx.Exec(ctx, `DELETE FROM calendar_default_reminders WHERE calendar_id = $1`, id); err != nil {
		return err
	}
	for _, m := range minutes {
		if _, err := tx.Exec(ctx, `INSERT INTO calendar_default_reminders (calendar_id, minutes) VALUES ($1,$2)`, id, m); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) AllCalendars(ctx context.Context) ([]*Calendar, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, owner_id, colour, readonly FROM calendars ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Calendar
	for rows.Next() {
		c, err := scanCalendar(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Shares -------------------------------------------------------------------

type Share struct {
	CalendarID string `json:"calendar_id"`
	PersonID   string `json:"person_id"`
	Name       string `json:"name"`
	Level      string `json:"level"`
}

func (s *Store) SharesOf(ctx context.Context, calendarID string) ([]*Share, error) {
	rows, err := s.pool.Query(ctx, `SELECT sh.calendar_id, sh.person_id, p.name, sh.level
	  FROM shares sh JOIN people p ON p.id = sh.person_id WHERE sh.calendar_id = $1 ORDER BY p.name`, calendarID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Share
	for rows.Next() {
		sh := &Share{}
		if err := rows.Scan(&sh.CalendarID, &sh.PersonID, &sh.Name, &sh.Level); err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) ShareLevel(ctx context.Context, calendarID, personID string) (string, error) {
	var level string
	err := s.pool.QueryRow(ctx, `SELECT level FROM shares WHERE calendar_id = $1 AND person_id = $2`, calendarID, personID).Scan(&level)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return level, err
}

// Office hours and guest defaults ------------------------------------------

type OfficeHours struct {
	Zone  string `json:"zone"`
	Open  string `json:"open"`
	Close string `json:"close"`
	Days  []int  `json:"days"`
}

func (s *Store) OfficeHoursAll(ctx context.Context) (map[string]OfficeHours, error) {
	rows, err := s.pool.Query(ctx, `SELECT zone, open, close, days FROM office_hours`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]OfficeHours{}
	for rows.Next() {
		var o OfficeHours
		if err := rows.Scan(&o.Zone, &o.Open, &o.Close, &o.Days); err != nil {
			return nil, err
		}
		out[o.Zone] = o
	}
	return out, rows.Err()
}

type GuestDefaults struct {
	ModifyEvent  bool `json:"modify_event"`
	InviteOthers bool `json:"invite_others"`
	SeeGuestList bool `json:"see_guest_list"`
}

func (s *Store) GuestDefaults(ctx context.Context) (GuestDefaults, error) {
	var g GuestDefaults
	err := s.pool.QueryRow(ctx, `SELECT modify_event, invite_others, see_guest_list FROM guest_defaults WHERE id = 1`).Scan(&g.ModifyEvent, &g.InviteOthers, &g.SeeGuestList)
	if err != nil {
		return g, err
	}
	return g, nil
}

// Zone rules ---------------------------------------------------------------

type ZoneRule struct {
	ID            string `json:"id"`
	Zone          string `json:"zone"`
	City          string `json:"city"`
	EffectiveDate string `json:"effective_date"`
	NewOffset     string `json:"new_offset"`
	Note          string `json:"note"`
	RecordedBy    string `json:"recorded_by"`
	OffsetMinutes int    `json:"-"`
}

func (s *Store) ZoneRules(ctx context.Context) ([]*ZoneRule, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, zone, effective_date, new_offset_minutes, note, recorded_by FROM zone_rules ORDER BY effective_date, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ZoneRule
	for rows.Next() {
		r := &ZoneRule{}
		var om int
		if err := rows.Scan(&r.ID, &r.Zone, &r.EffectiveDate, &om, &r.Note, &r.RecordedBy); err != nil {
			return nil, err
		}
		r.OffsetMinutes = om
		r.NewOffset = FormatOffset(om)
		if z, ok := zoneByName[r.Zone]; ok {
			r.City = z.City
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) ZoneRuleByID(ctx context.Context, id string) (*ZoneRule, error) {
	row := s.pool.QueryRow(ctx, `SELECT id, zone, effective_date, new_offset_minutes, note, recorded_by FROM zone_rules WHERE id = $1`, id)
	r := &ZoneRule{}
	var om int
	if err := row.Scan(&r.ID, &r.Zone, &r.EffectiveDate, &om, &r.Note, &r.RecordedBy); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	r.OffsetMinutes = om
	r.NewOffset = FormatOffset(om)
	if z, ok := zoneByName[r.Zone]; ok {
		r.City = z.City
	}
	return r, nil
}

// Trash --------------------------------------------------------------------

type TrashItem struct {
	ID           string    `json:"id"`
	Kind         string    `json:"kind"`
	Title        string    `json:"title"`
	EventID      string    `json:"event_id"`
	OccurrenceID *string   `json:"occurrence_id"`
	TrashedAt    time.Time `json:"trashed_at"`
	PurgeAt      time.Time `json:"purge_at"`
	DaysLeft     int       `json:"days_left"`
}

// Change log ---------------------------------------------------------------

type ChangeRow struct {
	Seq        int64   `json:"seq"`
	Type       string  `json:"type"`
	Data       []byte  `json:"-"`
	DecisionID *string `json:"-"`
}

func (s *Store) ChangesAfter(ctx context.Context, seq int64, limit int) ([]*ChangeRow, error) {
	rows, err := s.pool.Query(ctx, `SELECT seq, type, data, decision_id FROM change_log
	  WHERE seq > $1 ORDER BY seq LIMIT $2`, seq, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ChangeRow
	for rows.Next() {
		c := &ChangeRow{}
		var dec *string
		if err := rows.Scan(&c.Seq, &c.Type, &c.Data, &dec); err != nil {
			return nil, err
		}
		c.DecisionID = dec
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) MaxSeq(ctx context.Context) (int64, error) {
	var seq int64
	err := s.pool.QueryRow(ctx, `SELECT coalesce(max(seq),0) FROM change_log`).Scan(&seq)
	return seq, err
}

func (s *Store) AppendChange(ctx context.Context, tx pgx.Tx, typ string, personIDs []string, data any, decisionID *string) (int64, error) {
	b, err := marshalJSON(data)
	if err != nil {
		return 0, err
	}
	var seq int64
	err = tx.QueryRow(ctx, `INSERT INTO change_log (type, person_ids, data, decision_id) VALUES ($1,$2,$3,$4) RETURNING seq`,
		typ, personIDs, b, decisionID).Scan(&seq)
	return seq, err
}

func (s *Store) AppendChangePool(ctx context.Context, typ string, personIDs []string, data any, decisionID *string) (int64, error) {
	b, err := marshalJSON(data)
	if err != nil {
		return 0, err
	}
	var seq int64
	err = s.pool.QueryRow(ctx, `INSERT INTO change_log (type, person_ids, data, decision_id) VALUES ($1,$2,$3,$4) RETURNING seq`,
		typ, personIDs, b, decisionID).Scan(&seq)
	return seq, err
}

// Notices ------------------------------------------------------------------

type Notice struct {
	ID        int64     `json:"id"`
	Kind      string    `json:"kind"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Store) NoticesFor(ctx context.Context, personID string) ([]*Notice, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, kind, text, created_at FROM notices WHERE person_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, personID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Notice
	for rows.Next() {
		n := &Notice{}
		if err := rows.Scan(&n.ID, &n.Kind, &n.Text, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Store) InsertNotice(ctx context.Context, tx pgx.Tx, personID, kind, text string, decisionID *string) error {
	_, err := tx.Exec(ctx, `INSERT INTO notices (person_id, kind, text, decision_id) VALUES ($1,$2,$3,$4)`, personID, kind, text, decisionID)
	return err
}

func (s *Store) InsertNoticePool(ctx context.Context, personID, kind, text string, decisionID *string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO notices (person_id, kind, text, decision_id) VALUES ($1,$2,$3,$4)`, personID, kind, text, decisionID)
	return err
}

// Drafts -------------------------------------------------------------------

func (s *Store) GetDraft(ctx context.Context, personID string) (map[string]any, error) {
	var data []byte
	err := s.pool.QueryRow(ctx, `SELECT data FROM drafts WHERE person_id = $1`, personID).Scan(&data)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := unmarshalJSON(data, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func (s *Store) PutDraft(ctx context.Context, personID string, data map[string]any) error {
	b, err := marshalJSON(data)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO drafts (person_id, data, updated_at) VALUES ($1,$2,now())
	  ON CONFLICT (person_id) DO UPDATE SET data = excluded.data, updated_at = now()`, personID, b)
	return err
}

func (s *Store) DeleteDraft(ctx context.Context, personID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM drafts WHERE person_id = $1`, personID)
	return err
}

// Idempotency --------------------------------------------------------------

func (s *Store) IdempotentBody(ctx context.Context, personID, key string) (int, string, bool, error) {
	var status int
	var body string
	err := s.pool.QueryRow(ctx, `SELECT status, body FROM idempotency WHERE person_id = $1 AND key = $2`, personID, key).Scan(&status, &body)
	if err == pgx.ErrNoRows {
		return 0, "", false, nil
	}
	if err != nil {
		return 0, "", false, err
	}
	return status, body, true, nil
}

func (s *Store) IdempotentReplay(ctx context.Context, personID, key string) (int, []byte, bool, error) {
	var status int
	var body []byte
	err := s.pool.QueryRow(ctx, `SELECT status, response FROM idempotency WHERE person_id = $1 AND key = $2`, personID, key).Scan(&status, &body)
	if err == pgx.ErrNoRows {
		return 0, nil, false, nil
	}
	if err != nil {
		return 0, nil, false, err
	}
	return status, body, true, nil
}

func (s *Store) SaveIdempotent(ctx context.Context, personID, key, bodyHash string, status int, response []byte) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO idempotency (person_id, key, body, status, response) VALUES ($1,$2,$3,$4,$5)
	  ON CONFLICT (person_id, key) DO NOTHING`, personID, key, bodyHash, status, response)
	return err
}

func (s *Store) TxSaveIdempotent(ctx context.Context, tx pgx.Tx, personID, key, bodyHash string, status int, response []byte) error {
	_, err := tx.Exec(ctx, `INSERT INTO idempotency (person_id, key, body, status, response) VALUES ($1,$2,$3,$4,$5)
	  ON CONFLICT (person_id, key) DO NOTHING`, personID, key, bodyHash, status, response)
	return err
}

func marshalJSON(v any) ([]byte, error) {
	b, err := jsonMarshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}
	return b, nil
}

func unmarshalJSON(b []byte, v any) error { return jsonUnmarshal(b, v) }

var _ = time.Second
