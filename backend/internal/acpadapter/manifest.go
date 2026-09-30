package acpadapter

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

const releasesURL = "https://github.com/gluonfield/jaz/releases"

type manifest struct {
	Adapters map[string]manifestAdapter `json:"adapters"`
}

type manifestAdapter struct {
	Version string                   `json:"version"`
	Assets  map[string]manifestAsset `json:"assets"`
}

type manifestAsset struct {
	URL    string            `json:"url"`
	SHA256 string            `json:"sha256"`
	Binary string            `json:"binary"`
	Env    map[string]string `json:"env,omitempty"`
}

// releaseTag is the release a manifest is pinned to, or "" for latest.
func releaseTag(version string) string {
	version = strings.TrimSpace(version)
	if version == "" || version == "dev" {
		return ""
	}
	if !strings.HasPrefix(version, "v") {
		version = "v" + version
	}
	return version
}

func (m *Manager) resolveSpec(ctx context.Context, name string) (adapterSpec, error) {
	platform, err := platformKey(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return adapterSpec{}, err
	}
	source, err := m.fetchManifest(ctx)
	if err != nil {
		return adapterSpec{}, err
	}
	return m.specFromManifest(source, name, platform)
}

func (m *Manager) specFromManifest(source manifest, name, platform string) (adapterSpec, error) {
	adapter, ok := source.Adapters[name]
	if !ok {
		return adapterSpec{}, fmt.Errorf("managed acp adapter %q is not in the manifest", name)
	}
	asset, ok := adapter.Assets[platform]
	if !ok {
		return adapterSpec{}, fmt.Errorf("managed acp adapter %q does not support %s", name, platform)
	}
	if err := validateManifestAsset(name, adapter.Version, asset); err != nil {
		return adapterSpec{}, err
	}
	root := filepath.Join(m.root, "acp", "managed", "adapters", name, adapter.Version, platform)
	spec := adapterSpec{
		Adapter:  name,
		Version:  adapter.Version,
		Platform: platform,
		URL:      asset.URL,
		SHA256:   asset.SHA256,
		Root:     root,
		Command:  filepath.Join(root, filepath.FromSlash(asset.Binary)),
		Env:      map[string]string{},
	}
	for key, value := range asset.Env {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		spec.Env[key] = resolveArchivePath(root, value)
	}
	return spec, nil
}

// fetchManifest reads the dev manifest or the release manifest. A tagged
// release manifest never changes, so once cached it is final; the latest
// manifest is refetched and falls back to its cache when the network fails.
func (m *Manager) fetchManifest(ctx context.Context) (manifest, error) {
	if m.localManifestPath != "" {
		return readLocalManifest(m.localManifestPath)
	}
	cached, cachedOK := m.readManifestCache()
	if cachedOK && m.tag != "" {
		return cached, nil
	}
	out, err := m.fetchRemoteManifest(ctx)
	if err != nil {
		if cachedOK {
			return cached, nil
		}
		return manifest{}, err
	}
	_ = m.writeManifestCache(out)
	return out, nil
}

// offlineManifest is fetchManifest without the network.
func (m *Manager) offlineManifest() (manifest, bool) {
	if m.localManifestPath != "" {
		out, err := readLocalManifest(m.localManifestPath)
		return out, err == nil
	}
	return m.readManifestCache()
}

func readLocalManifest(file string) (manifest, error) {
	body, err := os.ReadFile(file)
	if err != nil {
		return manifest{}, err
	}
	var out manifest
	if err := json.Unmarshal(body, &out); err != nil {
		return manifest{}, err
	}
	if len(out.Adapters) == 0 {
		return manifest{}, fmt.Errorf("managed acp adapter manifest is empty")
	}
	return out, nil
}

func (m *Manager) fetchRemoteManifest(ctx context.Context) (manifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.manifestURL, nil)
	if err != nil {
		return manifest{}, err
	}
	res, err := m.client.Do(req)
	if err != nil {
		return manifest{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return manifest{}, fmt.Errorf("fetch managed acp adapter manifest: %s", res.Status)
	}
	var out manifest
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return manifest{}, err
	}
	return out, nil
}

func (m *Manager) writeManifestCache(out manifest) error {
	path := m.manifestCachePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	return os.WriteFile(path, body, 0o644)
}

func (m *Manager) readManifestCache() (manifest, bool) {
	body, err := os.ReadFile(m.manifestCachePath())
	if err != nil {
		return manifest{}, false
	}
	var out manifest
	if err := json.Unmarshal(body, &out); err != nil {
		return manifest{}, false
	}
	return out, true
}

func (m *Manager) manifestCachePath() string {
	return filepath.Join(m.root, "acp", "managed", "adapters", "manifest-"+cmp.Or(m.tag, "latest")+".json")
}

func findLocalManifestPath() string {
	dir, err := os.Getwd()
	if err == nil {
		if path := findManifestFromDir(dir); path != "" {
			return path
		}
	}
	_, file, _, ok := runtime.Caller(0)
	if ok {
		return findManifestFromDir(filepath.Dir(file))
	}
	return ""
}

func findManifestFromDir(dir string) string {
	for {
		candidate := filepath.Join(dir, "dist", "acp-adapters.json")
		if fileExists(candidate) {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func platformKey(goos, goarch string) (string, error) {
	arch := ""
	switch goarch {
	case "amd64":
		arch = "x64"
	case "arm64":
		arch = "arm64"
	default:
		return "", fmt.Errorf("unsupported managed adapter architecture %s", goarch)
	}
	switch goos {
	case "darwin":
		return "darwin-" + arch, nil
	case "linux":
		return "linux-" + arch, nil
	case "windows":
		return "win32-" + arch, nil
	default:
		return "", fmt.Errorf("unsupported managed adapter OS %s", goos)
	}
}

func validateManifestAsset(adapter, version string, asset manifestAsset) error {
	if strings.TrimSpace(version) == "" {
		return fmt.Errorf("managed acp adapter %q manifest entry is missing version", adapter)
	}
	if strings.TrimSpace(asset.URL) == "" || strings.TrimSpace(asset.SHA256) == "" || strings.TrimSpace(asset.Binary) == "" {
		return fmt.Errorf("managed acp adapter %q manifest entry is incomplete", adapter)
	}
	if !cleanRelative(asset.Binary) {
		return fmt.Errorf("managed acp adapter %q manifest binary path is invalid", adapter)
	}
	for key, value := range asset.Env {
		if strings.TrimSpace(key) == "" || !cleanRelative(value) {
			return fmt.Errorf("managed acp adapter %q manifest env path is invalid", adapter)
		}
	}
	return nil
}

func cleanRelative(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && value != "." && path.Clean(value) == value && !path.IsAbs(value) && !strings.HasPrefix(value, "../") && !strings.ContainsAny(value, `:\`)
}

func resolveArchivePath(root, value string) string {
	return filepath.Join(root, filepath.FromSlash(strings.TrimSpace(value)))
}
