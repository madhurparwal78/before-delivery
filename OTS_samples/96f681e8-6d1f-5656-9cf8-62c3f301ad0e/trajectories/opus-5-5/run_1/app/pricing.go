package main

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

var weekdayKeys = []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}

type person struct {
	Username string `json:"username"`
	Name     string `json:"name"`
}

type pricingVersion struct {
	Version       int       `json:"version"`
	EffectiveFrom string    `json:"effective_from"`
	Offpeak       int       `json:"offpeak_cents_per_minute"`
	Peak          int       `json:"peak_cents_per_minute"`
	PeakStart     string    `json:"peak_start"`
	PeakEnd       string    `json:"peak_end"`
	PeakDays      []string  `json:"peak_days"`
	SavedBy       *person   `json:"saved_by"`
	SavedAt       time.Time `json:"-"`
	SavedAtText   string    `json:"saved_at"`
}

const pricingColumns = `version, effective_from::text, offpeak_cents_per_minute, peak_cents_per_minute,
	peak_start, peak_end, peak_days, saved_by, saved_by_name, saved_at`

func scanPricingVersion(row pgx.Row) (pricingVersion, error) {
	var v pricingVersion
	var savedBy, savedName *string
	if err := row.Scan(&v.Version, &v.EffectiveFrom, &v.Offpeak, &v.Peak, &v.PeakStart, &v.PeakEnd,
		&v.PeakDays, &savedBy, &savedName, &v.SavedAt); err != nil {
		return v, err
	}
	if savedBy != nil {
		v.SavedBy = &person{Username: *savedBy, Name: *savedName}
	}
	v.SavedAtText = utcStamp(v.SavedAt)
	return v, nil
}

// pricingVersionFor is the one place that picks the pricing version for a slot's club date.
func pricingVersionFor(ctx context.Context, q querier, d clubDate) (pricingVersion, error) {
	v, err := scanPricingVersion(q.QueryRow(ctx, `SELECT `+pricingColumns+` FROM pricing_version
		WHERE effective_from <= $1::date ORDER BY effective_from DESC, version DESC LIMIT 1`, d.String()))
	if err != nil {
		return v, fmt.Errorf("pricing version for %s: %w", d, err)
	}
	return v, nil
}

type slotPrice struct {
	OffpeakMinutes int
	PeakMinutes    int
	Total          int
	Version        int
}

// priceSlot is the one place a slot is priced: minute by minute in club time.
func (c *config) priceSlot(v pricingVersion, start time.Time, minutes int) slotPrice {
	peakStart, _ := parseClock(v.PeakStart)
	peakEnd, _ := parseClock(v.PeakEnd)
	days := map[string]bool{}
	for _, d := range v.PeakDays {
		days[d] = true
	}
	p := slotPrice{Version: v.Version}
	for i := 0; i < minutes; i++ {
		l := start.Add(time.Duration(i) * time.Minute).In(c.Location)
		m := l.Hour()*60 + l.Minute()
		if days[weekdayKeys[l.Weekday()]] && m >= peakStart && m < peakEnd {
			p.PeakMinutes++
			p.Total += v.Peak
		} else {
			p.OffpeakMinutes++
			p.Total += v.Offpeak
		}
	}
	return p
}

func (c *config) priceFor(ctx context.Context, q querier, start time.Time, minutes int) (slotPrice, error) {
	v, err := pricingVersionFor(ctx, q, c.clubDateOf(start))
	if err != nil {
		return slotPrice{}, err
	}
	return c.priceSlot(v, start, minutes), nil
}

// splitShares divides a total into n shares of floor(total/n), with the remainder on the first.
func splitShares(total, n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = total / n
	}
	out[0] += total - (total/n)*n
	return out
}

// lateFee is the one place the late cancellation fee is worked out.
func lateFee(paid, percent int) int {
	return paid * percent / 100
}

func euros(cents int) string {
	return fmt.Sprintf("€%d.%02d", cents/100, cents%100)
}
