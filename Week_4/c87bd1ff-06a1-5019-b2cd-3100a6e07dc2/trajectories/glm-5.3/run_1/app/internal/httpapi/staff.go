package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"gavelhouse/internal/store"
)

// ---- consignor ----

// consign takes a watch or camera into intake.
func (s *Server) consign(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var body struct {
		Category    string `json:"category"`
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"title": "Enter a title of up to 120 characters."})
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return store.Invalid(map[string]string{"title": "Enter a title of up to 120 characters."})
	}
	lot, landing, err := s.db.Consign(r.Context(), *person, body.Category, body.Title, body.Description)
	if err != nil {
		return err
	}
	view, err := s.consignorLotView(r.Context(), person, lot)
	if err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"lot": view, "landing": landing})
	return nil
}

func (s *Server) consignorLotView(ctx context.Context, person *store.Person, lot store.LotFull) (map[string]any, error) {
	var view map[string]any
	err := s.db.WithTx(ctx, func(ctx context.Context, tx store.Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return err
		}
		var offer *store.Offer
		if o, err := tx.OpenOfferForLot(ctx, lot.ID); err != nil {
			return err
		} else {
			offer = o
		}
		view = s.db.ConsignedLotView(lot, offer, now)
		return nil
	})
	return view, err
}

// consignLots lists the consignor's own lots.
func (s *Server) consignLots(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var views []map[string]any
	var seq int64
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		if err := s.db.CloseDueLots(ctx, tx); err != nil {
			return err
		}
		now, err := tx.Now(ctx)
		if err != nil {
			return err
		}
		lots, err := tx.ConsignorLots(ctx, person.ID)
		if err != nil {
			return err
		}
		views = make([]map[string]any, 0, len(lots))
		for i := range lots {
			bids, err := tx.LotBids(ctx, lots[i].ID)
			if err != nil {
				return err
			}
			lf := store.LotFull{Lot: lots[i], Bids: bids}
			lf.Refresh()
			var offer *store.Offer
			if o, err := tx.OpenOfferForLot(ctx, lots[i].ID); err != nil {
				return err
			} else {
				offer = o
			}
			views = append(views, s.db.ConsignedLotView(lf, offer, now))
		}
		seq, err = tx.LatestSeq(ctx)
		return err
	})
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"lots": views, "seq": seq})
	return nil
}

// consignLot answers the consignor's view of one of their own lots.
func (s *Server) consignLot(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var view map[string]any
	var history []map[string]any
	var seq int64
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		if err := s.db.CloseDueLots(ctx, tx); err != nil {
			return err
		}
		lot, err := tx.GetLot(ctx, r.PathValue("id"))
		if err != nil {
			return err
		}
		if lot == nil || lot.ConsignorID != person.ID {
			return store.NotFound()
		}
		bids, err := tx.LotBids(ctx, lot.ID)
		if err != nil {
			return err
		}
		lf := store.LotFull{Lot: *lot, Bids: bids}
		lf.Refresh()
		var offer *store.Offer
		if o, err := tx.OpenOfferForLot(ctx, lot.ID); err != nil {
			return err
		} else {
			offer = o
		}
		now, err := tx.Now(ctx)
		if err != nil {
			return err
		}
		view = s.db.ConsignedLotView(lf, offer, now)
		history = s.db.ConsignorHistory(lf)
		seq, err = tx.LatestSeq(ctx)
		return err
	})
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"lot": view, "history": history, "seq": seq})
	return nil
}

// secondChance makes the consignor's offer to the top bidder.
func (s *Server) secondChance(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var body struct {
		Amount json.RawMessage `json:"amount"`
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"amount": "Enter a whole number of euros."})
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return store.Invalid(map[string]string{"amount": "Enter a whole number of euros."})
	}
	var amount int
	if err := json.Unmarshal(body.Amount, &amount); err != nil || body.Amount == nil {
		return store.Invalid(map[string]string{"amount": "Enter a whole number of euros."})
	}
	offer, err := s.db.SecondChance(r.Context(), *person, r.PathValue("id"), amount)
	if err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"offer": offerView(offer)})
	return nil
}

