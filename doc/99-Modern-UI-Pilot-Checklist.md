# Modern UI Pilot Checklist (NeoNOC)

## Purpose

Use this checklist during pilot rollout of `NeoNOC` to confirm that the visual refresh improves operator speed
without breaking daily monitoring operations.

## Pilot Scope

- 3-8 operators from different shifts
- 1-2 weeks of daily use
- At least one high-alert period included
- Include at least one daytime shift using `NeoNOC-Light`

## Functional Checks

- Open host and service details from list views
- Acknowledge problem and remove acknowledgement
- Schedule and remove downtime
- Add and remove comments
- Apply filters and sort changes in list views
- Use pagination under high result counts
- Switch between dashboard tabs and module tabs

## UX Checks

- Critical and warning states are recognizable at a glance
- Active row and hover row are clearly distinguishable
- Search and filter controls are readable and easy to target
- Buttons are visually consistent and obvious
- Focus outline is visible when navigating by keyboard
- Dense screens remain readable after 30+ minutes of use

## Accessibility Checks

- Contrast of text, status badges, and key controls is acceptable
- Color is not the only signal for severe states
- Keyboard-only flow works for core actions

## Mobile/Small Screen Checks

- Menu can be opened and closed reliably
- Search and filters are usable on <= 768px width
- No clipped controls in service/host lists

## Feedback Template

- What improved operator speed?
- Which areas still feel noisy?
- Which pages look inconsistent with the new style?
- Any regressions in workflow confidence?

## Exit Criteria

- No functional regressions reported
- At least 70% pilot users prefer `NeoNOC` over default
- No major readability issues in high-alert windows
