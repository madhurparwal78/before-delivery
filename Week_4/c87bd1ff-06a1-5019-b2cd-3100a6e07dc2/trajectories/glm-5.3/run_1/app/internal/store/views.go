package store

import (
	"context"
	"fmt"
	"sort"
	"time"
)

// Money and time formatting for sentences and views.
func (s *Store) FmtEuros(n int) string     { return fmtEuros(n) }
func (s *Store) FmtEuroCents(c int) string { return fmtEuroCents(c) }

var Amsterdam = func() *time.Location {
	l, err := time.LoadLocation("Europe/Amsterdam")
	if err != nil {
		l = time.FixedZone("CET", 3600)
	}
	return l
}()

func Rotterdam(t time.Time) string { return t.In(Amsterdam).Format("2 Jan 2006, 15:04:05") }

func TimeLeft(d time.Duration) string {
	if d < 0 {
		d = 0
	}
	s := int(d.Seconds())
	switch {
	case s >= 86400:
		return fmt.Sprintf("%dd %02d:%02d:%02d", s/86400, (s%86400)/3600, (s%3600)/60, s%60)
	case s >= 3600:
		return fmt.Sprintf("%02d:%02d:%02d", s/3600, (s%3600)/60, s%60)
	default:
		return fmt.Sprintf("%d:%02d", s/60, s%60)
	}
}

