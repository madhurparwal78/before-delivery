package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	rolePlayer  = "player"
	roleDesk    = "desk"
	roleCoach   = "coach"
	roleManager = "manager"
)

// errGrantRefused means Keycloak refused the grant itself, as it does for a session that has ended.
var errGrantRefused = errors.New("token grant refused")

var realmRoles = []string{rolePlayer, roleDesk, roleCoach, roleManager}

// Keycloak is the sign-in service client: the browser code flow, token checks and realm provisioning.
type Keycloak struct {
	base, realm, issuer, clientID, secret string
	client                                *http.Client
}

func newKeycloak(cfg Config) *Keycloak {
	return &Keycloak{base: cfg.KeycloakURL, realm: cfg.KeycloakRealm, issuer: cfg.AuthIssuerURL,
		clientID: cfg.AuthClientID, secret: cfg.AuthClientSecret, client: &http.Client{Timeout: 10 * time.Second}}
}

// origin is the sign-in server's address as the browser reaches it (the issuer's scheme and host).
func (k *Keycloak) origin() string {
	issuer, err := url.Parse(k.issuer)
	if err != nil {
		return ""
	}
	return issuer.Scheme + "://" + issuer.Host
}

// tokenSet is what the token endpoint hands back.
type tokenSet struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// tokenClaims is the verified content of an active token.
type tokenClaims struct {
	Username string
	Name     string
	Email    string
	Roles    map[string]bool
}

func (k *Keycloak) tokenURL() string {
	return k.base + "/realms/" + url.PathEscape(k.realm) + "/protocol/openid-connect/token"
}

func (k *Keycloak) authorizeURL(state, redirectURI string) string {
	query := url.Values{"client_id": {k.clientID}, "redirect_uri": {redirectURI}, "response_type": {"code"},
		"scope": {"openid"}, "state": {state}}
	return k.issuer + "/protocol/openid-connect/auth?" + query.Encode()
}

func (k *Keycloak) form(ctx context.Context, endpoint string, values url.Values) (int, []byte, error) {
	values.Set("client_id", k.clientID)
	values.Set("client_secret", k.secret)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return 0, nil, fmt.Errorf("build Keycloak request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return k.send(req)
}

func (k *Keycloak) send(req *http.Request) (int, []byte, error) {
	resp, err := k.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("call Keycloak %s: %w", req.URL.Path, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return 0, nil, fmt.Errorf("read Keycloak answer: %w", err)
	}
	return resp.StatusCode, body, nil
}

func (k *Keycloak) exchangeCode(ctx context.Context, code, redirectURI string) (tokenSet, error) {
	return k.grant(ctx, url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {redirectURI}})
}

// refresh trades a refresh token for new tokens; it fails once the Keycloak session has ended.
func (k *Keycloak) refresh(ctx context.Context, refreshToken string) (tokenSet, error) {
	return k.grant(ctx, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refreshToken}})
}

func (k *Keycloak) grant(ctx context.Context, values url.Values) (tokenSet, error) {
	status, body, err := k.form(ctx, k.tokenURL(), values)
	if err != nil {
		return tokenSet{}, err
	}
	var tokens tokenSet
	if status >= 400 && status < 500 {
		return tokenSet{}, fmt.Errorf("%w (status %d)", errGrantRefused, status)
	}
	if status != http.StatusOK || json.Unmarshal(body, &tokens) != nil || tokens.AccessToken == "" {
		return tokenSet{}, fmt.Errorf("token grant answered %d", status)
	}
	return tokens, nil
}

