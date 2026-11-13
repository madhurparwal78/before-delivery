package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"time"
)

// serviceError is a failure talking to Gotenberg or MinIO: unreachable, or an error status.
type serviceError struct {
	Unreachable bool
	Status      int
	Detail      string
}

func (e *serviceError) Error() string {
	if e.Unreachable {
		return "service unreachable: " + e.Detail
	}
	return fmt.Sprintf("service answered %d", e.Status)
}

func reach(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return &serviceError{Unreachable: true, Detail: ue.Err.Error()}
	}
	return &serviceError{Unreachable: true, Detail: err.Error()}
}

// ObjectStore talks to MinIO over plain HTTP with Signature Version 4.
type ObjectStore struct {
	cfg    Config
	client *http.Client
}

func newObjectStore(cfg Config) *ObjectStore {
	return &ObjectStore{cfg: cfg, client: &http.Client{Timeout: 15 * time.Second}}
}

func hmacSum(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

func (o *ObjectStore) request(ctx context.Context, method, key, contentType string, body []byte) (*http.Response, error) {
	base, err := url.Parse(o.cfg.S3Endpoint)
	if err != nil || base.Host == "" {
		return nil, &serviceError{Unreachable: true, Detail: "no endpoint"}
	}
	host, path := base.Host, "/"+o.cfg.S3Bucket+"/"+key
	if !o.cfg.S3PathStyle {
		host, path = o.cfg.S3Bucket+"."+base.Host, "/"+key
	}
	escaped := (&url.URL{Path: path}).EscapedPath()
	now := time.Now().UTC()
	stamp, day := now.Format("20060102T150405Z"), now.Format("20060102")
	payload := sha256.Sum256(body)
	payloadHash := hex.EncodeToString(payload[:])
	signed := "host;x-amz-content-sha256;x-amz-date"
	canonical := strings.Join([]string{method, escaped, "", "host:" + host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + stamp + "\n", signed, payloadHash}, "\n")
	scope := day + "/" + o.cfg.S3Region + "/s3/aws4_request"
	hashed := sha256.Sum256([]byte(canonical))
	toSign := "AWS4-HMAC-SHA256\n" + stamp + "\n" + scope + "\n" + hex.EncodeToString(hashed[:])
	k := hmacSum([]byte("AWS4"+o.cfg.S3Secret), day)
	k = hmacSum(hmacSum(hmacSum(k, o.cfg.S3Region), "s3"), "aws4_request")
	signature := hex.EncodeToString(hmacSum(k, toSign))
	req, err := http.NewRequestWithContext(ctx, method, base.Scheme+"://"+host+escaped, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-amz-date", stamp)
	req.Header.Set("x-amz-content-sha256", payloadHash)
	req.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s", o.cfg.S3KeyID, scope, signed, signature))
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := o.client.Do(req)
	if err != nil {
		return nil, reach(err)
	}
	return resp, nil
}

// Put stores an object and confirms by reading its size back.
func (o *ObjectStore) Put(ctx context.Context, key, contentType string, body []byte) error {
	resp, err := o.request(ctx, http.MethodPut, key, contentType, body)
	if err != nil {
		return err
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return &serviceError{Status: resp.StatusCode}
	}
	size, err := o.Size(ctx, key)
	if err != nil {
		return err
	}
	if size != int64(len(body)) {
		return &serviceError{Status: http.StatusConflict, Detail: "stored size differs"}
	}
	return nil
}

// Size is the stored size of an object.
func (o *ObjectStore) Size(ctx context.Context, key string) (int64, error) {
	resp, err := o.request(ctx, http.MethodHead, key, "", nil)
	if err != nil {
		return 0, err
	}
	resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return 0, &serviceError{Status: resp.StatusCode}
	}
	return resp.ContentLength, nil
}

func (o *ObjectStore) Get(ctx context.Context, key string) ([]byte, error) {
	resp, err := o.request(ctx, http.MethodGet, key, "", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, &serviceError{Status: resp.StatusCode}
	}
	return io.ReadAll(resp.Body)
}

// renderPDF posts an HTML page to Gotenberg and returns the PDF.
func renderPDF(ctx context.Context, base, html string) ([]byte, error) {
	var form bytes.Buffer
	mw := multipart.NewWriter(&form)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="files"; filename="index.html"`)
	header.Set("Content-Type", "text/html")
	part, _ := mw.CreatePart(header)
	part.Write([]byte(html))
	mw.Close()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/forms/chromium/convert/html", &form)
	if err != nil {
		return nil, &serviceError{Unreachable: true, Detail: "no document service address"}
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return nil, reach(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, resp.Body)
		return nil, &serviceError{Status: resp.StatusCode}
	}
	return io.ReadAll(resp.Body)
}
