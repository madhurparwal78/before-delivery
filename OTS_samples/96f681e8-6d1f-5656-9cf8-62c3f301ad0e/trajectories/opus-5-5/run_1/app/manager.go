package main

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const managerLockKey = 7350002

func (a *app) pricingBody(ctx context.Context, q querier) (map[string]any, error) {
	rows, err := q.Query(ctx, `SELECT `+pricingColumns+` FROM pricing_version ORDER BY version`)
	if err != nil {
		return nil, fmt.Errorf("read price schedule: %w", err)
	}
	schedule, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (pricingVersion, error) { return scanPricingVersion(r) })
	if err != nil {
		return nil, fmt.Errorf("read price schedule: %w", err)
	}
	latest := schedule[len(schedule)-1]
	return map[string]any{
		"version": latest.Version, "effective_from": latest.EffectiveFrom, "offpeak_cents_per_minute": latest.Offpeak,
		"peak_cents_per_minute": latest.Peak, "peak_start": latest.PeakStart, "peak_end": latest.PeakEnd,
		"peak_days": latest.PeakDays, "saved_by": latest.SavedBy, "saved_at": latest.SavedAtText, "schedule": schedule,
	}, nil
}

func (a *app) getPricing(c *call) (int, any, error) {
	body, err := a.pricingBody(c.ctx, a.db)
	if err != nil {
		return 0, nil, err
	}
	return 200, body, nil
}

func validPeakClock(s string, allowEnd bool) (int, bool) {
	m, err := parseClock(s)
	if err != nil || m%30 != 0 || (m == 1440 && !allowEnd) {
		return 0, false
	}
	return m, true
}

// editedVersion reads the version a save was edited from; ok is false when it is missing.
func editedVersion(f jsonFields, errs map[string]string) (int, bool) {
	v, ok := f.intField("version")
	if !ok || v < 1 {
		errs["version"] = msgVersion
		return 0, false
	}
	return v, true
}

func (a *app) putPricing(c *call) (int, any, error) {
	f, err := c.fields()
	if err != nil {
		return 0, nil, err
	}
	errs := map[string]string{}
	version, hasVersion := editedVersion(f, errs)
	var body map[string]any
	err = a.tx(c.ctx, func(t *txn) error {
		if _, err := t.Exec(c.ctx, `SELECT pg_advisory_xact_lock($1)`, managerLockKey); err != nil {
			return fmt.Errorf("lock pricing: %w", err)
		}
		var current int
		var now time.Time
		if err := t.QueryRow(c.ctx, `SELECT max(version), now() FROM pricing_version`).Scan(&current, &now); err != nil {
			return fmt.Errorf("read pricing version: %w", err)
		}
		if hasVersion && version != current {
			return fail("VERSION_STALE")
		}
		offpeak, ok1 := f.intField("offpeak_cents_per_minute")
		if !ok1 || offpeak < 1 || offpeak > 10000 {
			errs["offpeak_cents_per_minute"] = msgCents
		}
		peak, ok2 := f.intField("peak_cents_per_minute")
		if !ok2 || peak < 1 || peak > 10000 {
			errs["peak_cents_per_minute"] = msgCents
		}
		ps, _ := f.stringField("peak_start")
		pe, _ := f.stringField("peak_end")
		startMin, okS := validPeakClock(ps, false)
		endMin, okE := validPeakClock(pe, true)
		if !okS {
			errs["peak_start"] = msgPeakTime
		}
		if !okE || (okS && endMin <= startMin) {
			errs["peak_end"] = msgPeakTime
		}
		days, okD := f.stringList("peak_days")
		known := map[string]bool{"mon": true, "tue": true, "wed": true, "thu": true, "fri": true, "sat": true, "sun": true}
		if !okD || !distinct(days) {
			errs["peak_days"] = msgPeakDays
		}
		for _, d := range days {
			if !known[d] {
				errs["peak_days"] = msgPeakDays
			}
		}
		raw, _ := f.stringField("effective_from")
		from, okF := parseClubDate(raw)
		if !okF || from.Before(a.cfg.clubDateOf(now).AddDays(1)) {
			errs["effective_from"] = msgEffectiveFrom
		}
		if len(errs) > 0 {
			return invalid(errs)
		}
		if _, err := t.Exec(c.ctx, `INSERT INTO pricing_version (version, effective_from, offpeak_cents_per_minute,
			peak_cents_per_minute, peak_start, peak_end, peak_days, saved_by, saved_by_name, saved_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`, current+1, from.String(), offpeak, peak, ps, pe,
			orderedDays(days), c.user.Username, c.user.Name); err != nil {
			return fmt.Errorf("save pricing: %w", err)
		}
		body, err = a.pricingBody(c.ctx, t)
		return err
	})
	if err != nil {
		return 0, nil, err
	}
	return 200, body, nil
}