// leaveUnsold records the consignor's decision to leave the lot unsold.
func (s *Server) leaveUnsold(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	lot, err := s.db.LeaveUnsold(r.Context(), *person, r.PathValue("id"))
	if err != nil {
		return err
	}
	now, err := s.db.Now(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"lot": s.db.ConsignedLotView(lot, nil, now)})
	return nil
}

// consignStatements lists the consignor's issued and superseded statements.
func (s *Server) consignStatements(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var list []store.Statement
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		list, err = tx.ConsignorStatements(ctx, person.ID)
		return err
	})
	if err != nil {
		return err
	}
	views := make([]map[string]any, 0, len(list))
	for _, st := range list {
		views = append(views, statementHeaderView(st))
	}
	writeJSON(w, 200, map[string]any{"statements": views})
	return nil
}

// consignStatement answers one of the consignor's own statements.
func (s *Server) consignStatement(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var st *store.Statement
	var lines []store.StatementLine
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		st, err = tx.GetStatement(ctx, r.PathValue("id"))
		if err != nil {
			return err
		}
		if st == nil || st.ConsignorID != person.ID || st.Status == "draft" {
			st = nil
			return nil
		}
		if st.Status == "issued" || st.Status == "superseded" {
			lines = st.Lines
			if lines == nil {
				lines, err = s.db.StatementLinesFor(ctx, tx, *st)
				if err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if st == nil {
		return store.NotFound()
	}
	writeJSON(w, 200, map[string]any{"statement": statementView(st, lines)})
	return nil
}

func statementHeaderView(st store.Statement) map[string]any {
	return map[string]any{
		"id":            st.ID,
		"number":        st.Number,
		"sale_id":       st.SaleID,
		"sale_title":    st.SaleTitle,
		"version":       st.Version,
		"status":        st.Status,
		"issued_at":     strOrNilTime(st.IssuedAt),
		"supersedes":    strOrNil(st.Supersedes),
		"superseded_by": strOrNil(st.SupersededBy),
	}
}

func strOrNilTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return rfc(*t)
}

func statementView(st *store.Statement, lines []store.StatementLine) map[string]any {
	v := statementHeaderView(*st)
	hammer, commission, net := 0, 0, 0
	for _, l := range lines {
		if l.Result == "sold" {
			hammer += *l.Hammer
			commission += *l.Commission
			net += *l.Net
		}
	}
	v["lines"] = statementLineViews(lines)
	v["hammer_total"] = centsString(hammer)
	v["commission_total"] = centsString(commission)
	v["net_total"] = centsString(net)
	return v
}

func statementLineViews(lines []store.StatementLine) []map[string]any {
	out := make([]map[string]any, 0, len(lines))
	for _, l := range lines {
		out = append(out, map[string]any{
			"lot_id":     l.LotID,
			"lot_number": l.LotNumber,
			"title":      l.Title,
			"result":     l.Result,
			"hammer":     centsOrNil(l.Hammer),
			"commission": centsOrNil(l.Commission),
			"net":        centsOrNil(l.Net),
		})
	}
	return out
}

// centsOrNil writes an optional cents amount as a euro string.
func centsOrNil(p *int) any {
	if p == nil {
		return nil
	}
	return centsString(*p)
}

// ---- specialist ----

// deskLots lists the lots waiting for the specialist.
func (s *Server) deskLots(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "intake"
	}
	var lots []store.Lot
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		lots, err = tx.DeskLotsByState(ctx, []string{state})
		return err
	})
	if err != nil {
		return err
	}
	now, err := s.db.Now(r.Context())
	if err != nil {
		return err
	}
	views := make([]map[string]any, 0, len(lots))
	for i := range lots {
		views = append(views, s.db.StaffLotView(store.LotFull{Lot: lots[i]}, nil, now))
	}
	writeJSON(w, 200, map[string]any{"lots": views})
	return nil
}

