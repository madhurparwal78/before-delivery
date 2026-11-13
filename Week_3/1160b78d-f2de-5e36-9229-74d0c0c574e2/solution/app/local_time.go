package main

import (
	"fmt"
	"time"
)

// firmZone is the zone the firm keeps its times in: the public status page, and what an API key sees.
const firmZone = "America/Chicago"

// localLayout is the brief's "local time": YYYY-MM-DD HH:MM ZZZ.
const localLayout = "2006-01-02 15:04 MST"

// localLabel renders an instant as local time in a loaded zone.
func localLabel(t time.Time, loc *time.Location) string {
	return t.In(loc).Format(localLayout)
}

// localTime renders an instant as local time in a named zone.
func localTime(at time.Time, zoneName string) (string, error) {
	zone, err := time.LoadLocation(zoneName)
	if err != nil {
		return "", fmt.Errorf("load zone %s: %w", zoneName, err)
	}
	return localLabel(at, zone), nil
}
