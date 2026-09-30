package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/wins/jaz/backend/internal/filepathx"
	"github.com/wins/jaz/backend/internal/storage"
)

const sessionFileReadLimit = 1024 * 1024

// sessionFileWriteLimit caps a save from a file viewer app.
var sessionFileWriteLimit = 10 * 1024 * 1024

type sessionFileResponse struct {
	Path         string `json:"path"`
	RelativePath string `json:"relative_path,omitempty"`
	Content      string `json:"content,omitempty"`
	Size         int64  `json:"size"`
	Binary       bool   `json:"binary,omitempty"`
	Truncated    bool   `json:"truncated,omitempty"`
}

func (s *Server) handleSessionFile(w http.ResponseWriter, r *http.Request, session storage.Session) {
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("path is required"))
		return
	}
	abs, rel, err := resolveSessionFile(session, path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	info, err := os.Stat(abs)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if info.IsDir() {
		writeError(w, http.StatusBadRequest, fmt.Errorf("path is a directory: %s", abs))
		return
	}
	if rawSessionFileRequested(r) {
		serveSessionFileContent(w, r, abs, info)
		return
	}
	file, err := os.Open(abs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, sessionFileReadLimit+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	truncated := len(data) > sessionFileReadLimit
	if truncated {
		data = data[:sessionFileReadLimit]
	}
	binary := bytes.Contains(data, []byte{0}) || !utf8.Valid(data)
	resp := sessionFileResponse{
		Path:         abs,
		RelativePath: rel,
		Size:         info.Size(),
		Binary:       binary,
		Truncated:    truncated,
	}
	if !binary {
		resp.Content = string(data)
	}
	writeJSON(w, http.StatusOK, resp)
}

type sessionFileWrite struct {
	Path    string  `json:"path"`
	Text    *string `json:"text"`
	Blob    *string `json:"blob"`
	IfMatch string  `json:"if_match"`
}

// sessionFileWriteResult is OpenAI's openai/resources/write result, which the
// file viewer apps saving through this endpoint receive as it is.
type sessionFileWriteResult struct {
	Outcome  string `json:"outcome"`
	ETag     string `json:"etag,omitempty"`
	MaxBytes int    `json:"maxBytes,omitempty"`
}

// handleWriteSessionFile saves a file a viewer app opened. With if_match, it
// saves only while the file still has that version, so edits made elsewhere
// in the meantime are reported as a conflict instead of overwritten.
func (s *Server) handleWriteSessionFile(w http.ResponseWriter, r *http.Request) {
	session, err := s.Store.LoadSession(r.PathValue("session"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	var in sessionFileWrite
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, int64(sessionFileWriteLimit)*2+64*1024)).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	abs, _, err := resolveSessionFile(session, in.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	var data []byte
	switch {
	case in.Text != nil:
		data = []byte(*in.Text)
	case in.Blob != nil:
		if data, err = base64.StdEncoding.DecodeString(*in.Blob); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
	default:
		writeError(w, http.StatusBadRequest, errors.New("text or blob is required"))
		return
	}
	if len(data) > sessionFileWriteLimit {
		writeJSON(w, http.StatusOK, sessionFileWriteResult{Outcome: "too-large", MaxBytes: sessionFileWriteLimit})
		return
	}
	info, err := os.Stat(abs)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	if in.IfMatch != "" {
		current, err := os.ReadFile(abs)
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if tag := fileETag(current); tag != in.IfMatch {
			writeJSON(w, http.StatusOK, sessionFileWriteResult{Outcome: "conflict", ETag: tag})
			return
		}
	}
	if err := os.WriteFile(abs, data, info.Mode().Perm()); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, sessionFileWriteResult{Outcome: "saved", ETag: fileETag(data)})
}

// fileETag versions file contents: the hex SHA-256 of the bytes.
func fileETag(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func rawSessionFileRequested(r *http.Request) bool {
	raw := strings.TrimSpace(r.URL.Query().Get("raw"))
	return raw == "1" || strings.EqualFold(raw, "true")
}

func rawSessionFileContentRequest(r *http.Request) bool {
	return strings.HasPrefix(r.URL.Path, "/v1/sessions/") && strings.HasSuffix(r.URL.Path, "/file") && rawSessionFileRequested(r)
}

func serveSessionFileContent(w http.ResponseWriter, r *http.Request, abs string, info os.FileInfo) {
	file, err := os.Open(abs)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	defer file.Close()
	if ctype := mime.TypeByExtension(strings.ToLower(filepath.Ext(abs))); ctype != "" {
		w.Header().Set("Content-Type", ctype)
	}
	if disposition := mime.FormatMediaType("inline", map[string]string{"filename": filepath.Base(abs)}); disposition != "" {
		w.Header().Set("Content-Disposition", disposition)
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, filepath.Base(abs), info.ModTime(), file)
}

func resolveSessionFile(session storage.Session, raw string) (string, string, error) {
	path, err := filePathFromRequest(raw)
	if err != nil {
		return "", "", err
	}
	cwd := optionalCwd(session)
	var abs string
	if filepath.IsAbs(path) {
		abs = filepath.Clean(path)
	} else {
		if cwd == "" {
			return "", "", fmt.Errorf("session has no working directory")
		}
		abs = filepath.Join(cwd, path)
	}
	return abs, relativeToCwd(cwd, abs), nil
}

func relativeToCwd(cwd, abs string) string {
	if cwd == "" {
		return ""
	}
	rel, err := filepath.Rel(cwd, abs)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return ""
	}
	return filepath.ToSlash(rel)
}

func filePathFromRequest(raw string) (string, error) {
	return filepathx.FromUserInput(raw)
}
