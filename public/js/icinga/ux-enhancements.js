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
    var UX_DENSITY_MODES = ['compact', 'comfortable', 'wallboard'];
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
        activeIndex: 0
    };
    var operatorAuditState = {
        filter: 'all'
    };
    var incidentDrawerState = {
        url: '',
        abortController: null,
        timelineAbortController: null,
        object: null,
        focusTimeline: false
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
        sourceSignature: '',
        saveTimer: null,
        inFlight: false
    };
    var quickMenuContextState = {
        anchor: null
    };
    var quickNotebookState = {
        initialized: false,
        visible: false,
        dirty: false,
        drag: null
    };

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
            refreshTacticalOverview(false);
        }, TACTICAL_REFRESH_MS);
    }

    function getTacticalContainer() {
        return document.getElementById('header-logo-container');
    }

    function getTopEventsPanel() {
        return document.getElementById('top-events-panel');
    }

    function getTriageModeToggle() {
        return document.querySelector('[data-triage-mode-toggle]');
    }

    function getTriageDesk() {
        return document.getElementById('triage-desk-modal');
    }

    function isTriageDeskOpen() {
        var modal = getTriageDesk();

        return !! modal && ! modal.hidden;
    }

    function getTriageDeskLabel(key, fallback) {
        var modal = getTriageDesk();

        if (modal && modal.dataset && modal.dataset[key]) {
            return modal.dataset[key];
        }

        return fallback;
    }

    function getOperatorHandoff() {
        return document.getElementById('operator-handoff-modal');
    }

    function isOperatorHandoffOpen() {
        var modal = getOperatorHandoff();

        return !! modal && ! modal.hidden;
    }

    function getOperatorHandoffLabel(key, fallback) {
        var modal = getOperatorHandoff();

        if (modal && modal.dataset && modal.dataset[key]) {
            return modal.dataset[key];
        }

        return fallback;
    }

    function getOperatorActivity() {
        return document.getElementById('operator-activity-modal');
    }

    function isOperatorActivityOpen() {
        var modal = getOperatorActivity();

        return !! modal && ! modal.hidden;
    }

    function getOperatorActivityLabel(key, fallback) {
        var modal = getOperatorActivity();

        if (modal && modal.dataset && modal.dataset[key]) {
            return modal.dataset[key];
        }

        return fallback;
    }

    function getOperatorPlaybook() {
        return document.getElementById('operator-playbook-modal');
    }

    function isOperatorPlaybookOpen() {
        var modal = getOperatorPlaybook();

        return !! modal && ! modal.hidden;
    }

    function getOperatorPlaybookLabel(key, fallback) {
        var modal = getOperatorPlaybook();

        if (modal && modal.dataset && modal.dataset[key]) {
            return modal.dataset[key];
        }

        return fallback;
    }

    function getOperatorToastRegion() {
        return document.getElementById('operator-toast-region');
    }

    function showOperatorToast(message, tone) {
        var region = getOperatorToastRegion();
        var toast;
        var toasts;

        if (! region || ! normalizeText(message).length) {
            return;
        }

        toast = document.createElement('div');
        toast.className = 'operator-toast ' + (tone || 'success');
        toast.setAttribute('role', 'status');
        toast.textContent = message;
        region.appendChild(toast);

        toasts = region.querySelectorAll('.operator-toast');
        if (toasts.length > 4) {
            region.removeChild(toasts[0]);
        }

        window.setTimeout(function () {
            if (toast.parentNode === region) {
                region.removeChild(toast);
            }
        }, OPERATOR_TOAST_TIMEOUT_MS);
    }

    function getTopEventsSummary() {
        return document.querySelector('[data-top-events-summary]');
    }

    function getTopEventsPanelLabel(key, fallback) {
        var panel = getTopEventsPanel();

        if (panel && panel.dataset && panel.dataset[key]) {
            return panel.dataset[key];
        }

        return fallback;
    }

    function updateTriageModeToggle() {
        var enabled = isTriageModeEnabled();
        var panel = getTopEventsPanel();
        var toggle = getTriageModeToggle();

        if (panel) {
            panel.classList.toggle('triage-mode', enabled);
        }

        if (! toggle) {
            return;
        }

        toggle.textContent = enabled
            ? getTopEventsPanelLabel('triageOnLabel', 'Triage on')
            : getTopEventsPanelLabel('triageOffLabel', 'Triage');
        toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        toggle.classList.toggle('active', enabled);
    }

    function setTriageMode(enabled) {
        writeTriageMode(enabled);
        updateTriageModeToggle();
        recordOperatorActivity('Triage', enabled ? 'Enabled triage mode' : 'Disabled triage mode', '', '');
        rerenderCachedTopEvents();
        refreshTopEvents(true);
    }

    function updateTopEventsSummary(stats) {
        var summary = getTopEventsSummary();
        var activeLabel = getTopEventsPanelLabel('triageActiveLabel', 'active');
        var hiddenLabel = getTopEventsPanelLabel('triageHiddenLabel', 'hidden');

        if (! summary) {
            return;
        }

        if (! stats || ! stats.total) {
            summary.hidden = true;
            summary.textContent = '';
            return;
        }

        summary.hidden = false;
        summary.innerHTML = '<strong>' + String(stats.active) + '</strong> '
            + escapeHtml(activeLabel)
            + ' / <strong>'
            + String(stats.hidden)
            + '</strong> '
            + escapeHtml(hiddenLabel);
        summary.title = String(stats.total) + ' latest parsed events';
    }

    function getTacticalResizer() {
        return document.getElementById('tactical-overview-resizer');
    }

    function getTopEventsResizer() {
        return document.getElementById('top-events-resizer');
    }

    function getTopPanelsWidthResizer() {
        return document.getElementById('top-panels-width-resizer');
    }

    function getTopWidgetTargets() {
        return [getTacticalContainer(), getTopEventsPanel()].filter(Boolean);
    }

    function getLayoutRoot() {
        return document.getElementById('layout');
    }

    function setTopWidgetResizingClass(active) {
        var layout = getLayoutRoot();

        document.documentElement.classList.toggle('top-widget-resizing', active);

        if (layout) {
            layout.classList.toggle('top-widget-resizing', active);
        }
    }

    function setTopPanelsWidthResizingClass(active) {
        var layout = getLayoutRoot();

        document.documentElement.classList.toggle('top-panels-width-resizing', active);

        if (layout) {
            layout.classList.toggle('top-panels-width-resizing', active);
        }
    }

    function setTopPanelsOffset(px) {
        var offset = clamp(px, TOP_PANELS_OFFSET_MIN, TOP_PANELS_OFFSET_MAX);
        document.documentElement.style.setProperty('--ux-top-panels-offset', offset + 'px');

        return offset;
    }

    function clearTopPanelsOffset() {
        document.documentElement.style.removeProperty('--ux-top-panels-offset');
    }

    function getCurrentTopPanelsOffset() {
        var raw = window.getComputedStyle(document.documentElement).getPropertyValue('--ux-top-panels-offset');
        var parsed = parseFloat(String(raw || '').replace(/[^\d.-]/g, ''));

        return Number.isFinite(parsed) ? parsed : 0;
    }

    function readSavedTopPanelsOffset() {
        try {
            return parseInt(window.localStorage.getItem(TOP_PANELS_OFFSET_KEY), 10);
        } catch (error) {
            return NaN;
        }
    }

    function saveTopPanelsOffset(px) {
        try {
            window.localStorage.setItem(
                TOP_PANELS_OFFSET_KEY,
                String(clamp(px, TOP_PANELS_OFFSET_MIN, TOP_PANELS_OFFSET_MAX))
            );
        } catch (error) {
            // Ignore storage errors
        }
    }

    function applySavedTopPanelsOffset() {
        var saved = readSavedTopPanelsOffset();
        if (Number.isFinite(saved)) {
            setTopPanelsOffset(saved);
        } else {
            clearTopPanelsOffset();
        }
    }

    function onTopPanelsWidthResizeMove(event) {
        if (! topPanelsWidthResizeState) {
            return;
        }

        event.preventDefault();
        setTopPanelsOffset(topPanelsWidthResizeState.startOffset + (event.clientX - topPanelsWidthResizeState.startX));
    }

    function onTopPanelsWidthResizeEnd() {
        if (! topPanelsWidthResizeState) {
            return;
        }

        saveTopPanelsOffset(getCurrentTopPanelsOffset());

        topPanelsWidthResizeState = null;
        setTopPanelsWidthResizingClass(false);
        window.removeEventListener('mousemove', onTopPanelsWidthResizeMove);
        window.removeEventListener('mouseup', onTopPanelsWidthResizeEnd);
    }

    function onTopPanelsWidthResizeStart(event) {
        if (event.button !== 0) {
            return;
        }

        topPanelsWidthResizeState = {
            startX: event.clientX,
            startOffset: getCurrentTopPanelsOffset()
        };

        setTopPanelsWidthResizingClass(true);
        window.addEventListener('mousemove', onTopPanelsWidthResizeMove);
        window.addEventListener('mouseup', onTopPanelsWidthResizeEnd);
        event.preventDefault();
    }

    function onTopPanelsWidthResizeKeydown(event) {
        var current;
        var next;

        current = getCurrentTopPanelsOffset();
        next = current;

        if (event.key === 'ArrowLeft') {
            next = current - 14;
        } else if (event.key === 'ArrowRight') {
            next = current + 14;
        } else if (event.key === 'Home') {
            next = TOP_PANELS_OFFSET_MIN;
        } else if (event.key === 'End') {
            next = TOP_PANELS_OFFSET_MAX;
        } else {
            return;
        }

        event.preventDefault();
        next = setTopPanelsOffset(next);
        saveTopPanelsOffset(next);
    }

    function initTopPanelsWidthResizer() {
        var resizer = getTopPanelsWidthResizer();

        if (! resizer) {
            return;
        }

        applySavedTopPanelsOffset();
        resizer.addEventListener('mousedown', onTopPanelsWidthResizeStart);
        resizer.addEventListener('keydown', onTopPanelsWidthResizeKeydown);
    }

    function setTopWidgetHeight(px) {
        var height = clamp(px, TOP_WIDGET_MIN_HEIGHT, TOP_WIDGET_MAX_HEIGHT);

        document.documentElement.style.setProperty('--top-widget-height', height + 'px');
        getTopWidgetTargets().forEach(function (el) {
            el.style.height = height + 'px';
        });

        return height;
    }

    function clearTopWidgetHeight() {
        document.documentElement.style.removeProperty('--top-widget-height');
        getTopWidgetTargets().forEach(function (el) {
            el.style.height = '';
        });
    }

    function readSavedTopWidgetHeight() {
        try {
            return parseInt(window.localStorage.getItem(TOP_WIDGET_HEIGHT_KEY), 10);
        } catch (error) {
            return NaN;
        }
    }

    function saveTopWidgetHeight(px) {
        try {
            window.localStorage.setItem(TOP_WIDGET_HEIGHT_KEY, String(clamp(px, TOP_WIDGET_MIN_HEIGHT, TOP_WIDGET_MAX_HEIGHT)));
        } catch (error) {
            // Ignore storage errors
        }
    }

    function applySavedTopWidgetHeight() {
        var tactical;
        var saved = readSavedTopWidgetHeight();

        if (Number.isFinite(saved)) {
            setTopWidgetHeight(saved);
        } else {
            tactical = getTacticalContainer();
            if (tactical) {
                setTopWidgetHeight(tactical.getBoundingClientRect().height);
            } else {
                clearTopWidgetHeight();
            }
        }
    }

    function onTopWidgetResizeMove(event) {
        if (! topWidgetResizeState) {
            return;
        }

        event.preventDefault();
        var delta = event.clientY - topWidgetResizeState.startY;
        setTopWidgetHeight(topWidgetResizeState.startHeight + delta);
    }

    function onTopWidgetResizeEnd() {
        if (! topWidgetResizeState) {
            return;
        }

        var tactical = getTacticalContainer();
        if (tactical) {
            saveTopWidgetHeight(tactical.getBoundingClientRect().height);
        }

        topWidgetResizeState = null;
        setTopWidgetResizingClass(false);
        window.removeEventListener('mousemove', onTopWidgetResizeMove);
        window.removeEventListener('mouseup', onTopWidgetResizeEnd);
    }

    function onTopWidgetResizeStart(event) {
        var tactical = getTacticalContainer();
        if (! tactical || event.button !== 0) {
            return;
        }

        topWidgetResizeState = {
            startY: event.clientY,
            startHeight: tactical.getBoundingClientRect().height
        };

        setTopWidgetResizingClass(true);
        window.addEventListener('mousemove', onTopWidgetResizeMove);
        window.addEventListener('mouseup', onTopWidgetResizeEnd);
        event.preventDefault();
    }

    function onTopWidgetResizeKeydown(event) {
        var tactical = getTacticalContainer();
        if (! tactical) {
            return;
        }

        var current = tactical.getBoundingClientRect().height;
        var next = current;

        if (event.key === 'ArrowUp') {
            next = current - 12;
        } else if (event.key === 'ArrowDown') {
            next = current + 12;
        } else if (event.key === 'Home') {
            next = TOP_WIDGET_MIN_HEIGHT;
        } else if (event.key === 'End') {
            next = TOP_WIDGET_MAX_HEIGHT;
        } else {
            return;
        }

        event.preventDefault();
        setTopWidgetHeight(next);
        saveTopWidgetHeight(next);
    }

    function initTopWidgetResizers() {
        var tacticalResizer = getTacticalResizer();
        var topResizer = getTopEventsResizer();
        var tactical = getTacticalContainer();
        var topEvents = getTopEventsPanel();

        if (! tactical || ! topEvents) {
            return;
        }

        applySavedTopWidgetHeight();

        if (tacticalResizer) {
            tacticalResizer.addEventListener('mousedown', onTopWidgetResizeStart);
            tacticalResizer.addEventListener('keydown', onTopWidgetResizeKeydown);
        }

        if (topResizer) {
            topResizer.addEventListener('mousedown', onTopWidgetResizeStart);
            topResizer.addEventListener('keydown', onTopWidgetResizeKeydown);
        }

        window.addEventListener('resize', function () {
            if (! Number.isFinite(readSavedTopWidgetHeight())) {
                var currentTactical = getTacticalContainer();
                if (currentTactical) {
                    setTopWidgetHeight(currentTactical.getBoundingClientRect().height);
                }
            }
        });
    }

    function getTopEventsHistoryUrl() {
        var panel = getTopEventsPanel();
        if (panel && panel.dataset.historyUrl) {
            return panel.dataset.historyUrl;
        }

        return getBaseUrl() + '/icingadb/history';
    }

    function getTopEventsRequestUrl() {
        var url;

        try {
            url = new URL(getTopEventsHistoryUrl(), window.location.href);
            url.searchParams.set('view', 'detailed');
            return url.toString();
        } catch (error) {
            return getTopEventsHistoryUrl();
        }
    }

    function isHistoryOverviewLocation() {
        return /\/icingadb\/history\b/i.test(window.location.pathname + window.location.search);
    }

    function getHistoryEventBlock(target) {
        if (! target || ! isHistoryOverviewLocation()) {
            return null;
        }

        if (target.closest('button, input, select, textarea, .controls, .pagination, .tabs, [role="button"]')) {
            return null;
        }

        return target.closest('[data-action-item], .action-list li, .item-list li, .state-row, tr, article, .history-event, .event, .list-item');
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeTopEventUrl(url) {
        var value = String(url || '').trim();
        var parsed;

        if (! value.length || value === '#') {
            return '';
        }

        if (/^javascript:/i.test(value)) {
            return '';
        }

        try {
            parsed = new URL(value, window.location.href);

            // Keep internal links relative so Icinga's AJAX navigation can intercept them
            if (parsed.origin === window.location.origin) {
                return parsed.pathname + parsed.search + parsed.hash;
            }

            return parsed.toString();
        } catch (error) {
            return '';
        }
    }

    function getTopEventDetailsUrlById(eventId) {
        var baseUrl = getBaseUrl();
        var cleanId = String(eventId || '').trim();

        if (! /^[a-f0-9]{40}$/i.test(cleanId)) {
            return '';
        }

        return (baseUrl ? (baseUrl + '/') : '/') + 'icingadb/event?id=' + encodeURIComponent(cleanId);
    }

    function extractEventIdFromText(text) {
        var source = decodeHtmlEntities(text);
        var decoded = source;
        var match = source.match(/[?&]id=([a-f0-9]{40})\b/i);

        try {
            decoded = decodeURIComponent(source);
        } catch (error) {
            decoded = source;
        }

        if (! match) {
            match = decoded.match(/[?&]id=([a-f0-9]{40})\b/i);
        }

        if (! match) {
            match = decoded.match(/(?:^|[\s"';&(])id\s*[:=]\s*["']?([a-f0-9]{40})\b/i);
        }

        if (! match) {
            match = decoded.match(/\b(?:event-id|event_id|data-event-id|detail-filter|data-detail-filter)\b[^a-f0-9]{0,80}([a-f0-9]{40})\b/i);
        }

        if (! match) {
            match = decoded.match(/\bid=["']?event[-_]?([a-f0-9]{40})\b/i);
        }

        return match ? match[1] : '';
    }

    function extractSingleHexIdFromText(text) {
        var source = decodeHtmlEntities(text);
        var matches = source.match(/\b[a-f0-9]{40}\b/ig) || [];
        var unique = {};
        var ids = [];
        var i;

        for (i = 0; i < matches.length; i++) {
            if (unique[matches[i]]) {
                continue;
            }

            unique[matches[i]] = true;
            ids.push(matches[i]);
        }

        if (ids.length === 1) {
            return ids[0];
        }

        return '';
    }

    function isTopEventDetailsUrl(url) {
        var value = String(url || '');
        return /\/icingadb\/event\b/i.test(value) && /[?&]id=[a-f0-9]{40}\b/i.test(value);
    }

    function decodeHtmlEntities(value) {
        var text = String(value || '');
        return text
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#039;/gi, '\'')
            .replace(/&#x2F;/gi, '/')
            .replace(/\\\//g, '/');
    }

    function extractEventDetailsUrlFromText(text) {
        var source = decodeHtmlEntities(text);
        var match = source.match(/((?:https?:)?\/\/[^"'<> \t\r\n]*\/icingadb\/event\?[^"'<> \t\r\n]*\bid=[a-f0-9]{40}\b[^"'<> \t\r\n]*)/i);
        var candidate;
        var eventId;

        if (! match) {
            match = source.match(/((?:\/|\.\/|\.\.\/)?(?:[^"'<> \t\r\n]*\/)?icingadb\/event\?[^"'<> \t\r\n]*\bid=[a-f0-9]{40}\b[^"'<> \t\r\n]*)/i);
        }

        if (match) {
            candidate = normalizeTopEventUrl(match[1]);
            if (candidate && isTopEventDetailsUrl(candidate)) {
                return candidate;
            }
        }

        eventId = extractEventIdFromText(source);
        if (eventId) {
            return getTopEventDetailsUrlById(eventId);
        }

        return '';
    }

    function pickEventBlocks(doc) {
        var root = doc.querySelector('#col1 .content') || doc.querySelector('.content') || doc.body;
        if (! root) {
            return [];
        }

        var selectors = ['.action-list [data-action-item]', '[data-action-item]', 'tbody tr', '.list-item', 'article', '.event', 'li'];
        var blocks = [];
        selectors.forEach(function (selector) {
            if (! blocks.length) {
                blocks = Array.prototype.slice.call(root.querySelectorAll(selector));
            }
        });

        return blocks.slice(0, 24);
    }

    function extractEventUrl(block, titleEl) {
        var candidate = null;
        var actionItem;
        var anchors;
        var detailsAnchors;
        var attributeNodes;
        var attributeNames = [
            'href',
            'data-href',
            'data-url',
            'data-action-url',
            'data-icinga-url',
            'data-detail-filter',
            'data-icinga-detail-filter',
            'data-filter',
            'onclick',
            'id',
            'data-id',
            'data-event-id'
        ];
        var attrNames = attributeNames;
        var attrValue;
        var eventId;
        var actionList;
        var detailFilter;
        var j;
        var i;

        actionItem = block.matches('[data-action-item]')
            ? block
            : (block.closest('[data-action-item]') || block.querySelector('[data-action-item]'));

        if (actionItem) {
            actionList = actionItem.closest('[data-icinga-detail-url]') || block.closest('[data-icinga-detail-url]');
            detailFilter = actionItem.getAttribute('data-icinga-detail-filter');
        } else {
            actionList = block.closest('[data-icinga-detail-url]');
            detailFilter = block.getAttribute('data-icinga-detail-filter');
        }

        if (actionList && detailFilter) {
            candidate = normalizeTopEventUrl(actionList.getAttribute('data-icinga-detail-url') + '?' + detailFilter);
            if (candidate && isTopEventDetailsUrl(candidate)) {
                return candidate;
            }

            eventId = extractEventIdFromText(detailFilter);
            if (eventId) {
                candidate = getTopEventDetailsUrlById(eventId);
                if (candidate) {
                    return candidate;
                }
            }
        }

        candidate = extractEventDetailsUrlFromText(block.outerHTML);
        if (candidate) {
            return candidate;
        }

        detailsAnchors = block.querySelectorAll('a[href*="/icingadb/event"], a[href*="event?id="]');
        for (i = 0; i < detailsAnchors.length; i++) {
            candidate = normalizeTopEventUrl(detailsAnchors[i].getAttribute('href'));
            if (candidate && isTopEventDetailsUrl(candidate)) {
                return candidate;
            }
        }

        attributeNodes = block.querySelectorAll('*');
        for (i = 0; i < attributeNodes.length; i++) {
            for (j = 0; j < attributeNames.length; j++) {
                attrValue = attributeNodes[i].getAttribute(attributeNames[j]);
                if (! attrValue) {
                    continue;
                }

                candidate = extractEventDetailsUrlFromText(attrValue);
                if (candidate) {
                    return candidate;
                }

                eventId = extractEventIdFromText(attrValue);
                if (eventId) {
                    candidate = getTopEventDetailsUrlById(eventId);
                    if (candidate) {
                        return candidate;
                    }
                }
            }
        }

        if (titleEl && titleEl.tagName && titleEl.tagName.toLowerCase() === 'a') {
            candidate = normalizeTopEventUrl(titleEl.getAttribute('href'));
            if (candidate) {
                if (isTopEventDetailsUrl(candidate)) {
                    return candidate;
                }
            }
        }

        for (i = 0; i < attrNames.length; i++) {
            attrValue = block.getAttribute(attrNames[i]);
            if (! attrValue) {
                continue;
            }

            candidate = normalizeTopEventUrl(attrValue);
            if (candidate && isTopEventDetailsUrl(candidate)) {
                return candidate;
            }

            eventId = extractEventIdFromText(attrValue);
            if (eventId) {
                candidate = getTopEventDetailsUrlById(eventId);
                if (candidate) {
                    return candidate;
                }
            }
        }

        eventId = extractEventIdFromText(block.outerHTML);
        if (eventId) {
            candidate = getTopEventDetailsUrlById(eventId);
            if (candidate) {
                return candidate;
            }
        }

        eventId = extractSingleHexIdFromText(block.outerHTML);
        if (eventId) {
            candidate = getTopEventDetailsUrlById(eventId);
            if (candidate) {
                return candidate;
            }
        }

        anchors = block.querySelectorAll('a[href]');
        for (i = 0; i < anchors.length; i++) {
            candidate = normalizeTopEventUrl(anchors[i].getAttribute('href'));
            if (candidate) {
                if (isTopEventDetailsUrl(candidate)) {
                    return candidate;
                }

                // Keep a non-details fallback only if details URL cannot be derived
                return candidate;
            }
        }

        return '';
    }

    function extractEvent(block) {
        var titleEl = block.querySelector('h1, h2, h3, h4, a, strong, .subject, .title');
        var title = normalizeText(titleEl ? titleEl.textContent : '');
        var text = normalizeText(block.textContent);
        var metaParts = [];
        var state = extractEventState(block, text);
        var url = extractEventUrl(block, titleEl);

        if (! title.length && text.length) {
            title = text.split(/ [|-] /)[0];
        }

        if (! title.length || title.length < 3) {
            return null;
        }

        Array.prototype.slice.call(
            block.querySelectorAll('time, .time, .meta, .state, .badge, .plugin-output, .author, .comment-time')
        ).forEach(function (el) {
            var part = normalizeText(el.textContent);
            if (part.length && metaParts.indexOf(part) === -1) {
                metaParts.push(part);
            }
        });

        if (! metaParts.length && text.length > title.length) {
            metaParts.push(normalizeText(text.replace(title, '')).slice(0, 160));
        }

        return {
            title: title.slice(0, 220),
            meta: metaParts.join(' • ').slice(0, 220),
            preview: text.slice(0, 800),
            state: state.state,
            handled: state.handled,
            url: url
        };
    }

    function detectStateFromClassTokens(tokens) {
        var i;
        var token;

        for (i = 0; i < tokens.length; i++) {
            token = tokens[i];
            if (
                token === 'state-critical'
                || token === 'critical'
                || token === 'severity-critical'
                || token === 'state-down'
                || token === 'down'
                || token === 'state-unreachable'
                || token === 'unreachable'
            ) {
                return 'critical';
            }
        }

        for (i = 0; i < tokens.length; i++) {
            token = tokens[i];
            if (token === 'state-warning' || token === 'warning' || token === 'severity-warning') {
                return 'warning';
            }
        }

        for (i = 0; i < tokens.length; i++) {
            token = tokens[i];
            if (token === 'state-unknown' || token === 'unknown' || token === 'severity-unknown') {
                return 'unknown';
            }
        }

        for (i = 0; i < tokens.length; i++) {
            token = tokens[i];
            if (token === 'state-pending' || token === 'pending' || token === 'state-not-checked' || token === 'not-checked') {
                return 'pending';
            }
        }

        for (i = 0; i < tokens.length; i++) {
            token = tokens[i];
            if (token === 'state-ok' || token === 'ok' || token === 'state-up' || token === 'up' || token === 'severity-ok') {
                return 'ok';
            }
        }

        return '';
    }

    function extractEventState(block, text) {
        var classes = [];
        var classMap = {};
        var handled = false;
        var state = '';
        var lowerText = String(text || '').toLowerCase();

        Array.prototype.slice.call(
            block.querySelectorAll('[class*="state-"], .state, .badge, .state-badge, [class*="severity-"], .handled')
        ).concat([block]).forEach(function (node) {
            String(node.className || '')
                .toLowerCase()
                .split(/\s+/)
                .forEach(function (token) {
                    if (! token.length || classMap[token]) {
                        return;
                    }

                    classMap[token] = true;
                    classes.push(token);
                });
        });

        state = detectStateFromClassTokens(classes);
        handled = classes.indexOf('handled') !== -1
            || classes.indexOf('acknowledged') !== -1
            || classes.indexOf('in-downtime') !== -1
            || /\b(acknowledged|in downtime|handled)\b/i.test(lowerText);

        if (! state.length) {
            if (/\b(critical|down|unreachable)\b/i.test(lowerText)) {
                state = 'critical';
            } else if (/\bwarning\b/i.test(lowerText)) {
                state = 'warning';
            } else if (/\bunknown\b/i.test(lowerText)) {
                state = 'unknown';
            } else if (/\b(pending|not checked)\b/i.test(lowerText)) {
                state = 'pending';
            } else if (/\b(ok|up)\b/i.test(lowerText)) {
                state = 'ok';
            }
        }

        return {
            state: state,
            handled: handled
        };
    }

    function parseLatestEventsFromHistoryHtml(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var blocks = pickEventBlocks(doc);
        var results = [];
        var signatures = {};

        for (var i = 0; i < blocks.length; i++) {
            var event = extractEvent(blocks[i]);
            if (! event) {
                continue;
            }

            var signature = event.title + '|' + event.meta + '|' + event.preview + '|' + event.state + '|' + String(event.handled) + '|' + event.url;
            if (signatures[signature]) {
                continue;
            }

            signatures[signature] = true;
            results.push(event);

            if (results.length >= TOP_EVENTS_BUFFER_LIMIT) {
                break;
            }
        }

        return results;
    }

    function isTriageEvent(item) {
        var triageStates = {
            critical: true,
            warning: true,
            unknown: true,
            pending: true
        };

        if (! item || ! item.url || item.handled || isIncidentSeen(item.url)) {
            return false;
        }

        return Boolean(triageStates[item.state]);
    }

    function getTopEventsTriageStats(items) {
        var stats = {
            active: 0,
            hidden: 0,
            total: 0
        };

        items.forEach(function (item) {
            if (! item || ! item.url) {
                return;
            }

            stats.total += 1;
            if (! isIncidentSnoozed(item.url) && isTriageEvent(item)) {
                stats.active += 1;
            } else {
                stats.hidden += 1;
            }
        });

        return stats;
    }

    function getActiveTriageEvents() {
        return topEventsState.items.filter(function (item) {
            return item && item.url && ! isIncidentSnoozed(item.url) && isTriageEvent(item);
        });
    }

    function getActiveTriageEventByUrl(url) {
        var normalized = normalizeIncidentUrl(url);

        return getActiveTriageEvents().filter(function (item) {
            return normalizeIncidentUrl(item.url) === normalized;
        })[0] || null;
    }

    function getOperatorFocusBoard() {
        return document.querySelector('[data-operator-focus-board]');
    }

    function getOperatorFocusLabel(key, fallback) {
        var board = getOperatorFocusBoard();

        if (board && board.dataset && board.dataset[key]) {
            return board.dataset[key];
        }

        return fallback;
    }

    function getOperatorFocusStateWeight(state) {
        var weights = {
            critical: 100,
            warning: 70,
            unknown: 55,
            pending: 40
        };

        return weights[state] || 0;
    }

    function scoreOperatorFocusEvent(item, index) {
        var score = getOperatorFocusStateWeight(item.state);
        var preview = normalizeText(item.preview || '');
        var title = normalizeText(item.title || '');
        var meta = normalizeText(item.meta || '');

        if (isIncidentPinned(item.url)) {
            score += 18;
        }

        if (/\b(down|unreachable|critical|crash|failed|timeout)\b/i.test(title + ' ' + meta + ' ' + preview)) {
            score += 12;
        }

        if (index === 0) {
            score += 8;
        } else if (index === 1) {
            score += 4;
        }

        return score;
    }

    function getOperatorFocusSnapshot() {
        var events = getActiveTriageEvents();
        var counts = {
            active: events.length,
            critical: 0,
            warning: 0,
            unknown: 0,
            pending: 0,
            pinned: 0
        };
        var ranked = events.map(function (item, index) {
            if (counts.hasOwnProperty(item.state)) {
                counts[item.state] += 1;
            }

            if (isIncidentPinned(item.url)) {
                counts.pinned += 1;
            }

            return {
                item: item,
                score: scoreOperatorFocusEvent(item, index),
                index: index
            };
        }).sort(function (a, b) {
            if (b.score !== a.score) {
                return b.score - a.score;
            }

            return a.index - b.index;
        });

        return {
            counts: counts,
            next: ranked.length ? ranked[0].item : null,
            score: ranked.length ? ranked[0].score : 0
        };
    }

    function setOperatorFocusText(selector, value) {
        var element = document.querySelector(selector);

        if (element) {
            element.textContent = value;
        }
    }

    function renderOperatorFocusBoard() {
        var board = getOperatorFocusBoard();
        var snapshot = getOperatorFocusSnapshot();
        var next = snapshot.next;
        var actionButtons;
        var title;
        var detail;
        var state;

        if (! board) {
            return;
        }

        board.classList.remove('priority-critical', 'priority-warning', 'priority-unknown', 'priority-pending');

        setOperatorFocusText('[data-operator-focus-active]', String(snapshot.counts.active));
        setOperatorFocusText('[data-operator-focus-critical]', String(snapshot.counts.critical));
        setOperatorFocusText('[data-operator-focus-pinned]', String(snapshot.counts.pinned));

        var metroButton = board.querySelector('[data-open-metro-timeline]');
        if (metroButton) {
            metroButton.disabled = ! next;
        }

        actionButtons = board.querySelectorAll('[data-operator-focus-action]');
        actionButtons.forEach(function (button) {
            var action = button.getAttribute('data-operator-focus-action') || '';

            button.disabled = ! next;
            if (action === 'open') {
                button.textContent = getOperatorFocusLabel('openLabel', 'Open');
            } else if (action === 'pin') {
                button.textContent = getOperatorFocusLabel('pinLabel', 'Pin');
            } else if (action === 'snooze') {
                button.textContent = getOperatorFocusLabel('snoozeLabel', 'Snooze');
            }
        });

        if (! next) {
            setOperatorFocusText('[data-operator-focus-score]', '0');
            setOperatorFocusText('[data-operator-focus-state]', getOperatorFocusLabel('emptyLabel', 'Queue clear'));
            setOperatorFocusText('[data-operator-focus-kicker]', getOperatorFocusLabel('nextLabel', 'Next focus'));
            setOperatorFocusText('[data-operator-focus-title]', getOperatorFocusLabel('emptyDetailLabel', 'No active triage events need operator focus.'));
            setOperatorFocusText('[data-operator-focus-detail]', '');
            return;
        }

        state = next.state || 'pending';
        title = normalizeText(next.title || 'Untitled event');
        detail = normalizeText(next.meta || next.preview || '');
        board.classList.add('priority-' + state);

        setOperatorFocusText('[data-operator-focus-score]', String(snapshot.score));
        setOperatorFocusText('[data-operator-focus-state]', state);
        setOperatorFocusText('[data-operator-focus-kicker]', getOperatorFocusLabel('nextLabel', 'Next focus') + ' - ' + getOperatorFocusLabel('workloadLabel', 'workload') + ' ' + String(snapshot.counts.active));
        setOperatorFocusText('[data-operator-focus-title]', title);
        setOperatorFocusText('[data-operator-focus-detail]', detail);

        actionButtons.forEach(function (button) {
            var action = button.getAttribute('data-operator-focus-action') || '';

            if (action === 'pin') {
                button.textContent = isIncidentPinned(next.url)
                    ? getTriageDeskLabel('unpinLabel', 'Unpin')
                    : getOperatorFocusLabel('pinLabel', 'Pin');
            } else if (action === 'open') {
                button.textContent = getOperatorFocusLabel('openLabel', 'Open');
            } else if (action === 'snooze') {
                button.textContent = getOperatorFocusLabel('snoozeLabel', 'Snooze');
            }
        });
    }

    function runOperatorFocusAction(action) {
        var next = getOperatorFocusSnapshot().next;

        if (! next || ! action) {
            return;
        }

        if (action === 'open') {
            recordOperatorActivity('Triage', 'Opened focus event', normalizeText(next.title || next.meta || ''), next.url);
        }

        runTriageDeskAction(action, normalizeIncidentUrl(next.url));
        renderOperatorBoards();
    }

    function getOperatorDecisionMatrix() {
        return document.querySelector('[data-operator-decision-matrix]');
    }

    function getOperatorDecisionLabel(key, fallback) {
        var matrix = getOperatorDecisionMatrix();

        if (matrix && matrix.dataset && matrix.dataset[key]) {
            return matrix.dataset[key];
        }

        return fallback;
    }

    function createOperatorDecisionSnapshot() {
        var lanes = {
            now: [],
            watch: [],
            parked: [],
            handled: []
        };

        topEventsState.items.forEach(function (item) {
            if (! item || ! item.url) {
                return;
            }

            if (item.handled || isIncidentSeen(item.url)) {
                lanes.handled.push(item);
                return;
            }

            if (isIncidentSnoozed(item.url)) {
                lanes.parked.push(item);
                return;
            }

            if (item.state === 'critical' || item.state === 'warning') {
                lanes.now.push(item);
                return;
            }

            if (item.state === 'unknown' || item.state === 'pending') {
                lanes.watch.push(item);
            }
        });

        return lanes;
    }

    function getOperatorDecisionLaneTitle(item) {
        if (! item) {
            return getOperatorDecisionLabel('emptyLabel', 'No matching events');
        }

        return normalizeText(item.title || item.meta || item.preview || 'Untitled event');
    }

    function renderOperatorDecisionMatrix() {
        var matrix = getOperatorDecisionMatrix();
        var lanes;

        if (! matrix) {
            return;
        }

        lanes = createOperatorDecisionSnapshot();
        Object.keys(lanes).forEach(function (lane) {
            var events = lanes[lane];
            var first = events[0] || null;
            var count = matrix.querySelector('[data-operator-decision-count="' + lane + '"]');
            var title = matrix.querySelector('[data-operator-decision-title="' + lane + '"]');
            var card = matrix.querySelector('[data-operator-decision-lane="' + lane + '"]');
            var button = matrix.querySelector('[data-operator-decision-action="' + lane + '"]');

            if (count) {
                count.textContent = String(events.length);
            }

            if (title) {
                title.textContent = getOperatorDecisionLaneTitle(first);
            }

            if (card) {
                card.classList.toggle('has-events', events.length > 0);
            }

            if (button) {
                button.disabled = ! first;
                button.textContent = getOperatorDecisionLabel('openLabel', 'Open');
            }
        });
    }

    function runOperatorDecisionAction(lane) {
        var lanes = createOperatorDecisionSnapshot();
        var item = lanes[lane] && lanes[lane][0] ? lanes[lane][0] : null;

        if (! item) {
            return;
        }

        recordOperatorActivity('Decision', 'Opened ' + lane + ' decision lane', getOperatorDecisionLaneTitle(item), item.url);
        window.location.href = normalizeIncidentUrl(item.url);
    }

    function renderOperatorBoards() {
        renderOperatorFocusBoard();
        renderOperatorDecisionMatrix();
    }

    function getOperatorPlaybookEvent() {
        return getOperatorFocusSnapshot().next || getActiveTriageEvents()[0] || null;
    }

    function getOperatorPlaybookSteps(item, object) {
        var state = item ? item.state : '';
        var steps = [];

        if (state === 'critical') {
            steps.push(['Own the incident', 'Acknowledge only when an operator is actively taking responsibility.']);
            steps.push(['Recheck immediately', 'Confirm whether the state is still current before escalation.']);
            steps.push(['Add operator context', 'Leave a comment with current hypothesis, customer impact, and next owner.']);
        } else if (state === 'warning') {
            steps.push(['Inspect trend', 'Open history and compare recent flaps or repeated warning transitions.']);
            steps.push(['Recheck when safe', 'Use an immediate check if the service is expected to recover quickly.']);
            steps.push(['Escalate if repeated', 'Pin the event or add a comment if it keeps returning.']);
        } else if (state === 'unknown') {
            steps.push(['Validate monitoring path', 'Unknown state usually means the check path needs verification.']);
            steps.push(['Recheck and inspect history', 'Confirm whether the unknown result is transient or stable.']);
            steps.push(['Document uncertainty', 'Add a comment if the object needs owner review.']);
        } else if (state === 'pending') {
            steps.push(['Wait for first signal', 'Pending objects may not have a useful check result yet.']);
            steps.push(['Open object context', 'Confirm whether the object is newly added or has a scheduling issue.']);
            steps.push(['Park if expected', 'Snooze the event if the pending state is planned.']);
        } else {
            steps.push(['Open full context', 'Review the event before applying an operator action.']);
            steps.push(['Capture local note', 'Use the incident drawer note when context should stay local.']);
        }

        if (! object) {
            steps.push(['Resolve object mapping', 'Open the incident and use object context before running IcingaDB actions.']);
        }

        return steps;
    }

    function getOperatorPlaybookActions(item, object) {
        var actions = [];
        var contexts = object ? buildIcingadbContextUrls(object) : {};

        if (item && item.url) {
            actions.push(['Open incident', normalizeIncidentUrl(item.url), 'Details']);
        }

        if (object) {
            actions.push(['Open object', buildIcingadbObjectUrl(object), 'Context']);
            actions.push(['History', contexts.history || '', 'Trend']);
            actions.push(['Acknowledge', buildIcingadbActionUrl(object, 'acknowledge'), 'Own']);
            actions.push(['Recheck now', buildIcingadbActionUrl(object, 'check-now'), 'Verify']);
            actions.push(['Schedule downtime', buildIcingadbActionUrl(object, 'schedule-downtime'), 'Park']);
            actions.push(['Add comment', buildIcingadbActionUrl(object, 'add-comment'), 'Record']);
        }

        return actions.filter(function (entry) {
            return entry[1] && entry[1].length;
        });
    }

    function buildOperatorPlaybook() {
        var item = getOperatorPlaybookEvent();
        var object = item ? getIcingadbObjectFromUrl(item.url) : null;

        if (! item) {
            return {
                item: null,
                object: null,
                title: getOperatorPlaybookLabel('emptyLabel', 'No focus event selected'),
                detail: '',
                state: '',
                steps: [],
                actions: []
            };
        }

        return {
            item: item,
            object: object,
            title: normalizeText(item.title || item.meta || 'Untitled event'),
            detail: normalizeText(item.meta || item.preview || ''),
            state: item.state || '',
            steps: getOperatorPlaybookSteps(item, object),
            actions: getOperatorPlaybookActions(item, object)
        };
    }

    function buildOperatorPlaybookText() {
        var playbook = buildOperatorPlaybook();
        var lines = [
            'Operator playbook',
            'Generated: ' + new Date().toLocaleString(),
            ''
        ];

        if (! playbook.item) {
            lines.push(getOperatorPlaybookLabel('emptyLabel', 'No focus event selected'));
            return lines.join('\n');
        }

        lines.push('Target: ' + playbook.title);
        if (playbook.state) {
            lines.push('State: ' + playbook.state);
        }
        if (playbook.detail) {
            lines.push('Detail: ' + playbook.detail);
        }
        if (playbook.object) {
            lines.push('Object: ' + getIcingadbObjectDisplayName(playbook.object));
        }
        lines.push('URL: ' + normalizeIncidentUrl(playbook.item.url));

        lines.push('');
        lines.push('Recommended path:');
        playbook.steps.forEach(function (step, index) {
            lines.push(String(index + 1) + '. ' + step[0]);
            if (step[1]) {
                lines.push('   ' + step[1]);
            }
        });

        lines.push('');
        lines.push('Actions:');
        if (! playbook.actions.length) {
            lines.push('- none');
        } else {
            playbook.actions.forEach(function (action) {
                lines.push('- ' + action[0] + ': ' + action[1]);
            });
        }

        return lines.join('\n');
    }

    function buildTriageDigestText() {
        var events = getActiveTriageEvents();
        var lines = [
            'Triage digest: ' + String(events.length) + ' active event' + (events.length === 1 ? '' : 's')
        ];

        events.forEach(function (item, index) {
            var preview = normalizeText(item.preview || '');

            lines.push('');
            lines.push(String(index + 1) + '. ' + normalizeText(item.title || 'Untitled event'));
            if (item.state) {
                lines.push('State: ' + item.state);
            }
            if (item.meta) {
                lines.push('Meta: ' + normalizeText(item.meta));
            }
            if (preview.length && preview !== normalizeText(item.title || '') && preview !== normalizeText(item.meta || '')) {
                lines.push('Preview: ' + preview);
            }
            lines.push('URL: ' + normalizeIncidentUrl(item.url));
        });

        return lines.join('\n');
    }

    function renderTriageDesk() {
        var modal = getTriageDesk();
        var list = modal ? modal.querySelector('[data-triage-desk-list]') : null;
        var empty = modal ? modal.querySelector('[data-triage-desk-empty]') : null;
        var summary = modal ? modal.querySelector('[data-triage-desk-summary]') : null;
        var events = getActiveTriageEvents();

        if (! modal || ! list || ! empty || ! summary) {
            return;
        }

        summary.textContent = String(events.length) + ' ' + getTriageDeskLabel('summaryLabel', 'active events');
        empty.textContent = getTriageDeskLabel('emptyLabel', 'No active triage events');
        empty.hidden = events.length > 0;
        list.hidden = ! events.length;

        list.innerHTML = events.map(function (item) {
            var url = normalizeIncidentUrl(item.url);
            var title = normalizeText(item.title || 'Untitled event');
            var meta = normalizeText(item.meta || '');
            var preview = normalizeText(item.preview || '');
            var pinned = isIncidentPinned(url);
            var pinLabel = pinned
                ? getTriageDeskLabel('unpinLabel', 'Unpin')
                : getTriageDeskLabel('pinLabel', 'Pin');

            return '<li data-triage-desk-row data-url="' + escapeHtml(url) + '">'
                + '<span class="triage-desk-state ' + escapeHtml(item.state || '') + '"></span>'
                + '<div class="triage-desk-row-main">'
                + '<h3>' + escapeHtml(title) + '</h3>'
                + (meta.length ? '<p>' + escapeHtml(meta) + '</p>' : '')
                + (preview.length && preview !== title && preview !== meta ? '<p>' + escapeHtml(preview) + '</p>' : '')
                + '</div>'
                + '<div class="triage-desk-row-actions">'
                + '<button type="button" data-triage-desk-action="open">' + escapeHtml(getTriageDeskLabel('openLabel', 'Open')) + '</button>'
                + '<button type="button" data-triage-desk-action="pin">' + escapeHtml(pinLabel) + '</button>'
                + '<button type="button" data-triage-desk-action="snooze">' + escapeHtml(getTriageDeskLabel('snoozeLabel', 'Snooze')) + '</button>'
                + '<button type="button" data-triage-desk-action="seen">' + escapeHtml(getTriageDeskLabel('seenLabel', 'Seen')) + '</button>'
                + '<button type="button" data-triage-desk-action="copy">' + escapeHtml(getTriageDeskLabel('copyLinkLabel', 'Copy link')) + '</button>'
                + '</div>'
                + '</li>';
        }).join('');
    }

    function openTriageDesk() {
        var modal = getTriageDesk();

        if (! modal) {
            return;
        }

        if (isOperatorHandoffOpen()) {
            closeOperatorHandoff();
        }

        if (isOperatorActivityOpen()) {
            closeOperatorActivity();
        }

        if (isOperatorPlaybookOpen()) {
            closeOperatorPlaybook();
        }

        lastFocusedElement = document.activeElement;
        renderTriageDesk();
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        var firstButton = modal.querySelector('button');
        if (firstButton) {
            firstButton.focus();
        }
    }

    function closeTriageDesk() {
        var modal = getTriageDesk();

        if (! modal || modal.hidden) {
            return;
        }

        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');

        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
    }

    function resetTriageQueue() {
        writeSeenIncidents([]);
        writeSnoozedIncidents({});
        refreshSeenTopEventStates();
        rerenderCachedTopEvents();
        refreshTopEvents(true);
        renderTriageDesk();
        renderOperatorBoards();
        recordOperatorActivity('Triage', 'Reset triage queue', 'Cleared local seen and snoozed markers', '');
        showOperatorToast('Triage queue reset');
    }

    function runTriageDeskAction(action, url) {
        var event = getActiveTriageEventByUrl(url);

        if (! action || ! url.length) {
            return;
        }

        if (action === 'open') {
            window.location.href = url;
            return;
        }

        if (action === 'copy') {
            copyTextToClipboard(url).then(function () {
                recordOperatorActivity('Triage', 'Copied triage link', event ? normalizeText(event.title || event.meta || '') : '', url);
                showOperatorToast('Triage link copied');
            });
            return;
        }

        if (action === 'pin') {
            if (event) {
                setIncidentPinned(event, ! isIncidentPinned(url));
                recordOperatorActivity(
                    'Triage',
                    isIncidentPinned(url) ? 'Pinned triage event' : 'Unpinned triage event',
                    normalizeText(event.title || event.meta || ''),
                    url
                );
                showOperatorToast(isIncidentPinned(url) ? 'Triage event pinned' : 'Triage event unpinned');
            }
            renderTriageDesk();
            renderOperatorBoards();
            return;
        }

        if (action === 'snooze') {
            snoozeIncident(url);
            rerenderCachedTopEvents();
            refreshTopEvents(true);
            renderTriageDesk();
            renderOperatorBoards();
            recordOperatorActivity('Triage', 'Snoozed triage event', event ? normalizeText(event.title || event.meta || '') : '', url);
            showOperatorToast('Triage event snoozed');
            return;
        }

        if (action === 'seen') {
            markIncidentSeen(url);
            refreshSeenTopEventStates();
            rerenderCachedTopEvents();
            renderTriageDesk();
            renderOperatorBoards();
            recordOperatorActivity('Triage', 'Marked triage event seen', event ? normalizeText(event.title || event.meta || '') : '', url);
            showOperatorToast('Triage event marked seen');
        }
    }

    function appendHandoffIncidentList(lines, title, incidents) {
        lines.push('');
        lines.push(title + ': ' + String(incidents.length));

        if (! incidents.length) {
            lines.push('- none');
            return;
        }

        incidents.forEach(function (incident, index) {
            lines.push(String(index + 1) + '. ' + normalizeText(incident.title || 'Untitled incident'));
            if (incident.meta) {
                lines.push('   Meta: ' + normalizeText(incident.meta));
            }
            if (incident.url) {
                lines.push('   URL: ' + normalizeIncidentUrl(incident.url));
            }
        });
    }

    function buildOperatorHandoffText() {
        var triageEvents = getActiveTriageEvents();
        var pinned = readPinnedIncidents().filter(function (incident) {
            return incident && incident.title && incident.url;
        });
        var recent = readRecentIncidents().filter(function (incident) {
            return incident && incident.title && incident.url;
        });
        var notes = readIncidentNotes();
        var noteUrls = Object.keys(notes).filter(function (url) {
            return String(notes[url] || '').trim().length;
        });
        var decision = createOperatorDecisionSnapshot();
        var activity = readOperatorActivity().slice(0, 12);
        var lines = [
            'Operator handoff',
            'Generated: ' + new Date().toLocaleString(),
            '',
            'Queue state:',
            '- Active triage: ' + String(triageEvents.length),
            '- Pinned incidents: ' + String(pinned.length),
            '- Recent incidents: ' + String(recent.length),
            '- Local notes: ' + String(noteUrls.length),
            '- Seen markers: ' + String(readSeenIncidents().length),
            '- Snoozed markers: ' + String(Object.keys(readSnoozedIncidents()).length)
        ];

        lines.push('');
        lines.push(buildTriageDigestText());

        lines.push('');
        lines.push('Decision matrix:');
        lines.push('- Act now: ' + String(decision.now.length));
        lines.push('- Watch: ' + String(decision.watch.length));
        lines.push('- Parked: ' + String(decision.parked.length));
        lines.push('- Handled locally: ' + String(decision.handled.length));

        lines.push('');
        lines.push(buildOperatorPlaybookText());

        appendHandoffIncidentList(lines, 'Pinned incidents', pinned.slice(0, PINNED_INCIDENTS_LIMIT));
        appendHandoffIncidentList(lines, 'Recent incidents', recent.slice(0, RECENT_INCIDENTS_LIMIT));

        lines.push('');
        lines.push('Local incident notes: ' + String(noteUrls.length));
        if (! noteUrls.length) {
            lines.push('- none');
        } else {
            noteUrls.slice(0, 12).forEach(function (url, index) {
                lines.push(String(index + 1) + '. ' + normalizeIncidentUrl(url));
                lines.push('   Note: ' + normalizeText(notes[url]));
            });
        }

        lines.push('');
        lines.push('Audit timeline excerpt: ' + String(activity.length));
        if (! activity.length) {
            lines.push('- none');
        } else {
            activity.forEach(function (entry, index) {
                lines.push(String(index + 1) + '. ' + formatOperatorActivityTime(entry.time) + ' - ' + normalizeText(entry.title));
                if (entry.detail) {
                    lines.push('   Detail: ' + normalizeText(entry.detail));
                }
                if (entry.url) {
                    lines.push('   URL: ' + normalizeIncidentUrl(entry.url));
                }
            });
        }

        return lines.join('\n');
    }

    function renderOperatorHandoff() {
        var modal = getOperatorHandoff();
        var output = modal ? modal.querySelector('[data-operator-handoff-output]') : null;
        var summary = modal ? modal.querySelector('[data-operator-handoff-summary]') : null;

        if (! modal || ! output || ! summary) {
            return;
        }

        output.value = buildOperatorHandoffText();
        summary.textContent = getOperatorHandoffLabel('summaryLabel', 'generated handoff report');
    }

    function openOperatorHandoff() {
        var modal = getOperatorHandoff();
        var output;

        if (! modal) {
            return;
        }

        if (isTriageDeskOpen()) {
            closeTriageDesk();
        }

        if (isOperatorActivityOpen()) {
            closeOperatorActivity();
        }

        if (isOperatorPlaybookOpen()) {
            closeOperatorPlaybook();
        }

        lastFocusedElement = document.activeElement;
        renderOperatorHandoff();
        recordOperatorActivity('Handoff', 'Generated handoff report', '', '');
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        output = modal.querySelector('[data-operator-handoff-output]');
        if (output) {
            output.focus();
            output.select();
        }
    }

    function closeOperatorHandoff() {
        var modal = getOperatorHandoff();

        if (! modal || modal.hidden) {
            return;
        }

        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');

        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
    }

    function copyOperatorHandoff() {
        var modal = getOperatorHandoff();
        var output = modal ? modal.querySelector('[data-operator-handoff-output]') : null;

        copyTextToClipboard(output ? output.value : buildOperatorHandoffText()).then(function () {
            recordOperatorActivity('Handoff', 'Copied handoff report', 'Operator handoff report copied to clipboard', '');
            showOperatorToast('Handoff report copied');
        });
    }

    function formatOperatorActivityTime(timestamp) {
        var date = new Date(Number(timestamp || 0));

        if (Number.isNaN(date.getTime())) {
            return '';
        }

        return date.toLocaleString();
    }

    function getOperatorActivityKinds(activity) {
        var kinds = {};

        activity.forEach(function (entry) {
            var kind = normalizeText(entry.kind || 'Action');

            if (kind.length) {
                kinds[kind] = true;
            }
        });

        return Object.keys(kinds).sort();
    }

    function getFilteredOperatorActivity(activity) {
        if (operatorAuditState.filter === 'all') {
            return activity;
        }

        return activity.filter(function (entry) {
            return normalizeText(entry.kind || 'Action') === operatorAuditState.filter;
        });
    }

    function getOperatorAuditMetrics(activity) {
        var objects = {};
        var latest = activity[0] ? formatOperatorActivityTime(activity[0].time) : '—';

        activity.forEach(function (entry) {
            var url = normalizeIncidentUrl(entry.url || '');

            if (url.length) {
                objects[url] = true;
            }
        });

        return {
            total: activity.length,
            objects: Object.keys(objects).length,
            latest: latest
        };
    }

    function renderOperatorAuditFilters(activity) {
        var modal = getOperatorActivity();
        var filters = modal ? modal.querySelector('[data-operator-audit-filters]') : null;
        var kinds = getOperatorActivityKinds(activity);
        var allLabel = getOperatorActivityLabel('allLabel', 'All');

        if (! filters) {
            return;
        }

        if (operatorAuditState.filter !== 'all' && kinds.indexOf(operatorAuditState.filter) === -1) {
            operatorAuditState.filter = 'all';
        }

        filters.innerHTML = ['all'].concat(kinds).map(function (kind) {
            var label = kind === 'all' ? allLabel : kind;
            var count = kind === 'all'
                ? activity.length
                : activity.filter(function (entry) {
                    return normalizeText(entry.kind || 'Action') === kind;
                }).length;

            return '<button type="button" data-operator-audit-filter="' + escapeHtml(kind) + '"'
                + (operatorAuditState.filter === kind ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"')
                + '>' + escapeHtml(label) + ' ' + String(count) + '</button>';
        }).join('');
    }

    function buildOperatorAuditTimelineText() {
        var activity = getFilteredOperatorActivity(readOperatorActivity());
        var lines = [
            'Audit timeline',
            'Generated: ' + new Date().toLocaleString(),
            'Filter: ' + operatorAuditState.filter,
            'Events: ' + String(activity.length)
        ];

        activity.forEach(function (entry, index) {
            lines.push('');
            lines.push(String(index + 1) + '. [' + formatOperatorActivityTime(entry.time) + '] ' + normalizeText(entry.kind || 'Action'));
            lines.push('   Title: ' + normalizeText(entry.title || 'Operator action'));
            if (entry.detail) {
                lines.push('   Detail: ' + normalizeText(entry.detail));
            }
            if (entry.url) {
                lines.push('   URL: ' + normalizeIncidentUrl(entry.url));
            }
            if (entry.id) {
                lines.push('   Event ID: ' + normalizeText(entry.id));
            }
        });

        return lines.join('\n');
    }

    function renderOperatorActivity() {
        var modal = getOperatorActivity();
        var list = modal ? modal.querySelector('[data-operator-activity-list]') : null;
        var empty = modal ? modal.querySelector('[data-operator-activity-empty]') : null;
        var summary = modal ? modal.querySelector('[data-operator-activity-summary]') : null;
        var total = modal ? modal.querySelector('[data-operator-audit-total]') : null;
        var objects = modal ? modal.querySelector('[data-operator-audit-objects]') : null;
        var latest = modal ? modal.querySelector('[data-operator-audit-latest]') : null;
        var activity = readOperatorActivity();
        var filtered = getFilteredOperatorActivity(activity);
        var metrics = getOperatorAuditMetrics(activity);

        if (! modal || ! list || ! empty || ! summary) {
            return;
        }

        renderOperatorAuditFilters(activity);
        if (total) {
            total.textContent = String(metrics.total);
        }
        if (objects) {
            objects.textContent = String(metrics.objects);
        }
        if (latest) {
            latest.textContent = metrics.latest;
        }

        summary.textContent = String(filtered.length) + ' / ' + String(activity.length) + ' ' + getOperatorActivityLabel('summaryLabel', 'audit events');
        empty.textContent = getOperatorActivityLabel('emptyLabel', 'No operator activity yet');
        empty.hidden = filtered.length > 0;
        list.hidden = ! filtered.length;
        list.innerHTML = filtered.map(function (entry) {
            var detail = normalizeText(entry.detail || '');
            var url = normalizeIncidentUrl(entry.url || '');

            return '<li>'
                + '<time class="operator-activity-time">' + escapeHtml(formatOperatorActivityTime(entry.time)) + '</time>'
                + '<div class="operator-activity-main">'
                + '<h3>' + escapeHtml(normalizeText(entry.title || 'Operator action')) + '</h3>'
                + (detail.length ? '<p>' + escapeHtml(detail) + '</p>' : '')
                + (url.length ? '<a href="' + escapeHtml(url) + '" data-base-target="_main">' + escapeHtml(url) + '</a>' : '')
                + '</div>'
                + '<span class="operator-activity-kind">' + escapeHtml(normalizeText(entry.kind || 'Action')) + '</span>'
                + '</li>';
        }).join('');
    }

    function openOperatorActivity() {
        var modal = getOperatorActivity();
        var firstButton;

        if (! modal) {
            return;
        }

        if (isTriageDeskOpen()) {
            closeTriageDesk();
        }

        if (isOperatorHandoffOpen()) {
            closeOperatorHandoff();
        }

        if (isOperatorPlaybookOpen()) {
            closeOperatorPlaybook();
        }

        lastFocusedElement = document.activeElement;
        renderOperatorActivity();
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        firstButton = modal.querySelector('button');
        if (firstButton) {
            firstButton.focus();
        }
    }

    function closeOperatorActivity() {
        var modal = getOperatorActivity();

        if (! modal || modal.hidden) {
            return;
        }

        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');

        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
    }

    function clearOperatorActivity() {
        operatorAuditState.filter = 'all';
        writeOperatorActivity([]);
        renderOperatorActivity();
        showOperatorToast('Operator activity log cleared');
    }

    function copyOperatorAuditTimeline() {
        copyTextToClipboard(buildOperatorAuditTimelineText()).then(function () {
            showOperatorToast('Audit timeline copied');
        });
    }

    function renderOperatorPlaybook() {
        var modal = getOperatorPlaybook();
        var playbook = buildOperatorPlaybook();
        var summary = modal ? modal.querySelector('[data-operator-playbook-summary]') : null;
        var state = modal ? modal.querySelector('[data-operator-playbook-state]') : null;
        var target = modal ? modal.querySelector('[data-operator-playbook-target]') : null;
        var detail = modal ? modal.querySelector('[data-operator-playbook-detail]') : null;
        var targetBox = modal ? modal.querySelector('.operator-playbook-target') : null;
        var steps = modal ? modal.querySelector('[data-operator-playbook-steps]') : null;
        var actions = modal ? modal.querySelector('[data-operator-playbook-actions]') : null;
        var empty = modal ? modal.querySelector('[data-operator-playbook-empty]') : null;
        var body = modal ? modal.querySelector('.operator-playbook-body') : null;

        if (! modal || ! summary || ! state || ! target || ! detail || ! steps || ! actions || ! empty || ! body) {
            return;
        }

        summary.textContent = getOperatorPlaybookLabel('summaryLabel', 'recommended operator path');
        empty.textContent = getOperatorPlaybookLabel('emptyLabel', 'No focus event selected');
        empty.hidden = !! playbook.item;
        body.hidden = ! playbook.item;

        if (! playbook.item) {
            return;
        }

        if (targetBox) {
            targetBox.classList.remove('state-critical', 'state-warning', 'state-unknown', 'state-pending');
            if (playbook.state) {
                targetBox.classList.add('state-' + playbook.state);
            }
        }

        state.textContent = playbook.state
            ? playbook.state + (playbook.object ? ' - ' + getIcingadbObjectDisplayName(playbook.object) : '')
            : (playbook.object ? getIcingadbObjectDisplayName(playbook.object) : '');
        target.textContent = playbook.title;
        detail.textContent = playbook.detail;

        steps.innerHTML = playbook.steps.map(function (step) {
            return '<li>'
                + escapeHtml(step[0])
                + (step[1] ? '<small>' + escapeHtml(step[1]) + '</small>' : '')
                + '</li>';
        }).join('');

        actions.innerHTML = playbook.actions.map(function (action) {
            return '<a href="' + escapeHtml(action[1]) + '" data-base-target="_main">'
                + '<span>' + escapeHtml(action[0]) + '</span>'
                + '<small>' + escapeHtml(action[2] || getOperatorPlaybookLabel('openLabel', 'Open')) + '</small>'
                + '</a>';
        }).join('');
    }

    function openOperatorPlaybook() {
        var modal = getOperatorPlaybook();
        var firstAction;
        var playbook = buildOperatorPlaybook();

        if (! modal) {
            return;
        }

        if (isTriageDeskOpen()) {
            closeTriageDesk();
        }

        if (isOperatorHandoffOpen()) {
            closeOperatorHandoff();
        }

        if (isOperatorActivityOpen()) {
            closeOperatorActivity();
        }

        if (isIncidentDrawerOpen()) {
            closeIncidentDrawer();
        }

        lastFocusedElement = document.activeElement;
        renderOperatorPlaybook();
        if (playbook.item) {
            recordOperatorActivity('Playbook', 'Opened operator playbook', playbook.title, playbook.item.url);
        }
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        firstAction = modal.querySelector('a, button');
        if (firstAction) {
            firstAction.focus();
        }
    }

    function closeOperatorPlaybook() {
        var modal = getOperatorPlaybook();

        if (! modal || modal.hidden) {
            return;
        }

        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');

        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
    }

    function copyOperatorPlaybook() {
        copyTextToClipboard(buildOperatorPlaybookText()).then(function () {
            var playbook = buildOperatorPlaybook();

            if (playbook.item) {
                recordOperatorActivity('Playbook', 'Copied operator playbook', playbook.title, playbook.item.url);
            }
            showOperatorToast('Operator playbook copied');
        });
    }

    function renderTopEvents(items) {
        var slots = document.querySelectorAll('[data-top-event-item]');
        var triageMode = isTriageModeEnabled();
        var triageStats = getTopEventsTriageStats(items);
        var visibleItems = items.filter(function (item) {
            return ! item || ! item.url || ! isIncidentSnoozed(item.url);
        });
        var i;

        updateTopEventsSummary(triageStats);
        renderOperatorBoards();

        if (triageMode) {
            visibleItems = visibleItems.filter(isTriageEvent);
            if (! visibleItems.length && items.length) {
                visibleItems = [{
                    title: 'No active triage events',
                    meta: 'Seen, handled and snoozed entries are hidden',
                    preview: 'Disable triage mode to review the full latest event feed',
                    url: getTopEventsHistoryUrl(),
                    state: ''
                }];
            }
        }

        for (i = 0; i < slots.length; i++) {
            var item = visibleItems[i] || null;
            var titleEl = slots[i].querySelector('.top-event-title');
            var metaEl = slots[i].querySelector('.top-event-meta');
            var previewEl = slots[i].querySelector('.top-event-preview');
            var linkEl = slots[i].querySelector('.top-event-link');
            var stateClass;
            var url = normalizeTopEventUrl(getTopEventsHistoryUrl());

            if (! titleEl || ! metaEl || ! previewEl || ! linkEl) {
                continue;
            }

            TOP_EVENT_STATE_CLASSES.forEach(function (className) {
                slots[i].classList.remove(className);
            });
            slots[i].classList.remove('top-event-seen');
            slots[i].removeAttribute('data-event-state');
            slots[i].removeAttribute('data-event-url');
            linkEl.classList.remove('top-event-link-unresolved');
            linkEl.removeAttribute('aria-disabled');
            linkEl.removeAttribute('aria-expanded');
            linkEl.removeAttribute('role');
            previewEl.textContent = '';

            if (item) {
                titleEl.textContent = item.title;
                metaEl.textContent = item.meta || '—';
                previewEl.textContent = item.preview || item.meta || item.title;
                url = normalizeTopEventUrl(item.url);
                if (url && isTopEventDetailsUrl(url)) {
                    linkEl.setAttribute('href', url);
                    slots[i].setAttribute('data-event-url', url);
                    slots[i].classList.toggle('top-event-seen', isIncidentSeen(url));
                } else {
                    linkEl.setAttribute('href', normalizeTopEventUrl(getTopEventsHistoryUrl()) || getTopEventsHistoryUrl());
                    linkEl.classList.add('top-event-link-unresolved');
                }
                if (item.state) {
                    stateClass = 'top-event-state-' + item.state;
                    slots[i].classList.add(stateClass);
                    slots[i].setAttribute('data-event-state', item.state);
                }

                if (item.handled) {
                    slots[i].classList.add('top-event-state-handled');
                }
            } else {
                titleEl.textContent = '—';
                metaEl.textContent = '';
                linkEl.setAttribute('href', url || getTopEventsHistoryUrl());
            }
        }

        if (isTriageDeskOpen()) {
            renderTriageDesk();
        }

        if (isOperatorHandoffOpen()) {
            renderOperatorHandoff();
        }

        if (isOperatorPlaybookOpen()) {
            renderOperatorPlaybook();
        }
    }

    function renderTopEventsError() {
        renderTopEvents([
            {
                title: 'Unable to load event history',
                meta: 'Open History > Event Overview'
            },
            {
                title: '—',
                meta: ''
            }
        ]);
    }

    function rerenderCachedTopEvents() {
        if (topEventsState.items.length) {
            renderTopEvents(topEventsState.items);
        }
    }

    function refreshTopEvents(forceRender) {
        var now = Date.now();

        if (topEventsState.inFlight) {
            return;
        }

        if (! getTopEventsPanel()) {
            return;
        }

        if (! forceRender && topEventsState.retryAt > now) {
            return;
        }

        topEventsState.inFlight = true;

        fetch(getTopEventsRequestUrl(), {
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
                var items = parseLatestEventsFromHistoryHtml(html);

                if (! items.length) {
                    throw new Error('No parseable event entries found');
                }

                var signature = items.map(function (item) {
                    return item.title + '|' + item.meta + '|' + item.preview + '|' + item.state + '|' + String(item.handled) + '|' + item.url;
                }).join('||');
                var renderSignature = signature
                    + '||triage='
                    + (isTriageModeEnabled() ? '1' : '0')
                    + '||seen='
                    + readSeenIncidents().join('|')
                    + '||snoozed='
                    + Object.keys(readSnoozedIncidents()).sort().join('|');

                topEventsState.items = items;
                if (forceRender || renderSignature !== topEventsState.lastSignature) {
                    renderTopEvents(items);
                    topEventsState.lastSignature = renderSignature;
                }

                topEventsState.consecutiveErrors = 0;
                topEventsState.retryAt = 0;
            })
            .catch(function () {
                topEventsState.consecutiveErrors += 1;
                topEventsState.retryAt = Date.now() + Math.min(
                    TOP_EVENTS_ERROR_BACKOFF_MAX_MS,
                    TOP_EVENTS_ERROR_BACKOFF_MS * topEventsState.consecutiveErrors
                );

                if (! topEventsState.lastSignature.length || forceRender) {
                    renderTopEventsError();
                }
            })
            .then(function () {
                topEventsState.inFlight = false;
            }, function () {
                topEventsState.inFlight = false;
            });
    }

    function startTopEventsPolling() {
        if (! getTopEventsPanel()) {
            return;
        }

        refreshTopEvents(true);

        if (topEventsState.pollingTimer !== null) {
            window.clearInterval(topEventsState.pollingTimer);
        }

        topEventsState.pollingTimer = window.setInterval(function () {
            refreshTopEvents(false);
        }, TOP_EVENTS_REFRESH_MS);
    }

    function getIncidentDrawer() {
        return document.getElementById('incident-drawer');
    }

    function isIncidentDrawerOpen() {
        var drawer = getIncidentDrawer();

        return !! drawer && ! drawer.hidden;
    }

    function getIncidentDrawerLabel(name, fallback) {
        var drawer = getIncidentDrawer();
        var key = name.replace(/-([a-z])/g, function (_, letter) {
            return letter.toUpperCase();
        });

        if (drawer && drawer.dataset[key]) {
            return drawer.dataset[key];
        }

        return fallback;
    }

    function setIncidentDrawerBody(text, loading) {
        var body = document.querySelector('[data-incident-body]');

        if (! body) {
            return;
        }

        body.classList.toggle('loading', !! loading);
        body.textContent = text;
    }

    function normalizeIncidentUrl(url) {
        var value = String(url || '').trim();
        var baseUrl = getBaseUrl();

        if (! value.length || value === '#') {
            return '';
        }

        if (/^https?:\/\//i.test(value)) {
            return value;
        }

        if (value.indexOf(baseUrl + '/') === 0) {
            return value;
        }

        return baseUrl + '/' + value.replace(/^\/+/, '');
    }

    function getUrlSearchParams(url) {
        var queryIndex = url.indexOf('?');

        if (queryIndex === -1) {
            return new URLSearchParams();
        }

        return new URLSearchParams(url.slice(queryIndex + 1));
    }

    function getIcingadbObjectFromUrl(url) {
        var normalized = normalizeIncidentUrl(url);
        var baseUrl = getBaseUrl();
        var path = normalized;
        var params;
        var hostName;
        var serviceName;

        if (! normalized.length) {
            return null;
        }

        if (/^https?:\/\//i.test(normalized)) {
            try {
                path = new URL(normalized, window.location.href).pathname
                    + new URL(normalized, window.location.href).search;
            } catch (error) {
                path = normalized;
            }
        }

        if (baseUrl.length && path.indexOf(baseUrl + '/') === 0) {
            path = path.slice(baseUrl.length + 1);
        } else {
            path = path.replace(/^\/+/, '');
        }

        params = getUrlSearchParams(path);
        hostName = params.get('host.name') || params.get('host') || '';
        serviceName = params.get('name') || params.get('service.name') || '';

        if (path.indexOf('icingadb/service') === 0 && hostName.length && serviceName.length) {
            return {
                type: 'service',
                hostName: hostName,
                serviceName: serviceName
            };
        }

        hostName = params.get('name') || params.get('host.name') || '';
        if (path.indexOf('icingadb/host') === 0 && hostName.length) {
            return {
                type: 'host',
                hostName: hostName,
                serviceName: ''
            };
        }

        return null;
    }

    function findIcingadbObjectInDocument(doc) {
        var anchors = doc.querySelectorAll('a[href*="icingadb/service"], a[href*="icingadb/host"]');
        var i;
        var object;

        for (i = 0; i < anchors.length; i++) {
            object = getIcingadbObjectFromUrl(anchors[i].getAttribute('href') || anchors[i].href || '');
            if (object && object.type === 'service') {
                return object;
            }
        }

        for (i = 0; i < anchors.length; i++) {
            object = getIcingadbObjectFromUrl(anchors[i].getAttribute('href') || anchors[i].href || '');
            if (object) {
                return object;
            }
        }

        return null;
    }

    function buildIcingadbActionUrl(object, action) {
        var params;
        var path;

        if (! object || ! action) {
            return '';
        }

        params = new URLSearchParams();

        if (object.type === 'service') {
            path = 'icingadb/service/' + action;
            params.set('name', object.serviceName);
            params.set('host.name', object.hostName);
        } else {
            path = 'icingadb/host/' + action;
            params.set('name', object.hostName);
        }

        return getBaseUrl() + '/' + path + '?' + params.toString();
    }

    function buildIcingadbObjectUrl(object) {
        var params;
        var path;

        if (! object) {
            return '';
        }

        params = new URLSearchParams();
        if (object.type === 'service') {
            path = 'icingadb/service';
            params.set('name', object.serviceName);
            params.set('host.name', object.hostName);
        } else {
            path = 'icingadb/host';
            params.set('name', object.hostName);
        }

        return getBaseUrl() + '/' + path + '?' + params.toString();
    }

    function buildIcingadbContextUrls(object) {
        var params;
        var baseUrl = getBaseUrl();

        if (! object) {
            return {};
        }

        if (object.type === 'service') {
            params = new URLSearchParams();
            params.set('name', object.serviceName);
            params.set('host.name', object.hostName);

            return {
                object: buildIcingadbObjectUrl(object),
                history: baseUrl + '/icingadb/service/history?' + params.toString(),
                comments: baseUrl + '/icingadb/comments?'
                    + new URLSearchParams({
                        'service.name': object.serviceName,
                        'host.name': object.hostName
                    }).toString(),
                downtimes: baseUrl + '/icingadb/downtimes?'
                    + new URLSearchParams({
                        'service.name': object.serviceName,
                        'host.name': object.hostName
                    }).toString()
            };
        }

        params = new URLSearchParams();
        params.set('name', object.hostName);

        return {
            object: buildIcingadbObjectUrl(object),
            history: baseUrl + '/icingadb/host/history?' + params.toString(),
            comments: baseUrl + '/icingadb/comments?'
                + new URLSearchParams({ 'host.name': object.hostName }).toString(),
            downtimes: baseUrl + '/icingadb/downtimes?'
                + new URLSearchParams({ 'host.name': object.hostName }).toString()
        };
    }

    function getIcingadbObjectDisplayName(object) {
        if (! object) {
            return '';
        }

        if (object.type === 'service') {
            return object.serviceName + ' on ' + object.hostName;
        }

        return object.hostName;
    }

    function setIncidentQuickActions(object) {
        var container = document.querySelector('[data-incident-actions]');
        var actions = {
            'acknowledge': getIncidentDrawerLabel('acknowledge-label', 'Acknowledge'),
            'check-now': getIncidentDrawerLabel('recheck-label', 'Recheck now'),
            'schedule-downtime': getIncidentDrawerLabel('downtime-label', 'Schedule downtime'),
            'add-comment': getIncidentDrawerLabel('comment-label', 'Add comment')
        };

        if (! container) {
            return;
        }

        incidentDrawerState.object = object || null;
        container.hidden = ! object;

        Object.keys(actions).forEach(function (action) {
            var link = container.querySelector('[data-incident-action="' + action + '"]');
            var url;

            if (! link) {
                return;
            }

            link.textContent = actions[action];
            url = object ? buildIcingadbActionUrl(object, action) : '';
            link.href = url || '#';
            link.hidden = ! url.length;
        });
    }

    function setIncidentObjectContext(object) {
        var container = document.querySelector('[data-incident-context]');
        var title = document.querySelector('[data-incident-context-title]');
        var labels = {
            object: getIncidentDrawerLabel('object-label', 'Open object'),
            history: getIncidentDrawerLabel('history-label', 'History'),
            comments: getIncidentDrawerLabel('comments-label', 'Comments'),
            downtimes: getIncidentDrawerLabel('downtimes-label', 'Downtimes')
        };
        var urls = buildIcingadbContextUrls(object);

        if (! container) {
            return;
        }

        container.hidden = ! object;
        if (title) {
            title.textContent = object
                ? getIncidentDrawerLabel('context-label', 'Object context') + ': ' + getIcingadbObjectDisplayName(object)
                : getIncidentDrawerLabel('context-label', 'Object context');
        }

        Object.keys(labels).forEach(function (name) {
            var link = container.querySelector('[data-incident-context-link="' + name + '"]');
            var url = urls[name] || '';

            if (! link) {
                return;
            }

            link.textContent = labels[name];
            link.href = url || '#';
            link.hidden = ! url.length;
        });
    }

    function getMetroStateFromText(text) {
        var value = String(text || '').toLowerCase();

        if (/\b(critical|down|unreachable|failed|crash)\b/.test(value)) {
            return 'critical';
        }

        if (/\bwarning\b/.test(value)) {
            return 'warning';
        }

        if (/\bunknown\b/.test(value)) {
            return 'unknown';
        }

        if (/\b(pending|not checked)\b/.test(value)) {
            return 'pending';
        }

        if (/\b(ok|up|recovered|resolved)\b/.test(value)) {
            return 'ok';
        }

        return 'event';
    }

    function getMetroStateColor(state) {
        var colors = {
            critical: 'var(--to-critical)',
            warning: 'var(--to-warning)',
            unknown: 'var(--to-unknown)',
            pending: 'var(--to-pending)',
            ok: 'var(--to-ok)',
            event: 'var(--to-text-muted)'
        };

        return colors[state] || colors.event;
    }

    function getMetroStationLabel(text) {
        var normalized = normalizeText(text || '')
            .replace(/\b(host|service|state|changed|notification|check result)\b/ig, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (! normalized.length) {
            return 'Event';
        }

        return normalized.length > 34 ? normalized.slice(0, 34).replace(/\s+\S*$/, '') + '...' : normalized;
    }

    function getMetroStationTime(text) {
        var match = String(text || '').match(/\b(\d{1,2}:\d{2}(?::\d{2})?|\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4})\b/);

        return match ? match[1] : '';
    }

    function renderIncidentMetroTimeline(entries) {
        var metro = document.querySelector('[data-incident-metro-timeline]');
        var stops = entries.map(function (entry, index) {
            var state = entry.state || getMetroStateFromText(entry.text);

            return {
                index: index,
                label: getMetroStationLabel(entry.text),
                time: getMetroStationTime(entry.text),
                state: state,
                color: getMetroStateColor(state)
            };
        });
        var legend = {};
        var segments;

        if (! metro) {
            return;
        }

        metro.hidden = stops.length < 2;
        if (stops.length < 2) {
            metro.innerHTML = '';
            return;
        }

        segments = stops.slice(0, -1).map(function (stop, index) {
            var from = stops.length > 1 ? (index * 100 / (stops.length - 1)) : 0;
            var to = stops.length > 1 ? ((index + 1) * 100 / (stops.length - 1)) : 100;

            return '<span class="incident-metro-segment" style="--from: '
                + String(index)
                + '; --to: '
                + String(index + 1)
                + '; --left: calc('
                + String(from.toFixed(3))
                + '% + 0.5em); --right: calc('
                + String((100 - to).toFixed(3))
                + '% + 0.5em)'
                + '; --metro-color: '
                + stop.color
                + '"></span>';
        }).join('');

        stops.forEach(function (stop) {
            legend[stop.state] = stop.color;
        });

        metro.innerHTML = '<div class="incident-metro-viewport" style="--metro-count: '
            + String(stops.length)
            + '; --metro-width: '
            + String(Math.max(38, stops.length * 6))
            + 'em">'
            + '<div class="incident-metro-line">'
            + segments
            + stops.map(function (stop, index) {
                return '<div class="incident-metro-stop'
                    + (index === 0 ? ' current' : '')
                    + '" style="--metro-color: '
                    + stop.color
                    + '">'
                    + '<span class="incident-metro-label">' + escapeHtml(stop.label) + '</span>'
                    + '<span class="incident-metro-dot"></span>'
                    + '<span class="incident-metro-time">' + escapeHtml(stop.time || ('#' + String(index + 1))) + '</span>'
                    + '</div>';
            }).join('')
            + '</div>'
            + '<div class="incident-metro-legend">'
            + Object.keys(legend).map(function (state) {
                return '<span style="--metro-color: ' + legend[state] + '">' + escapeHtml(state) + '</span>';
            }).join('')
            + '</div>'
            + '</div>';
    }

    function renderMetroMapInto(container, entries) {
        var stops = entries.map(function (entry, index) {
            var state = entry.state || getMetroStateFromText(entry.text);

            return {
                index: index,
                label: getMetroStationLabel(entry.text),
                time: getMetroStationTime(entry.text),
                state: state,
                color: getMetroStateColor(state)
            };
        });
        var legend = {};
        var segments;

        if (! container) {
            return;
        }

        if (stops.length < 2) {
            container.innerHTML = '<p class="event-metro-empty">No timeline data for this range.</p>';
            return;
        }

        segments = stops.slice(0, -1).map(function (stop, index) {
            var from = stops.length > 1 ? (index * 100 / (stops.length - 1)) : 0;
            var to = stops.length > 1 ? ((index + 1) * 100 / (stops.length - 1)) : 100;

            return '<span class="incident-metro-segment" style="--left: calc('
                + String(from.toFixed(3))
                + '% + 0.5em); --right: calc('
                + String((100 - to).toFixed(3))
                + '% + 0.5em); --metro-color: '
                + stop.color
                + '"></span>';
        }).join('');

        stops.forEach(function (stop) {
            legend[stop.state] = stop.color;
        });

        container.innerHTML = '<div class="incident-metro-timeline event-metro-map">'
            + '<div class="incident-metro-viewport" style="--metro-count: '
            + String(stops.length)
            + '; --metro-width: '
            + String(Math.max(44, stops.length * 6))
            + 'em">'
            + '<div class="incident-metro-line">'
            + segments
            + stops.map(function (stop, index) {
                return '<div class="incident-metro-stop'
                    + (index === 0 ? ' current' : '')
                    + '" style="--metro-color: '
                    + stop.color
                    + '">'
                    + '<span class="incident-metro-label">' + escapeHtml(stop.label) + '</span>'
                    + '<span class="incident-metro-dot"></span>'
                    + '<span class="incident-metro-time">' + escapeHtml(stop.time || ('#' + String(index + 1))) + '</span>'
                    + '</div>';
            }).join('')
            + '</div>'
            + '<div class="incident-metro-legend">'
            + Object.keys(legend).map(function (state) {
                return '<span style="--metro-color: ' + legend[state] + '">' + escapeHtml(state) + '</span>';
            }).join('')
            + '</div>'
            + '</div>'
            + '</div>';
    }

    function setIncidentTimelineState(state, items) {
        var container = document.querySelector('[data-incident-timeline]');
        var title = document.querySelector('[data-incident-timeline-title]');
        var list = document.querySelector('[data-incident-timeline-list]');
        var metro = document.querySelector('[data-incident-metro-timeline]');
        var entries = items || [];

        if (! container || ! list) {
            return;
        }

        container.hidden = state === 'hidden';
        if (title) {
            title.textContent = getIncidentDrawerLabel('timeline-label', 'Metro Timeline');
        }

        if (state === 'loading') {
            if (metro) {
                metro.hidden = true;
                metro.innerHTML = '';
            }
            list.innerHTML = '<li class="incident-drawer-timeline-muted">'
                + escapeHtml(getIncidentDrawerLabel('timeline-loading-label', 'Loading history...'))
                + '</li>';
            return;
        }

        if (! entries.length) {
            if (metro) {
                metro.hidden = true;
                metro.innerHTML = '';
            }
            list.innerHTML = '<li class="incident-drawer-timeline-muted">'
                + escapeHtml(getIncidentDrawerLabel('timeline-empty-label', 'No recent history found.'))
                + '</li>';
            focusIncidentMetroTimelineWhenReady();
            return;
        }

        renderIncidentMetroTimeline(entries);
        focusIncidentMetroTimelineWhenReady();
        list.innerHTML = entries.map(function (entry) {
            return '<li><a href="'
                + escapeHtml(entry.url || '#')
                + '" data-base-target="_main">'
                + escapeHtml(entry.text)
                + '</a></li>';
        }).join('');
    }

    function extractHistoryTimelineItems(html, historyUrl) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var nodes = doc.querySelectorAll(
            '[data-action-item], .action-list li, .item-list li, .state-row, tr, article, .history-event'
        );
        var items = [];
        var seen = {};
        var i;

        for (i = 0; i < nodes.length && items.length < 9; i++) {
            var node = nodes[i];
            var text = normalizeText(node.textContent || '');
            var link = node.querySelector('a[href]');
            var url = link ? normalizeIncidentUrl(link.getAttribute('href') || link.href || '') : historyUrl;
            var entryText;

            if (! text.length || text.length < 12 || seen[text]) {
                continue;
            }

            entryText = text.length > 180 ? text.slice(0, 180).replace(/\s+\S*$/, '') + '...' : text;
            seen[text] = true;
            items.push({
                text: entryText,
                url: url,
                state: getMetroStateFromText(entryText)
            });
        }

        return items;
    }

    function loadIncidentTimeline(object) {
        var urls = buildIcingadbContextUrls(object);
        var historyUrl = urls.history || '';

        if (incidentDrawerState.timelineAbortController) {
            incidentDrawerState.timelineAbortController.abort();
            incidentDrawerState.timelineAbortController = null;
        }

        if (! object || ! historyUrl.length || typeof window.fetch !== 'function') {
            setIncidentTimelineState('hidden');
            return;
        }

        incidentDrawerState.timelineAbortController = typeof AbortController === 'function'
            ? new AbortController()
            : null;

        setIncidentTimelineState('loading');

        window.fetch(historyUrl, {
            credentials: 'same-origin',
            signal: incidentDrawerState.timelineAbortController
                ? incidentDrawerState.timelineAbortController.signal
                : undefined
        })
            .then(function (response) {
                if (! response.ok) {
                    throw new Error('Unable to load history');
                }

                return response.text();
            })
            .then(function (html) {
                setIncidentTimelineState('ready', extractHistoryTimelineItems(html, historyUrl));
            })
            .catch(function (error) {
                if (error && error.name === 'AbortError') {
                    return;
                }

                setIncidentTimelineState('hidden');
            });
    }

    function isEventDetailLocation() {
        var col1 = document.getElementById('col1');
        var url = col1 ? (col1.getAttribute('data-icinga-url') || '') : '';
        var path = window.location.pathname + window.location.search;

        return /(^|\/)icingadb\/event\b/i.test(url) || /\/icingadb\/event\b/i.test(path);
    }

    function getEventDetailRoot() {
        var col1 = document.getElementById('col1');

        if (! col1 || ! isEventDetailLocation()) {
            return null;
        }

        return col1.querySelector('.object-detail');
    }

    function formatEventMetroDate(date) {
        return String(date.getFullYear())
            + '-' + pad2(date.getMonth() + 1)
            + '-' + pad2(date.getDate());
    }

    function getEventMetroRange(range) {
        var now = new Date();
        var from = new Date(now.getTime());
        var to = new Date(now.getTime());

        if (range === 'day') {
            from.setDate(now.getDate() - 1);
        } else if (range === 'week') {
            from.setDate(now.getDate() - 7);
        } else if (range === 'month') {
            from.setMonth(now.getMonth() - 1);
        } else if (range === 'year') {
            from.setFullYear(now.getFullYear() - 1);
        } else {
            from.setHours(0, 0, 0, 0);
        }

        return {
            from: formatEventMetroDate(from),
            to: formatEventMetroDate(to)
        };
    }

    function buildEventMetroHistoryUrl(object, range) {
        var urls = buildIcingadbContextUrls(object);
        var historyUrl = urls.history || '';
        var parsed;

        if (! historyUrl.length) {
            return '';
        }

        try {
            parsed = new URL(historyUrl, window.location.href);
            if (range && range.from) {
                parsed.searchParams.set('from', range.from + ' 00:00:00');
            }
            if (range && range.to) {
                parsed.searchParams.set('to', range.to + ' 23:59:59');
            }

            return parsed.toString();
        } catch (error) {
            return historyUrl;
        }
    }

    function setEventMetroBusy(panel, busy) {
        if (panel) {
            panel.classList.toggle('is-loading', !! busy);
        }
    }

    function loadEventMetroTimeline(panel, object, range) {
        var map = panel ? panel.querySelector('[data-event-metro-map]') : null;
        var historyUrl = buildEventMetroHistoryUrl(object, range);

        if (! panel || ! map || ! historyUrl.length || typeof window.fetch !== 'function') {
            return;
        }

        setEventMetroBusy(panel, true);
        map.innerHTML = '<p class="event-metro-empty">Loading timeline...</p>';

        window.fetch(historyUrl, { credentials: 'same-origin' })
            .then(function (response) {
                if (! response.ok) {
                    throw new Error('Unable to load event metro history');
                }

                return response.text();
            })
            .then(function (html) {
                renderMetroMapInto(map, extractHistoryTimelineItems(html, historyUrl));
            })
            .catch(function () {
                map.innerHTML = '<p class="event-metro-empty">Timeline is unavailable for this range.</p>';
            })
            .then(function () {
                setEventMetroBusy(panel, false);
            });
    }

    function setEventMetroActiveRange(panel, range) {
        panel.querySelectorAll('[data-event-metro-range]').forEach(function (button) {
            button.classList.toggle('active', button.getAttribute('data-event-metro-range') === range);
        });
    }

    function createEventMetroPanel(object) {
        var panel = document.createElement('section');
        var current = getEventMetroRange('current');

        panel.className = 'event-metro-panel';
        panel.setAttribute('data-event-metro-panel', '');
        panel.innerHTML = '<div class="event-metro-toolbar">'
            + '<button type="button" data-event-metro-range="current">Current</button>'
            + '<button type="button" data-event-metro-range="day">Day</button>'
            + '<button type="button" data-event-metro-range="week">Week</button>'
            + '<button type="button" data-event-metro-range="month">Month</button>'
            + '<button type="button" data-event-metro-range="year">Year</button>'
            + '<input type="date" data-event-metro-from value="' + escapeHtml(current.from) + '">'
            + '<input type="date" data-event-metro-to value="' + escapeHtml(current.to) + '">'
            + '<button type="button" data-event-metro-apply>Range</button>'
            + '</div>'
            + '<div class="event-metro-canvas" data-event-metro-map></div>';
        panel.eventMetroObject = object;
        setEventMetroActiveRange(panel, 'current');
        loadEventMetroTimeline(panel, object, current);

        return panel;
    }

    function renderEventDetailMetroTimeline() {
        var root = getEventDetailRoot();
        var object;
        var existing;

        if (! root) {
            return;
        }

        existing = root.querySelector('[data-event-metro-panel]');
        if (existing) {
            return;
        }

        object = findIcingadbObjectInDocument(root);
        if (! object) {
            return;
        }

        root.appendChild(createEventMetroPanel(object));
    }

    function setIncidentNoteStatus(message) {
        var status = document.querySelector('[data-incident-note-status]');

        if (status) {
            status.textContent = message || '';
        }
    }

    function loadIncidentNote() {
        var section = document.querySelector('[data-incident-note-section]');
        var title = document.querySelector('[data-incident-note-title]');
        var textarea = document.querySelector('[data-incident-note]');
        var clear = document.querySelector('[data-clear-incident-note]');
        var note = incidentDrawerState.url.length ? getIncidentNote(incidentDrawerState.url) : '';

        if (! section || ! textarea) {
            return;
        }

        section.hidden = ! incidentDrawerState.url.length;
        textarea.value = note;
        textarea.placeholder = getIncidentDrawerLabel('note-placeholder', 'Add local operator note...');

        if (title) {
            title.textContent = getIncidentDrawerLabel('note-label', 'Private note');
        }

        if (clear) {
            clear.textContent = getIncidentDrawerLabel('note-clear-label', 'Clear note');
            clear.hidden = ! note.trim().length;
        }

        setIncidentNoteStatus(note.trim().length ? getIncidentDrawerLabel('note-saved-label', 'Saved locally') : '');
    }

    function saveIncidentNoteFromDom() {
        var textarea = document.querySelector('[data-incident-note]');
        var clear = document.querySelector('[data-clear-incident-note]');
        var note;

        if (! textarea || ! incidentDrawerState.url.length) {
            return;
        }

        note = String(textarea.value || '');
        setIncidentNote(incidentDrawerState.url, note);

        if (clear) {
            clear.hidden = ! note.trim().length;
        }

        setIncidentNoteStatus(note.trim().length ? getIncidentDrawerLabel('note-saved-label', 'Saved locally') : '');
    }

    function clearIncidentNote() {
        var textarea = document.querySelector('[data-incident-note]');

        if (! incidentDrawerState.url.length) {
            return;
        }

        setIncidentNote(incidentDrawerState.url, '');
        if (textarea) {
            textarea.value = '';
            textarea.focus();
        }

        recordOperatorActivity('Note', 'Cleared incident note', '', incidentDrawerState.url);
        loadIncidentNote();
    }

    function extractIncidentDetailsFromDocument(doc) {
        var content = doc.querySelector('#col1 .content, main .content, .content, body');
        var text;

        if (! content) {
            return '';
        }

        content.querySelectorAll('script, style, form, nav, .controls, .tabs').forEach(function (node) {
            node.parentNode.removeChild(node);
        });

        text = normalizeText(content.textContent || '');
        return text.length > 1200 ? text.slice(0, 1200).replace(/\s+\S*$/, '') + '...' : text;
    }

    function parseIncidentHtml(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');

        return {
            details: extractIncidentDetailsFromDocument(doc),
            object: findIcingadbObjectInDocument(doc)
        };
    }

    function loadIncidentDrawerDetails(url) {
        if (! url.length || typeof window.fetch !== 'function') {
            return;
        }

        if (incidentDrawerState.abortController) {
            incidentDrawerState.abortController.abort();
        }

        incidentDrawerState.abortController = typeof AbortController === 'function'
            ? new AbortController()
            : null;

        window.fetch(url, {
            credentials: 'same-origin',
            signal: incidentDrawerState.abortController ? incidentDrawerState.abortController.signal : undefined
        })
            .then(function (response) {
                if (! response.ok) {
                    throw new Error('Unable to load incident');
                }

                return response.text();
            })
            .then(function (html) {
                var parsed = parseIncidentHtml(html);

                if (url !== incidentDrawerState.url) {
                    return;
                }

                if (parsed.object) {
                    setIncidentQuickActions(parsed.object);
                    setIncidentObjectContext(parsed.object);
                    loadIncidentTimeline(parsed.object);
                }

                if (parsed.details.length) {
                    setIncidentDrawerBody(parsed.details, false);
                }
            })
            .catch(function (error) {
                if (error && error.name === 'AbortError') {
                    return;
                }

                if (url === incidentDrawerState.url) {
                    setIncidentDrawerBody(getIncidentDrawerLabel('unavailable-label', 'Incident details are unavailable.'), false);
                }
            });
    }

    function focusIncidentMetroTimelineWhenReady() {
        var timeline = document.querySelector('[data-incident-timeline]');

        if (! incidentDrawerState.focusTimeline || ! timeline || timeline.hidden) {
            return;
        }

        incidentDrawerState.focusTimeline = false;
        timeline.scrollIntoView({
            block: 'start',
            behavior: 'smooth'
        });
    }

    function openIncidentDrawerFromEventData(eventData, focusTimeline) {
        var drawer = getIncidentDrawer();
        var title = drawer ? drawer.querySelector('#incident-drawer-title') : null;
        var meta = drawer ? drawer.querySelector('[data-incident-meta]') : null;
        var open = drawer ? drawer.querySelector('[data-incident-open]') : null;
        var copy = drawer ? drawer.querySelector('[data-copy-incident-link]') : null;
        var titleText = normalizeText(eventData.title || '');
        var metaText = normalizeText(eventData.meta || '');
        var previewText = normalizeText(eventData.preview || '');
        var url = normalizeIncidentUrl(eventData.url || '');
        var object = eventData.object || getIcingadbObjectFromUrl(url);
        var skipDetailsLoad = !! eventData.skipDetailsLoad;

        if (! drawer || ! titleText.length || ! url.length) {
            return false;
        }

        incidentDrawerState.url = url;
        incidentDrawerState.focusTimeline = !! focusTimeline;
        lastFocusedElement = document.activeElement;
        markIncidentSeen(url);
        refreshSeenTopEventStates();
        if (isTriageModeEnabled()) {
            rerenderCachedTopEvents();
        }
        rememberRecentIncident({
            title: titleText,
            meta: metaText,
            url: url
        });
        recordOperatorActivity('Incident', 'Opened incident drawer', titleText, url);

        if (title) {
            title.textContent = titleText;
        }

        if (meta) {
            meta.textContent = metaText;
            meta.hidden = ! metaText.length;
        }

        if (open) {
            open.href = url || '#';
            open.textContent = getIncidentDrawerLabel('open-label', 'Open full details');
            open.hidden = ! url.length;
        }

        if (copy) {
            copy.textContent = getIncidentDrawerLabel('copy-label', 'Copy link');
            copy.hidden = ! url.length;
        }

        drawer.hidden = false;
        drawer.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        updatePinIncidentButton();
        updateSnoozeIncidentButton();
        loadIncidentNote();
        setIncidentQuickActions(object);
        setIncidentObjectContext(object);
        if (object) {
            loadIncidentTimeline(object);
        } else {
            setIncidentTimelineState('hidden');
        }
        setIncidentDrawerBody(
            previewText || getIncidentDrawerLabel('loading-label', 'Loading incident details...'),
            ! skipDetailsLoad
        );
        if (! skipDetailsLoad) {
            loadIncidentDrawerDetails(url);
        }

        if (open && ! open.hidden) {
            open.focus();
        }

        return true;
    }

    function openIncidentDrawerFromLink(link) {
        var item = link ? link.closest('.top-event-item') : null;
        var titleText = item ? normalizeText((item.querySelector('.top-event-title') || {}).textContent || '') : '';
        var metaText = item ? normalizeText((item.querySelector('.top-event-meta') || {}).textContent || '') : '';
        var previewText = item ? normalizeText((item.querySelector('.top-event-preview') || {}).textContent || '') : '';
        var url = normalizeIncidentUrl(link ? (link.getAttribute('href') || link.href || '') : '');
        var hasRenderedState = item && /top-event-state-/.test(item.className || '');

        if (! link || ! item || ! titleText.length || (! hasRenderedState && url.indexOf('/icingadb/history') !== -1)) {
            return false;
        }

        item.classList.add('top-event-seen');

        return openIncidentDrawerFromEventData({
            title: titleText,
            meta: metaText,
            preview: previewText,
            url: url
        }, false);
    }

    function openMetroTimelineForFocusEvent() {
        var event = getOperatorPlaybookEvent();
        var object;

        if (! event || ! event.url) {
            showOperatorToast('No focus event for metro timeline', 'warning');
            return;
        }

        object = getIcingadbObjectFromUrl(event.url);
        if (object) {
            event.object = object;
        }

        if (openIncidentDrawerFromEventData(event, true)) {
            recordOperatorActivity('Incident', 'Opened metro history timeline', normalizeText(event.title || event.meta || ''), event.url);
        }
    }

    function openIncidentDrawerFromHistoryBlock(block) {
        var event;
        var object;

        if (! block) {
            return false;
        }

        event = extractEvent(block);
        if (! event || ! event.url) {
            return false;
        }

        object = getIcingadbObjectFromUrl(event.url) || findIcingadbObjectInDocument({
            querySelectorAll: function (selector) {
                return block.querySelectorAll(selector);
            }
        });

        if (openIncidentDrawerFromEventData(event, true)) {
            recordOperatorActivity('Incident', 'Opened history event metro timeline', normalizeText(event.title || event.meta || ''), event.url);
            return true;
        }

        return false;
    }

    function closeIncidentDrawer() {
        var drawer = getIncidentDrawer();

        if (! drawer || drawer.hidden) {
            return;
        }

        if (incidentDrawerState.abortController) {
            incidentDrawerState.abortController.abort();
            incidentDrawerState.abortController = null;
        }

        if (incidentDrawerState.timelineAbortController) {
            incidentDrawerState.timelineAbortController.abort();
            incidentDrawerState.timelineAbortController = null;
        }

        drawer.hidden = true;
        drawer.setAttribute('aria-hidden', 'true');
        incidentDrawerState.focusTimeline = false;
        document.body.classList.remove('modal-open');

        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
    }

    function copyTextToClipboard(text) {
        var textarea;

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text);
        }

        textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            document.execCommand('copy');
        } finally {
            document.body.removeChild(textarea);
        }

        return Promise.resolve();
    }

    function copyIncidentLink(button) {
        var url = incidentDrawerState.url;

        if (! url.length || ! button) {
            return;
        }

        copyTextToClipboard(url).then(function () {
            recordOperatorActivity('Incident', 'Copied incident link', getCurrentIncidentSnapshot().title, url);
            showOperatorToast('Incident link copied');
            button.textContent = getIncidentDrawerLabel('copied-label', 'Copied');
            window.setTimeout(function () {
                if (! isIncidentDrawerOpen()) {
                    return;
                }

                button.textContent = getIncidentDrawerLabel('copy-label', 'Copy link');
            }, 1200);
        });
    }

    function getIncidentTimelineText() {
        var entries = [];

        document.querySelectorAll('[data-incident-timeline-list] li').forEach(function (item) {
            var text = normalizeText(item.textContent || '');

            if (text.length && ! item.classList.contains('incident-drawer-timeline-muted')) {
                entries.push(text);
            }
        });

        return entries;
    }

    function buildIncidentSummaryText() {
        var snapshot = getCurrentIncidentSnapshot();
        var objectName = getIcingadbObjectDisplayName(incidentDrawerState.object);
        var timeline = getIncidentTimelineText();
        var lines = [];

        if (snapshot.title.length) {
            lines.push('Incident: ' + snapshot.title);
        }

        if (snapshot.meta.length) {
            lines.push('Meta: ' + snapshot.meta);
        }

        if (objectName.length) {
            lines.push('Object: ' + objectName);
        }

        if (snapshot.url.length) {
            lines.push('URL: ' + snapshot.url);
        }

        if (getIncidentNote(snapshot.url).trim().length) {
            lines.push('Note: ' + getIncidentNote(snapshot.url).trim());
        }

        if (timeline.length) {
            lines.push('');
            lines.push('Recent history:');
            timeline.slice(0, 5).forEach(function (entry) {
                lines.push('- ' + entry);
            });
        }

        return lines.join('\n');
    }

    function copyIncidentSummary(button) {
        var summary = buildIncidentSummaryText();

        if (! summary.length || ! button) {
            return;
        }

        copyTextToClipboard(summary).then(function () {
            recordOperatorActivity('Incident', 'Copied incident summary', getCurrentIncidentSnapshot().title, incidentDrawerState.url);
            showOperatorToast('Incident summary copied');
            button.textContent = getIncidentDrawerLabel('copied-label', 'Copied');
            window.setTimeout(function () {
                if (! isIncidentDrawerOpen()) {
                    return;
                }

                button.textContent = getIncidentDrawerLabel('copy-summary-label', 'Copy summary');
            }, 1200);
        });
    }

    function getCurrentIncidentSnapshot() {
        var title = document.getElementById('incident-drawer-title');
        var meta = document.querySelector('[data-incident-meta]');

        return {
            title: title ? normalizeText(title.textContent || '') : '',
            meta: meta && ! meta.hidden ? normalizeText(meta.textContent || '') : '',
            url: incidentDrawerState.url
        };
    }

    function updatePinIncidentButton() {
        var button = document.querySelector('[data-pin-incident]');
        var pinned = incidentDrawerState.url.length && isIncidentPinned(incidentDrawerState.url);

        if (! button) {
            return;
        }

        button.hidden = ! incidentDrawerState.url.length;
        button.textContent = pinned
            ? getIncidentDrawerLabel('unpin-label', 'Unpin')
            : getIncidentDrawerLabel('pin-label', 'Pin');
        button.classList.toggle('active', pinned);
    }

    function updateSnoozeIncidentButton() {
        var button = document.querySelector('[data-snooze-incident]');
        var snoozed = incidentDrawerState.url.length && isIncidentSnoozed(incidentDrawerState.url);

        if (! button) {
            return;
        }

        button.hidden = ! incidentDrawerState.url.length;
        button.textContent = snoozed
            ? getIncidentDrawerLabel('snoozed-label', 'Snoozed')
            : getIncidentDrawerLabel('snooze-label', 'Snooze 15m');
        button.classList.toggle('active', snoozed);
    }

    function togglePinnedIncident() {
        var snapshot = getCurrentIncidentSnapshot();
        var pinned = isIncidentPinned(snapshot.url);

        setIncidentPinned(snapshot, ! pinned);
        recordOperatorActivity(
            'Incident',
            pinned ? 'Unpinned incident' : 'Pinned incident',
            snapshot.title,
            snapshot.url
        );
        updatePinIncidentButton();
        renderOperatorBoards();
    }

    function snoozeCurrentIncident() {
        if (! incidentDrawerState.url.length) {
            return;
        }

        snoozeIncident(incidentDrawerState.url);
        recordOperatorActivity('Incident', 'Snoozed incident', getCurrentIncidentSnapshot().title, incidentDrawerState.url);
        updateSnoozeIncidentButton();
        rerenderCachedTopEvents();
        refreshTopEvents(true);
        renderOperatorBoards();
        closeIncidentDrawer();
    }

    function focusSearchField() {
        var input = getSearchInput();

        if (! input) {
            return false;
        }

        input.focus();
        input.select();

        return true;
    }

    function openShortcutsDialog() {
        var modal = document.getElementById('keyboard-shortcuts-modal');
        var closeButton;

        if (! modal || ! modal.hidden) {
            return;
        }

        lastFocusedElement = document.activeElement;

        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        closeButton = modal.querySelector('.keyboard-shortcuts-close');
        if (closeButton) {
            closeButton.focus();
        }
    }

    function closeShortcutsDialog() {
        var modal = document.getElementById('keyboard-shortcuts-modal');

        if (! modal || modal.hidden) {
            return;
        }

        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');

        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
    }

    function toggleShortcutsDialog() {
        var modal = document.getElementById('keyboard-shortcuts-modal');

        if (! modal) {
            return;
        }

        if (modal.hidden) {
            openShortcutsDialog();
        } else {
            closeShortcutsDialog();
        }
    }

    function isShortcutsDialogOpen() {
        var modal = document.getElementById('keyboard-shortcuts-modal');

        return !! modal && ! modal.hidden;
    }

    function getBaseUrl() {
        return (document.documentElement.dataset.icingaBaseUrl || '').replace(/\/+$/, '');
    }

    function navigateTo(path) {
        var baseUrl = getBaseUrl();
        var cleanPath = (path || '').replace(/^\/+/, '');

        window.location.href = cleanPath.length ? (baseUrl + '/' + cleanPath) : (baseUrl + '/');
    }

    function getCommandPalette() {
        return document.getElementById('command-palette-modal');
    }

    function getCommandPaletteInput() {
        return document.getElementById('command-palette-input');
    }

    function getCommandPaletteResults() {
        return document.getElementById('command-palette-results');
    }

    function isCommandPaletteOpen() {
        var modal = getCommandPalette();

        return !! modal && ! modal.hidden;
    }

    function getCommandPaletteLabel(name, fallback) {
        var modal = getCommandPalette();
        var key = name.replace(/-([a-z])/g, function (_, letter) {
            return letter.toUpperCase();
        });

        if (modal && modal.dataset[key]) {
            return modal.dataset[key];
        }

        return fallback;
    }

    function makeCommand(type, label, category, description, value, element) {
        return {
            type: type,
            label: label,
            category: category,
            description: description || '',
            value: value || '',
            element: element || null
        };
    }

    function getStaticCommands() {
        var navigation = getCommandPaletteLabel('navigation-label', 'Navigation');
        var actions = getCommandPaletteLabel('actions-label', 'Actions');

        return [
            makeCommand('navigate', 'Dashboard', navigation, 'Open dashboard overview', 'dashboard'),
            makeCommand('navigate', 'Tactical Overview', navigation, 'Open tactical monitoring overview', 'icingadb/tactical'),
            makeCommand('navigate', 'Event History', navigation, 'Open latest monitoring events', 'icingadb/history'),
            makeCommand('navigate', 'Search', navigation, 'Open global search page', 'search'),
            makeCommand('navigate', 'My Account', navigation, 'Open account preferences', 'account'),
            makeCommand('navigate', 'Configuration', navigation, 'Open configuration area', 'config'),
            makeCommand('shortcut', 'Keyboard Shortcuts', actions, 'Show available keyboard shortcuts', 'shortcuts'),
            makeCommand(
                'triageMode',
                isTriageModeEnabled() ? 'Disable Triage Mode' : 'Enable Triage Mode',
                actions,
                'Filter latest events to unresolved unseen problems',
                isTriageModeEnabled() ? 'off' : 'on'
            ),
            makeCommand('triageDesk', 'Triage Desk', actions, 'Open the active triage queue workspace', ''),
            makeCommand('operatorHandoff', 'Operator Handoff', actions, 'Generate a shift handoff report', ''),
            makeCommand('operatorActivity', 'Audit Timeline', actions, 'Review filtered operator audit events', ''),
            makeCommand('copyOperatorAuditTimeline', 'Copy Audit Timeline', actions, 'Copy the filtered operator audit timeline', ''),
            makeCommand('operatorPlaybook', 'Operator Playbook', actions, 'Open recommended actions for the focus event', ''),
            makeCommand('copyOperatorPlaybook', 'Copy Operator Playbook', actions, 'Copy recommended actions for the focus event', ''),
            makeCommand('density', 'Density: Compact', actions, 'Use denser lists and smaller operational panels', 'compact'),
            makeCommand('density', 'Density: Comfortable', actions, 'Use the default balanced layout density', 'comfortable'),
            makeCommand('density', 'Density: Wallboard', actions, 'Use larger event cards for shared displays', 'wallboard'),
            makeCommand('navigate', 'Log Out', actions, 'End current session', 'authentication/logout')
        ];
    }

    function getAnchorCommandLabel(anchor) {
        var text = normalizeText(anchor.textContent || anchor.getAttribute('aria-label') || anchor.title || '');

        return text.replace(/\s+/g, ' ').trim();
    }

    function isUsableCommandAnchor(anchor) {
        var href = anchor.getAttribute('href') || '';

        if (! href || href === '#' || href.indexOf('javascript:') === 0) {
            return false;
        }

        if (anchor.closest('.keyboard-shortcuts-modal, .command-palette-modal, .quick-menu-context')) {
            return false;
        }

        if (anchor.matches('[data-qm-title]')) {
            return false;
        }

        return Boolean(getAnchorCommandLabel(anchor).length);
    }

    function collectNavigationCommands() {
        var navigation = getCommandPaletteLabel('navigation-label', 'Navigation');
        var currentPage = getCommandPaletteLabel('current-page-label', 'Current Page');
        var commands = [];
        var seen = {};

        document.querySelectorAll('#menu a[href], .config-menu a[href], #main .controls a[href]').forEach(function (anchor) {
            var label;
            var href;
            var key;
            var category;

            if (! isUsableCommandAnchor(anchor)) {
                return;
            }

            label = getAnchorCommandLabel(anchor);
            href = anchor.getAttribute('href') || anchor.href || '';
            key = label.toLowerCase() + '|' + href;

            if (seen[key]) {
                return;
            }

            seen[key] = true;
            category = anchor.closest('#main') ? currentPage : navigation;
            commands.push(makeCommand('anchor', label, category, href, href, anchor));
        });

        return commands;
    }

    function getRecentIncidentCommands() {
        return readRecentIncidents().filter(function (incident) {
            return incident && incident.title && incident.url;
        }).map(function (incident) {
            return makeCommand(
                'incident',
                incident.title,
                'Recent Incidents',
                incident.meta || 'Open incident details',
                incident.url
            );
        });
    }

    function getPinnedIncidentCommands() {
        var incidents = readPinnedIncidents().filter(function (incident) {
            return incident && incident.title && incident.url;
        });
        var commands = incidents.map(function (incident) {
            return makeCommand(
                'incident',
                incident.title,
                'Pinned Incidents',
                incident.meta || 'Open pinned incident',
                incident.url
            );
        });

        if (incidents.length) {
            commands.push(makeCommand(
                'clearPinnedIncidents',
                'Clear pinned incidents',
                'Pinned Incidents',
                'Remove all locally pinned incidents',
                ''
            ));
        }

        return commands;
    }

    function getSeenIncidentCommands() {
        if (! readSeenIncidents().length) {
            return [];
        }

        return [
            makeCommand(
                'clearSeenIncidents',
                'Clear seen incidents',
                'Seen Incidents',
                'Reset local seen markers in the top event feed',
                ''
            )
        ];
    }

    function getSnoozedIncidentCommands() {
        if (! Object.keys(readSnoozedIncidents()).length) {
            return [];
        }

        return [
            makeCommand(
                'clearSnoozedIncidents',
                'Clear snoozed incidents',
                'Snoozed Incidents',
                'Show locally snoozed top feed incidents again',
                ''
            )
        ];
    }

    function getTriageResetCommands() {
        if (! readSeenIncidents().length && ! Object.keys(readSnoozedIncidents()).length) {
            return [];
        }

        return [
            makeCommand(
                'resetTriageQueue',
                'Reset triage queue',
                'Triage Queue',
                'Clear local seen and snoozed triage markers',
                ''
            )
        ];
    }

    function getOperatorActivityCommands() {
        if (! readOperatorActivity().length) {
            return [];
        }

        return [
            makeCommand(
                'clearOperatorActivity',
                'Clear operator activity log',
                'Operator Activity',
                'Remove the local operator action history',
                ''
            )
        ];
    }

    function getOperatorDecisionCommands() {
        var lanes = createOperatorDecisionSnapshot();
        var labels = {
            now: 'Open act now decision',
            watch: 'Open watch decision',
            parked: 'Open parked decision',
            handled: 'Open handled decision'
        };

        return Object.keys(labels).filter(function (lane) {
            return lanes[lane] && lanes[lane].length;
        }).map(function (lane) {
            var item = lanes[lane][0];

            return makeCommand(
                'operatorDecisionLane',
                labels[lane],
                'Decision Matrix',
                getOperatorDecisionLaneTitle(item),
                lane
            );
        });
    }

    function getTriageQueueCommands() {
        var events = getActiveTriageEvents();
        var focus = getOperatorFocusSnapshot().next;
        var nextPinned;

        if (! events.length) {
            return [];
        }

        nextPinned = isIncidentPinned(events[0].url);

        return [
            makeCommand(
                'operatorFocusEvent',
                'Open focus event',
                'Operator Focus',
                focus ? normalizeText(focus.title || focus.meta || 'Open highest priority triage event') : 'Open highest priority triage event',
                focus ? focus.url : events[0].url
            ),
            makeCommand(
                'incident',
                'Open next triage event',
                'Triage Queue',
                normalizeText(events[0].title || events[0].meta || 'Open active triage event'),
                events[0].url
            ),
            makeCommand(
                'toggleTriageEventPin',
                nextPinned ? 'Unpin next triage event' : 'Pin next triage event',
                'Triage Queue',
                normalizeText(events[0].title || events[0].meta || 'Pin active triage event'),
                events[0].url
            ),
            makeCommand(
                'snoozeTriageEvent',
                'Snooze next triage event',
                'Triage Queue',
                normalizeText(events[0].title || events[0].meta || 'Snooze active triage event'),
                events[0].url
            ),
            makeCommand(
                'markTriageEventSeen',
                'Mark next triage event seen',
                'Triage Queue',
                normalizeText(events[0].title || events[0].meta || 'Mark active triage event seen'),
                events[0].url
            ),
            makeCommand(
                'copyTriageDigest',
                'Copy triage digest',
                'Triage Queue',
                'Copy ' + String(events.length) + ' active triage event' + (events.length === 1 ? '' : 's'),
                ''
            )
        ];
    }

    function parseOperatorAction(query) {
        var text = normalizeText(query).toLowerCase();
        var match = text.match(/^(ack|acknowledge|recheck|check|downtime|comment)\s+(.+)$/);
        var actionMap = {
            ack: 'acknowledge',
            acknowledge: 'acknowledge',
            recheck: 'check-now',
            check: 'check-now',
            downtime: 'schedule-downtime',
            comment: 'add-comment'
        };

        if (! match) {
            return {
                action: '',
                expression: query
            };
        }

        return {
            action: actionMap[match[1]] || '',
            expression: query.replace(/^\s*\S+\s+/, '')
        };
    }

    function parseObjectExpression(expression) {
        var text = normalizeText(expression);
        var match;

        if (! text.length) {
            return null;
        }

        match = text.match(/^host\s*[:=]\s*(.+)$/i);
        if (match && match[1].trim().length) {
            return {
                type: 'host',
                hostName: match[1].trim(),
                serviceName: ''
            };
        }

        match = text.match(/^service\s*[:=]\s*(.+)$/i);
        if (match) {
            text = match[1].trim();
        }

        match = text.match(/^(.+?)\s+on\s+(.+)$/i);
        if (match && match[1].trim().length && match[2].trim().length) {
            return {
                type: 'service',
                hostName: match[2].trim(),
                serviceName: match[1].trim()
            };
        }

        match = text.match(/^(.+?)!(.+)$/);
        if (match && match[1].trim().length && match[2].trim().length) {
            return {
                type: 'service',
                hostName: match[1].trim(),
                serviceName: match[2].trim()
            };
        }

        if (/^host\s+/i.test(text)) {
            text = text.replace(/^host\s+/i, '').trim();
        }

        if (text.length && text.indexOf(' ') === -1 && text.indexOf(':') === -1) {
            return {
                type: 'host',
                hostName: text,
                serviceName: ''
            };
        }

        return null;
    }

    function getObjectCommandLabel(object, action) {
        var name;
        var labels = {
            'acknowledge': 'Acknowledge',
            'check-now': 'Recheck now',
            'schedule-downtime': 'Schedule downtime',
            'add-comment': 'Add comment'
        };

        if (! object) {
            return '';
        }

        name = object.type === 'service'
            ? object.serviceName + ' on ' + object.hostName
            : object.hostName;

        if (action) {
            return (labels[action] || action) + ': ' + name;
        }

        return 'Open ' + (object.type === 'service' ? 'service ' : 'host ') + name;
    }

    function getOperatorObjectCommands(query) {
        var parsed = parseOperatorAction(query);
        var object = parseObjectExpression(parsed.expression);
        var category = 'Objects';
        var url;

        if (! object) {
            return [];
        }

        url = parsed.action
            ? buildIcingadbActionUrl(object, parsed.action)
            : buildIcingadbObjectUrl(object);

        if (! url.length) {
            return [];
        }

        return [
            makeCommand(
                'navigateAbsolute',
                getObjectCommandLabel(object, parsed.action),
                category,
                object.type === 'service' ? 'IcingaDB service object' : 'IcingaDB host object',
                url
            )
        ];
    }

    function getCurrentObjectCommands() {
        var object = getIcingadbObjectFromUrl(window.location.href);
        var category = 'Current Object';
        var actions = [
            ['Open object', buildIcingadbObjectUrl(object), 'Open the current IcingaDB object'],
            ['History', buildIcingadbContextUrls(object).history, 'Open object history'],
            ['Comments', buildIcingadbContextUrls(object).comments, 'Open object comments'],
            ['Downtimes', buildIcingadbContextUrls(object).downtimes, 'Open object downtimes'],
            ['Acknowledge', buildIcingadbActionUrl(object, 'acknowledge'), 'Open acknowledge form'],
            ['Recheck now', buildIcingadbActionUrl(object, 'check-now'), 'Open immediate recheck form'],
            ['Schedule downtime', buildIcingadbActionUrl(object, 'schedule-downtime'), 'Open downtime form'],
            ['Add comment', buildIcingadbActionUrl(object, 'add-comment'), 'Open comment form']
        ];

        if (! object) {
            return [];
        }

        return actions.filter(function (entry) {
            return entry[1] && entry[1].length;
        }).map(function (entry) {
            return makeCommand(
                'navigateAbsolute',
                entry[0] + ': ' + getIcingadbObjectDisplayName(object),
                category,
                entry[2],
                entry[1]
            );
        });
    }

    function commandMatches(command, query) {
        var haystack;

        if (! query.length) {
            return true;
        }

        haystack = normalizeText([
            command.label,
            command.category,
            command.description,
            command.value
        ].join(' ')).toLowerCase();

        return haystack.indexOf(query) !== -1;
    }

    function scoreCommand(command, query) {
        var label = normalizeText(command.label).toLowerCase();
        var value = normalizeText(command.value).toLowerCase();

        if (! query.length) {
            return command.type === 'anchor' ? 40 : 10;
        }

        if (label === query) {
            return 0;
        }

        if (label.indexOf(query) === 0) {
            return 1;
        }

        if (value.indexOf(query) === 0) {
            return 2;
        }

        if (label.indexOf(query) !== -1) {
            return 3;
        }

        return 8;
    }

    function buildCommandPaletteCommands(query) {
        var normalizedQuery = normalizeText(query || '').toLowerCase();
        var commands = getStaticCommands()
            .concat(getCurrentObjectCommands())
            .concat(getOperatorObjectCommands(query))
            .concat(getPinnedIncidentCommands())
            .concat(getSeenIncidentCommands())
            .concat(getSnoozedIncidentCommands())
            .concat(getTriageResetCommands())
            .concat(getTriageQueueCommands())
            .concat(getOperatorDecisionCommands())
            .concat(getOperatorActivityCommands())
            .concat(getRecentIncidentCommands())
            .concat(collectNavigationCommands());
        var searchLabel = getCommandPaletteLabel('search-label', 'Search for');

        commands = commands.filter(function (command) {
            return commandMatches(command, normalizedQuery);
        }).sort(function (a, b) {
            var scoreDiff = scoreCommand(a, normalizedQuery) - scoreCommand(b, normalizedQuery);

            if (scoreDiff !== 0) {
                return scoreDiff;
            }

            return a.label.localeCompare(b.label);
        });

        if (normalizedQuery.length) {
            commands.unshift(makeCommand(
                'search',
                searchLabel + ' "' + query.trim() + '"',
                getCommandPaletteLabel('actions-label', 'Actions'),
                'Run global search',
                query.trim()
            ));
        }

        return commands.slice(0, COMMAND_PALETTE_RESULT_LIMIT);
    }

    function setCommandPaletteActive(index) {
        var results = getCommandPaletteResults();
        var buttons;

        if (! results || ! commandPaletteState.commands.length) {
            commandPaletteState.activeIndex = 0;
            return;
        }

        commandPaletteState.activeIndex = clamp(index, 0, commandPaletteState.commands.length - 1);
        buttons = results.querySelectorAll('[data-command-index]');
        buttons.forEach(function (button, buttonIndex) {
            var active = buttonIndex === commandPaletteState.activeIndex;

            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }

    function renderCommandPaletteResults() {
        var input = getCommandPaletteInput();
        var results = getCommandPaletteResults();
        var empty = document.querySelector('[data-command-palette-empty]');
        var query = input ? input.value : '';

        if (! results) {
            return;
        }

        commandPaletteState.commands = buildCommandPaletteCommands(query);
        results.innerHTML = commandPaletteState.commands.map(function (command, index) {
            return '<li role="presentation">'
                + '<button type="button" role="option" data-command-index="' + String(index) + '">'
                + '<span class="command-palette-command-main">'
                + '<strong>' + escapeHtml(command.label) + '</strong>'
                + '<small>' + escapeHtml(command.category) + '</small>'
                + '</span>'
                + '<span class="command-palette-command-desc">' + escapeHtml(command.description) + '</span>'
                + '</button>'
                + '</li>';
        }).join('');

        if (empty) {
            empty.textContent = getCommandPaletteLabel('empty-label', 'No command found');
            empty.hidden = commandPaletteState.commands.length > 0;
        }

        setCommandPaletteActive(0);
    }

    function openCommandPalette(prefill) {
        var modal = getCommandPalette();
        var input = getCommandPaletteInput();

        if (! modal || ! input) {
            return;
        }

        lastFocusedElement = document.activeElement;

        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        input.placeholder = getCommandPaletteLabel('placeholder', 'Type a command, page, host or service');
        input.value = prefill || '';
        renderCommandPaletteResults();
        input.focus();
        input.select();
    }

    function closeCommandPalette() {
        var modal = getCommandPalette();

        if (! modal || modal.hidden) {
            return;
        }

        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');

        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
        }
    }

    function runCommandPaletteCommand(command) {
        if (! command) {
            return;
        }

        closeCommandPalette();

        if (command.type === 'search') {
            navigateTo('search?q=' + encodeURIComponent(command.value));
            return;
        }

        if (command.type === 'shortcut') {
            openShortcutsDialog();
            return;
        }

        if (command.type === 'density') {
            setDensityMode(command.value);
            return;
        }

        if (command.type === 'triageMode') {
            setTriageMode(command.value === 'on');
            return;
        }

        if (command.type === 'triageDesk') {
            openTriageDesk();
            return;
        }

        if (command.type === 'operatorHandoff') {
            openOperatorHandoff();
            return;
        }

        if (command.type === 'operatorActivity') {
            openOperatorActivity();
            return;
        }

        if (command.type === 'copyOperatorAuditTimeline') {
            copyOperatorAuditTimeline();
            return;
        }

        if (command.type === 'operatorPlaybook') {
            openOperatorPlaybook();
            return;
        }

        if (command.type === 'copyOperatorPlaybook') {
            copyOperatorPlaybook();
            return;
        }

        if (command.type === 'anchor' && command.element) {
            command.element.click();
            return;
        }

        if (command.type === 'incident') {
            recordOperatorActivity('Incident', 'Opened incident from command palette', command.label, command.value);
            window.location.href = command.value;
            return;
        }

        if (command.type === 'operatorFocusEvent') {
            recordOperatorActivity('Triage', 'Opened focus event', command.description, command.value);
            window.location.href = command.value;
            return;
        }

        if (command.type === 'operatorDecisionLane') {
            runOperatorDecisionAction(command.value);
            return;
        }

        if (command.type === 'clearPinnedIncidents') {
            writePinnedIncidents([]);
            renderOperatorBoards();
            recordOperatorActivity('Incident', 'Cleared pinned incidents', '', '');
            showOperatorToast('Pinned incidents cleared');
            renderCommandPaletteResults();
            return;
        }

        if (command.type === 'clearSeenIncidents') {
            writeSeenIncidents([]);
            refreshSeenTopEventStates();
            rerenderCachedTopEvents();
            renderOperatorBoards();
            recordOperatorActivity('Incident', 'Cleared seen incidents', '', '');
            showOperatorToast('Seen incidents cleared');
            renderCommandPaletteResults();
            return;
        }

        if (command.type === 'clearSnoozedIncidents') {
            writeSnoozedIncidents({});
            rerenderCachedTopEvents();
            refreshTopEvents(true);
            renderOperatorBoards();
            recordOperatorActivity('Incident', 'Cleared snoozed incidents', '', '');
            showOperatorToast('Snoozed incidents cleared');
            renderCommandPaletteResults();
            return;
        }

        if (command.type === 'clearOperatorActivity') {
            clearOperatorActivity();
            renderCommandPaletteResults();
            return;
        }

        if (command.type === 'resetTriageQueue') {
            resetTriageQueue();
            renderCommandPaletteResults();
            return;
        }

        if (command.type === 'copyTriageDigest') {
            copyTextToClipboard(buildTriageDigestText()).then(function () {
                recordOperatorActivity('Triage', 'Copied triage digest', '', '');
                showOperatorToast('Triage digest copied');
            });
            return;
        }

        if (command.type === 'snoozeTriageEvent') {
            snoozeIncident(command.value);
            rerenderCachedTopEvents();
            refreshTopEvents(true);
            renderOperatorBoards();
            recordOperatorActivity('Triage', 'Snoozed next triage event', '', command.value);
            showOperatorToast('Next triage event snoozed');
            return;
        }

        if (command.type === 'toggleTriageEventPin') {
            var event = getActiveTriageEventByUrl(command.value);
            if (event) {
                setIncidentPinned(event, ! isIncidentPinned(command.value));
                recordOperatorActivity(
                    'Triage',
                    isIncidentPinned(command.value) ? 'Pinned next triage event' : 'Unpinned next triage event',
                    normalizeText(event.title || event.meta || ''),
                    command.value
                );
                showOperatorToast(isIncidentPinned(command.value) ? 'Next triage event pinned' : 'Next triage event unpinned');
            }
            renderOperatorBoards();
            return;
        }

        if (command.type === 'markTriageEventSeen') {
            markIncidentSeen(command.value);
            refreshSeenTopEventStates();
            rerenderCachedTopEvents();
            renderOperatorBoards();
            recordOperatorActivity('Triage', 'Marked next triage event seen', '', command.value);
            showOperatorToast('Next triage event marked seen');
            return;
        }

        if (command.type === 'navigateAbsolute') {
            window.location.href = command.value;
            return;
        }

        if (command.type === 'navigate') {
            navigateTo(command.value);
        }
    }

    function handleCommandPaletteKeydown(event) {
        if (! isCommandPaletteOpen()) {
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            closeCommandPalette();
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setCommandPaletteActive(commandPaletteState.activeIndex + 1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setCommandPaletteActive(commandPaletteState.activeIndex - 1);
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            setCommandPaletteActive(0);
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            setCommandPaletteActive(commandPaletteState.commands.length - 1);
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            runCommandPaletteCommand(commandPaletteState.commands[commandPaletteState.activeIndex]);
        }
    }

    function activateShortcutTarget(target) {
        if (target === 's') {
            if (! focusSearchField()) {
                navigateTo('search');
            }

            return;
        }

        if (target === 'd') {
            navigateTo('dashboard');
            return;
        }

        if (target === 'a') {
            navigateTo('account');
            return;
        }

        if (target === 'l') {
            navigateTo('authentication/logout');
        }
    }

    function clearGoSequence() {
        if (goState.timer !== null) {
            window.clearTimeout(goState.timer);
            goState.timer = null;
        }

        goState.pending = false;
    }

    function startGoSequence() {
        clearGoSequence();

        goState.pending = true;
        goState.timer = window.setTimeout(function () {
            clearGoSequence();
        }, NAV_SEQUENCE_TIMEOUT);
    }

    function handleGlobalShortcuts(event) {
        var key = event.key || '';

        if ((event.ctrlKey || event.metaKey) && ! event.altKey && key.toLowerCase() === 'k') {
            event.preventDefault();
            openCommandPalette();
            return;
        }

        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        if (isCommandPaletteOpen()) {
            if (key === 'Escape') {
                event.preventDefault();
                closeCommandPalette();
            }

            return;
        }

        if (isShortcutsDialogOpen() && key === 'Escape') {
            event.preventDefault();
            closeShortcutsDialog();
            return;
        }

        if (key === '?') {
            if (! isEditableTarget(event.target)) {
                event.preventDefault();
                toggleShortcutsDialog();
            }

            return;
        }

        if (isEditableTarget(event.target)) {
            return;
        }

        if (goState.pending) {
            clearGoSequence();

            if (key === 'd' || key === 's' || key === 'a' || key === 'l') {
                event.preventDefault();
                activateShortcutTarget(key);
            }

            return;
        }

        if (key === 'g') {
            event.preventDefault();
            startGoSequence();
        }
    }

    function trapDialogFocus(event) {
        var modal;
        var focusable;
        var first;
        var last;

        if (event.key !== 'Tab'
            || (! isShortcutsDialogOpen()
                && ! isCommandPaletteOpen()
                && ! isIncidentDrawerOpen()
                && ! isTriageDeskOpen()
                && ! isOperatorHandoffOpen()
                && ! isOperatorActivityOpen()
                && ! isOperatorPlaybookOpen())) {
            return;
        }

        if (isCommandPaletteOpen()) {
            modal = getCommandPalette();
        } else if (isOperatorPlaybookOpen()) {
            modal = getOperatorPlaybook();
        } else if (isOperatorActivityOpen()) {
            modal = getOperatorActivity();
        } else if (isOperatorHandoffOpen()) {
            modal = getOperatorHandoff();
        } else if (isTriageDeskOpen()) {
            modal = getTriageDesk();
        } else if (isIncidentDrawerOpen()) {
            modal = getIncidentDrawer();
        } else {
            modal = document.getElementById('keyboard-shortcuts-modal');
        }
        if (! modal) {
            return;
        }

        focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (! focusable.length) {
            return;
        }

        first = focusable[0];
        last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (! event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function onSubmit(event) {
        var form = event.target;
        var input;

        if (! form.matches('form.search-control')) {
            return;
        }

        input = form.querySelector('#search');
        if (! input) {
            return;
        }

        rememberSearchQuery(input.value);

        window.setTimeout(renderRecentSearches, 0);
    }

    function getQuickMenuRoot() {
        return document.querySelector('[data-quick-menu]');
    }

    function parseQuickMenuItems(raw) {
        try {
            var parsed = JSON.parse(raw || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    }

    function getQuickMenuSourceSignature(root) {
        if (! root) {
            return '';
        }

        return [
            root.dataset.itemsJson || '[]',
            root.dataset.note || ''
        ].join('\n');
    }

    function updateQuickMenuSourceData(root) {
        if (! root) {
            return;
        }

        root.dataset.itemsJson = JSON.stringify(quickMenuState.items);
        root.dataset.note = quickMenuState.note;
        quickMenuState.sourceSignature = getQuickMenuSourceSignature(root);
    }

    function getQuickNotebookDraftKey() {
        var root = getQuickMenuRoot();
        var apiScope = root && root.dataset.apiUrl ? root.dataset.apiUrl : window.location.pathname;
        var userScope = root && root.dataset.userScope ? root.dataset.userScope : 'anonymous';
        var scope = encodeURIComponent(String(apiScope)) + ':' + encodeURIComponent(String(userScope));

        return QUICK_NOTE_DRAFT_KEY + ':' + scope;
    }

    function readQuickNotebookDraft() {
        var key = getQuickNotebookDraftKey();
        var value = null;

        try {
            value = window.sessionStorage.getItem(key);
            if (value !== null) {
                return value;
            }
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }

        try {
            value = window.localStorage.getItem(key);
            if (value !== null) {
                return value;
            }
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }

        return null;
    }

    function writeQuickNotebookDraft(note) {
        var key = getQuickNotebookDraftKey();
        var value = String(note || '');

        try {
            window.sessionStorage.setItem(key, value);
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }

        try {
            window.localStorage.setItem(key, value);
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function clearQuickNotebookDraft() {
        var key = getQuickNotebookDraftKey();

        try {
            window.sessionStorage.removeItem(key);
            window.sessionStorage.removeItem(QUICK_NOTE_DRAFT_KEY);
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }

        try {
            window.localStorage.removeItem(key);
            window.localStorage.removeItem(QUICK_NOTE_DRAFT_KEY);
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function persistQuickNotebookDraftFromDom() {
        var content = document.querySelector('[data-qn-content]');

        if (! content) {
            return;
        }

        quickMenuState.note = String(content.value || '');
        if (quickNotebookState.dirty || quickMenuState.note.length) {
            writeQuickNotebookDraft(quickMenuState.note);
        }
    }

    function normalizeQuickMenuUrl(url) {
        var cleaned = String(url || '').trim();
        var parsed;

        if (! cleaned.length) {
            return '';
        }

        if (/^(javascript|data|vbscript):/i.test(cleaned)) {
            return '';
        }

        try {
            parsed = new URL(cleaned, window.location.href);
        } catch (error) {
            return '';
        }

        if (parsed.origin !== window.location.origin) {
            return '';
        }

        return parsed.pathname + parsed.search + parsed.hash;
    }

    function normalizeQuickMenuItem(item) {
        var label = String(item && item.label ? item.label : '').trim();
        var url = normalizeQuickMenuUrl(item && item.url ? item.url : '');

        if (! label.length || ! url.length) {
            return null;
        }

        return {
            label: label.slice(0, 120),
            url: url
        };
    }

    function normalizeQuickMenuItems(items) {
        var unique = Object.create(null);
        var normalized = [];
        var i;
        var item;

        for (i = 0; i < items.length; i++) {
            item = normalizeQuickMenuItem(items[i]);
            if (! item) {
                continue;
            }

            if (unique[item.url]) {
                continue;
            }

            unique[item.url] = true;
            normalized.push(item);

            if (normalized.length >= 40) {
                break;
            }
        }

        return normalized;
    }

    function pad2(value) {
        return value < 10 ? ('0' + String(value)) : String(value);
    }

    function formatNotebookTimestamp(date) {
        return String(date.getFullYear())
            + '-' + pad2(date.getMonth() + 1)
            + '-' + pad2(date.getDate())
            + ' ' + pad2(date.getHours())
            + ':' + pad2(date.getMinutes())
            + ':' + pad2(date.getSeconds());
    }

    function getCol1Path() {
        var col1 = document.getElementById('col1');
        var url;
        var parsed;

        if (! col1) {
            return '';
        }

        url = col1.getAttribute('data-icinga-url') || '';
        if (! url.length) {
            return '';
        }

        try {
            parsed = new URL(url, window.location.href);
        } catch (error) {
            return '';
        }

        return parsed.pathname.replace(/\/+$/, '');
    }

    function isMainDashboardPage() {
        var path = getCol1Path();

        if (! path.length) {
            return false;
        }

        return /\/dashboard$/i.test(path) || /\/index\/welcome$/i.test(path) || /\/welcome$/i.test(path);
    }

    function renderQuickMenuStatus(state) {
        var status = document.querySelector('[data-qm-status]');
        var root = getQuickMenuRoot();

        if (! status || ! root) {
            return;
        }

        if (state === 'saving') {
            status.textContent = root.dataset.statusSaving || 'Saving...';
            status.classList.add('is-busy');
            status.classList.remove('is-error');
            return;
        }

        if (state === 'saved') {
            status.textContent = root.dataset.statusSaved || 'Saved';
            status.classList.remove('is-busy', 'is-error');
            return;
        }

        if (state === 'error') {
            status.textContent = root.dataset.statusError || 'Unable to save';
            status.classList.remove('is-busy');
            status.classList.add('is-error');
            return;
        }

        status.textContent = '';
        status.classList.remove('is-busy', 'is-error');
    }

    function renderQuickMenu() {
        var root = getQuickMenuRoot();
        var title;
        var linksLabel;
        var noteToggleLabel;
        var emptyLabel;
        var validItems;
        var linksHtml = '';
        var count;

        if (! root) {
            return;
        }

        title = root.dataset.title || 'Quick Menu';
        linksLabel = root.dataset.linksLabel || 'Links';
        noteToggleLabel = root.dataset.noteToggleLabel || 'Notebook';
        emptyLabel = root.dataset.emptyLabel || 'No quick links yet.';
        validItems = normalizeQuickMenuItems(quickMenuState.items);
        count = validItems.length;

        if (count) {
            linksHtml = validItems.map(function (entry, index) {
                    return '<li class="nav-item quick-menu-link-item">'
                        + '<a href="' + escapeHtml(entry.url) + '" class="quick-menu-link">'
                        + escapeHtml(entry.label)
                        + '</a>'
                        + '<button type="button" class="quick-menu-remove" data-qm-remove data-index="'
                        + String(index)
                        + '" title="Remove">×</button>'
                        + '</li>';
                }).join('');
        } else {
            linksHtml = '<li class="nav-item quick-menu-empty-item">'
                + '<span class="quick-menu-empty">' + escapeHtml(emptyLabel) + '</span>'
                + '</li>';
        }

        root.innerHTML = ''
            + '<nav class="quick-menu-panel">'
            + '<ul class="nav-level-1">'
            + '<li class="nav-item quick-menu-nav-item">'
            + '<a href="#" class="quick-menu-title-link" data-qm-title>'
            + '<i class="icon icon-info-circled" aria-hidden="true"></i>'
            + '<span class="quick-menu-title">' + escapeHtml(title) + '</span>'
            + '<span class="badge quick-menu-count">' + String(count) + '</span>'
            + '</a>'
            + '<ul class="nav-level-2 quick-menu-links-list">'
            + linksHtml
            + '<li class="nav-item quick-menu-notebook-item">'
            + '<a href="#" data-qm-toggle-note class="quick-menu-note-toggle">'
            + escapeHtml(noteToggleLabel)
            + '</a>'
            + '</li>'
            + '</ul>'
            + '</li>'
            + '</ul>'
            + '</nav>';
    }

    function updateQuickMenuNotebookToggleLabel() {
        var root = getQuickMenuRoot();
        var button = document.querySelector('.quick-menu-note-toggle[data-qm-toggle-note]');

        if (! root || ! button) {
            return;
        }

        button.textContent = root.dataset.noteToggleLabel || 'Notebook';
        button.classList.toggle('active', quickNotebookState.visible);
    }

    function saveQuickMenuState() {
        var payload;
        var body;
        var savedNote;

        if (! quickMenuState.apiUrl || quickMenuState.inFlight) {
            return;
        }

        quickMenuState.inFlight = true;
        renderQuickMenuStatus('saving');

        payload = {
            items: quickMenuState.items,
            note: quickMenuState.note
        };
        savedNote = payload.note;

        body = new URLSearchParams();
        body.set('items', JSON.stringify(payload.items));
        body.set('note', payload.note);

        fetch(quickMenuState.apiUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            body: body.toString()
        })
            .then(function (response) {
                if (! response.ok) {
                    throw new Error('Request failed');
                }

                return response.json();
            })
            .then(function (result) {
                var root = getQuickMenuRoot();
                quickMenuState.items = normalizeQuickMenuItems(result.items || []);
                if (! quickNotebookState.dirty || quickMenuState.note === savedNote) {
                    quickMenuState.note = String(result.note || '');
                    quickNotebookState.dirty = false;
                    clearQuickNotebookDraft();
                    refreshQuickNotebookContent(true);
                }
                updateQuickMenuSourceData(root);
                renderQuickMenu();
                renderQuickMenuStatus('saved');
                updateQuickNotebookStatus('Saved', false);
            })
            .catch(function () {
                renderQuickMenuStatus('error');
                updateQuickNotebookStatus('Unable to save', true);
            })
            .then(function () {
                quickMenuState.inFlight = false;
            }, function () {
                quickMenuState.inFlight = false;
            });
    }

    function scheduleQuickMenuSave(delay) {
        if (quickMenuState.saveTimer !== null) {
            window.clearTimeout(quickMenuState.saveTimer);
            quickMenuState.saveTimer = null;
        }

        quickMenuState.saveTimer = window.setTimeout(function () {
            quickMenuState.saveTimer = null;
            saveQuickMenuState();
        }, typeof delay === 'number' ? delay : 250);
    }

    function addQuickMenuItem(item) {
        var normalized = normalizeQuickMenuItem(item);
        if (! normalized) {
            return;
        }

        quickMenuState.items = normalizeQuickMenuItems([normalized].concat(quickMenuState.items));
        renderQuickMenu();
        scheduleQuickMenuSave(0);
    }

    function resolveContextMenuAnchor(target) {
        var anchor = target && target.closest ? target.closest('a[href]') : null;
        var href;

        if (! anchor || anchor.closest('[data-quick-menu-context]')) {
            return null;
        }

        href = normalizeQuickMenuUrl(anchor.getAttribute('href') || anchor.href || '');
        if (! href.length) {
            return null;
        }

        return anchor;
    }

    function getQuickMenuContextMenu() {
        var existing = document.querySelector('[data-quick-menu-context]');
        var root;
        var addLabel;
        var tabLabel;
        var windowLabel;

        if (existing) {
            return existing;
        }

        root = getQuickMenuRoot();
        addLabel = root ? (root.dataset.contextAddLabel || 'Add To Quick Menu') : 'Add To Quick Menu';
        tabLabel = root ? (root.dataset.contextOpenTabLabel || 'Open In New Tab') : 'Open In New Tab';
        windowLabel = root ? (root.dataset.contextOpenWindowLabel || 'Open In New Window') : 'Open In New Window';

        existing = document.createElement('div');
        existing.className = 'quick-menu-context';
        existing.setAttribute('data-quick-menu-context', '');
        existing.hidden = true;
        existing.innerHTML = ''
            + '<button type="button" data-qm-add-link>' + escapeHtml(addLabel) + '</button>'
            + '<button type="button" data-qm-open-tab>' + escapeHtml(tabLabel) + '</button>'
            + '<button type="button" data-qm-open-window>' + escapeHtml(windowLabel) + '</button>';
        document.body.appendChild(existing);

        return existing;
    }

    function hideQuickMenuContextMenu() {
        var menu = document.querySelector('[data-quick-menu-context]');
        if (! menu) {
            return;
        }

        menu.hidden = true;
        quickMenuContextState.anchor = null;
    }

    function showQuickMenuContextMenu(x, y, anchor) {
        var menu = getQuickMenuContextMenu();
        var maxLeft;
        var maxTop;

        quickMenuContextState.anchor = anchor;

        menu.hidden = false;
        menu.style.left = '0px';
        menu.style.top = '0px';

        maxLeft = Math.max(0, window.innerWidth - menu.offsetWidth - 8);
        maxTop = Math.max(0, window.innerHeight - menu.offsetHeight - 8);
        menu.style.left = String(Math.min(x, maxLeft)) + 'px';
        menu.style.top = String(Math.min(y, maxTop)) + 'px';
    }

    function openQuickMenuContextAnchor(target) {
        var anchor = quickMenuContextState.anchor;
        var href = anchor ? normalizeQuickMenuUrl(anchor.getAttribute('href') || anchor.href || '') : '';
        var features;

        if (! href.length) {
            hideQuickMenuContextMenu();
            return;
        }

        if (target === 'window') {
            features = [
                'noopener',
                'noreferrer',
                'width=1200',
                'height=800',
                'left=' + String(Math.max(0, Math.round((window.screen.width - 1200) / 2))),
                'top=' + String(Math.max(0, Math.round((window.screen.height - 800) / 2)))
            ].join(',');
            window.open(href, '_blank', features);
        } else {
            window.open(href, '_blank', 'noopener,noreferrer');
        }

        hideQuickMenuContextMenu();
    }

    function onContextMenu(event) {
        var anchor = resolveContextMenuAnchor(event.target);

        if (! anchor) {
            hideQuickMenuContextMenu();
            return;
        }

        event.preventDefault();
        showQuickMenuContextMenu(event.clientX, event.clientY, anchor);
    }

    function initQuickMenu() {
        var root = getQuickMenuRoot();
        var sourceSignature;
        var draftNote;

        if (! root) {
            return;
        }

        quickMenuState.apiUrl = root.dataset.apiUrl || '';
        draftNote = readQuickNotebookDraft();
        sourceSignature = getQuickMenuSourceSignature(root);

        if (! quickMenuState.initialized || (! quickMenuState.inFlight && quickMenuState.sourceSignature !== sourceSignature)) {
            quickMenuState.items = normalizeQuickMenuItems(parseQuickMenuItems(root.dataset.itemsJson || '[]'));
            if (draftNote !== null) {
                quickMenuState.note = draftNote;
                quickNotebookState.dirty = true;
            } else if (! quickNotebookState.dirty) {
                quickMenuState.note = String(root.dataset.note || '');
            }
            quickMenuState.sourceSignature = sourceSignature;
            quickMenuState.initialized = true;
        }

        if (draftNote !== null && quickNotebookState.initialized) {
            refreshQuickNotebookContent(true);
        }

        renderQuickMenu();
    }

    function getQuickNotebook() {
        return document.getElementById('quick-notebook-float');
    }

    function parseCssColor(value) {
        var text = String(value || '').trim();
        var hex;
        var match;

        if (! text.length || text === 'transparent') {
            return null;
        }

        if (text.charAt(0) === '#') {
            hex = text.slice(1);
            if (hex.length === 3) {
                hex = hex.replace(/(.)/g, '$1$1');
            }

            if (/^[a-f0-9]{6}$/i.test(hex)) {
                return {
                    r: parseInt(hex.slice(0, 2), 16),
                    g: parseInt(hex.slice(2, 4), 16),
                    b: parseInt(hex.slice(4, 6), 16)
                };
            }
        }

        match = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
        if (! match) {
            return null;
        }

        return {
            r: parseFloat(match[1]),
            g: parseFloat(match[2]),
            b: parseFloat(match[3])
        };
    }

    function getCurrentThemeBackgroundColor() {
        var rootStyles = window.getComputedStyle(document.documentElement);
        var bodyStyles = window.getComputedStyle(document.body);
        var candidates = [
            rootStyles.getPropertyValue('--body-bg-color'),
            bodyStyles.getPropertyValue('--body-bg-color'),
            bodyStyles.backgroundColor,
            rootStyles.backgroundColor
        ];
        var i;
        var color;

        for (i = 0; i < candidates.length; i++) {
            color = parseCssColor(candidates[i]);
            if (color) {
                return color;
            }
        }

        return null;
    }

    function isLightTheme() {
        var color = getCurrentThemeBackgroundColor();
        var luminance;

        if (! color) {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
        }

        luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
        return luminance > 0.62;
    }

    function applyQuickNotebookTheme(notebook) {
        if (! notebook) {
            return;
        }

        notebook.classList.toggle('quick-notebook-light', isLightTheme());
    }

    function renderQuickNotebook() {
        var root = getQuickMenuRoot();
        var notebook = getQuickNotebook();
        var title;
        var placeholder;
        var addLabel;
        var saveLabel;
        var clearLabel;

        if (! root) {
            return;
        }

        if (! notebook) {
            notebook = document.createElement('section');
            notebook.id = 'quick-notebook-float';
            notebook.className = 'quick-notebook-float';
            notebook.hidden = true;
            document.body.appendChild(notebook);
        } else {
            applyQuickNotebookTheme(notebook);
            return;
        }

        applyQuickNotebookTheme(notebook);

        title = root.dataset.noteLabel || 'Personal Notebook';
        placeholder = root.dataset.notePlaceholder || 'Type note content...';
        addLabel = root.dataset.noteAddLabel || 'Add Entry';
        saveLabel = root.dataset.noteSaveLabel || 'Save Notebook';
        clearLabel = root.dataset.noteClearLabel || 'Clear Notebook';

        notebook.innerHTML = ''
            + '<header class="quick-notebook-header">'
            + '<h3>' + escapeHtml(title) + '</h3>'
            + '</header>'
            + '<div class="quick-notebook-body">'
            + '<textarea class="quick-notebook-input" data-qn-input rows="3" placeholder="'
            + escapeHtml(placeholder)
            + '"></textarea>'
            + '<div class="quick-notebook-actions">'
            + '<button type="button" data-qn-add>' + escapeHtml(addLabel) + '</button>'
            + '<button type="button" data-qn-save>' + escapeHtml(saveLabel) + '</button>'
            + '<button type="button" data-qn-clear>' + escapeHtml(clearLabel) + '</button>'
            + '<span class="quick-notebook-status" data-qn-status></span>'
            + '</div>'
            + '<textarea class="quick-notebook-content" data-qn-content rows="10"></textarea>'
            + '</div>';

        {
            var content = notebook.querySelector('[data-qn-content]');
            if (content) {
                content.value = quickMenuState.note;
            }
        }
    }

    function updateQuickNotebookStatus(text, isError) {
        var status = document.querySelector('[data-qn-status]');
        if (! status) {
            return;
        }

        status.textContent = text || '';
        status.classList.toggle('is-error', Boolean(isError));
    }

    function refreshQuickNotebookContent(force) {
        var content = document.querySelector('[data-qn-content]');
        if (quickNotebookState.dirty && force !== true) {
            return;
        }

        if (content) {
            content.value = quickMenuState.note;
        }
    }

    function setQuickNotebookVisible(visible) {
        var notebook = getQuickNotebook();
        if (! notebook) {
            return;
        }

        applyQuickNotebookTheme(notebook);
        notebook.hidden = ! visible;
        quickNotebookState.visible = visible;
        if (visible) {
            clampQuickNotebookPosition();
        }
        updateQuickMenuNotebookToggleLabel();
    }

    function updateQuickNotebookVisibility() {
        updateQuickMenuNotebookToggleLabel();
    }

    function toggleQuickNotebookVisible() {
        if (! getQuickNotebook()) {
            renderQuickNotebook();
        }

        setQuickNotebookVisible(! quickNotebookState.visible);
    }

    function onQuickNotebookDragMove(event) {
        var notebook = getQuickNotebook();
        var nextLeft;
        var nextTop;
        var maxLeft;
        var maxTop;
        var drag = quickNotebookState.drag;

        if (! notebook || ! drag) {
            return;
        }

        event.preventDefault();
        nextLeft = drag.startLeft + (event.clientX - drag.startClientX);
        nextTop = drag.startTop + (event.clientY - drag.startClientY);

        maxLeft = Math.max(0, window.innerWidth - notebook.offsetWidth);
        maxTop = Math.max(0, window.innerHeight - notebook.offsetHeight);

        nextLeft = clamp(nextLeft, 0, maxLeft);
        nextTop = clamp(nextTop, 0, maxTop);

        notebook.style.left = String(nextLeft) + 'px';
        notebook.style.top = String(nextTop) + 'px';
        notebook.style.right = 'auto';
        notebook.style.bottom = 'auto';
    }

    function clampQuickNotebookPosition() {
        var notebook = getQuickNotebook();
        var rect;
        var maxLeft;
        var maxTop;
        var left;
        var top;

        if (! notebook || notebook.hidden) {
            return;
        }

        rect = notebook.getBoundingClientRect();
        maxLeft = Math.max(0, window.innerWidth - notebook.offsetWidth);
        maxTop = Math.max(0, window.innerHeight - notebook.offsetHeight);
        left = clamp(rect.left, 0, maxLeft);
        top = clamp(rect.top, 0, maxTop);

        notebook.style.left = String(left) + 'px';
        notebook.style.top = String(top) + 'px';
        notebook.style.right = 'auto';
        notebook.style.bottom = 'auto';
    }

    function onQuickNotebookDragEnd() {
        if (! quickNotebookState.drag) {
            return;
        }

        quickNotebookState.drag = null;
        document.removeEventListener('mousemove', onQuickNotebookDragMove);
        document.removeEventListener('mouseup', onQuickNotebookDragEnd);
    }

    function onQuickNotebookDragStart(event) {
        var notebook = getQuickNotebook();
        var rect;

        if (event.button !== 0 || ! notebook || ! quickNotebookState.visible) {
            return;
        }

        if (! event.target.closest('.quick-notebook-header')) {
            return;
        }

        rect = notebook.getBoundingClientRect();
        notebook.style.left = String(rect.left) + 'px';
        notebook.style.top = String(rect.top) + 'px';
        notebook.style.right = 'auto';
        notebook.style.bottom = 'auto';

        quickNotebookState.drag = {
            startClientX: event.clientX,
            startClientY: event.clientY,
            startLeft: rect.left,
            startTop: rect.top
        };

        document.addEventListener('mousemove', onQuickNotebookDragMove);
        document.addEventListener('mouseup', onQuickNotebookDragEnd);
        event.preventDefault();
    }

    function appendNotebookEntry(rawText) {
        var text = String(rawText || '').trim();
        var entry;

        if (! text.length) {
            return false;
        }

        entry = '[' + formatNotebookTimestamp(new Date()) + '] ' + text;
        quickMenuState.note = quickMenuState.note.trim().length
            ? (quickMenuState.note.replace(/\s*$/, '') + '\n\n' + entry)
            : entry;
        quickNotebookState.dirty = true;
        writeQuickNotebookDraft(quickMenuState.note);

        refreshQuickNotebookContent(true);
        return true;
    }

    function initQuickNotebook() {
        if (! getQuickMenuRoot()) {
            return;
        }

        renderQuickNotebook();
        if (! quickNotebookState.initialized) {
            setQuickNotebookVisible(false);
        }
        updateQuickNotebookVisibility();
        quickNotebookState.initialized = true;
    }

    function onClick(event) {
        var action = event.target.closest('.search-history-action');
        var close = event.target.closest('[data-close-shortcuts]');
        var closeCommandPaletteButton = event.target.closest('[data-close-command-palette]');
        var commandPaletteCommand = event.target.closest('[data-command-index]');
        var triageModeToggle = event.target.closest('[data-triage-mode-toggle]');
        var openTriageDeskButton = event.target.closest('[data-open-triage-desk]');
        var closeTriageDeskButton = event.target.closest('[data-close-triage-desk]');
        var triageDeskActionButton = event.target.closest('[data-triage-desk-action]');
        var triageDeskCopyButton = event.target.closest('[data-triage-desk-copy]');
        var triageDeskResetButton = event.target.closest('[data-triage-desk-reset]');
        var operatorFocusActionButton = event.target.closest('[data-operator-focus-action]');
        var openMetroTimelineButton = event.target.closest('[data-open-metro-timeline]');
        var operatorDecisionActionButton = event.target.closest('[data-operator-decision-action]');
        var openOperatorHandoffButton = event.target.closest('[data-open-operator-handoff]');
        var closeOperatorHandoffButton = event.target.closest('[data-close-operator-handoff]');
        var operatorHandoffCopyButton = event.target.closest('[data-operator-handoff-copy]');
        var operatorHandoffRefreshButton = event.target.closest('[data-operator-handoff-refresh]');
        var openOperatorActivityButton = event.target.closest('[data-open-operator-activity]');
        var closeOperatorActivityButton = event.target.closest('[data-close-operator-activity]');
        var operatorActivityClearButton = event.target.closest('[data-operator-activity-clear]');
        var operatorActivityCopyButton = event.target.closest('[data-operator-activity-copy]');
        var operatorAuditFilterButton = event.target.closest('[data-operator-audit-filter]');
        var openOperatorPlaybookButton = event.target.closest('[data-open-operator-playbook]');
        var closeOperatorPlaybookButton = event.target.closest('[data-close-operator-playbook]');
        var operatorPlaybookCopyButton = event.target.closest('[data-operator-playbook-copy]');
        var closeIncidentDrawerButton = event.target.closest('[data-close-incident-drawer]');
        var copyIncidentLinkButton = event.target.closest('[data-copy-incident-link]');
        var copyIncidentSummaryButton = event.target.closest('[data-copy-incident-summary]');
        var pinIncidentButton = event.target.closest('[data-pin-incident]');
        var snoozeIncidentButton = event.target.closest('[data-snooze-incident]');
        var clearIncidentNoteButton = event.target.closest('[data-clear-incident-note]');
        var incidentLink = event.target.closest('.top-event-link');
        var eventMetroRangeButton = event.target.closest('[data-event-metro-range]');
        var eventMetroApplyButton = event.target.closest('[data-event-metro-apply]');
        var open = event.target.closest('[data-open-shortcuts]');
        var quickMenuTitle = event.target.closest('[data-qm-title]');
        var toggleNotebook = event.target.closest('[data-qm-toggle-note]');
        var removeRow = event.target.closest('[data-qm-remove]');
        var addLink = event.target.closest('[data-qm-add-link]');
        var openTab = event.target.closest('[data-qm-open-tab]');
        var openWindow = event.target.closest('[data-qm-open-window]');
        var qnAdd = event.target.closest('[data-qn-add]');
        var qnSave = event.target.closest('[data-qn-save]');
        var qnClear = event.target.closest('[data-qn-clear]');
        if (action) {
            var input = getSearchInput();
            var query = action.getAttribute('data-search-query') || '';

            if (input) {
                input.value = query;
                if (typeof input.form.requestSubmit === 'function') {
                    input.form.requestSubmit();
                } else {
                    input.form.submit();
                }
            }

            return;
        }

        if (closeCommandPaletteButton) {
            event.preventDefault();
            closeCommandPalette();
            return;
        }

        if (commandPaletteCommand) {
            event.preventDefault();
            runCommandPaletteCommand(commandPaletteState.commands[
                parseInt(commandPaletteCommand.getAttribute('data-command-index') || '0', 10)
            ]);
            return;
        }

        if (triageModeToggle) {
            event.preventDefault();
            setTriageMode(! isTriageModeEnabled());
            return;
        }

        if (openTriageDeskButton) {
            event.preventDefault();
            openTriageDesk();
            return;
        }

        if (closeTriageDeskButton) {
            event.preventDefault();
            closeTriageDesk();
            return;
        }

        if (triageDeskCopyButton) {
            event.preventDefault();
            copyTextToClipboard(buildTriageDigestText()).then(function () {
                recordOperatorActivity('Triage', 'Copied triage digest', '', '');
                showOperatorToast('Triage digest copied');
            });
            return;
        }

        if (triageDeskResetButton) {
            event.preventDefault();
            resetTriageQueue();
            return;
        }

        if (triageDeskActionButton) {
            var triageRow = triageDeskActionButton.closest('[data-triage-desk-row]');
            event.preventDefault();
            runTriageDeskAction(
                triageDeskActionButton.getAttribute('data-triage-desk-action') || '',
                triageRow ? (triageRow.getAttribute('data-url') || '') : ''
            );
            return;
        }

        if (operatorFocusActionButton) {
            event.preventDefault();
            runOperatorFocusAction(operatorFocusActionButton.getAttribute('data-operator-focus-action') || '');
            return;
        }

        if (openMetroTimelineButton) {
            event.preventDefault();
            openMetroTimelineForFocusEvent();
            return;
        }

        if (operatorDecisionActionButton) {
            event.preventDefault();
            runOperatorDecisionAction(operatorDecisionActionButton.getAttribute('data-operator-decision-action') || '');
            return;
        }

        if (openOperatorHandoffButton) {
            event.preventDefault();
            openOperatorHandoff();
            return;
        }

        if (closeOperatorHandoffButton) {
            event.preventDefault();
            closeOperatorHandoff();
            return;
        }

        if (operatorHandoffCopyButton) {
            event.preventDefault();
            copyOperatorHandoff();
            return;
        }

        if (operatorHandoffRefreshButton) {
            event.preventDefault();
            renderOperatorHandoff();
            recordOperatorActivity('Handoff', 'Regenerated handoff report', '', '');
            showOperatorToast('Handoff report regenerated');
            return;
        }

        if (openOperatorActivityButton) {
            event.preventDefault();
            openOperatorActivity();
            return;
        }

        if (closeOperatorActivityButton) {
            event.preventDefault();
            closeOperatorActivity();
            return;
        }

        if (operatorActivityClearButton) {
            event.preventDefault();
            clearOperatorActivity();
            return;
        }

        if (operatorActivityCopyButton) {
            event.preventDefault();
            copyOperatorAuditTimeline();
            return;
        }

        if (operatorAuditFilterButton) {
            event.preventDefault();
            operatorAuditState.filter = operatorAuditFilterButton.getAttribute('data-operator-audit-filter') || 'all';
            renderOperatorActivity();
            return;
        }

        if (openOperatorPlaybookButton) {
            event.preventDefault();
            openOperatorPlaybook();
            return;
        }

        if (closeOperatorPlaybookButton) {
            event.preventDefault();
            closeOperatorPlaybook();
            return;
        }

        if (operatorPlaybookCopyButton) {
            event.preventDefault();
            copyOperatorPlaybook();
            return;
        }

        if (closeIncidentDrawerButton) {
            event.preventDefault();
            closeIncidentDrawer();
            return;
        }

        if (copyIncidentLinkButton) {
            event.preventDefault();
            copyIncidentLink(copyIncidentLinkButton);
            return;
        }

        if (copyIncidentSummaryButton) {
            event.preventDefault();
            copyIncidentSummary(copyIncidentSummaryButton);
            return;
        }

        if (pinIncidentButton) {
            event.preventDefault();
            togglePinnedIncident();
            return;
        }

        if (snoozeIncidentButton) {
            event.preventDefault();
            snoozeCurrentIncident();
            return;
        }

        if (clearIncidentNoteButton) {
            event.preventDefault();
            clearIncidentNote();
            return;
        }

        if (eventMetroRangeButton) {
            var metroPanel = eventMetroRangeButton.closest('[data-event-metro-panel]');
            var rangeName = eventMetroRangeButton.getAttribute('data-event-metro-range') || 'current';
            var rangeValue = getEventMetroRange(rangeName);
            var fromInput = metroPanel ? metroPanel.querySelector('[data-event-metro-from]') : null;
            var toInput = metroPanel ? metroPanel.querySelector('[data-event-metro-to]') : null;

            event.preventDefault();
            if (fromInput) {
                fromInput.value = rangeValue.from;
            }
            if (toInput) {
                toInput.value = rangeValue.to;
            }
            if (metroPanel && metroPanel.eventMetroObject) {
                setEventMetroActiveRange(metroPanel, rangeName);
                loadEventMetroTimeline(metroPanel, metroPanel.eventMetroObject, rangeValue);
            }
            return;
        }

        if (eventMetroApplyButton) {
            var rangePanel = eventMetroApplyButton.closest('[data-event-metro-panel]');
            var from = rangePanel ? rangePanel.querySelector('[data-event-metro-from]') : null;
            var to = rangePanel ? rangePanel.querySelector('[data-event-metro-to]') : null;

            event.preventDefault();
            if (rangePanel && rangePanel.eventMetroObject) {
                setEventMetroActiveRange(rangePanel, '');
                loadEventMetroTimeline(rangePanel, rangePanel.eventMetroObject, {
                    from: from ? from.value : '',
                    to: to ? to.value : ''
                });
            }
            return;
        }

        if (incidentLink && ! event.ctrlKey && ! event.metaKey && ! event.shiftKey) {
            if (openIncidentDrawerFromLink(incidentLink)) {
                event.preventDefault();
                return;
            }
        }

        if (open) {
            event.preventDefault();
            openShortcutsDialog();
            return;
        }

        if (quickMenuTitle) {
            event.preventDefault();
            return;
        }

        if (close) {
            event.preventDefault();
            closeShortcutsDialog();
            return;
        }

        if (toggleNotebook) {
            event.preventDefault();
            toggleQuickNotebookVisible();
            return;
        }

        if (removeRow) {
            var idx = parseInt(removeRow.getAttribute('data-index') || '-1', 10);
            if (idx >= 0 && idx < quickMenuState.items.length) {
                quickMenuState.items.splice(idx, 1);
                renderQuickMenu();
                renderQuickMenuStatus('');
                scheduleQuickMenuSave(150);
            }

            return;
        }

        if (qnAdd) {
            var input = document.querySelector('[data-qn-input]');
            var value = input ? input.value : '';
            event.preventDefault();

            if (! appendNotebookEntry(value)) {
                updateQuickNotebookStatus('Type note content first', true);
                return;
            }

            if (input) {
                input.value = '';
                input.focus();
            }

            updateQuickNotebookStatus('', false);
            saveQuickMenuState();
            return;
        }

        if (qnSave) {
            var content = document.querySelector('[data-qn-content]');
            event.preventDefault();
            quickMenuState.note = content ? String(content.value || '') : quickMenuState.note;
            quickNotebookState.dirty = true;
            writeQuickNotebookDraft(quickMenuState.note);
            updateQuickNotebookStatus('', false);
            saveQuickMenuState();
            return;
        }

        if (qnClear) {
            event.preventDefault();
            quickMenuState.note = '';
            quickNotebookState.dirty = true;
            writeQuickNotebookDraft(quickMenuState.note);
            refreshQuickNotebookContent(true);
            updateQuickNotebookStatus('', false);
            saveQuickMenuState();
            return;
        }

        if (openTab) {
            event.preventDefault();
            openQuickMenuContextAnchor('tab');
            return;
        }

        if (openWindow) {
            event.preventDefault();
            openQuickMenuContextAnchor('window');
            return;
        }

        if (addLink) {
            event.preventDefault();
            if (quickMenuContextState.anchor) {
                addQuickMenuItem({
                    label: quickMenuContextState.anchor.textContent || quickMenuContextState.anchor.title || 'Link',
                    url: quickMenuContextState.anchor.getAttribute('href') || quickMenuContextState.anchor.href || ''
                });
            }

            hideQuickMenuContextMenu();
            return;
        }

        if (! event.target.closest('[data-quick-menu-context]')) {
            hideQuickMenuContextMenu();
        }
    }

    function onInput(event) {
        if (event.target.matches('#command-palette-input')) {
            renderCommandPaletteResults();
            return;
        }

        if (event.target.matches('[data-qn-input]')) {
            updateQuickNotebookStatus('', false);
            return;
        }

        if (event.target.matches('[data-qn-content]')) {
            quickMenuState.note = String(event.target.value || '');
            quickNotebookState.dirty = true;
            writeQuickNotebookDraft(quickMenuState.note);
            updateQuickNotebookStatus('', false);
            return;
        }

        if (event.target.matches('[data-incident-note]')) {
            saveIncidentNoteFromDom();
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function onGlobalEscape(event) {
        if (event.key !== 'Escape') {
            return;
        }

        if (isCommandPaletteOpen()) {
            closeCommandPalette();
            return;
        }

        if (isIncidentDrawerOpen()) {
            closeIncidentDrawer();
            return;
        }

        if (isTriageDeskOpen()) {
            closeTriageDesk();
            return;
        }

        if (isOperatorHandoffOpen()) {
            closeOperatorHandoff();
            return;
        }

        if (isOperatorActivityOpen()) {
            closeOperatorActivity();
            return;
        }

        if (isOperatorPlaybookOpen()) {
            closeOperatorPlaybook();
            return;
        }

        hideQuickMenuContextMenu();
        if (quickNotebookState.visible) {
            setQuickNotebookVisible(false);
        }
    }

    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('click', onClick);
    document.addEventListener('mousedown', onQuickNotebookDragStart);
    document.addEventListener('input', onInput);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', handleGlobalShortcuts);
    document.addEventListener('keydown', handleCommandPaletteKeydown);
    document.addEventListener('keydown', trapDialogFocus);
    document.addEventListener('keydown', onGlobalEscape, true);
    document.addEventListener('scroll', hideQuickMenuContextMenu, true);
    applyDensityMode(readDensityMode());
    updateTriageModeToggle();
    window.addEventListener('pagehide', persistQuickNotebookDraftFromDom);
    window.addEventListener('beforeunload', persistQuickNotebookDraftFromDom);
    window.addEventListener('resize', function () {
        if (quickNotebookState.visible && quickNotebookState.initialized) {
            clampQuickNotebookPosition();
        }
    });
    document.addEventListener('DOMContentLoaded', function () {
        renderRecentSearches();
        initQuickMenu();
        initQuickNotebook();
        updateTriageModeToggle();
        startTacticalOverviewPolling();
        initTopWidgetResizers();
        initTopPanelsWidthResizer();
        startTopEventsPolling();
        renderEventDetailMetroTimeline();
    });

    if (typeof window.jQuery !== 'undefined') {
        window.jQuery(document).on('rendered', '#menu', function () {
            renderRecentSearches();
            initQuickMenu();
            initQuickNotebook();
            refreshTacticalOverview(false);
            refreshTopEvents(false);
        });
        window.jQuery(document).on('rendered', '#col1', function () {
            updateQuickNotebookVisibility();
            renderEventDetailMetroTimeline();
        });
    }

    renderRecentSearches();
    initQuickMenu();
    initQuickNotebook();
    refreshTacticalOverview(true);
    renderEventDetailMetroTimeline();
})();
