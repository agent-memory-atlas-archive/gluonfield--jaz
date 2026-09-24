package memorysearchprompt

import (
	"bytes"
	_ "embed"
	"text/template"
)

//go:embed memorysearchprompt.tmpl
var source string

var prompt = template.Must(template.New("memorysearchprompt").Parse(source))

type Data struct {
	Query string
	Limit int
	Deep  bool
}

func Render(data Data) (string, error) {
	var out bytes.Buffer
	err := prompt.Execute(&out, data)
	return out.String(), err
}
