package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"sundialwren/internal/domain"
)

const eventColumns = `e.id, e.calendar_id, e.series_id, e.split_from, e.organiser_id, coalesce(o.name,''),
	e.title, e.location, e.notes, e.kind, e.colour, e.reminders, e.all_day, e.start_local, e.end_local,
	e.zone, e.visibility, e.rrule, e.series_until, e.decline_mode, e.decline_message, e.switches,
	e.version, e.saved_at, coalesce(sb.name,''), e.trashed_at`

const eventFrom = ` FROM events e LEFT JOIN people o ON o.id = e.organiser_id LEFT JOIN people sb ON sb.id = e.saved_by`

func scanEvent(rows pgx.Rows) (*domain.Event, error) {
	var e domain.Event
	var organiser *string
	var switches []byte
	err := rows.Scan(&e.ID, &e.CalendarID, &e.SeriesID, &e.SplitFrom, &organiser, &e.OrganiserName,
		&e.Title, &e.Location, &e.Notes, &e.Kind, &e.Colour, &e.Reminders, &e.AllDay, &e.StartLocal, &e.EndLocal,
		&e.Zone, &e.Visibility, &e.RRule, &e.SeriesUntil, &e.DeclineMode, &e.DeclineMessage, &switches,
		&e.Version, &e.SavedAt, &e.SavedByName, &e.TrashedAt)
	if err != nil {
		return nil, err
	}
	if organiser != nil {
		e.OrganiserID = *organiser
	}
	if err := json.Unmarshal(switches, &e.Switches); err != nil {
		return nil, err
	}
	if e.Reminders == nil {
		e.Reminders = []int{}
	}
	return &e, nil
}

// Event loads one event with every relation, trashed or live.
func (s *Store) Event(ctx context.Context, id string) (*domain.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+eventColumns+eventFrom+` WHERE e.id = $1`, id)
	if err != nil {
		return nil, err
	}
	events, err := collectEvents(rows)
	if err != nil {
		return nil, err
	}
	if len(events) == 0 {
		return nil, ErrNotFound
	}
	if err := s.loadRelations(ctx, events); err != nil {
		return nil, err
	}
	return events[0], nil
}

// LiveEvents loads every untrashed event on the named calendars, together with
// every untrashed event the person is a guest of.
func (s *Store) LiveEvents(ctx context.Context, calendarIDs []string, personID string) ([]*domain.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+eventColumns+eventFrom+`
		WHERE e.trashed_at IS NULL AND (e.calendar_id = ANY($1)
			OR EXISTS (SELECT 1 FROM guests g WHERE g.event_id = e.id AND g.person_id = $2))
		ORDER BY e.start_local`, calendarIDs, personID)
	if err != nil {
		return nil, err
	}
	events, err := collectEvents(rows)
	if err != nil {
		return nil, err
	}
	if err := s.loadRelations(ctx, events); err != nil {
		return nil, err
	}
	return events, nil
}

// EventsInSeries loads every event of one series, splits included.
func (s *Store) EventsInSeries(ctx context.Context, seriesID string) ([]*domain.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+eventColumns+eventFrom+` WHERE e.series_id = $1 ORDER BY e.start_local`, seriesID)
	if err != nil {
		return nil, err
	}
	events, err := collectEvents(rows)
	if err != nil {
		return nil, err
	}
	if err := s.loadRelations(ctx, events); err != nil {
		return nil, err
	}
	return events, nil
}

// EventsOnCalendar loads every untrashed event of one calendar.
func (s *Store) EventsOnCalendar(ctx context.Context, calendarID string) ([]*domain.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+eventColumns+eventFrom+`
		WHERE e.trashed_at IS NULL AND e.calendar_id = $1 ORDER BY e.start_local`, calendarID)
	if err != nil {
		return nil, err
	}
	events, err := collectEvents(rows)
	if err != nil {
		return nil, err
	}
	if err := s.loadRelations(ctx, events); err != nil {
		return nil, err
	}
	return events, nil
}

// EventsBlocking loads every untrashed event that can block a person: those on
// a calendar they own and those they are a guest of.
func (s *Store) EventsBlocking(ctx context.Context, personID string) ([]*domain.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+eventColumns+eventFrom+`
		WHERE e.trashed_at IS NULL AND e.calendar_id <> $2 AND (
			e.calendar_id IN (SELECT id FROM calendars WHERE owner_id = $1)
			OR EXISTS (SELECT 1 FROM guests g WHERE g.event_id = e.id AND g.person_id = $1))`,
		personID, domain.HolidaysCalendarID)
	if err != nil {
		return nil, err
	}
	events, err := collectEvents(rows)
	if err != nil {
		return nil, err
	}
	if err := s.loadRelations(ctx, events); err != nil {
		return nil, err
	}
	return events, nil
}

