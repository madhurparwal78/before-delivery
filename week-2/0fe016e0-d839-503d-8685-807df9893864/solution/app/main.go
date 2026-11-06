package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// App holds the database handle and whether the schema and seed are in place.
type App struct {
	db       *sql.DB
	ready    atomic.Bool
	exportMu sync.Mutex
}

func main() {
	port := os.Getenv("APP_PUBLIC_PORT")
	if port == "" {
		port = "4173"
	}
	db, err := sql.Open("pgx", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal("DATABASE_URL is not a usable PostgreSQL URL")
	}
	db.SetMaxOpenConns(40)
	db.SetMaxIdleConns(20)
	app := &App{db: db}
	go app.prepareStore()
	server := &http.Server{
		Addr:              "0.0.0.0:" + port,
		Handler:           app.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("listening on 0.0.0.0:%s", port)
	log.Fatal(server.ListenAndServe())
}

// prepareStore retries until the database answers, then creates the schema and loads the seed.
func (a *App) prepareStore() {
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := ensureStore(ctx, a.db)
		cancel()
		if err == nil {
			a.ready.Store(true)
			log.Print("store ready")
			return
		}
		log.Print("database not reachable yet, retrying")
		time.Sleep(time.Second)
	}
}

// currentMinute is the server clock in whole minutes since 1970-01-01 00:00 UTC.
func currentMinute() int {
	return int(time.Now().Unix() / 60)
}
