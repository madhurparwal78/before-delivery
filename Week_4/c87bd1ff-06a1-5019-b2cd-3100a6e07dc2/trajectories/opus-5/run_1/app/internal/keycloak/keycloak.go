// Package keycloak talks to the realm that signs people in: the
// authorization-code flow for the browser, and the client's own service
// account for the realm roles and the seed users.
package keycloak

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
	"time"

	"gavelhouse/internal/config"
)

// Client reaches the realm over plain HTTP, as the saleroom has no TLS
// libraries available.
type Client struct {
	cfg  *config.Config
	http *http.Client
}

// New builds the realm client.
func New(cfg *config.Config) *Client {
	return &Client{cfg: cfg, http: &http.Client{Timeout: 10 * time.Second}}
}

// ErrUnreachable marks a realm that did not answer.
var ErrUnreachable = errors.New("keycloak is unreachable")

func (c *Client) realmBase() string {
	return strings.TrimSuffix(c.cfg.KeycloakURL, "/") + "/realms/" + url.PathEscape(c.cfg.KeycloakRealm)
}

func (c *Client) adminBase() string {
	return strings.TrimSuffix(c.cfg.KeycloakURL, "/") + "/admin/realms/" + url.PathEscape(c.cfg.KeycloakRealm)
}

// AuthorizeURL is the realm's authorization endpoint, built from the issuer.
func (c *Client) AuthorizeURL() string {
	return strings.TrimSuffix(c.cfg.AuthIssuerURL, "/") + "/protocol/openid-connect/auth"
}

func (c *Client) tokenURL() string {
	return strings.TrimSuffix(c.cfg.AuthIssuerURL, "/") + "/protocol/openid-connect/token"
}

// Reachable probes the realm within the given budget, so the sign-in page can
// answer 503 at once during an outage.
func (c *Client) Reachable(ctx context.Context, budget time.Duration) bool {
	probeCtx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, c.realmBase(), nil)
	if err != nil {
		return false
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode == http.StatusOK
}

// Identity is the person the realm signed in.
type Identity struct {
	Subject  string
	Username string
	FullName string
	Email    string
	Roles    []string
	Nonce    string
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	IDToken     string `json:"id_token"`
}

type claims struct {
	Subject           string `json:"sub"`
	PreferredUsername string `json:"preferred_username"`
	Name              string `json:"name"`
	Email             string `json:"email"`
	Nonce             string `json:"nonce"`
	RealmAccess       struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
}

// Exchange trades the authorization code for tokens, using the PKCE verifier
// and the client secret, and reads the person out of them.
func (c *Client) Exchange(ctx context.Context, code, verifier, redirectURI string) (Identity, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"client_id":     {c.cfg.AuthClientID},
		"client_secret": {c.cfg.AuthClientSecret},
		"code_verifier": {verifier},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL(),
		strings.NewReader(form.Encode()))
	if err != nil {
		return Identity{}, fmt.Errorf("build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return Identity{}, fmt.Errorf("exchange authorization code: %w", ErrUnreachable)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Identity{}, fmt.Errorf("read token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return Identity{}, fmt.Errorf("token endpoint answered %d", resp.StatusCode)
	}
	var tokens tokenResponse
	if err := json.Unmarshal(body, &tokens); err != nil {
		return Identity{}, fmt.Errorf("decode token response: %w", err)
	}
	idClaims, err := decodeClaims(tokens.IDToken)
	if err != nil {
		return Identity{}, err
	}
	accessClaims, err := decodeClaims(tokens.AccessToken)
	if err != nil {
		return Identity{}, err
	}
	id := Identity{
		Subject:  idClaims.Subject,
		Username: firstNonEmpty(idClaims.PreferredUsername, accessClaims.PreferredUsername),
		FullName: firstNonEmpty(idClaims.Name, accessClaims.Name),
		Email:    firstNonEmpty(idClaims.Email, accessClaims.Email),
		Roles:    accessClaims.RealmAccess.Roles,
		Nonce:    idClaims.Nonce,
	}
	if id.Subject == "" {
		return Identity{}, fmt.Errorf("token carried no subject")
	}
	return id, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// decodeClaims reads a token's payload. The tokens arrive straight from the
// token endpoint over the back channel, so the payload is read as given.
func decodeClaims(token string) (claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return claims{}, fmt.Errorf("token is not in three parts")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return claims{}, fmt.Errorf("decode token payload: %w", err)
	}
	var c claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return claims{}, fmt.Errorf("decode token claims: %w", err)
	}
	return c, nil
}

