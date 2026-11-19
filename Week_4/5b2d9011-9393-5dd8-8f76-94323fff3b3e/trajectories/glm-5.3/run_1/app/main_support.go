package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"holdfast/internal/api"
	"holdfast/internal/mail"
	"holdfast/internal/rooms"
	"holdfast/internal/sim"
	"holdfast/internal/store"
	"holdfast/internal/studio"
	"holdfast/internal/zoneinfo"
)

// probeLoop probes each dependency at least every 2 seconds and reports the
// result to the app, so /api/status reflects a change within 5 seconds.
func probeLoop(ctx context.Context, st *store.Store, vk *rooms.Valkey, sender *mail.Sender, app *api.App) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			app.SetService("postgres", st.Ping())
			if vk != nil {
				app.SetService("valkey", vk.Ping())
			} else {
				app.SetService("valkey", false)
			}
			app.SetService("mail", sender.Up())
		}
	}
}

// seedAll writes the seed records only when they are absent.
func seedAll(ctx context.Context, st *store.Store, zone studio.Zone) {
	series := []store.SeriesSeed{
		{
			ID: "series-friday-siege", Title: "Friday Siege", Mode: "siege",
			Weekday: "friday", LocalTime: "20:00", FirstDate: "2026-11-13",
			Weeks: 8, Capacity: 24,
		},
		{
			ID: "series-sunday-convoy", Title: "Sunday Convoy", Mode: "convoy",
			Weekday: "sunday", LocalTime: "19:00", FirstDate: "2026-11-15",
			Weeks: 4, Capacity: 12,
		},
	}
	// Expand each seeded series into its nights by the series rules.
	for i := range series {
		sr := &series[i]
		first, err := time.Parse("2006-01-02", sr.FirstDate)
		if err != nil {
			continue
		}
		for w := 0; w < sr.Weeks; w++ {
			date := first.AddDate(0, 0, 7*w)
			hh, mm, _ := parseWallTime(sr.LocalTime)
			startsAt, rule := studio.ExpandInZone(date.Year(), int(date.Month()), date.Day(), hh, mm, zone.Loc)
			localStart := date.Format("2006-01-02") + "T" + sr.LocalTime
			if rule == studio.ShiftedForward {
				ls := startsAt.In(zone.Loc)
				localStart = ls.Format("2006-01-02T15:04")
			}
			sr.Nights = append(sr.Nights, store.NightSeed{
				ID:              store.NewID(),
				Date:            date.Format("2006-01-02"),
				LocalStart:       localStart,
				UTCOffset:       utcOffsetOf(startsAt, zone.Loc),
				ZoneAbbr:        abbrOf(startsAt, zone.Loc),
				StartsAt:        startsAt,
				SignupsOpenAt:   startsAt.Add(-studio.SignupsLeadHours * time.Hour),
				SignupsCloseAt:  startsAt.Add(-studio.SignupsCloseLead),
				EndsAt:          startsAt.Add(studio.NightDuration),
				DstNote:         rule.Note(),
			})
		}
	}
	st.Seed(ctx, "Cinderlatch Games", zone.Name, "latch-founder-2026",
		map[string]int{"ammo_pack": 120, "grenade": 200, "med_kit": 150}, series)
}

func parseWallTime(s string) (int, int, bool) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return 0, 0, false
	}
	hh := 0
	for _, c := range parts[0] {
		if c < '0' || c > '9' {
			return 0, 0, false
		}
		hh = hh*10 + int(c-'0')
	}
	mm := 0
	for _, c := range parts[1] {
		if c < '0' || c > '9' {
			return 0, 0, false
		}
		mm = mm*10 + int(c-'0')
	}
	return hh, mm, hh <= 23 && mm <= 59
}

// saveMatch stores a finished match and its laps.
func saveMatch(ctx context.Context, st *store.Store, rec rooms.FinishRecord) {
	m := store.Match{
		ID:           store.NewID(),
		Code:         rec.Code,
		Mode:         rec.Mode,
		Result:       rec.Result,
		WavesCleared: rec.WavesCleared,
		NightID:      nightIDAny(rec.NightID),
		StartedAt:    rec.StartedAt,
		EndedAt:      time.Now().UTC(),
	}
	for _, p := range rec.Players {
		m.Players = append(m.Players, store.MatchPlayer{
			Seat: p.Seat, Callsign: p.Callsign, Score: int(p.Score), Kills: p.Kills,
			CreditsEarned: int(p.CreditsEarned), BestLapMs: bestLapAny(p.BestLapMs),
		})
	}
	var laps []store.LapRow
	for _, l := range rec.Laps {
		laps = append(laps, store.LapRow{MatchID: m.ID, Callsign: l.Callsign, LapMs: l.LapMs, SetAt: l.SetAt})
	}
	st.SaveMatch(ctx, m, laps)
}

