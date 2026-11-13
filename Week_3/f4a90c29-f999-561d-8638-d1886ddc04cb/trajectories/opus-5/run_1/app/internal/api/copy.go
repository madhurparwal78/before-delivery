package api

import (
	"fmt"

	"sundialwren/internal/domain"
)

// The published sentences every notice and decision renders, character for
// character.

func outOfOfficeDecline(name, lastDay, title string) string {
	return fmt.Sprintf("%s is out of office until %s, so %s was declined automatically.", name, lastDay, title)
}

func focusTimeDecline(name, endsAt, title string) string {
	return fmt.Sprintf("%s is in focus time until %s, so %s was declined automatically.", name, endsAt, title)
}

func proposalAccepted(title, time, city string) string {
	return fmt.Sprintf("Proposal accepted: %s moves to %s %s.", title, time, city)
}

func proposalDeclined(title string) string {
	return fmt.Sprintf("Proposal declined for %s.", title)
}

func proposalMade(name, time, city, title string) string {
	return fmt.Sprintf("%s proposed %s %s for %s.", name, time, city, title)
}

func invitation(name, title string) string {
	return fmt.Sprintf("%s invited you to %s.", name, title)
}

func reminderAllDay(title string) string {
	return fmt.Sprintf("Reminder: %s is tomorrow.", title)
}

func reminderTimed(title, time, city string) string {
	return fmt.Sprintf("Reminder: %s starts at %s %s.", title, time, city)
}

func accessChanged(calendarName, levelLabel string) string {
	return fmt.Sprintf("Your access to %s changed to %s.", calendarName, levelLabel)
}

func accessRemoved(calendarName string) string {
	return fmt.Sprintf("You no longer have access to %s.", calendarName)
}

// LevelLabel writes a share level the way the sharing screen reads it.
func LevelLabel(level string) string {
	switch level {
	case domain.LevelFreeBusy:
		return "See only free/busy"
	case domain.LevelDetails:
		return "See all details"
	case domain.LevelEdit:
		return "Make changes"
	case domain.LevelManage:
		return "Manage sharing"
	}
	return level
}

// Notice kinds.
const (
	noticeInvitation = "invitation"
	noticeDecision   = "decision"
	noticeReminder   = "reminder"
)

// Error messages named in Feedback states.
const (
	badCredentialsMessage = "That email and passcode do not match."
	proposalOpenMessage   = "You already have an open proposal for this time."
	parentTrashedMessage  = "Restore the series first, then this occurrence."
	fileStorageMessage    = "File storage is not answering. Nothing was changed. Try again shortly."
	deadLinkMessage       = "This link no longer works."
)

// Field sentences.
const (
	titleRequired  = "Enter a title."
	endAfterStart  = "End must be after start."
	dateTimeFormat = "Use YYYY-MM-DD HH:MM."
	dateFormat     = "Use YYYY-MM-DD."
	clockFormat    = "Use HH:MM."
)
