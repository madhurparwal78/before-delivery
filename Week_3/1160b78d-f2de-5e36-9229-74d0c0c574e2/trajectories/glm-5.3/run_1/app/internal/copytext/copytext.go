// Package copytext holds the exact published sentences the app must print.
// Every piece of user-visible copy lives here so it is decided in one place.
package copytext

const (
	// Field errors.
	FmtDateTime      = "Use the format YYYY-MM-DD HH:MM."
	FmtDate          = "Use the format YYYY-MM-DD."
	FmtTime          = "Use the format HH:MM."
	FmtDelays        = "Use 1 to 5 whole minutes from 0 to 60, separated by commas."
	LowDelayRange    = "Use a whole number of minutes from 0 to 60."
	TimezoneUnknown  = "Choose a listed time zone."
	QuietBoth        = "Set both quiet hours times or neither."
	OutRange         = "Out of range."

	// Intake sentences.
	RoutingKeyRequired = "Routing key is required."
	ActionInvalid      = "Action must be trigger, acknowledge or resolve."
	DedupRequired      = "Dedup key is required for this action."
	DedupLength        = "Dedup key must be 1 to 255 characters."
	SummaryRequired    = "Summary is required."
	SummaryLength      = "Summary is longer than 1024 characters."
	SourceRequired     = "Source is required."
	SeverityInvalid    = "Severity must be critical, error, warning or info."

	// Dead letters.
	DeadNotJSON    = "Body is not valid JSON."
	DeadMissing    = "Missing field: "
	DeadSeverity   = "Unknown severity: "
	DeadRoutingKey = "Unknown routing key: "
	DeadEarlierEv  = "Earlier event never arrived: key_seq "

	// Integration event log reasons.
	ReasonNoAlert         = "No alert has this dedup key."
	ReasonAlreadyResolved = "This alert is already resolved."
	ReasonAlreadyAck      = "This alert is already acknowledged."
	ReasonOtherRouting    = "This dedup key belongs to another integration."
	ReasonNobodyOnCall    = "Nobody is on call on this policy, so no incident opened."
	ReasonMaintenance     = "The service is in a maintenance window."
	ReasonRateLimit       = "Over the limit of 120 events a minute."
	ReasonQueueDown       = "The queue did not confirm this event."
	ReasonInvalidEvent    = "Invalid event: "

	// API errors.
	LimitRange         = "Limit must be between 1 and 100."
	IdsRange           = "Choose 1 to 100 incidents."
	SnoozeMax          = "Snooze for at most 168 hours."
	SnoozeFuture       = "Choose a time after now."
	PersonAlreadyHold  = "This person already holds the incident."
	PersonOrService    = "Choose either a person or a service."
	AlreadyThisService = "The incident is already on this service."
	MergeIntoItself    = "An incident cannot merge into itself."
	MergeTooMany       = "An incident can hold at most 1000 alerts."
	OnlyAckSnooze      = "Only an acknowledged incident can be snoozed."
	ViewMax35          = "View at most 35 days."
	WindowEnd          = "The window must end after it starts."
	WindowPast         = "The window cannot start in the past."
	TimeoutOne         = "Use at least 1 minute with one target."
	TimeoutSeveral     = "Use at least 3 minutes with several targets."
	RepeatsMax         = "A policy repeats at most 9 times."
	LevelsRange        = "A policy has 1 to 20 levels."
	TargetsRange       = "A level has 1 to 10 targets."
	LoopMade           = "This would make a loop: "
	Step15             = "Overrides start and end on a 15-minute step."
	OverrideEnd        = "An override must end after it starts."
	OverrideMax        = "An override lasts at most 14 days."
	OverridePast       = "Overrides cannot change the past."
	RangeEnd           = "The range must end on or after its start."
	EmailInvalid       = "Enter a valid email address."
	PathSlash          = "The path must start with /."
	InvalidCredentials = "That email and password do not match."
	ChooseService      = "Choose a service."

	// Feedback states.
	Working          = "Working on it."
	NoteAdded        = "Note added."
	NewerVersion     = "Someone saved a newer version. Reload to see it."
	Saved            = "Saved."
	Published        = "Published. Notices to %d subscribers are on their way."
	Subscribed       = "You are subscribed to status updates."
	Unsubscribed     = "You will get no more status updates."
	Merged           = "Merged %d incidents into #%d."
	PolicyNotice     = "%d running incidents keep version %d. Version %d applies to later incidents."
	RemoveRefused    = " cannot be removed yet."
	FilterSaved      = "Filter saved."
	Replayed         = "Replayed. The event applied once."
	ReplayQueued     = "Replay queued under the same event id."
	ClockMoved       = "Clock moved to %s."
	LevelMoved       = "Level moved to position %d."
	SignedOutForced  = "You have been signed out."
	RoleChanged      = "Your role changed to %s."

	// Outage bars and fixed notices.
	ValkeyNotice  = "Figures are coming straight from the record, so this page may load more slowly."
	ValkeyCounter = "Counter unavailable: events are accepted uncounted until it returns."
	MailIncident  = "Mail is unreachable. %d notification steps are queued and will go out when it returns."
	MailDesk      = "Mail is unreachable. %d subscriber notices are queued and will go out when it returns."
	ReceiverDown  = "The receiver is unreachable. Attempts continue on the published schedule."
	BrokerDown    = "The queue is unreachable. New events are being refused."
	NotFound      = "We could not find that page."

	// Empty sentences.
	EmptyIncidents  = "Nothing is open."
	EmptyDead       = "No dead letters."
	EmptyDeliveries = "Nothing has been sent yet."
	EmptyUpdates    = "No updates published."

	// Status headlines.
	HeadlineRunning     = "All services are running."
	HeadlineMaintenance = "Maintenance is under way."
	HeadlineAffected    = "Some services are affected."
)

// AttemptNoAnswer describes an attempt with no answer.
const AttemptNoAnswer = "Receiver unreachable"

// RoleLabel maps the API's lowercase role to its published label.
func RoleLabel(role string) string {
	switch role {
	case "admin":
		return "Admin"
	case "lead":
		return "Lead"
	case "stakeholder":
		return "Stakeholder"
	default:
		return "Responder"
	}
}

// StateLabel maps the API's lowercase update state to its published label.
func StateLabel(state string) string {
	switch state {
	case "identified":
		return "Identified"
	case "monitoring":
		return "Monitoring"
	case "resolved":
		return "Resolved"
	default:
		return "Investigating"
	}
}
