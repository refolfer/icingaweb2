# Modern UI Smoke Test (15 Min)

## Scope

Quick `pass/fail` verification for:

1. `NeoNOC`
2. `NeoNOC-Light`

## Test Metadata

- Date:
- Tester:
- Environment:
- Browser:

## Pass/Fail Matrix

Mark each cell as `PASS` or `FAIL`.

| Check | NeoNOC | NeoNOC-Light | Notes |
|---|---|---|---|
| Theme loads (no plain-text layout) |  |  |  |
| Menu and tabs are styled correctly |  |  |  |
| Host and service lists are readable |  |  |  |
| Filter/search controls and pagination work |  |  |  |
| Acknowledge and downtime forms are readable |  |  |  |
| Dashboard pane switching works |  |  |  |
| Incident assignment save and removal work |  |  |  |
| Assignment timestamps are populated |  |  |  |
| Quick Menu and notebook persist after refresh |  |  |  |
| Statuses are distinct without relying only on color |  |  |  |
| Keyboard focus and dialog focus trapping work |  |  |  |
| Mobile width <=768px is usable |  |  |  |

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
