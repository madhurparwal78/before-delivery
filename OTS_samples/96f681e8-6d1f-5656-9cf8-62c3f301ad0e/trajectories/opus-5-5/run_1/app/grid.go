package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type gridItem struct {
	Kind      string
	State     string
	Court     int
	Start     time.Time
	End       time.Time
	Mine      bool
	BookingID *string
	MatchID   *string
	Players   *int
}

type gridCell struct {
	Court     int     `json:"court"`
	Start     string  `json:"start"`
	StartUTC  string  `json:"start_utc"`
	State     string  `json:"state"`
	Mine      bool    `json:"mine"`
	BookingID *string `json:"booking_id"`
	MatchID   *string `json:"match_id"`
	Players   *int    `json:"players"`
}

// cellPrecedence orders what may cover a cell: the first found wins.
var cellPrecedence = []string{"held", "booked", "match", "lesson"}

func parseCourts(v string) ([]int, string) {
	if v == "" {
		return []int{1, 2, 3, 4, 5, 6, 7}, ""
	}
	parts := strings.Split(v, ",")
	if len(parts) > 8 {
		return nil, "Ask for at most 8 courts."
	}
	seen := map[int]bool{}
	var out []int
	for _, p := range parts {
		n, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil || n < 1 || n > 7 || seen[n] {
			return nil, "Use court numbers 1 to 7, each once."
		}
		seen[n] = true
		out = append(out, n)
	}
	return out, ""
}

func (a *app) getGrid(c *call) (int, any, error) {
	q := c.r.URL.Query()
	now, err := dbNow(c.ctx, a.db)
	if err != nil {
		return 0, nil, err
	}
	errs := map[string]string{}
	from := a.cfg.clubDateOf(now)
	if v := q.Get("from"); v != "" {
		var ok bool
		if from, ok = parseClubDate(v); !ok {
			errs["from"] = msgDate
		}
	}
	to := from
	if v := q.Get("to"); v != "" {
		var ok bool
		if to, ok = parseClubDate(v); !ok {
			errs["to"] = msgDate
		}
	}
	if errs["from"] == "" && errs["to"] == "" {
		switch {
		case to.Before(from):
			errs["to"] = "End on or after the start date."
		case from.DaysUntil(to) > 6:
			errs["to"] = "Ask for at most 7 days."
		}
	}
	courts, courtErr := parseCourts(q.Get("courts"))
	if courtErr != "" {
		errs["courts"] = courtErr
	}
	if len(errs) > 0 {
		return 0, nil, invalid(errs)
	}
	rangeFrom, _ := a.cfg.dayBounds(from)
	_, rangeTo := a.cfg.dayBounds(to)
	items, err := a.gridItems(c, rangeFrom, rangeTo, courts)
	if err != nil {
		return 0, nil, err
	}
	days := []map[string]any{}
	for d := from; !to.Before(d); d = d.AddDays(1) {
		cells := []gridCell{}
		for _, start := range a.cfg.gridStarts(d) {
			end := start.Add(30 * time.Minute)
			for _, court := range courts {
				cell := gridCell{Court: court, Start: a.cfg.clubOffsetTime(start), StartUTC: utcStamp(start), State: "free"}
				if !start.After(now) {
					cell.State = "past"
				}
				for _, kind := range cellPrecedence {
					if it := findItem(items, kind, court, start, end); it != nil {
						cell.State, cell.Mine = kind, it.Mine
						if it.Mine {
							cell.BookingID = it.BookingID
						}
						cell.MatchID, cell.Players = it.MatchID, it.Players
						break
					}
				}
				cells = append(cells, cell)
			}
		}
		days = append(days, map[string]any{"date": d.String(), "cells": cells})
	}
	return 200, map[string]any{"timezone": a.cfg.Location.String(), "server_now": utcStamp(now), "days": days}, nil
}

func findItem(items []gridItem, kind string, court int, start, end time.Time) *gridItem {
	for i := range items {
		it := &items[i]
		if it.Kind == kind && it.Court == court && it.Start.Before(end) && it.End.After(start) {
			return it
		}
	}
	return nil
}

func (a *app) gridItems(c *call, from, to time.Time, courts []int) ([]gridItem, error) {
	rows, err := a.db.Query(c.ctx, `
		SELECT CASE WHEN state = 'held' THEN 'held' ELSE 'booked' END, court, start_utc, end_utc, organiser = $3, id, match_id, NULL::int
		FROM booking_now WHERE state IN ('held', 'paid', 'checked-in', 'no-show')
			AND court = ANY($4) AND start_utc < $2 AND end_utc > $1
		UNION ALL
		SELECT 'match', court, start_utc, start_utc + make_interval(mins => minutes), false, NULL, id, players
		FROM match_now WHERE state = 'open' AND court = ANY($4)
			AND start_utc < $2 AND start_utc + make_interval(mins => minutes) > $1
		UNION ALL
		SELECT 'lesson', court, start_utc, start_utc + make_interval(mins => minutes), false, NULL, NULL, NULL
		FROM lesson WHERE court = ANY($4) AND start_utc < $2 AND start_utc + make_interval(mins => minutes) > $1`,
		from, to, c.user.Username, courts)
	if err != nil {
		return nil, fmt.Errorf("read grid: %w", err)
	}
	items, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (gridItem, error) {
		var it gridItem
		err := r.Scan(&it.Kind, &it.Court, &it.Start, &it.End, &it.Mine, &it.BookingID, &it.MatchID, &it.Players)
		return it, err
	})
	if err != nil {
		return nil, fmt.Errorf("read grid: %w", err)
	}
	return items, nil
}

func (a *app) getQuote(c *call) (int, any, error) {
	q := c.r.URL.Query()
	start, _ := json.Marshal(q.Get("start"))
	f := jsonFields{"court": json.RawMessage(q.Get("court")), "minutes": json.RawMessage(q.Get("minutes")), "start": start}
	now, err := dbNow(c.ctx, a.db)
	if err != nil {
		return 0, nil, err
	}
	errs := map[string]string{}
	slot := a.parseSlot(f, now, errs)
	if len(errs) > 0 {
		return 0, nil, invalid(errs)
	}
	price, err := a.cfg.priceFor(c.ctx, a.db, slot.Start, slot.Minutes)
	if err != nil {
		return 0, nil, err
	}
	return 200, map[string]any{
		"court": slot.Court, "start": a.cfg.clubOffsetTime(slot.Start), "start_utc": utcStamp(slot.Start),
		"minutes": slot.Minutes, "offpeak_minutes": price.OffpeakMinutes, "peak_minutes": price.PeakMinutes,
		"total_cents": price.Total, "split_cents": splitShares(price.Total, 4), "pricing_version": price.Version,
	}, nil
}
