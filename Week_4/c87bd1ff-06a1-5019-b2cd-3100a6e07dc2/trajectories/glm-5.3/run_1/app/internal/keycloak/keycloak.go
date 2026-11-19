// Package keycloak talks to the Keycloak admin and OIDC endpoints.
package keycloak

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Client struct {
	baseURL  string
	realm    string
	issuer   string
	clientID string
	secret   string
	http     *http.Client

	mu         sync.Mutex
	serviceTok string
	serviceExp time.Time
}

func New(baseURL, realm, issuer, clientID, secret string) *Client {
	return &Client{
		baseURL:  strings.TrimSuffix(baseURL, "/"),
		realm:    realm,
		issuer:   issuer,
		clientID: clientID,
		secret:   secret,
		http:     &http.Client{Timeout: 5 * time.Second},
	}
}

// Healthy checks whether the issuer answers within a short window.
func (c *Client) Healthy() bool {
	resp, err := c.http.Get(c.issuer + "/.well-known/openid-configuration")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return resp.StatusCode == 200
}

// ClientID exposes the configured OIDC client id.
func (c *Client) ClientID() string { return c.clientID }

// AuthorizationEndpoint is where the browser starts the sign-in.
func (c *Client) AuthorizationEndpoint() string {
	return c.baseURL + "/realms/" + c.realm + "/protocol/openid-connect/auth"
}

// serviceToken fetches and caches the client's service-account token.
func (c *Client) serviceToken() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.serviceTok != "" && time.Now().Before(c.serviceExp.Add(-30*time.Second)) {
		return c.serviceTok, nil
	}
	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", c.clientID)
	form.Set("client_secret", c.secret)
	resp, err := c.http.Post(c.baseURL+"/realms/"+c.realm+"/protocol/openid-connect/token",
		"application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("reaching keycloak: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("keycloak answered %d for the service token", resp.StatusCode)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", fmt.Errorf("reading the service token: %w", err)
	}
	c.serviceTok = tok.AccessToken
	c.serviceExp = time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
	return c.serviceTok, nil
}

func (c *Client) adminReq(method, path string, payload any) (*http.Response, error) {
	tok, err := c.serviceToken()
	if err != nil {
		return nil, err
	}
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("encoding the request: %w", err)
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, c.baseURL+"/admin/realms/"+c.realm+path, body)
	if err != nil {
		return nil, fmt.Errorf("building the request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("reaching keycloak: %w", err)
	}
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		resp.Body.Close()
		return nil, fmt.Errorf("keycloak answered %d for %s %s: %s", resp.StatusCode, method, path, raw)
	}
	return resp, nil
}

// EnsureRole creates the realm role when it is missing.
func (c *Client) EnsureRole(name string) error {
	resp, err := c.adminReq("POST", "/roles", map[string]string{"name": name})
	if err != nil {
		// A 409 from the raw call means the role already exists; adminReq
		// flattens that into an error, so check the role before failing.
		if c.roleExists(name) {
			return nil
		}
		return err
	}
	resp.Body.Close()
	return nil
}

func (c *Client) roleExists(name string) bool {
	resp, err := c.adminReq("GET", "/roles/"+url.PathEscape(name), nil)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return resp.StatusCode == 200
}

