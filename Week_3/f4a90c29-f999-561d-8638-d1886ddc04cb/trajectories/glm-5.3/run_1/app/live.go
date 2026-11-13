package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/websocket"
)

// live.go — the change log, the WebSocket and the live fan-out.

type conn struct {
	ws       *websocket.Conn
	personID string
	send     chan []byte
	seq      int64
	lastSeq  int64
}

type Broadcaster struct {
	mu    sync.Mutex
	conns map[*conn]bool
	store *Store
	mu2   sync.Mutex
}

func NewBroadcaster(s *Store) *Broadcaster {
	b := &Broadcaster{conns: map[*conn]bool{}}
	return b
}

func (b *Broadcaster) SetStore(s *Store) { b.mu2.Lock(); b.store = s; b.mu2.Unlock() }

func (b *Broadcaster) storeRef() *Store {
	b.mu2.Lock()
	defer b.mu2.Unlock()
	return b.store
}

// handleLive serves /api/live, replaying missed rows first.
func (a *App) handleLive(resp *apiResponse) error {
	person, err := requirePerson(resp.r.Context(), a.store, resp.r)
	if err != nil {
		return apiErr(401, "unauthenticated", "Sign in first.")
	}
	afterStr := resp.r.URL.Query().Get("after")
	after := int64(0)
	if afterStr != "" {
		fmt.Sscanf(afterStr, "%d", &after)
	}
	ws := websocket.Server{
		Handler: func(ws *websocket.Conn) {
			c := &conn{ws: ws, personID: person.ID, send: make(chan []byte, 64), lastSeq: after}
			a.broadcaster.attach(c, person)
			defer a.broadcaster.detach(c)
			// replay missed rows
			ctx := context.Background()
			rows, err := a.store.ChangesAfter(ctx, after, 1000)
			if err == nil {
				for _, row := range rows {
					if msg, ok := a.projectChange(ctx, person.ID, row); ok {
						c.send <- msg
						c.lastSeq = row.Seq
					}
				}
			}
			// live pump: read side closes on error; write side from store
			done := make(chan struct{})
			go func() {
				defer close(done)
				var msg []byte
				for {
					if err := websocket.Message.Receive(ws, &msg); err != nil {
						return
					}
					// the client sends nothing before opening; ignore anything
				}
			}()
			pump := time.NewTicker(250 * time.Millisecond)
			defer pump.Stop()
			for {
				select {
				case <-done:
					return
				case msg := <-c.send:
					if err := websocket.Message.Send(ws, string(msg)); err != nil {
						return
					}
				case <-pump.C:
					if !a.dbReady {
						continue
					}
					rows, err := a.store.ChangesAfter(ctx, c.lastSeq, 200)
					if err != nil {
						continue
					}
					for _, row := range rows {
						if msg, ok := a.projectChange(ctx, c.personID, row); ok {
							if err := websocket.Message.Send(ws, string(msg)); err != nil {
								return
							}
						}
						c.lastSeq = row.Seq
					}
				}
			}
		},
	}
	wsHandler := websocket.Handler(ws.Handler)
	wsHandler.ServeHTTP(resp.w, resp.r)
	return nil
}

func (b *Broadcaster) attach(c *conn, p *Person) {
	b.mu.Lock()
	b.conns[c] = true
	b.mu.Unlock()
}

func (b *Broadcaster) detach(c *conn) {
	b.mu.Lock()
	delete(b.conns, c)
	b.mu.Unlock()
}

