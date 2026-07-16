    function getTacticalContainer() {
        return document.getElementById('header-logo-container');
    }

    function getTopEventsPanel() {
        return document.getElementById('top-events-panel');
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

    function setTriageMode(enabled) {
        writeTriageMode(enabled);
        recordOperatorActivity('Triage', enabled ? 'Enabled triage mode' : 'Disabled triage mode', '', '');
        rerenderCachedTopEvents();
        refreshTopEvents(true);
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

        object = getIcingadbObjectFromServiceTitle(block);
        if (object) {
            return buildIcingadbObjectUrl(object);
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

    function getIcingadbObjectStateFromNode(node) {
        var classes = [];
        var classMap = {};
        var i;

        if (! node) {
            return '';
        }

        Array.prototype.slice.call(
            node.querySelectorAll('[class*="state-"], .state, .badge, .state-badge, [class*="severity-"]')
        ).concat([node]).forEach(function (element) {
            String(element.className || '')
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

        for (i = 0; i < classes.length; i++) {
            if (
                classes[i] === 'state-critical'
                || classes[i] === 'critical'
                || classes[i] === 'severity-critical'
                || classes[i] === 'state-down'
                || classes[i] === 'down'
                || classes[i] === 'state-unreachable'
                || classes[i] === 'unreachable'
            ) {
                return 'critical';
            }
        }

        for (i = 0; i < classes.length; i++) {
            if (
                classes[i] === 'state-ok'
                || classes[i] === 'ok'
                || classes[i] === 'state-up'
                || classes[i] === 'up'
                || classes[i] === 'severity-ok'
            ) {
                return 'ok';
            }
        }

        return '';
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
        if (! item || ! item.url || item.handled || isIncidentSeen(item.url)) {
            return false;
        }

        return item.state === 'critical';
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
            critical: 100
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
            setOperatorFocusText('[data-operator-focus-title]', getOperatorFocusLabel('emptyDetailLabel', 'No active critical events need operator focus.'));
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

    function getOperatorDecisionLaneLabel(lane) {
        var labels = {
            me: 'Assigned to me',
            assigned: 'Assigned',
            unassigned: 'Not assigned'
        };

        return getOperatorDecisionLabel(lane + 'Label', labels[lane] || 'No matching events');
    }

    function getOperatorDecisionNormalizedNames(value) {
        var names = [];
        var normalized = normalizeText(value || '').toLowerCase();
        var local = normalized.indexOf('@') === -1 ? normalized : normalized.split('@')[0];

        if (normalized.length && names.indexOf(normalized) === -1) {
            names.push(normalized);
        }

        if (local.length && names.indexOf(local) === -1) {
            names.push(local);
        }

        return names;
    }

    function getOperatorDecisionCurrentUserNames() {
        var matrix = getOperatorDecisionMatrix();
        var names = [];

        if (! matrix || ! matrix.dataset) {
            return names;
        }

        names = names
            .concat(getOperatorDecisionNormalizedNames(matrix.dataset.currentUser || ''))
            .concat(getOperatorDecisionNormalizedNames(matrix.dataset.currentUserLocal || ''));

        return names.filter(function (name, index, list) {
            return name.length && list.indexOf(name) === index;
        });
    }

    function isAssignedToCurrentUser(assignee, currentUserNames) {
        var names = currentUserNames || getOperatorDecisionCurrentUserNames();
        var assigneeNames = getOperatorDecisionNormalizedNames(assignee || '');

        if (! assigneeNames.length || ! names.length) {
            return false;
        }

        return assigneeNames.some(function (name) {
            return names.indexOf(name) !== -1;
        });
    }

    function getOperatorDecisionLaneFromAssignee(assignee, currentUserNames) {
        if (! normalizeText(assignee || '').length) {
            return 'unassigned';
        }

        return isAssignedToCurrentUser(assignee, currentUserNames) ? 'me' : 'assigned';
    }

    function getOperatorDecisionLaneAssignedValue(lane) {
        var currentUserNames = getOperatorDecisionCurrentUserNames();

        if (lane === 'me') {
            return currentUserNames[0] || '';
        }

        if (lane === 'assigned') {
            return 'true';
        }

        if (lane === 'unassigned') {
            return 'false';
        }

        return '';
    }

    function refreshOperatorDecisionAssignments() {
        var url = getIncidentAssignmentSummaryUrl();
        var now = Date.now();

        if (! url.length || typeof window.fetch !== 'function') {
            return;
        }

        if (operatorDecisionAssignmentState.inFlight) {
            return;
        }

        if (operatorDecisionAssignmentState.retryAt > now) {
            return;
        }

        operatorDecisionAssignmentState.inFlight = true;

        window.fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store'
        })
            .then(function (response) {
                if (! response.ok) {
                    throw new Error('Request failed with status ' + response.status);
                }

                return response.json();
            })
            .then(function (payload) {
                operatorDecisionAssignmentState.summary = payload && payload.summary ? payload.summary : null;
                operatorDecisionAssignmentState.retryAt = 0;
                renderOperatorDecisionMatrix();
            })
            .catch(function () {
                operatorDecisionAssignmentState.retryAt = Date.now() + Math.min(
                    TOP_EVENTS_ERROR_BACKOFF_MAX_MS,
                    TOP_EVENTS_ERROR_BACKOFF_MS
                );
            })
            .then(function () {
                operatorDecisionAssignmentState.inFlight = false;
            }, function () {
                operatorDecisionAssignmentState.inFlight = false;
            });
    }

    function createOperatorDecisionSnapshot() {
        var lanes = {
            me: [],
            assigned: [],
            unassigned: []
        };
        var currentUserNames = getOperatorDecisionCurrentUserNames();
        var items = Array.isArray(topEventsState.items) ? topEventsState.items : [];

        items.forEach(function (item) {
            var object;
            var assignee;
            var assignmentDetails;
            var lane;

            object = getIcingadbObjectFromUrl(item.url);
            if (object) {
                assignmentDetails = getIncidentAssignmentDetailsCache(object);
                assignee = assignmentDetails && assignmentDetails.assignment
                    ? String(assignmentDetails.assignment.assignee || '')
                    : getIncidentAssignmentCache(object);
            } else {
                assignee = '';
            }

            lane = getOperatorDecisionLaneFromAssignee(assignee, currentUserNames);
            lanes[lane].push(item);
        });

        return lanes;
    }

    function getOperatorDecisionLaneTitle(item, lane) {
        if (! item) {
            return getOperatorDecisionLabel('emptyLabel', getOperatorDecisionLaneLabel(lane || ''));
        }

        return normalizeText(item.title || item.meta || item.preview || 'Untitled event');
    }

    function renderOperatorDecisionMatrix() {
        var matrix = getOperatorDecisionMatrix();
        var lanes;
        var summary = operatorDecisionAssignmentState.summary || null;

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
            var laneSummary = summary && summary.lanes ? summary.lanes[lane] : null;
            var laneCount = summary && typeof summary[lane] === 'number'
                ? summary[lane]
                : events.length;

            if (count) {
                count.textContent = String(laneCount);
            }

            if (title) {
                title.textContent = laneSummary && laneSummary.title
                    ? laneSummary.title
                    : getOperatorDecisionLaneTitle(first, lane);
                title.hidden = lane === 'assigned' && laneCount <= 0;
            }

            if (card) {
                card.classList.toggle('has-events', laneCount > 0);
            }

            if (button) {
                button.disabled = laneCount <= 0
                    || (lane === 'me' && ! getOperatorDecisionLaneAssignedValue(lane).length);
                button.textContent = getOperatorDecisionLabel('openLabel', 'Open');
            }
        });
    }

    function runOperatorDecisionAction(lane) {
        var lanes = createOperatorDecisionSnapshot();
        var item = lanes[lane] && lanes[lane][0] ? lanes[lane][0] : null;
        var assigned = getOperatorDecisionLaneAssignedValue(lane);
        var searchPath = 'search?assigned=' + encodeURIComponent(assigned);
        var searchUrl = normalizeIncidentUrl(searchPath);

        recordOperatorActivity(
            'Decision',
            'Opened ' + getOperatorDecisionLaneLabel(lane).toLowerCase(),
            item ? getOperatorDecisionLaneTitle(item, lane) : getOperatorDecisionLaneLabel(lane),
            searchUrl
        );
        navigateTo(searchPath);
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
        empty.textContent = getTriageDeskLabel('emptyLabel', 'No active critical events');
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
        lines.push('- Assigned to me: ' + String(decision.me.length));
        lines.push('- Assigned: ' + String(decision.assigned.length));
        lines.push('- Not assigned: ' + String(decision.unassigned.length));

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

    function renderTopEventAssignmentControls(item, object, controlsEl) {
        var details = getIncidentAssignmentDetailsCache(object);
        var currentAssignee = details && details.assignment
            ? String(details.assignment.assignee || '')
            : getIncidentAssignmentCache(object);
        var isLoading = isIncidentAssignmentLoading(object) && ! details;
        var canAssign = !! (details && details.canAssign);
        var users = details && Array.isArray(details.users) ? details.users : [];
        var currentNote = details && details.assignment
            ? String(details.assignment.note || '')
            : '';
        if (! currentNote.trim().length) {
            currentNote = getIncidentAssignmentNoteCache(object);
        }
        var html = '';
        var options = [];

        if (! controlsEl) {
            return;
        }

        controlsEl.innerHTML = '';

        if (! object || ! item || ! item.url) {
            controlsEl.hidden = true;
            return;
        }

        controlsEl.hidden = false;

        if (isLoading) {
            controlsEl.innerHTML = '<span class="top-event-assignment-loading">'
                + escapeHtml(getIncidentAssignmentLabel('assignment-loading-label', 'Loading assignee...'))
                + '</span>';
            return;
        }

        if (canAssign) {
            options.push('<option value="">'
                + escapeHtml(getIncidentAssignmentLabel('assignment-placeholder-label', 'Choose a registered user'))
                + '</option>');

            if (currentAssignee.length && users.indexOf(currentAssignee) === -1) {
                options.push('<option value="' + escapeHtml(currentAssignee) + '" selected>'
                    + escapeHtml(currentAssignee)
                    + '</option>');
            }

            users.forEach(function (userName) {
                options.push('<option value="' + escapeHtml(userName) + '"'
                    + (userName === currentAssignee ? ' selected' : '')
                    + '>' + escapeHtml(userName) + '</option>');
            });

            html = ''
                + (currentNote.trim().length
                    ? '<span class="top-event-assignment-note top-event-assignment-note-compact" title="' + escapeHtml(currentNote.trim()) + '">'
                        + escapeHtml(getIncidentAssignmentLabel('assignment-note-label', 'Note') + ': ' + currentNote.trim())
                        + '</span>'
                    : '')
                + '<form class="top-event-assignment-form" data-top-event-assignment-form>'
                + '<label class="top-event-assignment-select">'
                + '<span class="sr-only">' + escapeHtml(getIncidentAssignmentLabel('assign-to-label', 'Assign to')) + '</span>'
                + '<select data-top-event-assignee-select'
                + ' data-assignment-object-type="' + escapeHtml(object.type) + '"'
                + ' data-assignment-host-name="' + escapeHtml(object.hostName) + '"'
                + ' data-assignment-service-name="' + escapeHtml(object.serviceName || '') + '"'
                + '>'
                + options.join('')
                + '</select>'
                + '</label>'
                + '<button type="submit" class="top-event-assignment-save">'
                + escapeHtml(getIncidentAssignmentLabel('assignment-save-label', 'Save assignee'))
                + '</button>'
                + '</form>';

            if (! users.length) {
                html += '<span class="top-event-assignment-note">'
                    + escapeHtml(getIncidentAssignmentLabel(
                        'assignment-no-users-label',
                        'No registered users are available for assignment.'
                    ))
                    + '</span>';
            }

            controlsEl.innerHTML = html;
            return;
        }

        html = '';

        if (currentNote.trim().length) {
            html += '<span class="top-event-assignment-note top-event-assignment-note-compact" title="'
                + escapeHtml(currentNote.trim())
                + '">'
                + escapeHtml(getIncidentAssignmentLabel('assignment-note-label', 'Note') + ': ' + currentNote.trim())
                + '</span>';
        }

        html += '<button type="button" class="top-event-assignment-open" data-open-incident-assignment>'
            + escapeHtml(getIncidentAssignmentLabel('assignment-open-label', 'Open drawer'))
            + '</button>';

        controlsEl.innerHTML = html;
    }

    function renderTopEvents(items) {
        var slots = document.querySelectorAll('[data-top-event-item]');
        var triageMode = isTriageModeEnabled();
        var visibleItems = items.filter(function (item) {
            return ! item || ! item.url || ! isIncidentSnoozed(item.url);
        });
        var i;

        renderOperatorBoards();

        if (triageMode) {
            visibleItems = visibleItems.filter(isTriageEvent);
            if (! visibleItems.length && items.length) {
                visibleItems = [{
                    title: 'No active critical events',
                    meta: 'Seen, handled, snoozed and non-critical entries are hidden',
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
            var assignmentControlsEl = slots[i].querySelector('.top-event-assignment-controls');
            var previewEl = slots[i].querySelector('.top-event-preview');
            var linkEl = slots[i].querySelector('.top-event-link');
            var stateClass;
            var url = normalizeTopEventUrl(getTopEventsHistoryUrl());
            var object = null;

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
            if (assignmentControlsEl) {
                assignmentControlsEl.innerHTML = '';
            }

            if (item) {
                titleEl.textContent = item.title;
                object = getIcingadbObjectFromUrl(item.url);
                prefetchIncidentAssignment(object);
                metaEl.textContent = item.meta || '—';
                renderTopEventAssignmentControls(item, object, assignmentControlsEl);
                previewEl.textContent = item.preview || item.meta || item.title;
                if (object) {
                    slots[i].dataset.incidentObjectType = object.type;
                    slots[i].dataset.incidentObjectHostName = object.hostName;
                    slots[i].dataset.incidentObjectServiceName = object.serviceName || '';
                } else {
                    delete slots[i].dataset.incidentObjectType;
                    delete slots[i].dataset.incidentObjectHostName;
                    delete slots[i].dataset.incidentObjectServiceName;
                }
                url = normalizeTopEventUrl(item.url);
                if (url && isTopEventDetailsUrl(url)) {
                    linkEl.setAttribute('href', url);
                    slots[i].setAttribute('data-event-url', url);
                    slots[i].classList.toggle('top-event-seen', isIncidentSeen(url));
                } else {
                    linkEl.setAttribute('href', normalizeTopEventUrl(getTopEventsHistoryUrl()) || getTopEventsHistoryUrl());
                    linkEl.classList.add('top-event-link-unresolved');
                    slots[i].removeAttribute('data-event-url');
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
                delete slots[i].dataset.incidentObjectType;
                delete slots[i].dataset.incidentObjectHostName;
                delete slots[i].dataset.incidentObjectServiceName;
                slots[i].removeAttribute('data-event-url');
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
                refreshOperatorDecisionAssignments();
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
            if (! document.hidden) {
                refreshTopEvents(false);
            }
        }, TOP_EVENTS_REFRESH_MS);
    }
