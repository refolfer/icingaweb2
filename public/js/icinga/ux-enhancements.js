// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

(function () {
    'use strict';

    var SEARCH_HISTORY_KEY = 'menu-search-history';
    var NAV_SEQUENCE_TIMEOUT = 1200;
    var TOP_WIDGET_HEIGHT_KEY = 'top-widget-height';
    var TOP_WIDGET_MIN_HEIGHT = 120;
    var TOP_WIDGET_MAX_HEIGHT = 340;
    var TOP_EVENTS_REFRESH_MS = 15000;
    var TOP_EVENTS_ERROR_BACKOFF_MS = 120000;
    var TOP_EVENTS_ERROR_BACKOFF_MAX_MS = 600000;
    var TACTICAL_REFRESH_MS = 10000;
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

    var lastFocusedElement = null;
    var topWidgetResizeState = null;
    var topPanelsWidthResizeState = null;
    var topEventsState = {
        lastSignature: '',
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

            if (results.length >= 2) {
                break;
            }
        }

        return results;
    }

    function renderTopEvents(items) {
        var slots = document.querySelectorAll('[data-top-event-item]');
        var i;

        for (i = 0; i < slots.length; i++) {
            var item = items[i] || null;
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

                if (forceRender || signature !== topEventsState.lastSignature) {
                    renderTopEvents(items);
                    topEventsState.lastSignature = signature;
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

        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
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

        if (event.key !== 'Tab' || ! isShortcutsDialogOpen()) {
            return;
        }

        modal = document.getElementById('keyboard-shortcuts-modal');
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

        if (! quickMenuState.apiUrl || quickMenuState.inFlight) {
            return;
        }

        quickMenuState.inFlight = true;
        renderQuickMenuStatus('saving');

        payload = {
            items: quickMenuState.items,
            note: quickMenuState.note
        };

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
                quickMenuState.note = String(result.note || '');
                updateQuickMenuSourceData(root);
                renderQuickMenu();
                refreshQuickNotebookContent();
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

        if (existing) {
            return existing;
        }

        root = getQuickMenuRoot();
        addLabel = root ? (root.dataset.contextAddLabel || 'Add To Quick Menu') : 'Add To Quick Menu';

        existing = document.createElement('div');
        existing.className = 'quick-menu-context';
        existing.setAttribute('data-quick-menu-context', '');
        existing.hidden = true;
        existing.innerHTML = ''
            + '<button type="button" data-qm-add-link>' + escapeHtml(addLabel) + '</button>';
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

        if (! root) {
            return;
        }

        quickMenuState.apiUrl = root.dataset.apiUrl || '';
        sourceSignature = getQuickMenuSourceSignature(root);

        if (! quickMenuState.initialized || (! quickMenuState.inFlight && quickMenuState.sourceSignature !== sourceSignature)) {
            quickMenuState.items = normalizeQuickMenuItems(parseQuickMenuItems(root.dataset.itemsJson || '[]'));
            quickMenuState.note = String(root.dataset.note || '');
            quickMenuState.sourceSignature = sourceSignature;
            quickMenuState.initialized = true;
        }

        renderQuickMenu();
    }

    function getQuickNotebook() {
        return document.getElementById('quick-notebook-float');
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
        }

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

    function refreshQuickNotebookContent() {
        var content = document.querySelector('[data-qn-content]');
        if (content) {
            content.value = quickMenuState.note;
        }
    }

    function setQuickNotebookVisible(visible) {
        var notebook = getQuickNotebook();
        if (! notebook) {
            return;
        }

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

        refreshQuickNotebookContent();
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
        var open = event.target.closest('[data-open-shortcuts]');
        var quickMenuTitle = event.target.closest('[data-qm-title]');
        var toggleNotebook = event.target.closest('[data-qm-toggle-note]');
        var removeRow = event.target.closest('[data-qm-remove]');
        var addLink = event.target.closest('[data-qm-add-link]');
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
            updateQuickNotebookStatus('', false);
            saveQuickMenuState();
            return;
        }

        if (qnClear) {
            event.preventDefault();
            quickMenuState.note = '';
            refreshQuickNotebookContent();
            updateQuickNotebookStatus('', false);
            saveQuickMenuState();
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
        if (event.target.matches('[data-qn-input]')) {
            updateQuickNotebookStatus('', false);
            return;
        }

        if (event.target.matches('[data-qn-content]')) {
            quickMenuState.note = String(event.target.value || '');
            updateQuickNotebookStatus('', false);
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
    document.addEventListener('keydown', trapDialogFocus);
    document.addEventListener('keydown', onGlobalEscape, true);
    document.addEventListener('scroll', hideQuickMenuContextMenu, true);
    window.addEventListener('resize', function () {
        if (quickNotebookState.visible && quickNotebookState.initialized) {
            clampQuickNotebookPosition();
        }
    });
    document.addEventListener('DOMContentLoaded', function () {
        renderRecentSearches();
        initQuickMenu();
        initQuickNotebook();
        startTacticalOverviewPolling();
        initTopWidgetResizers();
        initTopPanelsWidthResizer();
        startTopEventsPolling();
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
        });
    }

    renderRecentSearches();
    initQuickMenu();
    initQuickNotebook();
    refreshTacticalOverview(true);
})();