// estimate saves the specialist's estimate on an intake lot.
func (s *Server) estimate(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var body struct {
		EstimateLow  json.RawMessage `json:"estimate_low"`
		EstimateHigh json.RawMessage `json:"estimate_high"`
		OpeningBid   json.RawMessage `json:"opening_bid"`
		Reserve      json.RawMessage `json:"reserve"`
		Condition    string          `json:"condition"`
		Portrait     string          `json:"portrait"`
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"estimate_low": "Enter a whole number of euros from €1 to €1,000,000."})
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return store.Invalid(map[string]string{"estimate_low": "Enter a whole number of euros from €1 to €1,000,000."})
	}
	low, lowOK := intField(body.EstimateLow)
	high, highOK := intField(body.EstimateHigh)
	opening, openOK := intField(body.OpeningBid)
	reserve, reserveOK := intField(body.Reserve)
	lot, err := s.db.SaveEstimate(r.Context(), r.PathValue("id"),
		maybeInt(low, lowOK), maybeInt(high, highOK), maybeInt(opening, openOK), maybeInt(reserve, reserveOK),
		body.Condition, body.Portrait)
	if err != nil {
		return err
	}
	now, err := s.db.Now(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"lot": s.db.StaffLotView(store.LotFull{Lot: lot.Lot}, nil, now)})
	return nil
}

func maybeInt(v int, ok bool) *int {
	if !ok {
		return nil
	}
	return &v
}

func intField(raw json.RawMessage) (int, bool) {
	if len(raw) == 0 {
		return 0, false
	}
	var n int
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0, false
	}
	return n, true
}

// createSale makes a draft sale.
func (s *Server) createSale(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var body struct {
		Title          string          `json:"title"`
		EndsAt         string          `json:"ends_at"`
		FirstLotNumber json.RawMessage `json:"first_lot_number"`
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"title": "Enter a sale title of up to 80 characters."})
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return store.Invalid(map[string]string{"ends_at": "Enter the end as a real date and time."})
	}
	var first int
	if err := json.Unmarshal(body.FirstLotNumber, &first); err != nil || body.FirstLotNumber == nil {
		return store.Invalid(map[string]string{"first_lot_number": "Enter a first lot number from 1 to 9999."})
	}
	endsAt, err := time.Parse(time.RFC3339, body.EndsAt)
	if err != nil {
		return store.Invalid(map[string]string{"ends_at": "Enter the end as a real date and time."})
	}
	sale, err := s.db.CreateSale(r.Context(), body.Title, endsAt, first)
	if err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"sale": saleView(sale)})
	return nil
}

// deskSales lists every sale.
func (s *Server) deskSales(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var sales []store.Sale
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		sales, err = tx.AllSales(ctx)
		return err
	})
	if err != nil {
		return err
	}
	views := make([]map[string]any, 0, len(sales))
	for _, sale := range sales {
		views = append(views, saleView(sale))
	}
	writeJSON(w, 200, map[string]any{"sales": views})
	return nil
}

// saleOrder places estimated lots in catalogue order.
func (s *Server) saleOrder(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var body struct {
		LotIDs []string `json:"lot_ids"`
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"lot_ids": "Add at least one lot before publishing."})
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return store.Invalid(map[string]string{"lot_ids": "Add at least one lot before publishing."})
	}
	lots, err := s.db.SetSaleOrder(r.Context(), r.PathValue("id"), body.LotIDs)
	if err != nil {
		return err
	}
	now, err := s.db.Now(r.Context())
	if err != nil {
		return err
	}
	views := make([]map[string]any, 0, len(lots))
	for i := range lots {
		views = append(views, s.db.StaffLotView(store.LotFull{Lot: lots[i]}, nil, now))
	}
	var saleViewMap map[string]any
	err = s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		sale, err := tx.GetSale(ctx, r.PathValue("id"))
		if err != nil || sale == nil {
			return err
		}
		saleViewMap = saleView(*sale)
		return nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"sale": saleViewMap, "lots": views})
	return nil
}

