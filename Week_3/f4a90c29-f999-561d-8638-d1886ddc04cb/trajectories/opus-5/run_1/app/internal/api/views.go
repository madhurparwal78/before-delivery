package api

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"time"

	"sundialwren/internal/domain"
)

const maxWindowDays = 366

// handleOccurrences lists the occurrences of a window, ordered by start.
func (s *Server) handleOccurrences(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	from, to, ok := s.readWindow(w, r, c, maxWindowDays, false)
	if !ok {
		return
	}
	calendars := queryList(r, "calendars")
	if calendars == nil {
		for id := range c.Viewer.Levels {
			if id != domain.HolidaysCalendarID {
				calendars = append(calendars, id)
			}
		}
	} else {
		var readable []string
		for _, id := range calendars {
			if _, ok := c.Viewer.Levels[id]; ok {
				readable = append(readable, id)
			}
		}
		calendars = readable
	}
	events, err := s.Store.LiveEvents(r.Context(), calendars, c.Person.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	type row struct {
		body  map[string]any
		start time.Time
	}
	var rows []row
	for _, e := range events {
		if !c.Viewer.CanRead(e) {
			continue
		}
		for _, o := range c.Expander.ExpandRange(e, from, to) {
			start, _ := o.Instants()
			rows = append(rows, row{body: c.Projector.Occurrence(o), start: start})
		}
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].start.Before(rows[j].start) })
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.body)
	}
	writeJSON(w, http.StatusOK, map[string]any{"occurrences": out})
}

// readWindow reads a from and to date range in the caller's zone.
func (s *Server) readWindow(w http.ResponseWriter, r *http.Request, c *Context, maxDays int, inclusive bool) (time.Time, time.Time, bool) {
	fromRaw := r.URL.Query().Get("from")
	toRaw := r.URL.Query().Get("to")
	fromDate, err := domain.ParseDate(fromRaw)
	if err != nil {
		unprocessable(w, map[string]string{"from": dateFormat})
		return time.Time{}, time.Time{}, false
	}
	toDate, err := domain.ParseDate(toRaw)
	if err != nil {
		unprocessable(w, map[string]string{"to": dateFormat})
		return time.Time{}, time.Time{}, false
	}
	if inclusive {
		toDate = toDate.AddDays(1)
	}
	days := fromDate.MinutesUntil(toDate) / (24 * 60)
	if days <= 0 || days > maxDays {
		unprocessable(w, map[string]string{"to": "Ask for a range of 1 to " + itoa(maxDays) + " days."})
		return time.Time{}, time.Time{}, false
	}
	zone := c.Person.Zone
	return domain.StartOfDay(fromDate, zone), domain.StartOfDay(toDate, zone), true
}

// handleSearch matches title, location, notes and readable guest names.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		unprocessable(w, map[string]string{"q": "Type at least 2 characters to search."})
		return
	}
	needle := strings.ToLower(q)
	events, err := s.Store.AllLiveEvents(r.Context())
	if err != nil {
		s.fail(w, err)
		return
	}
	type result struct {
		body  map[string]any
		start time.Time
		id    string
	}
	var results []result
	for _, e := range events {
		access := c.Viewer.Access(e)
		switch access {
		case domain.AccessFull, domain.AccessGuest, domain.AccessDetails:
		default:
			continue
		}
		named := s.matchEvent(c, e, needle)
		if named == nil {
			continue
		}
		start, _ := named.Instants()
		results = append(results, result{
			body: map[string]any{
				"event_id": e.ID, "occurrence_id": named.ID(), "title": named.Title,
				"start_local": named.ShownStart.Local(e.AllDay), "zone": e.Zone, "calendar_id": e.CalendarID,
			},
			start: start, id: e.ID,
		})
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].start.Equal(results[j].start) {
			return results[i].id < results[j].id
		}
		return results[i].start.Before(results[j].start)
	})
	if len(results) > 50 {
		results = results[:50]
	}
	out := make([]map[string]any, 0, len(results))
	for _, res := range results {
		out = append(out, res.body)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": out})
}

// matchEvent reports which occurrence a search names, or nothing when the
// event does not match.
func (s *Server) matchEvent(c *Context, e *domain.Event, needle string) *domain.Occurrence {
	ownMatch := hasText(e.Title, needle) || hasText(e.Location, needle) || hasText(e.Notes, needle)
	if !ownMatch && c.Viewer.SeesGuestList(e) {
		for _, g := range e.Guests {
			if hasText(g.Name, needle) {
				ownMatch = true
				break
			}
		}
	}
	if ownMatch {
		if !e.IsSeries() {
			start, _ := domain.ParseLocal(e.StartLocal, e.AllDay)
			return c.Expander.One(e, start.Key())
		}
		return c.Expander.NextOccurrence(e, c.Now)
	}
	// A series can match only through one of its modified exceptions, and then
	// names the earliest of them.
	horizon := domain.WallFromUTC(c.Now.AddDate(2, 0, 0))
	for _, o := range c.Expander.Expand(e, &horizon, 0) {
		if o.Deleted || !o.IsException {
			continue
		}
		if hasText(o.Title, needle) || hasText(o.Location, needle) || hasText(o.Notes, needle) {
			return o
		}
	}
	return nil
}

func hasText(haystack, needle string) bool {
	return haystack != "" && strings.Contains(strings.ToLower(haystack), needle)
}

