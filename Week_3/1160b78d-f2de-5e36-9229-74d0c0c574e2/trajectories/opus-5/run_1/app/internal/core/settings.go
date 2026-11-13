package core

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// SaveSettings saves one person's zone, quiet hours and notification delays.
func (a *App) SaveSettings(ctx context.Context, userID string, body map[string]any) (*User, error) {
	user, err := a.UserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	errs := map[string]string{}

	timezone := user.Timezone
	if raw, ok := body["timezone"]; ok {
		value, _ := raw.(string)
		if _, err := time.LoadLocation(value); err != nil {
			errs["timezone"] = "Choose a listed time zone."
		} else {
			timezone = value
		}
	}

	quietStart, quietEnd := user.QuietStart, user.QuietEnd
	_, hasStart := body["quiet_start"]
	_, hasEnd := body["quiet_end"]
	if hasStart || hasEnd {
		readQuiet := func(name string, current *string) (*string, bool) {
			raw, ok := body[name]
			if !ok {
				return current, true
			}
			if raw == nil {
				return nil, true
			}
			value, _ := raw.(string)
			if value == "" {
				return nil, true
			}
			if _, _, ok := parseHHMM(value); !ok {
				errs[name] = "Use the format HH:MM."
				return nil, false
			}
			return &value, true
		}
		start, okStart := readQuiet("quiet_start", user.QuietStart)
		end, okEnd := readQuiet("quiet_end", user.QuietEnd)
		if okStart && okEnd {
			if (start == nil) != (end == nil) {
				errs["quiet_start"] = "Set both quiet hours times or neither."
			} else {
				quietStart, quietEnd = start, end
			}
		}
	}

	delays := user.NotificationDelays
	if raw, ok := body["notification_delays"]; ok {
		list, isList := raw.([]any)
		parsed := []int{}
		valid := isList && len(list) >= 1 && len(list) <= 5
		if valid {
			for _, item := range list {
				number, isNumber := item.(float64)
				if !isNumber || number != float64(int(number)) || number < 0 || number > 60 {
					valid = false
					break
				}
				parsed = append(parsed, int(number))
			}
		}
		if !valid {
			errs["notification_delays"] = "Use 1 to 5 whole minutes from 0 to 60, separated by commas."
		} else {
			delays = parsed
		}
	}

	lowDelay := user.LowUrgencyDelay
	if raw, ok := body["low_urgency_delay"]; ok {
		number, isNumber := raw.(float64)
		if !isNumber || number != float64(int(number)) || number < 0 || number > 60 {
			errs["low_urgency_delay"] = "Use a whole number of minutes from 0 to 60."
		} else {
			lowDelay = int(number)
		}
	}

	if len(errs) > 0 {
		return nil, errFieldMap(errs)
	}
	encoded, err := json.Marshal(delays)
	if err != nil {
		return nil, fmt.Errorf("write delays: %w", err)
	}
	if _, err := a.pool.Exec(ctx, `UPDATE users SET timezone=$1, quiet_start=$2, quiet_end=$3,
		notification_delays=$4, low_urgency_delay=$5 WHERE id=$6`,
		timezone, quietStart, quietEnd, encoded, lowDelay, userID); err != nil {
		return nil, fmt.Errorf("save settings: %w", err)
	}
	return a.UserByID(ctx, userID)
}

// ClockMoved clears the cached copies a clock move invalidates and tells every
// open screen.
func (a *App) ClockMoved(ctx context.Context) {
	a.clearOncallCache(ctx)
	a.clearStatusCache(ctx)
	a.publishClock(ctx)
	a.publishStatus(ctx)
}

// OverrideSavedCopy is the one sentence a saved cut reports, in the schedule's
// own zone.
func (a *App) OverrideSavedCopy(ctx context.Context, scheduleID string, override *Override) string {
	name := "Nobody"
	if override.Person != nil {
		name = override.Person.Name
	}
	zone := FirmZoneName
	if schedule, err := a.GetSchedule(ctx, scheduleID); err == nil {
		zone = schedule.Zone
	}
	loc := zoneOr(zone)
	return fmt.Sprintf("Override saved: %s from %s to %s.", name,
		LocalTime(override.Start, loc), LocalTime(override.End, loc))
}
