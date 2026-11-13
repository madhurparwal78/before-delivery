package domain

import "time"

// Event kinds.
const (
	KindEvent       = "event"
	KindFocusTime   = "focus_time"
	KindOutOfOffice = "out_of_office"
)

// Decline modes of a focus event.
const (
	DeclineNewOnly        = "new_only"
	DeclineNewAndExisting = "new_and_existing"
	VisibilityDefault     = "default"
	VisibilityPrivate     = "private"
)

// Share levels, lowest first.
const (
	LevelFreeBusy = "free_busy"
	LevelDetails  = "details"
	LevelEdit     = "edit"
	LevelManage   = "manage"
	LevelOwner    = "owner"
	LevelReadOnly = "read_only"
)

// Access levels a response is projected for.
const (
	AccessFull    = "full"
	AccessGuest   = "guest"
	AccessDetails = "details"
	AccessBusy    = "busy"
)

// Reply answers.
const (
	AnswerInvited = "invited"
	AnswerYes     = "yes"
	AnswerNo      = "no"
	AnswerMaybe   = "maybe"
)

// Proposal states.
const (
	ProposalProposed = "proposed"
	ProposalAccepted = "accepted"
	ProposalDeclined = "declined"
)

// Roles.
const (
	RoleOfficeManager = "office_manager"
	RoleMember        = "member"
	RoleGuest         = "guest"
)

// Edit scopes of a repeating event.
const (
	ScopeThis      = "this"
	ScopeFollowing = "following"
	ScopeAll       = "all"
)

// HolidaysCalendarID names the one read-only calendar.
const HolidaysCalendarID = "cal-holidays"

type Person struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Email        string  `json:"email"`
	Zone         string  `json:"zone"`
	City         string  `json:"city"`
	Role         string  `json:"role"`
	WeekStart    string  `json:"week_start"`
	HideWeekends bool    `json:"hide_weekends"`
	CustomDays   int     `json:"custom_days"`
	SecondZone   *string `json:"second_zone"`
}

type Calendar struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	OwnerID          *string `json:"owner_id"`
	Colour           string  `json:"colour"`
	Level            string  `json:"level"`
	DefaultReminders []int   `json:"default_reminders"`
}

type Switches struct {
	ModifyEvent  bool `json:"modify_event"`
	InviteOthers bool `json:"invite_others"`
	SeeGuestList bool `json:"see_guest_list"`
}

// Guest is one invited person's series-wide row.
type Guest struct {
	PersonID string `json:"person_id"`
	Name     string `json:"name"`
	Answer   string `json:"answer"`
	Message  string `json:"message"`
}

// Reply is one person's answer to one occurrence.
type Reply struct {
	Key      string
	PersonID string
	Answer   string
	Message  string
}

// Exception is one occurrence's own values, keyed to its original date.
type Exception struct {
	Key        string  `json:"occurrence_id"`
	Deleted    bool    `json:"deleted"`
	StartLocal *string `json:"start_local"`
	EndLocal   *string `json:"end_local"`
	Title      *string `json:"title"`
	Location   *string `json:"location"`
	Notes      *string `json:"notes"`
}

type Proposal struct {
	ID           string
	EventID      string
	Key          string
	ProposerID   string
	ProposerName string
	StartLocal   string
	EndLocal     string
	Note         string
	Status       string
}

