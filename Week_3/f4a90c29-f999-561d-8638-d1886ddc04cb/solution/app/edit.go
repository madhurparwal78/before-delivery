package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/lib/pq"
)

// ReplyChange remembers a reply row as it was before an edit touched it, for undo.
type ReplyChange struct {
	PersonID, Key string
	Prev          *Reply
}

// Edit is the working state of one write transaction.
type Edit struct {
	S       *Server
	Ctx     context.Context
	Tx      *sql.Tx
	W       *World
	Actor   *Person
	Now     time.Time
	Undo    []ReplyChange
	Notices map[string]map[string]any
}

func (s *Server) edit(ctx context.Context, actor *Person, fn func(ed *Edit) error) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		now := s.clock.Now()
		w, err := loadWorld(ctx, tx, now)
		if err != nil {
			return err
		}
		ed := &Edit{S: s, Ctx: ctx, Tx: tx, W: w, Actor: w.People[actor.ID], Now: now, Notices: map[string]map[string]any{}}
		return fn(ed)
	})
}

func (ed *Edit) loadLocked(id string) (*Event, error) {
	e, err := loadEvent(ed.Ctx, ed.Tx, id)
	if err != nil || e == nil {
		return nil, err
	}
	return e, attachDetails(ed.Ctx, ed.Tx, []*Event{e}, ed.Now)
}

var replyStates = map[string]bool{"yes": true, "no": true, "maybe": true, "invited": true}

// readableEvent loads a live event with its details for the actor; 404 when it is gone or unreadable.
func (ed *Edit) readableEvent(id string) (*Event, error) {
	e, err := ed.loadLocked(id)
	if err != nil {
		return nil, err
	}
	if e == nil || e.Trashed || ed.W.access(e, ed.Actor) == "" {
		return nil, errNotFound
	}
	return e, nil
}

// setReply is the only writer of reply rows; a guest moves freely among yes, no and maybe,
// and only the system (byGuest false) returns a guest to invited.
func (ed *Edit) setReply(e *Event, person, key, status string, message *string, byGuest bool) error {
	if !replyStates[status] || (byGuest && status == "invited") {
		return fieldErr("answer", "Answer yes, no or maybe.")
	}
	var prev *Reply
	for i := range e.Replies {
		if e.Replies[i].PersonID == person && e.Replies[i].Key == key {
			r := e.Replies[i]
			prev = &r
		}
	}
	ed.Undo = append(ed.Undo, ReplyChange{PersonID: person, Key: key, Prev: prev})
	if _, err := ed.Tx.ExecContext(ed.Ctx, `INSERT INTO replies (event_id, person_id, key, status, message) VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (event_id, person_id, key) DO UPDATE SET status = $4, message = $5`, e.ID, person, key, status, message); err != nil {
		return err
	}
	kept := e.Replies[:0:0]
	for _, r := range e.Replies {
		if !(r.PersonID == person && r.Key == key) {
			kept = append(kept, r)
		}
	}
	e.Replies = append(kept, Reply{PersonID: person, Key: key, Status: status, Message: message})
	return nil
}

