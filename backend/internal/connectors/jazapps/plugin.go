package jazapps

import "github.com/wins/jaz/backend/pkg/integrations"

func Tasks() integrations.Plugin {
	return plugin("tasks", "Tasks", "Manage projects, issues and task progress.")
}

func CRM() integrations.Plugin {
	return plugin("crm", "Customer Relationship Management", "Manage people, companies, deals and communication.")
}

func plugin(id, name, description string) integrations.Plugin {
	return integrations.Plugin{
		ID:             id,
		Name:           name,
		Description:    description,
		Provider:       integrations.Provider{ID: id, Name: name},
		Category:       "productivity",
		Icon:           integrations.PluginIcon{Kind: integrations.PluginIconKindAsset, Value: id},
		Auth:           []integrations.AuthOption{{Kind: integrations.AuthKindMCPConnection}},
		Capabilities:   []integrations.Capability{integrations.CapabilityAct, integrations.CapabilityMCP},
		RemoteMCP:      &integrations.RemoteMCP{URL: "https://" + id + ".jaz.chat/mcp", Status: "available"},
		Implementation: integrations.Implementation{Status: "available", Owner: "jaz"},
	}
}
