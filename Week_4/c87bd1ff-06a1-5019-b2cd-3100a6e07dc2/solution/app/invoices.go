package main

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type invoiceLine struct {
	LotID, Title, Source string
	LotNumber            int
	Hammer, Premium, VAT int64
}

type paymentRow struct {
	Amount int64
	Method string
	At     time.Time
}

type invoiceRow struct {
	ID, Number, SaleID, SaleTitle, PersonID, Status, BidderName string
	Paddle                                                      sql.NullInt64
	IssuedAt, DueAt                                             time.Time
	Lines                                                       []invoiceLine
	Payments                                                    []paymentRow
}

func (i *invoiceRow) totals() (hammer, premium, vat, total, paid int64) {
	for _, l := range i.Lines {
		hammer += l.Hammer
		premium += l.Premium
		vat += l.VAT
	}
	for _, p := range i.Payments {
		paid += p.Amount
	}
	return hammer, premium, vat, hammer + premium + vat, paid
}

func (i *invoiceRow) outstanding() int64 {
	_, _, _, total, paid := i.totals()
	return total - paid
}

func (i *invoiceRow) json(cashier bool) map[string]any {
	hammer, premium, vat, total, paid := i.totals()
	lines := make([]map[string]any, 0, len(i.Lines))
	for _, l := range i.Lines {
		lines = append(lines, map[string]any{
			"lot_id": l.LotID, "lot_number": l.LotNumber, "title": l.Title, "source": l.Source,
			"hammer": decimalText(l.Hammer), "premium": decimalText(l.Premium), "vat": decimalText(l.VAT),
		})
	}
	payments := make([]map[string]any, 0, len(i.Payments))
	for _, p := range i.Payments {
		payments = append(payments, map[string]any{"amount": decimalText(p.Amount), "method": p.Method, "recorded_at": apiTime(p.At)})
	}
	m := map[string]any{
		"id": i.ID, "number": i.Number, "sale_id": i.SaleID, "sale_title": i.SaleTitle, "paddle": optInt(i.Paddle),
		"status": i.Status, "issued_at": apiTime(i.IssuedAt), "due_at": apiTime(i.DueAt), "lines": lines,
		"hammer_total": decimalText(hammer), "premium_total": decimalText(premium), "vat_total": decimalText(vat),
		"total": decimalText(total), "paid": decimalText(paid), "outstanding": decimalText(total - paid), "payments": payments,
	}
	if cashier {
		m["bidder_name"] = i.BidderName
	}
	return m
}

// loadInvoices reads invoices (with lines and payments) matching a WHERE/ORDER clause.
func loadInvoices(ctx context.Context, q querier, clause string, args ...any) ([]*invoiceRow, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT i.id, i.number, i.sale_id, s.title, i.person_id, i.status, COALESCE(r.full_name, p.display_name), r.paddle, i.issued_at, i.due_at
		FROM invoices i JOIN sales s ON s.id = i.sale_id JOIN people p ON p.id = i.person_id
		LEFT JOIN registrations r ON r.person_id = i.person_id `+clause, args...)
	if err != nil {
		return nil, fmt.Errorf("load invoices: %w", err)
	}
	var out []*invoiceRow
	byID := map[string]*invoiceRow{}
	var ids []string
	for rows.Next() {
		i := &invoiceRow{}
		if err := rows.Scan(&i.ID, &i.Number, &i.SaleID, &i.SaleTitle, &i.PersonID, &i.Status, &i.BidderName, &i.Paddle, &i.IssuedAt, &i.DueAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan invoice: %w", err)
		}
		out = append(out, i)
		byID[i.ID] = i
		ids = append(ids, i.ID)
	}
	rows.Close()
	if err := readErr(rows, "invoices"); err != nil || len(ids) == 0 {
		return out, err
	}
	lineRows, err := q.QueryContext(ctx, `
		SELECT il.invoice_id, il.lot_id, l.title, COALESCE(l.lot_number, 0), il.source, il.hammer_cents, il.premium_cents, il.vat_cents
		FROM invoice_lines il JOIN lots l ON l.id = il.lot_id WHERE il.invoice_id = ANY($1) ORDER BY l.lot_number`, pqStrings(ids))
	if err != nil {
		return nil, fmt.Errorf("load invoice lines: %w", err)
	}
	for lineRows.Next() {
		var invoiceID string
		var l invoiceLine
		if err := lineRows.Scan(&invoiceID, &l.LotID, &l.Title, &l.LotNumber, &l.Source, &l.Hammer, &l.Premium, &l.VAT); err != nil {
			lineRows.Close()
			return nil, fmt.Errorf("scan invoice line: %w", err)
		}
		byID[invoiceID].Lines = append(byID[invoiceID].Lines, l)
	}
	lineRows.Close()
	payRows, err := q.QueryContext(ctx, `SELECT invoice_id, amount_cents, method, recorded_at FROM payments WHERE invoice_id = ANY($1) ORDER BY id`, pqStrings(ids))
	if err != nil {
		return nil, fmt.Errorf("load payments: %w", err)
	}
	defer payRows.Close()
	for payRows.Next() {
		var invoiceID string
		var p paymentRow
		if err := payRows.Scan(&invoiceID, &p.Amount, &p.Method, &p.At); err != nil {
			return nil, fmt.Errorf("scan payment: %w", err)
		}
		byID[invoiceID].Payments = append(byID[invoiceID].Payments, p)
	}
	if err := readErr(payRows, "payments"); err != nil {
		return nil, err
	}
	return out, nil
}

func invoiceJSONs(list []*invoiceRow, cashier bool) []map[string]any {
	out := make([]map[string]any, 0, len(list))
	for _, i := range list {
		out = append(out, i.json(cashier))
	}
	return out
}
