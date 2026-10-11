package canvas

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
)

const maxComponentBytes = 1 << 20

var componentLoaders = map[string]api.Loader{".tsx": api.LoaderTSX, ".jsx": api.LoaderJSX}

func IsComponent(path string) bool {
	_, ok := componentLoaders[strings.ToLower(filepath.Ext(path))]
	return ok
}

// compile turns an agent-written component into CommonJS the client sandbox
// can evaluate, keeping compile errors for the agent and the user to see.
func compile(path string) Component {
	source, err := os.ReadFile(path)
	if err != nil {
		return Component{Error: err.Error()}
	}
	if len(source) > maxComponentBytes {
		return Component{Error: fmt.Sprintf("%s is larger than %d bytes", filepath.Base(path), maxComponentBytes)}
	}
	result := api.Transform(string(source), api.TransformOptions{
		Loader:     componentLoaders[strings.ToLower(filepath.Ext(path))],
		Format:     api.FormatCommonJS,
		JSX:        api.JSXAutomatic,
		Target:     api.ES2022,
		Sourcefile: filepath.Base(path),
	})
	if len(result.Errors) > 0 {
		lines := make([]string, 0, len(result.Errors))
		for _, message := range result.Errors {
			if location := message.Location; location != nil {
				lines = append(lines, fmt.Sprintf("%s:%d:%d: %s", location.File, location.Line, location.Column+1, message.Text))
				continue
			}
			lines = append(lines, message.Text)
		}
		return Component{Error: strings.Join(lines, "\n")}
	}
	return Component{Code: string(result.Code)}
}