// projectChange sends the row when the person may see it, projected for them.
func (a *App) projectChange(ctx context.Context, personID string, row *ChangeRow) ([]byte, bool) {
	data := map[string]any{}
	if err := jsonUnmarshal(row.Data, &data); err != nil {
		return nil, false
	}
	typ := row.Type
	switch typ {
	case "event.changed", "event.deleted":
		eventID, _ := data["event_id"].(string)
		if eventID == "" {
			return nil, false
		}
		if !a.personSeesEvent(ctx, personID, eventID) {
			return nil, false
		}
		person, _ := a.store.PersonByID(ctx, personID)
		if person == nil {
			return nil, false
		}
		data = a.projectionForPerson(ctx, person, eventID)
		if data == nil {
			return nil, false
		}
		data["event_id"] = eventID
	case "reply.changed", "proposal.changed", "decision", "share.changed", "zone_rule.recorded",
		"reminder.fired", "print.changed", "invitation", "settings.changed":
		if target, _ := data["person_id"].(string); target != "" && target != personID {
			return nil, false
		}
		if ids, ok := data["person_ids"].([]any); ok {
			found := false
			for _, id := range ids {
				if s, _ := id.(string); s == personID {
					found = true
				}
			}
			if !found {
				return nil, false
			}
		}
		if typ == "reply.changed" || typ == "proposal.changed" {
			eventID, _ := data["event_id"].(string)
			if eventID != "" && !a.personSeesEvent(ctx, personID, eventID) {
				return nil, false
			}
		}
	}
	out := map[string]any{
		"seq":  row.Seq,
		"type": typ,
		"data": data,
	}
	b, err := jsonMarshal(out)
	if err != nil {
		return nil, false
	}
	return b, true
}

// personSeesEvent reports whether the person reads the event at all.
func (a *App) personSeesEvent(ctx context.Context, personID, eventID string) bool {
	person, _ := a.store.PersonByID(ctx, personID)
	if person == nil {
		return false
	}
	e, err := a.store.LoadEvent(ctx, eventID)
	if err != nil || e == nil || e.State == "trashed" || e.State == "purged" {
		return false
	}
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	access := a.store.Access(ctx, person, cal, e)
	return access != "none"
}

// projectionForPerson projects an event change for the person's current access.
func (a *App) projectionForPerson(ctx context.Context, person *Person, eventID string) map[string]any {
	e, err := a.store.LoadEvent(ctx, eventID)
	if err != nil || e == nil {
		return nil
	}
	cal, _ := a.store.CalendarByID(ctx, e.CalendarID)
	access := a.store.Access(ctx, person, cal, e)
	if access == "none" {
		return nil
	}
	hours, _ := a.store.OfficeHoursAll(ctx)
	return ProjectEvent(e, nil, access, person, hours)
}

// BroadcastEvent appends an event.changed row.
func (b *Broadcaster) BroadcastEvent(ctx context.Context, e *Event) {
	if e == nil || b.storeRef() == nil {
		return
	}
	people := b.readersOf(ctx, e)
	_, _ = b.storeRef().AppendChangePool(ctx, "event.changed", people, map[string]any{
		"event_id": e.ID, "calendar_id": e.CalendarID,
	}, nil)
}

// BroadcastDelete appends an event.deleted row.
func (b *Broadcaster) BroadcastDelete(ctx context.Context, e *Event, trashID string) {
	if e == nil || b.storeRef() == nil {
		return
	}
	people := b.readersOf(ctx, e)
	_, _ = b.storeRef().AppendChangePool(ctx, "event.deleted", people, map[string]any{
		"event_id": e.ID, "trash_id": trashID,
	}, nil)
}

// BroadcastReply appends a reply.changed row for the event's readers.
func (b *Broadcaster) BroadcastReply(ctx context.Context, e *Event, personID string) {
	if e == nil || b.storeRef() == nil {
		return
	}
	people := b.readersOf(ctx, e)
	_, _ = b.storeRef().AppendChangePool(ctx, "reply.changed", people, map[string]any{
		"event_id": e.ID, "person_id": personID,
	}, nil)
}

func (b *Broadcaster) BroadcastProposal(ctx context.Context, e *Event, proposalID string, proposer *Person) {
	if e == nil || b.storeRef() == nil {
		return
	}
	people := append(b.readersOf(ctx, e), e.OrganiserID)
	_, _ = b.storeRef().AppendChangePool(ctx, "proposal.changed", people, map[string]any{
		"event_id": e.ID, "proposal_id": proposalID, "person_id": proposer.ID,
	}, nil)
}

