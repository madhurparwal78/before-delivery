package store

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
)

// TrashItem is one trashed event, series or occurrence.
type TrashItem struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	EventID    string `json:"event_id"`
	Occurrence string `json:"occurrence_id"`
	TrashedAt  string `json:"trashed_at"`
	PurgeAt    string `json:"purge_at"`
	DaysLeft   int    `json:"days_left"`

	CalendarID string `json:"-"`
	Key        string `json:"-"`
	State      string `json:"-"`
}

const trashColumns = `id, kind, event_id, occurrence_key, title, calendar_id, trashed_at, purge_at, state`

func scanTrash(rows pgx.Rows, now time.Time) (TrashItem, error) {
	var t TrashItem
	var trashedAt, purgeAt time.Time
	err := rows.Scan(&t.ID, &t.Kind, &t.EventID, &t.Key, &t.Title, &t.CalendarID, &trashedAt, &purgeAt, &t.State)
	if err != nil {
		return t, err
	}
	t.TrashedAt = trashedAt.UTC().Format(time.RFC3339)
	t.PurgeAt = purgeAt.UTC().Format(time.RFC3339)
	t.DaysLeft = int(math.Ceil(purgeAt.Sub(now).Hours() / 24))
	if t.DaysLeft < 0 {
		t.DaysLeft = 0
	}
	t.Occurrence = t.EventID
	if t.Key != "" {
		t.Occurrence = t.EventID + "@" + t.Key
	}
	return t, nil
}

func (s *Store) InsertTrashItem(ctx context.Context, t TrashItem, trashedAt, purgeAt time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO trash_items (`+trashColumns+`)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'trashed')`,
		t.ID, t.Kind, t.EventID, t.Key, t.Title, t.CalendarID, trashedAt, purgeAt)
	return err
}

func (s *Store) TrashItems(ctx context.Context, now time.Time) ([]TrashItem, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+trashColumns+` FROM trash_items WHERE state='trashed' ORDER BY trashed_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrashItem{}
	for rows.Next() {
		t, err := scanTrash(rows, now)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) TrashItem(ctx context.Context, id string, now time.Time) (TrashItem, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+trashColumns+` FROM trash_items WHERE id=$1`, id)
	if err != nil {
		return TrashItem{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return TrashItem{}, ErrNotFound
	}
	return scanTrash(rows, now)
}

// TrashItemFor finds the live trash item covering an event or one occurrence.
func (s *Store) TrashItemFor(ctx context.Context, eventID, key string, now time.Time) (TrashItem, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+trashColumns+` FROM trash_items
		WHERE event_id=$1 AND occurrence_key=$2 AND state='trashed' ORDER BY trashed_at DESC LIMIT 1`, eventID, key)
	if err != nil {
		return TrashItem{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return TrashItem{}, ErrNotFound
	}
	return scanTrash(rows, now)
}

func (s *Store) SetTrashState(ctx context.Context, id, state string) error {
	_, err := s.pool.Exec(ctx, `UPDATE trash_items SET state=$2 WHERE id=$1`, id, state)
	return err
}

func (s *Store) DuePurges(ctx context.Context, now time.Time) ([]TrashItem, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+trashColumns+` FROM trash_items WHERE state='trashed' AND purge_at <= $1`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TrashItem
	for rows.Next() {
		t, err := scanTrash(rows, now)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// PurgeEvent removes an event's data from every surface it reached.
func (s *Store) PurgeEvent(ctx context.Context, eventID string) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM notices WHERE event_id=$1`, eventID); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM change_log WHERE event_id=$1`, eventID); err != nil {
		return err
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM trash_items WHERE event_id=$1`, eventID); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM events WHERE id=$1`, eventID)
	return err
}

// Reminder is one person's reminder for one occurrence.
type Reminder struct {
	ID         string  `json:"id"`
	Occurrence string  `json:"occurrence_id"`
	Title      string  `json:"title"`
	Minutes    int     `json:"minutes"`
	DueUTC     string  `json:"due_utc"`
	Status     string  `json:"status"`
	FiredAt    *string `json:"fired_at"`

	EventID  string    `json:"-"`
	Key      string    `json:"-"`
	PersonID string    `json:"-"`
	AllDay   bool      `json:"-"`
	Due      time.Time `json:"-"`
}

const reminderColumns = `r.id, r.event_id, r.occurrence_key, r.person_id, r.minutes, r.all_day, r.due_utc, r.status, r.fired_at`

func scanReminder(rows pgx.Rows) (Reminder, error) {
	var r Reminder
	var firedAt *time.Time
	var title, rrule string
	err := rows.Scan(&r.ID, &r.EventID, &r.Key, &r.PersonID, &r.Minutes, &r.AllDay, &r.Due, &r.Status, &firedAt, &title, &rrule)
	if err != nil {
		return r, err
	}
	r.Title = title
	r.DueUTC = r.Due.UTC().Format(time.RFC3339)
	if firedAt != nil {
		s := firedAt.UTC().Format(time.RFC3339)
		r.FiredAt = &s
	}
	// A single event uses its event id as its occurrence id.
	r.Occurrence = r.EventID
	if rrule != "" && r.Key != "" {
		r.Occurrence = r.EventID + "@" + r.Key
	}
	return r, nil
}

