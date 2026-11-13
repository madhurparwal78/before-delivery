package main

import (
	"sort"
	"strings"

	"github.com/lib/pq"
)

type searchHit struct {
	event *Event
	occ   *Occurrence
}

func contains(haystack, needle string) bool {
	return strings.Contains(strings.ToLower(haystack), needle)
}

func (s *Server) handleSearch(rq *Req) error {
	q := strings.TrimSpace(rq.R.URL.Query().Get("q"))
	if len([]rune(q)) < 2 {
		return fieldErr("q", "Type at least 2 characters to search.")
	}
	w, err := rq.World()
	if err != nil {
		return err
	}
	needle := strings.ToLower(q)
	readable := pq.StringArray{}
	for id, c := range w.Calendars {
		if w.canRead(c, rq.Me) {
			readable = append(readable, id)
		}
	}
	events, err := loadEvents(rq.ctx(), s.db, `NOT trashed AND (calendar_id = ANY($1) OR id IN (SELECT event_id FROM guests WHERE person_id = $2))
		AND (position($3 in lower(title)) > 0 OR position($3 in lower(location)) > 0 OR position($3 in lower(notes)) > 0
		 OR EXISTS (SELECT 1 FROM exceptions x WHERE x.event_id = events.id AND NOT x.deleted AND position($3 in lower(x.over::text)) > 0)
		 OR EXISTS (SELECT 1 FROM guests g JOIN people p ON p.id = g.person_id WHERE g.event_id = events.id AND position($3 in lower(p.name)) > 0))`,
		readable, rq.Me.ID, needle)
	if err != nil {
		return err
	}
	var hits []searchHit
	for _, e := range events {
		access := w.access(e, rq.Me)
		if access == "" || access == "busy" {
			continue
		}
		guestsVisible := View{E: e, Access: access}.canSeeGuests()
		own := contains(e.Title, needle) || contains(e.Location, needle) || contains(e.Notes, needle)
		if !own && guestsVisible {
			for _, g := range e.GuestIDs {
				if contains(w.People[g].Name, needle) {
					own = true
				}
			}
		}
		var occ *Occurrence
		switch {
		case !e.recurring():
			if own {
				occ = w.firstOccurrence(e)
			}
		case own:
			occ = w.nextOrLast(e)
		default:
			for _, key := range sortedKeys(e.Exceptions) {
				x := e.Exceptions[key]
				if x.Deleted {
					continue
				}
				matched := false
				for _, f := range []string{"title", "location", "notes"} {
					matched = matched || contains(x.Over[f], needle)
				}
				if o := w.build(e, wallFromKey(key)); matched && o != nil && (occ == nil || o.Begin.Before(occ.Begin)) {
					occ = o
				}
			}
		}
		if occ != nil {
			hits = append(hits, searchHit{e, occ})
		}
	}
	sort.Slice(hits, func(i, j int) bool {
		if !hits[i].occ.Begin.Equal(hits[j].occ.Begin) {
			return hits[i].occ.Begin.Before(hits[j].occ.Begin)
		}
		return hits[i].event.ID < hits[j].event.ID
	})
	if len(hits) > 50 {
		hits = hits[:50]
	}
	results := []map[string]any{}
	for _, h := range hits {
		fields := w.project(View{Viewer: rq.Me, E: h.event, O: h.occ, Access: w.access(h.event, rq.Me), ForOccurrence: true, Key: h.occ.ReplyKey()})
		results = append(results, pick(fields, "event_id", "occurrence_id", "title", "start_local", "zone", "calendar_id"))
	}
	return rq.json(200, map[string]any{"results": results})
}

// nextOrLast is a series' next live occurrence at or after the server clock, else its last.
func (w *World) nextOrLast(e *Event) *Occurrence {
	if occs := w.occurrences(e, Window{From: w.Now, To: w.Now.AddDate(3, 0, 0)}); len(occs) > 0 {
		return occs[0]
	}
	var last *Occurrence
	if occs := w.occurrences(e, Window{From: e.baseStart().AddDate(-1, 0, 0), To: w.Now}); len(occs) > 0 {
		last = occs[len(occs)-1]
	}
	return last
}