// handleFindATime lists the earliest common slots inside everyone's working
// hours.
func (s *Server) handleFindATime(w http.ResponseWriter, r *http.Request) {
	c := s.caller(w, r)
	if c == nil {
		return
	}
	if c.Person.Role == domain.RoleGuest {
		forbidden(w, "forbidden")
		return
	}
	minutes, ok := queryInt(r, "minutes", 30)
	if !ok || minutes < 15 || minutes > 480 || minutes%15 != 0 {
		unprocessable(w, map[string]string{"minutes": "Choose a whole quarter hour from 15 to 480 minutes."})
		return
	}
	from, to, ok := s.readWindow(w, r, c, 31, true)
	if !ok {
		return
	}
	var people []domain.Person
	for _, id := range queryList(r, "people") {
		person, err := s.Store.Person(r.Context(), id)
		if err != nil {
			unprocessable(w, map[string]string{"people": "Choose people from the firm."})
			return
		}
		people = append(people, person)
	}
	checked := append([]domain.Person{}, people...)
	checked = append(checked, c.Person)

	type busyBlock struct{ start, end time.Time }
	blocksFor := map[string][]busyBlock{}
	for _, person := range checked {
		if _, ok := blocksFor[person.ID]; ok {
			continue
		}
		events, err := s.Store.EventsBlocking(r.Context(), person.ID)
		if err != nil {
			s.fail(w, err)
			return
		}
		owned, err := s.ownedCalendars(r.Context(), person.ID)
		if err != nil {
			s.fail(w, err)
			return
		}
		var blocks []busyBlock
		for _, e := range events {
			for _, o := range c.Expander.ExpandRange(e, from, to) {
				if !blocks_(e, o, person.ID, owned) {
					continue
				}
				start, end := o.Instants()
				if start.Before(from) {
					start = from
				}
				if end.After(to) {
					end = to
				}
				if !end.After(start) {
					continue
				}
				blocks = append(blocks, busyBlock{start, end})
			}
		}
		sort.Slice(blocks, func(i, j int) bool { return blocks[i].start.Before(blocks[j].start) })
		var merged []busyBlock
		for _, b := range blocks {
			if len(merged) > 0 && !b.start.After(merged[len(merged)-1].end) {
				if b.end.After(merged[len(merged)-1].end) {
					merged[len(merged)-1].end = b.end
				}
				continue
			}
			merged = append(merged, b)
		}
		blocksFor[person.ID] = merged
	}

	var slots []map[string]any
	span := time.Duration(minutes) * time.Minute
	for at := from; !at.Add(span).After(to) && len(slots) < 20; at = at.Add(15 * time.Minute) {
		end := at.Add(span)
		fits := true
		for _, person := range checked {
			if !slotFits(person, at, end, c.Settings) {
				fits = false
				break
			}
			for _, b := range blocksFor[person.ID] {
				if b.end.After(at) && b.start.Before(end) {
					fits = false
					break
				}
			}
			if !fits {
				break
			}
		}
		if !fits {
			continue
		}
		slots = append(slots, map[string]any{
			"start_utc": at.UTC().Format(time.RFC3339),
			"end_utc":   end.UTC().Format(time.RFC3339),
			"clocks":    domain.ClocksAt(at, c.Settings, "", domain.Wall{}, false),
		})
	}
	busy := make([]map[string]any, 0, len(checked))
	seen := map[string]bool{}
	for _, person := range checked {
		if seen[person.ID] {
			continue
		}
		seen[person.ID] = true
		rows := make([]map[string]any, 0, len(blocksFor[person.ID]))
		for _, b := range blocksFor[person.ID] {
			rows = append(rows, map[string]any{
				"start_utc": b.start.UTC().Format(time.RFC3339),
				"end_utc":   b.end.UTC().Format(time.RFC3339),
			})
		}
		busy = append(busy, map[string]any{"person_id": person.ID, "name": person.Name, "blocks": rows})
	}
	if slots == nil {
		slots = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"slots": slots, "busy": busy})
}

// slotFits reports whether a slot's start and end are both inside a person's
// office hours and fall on one date in their zone.
func slotFits(person domain.Person, start, end time.Time, settings domain.Settings) bool {
	startLocal := domain.InZone(start, person.Zone)
	endLocal := domain.InZone(end, person.Zone)
	if !settings.StartInsideHours(person.Zone, startLocal) || !settings.EndInsideHours(person.Zone, endLocal) {
		return false
	}
	if startLocal.Date() != endLocal.Date() && !(endLocal.H == 0 && endLocal.Min == 0) {
		return false
	}
	return true
}

// blocks_ reports whether one occurrence blocks a person: every occurrence on
// a calendar they own, and an occurrence they are a guest of while they answer
// yes or maybe.
func blocks_(e *domain.Event, o *domain.Occurrence, personID string, owned map[string]bool) bool {
	if o.Deleted {
		return false
	}
	if owned[e.CalendarID] {
		return true
	}
	answer, _ := e.ReplyFor(o.Key, personID)
	return answer == domain.AnswerYes || answer == domain.AnswerMaybe
}

// ownedCalendars lists the calendars a person owns.
func (s *Server) ownedCalendars(ctx context.Context, personID string) (map[string]bool, error) {
	cals, err := s.Store.Calendars(ctx, personID)
	if err != nil {
		return nil, err
	}
	out := map[string]bool{}
	for _, cal := range cals {
		if cal.OwnerID != nil && *cal.OwnerID == personID {
			out[cal.ID] = true
		}
	}
	return out, nil
}
