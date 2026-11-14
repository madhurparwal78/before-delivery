package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5/pgconn"
)

const uniqueViolation = "23505"

// PricingBody is the pricing answer: the latest version's fields and every version.
type PricingBody struct {
	PricingVersion
	Schedule []PricingVersion `json:"schedule"`
}

func (a *App) pricingBody(ctx context.Context, q querier) (PricingBody, error) {
	rows, err := q.Query(ctx, "SELECT "+pricingColumns+" FROM pricing_versions v ORDER BY v.version")
	if err != nil {
		return PricingBody{}, fmt.Errorf("list pricing versions: %w", err)
	}
	defer rows.Close()
	body := PricingBody{Schedule: []PricingVersion{}}
	for rows.Next() {
		v, err := scanPricing(rows)
		if err != nil {
			return PricingBody{}, fmt.Errorf("read pricing version: %w", err)
		}
		body.Schedule = append(body.Schedule, v)
	}
	if err := rows.Err(); err != nil {
		return PricingBody{}, fmt.Errorf("list pricing versions: %w", err)
	}
	body.PricingVersion = body.Schedule[len(body.Schedule)-1]
	return body, nil
}

func (a *App) getPricing(ctx context.Context, _ *request) (result, error) {
	body, err := a.pricingBody(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	return ok(body), nil
}

func validPeakTime(text string) bool {
	return hmPattern.MatchString(text) && (text[3:] == "00" || text[3:] == "30")
}

func (a *App) putPricing(ctx context.Context, rq *request) (result, error) {
	var in struct {
		Offpeak       json.RawMessage `json:"offpeak_cents_per_minute"`
		Peak          json.RawMessage `json:"peak_cents_per_minute"`
		PeakStart     json.RawMessage `json:"peak_start"`
		PeakEnd       json.RawMessage `json:"peak_end"`
		PeakDays      json.RawMessage `json:"peak_days"`
		EffectiveFrom json.RawMessage `json:"effective_from"`
		Version       json.RawMessage `json:"version"`
	}
	if err := decodeJSON(rq, &in); err != nil {
		return result{}, err
	}
	current, err := a.pricingBody(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	version, versionOK := rawInt(in.Version)
	if versionOK && version != current.PricingVersion.Version {
		return result{}, fail(codeVersionStale)
	}
	problems := fieldErrors{}
	if !versionOK {
		problems["version"] = msgVersion
	}
	next := PricingVersion{Version: current.PricingVersion.Version + 1}
	for _, rate := range []struct {
		raw    json.RawMessage
		field  string
		target *int
	}{{in.Offpeak, "offpeak_cents_per_minute", &next.OffpeakCents}, {in.Peak, "peak_cents_per_minute", &next.PeakCents}} {
		if value, valid := rawInt(rate.raw); valid && value >= 1 && value <= 10000 {
			*rate.target = value
		} else {
			problems[rate.field] = msgRates
		}
	}
	start, startOK := rawString(in.PeakStart)
	end, endOK := rawString(in.PeakEnd)
	if startOK && endOK && validPeakTime(start) && validPeakTime(end) && start < end {
		next.PeakStart, next.PeakEnd = start, end
	} else {
		problems["peak_start"], problems["peak_end"] = msgPeakTimes, msgPeakTimes
	}
	days, daysOK := rawStrings(in.PeakDays)
	if daysOK && validPeakDays(days) {
		next.PeakDays = days
	} else {
		problems["peak_days"] = msgPeakDays
	}
	now, err := dbNow(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	tomorrow := a.clock.clubDate(now).AddDate(0, 0, 1)
	if text, valid := rawString(in.EffectiveFrom); valid {
		if day, parsed := parseDay(text); parsed && !day.Before(tomorrow) {
			next.EffectiveFrom = text
		} else {
			problems["effective_from"] = msgEffective
		}
	} else {
		problems["effective_from"] = msgEffective
	}
	if err := problems.err(); err != nil {
		return result{}, err
	}
	// Attribution comes only from the verified token and the database clock; a saved version is never edited.
	if _, err := a.pool.Exec(ctx, `INSERT INTO pricing_versions (version, effective_from, offpeak_cents, peak_cents, peak_start, peak_end, peak_days, saved_by, saved_by_name, saved_at)
		VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, date_trunc('milliseconds', clock_timestamp()))`, next.Version, next.EffectiveFrom,
		next.OffpeakCents, next.PeakCents, next.PeakStart, next.PeakEnd, next.PeakDays, rq.me.Username, rq.me.Name); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
			return result{}, fail(codeVersionStale)
		}
		return result{}, fmt.Errorf("save pricing version: %w", err)
	}
	saved, err := a.pricingBody(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	return ok(saved), nil
}

func validPeakDays(days []string) bool {
	seen := map[string]bool{}
	for _, day := range days {
		if !slices.Contains(weekdayNames, day) || seen[day] {
			return false
		}
		seen[day] = true
	}
	return true
}

// CancellationRule is the club's cancellation rule version.
type CancellationRule struct {
	Version        int    `json:"version"`
	LateFeePercent int    `json:"late_fee_percent"`
	Description    string `json:"description"`
	Attribution
}

func latestRule(ctx context.Context, q querier) (CancellationRule, error) {
	var rule CancellationRule
	var by attributionScan
	err := q.QueryRow(ctx, "SELECT v.version, v.late_fee_percent, v.description, "+attributionColumns+
		" FROM cancellation_rules v ORDER BY v.version DESC LIMIT 1").
		Scan(&rule.Version, &rule.LateFeePercent, &rule.Description, &by.username, &by.name, &by.at)
	if err != nil {
		return CancellationRule{}, fmt.Errorf("read cancellation rule: %w", err)
	}
	rule.Attribution = by.attribution()
	return rule, nil
}

func (a *App) getCancellationRule(ctx context.Context, _ *request) (result, error) {
	rule, err := latestRule(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	return ok(rule), nil
}

func (a *App) putCancellationRule(ctx context.Context, rq *request) (result, error) {
	var in struct {
		LateFeePercent json.RawMessage `json:"late_fee_percent"`
		Description    json.RawMessage `json:"description"`
		Version        json.RawMessage `json:"version"`
	}
	if err := decodeJSON(rq, &in); err != nil {
		return result{}, err
	}
	current, err := latestRule(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	version, versionOK := rawInt(in.Version)
	if versionOK && version != current.Version {
		return result{}, fail(codeVersionStale)
	}
	problems := fieldErrors{}
	if !versionOK {
		problems["version"] = msgVersion
	}
	next := CancellationRule{Version: current.Version + 1}
	if percent, valid := rawInt(in.LateFeePercent); valid && percent >= 0 && percent <= 100 {
		next.LateFeePercent = percent
	} else {
		problems["late_fee_percent"] = msgLateFee
	}
	if text, valid := rawString(in.Description); valid && withinRunes(text, maxNoteRunes) {
		next.Description = text
	} else {
		problems["description"] = msgDescription
	}
	if err := problems.err(); err != nil {
		return result{}, err
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO cancellation_rules (version, late_fee_percent, description, saved_by, saved_by_name, saved_at)
		VALUES ($1, $2, $3, $4, $5, date_trunc('milliseconds', clock_timestamp()))`,
		next.Version, next.LateFeePercent, next.Description, rq.me.Username, rq.me.Name); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
			return result{}, fail(codeVersionStale)
		}
		return result{}, fmt.Errorf("save cancellation rule: %w", err)
	}
	saved, err := latestRule(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	return ok(saved), nil
}

// UtilisationCourt is one court's booked and open minutes.
type UtilisationCourt struct {
	Court        int `json:"court"`
	BookedMinute int `json:"booked_minutes"`
	OpenMinutes  int `json:"open_minutes"`
	Percent      int `json:"percent"`
}

func percentOf(booked, open int) int {
	if open == 0 {
		return 0
	}
	return booked * 100 / open
}

func (a *App) getUtilisation(ctx context.Context, rq *request) (result, error) {
	now, err := dbNow(ctx, a.pool)
	if err != nil {
		return result{}, err
	}
	day := a.clock.clubDate(now)
	if rq.r.URL.Query().Has("date") {
		parsed, valid := parseDay(rq.r.URL.Query().Get("date"))
		if !valid {
			return result{}, failValidation(map[string]string{"date": msgDate})
		}
		day = parsed
	}
	from, to := a.dayBounds(day)
	rows, err := a.pool.Query(ctx, fmt.Sprintf(`SELECT court, COALESCE(sum(EXTRACT(EPOCH FROM (LEAST(e, $2) - GREATEST(s, $1))) / 60), 0)::int
		FROM (SELECT court, start_utc AS s, start_utc + make_interval(mins => minutes) AS e FROM bookings WHERE status IN %s
			UNION ALL SELECT court, start_utc, start_utc + make_interval(mins => minutes) FROM lessons) t
		WHERE s < $2 AND e > $1 GROUP BY court`, bookedStatusesSQL), from, to)
	if err != nil {
		return result{}, fmt.Errorf("read utilisation: %w", err)
	}
	defer rows.Close()
	booked := map[int]int{}
	for rows.Next() {
		var court, minutes int
		if err := rows.Scan(&court, &minutes); err != nil {
			return result{}, fmt.Errorf("read utilisation row: %w", err)
		}
		booked[court] = minutes
	}
	if err := rows.Err(); err != nil {
		return result{}, fmt.Errorf("read utilisation: %w", err)
	}
	open := a.clock.openMinutes(day)
	courts := make([]UtilisationCourt, 0, courtCount)
	totalBooked := 0
	for court := 1; court <= courtCount; court++ {
		courts = append(courts, UtilisationCourt{court, booked[court], open, percentOf(booked[court], open)})
		totalBooked += booked[court]
	}
	return ok(map[string]any{"date": day.Format(dateLayout), "open_minutes": open, "courts": courts,
		"total": map[string]int{"booked_minutes": totalBooked, "open_minutes": open * courtCount,
			"percent": percentOf(totalBooked, open*courtCount)}}), nil
}