// serviceToken takes an access token for the client's own service account.
func (c *Client) serviceToken(ctx context.Context) (string, error) {
	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {c.cfg.AuthClientID},
		"client_secret": {c.cfg.AuthClientSecret},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.realmBase()+"/protocol/openid-connect/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("build service token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("take service account token: %w", ErrUnreachable)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("read service token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("service token endpoint answered %d", resp.StatusCode)
	}
	var tokens tokenResponse
	if err := json.Unmarshal(body, &tokens); err != nil {
		return "", fmt.Errorf("decode service token response: %w", err)
	}
	return tokens.AccessToken, nil
}

func (c *Client) admin(ctx context.Context, token, method, path string, body any, out any) (int, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, fmt.Errorf("encode admin request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.adminBase()+path, reader)
	if err != nil {
		return 0, fmt.Errorf("build admin request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, fmt.Errorf("call realm admin %s: %w", path, ErrUnreachable)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return resp.StatusCode, fmt.Errorf("read admin response: %w", err)
	}
	if out != nil && resp.StatusCode < 300 && len(raw) > 0 {
		if err := json.Unmarshal(raw, out); err != nil {
			return resp.StatusCode, fmt.Errorf("decode admin response: %w", err)
		}
	}
	return resp.StatusCode, nil
}

// SeedUser is a person the saleroom makes sure exists in the realm.
type SeedUser struct {
	Username string
	Password string
	Role     string
	FullName string
	Email    string
}

// RealmRoles are the five roles the saleroom's desks depend on.
var RealmRoles = []string{"bidder", "consignor", "specialist", "cashier", "admin"}

// EnsureRealm makes sure the realm roles exist and creates any missing seed
// users with their roles and passwords. Seed users that already exist are
// left as they are.
func (c *Client) EnsureRealm(ctx context.Context, users []SeedUser) error {
	token, err := c.serviceToken(ctx)
	if err != nil {
		return err
	}
	for _, role := range RealmRoles {
		status, err := c.admin(ctx, token, http.MethodPost, "/roles", map[string]string{"name": role}, nil)
		if err != nil {
			return err
		}
		if status != http.StatusCreated && status != http.StatusConflict {
			return fmt.Errorf("create realm role %s: realm answered %d", role, status)
		}
	}
	for _, u := range users {
		if err := c.ensureUser(ctx, token, u); err != nil {
			return err
		}
	}
	return nil
}

type realmUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

func (c *Client) findUser(ctx context.Context, token, username string) (string, error) {
	var found []realmUser
	status, err := c.admin(ctx, token, http.MethodGet,
		"/users?exact=true&username="+url.QueryEscape(username), nil, &found)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("look up user %s: realm answered %d", username, status)
	}
	for _, u := range found {
		if u.Username == username {
			return u.ID, nil
		}
	}
	return "", nil
}

func (c *Client) ensureUser(ctx context.Context, token string, u SeedUser) error {
	id, err := c.findUser(ctx, token, u.Username)
	if err != nil {
		return err
	}
	if id != "" {
		return nil
	}
	first, last := splitName(u.FullName)
	status, err := c.admin(ctx, token, http.MethodPost, "/users", map[string]any{
		"username":      u.Username,
		"email":         u.Email,
		"firstName":     first,
		"lastName":      last,
		"enabled":       true,
		"emailVerified": true,
		"credentials": []map[string]any{
			{"type": "password", "value": u.Password, "temporary": false},
		},
	}, nil)
	if err != nil {
		return err
	}
	if status != http.StatusCreated && status != http.StatusConflict {
		return fmt.Errorf("create user %s: realm answered %d", u.Username, status)
	}
	id, err = c.findUser(ctx, token, u.Username)
	if err != nil || id == "" {
		return err
	}
	return c.grantRealmRole(ctx, token, id, u.Role)
}

func splitName(fullName string) (string, string) {
	first, last, ok := strings.Cut(fullName, " ")
	if !ok {
		return fullName, ""
	}
	return first, last
}

type realmRole struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (c *Client) grantRealmRole(ctx context.Context, token, userID, role string) error {
	var r realmRole
	status, err := c.admin(ctx, token, http.MethodGet, "/roles/"+url.PathEscape(role), nil, &r)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("read realm role %s: realm answered %d", role, status)
	}
	status, err = c.admin(ctx, token, http.MethodPost,
		"/users/"+url.PathEscape(userID)+"/role-mappings/realm", []realmRole{r}, nil)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("grant realm role %s: realm answered %d", role, status)
	}
	return nil
}

// AssignRole gives a person the realm role they registered for, so the role
// shows on the user in Keycloak.
func (c *Client) AssignRole(ctx context.Context, subject, role string) error {
	token, err := c.serviceToken(ctx)
	if err != nil {
		return err
	}
	return c.grantRealmRole(ctx, token, subject, role)
}
