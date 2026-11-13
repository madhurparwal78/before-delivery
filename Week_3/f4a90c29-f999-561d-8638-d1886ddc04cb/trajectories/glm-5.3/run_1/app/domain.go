package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// domain.go — the one place occurrence generation lives.

// Event is a stored event or series.
type Event struct {
	ID             string
	CalendarID     string
	SeriesID       *string
	SplitFrom      *string
	OrganiserID    string
	Title          string
	Location       string
	Notes          string
	Kind           string // event | focus | out_of_office
	Colour         string
	AllDay         bool
	StartDate      string // local date in zone
	StartMinutes   int    // minutes from local midnight
	EndDate        string
	EndMinutes     int
	Zone           string
	Visibility     string
	RRule          *string
	DeclineMode    *string
	DeclineMessage *string
	Reminders      []int
	Switches       EventSwitches
	Guests         []*GuestRow
	Replies        []*ReplyRow
	Exceptions     []*ExceptionRow
	ShareLink      *ShareLinkRow
	Version        int
	SavedAt        time.Time
	SavedDate      string
	State          string
	MovedRules     []string
	LastSavePerson *string
}

type EventSwitches struct {
	ModifyEvent  bool `json:"modify_event"`
	InviteOthers bool `json:"invite_others"`
	SeeGuestList bool `json:"see_guest_list"`
}

type GuestRow struct {
	PersonID string
	Name     string
	Answer   string // series default
}

type ReplyRow struct {
	PersonID     string
	OccurrenceID string
	Answer       string
	Message      string
}

type ExceptionRow struct {
	OccurrenceID string
	Deleted      bool
	StartDate    *string
	StartMinutes *int
	EndDate      *string
	EndMinutes   *int
	Title        *string
	Location     *string
	Notes        *string
}

type ShareLinkRow struct {
	Token     string
	ExpiresAt time.Time
}

func (e *Event) Rule() *RepeatRule {
	if e.RRule == nil || *e.RRule == "" {
		return nil
	}
	r, err := ParseRRule(*e.RRule)
	if err != nil {
		return nil
	}
	return r
}

func (e *Event) StartLocal() string {
	if e.AllDay {
		return e.StartDate
	}
	return e.StartDate + "T" + minutesHM(e.StartMinutes)
}

func (e *Event) EndLocal() string {
	if e.AllDay {
		return e.EndDate
	}
	return e.EndDate + "T" + minutesHM(e.EndMinutes)
}

func minutesHM(m int) string {
	return fmt.Sprintf("%02d:%02d", m/60, m%60)
}

// Occurrence is one materialised occurrence of an event.
type Occurrence struct {
	EventID      string
	OccurrenceID string
	SeriesID     *string
	SplitFrom    *string
	CalendarID   string
	OrganiserID  string
	Title        string
	Location     string
	Notes        string
	Kind         string
	Colour       string
	AllDay       bool
	StartDate    string
	StartMinutes int
	EndDate      string
	EndMinutes   int
	Zone         string
	Visibility   string
	RRule        *string
	IsException  bool
	IsDeleted    bool
	Reminders    []int
	Switches     EventSwitches
	Adjusted     bool
	ShiftMinutes int
	RuleID       string
	HasWarning   bool
	Warning      *ZoneWarning
	// lazily filled
	Exception *ExceptionRow
}

