// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

(function () {
    'use strict';

    var SEARCH_HISTORY_KEY = 'menu-search-history';
    var NAV_SEQUENCE_TIMEOUT = 1200;
    var TACTICAL_HEIGHT_KEY = 'tactical-overview-height';
    var TACTICAL_MIN_HEIGHT = 120;
    var TACTICAL_MAX_HEIGHT = 340;

    var goState = {
        pending: false,
        timer: null
    };

    var lastFocusedElement = null;
    var tacticalResizeState = null;

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

    function getTacticalResizer() {
        return document.getElementById('tactical-overview-resizer');
    }

    function setTacticalHeight(px) {
        var container = getTacticalContainer();
        if (! container) {
            return;
        }

        container.style.height = clamp(px, TACTICAL_MIN_HEIGHT, TACTICAL_MAX_HEIGHT) + 'px';
    }

    function readSavedTacticalHeight() {
        try {
            return parseInt(window.localStorage.getItem(TACTICAL_HEIGHT_KEY), 10);
        } catch (error) {
            return NaN;
        }
    }

    function saveTacticalHeight(px) {
        try {
            window.localStorage.setItem(TACTICAL_HEIGHT_KEY, String(clamp(px, TACTICAL_MIN_HEIGHT, TACTICAL_MAX_HEIGHT)));
        } catch (error) {
            // Ignore storage errors
        }
    }

    function applySavedTacticalHeight() {
        var saved = readSavedTacticalHeight();
        if (Number.isFinite(saved)) {
            setTacticalHeight(saved);
        }
    }

    function onTacticalResizeMove(event) {
        if (! tacticalResizeState) {
            return;
        }

        event.preventDefault();

        var delta = event.clientY - tacticalResizeState.startY;
        setTacticalHeight(tacticalResizeState.startHeight + delta);
    }

    function onTacticalResizeEnd() {
        if (! tacticalResizeState) {
            return;
        }

        var container = getTacticalContainer();
        if (container) {
            saveTacticalHeight(container.getBoundingClientRect().height);
        }

        tacticalResizeState = null;
        document.documentElement.classList.remove('tactical-resizing');
        window.removeEventListener('mousemove', onTacticalResizeMove);
        window.removeEventListener('mouseup', onTacticalResizeEnd);
    }

    function onTacticalResizeStart(event) {
        var container = getTacticalContainer();
        if (! container || event.button !== 0) {
            return;
        }

        tacticalResizeState = {
            startY: event.clientY,
            startHeight: container.getBoundingClientRect().height
        };

        document.documentElement.classList.add('tactical-resizing');
        window.addEventListener('mousemove', onTacticalResizeMove);
        window.addEventListener('mouseup', onTacticalResizeEnd);
        event.preventDefault();
    }

    function onTacticalResizeKeydown(event) {
        var container = getTacticalContainer();
        if (! container) {
            return;
        }

        var current = container.getBoundingClientRect().height;
        var next = current;

        if (event.key === 'ArrowUp') {
            next = current - 12;
        } else if (event.key === 'ArrowDown') {
            next = current + 12;
        } else if (event.key === 'Home') {
            next = TACTICAL_MIN_HEIGHT;
        } else if (event.key === 'End') {
            next = TACTICAL_MAX_HEIGHT;
        } else {
            return;
        }

        event.preventDefault();
        setTacticalHeight(next);
        saveTacticalHeight(next);
    }

    function initTacticalResizer() {
        var resizer = getTacticalResizer();
        var container = getTacticalContainer();

        if (! resizer || ! container) {
            return;
        }

        applySavedTacticalHeight();
        resizer.addEventListener('mousedown', onTacticalResizeStart);
        resizer.addEventListener('keydown', onTacticalResizeKeydown);
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
        initTacticalResizer();
    });

    if (typeof window.jQuery !== 'undefined') {
        window.jQuery(document).on('rendered', '#menu', function () {
            renderRecentSearches();
            refreshTacticalOverview();
        });
    }

    renderRecentSearches();
    refreshTacticalOverview();
})();
