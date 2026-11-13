package store

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"sundialwren/internal/domain"
)

// ErrNotFound is returned when a record does not exist.
var ErrNotFound = errors.New("not found")

const personColumns = `id, name, email, zone, role, week_start, hide_weekends, custom_days, second_zone`

func scanPerson(row pgx.Row) (domain.Person, error) {
	var p domain.Person
	err := row.Scan(&p.ID, &p.Name, &p.Email, &p.Zone, &p.Role, &p.WeekStart, &p.HideWeekends, &p.CustomDays, &p.SecondZone)
	p.City = domain.ZoneCity(p.Zone)
	return p, err
}

func (s *Store) PersonByCredentials(ctx context.Context, email, passcode string) (domain.Person, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+personColumns+` FROM people WHERE email = $1 AND passcode = $2`, email, passcode)
	p, err := scanPerson(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func (s *Store) Person(ctx context.Context, id string) (domain.Person, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+personColumns+` FROM people WHERE id = $1`, id)
	p, err := scanPerson(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func (s *Store) People(ctx context.Context) ([]domain.Person, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+personColumns+` FROM people ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Person
	for rows.Next() {
		p, err := scanPerson(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// UpdatePerson writes a person's own view settings.
func (s *Store) UpdatePerson(ctx context.Context, p domain.Person) error {
	_, err := s.pool.Exec(ctx, `UPDATE people SET zone=$2, week_start=$3, hide_weekends=$4, custom_days=$5, second_zone=$6
		WHERE id=$1`, p.ID, p.Zone, p.WeekStart, p.HideWeekends, p.CustomDays, p.SecondZone)
	return err
}

func NewToken() string {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func (s *Store) CreateSession(ctx context.Context, personID string, now time.Time) (string, error) {
	token := NewToken()
	_, err := s.pool.Exec(ctx, `INSERT INTO sessions (token, person_id, created_at) VALUES ($1,$2,$3)`, token, personID, now)
	return token, err
}

func (s *Store) SessionPerson(ctx context.Context, token string) (domain.Person, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+prefixed(personColumns, "p")+`
		FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = $1`, token)
	p, err := scanPerson(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func (s *Store) DeleteSession(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token = $1`, token)
	return err
}

func prefixed(columns, alias string) string {
	out := ""
	for i, c := range splitColumns(columns) {
		if i > 0 {
			out += ", "
		}
		out += alias + "." + c
	}
	return out
}

func splitColumns(columns string) []string {
	var out []string
	cur := ""
	for _, r := range columns {
		switch r {
		case ',':
			out = append(out, trim(cur))
			cur = ""
		default:
			cur += string(r)
		}
	}
	if trim(cur) != "" {
		out = append(out, trim(cur))
	}
	return out
}

func trim(s string) string { return domain.TrimSpace(s) }

// Calendars lists every calendar a person can read, with the level they read
// it at.
func (s *Store) Calendars(ctx context.Context, personID string) ([]domain.Calendar, error) {
	rows, err := s.pool.Query(ctx, `SELECT c.id, c.name, c.owner_id, c.colour, c.default_reminders, c.read_only, s.level
		FROM calendars c LEFT JOIN shares s ON s.calendar_id = c.id AND s.person_id = $1
		ORDER BY c.name`, personID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Calendar
	for rows.Next() {
		var c domain.Calendar
		var readOnly bool
		var level *string
		if err := rows.Scan(&c.ID, &c.Name, &c.OwnerID, &c.Colour, &c.DefaultReminders, &readOnly, &level); err != nil {
			return nil, err
		}
		c.Level = calendarLevel(c, readOnly, level, personID)
		if c.Level == "" {
			continue
		}
		if c.DefaultReminders == nil {
			c.DefaultReminders = []int{}
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func calendarLevel(c domain.Calendar, readOnly bool, share *string, personID string) string {
	if readOnly {
		return domain.LevelReadOnly
	}
	if c.OwnerID != nil && *c.OwnerID == personID {
		return domain.LevelOwner
	}
	if share != nil {
		return *share
	}
	return ""
}

// Levels gives a person's share level for every calendar they can read.
func (s *Store) Levels(ctx context.Context, personID string) (map[string]string, error) {
	cals, err := s.Calendars(ctx, personID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(cals))
	for _, c := range cals {
		out[c.ID] = c.Level
	}
	return out, nil
}

func (s *Store) Calendar(ctx context.Context, id string) (domain.Calendar, error) {
	row := s.pool.QueryRow(ctx, `SELECT id, name, owner_id, colour, default_reminders FROM calendars WHERE id = $1`, id)
	var c domain.Calendar
	err := row.Scan(&c.ID, &c.Name, &c.OwnerID, &c.Colour, &c.DefaultReminders)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

func (s *Store) SetDefaultReminders(ctx context.Context, calendarID string, minutes []int) error {
	_, err := s.pool.Exec(ctx, `UPDATE calendars SET default_reminders = $2 WHERE id = $1`, calendarID, minutes)
	return err
}

type Share struct {
	PersonID string `json:"person_id"`
	Name     string `json:"name"`
	Level    string `json:"level"`
}

func (s *Store) Shares(ctx context.Context, calendarID string) ([]Share, error) {
	rows, err := s.pool.Query(ctx, `SELECT s.person_id, p.name, s.level FROM shares s
		JOIN people p ON p.id = s.person_id WHERE s.calendar_id = $1 ORDER BY p.name`, calendarID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Share{}
	for rows.Next() {
		var sh Share
		if err := rows.Scan(&sh.PersonID, &sh.Name, &sh.Level); err != nil {
			return nil, err
		}
		out = append(out, sh)
	}
	return out, rows.Err()
}

func (s *Store) PutShare(ctx context.Context, calendarID, personID, level string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO shares (calendar_id, person_id, level) VALUES ($1,$2,$3)
		ON CONFLICT (calendar_id, person_id) DO UPDATE SET level = $3`, calendarID, personID, level)
	return err
}

func (s *Store) DeleteShare(ctx context.Context, calendarID, personID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM shares WHERE calendar_id=$1 AND person_id=$2`, calendarID, personID)
	return err
}

func (s *Store) Settings(ctx context.Context) (domain.Settings, error) {
	var defaults, hours []byte
	err := s.pool.QueryRow(ctx, `SELECT guest_defaults, office_hours FROM firm_settings WHERE id = 1`).Scan(&defaults, &hours)
	var out domain.Settings
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(defaults, &out.GuestDefaults); err != nil {
		return out, err
	}
	return out, json.Unmarshal(hours, &out.OfficeHours)
}

func (s *Store) SaveSettings(ctx context.Context, set domain.Settings) error {
	defaults, err := json.Marshal(set.GuestDefaults)
	if err != nil {
		return err
	}
	hours, err := json.Marshal(set.OfficeHours)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `UPDATE firm_settings SET guest_defaults=$1, office_hours=$2 WHERE id = 1`, defaults, hours)
	return err
}

func (s *Store) ZoneRules(ctx context.Context) (domain.ZoneRules, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, zone, effective_date, new_offset, note, recorded_by
		FROM zone_rules ORDER BY zone, effective_date`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := domain.ZoneRules{}
	for rows.Next() {
		var r domain.ZoneRule
		if err := rows.Scan(&r.ID, &r.Zone, &r.EffectiveDate, &r.NewOffset, &r.Note, &r.RecordedBy); err != nil {
			return nil, err
		}
		r.City = domain.ZoneCity(r.Zone)
		r.OffsetMinutes, _ = domain.ParseOffset(r.NewOffset)
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) InsertZoneRule(ctx context.Context, r domain.ZoneRule, now time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO zone_rules (id, zone, effective_date, new_offset, note, recorded_by, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, r.ID, r.Zone, r.EffectiveDate, r.NewOffset, r.Note, r.RecordedBy, now)
	return err
}

func (s *Store) ZoneRuleExists(ctx context.Context, zone, date string) (bool, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM zone_rules WHERE zone=$1 AND effective_date=$2`, zone, date).Scan(&n)
	return n > 0, err
}

func (s *Store) Draft(ctx context.Context, personID string) ([]byte, error) {
	var data []byte
	err := s.pool.QueryRow(ctx, `SELECT data FROM drafts WHERE person_id=$1`, personID).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return data, err
}

func (s *Store) SaveDraft(ctx context.Context, personID string, data []byte, now time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO drafts (person_id, data, saved_at) VALUES ($1,$2,$3)
		ON CONFLICT (person_id) DO UPDATE SET data=$2, saved_at=$3`, personID, data, now)
	return err
}

func (s *Store) DeleteDraft(ctx context.Context, personID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM drafts WHERE person_id=$1`, personID)
	return err
}
