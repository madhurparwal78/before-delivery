// Package s3lite talks plain HTTP to MinIO over the S3 API with path-style
// addressing and SigV4 signing.
package s3lite

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

// ErrUnavailable means MinIO did not answer, so nothing was stored.
var ErrUnavailable = errors.New("file storage is not answering")

type Client struct {
	endpoint  string
	region    string
	bucket    string
	pathStyle bool
	accessKey string
	secretKey string
	http      *http.Client
}

type Object struct {
	Body        []byte
	ContentType string
}

func New(endpoint, region, bucket string, pathStyle bool, accessKey, secretKey string) *Client {
	if region == "" {
		region = "us-east-1"
	}
	return &Client{
		endpoint:  strings.TrimRight(endpoint, "/"),
		region:    region,
		bucket:    bucket,
		pathStyle: pathStyle,
		accessKey: accessKey,
		secretKey: secretKey,
		http:      &http.Client{Timeout: 10 * time.Second},
	}
}

// EnsureBucket creates the configured bucket when it is missing.
func (c *Client) EnsureBucket(ctx context.Context) error {
	status, _, err := c.do(ctx, http.MethodHead, "", nil, nil, "")
	if err != nil {
		return err
	}
	if status == http.StatusOK {
		return nil
	}
	status, body, err := c.do(ctx, http.MethodPut, "", nil, nil, "")
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusConflict {
		return fmt.Errorf("create bucket: status %d: %s", status, string(body))
	}
	return nil
}

func (c *Client) Put(ctx context.Context, key, contentType string, body []byte) error {
	status, response, err := c.do(ctx, http.MethodPut, key, body, nil, contentType)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("put %s: status %d: %s", key, status, string(response))
	}
	return nil
}

func (c *Client) Get(ctx context.Context, key string) (*Object, error) {
	status, body, header, err := c.request(ctx, http.MethodGet, key, nil, nil, "")
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("get %s: status %d", key, status)
	}
	return &Object{Body: body, ContentType: header.Get("Content-Type")}, nil
}

func (c *Client) Delete(ctx context.Context, key string) error {
	status, body, err := c.do(ctx, http.MethodDelete, key, nil, nil, "")
	if err != nil {
		return err
	}
	if status != http.StatusNoContent && status != http.StatusOK && status != http.StatusNotFound {
		return fmt.Errorf("delete %s: status %d: %s", key, status, string(body))
	}
	return nil
}

type listResult struct {
	Contents []struct {
		Key string `xml:"Key"`
	} `xml:"Contents"`
	IsTruncated         bool   `xml:"IsTruncated"`
	NextContinuationTok string `xml:"NextContinuationToken"`
}

// DeletePrefix removes every object stored under a prefix.
func (c *Client) DeletePrefix(ctx context.Context, prefix string) error {
	token := ""
	for {
		query := url.Values{"list-type": {"2"}, "prefix": {prefix}}
		if token != "" {
			query.Set("continuation-token", token)
		}
		status, body, _, err := c.request(ctx, http.MethodGet, "", nil, query, "")
		if err != nil {
			return err
		}
		if status != http.StatusOK {
			return fmt.Errorf("list %s: status %d", prefix, status)
		}
		var result listResult
		if err := xml.Unmarshal(body, &result); err != nil {
			return fmt.Errorf("decode object list: %w", err)
		}
		for _, item := range result.Contents {
			if err := c.Delete(ctx, item.Key); err != nil {
				return err
			}
		}
		if !result.IsTruncated || result.NextContinuationTok == "" {
			return nil
		}
		token = result.NextContinuationTok
	}
}

func (c *Client) do(ctx context.Context, method, key string, body []byte, query url.Values, contentType string) (int, []byte, error) {
	status, response, _, err := c.request(ctx, method, key, body, query, contentType)
	return status, response, err
}

func (c *Client) request(ctx context.Context, method, key string, body []byte, query url.Values, contentType string) (int, []byte, http.Header, error) {
	path := "/" + c.bucket
	if key != "" {
		path += "/" + key
	}
	target := c.endpoint + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
	if err != nil {
		return 0, nil, nil, fmt.Errorf("build storage request: %w", err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.ContentLength = int64(len(body))
	c.sign(req, path, query, body)

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	read, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if resp.StatusCode >= 500 {
		return resp.StatusCode, read, resp.Header, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	return resp.StatusCode, read, resp.Header, nil
}

func (c *Client) sign(req *http.Request, path string, query url.Values, body []byte) {
	now := time.Now().UTC()
	stamp := now.Format("20060102T150405Z")
	day := now.Format("20060102")
	payloadSum := sha256.Sum256(body)
	payload := hex.EncodeToString(payloadSum[:])

	req.Header.Set("Host", req.URL.Host)
	req.Header.Set("X-Amz-Content-Sha256", payload)
	req.Header.Set("X-Amz-Date", stamp)

	signed := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n", req.URL.Host, payload, stamp)
	if ct := req.Header.Get("Content-Type"); ct != "" {
		signed = append(signed, "content-type")
		canonicalHeaders = fmt.Sprintf("content-type:%s\n", ct) + canonicalHeaders
		sort.Strings(signed)
	}

	canonicalRequest := strings.Join([]string{
		req.Method,
		canonicalURI(path),
		canonicalQuery(query),
		canonicalHeaders,
		strings.Join(signed, ";"),
		payload,
	}, "\n")
	requestSum := sha256.Sum256([]byte(canonicalRequest))
	scope := strings.Join([]string{day, c.region, "s3", "aws4_request"}, "/")
	toSign := strings.Join([]string{"AWS4-HMAC-SHA256", stamp, scope, hex.EncodeToString(requestSum[:])}, "\n")

	key := hmacSum([]byte("AWS4"+c.secretKey), day)
	key = hmacSum(key, c.region)
	key = hmacSum(key, "s3")
	key = hmacSum(key, "aws4_request")
	signature := hex.EncodeToString(hmacSum(key, toSign))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		c.accessKey, scope, strings.Join(signed, ";"), signature))
}

func canonicalURI(path string) string {
	parts := strings.Split(path, "/")
	for i, part := range parts {
		parts[i] = strings.ReplaceAll(url.QueryEscape(part), "+", "%20")
	}
	return strings.Join(parts, "/")
}

func canonicalQuery(query url.Values) string {
	if len(query) == 0 {
		return ""
	}
	keys := make([]string, 0, len(query))
	for k := range query {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		values := append([]string{}, query[k]...)
		sort.Strings(values)
		for _, v := range values {
			pairs = append(pairs, url.QueryEscape(k)+"="+url.QueryEscape(v))
		}
	}
	return strings.Join(pairs, "&")
}

func hmacSum(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}