// PushPersonal writes a row targeted at one person.
func (b *Broadcaster) PushPersonal(_ *Person, personID, typ string, data map[string]any) {
	if b.storeRef() == nil {
		return
	}
	data = copyMap(data)
	data["person_id"] = personID
	_, _ = b.storeRef().AppendChangePool(context.Background(), typ, []string{personID}, data, nil)
}

func copyMap(m map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range m {
		out[k] = v
	}
	return out
}

// PushDecision writes a decision change-log row with its decision id, so
// screens announce it once even across reconnects.
func (b *Broadcaster) PushDecision(ctx context.Context, e *Event, personID, kind, text string) {
	if e == nil || b.storeRef() == nil {
		return
	}
	decisionID := fmt.Sprintf("dec-%d", time.Now().UnixNano())
	people := append(b.readersOf(ctx, e), personID)
	data := map[string]any{
		"event_id": e.ID, "person_id": personID, "kind": kind,
		"text": text, "person_ids": people,
	}
	_, _ = b.storeRef().AppendChangePool(ctx, "decision", people, data, &decisionID)
	// one notice per person
	for _, p := range people {
		if p == "" {
			continue
		}
		_ = b.storeRef().InsertNoticePool(ctx, p, "decision", text, &decisionID)
	}
}

func (b *Broadcaster) PushDecisionForProposal(ctx context.Context, e *Event, row struct {
	EventID      string
	OccurrenceID string
	ProposerID   string
	StartLocal   string
	EndLocal     string
	Status       string
}, accept bool, text, deciderID string) {
	if b.storeRef() == nil {
		return
	}
	decisionID := fmt.Sprintf("dec-%d", time.Now().UnixNano())
	people := append(b.readersOf(ctx, e), row.ProposerID)
	data := map[string]any{
		"event_id": e.ID, "person_id": row.ProposerID,
		"kind": "accept", "text": text, "person_ids": people,
	}
	if !accept {
		data["kind"] = "decline"
	}
	_, _ = b.storeRef().AppendChangePool(ctx, "decision", people, data, &decisionID)
	for _, p := range people {
		if p == "" {
			continue
		}
		_ = b.storeRef().InsertNoticePool(ctx, p, "decision", text, &decisionID)
	}
}

// PushAccessChange writes a share.changed row for the affected colleague.
func (b *Broadcaster) PushAccessChange(ctx context.Context, personID string, cal *Calendar, level string, granted bool) {
	if b.storeRef() == nil {
		return
	}
	data := map[string]any{
		"person_id": personID, "calendar_id": cal.ID, "calendar_name": cal.Name,
	}
	if granted {
		data["level"] = level
	} else {
		data["level"] = ""
	}
	_, _ = b.storeRef().AppendChangePool(ctx, "share.changed", []string{personID}, data, nil)
}

func (b *Broadcaster) BroadcastZoneRule(ctx context.Context, rule *ZoneRule) {
	if rule == nil || b.storeRef() == nil {
		return
	}
	people, _ := b.storeRef().AllPeople(ctx)
	ids := []string{}
	for _, p := range people {
		if p.Role != "guest" {
			ids = append(ids, p.ID)
		}
	}
	_, _ = b.storeRef().AppendChangePool(ctx, "zone_rule.recorded", ids, map[string]any{
		"rule": map[string]any{
			"id": rule.ID, "zone": rule.Zone, "city": rule.City,
			"effective_date": rule.EffectiveDate, "new_offset": rule.NewOffset,
			"note": rule.Note,
		},
	}, nil)
}

