package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"gavelhouse/internal/domain"
	"gavelhouse/internal/keycloak"
	"gavelhouse/internal/saleroom"
)

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})

	s.mux.HandleFunc("GET /auth/login", s.handleLogin)
	s.mux.HandleFunc("GET /auth/callback", s.handleCallback)
	s.mux.HandleFunc("POST /auth/logout", s.handleLogout)
	s.mux.HandleFunc("GET /api/me", s.handleMe)
	s.mux.HandleFunc("GET /api/live", s.handleLive)

	s.mux.HandleFunc("GET /api/sales/current", s.signedAny(s.handleCurrentSale))
	s.mux.HandleFunc("GET /api/sales/{saleID}/catalogue", s.signedAny(s.handleCatalogue))
	s.mux.HandleFunc("GET /api/lots/{lotID}", s.signedAny(s.handleLot))
	s.mux.HandleFunc("GET /api/notices", s.signedIn(s.handleNotices))

	s.mux.HandleFunc("POST /api/register", s.signedIn(s.handleRegister))

	s.mux.HandleFunc("POST /api/lots/{lotID}/bids", s.role("bidder", s.handlePlaceBid))
	s.mux.HandleFunc("PUT /api/lots/{lotID}/watch", s.role("bidder", s.handleWatch))
	s.mux.HandleFunc("DELETE /api/lots/{lotID}/watch", s.role("bidder", s.handleUnwatch))
	s.mux.HandleFunc("GET /api/bidder/dashboard", s.role("bidder", s.handleDashboard))
	s.mux.HandleFunc("GET /api/bidder/invoices/{invoiceID}", s.role("bidder", s.handleBidderInvoice))
	s.mux.HandleFunc("POST /api/bidder/offers/{offerID}/accept", s.role("bidder", s.handleAcceptOffer))
	s.mux.HandleFunc("POST /api/bidder/offers/{offerID}/decline", s.role("bidder", s.handleDeclineOffer))

	s.mux.HandleFunc("POST /api/consign/lots", s.role("consignor", s.handleConsignLot))
	s.mux.HandleFunc("GET /api/consign/lots", s.role("consignor", s.handleConsignorLots))
	s.mux.HandleFunc("GET /api/consign/lots/{lotID}", s.role("consignor", s.handleConsignorLot))
	s.mux.HandleFunc("POST /api/consign/lots/{lotID}/second-chance", s.role("consignor", s.handleSecondChance))
	s.mux.HandleFunc("POST /api/consign/lots/{lotID}/leave-unsold", s.role("consignor", s.handleLeaveUnsold))
	s.mux.HandleFunc("GET /api/consign/statements", s.role("consignor", s.handleConsignorStatements))
	s.mux.HandleFunc("GET /api/consign/statements/{statementID}", s.role("consignor", s.handleConsignorStatement))

	s.mux.HandleFunc("GET /api/desk/lots", s.role("specialist", s.handleDeskLots))
	s.mux.HandleFunc("PUT /api/desk/lots/{lotID}/estimate", s.role("specialist", s.handleEstimate))
	s.mux.HandleFunc("GET /api/desk/sales", s.role("specialist", s.handleSales))
	s.mux.HandleFunc("POST /api/desk/sales", s.role("specialist", s.handleCreateSale))
	s.mux.HandleFunc("PUT /api/desk/sales/{saleID}/lots", s.role("specialist", s.handleOrderSaleLots))
	s.mux.HandleFunc("POST /api/desk/sales/{saleID}/publish", s.role("specialist", s.handlePublishSale))

	s.mux.HandleFunc("GET /api/desk/invoices", s.role("cashier", s.handleDeskInvoices))
	s.mux.HandleFunc("GET /api/desk/invoices/{invoiceID}", s.role("cashier", s.handleDeskInvoice))
	s.mux.HandleFunc("POST /api/desk/invoices/{invoiceID}/payments", s.role("cashier", s.handleRecordPayment))

	s.mux.HandleFunc("GET /api/admin/registrations", s.role("admin", s.handleRegistrations))
	s.mux.HandleFunc("POST /api/admin/registrations/{registrationID}/approve", s.role("admin", s.handleApprove))
	s.mux.HandleFunc("GET /api/admin/lots", s.role("admin", s.handleAdminLots))
	s.mux.HandleFunc("GET /api/admin/lots/{lotID}/bids", s.role("admin", s.handleAdminLotBids))
	s.mux.HandleFunc("POST /api/admin/bids/{bidID}/remove", s.role("admin", s.handleRemoveBid))
	s.mux.HandleFunc("GET /api/admin/statements", s.role("admin", s.handleAdminStatements))
	s.mux.HandleFunc("GET /api/admin/statements/{statementID}", s.role("admin", s.handleAdminStatement))
	s.mux.HandleFunc("POST /api/admin/statements/{statementID}/issue", s.role("admin", s.handleIssueStatement))
	s.mux.HandleFunc("POST /api/admin/statements/{statementID}/correct", s.role("admin", s.handleCorrectStatement))

	s.mux.HandleFunc("GET /assets/{path...}", s.handleAsset)
	s.mux.HandleFunc("/", s.handlePage)
}

