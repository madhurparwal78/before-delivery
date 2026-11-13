package main

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"
)

// trash moves an occurrence, a series from an occurrence on, or a whole event to the trash.
func (ed *Edit) trash(e *Event, scope string, occ *Occurrence) (string, error) {
	switch {
	case !e.recurring() || scope == "all" || (scope == "following" && keyOf(e.baseStart()) == occ.Key):
		return ed.trashWhole(e)
	case scope == "this":
		x := e.Exceptions[occ.Key]
		if x == nil {
			x = &Exception{Key: occ.Key, Over: map[string]string{}}
		}
		x.Deleted = true
		if err := ed.writeException(e, x); err != nil {
			return "", err
		}
		if err := ed.touch(e); err != nil {
			return "", err
		}
		id, err := ed.moveToTrash("occurrence", e, occ.Key, occ.Title)
		if err != nil {
			return "", err
		}
		return id, ed.changed(e, "event.changed")
	}
	nominal := wallFromKey(occ.Key)
	later, err := ed.split(e, nominal, nominal, nominal.Add(e.baseDuration()))
	if err != nil {
		return "", err
	}
	if err := ed.touch(e); err != nil {
		return "", err
	}
	if err := ed.changed(e, "event.changed"); err != nil {
		return "", err
	}
	return ed.trashWhole(later)
}

func (ed *Edit) moveToTrash(kind string, e *Event, key, title string) (string, error) {
	id := newID("tr-")
	_, err := ed.Tx.ExecContext(ed.Ctx, `INSERT INTO trash_items VALUES ($1,$2,$3,$4,$5,$6,$7,'trashed')`,
		id, kind, e.ID, key, title, ed.Now, ed.Now.Add(ed.S.cfg.TrashRetention))
	return id, err
}

func (ed *Edit) trashWhole(e *Event) (string, error) {
	kind := "event"
	if e.recurring() {
		kind = "series"
	}
	e.Trashed = true
	if err := ed.touch(e); err != nil {
		return "", err
	}
	id, err := ed.moveToTrash(kind, e, "", e.Title)
	if err != nil {
		return "", err
	}
	return id, ed.log(ChangeRow{Type: "event.deleted", EventID: e.ID, CalendarID: e.CalendarID, Data: map[string]any{}})
}

type trashItem struct {
	ID, Kind, EventID, Key, Title, State string
	TrashedAt, PurgeAt                   time.Time
}

