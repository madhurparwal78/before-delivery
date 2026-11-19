package mailer

import (
	"fmt"
	"strings"
	"time"

	"github.com/cinderlatch/holdfast/internal/calendar"
	"github.com/cinderlatch/holdfast/internal/store"
)

// The two kinds of email the studio sends.
const (
	KindConfirmation = "confirmation"
	KindReminder     = "reminder"
)

// ReminderLead is how long before a night its reminder falls due.
const ReminderLead = 60 * time.Minute

// Composed is a ready-to-queue email.
type Composed struct {
	DedupeKey string
	Kind      string
	To        string
	Subject   string
	Body      string
}

// FormatMoment renders an instant as the emails print it.
func FormatMoment(at time.Time, zoneName string) string {
	zone, err := time.LoadLocation(zoneName)
	if err != nil {
		zone = time.UTC
		zoneName = "UTC"
	}
	return fmt.Sprintf("%s (%s)", at.In(zone).Format("Mon 2 Jan 2006, 15:04 MST"), zoneName)
}

// Confirmation composes a sign-up's confirmation email.
func Confirmation(signup store.Signup, night calendar.NightView, studioZone string) Composed {
	studioDate := dateHeading(night, studioZone)
	lines := []string{
		fmt.Sprintf("Hi %s,", signup.Name),
		fmt.Sprintf("You're on the list for %s.", night.Title),
		fmt.Sprintf("Studio time: %s", FormatMoment(night.StartsAtTime(), studioZone)),
		fmt.Sprintf("Your time: %s", FormatMoment(night.StartsAtTime(), signup.ViewerZone)),
		fmt.Sprintf("Sign-ups close: %s", FormatMoment(night.SignupsCloseAtTime(), studioZone)),
	}
	return Composed{
		DedupeKey: "confirmation:" + signup.ID,
		Kind:      KindConfirmation,
		To:        signup.Email,
		Subject:   fmt.Sprintf("Signed up: %s · %s", night.Title, studioDate),
		Body:      strings.Join(lines, "\n") + "\n",
	}
}

// Reminder composes a sign-up's one-hour reminder email.
func Reminder(signup store.Signup, night calendar.NightView, studioZone string) Composed {
	lines := []string{
		fmt.Sprintf("Hi %s,", signup.Name),
		fmt.Sprintf("%s starts in 1 hour.", night.Title),
		fmt.Sprintf("Studio time: %s", FormatMoment(night.StartsAtTime(), studioZone)),
		fmt.Sprintf("Your time: %s", FormatMoment(night.StartsAtTime(), signup.ViewerZone)),
	}
	return Composed{
		DedupeKey: "reminder:" + signup.ID,
		Kind:      KindReminder,
		To:        signup.Email,
		Subject:   fmt.Sprintf("Starts in 1 hour: %s", night.Title),
		Body:      strings.Join(lines, "\n") + "\n",
	}
}

// dateHeading renders the night's studio date for the confirmation subject.
func dateHeading(night calendar.NightView, studioZone string) string {
	zone, err := time.LoadLocation(studioZone)
	if err != nil {
		zone = time.UTC
	}
	return night.StartsAtTime().In(zone).Format("Mon 2 Jan 2006")
}