// introspect asks Keycloak whether a token is live; it returns nil when the token or its session has ended.
func (k *Keycloak) introspect(ctx context.Context, token string) (*tokenClaims, error) {
	status, body, err := k.form(ctx, k.tokenURL()+"/introspect", url.Values{"token": {token}})
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("introspection answered %d", status)
	}
	var parsed struct {
		Active      bool   `json:"active"`
		Username    string `json:"preferred_username"`
		Name        string `json:"name"`
		Email       string `json:"email"`
		RealmAccess struct {
			Roles []string `json:"roles"`
		} `json:"realm_access"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("read introspection: %w", err)
	}
	if !parsed.Active || parsed.Username == "" {
		return nil, nil
	}
	claims := &tokenClaims{Username: parsed.Username, Name: parsed.Name, Email: parsed.Email, Roles: map[string]bool{}}
	for _, role := range parsed.RealmAccess.Roles {
		claims.Roles[role] = true
	}
	return claims, nil
}

// endSession ends the Keycloak session behind a refresh token.
func (k *Keycloak) endSession(ctx context.Context, refreshToken string) error {
	status, _, err := k.form(ctx, strings.Replace(k.tokenURL(), "/token", "/logout", 1), url.Values{"refresh_token": {refreshToken}})
	if err != nil {
		return err
	}
	if status != http.StatusNoContent && status != http.StatusOK {
		return fmt.Errorf("logout answered %d", status)
	}
	return nil
}

// ---- provisioning through the client's service account ----

func (k *Keycloak) admin(ctx context.Context, token, method, path string, body any) (int, []byte, http.Header, error) {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return 0, nil, nil, fmt.Errorf("encode admin request: %w", err)
		}
		reader = strings.NewReader(string(payload))
	}
	req, err := http.NewRequestWithContext(ctx, method, k.base+"/admin/realms/"+url.PathEscape(k.realm)+path, reader)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("build admin request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := k.client.Do(req)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("call Keycloak admin %s: %w", path, err)
	}
	defer resp.Body.Close()
	answer, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return 0, nil, nil, fmt.Errorf("read admin answer: %w", err)
	}
	return resp.StatusCode, answer, resp.Header, nil
}

type realmRole struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ensureRealm makes sure the four realm roles and the seeded users exist. A seeded user's password and
// roles are set only when that user is missing.
func (k *Keycloak) ensureRealm(ctx context.Context, users []seedPerson, password string) error {
	tokens, err := k.grant(ctx, url.Values{"grant_type": {"client_credentials"}})
	if err != nil {
		return fmt.Errorf("service account sign-in: %w", err)
	}
	roles := map[string]realmRole{}
	for _, name := range realmRoles {
		role, err := k.ensureRole(ctx, tokens.AccessToken, name)
		if err != nil {
			return err
		}
		roles[name] = role
	}
	for _, person := range users {
		if err := k.ensureUser(ctx, tokens.AccessToken, person, password, roles); err != nil {
			return err
		}
	}
	return nil
}

func (k *Keycloak) ensureRole(ctx context.Context, token, name string) (realmRole, error) {
	for attempt := 0; attempt < 2; attempt++ {
		status, body, _, err := k.admin(ctx, token, http.MethodGet, "/roles/"+url.PathEscape(name), nil)
		if err != nil {
			return realmRole{}, err
		}
		if status == http.StatusOK {
			var role realmRole
			if err := json.Unmarshal(body, &role); err != nil {
				return realmRole{}, fmt.Errorf("read role %s: %w", name, err)
			}
			return role, nil
		}
		if status != http.StatusNotFound {
			return realmRole{}, fmt.Errorf("read role %s answered %d", name, status)
		}
		created, _, _, err := k.admin(ctx, token, http.MethodPost, "/roles", map[string]string{"name": name})
		if err != nil {
			return realmRole{}, err
		}
		if created != http.StatusCreated && created != http.StatusConflict {
			return realmRole{}, fmt.Errorf("create role %s answered %d", name, created)
		}
	}
	return realmRole{}, errors.New("role " + name + " could not be created")
}

func (k *Keycloak) ensureUser(ctx context.Context, token string, person seedPerson, password string, roles map[string]realmRole) error {
	status, body, _, err := k.admin(ctx, token, http.MethodGet, "/users?exact=true&username="+url.QueryEscape(person.Username), nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("look up user %s answered %d", person.Username, status)
	}
	var found []json.RawMessage
	if err := json.Unmarshal(body, &found); err != nil {
		return fmt.Errorf("read user %s: %w", person.Username, err)
	}
	if len(found) > 0 {
		return nil
	}
	first, last, _ := strings.Cut(person.Name, " ")
	created, _, header, err := k.admin(ctx, token, http.MethodPost, "/users", map[string]any{
		"username": person.Username, "email": person.Email, "firstName": first, "lastName": last,
		"enabled": true, "emailVerified": true,
		"credentials": []map[string]any{{"type": "password", "value": password, "temporary": false}}})
	if err != nil {
		return err
	}
	if created == http.StatusConflict {
		return nil
	}
	if created != http.StatusCreated {
		return fmt.Errorf("create user %s answered %d", person.Username, created)
	}
	id := header.Get("Location")[strings.LastIndex(header.Get("Location"), "/")+1:]
	mapped, _, _, err := k.admin(ctx, token, http.MethodPost, "/users/"+id+"/role-mappings/realm", []realmRole{roles[person.Role]})
	if err != nil {
		return err
	}
	if mapped != http.StatusNoContent {
		return fmt.Errorf("map role for %s answered %d", person.Username, mapped)
	}
	return nil
}
