package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// S3 is a minimal path-style S3 client (SigV4 over plain HTTP) for the one bucket the app uses.
type S3 struct {
	endpoint  string
	region    string
	bucket    string
	accessKey string
	secretKey string
	client    *http.Client
}

var errObjectMissing = errors.New("object not found")

func newS3(cfg Config) *S3 {
	return &S3{
		endpoint: strings.TrimRight(cfg.S3Endpoint, "/"), region: cfg.S3Region, bucket: cfg.S3Bucket,
		accessKey: cfg.S3AccessKey, secretKey: cfg.S3SecretKey, client: &http.Client{Timeout: 20 * time.Second},
	}
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

func awsEscape(s string, keepSlash bool) string {
	var sb strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '-', c == '_', c == '.', c == '~':
			sb.WriteByte(c)
		case c == '/' && keepSlash:
			sb.WriteByte(c)
		default:
			fmt.Fprintf(&sb, "%%%02X", c)
		}
	}
	return sb.String()
}

func (s *S3) request(ctx context.Context, method, key string, query url.Values, body []byte, contentType string) (*http.Response, error) {
	path := "/" + s.bucket
	if key != "" {
		path += "/" + key
	}
	names := make([]string, 0, len(query))
	for name := range query {
		names = append(names, name)
	}
	sort.Strings(names)
	var qs []string
	for _, name := range names {
		qs = append(qs, awsEscape(name, false)+"="+awsEscape(query.Get(name), false))
	}
	canonicalQuery := strings.Join(qs, "&")
	endpoint, err := url.Parse(s.endpoint)
	if err != nil || endpoint.Host == "" {
		return nil, fmt.Errorf("%w: bad S3 endpoint", errStorageDown)
	}
	stamp := time.Now().UTC()
	date, day := stamp.Format("20060102T150405Z"), stamp.Format("20060102")
	payload := sha256Hex(body)
	canonical := strings.Join([]string{method, awsEscape(path, true), canonicalQuery,
		"host:" + endpoint.Host + "\nx-amz-content-sha256:" + payload + "\nx-amz-date:" + date + "\n",
		"host;x-amz-content-sha256;x-amz-date", payload}, "\n")
	scope := day + "/" + s.region + "/s3/aws4_request"
	toSign := "AWS4-HMAC-SHA256\n" + date + "\n" + scope + "\n" + sha256Hex([]byte(canonical))
	signKey := hmacSHA256(hmacSHA256(hmacSHA256(hmacSHA256([]byte("AWS4"+s.secretKey), day), s.region), "s3"), "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(signKey, toSign))
	full := s.endpoint + awsEscape(path, true)
	if canonicalQuery != "" {
		full += "?" + canonicalQuery
	}
	req, err := http.NewRequestWithContext(ctx, method, full, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errStorageDown, bareErr(err))
	}
	req.Header.Set("x-amz-date", date)
	req.Header.Set("x-amz-content-sha256", payload)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=%s", s.accessKey, scope, signature))
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errStorageDown, bareErr(err))
	}
	return resp, nil
}

func (s *S3) createBucket(ctx context.Context) error {
	resp, err := s.request(ctx, http.MethodPut, "", nil, nil, "")
	if err != nil {
		return err
	}
	if _, err := drain(resp); err != nil {
		return err
	}
	if resp.StatusCode >= 300 && resp.StatusCode != http.StatusConflict {
		return fmt.Errorf("%w: create bucket answered %d", errStorageDown, resp.StatusCode)
	}
	return nil
}

func (s *S3) Put(ctx context.Context, key string, data []byte, contentType string) error {
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := s.request(ctx, http.MethodPut, key, nil, data, contentType)
		if err != nil {
			return err
		}
		body, err := drain(resp)
		if err != nil {
			return err
		}
		switch {
		case resp.StatusCode < 300:
			return nil
		case resp.StatusCode == http.StatusNotFound && bytes.Contains(body, []byte("NoSuchBucket")) && attempt == 0:
			if err := s.createBucket(ctx); err != nil {
				return err
			}
		default:
			return fmt.Errorf("%w: put %s answered %d", errStorageDown, key, resp.StatusCode)
		}
	}
	return fmt.Errorf("%w: put %s", errStorageDown, key)
}

func (s *S3) Get(ctx context.Context, key string) ([]byte, string, error) {
	resp, err := s.request(ctx, http.MethodGet, key, nil, nil, "")
	if err != nil {
		return nil, "", err
	}
	body, err := drain(resp)
	if err != nil {
		return nil, "", err
	}
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, "", errObjectMissing
	case resp.StatusCode >= 300:
		return nil, "", fmt.Errorf("%w: get %s answered %d", errStorageDown, key, resp.StatusCode)
	}
	return body, resp.Header.Get("Content-Type"), nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	resp, err := s.request(ctx, http.MethodDelete, key, nil, nil, "")
	if err != nil {
		return err
	}
	if _, err := drain(resp); err != nil {
		return err
	}
	if resp.StatusCode >= 300 && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("%w: delete %s answered %d", errStorageDown, key, resp.StatusCode)
	}
	return nil
}

// DeletePrefix removes every object under a prefix.
func (s *S3) DeletePrefix(ctx context.Context, prefix string) error {
	token := ""
	for {
		query := url.Values{"list-type": {"2"}, "prefix": {prefix}}
		if token != "" {
			query.Set("continuation-token", token)
		}
		resp, err := s.request(ctx, http.MethodGet, "", query, nil, "")
		if err != nil {
			return err
		}
		body, err := drain(resp)
		if err != nil {
			return err
		}
		if resp.StatusCode == http.StatusNotFound {
			return nil
		}
		if resp.StatusCode >= 300 {
			return fmt.Errorf("%w: list %s answered %d", errStorageDown, prefix, resp.StatusCode)
		}
		var page struct {
			Truncated bool     `xml:"IsTruncated"`
			Next      string   `xml:"NextContinuationToken"`
			Keys      []string `xml:"Contents>Key"`
		}
		if err := xml.Unmarshal(body, &page); err != nil {
			return fmt.Errorf("%w: parse listing: %v", errStorageDown, err)
		}
		for _, key := range page.Keys {
			if err := s.Delete(ctx, key); err != nil {
				return err
			}
		}
		if !page.Truncated {
			return nil
		}
		token = page.Next
	}
}

// drain reads and closes a MinIO response body; a broken read counts as storage being unavailable.
func drain(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%w: read response: %v", errStorageDown, bareErr(err))
	}
	return body, nil
}
