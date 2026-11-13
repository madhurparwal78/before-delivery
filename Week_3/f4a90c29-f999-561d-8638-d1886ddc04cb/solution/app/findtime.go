package main

import (
	"sort"
	"strconv"
	"strings"
	"time"
)

type span struct{ from, to time.Time }

// blocks lists the intervals that block a person: their calendar's occurrences and yes or maybe meetings.
func (s *Server) blocksOf(rq *Req, w *World, p *Person, win Window) ([]span, error) {
	events, err := loadEvents(rq.ctx(), s.db, `NOT trashed AND (calendar_id IN (SELECT id FROM calendars WHERE owner_id = $1)
		OR id IN (SELECT event_id FROM guests WHERE person_id = $1))`, p.ID)
	if err != nil {
		return nil, err
	}
	if err := attachReplies(rq.ctx(), s.db, events); err != nil {
		return nil, err
	}
	var out []span
	for _, e := range events {
		owned := w.organiser(e) != nil && w.organiser(e).ID == p.ID
		for _, o := range w.occurrences(e, win) {
			if !owned {
				if status, _ := e.replyFor(p.ID, o.ReplyKey()); status != "yes" && status != "maybe" {
					continue
				}
			}
			out = append(out, span{o.Begin, o.Finish})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].from.Before(out[j].from) })
	return out, nil
}

func merge(blocks []span) []span {
	var out []span
	for _, b := range blocks {
		if n := len(out); n > 0 && !b.from.After(out[n-1].to) {
			if b.to.After(out[n-1].to) {
				out[n-1].to = b.to
			}
			continue
		}
		out = append(out, b)
	}
	return out
}

func (s *Server) handleFindATime(rq *Req) error {
	if rq.Me.Role == "guest" {
		return errForbidden
	}
	q := rq.R.URL.Query()
	w, err := rq.World()
	if err != nil {
		return err
	}
	errs := map[string]string{}
	var people []*Person
	seen := map[string]bool{}
	for _, id := range strings.Split(q.Get("people"), ",") {
		if id == "" || seen[id] {
			continue
		}
		p := w.People[id]
		if p == nil || p.Role == "guest" {
			errs["people"] = "Choose colleagues from the list."
			continue
		}
		seen[id] = true
		people = append(people, p)
	}
	if !seen[rq.Me.ID] {
		people = append(people, rq.Me)
	}
	minutes, merr := strconv.Atoi(q.Get("minutes"))
	if merr != nil || minutes < 15 || minutes > 480 || minutes%15 != 0 {
		errs["minutes"] = "Use a multiple of 15 from 15 to 480."
	}
	from, ferr := parseDate(q.Get("from"))
	to, terr := parseDate(q.Get("to"))
	if ferr != nil {
		errs["from"] = "Use YYYY-MM-DD."
	}
	if terr != nil {
		errs["to"] = "Use YYYY-MM-DD."
	} else if ferr == nil && (to.Before(from) || to.Sub(from) > 30*24*time.Hour) {
		errs["to"] = "Use a date from the start date to at most 31 days."
	}
	if len(errs) > 0 {
		return fieldErrors(errs)
	}
	loc := zoneLocations[rq.Me.Zone]
	begin, _, _ := resolveLocal(loc, from, nil)
	finish, _, _ := resolveLocal(loc, to.AddDate(0, 0, 1), nil)
	win := Window{From: begin, To: finish}
	blocked := map[string][]span{}
	busy := []map[string]any{}
	for _, p := range people {
		blocks, err := s.blocksOf(rq, w, p, win)
		if err != nil {
			return err
		}
		blocked[p.ID] = merge(blocks)
		rows := []map[string]string{}
		for _, b := range blocked[p.ID] {
			if b.to.After(begin) && b.from.Before(finish) {
				a, z := b.from, b.to
				if a.Before(begin) {
					a = begin
				}
				if z.After(finish) {
					z = finish
				}
				rows = append(rows, map[string]string{"start_utc": a.UTC().Format(time.RFC3339), "end_utc": z.UTC().Format(time.RFC3339)})
			}
		}
		busy = append(busy, map[string]any{"person_id": p.ID, "name": p.Name, "blocks": rows})
	}
	step := time.Duration(minutes) * time.Minute
	slots := []map[string]any{}
	for t := begin; !t.Add(step).After(finish) && len(slots) < 20; t = t.Add(15 * time.Minute) {
		end := t.Add(step)
		free := true
		for _, p := range people {
			ploc := zoneLocations[p.Zone]
			hours := w.hasHours(p.Zone)
			startWall, endWall := wallOf(t, ploc), wallOf(end, ploc)
			if !hours.insideHours(startWall, false) || !hours.insideHours(endWall, true) {
				free = false
				break
			}
			for _, b := range blocked[p.ID] {
				if b.from.Before(end) && b.to.After(t) {
					free = false
					break
				}
			}
			if !free {
				break
			}
		}
		if !free {
			continue
		}
		slots = append(slots, map[string]any{"start_utc": t.UTC().Format(time.RFC3339), "end_utc": end.UTC().Format(time.RFC3339), "clocks": clockList(w.clocksAt(t, nil))})
	}
	return rq.json(200, map[string]any{"slots": slots, "busy": busy})
}
