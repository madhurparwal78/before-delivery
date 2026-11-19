package domain

import (
	"fmt"
	"strings"
	"time"
	// The saleroom shows every server time in Rotterdam local time, so the
	// zone database travels with the binary.
	_ "time/tzdata"
)

// Rotterdam is the saleroom's display zone.
var Rotterdam = mustLoadRotterdam()

func mustLoadRotterdam() *time.Location {
	loc, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		panic(fmt.Sprintf("load Europe/Amsterdam: %v", err))
	}
	return loc
}

// Euros writes a whole-euro amount as the brief's <euros> placeholder.
func Euros(euros int) string { return "€" + Grouped(int64(euros)) }

// Amount writes euros and cents as the brief's <amount> placeholder.
func Amount(c Cents) string {
	v := int64(c)
	return "€" + Grouped(v/100) + fmt.Sprintf(".%02d", v%100)
}

// Grouped writes a whole number with comma thousands separators.
func Grouped(n int64) string {
	s := fmt.Sprintf("%d", n)
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	if neg {
		return "-" + string(out)
	}
	return string(out)
}

// RotterdamTime writes a server time as the brief's <rotterdam time>
// placeholder, for example "12 Nov 2026, 20:14:30".
func RotterdamTime(t time.Time) string {
	return t.In(Rotterdam).Format("2 Jan 2006, 15:04:05")
}
