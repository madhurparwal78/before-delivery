package api

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"holdfast/internal/apperr"
	"holdfast/internal/httpx"
	"holdfast/internal/sim"
)

var reportIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// reportBody is one client report.
type reportBody struct {
	ReportID    string  `json:"report_id"`
	Type        string  `json:"type"`
	Aim         *float64 `json:"aim"`
	Target      *struct {
		X *float64 `json:"x"`
		Z *float64 `json:"z"`
	} `json:"target"`
	TargetPlayer string `json:"target_player"`
}

func (a *App) handleRoomReport(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	player, seated := a.requireSeat(w, r, room)
	if !seated {
		return
	}
	var body reportBody
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	res, aerr := a.applyReport(r, room, player, body)
	if aerr != nil {
		httpx.WriteError(w, aerr)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, res)
}

func (a *App) handleRoomReportBatch(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	player, seated := a.requireSeat(w, r, room)
	if !seated {
		return
	}
	var body struct {
		Reports []reportBody `json:"reports"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if len(body.Reports) < 1 || len(body.Reports) > 64 {
		httpx.WriteError(w, apperr.SingleValidation("reports", "Send 1 to 64 reports."))
		return
	}
	if room.DegradedPublic() != "" {
		httpx.WriteError(w, apperr.RoomPaused)
		return
	}
	results := make([]any, 0, len(body.Reports))
	for _, rep := range body.Reports {
		res, aerr := a.applyReport(r, room, player, rep)
		if aerr != nil {
			if aerr == apperr.ReportConflict {
				results = append(results, map[string]any{"error": map[string]any{
					"code": "report_conflict", "message": apperr.ReportConflict.Message,
				}})
				continue
			}
			httpx.WriteError(w, aerr)
			return
		}
		results = append(results, res)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"results": results})
}

// applyReport validates, dedupes and applies one report.
func (a *App) applyReport(r *http.Request, room *sim.Room, player *sim.Player, body reportBody) (sim.ReportResult, *apperr.Error) {
	fields := map[string]string{}
	if !reportIDPattern.MatchString(body.ReportID) {
		fields["report_id"] = "Use 1 to 64 letters, digits, underscores or hyphens."
	}
	switch body.Type {
	case "shot":
		if body.Aim == nil || *body.Aim < 0 || *body.Aim > 360 {
			fields["aim"] = "Send 0 to 360."
		}
	case "reload":
	case "grenade":
		if body.Target == nil || body.Target.X == nil || body.Target.Z == nil {
			fields["target"] = "Send a target point."
		}
	case "revive":
		if body.TargetPlayer == "" {
			fields["target_player"] = "Send the downed player's id."
		}
	default:
		fields["type"] = "Pick shot, reload, grenade or revive."
	}
	if len(fields) > 0 {
		return sim.ReportResult{}, apperr.Validation(fields)
	}
	if room.DegradedPublic() != "" {
		return sim.ReportResult{}, apperr.RoomPaused
	}

	// Idempotent replay: a stored id returns its stored result.
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	stored, found, err := a.Hub.GetReport(ctx, room.Code, body.ReportID)
	if err != nil {
		return sim.ReportResult{}, apperr.RoomsUnavailable
	}
	if found {
		if stored.Body != canonicalReportBody(body) {
			return sim.ReportResult{}, apperr.ReportConflict
		}
		return stored.Result, nil
	}

	room.RoomLock()
	nowMono := a.Clock.Mono()
	var res sim.ReportResult
	switch body.Type {
	case "shot":
		res = room.Shot(player.ID, body.ReportID, *body.Aim, nowMono)
	case "reload":
		res = room.Reload(player.ID, body.ReportID, nowMono)
	case "grenade":
		res = room.ThrowGrenade(player.ID, body.ReportID, *body.Target.X, *body.Target.Z, nowMono)
	case "revive":
		res = room.Revive(player.ID, body.ReportID, body.TargetPlayer, nowMono)
	}
	// Credit ledger movements for kills and wave bonuses are written when the
	// match ends; purchases write theirs at purchase time.
	room.RoomUnlock()

	res.Body = canonicalReportBody(body)
	if err := a.Hub.PutReport(ctx, room.Code, res); err != nil {
		// A same-moment duplicate lost the race; the stored result is the
		// identical outcome, so it is returned unchanged.
		if stored, found, gerr := a.Hub.GetReport(ctx, room.Code, body.ReportID); gerr == nil && found {
			return stored.Result, nil
		}
	}
	return res, nil
}

// canonicalReportBody renders a report's identity for conflict detection.
func canonicalReportBody(b reportBody) string {
	switch b.Type {
	case "shot":
		return "shot:" + formatNum(*b.Aim)
	case "reload":
		return "reload"
	case "grenade":
		return "grenade:" + formatNum(*b.Target.X) + "," + formatNum(*b.Target.Z)
	case "revive":
		return "revive:" + b.TargetPlayer
	}
	return b.Type
}

func formatNum(f float64) string {
	return strconvFormat(f)
}

func (a *App) handleRoomPose(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	player, seated := a.requireSeat(w, r, room)
	if !seated {
		return
	}
	var body struct {
		Seq     *int64    `json:"seq"`
		X       *float64  `json:"x"`
		Z       *float64  `json:"z"`
		Heading *float64  `json:"heading"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	fields := map[string]string{}
	if body.Seq == nil || *body.Seq < 1 {
		fields["seq"] = "Use a whole number of 1 or more."
	}
	if body.X == nil || body.Z == nil {
		fields["x"] = "Send the car's position."
		fields["z"] = "Send the car's position."
	}
	if body.Heading == nil || *body.Heading < 0 || *body.Heading > 360 {
		fields["heading"] = "Send 0 to 360."
	}
	if len(fields) > 0 {
		httpx.WriteError(w, apperr.Validation(fields))
		return
	}
	if room.DegradedPublic() != "" {
		httpx.WriteError(w, apperr.RoomPaused)
		return
	}
	room.RoomLock()
	defer room.RoomUnlock()
	accepted, reason := room.Pose(player.ID, *body.Seq, *body.X, *body.Z, *body.Heading, a.Clock.Mono())
	v := room.VehicleView(player.ID)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"seq": *body.Seq, "accepted": accepted, "reason": reason, "vehicle": v,
	})
}

