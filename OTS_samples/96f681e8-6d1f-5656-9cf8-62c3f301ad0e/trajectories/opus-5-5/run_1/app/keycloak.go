package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var appRoles = []string{"player", "desk", "coach", "manager"}

type keycloak struct {
	cfg    *config
	client *http.Client
}

func newKeycloak(cfg *config) *keycloak {
	return &keycloak{cfg: cfg, client: &http.Client{Timeout: 10 * time.Second}}
}

func (k *keycloak) realmURL() string {
	return k.cfg.KeycloakURL + "/realms/" + url.PathEscape(k.cfg.KeycloakRealm)
}

func (k *keycloak) adminURL() string {
	return k.cfg.KeycloakURL + "/admin/realms/" + url.PathEscape(k.cfg.KeycloakRealm)
}

func (k *keycloak) redirectURI() string { return k.cfg.PublicURL + "/auth/callback" }

type tokenSet struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	ExpiresIn    int    `json:"expires_in"`
}

var errTokenRejected = errors.New("keycloak rejected the token request")

func (k *keycloak) tokenRequest(ctx context.Context, form url.Values) (tokenSet, error) {
	var ts tokenSet
	form.Set("client_id", k.cfg.ClientID)
	form.Set("client_secret", k.cfg.ClientSecret)
	status, body, err := k.postForm(ctx, k.realmURL()+"/protocol/openid-connect/token", form)
	if err != nil {
		return ts, err
	}
	if status != http.StatusOK {
		return ts, fmt.Errorf("%w: status %d", errTokenRejected, status)
	}
	if err := json.Unmarshal(body, &ts); err != nil {
		return ts, fmt.Errorf("decode token answer: %w", err)
	}
	return ts, nil
}

func (k *keycloak) postForm(ctx context.Context, u string, form url.Values) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(form.Encode()))
	if err != nil {
		return 0, nil, fmt.Errorf("build keycloak request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := k.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("call keycloak: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, nil, fmt.Errorf("read keycloak answer: %w", err)
	}
	return resp.StatusCode, body, nil
}

func (k *keycloak) authCodeURL(state, challenge string) string {
	q := url.Values{
		"client_id":             {k.cfg.ClientID},
		"response_type":         {"code"},
		"scope":                 {"openid profile email"},
		"redirect_uri":          {k.redirectURI()},
		"state":                 {state},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}
	return k.cfg.IssuerURL + "/protocol/openid-connect/auth?" + q.Encode()
}

func (k *keycloak) exchangeCode(ctx context.Context, code, verifier string) (tokenSet, error) {
	return k.tokenRequest(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {k.redirectURI()},
		"code_verifier": {verifier},
	})
}

func (k *keycloak) refresh(ctx context.Context, refreshToken string) (tokenSet, error) {
	return k.tokenRequest(ctx, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refreshToken}})
}

func (k *keycloak) logout(ctx context.Context, refreshToken string) error {
	status, _, err := k.postForm(ctx, k.realmURL()+"/protocol/openid-connect/logout", url.Values{
		"client_id": {k.cfg.ClientID}, "client_secret": {k.cfg.ClientSecret}, "refresh_token": {refreshToken},
	})
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("keycloak logout answered %d", status)
	}
	return nil
}

type introspection struct {
	Active            bool   `json:"active"`
	Issuer            string `json:"iss"`
	AuthorizedParty   string `json:"azp"`
	PreferredUsername string `json:"preferred_username"`
	Name              string `json:"name"`
	Email             string `json:"email"`
	RealmAccess       struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
}

// verify asks Keycloak whether an access token is live and returns the identity it carries.
func (k *keycloak) verify(ctx context.Context, accessToken string) (*identity, error) {
	status, body, err := k.postForm(ctx, k.realmURL()+"/protocol/openid-connect/token/introspect", url.Values{
		"client_id": {k.cfg.ClientID}, "client_secret": {k.cfg.ClientSecret}, "token": {accessToken},
	})
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("introspection answered %d", status)
	}
	var in introspection
	if err := json.Unmarshal(body, &in); err != nil {
		return nil, fmt.Errorf("decode introspection: %w", err)
	}
	if !in.Active || in.Issuer != k.cfg.IssuerURL || in.AuthorizedParty != k.cfg.ClientID || in.PreferredUsername == "" {
		return nil, nil
	}
	id := &identity{Username: in.PreferredUsername, Name: in.Name, Email: in.Email}
	if id.Name == "" {
		id.Name = id.Username
	}
	for _, r := range in.RealmAccess.Roles {
		for _, known := range appRoles {
			if r == known {
				id.Roles = append(id.Roles, r)
			}
		}
	}
	return id, nil
}

