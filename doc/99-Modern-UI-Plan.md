# Modern UI Plan For Icinga Web 2

## Goal

Build a modern, readable, and low-noise monitoring UI for day-to-day operations without breaking existing
Icinga Web 2 workflows (acknowledgements, comments, downtime, filtering, quick navigation).

## Design Direction

- Focus: NOC and SRE operators working for long sessions
- Priority: fast signal recognition over decorative visuals
- Style: dark graph-like workspace with strong state contrast and cleaner spacing
- Constraints: keep compatibility with stock Icinga Web 2 and modules
- Theme family:
  - `NeoNOC`: default dark operator profile
  - `NeoNOC-Compact`: dense dark profile for crowded screens and wallboards
  - `NeoNOC-Light`: light profile for bright offices and daytime shifts

## Phase 1 - Foundation (Done In This Sketch)

- Add a dedicated theme file in `public/css/themes/`
- Define a new color system for menu, content surfaces, accents, and host/service states
- Improve typography and spacing for higher density readability
- Introduce card-like content containers, stronger table hierarchy, and clearer form controls

## Phase 2 - Monitoring Dashboard Layer

- Build dashboard presets for:
  - Global health summary
  - Active incidents
  - SLA and trend tracking
  - Capacity and latency hotspots
- Define widget visual conventions:
  - status chips
  - trend arrows
  - service/host criticality badges
- Add uniform component rules for module pages to reduce visual inconsistency
- Provide baseline `dashboard.ini` blueprint for fast pilot onboarding

## Phase 3 - UX Hardening

- Accessibility checks:
  - keyboard focus visibility
  - text/background contrast
  - color-blind state distinction
- Mobile and small-screen sanity pass for side menu, filters, and tables
- Validate readability under real alert load (high critical/warning count)

## Phase 4 - Rollout

- Deploy as optional theme for pilot users
- Gather feedback from operators for 1-2 weeks
- Tune spacing, contrast, and density
- Set as default theme only after pilot sign-off

## Acceptance Criteria

- Operators can identify state changes faster than with default theme
- No regressions in core actions (acknowledge, schedule downtime, comments, filtering)
- Theme works with current enabled modules without layout breakage
- Dark and light mode remain selectable for users

## How To Enable This Sketch

1. Ensure file `public/css/themes/NeoNOC.less` exists in deployment
2. Optionally use `public/css/themes/NeoNOC-Compact.less` for denser NOC layout
3. Optionally use `public/css/themes/NeoNOC-Light.less` for light operator layout
4. Open Icinga Web 2 and select theme `NeoNOC`, `NeoNOC-Compact` or `NeoNOC-Light` in user preferences
5. Optionally enforce globally in `/etc/icingaweb2/config.ini`:

```ini
[themes]
default = "NeoNOC"
disabled = "0"
```

## Pilot Execution

Use `doc/99-Modern-UI-Pilot-Checklist.md` as rollout checklist and feedback baseline.
Use `doc/99-Modern-UI-Dashboard-Blueprint.md` and `doc/res/modern-ui-dashboard.ini.example`
to seed operator dashboards quickly.
Use `doc/99-Modern-UI-Theme-Profiles.md` to assign theme variants per team/shift.