// purchaseBody is one purchase request.
type purchaseBody struct {
	PurchaseID string `json:"purchase_id"`
	Item       string `json:"item"`
}

func (a *App) handleRoomPurchase(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	player, seated := a.requireSeat(w, r, room)
	if !seated {
		return
	}
	var body purchaseBody
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if !reportIDPattern.MatchString(body.PurchaseID) {
		httpx.WriteError(w, apperr.SingleValidation("purchase_id", "Use 1 to 64 letters, digits, underscores or hyphens."))
		return
	}
	if body.Item != "ammo_pack" && body.Item != "grenade" && body.Item != "med_kit" {
		httpx.WriteError(w, apperr.SingleValidation("item", "Pick ammo_pack, grenade or med_kit."))
		return
	}
	if room.DegradedPublic() != "" {
		httpx.WriteError(w, apperr.RoomPaused)
		return
	}

	// Idempotent replay.
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	stored, found, err := a.Hub.GetPurchase(ctx, room.Code, body.PurchaseID)
	if err != nil {
		httpx.WriteError(w, apperr.RoomsUnavailable)
		return
	}
	if found {
		if stored.Item != body.Item {
			httpx.WriteError(w, apperr.PurchaseConflict)
			return
		}
		a.writePurchaseReplay(w, room, stored)
		return
	}

	// The unit price is the price in effect at the server's wall-clock instant.
	now := a.Clock.Now().UTC()
	unitPrice, effAt, ok := a.priceForItem(body.Item, now)
	if !ok {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}

	room.RoomLock()
	name := itemName(body.Item)
	outcome, reason := room.Buy(player.ID, body.PurchaseID, body.Item, unitPrice, effAt, a.Clock.Mono())
	if reason != "" {
		room.RoomUnlock()
		switch reason {
		case "shop_closed":
			httpx.WriteError(w, apperr.ShopClosed)
		case "insufficient_credits":
			httpx.WriteError(w, apperr.InsufficientCredits(name, unitPrice))
		case "at_capacity":
			httpx.WriteError(w, apperr.AtCapacity)
		default:
			httpx.WriteError(w, apperr.NotFound)
		}
		return
	}
	// Write the paired ledger entries.
	if err := a.Store.AppendLedger(ctx, room.MatchID, player.ID, -int64(unitPrice), "purchase",
		body.PurchaseID, body.Item, unitPrice); err != nil {
		room.RoomUnlock()
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	playerView := room.PlayerView(player.ID)
	room.RoomUnlock()

	rec := sim.PurchaseRecord{
		PurchaseID: body.PurchaseID, Item: body.Item, UnitPrice: unitPrice,
		PriceEffectiveAt: effAt, Balance: outcome.Balance, PlayerID: player.ID,
	}
	a.Hub.PutPurchase(ctx, room.Code, rec)
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"purchase_id": body.PurchaseID,
		"item":        body.Item,
		"unit_price":  unitPrice,
		"price_effective_at": clockInstant(effAt),
		"balance":     outcome.Balance,
		"player":      playerView,
	})
}

