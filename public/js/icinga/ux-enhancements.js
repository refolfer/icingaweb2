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

    function setBarWidth(selector, value, maxValue) {
        var el = document.querySelector(selector);
        var count = parseIntOrZero(value);
        var max = parseIntOrZero(maxValue);
        var width = 0;

        if (! el) {
            return;
        }

        if (max > 0 && count > 0) {
            width = Math.max(6, Math.min(100, Math.round((count / max) * 100)));
        }

        el.style.width = width + '%';
    }

    function readMenuBadgeCount(matcher) {
        var links = document.querySelectorAll('#menu a[href]');
        var i;
        var href;
        var badge;

        for (i = 0; i < links.length; i++) {
            href = links[i].getAttribute('href') || '';
            if (! matcher(href)) {
                continue;
            }

            badge = links[i].closest('li') ? links[i].closest('li').querySelector('.badge') : null;
            if (badge) {
                return parseIntOrZero(badge.textContent);
            }
        }

        return null;
    }

    function refreshTacticalOverview() {
        if (! document.querySelector('.tactical-overview')) {
            return;
        }

        var hostDown = readMenuBadgeCount(function (href) {
            return href.indexOf('/monitoring/list/hosts') !== -1 && href.indexOf('host_problem') !== -1;
        });
        var serviceCritical = readMenuBadgeCount(function (href) {
            return href.indexOf('/monitoring/list/services') !== -1
                && (href.indexOf('service_problem') !== -1 || href.indexOf('service_state=2') !== -1);
        });
        var maxIncidentCount = Math.max(
            hostDown === null ? 0 : hostDown,
            serviceCritical === null ? 0 : serviceCritical
        );

        if (hostDown === null) {
            setText('[data-to-host-down]', '--');
            setBarWidth('[data-to-host-bar]', 0, 1);
        } else {
            setText('[data-to-host-down]', hostDown);
            setBarWidth('[data-to-host-bar]', hostDown, maxIncidentCount);
        }

        if (serviceCritical === null) {
            setText('[data-to-service-critical]', '--');
            setBarWidth('[data-to-service-bar]', 0, 1);
        } else {
            setText('[data-to-service-critical]', serviceCritical);
            setBarWidth('[data-to-service-bar]', serviceCritical, maxIncidentCount);
        }
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

    function setTopWidgetHeight(px) {
        var height = clamp(px, TOP_WIDGET_MIN_HEIGHT, TOP_WIDGET_MAX_HEIGHT);
        getTopWidgetTargets().forEach(function (el) {
            el.style.height = height + 'px';
        });
    }

    function clearTopWidgetHeight() {
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

    function syncTopEventsHeightWithTactical() {
        var tactical = getTacticalContainer();
        var topEvents = getTopEventsPanel();
        if (! tactical || ! topEvents) {
            return;
        }

        topEvents.style.height = tactical.getBoundingClientRect().height + 'px';
    }

    function applySavedTopWidgetHeight() {
        var saved = readSavedTopWidgetHeight();
        if (Number.isFinite(saved)) {
            setTopWidgetHeight(saved);
        } else {
            clearTopWidgetHeight();
            syncTopEventsHeightWithTactical();
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
        document.documentElement.classList.remove('top-widget-resizing');
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

        document.documentElement.classList.add('top-widget-resizing');
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
                syncTopEventsHeightWithTactical();
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
        refreshTacticalOverview();
        initTopWidgetResizers();
        startTopEventsPolling();
    });

    if (typeof window.jQuery !== 'undefined') {
        window.jQuery(document).on('rendered', '#menu', function () {
            renderRecentSearches();
            refreshTacticalOverview();
            refreshTopEvents(false);
        });
    }

    renderRecentSearches();
    refreshTacticalOverview();
})();
