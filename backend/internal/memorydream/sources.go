package memorydream

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/wins/jaz/backend/internal/sourcequeue"
)

func writeSources(file string, sources []sourcequeue.Source) error {
	paths := make([]string, 0, len(sources))
	for _, source := range sources {
		paths = append(paths, source.Path)
	}
	data, err := json.MarshalIndent(paths, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(file, data, 0o600)
}

func readReceipt(file string, sources []sourcequeue.Source) ([]sourcequeue.Source, []sourcequeue.Source, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, nil, fmt.Errorf("read processed-source receipt: %w", err)
	}
	var paths []string
	if err := json.Unmarshal(data, &paths); err != nil || paths == nil {
		return nil, nil, fmt.Errorf("processed-source receipt must be a JSON array of paths")
	}
	reserved := make(map[string]sourcequeue.Source, len(sources))
	for _, source := range sources {
		reserved[source.Path] = source
	}
	completed := make([]sourcequeue.Source, 0, len(paths))
	for _, path := range paths {
		source, ok := reserved[path]
		if !ok {
			return nil, nil, fmt.Errorf("processed-source receipt contains unreserved or duplicate path %q", path)
		}
		completed = append(completed, source)
		delete(reserved, path)
	}
	var pending []sourcequeue.Source
	for _, source := range sources {
		if _, ok := reserved[source.Path]; ok {
			pending = append(pending, source)
		}
	}
	return completed, pending, nil
}
