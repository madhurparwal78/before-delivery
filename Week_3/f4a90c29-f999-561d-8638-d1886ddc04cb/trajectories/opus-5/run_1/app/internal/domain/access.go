package domain

// Viewer is one signed-in person with their share levels, as read on every
// request.
type Viewer struct {
	Person   Person
	Levels   map[string]string // calendar id to share level
	Settings Settings
}

// Access gives the level a viewer reads an event at, the first that applies,
// or the empty string when they cannot read it at all.
func (v Viewer) Access(e *Event) string {
	level := v.Levels[e.CalendarID]
	switch level {
	case LevelOwner, LevelEdit, LevelManage:
		return AccessFull
	}
	if e.IsGuest(v.Person.ID) {
		return AccessGuest
	}
	switch level {
	case LevelReadOnly:
		return AccessDetails
	case LevelDetails:
		if e.Visibility == VisibilityPrivate {
			return AccessBusy
		}
		return AccessDetails
	case LevelFreeBusy:
		return AccessBusy
	}
	return ""
}

func (v Viewer) CanRead(e *Event) bool { return v.Access(e) != "" }

// CanEdit reports whether a viewer may change an event's own fields, which a
// guest may do only through the Modify event switch.
func (v Viewer) CanEdit(e *Event) bool {
	if e.CalendarID == HolidaysCalendarID {
		return false
	}
	switch v.Access(e) {
	case AccessFull:
		return true
	case AccessGuest:
		return e.Switches.ModifyEvent
	}
	return false
}

// CanEditCalendar reports whether a viewer may create on a calendar.
func (v Viewer) CanEditCalendar(calendarID string) bool {
	if calendarID == HolidaysCalendarID {
		return false
	}
	switch v.Levels[calendarID] {
	case LevelOwner, LevelEdit, LevelManage:
		return true
	}
	return false
}

// CanManageCalendar reports whether a viewer may set a calendar's shares and
// default reminders.
func (v Viewer) CanManageCalendar(calendarID string) bool {
	if calendarID == HolidaysCalendarID {
		return false
	}
	if v.Person.Role == RoleOfficeManager {
		return true
	}
	switch v.Levels[calendarID] {
	case LevelOwner, LevelManage:
		return true
	}
	return false
}

// SeesGuestList reports whether a viewer receives other guests and answer
// counts for an event.
func (v Viewer) SeesGuestList(e *Event) bool {
	switch v.Access(e) {
	case AccessFull:
		return true
	case AccessGuest:
		return e.Switches.SeeGuestList || e.Switches.ModifyEvent
	case AccessDetails:
		return e.Switches.SeeGuestList
	}
	return false
}