func (ed *Edit) dropReplies(e *Event, person string, onlyKeys func(string) bool) error {
	kept := e.Replies[:0:0]
	for _, r := range e.Replies {
		if r.PersonID == person && onlyKeys(r.Key) {
			rc := r
			ed.Undo = append(ed.Undo, ReplyChange{PersonID: person, Key: r.Key, Prev: &rc})
			if _, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM replies WHERE event_id=$1 AND person_id=$2 AND key=$3`, e.ID, person, r.Key); err != nil {
				return err
			}
			continue
		}
		kept = append(kept, r)
	}
	e.Replies = kept
	return nil
}

// reopenReplies returns guests to waiting for the given occurrence keys, or for the whole event when keys is nil.
func (ed *Edit) reopenReplies(e *Event, keys []string, except map[string]bool) error {
	if keys == nil {
		if _, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM reminder_states WHERE event_id=$1 AND status='snoozed'`, e.ID); err != nil {
			return err
		}
	}
	for _, k := range keys {
		if _, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM reminder_states WHERE event_id=$1 AND occurrence_key=$2 AND status='snoozed'`, e.ID, k); err != nil {
			return err
		}
	}
	for _, g := range e.GuestIDs {
		if except[g] {
			continue
		}
		if keys == nil {
			if err := ed.dropReplies(e, g, func(k string) bool { return k != "" }); err != nil {
				return err
			}
			if err := ed.setReply(e, g, "", "invited", nil, false); err != nil {
				return err
			}
			continue
		}
		for _, k := range keys {
			if err := ed.setReply(e, g, k, "invited", nil, false); err != nil {
				return err
			}
		}
	}
	return nil
}

func (ed *Edit) notice(person, kind, text, eventID string) (int64, error) {
	var id int64
	err := ed.Tx.QueryRowContext(ed.Ctx, `INSERT INTO notices (person_id, kind, text, event_id, created_at) VALUES ($1,$2,$3,NULLIF($4,''),$5) RETURNING id`,
		person, kind, text, eventID, ed.Now).Scan(&id)
	return id, err
}

func (ed *Edit) log(r ChangeRow) error { return logChange(ed.Ctx, ed.Tx, ed.Now, r) }

// changed announces a changed event, carrying any invitation notices collected during the edit.
func (ed *Edit) changed(e *Event, typ string) error {
	data := map[string]any{}
	if len(ed.Notices) > 0 {
		data["notices"] = ed.Notices
		ed.Notices = map[string]map[string]any{}
	}
	return ed.log(ChangeRow{Type: typ, EventID: e.ID, CalendarID: e.CalendarID, Data: data})
}

// fullAccessPeople are the people who can edit an event: its calendar's owner and edit or manage shares.
func (ed *Edit) fullAccessPeople(e *Event) []string {
	var out []string
	for _, p := range ed.W.peopleSorted() {
		if ed.W.canWrite(ed.W.Calendars[e.CalendarID], p) {
			out = append(out, p.ID)
		}
	}
	return out
}

func unique(ids ...[]string) []string {
	seen := map[string]bool{}
	var out []string
	for _, list := range ids {
		for _, id := range list {
			if id != "" && !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	return out
}

// decide commits one decision: a change-log entry and one notice per recipient.
func (ed *Edit) decide(e *Event, occurrenceID, kind, text string, audience []string) error {
	decisionID := newID("dec-")
	for _, p := range audience {
		if _, err := ed.notice(p, "decision", text, e.ID); err != nil {
			return err
		}
	}
	return ed.log(ChangeRow{Type: "decision", EventID: e.ID, CalendarID: e.CalendarID, Audience: audience,
		Data: map[string]any{"decision_id": decisionID, "kind": kind, "text": text, "event_id": e.ID, "occurrence_id": occurrenceID, "event_title": e.Title}})
}

// windowsOf expands a person's focus and out-of-office events across a span.
func (ed *Edit) windowsOf(personID string, from, to time.Time) ([]*Occurrence, error) {
	events, err := loadEvents(ed.Ctx, ed.Tx, `NOT trashed AND kind IN ('focus','out_of_office')
		AND calendar_id IN (SELECT id FROM calendars WHERE owner_id = $1)`, personID)
	if err != nil {
		return nil, err
	}
	var out []*Occurrence
	for _, e := range events {
		out = append(out, ed.W.occurrences(e, Window{From: from, To: to})...)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Begin.Before(out[j].Begin) })
	return out, nil
}

// declineIfBlocked answers no for a guest whose occurrence overlaps one of their windows.
func (ed *Edit) declineIfBlocked(e *Event, o *Occurrence, p *Person, windows []*Occurrence, announce *int) error {
	if owner := ed.W.organiser(e); owner != nil && owner.ID == p.ID {
		return nil
	}
	var hit *Occurrence
	for _, wo := range windows {
		if wo.Begin.Before(o.Finish) && wo.Finish.After(o.Begin) {
			hit = wo
			break
		}
	}
	if hit == nil {
		return nil
	}
	loc := zoneLocations[p.Zone]
	until := wallOf(hit.Finish, loc).Format("15:04")
	if hit.Event.Kind == "out_of_office" {
		last := hit.ShownEnd
		if !hit.AllDay {
			last = wallOf(hit.Finish, loc)
		}
		until = longDate(last)
	}
	sentence := declineCopy(hit.Event.Kind, p.Name, until, o.Title)
	message := sentence
	if hit.Event.Kind == "out_of_office" && hit.Event.DeclineMessage != nil && *hit.Event.DeclineMessage != "" {
		message = *hit.Event.DeclineMessage
	}
	if err := ed.setReply(e, p.ID, o.ReplyKey(), "no", &message, false); err != nil {
		return err
	}
	if *announce >= 20 {
		return nil
	}
	*announce++
	audience := unique([]string{p.ID}, ed.fullAccessPeople(e))
	return ed.decide(e, o.ID, "auto_decline", sentence, audience)
}

const declineHorizonDays = 400

var proposalEdges = map[string][]string{"proposed": {"accepted", "declined"}}

// openProposal records a guest's new proposal in the proposed state.
func (ed *Edit) openProposal(p Proposal) error {
	_, err := ed.Tx.ExecContext(ed.Ctx, `INSERT INTO proposals VALUES ($1,$2,$3,$4,$5,$6,$7,'proposed',$8)`,
		p.ID, p.EventID, p.Key, p.ProposerID, p.StartLocal, p.EndLocal, p.Note, ed.Now)
	if pe, ok := err.(*pq.Error); ok && pe.Code == "23505" {
		return apiErr(409, "proposal_open", "You already have an open proposal for this time.")
	}
	return err
}

// decideProposal is the only place a proposal leaves the proposed state, by its legal edges.
func (ed *Edit) decideProposal(p *Proposal, to string) error {
	for _, next := range proposalEdges[p.Status] {
		if next == to {
			p.Status = to
			_, err := ed.Tx.ExecContext(ed.Ctx, `UPDATE proposals SET status = $2 WHERE id = $1`, p.ID, to)
			return err
		}
	}
	return apiErr(409, "proposal_decided", "That proposal has already been decided.")
}

// removeGuest takes a guest off an event with their replies and reminders.
func (ed *Edit) removeGuest(e *Event, person string) error {
	for _, stmt := range []string{`DELETE FROM replies WHERE event_id=$1 AND person_id=$2`, `DELETE FROM guests WHERE event_id=$1 AND person_id=$2`,
		`DELETE FROM reminder_states WHERE event_id=$1 AND person_id=$2`} {
		if _, err := ed.Tx.ExecContext(ed.Ctx, stmt, e.ID, person); err != nil {
			return err
		}
	}
	return nil
}

// declineCopy is the published sentence for an automatic decline by an out-of-office or focus window.
func declineCopy(kind, name, until, title string) string {
	what := "in focus time"
	if kind == "out_of_office" {
		what = "out of office"
	}
	return fmt.Sprintf("%s is %s until %s, so %s was declined automatically.", name, what, until, title)
}

// declineGuests checks the given guests' windows against an event's occurrences (all, or only the given keys).
func (ed *Edit) declineGuests(e *Event, guests []string, keys map[string]bool) error {
	if e.Trashed || len(guests) == 0 {
		return nil
	}
	first := ed.W.firstOccurrence(e)
	span := Window{From: first.Begin.Add(-24 * time.Hour), To: first.Begin.AddDate(0, 0, declineHorizonDays)}
	occs := ed.W.occurrences(e, span)
	announce := 0
	for _, g := range guests {
		p := ed.W.People[g]
		windows, err := ed.windowsOf(g, span.From, span.To)
		if err != nil {
			return err
		}
		for _, o := range occs {
			if keys != nil && !keys[o.Key] {
				continue
			}
			if err := ed.declineIfBlocked(e, o, p, windows, &announce); err != nil {
				return err
			}
		}
	}
	return nil
}

// declineExisting applies a new or moved focus event (new and existing mode) to meetings its owner already guests.
func (ed *Edit) declineExisting(win *Event) error {
	if win.Kind != "focus" || win.DeclineMode == nil || *win.DeclineMode != "new_and_existing" || win.Trashed {
		return nil
	}
	owner := ed.W.organiser(win)
	if owner == nil {
		return nil
	}
	first := ed.W.firstOccurrence(win)
	span := Window{From: first.Begin.Add(-24 * time.Hour), To: first.Begin.AddDate(0, 0, declineHorizonDays)}
	windows := ed.W.occurrences(win, span)
	meetings, err := loadEvents(ed.Ctx, ed.Tx, `NOT trashed AND id IN (SELECT event_id FROM guests WHERE person_id = $1)`, owner.ID)
	if err != nil {
		return err
	}
	if err := attachDetails(ed.Ctx, ed.Tx, meetings, ed.Now); err != nil {
		return err
	}
	announce := 0
	for _, m := range meetings {
		for _, wo := range windows {
			for _, o := range ed.W.occurrences(m, Window{From: wo.Begin, To: wo.Finish}) {
				if err := ed.declineIfBlocked(m, o, owner, []*Occurrence{wo}, &announce); err != nil {
					return err
				}
				if err := ed.changed(m, "reply.changed"); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// recheckWindow reapplies a created or moved window event, and rechecks the declines of an event's guests.
func (ed *Edit) recheck(e *Event, keys map[string]bool) error {
	if err := ed.declineGuests(e, e.GuestIDs, keys); err != nil {
		return err
	}
	return ed.declineExisting(e)
}

// guestCandidates checks a list of person ids and leaves out the event's organiser and any repeats.
func (ed *Edit) guestCandidates(e *Event, ids []string, field string) ([]string, error) {
	var out []string
	for _, id := range ids {
		if ed.W.People[id] == nil {
			return nil, fieldErr(field, "Choose people from the list.")
		}
		if o := ed.W.organiser(e); o == nil || o.ID != id {
			out = append(out, id)
		}
	}
	return unique(out), nil
}

func (ed *Edit) invite(e *Event, people []string) error {
	var added []string
	for _, id := range people {
		if e.isGuest(id) {
			continue
		}
		if _, err := ed.Tx.ExecContext(ed.Ctx, `INSERT INTO guests VALUES ($1,$2)`, e.ID, id); err != nil {
			return err
		}
		e.GuestIDs = append(e.GuestIDs, id)
		if err := ed.setReply(e, id, "", "invited", nil, false); err != nil {
			return err
		}
		added = append(added, id)
		nid, err := ed.notice(id, "invitation", ed.Actor.Name+" invited you to "+e.Title+".", e.ID)
		if err != nil {
			return err
		}
		ed.Notices[id] = map[string]any{"id": itoa(nid), "text": ed.Actor.Name + " invited you to " + e.Title + "."}
	}
	sort.Slice(e.GuestIDs, func(i, j int) bool { return ed.W.People[e.GuestIDs[i]].Name < ed.W.People[e.GuestIDs[j]].Name })
	return ed.declineGuests(e, added, nil)
}

// rekey renames occurrence keys across every table that holds them.
func (ed *Edit) rekey(e *Event, mapKey func(string) string) error {
	rows, err := ed.Tx.QueryContext(ed.Ctx, `SELECT key FROM exceptions WHERE event_id=$1 UNION SELECT key FROM replies WHERE event_id=$1 AND key<>''
		UNION SELECT occurrence_key FROM proposals WHERE event_id=$1 AND occurrence_key<>''
		UNION SELECT occurrence_key FROM trash_items WHERE event_id=$1 AND occurrence_key<>''
		UNION SELECT occurrence_key FROM reminder_states WHERE event_id=$1`, e.ID)
	if err != nil {
		return err
	}
	var keys []string
	for rows.Next() {
		var k string
		rows.Scan(&k)
		keys = append(keys, k)
	}
	rows.Close()
	for _, old := range keys {
		next := mapKey(old)
		if next == old {
			continue
		}
		for _, stmt := range []string{
			`UPDATE exceptions SET key=$3 WHERE event_id=$1 AND key=$2`, `UPDATE replies SET key=$3 WHERE event_id=$1 AND key=$2`,
			`UPDATE proposals SET occurrence_key=$3 WHERE event_id=$1 AND occurrence_key=$2`,
			`UPDATE trash_items SET occurrence_key=$3 WHERE event_id=$1 AND occurrence_key=$2`,
			`UPDATE reminder_states SET occurrence_key=$3 WHERE event_id=$1 AND occurrence_key=$2`,
		} {
			if _, err := ed.Tx.ExecContext(ed.Ctx, stmt, e.ID, old, next); err != nil {
				return err
			}
		}
		if x, ok := e.Exceptions[old]; ok {
			delete(e.Exceptions, old)
			x.Key = next
			e.Exceptions[next] = x
		}
	}
	return nil
}

func (ed *Edit) writeException(e *Event, x *Exception) error {
	if len(x.Over) == 0 && !x.Deleted {
		delete(e.Exceptions, x.Key)
		_, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM exceptions WHERE event_id=$1 AND key=$2`, e.ID, x.Key)
		return err
	}
	over, _ := json.Marshal(x.Over)
	e.Exceptions[x.Key] = x
	_, err := ed.Tx.ExecContext(ed.Ctx, `INSERT INTO exceptions VALUES ($1,$2,$3,$4) ON CONFLICT (event_id, key) DO UPDATE SET deleted=$3, over=$4`,
		e.ID, x.Key, x.Deleted, over)
	return err
}

