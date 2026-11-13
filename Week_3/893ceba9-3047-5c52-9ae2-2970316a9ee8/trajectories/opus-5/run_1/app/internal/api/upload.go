package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
)

var utf8BOM = []byte{0xef, 0xbb, 0xbf}

type uploadedFile struct {
	Name        string
	ContentType string
	Bytes       []byte
	SHA256      string
}

// readUpload reads the file part of a multipart request, enforcing the
// published file and request limits.
func readUpload(r *http.Request, field string) (*uploadedFile, map[string]string, *apiError) {
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, nil, errPayloadTooLarge()
		}
		return nil, nil, errField("file", "Send the file as a multipart form.")
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()
	values := map[string]string{}
	for name, list := range r.MultipartForm.Value {
		if len(list) > 0 {
			values[name] = list[0]
		}
	}
	files := r.MultipartForm.File[field]
	if len(files) == 0 {
		return nil, values, errField("file", "Choose a file to upload.")
	}
	header := files[0]
	if header.Size > maxUploadFile {
		return nil, values, errPayloadTooLarge()
	}
	opened, err := header.Open()
	if err != nil {
		return nil, values, errField("file", "That file could not be read.")
	}
	defer func() { _ = opened.Close() }()
	read, err := io.ReadAll(io.LimitReader(opened, maxUploadFile+1))
	if err != nil {
		return nil, values, errField("file", "That file could not be read.")
	}
	if len(read) > maxUploadFile {
		return nil, values, errPayloadTooLarge()
	}
	sum := sha256.Sum256(read)
	return &uploadedFile{
		Name:        header.Filename,
		ContentType: header.Header.Get("Content-Type"),
		Bytes:       read,
		SHA256:      hex.EncodeToString(sum[:]),
	}, values, nil
}

func withoutBOM(data []byte) []byte { return bytes.TrimPrefix(data, utf8BOM) }
