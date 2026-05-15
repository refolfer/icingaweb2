# Modern UI Smoke Test (15 Min)

## Scope

Quick `pass/fail` verification for:

1. `NeoNOC`
2. `NeoNOC-Compact`
3. `NeoNOC-Light`

## Test Metadata

- Date:
- Tester:
- Environment:
- Browser:

## Pass/Fail Matrix

Mark each cell as `PASS` or `FAIL`.

| Check | NeoNOC | NeoNOC-Compact | NeoNOC-Light | Notes |
|---|---|---|---|---|
| Theme loads (no plain-text layout) |  |  |  |  |
| Menu and tabs are styled correctly |  |  |  |  |
| Host list opens and rows are readable |  |  |  |  |
| Service list opens and rows are readable |  |  |  |  |
| Filter/search controls are usable |  |  |  |  |
| Pagination is visible and clickable |  |  |  |  |
| Acknowledge action form is readable |  |  |  |  |
| Downtime action form is readable |  |  |  |  |
| Dashboard pane switching works |  |  |  |  |
| Status badges (OK/WARN/CRIT/UNKNOWN) are distinct |  |  |  |  |
| Keyboard focus outline is visible |  |  |  |  |
| Mobile width <=768px usable (menu/filter/list) |  |  |  |  |

## Failure Template

- Theme:
- Check:
- URL:
- Expected:
- Actual:
- Screenshot:

## Exit Rule

Pilot can continue only if:

1. No `FAIL` in "Theme loads (no plain-text layout)"
2. No critical workflow regression (`ack`, `downtime`, filters, dashboard switching)
3. At most minor visual issues with workaround