// touch records a save on the event: next version, saved time and saver.
func (ed *Edit) touch(e *Event) error {
	e.Version++
	e.SavedAt, e.SavedBy = ed.Now, ed.Actor.ID
	return saveEvent(ed.Ctx, ed.Tx, e)
}

// split starts a later series at the given nominal start, moving everything dated from then on.
func (ed *Edit) split(e *Event, at wall, laterStart, laterEnd wall) (*Event, error) {
	r := e.rule()
	start := dateOnly(e.baseStart())
	splitDate := dateOnly(at)
	before := r.CountBefore(start, splitDate)
	later := *e
	later.ID, later.SplitFrom, later.Version = newID("evt-"), &e.ID, 1
	later.Exceptions, later.GuestIDs, later.Replies, later.Proposals, later.Link = map[string]*Exception{}, append([]string(nil), e.GuestIDs...), nil, nil, nil
	later.MovedRules = append([]string(nil), e.MovedRules...)
	later.ICalUID = nil
	later.SavedAt, later.SavedBy = ed.Now, ed.Actor.ID
	if e.AllDay {
		later.StartLocal, later.EndLocal = laterStart.Format(layoutDate), laterEnd.Format(layoutDate)
	} else {
		later.StartLocal, later.EndLocal = wallString(laterStart), wallString(laterEnd)
	}
	untilBefore := splitDate.AddDate(0, 0, -1).Format("20060102")
	var laterRule string
	switch {
	case r.Count > 0:
		e.RRule = ptr(r.With(before, ""))
		laterRule = r.With(r.Count-before, "")
	case !r.Until.IsZero():
		e.RRule = ptr(r.With(0, untilBefore))
		laterRule = r.With(0, r.Until.Format("20060102"))
	default:
		e.RRule = ptr(r.With(0, untilBefore))
		laterRule = r.With(0, "")
	}
	later.RRule = &laterRule
	if err := insertEvent(ed.Ctx, ed.Tx, &later); err != nil {
		return nil, err
	}
	cutoff := splitDate.Format("20060102")
	for _, g := range e.GuestIDs {
		if _, err := ed.Tx.ExecContext(ed.Ctx, `INSERT INTO guests VALUES ($1,$2)`, later.ID, g); err != nil {
			return nil, err
		}
	}
	for _, r := range e.Replies {
		if r.Key != "" {
			continue
		}
		if err := ed.setReply(&later, r.PersonID, "", r.Status, r.Message, false); err != nil {
			return nil, err
		}
	}
	for _, stmt := range []string{
		`UPDATE exceptions SET event_id=$2 WHERE event_id=$1 AND substr(key,1,8) >= $3`,
		`UPDATE replies SET event_id=$2 WHERE event_id=$1 AND key<>'' AND substr(key,1,8) >= $3`,
		`UPDATE proposals SET event_id=$2 WHERE event_id=$1 AND occurrence_key<>'' AND substr(occurrence_key,1,8) >= $3`,
		`UPDATE trash_items SET event_id=$2 WHERE event_id=$1 AND occurrence_key<>'' AND substr(occurrence_key,1,8) >= $3`,
		`UPDATE reminder_states SET event_id=$2 WHERE event_id=$1 AND substr(occurrence_key,1,8) >= $3`,
	} {
		if _, err := ed.Tx.ExecContext(ed.Ctx, stmt, e.ID, later.ID, cutoff); err != nil {
			return nil, err
		}
	}
	for key, x := range e.Exceptions {
		if key[:8] >= cutoff {
			delete(e.Exceptions, key)
			later.Exceptions[key] = x
		}
	}
	return &later, nil
}