func orderedDays(days []string) []string {
	out := []string{}
	for _, k := range []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"} {
		for _, d := range days {
			if d == k {
				out = append(out, k)
			}
		}
	}
	return out
}

func (a *app) ruleBody(ctx context.Context, q querier) (map[string]any, error) {
	var version, fee int
	var description string
	var savedBy, savedName *string
	var savedAt time.Time
	if err := q.QueryRow(ctx, `SELECT version, late_fee_percent, description, saved_by, saved_by_name, saved_at
		FROM cancellation_rule ORDER BY version DESC LIMIT 1`).Scan(&version, &fee, &description, &savedBy, &savedName, &savedAt); err != nil {
		return nil, fmt.Errorf("read cancellation rule: %w", err)
	}
	var by *person
	if savedBy != nil {
		by = &person{Username: *savedBy, Name: *savedName}
	}
	return map[string]any{"version": version, "late_fee_percent": fee, "description": description,
		"saved_by": by, "saved_at": utcStamp(savedAt)}, nil
}

func (a *app) getRule(c *call) (int, any, error) {
	body, err := a.ruleBody(c.ctx, a.db)
	if err != nil {
		return 0, nil, err
	}
	return 200, body, nil
}

func (a *app) putRule(c *call) (int, any, error) {
	f, err := c.fields()
	if err != nil {
		return 0, nil, err
	}
	errs := map[string]string{}
	version, hasVersion := editedVersion(f, errs)
	var body map[string]any
	err = a.tx(c.ctx, func(t *txn) error {
		if _, err := t.Exec(c.ctx, `SELECT pg_advisory_xact_lock($1)`, managerLockKey+1); err != nil {
			return fmt.Errorf("lock rule: %w", err)
		}
		var current int
		if err := t.QueryRow(c.ctx, `SELECT max(version) FROM cancellation_rule`).Scan(&current); err != nil {
			return fmt.Errorf("read rule version: %w", err)
		}
		if hasVersion && version != current {
			return fail("VERSION_STALE")
		}
		fee, ok := f.intField("late_fee_percent")
		if !ok || fee < 0 || fee > 100 {
			errs["late_fee_percent"] = msgLateFee
		}
		description, ok := f.stringField("description")
		if !ok || !withinTextLimit(description) {
			errs["description"] = msgDescription
		}
		if len(errs) > 0 {
			return invalid(errs)
		}
		if _, err := t.Exec(c.ctx, `INSERT INTO cancellation_rule (version, late_fee_percent, description, saved_by, saved_by_name, saved_at)
			VALUES ($1, $2, $3, $4, $5, now())`, current+1, fee, description, c.user.Username, c.user.Name); err != nil {
			return fmt.Errorf("save rule: %w", err)
		}
		body, err = a.ruleBody(c.ctx, t)
		return err
	})
	if err != nil {
		return 0, nil, err
	}
	return 200, body, nil
}

func (a *app) getUtilisation(c *call) (int, any, error) {
	now, err := dbNow(c.ctx, a.db)
	if err != nil {
		return 0, nil, err
	}
	d := a.cfg.clubDateOf(now)
	if v := c.r.URL.Query().Get("date"); v != "" {
		var ok bool
		if d, ok = parseClubDate(v); !ok {
			return 0, nil, invalidField("date", msgDate)
		}
	}
	from, to := a.cfg.dayBounds(d)
	booked := map[int]int{}
	rows, err := a.db.Query(c.ctx, `WITH used AS (
			SELECT court, start_utc, end_utc FROM booking_now WHERE state IN ('paid', 'checked-in', 'no-show')
			UNION ALL
			SELECT court, start_utc, start_utc + make_interval(mins => minutes) FROM lesson
		)
		SELECT court, COALESCE(sum(EXTRACT(EPOCH FROM LEAST(end_utc, $2) - GREATEST(start_utc, $1)) / 60), 0)::int
		FROM used WHERE start_utc < $2 AND end_utc > $1 GROUP BY court`, from, to)
	if err != nil {
		return 0, nil, fmt.Errorf("read utilisation: %w", err)
	}
	var court, minutes int
	if _, err := pgx.ForEachRow(rows, []any{&court, &minutes}, func() error {
		booked[court] = minutes
		return nil
	}); err != nil {
		return 0, nil, fmt.Errorf("read utilisation: %w", err)
	}
	open := a.cfg.openMinutes(d)
	percent := func(b, o int) int { return b * 100 / o }
	courts := []map[string]any{}
	total := 0
	for n := 1; n <= 7; n++ {
		total += booked[n]
		courts = append(courts, map[string]any{"court": n, "booked_minutes": booked[n], "open_minutes": open,
			"percent": percent(booked[n], open)})
	}
	return 200, map[string]any{"date": d.String(), "open_minutes": open, "courts": courts,
		"total": map[string]any{"booked_minutes": total, "open_minutes": open * 7, "percent": percent(total, open*7)}}, nil
}