// readersOf gives everyone who may read the event.
func (b *Broadcaster) readersOf(ctx context.Context, e *Event) []string {
	s := b.storeRef()
	if s == nil || e == nil {
		return nil
	}
	people, err := s.AllPeople(ctx)
	if err != nil {
		return nil
	}
	out := []string{}
	for _, p := range people {
		if e.OrganiserID == p.ID {
			out = append(out, p.ID)
			continue
		}
		if IsGuest(e, p.ID) {
			out = append(out, p.ID)
			continue
		}
		cal, _ := s.CalendarByID(ctx, e.CalendarID)
		if cal == nil {
			continue
		}
		if cal.ReadOnly {
			out = append(out, p.ID)
			continue
		}
		if cal.OwnerID != nil && *cal.OwnerID == p.ID {
			out = append(out, p.ID)
			continue
		}
		if level, _ := s.ShareLevel(ctx, cal.ID, p.ID); level != "" {
			out = append(out, p.ID)
		}
	}
	return out
}

// Search --------------------------------------------------------------------

func (a *App) handleSearch(ctx context.Context, resp *apiResponse, person *Person, q string) error {
	q = strings.TrimSpace(q)
	if len(q) < 2 {
		return apiFieldErr("Type at least 2 characters to search.", map[string]string{"q": "Type at least 2 characters to search."})
	}
	person_ := person
	cals, _ := a.store.AllCalendars(ctx)
	people, _ := a.store.AllPeople(ctx)
	nameOf := map[string]string{}
	for _, p := range people {
		nameOf[p.ID] = p.Name
	}
	_ = person_
	var results []map[string]any
	now := a.clock.Now()
	type scored struct {
		result  map[string]any
		instant time.Time
		id      string
	}
	var scoredList []scored
	for _, cal := range cals {
		events, err := a.store.EventsOfCalendar(ctx, cal.ID)
		if err != nil {
			return err
		}
		for _, e := range events {
			access := a.store.Access(ctx, person, cal, e)
			if access != "full" && access != "guest" && access != "details" {
				continue
			}
			matchEvent := containsFold(e.Title, q) || containsFold(e.Location, q) || containsFold(e.Notes, q)
			guestMatch := false
			if GuestListVisible(access, e) {
				for _, g := range e.Guests {
					if containsFold(g.Name, q) {
						guestMatch = true
					}
				}
			}
			rule := e.Rule()
			var namedOcc *Occurrence
			if matchEvent || guestMatch {
				if rule == nil {
					o := buildOccurrence(e, e.StartDate)
					namedOcc = o
				} else {
					rules, _ := a.store.ZoneRules(ctx)
					moved := map[string]bool{}
					occs := GenOccurrences(e, mustDate("1900-01-01"), mustDate("9999-12-31"), rules, moved)
					// next undeleted occurrence at or after now
					for _, o := range occs {
						if o.IsDeleted {
							continue
						}
						inst := occInstants(o).start
						if !inst.Before(now) {
							namedOcc = o
							break
						}
					}
					if namedOcc == nil {
						for i := len(occs) - 1; i >= 0; i-- {
							if !occs[i].IsDeleted {
								namedOcc = occs[i]
								break
							}
						}
					}
				}
			}
			if namedOcc == nil && !matchEvent && !guestMatch {
				// a series may match only through modified exceptions
				for _, ex := range e.Exceptions {
					if ex.Deleted || ex.Title == nil {
						continue
					}
					if containsFold(*ex.Title, q) ||
						(ex.Location != nil && containsFold(*ex.Location, q)) ||
						(ex.Notes != nil && containsFold(*ex.Notes, q)) {
						o := &Occurrence{
							EventID: e.ID, OccurrenceID: ex.OccurrenceID, Title: *ex.Title,
							AllDay: e.AllDay, StartDate: derefStr(ex.StartDate, e.StartDate),
							StartMinutes: derefIntP(ex.StartMinutes, e.StartMinutes),
							Zone:         e.Zone,
						}
						namedOcc = o
						break
					}
				}
			}
			if namedOcc == nil {
				continue
			}
			inst := occInstants(namedOcc).start
			scoredList = append(scoredList, scored{
				result: map[string]any{
					"event_id": e.ID, "occurrence_id": namedOcc.OccurrenceID,
					"title": namedOcc.Title, "start_local": occStartLocal(namedOcc),
					"zone": namedOcc.Zone, "calendar_id": e.CalendarID,
				},
				instant: inst, id: e.ID,
			})
		}
	}
	sort.SliceStable(scoredList, func(i, j int) bool {
		if !scoredList[i].instant.Equal(scoredList[j].instant) {
			return scoredList[i].instant.Before(scoredList[j].instant)
		}
		return scoredList[i].id < scoredList[j].id
	})
	for i, s := range scoredList {
		if i >= 50 {
			break
		}
		results = append(results, s.result)
	}
	if results == nil {
		results = []map[string]any{}
	}
	return writeOkBody(resp, map[string]any{"results": results})
}