func ptr[T any](v T) *T { return &v }

var trashEdges = map[string][]string{"trashed": {"restored", "purged"}}

// setTrashState is the only place a trash item leaves the trashed state, by its legal edges.
func (ed *Edit) setTrashState(t *trashItem, to string) error {
	for _, next := range trashEdges[t.State] {
		if next != to {
			continue
		}
		t.State = to
		if to == "purged" {
			return ed.purge(t.ID, t.Kind, t.EventID, t.Key)
		}
		_, err := ed.Tx.ExecContext(ed.Ctx, `UPDATE trash_items SET state = $2 WHERE id = $1`, t.ID, to)
		return err
	}
	return apiErr(409, "not_trashed", "That item is not in the trash.")
}

// purge deletes a trashed item's data for good.
func (ed *Edit) purge(itemID, kind, eventID, key string) error {
	if kind == "occurrence" {
		for _, stmt := range []string{
			`DELETE FROM exceptions WHERE event_id=$1 AND key=$2`, `DELETE FROM replies WHERE event_id=$1 AND key=$2`,
			`DELETE FROM proposals WHERE event_id=$1 AND occurrence_key=$2`, `DELETE FROM reminder_states WHERE event_id=$1 AND occurrence_key=$2`,
			`DELETE FROM change_log WHERE event_id=$1 AND data->>'occurrence_id' = $1::text || '@' || $2::text`,
		} {
			if _, err := ed.Tx.ExecContext(ed.Ctx, stmt, eventID, key); err != nil {
				return err
			}
		}
		_, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM trash_items WHERE id=$1`, itemID)
		return err
	}
	if _, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM notices WHERE event_id=$1`, eventID); err != nil {
		return err
	}
	if _, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM change_log WHERE event_id=$1`, eventID); err != nil {
		return err
	}
	_, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM events WHERE id=$1`, eventID)
	return err
}