const reminderFrom = ` FROM reminders r JOIN events e ON e.id = r.event_id`

// reminderSelect reads a reminder with the event title and rule it belongs to.
const reminderSelect = `SELECT ` + reminderColumns + `, e.title, e.rrule` + reminderFrom

func (s *Store) Reminders(ctx context.Context, personID string, from, to time.Time) ([]Reminder, error) {
	rows, err := s.pool.Query(ctx, reminderSelect+`
		WHERE r.person_id=$1 AND r.due_utc >= $2 AND r.due_utc < $3 AND r.status <> 'cancelled'
		ORDER BY r.due_utc`, personID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Reminder{}
	for rows.Next() {
		r, err := scanReminder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) Reminder(ctx context.Context, id string) (Reminder, error) {
	rows, err := s.pool.Query(ctx, reminderSelect+` WHERE r.id=$1`, id)
	if err != nil {
		return Reminder{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return Reminder{}, ErrNotFound
	}
	return scanReminder(rows)
}

// RemindersForEvent lists every reminder of an event, whatever its state.
func (s *Store) RemindersForEvent(ctx context.Context, eventID string) ([]Reminder, error) {
	rows, err := s.pool.Query(ctx, reminderSelect+` WHERE r.event_id=$1`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reminder
	for rows.Next() {
		r, err := scanReminder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) DeleteReminder(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM reminders WHERE id=$1`, id)
	return err
}

func (s *Store) SetReminderDue(ctx context.Context, id string, due time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE reminders SET due_utc=$2, status='scheduled', fired_at=NULL WHERE id=$1`, id, due)
	return err
}

func (s *Store) DueReminders(ctx context.Context, now time.Time) ([]Reminder, error) {
	rows, err := s.pool.Query(ctx, reminderSelect+`
		WHERE r.status IN ('scheduled','snoozed') AND r.due_utc <= $1 ORDER BY r.due_utc`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Reminder
	for rows.Next() {
		r, err := scanReminder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) InsertReminder(ctx context.Context, r Reminder) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO reminders (id, event_id, occurrence_key, person_id, minutes, all_day, due_utc, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')`, r.ID, r.EventID, r.Key, r.PersonID, r.Minutes, r.AllDay, r.Due)
	return err
}

// FireReminder marks a reminder fired only once, so it never fires twice.
func (s *Store) FireReminder(ctx context.Context, id string, now time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE reminders SET status='fired', fired_at=$2
		WHERE id=$1 AND status IN ('scheduled','snoozed')`, id, now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *Store) SnoozeReminder(ctx context.Context, id string, due time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE reminders SET status='snoozed', due_utc=$2 WHERE id=$1`, id, due)
	return err
}

func (s *Store) CancelReminders(ctx context.Context, eventID string, key *string, personID *string) error {
	_, err := s.pool.Exec(ctx, `UPDATE reminders SET status='cancelled'
		WHERE event_id=$1 AND ($2::text IS NULL OR occurrence_key=$2) AND ($3::text IS NULL OR person_id=$3)
		  AND status IN ('scheduled','snoozed')`, eventID, key, personID)
	return err
}

func (s *Store) RestoreReminders(ctx context.Context, eventID string, now time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE reminders SET status='scheduled'
		WHERE event_id=$1 AND status='cancelled' AND due_utc > $2`, eventID, now)
	return err
}

// Notice is one in-app notice.
type Notice struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Text      string `json:"text"`
	CreatedAt string `json:"created_at"`
}

func (s *Store) InsertNotice(ctx context.Context, id, personID, kind, text, eventID, decisionID string, now time.Time) error {
	var event, decision *string
	if eventID != "" {
		event = &eventID
	}
	if decisionID != "" {
		decision = &decisionID
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO notices (id, person_id, kind, text, event_id, decision_id, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, personID, kind, text, event, decision, now)
	return err
}

func (s *Store) Notices(ctx context.Context, personID string) ([]Notice, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, kind, text, created_at FROM notices
		WHERE person_id=$1 ORDER BY created_at DESC, id DESC LIMIT 200`, personID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Notice{}
	for rows.Next() {
		var n Notice
		var created time.Time
		if err := rows.Scan(&n.ID, &n.Kind, &n.Text, &created); err != nil {
			return nil, err
		}
		n.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, n)
	}
	return out, rows.Err()
}

// Print is one printed week job.
type Print struct {
	ID        string   `json:"id"`
	WeekStart string   `json:"week_start"`
	Calendars []string `json:"calendars"`
	Status    string   `json:"status"`
	WaitingOn *string  `json:"waiting_on"`
	ObjectKey string   `json:"object_key"`
	SizeBytes *int64   `json:"size_bytes"`
	CreatedAt string   `json:"created_at"`
	StoredAt  *string  `json:"stored_at"`

	PersonID string `json:"-"`
	BodyHash string `json:"-"`
}

const printColumns = `id, person_id, week_start, calendars, status, waiting_on, object_key, size_bytes, created_at, stored_at, body_hash`

func scanPrint(rows pgx.Rows) (Print, error) {
	var p Print
	var created time.Time
	var stored *time.Time
	err := rows.Scan(&p.ID, &p.PersonID, &p.WeekStart, &p.Calendars, &p.Status, &p.WaitingOn,
		&p.ObjectKey, &p.SizeBytes, &created, &stored, &p.BodyHash)
	if err != nil {
		return p, err
	}
	p.CreatedAt = created.UTC().Format(time.RFC3339)
	if stored != nil {
		v := stored.UTC().Format(time.RFC3339)
		p.StoredAt = &v
	}
	if p.Calendars == nil {
		p.Calendars = []string{}
	}
	return p, nil
}

func (s *Store) InsertPrint(ctx context.Context, p Print, idempotencyKey string, now time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO prints
		(id, person_id, week_start, calendars, status, waiting_on, object_key, created_at, idempotency_key, body_hash)
		VALUES ($1,$2,$3,$4,'pending',NULL,$5,$6,$7,$8)`,
		p.ID, p.PersonID, p.WeekStart, p.Calendars, p.ObjectKey, now, idempotencyKey, p.BodyHash)
	return err
}

func (s *Store) PrintByIdempotency(ctx context.Context, personID, key string) (Print, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+printColumns+` FROM prints WHERE person_id=$1 AND idempotency_key=$2`, personID, key)
	if err != nil {
		return Print{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return Print{}, ErrNotFound
	}
	return scanPrint(rows)
}

func (s *Store) Print(ctx context.Context, id string) (Print, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+printColumns+` FROM prints WHERE id=$1`, id)
	if err != nil {
		return Print{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return Print{}, ErrNotFound
	}
	return scanPrint(rows)
}

func (s *Store) Prints(ctx context.Context, personID string) ([]Print, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+printColumns+` FROM prints WHERE person_id=$1 ORDER BY created_at DESC`, personID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Print{}
	for rows.Next() {
		p, err := scanPrint(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) SetPrintState(ctx context.Context, id, status string, waitingOn *string, size *int64, storedAt *time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE prints SET status=$2, waiting_on=$3, size_bytes=$4, stored_at=$5 WHERE id=$1`,
		id, status, waitingOn, size, storedAt)
	return err
}

func (s *Store) InsertICSFile(ctx context.Context, id, kind, calendarID, objectKey string, size int64, now time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO ics_files (id, kind, calendar_id, object_key, size_bytes, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, kind, calendarID, objectKey, size, now)
	return err
}

func (s *Store) ICSFile(ctx context.Context, id string) (string, string, error) {
	var key, calendarID string
	err := s.pool.QueryRow(ctx, `SELECT object_key, calendar_id FROM ics_files WHERE id=$1`, id).Scan(&key, &calendarID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return key, calendarID, err
}

func (s *Store) ImportedEventID(ctx context.Context, calendarID, uid string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT event_id FROM imported_uids WHERE calendar_id=$1 AND uid=$2`, calendarID, uid).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

func (s *Store) RememberImportedUID(ctx context.Context, calendarID, uid, eventID string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO imported_uids (calendar_id, uid, event_id) VALUES ($1,$2,$3)
		ON CONFLICT (calendar_id, uid) DO UPDATE SET event_id=$3`, calendarID, uid, eventID)
	return err
}

// Change is one row of the replayable change log.
type Change struct {
	Seq        int64           `json:"seq"`
	Type       string          `json:"type"`
	EventID    string          `json:"-"`
	CalendarID string          `json:"-"`
	PersonID   string          `json:"-"`
	DecisionID string          `json:"-"`
	Payload    json.RawMessage `json:"data"`
}

// AppendChange writes one change-log row and gives back its sequence number.
func (s *Store) AppendChange(ctx context.Context, c Change, now time.Time) (int64, error) {
	var seq int64
	err := s.pool.QueryRow(ctx, `INSERT INTO change_log (type, event_id, calendar_id, person_id, decision_id, payload, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING seq`,
		c.Type, nullable(c.EventID), nullable(c.CalendarID), nullable(c.PersonID), nullable(c.DecisionID), c.Payload, now).Scan(&seq)
	return seq, err
}

func (s *Store) ChangesAfter(ctx context.Context, after int64) ([]Change, error) {
	rows, err := s.pool.Query(ctx, `SELECT seq, type, coalesce(event_id,''), coalesce(calendar_id,''),
		coalesce(person_id,''), coalesce(decision_id,''), payload FROM change_log WHERE seq > $1 ORDER BY seq`, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Change
	for rows.Next() {
		var c Change
		if err := rows.Scan(&c.Seq, &c.Type, &c.EventID, &c.CalendarID, &c.PersonID, &c.DecisionID, &c.Payload); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) LatestSeq(ctx context.Context) (int64, error) {
	var seq *int64
	if err := s.pool.QueryRow(ctx, `SELECT max(seq) FROM change_log`).Scan(&seq); err != nil {
		return 0, err
	}
	if seq == nil {
		return 0, nil
	}
	return *seq, nil
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
