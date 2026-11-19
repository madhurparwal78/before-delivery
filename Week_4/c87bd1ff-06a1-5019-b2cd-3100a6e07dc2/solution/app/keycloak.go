package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var appRoles = []string{"bidder", "consignor", "specialist", "cashier", "admin"}

// seedUser is a person the server makes sure exists in Keycloak.
type seedUser struct {
	username, password, first, last, role string
}

var seedUsers = []seedUser{
	{"mila.verhoef", "Harrow-specialist-2026", "Mila", "Verhoef", "specialist"},
	{"joost.bakker", "Harrow-cashier-2026", "Joost", "Bakker", "cashier"},
	{"ines.dekker", "Harrow-admin-2026", "Ines", "Dekker", "admin"},
	{"ruth.okafor", "Harrow-bidder-2026", "Ruth", "Okafor", "bidder"},
	{"tomas.lindqvist", "Harrow-bidder-2026", "Tomas", "Lindqvist", "bidder"},
	{"amaal.haddad", "Harrow-bidder-2026", "Amaal", "Haddad", "bidder"},
	{"pieter.smit", "Harrow-bidder-2026", "Pieter", "Smit", "bidder"},
	{"hendrik.vos", "Harrow-consignor-2026", "Hendrik", "Vos", "consignor"},
	{"saskia.mol", "Harrow-consignor-2026", "Saskia", "Mol", "consignor"},
}

type keycloak struct {
	cfg    config
	client *http.Client

	mu      sync.Mutex
	token   string
	expires time.Time
}

func newKeycloak(cfg config) *keycloak {
	return &keycloak{cfg: cfg, client: &http.Client{Timeout: 8 * time.Second}}
}

// unreachable describes a failed call to Keycloak without its address, query or form values.
func unreachable(op string, err error) error {
	var ue *url.Error
	if errors.As(err, &ue) && ue.Timeout() {
		return fmt.Errorf("%s: Keycloak did not answer in time", op)
	}
	return fmt.Errorf("%s: Keycloak could not be reached", op)
}

func (k *keycloak) realmURL() string { return k.cfg.keycloakURL + "/realms/" + k.cfg.realm }

// available asks Keycloak for its discovery document within two seconds.
func (k *keycloak) available(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, k.realmURL()+"/.well-known/openid-configuration", nil)
	if err != nil {
		return false
	}
	resp, err := k.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return resp.StatusCode == http.StatusOK
}

type tokenClaims struct {
	Subject     string `json:"sub"`
	Username    string `json:"preferred_username"`
	Name        string `json:"name"`
	Nonce       string `json:"nonce"`
	RealmAccess struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
}

type tokenSet struct {
	access, id tokenClaims
}

func decodeClaims(jwt string) (tokenClaims, error) {
	var c tokenClaims
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		return c, fmt.Errorf("token is not a JWT")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return c, fmt.Errorf("decode token payload: %w", err)
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, fmt.Errorf("parse token payload: %w", err)
	}
	return c, nil
}

// exchange trades an authorization code (with its PKCE verifier) for tokens.
func (k *keycloak) exchange(ctx context.Context, code, verifier, redirect string) (tokenSet, error) {
	var ts tokenSet
	form := url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {verifier},
		"redirect_uri": {redirect}, "client_id": {k.cfg.clientID}, "client_secret": {k.cfg.clientSecret},
	}
	resp, err := k.post(ctx, k.realmURL()+"/protocol/openid-connect/token", form)
	if err != nil {
		return ts, fmt.Errorf("exchange code: %w", err)
	}
	var body struct {
		Access string `json:"access_token"`
		ID     string `json:"id_token"`
	}
	if err := json.Unmarshal(resp, &body); err != nil || body.Access == "" {
		return ts, fmt.Errorf("token response has no access token")
	}
	if ts.access, err = decodeClaims(body.Access); err != nil {
		return ts, fmt.Errorf("access token: %w", err)
	}
	if body.ID != "" {
		if ts.id, err = decodeClaims(body.ID); err != nil {
			return ts, fmt.Errorf("id token: %w", err)
		}
	}
	return ts, nil
}

func (k *keycloak) post(ctx context.Context, target string, form url.Values) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, errors.New("build token request: invalid Keycloak address")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := k.client.Do(req)
	if err != nil {
		return nil, unreachable("token request", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint answered %d", resp.StatusCode)
	}
	return data, nil
}

func (k *keycloak) serviceToken(ctx context.Context) (string, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.token != "" && time.Now().Before(k.expires) {
		return k.token, nil
	}
	form := url.Values{"grant_type": {"client_credentials"}, "client_id": {k.cfg.clientID}, "client_secret": {k.cfg.clientSecret}}
	data, err := k.post(ctx, k.realmURL()+"/protocol/openid-connect/token", form)
	if err != nil {
		return "", fmt.Errorf("service token: %w", err)
	}
	var body struct {
		Access  string `json:"access_token"`
		Expires int    `json:"expires_in"`
	}
	if err := json.Unmarshal(data, &body); err != nil || body.Access == "" {
		return "", fmt.Errorf("service token response has no access token")
	}
	k.token = body.Access
	k.expires = time.Now().Add(time.Duration(max(body.Expires-10, 1)) * time.Second)
	return k.token, nil
}

