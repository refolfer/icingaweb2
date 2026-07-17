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
            element: element || null,
            badge: '',
            badgeClass: '',
            pending: false
        };
    }

    function dedupeCommandPaletteCommands(commands) {
        var seen = {};

        return commands.filter(function (command) {
            var key = normalizeText(command.label).toLowerCase() + '|' + normalizeText(command.value).toLowerCase();

            if (! key.length) {
                return true;
            }

            if (seen[key]) {
                return false;
            }

            seen[key] = true;
            return true;
        });
    }


    function getStaticCommands() {
        var navigation = getCommandPaletteLabel('navigation-label', 'Navigation');
        var actions = getCommandPaletteLabel('actions-label', 'Actions');
        var commands = [];

        commands.push(makeCommand('shortcut', 'Keyboard Shortcuts', actions, 'Show available keyboard shortcuts', 'shortcuts'));
        commands.push(makeCommand(
                'triageMode',
                isTriageModeEnabled() ? 'Disable Triage Mode' : 'Enable Triage Mode',
                actions,
                'Filter latest events to unresolved unseen problems',
                isTriageModeEnabled() ? 'off' : 'on'
        ));

        if (getActiveTriageEvents().length) {
            commands.push(makeCommand('triageDesk', 'Triage Desk', actions, 'Open the active triage queue workspace', ''));
        }

        commands.push(makeCommand('operatorHandoff', 'Operator Handoff', actions, 'Generate a shift handoff report', ''));

        if (readOperatorActivity().length) {
            commands.push(makeCommand('operatorActivity', 'Audit Timeline', actions, 'Review filtered operator audit events', ''));
            commands.push(makeCommand('copyOperatorAuditTimeline', 'Copy Audit Timeline', actions, 'Copy the filtered operator audit timeline', ''));
        }

        if (getOperatorPlaybookEvent()) {
            commands.push(makeCommand('operatorPlaybook', 'Operator Playbook', actions, 'Open recommended actions for the focus event', ''));
            commands.push(makeCommand('copyOperatorPlaybook', 'Copy Operator Playbook', actions, 'Copy recommended actions for the focus event', ''));
        }

        commands.push(makeCommand('density', 'Density: Comfortable', actions, 'Use the default balanced layout density', 'comfortable'));

        return commands;
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
            me: 'Open assigned to me incidents',
            assigned: 'Open assigned incidents',
            unassigned: 'Open unassigned incidents'
        };

        return Object.keys(labels).filter(function (lane) {
            return lanes[lane] && lanes[lane].length;
        }).map(function (lane) {
            var item = lanes[lane][0];

            return makeCommand(
                'operatorDecisionLane',
                labels[lane],
                'Decision Matrix',
                getOperatorDecisionLaneTitle(item, lane),
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
                serviceName: '',
                explicit: true
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
                serviceName: match[1].trim(),
                explicit: true
            };
        }

        match = text.match(/^(.+?)!(.+)$/);
        if (match && match[1].trim().length && match[2].trim().length) {
            return {
                type: 'service',
                hostName: match[1].trim(),
                serviceName: match[2].trim(),
                explicit: true
            };
        }

        if (/^host\s+/i.test(text)) {
            text = text.replace(/^host\s+/i, '').trim();
        }

        if (text.length && text.indexOf(' ') === -1 && text.indexOf(':') === -1) {
            return {
                type: 'host',
                hostName: text,
                serviceName: '',
                explicit: false
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

        if (parsed.action && ! object.explicit) {
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
        var object = getIcingadbObjectFromDetailContainer(getIcingadbDetailContainer())
            || getIcingadbObjectFromUrl(window.location.href);
        var category = 'Current Object';
        var actions = [
            ['Open object', buildIcingadbObjectUrl(object), 'Open the current IcingaDB object'],
            ['History', buildIcingadbContextUrls(object).history, 'Open object history'],
            ['Comments', buildIcingadbContextUrls(object).comments, 'Open object comments'],
            ['Downtimes', buildIcingadbContextUrls(object).downtimes, 'Open object downtimes'],
            ['Assign', buildIcingadbObjectUrl(object), 'Open the assignee selection for this object'],
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
            var type = entry[0] === 'Assign' ? 'assignObject' : 'navigateAbsolute';

            return makeCommand(
                type,
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
        var trimmedQuery = (query || '').trim();
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

        commands = dedupeCommandPaletteCommands(commands);
        commands = commands.filter(function (command) {
            return commandMatches(command, normalizedQuery);
        }).sort(function (a, b) {
            var scoreDiff = scoreCommand(a, normalizedQuery) - scoreCommand(b, normalizedQuery);

            if (scoreDiff !== 0) {
                return scoreDiff;
            }

            return a.label.localeCompare(b.label);
        });

        if (trimmedQuery.length) {
            commands.unshift(makeCommand(
                'search',
                searchLabel + ' "' + trimmedQuery + '"',
                getCommandPaletteLabel('actions-label', 'Actions'),
                'Run global search',
                trimmedQuery
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
                + '<button type="button" role="option" data-command-index="' + String(index) + '"'
                + (command.pending ? ' data-command-pending="y" aria-disabled="true"' : '')
                + '>'
                + '<span class="command-palette-command-main">'
                + '<strong>'
                + escapeHtml(command.label)
                + (command.badge ? '<span class="command-palette-badge ' + escapeHtml(command.badgeClass || 'command-palette-badge--ai') + '">' + escapeHtml(command.badge) + '</span>' : '')
                + '</strong>'
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

        if (command.type === 'assignObject') {
            recordOperatorActivity('Object', 'Opened object assignment', command.label, command.value);
            openAssignmentDrawerForObject(getIcingadbObjectFromUrl(command.value));
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

        if (form.matches('[data-top-event-assignment-form]')) {
            event.preventDefault();
            saveTopEventAssignmentFromDom(form);
            return;
        }

        if (form.matches('[data-incident-assignment-form]')) {
            event.preventDefault();
            saveIncidentAssignmentFromDom();
            return;
        }

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
