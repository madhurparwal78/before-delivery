package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "time/tzdata"
)

// App is the Gavelhouse server: configuration, the database and its collaborators.
type App struct {
	cfg config
	db  *sql.DB
	kc  *keycloak
	hub *hub
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		fatalf("configuration: %v", err)
	}
	redactLogs(cfg)
	a := &App{cfg: cfg, kc: newKeycloak(cfg), hub: newHub()}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := a.openDB(); err != nil {
		fatalf("database: %v", err)
	}
	for {
		if err := a.db.PingContext(ctx); err != nil {
			logf("waiting for PostgreSQL to accept connections")
		} else if err := a.migrate(ctx); err != nil {
			logf("prepare database: %v", err)
		} else if err := a.seed(ctx); err != nil {
			logf("seed database: %v", err)
		} else {
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
	go a.kc.setup(ctx)
	go a.listen(ctx)
	go a.runJobs(ctx)

	srv := &http.Server{Addr: ":" + cfg.port, Handler: a.routes(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	logf("Gavelhouse listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fatalf("serve: %v", err)
	}
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	r := func(pattern, role string, fn handlerFunc) { a.route(mux, pattern, role, fn) }

	r("GET /api/health", "", func(c *reqCtx) error { return c.json(200, map[string]string{"status": "ok"}) })
	r("GET /api/me", "", a.handleMe)
	r("POST /api/register", "any", a.handleRegister)
	r("GET /api/notices", "any", a.handleNotices)

	r("GET /api/sales/current", "", a.handleCurrentSale)
	r("GET /api/sales/{id}/catalogue", "", a.handleCatalogue)
	r("GET /api/lots/{id}", "", a.handleLot)
	r("PUT /api/lots/{id}/watch", "bidder", a.handleWatch)
	r("DELETE /api/lots/{id}/watch", "bidder", a.handleWatch)
	r("POST /api/lots/{id}/bids", "bidder", a.handleBid)

	r("GET /api/bidder/dashboard", "bidder", a.handleDashboard)
	r("GET /api/bidder/invoices/{id}", "bidder", a.handleBidderInvoice)
	r("POST /api/bidder/offers/{id}/accept", "bidder", a.handleAcceptOffer)
	r("POST /api/bidder/offers/{id}/decline", "bidder", a.handleDeclineOffer)

	r("POST /api/consign/lots", "consignor", a.handleConsignCreate)
	r("GET /api/consign/lots", "consignor", a.handleConsignLots)
	r("GET /api/consign/lots/{id}", "consignor", a.handleConsignLot)
	r("POST /api/consign/lots/{id}/second-chance", "consignor", a.handleSecondChance)
	r("POST /api/consign/lots/{id}/leave-unsold", "consignor", a.handleLeaveUnsold)
	r("GET /api/consign/statements", "consignor", a.handleConsignStatements)
	r("GET /api/consign/statements/{id}", "consignor", a.handleConsignStatement)

	r("GET /api/desk/lots", "specialist", a.handleDeskLots)
	r("PUT /api/desk/lots/{id}/estimate", "specialist", a.handleEstimate)
	r("POST /api/desk/sales", "specialist", a.handleCreateSale)
	r("GET /api/desk/sales", "specialist", a.handleSales)
	r("PUT /api/desk/sales/{id}/lots", "specialist", a.handleOrderLots)
	r("POST /api/desk/sales/{id}/publish", "specialist", a.handlePublish)

	r("GET /api/desk/invoices", "cashier", a.handleInvoices)
	r("GET /api/desk/invoices/{id}", "cashier", a.handleInvoice)
	r("POST /api/desk/invoices/{id}/payments", "cashier", a.handlePayment)

	r("GET /api/admin/registrations", "admin", a.handleRegistrations)
	r("POST /api/admin/registrations/{id}/approve", "admin", a.handleApprove)
	r("GET /api/admin/lots", "admin", a.handleAdminLots)
	r("GET /api/admin/lots/{id}/bids", "admin", a.handleAdminLotBids)
	r("POST /api/admin/bids/{id}/remove", "admin", a.handleRemoveBid)
	r("GET /api/admin/statements", "admin", a.handleAdminStatements)
	r("GET /api/admin/statements/{id}", "admin", a.handleAdminStatement)
	r("POST /api/admin/statements/{id}/issue", "admin", a.handleIssueStatement)
	r("POST /api/admin/statements/{id}/correct", "admin", a.handleCorrectStatement)

	mux.HandleFunc("GET /api/live", a.handleLive)
	mux.HandleFunc("GET /auth/login", a.handleLogin)
	mux.HandleFunc("GET /auth/callback", a.handleCallback)
	mux.HandleFunc("POST /auth/logout", a.handleLogout)
	mux.HandleFunc("GET /assets/", a.serveAsset)
	mux.HandleFunc("GET /fonts/", a.serveAsset)
	mux.HandleFunc("/", a.handlePage)
	return mux
}