// DeclineWindows loads a person's own out-of-office and focus events.
func (s *Store) DeclineWindows(ctx context.Context, personID string) ([]*domain.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+eventColumns+eventFrom+`
		WHERE e.trashed_at IS NULL AND e.kind = ANY($2)
		  AND e.calendar_id IN (SELECT id FROM calendars WHERE owner_id = $1)`,
		personID, []string{domain.KindOutOfOffice, domain.KindFocusTime})
	if err != nil {
		return nil, err
	}
	events, err := collectEvents(rows)
	if err != nil {
		return nil, err
	}
	if err := s.loadRelations(ctx, events); err != nil {
		return nil, err
	}
	return events, nil
}

// AllLiveEvents loads every untrashed event, for search and reminder sweeps.
func (s *Store) AllLiveEvents(ctx context.Context) ([]*domain.Event, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+eventColumns+eventFrom+` WHERE e.trashed_at IS NULL`)
	if err != nil {
		return nil, err
	}
	events, err := collectEvents(rows)
	if err != nil {
		return nil, err
	}
	if err := s.loadRelations(ctx, events); err != nil {
		return nil, err
	}
	return events, nil
}

func collectEvents(rows pgx.Rows) ([]*domain.Event, error) {
	defer rows.Close()
	var out []*domain.Event
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) loadRelations(ctx context.Context, events []*domain.Event) error {
	if len(events) == 0 {
		return nil
	}
	byID := make(map[string]*domain.Event, len(events))
	ids := make([]string, 0, len(events))
	for _, e := range events {
		byID[e.ID] = e
		ids = append(ids, e.ID)
	}

	rows, err := s.pool.Query(ctx, `SELECT g.event_id, g.person_id, p.name, g.answer, g.message
		FROM guests g JOIN people p ON p.id = g.person_id WHERE g.event_id = ANY($1) ORDER BY p.name`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var g domain.Guest
		if err := rows.Scan(&id, &g.PersonID, &g.Name, &g.Answer, &g.Message); err != nil {
			rows.Close()
			return err
		}
		byID[id].Guests = append(byID[id].Guests, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	rows, err = s.pool.Query(ctx, `SELECT event_id, occurrence_key, person_id, answer, message
		FROM replies WHERE event_id = ANY($1)`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var r domain.Reply
		if err := rows.Scan(&id, &r.Key, &r.PersonID, &r.Answer, &r.Message); err != nil {
			rows.Close()
			return err
		}
		byID[id].Replies = append(byID[id].Replies, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	rows, err = s.pool.Query(ctx, `SELECT event_id, occurrence_key, deleted, start_local, end_local, title, location, notes
		FROM exceptions WHERE event_id = ANY($1) ORDER BY occurrence_key`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var x domain.Exception
		if err := rows.Scan(&id, &x.Key, &x.Deleted, &x.StartLocal, &x.EndLocal, &x.Title, &x.Location, &x.Notes); err != nil {
			rows.Close()
			return err
		}
		byID[id].Exceptions = append(byID[id].Exceptions, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	rows, err = s.pool.Query(ctx, `SELECT pr.id, pr.event_id, pr.occurrence_key, pr.proposer_id, p.name,
		pr.start_local, pr.end_local, pr.note, pr.status
		FROM proposals pr JOIN people p ON p.id = pr.proposer_id
		WHERE pr.event_id = ANY($1) ORDER BY pr.created_at`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var pr domain.Proposal
		if err := rows.Scan(&pr.ID, &pr.EventID, &pr.Key, &pr.ProposerID, &pr.ProposerName,
			&pr.StartLocal, &pr.EndLocal, &pr.Note, &pr.Status); err != nil {
			rows.Close()
			return err
		}
		byID[pr.EventID].Proposals = append(byID[pr.EventID].Proposals, pr)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	rows, err = s.pool.Query(ctx, `SELECT event_id, token, expires_at FROM share_links WHERE event_id = ANY($1)`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		var link domain.ShareLink
		if err := rows.Scan(&id, &link.Token, &link.ExpiresAt); err != nil {
			rows.Close()
			return err
		}
		link.URL = "/share/" + link.Token
		byID[id].Link = &link
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	rows, err = s.pool.Query(ctx, `SELECT event_id, rule_id FROM zone_moves WHERE event_id = ANY($1)`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id, ruleID string
		if err := rows.Scan(&id, &ruleID); err != nil {
			rows.Close()
			return err
		}
		byID[id].MovedRules = append(byID[id].MovedRules, ruleID)
	}
	rows.Close()
	return rows.Err()
}

// InsertEvent writes a new event row.
func (s *Store) InsertEvent(ctx context.Context, e *domain.Event) error {
	switches, err := json.Marshal(e.Switches)
	if err != nil {
		return err
	}
	var organiser *string
	if e.OrganiserID != "" {
		organiser = &e.OrganiserID
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO events
		(id, calendar_id, series_id, split_from, organiser_id, title, location, notes, kind, colour, reminders,
		 all_day, start_local, end_local, zone, visibility, rrule, series_until, decline_mode, decline_message,
		 switches, version, saved_at, saved_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
		e.ID, e.CalendarID, e.SeriesID, e.SplitFrom, organiser, e.Title, e.Location, e.Notes, e.Kind, e.Colour,
		e.Reminders, e.AllDay, e.StartLocal, e.EndLocal, e.Zone, e.Visibility, e.RRule, e.SeriesUntil,
		e.DeclineMode, e.DeclineMessage, switches, e.Version, e.SavedAt, nullable(e.SavedByID))
	return err
}

// UpdateEvent writes an event's fields and takes it to a new version only when
// the version it was read at still stands, so the first save wins.
func (s *Store) UpdateEvent(ctx context.Context, e *domain.Event, fromVersion int) (bool, error) {
	switches, err := json.Marshal(e.Switches)
	if err != nil {
		return false, err
	}
	tag, err := s.pool.Exec(ctx, `UPDATE events SET calendar_id=$2, title=$3, location=$4, notes=$5, kind=$6,
		colour=$7, reminders=$8, all_day=$9, start_local=$10, end_local=$11, zone=$12, visibility=$13,
		rrule=$14, series_until=$15, decline_mode=$16, decline_message=$17, switches=$18,
		version=version+1, saved_at=$19, saved_by=$20, trashed_at=$21
		WHERE id=$1 AND version=$22`,
		e.ID, e.CalendarID, e.Title, e.Location, e.Notes, e.Kind, e.Colour, e.Reminders, e.AllDay,
		e.StartLocal, e.EndLocal, e.Zone, e.Visibility, e.RRule, e.SeriesUntil, e.DeclineMode,
		e.DeclineMessage, switches, e.SavedAt, nullable(e.SavedByID), e.TrashedAt, fromVersion)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// BumpVersion raises an event's version without touching its fields, which an
// answer, proposal or switch change does.
func (s *Store) BumpVersion(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `UPDATE events SET version = version + 1 WHERE id = $1`, id)
	return err
}

func (s *Store) SetTrashed(ctx context.Context, id string, at *time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE events SET trashed_at=$2, version=version+1 WHERE id=$1`, id, at)
	return err
}

func (s *Store) AddGuest(ctx context.Context, eventID, personID string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO guests (event_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, eventID, personID)
	return err
}

func (s *Store) RemoveGuest(ctx context.Context, eventID, personID string) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM replies WHERE event_id=$1 AND person_id=$2`, eventID, personID); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM guests WHERE event_id=$1 AND person_id=$2`, eventID, personID)
	return err
}

// SetSeriesAnswer writes a guest's series-wide answer.
func (s *Store) SetSeriesAnswer(ctx context.Context, eventID, personID, answer, message string) error {
	_, err := s.pool.Exec(ctx, `UPDATE guests SET answer=$3, message=$4 WHERE event_id=$1 AND person_id=$2`,
		eventID, personID, answer, message)
	return err
}

// SetOccurrenceAnswer writes a guest's answer to one occurrence.
func (s *Store) SetOccurrenceAnswer(ctx context.Context, eventID, key, personID, answer, message string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO replies (event_id, occurrence_key, person_id, answer, message)
		VALUES ($1,$2,$3,$4,$5) ON CONFLICT (event_id, occurrence_key, person_id)
		DO UPDATE SET answer=$4, message=$5`, eventID, key, personID, answer, message)
	return err
}

func (s *Store) PutException(ctx context.Context, eventID string, x domain.Exception) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO exceptions (event_id, occurrence_key, deleted, start_local, end_local, title, location, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (event_id, occurrence_key) DO UPDATE SET deleted=$3,
			start_local=coalesce($4, exceptions.start_local),
			end_local=coalesce($5, exceptions.end_local),
			title=coalesce($6, exceptions.title),
			location=coalesce($7, exceptions.location),
			notes=coalesce($8, exceptions.notes)`,
		eventID, x.Key, x.Deleted, x.StartLocal, x.EndLocal, x.Title, x.Location, x.Notes)
	return err
}

// UndeleteException brings a deleted occurrence back with the values it
// overrode, dropping the row when it overrode none.
func (s *Store) UndeleteException(ctx context.Context, eventID, key string) error {
	if _, err := s.pool.Exec(ctx, `UPDATE exceptions SET deleted=false WHERE event_id=$1 AND occurrence_key=$2`,
		eventID, key); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM exceptions WHERE event_id=$1 AND occurrence_key=$2 AND deleted=false
		AND title IS NULL AND location IS NULL AND notes IS NULL AND start_local IS NULL AND end_local IS NULL`,
		eventID, key)
	return err
}

func (s *Store) DeleteException(ctx context.Context, eventID, key string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM exceptions WHERE event_id=$1 AND occurrence_key=$2`, eventID, key)
	return err
}

// ClearExceptionField drops one overridden value, so that field follows the
// series again.
func (s *Store) ClearExceptionField(ctx context.Context, eventID, key, field string) error {
	switch field {
	case "title", "location", "notes", "start_local", "end_local":
	default:
		return nil
	}
	_, err := s.pool.Exec(ctx, `UPDATE exceptions SET `+field+`=NULL WHERE event_id=$1 AND occurrence_key=$2`, eventID, key)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM exceptions WHERE event_id=$1 AND occurrence_key=$2 AND deleted=false
		AND title IS NULL AND location IS NULL AND notes IS NULL AND start_local IS NULL AND end_local IS NULL`, eventID, key)
	return err
}

func (s *Store) ClearAllAnswers(ctx context.Context, eventID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM replies WHERE event_id=$1`, eventID)
	return err
}

func (s *Store) ClearOneAnswer(ctx context.Context, eventID, key, personID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM replies WHERE event_id=$1 AND occurrence_key=$2 AND person_id=$3`,
		eventID, key, personID)
	return err
}

func (s *Store) MoveProposal(ctx context.Context, id, eventID, key string) error {
	_, err := s.pool.Exec(ctx, `UPDATE proposals SET event_id=$2, occurrence_key=$3 WHERE id=$1`, id, eventID, key)
	return err
}

func (s *Store) SetOrganiser(ctx context.Context, eventID, personID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE events SET organiser_id=$2 WHERE id=$1`, eventID, personID)
	return err
}

func (s *Store) CopyGuests(ctx context.Context, fromEvent, toEvent string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO guests (event_id, person_id, answer, message)
		SELECT $2, person_id, answer, message FROM guests WHERE event_id=$1 ON CONFLICT DO NOTHING`, fromEvent, toEvent)
	return err
}

func (s *Store) CopyZoneMoves(ctx context.Context, fromEvent, toEvent string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO zone_moves (event_id, rule_id)
		SELECT $2, rule_id FROM zone_moves WHERE event_id=$1 ON CONFLICT DO NOTHING`, fromEvent, toEvent)
	return err
}

func (s *Store) InsertProposal(ctx context.Context, p domain.Proposal, now time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO proposals (id, event_id, occurrence_key, proposer_id, start_local, end_local, note, status, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		p.ID, p.EventID, p.Key, p.ProposerID, p.StartLocal, p.EndLocal, p.Note, p.Status, now)
	return err
}

func (s *Store) Proposal(ctx context.Context, id string) (domain.Proposal, error) {
	var p domain.Proposal
	err := s.pool.QueryRow(ctx, `SELECT pr.id, pr.event_id, pr.occurrence_key, pr.proposer_id, p.name,
		pr.start_local, pr.end_local, pr.note, pr.status
		FROM proposals pr JOIN people p ON p.id = pr.proposer_id WHERE pr.id=$1`, id).
		Scan(&p.ID, &p.EventID, &p.Key, &p.ProposerID, &p.ProposerName, &p.StartLocal, &p.EndLocal, &p.Note, &p.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// DecideProposal settles a proposal only while it is still open, so exactly one
// decision wins.
func (s *Store) DecideProposal(ctx context.Context, id, status string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE proposals SET status=$2 WHERE id=$1 AND status='proposed'`, id, status)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *Store) OpenProposal(ctx context.Context, eventID, key, proposerID string) (bool, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM proposals
		WHERE event_id=$1 AND occurrence_key=$2 AND proposer_id=$3 AND status='proposed'`, eventID, key, proposerID).Scan(&n)
	return n > 0, err
}

func (s *Store) PutShareLink(ctx context.Context, eventID, token string, expires time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO share_links (event_id, token, expires_at) VALUES ($1,$2,$3)
		ON CONFLICT (event_id) DO UPDATE SET token=$2, expires_at=$3`, eventID, token, expires)
	return err
}

func (s *Store) DeleteShareLink(ctx context.Context, eventID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM share_links WHERE event_id=$1`, eventID)
	return err
}

// EventByShareToken finds the event a live shared link points at.
func (s *Store) EventByShareToken(ctx context.Context, token string) (*domain.Event, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT event_id FROM share_links WHERE token=$1`, token).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.Event(ctx, id)
}

func (s *Store) InsertZoneMove(ctx context.Context, eventID, ruleID string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO zone_moves (event_id, rule_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, eventID, ruleID)
	return err
}