// publishSale numbers the lots and opens the sale.
func (s *Server) publishSale(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	sale, lots, err := s.db.PublishSale(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	now, err := s.db.Now(r.Context())
	if err != nil {
		return err
	}
	views := make([]map[string]any, 0, len(lots))
	for i := range lots {
		views = append(views, s.db.StaffLotView(store.LotFull{Lot: lots[i]}, nil, now))
	}
	writeJSON(w, 200, map[string]any{"sale": saleView(sale), "lots": views})
	return nil
}

// ---- cashier ----

// deskInvoices lists the invoices for the cashier's filter.
func (s *Server) deskInvoices(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	status := r.URL.Query().Get("status")
	statuses := []string{"issued"}
	switch status {
	case "paid":
		statuses = []string{"paid"}
	case "all":
		statuses = []string{"issued", "paid", "defaulted"}
	case "":
		statuses = []string{"issued"}
	}
	var list []store.Invoice
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		list, err = tx.InvoicesByStatus(ctx, statuses)
		return err
	})
	if err != nil {
		return err
	}
	views := make([]map[string]any, 0, len(list))
	for _, inv := range list {
		views = append(views, cashierInvoiceView(inv))
	}
	writeJSON(w, 200, map[string]any{"invoices": views})
	return nil
}

// deskInvoice answers one invoice in the cashier's projection.
func (s *Server) deskInvoice(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var inv *store.Invoice
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		inv, err = tx.GetInvoice(ctx, r.PathValue("id"))
		return err
	})
	if err != nil {
		return err
	}
	if inv == nil {
		return store.NotFound()
	}
	writeJSON(w, 200, map[string]any{"invoice": cashierInvoiceView(*inv)})
	return nil
}

// payment records the cashier's payment against an invoice.
func (s *Server) payment(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var body struct {
		Amount string `json:"amount"`
		Method string `json:"method"`
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"amount": "Enter an amount in euros and cents, for example 125.50."})
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return store.Invalid(map[string]string{"amount": "Enter an amount in euros and cents, for example 125.50."})
	}
	if body.Method != "bank_transfer" && body.Method != "card" && body.Method != "cash" {
		return store.Invalid(map[string]string{"method": "Choose the payment method."})
	}
	cents, ok := euroCentsFromString(body.Amount)
	if !ok {
		return store.Invalid(map[string]string{"amount": "Enter an amount in euros and cents, for example 125.50."})
	}
	inv, err := s.db.RecordPayment(r.Context(), r.PathValue("id"), cents, body.Method)
	if err != nil {
		return err
	}
	payment := store.Payment{Amount: cents, Method: body.Method, RecordedAt: time.Now().UTC()}
	writeJSON(w, 201, map[string]any{"payment": map[string]any{"amount": centsString(cents), "method": body.Method, "recorded_at": rfc(payment.RecordedAt)}, "invoice": cashierInvoiceView(inv)})
	return nil
}

// ---- admin ----

// adminRegistrations lists the pending bidders.
func (s *Server) adminRegistrations(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	if r.URL.Query().Get("status") != "pending" && r.URL.Query().Get("status") != "" {
		writeJSON(w, 200, map[string]any{"registrations": []any{}})
		return nil
	}
	var list []store.Registration
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		list, err = tx.PendingRegistrations(ctx)
		return err
	})
	if err != nil {
		return err
	}
	views := make([]map[string]any, 0, len(list))
	for _, reg := range list {
		views = append(views, map[string]any{
			"id":         reg.ID,
			"full_name":  reg.FullName,
			"phone":      reg.Phone,
			"address":    reg.Address,
			"status":     reg.Status,
			"created_at": rfc(reg.CreatedAt),
		})
	}
	writeJSON(w, 200, map[string]any{"registrations": views})
	return nil
}

