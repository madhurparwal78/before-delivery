package main

import (
	"fmt"
	"time"
)

var seedSubscribers = []string{"dock-office@meridian-haulage.example", "ops@larkfield-freight.example"}

func init() {
	seeders = append(seeders, seeder{order: 60, name: "status", fn: seedStatusRows})
}

func seedStatusRows(a *App, w *Work) error {
	var trackingID string
	if err := w.Tx.QueryRow(w.Ctx, `select id from services where name = 'Shipment Tracking'`).Scan(&trackingID); err != nil {
		return fmt.Errorf("find Shipment Tracking: %w", err)
	}
	published := time.Date(2026, time.October, 8, 17, 0, 0, 0, time.UTC)
	updates := []struct {
		title, body, state string
		serviceIDs         []string
		publishedAt        *time.Time
	}{
		{"Tracking delays cleared", "Tracking updates are back on time.", "resolved", []string{trackingID}, &published},
		{"Carrier feed slowdown", "DRAFT-ONLY: carrier feed slowdown under review.", "investigating", []string{}, nil},
	}
	for _, update := range updates {
		_, err := w.Tx.Exec(w.Ctx, `insert into status_updates (id, title, body, state, service_ids, published_at, created_at)
			values ($1, $2, $3, $4, $5, $6, $7)`, newID(), update.title, update.body, update.state, update.serviceIDs, update.publishedAt, w.Now)
		if err != nil {
			return fmt.Errorf("insert status update %s: %w", update.title, err)
		}
	}
	for _, address := range seedSubscribers {
		_, err := w.Tx.Exec(w.Ctx, `insert into subscribers (id, email, token, created_at) values ($1, $2, $3, $4)`,
			newID(), address, newToken(16), w.Now)
		if err != nil {
			return fmt.Errorf("insert subscriber %s: %w", address, err)
		}
	}
	return nil
}
