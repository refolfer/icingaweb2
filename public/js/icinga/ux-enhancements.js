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

    var goState = {
        pending: false,
        timer: null
    };

    var lastFocusedElement = null;
    var topWidgetResizeState = null;
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

    function stateCountFromClasses(container, classes) {
        var candidates = container.querySelectorAll('.state-badges [class]');
        var i;
        var j;
        var classList;
        var count;

        for (i = 0; i < candidates.length; i++) {
            classList = String(candidates[i].className || '').split(/\s+/);
            for (j = 0; j < classes.length; j++) {
                if (classList.indexOf(classes[j]) === -1) {
                    continue;
                }

                count = parseCompactNumber(candidates[i].textContent);
                if (count > 0) {
                    return count;
                }
            }
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
            return 'conic-gradient(from -90deg, rgba(47, 125, 213, 0.2), rgba(47, 125, 213, 0.2))';
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
            return 'conic-gradient(from -90deg, rgba(47, 125, 213, 0.2), rgba(47, 125, 213, 0.2))';
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
                up: stateCountFromClasses(container, ['state-up', 'state-ok']),
                downUnhandled: stateCountFromClasses(container, ['state-down', 'state-critical']),
                downHandled: stateCountFromClasses(container, ['state-down-handled', 'state-critical-handled']),
                pending: stateCountFromClasses(container, ['state-pending'])
            };
        }

        return {
            total: parseCompactNumber(meta ? meta.textContent : ''),
            primary: parseCompactNumber(big ? big.textContent : ''),
            primaryLabel: normalizeText(small ? small.textContent : 'Critical') || 'Critical',
            ok: stateCountFromClasses(container, ['state-ok']),
            warningUnhandled: stateCountFromClasses(container, ['state-warning']),
            warningHandled: stateCountFromClasses(container, ['state-warning-handled']),
            criticalUnhandled: stateCountFromClasses(container, ['state-critical']),
            criticalHandled: stateCountFromClasses(container, ['state-critical-handled']),
            unknownUnhandled: stateCountFromClasses(container, ['state-unknown']),
            unknownHandled: stateCountFromClasses(container, ['state-unknown-handled']),
            pending: stateCountFromClasses(container, ['state-pending'])
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
                { value: host.up, color: 'var(--to-ok)' },
                { value: host.downHandled, color: 'var(--to-critical-handled)' },
                { value: host.downUnhandled, color: 'var(--to-critical)' },
                { value: host.pending, color: 'var(--to-pending)' }
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
                { value: service.ok, color: 'var(--to-ok)' },
                { value: service.warningHandled, color: 'var(--to-warning-handled)' },
                { value: service.warningUnhandled, color: 'var(--to-warning)' },
                { value: service.criticalHandled, color: 'var(--to-critical-handled)' },
                { value: service.criticalUnhandled, color: 'var(--to-critical)' },
                { value: service.unknownHandled, color: 'var(--to-unknown-handled)' },
                { value: service.unknownUnhandled, color: 'var(--to-unknown)' },
                { value: service.pending, color: 'var(--to-pending)' }
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

    function extractEvent(block) {
        var titleEl = block.querySelector('h1, h2, h3, h4, a, strong, .subject, .title');
        var title = normalizeText(titleEl ? titleEl.textContent : '');
        var text = normalizeText(block.textContent);
        var metaParts = [];

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
            meta: metaParts.join(' • ').slice(0, 220)
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

            var signature = event.title + '|' + event.meta;
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

            if (! titleEl || ! metaEl) {
                continue;
            }

            if (item) {
                titleEl.textContent = item.title;
                metaEl.textContent = item.meta || '—';
            } else {
                titleEl.textContent = '—';
                metaEl.textContent = '';
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
                    return item.title + '|' + item.meta;
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