// approve gives a pending bidder a paddle and spending limit.
func (s *Server) approve(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var body struct {
		SpendingLimit json.RawMessage `json:"spending_limit"`
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"spending_limit": "Enter a spending limit between €100 and €1,000,000."})
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return store.Invalid(map[string]string{"spending_limit": "Enter a spending limit between €100 and €1,000,000."})
	}
	var limit int
	if err := json.Unmarshal(body.SpendingLimit, &limit); err != nil || body.SpendingLimit == nil {
		return store.Invalid(map[string]string{"spending_limit": "Enter a spending limit between €100 and €1,000,000."})
	}
	reg, err := s.db.ApproveRegistration(r.Context(), r.PathValue("id"), limit)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"registration": regView(reg)})
	return nil
}

// adminBids answers the admin's view of a lot's bids.
func (s *Server) adminBids(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var view map[string]any
	var bids []map[string]any
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		if err := s.db.CloseDueLots(ctx, tx); err != nil {
			return err
		}
		lot, err := tx.GetLot(ctx, r.PathValue("id"))
		if err != nil {
			return err
		}
		if lot == nil {
			return store.NotFound()
		}
		lotBids, err := tx.LotBids(ctx, lot.ID)
		if err != nil {
			return err
		}
		now, err := tx.Now(ctx)
		if err != nil {
			return err
		}
		lf := store.LotFull{Lot: *lot, Bids: lotBids}
		lf.Refresh()
		view = s.db.StaffLotView(lf, nil, now)
		bids = s.db.AdminHistory(lf)
		return nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"lot": view, "bids": bids})
	return nil
}

// removeBid removes one bid and recomputes at once.
func (s *Server) removeBid(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var body struct {
		Reason string `json:"reason"`
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"reason": "Enter a reason of up to 300 characters."})
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return store.Invalid(map[string]string{"reason": "Enter a reason of up to 300 characters."})
	}
	lot, err := s.db.RemoveBid(r.Context(), r.PathValue("id"), body.Reason)
	if err != nil {
		return err
	}
	now, err := s.db.Now(r.Context())
	if err != nil {
		return err
	}
	var bids []map[string]any
	var lotView map[string]any
	err = s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		fresh, err := s.loadFull(ctx, tx, lot.ID)
		if err != nil || fresh == nil {
			return err
		}
		lotView = s.db.StaffLotView(*fresh, nil, now)
		bids = s.db.AdminHistory(*fresh)
		return nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"lot": lotView, "bids": bids})
	return nil
}

func (s *Server) loadFull(ctx context.Context, tx store.Tx, lotID string) (*store.LotFull, error) {
	lot, err := tx.GetLot(ctx, lotID)
	if err != nil || lot == nil {
		return nil, err
	}
	bids, err := tx.LotBids(ctx, lotID)
	if err != nil {
		return nil, err
	}
	lf := store.LotFull{Lot: *lot, Bids: bids}
	lf.Refresh()
	return &lf, nil
}

// adminStatements lists the statements for one sale, or every draft and issued one.
func (s *Server) adminStatements(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	saleID := r.URL.Query().Get("sale_id")
	var list []store.Statement
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		if saleID != "" {
			list, err = tx.SaleStatements(ctx, saleID)
		} else {
			list, err = tx.AllStatements(ctx)
		}
		return err
	})
	if err != nil {
		return err
	}
	views := make([]map[string]any, 0, len(list))
	for _, st := range list {
		views = append(views, statementHeaderView(st))
	}
	writeJSON(w, 200, map[string]any{"statements": views})
	return nil
}

// issueStatement locks a draft statement.
func (s *Server) issueStatement(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	st, lines, err := s.db.IssueStatement(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"statement": statementView(&st, lines)})
	return nil
}

// correctStatement issues a new statement that supersedes the old one.
func (s *Server) correctStatement(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var body struct {
		Note string `json:"note"`
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"note": "Enter a note of up to 300 characters."})
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return store.Invalid(map[string]string{"note": "Enter a note of up to 300 characters."})
	}
	st, lines, old, err := s.db.CorrectStatement(r.Context(), r.PathValue("id"), body.Note)
	if err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"statement": statementView(&st, lines), "superseded": statementHeaderView(old)})
	return nil
}
