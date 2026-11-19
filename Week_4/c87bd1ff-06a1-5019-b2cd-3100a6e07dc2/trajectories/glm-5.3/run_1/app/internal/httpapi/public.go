package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"gavelhouse/internal/store"
)

func rfc(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.999Z07:00") }

func intOrNil(p *int) any {
	if p == nil {
		return nil
	}
	return *p
}

func strOrNil(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

// me answers the signed-in person's own record.
func (s *Server) me(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var reg *store.Registration
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		reg, err = tx.GetRegistrationByPerson(ctx, person.ID)
		return err
	})
	if err != nil {
		return err
	}
	me := map[string]any{"name": person.Name, "roles": person.Roles, "registration": nil}
	if reg != nil {
		me["registration"] = regView(*reg)
	}
	writeJSON(w, 200, me)
	return nil
}

func regView(r store.Registration) map[string]any {
	return map[string]any{
		"id":             r.ID,
		"role":           r.Role,
		"status":         r.Status,
		"paddle":         intOrNil(r.Paddle),
		"spending_limit": intOrNil(r.SpendingLimit),
	}
}

func saleView(sale store.Sale) map[string]any {
	return map[string]any{
		"id":               sale.ID,
		"title":            sale.Title,
		"ends_at":          rfc(sale.EndsAt),
		"state":            sale.State,
		"first_lot_number": sale.FirstLotNumber,
	}
}

func invoiceView(inv store.Invoice) map[string]any {
	hammer, premium, vat := inv.Totals()
	return map[string]any{
		"id":            inv.ID,
		"number":        inv.Number,
		"sale_id":       strOrNil(inv.SaleID),
		"sale_title":    inv.SaleTitle,
		"paddle":        inv.Paddle,
		"status":        inv.Status,
		"issued_at":     rfc(inv.IssuedAt),
		"due_at":        rfc(inv.DueAt),
		"lines":         lineViews(inv.Lines),
		"hammer_total":  centsString(hammer),
		"premium_total": centsString(premium),
		"vat_total":     centsString(vat),
		"total":         centsString(hammer + premium + vat),
		"paid":          centsString(inv.Paid),
		"outstanding":   centsString(inv.Outstanding()),
		"payments":      paymentViews(inv.Payments),
	}
}

func cashierInvoiceView(inv store.Invoice) map[string]any {
	v := invoiceView(inv)
	v["bidder_name"] = inv.BidderName
	return v
}

// centsString writes cents as a euro string with exactly two decimals.
func centsString(c int) string {
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

func lineViews(lines []store.InvoiceLine) []map[string]any {
	out := make([]map[string]any, 0, len(lines))
	for _, l := range lines {
		out = append(out, map[string]any{
			"lot_id":     l.LotID,
			"lot_number": l.LotNumber,
			"title":      l.Title,
			"source":     l.Source,
			"hammer":     centsString(l.Hammer),
			"premium":    centsString(l.Premium),
			"vat":        centsString(l.VAT),
		})
	}
	return out
}

func paymentViews(payments []store.Payment) []map[string]any {
	out := make([]map[string]any, 0, len(payments))
	for _, p := range payments {
		out = append(out, map[string]any{"amount": centsString(p.Amount), "method": p.Method, "recorded_at": rfc(p.RecordedAt)})
	}
	return out
}

func offerView(o store.Offer) map[string]any {
	return map[string]any{
		"id":         o.ID,
		"lot_id":     o.LotID,
		"kind":       o.Kind,
		"amount":     o.Amount,
		"expires_at": rfc(o.ExpiresAt),
		"status":     o.Status,
	}
}

func noticeView(n store.Notice) map[string]any {
	return map[string]any{
		"id":         n.ID,
		"kind":       n.Kind,
		"text":       n.Text,
		"lot_id":     strOrNil(n.LotID),
		"created_at": rfc(n.CreatedAt),
	}
}

// register records a bidder or consignor registration.
func (s *Server) register(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var body struct {
		Role     string `json:"role"`
		FullName string `json:"full_name"`
		Phone    string `json:"phone"`
		Address  string `json:"address"`
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"full_name": "Enter your full name."})
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return store.Invalid(map[string]string{"full_name": "Enter your full name."})
	}
	if isStaff(person.Roles) {
		return store.Conflict("already_registered", "You are already registered.")
	}
	reg, landing, err := s.db.Register(r.Context(), *person, body.Role, body.FullName, body.Phone, body.Address)
	if err != nil {
		return err
	}
	if err := s.db.AddRealmRole(r.Context(), person.Sub, reg.Role); err != nil {
		return store.CodedErr(503, "sign_in_unavailable", "Sign-in is unavailable right now. If you are already signed in, you can carry on bidding.")
	}
	writeJSON(w, 201, map[string]any{"registration": regView(reg), "landing": landing})
	return nil
}

