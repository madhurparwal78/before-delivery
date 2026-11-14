package main

import (
	"bytes"
	"encoding/json"
	"unicode/utf8"
)

// fieldErrors collects the 422 messages by field.
type fieldErrors map[string]string

func (f fieldErrors) err() error {
	if len(f) == 0 {
		return nil
	}
	return failValidation(f)
}

const (
	msgCourt        = "Pick a court from 1 to 7."
	msgStart        = "Pick a start inside opening hours on the slot grid."
	msgStartFuture  = "Pick a start in the future."
	msgMatchLate    = "Too late to open a match for this time."
	msgMinutes      = "Pick 60, 90 or 120 minutes."
	msgNote         = "Keep the note to 280 characters."
	msgDescription  = "Keep the description to 280 characters."
	msgCoPlayers    = "Add exactly three club players, or none."
	msgSplitLate    = "Too late to split this booking."
	msgStudents     = "Add one to four club players."
	msgWeeks        = "Pick 1 to 8 weeks."
	msgLevels       = "Use levels from 1.0 to 7.0 in steps of 0.5, lowest first."
	msgLevel        = "Your level is outside this match's range."
	msgRates        = "Use whole cents from 1 to 10000."
	msgPeakTimes    = "Use HH:MM on the half hour, start before end."
	msgPeakDays     = "Use mon to sun, each once."
	msgEffective    = "Pick a date from tomorrow on."
	msgLateFee      = "Use a whole number from 0 to 100."
	msgVersion      = "Send the version you edited."
	msgDate         = "Use a date like 2027-03-28."
	msgLimit        = "Ask for 1 to 50 rows."
	msgCursor       = "This cursor is not valid."
	msgIdempotency  = "Use 1 to 100 visible characters."
	msgToBeforeFrom = "End on or after the start date."
	msgTooManyDays  = "Ask for at most 7 days."
	msgTooManyCourt = "Ask for at most 8 courts."
	msgCourtList    = "Use court numbers 1 to 7, each once."
)

var allowedMinutes = []int{60, 90, 120}

// defaultMinutes is the length a start is checked against while the length itself is still unread.
var defaultMinutes = allowedMinutes[0]

// rawInt reads a JSON whole number.
func rawInt(raw json.RawMessage) (int, bool) {
	var number json.Number
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if len(raw) == 0 || decoder.Decode(&number) != nil {
		return 0, false
	}
	value, err := number.Int64()
	if err != nil {
		return 0, false
	}
	return int(value), true
}

func rawFloat(raw json.RawMessage) (float64, bool) {
	var value float64
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return 0, false
	}
	return value, true
}

func rawString(raw json.RawMessage) (string, bool) {
	var value string
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return "", false
	}
	return value, true
}

func rawStrings(raw json.RawMessage) ([]string, bool) {
	var values []string
	if len(raw) == 0 || json.Unmarshal(raw, &values) != nil {
		return nil, false
	}
	return values, true
}

// isAbsent is true for a field the body leaves out or sets to null.
func isAbsent(raw json.RawMessage) bool {
	return len(raw) == 0 || string(bytes.TrimSpace(raw)) == "null"
}

func withinRunes(text string, limit int) bool { return utf8.RuneCountInString(text) <= limit }

func allowedLength(minutes int) bool {
	for _, allowed := range allowedMinutes {
		if minutes == allowed {
			return true
		}
	}
	return false
}

// validLevel is true for a level from 1.0 to 7.0 in steps of 0.5.
func validLevel(value float64) bool {
	return value >= 1 && value <= 7 && value*2 == float64(int(value*2))
}
