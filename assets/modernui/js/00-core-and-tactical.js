// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

(function () {
    'use strict';

    var SEARCH_HISTORY_KEY = 'menu-search-history';
    var RECENT_INCIDENTS_KEY = 'recent-incidents';
    var PINNED_INCIDENTS_KEY = 'pinned-incidents';
    var SEEN_INCIDENTS_KEY = 'seen-incidents';
    var SNOOZED_INCIDENTS_KEY = 'snoozed-incidents';
    var TRIAGE_MODE_KEY = 'top-events-triage-mode';
    var INCIDENT_NOTES_KEY = 'incident-notes';
    var OPERATOR_ACTIVITY_KEY = 'operator-activity-log';
    var UX_DENSITY_KEY = 'ux-density-mode';
    var QUICK_NOTE_DRAFT_KEY = 'quick-menu-note-draft';
    var NAV_SEQUENCE_TIMEOUT = 1200;
    var TOP_WIDGET_HEIGHT_KEY = 'top-widget-height';
    var TOP_WIDGET_MIN_HEIGHT = 120;
    var TOP_WIDGET_MAX_HEIGHT = 340;
    var TOP_EVENTS_REFRESH_MS = 15000;
    var TOP_EVENTS_ERROR_BACKOFF_MS = 120000;
    var TOP_EVENTS_ERROR_BACKOFF_MAX_MS = 600000;
    var TOP_EVENTS_BUFFER_LIMIT = 8;
    var TACTICAL_REFRESH_MS = 10000;
    var COMMAND_PALETTE_RESULT_LIMIT = 12;
    var OPERATOR_TOAST_TIMEOUT_MS = 2600;
    var RECENT_INCIDENTS_LIMIT = 10;
    var PINNED_INCIDENTS_LIMIT = 20;
    var SEEN_INCIDENTS_LIMIT = 200;
    var OPERATOR_ACTIVITY_LIMIT = 80;
    var INCIDENT_SNOOZE_MS = 15 * 60 * 1000;
    var INCIDENT_ASSIGNMENT_PREFETCH_TTL_MS = 60 * 1000;
    var INCIDENT_TIMELINE_WINDOW_SIZE = 7;
    var INCIDENT_DRAWER_WIDTH_KEY = 'incident-drawer-width';
    var INCIDENT_DRAWER_WIDTH_MIN = 320;
    var INCIDENT_DRAWER_WIDTH_MAX = 960;
    var INCIDENT_ASSIGNMENT_NOTE_KEY = 'incident-assignment-notes';
    var UX_DENSITY_MODES = ['comfortable'];
    var TOP_PANELS_OFFSET_KEY = 'top-panels-offset';
    var TOP_PANELS_OFFSET_MIN = 0;
    var TOP_PANELS_OFFSET_MAX = 360;
    var TOP_EVENT_STATE_CLASSES = [
        'top-event-state-ok',
        'top-event-state-warning',
        'top-event-state-critical',
        'top-event-state-unknown',
        'top-event-state-pending',
        'top-event-state-handled'
    ];
    var TACTICAL_COLORS = {
        ok: '#2aa86a',
        critical: '#d94b63',
        criticalHandled: '#f1a9b6',
        warning: '#d89a22',
        warningHandled: '#edc37b',
        unknown: '#7565d9',
        unknownHandled: '#aba3ee',
        pending: '#2f87d3',
        empty: '#d9e6ef'
    };

    var goState = {
        pending: false,
        timer: null
    };
    var commandPaletteState = {
        commands: [],
        activeIndex: 0,
        aiCommand: null,
        aiError: false,
        aiLoading: false,
        aiQuery: '',
        requestId: 0,
        requestTimer: null
    };
    var operatorAuditState = {
        filter: 'all'
    };
    var incidentDrawerState = {
        url: '',
        abortController: null,
        timelineAbortController: null,
        timelineEntries: [],
        timelineWindowStart: 0,
        object: null,
        assignment: null,
        focusTimeline: false,
        focusAssignment: false
    };
    var incidentDrawerWidthResizeState = null;
    var incidentAssignmentCache = {};
    var incidentAssignmentDetailsCache = {};
    var incidentAssignmentFetchState = {};
    var incidentAssignmentCsrfToken = '';
    var operatorDecisionAssignmentState = {
        lastSignature: '',
        inFlight: false,
        retryAt: 0,
        summary: null
    };

    var lastFocusedElement = null;
    var topWidgetResizeState = null;
    var topPanelsWidthResizeState = null;
    var topEventsState = {
        lastSignature: '',
        items: [],
        pollingTimer: null,
        inFlight: false,
        consecutiveErrors: 0,
        retryAt: 0
    };
    var tacticalState = {
        lastSignature: '',
        pollingTimer: null,
        inFlight: false
    };
    var quickMenuState = {
        initialized: false,
        apiUrl: '',
        items: [],
        note: '',
        csrfToken: '',
        sourceSignature: '',
        saveTimer: null,
        inFlight: false
    };
    var quickMenuContextState = {
        anchor: null,
        object: null
    };
    var quickNotebookState = {
        initialized: false,
        visible: false,
        dirty: false,
        drag: null
    };
    var incidentAssignmentRequestCounter = 0;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function getSearchInput() {
        return document.getElementById('search');
    }

    function isEditableTarget(target) {
        if (! target || target.nodeType !== 1) {
            return false;
        }

        if (target.matches('input, textarea, select, button')) {
            return true;
        }

        if (target.hasAttribute('contenteditable')) {
            return true;
        }

        return Boolean(target.closest('[contenteditable]'));
    }

    function readSearchHistory() {
        var history = [];

        try {
            var raw = window.sessionStorage.getItem(SEARCH_HISTORY_KEY);
            history = raw ? JSON.parse(raw) : [];
        } catch (error) {
            history = [];
        }

        return Array.isArray(history) ? history : [];
    }

    function writeSearchHistory(history) {
        try {
            window.sessionStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function readRecentIncidents() {
        var incidents = [];

        try {
            incidents = JSON.parse(window.sessionStorage.getItem(RECENT_INCIDENTS_KEY) || '[]');
        } catch (error) {
            incidents = [];
        }

        return Array.isArray(incidents) ? incidents : [];
    }

    function writeRecentIncidents(incidents) {
        try {
            window.sessionStorage.setItem(RECENT_INCIDENTS_KEY, JSON.stringify(incidents));
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function rememberRecentIncident(incident) {
        var url = String(incident.url || '').trim();
        var title = String(incident.title || '').trim();
        var incidents;

        if (! url.length || ! title.length) {
            return;
        }

        incidents = readRecentIncidents().filter(function (entry) {
            return entry && entry.url !== url;
        });

        incidents.unshift({
            title: title,
            meta: String(incident.meta || '').trim(),
            url: url
        });

        writeRecentIncidents(incidents.slice(0, RECENT_INCIDENTS_LIMIT));
    }

    function readPinnedIncidents() {
        var incidents = [];

        try {
            incidents = JSON.parse(window.localStorage.getItem(PINNED_INCIDENTS_KEY) || '[]');
        } catch (error) {
            incidents = [];
        }

        return Array.isArray(incidents) ? incidents : [];
    }

    function writePinnedIncidents(incidents) {
        try {
            window.localStorage.setItem(PINNED_INCIDENTS_KEY, JSON.stringify(incidents));
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function isIncidentPinned(url) {
        return readPinnedIncidents().some(function (incident) {
            return incident && incident.url === url;
        });
    }

    function setIncidentPinned(incident, pinned) {
        var url = String(incident.url || '').trim();
        var title = String(incident.title || '').trim();
        var incidents;

        if (! url.length || ! title.length) {
            return;
        }

        incidents = readPinnedIncidents().filter(function (entry) {
            return entry && entry.url !== url;
        });

        if (pinned) {
            incidents.unshift({
                title: title,
                meta: String(incident.meta || '').trim(),
                url: url
            });
        }

        writePinnedIncidents(incidents.slice(0, PINNED_INCIDENTS_LIMIT));
    }

    function readSeenIncidents() {
        var incidents = [];

        try {
            incidents = JSON.parse(window.localStorage.getItem(SEEN_INCIDENTS_KEY) || '[]');
        } catch (error) {
            incidents = [];
        }

        return Array.isArray(incidents) ? incidents : [];
    }

    function writeSeenIncidents(incidents) {
        try {
            window.localStorage.setItem(SEEN_INCIDENTS_KEY, JSON.stringify(incidents));
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function isIncidentSeen(url) {
        var normalized = normalizeIncidentUrl(url);

        if (! normalized.length) {
            return false;
        }

        return readSeenIncidents().indexOf(normalized) !== -1;
    }

    function markIncidentSeen(url) {
        var normalized = normalizeIncidentUrl(url);
        var incidents;

        if (! normalized.length) {
            return;
        }

        incidents = readSeenIncidents().filter(function (entry) {
            return entry !== normalized;
        });

        incidents.unshift(normalized);
        writeSeenIncidents(incidents.slice(0, SEEN_INCIDENTS_LIMIT));
    }

    function refreshSeenTopEventStates() {
        document.querySelectorAll('[data-top-event-item]').forEach(function (item) {
            var url = item.getAttribute('data-event-url') || '';

            item.classList.toggle('top-event-seen', isIncidentSeen(url));
        });
    }

    function readSnoozedIncidents() {
        var snoozed = {};
        var changed = false;
        var now = Date.now();

        try {
            snoozed = JSON.parse(window.localStorage.getItem(SNOOZED_INCIDENTS_KEY) || '{}');
        } catch (error) {
            snoozed = {};
        }

        if (! snoozed || typeof snoozed !== 'object' || Array.isArray(snoozed)) {
            return {};
        }

        Object.keys(snoozed).forEach(function (url) {
            if (Number(snoozed[url] || 0) <= now) {
                delete snoozed[url];
                changed = true;
            }
        });

        if (changed) {
            writeSnoozedIncidents(snoozed);
        }

        return snoozed;
    }

    function writeSnoozedIncidents(snoozed) {
        try {
            window.localStorage.setItem(SNOOZED_INCIDENTS_KEY, JSON.stringify(snoozed));
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function isIncidentSnoozed(url) {
        var normalized = normalizeIncidentUrl(url);
        var snoozed;

        if (! normalized.length) {
            return false;
        }

        snoozed = readSnoozedIncidents();
        return Number(snoozed[normalized] || 0) > Date.now();
    }

    function snoozeIncident(url) {
        var normalized = normalizeIncidentUrl(url);
        var snoozed;

        if (! normalized.length) {
            return;
        }

        snoozed = readSnoozedIncidents();
        snoozed[normalized] = Date.now() + INCIDENT_SNOOZE_MS;
        writeSnoozedIncidents(snoozed);
    }

    function readOperatorActivity() {
        var activity = [];

        try {
            activity = JSON.parse(window.localStorage.getItem(OPERATOR_ACTIVITY_KEY) || '[]');
        } catch (error) {
            activity = [];
        }

        return Array.isArray(activity) ? activity : [];
    }

    function writeOperatorActivity(activity) {
        try {
            window.localStorage.setItem(OPERATOR_ACTIVITY_KEY, JSON.stringify(activity));
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function recordOperatorActivity(kind, title, detail, url) {
        var normalizedTitle = normalizeText(title || '');
        var entry;
        var activity;

        if (! normalizedTitle.length) {
            return;
        }

        entry = {
            id: String(Date.now()) + '-' + String(Math.random()).slice(2, 8),
            time: Date.now(),
            kind: normalizeText(kind || 'Action'),
            title: normalizedTitle,
            detail: normalizeText(detail || ''),
            url: normalizeIncidentUrl(url || '')
        };

        activity = readOperatorActivity();
        activity.unshift(entry);
        writeOperatorActivity(activity.slice(0, OPERATOR_ACTIVITY_LIMIT));

        if (isOperatorActivityOpen()) {
            renderOperatorActivity();
        }
    }

    function readTriageMode() {
        try {
            return window.localStorage.getItem(TRIAGE_MODE_KEY) === '1';
        } catch (error) {
            return false;
        }
    }

    function writeTriageMode(enabled) {
        try {
            window.localStorage.setItem(TRIAGE_MODE_KEY, enabled ? '1' : '0');
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function isTriageModeEnabled() {
        return readTriageMode();
    }

    function readIncidentNotes() {
        var notes = {};

        try {
            notes = JSON.parse(window.localStorage.getItem(INCIDENT_NOTES_KEY) || '{}');
        } catch (error) {
            notes = {};
        }

        return notes && typeof notes === 'object' && ! Array.isArray(notes) ? notes : {};
    }

    function writeIncidentNotes(notes) {
        try {
            window.localStorage.setItem(INCIDENT_NOTES_KEY, JSON.stringify(notes));
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function getIncidentNote(url) {
        var notes = readIncidentNotes();

        return String(notes[url] || '');
    }

    function setIncidentNote(url, note) {
        var notes;

        if (! url.length) {
            return;
        }

        notes = readIncidentNotes();
        if (String(note || '').trim().length) {
            notes[url] = String(note || '');
        } else {
            delete notes[url];
        }

        writeIncidentNotes(notes);
    }

    function rememberSearchQuery(query) {
        var value = (query || '').trim();
        var history;

        if (! value.length) {
            return;
        }

        history = readSearchHistory().filter(function (entry) {
            return entry !== value;
        });

        history.unshift(value);
        writeSearchHistory(history.slice(0, 8));
    }

    function normalizeDensityMode(mode) {
        return UX_DENSITY_MODES.indexOf(mode) === -1 ? 'comfortable' : mode;
    }

    function readDensityMode() {
        var mode = '';

        try {
            mode = window.localStorage.getItem(UX_DENSITY_KEY) || '';
        } catch (error) {
            mode = '';
        }

        return normalizeDensityMode(mode);
    }

    function applyDensityMode(mode) {
        var normalized = normalizeDensityMode(mode);

        UX_DENSITY_MODES.forEach(function (densityMode) {
            document.body.classList.toggle('ux-density-' + densityMode, densityMode === normalized);
        });

        return normalized;
    }

    function setDensityMode(mode) {
        var normalized = applyDensityMode(mode);

        try {
            window.localStorage.setItem(UX_DENSITY_KEY, normalized);
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function renderRecentSearches() {
        var container = document.querySelector('[data-search-history-container]');
        var actions;
        var history;
        var title;

        if (! container) {
            return;
        }

        actions = container.querySelector('.search-history-actions');
        title = container.querySelector('.search-history-title');

        if (! actions || ! title) {
            return;
        }

        history = readSearchHistory();

        if (! history.length) {
            container.hidden = true;
            actions.innerHTML = '';
            return;
        }

        title.textContent = container.dataset.titleLabel || 'Recent Searches';
        actions.innerHTML = history.map(function (entry) {
            return '<button type="button" class="search-history-action" data-search-query="'
                + escapeHtml(entry)
                + '" title="'
                + escapeHtml(entry)
                + '">'
                + escapeHtml(entry)
                + '</button>';
        }).join('');

        container.hidden = false;
    }

    function parseIntOrZero(value) {
        var parsed = parseInt(String(value || '').replace(/[^\d-]/g, ''), 10);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }

    function setText(selector, value) {
        var el = document.querySelector(selector);
        if (el) {
            el.textContent = String(value);
        }
    }

    function getTacticalOverviewNode() {
        return document.querySelector('.tactical-overview');
    }

    function getTacticalOverviewUrl() {
        var tactical = getTacticalOverviewNode();
        if (tactical && tactical.dataset.tacticalUrl) {
            return tactical.dataset.tacticalUrl;
        }

        return getBaseUrl() + '/icingadb/tactical';
    }

    function parseCompactNumber(value) {
        var text = normalizeText(value).toLowerCase();
        var multiplier = 1;
        var raw;
        var number;

        if (! text.length) {
            return 0;
        }

        text = text.replace(/^~/, '').replace(/,/g, '');
        if (text.slice(-1) === 'k') {
            multiplier = 1000;
            text = text.slice(0, -1);
        }

        raw = text.match(/-?\d+(\.\d+)?/);
        if (! raw) {
            return 0;
        }

        number = parseFloat(raw[0]);
        if (! Number.isFinite(number)) {
            return 0;
        }

        return Math.max(0, Math.round(number * multiplier));
    }

    function formatTotal(count) {
        return 'Total ' + String(parseIntOrZero(count));
    }

    function hasClassToken(tokens, expected) {
        return tokens.indexOf(expected) !== -1 || tokens.indexOf('state-' + expected) !== -1;
    }

    function stateCountFromBadges(container, state, mode) {
        var candidates = container.querySelectorAll('.state-badges .state-badge, .state-badges [class*="state-"]');
        var i;
        var tokens;
        var isState;
        var isHandled;
        var count;

        for (i = 0; i < candidates.length; i++) {
            tokens = String(candidates[i].className || '').toLowerCase().split(/\s+/);
            isState = hasClassToken(tokens, state);

            if (! isState) {
                continue;
            }

            isHandled = hasClassToken(tokens, 'handled') || hasClassToken(tokens, state + '-handled');
            if (mode === 'handled' && ! isHandled) {
                continue;
            }

            if (mode === 'unhandled' && isHandled) {
                continue;
            }

            count = parseCompactNumber(candidates[i].textContent);
            return count;
        }

        return 0;
    }

    function buildDonutGradient(slices, total) {
        var current = 0;
        var parts = [];
        var i;
        var slice;
        var amount;
        var next;

        if (! total || total <= 0) {
            return 'conic-gradient(from -90deg, ' + TACTICAL_COLORS.empty + ', ' + TACTICAL_COLORS.empty + ')';
        }

        for (i = 0; i < slices.length; i++) {
            slice = slices[i];
            amount = parseIntOrZero(slice.value);
            if (! amount) {
                continue;
            }

            next = current + (amount / total) * 360;
            parts.push(slice.color + ' ' + current + 'deg ' + next + 'deg');
            current = next;
        }

        if (! parts.length) {
            return 'conic-gradient(from -90deg, ' + TACTICAL_COLORS.empty + ', ' + TACTICAL_COLORS.empty + ')';
        }

        return 'conic-gradient(from -90deg, ' + parts.join(', ') + ')';
    }

    function parseTacticalCard(container, type) {
        var meta = container.querySelector('.meta');
        var big = container.querySelector('.donut-label-big');
        var small = container.querySelector('.donut-label-small');

        if (type === 'host') {
            return {
                total: parseCompactNumber(meta ? meta.textContent : ''),
                primary: parseCompactNumber(big ? big.textContent : ''),
                primaryLabel: normalizeText(small ? small.textContent : 'Down') || 'Down',
                up: stateCountFromBadges(container, 'up', 'any') || stateCountFromBadges(container, 'ok', 'any'),
                downUnhandled: stateCountFromBadges(container, 'down', 'unhandled')
                    || stateCountFromBadges(container, 'critical', 'unhandled'),
                downHandled: stateCountFromBadges(container, 'down', 'handled')
                    || stateCountFromBadges(container, 'critical', 'handled'),
                pending: stateCountFromBadges(container, 'pending', 'any')
            };
        }

        return {
            total: parseCompactNumber(meta ? meta.textContent : ''),
            primary: parseCompactNumber(big ? big.textContent : ''),
            primaryLabel: normalizeText(small ? small.textContent : 'Critical') || 'Critical',
            ok: stateCountFromBadges(container, 'ok', 'any'),
            warningUnhandled: stateCountFromBadges(container, 'warning', 'unhandled'),
            warningHandled: stateCountFromBadges(container, 'warning', 'handled'),
            criticalUnhandled: stateCountFromBadges(container, 'critical', 'unhandled'),
            criticalHandled: stateCountFromBadges(container, 'critical', 'handled'),
            unknownUnhandled: stateCountFromBadges(container, 'unknown', 'unhandled'),
            unknownHandled: stateCountFromBadges(container, 'unknown', 'handled'),
            pending: stateCountFromBadges(container, 'pending', 'any')
        };
    }

    function parseTacticalOverviewFromHtml(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var cards = doc.querySelectorAll('.donut-container');
        var result = { host: null, service: null };
        var i;
        var title;

        for (i = 0; i < cards.length; i++) {
            title = normalizeText(cards[i].querySelector('h2') ? cards[i].querySelector('h2').textContent : '').toLowerCase();

            if (! result.host && title.indexOf('host') !== -1) {
                result.host = parseTacticalCard(cards[i], 'host');
            } else if (! result.service && title.indexOf('service') !== -1) {
                result.service = parseTacticalCard(cards[i], 'service');
            }
        }

        return result;
    }

    function renderHostTactical(host) {
        var total = host.total || (host.up + host.downHandled + host.downUnhandled + host.pending);
        var primary = host.primary || host.downUnhandled;
        var donut = document.querySelector('[data-to-host-donut]');
        var legend = document.querySelector('[data-to-host-legend]');

        setText('[data-to-host-total]', formatTotal(total));
        setText('[data-to-host-down]', primary);

        if (donut) {
            donut.style.background = buildDonutGradient([
                { value: host.up, color: TACTICAL_COLORS.ok },
                { value: host.downHandled, color: TACTICAL_COLORS.criticalHandled },
                { value: host.downUnhandled, color: TACTICAL_COLORS.critical },
                { value: host.pending, color: TACTICAL_COLORS.pending }
            ], total);
        }

        if (legend) {
            legend.textContent = 'DOWN ' + host.downUnhandled + '/' + host.downHandled
                + ' • UP ' + host.up
                + ' • PEND ' + host.pending;
        }
    }

    function renderServiceTactical(service) {
        var total = service.total
            || (
                service.ok
                + service.warningUnhandled
                + service.warningHandled
                + service.criticalUnhandled
                + service.criticalHandled
                + service.unknownUnhandled
                + service.unknownHandled
                + service.pending
            );
        var primary = service.primary || service.criticalUnhandled;
        var donut = document.querySelector('[data-to-service-donut]');
        var legend = document.querySelector('[data-to-service-legend]');

        setText('[data-to-service-total]', formatTotal(total));
        setText('[data-to-service-critical]', primary);

        if (donut) {
            donut.style.background = buildDonutGradient([
                { value: service.ok, color: TACTICAL_COLORS.ok },
                { value: service.warningHandled, color: TACTICAL_COLORS.warningHandled },
                { value: service.warningUnhandled, color: TACTICAL_COLORS.warning },
                { value: service.criticalHandled, color: TACTICAL_COLORS.criticalHandled },
                { value: service.criticalUnhandled, color: TACTICAL_COLORS.critical },
                { value: service.unknownHandled, color: TACTICAL_COLORS.unknownHandled },
                { value: service.unknownUnhandled, color: TACTICAL_COLORS.unknown },
                { value: service.pending, color: TACTICAL_COLORS.pending }
            ], total);
        }

        if (legend) {
            legend.textContent = 'CRIT ' + service.criticalUnhandled + '/' + service.criticalHandled
                + ' • WARN ' + service.warningUnhandled + '/' + service.warningHandled
                + ' • UNK ' + service.unknownUnhandled + '/' + service.unknownHandled
                + ' • OK ' + service.ok
                + ' • PEND ' + service.pending;
        }
    }

    function renderTacticalOverviewData(data) {
        if (data.host) {
            renderHostTactical(data.host);
        }

        if (data.service) {
            renderServiceTactical(data.service);
        }
    }

    function renderTacticalOverviewError() {
        setText('[data-to-host-total]', 'Total --');
        setText('[data-to-service-total]', 'Total --');
        setText('[data-to-host-down]', '--');
        setText('[data-to-service-critical]', '--');
        setText('[data-to-host-legend]', 'Unable to load tactical data');
        setText('[data-to-service-legend]', 'Open Tactical Overview');
    }

    function refreshTacticalOverview(forceRender) {
        if (! getTacticalOverviewNode() || tacticalState.inFlight) {
            return;
        }

        tacticalState.inFlight = true;

        fetch(getTacticalOverviewUrl(), {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store'
        })
            .then(function (response) {
                if (! response.ok) {
                    throw new Error('Request failed with status ' + response.status);
                }

                return response.text();
            })
            .then(function (html) {
                var data = parseTacticalOverviewFromHtml(html);
                var signature = JSON.stringify(data);

                if (! data.host && ! data.service) {
                    throw new Error('No tactical cards found');
                }

                if (forceRender || signature !== tacticalState.lastSignature) {
                    renderTacticalOverviewData(data);
                    tacticalState.lastSignature = signature;
                }
            })
            .catch(function () {
                if (! tacticalState.lastSignature.length || forceRender) {
                    renderTacticalOverviewError();
                }
            })
            .then(function () {
                tacticalState.inFlight = false;
            }, function () {
                tacticalState.inFlight = false;
            });
    }

    function startTacticalOverviewPolling() {
        if (! getTacticalOverviewNode()) {
            return;
        }

        refreshTacticalOverview(true);

        if (tacticalState.pollingTimer !== null) {
            window.clearInterval(tacticalState.pollingTimer);
        }

        tacticalState.pollingTimer = window.setInterval(function () {
            if (! document.hidden) {
                refreshTacticalOverview(false);
            }
        }, TACTICAL_REFRESH_MS);
    }
