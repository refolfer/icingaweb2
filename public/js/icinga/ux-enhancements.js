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
        inFlight: false
    };
    var tacticalState = {
        lastSignature: '',
        pollingTimer: null,
        inFlight: false
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

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeTopEventUrl(url) {
        var value = String(url || '').trim();

        if (! value.length || value === '#') {
            return '';
        }

        if (/^javascript:/i.test(value)) {
            return '';
        }

        try {
            return new URL(value, getTopEventsHistoryUrl()).toString();
        } catch (error) {
            return '';
        }
    }

    function pickEventBlocks(doc) {
        var root = doc.querySelector('#col1 .content') || doc.querySelector('.content') || doc.body;
        if (! root) {
            return [];
        }

        var selectors = ['tbody tr', '.list-item', 'article', '.event', 'li'];
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
        var anchors;
        var i;

        if (titleEl && titleEl.tagName && titleEl.tagName.toLowerCase() === 'a') {
            candidate = normalizeTopEventUrl(titleEl.getAttribute('href'));
            if (candidate) {
                return candidate;
            }
        }

        anchors = block.querySelectorAll('a[href]');
        for (i = 0; i < anchors.length; i++) {
            candidate = normalizeTopEventUrl(anchors[i].getAttribute('href'));
            if (candidate) {
                return candidate;
            }
        }

        return normalizeTopEventUrl(getTopEventsHistoryUrl());
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

            var signature = event.title + '|' + event.meta + '|' + event.state + '|' + String(event.handled) + '|' + event.url;
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
            var linkEl = slots[i].querySelector('.top-event-link');
            var stateClass;
            var url = normalizeTopEventUrl(getTopEventsHistoryUrl());

            if (! titleEl || ! metaEl || ! linkEl) {
                continue;
            }

            TOP_EVENT_STATE_CLASSES.forEach(function (className) {
                slots[i].classList.remove(className);
            });
            slots[i].removeAttribute('data-event-state');
            slots[i].removeAttribute('data-event-url');

            if (item) {
                titleEl.textContent = item.title;
                metaEl.textContent = item.meta || '—';
                url = normalizeTopEventUrl(item.url) || normalizeTopEventUrl(getTopEventsHistoryUrl());
                if (url) {
                    linkEl.setAttribute('href', url);
                    slots[i].setAttribute('data-event-url', url);
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
                if (url) {
                    linkEl.setAttribute('href', url);
                }
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
        if (topEventsState.inFlight) {
            return;
        }

        if (! getTopEventsPanel()) {
            return;
        }

        topEventsState.inFlight = true;

        fetch(getTopEventsHistoryUrl(), {
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
                    return item.title + '|' + item.meta + '|' + item.state + '|' + String(item.handled) + '|' + item.url;
                }).join('||');

                if (forceRender || signature !== topEventsState.lastSignature) {
                    renderTopEvents(items);
                    topEventsState.lastSignature = signature;
                }
            })
            .catch(function () {
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

    function onClick(event) {
        var action = event.target.closest('.search-history-action');
        var close = event.target.closest('[data-close-shortcuts]');
        var open = event.target.closest('[data-open-shortcuts]');

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

        if (close) {
            event.preventDefault();
            closeShortcutsDialog();
        }
    }

    function escapeHtml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    document.addEventListener('submit', onSubmit, true);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', handleGlobalShortcuts);
    document.addEventListener('keydown', trapDialogFocus);
    document.addEventListener('DOMContentLoaded', function () {
        renderRecentSearches();
        startTacticalOverviewPolling();
        initTopWidgetResizers();
        initTopPanelsWidthResizer();
        startTopEventsPolling();
    });

    if (typeof window.jQuery !== 'undefined') {
        window.jQuery(document).on('rendered', '#menu', function () {
            renderRecentSearches();
            refreshTacticalOverview(false);
            refreshTopEvents(false);
        });
    }

    renderRecentSearches();
    refreshTacticalOverview(true);
})();
