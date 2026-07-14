    function getIncidentDrawer() {
        return document.getElementById('incident-drawer');
    }

    function getIncidentDrawerPanel() {
        var drawer = getIncidentDrawer();

        return drawer ? drawer.querySelector('.incident-drawer-panel') : null;
    }

    function getIncidentDrawerResizer() {
        return document.querySelector('[data-incident-drawer-resizer]');
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

    function setIncidentDrawerWidthResizingClass(active) {
        var layout = getLayoutRoot();

        document.documentElement.classList.toggle('incident-drawer-resizing', active);

        if (layout) {
            layout.classList.toggle('incident-drawer-resizing', active);
        }
    }

    function setIncidentDrawerWidth(px) {
        var width = clamp(px, INCIDENT_DRAWER_WIDTH_MIN, INCIDENT_DRAWER_WIDTH_MAX);

        document.documentElement.style.setProperty('--ux-incident-drawer-width', width + 'px');
        return width;
    }

    function clearIncidentDrawerWidth() {
        document.documentElement.style.removeProperty('--ux-incident-drawer-width');
    }

    function getCurrentIncidentDrawerWidth() {
        var panel = getIncidentDrawerPanel();
        var parsed = parseFloat(String(panel ? window.getComputedStyle(panel).width : '').replace(/[^\d.-]/g, ''));

        return Number.isFinite(parsed) ? parsed : NaN;
    }

    function readSavedIncidentDrawerWidth() {
        try {
            return parseInt(window.localStorage.getItem(INCIDENT_DRAWER_WIDTH_KEY), 10);
        } catch (error) {
            return NaN;
        }
    }

    function saveIncidentDrawerWidth(px) {
        try {
            window.localStorage.setItem(
                INCIDENT_DRAWER_WIDTH_KEY,
                String(clamp(px, INCIDENT_DRAWER_WIDTH_MIN, INCIDENT_DRAWER_WIDTH_MAX))
            );
        } catch (error) {
            // Ignore storage errors
        }
    }

    function applySavedIncidentDrawerWidth() {
        var saved = readSavedIncidentDrawerWidth();

        if (Number.isFinite(saved)) {
            setIncidentDrawerWidth(saved);
        } else {
            clearIncidentDrawerWidth();
        }
    }

    function onIncidentDrawerWidthResizeMove(event) {
        if (! incidentDrawerWidthResizeState) {
            return;
        }

        event.preventDefault();
        setIncidentDrawerWidth(
            incidentDrawerWidthResizeState.startWidth - (event.clientX - incidentDrawerWidthResizeState.startX)
        );
    }

    function onIncidentDrawerWidthResizeEnd() {
        if (! incidentDrawerWidthResizeState) {
            return;
        }

        saveIncidentDrawerWidth(getCurrentIncidentDrawerWidth());

        incidentDrawerWidthResizeState = null;
        setIncidentDrawerWidthResizingClass(false);
        window.removeEventListener('mousemove', onIncidentDrawerWidthResizeMove);
        window.removeEventListener('mouseup', onIncidentDrawerWidthResizeEnd);
    }

    function onIncidentDrawerWidthResizeStart(event) {
        var width;

        if (event.button !== 0) {
            return;
        }

        width = getCurrentIncidentDrawerWidth();
        if (! Number.isFinite(width) || width <= 0) {
            width = parseFloat(String(window.getComputedStyle(getIncidentDrawerPanel() || document.documentElement)
                .getPropertyValue('width') || '').replace(/[^\d.-]/g, ''));
        }

        incidentDrawerWidthResizeState = {
            startX: event.clientX,
            startWidth: Number.isFinite(width) && width > 0 ? width : 672
        };

        setIncidentDrawerWidthResizingClass(true);
        window.addEventListener('mousemove', onIncidentDrawerWidthResizeMove);
        window.addEventListener('mouseup', onIncidentDrawerWidthResizeEnd);
        event.preventDefault();
    }

    function onIncidentDrawerWidthResizeKeydown(event) {
        var current = getCurrentIncidentDrawerWidth();
        var next;

        if (! Number.isFinite(current) || current <= 0) {
            current = parseFloat(String(window.getComputedStyle(getIncidentDrawerPanel() || document.documentElement)
                .getPropertyValue('width') || '').replace(/[^\d.-]/g, ''));
        }

        next = Number.isFinite(current) && current > 0 ? current : 672;

        if (event.key === 'ArrowLeft') {
            next = next + 16;
        } else if (event.key === 'ArrowRight') {
            next = next - 16;
        } else if (event.key === 'Home') {
            next = INCIDENT_DRAWER_WIDTH_MIN;
        } else if (event.key === 'End') {
            next = INCIDENT_DRAWER_WIDTH_MAX;
        } else {
            return;
        }

        event.preventDefault();
        next = setIncidentDrawerWidth(next);
        saveIncidentDrawerWidth(next);
    }

    function initIncidentDrawerWidthResizer() {
        var resizer = getIncidentDrawerResizer();

        if (! resizer) {
            return;
        }

        if (resizer.__incidentDrawerWidthInitialized) {
            return;
        }

        applySavedIncidentDrawerWidth();
        resizer.addEventListener('mousedown', onIncidentDrawerWidthResizeStart);
        resizer.addEventListener('keydown', onIncidentDrawerWidthResizeKeydown);
        resizer.__incidentDrawerWidthInitialized = true;
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

    function parseIcingadbObjectPath(path) {
        var params;
        var hostName;
        var serviceName;

        if (! path.length) {
            return null;
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

    function getIcingadbObjectFromUrl(url) {
        var normalized = normalizeIncidentUrl(url);
        var baseUrl = getBaseUrl();
        var path = normalized;
        var hashIndex;
        var hashPath;
        var hashObject;

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

        hashIndex = normalized.indexOf('#');
        if (hashIndex !== -1) {
            hashPath = normalized.slice(hashIndex + 1).replace(/^!+/, '');
            if (hashPath.indexOf(baseUrl + '/') === 0) {
                hashPath = hashPath.slice(baseUrl.length + 1);
            } else {
                hashPath = hashPath.replace(/^\/+/, '');
            }

            hashObject = parseIcingadbObjectPath(hashPath);
            if (hashObject) {
                return hashObject;
            }
        }

        return parseIcingadbObjectPath(path);
    }

    function getIcingadbObjectFromNode(node) {
        var type;
        var hostName;
        var serviceName;

        if (! node || ! node.dataset) {
            return null;
        }

        type = String(node.dataset.incidentObjectType || '').trim();
        hostName = String(node.dataset.incidentObjectHostName || '').trim();
        serviceName = String(node.dataset.incidentObjectServiceName || '').trim();

        if (type === 'host' && hostName.length) {
            return {
                type: 'host',
                hostName: hostName,
                serviceName: ''
            };
        }

        if (type === 'service' && hostName.length && serviceName.length) {
            return {
                type: 'service',
                hostName: hostName,
                serviceName: serviceName
            };
        }

        return null;
    }

    function getIcingadbObjectFromDetailFilter(node) {
        var container;
        var filter;
        var params;
        var hostName;
        var serviceName;

        if (! node || typeof node.closest !== 'function') {
            return null;
        }

        container = node.closest('[data-icinga-detail-filter]');
        if (! container) {
            return null;
        }

        filter = String(container.getAttribute('data-icinga-detail-filter') || '').trim();
        while (filter.length > 1 && filter.charAt(0) === '(' && filter.charAt(filter.length - 1) === ')') {
            filter = filter.slice(1, -1).trim();
        }

        if (! filter.length) {
            return null;
        }

        params = getUrlSearchParams(filter);
        hostName = params.get('host.name') || params.get('host') || '';
        serviceName = params.get('name') || params.get('service.name') || '';

        if (hostName.length && serviceName.length) {
            return {
                type: 'service',
                hostName: hostName,
                serviceName: serviceName
            };
        }

        if (hostName.length) {
            return {
                type: 'host',
                hostName: hostName,
                serviceName: ''
            };
        }

        return null;
    }

    function findIcingadbObjectInDocument(doc) {
        var containers = doc.querySelectorAll('[data-icinga-url]');
        var anchors = doc.querySelectorAll('a[href*="icingadb/service"], a[href*="icingadb/host"]');
        var i;
        var object;

        for (i = 0; i < containers.length; i++) {
            object = getIcingadbObjectFromUrl(containers[i].getAttribute('data-icinga-url') || '');
            if (object && object.type === 'service') {
                return object;
            }
        }

        for (i = 0; i < containers.length; i++) {
            object = getIcingadbObjectFromUrl(containers[i].getAttribute('data-icinga-url') || '');
            if (object) {
                return object;
            }
        }

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

    function findIcingadbObjectInNode(node) {
        var anchors;
        var i;
        var object;

        if (! node) {
            return null;
        }

        object = getIcingadbObjectFromDetailFilter(node);
        if (object) {
            return object;
        }

        object = getIcingadbObjectFromNode(node);
        if (object) {
            return object;
        }

        object = getIcingadbObjectFromServiceTitle(node);
        if (object) {
            return object;
        }

        if (typeof node.querySelectorAll === 'function') {
            object = findIcingadbObjectInSubtree(node);
            if (object) {
                return object;
            }
        }

        if (typeof node.closest === 'function' && node.closest('.object-detail')) {
            object = findIcingadbObjectInDocument(node);
            if (object) {
                return object;
            }

            object = getIcingadbObjectFromUrlContainer(node);
            if (object) {
                return object;
            }

            return getIcingadbObjectFromUrl(window.location.href);
        }

        anchors = node.querySelectorAll('a[href*="icingadb/service"], a[href*="icingadb/host"]');

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

    function getIcingadbObjectFromUrlContainer(node) {
        var container;
        var object;

        if (! node || typeof node.closest !== 'function') {
            return null;
        }

        container = node.closest('[data-icinga-url]');
        if (! container) {
            return null;
        }

        object = getIcingadbObjectFromUrl(container.getAttribute('data-icinga-url') || '');

        return object || null;
    }

    function getIcingadbObjectFromServiceTitle(node) {
        var subjects;
        var serviceSubject;
        var hostSubject;
        var object;
        var hostObject;
        var serviceName;
        var hostName;

        if (! node || ! node.classList || ! node.classList.contains('service')) {
            return null;
        }

        subjects = node.querySelectorAll('.subject');
        if (subjects.length < 2) {
            return null;
        }

        serviceSubject = subjects[0];
        hostSubject = subjects[1];
        serviceName = String(serviceSubject ? serviceSubject.textContent || '' : '').trim();
        hostName = '';

        object = getIcingadbObjectFromNode(serviceSubject);
        if (object && object.type === 'service') {
            return object;
        }

        object = getIcingadbObjectFromUrl(
            serviceSubject && typeof serviceSubject.getAttribute === 'function'
                ? (serviceSubject.getAttribute('href') || serviceSubject.href || '')
                : ''
        );
        if (object && object.type === 'service') {
            return object;
        }

        hostObject = getIcingadbObjectFromUrl(
            hostSubject && typeof hostSubject.getAttribute === 'function'
                ? (hostSubject.getAttribute('href') || hostSubject.href || '')
                : ''
        );
        if (hostObject && hostObject.hostName) {
            hostName = hostObject.hostName;
        }

        if (serviceName.length && hostName.length) {
            return {
                type: 'service',
                hostName: hostName,
                serviceName: serviceName
            };
        }

        return null;
    }

    function findIcingadbObjectInSubtree(node) {
        var elements;
        var i;
        var object;
        var fallbackObject = null;

        if (! node || typeof node.querySelectorAll !== 'function') {
            return null;
        }

        elements = node.querySelectorAll(
            '[data-icinga-detail-filter], [data-icinga-url], a[href*="icingadb/service"], a[href*="icingadb/host"]'
        );

        for (i = 0; i < elements.length; i++) {
            object = getIcingadbObjectFromDetailFilter(elements[i]);
            if (object && object.type === 'service') {
                return object;
            }
            if (! fallbackObject && object) {
                fallbackObject = object;
            }
        }

        for (i = 0; i < elements.length; i++) {
            object = getIcingadbObjectFromServiceTitle(elements[i]);
            if (object) {
                return object;
            }
        }

        for (i = 0; i < elements.length; i++) {
            object = getIcingadbObjectFromNode(elements[i]);
            if (object && object.type === 'service') {
                return object;
            }
            if (! fallbackObject && object) {
                fallbackObject = object;
            }
        }

        for (i = 0; i < elements.length; i++) {
            object = getIcingadbObjectFromUrl(elements[i].getAttribute('data-icinga-url') || '');
            if (object && object.type === 'service') {
                return object;
            }
            if (! fallbackObject && object) {
                fallbackObject = object;
            }
        }

        for (i = 0; i < elements.length; i++) {
            object = getIcingadbObjectFromUrl(elements[i].getAttribute('href') || elements[i].href || '');
            if (object && object.type === 'service') {
                return object;
            }
            if (! fallbackObject && object) {
                fallbackObject = object;
            }
        }

        return fallbackObject;
    }

    function getIcingadbDetailContainer() {
        var col2 = document.getElementById('col2');
        var col1 = document.getElementById('col1');
        var detail;

        if (col2) {
            detail = col2.querySelector('.object-detail');
            if (detail) {
                return detail.closest('#col1, #col2') || col2;
            }
        }

        if (col1) {
            detail = col1.querySelector('.object-detail');
            if (detail) {
                return detail.closest('#col1, #col2') || col1;
            }
        }

        return null;
    }

    function getIcingadbObjectAssignmentBanner() {
        var container = getIcingadbDetailContainer();
        var banner;

        if (! container) {
            return null;
        }

        banner = container.querySelector('[data-object-assignee-banner]');
        if (! banner) {
            banner = document.createElement('div');
            banner.setAttribute('data-object-assignee-banner', '');
            banner.className = 'object-assignee-banner';
            container.insertBefore(banner, container.firstChild || null);
        }

        return banner;
    }

    function renderIcingadbObjectAssignmentBanner(object) {
        var banner = getIcingadbObjectAssignmentBanner();
        var label;
        var value;
        var text = '';
        var assignee = '';
        var currentNote = '';
        var details = object ? getIncidentAssignmentDetailsCache(object) : null;
        var displayText = '';

        if (! banner || ! object) {
            return;
        }

        label = banner.querySelector('[data-object-assignee-label]');
        value = banner.querySelector('[data-object-assignee-value]');

        if (! label) {
            label = document.createElement('span');
            label.setAttribute('data-object-assignee-label', '');
            label.className = 'object-assignee-banner-label';
            label.textContent = getIncidentAssignmentLabel('assignee-label', 'Assignee');
            banner.appendChild(label);
        }

        if (! value) {
            value = document.createElement('span');
            value.setAttribute('data-object-assignee-value', '');
            value.className = 'object-assignee-banner-value';
            banner.appendChild(value);
        }

        assignee = getIncidentAssignmentCache(object);
        currentNote = details && details.assignment ? String(details.assignment.note || '') : '';
        if (! currentNote.trim().length) {
            currentNote = getIncidentAssignmentNoteCache(object);
        }
        displayText = assignee.length
            ? assignee
            : getIncidentAssignmentLabel('no-assignee-label', 'Unassigned');
        if (currentNote.trim().length) {
            displayText += ' · '
                + getIncidentAssignmentLabel('assignment-note-label', 'Note')
                + ': ' + currentNote;
        }
        if (! assignee.length && ! isIncidentAssignmentLoaded(object) && ! isIncidentAssignmentLoading(object)) {
            prefetchIncidentAssignment(object);
        }

        if (isIncidentAssignmentLoading(object)) {
            text = getIncidentAssignmentLabel('assignment-loading-label', 'Loading assignee...');
            banner.classList.add('loading');
        } else if (assignee.length) {
            text = assignee;
            banner.classList.remove('loading');
        } else {
            text = getIncidentAssignmentLabel('no-assignee-label', 'Unassigned');
            banner.classList.remove('loading');
        }

        value.textContent = displayText.length ? displayText : text;
        banner.classList.toggle('assigned', !! assignee.length);
        banner.hidden = false;
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

    function getIcingadbObjectSignature(object) {
        if (! object) {
            return '';
        }

        return object.type + '|' + object.hostName + '|' + (object.serviceName || '');
    }

    function setIncidentAssignmentCache(object, assignee, markLoaded) {
        var signature = getIcingadbObjectSignature(object);

        if (! signature.length) {
            return;
        }

        incidentAssignmentCache[signature] = String(assignee || '');
        if (markLoaded !== false) {
            setIncidentAssignmentFetchState(object, false, true);
        }
        renderIcingadbObjectAssignmentLabels();
    }

    function readIncidentAssignmentNotes() {
        try {
            return JSON.parse(window.localStorage.getItem(INCIDENT_ASSIGNMENT_NOTE_KEY) || '{}');
        } catch (error) {
            return {};
        }
    }

    function writeIncidentAssignmentNotes(notes) {
        try {
            window.localStorage.setItem(INCIDENT_ASSIGNMENT_NOTE_KEY, JSON.stringify(notes || {}));
        } catch (error) {
            // Ignore storage errors caused by private mode or browser restrictions
        }
    }

    function setIncidentAssignmentNoteCache(object, note) {
        var signature = getIcingadbObjectSignature(object);
        var notes;

        if (! signature.length) {
            return;
        }

        notes = readIncidentAssignmentNotes();
        if (String(note || '').trim().length) {
            notes[signature] = String(note || '');
        } else {
            delete notes[signature];
        }
        writeIncidentAssignmentNotes(notes);
    }

    function getIncidentAssignmentNoteCache(object) {
        var signature = getIcingadbObjectSignature(object);
        var notes;

        if (! signature.length) {
            return '';
        }

        notes = readIncidentAssignmentNotes();

        return String(notes[signature] || '');
    }

    function setIncidentAssignmentDetailsCache(object, payload) {
        var signature = getIcingadbObjectSignature(object);
        var cachedNote = getIncidentAssignmentNoteCache(object);
        var note = payload && payload.assignment ? String(payload.assignment.note || '') : '';

        if (! signature.length) {
            return;
        }

        if (! note.length && cachedNote.length) {
            note = cachedNote;
        }

        incidentAssignmentDetailsCache[signature] = {
            assignment: payload && payload.assignment ? {
                assignee: String(payload.assignment.assignee || ''),
                assignedBy: String(payload.assignment.assignedBy || ''),
                assignedAt: String(payload.assignment.assignedAt || ''),
                note: note
            } : null,
            canAssign: !! (payload && payload.canAssign),
            users: payload && Array.isArray(payload.users) ? payload.users.slice() : [],
            loadedAt: Date.now()
        };
    }

    function getIncidentAssignmentDetailsCache(object) {
        var signature = getIcingadbObjectSignature(object);

        return signature.length ? (incidentAssignmentDetailsCache[signature] || null) : null;
    }

    function clearIncidentAssignmentCaches(object) {
        var signature = getIcingadbObjectSignature(object);

        if (signature.length) {
            delete incidentAssignmentCache[signature];
            delete incidentAssignmentDetailsCache[signature];
            delete incidentAssignmentFetchState[signature];
        }
    }

    function getIncidentAssignmentCache(object) {
        var signature = getIcingadbObjectSignature(object);

        return signature.length ? (incidentAssignmentCache[signature] || '') : '';
    }

    function isIncidentAssignmentLoaded(object) {
        var signature = getIcingadbObjectSignature(object);
        var state = signature.length ? incidentAssignmentFetchState[signature] : null;

        return !! (state
            && state.loaded
            && state.loadedAt
            && Date.now() - state.loadedAt < INCIDENT_ASSIGNMENT_PREFETCH_TTL_MS);
    }

    function isIncidentAssignmentLoading(object) {
        var signature = getIcingadbObjectSignature(object);

        return !! (signature.length
            && incidentAssignmentFetchState[signature]
            && incidentAssignmentFetchState[signature].loading);
    }

    function setIncidentAssignmentFetchState(object, loading, loaded) {
        var signature = getIcingadbObjectSignature(object);
        var state = signature.length ? incidentAssignmentFetchState[signature] : null;

        if (! signature.length) {
            return;
        }

        incidentAssignmentFetchState[signature] = {
            loading: !! loading,
            loaded: !! loaded,
            loadedAt: loaded
                ? (state && state.loadedAt ? state.loadedAt : Date.now())
                : 0
        };
    }

    function clearIncidentAssignmentFetchState(object) {
        var signature = getIcingadbObjectSignature(object);

        if (signature.length) {
            delete incidentAssignmentFetchState[signature];
        }
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

    function parseHistoryTimestamp(text) {
        var value = String(text || '').trim();
        var match;
        var dayMatch;
        var iso;
        var date;

        if (! value.length) {
            return null;
        }

        if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(value)) {
            iso = value.replace(' ', 'T');
            date = new Date(iso);
            return isNaN(date.getTime()) ? null : date;
        }

        match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (match) {
            date = new Date(
                parseInt(match[3].length === 2 ? '20' + match[3] : match[3], 10),
                parseInt(match[2], 10) - 1,
                parseInt(match[1], 10),
                parseInt(match[4] || '0', 10),
                parseInt(match[5] || '0', 10),
                parseInt(match[6] || '0', 10)
            );
            return isNaN(date.getTime()) ? null : date;
        }

        match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (match) {
            return null;
        }

        dayMatch = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (dayMatch) {
            date = new Date(dayMatch[1]);
            return isNaN(date.getTime()) ? null : date;
        }

        return null;
    }

    function formatHistoryDuration(ms) {
        var totalMinutes;
        var hours;
        var minutes;

        if (! isFinite(ms) || ms <= 0) {
            return '';
        }

        totalMinutes = Math.floor(ms / 60000);
        hours = Math.floor(totalMinutes / 60);
        minutes = totalMinutes % 60;

        if (hours > 0) {
            return hours + 'h ' + minutes + 'm';
        }

        return minutes + 'm';
    }

    function extractHistoryTimestamp(node, text) {
        var timeNode = node.querySelector('time[datetime], [datetime], [data-time]');
        var attrValue = '';
        var parsed;
        var label = '';
        var match;

        if (timeNode) {
            attrValue = String(
                timeNode.getAttribute('datetime')
                || timeNode.getAttribute('data-time')
                || timeNode.getAttribute('title')
                || timeNode.textContent
                || ''
            ).trim();
        }

        parsed = parseHistoryTimestamp(attrValue);
        if (! parsed) {
            match = String(text || '').match(
                /(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?|\d{1,2}\.\d{1,2}\.\d{2,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?)/
            );
            if (match) {
                parsed = parseHistoryTimestamp(match[1]);
                label = match[1];
            }
        } else {
            label = attrValue;
        }

        return {
            date: parsed,
            label: label
        };
    }

    function renderIncidentMetroTimeline(entries) {
        var metro = document.querySelector('[data-incident-metro-timeline]');
        var stops = entries.map(function (entry, index) {
            var state = entry.state || getMetroStateFromText(entry.text);

            return {
                index: index,
                label: getMetroStationLabel(entry.text),
                time: entry.timeText || getMetroStationTime(entry.text),
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
                + '%); --right: calc('
                + String((100 - to).toFixed(3))
                + '%)'
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
                time: entry.timeText || getMetroStationTime(entry.text),
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
                + '%); --right: calc('
                + String((100 - to).toFixed(3))
                + '%); --metro-color: '
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

    function buildHistoryOccurrenceMap(entries) {
        var openOccurrence = null;
        var ordered = entries
            .map(function (entry, index) {
                return {
                    entry: entry,
                    index: index
                };
            })
            .filter(function (item) {
                return !! (item.entry && item.entry.timestamp);
            })
            .sort(function (left, right) {
                return left.entry.timestamp - right.entry.timestamp;
            });
        var i;

        for (i = 0; i < ordered.length; i++) {
            if (ordered[i].entry.state === 'critical' && openOccurrence === null) {
                openOccurrence = ordered[i];
                ordered[i].entry.occurrenceStart = true;
            } else if (ordered[i].entry.state === 'ok' && openOccurrence !== null) {
                openOccurrence.entry.durationMs = ordered[i].entry.timestamp - openOccurrence.entry.timestamp;
                openOccurrence.entry.durationText = formatHistoryDuration(openOccurrence.entry.durationMs);
                ordered[i].entry.recoveryOf = openOccurrence.index;
                openOccurrence = null;
            }
        }

        if (openOccurrence !== null) {
            openOccurrence.entry.occurrenceStart = true;
        }
    }

    function orderHistoryTimelineEntries(entries) {
        return (entries || [])
            .map(function (entry, index) {
                return {
                    entry: entry,
                    index: index,
                    hasTimestamp: !! (entry && typeof entry.timestamp === 'number' && entry.timestamp > 0)
                };
            })
            .sort(function (left, right) {
                if (left.hasTimestamp && right.hasTimestamp && left.entry.timestamp !== right.entry.timestamp) {
                    return left.entry.timestamp - right.entry.timestamp;
                }

                if (left.hasTimestamp !== right.hasTimestamp) {
                    return left.hasTimestamp ? -1 : 1;
                }

                return left.index - right.index;
            })
            .map(function (item) {
                return item.entry;
            });
    }

    function getIncidentTimelineWindowBounds(entries) {
        var total = entries.length;
        var maxStart = Math.max(0, total - INCIDENT_TIMELINE_WINDOW_SIZE);
        var start = Math.max(0, Math.min(maxStart, incidentDrawerState.timelineWindowStart || 0));

        return {
            start: start,
            end: Math.min(total, start + INCIDENT_TIMELINE_WINDOW_SIZE),
            maxStart: maxStart,
            total: total
        };
    }

    function renderIncidentTimelineWindow() {
        var container = document.querySelector('[data-incident-timeline]');
        var title = document.querySelector('[data-incident-timeline-title]');
        var list = document.querySelector('[data-incident-timeline-list]');
        var metro = document.querySelector('[data-incident-metro-timeline]');
        var controls = document.querySelector('[data-incident-timeline-controls]');
        var rangeLabel = document.querySelector('[data-incident-timeline-range]');
        var olderButton = document.querySelector('[data-incident-timeline-older]');
        var newerButton = document.querySelector('[data-incident-timeline-newer]');
        var entries = incidentDrawerState.timelineEntries || [];
        var bounds;
        var windowEntries;

        if (! container || ! list) {
            return;
        }

        if (title) {
            title.textContent = getIncidentDrawerLabel('timeline-label', 'Metro Timeline');
        }

        if (! entries.length) {
            if (metro) {
                metro.hidden = true;
                metro.innerHTML = '';
            }
            if (controls) {
                controls.hidden = true;
            }
            if (rangeLabel) {
                rangeLabel.textContent = '';
            }
            if (olderButton) {
                olderButton.disabled = true;
            }
            if (newerButton) {
                newerButton.disabled = true;
            }
            list.innerHTML = '<li class="incident-drawer-timeline-muted">'
                + escapeHtml(getIncidentDrawerLabel('timeline-empty-label', 'No recent history found.'))
                + '</li>';
            return;
        }

        bounds = getIncidentTimelineWindowBounds(entries);
        incidentDrawerState.timelineWindowStart = bounds.start;
        windowEntries = entries.slice(bounds.start, bounds.end);

        if (controls) {
            controls.hidden = entries.length <= INCIDENT_TIMELINE_WINDOW_SIZE;
            if (rangeLabel) {
                rangeLabel.textContent = bounds.total
                    ? (getIncidentDrawerLabel('timeline-range-label', 'Showing')
                        + ' ' + String(bounds.start + 1)
                        + '-' + String(bounds.end)
                        + ' ' + getIncidentDrawerLabel('timeline-range-separator-label', 'of')
                        + ' ' + String(bounds.total))
                    : '';
            }
            if (olderButton) {
                olderButton.disabled = bounds.start <= 0;
            }
            if (newerButton) {
                newerButton.disabled = bounds.start >= bounds.maxStart;
            }
        }

        buildHistoryOccurrenceMap(entries);
        renderIncidentMetroTimeline(windowEntries);
        list.innerHTML = windowEntries.map(function (entry) {
            var meta = [];

            if (entry.timeText) {
                meta.push('<span class="incident-drawer-timeline-time">'
                    + escapeHtml(entry.timeText)
                    + '</span>');
            }

            if (entry.durationText) {
                meta.push('<span class="incident-drawer-timeline-duration">'
                    + escapeHtml(getIncidentDrawerLabel('timeline-duration-label', 'Duration'))
                    + ': '
                    + escapeHtml(entry.durationText)
                    + '</span>');
            } else if (entry.occurrenceStart && entry.state === 'critical') {
                meta.push('<span class="incident-drawer-timeline-duration">'
                    + escapeHtml(getIncidentDrawerLabel('timeline-ongoing-label', 'Ongoing'))
                    + '</span>');
            }

            return '<li class="incident-drawer-timeline-entry">'
                + '<a href="'
                + escapeHtml(entry.url || '#')
                + '" data-base-target="_main">'
                + escapeHtml(entry.text)
                + '</a>'
                + (meta.length ? '<div class="incident-drawer-timeline-meta">'
                    + meta.join(' ')
                    + '</div>' : '')
                + '</li>';
        }).join('');
    }

    function shiftIncidentTimelineWindow(delta) {
        var entries = incidentDrawerState.timelineEntries || [];
        var maxStart = Math.max(0, entries.length - INCIDENT_TIMELINE_WINDOW_SIZE);

        if (! entries.length) {
            return;
        }

        incidentDrawerState.timelineWindowStart = Math.max(
            0,
            Math.min(maxStart, (incidentDrawerState.timelineWindowStart || 0) + delta)
        );
        renderIncidentTimelineWindow();
    }

    function setIncidentTimelineState(state, items) {
        var container = document.querySelector('[data-incident-timeline]');
        var list = document.querySelector('[data-incident-timeline-list]');
        var entries = items || [];
        var controls = document.querySelector('[data-incident-timeline-controls]');
        var rangeLabel = document.querySelector('[data-incident-timeline-range]');
        var olderButton = document.querySelector('[data-incident-timeline-older]');
        var newerButton = document.querySelector('[data-incident-timeline-newer]');

        if (! container || ! list) {
            return;
        }

        container.hidden = state === 'hidden';
        incidentDrawerState.timelineEntries = [];
        incidentDrawerState.timelineWindowStart = 0;

        if (state === 'loading') {
            if (controls) {
                controls.hidden = true;
            }
            if (rangeLabel) {
                rangeLabel.textContent = '';
            }
            if (olderButton) {
                olderButton.disabled = true;
            }
            if (newerButton) {
                newerButton.disabled = true;
            }
            list.innerHTML = '<li class="incident-drawer-timeline-muted">'
                + escapeHtml(getIncidentDrawerLabel('timeline-loading-label', 'Loading history...'))
                + '</li>';
            return;
        }

        if (! entries.length) {
            if (controls) {
                controls.hidden = true;
            }
            if (rangeLabel) {
                rangeLabel.textContent = '';
            }
            if (olderButton) {
                olderButton.disabled = true;
            }
            if (newerButton) {
                newerButton.disabled = true;
            }
            list.innerHTML = '<li class="incident-drawer-timeline-muted">'
                + escapeHtml(getIncidentDrawerLabel('timeline-empty-label', 'No recent history found.'))
                + '</li>';
            focusIncidentMetroTimelineWhenReady();
            return;
        }

        incidentDrawerState.timelineEntries = orderHistoryTimelineEntries(entries);
        incidentDrawerState.timelineWindowStart = Math.max(
            0,
            incidentDrawerState.timelineEntries.length - INCIDENT_TIMELINE_WINDOW_SIZE
        );
        renderIncidentTimelineWindow();
        focusIncidentMetroTimelineWhenReady();
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

        for (i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            var text = normalizeText(node.textContent || '');
            var link = node.querySelector('a[href]');
            var url = link ? normalizeIncidentUrl(link.getAttribute('href') || link.href || '') : historyUrl;
            var entryText;

            if (! text.length || text.length < 12 || seen[text]) {
                continue;
            }

            var timestamp = extractHistoryTimestamp(node, text);
            entryText = text.length > 180 ? text.slice(0, 180).replace(/\s+\S*$/, '') + '...' : text;
            seen[text] = true;
            items.push({
                text: entryText,
                url: url,
                state: getMetroStateFromText(entryText),
                timestamp: timestamp.date ? timestamp.date.getTime() : 0,
                timeText: timestamp.label || getMetroStationTime(entryText)
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

    function getIncidentAssignmentSection() {
        return document.querySelector('[data-incident-assignment-section]');
    }

    function getIncidentAssignmentApiUrl() {
        var drawer = getIncidentDrawer();

        return drawer ? (drawer.dataset.assignmentUrl || '') : '';
    }

    function getIncidentAssignmentSaveUrl() {
        var drawer = getIncidentDrawer();

        return drawer ? (drawer.dataset.assignmentSaveUrl || '') : '';
    }

    function getIncidentAssignmentSummaryUrl() {
        var drawer = getIncidentDrawer();

        return drawer ? (drawer.dataset.assignmentSummaryUrl || '') : '';
    }

    function getIncidentAssignmentLabel(name, fallback) {
        return getIncidentDrawerLabel(name, fallback);
    }

    function setIncidentAssignmentStatus(message, isError) {
        var status = document.querySelector('[data-incident-assignment-status]');

        if (status) {
            status.textContent = message || '';
            status.classList.toggle('error', !! isError);
        }
    }

    function getIncidentAssignmentObjectFromForm(form) {
        var object;
        var type;
        var hostName;
        var serviceName;

        if (form) {
            type = String(form.dataset.incidentAssignmentObjectType || '').trim();
            hostName = String(form.dataset.incidentAssignmentHostName || '').trim();
            serviceName = String(form.dataset.incidentAssignmentServiceName || '').trim();

            if (type === 'host' && hostName.length) {
                return {
                    type: 'host',
                    hostName: hostName,
                    serviceName: ''
                };
            }

            if (type === 'service' && hostName.length && serviceName.length) {
                return {
                    type: 'service',
                    hostName: hostName,
                    serviceName: serviceName
                };
            }
        }

        object = incidentDrawerState.object;
        if (object && object.type && object.hostName) {
            return {
                type: object.type,
                hostName: object.hostName,
                serviceName: object.type === 'service' ? object.serviceName : ''
            };
        }

        return null;
    }

    function renderIncidentAssignment() {
        var section = getIncidentAssignmentSection();
        var title = document.querySelector('[data-incident-assignment-title]');
        var assignee = document.querySelector('[data-incident-assignee]');
        var notePreview = document.querySelector('[data-incident-assignment-note-preview]');
        var form = document.querySelector('[data-incident-assignment-form]');
        var select = document.querySelector('[data-incident-assignee-select]');
        var note = document.querySelector('[data-incident-assignment-note]');
        var save = document.querySelector('[data-save-incident-assignment]');
        var assignment = incidentDrawerState.assignment || null;
        var cachedDetails = incidentDrawerState.object ? getIncidentAssignmentDetailsCache(incidentDrawerState.object) : null;
        var cachedNote = incidentDrawerState.object ? getIncidentAssignmentNoteCache(incidentDrawerState.object) : '';
        var canAssign = !! (assignment && assignment.canAssign);
        var users = assignment && Array.isArray(assignment.users) ? assignment.users : [];
        var currentAssignee = assignment && assignment.assignment
            ? String(assignment.assignment.assignee || '')
            : (cachedDetails && cachedDetails.assignment
                ? String(cachedDetails.assignment.assignee || '')
                : getIncidentAssignmentCache(incidentDrawerState.object));
        var currentNote = assignment && assignment.assignment
            ? String(assignment.assignment.note || '')
            : (cachedDetails && cachedDetails.assignment
                ? String(cachedDetails.assignment.note || '')
                : cachedNote);
        if (! currentNote.trim().length) {
            currentNote = cachedNote;
        }
        var statusMessage = assignment && assignment.statusMessage ? String(assignment.statusMessage) : '';
        var statusError = !! (assignment && assignment.statusError);

        if (! section || ! assignee || ! form || ! select || ! note) {
            return;
        }

        section.hidden = ! incidentDrawerState.object;
        form.dataset.incidentAssignmentObjectType = incidentDrawerState.object ? incidentDrawerState.object.type : '';
        form.dataset.incidentAssignmentHostName = incidentDrawerState.object ? incidentDrawerState.object.hostName : '';
        form.dataset.incidentAssignmentServiceName = incidentDrawerState.object && incidentDrawerState.object.type === 'service'
            ? incidentDrawerState.object.serviceName
            : '';
        form.querySelector('input[name="object_type"]').value = incidentDrawerState.object ? incidentDrawerState.object.type : '';
        form.querySelector('input[name="object_host_name"]').value = incidentDrawerState.object ? incidentDrawerState.object.hostName : '';
        form.querySelector('input[name="object_service_name"]').value = incidentDrawerState.object && incidentDrawerState.object.type === 'service'
            ? incidentDrawerState.object.serviceName
            : '';

        if (! incidentDrawerState.object) {
            setIncidentAssignmentStatus('');
            return;
        }

        if (title) {
            title.textContent = getIncidentDrawerLabel(
                'assignment-drawer-title-label',
                'Critical assignment'
            );
        }

        form.hidden = false;
        assignee.textContent = currentAssignee.length
            ? getIncidentAssignmentLabel('assignee-label', 'Assignee') + ': ' + currentAssignee
            : getIncidentAssignmentLabel('no-assignee-label', 'Unassigned');
        if (notePreview) {
            if (currentNote.trim().length) {
                notePreview.hidden = false;
                notePreview.textContent = getIncidentAssignmentLabel(
                    'assignment-note-label',
                    'Note'
                ) + ': ' + currentNote;
            } else {
                notePreview.hidden = true;
                notePreview.textContent = '';
            }
        }
        note.value = currentNote;
        note.placeholder = getIncidentAssignmentLabel(
            'assignment-note-placeholder',
            'Optional note for the assigned user'
        );

        if (save) {
            save.textContent = getIncidentAssignmentLabel('assignment-save-label', 'Save assignee');
            save.disabled = ! canAssign;
        }

        if (canAssign) {
            var options = ['<option value="">'
                + escapeHtml(getIncidentAssignmentLabel('assignment-placeholder-label', 'Choose a registered user'))
                + '</option>'];

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

            select.innerHTML = options.join('');
            select.disabled = false;

            if (save) {
                save.disabled = ! users.length;
            }

            if (! users.length && ! statusMessage.length) {
                statusMessage = getIncidentAssignmentLabel(
                    'assignment-no-users-label',
                    'No registered users are available for assignment.'
                );
            }
        } else {
            select.innerHTML = '<option value="' + escapeHtml(currentAssignee) + '">'
                + escapeHtml(currentAssignee.length
                    ? currentAssignee
                    : getIncidentAssignmentLabel('no-assignee-label', 'Unassigned'))
                + '</option>';
            select.disabled = true;
            if (save) {
                save.disabled = true;
            }

            if (! statusMessage.length) {
                statusMessage = getIncidentAssignmentLabel(
                    'assignment-no-permission-label',
                    'You need the "application/critical-assignments" permission in your role to assign incidents.'
                );
            }
        }

        note.disabled = ! canAssign;

        setIncidentAssignmentStatus(statusMessage, statusError);

        if (incidentDrawerState.focusAssignment && canAssign && select && ! select.disabled) {
            incidentDrawerState.focusAssignment = false;
            window.setTimeout(function () {
                if (select && typeof select.focus === 'function') {
                    select.focus();
                }
            }, 0);
        }
    }

    function loadIncidentAssignment(object) {
        var url = getIncidentAssignmentApiUrl();
        var params;
        var signature = getIcingadbObjectSignature(object);
        var cachedDetails = getIncidentAssignmentDetailsCache(object);
        var requestId;

        if (! object || ! url.length || typeof window.fetch !== 'function') {
            incidentDrawerState.assignment = null;
            renderIncidentAssignment();
            return;
        }

        params = new URLSearchParams();
        params.set('type', object.type);
        params.set('host.name', object.hostName);
        if (object.type === 'service') {
            params.set('service.name', object.serviceName);
        }

        incidentDrawerState.assignment = {
            loading: true,
            assignment: cachedDetails && cachedDetails.assignment ? {
                assignee: String(cachedDetails.assignment.assignee || ''),
                assignedBy: String(cachedDetails.assignment.assignedBy || ''),
                assignedAt: String(cachedDetails.assignment.assignedAt || ''),
                note: String(cachedDetails.assignment.note || '')
            } : null,
            canAssign: false,
            users: cachedDetails && Array.isArray(cachedDetails.users) ? cachedDetails.users.slice() : [],
            objectSignature: signature,
            requestId: 0,
            statusMessage: getIncidentAssignmentLabel('assignment-loading-label', 'Loading assignee...'),
            statusError: false
        };
        requestId = ++incidentAssignmentRequestCounter;
        incidentDrawerState.assignment.requestId = requestId;
        setIncidentAssignmentFetchState(object, true, false);
        renderIncidentAssignment();

        window.fetch(url + '?' + params.toString(), {
            credentials: 'same-origin',
            cache: 'no-store'
        })
            .then(function (response) {
                if (! response.ok) {
                    throw new Error('Unable to load incident assignment');
                }

                return response.json();
            })
            .then(function (payload) {
                incidentAssignmentCsrfToken = payload && payload.csrfToken
                    ? String(payload.csrfToken)
                    : incidentAssignmentCsrfToken;
                if (! incidentDrawerState.assignment
                    || incidentDrawerState.assignment.objectSignature !== signature
                    || incidentDrawerState.assignment.requestId !== requestId
                ) {
                    return;
                }

                incidentDrawerState.assignment = {
                    loading: false,
                    assignment: payload ? payload.assignment : null,
                    canAssign: !! (payload && payload.canAssign),
                    users: payload && Array.isArray(payload.users) ? payload.users : [],
                    objectSignature: signature,
                    requestId: requestId,
                    statusMessage: '',
                    statusError: false
                };
                setIncidentAssignmentCache(
                    object,
                    payload && payload.assignment ? payload.assignment.assignee : ''
                );
                setIncidentAssignmentDetailsCache(object, payload || null);
                rerenderCachedTopEvents();
                renderIncidentAssignment();
            })
            .catch(function (error) {
                if (! incidentDrawerState.assignment
                    || incidentDrawerState.assignment.objectSignature !== signature
                    || incidentDrawerState.assignment.requestId !== requestId
                ) {
                    return;
                }

                incidentDrawerState.assignment = cachedDetails && cachedDetails.assignment ? {
                    loading: false,
                    assignment: {
                        assignee: String(cachedDetails.assignment.assignee || ''),
                        assignedBy: String(cachedDetails.assignment.assignedBy || ''),
                        assignedAt: String(cachedDetails.assignment.assignedAt || ''),
                        note: String(cachedDetails.assignment.note || '')
                    },
                    canAssign: !! cachedDetails.canAssign,
                    users: Array.isArray(cachedDetails.users) ? cachedDetails.users.slice() : [],
                    objectSignature: signature,
                    requestId: requestId,
                    statusMessage: String(error && error.message ? error.message : 'Unable to load assignee.'),
                    statusError: true
                } : {
                    loading: false,
                    assignment: null,
                    canAssign: false,
                    users: [],
                    objectSignature: signature,
                    requestId: requestId,
                    statusMessage: String(error && error.message ? error.message : 'Unable to load assignee.'),
                    statusError: true
                };
                renderIncidentAssignment();
            });
    }

    function prefetchIncidentAssignment(object) {
        var url = getIncidentAssignmentApiUrl();
        var params;

        if (! object || ! url.length || typeof window.fetch !== 'function') {
            return;
        }

        if (isIncidentAssignmentLoaded(object) || isIncidentAssignmentLoading(object)) {
            return;
        }

        setIncidentAssignmentFetchState(object, true, false);

        params = new URLSearchParams();
        params.set('type', object.type);
        params.set('host.name', object.hostName);
        if (object.type === 'service') {
            params.set('service.name', object.serviceName);
        }
        params.set('_', String(Date.now()));
        params.set('include_users', '0');

        window.fetch(url + '?' + params.toString(), {
            credentials: 'same-origin',
            cache: 'no-store'
        })
            .then(function (response) {
                if (! response.ok) {
                    throw new Error('Unable to load incident assignment');
                }

                return response.json();
            })
            .then(function (payload) {
                incidentAssignmentCsrfToken = payload && payload.csrfToken
                    ? String(payload.csrfToken)
                    : incidentAssignmentCsrfToken;
                if (payload && payload.assignment) {
                    setIncidentAssignmentCache(object, payload.assignment.assignee);
                } else {
                    setIncidentAssignmentCache(object, '');
                }
                setIncidentAssignmentDetailsCache(object, payload || null);

                setIncidentAssignmentFetchState(object, false, true);
                rerenderCachedTopEvents();
            })
            .catch(function () {
                if (! getIncidentAssignmentDetailsCache(object)) {
                    clearIncidentAssignmentCaches(object);
                }
            });
    }

    function renderIcingadbObjectAssignmentLabels(root) {
        var scope = root || document;
        var blocks = scope.querySelectorAll(
            '.header-item-layout.host, .header-item-layout.service, .item-layout.host, .item-layout.service'
        );
        var pageObject = getIcingadbObjectFromUrl(window.location.href);
        var detailRoot = getIcingadbDetailContainer();
        var i;

        if (pageObject && detailRoot && detailRoot.querySelector('.object-detail')) {
            renderIcingadbObjectAssignmentBanner(pageObject);
            return;
        }

        for (i = 0; i < blocks.length; i++) {
            var block = blocks[i];
            var info = block.querySelector('.extended-info');
            var label = info ? info.querySelector('[data-object-assignee]') : null;
            var object = findIcingadbObjectInNode(block);
            var assignee = object ? getIncidentAssignmentCache(object) : '';
            var assignmentDetails = object ? getIncidentAssignmentDetailsCache(object) : null;
            var note = assignmentDetails && assignmentDetails.assignment
                ? String(assignmentDetails.assignment.note || '')
                : getIncidentAssignmentNoteCache(object);
            var objectState = getIcingadbObjectStateFromNode(block);
            var text = '';

            if (! info || ! object) {
                continue;
            }

            if (! assignee.length && ! isIncidentAssignmentLoaded(object) && ! isIncidentAssignmentLoading(object)) {
                prefetchIncidentAssignment(object);
            }

            if (isIncidentAssignmentLoading(object)) {
                text = getIncidentAssignmentLabel('assignment-loading-label', 'Loading assignee...');
            } else if (assignee.length) {
                text = getIncidentAssignmentLabel('assignee-label', 'Assignee') + ': ' + assignee;
            } else if (objectState === 'critical') {
                text = getIncidentAssignmentLabel('no-assignee-label', 'Unassigned');
            } else {
                if (label) {
                    label.remove();
                }
                continue;
            }

            if (! label) {
                label = document.createElement('span');
                label.setAttribute('data-object-assignee', '');
                label.className = 'object-assignee';
                info.appendChild(label);
            }

            if (note.trim().length) {
                text += ' · ' + getIncidentAssignmentLabel('assignment-note-label', 'Note') + ': ' + note;
            }
            label.textContent = text;
            label.classList.toggle('assigned', !! assignee.length);
            label.classList.toggle('unassigned', ! assignee.length);
            label.classList.toggle('loading', isIncidentAssignmentLoading(object));
            label.classList.toggle('has-note', note.trim().length > 0);
        }
    }

    function submitIncidentAssignment(object, assignee, note) {
        var url = getIncidentAssignmentSaveUrl();
        var params;

        if (! object || ! url.length || typeof window.fetch !== 'function') {
            return null;
        }

        params = new URLSearchParams();
        params.set('type', object.type);
        params.set('object_type', object.type);
        params.set('host.name', object.hostName);
        params.set('host_name', object.hostName);
        params.set('object_host_name', object.hostName);
        if (object.type === 'service') {
            params.set('service.name', object.serviceName);
            params.set('service_name', object.serviceName);
            params.set('object_service_name', object.serviceName);
        }
        params.set('object', JSON.stringify(object));
        params.set('assignee', String(assignee || ''));
        if (typeof note === 'string') {
            params.set('note', note);
        }
        params.set('CSRFToken', incidentAssignmentCsrfToken);

        return window.fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-Token': incidentAssignmentCsrfToken
            },
            body: params.toString()
        })
            .then(function (response) {
                return response.text().then(function (text) {
                    var payload;

                    try {
                        payload = text.length ? JSON.parse(text) : {};
                    } catch (error) {
                        payload = {};
                    }

                    if (! response.ok) {
                        throw new Error(payload && payload.error ? payload.error : 'Unable to save incident assignment');
                    }

                    incidentAssignmentCsrfToken = payload && payload.csrfToken
                        ? String(payload.csrfToken)
                        : incidentAssignmentCsrfToken;

                    return payload;
                });
            });
    }

    function saveIncidentAssignmentFromDom() {
        var form = document.querySelector('[data-incident-assignment-form]');
        var select = document.querySelector('[data-incident-assignee-select]');
        var note = document.querySelector('[data-incident-assignment-note]');
        var object = getIncidentAssignmentObjectFromForm(form);
        var signature = getIcingadbObjectSignature(object);
        var requestId;
        var selectedAssignee;
        var selectedNote;

        if (! object || ! select || ! note) {
            return;
        }

        selectedAssignee = String(select.value || '').trim();
        selectedNote = String(note.value || '');
        setIncidentAssignmentStatus(getIncidentAssignmentLabel('assignment-loading-label', 'Loading assignee...'));
        requestId = ++incidentAssignmentRequestCounter;
        if (incidentDrawerState.assignment) {
            incidentDrawerState.assignment.requestId = requestId;
        }

        var request = submitIncidentAssignment(object, select.value, selectedNote);

        if (! request) {
            return;
        }

        request
            .then(function (payload) {
                if (! incidentDrawerState.assignment
                    || incidentDrawerState.assignment.objectSignature !== signature
                    || incidentDrawerState.assignment.requestId !== requestId
                ) {
                    return;
                }

                incidentDrawerState.assignment = {
                    loading: false,
                    assignment: payload && payload.assignment ? {
                        assignee: String(payload.assignment.assignee || ''),
                        assignedBy: String(payload.assignment.assignedBy || ''),
                        assignedAt: String(payload.assignment.assignedAt || ''),
                        note: String(payload.assignment.note || selectedNote || '')
                    } : (selectedAssignee.length
                        ? {
                            assignee: selectedAssignee,
                            assignedBy: '',
                            assignedAt: '',
                            note: selectedNote
                        }
                        : null),
                    canAssign: !! (payload && payload.canAssign),
                    users: payload && Array.isArray(payload.users) ? payload.users : [],
                    objectSignature: signature,
                    requestId: requestId,
                    statusMessage: getIncidentAssignmentLabel('assignment-saved-label', 'Assignee saved'),
                    statusError: false
                };
                setIncidentAssignmentNoteCache(object, selectedNote);
                setIncidentAssignmentCache(
                    object,
                    payload && payload.assignment
                        ? payload.assignment.assignee
                        : selectedAssignee
                );
                setIncidentAssignmentDetailsCache(object, payload || null);
                rerenderCachedTopEvents();
                renderIncidentAssignment();
            })
            .catch(function (error) {
                if (! incidentDrawerState.assignment
                    || incidentDrawerState.assignment.objectSignature !== signature
                    || incidentDrawerState.assignment.requestId !== requestId
                ) {
                    return;
                }

                incidentDrawerState.assignment.statusMessage = String(
                    error && error.message ? error.message : 'Unable to save assignee.'
                );
                incidentDrawerState.assignment.statusError = true;
                renderIncidentAssignment();
            });
    }

    function saveTopEventAssignmentFromDom(form) {
        var select = form ? form.querySelector('[data-top-event-assignee-select]') : null;
        var object;
        var signature;
        var selectedAssignee;

        if (! form || ! select) {
            return;
        }

        object = {
            type: String(form.dataset.assignmentObjectType || ''),
            hostName: String(form.dataset.assignmentHostName || ''),
            serviceName: String(form.dataset.assignmentServiceName || '')
        };
        if (! object.serviceName.length) {
            object.serviceName = null;
        }
        signature = getIcingadbObjectSignature(object);
        selectedAssignee = String(select.value || '').trim();

        form.classList.add('is-saving');
        var request = submitIncidentAssignment(object, select.value);

        if (! request) {
            form.classList.remove('is-saving');
            return;
        }

        request
            .then(function (payload) {
                setIncidentAssignmentCache(
                    object,
                    payload && payload.assignment
                        ? payload.assignment.assignee
                        : selectedAssignee
                );
                setIncidentAssignmentDetailsCache(object, payload || null);
                rerenderCachedTopEvents();
                showOperatorToast(getIncidentAssignmentLabel('assignment-saved-label', 'Assignee saved'));

                if (incidentDrawerState.assignment
                    && incidentDrawerState.assignment.objectSignature === signature
                ) {
                    incidentDrawerState.assignment = {
                        loading: false,
                        assignment: payload && payload.assignment ? {
                            assignee: String(payload.assignment.assignee || ''),
                            assignedBy: String(payload.assignment.assignedBy || ''),
                            assignedAt: String(payload.assignment.assignedAt || ''),
                            note: String(payload.assignment.note || '')
                        } : (selectedAssignee.length
                            ? {
                                assignee: selectedAssignee,
                                assignedBy: '',
                                assignedAt: ''
                            }
                            : null),
                        canAssign: !! (payload && payload.canAssign),
                        users: payload && Array.isArray(payload.users) ? payload.users : [],
                        objectSignature: signature,
                        statusMessage: getIncidentAssignmentLabel('assignment-saved-label', 'Assignee saved'),
                        statusError: false
                    };
                    setIncidentAssignmentNoteCache(object, selectedNote);
                    renderIncidentAssignment();
                }
            })
            .catch(function () {
                showOperatorToast(getIncidentAssignmentLabel(
                    'assignment-error-label',
                    'Unable to save assignee.'
                ), 'error');
            })
            .then(function () {
                form.classList.remove('is-saving');
            });
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
                var currentObjectSignature = getIcingadbObjectSignature(incidentDrawerState.object);
                var parsedObjectSignature = parsed.object ? getIcingadbObjectSignature(parsed.object) : '';

                if (url !== incidentDrawerState.url) {
                    return;
                }

                if (parsed.object && (! currentObjectSignature.length || currentObjectSignature === parsedObjectSignature)) {
                    incidentDrawerState.object = parsed.object;
                    setIncidentQuickActions(parsed.object);
                    setIncidentObjectContext(parsed.object);
                    loadIncidentTimeline(parsed.object);
                    if (! incidentDrawerState.assignment
                        || incidentDrawerState.assignment.objectSignature !== getIcingadbObjectSignature(parsed.object)
                    ) {
                        loadIncidentAssignment(parsed.object);
                    }
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
        var object = eventData.object || getIcingadbObjectFromUrl(normalizeIncidentUrl(eventData.url || ''));

        if (! object) {
            return false;
        }

        return openAssignmentDrawerForObject(
            object,
            normalizeIncidentUrl(eventData.url || ''),
            true,
            !! focusTimeline
        );
    }

    function openIncidentDrawerFromLink(link) {
        var item = link ? link.closest('.top-event-item') : null;
        var object = item ? getIcingadbObjectFromNode(item) : null;
        var url = normalizeIncidentUrl(link ? (link.getAttribute('href') || link.href || '') : '');

        if (! link || ! item) {
            return false;
        }

        if (! object) {
            object = getIcingadbObjectFromUrl(item.getAttribute('data-event-url') || url);
        }

        if (! object) {
            object = findIcingadbObjectInNode(item);
        }

        item.classList.add('top-event-seen');

        return openAssignmentDrawerForObject(
            object,
            item.getAttribute('data-event-url') || '',
            true,
            false
        );
    }

    function openAssignmentDrawerForObject(object, sourceUrl, focusAssignment, focusTimeline) {
        var url = buildIcingadbObjectUrl(object);
        var drawer = getIncidentDrawer();
        var title = drawer ? drawer.querySelector('#incident-drawer-title') : null;
        var meta = drawer ? drawer.querySelector('[data-incident-meta]') : null;
        var open = drawer ? drawer.querySelector('[data-incident-open]') : null;
        var drawerTitle = getIncidentDrawerLabel('assignment-drawer-title-label', 'Critical assignment');
        var drawerMeta = getIcingadbObjectDisplayName(object);
        var contextUrl = normalizeIncidentUrl(sourceUrl || '');
        var activityUrl = contextUrl || url;

        if (! drawer || ! object || ! url.length) {
            return false;
        }

        incidentDrawerState.url = activityUrl;
        incidentDrawerState.focusTimeline = !! focusTimeline;
        incidentDrawerState.focusAssignment = !! focusAssignment || ! contextUrl.length;
        incidentDrawerState.object = object;
        incidentDrawerState.assignment = null;
        lastFocusedElement = document.activeElement;

        if (contextUrl.length) {
            markIncidentSeen(contextUrl);
            refreshSeenTopEventStates();
            if (isTriageModeEnabled()) {
                rerenderCachedTopEvents();
            }
        }

        clearIncidentAssignmentCaches(object);
        rememberRecentIncident({
            title: drawerTitle,
            meta: drawerMeta,
            url: activityUrl
        });
        recordOperatorActivity('Assignment', 'Opened assignment drawer', drawerMeta, activityUrl);

        if (title) {
            title.textContent = drawerTitle;
        }

        if (meta) {
            meta.textContent = drawerMeta;
            meta.hidden = ! drawerMeta.length;
        }

        if (open) {
            open.href = url || '#';
            open.textContent = getIncidentDrawerLabel('assignment-open-label', 'Open object');
            open.hidden = ! url.length;
        }

        drawer.hidden = false;
        drawer.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        renderIncidentAssignment();
        setIncidentQuickActions(object);
        setIncidentObjectContext(object);
        loadIncidentTimeline(object);
        loadIncidentAssignment(object);

        if (open && ! open.hidden) {
            open.focus();
        }

        return true;
    }

    function openAssignmentDrawerFromLink(link) {
        var object = link ? getIcingadbObjectFromUrl(link.getAttribute('href') || link.href || '') : null;

        return openAssignmentDrawerForObject(
            object,
            normalizeIncidentUrl(link ? (link.getAttribute('href') || link.href || '') : ''),
            true,
            false
        );
    }

    function openIncidentDrawerForAssignment(link) {
        if (! openIncidentDrawerFromLink(link)) {
            return false;
        }

        incidentDrawerState.focusAssignment = true;
        renderIncidentAssignment();
        return true;
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
        if (object) {
            event.object = object;
        }

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
        incidentDrawerState.focusAssignment = false;
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

        if (snapshot.assignee.length) {
            lines.push('Assignee: ' + snapshot.assignee);
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
        var assignment = incidentDrawerState.assignment && incidentDrawerState.assignment.assignment
            ? incidentDrawerState.assignment.assignment
            : null;
        var cachedAssignee = getIncidentAssignmentCache(incidentDrawerState.object);

        return {
            title: title ? normalizeText(title.textContent || '') : '',
            meta: meta && ! meta.hidden ? normalizeText(meta.textContent || '') : '',
            url: incidentDrawerState.url,
            assignee: assignment ? normalizeText(assignment.assignee || '') : normalizeText(cachedAssignee || '')
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