// admin calls the Keycloak admin API as the client's service account.
func (k *keycloak) admin(ctx context.Context, method, path string, in, out any) (int, http.Header, error) {
	token, err := k.serviceToken(ctx)
	if err != nil {
		return 0, nil, fmt.Errorf("admin request: %w", err)
	}
	var rd io.Reader
	if in != nil {
		raw, err := json.Marshal(in)
		if err != nil {
			return 0, nil, fmt.Errorf("encode admin request: %w", err)
		}
		rd = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, k.cfg.keycloakURL+"/admin/realms/"+k.cfg.realm+path, rd)
	if err != nil {
		return 0, nil, errors.New("build admin request: invalid Keycloak address")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := k.client.Do(req)
	if err != nil {
		return 0, nil, unreachable("admin request", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if out != nil && resp.StatusCode == http.StatusOK {
		if err := json.Unmarshal(data, out); err != nil {
			return resp.StatusCode, resp.Header, fmt.Errorf("parse admin response: %w", err)
		}
	}
	return resp.StatusCode, resp.Header, nil
}

type roleRep struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (k *keycloak) role(ctx context.Context, name string) (roleRep, error) {
	var r roleRep
	status, _, err := k.admin(ctx, http.MethodGet, "/roles/"+url.PathEscape(name), nil, &r)
	if err != nil {
		return r, fmt.Errorf("read role %s: %w", name, err)
	}
	if status != http.StatusOK {
		return r, fmt.Errorf("role %s answered %d", name, status)
	}
	return r, nil
}

func (k *keycloak) ensureRoles(ctx context.Context) error {
	for _, name := range appRoles {
		status, _, err := k.admin(ctx, http.MethodGet, "/roles/"+url.PathEscape(name), nil, nil)
		if err != nil {
			return fmt.Errorf("find role %s: %w", name, err)
		}
		if status == http.StatusNotFound {
			status, _, err = k.admin(ctx, http.MethodPost, "/roles", map[string]string{"name": name}, nil)
			if err != nil {
				return fmt.Errorf("create role %s: %w", name, err)
			}
			if status != http.StatusCreated && status != http.StatusConflict {
				return fmt.Errorf("create role %s answered %d", name, status)
			}
		}
	}
	return nil
}

// addRealmRole puts a realm role on a Keycloak user.
func (k *keycloak) addRealmRole(ctx context.Context, userID, role string) error {
	rep, err := k.role(ctx, role)
	if err != nil {
		return fmt.Errorf("add realm role: %w", err)
	}
	status, _, err := k.admin(ctx, http.MethodPost, "/users/"+url.PathEscape(userID)+"/role-mappings/realm", []roleRep{rep}, nil)
	if err != nil {
		return fmt.Errorf("map realm role %s: %w", role, err)
	}
	if status != http.StatusNoContent && status != http.StatusOK {
		return fmt.Errorf("role mapping answered %d", status)
	}
	return nil
}

func (k *keycloak) userID(ctx context.Context, username string) (string, error) {
	var users []struct {
		ID string `json:"id"`
	}
	status, _, err := k.admin(ctx, http.MethodGet, "/users?exact=true&username="+url.QueryEscape(username), nil, &users)
	if err != nil {
		return "", fmt.Errorf("look up user %s: %w", username, err)
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("user lookup answered %d", status)
	}
	if len(users) == 0 {
		return "", nil
	}
	return users[0].ID, nil
}

// ensureSeedUsers creates the seed people who are missing, with their role; existing users are left alone.
func (k *keycloak) ensureSeedUsers(ctx context.Context) error {
	for _, u := range seedUsers {
		id, err := k.userID(ctx, u.username)
		if err != nil {
			return fmt.Errorf("seed user: %w", err)
		}
		if id != "" {
			continue
		}
		body := map[string]any{
			"username": u.username, "email": u.username + "@example.test", "emailVerified": true, "enabled": true,
			"firstName": u.first, "lastName": u.last,
			"credentials": []map[string]any{{"type": "password", "value": u.password, "temporary": false}},
		}
		status, header, err := k.admin(ctx, http.MethodPost, "/users", body, nil)
		if err != nil {
			return fmt.Errorf("create user %s: %w", u.username, err)
		}
		if status == http.StatusConflict {
			continue
		}
		if status != http.StatusCreated {
			return fmt.Errorf("create user %s answered %d", u.username, status)
		}
		id = header.Get("Location")[strings.LastIndex(header.Get("Location"), "/")+1:]
		if err := k.addRealmRole(ctx, id, u.role); err != nil {
			return fmt.Errorf("seed user %s: %w", u.username, err)
		}
	}
	return nil
}

// ensureLoginLanguage turns on the realm's English locale, so Keycloak's sign-in and account pages carry lang="en".
// One supported locale means the pages show no language menu.
func (k *keycloak) ensureLoginLanguage(ctx context.Context) error {
	rep := map[string]any{"internationalizationEnabled": true, "supportedLocales": []string{"en"}, "defaultLocale": "en"}
	status, _, err := k.admin(ctx, http.MethodPut, "", rep, nil)
	if err != nil {
		return fmt.Errorf("set login language: %w", err)
	}
	if status != http.StatusNoContent && status != http.StatusOK {
		return fmt.Errorf("set login language answered %d", status)
	}
	return nil
}

// setup makes the realm roles, the seed users and the login language exist, retrying every ten seconds until it has.
func (k *keycloak) setup(ctx context.Context) {
	for {
		err := k.ensureRoles(ctx)
		if err == nil {
			err = k.ensureSeedUsers(ctx)
		}
		if err == nil {
			err = k.ensureLoginLanguage(ctx)
		}
		if err == nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
		}
	}
}