func containsFold(haystack, needle string) bool {
	return strings.Contains(strings.ToLower(haystack), strings.ToLower(needle))
}

func derefStr(p *string, def string) string {
	if p == nil {
		return def
	}
	return *p
}

func derefIntP(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}

// Find a time ---------------------------------------------------------------

type busyWindow struct {
	start, end    time.Time
	message       string
	publishedCopy string
	kind          string
}

// declineWindowsOf lists a person's out-of-office and focus windows.
func (s *Store) declineWindowsOf(ctx context.Context, personID string, excludeEventID string) ([]*busyWindow, error) {
	cals, err := s.AllCalendars(ctx)
	if err != nil {
		return nil, err
	}
	own := map[string]bool{}
	for _, c := range cals {
		if c.OwnerID != nil && *c.OwnerID == personID {
			own[c.ID] = true
		}
	}
	var events []*Event
	for calID := range own {
		evs, err := s.EventsOfCalendar(ctx, calID)
		if err != nil {
			return nil, err
		}
		events = append(events, evs...)
	}
	var out []*busyWindow
	for _, e := range events {
		if e.OrganiserID != personID {
			continue
		}
		if e.Kind != "focus" && e.Kind != "out_of_office" {
			continue
		}
		if e.ID == excludeEventID {
			continue
		}
		message := ""
		if e.DeclineMessage != nil {
			message = *e.DeclineMessage
		}
		if e.Kind == "out_of_office" {
			person, _ := s.PersonByID(ctx, personID)
			lastDay := e.EndDate
			copy_ := fmt.Sprintf("%s is out of office until %s, so this was declined automatically.", personNameOf(person), longDateOf(lastDay))
			if !e.AllDay {
				copy_ = fmt.Sprintf("%s is out of office until %s, so this was declined automatically.", personNameOf(person), longDateOf(lastDay))
			}
			out = append(out, &busyWindow{message: message, publishedCopy: copy_, kind: e.Kind, end: time.Time{}})
			w := out[len(out)-1]
			w.start, w.end = windowBounds(e)
		} else {
			person, _ := s.PersonByID(ctx, personID)
			copy_ := fmt.Sprintf("%s is in focus time until %s, so this was declined automatically.", personNameOf(person), minutesHM(e.EndMinutes))
			out = append(out, &busyWindow{message: message, publishedCopy: copy_, kind: e.Kind})
			w := out[len(out)-1]
			w.start, w.end = windowBounds(e)
		}
	}
	return out, nil
}

func longDateOf(date string) string {
	d, ok := ParseDate(date)
	if !ok {
		return date
	}
	return d.Format("Mon 2 Jan 2006")
}

// windowBounds gives the instants a whole event's occurrences cover. An
// all-day window covers its dates from local midnight to local midnight in
// its zone.
func windowBounds(e *Event) (time.Time, time.Time) {
	if e.AllDay {
		start, _, _ := InstantFromLocal(e.Zone, e.StartDate, 0)
		end, _, _ := InstantFromLocal(e.Zone, e.EndDate, 0)
		return start, end.Add(24 * time.Hour)
	}
	return InstantFromLocalOr(e.Zone, e.StartDate, e.StartMinutes), InstantFromLocalOr(e.Zone, e.EndDate, e.EndMinutes)
}