func (c *Client) userID(username string) (string, error) {
	resp, err := c.adminReq("GET", "/users?username="+url.QueryEscape(username)+"&exact=true", nil)
	if err != nil {
		return "", fmt.Errorf("reading the user: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var users []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &users); err != nil {
		return "", fmt.Errorf("reading the user: %w", err)
	}
	if len(users) == 0 {
		return "", nil
	}
	return users[0].ID, nil
}

func (c *Client) userRoles(userID string) ([]string, error) {
	resp, err := c.adminReq("GET", "/users/"+userID+"/role-mappings/realm", nil)
	if err != nil {
		return nil, fmt.Errorf("reading the user's roles: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var roles []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &roles); err != nil {
		return nil, fmt.Errorf("reading the user's roles: %w", err)
	}
	names := make([]string, 0, len(roles))
	for _, r := range roles {
		names = append(names, r.Name)
	}
	return names, nil
}

// roleID looks up the role's internal id, which the mapping API needs.
func (c *Client) roleID(name string) (string, error) {
	resp, err := c.adminReq("GET", "/roles/"+url.PathEscape(name), nil)
	if err != nil {
		return "", fmt.Errorf("reading the role: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var role struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &role); err != nil {
		return "", fmt.Errorf("reading the role: %w", err)
	}
	return role.ID, nil
}

// giveRole maps the realm role onto the user.
func (c *Client) giveRole(userID, role string) error {
	roleID, err := c.roleID(role)
	if err != nil {
		return err
	}
	resp, err := c.adminReq("POST", "/users/"+userID+"/role-mappings/realm", []map[string]string{{"id": roleID, "name": role}})
	if err != nil {
		return fmt.Errorf("giving the role: %w", err)
	}
	resp.Body.Close()
	return nil
}

// EnsureUser creates the seed user when missing and gives it the role.
func (c *Client) EnsureUser(username, password, firstName, lastName, role string) error {
	existing, err := c.userID(username)
	if err != nil {
		return fmt.Errorf("reading the user: %w", err)
	}
	if existing == "" {
		payload := map[string]any{
			"username":        username,
			"enabled":         true,
			"email":           username + "@example.test",
			"emailVerified":   true,
			"firstName":       firstName,
			"lastName":        lastName,
			"requiredActions": []string{},
			"credentials": []map[string]any{{
				"type":      "password",
				"value":     password,
				"temporary": false,
			}},
		}
		resp, err := c.adminReq("POST", "/users", payload)
		if err != nil {
			// Another process may have created the user first.
			existing, err2 := c.userID(username)
			if err2 != nil || existing == "" {
				return fmt.Errorf("creating the user: %w", err)
			}
		} else {
			resp.Body.Close()
			location := resp.Header.Get("Location")
			parts := strings.Split(location, "/")
			existing = parts[len(parts)-1]
		}
	}
	roles, err := c.userRoles(existing)
	if err != nil {
		return fmt.Errorf("reading the user's roles: %w", err)
	}
	for _, r := range roles {
		if r == role {
			return nil
		}
	}
	return c.giveRole(existing, role)
}

// AddRealmRole gives the person the realm role, so it shows on the user.
func (c *Client) AddRealmRole(sub, role string) error {
	userID, err := c.userID(sub)
	if err != nil {
		return fmt.Errorf("reading the user: %w", err)
	}
	if userID == "" {
		return fmt.Errorf("the user is missing")
	}
	roles, err := c.userRoles(userID)
	if err != nil {
		return fmt.Errorf("reading the user's roles: %w", err)
	}
	for _, r := range roles {
		if r == role {
			return nil
		}
	}
	return c.giveRole(userID, role)
}

// TokenResponse is the OIDC token exchange result.
type TokenResponse struct {
	AccessToken      string `json:"access_token"`
	IDToken          string `json:"id_token"`
	RefreshExpiresIn int    `json:"refresh_expires_in"`
}

// Exchange swaps an authorisation code for tokens.
func (c *Client) Exchange(code, redirectURI, verifier string) (*TokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", c.clientID)
	form.Set("client_secret", c.secret)
	form.Set("code_verifier", verifier)
	resp, err := c.http.Post(c.baseURL+"/realms/"+c.realm+"/protocol/openid-connect/token",
		"application/x-www-form-urlencoded", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("reaching keycloak: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("keycloak answered %d for the code exchange", resp.StatusCode)
	}
	var tok TokenResponse
	if err := json.Unmarshal(raw, &tok); err != nil {
		return nil, fmt.Errorf("reading the token: %w", err)
	}
	return &tok, nil
}

// UserInfo is the signed-in person's identity, read from the access token.
type UserInfo struct {
	Sub           string
	PreferredName string
	Name          string
	Email         string
	RealmRoles    []string
}

// UserInfo decodes the access token's claims, which carry the realm roles.
func (c *Client) UserInfo(accessToken string) (*UserInfo, error) {
	parts := strings.Split(accessToken, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("the token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("reading the token: %w", err)
	}
	var claims struct {
		Sub           string `json:"sub"`
		PreferredName string `json:"preferred_username"`
		Name          string `json:"name"`
		Email         string `json:"email"`
		RealmAccess   struct {
			Roles []string `json:"roles"`
		} `json:"realm_access"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("reading the token: %w", err)
	}
	return &UserInfo{
		Sub:           claims.Sub,
		PreferredName: claims.PreferredName,
		Name:          claims.Name,
		Email:         claims.Email,
		RealmRoles:    claims.RealmAccess.Roles,
	}, nil
}
