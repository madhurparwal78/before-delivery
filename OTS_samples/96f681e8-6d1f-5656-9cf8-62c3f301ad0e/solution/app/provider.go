package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const providerTimeout = 8 * time.Second

// providerOutcome is how Courtpay's answer reads.
type providerOutcome int

const (
	providerAccepted providerOutcome = iota
	providerDeclined
	providerUnconfirmed
	providerUnavailable
)

// providerAnswer is a parsed Courtpay answer; ID is its authorisation, capture or charge id when accepted.
type providerAnswer struct {
	outcome providerOutcome
	id      string
}

// Courtpay is the card-payment provider client.
type Courtpay struct {
	base   string
	client *http.Client
}

func newCourtpay(base string) *Courtpay {
	return &Courtpay{base: base, client: &http.Client{Timeout: providerTimeout}}
}

func (p *Courtpay) post(ctx context.Context, path string, body any) (int, []byte, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return 0, nil, fmt.Errorf("encode provider request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.base+path, bytes.NewReader(payload))
	if err != nil {
		return 0, nil, fmt.Errorf("build provider request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("call provider %s: %w", path, err)
	}
	defer resp.Body.Close()
	answer, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, nil, fmt.Errorf("read provider answer: %w", err)
	}
	return resp.StatusCode, answer, nil
}

// readAnswer is the one place a provider answer is read: a 2xx carrying the wanted status is acceptance,
// a 402 or a declined status is a decline, any other 2xx status is unconfirmed, and everything else is an outage.
func readAnswer(status int, body []byte, wanted string) providerAnswer {
	if status == http.StatusPaymentRequired {
		return providerAnswer{outcome: providerDeclined}
	}
	if status < 200 || status > 299 {
		return providerAnswer{outcome: providerUnavailable}
	}
	var parsed struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return providerAnswer{outcome: providerUnconfirmed}
	}
	switch {
	case parsed.Status == wanted && parsed.ID != "":
		return providerAnswer{outcome: providerAccepted, id: parsed.ID}
	case parsed.Status == "declined":
		return providerAnswer{outcome: providerDeclined}
	default:
		return providerAnswer{outcome: providerUnconfirmed}
	}
}

func (p *Courtpay) ask(ctx context.Context, path string, body any, wanted string) providerAnswer {
	status, answer, err := p.post(ctx, path, body)
	if err != nil {
		return providerAnswer{outcome: providerUnavailable}
	}
	return readAnswer(status, answer, wanted)
}

func (p *Courtpay) authorize(ctx context.Context, amountCents int, reference, payerEmail string) providerAnswer {
	return p.ask(ctx, "/v1/authorizations", map[string]any{
		"amount_cents": amountCents, "currency": "EUR", "reference": reference, "payer": payerEmail}, "authorized")
}

// capture takes an amount from an authorisation. A final capture closes the authorisation and releases the rest;
// a capture that is not final keeps the rest authorised for later captures.
func (p *Courtpay) capture(ctx context.Context, authorizationID string, amountCents int, reference string, final bool) providerAnswer {
	return p.ask(ctx, "/v1/captures", map[string]any{
		"authorization_id": authorizationID, "amount_cents": amountCents, "reference": reference, "final_capture": final}, "captured")
}

func (p *Courtpay) charge(ctx context.Context, amountCents int, reference, payerEmail string) providerAnswer {
	return p.ask(ctx, "/v1/charges", map[string]any{
		"amount_cents": amountCents, "currency": "EUR", "reference": reference, "payer": payerEmail}, "captured")
}

// void reports whether Courtpay accepted the void with a 2xx.
func (p *Courtpay) void(ctx context.Context, authorizationID string) bool {
	status, _, err := p.post(ctx, "/v1/authorizations/"+authorizationID+"/void", map[string]any{})
	return err == nil && status >= 200 && status <= 299
}

// paymentFailure turns a provider answer that is not an acceptance into the catalogue error.
func paymentFailure(answer providerAnswer, forHold bool) *apiError {
	switch answer.outcome {
	case providerDeclined:
		return fail(codePaymentDeclined)
	case providerUnconfirmed:
		return fail(codeNotConfirmed)
	default:
		if forHold {
			return failHoldUnavailable()
		}
		return fail(codePaymentUnavail)
	}
}