func (a *App) handleFindATime(ctx context.Context, resp *apiResponse, person *Person, q map[string][]string) error {
	if person.Role == "guest" {
		return apiErr(403, "forbidden", "Guests may not find a time.")
	}
	get := func(k string) string {
		if v, ok := q[k]; ok && len(v) > 0 {
			return v[0]
		}
		return ""
	}
	peopleParam := get("people")
	minutesParam := get("minutes")
	fromStr, toStr := get("from"), get("to")
	fields := map[string]string{}
	personIDs := []string{}
	for _, s := range strings.Split(peopleParam, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			personIDs = append(personIDs, s)
		}
	}
	minutes := 0
	if n, err := fmt.Sscanf(minutesParam, "%d", &minutes); err != nil || n != 1 {
		fields["minutes"] = "Minutes must be a number."
	}
	if minutes%15 != 0 || minutes < 15 || minutes > 480 {
		fields["minutes"] = "Minutes must be a multiple of 15 from 15 to 480."
	}
	from, ok1 := ParseDate(fromStr)
	to, ok2 := ParseDate(toStr)
	if !ok1 {
		fields["from"] = "Use YYYY-MM-DD."
	}
	if !ok2 {
		fields["to"] = "Use YYYY-MM-DD."
	}
	if ok1 && ok2 {
		days := to.Sub(from).Hours()/24 + 1
		if days < 1 || days > 31 {
			fields["to"] = "That range must be at most 31 days."
		}
	}
	if len(fields) > 0 {
		return apiFieldErr("Check the fields and try again.", fields)
	}
	// the checked people are those named plus the caller
	checked := append([]string{person.ID}, personIDs...)
	blocksByPerson := map[string][][2]time.Time{}
	people, _ := a.store.AllPeople(ctx)
	personZone := map[string]string{}
	for _, p := range people {
		personZone[p.ID] = p.Zone
	}
	for _, pid := range checked {
		blocks, err := a.busyBlocksOf(ctx, pid)
		if err != nil {
			return err
		}
		blocksByPerson[pid] = blocks
	}
	// slot starts: every 15 real minutes from midnight at the start of from
	rangeStart := midnightInZone(person.Zone, fromStr)
	rangeEnd := midnightInZone(person.Zone, toStr).Add(24 * time.Hour)
	type slot struct {
		start, end time.Time
	}
	var slots []slot
	for t := rangeStart; !t.Add(time.Duration(minutes) * time.Minute).After(rangeEnd); t = t.Add(15 * time.Minute) {
		s := slot{t, t.Add(time.Duration(minutes) * time.Minute)}
		ok := true
		for _, pid := range checked {
			zone := personZone[pid]
			if zone == "" {
				ok = false
				break
			}
			// both ends inside that person's office hours and on one date
			if !insideWorkingHours(s.start, zone) || !insideWorkingHoursEnd(s.end, zone) {
				ok = false
				break
			}
			if InZone(s.start, zone).Format("2006-01-02") != InZone(s.end, zone).Format("2006-01-02") &&
				!(InZone(s.end, zone).Hour() == 0 && InZone(s.end, zone).Minute() == 0 && InZone(s.end, zone).Format("2006-01-02") > InZone(s.start, zone).Format("2006-01-02")) {
				ok = false
				break
			}
			for _, b := range blocksByPerson[pid] {
				if overlap(s.start, s.end, b[0], b[1]) {
					ok = false
					break
				}
			}
			if !ok {
				break
			}
		}
		if ok {
			slots = append(slots, s)
			if len(slots) >= 20 {
				break
			}
		}
	}
	slotOut := []map[string]any{}
	for _, s := range slots {
		slotOut = append(slotOut, map[string]any{
			"start_utc": s.start.UTC().Format(time.RFC3339),
			"end_utc":   s.end.UTC().Format(time.RFC3339),
			"clocks":    threeClocks(s.start),
		})
	}
	busyOut := []map[string]any{}
	for _, pid := range checked {
		p, _ := a.store.PersonByID(ctx, pid)
		if p == nil {
			continue
		}
		var blocks []map[string]any = []map[string]any{}
		for _, b := range blocksByPerson[pid] {
			cs := b[0]
			ce := b[1]
			if cs.Before(rangeStart) {
				cs = rangeStart
			}
			if ce.After(rangeEnd) {
				ce = rangeEnd
			}
			if !cs.Before(ce) {
				continue
			}
			blocks = append(blocks, map[string]any{
				"start_utc": cs.UTC().Format(time.RFC3339),
				"end_utc":   ce.UTC().Format(time.RFC3339),
			})
		}
		busyOut = append(busyOut, map[string]any{
			"person_id": pid, "name": p.Name, "blocks": blocks,
		})
	}
	return writeOkBody(resp, map[string]any{"slots": slotOut, "busy": busyOut})
}