func loadTrashItem(ctx context.Context, q queryer, id string) (*trashItem, error) {
	t := &trashItem{}
	err := q.QueryRowContext(ctx, `SELECT id, kind, event_id, occurrence_key, title, state, trashed_at, purge_at FROM trash_items WHERE id = $1`, id).
		Scan(&t.ID, &t.Kind, &t.EventID, &t.Key, &t.Title, &t.State, &t.TrashedAt, &t.PurgeAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return t, err
}

func (s *Server) handleTrash(rq *Req) error {
	w, err := rq.World()
	if err != nil {
		return err
	}
	rows, err := s.db.QueryContext(rq.ctx(), `SELECT t.id, t.kind, t.event_id, t.occurrence_key, t.title, t.state, t.trashed_at, t.purge_at, e.calendar_id
		FROM trash_items t JOIN events e ON e.id = t.event_id WHERE t.state = 'trashed' ORDER BY t.trashed_at DESC, t.id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var t trashItem
		var calendar string
		if err := rows.Scan(&t.ID, &t.Kind, &t.EventID, &t.Key, &t.Title, &t.State, &t.TrashedAt, &t.PurgeAt, &calendar); err != nil {
			return err
		}
		if !w.canWrite(w.Calendars[calendar], rq.Me) {
			continue
		}
		var occurrence any
		if t.Kind == "occurrence" {
			occurrence = t.EventID + "@" + t.Key
		}
		left := int(math.Ceil(t.PurgeAt.Sub(w.Now).Hours() / 24))
		if left < 1 {
			left = 1
		}
		items = append(items, map[string]any{"id": t.ID, "kind": t.Kind, "title": t.Title, "event_id": t.EventID, "occurrence_id": occurrence,
			"trashed_at": t.TrashedAt.UTC().Format(time.RFC3339), "purge_at": t.PurgeAt.UTC().Format(time.RFC3339), "days_left": left})
	}
	return rq.json(200, map[string]any{"items": items})
}

func (s *Server) handleRestore(rq *Req) error {
	var id string
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		t, err := loadTrashItem(ed.Ctx, ed.Tx, rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		if t == nil {
			return errNotFound
		}
		e, err := ed.loadLocked(t.EventID)
		if err != nil || e == nil || ed.W.access(e, ed.Actor) == "" {
			return errNotFound
		}
		if ed.W.access(e, ed.Actor) != "full" {
			return errForbidden
		}
		if t.State != "trashed" {
			return apiErr(409, "not_trashed", "That item is not in the trash.")
		}
		if t.Kind == "occurrence" {
			if e.Trashed {
				return apiErr(409, "parent_trashed", "Restore the series first, then this occurrence.")
			}
			x := e.Exceptions[t.Key]
			if x == nil {
				x = &Exception{Key: t.Key, Over: map[string]string{}}
			}
			x.Deleted = false
			if err := ed.writeException(e, x); err != nil {
				return err
			}
		} else {
			e.Trashed = false
		}
		if err := ed.touch(e); err != nil {
			return err
		}
		if err := ed.setTrashState(t, "restored"); err != nil {
			return err
		}
		id = e.ID
		return ed.changed(e, "event.changed")
	})
	if err != nil {
		return err
	}
	_, e, access, err := rq.readableFresh(id)
	if err != nil {
		return err
	}
	rq.etag(e)
	return rq.json(200, map[string]any{"event": view(rq.world, rq.Me, e, nil, access, true)})
}

func (s *Server) handleDeleteForGood(rq *Req) error {
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		t, err := loadTrashItem(ed.Ctx, ed.Tx, rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		if t == nil || t.State != "trashed" {
			return errNotFound
		}
		e, err := loadEvent(ed.Ctx, ed.Tx, t.EventID)
		if err != nil || e == nil {
			return errNotFound
		}
		if ed.W.access(e, ed.Actor) != "full" {
			return errForbidden
		}
		return ed.setTrashState(t, "purged")
	})
	if err != nil {
		return err
	}
	return rq.noContent()
}

// purgeLoop removes trash items whose retention has ended on the server clock.
func (s *Server) purgeLoop(ctx context.Context) {
	ticker := time.NewTicker(400 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		rows, err := s.db.QueryContext(ctx, `SELECT id, kind, event_id, occurrence_key FROM trash_items WHERE state = 'trashed' AND purge_at <= $1`, s.clock.Now())
		if err != nil {
			continue
		}
		var due []trashItem
		for rows.Next() {
			var t trashItem
			rows.Scan(&t.ID, &t.Kind, &t.EventID, &t.Key)
			due = append(due, t)
		}
		rows.Close()
		for _, t := range due {
			s.tx(ctx, func(tx *sql.Tx) error {
				current, err := loadTrashItem(ctx, tx, t.ID)
				if err != nil || current == nil || current.State != "trashed" {
					return err
				}
				return (&Edit{S: s, Ctx: ctx, Tx: tx, Now: s.clock.Now()}).setTrashState(current, "purged")
			})
		}
	}
}

func (s *Server) handlePropose(rq *Req) error {
	var body struct {
		OccurrenceID string `json:"occurrence_id"`
		Start        string `json:"start_local"`
		End          string `json:"end_local"`
		Note         string `json:"note"`
	}
	if err := rq.decode(&body); err != nil {
		return err
	}
	var created Proposal
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		if !e.isGuest(ed.Actor.ID) {
			return apiErr(403, "not_a_guest", "Only a guest can propose a new time.")
		}
		errs := map[string]string{}
		key := ""
		var occ *Occurrence
		if e.recurring() {
			eventID, k := splitOccurrenceID(body.OccurrenceID)
			if body.OccurrenceID == "" || eventID != e.ID || ed.W.occurrenceAt(e, k) == nil {
				errs["occurrence_id"] = "Name the occurrence this proposal is for."
			}
			key = k
			occ = ed.W.occurrenceAt(e, k)
		} else {
			occ = ed.W.firstOccurrence(e)
		}
		start, serr := parseStored2(body.Start, e.AllDay)
		end, eerr := parseStored2(body.End, e.AllDay)
		if serr != nil {
			errs["start_local"] = "Use the event's date and time format."
		}
		if eerr != nil {
			errs["end_local"] = "Use the event's date and time format."
		} else if serr == nil && ((e.AllDay && end.Before(start)) || (!e.AllDay && !end.After(start))) {
			errs["end_local"] = "End must be after start."
		}
		if len(body.Note) > 500 {
			errs["note"] = "Use at most 500 characters."
		}
		if len(errs) > 0 {
			return fieldErrors(errs)
		}
		created = Proposal{ID: newID("prop-"), EventID: e.ID, Key: key, ProposerID: ed.Actor.ID, StartLocal: body.Start, EndLocal: body.End,
			Note: strings.TrimSpace(body.Note), Status: "proposed"}
		if err := ed.openProposal(created); err != nil {
			return err
		}
		when := start.Format("15:04")
		if e.AllDay {
			when = longDate(start)
		}
		text := fmt.Sprintf("%s proposed %s %s for %s.", ed.Actor.Name, when, zoneCity[e.Zone], occ.Title)
		for _, p := range ed.fullAccessPeople(e) {
			nid, err := ed.notice(p, "proposal", text, e.ID)
			if err != nil {
				return err
			}
			ed.Notices[p] = map[string]any{"id": itoa(nid), "text": text}
		}
		return ed.changed(e, "proposal.changed")
	})
	if err != nil {
		return err
	}
	w, err := rq.World()
	if err != nil {
		return err
	}
	return rq.json(201, proposalJSON(w, created))
}

func (s *Server) handleDecideProposal(rq *Req) error {
	accept := strings.HasSuffix(rq.R.URL.Path, "/accept")
	var result Proposal
	var eventID string
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		var p Proposal
		err := ed.Tx.QueryRowContext(ed.Ctx, `SELECT id, event_id, occurrence_key, proposer_id, start_local, end_local, note, status FROM proposals WHERE id = $1`,
			rq.R.PathValue("id")).Scan(&p.ID, &p.EventID, &p.Key, &p.ProposerID, &p.StartLocal, &p.EndLocal, &p.Note, &p.Status)
		if err == sql.ErrNoRows {
			return errNotFound
		}
		if err != nil {
			return err
		}
		e, err := ed.loadLocked(p.EventID)
		if err != nil || e == nil || e.Trashed || ed.W.access(e, ed.Actor) == "" {
			return errNotFound
		}
		if ed.W.access(e, ed.Actor) != "full" {
			return errForbidden
		}
		var occ *Occurrence
		if e.recurring() {
			occ = ed.W.occurrenceAt(e, p.Key)
		} else {
			occ = ed.W.firstOccurrence(e)
		}
		if occ == nil {
			return errNotFound
		}
		var text string
		audience := unique([]string{p.ProposerID}, ed.fullAccessPeople(e))
		if accept {
			text = fmt.Sprintf("Proposal accepted: %s moves to %s %s.", occ.Title, p.StartLocal[len(p.StartLocal)-5:], zoneCity[e.Zone])
			if e.AllDay {
				start, _ := parseDate(p.StartLocal)
				text = fmt.Sprintf("Proposal accepted: %s moves to %s %s.", occ.Title, longDate(start), zoneCity[e.Zone])
			}
			if err := ed.decideProposal(&p, "accepted"); err != nil {
				return err
			}
			audience = unique(audience, e.GuestIDs)
			patch := &EventPatch{Present: map[string]bool{}, Start: &p.StartLocal, End: &p.EndLocal}
			scope := "all"
			if e.recurring() {
				scope = "this"
			}
			moved, _, err := ed.patchEvent(e, patch, scope, occ)
			if err != nil {
				return err
			}
			e = moved
			if err := ed.setReply(e, p.ProposerID, occ.ReplyKey(), "yes", nil, false); err != nil {
				return err
			}
		} else {
			text = "Proposal declined for " + occ.Title + "."
			if err := ed.decideProposal(&p, "declined"); err != nil {
				return err
			}
		}
		result, eventID = p, e.ID
		if err := ed.decide(e, occ.ID, "proposal_"+p.Status, text, audience); err != nil {
			return err
		}
		return ed.changed(e, "proposal.changed")
	})
	if err != nil {
		return err
	}
	_, e, access, err := rq.readableFresh(eventID)
	if err != nil {
		return err
	}
	return rq.json(200, map[string]any{"proposal": proposalJSON(rq.world, result), "event": view(rq.world, rq.Me, e, nil, access, true)})
}

func (s *Server) handleCreateLink(rq *Req) error {
	var link map[string]any
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		if ed.W.access(e, ed.Actor) != "full" {
			return errForbidden
		}
		if !e.Switches.SeeGuestList {
			return apiErr(409, "guest_list_hidden", "Turn on See guest list before sharing a link.")
		}
		if e.Visibility == "private" {
			return apiErr(409, "private_event", "A private event cannot have a shared link.")
		}
		token, expires := newToken(), ed.Now.Add(s.cfg.ShareLinkTTL)
		if _, err := ed.Tx.ExecContext(ed.Ctx, `INSERT INTO share_links VALUES ($1,$2,$3,$4)
			ON CONFLICT (event_id) DO UPDATE SET token = $2, created_at = $3, expires_at = $4`, e.ID, token, ed.Now, expires); err != nil {
			return err
		}
		link = linkJSON(token, expires)
		return ed.changed(e, "event.changed")
	})
	if err != nil {
		return err
	}
	return rq.json(201, link)
}

func (s *Server) handleDeleteLink(rq *Req) error {
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		if ed.W.access(e, ed.Actor) != "full" {
			return errForbidden
		}
		if _, err := ed.Tx.ExecContext(ed.Ctx, `DELETE FROM share_links WHERE event_id = $1`, e.ID); err != nil {
			return err
		}
		return ed.changed(e, "event.changed")
	})
	if err != nil {
		return err
	}
	return rq.noContent()
}

func (s *Server) handleSharedEvent(rq *Req) error {
	dead := apiErr(404, "not_found", "This link no longer works.")
	var id string
	err := s.db.QueryRowContext(rq.ctx(), `SELECT l.event_id FROM share_links l JOIN events e ON e.id = l.event_id
		WHERE l.token = $1 AND l.expires_at > $2 AND NOT e.trashed`, rq.R.PathValue("token"), s.clock.Now()).Scan(&id)
	if err == sql.ErrNoRows {
		return dead
	}
	if err != nil {
		return err
	}
	w, err := rq.World()
	if err != nil {
		return err
	}
	e, err := loadEvent(rq.ctx(), s.db, id)
	if err != nil || e == nil {
		return dead
	}
	if err := attachReplies(rq.ctx(), s.db, []*Event{e}); err != nil {
		return err
	}
	return rq.json(200, w.sharedView(e))
}

func (s *Server) handleZoneMove(rq *Req) error {
	var body struct {
		RuleID string `json:"rule_id"`
	}
	if err := rq.decode(&body); err != nil {
		return err
	}
	var split *SplitResult
	var id string
	err := s.edit(rq.ctx(), rq.Me, func(ed *Edit) error {
		e, err := ed.readableEvent(rq.R.PathValue("id"))
		if err != nil {
			return err
		}
		if ed.W.access(e, ed.Actor) != "full" {
			return errForbidden
		}
		if err := rq.checkVersion(ed, e); err != nil {
			return err
		}
		var first *Occurrence
		if e.recurring() {
			start := e.baseStart()
			for _, o := range ed.W.occurrences(e, Window{From: start.AddDate(0, 0, -1), To: start.AddDate(3, 0, 0)}) {
				if o.Warning != nil && o.Warning.RuleID == body.RuleID {
					first = o
					break
				}
			}
		} else if o := ed.W.firstOccurrence(e); o.Warning != nil && o.Warning.RuleID == body.RuleID {
			first = o
		}
		if first == nil {
			return apiErr(409, "not_warned", "No occurrence of this event carries that zone rule warning.")
		}
		target := e
		if e.recurring() && keyOf(e.baseStart()) != first.Key {
			nominal := wallFromKey(first.Key)
			later, err := ed.split(e, nominal, nominal, nominal.Add(e.baseDuration()))
			if err != nil {
				return err
			}
			if err := ed.touch(e); err != nil {
				return err
			}
			if err := ed.changed(e, "event.changed"); err != nil {
				return err
			}
			target, split = later, &SplitResult{EarlierID: e.ID, LaterID: later.ID}
		}
		target.MovedRules = append(target.MovedRules, body.RuleID)
		if err := ed.touch(target); err != nil {
			return err
		}
		id = target.ID
		return ed.changed(target, "event.changed")
	})
	if err != nil {
		return err
	}
	_, e, access, err := rq.readableFresh(id)
	if err != nil {
		return err
	}
	out := map[string]any{"event": view(rq.world, rq.Me, e, nil, access, true), "split": nil}
	if split != nil {
		out["split"] = split
	}
	rq.etag(e)
	return rq.json(200, out)
}