// GenOccurrences generates occurrences overlapping [from, to) as UTC
// instants, from inclusive, to exclusive. All-day events overlap when any of
// their dates fall in the range. Each occurrence carries its own zone rule
// warning, when it has one.
func GenOccurrences(e *Event, from, to time.Time, rules []*ZoneRule, movedRules map[string]bool) []*Occurrence {
	rr := e.Rule()
	var dates []string
	if rr == nil {
		dates = []string{e.StartDate}
	} else {
		dates = seriesDates(e, rr, from, to)
	}
	var out []*Occurrence
	for _, d := range dates {
		occ := buildOccurrence(e, d)
		if occ == nil {
			continue
		}
		if occ.IsDeleted {
			continue
		}
		applyWarning(occ, e, rules, movedRules)
		out = append(out, occ)
	}
	// stand-alone exceptions whose date no longer fits the rule
	for _, ex := range e.Exceptions {
		if ex.StartDate != nil && rr != nil {
			if !dateInList(*ex.StartDate, dates) && !rr.MatchesStartDate(*ex.StartDate) {
				occ := exceptionOccurrence(e, ex)
				if occ != nil && !occ.IsDeleted {
					applyWarning(occ, e, rules, movedRules)
					out = append(out, occ)
				}
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		si, _ := occStartInstant(out[i], rules, movedRules)
		sj, _ := occStartInstant(out[j], rules, movedRules)
		if !si.Equal(sj) {
			return si.Before(sj)
		}
		return out[i].OccurrenceID < out[j].OccurrenceID
	})
	var filtered []*Occurrence
	for _, o := range out {
		if overlapsRange(o, from, to, rules, movedRules) {
			filtered = append(filtered, o)
		}
	}
	return filtered
}

// applyWarning sets the occurrence's own zone rule warning by the one
// published rule: the event's zone matches, its saved date is strictly after
// the effective date, the occurrence is dated on or after it, its own shift
// is not zero, and the event has not been moved for that rule. The saved date
// comparison is decided by the caller filling savedAfter.
func applyWarning(o *Occurrence, e *Event, rules []*ZoneRule, movedRules map[string]bool) {
	if o.AllDay {
		return
	}
	for _, r := range rules {
		if r.Zone != o.Zone {
			continue
		}
		if o.StartDate < r.EffectiveDate {
			continue
		}
		if e.SavedDate <= r.EffectiveDate {
			continue
		}
		if movedRules[r.ID] {
			continue
		}
		zoneOff := OffsetForLocal(o.Zone, o.StartDate, o.StartMinutes)
		shift := r.OffsetMinutes - zoneOff
		if shift == 0 {
			continue
		}
		o.HasWarning = true
		o.ShiftMinutes = shift
		o.RuleID = r.ID
		o.Warning = &ZoneWarning{
			RuleID:        r.ID,
			City:          zoneByName[r.Zone].City,
			EffectiveDate: r.EffectiveDate,
			NewOffset:     r.NewOffset,
			ShiftMinutes:  shift,
			SavedTime:     minutesHM(o.StartMinutes),
			Note:          r.Note,
		}
		o.Warning.ShownTime = minutesHM(mod1440(o.StartMinutes + shift))
		return
	}
}

func mod1440(m int) int {
	return ((m % 1440) + 1440) % 1440
}

func dateInList(d string, list []string) bool {
	for _, x := range list {
		if x == d {
			return true
		}
	}
	return false
}

// seriesDates gives the rule-generated local start dates of a series within
// the window, always including the first occurrence date.
func seriesDates(e *Event, rr *RepeatRule, from, to time.Time) []string {
	// expand generously: from a month before window start
	expandFrom := from.AddDate(-1, 0, 0)
	dates := rr.Expand(e.StartDate, 0, to.AddDate(0, 0, 2))
	_ = expandFrom
	if dates == nil {
		return nil
	}
	// keep dates whose occurrence may overlap [from, to)
	var out []string
	maxEnd := 0
	if n := len(dates); n > 0 {
		maxEnd = occurrenceEndMinutes(e)
	}
	for _, d := range dates {
		startDate, _ := ParseDate(d)
		endInstant := midnightUTC(startDate).Add(time.Duration(maxEnd)*time.Minute + 24*time.Hour)
		if endInstant.Before(from) {
			continue
		}
		dayStart := midnightUTC(startDate)
		if !dayStart.Before(to) {
			continue
		}
		out = append(out, d)
	}
	return out
}

func occurrenceEndMinutes(e *Event) int {
	if e.AllDay {
		return 1440 * daysBetween(e.StartDate, e.EndDate)
	}
	// minutes from start to end
	sd, _ := ParseDate(e.StartDate)
	ed, _ := ParseDate(e.EndDate)
	return int(ed.Sub(sd).Hours()/24)*1440 + e.EndMinutes - e.StartMinutes
}

func daysBetween(a, b string) int {
	d1, ok1 := ParseDate(a)
	d2, ok2 := ParseDate(b)
	if !ok1 || !ok2 {
		return 1
	}
	n := int(d2.Sub(d1).Hours() / 24)
	if n < 0 {
		n = 0
	}
	return n + 1
}

func midnightUTC(d time.Time) time.Time {
	y, m, day := d.UTC().Date()
	return time.Date(y, m, day, 0, 0, 0, 0, time.UTC)
}

// buildOccurrence makes one occurrence from an event and a rule-generated
// date, applying the exception keyed to the original date.
func buildOccurrence(e *Event, date string) *Occurrence {
	o := &Occurrence{
		EventID:      e.ID,
		OccurrenceID: "",
		SeriesID:     e.SeriesID,
		SplitFrom:    e.SplitFrom,
		CalendarID:   e.CalendarID,
		OrganiserID:  e.OrganiserID,
		Title:        e.Title,
		Location:     e.Location,
		Notes:        e.Notes,
		Kind:         e.Kind,
		Colour:       e.Colour,
		AllDay:       e.AllDay,
		StartDate:    date,
		StartMinutes: e.StartMinutes,
		EndDate:      date,
		EndMinutes:   e.EndMinutes,
		Zone:         e.Zone,
		Visibility:   e.Visibility,
		RRule:        e.RRule,
		Reminders:    e.Reminders,
		Switches:     e.Switches,
	}
	if e.AllDay {
		o.EndDate = addDays(date, daysBetween(e.StartDate, e.EndDate)-1)
		o.OccurrenceID = e.ID + "@" + strings.ReplaceAll(date, "-", "")
	} else {
		o.OccurrenceID = e.ID + "@" + strings.ReplaceAll(date, "-", "") + "T" + strings.ReplaceAll(e.StartLocal()[len(e.StartDate)+1:], ":", "")
	}
	for _, ex := range e.Exceptions {
		if ex.OccurrenceID == o.OccurrenceID {
			o.IsException = true
			o.Exception = ex
			if ex.Deleted {
				o.IsDeleted = true
				return o
			}
			if ex.StartDate != nil {
				o.StartDate = *ex.StartDate
			}
			if ex.StartMinutes != nil {
				o.StartMinutes = *ex.StartMinutes
			}
			if ex.EndDate != nil {
				o.EndDate = *ex.EndDate
			} else {
				o.EndDate = o.StartDate
			}
			if ex.EndMinutes != nil {
				o.EndMinutes = *ex.EndMinutes
			}
			if ex.Title != nil {
				o.Title = *ex.Title
			}
			if ex.Location != nil {
				o.Location = *ex.Location
			}
			if ex.Notes != nil {
				o.Notes = *ex.Notes
			}
			return o
		}
	}
	return o
}

// exceptionOccurrence makes a standalone occurrence from a modified exception
// whose date no longer fits the rule.
func exceptionOccurrence(e *Event, ex *ExceptionRow) *Occurrence {
	if ex.Deleted || ex.StartDate == nil {
		return nil
	}
	o := buildOccurrence(e, e.StartDate)
	o.IsException = true
	o.Exception = ex
	o.StartDate = *ex.StartDate
	if ex.StartMinutes != nil {
		o.StartMinutes = *ex.StartMinutes
	}
	o.EndDate = o.StartDate
	if ex.EndDate != nil {
		o.EndDate = *ex.EndDate
	}
	if ex.EndMinutes != nil {
		o.EndMinutes = *ex.EndMinutes
	}
	if ex.Title != nil {
		o.Title = *ex.Title
	}
	if ex.Location != nil {
		o.Location = *ex.Location
	}
	if ex.Notes != nil {
		o.Notes = *ex.Notes
	}
	o.OccurrenceID = ex.OccurrenceID
	return o
}

func addDays(date string, n int) string {
	d, ok := ParseDate(date)
	if !ok {
		return date
	}
	return FormatDate(d.AddDate(0, 0, n))
}

// occStartInstant gives the saved UTC instant of an occurrence start.
func occStartInstant(o *Occurrence, rules []*ZoneRule, movedRules map[string]bool) (time.Time, bool) {
	if o.AllDay {
		return midnightUTC(mustDate(o.StartDate)), false
	}
	w, _ := occWarning(o, rules, movedRules)
	inst, _, gap := InstantFromLocal(o.Zone, o.StartDate, o.StartMinutes)
	if w != nil {
		gap = false
	}
	return inst, gap
}

// occEndInstant gives the saved UTC instant of an occurrence end.
func occEndInstant(o *Occurrence, rules []*ZoneRule, movedRules map[string]bool) (time.Time, bool) {
	if o.AllDay {
		return midnightUTC(mustDate(o.EndDate)).Add(24 * time.Hour), false
	}
	end := InstantFromLocalOr(o.Zone, o.EndDate, o.EndMinutes)
	return end, false
}

func InstantFromLocalOr(zone, date string, minutes int) time.Time {
	t, _, _ := InstantFromLocal(zone, date, minutes)
	return t
}

func mustDate(s string) time.Time {
	t, _ := ParseDate(s)
	return t
}

// ZoneWarning is one occurrence's warning.
type ZoneWarning struct {
	RuleID        string `json:"rule_id"`
	City          string `json:"city"`
	EffectiveDate string `json:"effective_date"`
	NewOffset     string `json:"new_offset"`
	ShiftMinutes  int    `json:"shift_minutes"`
	SavedTime     string `json:"saved_time"`
	ShownTime     string `json:"shown_time"`
	Note          string `json:"note"`
	moved         bool
}

func occWarning(o *Occurrence, rules []*ZoneRule, movedRules map[string]bool) (*ZoneWarning, bool) {
	if o.AllDay {
		return nil, false
	}
	for _, r := range rules {
		if r.Zone != o.Zone {
			continue
		}
		if o.StartDate < r.EffectiveDate {
			continue
		}
		if movedRules[r.ID] {
			continue
		}
		zoneOff := OffsetForLocal(o.Zone, o.StartDate, o.StartMinutes)
		shift := r.OffsetMinutes - zoneOff
		if shift == 0 {
			continue
		}
		savedTime := minutesHM(o.StartMinutes)
		shown := o.StartMinutes + shift
		shown = ((shown % 1440) + 1440) % 1440
		return &ZoneWarning{
			RuleID:        r.ID,
			City:          zoneByName[r.Zone].City,
			EffectiveDate: r.EffectiveDate,
			NewOffset:     r.NewOffset,
			ShiftMinutes:  shift,
			SavedTime:     savedTime,
			ShownTime:     minutesHM(shown),
			Note:          r.Note,
			moved:         false,
		}, true
	}
	return nil, false
}

// overlapsRange reports whether the occurrence's instants intersect the range.
func overlapsRange(o *Occurrence, from, to time.Time, rules []*ZoneRule, movedRules map[string]bool) bool {
	if o.AllDay {
		sd := midnightUTC(mustDate(o.StartDate))
		ed := midnightUTC(mustDate(o.EndDate)).Add(24 * time.Hour)
		return sd.Before(to) && ed.After(from)
	}
	s, _ := occStartInstant(o, rules, movedRules)
	e, _ := occEndInstant(o, rules, movedRules)
	return s.Before(to) && e.After(from)
}
