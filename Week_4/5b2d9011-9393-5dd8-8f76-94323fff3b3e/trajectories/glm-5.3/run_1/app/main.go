package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"holdfast/internal/api"
	"holdfast/internal/clock"
	"holdfast/internal/config"
	"holdfast/internal/mail"
	"holdfast/internal/rooms"
	"holdfast/internal/store"
	"holdfast/internal/studio"
	"holdfast/internal/zoneinfo"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx := context.Background()

	ck := clock.New()

	// Postgres may be down at boot; that must not stop the app.
	st, err := store.Open(cfg.DatabaseURL)
	if err != nil {
		st = store.Unreachable()
		log.Printf("postgres down at boot: %v", err)
	}

	// Valkey may be down at boot.
	vk, err := rooms.NewValkey(cfg.ValkeyURL)
	if err != nil {
		log.Printf("valkey down at boot: %v", err)
	} else {
		vk.ClearStale()
	}

	// The studio zone is the seeded zone; the seed row confirms it.
	studioName := "Cinderlatch Games"
	studioZone := studio.Zone{Name: "America/Chicago"}
	if loc, err := zoneinfo.Load(studioZone.Name); err == nil {
		studioZone.Loc = loc
	} else {
		studioZone.Loc = time.UTC
	}

	hub := rooms.NewHub(ck, vk, st, liveShopItemsSource(st))
	appAPI := api.NewApp(cfg, ck, st, hub, studioZone, studioName)
	hub.SetMatchOver(func(rec rooms.FinishRecord) {
		saveMatch(ctx, st, rec)
	})

	sender := &mail.Sender{Host: cfg.SMTPHost, Port: cfg.SMTPPort, From: cfg.MailFrom}

	// Probe each dependency at least every 2 seconds.
	go probeLoop(ctx, st, vk, sender, appAPI)

	// Apply the schema and seed when Postgres is reachable.
	go func() {
		for {
			if st.Ping() {
				if err := st.Migrate(ctx); err == nil {
					seedAll(ctx, st, studioZone)
				}
				break
			}
			time.Sleep(2 * time.Second)
		}
	}()

	go hub.Run(ctx)

	worker := &mail.Worker{Sender: sender, Store: st, Clock: ck}
	worker.OnQueued = appAPI.SetQueued
	worker.OnUp = func(up bool) { appAPI.SetService("mail", up) }
	worker.ReminderTime = func(n store.Night, viewerZone string) (string, string) {
		return appAPI.MailTimeIn(n.StartsAt, studioZone.Name), appAPI.MailTimeIn(n.StartsAt, viewerZone)
	}
	go worker.Run(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/", appAPI.Handle)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		serveFrontend(w, r, cfg.EmbedDir)
	})

	addr := "0.0.0.0:" + cfg.PublicPort
	srv := &http.Server{Addr: addr, Handler: mux}
	log.Printf("holdfast serving on %s", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("serve: %v", err)
	}
}