// currentSale gives the sale the home page and catalogue show.
func (s *Server) currentSale(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	sale, err := s.db.CurrentSale(r.Context())
	if err != nil {
		return err
	}
	if sale == nil {
		return store.NotFound()
	}
	writeJSON(w, 200, map[string]any{"sale": saleView(*sale)})
	return nil
}

// catalogue returns a sale's lots complete on first load, with the sequence
// number the page's socket resumes from.
func (s *Server) catalogue(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	sale, _, views, seq, err := s.db.Catalogue(r.Context(), *person, r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"sale": saleView(sale), "lots": views, "seq": seq})
	return nil
}

// getLot answers one lot with its full history.
func (s *Server) getLot(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	view, history, seq, err := s.db.LotWithHistory(r.Context(), *person, r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"lot": view, "history": history, "seq": seq})
	return nil
}

// placeBid decides one bid, idempotent by key.
func (s *Server) placeBid(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	lotID := r.PathValue("id")
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 100 || !printableASCII(key) {
		return store.CodedErr(400, "idempotency_key_required", "Send the bid with an idempotency key.")
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return store.Invalid(map[string]string{"max_amount": "Enter a whole number of euros."})
	}
	body, err := store.ParseBid(raw)
	if err != nil {
		return err
	}
	status, resp, err := s.db.PlaceBid(r.Context(), *person, lotID, key, body)
	if err != nil {
		return err
	}
	writeJSON(w, status, resp)
	return nil
}

func printableASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < 0x21 || s[i] > 0x7e {
			return false
		}
	}
	return len(s) > 0
}

// setWatch turns watching on.
func (s *Server) setWatch(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	watching, err := s.db.SetWatch(r.Context(), *person, r.PathValue("id"), true)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"watching": watching})
	return nil
}

// unsetWatch turns watching off.
func (s *Server) unsetWatch(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	watching, err := s.db.SetWatch(r.Context(), *person, r.PathValue("id"), false)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"watching": watching})
	return nil
}

// notices lists the signed-in person's notices, newest first.
func (s *Server) notices(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var list []store.Notice
	var seq int64
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		list, err = tx.PersonNotices(ctx, person.ID)
		if err != nil {
			return err
		}
		seq, err = tx.LatestSeq(ctx)
		return err
	})
	if err != nil {
		return err
	}
	out := make([]map[string]any, 0, len(list))
	for _, n := range list {
		out = append(out, noticeView(n))
	}
	writeJSON(w, 200, map[string]any{"notices": out, "seq": seq})
	return nil
}

// bidderDashboard assembles the bidder's own desk.
func (s *Server) bidderDashboard(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	dash, err := s.db.BidderDashboard(r.Context(), *person)
	if err != nil {
		return err
	}
	writeJSON(w, 200, dash)
	return nil
}

// bidderInvoice answers the bidder's own invoice, 404 for anyone else's.
func (s *Server) bidderInvoice(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	var inv *store.Invoice
	err := s.db.WithTx(r.Context(), func(ctx context.Context, tx store.Tx) error {
		var err error
		inv, err = tx.GetInvoice(ctx, r.PathValue("id"))
		if err != nil {
			return err
		}
		if inv == nil || inv.BidderID != person.ID {
			inv = nil
		}
		return nil
	})
	if err != nil {
		return err
	}
	if inv == nil {
		return store.NotFound()
	}
	writeJSON(w, 200, map[string]any{"invoice": invoiceView(*inv)})
	return nil
}

// acceptOffer lets the bidder take an offered lot.
func (s *Server) acceptOffer(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	offer, invoice, err := s.db.AcceptOffer(r.Context(), *person, r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"offer": offerView(offer), "invoice": invoiceView(invoice)})
	return nil
}

// declineOffer records the bidder's refusal.
func (s *Server) declineOffer(w http.ResponseWriter, r *http.Request, person *store.Person) error {
	offer, err := s.db.DeclineOffer(r.Context(), *person, r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"offer": offerView(offer)})
	return nil
}
