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
        body.set('CSRFToken', quickMenuState.csrfToken);

        fetch(quickMenuState.apiUrl, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-CSRF-Token': quickMenuState.csrfToken
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
                quickMenuState.csrfToken = String(result.csrfToken || quickMenuState.csrfToken);
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
        var assignLabel;
        var tabLabel;
        var windowLabel;

        if (existing) {
            return existing;
        }

        root = getQuickMenuRoot();
        addLabel = root ? (root.dataset.contextAddLabel || 'Add To Quick Menu') : 'Add To Quick Menu';
        assignLabel = root ? (root.dataset.contextAssignLabel || 'Assign') : 'Assign';
        tabLabel = root ? (root.dataset.contextOpenTabLabel || 'Open In New Tab') : 'Open In New Tab';
        windowLabel = root ? (root.dataset.contextOpenWindowLabel || 'Open In New Window') : 'Open In New Window';

        existing = document.createElement('div');
        existing.className = 'quick-menu-context';
        existing.setAttribute('data-quick-menu-context', '');
        existing.hidden = true;
        existing.innerHTML = ''
            + '<button type="button" data-qm-add-link>' + escapeHtml(addLabel) + '</button>'
            + '<button type="button" data-qm-assign-object>' + escapeHtml(assignLabel) + '</button>'
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
        quickMenuContextState.object = null;
    }

    function showQuickMenuContextMenu(x, y, anchor) {
        var menu = getQuickMenuContextMenu();
        var maxLeft;
        var maxTop;
        var object = getIcingadbObjectFromUrl(anchor ? (anchor.getAttribute('href') || anchor.href || '') : '');
        var assignButton = menu.querySelector('[data-qm-assign-object]');

        quickMenuContextState.anchor = anchor;
        quickMenuContextState.object = object;
        if (assignButton) {
            assignButton.hidden = ! object;
        }

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
        var object = quickMenuContextState.object;
        var features;

        if (target === 'assign') {
            if (! object) {
                hideQuickMenuContextMenu();
                return;
            }

            openAssignmentDrawerForObject(object);
            hideQuickMenuContextMenu();
            return;
        }

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
        quickMenuState.csrfToken = root.dataset.csrfToken || quickMenuState.csrfToken;
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
        var incidentTimelineOlderButton = event.target.closest('[data-incident-timeline-older]');
        var incidentTimelineNewerButton = event.target.closest('[data-incident-timeline-newer]');
        var openIncidentAssignmentButton = event.target.closest('[data-open-incident-assignment]');
        var objectAssignmentButton = event.target.closest('[data-object-assignment-action]');
        var quickMenuAssignButton = event.target.closest('[data-qm-assign-object]');
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

        if (incidentTimelineOlderButton) {
            event.preventDefault();
            shiftIncidentTimelineWindow(-INCIDENT_TIMELINE_WINDOW_SIZE);
            return;
        }

        if (incidentTimelineNewerButton) {
            event.preventDefault();
            shiftIncidentTimelineWindow(INCIDENT_TIMELINE_WINDOW_SIZE);
            return;
        }

        if (quickMenuAssignButton) {
            event.preventDefault();
            openQuickMenuContextAnchor('assign');
            return;
        }

        if (objectAssignmentButton) {
            var currentObject = getIcingadbObjectFromDetailContainer(getIcingadbDetailContainer())
                || getIcingadbObjectFromUrl(window.location.href)
                || findIcingadbObjectInDocument(document);

            event.preventDefault();
            if (currentObject) {
                openAssignmentDrawerForObject(currentObject);
            }
            return;
        }

        if (openIncidentAssignmentButton) {
            var topEventItem = openIncidentAssignmentButton.closest('.top-event-item');

            event.preventDefault();
            if (topEventItem) {
                openIncidentDrawerForAssignment(topEventItem.querySelector('.top-event-link'));
            }
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
        startTacticalOverviewPolling();
        initTopWidgetResizers();
        initTopPanelsWidthResizer();
        initIncidentDrawerWidthResizer();
        renderIcingadbObjectAssignmentLabels();
        refreshOperatorDecisionAssignments();
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
            refreshOperatorDecisionAssignments();
        });
        window.jQuery(document).on('rendered', '#col1', function () {
            updateQuickNotebookVisibility();
            initIncidentDrawerWidthResizer();
            renderIcingadbObjectAssignmentLabels();
            renderEventDetailMetroTimeline();
        });
        window.jQuery(document).on('rendered', '#col2', function () {
            renderIcingadbObjectAssignmentLabels();
        });
    }

    document.addEventListener('visibilitychange', function () {
        if (! document.hidden) {
            refreshTacticalOverview(true);
            refreshTopEvents(true);
        }
    });

    renderRecentSearches();
    initQuickMenu();
    initQuickNotebook();
    refreshTacticalOverview(true);
    initIncidentDrawerWidthResizer();
    renderIcingadbObjectAssignmentLabels();
    renderEventDetailMetroTimeline();
})();