func nightIDAny(n string) any {
	if n == "" {
		return nil
	}
	return n
}

func bestLapAny(b *int64) any {
	if b == nil {
		return nil
	}
	return *b
}

// serveFrontend serves the built frontend and the three app routes. Anything
// else under the app answers 404. Source, manifests, lockfiles and dotfiles
// are never served.
func serveFrontend(w http.ResponseWriter, r *http.Request, dir string) {
	path := r.URL.Path
	if strings.HasPrefix(path, "/api/") {
		http.NotFound(w, r)
		return
	}
	switch path {
	case "/", "/nights":
		serveIndex(w, r, dir)
		return
	}
	if strings.HasPrefix(path, "/room/") {
		serveIndex(w, r, dir)
		return
	}
	serveAsset(w, r, dir, path)
}

func serveIndex(w http.ResponseWriter, r *http.Request, dir string) {
	name := filepath.Join(dir, "index.html")
	data, err := os.ReadFile(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(data)
}

// blockedPaths are never served.
func blockedPath(path string) bool {
	if strings.Contains(path, "..") {
		return true
	}
	base := filepath.Base(path)
	if strings.HasPrefix(base, ".") {
		return true
	}
	switch base {
	case "run.json", "go.mod", "go.sum", "package.json", "package-lock.json", "THIRD_PARTY_NOTICES.md":
		return true
	}
	for _, ext := range []string{".go", ".ts", ".tsx", ".env", ".md"} {
		if strings.HasSuffix(base, ext) {
			return true
		}
	}
	return false
}

func serveAsset(w http.ResponseWriter, r *http.Request, dir, path string) {
	clean := filepath.Clean("/" + path)
	if blockedPath(clean) {
		http.NotFound(w, r)
		return
	}
	full := filepath.Join(dir, clean)
	if !strings.HasPrefix(full, filepath.Clean(dir)) {
		http.NotFound(w, r)
		return
	}
	data, err := os.ReadFile(full)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentTypeFor(full))
	w.Write(data)
}

func contentTypeFor(name string) string {
	switch {
	case strings.HasSuffix(name, ".html"):
		return "text/html; charset=utf-8"
	case strings.HasSuffix(name, ".css"):
		return "text/css; charset=utf-8"
	case strings.HasSuffix(name, ".js"):
		return "text/javascript; charset=utf-8"
	case strings.HasSuffix(name, ".json"):
		return "application/json; charset=utf-8"
	case strings.HasSuffix(name, ".svg"):
		return "image/svg+xml"
	case strings.HasSuffix(name, ".woff2"):
		return "font/woff2"
	case strings.HasSuffix(name, ".png"):
		return "image/png"
	}
	return "application/octet-stream"
}

// liveShopItemsSource renders the shop's prices for each snapshot.
func liveShopItemsSource(st *store.Store) rooms.PriceSource {
	return func(ctx context.Context, now time.Time) []sim.ShopItem {
		return readShopItems(ctx, st, now)
	}
}

func readShopItems(ctx context.Context, st *store.Store, now time.Time) []sim.ShopItem {
	rows, err := st.PriceChanges(ctx)
	if err != nil {
		return nil
	}
	items := []sim.ShopItem{
		{Item: "ammo_pack", Name: "Ammo pack"},
		{Item: "grenade", Name: "Grenade"},
		{Item: "med_kit", Name: "Med kit"},
	}
	for i := range items {
		it := &items[i]
		var currentAt time.Time
		haveCurrent := false
		for _, pc := range rows {
			if pc.Item != it.Item || pc.EffectiveAt.After(now) {
				continue
			}
			if !haveCurrent || pc.EffectiveAt.After(currentAt) {
				currentAt = pc.EffectiveAt
				it.Price = pc.Price
				haveCurrent = true
			}
		}
		var nextAt time.Time
		haveNext := false
		var nextPrice int
		for _, pc := range rows {
			if pc.Item != it.Item || !pc.EffectiveAt.After(now) {
				continue
			}
			if !haveNext || pc.EffectiveAt.Before(nextAt) {
				nextAt = pc.EffectiveAt
				nextPrice = pc.Price
				haveNext = true
			}
		}
		if haveNext {
			np := nextPrice
			it.NextPrice = &np
			inMs := nextAt.Sub(now).Milliseconds()
			it.NextChangeInMs = &inMs
		}
	}
	return items
}

func utcOffsetOf(t time.Time, loc *time.Location) string {
	_, offset := t.In(loc).Zone()
	sign := "+"
	if offset < 0 {
		sign = "-"
		offset = -offset
	}
	return fmt.Sprintf("%s%02d:%02d", sign, offset/3600, (offset%3600)/60)
}

func abbrOf(t time.Time, loc *time.Location) string {
	return zoneinfo.Abbr(t, loc)
}