type handler func(http.ResponseWriter, *http.Request, saleroom.Viewer)

// signedAny lets the public pages through, signed in or not.
func (s *Server) signedAny(next handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, _, err := s.viewerOf(r)
		if err != nil {
			fail(w, err)
			return
		}
		next(w, r, v)
	}
}

// signedIn answers 401 when there is no session.
func (s *Server) signedIn(next handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, _, err := s.viewerOf(r)
		if err != nil {
			fail(w, err)
			return
		}
		if !v.SignedIn {
			writeError(w, http.StatusUnauthorized, "signed_out", "Sign in to use the saleroom.", nil)
			return
		}
		next(w, r, v)
	}
}

// role answers only to the realm role that owns the route.
func (s *Server) role(want string, next handler) http.HandlerFunc {
	return s.signedIn(func(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
		if !v.HasRole[want] {
			writeError(w, http.StatusForbidden, "forbidden", "This desk belongs to another role.", nil)
			return
		}
		next(w, r, v)
	})
}

func (s *Server) handleCurrentSale(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	sale, err := s.room.CurrentSale(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sale": sale})
}

func (s *Server) handleCatalogue(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	out, err := s.room.Catalogue(r.Context(), v, r.PathValue("saleID"))
	if err != nil {
		fail(w, err)
		return
	}
	// The catalogue endpoint answers with the published keys; the page's own
	// first response carries each lot's history as well.
	delete(out, "histories")
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleLot(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	out, err := s.room.Lot(r.Context(), v, r.PathValue("lotID"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleNotices(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	out, err := s.room.Notices(r.Context(), v)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	if v.RegRole != "" || v.HasRole["specialist"] || v.HasRole["cashier"] || v.HasRole["admin"] {
		if v.RegRole != "" {
			writeError(w, http.StatusConflict, "already_registered",
				"You are already registered in this saleroom.", nil)
			return
		}
		writeError(w, http.StatusForbidden, "forbidden", "This desk belongs to another role.", nil)
		return
	}
	body, _, ok := decodeBody(w, r)
	if !ok {
		return
	}
	role := stringField(body, "role")
	fullName := stringField(body, "full_name")
	phone := stringField(body, "phone")
	address := stringField(body, "address")
	fields := map[string]string{}
	if role != "bidder" && role != "consignor" {
		fields["role"] = domain.MsgChooseRole
	}
	if n := len([]rune(fullName)); n < 1 || n > 120 {
		fields["full_name"] = domain.MsgEnterFullName
	}
	if n := len([]rune(phone)); n < 6 || n > 30 {
		fields["phone"] = domain.MsgEnterPhone
	}
	if n := len([]rune(address)); n < 1 || n > 300 {
		fields["address"] = domain.MsgEnterAddress
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "invalid", "Check the highlighted fields.", fields)
		return
	}
	if err := s.realm.AssignRole(r.Context(), v.PersonID, role); err != nil {
		if errors.Is(err, keycloak.ErrUnreachable) || !s.realm.Reachable(r.Context(), keycloakProbeBudget) {
			writeError(w, http.StatusServiceUnavailable, "sign_in_unavailable",
				"Sign-in is unavailable right now. If you are already signed in, you can carry on bidding.", nil)
			return
		}
		fail(w, err)
		return
	}
	out, err := s.room.Register(r.Context(), v, role, fullName, phone, address)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handlePlaceBid(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	key := r.Header.Get("Idempotency-Key")
	if !validIdempotencyKey(key) {
		writeError(w, http.StatusBadRequest, "idempotency_key_required",
			"Send an Idempotency-Key header with every bid.", nil)
		return
	}
	body, raw, ok := decodeBody(w, r)
	if !ok {
		return
	}
	digest := sha256.Sum256(raw)
	bidType := stringField(body, "type")
	if bidType != "single" && bidType != "maximum" {
		bidType = "maximum"
	}
	out, err := s.room.PlaceBid(r.Context(), v, saleroom.BidRequest{
		LotID:          r.PathValue("lotID"),
		Type:           bidType,
		MaxAmount:      wholeEuros(body, "max_amount"),
		IdempotencyKey: key,
		BodyHash:       hex.EncodeToString(digest[:]),
	})
	if err != nil {
		fail(w, err)
		return
	}
	writeRaw(w, out.Status, out.Body)
}

func validIdempotencyKey(key string) bool {
	if len(key) < 1 || len(key) > 100 {
		return false
	}
	for _, c := range []byte(key) {
		if c < 0x21 || c > 0x7e {
			return false
		}
	}
	return true
}

func (s *Server) handleWatch(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	s.setWatch(w, r, v, true)
}

func (s *Server) handleUnwatch(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	s.setWatch(w, r, v, false)
}

func (s *Server) setWatch(w http.ResponseWriter, r *http.Request, v saleroom.Viewer, watching bool) {
	if _, _, ok := decodeBody(w, r); !ok {
		return
	}
	state, err := s.room.SetWatch(r.Context(), v, r.PathValue("lotID"), watching)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"watching": state})
}

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	out, err := s.room.Dashboard(r.Context(), v)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleBidderInvoice(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	out, err := s.room.Invoice(r.Context(), v, r.PathValue("invoiceID"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleAcceptOffer(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	s.answerOffer(w, r, v, true)
}

func (s *Server) handleDeclineOffer(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	s.answerOffer(w, r, v, false)
}

func (s *Server) answerOffer(w http.ResponseWriter, r *http.Request, v saleroom.Viewer, accept bool) {
	if _, _, ok := decodeBody(w, r); !ok {
		return
	}
	out, err := s.room.AnswerOffer(r.Context(), v, r.PathValue("offerID"), accept)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleConsignLot(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	body, _, ok := decodeBody(w, r)
	if !ok {
		return
	}
	category := stringField(body, "category")
	title := stringField(body, "title")
	description := stringField(body, "description")
	fields := map[string]string{}
	if category != "wristwatch" && category != "camera" {
		fields["category"] = domain.MsgChooseCategory
	}
	if n := len([]rune(title)); n < 1 || n > 120 {
		fields["title"] = domain.MsgTitleLength
	}
	if n := len([]rune(description)); n < 1 || n > 2000 {
		fields["description"] = domain.MsgDescriptionLength
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "invalid", "Check the highlighted fields.", fields)
		return
	}
	out, err := s.room.ConsignLot(r.Context(), v, category, title, description)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleConsignorLots(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	out, err := s.room.ConsignorLots(r.Context(), v)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleConsignorLot(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	out, err := s.room.ConsignorLot(r.Context(), v, r.PathValue("lotID"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSecondChance(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	body, _, ok := decodeBody(w, r)
	if !ok {
		return
	}
	out, err := s.room.SecondChance(r.Context(), v, r.PathValue("lotID"), wholeEuros(body, "amount"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleLeaveUnsold(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	if _, _, ok := decodeBody(w, r); !ok {
		return
	}
	out, err := s.room.LeaveUnsold(r.Context(), v, r.PathValue("lotID"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleConsignorStatements(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	statements, err := s.room.ConsignorStatements(r.Context(), v)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"statements": statements})
}

func (s *Server) handleConsignorStatement(w http.ResponseWriter, r *http.Request, v saleroom.Viewer) {
	out, err := s.room.ConsignorStatement(r.Context(), v, r.PathValue("statementID"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDeskLots(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	state := r.URL.Query().Get("state")
	switch state {
	case domain.LotIntake, domain.LotEstimated, domain.LotPlaced:
	default:
		writeError(w, http.StatusUnprocessableEntity, "invalid", "Check the highlighted fields.",
			map[string]string{"state": "Choose intake, estimated or placed."})
		return
	}
	lots, err := s.room.DeskLots(r.Context(), state)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lots": lots})
}

func (s *Server) handleEstimate(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	body, _, ok := decodeBody(w, r)
	if !ok {
		return
	}
	out, err := s.room.SaveEstimate(r.Context(), r.PathValue("lotID"), saleroom.Estimate{
		EstimateLow:  wholeEuros(body, "estimate_low"),
		EstimateHigh: wholeEuros(body, "estimate_high"),
		OpeningBid:   wholeEuros(body, "opening_bid"),
		Reserve:      wholeEuros(body, "reserve"),
		Condition:    stringField(body, "condition"),
		Portrait:     stringField(body, "portrait"),
	})
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSales(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	sales, err := s.room.Sales(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sales": sales})
}

func (s *Server) handleCreateSale(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	body, _, ok := decodeBody(w, r)
	if !ok {
		return
	}
	title := stringField(body, "title")
	endsAtRaw := stringField(body, "ends_at")
	firstLotNumber := wholeEuros(body, "first_lot_number")
	fields := map[string]string{}
	if n := len([]rune(title)); n < 1 || n > 80 {
		fields["title"] = domain.MsgSaleTitleLength
	}
	endsAt, err := time.Parse(time.RFC3339, endsAtRaw)
	if err != nil {
		fields["ends_at"] = domain.MsgSaleEndsForm
	}
	if firstLotNumber == nil || *firstLotNumber < 1 || *firstLotNumber > 9999 {
		fields["first_lot_number"] = domain.MsgFirstLotNumber
	}
	if len(fields) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "invalid", "Check the highlighted fields.", fields)
		return
	}
	out, err := s.room.CreateSale(r.Context(), title, endsAt, *firstLotNumber)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleOrderSaleLots(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	body, _, ok := decodeBody(w, r)
	if !ok {
		return
	}
	lotIDs := stringsField(body, "lot_ids")
	if lotIDs == nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid", "Check the highlighted fields.",
			map[string]string{"lot_ids": domain.MsgLotIDsRequired})
		return
	}
	out, err := s.room.OrderSaleLots(r.Context(), r.PathValue("saleID"), lotIDs)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handlePublishSale(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	if _, _, ok := decodeBody(w, r); !ok {
		return
	}
	out, err := s.room.PublishSale(r.Context(), r.PathValue("saleID"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDeskInvoices(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	status := r.URL.Query().Get("status")
	switch status {
	case "", domain.InvoiceIssued, domain.InvoicePaid, domain.InvoiceDefaulted:
	default:
		status = ""
	}
	invoices, err := s.room.DeskInvoices(r.Context(), status)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"invoices": invoices})
}

func (s *Server) handleDeskInvoice(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	out, err := s.room.DeskInvoice(r.Context(), r.PathValue("invoiceID"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleRecordPayment(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	body, _, ok := decodeBody(w, r)
	if !ok {
		return
	}
	method := stringField(body, "method")
	switch method {
	case "bank_transfer", "card", "cash":
	default:
		writeError(w, http.StatusUnprocessableEntity, "invalid", "Check the highlighted fields.",
			map[string]string{"method": domain.MsgMethodRequired})
		return
	}
	out, err := s.room.RecordPayment(r.Context(), r.PathValue("invoiceID"),
		stringField(body, "amount"), method)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

func (s *Server) handleRegistrations(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	status := r.URL.Query().Get("status")
	registrations, err := s.room.PendingRegistrations(r.Context(), status)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"registrations": registrations})
}

func (s *Server) handleApprove(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	body, _, ok := decodeBody(w, r)
	if !ok {
		return
	}
	out, err := s.room.ApproveRegistration(r.Context(), r.PathValue("registrationID"),
		wholeEuros(body, "spending_limit"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleAdminLots(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	lots, err := s.room.AdminOpenLots(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lots": lots})
}

func (s *Server) handleAdminLotBids(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	lot, bids, err := s.room.AdminLotBids(r.Context(), r.PathValue("lotID"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lot": lot, "bids": bids})
}

func (s *Server) handleRemoveBid(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	body, _, ok := decodeBody(w, r)
	if !ok {
		return
	}
	reason := stringField(body, "reason")
	if n := len([]rune(reason)); n < 1 || n > 300 {
		writeError(w, http.StatusUnprocessableEntity, "invalid", "Check the highlighted fields.",
			map[string]string{"reason": domain.MsgReasonLength})
		return
	}
	lot, bids, err := s.room.RemoveBid(r.Context(), r.PathValue("bidID"), reason)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lot": lot, "bids": bids})
}

func (s *Server) handleAdminStatements(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	statements, err := s.room.AdminStatements(r.Context(), r.URL.Query().Get("sale_id"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"statements": statements})
}

func (s *Server) handleAdminStatement(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	out, err := s.room.AdminStatement(r.Context(), r.PathValue("statementID"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleIssueStatement(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	if _, _, ok := decodeBody(w, r); !ok {
		return
	}
	out, err := s.room.IssueStatement(r.Context(), r.PathValue("statementID"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleCorrectStatement(w http.ResponseWriter, r *http.Request, _ saleroom.Viewer) {
	body, _, ok := decodeBody(w, r)
	if !ok {
		return
	}
	note := stringField(body, "note")
	if n := len([]rune(note)); n < 1 || n > 300 {
		writeError(w, http.StatusUnprocessableEntity, "invalid", "Check the highlighted fields.",
			map[string]string{"note": domain.MsgNoteLength})
		return
	}
	out, err := s.room.CorrectStatement(r.Context(), r.PathValue("statementID"), note)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}
