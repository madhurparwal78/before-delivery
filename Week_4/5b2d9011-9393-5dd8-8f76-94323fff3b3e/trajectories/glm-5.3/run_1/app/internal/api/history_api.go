package api

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"holdfast/internal/apperr"
	"holdfast/internal/httpx"
	"holdfast/internal/maps"
	"holdfast/internal/store"
)

func (a *App) handleHistory(w http.ResponseWriter, r *http.Request) {
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	limit := 20
	if s := r.URL.Query().Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 50 {
			httpx.WriteError(w, apperr.SingleValidation("limit", "Use 1 to 50."))
			return
		}
		limit = n
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	rows, err := a.Store.History(ctx, limit)
	if err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, m := range rows {
		players := make([]map[string]any, 0, len(m.Players))
		for _, p := range m.Players {
			pm := map[string]any{
				"callsign": p.Callsign, "score": p.Score, "kills": p.Kills,
				"credits_earned": p.CreditsEarned, "best_lap_ms": nil,
			}
			if ms, ok := p.BestLapMs.(int64); ok {
				pm["best_lap_ms"] = ms
			}
			players = append(players, pm)
		}
		out = append(out, map[string]any{
			"id": m.ID, "code": m.Code, "mode": m.Mode, "result": m.Result,
			"waves_cleared": m.WavesCleared, "night_id": m.NightID,
			"started_at": clockInstant(m.StartedAt), "ended_at": clockInstant(m.EndedAt),
			"players": players,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"matches": out})
}

func (a *App) handleLaps(w http.ResponseWriter, r *http.Request) {
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	limit := 10
	if s := r.URL.Query().Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 50 {
			httpx.WriteError(w, apperr.SingleValidation("limit", "Use 1 to 50."))
			return
		}
		limit = n
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	rows, err := a.Store.BestLaps(ctx, limit)
	if err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for i, b := range rows {
		out = append(out, map[string]any{
			"rank": i + 1, "callsign": b.Callsign, "lap_ms": b.LapMs,
			"set_at": clockInstant(b.SetAt), "match_id": b.MatchID,
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"laps": out})
}

func (a *App) handleMap(w http.ResponseWriter, r *http.Request, id string) {
	m, ok := maps.ByID(id)
	if !ok {
		httpx.WriteError(w, apperr.NotFound)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, m)
}

func (a *App) handlePrices(w http.ResponseWriter, r *http.Request) {
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if r.Method == http.MethodGet {
		a.handlePricesGet(w)
		return
	}
	a.handlePricesPost(w, r)
}

func (a *App) handlePricesGet(w http.ResponseWriter) {
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	rows, err := a.Store.PriceChanges(ctx)
	if err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	now := a.Clock.Now().UTC()
	type scheduleRow struct {
		ID            string `json:"id"`
		Item          string `json:"item"`
		Price         int    `json:"price"`
		EffectiveLocal string `json:"effective_local"`
		EffectiveAt   string `json:"effective_at"`
		Status        string `json:"status"`
	}
	schedule := make([]scheduleRow, 0, len(rows))
	// For each item, find the row currently deciding the price.
	currentIdx := map[string]int{}
	for i, pc := range rows {
		if pc.EffectiveAt.After(now) {
			continue
		}
		if cur, ok := currentIdx[pc.Item]; !ok || pc.EffectiveAt.After(rows[cur].EffectiveAt) {
			currentIdx[pc.Item] = i
		}
	}
	for i, pc := range rows {
		status := "superseded"
		if pc.EffectiveAt.After(now) {
			status = "pending"
		} else if currentIdx[pc.Item] == i {
			status = "in_effect"
		}
		schedule = append(schedule, scheduleRow{
			ID: pc.ID, Item: pc.Item, Price: pc.Price,
			EffectiveLocal: pc.EffectiveLocal, EffectiveAt: clockInstant(pc.EffectiveAt),
			Status: status,
		})
	}
	items := []map[string]any{
		{"item": "ammo_pack", "name": "Ammo pack"},
		{"item": "grenade", "name": "Grenade"},
		{"item": "med_kit", "name": "Med kit"},
	}
	for _, it := range items {
		item := it["item"].(string)
		price := 0
		var currentAt time.Time
		haveCurrent := false
		for _, pc := range rows {
			if pc.Item != item || pc.EffectiveAt.After(now) {
				continue
			}
			if !haveCurrent || pc.EffectiveAt.After(currentAt) {
				currentAt = pc.EffectiveAt
				price = pc.Price
				haveCurrent = true
			}
		}
		it["current_price"] = price
		var next *map[string]any
		var nextAt time.Time
		haveNext := false
		var nextPrice int
		var nextID string
		var nextLocal string
		for _, pc := range rows {
			if pc.Item != item || !pc.EffectiveAt.After(now) {
				continue
			}
			if !haveNext || pc.EffectiveAt.Before(nextAt) {
				nextAt = pc.EffectiveAt
				nextPrice = pc.Price
				nextID = pc.ID
				nextLocal = pc.EffectiveLocal
				haveNext = true
			}
		}
		if haveNext {
			next = &map[string]any{
				"id": nextID, "price": nextPrice, "effective_local": nextLocal,
				"effective_at": clockInstant(nextAt), "in_ms": nextAt.Sub(now).Milliseconds(),
			}
		}
		it["next_change"] = next
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"zone": a.Studio.Name, "items": items, "schedule": schedule,
	})
}

func (a *App) handlePricesPost(w http.ResponseWriter, r *http.Request) {
	player, aerr := a.authenticate(r)
	if aerr != nil {
		httpx.WriteError(w, aerr)
		return
	}
	if player.Role != "founder" {
		httpx.WriteError(w, apperr.ForbiddenRole())
		return
	}
	var body struct {
		Item          string `json:"item"`
		Price         *int   `json:"price"`
		EffectiveLocal string `json:"effective_local"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	fields := map[string]string{}
	if body.Item != "ammo_pack" && body.Item != "grenade" && body.Item != "med_kit" {
		fields["item"] = "Pick ammo_pack, grenade or med_kit."
	}
	if body.Price == nil || *body.Price < 1 || *body.Price > 5000 {
		fields["price"] = "Use a whole number from 1 to 5000."
	}
	effectiveAt, ok := a.parseLocalInstant(body.EffectiveLocal)
	if !ok {
		fields["effective_local"] = "Pick a time after now, in studio time."
	}
	if len(fields) > 0 {
		httpx.WriteError(w, apperr.Validation(fields))
		return
	}
	if !effectiveAt.After(a.Clock.Now()) {
		httpx.WriteError(w, apperr.SingleValidation("effective_local", "Pick a time after now, in studio time."))
		return
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	id := store.NewID()
	row, err := a.Store.CreatePriceChange(ctx, id, body.Item, *body.Price, body.EffectiveLocal, effectiveAt)
	if err != nil {
		if errors.Is(err, store.ErrPriceExists) {
			httpx.WriteError(w, apperr.PriceChangeExists)
			return
		}
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"id": row.ID, "item": row.Item, "price": row.Price,
		"effective_local": row.EffectiveLocal, "effective_at": clockInstant(row.EffectiveAt),
		"status": "pending",
	})
}

// parseLocalInstant parses a studio-local instant typed as YYYY-MM-DD HH:MM
// or YYYY-MM-DDTHH:MM (also with a space in place of T).
func (a *App) parseLocalInstant(s string) (time.Time, bool) {
	if len(s) < len("2006-01-02T15:04") {
		return time.Time{}, false
	}
	normalized := s
	if len(s) > 10 && s[10] == ' ' {
		normalized = s[:10] + "T" + s[11:]
	}
	t, err := parseLocal(normalized, a.Studio.Loc)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func (a *App) handlePriceDelete(w http.ResponseWriter, r *http.Request, id string) {
	player, aerr := a.authenticate(r)
	if aerr != nil {
		httpx.WriteError(w, aerr)
		return
	}
	if player.Role != "founder" {
		httpx.WriteError(w, apperr.ForbiddenRole())
		return
	}
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	row, found, err := a.Store.PriceChangeByID(ctx, id)
	if err != nil || !found {
		httpx.WriteError(w, apperr.NotFound)
		return
	}
	if !row.EffectiveAt.After(a.Clock.Now()) {
		httpx.WriteError(w, apperr.PriceChangeInEffect)
		return
	}
	if err := a.Store.DeletePriceChange(ctx, id); err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