// adminCall makes one admin REST call with the client's service account.
func (k *keycloak) adminCall(ctx context.Context, token, method, path string, in any) (int, []byte, error) {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return 0, nil, fmt.Errorf("encode admin body: %w", err)
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, k.adminURL()+path, body)
	if err != nil {
		return 0, nil, fmt.Errorf("build admin request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := k.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("keycloak admin %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, nil, fmt.Errorf("read admin answer: %w", err)
	}
	return resp.StatusCode, out, nil
}

type kcRole struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// bootstrap makes sure the four realm roles and the seeded users exist. A
// seeded user's password and roles are set only when that user is missing.
func (k *keycloak) bootstrap(ctx context.Context, db *pgxpool.Pool) error {
	ts, err := k.tokenRequest(ctx, url.Values{"grant_type": {"client_credentials"}})
	if err != nil {
		return fmt.Errorf("service account token: %w", err)
	}
	tok := ts.AccessToken
	roles := map[string]kcRole{}
	for _, name := range appRoles {
		role, err := k.ensureRole(ctx, tok, name)
		if err != nil {
			return err
		}
		roles[name] = role
	}
	for _, p := range seedPeople {
		if err := k.ensureUser(ctx, tok, p, roles[p.Role]); err != nil {
			return err
		}
	}
	return nil
}

func (k *keycloak) ensureRole(ctx context.Context, tok, name string) (kcRole, error) {
	var role kcRole
	status, body, err := k.adminCall(ctx, tok, http.MethodGet, "/roles/"+url.PathEscape(name), nil)
	if err != nil {
		return role, err
	}
	if status == http.StatusNotFound {
		status, _, err = k.adminCall(ctx, tok, http.MethodPost, "/roles", map[string]string{"name": name})
		if err != nil {
			return role, err
		}
		if status != http.StatusCreated && status != http.StatusConflict {
			return role, fmt.Errorf("create role %s answered %d", name, status)
		}
		if status, body, err = k.adminCall(ctx, tok, http.MethodGet, "/roles/"+url.PathEscape(name), nil); err != nil {
			return role, err
		}
	}
	if status != http.StatusOK {
		return role, fmt.Errorf("read role %s answered %d", name, status)
	}
	if err := json.Unmarshal(body, &role); err != nil {
		return role, fmt.Errorf("decode role: %w", err)
	}
	return role, nil
}

func (k *keycloak) findUser(ctx context.Context, tok, username string) (string, error) {
	status, body, err := k.adminCall(ctx, tok, http.MethodGet, "/users?exact=true&username="+url.QueryEscape(username), nil)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("find user %s answered %d", username, status)
	}
	var users []struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	}
	if err := json.Unmarshal(body, &users); err != nil {
		return "", fmt.Errorf("decode users: %w", err)
	}
	for _, u := range users {
		if u.Username == username {
			return u.ID, nil
		}
	}
	return "", nil
}

func (k *keycloak) ensureUser(ctx context.Context, tok string, p seedPerson, role kcRole) error {
	id, err := k.findUser(ctx, tok, p.Username)
	if err != nil || id != "" {
		return err
	}
	first, last, _ := strings.Cut(p.Name, " ")
	status, _, err := k.adminCall(ctx, tok, http.MethodPost, "/users", map[string]any{
		"username": p.Username, "email": p.Email, "firstName": first, "lastName": last,
		"enabled": true, "emailVerified": true, "requiredActions": []string{},
		"credentials": []map[string]any{{"type": "password", "value": seedPassword, "temporary": false}},
	})
	if err != nil {
		return err
	}
	if status != http.StatusCreated {
		return fmt.Errorf("create user %s answered %d", p.Username, status)
	}
	if id, err = k.findUser(ctx, tok, p.Username); err != nil {
		return err
	}
	status, _, err = k.adminCall(ctx, tok, http.MethodPost, "/users/"+id+"/role-mappings/realm", []kcRole{role})
	if err != nil {
		return err
	}
	if status != http.StatusNoContent {
		return fmt.Errorf("assign role to %s answered %d", p.Username, status)
	}
	return nil
}
