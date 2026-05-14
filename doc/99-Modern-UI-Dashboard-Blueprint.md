# Modern UI Dashboard Blueprint

## Goal

Provide a practical starter blueprint for NOC dashboards that pair well with `NeoNOC` and `NeoNOC-Compact`.

## Recommended Pane Structure

1. `NOC Live`: active incidents and unstable objects
2. `SLA & Trends`: service quality and trend-oriented views
3. `Capacity`: saturation hotspots and growth signals

## Dashlet Design Rules

- Keep 4-8 dashlets per pane
- Put critical/problem-focused dashlets first (top-left)
- Use compact/grid views for high-cardinality lists
- Avoid mixing "problem lists" and "inventory lists" in the same pane

## Suggested Dashlets (Conceptual)

1. Active problems (services)
2. Active problems (hosts)
3. Unhandled criticals
4. Acked but still critical
5. Recent notifications/history
6. Long-running downtimes
7. SLA summary
8. Top latency/response degradations

## User Dashboard Config Location

Per user dashboard config is loaded from:

`/etc/icingaweb2/dashboards/<username>/dashboard.ini`

The parser accepts sections:

- `[pane-name]` for pane metadata (for example title, disabled)
- `[pane-name.dashlet-name]` for dashlets (requires `url`, can include extra URL params)

## Ready-To-Adapt Example

See:

`doc/res/modern-ui-dashboard.ini.example`

## How To Adapt URLs Safely

1. Open target view in Icinga Web 2
2. Copy the relative path and query from browser URL
3. Put path into `url = "..."`
4. Convert query string into one key-value per line

Example:

`icingadb/services/grid?problems&limit=30`

becomes:

```ini
url = "icingadb/services/grid"
problems = "1"
limit = "30"
```