func (a *App) writePurchaseReplay(w http.ResponseWriter, room *sim.Room, rec sim.PurchaseRecord) {
	room.RoomLock()
	pv := room.PlayerView(rec.PlayerID)
	room.RoomUnlock()
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{
		"purchase_id": rec.PurchaseID,
		"item":        rec.Item,
		"unit_price":  rec.UnitPrice,
		"price_effective_at": clockInstant(rec.PriceEffectiveAt),
		"balance":     rec.Balance,
		"player":      pv,
	})
}

// itemName is the published display name.
func itemName(item string) string {
	switch item {
	case "ammo_pack":
		return "Ammo pack"
	case "grenade":
		return "Grenade"
	case "med_kit":
		return "Med kit"
	}
	return item
}

func (a *App) handleRoomLedger(w http.ResponseWriter, r *http.Request, room *sim.Room) {
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	if err := a.requireStorage(); err != nil {
		httpx.WriteError(w, err)
		return
	}
	balances, err := a.Store.Balances(ctx, room.MatchID)
	if err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	entries, err := a.Store.LedgerEntries(ctx, room.MatchID)
	if err != nil {
		httpx.WriteError(w, apperr.StorageUnavailable)
		return
	}
	out := map[string]any{"balances": map[string]int64{}, "entries": []any{}, "total": 0}
	if balances != nil {
		out["balances"] = balances
	}
	entryList := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		entryList = append(entryList, map[string]any{
			"id": e.ID, "account": e.Account, "amount": e.Amount, "kind": e.Kind,
			"ref": e.Ref, "item": e.Item, "unit_price": e.UnitPrice, "at": clockInstant(e.At),
		})
	}
	out["entries"] = entryList
	httpx.WriteJSON(w, http.StatusOK, out)
}

// priceForItem returns the price in effect at t.
func (a *App) priceForItem(item string, t time.Time) (int, time.Time, bool) {
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	rows, err := a.Store.PriceChanges(ctx)
	if err != nil {
		return 0, time.Time{}, false
	}
	best := -1
	var bestAt time.Time
	for i, pc := range rows {
		if pc.Item != item || pc.EffectiveAt.After(t) {
			continue
		}
		if best == -1 || pc.EffectiveAt.After(rows[best].EffectiveAt) {
			best = i
			bestAt = pc.EffectiveAt
		}
	}
	if best == -1 {
		return 0, time.Time{}, false
	}
	return rows[best].Price, bestAt, true
}


// strconvFormat renders a float the same way the sim does.
func strconvFormat(f float64) string {
return strconv.FormatFloat(f, 'g', -1, 64)
}

// clockInstant formats an instant.
func clockInstant(t time.Time) string {
return t.UTC().Format("2006-01-02T15:04:05Z")
}
