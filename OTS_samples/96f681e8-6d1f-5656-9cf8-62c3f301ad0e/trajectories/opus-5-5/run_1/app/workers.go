package main

import (
	"context"
	"log"
	"net/http"
	"time"
)

// runWorkers starts the background loops that act on the database clock.
func (a *app) runWorkers(ctx context.Context) {
	client := &http.Client{Timeout: 10 * time.Second}
	go (&noticeSender{a: a, channel: "email"}).run(ctx)
	go (&noticeSender{a: a, channel: "push", http: client}).run(ctx)
	go a.every(ctx, "owed voids", a.sendOwedVoids)
	go a.every(ctx, "guarantees", func(ctx context.Context) error {
		if err := a.refreshGuarantees(ctx); err != nil {
			return err
		}
		return a.settleShares(ctx)
	})
	a.every(ctx, "clock", a.clockTick)
}

func (a *app) every(ctx context.Context, name string, fn func(context.Context) error) {
	for {
		if err := fn(ctx); err != nil {
			log.Printf("%s: %v", name, err)
		}
		if !sleepCtx(ctx, time.Second) {
			return
		}
	}
}

// clockTick applies the transitions that come due with time alone.
func (a *app) clockTick(ctx context.Context) error {
	if err := a.tx(ctx, func(t *txn) error { return a.releaseExpiredHolds(ctx, t, 0) }); err != nil {
		return err
	}
	if err := a.tx(ctx, func(t *txn) error { return a.cancelMatchesAtCutoff(ctx, t, 0) }); err != nil {
		return err
	}
	if err := a.voidSharesAtStart(ctx); err != nil {
		return err
	}
	return closeFinishedGuarantees(ctx, a.db, nil)
}
