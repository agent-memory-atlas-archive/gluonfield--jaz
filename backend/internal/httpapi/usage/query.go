package usage

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	usagecore "github.com/wins/jaz/backend/internal/usage"
)

func parseDailyQuery(r *http.Request) (usagecore.DailyQuery, error) {
	params := r.URL.Query()
	days, err := parseDays(params.Get("days"))
	if err != nil {
		return usagecore.DailyQuery{}, err
	}
	loc, err := parseLocation(params.Get("timezone"), params.Get("tz_offset_minutes"))
	if err != nil {
		return usagecore.DailyQuery{}, err
	}
	query := usagecore.DailyQuery{Days: days, Location: loc}
	if params.Has("start") || params.Has("end") {
		query.Range = &usagecore.DateRange{}
		for name, target := range map[string]*time.Time{"start": &query.Range.Start, "end": &query.Range.End} {
			*target, err = time.Parse(usagecore.DateLayout, strings.TrimSpace(params.Get(name)))
			if err != nil {
				return usagecore.DailyQuery{}, fmt.Errorf("%s must be a date in YYYY-MM-DD format", name)
			}
		}
	}
	return query, nil
}

func parseDays(raw string) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, nil
	}
	days, err := strconv.Atoi(raw)
	if err != nil {
		return 0, usagecore.ErrInvalidDays
	}
	if days == 0 {
		return 0, usagecore.ErrInvalidDays
	}
	return days, nil
}

func parseLocation(timezone, offset string) (*time.Location, error) {
	if raw := strings.TrimSpace(timezone); raw != "" {
		loc, err := time.LoadLocation(raw)
		if err != nil {
			return nil, fmt.Errorf("timezone must be an IANA timezone: %w", err)
		}
		return loc, nil
	}
	if raw := strings.TrimSpace(offset); raw != "" {
		minutes, err := strconv.Atoi(raw)
		if err != nil {
			return nil, fmt.Errorf("tz_offset_minutes must be an integer")
		}
		return time.FixedZone("client", -minutes*60), nil
	}
	return nil, nil
}
