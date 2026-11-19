package saleroom

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"gavelhouse/internal/domain"
)

// invoiceLine is one lot on an invoice, with its premium and VAT already
// rounded to the cent.
type invoiceLine struct {
	LotID     string
	LotNumber int
	Title     string
	Source    string
	Hammer    domain.Cents
	Premium   domain.Cents
	VAT       domain.Cents
}

func lineFor(lotID string, lotNumber int, title, source string, hammerEuros int) invoiceLine {
	hammer := domain.EurosToCents(hammerEuros)
	premium := domain.Premium(hammer)
	return invoiceLine{
		LotID: lotID, LotNumber: lotNumber, Title: title, Source: source,
		Hammer: hammer, Premium: premium, VAT: domain.VAT(premium),
	}
}

// issueInvoice writes one invoice holding the given lines and tells the buyer.
func issueInvoice(ctx context.Context, tx pgx.Tx, saleID, personID string,
	lines []invoiceLine, issuedAt, dueAt time.Time) (string, string, domain.Cents, error) {
	n, err := nextCounter(ctx, tx, "invoice")
	if err != nil {
		return "", "", 0, err
	}
	number := fmt.Sprintf("INV-%05d", n)
	id := newID()
	_, err = tx.Exec(ctx,
		`INSERT INTO invoices (id, number, sale_id, person_id, status, issued_at, due_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		id, number, saleID, personID, domain.InvoiceIssued, issuedAt, dueAt)
	if err != nil {
		return "", "", 0, fmt.Errorf("insert invoice %s: %w", number, err)
	}
	var total domain.Cents
	for _, ln := range lines {
		_, err := tx.Exec(ctx,
			`INSERT INTO invoice_lines (invoice_id, lot_id, source, hammer_cents, premium_cents, vat_cents)
			 VALUES ($1,$2,$3,$4,$5,$6)`,
			id, ln.LotID, ln.Source, int64(ln.Hammer), int64(ln.Premium), int64(ln.VAT))
		if err != nil {
			return "", "", 0, fmt.Errorf("insert invoice line for lot %s: %w", ln.LotID, err)
		}
		total += ln.Hammer + ln.Premium + ln.VAT
	}
	body := domain.NoticeInvoiceIssuedText(number, total, dueAt)
	if err := addNotice(ctx, tx, personID, domain.NoticeInvoiceIssued, body, "", issuedAt); err != nil {
		return "", "", 0, err
	}
	return id, number, total, nil
}

// invoiceRecord is an invoice as the database holds it.
type invoiceRecord struct {
	ID           string
	Number       string
	SaleID       string
	SaleTitle    string
	PersonID     string
	BidderName   string
	Paddle       *int
	Status       string
	IssuedAt     time.Time
	DueAt        time.Time
	Lines        []invoiceLine
	Payments     []paymentRecord
	HammerTotal  domain.Cents
	PremiumTotal domain.Cents
	VATTotal     domain.Cents
	Total        domain.Cents
	Paid         domain.Cents
	Outstanding  domain.Cents
}

type paymentRecord struct {
	Amount     domain.Cents
	Method     string
	RecordedAt time.Time
}

const invoiceColumns = `i.id, i.number, i.sale_id, s.title, i.person_id, p.full_name,
	r.paddle, i.status, i.issued_at, i.due_at`

const invoiceFrom = ` FROM invoices i
	JOIN sales s ON s.id = i.sale_id
	JOIN people p ON p.id = i.person_id
	LEFT JOIN registrations r ON r.person_id = i.person_id`

func loadInvoices(ctx context.Context, tx pgx.Tx, where string, args ...any) ([]*invoiceRecord, error) {
	rows, err := tx.Query(ctx, `SELECT `+invoiceColumns+invoiceFrom+` `+where, args...)
	if err != nil {
		return nil, fmt.Errorf("query invoices: %w", err)
	}
	defer rows.Close()
	var out []*invoiceRecord
	for rows.Next() {
		inv := &invoiceRecord{}
		err := rows.Scan(&inv.ID, &inv.Number, &inv.SaleID, &inv.SaleTitle, &inv.PersonID,
			&inv.BidderName, &inv.Paddle, &inv.Status, &inv.IssuedAt, &inv.DueAt)
		if err != nil {
			return nil, fmt.Errorf("scan invoice: %w", err)
		}
		out = append(out, inv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, inv := range out {
		if err := fillInvoice(ctx, tx, inv); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func fillInvoice(ctx context.Context, tx pgx.Tx, inv *invoiceRecord) error {
	rows, err := tx.Query(ctx,
		`SELECT il.lot_id, l.lot_number, l.title, il.source, il.hammer_cents,
		        il.premium_cents, il.vat_cents
		   FROM invoice_lines il JOIN lots l ON l.id = il.lot_id
		  WHERE il.invoice_id = $1 ORDER BY l.lot_number`, inv.ID)
	if err != nil {
		return fmt.Errorf("query invoice lines for %s: %w", inv.Number, err)
	}
	defer rows.Close()
	for rows.Next() {
		var ln invoiceLine
		if err := rows.Scan(&ln.LotID, &ln.LotNumber, &ln.Title, &ln.Source,
			&ln.Hammer, &ln.Premium, &ln.VAT); err != nil {
			return fmt.Errorf("scan invoice line: %w", err)
		}
		inv.Lines = append(inv.Lines, ln)
		inv.HammerTotal += ln.Hammer
		inv.PremiumTotal += ln.Premium
		inv.VATTotal += ln.VAT
	}
	if err := rows.Err(); err != nil {
		return err
	}
	inv.Total = inv.HammerTotal + inv.PremiumTotal + inv.VATTotal

	prows, err := tx.Query(ctx,
		`SELECT amount_cents, method, recorded_at FROM payments
		  WHERE invoice_id = $1 ORDER BY recorded_at`, inv.ID)
	if err != nil {
		return fmt.Errorf("query payments for %s: %w", inv.Number, err)
	}
	defer prows.Close()
	for prows.Next() {
		var p paymentRecord
		if err := prows.Scan(&p.Amount, &p.Method, &p.RecordedAt); err != nil {
			return fmt.Errorf("scan payment: %w", err)
		}
		inv.Payments = append(inv.Payments, p)
		inv.Paid += p.Amount
	}
	if err := prows.Err(); err != nil {
		return err
	}
	inv.Outstanding = inv.Total - inv.Paid
	return nil
}

func (inv *invoiceRecord) project(withBidderName bool) map[string]any {
	lines := make([]map[string]any, 0, len(inv.Lines))
	for _, ln := range inv.Lines {
		lines = append(lines, map[string]any{
			"lot_id":     ln.LotID,
			"lot_number": ln.LotNumber,
			"title":      ln.Title,
			"source":     ln.Source,
			"hammer":     ln.Hammer.String(),
			"premium":    ln.Premium.String(),
			"vat":        ln.VAT.String(),
		})
	}
	payments := make([]map[string]any, 0, len(inv.Payments))
	for _, p := range inv.Payments {
		payments = append(payments, map[string]any{
			"amount":      p.Amount.String(),
			"method":      p.Method,
			"recorded_at": p.RecordedAt.UTC().Format(time.RFC3339),
		})
	}
	m := map[string]any{
		"id":            inv.ID,
		"number":        inv.Number,
		"sale_id":       inv.SaleID,
		"sale_title":    inv.SaleTitle,
		"paddle":        intPtrOrNil(inv.Paddle),
		"status":        inv.Status,
		"issued_at":     inv.IssuedAt.UTC().Format(time.RFC3339),
		"due_at":        inv.DueAt.UTC().Format(time.RFC3339),
		"lines":         lines,
		"hammer_total":  inv.HammerTotal.String(),
		"premium_total": inv.PremiumTotal.String(),
		"vat_total":     inv.VATTotal.String(),
		"total":         inv.Total.String(),
		"paid":          inv.Paid.String(),
		"outstanding":   inv.Outstanding.String(),
		"payments":      payments,
	}
	if withBidderName {
		m["bidder_name"] = inv.BidderName
	}
	return m
}
