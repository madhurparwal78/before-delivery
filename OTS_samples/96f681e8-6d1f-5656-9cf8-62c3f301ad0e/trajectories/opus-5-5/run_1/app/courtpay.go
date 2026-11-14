package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"
)

// courtpay talks to the Courtpay payment provider.
type courtpay struct {
	base   string
	client *http.Client
}

func newCourtpay(base string) *courtpay {
	return &courtpay{base: base, client: &http.Client{Timeout: 8 * time.Second}}
}

type payOutcome int

const (
	payAccepted payOutcome = iota
	payDeclined
	payUnconfirmed
	payOutage
)

type payResult struct {
	Outcome payOutcome
	ID      string
}

// asError turns a provider outcome other than acceptance into the published answer.
func (p payResult) asError(holdRoute bool) *apiError {
	switch p.Outcome {
	case payDeclined:
		return fail("PAYMENT_DECLINED")
	case payUnconfirmed:
		return fail("PAYMENT_NOT_CONFIRMED")
	case payOutage:
		e := fail("PAYMENT_UNAVAILABLE")
		if holdRoute {
			e.Message = holdUnavailableMessage
		}
		return e
	}
	return nil
}

func (p *courtpay) post(ctx context.Context, path string, body any, accepted string) payResult {
	b, err := json.Marshal(body)
	if err != nil {
		log.Printf("courtpay encode: %v", err)
		return payResult{Outcome: payOutage}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.base+path, bytes.NewReader(b))
	if err != nil {
		log.Printf("courtpay request: %v", err)
		return payResult{Outcome: payOutage}
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		log.Printf("courtpay %s: %v", path, err)
		return payResult{Outcome: payOutage}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return payResult{Outcome: payOutage}
	}
	var answer struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	_ = json.Unmarshal(raw, &answer)
	switch {
	case resp.StatusCode == http.StatusPaymentRequired:
		return payResult{Outcome: payDeclined}
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		return payResult{Outcome: payOutage}
	case accepted == "" || answer.Status == accepted:
		return payResult{Outcome: payAccepted, ID: answer.ID}
	case answer.Status == "declined":
		return payResult{Outcome: payDeclined}
	}
	return payResult{Outcome: payUnconfirmed}
}

func (p *courtpay) authorize(ctx context.Context, amount int, reference, payer string) payResult {
	return p.post(ctx, "/v1/authorizations", map[string]any{
		"amount_cents": amount, "currency": "EUR", "reference": reference, "payer": payer,
	}, "authorized")
}

func (p *courtpay) capture(ctx context.Context, authorizationID string, amount int, reference string, final bool) payResult {
	return p.post(ctx, "/v1/captures", map[string]any{
		"authorization_id": authorizationID, "amount_cents": amount, "reference": reference, "final_capture": final,
	}, "captured")
}

func (p *courtpay) charge(ctx context.Context, amount int, reference, payer string) payResult {
	return p.post(ctx, "/v1/charges", map[string]any{
		"amount_cents": amount, "currency": "EUR", "reference": reference, "payer": payer,
	}, "captured")
}

// void reports whether the provider accepted the void with any 2xx answer.
func (p *courtpay) void(ctx context.Context, authorizationID string) bool {
	return p.post(ctx, "/v1/authorizations/"+authorizationID+"/void", map[string]any{}, "").Outcome == payAccepted
}
