package main

import (
	"context"
	"fmt"
	"slices"
	"time"
)

var weekdayNames = []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}

// PricingVersion is one saved version of the club's rates, applying from 00:00 club time on its effective date.
type PricingVersion struct {
	Version       int      `json:"version"`
	EffectiveFrom string   `json:"effective_from"`
	OffpeakCents  int      `json:"offpeak_cents_per_minute"`
	PeakCents     int      `json:"peak_cents_per_minute"`
	PeakStart     string   `json:"peak_start"`
	PeakEnd       string   `json:"peak_end"`
	PeakDays      []string `json:"peak_days"`
	Attribution
}

// Attribution says who saved a settings version and when; SavedBy is nil for a seed version.
type Attribution struct {
	SavedBy *PersonRef `json:"saved_by"`
	SavedAt string     `json:"saved_at"`
}

// attributionColumns reads saved_by and saved_at of the table aliased v.
const attributionColumns = "v.saved_by, v.saved_by_name, v.saved_at"

const pricingColumns = "v.version, to_char(v.effective_from, 'YYYY-MM-DD'), v.offpeak_cents, v.peak_cents, v.peak_start, v.peak_end, v.peak_days, " +
	attributionColumns

type scanner interface{ Scan(...any) error }

func scanPricing(row scanner) (PricingVersion, error) {
	var v PricingVersion
	var by attributionScan
	err := row.Scan(&v.Version, &v.EffectiveFrom, &v.OffpeakCents, &v.PeakCents, &v.PeakStart, &v.PeakEnd, &v.PeakDays,
		&by.username, &by.name, &by.at)
	v.Attribution = by.attribution()
	return v, err
}

// attributionScan is saved_by and saved_at as read from a row.
type attributionScan struct {
	username, name *string
	at             time.Time
}

func (s attributionScan) attribution() Attribution {
	out := Attribution{SavedAt: formatUTC(s.at)}
	if s.username != nil {
		name := *s.username
		if s.name != nil {
			name = *s.name
		}
		out.SavedBy = &PersonRef{Username: *s.username, Name: name}
	}
	return out
}

// pricingInForce is the one place the pricing version for a slot's club date is chosen: the latest
// effective date on or before it, the higher version when two share a date.
func pricingInForce(ctx context.Context, q querier, clubDay string) (PricingVersion, error) {
	version, err := scanPricing(q.QueryRow(ctx,
		"SELECT "+pricingColumns+" FROM pricing_versions v WHERE v.effective_from <= $1::date ORDER BY v.effective_from DESC, v.version DESC LIMIT 1", clubDay))
	if err != nil {
		return PricingVersion{}, fmt.Errorf("pricing in force on %s: %w", clubDay, err)
	}
	return version, nil
}

// priceSlot prices a slot minute by minute, in whole cents, and counts its peak minutes.
func (c *ClubClock) priceSlot(v PricingVersion, start time.Time, minutes int) (total, peakMinutes int) {
	for i := 0; i < minutes; i++ {
		local := start.Add(time.Duration(i) * time.Minute).In(c.zone)
		hm := local.Format("15:04")
		if slices.Contains(v.PeakDays, weekdayNames[local.Weekday()]) && v.PeakStart <= hm && hm < v.PeakEnd {
			total += v.PeakCents
			peakMinutes++
		} else {
			total += v.OffpeakCents
		}
	}
	return total, peakMinutes
}

// Quote is the price of one slot.
type Quote struct {
	Court          int    `json:"court"`
	Start          string `json:"start"`
	StartUTC       string `json:"start_utc"`
	Minutes        int    `json:"minutes"`
	OffpeakMinutes int    `json:"offpeak_minutes"`
	PeakMinutes    int    `json:"peak_minutes"`
	TotalCents     int    `json:"total_cents"`
	SplitCents     []int  `json:"split_cents"`
	PricingVersion int    `json:"pricing_version"`
}

func (a *App) quoteSlot(ctx context.Context, q querier, court int, start time.Time, minutes int) (Quote, error) {
	version, err := pricingInForce(ctx, q, a.clock.clubDay(start))
	if err != nil {
		return Quote{}, err
	}
	total, peak := a.clock.priceSlot(version, start, minutes)
	return Quote{Court: court, Start: a.clock.formatClub(start), StartUTC: formatUTC(start), Minutes: minutes,
		OffpeakMinutes: minutes - peak, PeakMinutes: peak, TotalCents: total, SplitCents: splitFourWays(total),
		PricingVersion: version.Version}, nil
}