type ShareLink struct {
	Token     string    `json:"token"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Event is a single event or the whole of one series.
type Event struct {
	ID             string
	CalendarID     string
	SeriesID       string
	SplitFrom      *string
	OrganiserID    string
	OrganiserName  string
	Title          string
	Location       string
	Notes          string
	Kind           string
	Colour         string
	Reminders      []int
	AllDay         bool
	StartLocal     string
	EndLocal       string
	Zone           string
	Visibility     string
	RRule          string
	SeriesUntil    *string
	DeclineMode    string
	DeclineMessage string
	Switches       Switches
	Version        int
	SavedAt        time.Time
	SavedByID      string
	SavedByName    string
	TrashedAt      *time.Time

	Guests     []Guest
	Replies    []Reply
	Exceptions []Exception
	Proposals  []Proposal
	Link       *ShareLink
	MovedRules []string
}

func (e *Event) IsSeries() bool { return e.RRule != "" }

func (e *Event) IsGuest(personID string) bool {
	for _, g := range e.Guests {
		if g.PersonID == personID {
			return true
		}
	}
	return false
}

func (e *Event) Guest(personID string) *Guest {
	for i := range e.Guests {
		if e.Guests[i].PersonID == personID {
			return &e.Guests[i]
		}
	}
	return nil
}

func (e *Event) MovedFor(ruleID string) bool {
	for _, id := range e.MovedRules {
		if id == ruleID {
			return true
		}
	}
	return false
}

func (e *Event) Exception(key string) *Exception {
	for i := range e.Exceptions {
		if e.Exceptions[i].Key == key {
			return &e.Exceptions[i]
		}
	}
	return nil
}

// ReplyFor gives a person's answer and message for one occurrence, falling
// back to their series row.
func (e *Event) ReplyFor(key, personID string) (string, string) {
	for _, r := range e.Replies {
		if r.Key == key && r.PersonID == personID {
			return r.Answer, r.Message
		}
	}
	if g := e.Guest(personID); g != nil {
		return g.Answer, g.Message
	}
	return "", ""
}

// ZoneRule is one recorded, effective-dated change to a zone's offset.
type ZoneRule struct {
	ID            string `json:"id"`
	Zone          string `json:"zone"`
	City          string `json:"city"`
	EffectiveDate string `json:"effective_date"`
	NewOffset     string `json:"new_offset"`
	Note          string `json:"note"`
	RecordedBy    string `json:"recorded_by"`
	OffsetMinutes int    `json:"-"`
}

// ZoneRules is every recorded rule, ordered by zone and effective date.
type ZoneRules []ZoneRule

// Latest gives the last rule for a zone effective on or before a date.
func (zr ZoneRules) Latest(zone, date string) *ZoneRule {
	var out *ZoneRule
	for i := range zr {
		r := &zr[i]
		if r.Zone != zone || r.EffectiveDate > date {
			continue
		}
		if out == nil || r.EffectiveDate > out.EffectiveDate {
			out = r
		}
	}
	return out
}

// ByID finds a recorded rule.
func (zr ZoneRules) ByID(id string) *ZoneRule {
	for i := range zr {
		if zr[i].ID == id {
			return &zr[i]
		}
	}
	return nil
}

// ZoneWarning is one occurrence's warning under one recorded rule.
type ZoneWarning struct {
	RuleID        string `json:"rule_id"`
	City          string `json:"city"`
	EffectiveDate string `json:"effective_date"`
	NewOffset     string `json:"new_offset"`
	ShiftMinutes  int    `json:"shift_minutes"`
	SavedTime     string `json:"saved_time"`
	ShownTime     string `json:"shown_time"`
	Note          string `json:"note"`
}

// OfficeHours is one office's working day.
type OfficeHours struct {
	Open  string `json:"open"`
	Close string `json:"close"`
	Days  []int  `json:"days"`
}

// Settings holds the firm-wide guest defaults and office hours.
type Settings struct {
	GuestDefaults Switches               `json:"guest_defaults"`
	OfficeHours   map[string]OfficeHours `json:"office_hours"`
}

// StartInsideHours reports whether a start is at or after opening and before
// closing on a working day of that office.
func (s Settings) StartInsideHours(zone string, w Wall) bool {
	h, ok := s.OfficeHours[zone]
	if !ok {
		return false
	}
	if !workingDay(h, w) {
		return false
	}
	open, _ := MinutesOfDay(h.Open)
	close, _ := MinutesOfDay(h.Close)
	m := w.H*60 + w.Min
	return m >= open && m < close
}

// EndInsideHours reports whether an end is after opening and at or before
// closing on a working day of that office.
func (s Settings) EndInsideHours(zone string, w Wall) bool {
	h, ok := s.OfficeHours[zone]
	if !ok {
		return false
	}
	day := w
	minutes := w.H*60 + w.Min
	if minutes == 0 {
		// Midnight ends the day before.
		day = w.AddDays(-1)
		minutes = 24 * 60
	}
	if !workingDay(h, day) {
		return false
	}
	open, _ := MinutesOfDay(h.Open)
	close, _ := MinutesOfDay(h.Close)
	return minutes > open && minutes <= close
}

func workingDay(h OfficeHours, w Wall) bool {
	wd := int(w.Weekday())
	if wd == 0 {
		wd = 7
	}
	for _, d := range h.Days {
		if d == wd {
			return true
		}
	}
	return false
}

// Clock is one city's reading of an instant.
type Clock struct {
	City        string `json:"city"`
	Time        string `json:"time"`
	Date        string `json:"date"`
	InsideHours bool   `json:"inside_hours"`
}

// ClocksAt reads an instant in all three cities. A zone whose offset a
// recorded rule has changed reads the clock time that rule gives instead.
func ClocksAt(instant time.Time, settings Settings, ruledZone string, ruledTime Wall, ruled bool) []Clock {
	out := make([]Clock, 0, 3)
	for _, zc := range zoneCities {
		w := InZone(instant, zc.Zone)
		if ruled && zc.Zone == ruledZone {
			w = ruledTime
		}
		out = append(out, Clock{
			City:        zc.City,
			Time:        w.Clock(),
			Date:        w.Date(),
			InsideHours: settings.StartInsideHours(zc.Zone, w),
		})
	}
	return out
}

// OccurrenceClocks reads one occurrence's start in all three cities, its own
// zone reading the clock time every surface shows.
func OccurrenceClocks(o *Occurrence, settings Settings) []Clock {
	if o == nil || o.AllDay || o.StartUTC == nil {
		return []Clock{}
	}
	return ClocksAt(*o.StartUTC, settings, o.Event.Zone, o.ShownStart, true)
}