func rfc(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.999Z07:00") }

func rfcOpt(t *time.Time) any {
	if t == nil {
		return nil
	}
	return rfc(*t)
}

func intOpt(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func strOpt(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func hasRole(roles []string, role string) bool {
	for _, r := range roles {
		if r == role {
			return true
		}
	}
	return false
}

func isStaff(roles []string) bool {
	return hasRole(roles, "specialist") || hasRole(roles, "cashier") || hasRole(roles, "admin")
}

// lotAccess decides whether a viewer may know a lot exists. Unestimated and
// draft-sale lots are unknown to everyone except the staff and the owner.
func lotAccess(viewer Person, lot *Lot) bool {
	if lot.ConsignorID == viewer.ID || isStaff(viewer.Roles) {
		return true
	}
	switch lot.State {
	case "intake", "estimated", "placed":
		return false
	default:
		return true
	}
}

func remainingSeconds(lot *Lot, now time.Time) int {
	if lot.ClosesAt == nil || !lot.IsOpenish() {
		return 0
	}
	r := int(lot.ClosesAt.Sub(now).Seconds())
	if r < 0 {
		r = 0
	}
	return r
}

func statusOf(lot *Lot) string {
	if lot.IsOpenish() {
		return lot.State
	}
	return lot.Status()
}

// publicLotView is the public projection of a lot.
func (s *Store) publicLotView(lot *LotFull, now time.Time) map[string]any {
	v := map[string]any{
		"id":                lot.ID,
		"sale_id":           strOpt(lot.SaleID),
		"lot_number":        intOpt(lot.LotNumber),
		"title":             lot.Title,
		"category":          lot.Category,
		"description":       lot.Description,
		"condition":         lot.Condition,
		"portrait":          lot.Portrait,
		"estimate_low":      intOpt(lot.EstimateLow),
		"estimate_high":     intOpt(lot.EstimateHigh),
		"opening_bid":       intOpt(lot.OpeningBid),
		"price":             intOpt(lot.Price),
		"asking":            intOpt(lot.OpeningBid),
		"bid_count":         len(lot.Bids),
		"leader_paddle":     intOpt(lot.LeaderPaddle),
		"reserve_met":       lot.ReserveMet,
		"status":            statusOf(&lot.Lot),
		"closes_at":         rfcOpt(lot.ClosesAt),
		"remaining_seconds": remainingSeconds(&lot.Lot, now),
		"server_now":        rfc(now),
	}
	if lot.Price != nil {
		v["asking"] = lot.Asking()
	}
	return v
}

// bidderLotView adds the viewer's own fields and never another bidder's maximum.
func (s *Store) bidderLotView(ctx context.Context, tx Tx, viewer Person, lot *LotFull, now time.Time) map[string]any {
	v := s.publicLotView(lot, now)
	if myMax, err := tx.MyMax(ctx, viewer.ID, lot.ID); err == nil {
		v["my_max"] = intOpt(myMax)
	}
	watching, _ := tx.IsWatching(ctx, viewer.ID, lot.ID)
	v["i_lead"] = lot.LeaderPersonID != nil && *lot.LeaderPersonID == viewer.ID
	v["watching"] = watching
	return v
}

// viewerLotView picks the projection for the viewer's role.
func (s *Store) viewerLotView(ctx context.Context, tx Tx, viewer Person, lot *LotFull, offer *Offer, now time.Time) (map[string]any, error) {
	switch {
	case isStaff(viewer.Roles):
		return s.staffLotView(lot, offer, now), nil
	case hasRole(viewer.Roles, "consignor") && lot.ConsignorID == viewer.ID:
		return s.consignorLotView(lot, offer, now), nil
	case hasRole(viewer.Roles, "bidder"):
		return s.bidderLotView(ctx, tx, viewer, lot, now), nil
	default:
		return s.publicLotView(lot, now), nil
	}
}

// consignorLotView never carries a paddle or any bidder detail.
func (s *Store) consignorLotView(lot *LotFull, offer *Offer, now time.Time) map[string]any {
	v := map[string]any{
		"id":                 lot.ID,
		"sale_id":            strOpt(lot.SaleID),
		"lot_number":         intOpt(lot.LotNumber),
		"title":              lot.Title,
		"category":           lot.Category,
		"description":        lot.Description,
		"condition":          lot.Condition,
		"portrait":           lot.Portrait,
		"estimate_low":       intOpt(lot.EstimateLow),
		"estimate_high":      intOpt(lot.EstimateHigh),
		"opening_bid":        intOpt(lot.OpeningBid),
		"reserve":            intOpt(lot.Reserve),
		"price":              intOpt(lot.Price),
		"bid_count":          len(lot.Bids),
		"reserve_met":        lot.ReserveMet,
		"state":              lot.State,
		"closes_at":          rfcOpt(lot.ClosesAt),
		"remaining_seconds":  remainingSeconds(&lot.Lot, now),
		"server_now":         rfc(now),
		"hammer":             intOpt(lot.Hammer),
		"second_chance_open": s.secondChanceOpen(lot),
		"offer":              nil,
	}
	if offer != nil {
		v["offer"] = s.offerView(offer, lot)
	}
	return v
}

func (s *Store) secondChanceOpen(lot *LotFull) bool {
	return lot.State == "closed_unsold" && !lot.SecondChanceDone && len(lot.Bids) > 0
}

func (s *Store) offerView(o *Offer, lot *LotFull) map[string]any {
	v := map[string]any{
		"id":         o.ID,
		"lot_id":     o.LotID,
		"kind":       o.Kind,
		"amount":     o.Amount,
		"expires_at": rfc(o.ExpiresAt),
		"status":     o.Status,
	}
	if lot != nil && lot.LotNumber != nil {
		v["lot_number"] = *lot.LotNumber
		v["title"] = lot.Title
	}
	return v
}

// staffLotView adds the consignor's name and the leader's paddle.
func (s *Store) staffLotView(lot *LotFull, offer *Offer, now time.Time) map[string]any {
	v := s.consignorLotView(lot, offer, now)
	v["consignor_name"] = lot.ConsignorName
	v["leader_paddle"] = intOpt(lot.LeaderPaddle)
	return v
}

// historyView writes bid rows for each audience, newest first.
func historyView(rows []Bid, audience string) []map[string]any {
	out := make([]map[string]any, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		b := rows[i]
		switch audience {
		case "consignor":
			out = append(out, map[string]any{"price_after": b.PriceAfter, "accepted_at": rfc(b.AcceptedAt)})
		case "admin":
			out = append(out, map[string]any{
				"bid_id":      b.ID,
				"paddle":      b.Paddle,
				"bidder_name": b.BidderName,
				"max_amount":  b.MaxAmount,
				"price_after": b.PriceAfter,
				"accepted_at": rfc(b.AcceptedAt),
			})
		default:
			out = append(out, map[string]any{"paddle": b.Paddle, "price_after": b.PriceAfter, "accepted_at": rfc(b.AcceptedAt)})
		}
	}
	return out
}

func saleView(sale Sale) map[string]any {
	return map[string]any{
		"id":               sale.ID,
		"title":            sale.Title,
		"ends_at":          rfc(sale.EndsAt),
		"state":            sale.State,
		"first_lot_number": sale.FirstLotNumber,
	}
}

func invoiceView(inv Invoice) map[string]any {
	hammer, premium, vat := inv.Totals()
	return map[string]any{
		"id":            inv.ID,
		"number":        inv.Number,
		"sale_id":       strOpt(inv.SaleID),
		"sale_title":    inv.SaleTitle,
		"paddle":        inv.Paddle,
		"status":        inv.Status,
		"issued_at":     rfc(inv.IssuedAt),
		"due_at":        rfc(inv.DueAt),
		"lines":         lineViews(inv.Lines),
		"hammer_total":  eurosCents(hammer),
		"premium_total": eurosCents(premium),
		"vat_total":     eurosCents(vat),
		"total":         eurosCents(hammer + premium + vat),
		"paid":          eurosCents(inv.Paid),
		"outstanding":   eurosCents(inv.Outstanding()),
		"payments":      paymentViews(inv.Payments),
	}
}

// eurosCents writes a cents amount as a euro string with two decimals.
func eurosCents(c int) string {
	negative := c < 0
	if negative {
		c = -c
	}
	s := fmt.Sprintf("%d.%02d", c/100, c%100)
	if negative {
		return "-" + s
	}
	return s
}

func cashierInvoiceView(inv Invoice) map[string]any {
	v := invoiceView(inv)
	v["bidder_name"] = inv.BidderName
	return v
}

func lineViews(lines []InvoiceLine) []map[string]any {
	out := make([]map[string]any, 0, len(lines))
	for _, l := range lines {
		out = append(out, map[string]any{
			"lot_id":     l.LotID,
			"lot_number": l.LotNumber,
			"title":      l.Title,
			"source":     l.Source,
			"hammer":     l.Hammer,
			"premium":    l.Premium,
			"vat":        l.VAT,
		})
	}
	return out
}

func paymentViews(payments []Payment) []map[string]any {
	out := make([]map[string]any, 0, len(payments))
	for _, p := range payments {
		out = append(out, map[string]any{"amount": eurosCents(p.Amount), "method": p.Method, "recorded_at": rfc(p.RecordedAt)})
	}
	return out
}

func statementView(st Statement, lines []StatementLine) map[string]any {
	hammer, commission, net := 0, 0, 0
	for _, l := range lines {
		if l.Result == "sold" {
			hammer += *l.Hammer
			commission += *l.Commission
			net += *l.Net
		}
	}
	return map[string]any{
		"id":               st.ID,
		"number":           st.Number,
		"sale_id":          st.SaleID,
		"sale_title":       st.SaleTitle,
		"version":          st.Version,
		"status":           st.Status,
		"issued_at":        rfcOpt(st.IssuedAt),
		"supersedes":       strOpt(st.Supersedes),
		"superseded_by":    strOpt(st.SupersededBy),
		"lines":            statementLineViews(lines),
		"hammer_total":     hammer,
		"commission_total": commission,
		"net_total":        net,
	}
}

func statementLineViews(lines []StatementLine) []map[string]any {
	out := make([]map[string]any, 0, len(lines))
	for _, l := range lines {
		out = append(out, map[string]any{
			"lot_id":     l.LotID,
			"lot_number": l.LotNumber,
			"title":      l.Title,
			"result":     l.Result,
			"hammer":     intOpt(l.Hammer),
			"commission": intOpt(l.Commission),
			"net":        intOpt(l.Net),
		})
	}
	return out
}

func noticeView(n Notice) map[string]any {
	return map[string]any{
		"id":         n.ID,
		"kind":       n.Kind,
		"text":       n.Text,
		"lot_id":     strOpt(n.LotID),
		"created_at": rfc(n.CreatedAt),
	}
}

func registrationView(r Registration) map[string]any {
	return map[string]any{
		"id":             r.ID,
		"role":           r.Role,
		"status":         r.Status,
		"paddle":         intOpt(r.Paddle),
		"spending_limit": intOpt(r.SpendingLimit),
	}
}

// sortLotsByClosingOrder puts open lots soonest first, then closed by lot number.
func sortLotsByClosingOrder(lots []LotFull) {
	sort.SliceStable(lots, func(i, j int) bool {
		a, b := lots[i].IsOpenish(), lots[j].IsOpenish()
		if a != b {
			return a
		}
		if a {
			return lots[i].ClosesAt.Before(*lots[j].ClosesAt)
		}
		if lots[i].LotNumber == nil || lots[j].LotNumber == nil {
			return false
		}
		return *lots[i].LotNumber < *lots[j].LotNumber
	})
}

// centsOpt writes an optional cents amount as a euro string.
func centsOpt(p *int) any {
	if p == nil {
		return nil
	}
	return eurosCents(*p)
}