// busyBlocksOf merges the occurrences that block a person.
func (a *App) busyBlocksOf(ctx context.Context, personID string) ([][2]time.Time, error) {
	person, err := a.store.PersonByID(ctx, personID)
	if err != nil || person == nil {
		return nil, err
	}
	var blocks [][2]time.Time
	cals, _ := a.store.AllCalendars(ctx)
	rules, _ := a.store.ZoneRules(ctx)
	for _, cal := range cals {
		if cal.ReadOnly || cal.ID == "cal-holidays" {
			continue
		}
		if cal.OwnerID == nil || *cal.OwnerID != person.ID {
			continue
		}
		events, err := a.store.EventsOfCalendar(ctx, cal.ID)
		if err != nil {
			return nil, err
		}
		for _, e := range events {
			moved := map[string]bool{}
			for _, r := range e.MovedRules {
				moved[r] = true
			}
			occs := GenOccurrences(e, mustDate("1900-01-01"), mustDate("9999-12-31"), rules, moved)
			for _, o := range occs {
				p := occInstants(o)
				blocks = append(blocks, [2]time.Time{p.start, p.end})
			}
		}
	}
	// occurrences where the person is a guest answering yes or maybe
	guestEvents, err := a.store.EventsOfGuest(ctx, person.ID)
	if err != nil {
		return nil, err
	}
	for _, e := range guestEvents {
		if cal, _ := a.store.CalendarByID(ctx, e.CalendarID); cal != nil && cal.ReadOnly {
			continue
		}
		moved := map[string]bool{}
		for _, r := range e.MovedRules {
			moved[r] = true
		}
		occs := GenOccurrences(e, mustDate("1900-01-01"), mustDate("9999-12-31"), rules, moved)
		for _, o := range occs {
			answer := ReplyFor(e, person.ID, o.OccurrenceID)
			if answer != "yes" && answer != "maybe" {
				continue
			}
			p := occInstants(o)
			blocks = append(blocks, [2]time.Time{p.start, p.end})
		}
	}
	sort.Slice(blocks, func(i, j int) bool { return blocks[i][0].Before(blocks[j][0]) })
	var merged [][2]time.Time
	for _, b := range blocks {
		if len(merged) > 0 && !b[0].After(merged[len(merged)-1][1]) {
			if b[1].After(merged[len(merged)-1][1]) {
				merged[len(merged)-1][1] = b[1]
			}
			continue
		}
		merged = append(merged, b)
	}
	return merged, nil
}

func insideWorkingHoursEnd(t time.Time, zone string) bool {
	if officeHoursCache == nil {
		return false
	}
	h, ok := officeHoursCache[zone]
	if !ok {
		return false
	}
	loc := InZone(t, zone)
	wd := int(loc.Weekday())
	if wd == 0 {
		wd = 7
	}
	dayOK := false
	for _, d := range h.Days {
		if d == wd {
			dayOK = true
		}
	}
	if !dayOK {
		return false
	}
	minutes := loc.Hour()*60 + loc.Minute()
	open, _ := MinutesFromMidnight(h.Open)
	close_, _ := MinutesFromMidnight(h.Close)
	return minutes > open && minutes <= close_
}

var _ = json.Marshal
var _ = log.Print
var _ = http.MethodGet
