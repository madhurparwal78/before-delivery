package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type statementLine struct {
	LotID      string  `json:"lot_id"`
	LotNumber  int     `json:"lot_number"`
	Title      string  `json:"title"`
	Result     string  `json:"result"`
	Hammer     *string `json:"hammer"`
	Commission *string `json:"commission"`
	Net        *string `json:"net"`
}

type statementBody struct {
	Lines           []statementLine `json:"lines"`
	HammerTotal     string          `json:"hammer_total"`
	CommissionTotal string          `json:"commission_total"`
	NetTotal        string          `json:"net_total"`
}

// computeStatement works a consignor's lots in a sale out from their current results.
func computeStatement(ctx context.Context, q querier, saleID, consignorID string) (statementBody, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, COALESCE(lot_number, 0), title, state, COALESCE(hammer, 0) FROM lots
		WHERE sale_id = $1 AND consignor_id = $2 ORDER BY lot_number`, saleID, consignorID)
	if err != nil {
		return statementBody{}, fmt.Errorf("load statement lots: %w", err)
	}
	defer rows.Close()
	body := statementBody{Lines: []statementLine{}}
	var hammerSum, commissionSum int64
	for rows.Next() {
		var l statementLine
		var state string
		var hammer int
		if err := rows.Scan(&l.LotID, &l.LotNumber, &l.Title, &state, &hammer); err != nil {
			return body, fmt.Errorf("scan statement lot: %w", err)
		}
		l.Result = "unsold"
		if lotSold(state) {
			l.Result = "sold"
			h, c := int64(hammer)*100, commissionCents(hammer)
			hs, cs, ns := decimalText(h), decimalText(c), decimalText(h-c)
			l.Hammer, l.Commission, l.Net = &hs, &cs, &ns
			hammerSum += h
			commissionSum += c
		}
		body.Lines = append(body.Lines, l)
	}
	body.HammerTotal = decimalText(hammerSum)
	body.CommissionTotal = decimalText(commissionSum)
	body.NetTotal = decimalText(hammerSum - commissionSum)
	return body, readErr(rows, "statement lines")
}

func (a *App) draftStatements(ctx context.Context, t *Tx, saleID string) error {
	rows, err := t.QueryContext(ctx, `SELECT DISTINCT consignor_id FROM lots WHERE sale_id = $1`, saleID)
	if err != nil {
		return fmt.Errorf("find consignors: %w", err)
	}
	var consignors []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan consignor: %w", err)
		}
		consignors = append(consignors, id)
	}
	rows.Close()
	if err := readErr(rows, "consignors"); err != nil {
		return err
	}
	for _, id := range consignors {
		n, err := nextCounter(ctx, t, "statement")
		if err != nil {
			return err
		}
		_, err = t.ExecContext(ctx, `INSERT INTO statements (id, number, sale_id, consignor_id, version, status) VALUES ($1, $2, $3, $4, 1, $5)`,
			newID("stm_"), fmt.Sprintf("ST-%05d", n), saleID, id, statementFlow.start)
		if err != nil {
			return fmt.Errorf("draft statement: %w", err)
		}
	}
	return nil
}

type statementRow struct {
	ID, Number, SaleID, SaleTitle, ConsignorID, Status string
	Version                                            int
	IssuedAt                                           sql.NullTime
	Supersedes, SupersededBy, Frozen                   sql.NullString
}

const statementColumns = `s.id, s.number, s.sale_id, sa.title, s.consignor_id, s.status, s.version, s.issued_at, s.supersedes, s.superseded_by, s.frozen`

func loadStatements(ctx context.Context, q querier, clause string, args ...any) ([]*statementRow, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+statementColumns+" FROM statements s JOIN sales sa ON sa.id = s.sale_id "+clause, args...)
	if err != nil {
		return nil, fmt.Errorf("load statements: %w", err)
	}
	defer rows.Close()
	var out []*statementRow
	for rows.Next() {
		s := &statementRow{}
		if err := rows.Scan(&s.ID, &s.Number, &s.SaleID, &s.SaleTitle, &s.ConsignorID, &s.Status, &s.Version, &s.IssuedAt, &s.Supersedes, &s.SupersededBy, &s.Frozen); err != nil {
			return nil, fmt.Errorf("scan statement: %w", err)
		}
		out = append(out, s)
	}
	return out, readErr(rows, "statements")
}

// json renders a statement; drafts are worked out again on every read, issued ones are frozen.
func (s *statementRow) json(ctx context.Context, q querier) (map[string]any, error) {
	var body statementBody
	if statementDraft(s.Status) {
		var err error
		if body, err = computeStatement(ctx, q, s.SaleID, s.ConsignorID); err != nil {
			return nil, err
		}
	} else if err := json.Unmarshal([]byte(s.Frozen.String), &body); err != nil {
		return nil, fmt.Errorf("read frozen statement: %w", err)
	}
	return map[string]any{
		"id": s.ID, "number": s.Number, "sale_id": s.SaleID, "sale_title": s.SaleTitle, "version": s.Version,
		"status": s.Status, "issued_at": optTime(s.IssuedAt), "supersedes": optString(s.Supersedes),
		"superseded_by": optString(s.SupersededBy), "lines": body.Lines, "hammer_total": body.HammerTotal,
		"commission_total": body.CommissionTotal, "net_total": body.NetTotal,
	}, nil
}

func statementJSONs(ctx context.Context, q querier, list []*statementRow) ([]map[string]any, error) {
	out := make([]map[string]any, 0, len(list))
	for _, s := range list {
		m, err := s.json(ctx, q)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

func (a *App) handleConsignStatements(c *reqCtx) error {
	var out []map[string]any
	err := a.snapshot(c.r.Context(), func(q *sql.Tx) error {
		list, err := loadStatements(c.r.Context(), q, "WHERE s.consignor_id = $1 AND NOT (s.status = ANY($2)) ORDER BY s.issued_at DESC, s.number DESC", c.viewer.PersonID, pqStrings(statementsDraft))
		if err != nil {
			return err
		}
		out, err = statementJSONs(c.r.Context(), q, list)
		return err
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"statements": out})
}

func (a *App) handleConsignStatement(c *reqCtx) error {
	return a.oneStatement(c, "WHERE s.id = $1 AND s.consignor_id = $2 AND NOT (s.status = ANY($3))", c.r.PathValue("id"), c.viewer.PersonID, pqStrings(statementsDraft))
}

func (a *App) handleAdminStatement(c *reqCtx) error {
	return a.oneStatement(c, "WHERE s.id = $1", c.r.PathValue("id"))
}

func (a *App) oneStatement(c *reqCtx, clause string, args ...any) error {
	var out map[string]any
	err := a.snapshot(c.r.Context(), func(q *sql.Tx) error {
		list, err := loadStatements(c.r.Context(), q, clause, args...)
		if err != nil || len(list) == 0 {
			return err
		}
		out, err = list[0].json(c.r.Context(), q)
		return err
	})
	if err != nil {
		return err
	}
	if out == nil {
		return c.fail(errNotFound)
	}
	return c.json(200, map[string]any{"statement": out})
}

func (a *App) handleAdminStatements(c *reqCtx) error {
	var out []map[string]any
	err := a.snapshot(c.r.Context(), func(q *sql.Tx) error {
		clause, args := "ORDER BY s.number DESC", []any(nil)
		if sale := c.r.URL.Query().Get("sale_id"); sale != "" {
			clause, args = "WHERE s.sale_id = $1 ORDER BY s.number", []any{sale}
		}
		list, err := loadStatements(c.r.Context(), q, clause, args...)
		if err != nil {
			return err
		}
		out, err = statementJSONs(c.r.Context(), q, list)
		return err
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"statements": out})
}

// freeze stores the statement's current lines and totals and marks it issued, telling the consignor.
func (a *App) freeze(ctx context.Context, t *Tx, s *statementRow, now time.Time) error {
	issued, ok := statementFlow.next(s.Status, "issue")
	if !ok {
		return errTransition
	}
	body, err := computeStatement(ctx, t, s.SaleID, s.ConsignorID)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("freeze statement: %w", err)
	}
	if _, err := t.ExecContext(ctx, `UPDATE statements SET status = $4, issued_at = $2, frozen = $3 WHERE id = $1`, s.ID, now, string(raw), issued); err != nil {
		return fmt.Errorf("issue statement: %w", err)
	}
	return notify(ctx, t, s.ConsignorID, "statement_issued", fmt.Sprintf("Your statement %s is ready.", s.Number), "")
}

func lockStatement(ctx context.Context, t *Tx, id string) (*statementRow, error) {
	if _, err := t.ExecContext(ctx, `SELECT 1 FROM statements WHERE id = $1 FOR UPDATE`, id); err != nil {
		return nil, fmt.Errorf("lock statement: %w", err)
	}
	list, err := loadStatements(ctx, t, "WHERE s.id = $1", id)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return list[0], nil
}

func (a *App) handleIssueStatement(c *reqCtx) error {
	ctx := c.r.Context()
	var out map[string]any
	err := a.tx(ctx, func(t *Tx) error {
		s, err := lockStatement(ctx, t, c.r.PathValue("id"))
		if err != nil {
			return err
		}
		if s == nil {
			return errNotFound
		}
		if !statementFlow.can(s.Status, "issue") {
			return failure(409, "statement_locked", fmt.Sprintf("Statement %s is issued and locked.", s.Number))
		}
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		if err := a.freeze(ctx, t, s, now); err != nil {
			return err
		}
		list, err := loadStatements(ctx, t, "WHERE s.id = $1", s.ID)
		if err != nil {
			return err
		}
		out, err = list[0].json(ctx, t)
		return err
	})
	if err != nil {
		return err
	}
	return c.json(200, map[string]any{"statement": out})
}

func (a *App) handleCorrectStatement(c *reqCtx) error {
	ctx := c.r.Context()
	body, ae := c.decode()
	if ae != nil {
		return c.fail(ae)
	}
	note, _ := body["note"].(string)
	var created, superseded map[string]any
	err := a.tx(ctx, func(t *Tx) error {
		s, err := lockStatement(ctx, t, c.r.PathValue("id"))
		if err != nil {
			return err
		}
		if s == nil {
			return errNotFound
		}
		replaced, ok := statementFlow.next(s.Status, "supersede")
		if !ok {
			return errTransition
		}
		if n := len([]rune(strings.TrimSpace(note))); n < 1 || n > 300 {
			return invalid("note", "Enter a note of up to 300 characters.")
		}
		now, err := dbNow(ctx, t)
		if err != nil {
			return err
		}
		n, err := nextCounter(ctx, t, "statement")
		if err != nil {
			return err
		}
		next := &statementRow{ID: newID("stm_"), Number: fmt.Sprintf("ST-%05d", n), SaleID: s.SaleID, ConsignorID: s.ConsignorID, Status: statementFlow.start}
		_, err = t.ExecContext(ctx, `INSERT INTO statements (id, number, sale_id, consignor_id, version, status, supersedes, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			next.ID, next.Number, next.SaleID, next.ConsignorID, s.Version+1, next.Status, s.ID, strings.TrimSpace(note))
		if err != nil {
			return fmt.Errorf("write correction: %w", err)
		}
		if _, err := t.ExecContext(ctx, `UPDATE statements SET status = $3, superseded_by = $2 WHERE id = $1`, s.ID, next.ID, replaced); err != nil {
			return fmt.Errorf("supersede statement: %w", err)
		}
		if err := a.freeze(ctx, t, next, now); err != nil {
			return err
		}
		for _, pair := range []struct {
			id  string
			dst *map[string]any
		}{{next.ID, &created}, {s.ID, &superseded}} {
			list, err := loadStatements(ctx, t, "WHERE s.id = $1", pair.id)
			if err != nil || len(list) == 0 {
				return fmt.Errorf("reload statement: %w", errors.Join(err))
			}
			if *pair.dst, err = list[0].json(ctx, t); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return c.json(201, map[string]any{"statement": created, "superseded": superseded})
}
