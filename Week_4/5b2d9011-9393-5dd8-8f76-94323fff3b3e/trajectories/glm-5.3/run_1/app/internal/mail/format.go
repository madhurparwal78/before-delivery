package mail

import (
"fmt"
"time"

"holdfast/internal/zoneinfo"
)

// formatTime renders the published email time shape:
// Ddd D Mon YYYY, HH:MM <abbr> (<IANA zone>).
func formatTime(t time.Time, zone string) string {
loc, err := zoneinfo.Load(zone)
if err != nil {
loc = time.UTC
}
local := t.In(loc)
return fmt.Sprintf("%s (%s)", local.Format("Mon 2 Jan 2006, 15:04")+" "+zoneinfo.Abbr(local, loc), zone)
}
