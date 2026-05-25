// SPDX-FileCopyrightText: 2026
// SPDX-License-Identifier: GPL-3.0-or-later

;(function(Icinga, $) {
    'use strict';

    Icinga.Behaviors = Icinga.Behaviors || {};

    var MIN_WIDTH = 260;
    var MIN_HEIGHT = 180;
    var DASHBOARD_PADDING = 16;
    var MIN_FLOATING_WIDTH = 760;

    var FloatingDashlets = function(icinga) {
        Icinga.EventListener.call(this, icinga);

        this.storage = this.createStorage();
        this.storageKey = 'layout-v1';
        this.viewModeKey = 'view-mode-v1';
        this.hiddenTabsKey = 'hidden-tabs-v1';

        this.dragState = null;
        this.resizeState = null;
        this.zCounter = 10;

        this.on('rendered', '.container', this.onRendered, this);
        this.on('rendered', '.dashboard.floating-dashlets', this.onRendered, this);
        this.on('rendered', '#layout', this.onRendered, this);
        this.on('layout-change', this.onLayoutChange, this);
        this.on('mousedown', '.dashboard.floating-dashlets.floating-dashlets-active > .container > h1', this.onDragStart, this);
        this.on('mousedown', '.dashboard.floating-dashlets.floating-dashlets-active > .container .dashlet-resize-handle', this.onResizeStart, this);
        this.on('click', '.dashboard.floating-dashlets.floating-dashlets-active > .container > h1 a', this.onTitleClick, this);
        this.on('click', '.js-reset-dashlet-layout', this.onResetLayoutClick, this);
        this.on('click', '.js-toggle-dashlet-view', this.onToggleViewClick, this);
        this.on('click', '.js-dashboard-visibility-toggle', this.onDashboardVisibilityToggle, this);
        this.on('change', '.js-dashboard-visibility-list input[type="checkbox"]', this.onDashboardVisibilityChange, this);

        this.scheduleSetupPasses();
        this.bindVisibilityPanelDismissHandlers();
    };

    $.extend(FloatingDashlets.prototype, new Icinga.EventListener(), {
        createStorage: function() {
            var noopStorage = {
                get: function() { return {}; },
                set: function() {}
            };

            if (! Icinga.Storage || typeof Icinga.Storage.BehaviorStorage !== 'function') {
                return noopStorage;
            }

            try {
                var storage = Icinga.Storage.BehaviorStorage('floating-dashlets');
                storage.get('layout-v1');
                return storage;
            } catch (error) {
                if (window.console && typeof window.console.warn === 'function') {
                    window.console.warn('Floating dashlets: localStorage unavailable, layout persistence disabled.', error);
                }

                return noopStorage;
            }
        },

        scheduleSetupPasses: function() {
            var _this = this;
            // Dashlet content is loaded asynchronously; run a second pass after initial hydration.
            window.setTimeout(function() {
                _this.setupAllDashboards();
            }, 0);

            window.setTimeout(function() {
                _this.setupAllDashboards();
            }, 250);

            window.setTimeout(function() {
                _this.setupAllDashboards();
            }, 900);
        },

        setupAllDashboards: function() {
            var _this = this;
            $('.dashboard.floating-dashlets').each(function() {
                _this.setupDashboard($(this));
            });
        },

        onRendered: function(event) {
            var _this = event.data.self;
            var $target = $(event.target);
            var dashboards = [];

            if ($target.is('.dashboard.floating-dashlets')) {
                dashboards.push($target);
            }

            $target.find('.dashboard.floating-dashlets').each(function() {
                dashboards.push($(this));
            });

            var $parentDashboard = $target.closest('.dashboard.floating-dashlets');
            if ($parentDashboard.length) {
                dashboards.push($parentDashboard);
            }

            var unique = [];
            $.each(dashboards, function(_, $dashboard) {
                if ($dashboard.length && unique.indexOf($dashboard[0]) === -1) {
                    unique.push($dashboard[0]);
                }
            });

            for (var i = 0; i < unique.length; i++) {
                _this.setupDashboard($(unique[i]));
            }
        },

        onLayoutChange: function(event) {
            var _this = event.data.self;
            _this.setupAllDashboards();
        },

        onTitleClick: function(event) {
            var $dashlet = $(event.currentTarget).closest('.container');
            if ($dashlet.data('floatingSuppressClick')) {
                event.preventDefault();
                event.stopPropagation();
                $dashlet.data('floatingSuppressClick', false);
            }
        },

        onResetLayoutClick: function(event) {
            var _this = event.data.self;
            var $button = $(event.currentTarget);
            var $dashboard = _this.getAssociatedDashboard($button);

            event.preventDefault();
            event.stopPropagation();

            if (! $dashboard.length) {
                return;
            }

            _this.resetDashboardLayout($dashboard);
            $button.blur();
        },

        onToggleViewClick: function(event) {
            var _this = event.data.self;
            var $button = $(event.currentTarget);
            var $dashboard = _this.getAssociatedDashboard($button);

            event.preventDefault();
            event.stopPropagation();

            if (! $dashboard.length) {
                return;
            }

            if (_this.shouldDisableFloating($dashboard)) {
                _this.updateViewToggleControl($dashboard);
                $button.blur();
                return;
            }

            var currentMode = _this.getDashboardViewMode($dashboard);
            var nextMode = currentMode === 'classic' ? 'containers' : 'classic';

            _this.setDashboardViewMode($dashboard, nextMode);
            _this.setupDashboard($dashboard);
            $button.blur();
        },

        onDragStart: function(event) {
            var _this = event.data.self;
            if (event.which !== 1 || $(event.target).closest('.dashlet-resize-handle').length) {
                return;
            }

            var $title = $(event.currentTarget);
            var $dashlet = $title.closest('.container');
            var $dashboard = $dashlet.closest('.dashboard.floating-dashlets.floating-dashlets-active');
            if (! $dashboard.length) {
                return;
            }

            var position = $dashlet.position();

            _this.bringToFront($dashlet);
            _this.dragState = {
                $dashlet: $dashlet,
                $dashboard: $dashboard,
                startX: event.pageX,
                startY: event.pageY,
                left: position.left,
                top: position.top,
                moved: false
            };

            _this.bindPointerHandlers();
            event.preventDefault();
        },

        onResizeStart: function(event) {
            var _this = event.data.self;
            if (event.which !== 1) {
                return;
            }

            var $dashlet = $(event.currentTarget).closest('.container');
            var $dashboard = $dashlet.closest('.dashboard.floating-dashlets.floating-dashlets-active');
            if (! $dashboard.length) {
                return;
            }

            var position = $dashlet.position();

            _this.bringToFront($dashlet);
            _this.resizeState = {
                $dashlet: $dashlet,
                $dashboard: $dashboard,
                startX: event.pageX,
                startY: event.pageY,
                width: $dashlet.outerWidth(),
                height: $dashlet.outerHeight(),
                left: position.left
            };

            _this.bindPointerHandlers();
            event.preventDefault();
            event.stopPropagation();
        },

        bindPointerHandlers: function() {
            var _this = this;
            $(document)
                .off('mousemove.floatingDashlets')
                .on('mousemove.floatingDashlets', function(e) { _this.onPointerMove(e); });
            $(document)
                .off('mouseup.floatingDashlets')
                .on('mouseup.floatingDashlets', function(e) { _this.onPointerUp(e); });
        },

        onPointerMove: function(event) {
            if (this.dragState) {
                this.updateDrag(event);
                event.preventDefault();
                return;
            }

            if (this.resizeState) {
                this.updateResize(event);
                event.preventDefault();
            }
        },

        onPointerUp: function() {
            var $dashletToMark = null;
            var $dashboard = null;

            if (this.dragState) {
                if (this.dragState.moved) {
                    $dashletToMark = this.dragState.$dashlet;
                }
                $dashboard = this.dragState.$dashboard;
                this.dragState = null;
            }

            if (this.resizeState) {
                $dashboard = this.resizeState.$dashboard;
                this.resizeState = null;
            }

            $(document).off('mousemove.floatingDashlets mouseup.floatingDashlets');

            if ($dashletToMark) {
                $dashletToMark.data('floatingSuppressClick', true);
            }

            if ($dashboard && $dashboard.length) {
                this.refreshDashboardHeight($dashboard);
                this.saveLayout($dashboard);
            }
        },

        updateDrag: function(event) {
            var state = this.dragState;
            if (! state) {
                return;
            }

            var dx = event.pageX - state.startX;
            var dy = event.pageY - state.startY;

            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                state.moved = true;
            }

            var $dashlet = state.$dashlet;
            var $dashboard = state.$dashboard;
            var maxLeft = Math.max(0, $dashboard.innerWidth() - $dashlet.outerWidth() - DASHBOARD_PADDING);

            var left = Math.min(Math.max(0, state.left + dx), maxLeft);
            var top = Math.max(0, state.top + dy);
            var placed = this.placeWithoutOverlap(
                $dashboard,
                $dashlet,
                left,
                top,
                $dashlet.outerWidth(),
                $dashlet.outerHeight()
            );

            $dashlet.css({ left: placed.left + 'px', top: placed.top + 'px' });
            this.refreshDashboardHeight($dashboard);
        },

        updateResize: function(event) {
            var state = this.resizeState;
            if (! state) {
                return;
            }

            var dx = event.pageX - state.startX;
            var dy = event.pageY - state.startY;

            var $dashlet = state.$dashlet;
            var $dashboard = state.$dashboard;
            var maxWidth = Math.max(MIN_WIDTH, $dashboard.innerWidth() - state.left - DASHBOARD_PADDING);

            var width = Math.min(maxWidth, Math.max(MIN_WIDTH, state.width + dx));
            var height = Math.max(MIN_HEIGHT, state.height + dy);
            var currentPos = $dashlet.position();
            var placed = this.placeWithoutOverlap(
                $dashboard,
                $dashlet,
                currentPos.left,
                currentPos.top,
                width,
                height
            );

            $dashlet.css({
                left: placed.left + 'px',
                top: placed.top + 'px',
                width: placed.width + 'px',
                height: placed.height + 'px'
            });
            this.refreshDashboardHeight($dashboard);
        },

        setupDashboard: function($dashboard) {
            if (! $dashboard.length) {
                return;
            }

            this.initDashboardVisibilityManager($dashboard);

            if (this.shouldDisableFloating($dashboard)) {
                this.teardownDashboard($dashboard);
                this.updateViewToggleControl($dashboard);
                return;
            }

            if (this.getDashboardViewMode($dashboard) === 'classic') {
                this.teardownDashboard($dashboard);
                this.updateViewToggleControl($dashboard);
                return;
            }

            var key = this.getDashboardKey($dashboard);
            var layouts = this.getLayouts();
            var savedLayout = layouts[key] || {};
            var $dashlets = $dashboard.children('.container');

            if (! $dashlets.length) {
                return;
            }

            $dashboard.css({
                position: 'relative',
                letterSpacing: 'normal'
            });

            if (! $dashboard.hasClass('floating-dashlets-active')) {
                this.applyInitialLayout($dashboard, $dashlets, savedLayout);
                $dashboard.addClass('floating-dashlets-active');
                $dashboard.attr('data-floating-dashlets-active', '1');
            } else {
                this.applySavedLayout($dashboard, $dashlets, savedLayout);
            }

            var hasSavedLayout = this.hasSavedLayoutForAllDashlets($dashlets, savedLayout);
            if (! hasSavedLayout || this.dashboardHasOverlap($dashboard)) {
                this.autoArrangeDashboard($dashboard);
                this.saveLayout($dashboard);
            }

            this.ensureResizeHandles($dashlets);
            this.ensurePinnedDashletContent($dashlets);
            this.refreshDashboardHeight($dashboard);
            this.updateViewToggleControl($dashboard);
        },

        getAssociatedDashboard: function($trigger) {
            var $controls = $trigger.closest('.controls');
            if ($controls.length) {
                var $nearDashboard = $controls.siblings('.dashboard.floating-dashlets').first();
                if ($nearDashboard.length) {
                    return $nearDashboard;
                }
            }

            var $container = $trigger.closest('.container');
            if ($container.length) {
                var $inContainer = $container.find('.dashboard.floating-dashlets').first();
                if ($inContainer.length) {
                    return $inContainer;
                }
            }

            return $('.dashboard.floating-dashlets').first();
        },

        resetDashboardLayout: function($dashboard) {
            if (! $dashboard.length) {
                return;
            }

            var key = this.getDashboardKey($dashboard);
            var layouts = this.getLayouts();

            if (typeof layouts[key] !== 'undefined') {
                delete layouts[key];
                this.setLayouts(layouts);
            }

            if (this.getDashboardViewMode($dashboard) === 'classic' || this.shouldDisableFloating($dashboard)) {
                return;
            }

            var $dashlets = $dashboard.children('.container');
            if (! $dashlets.length) {
                return;
            }

            this.autoArrangeDashboard($dashboard);
            this.ensureResizeHandles($dashlets);
            this.ensurePinnedDashletContent($dashlets);
            this.refreshDashboardHeight($dashboard);
            this.saveLayout($dashboard);
        },

        bindVisibilityPanelDismissHandlers: function() {
            var _this = this;

            $(document)
                .off('click.floatingDashletVisibility')
                .on('click.floatingDashletVisibility', function(event) {
                    if (! $(event.target).closest('.dashboard-visibility-manager').length) {
                        _this.closeDashboardVisibilityPanels();
                    }
                });

            $(document)
                .off('keyup.floatingDashletVisibility')
                .on('keyup.floatingDashletVisibility', function(event) {
                    if (event.key === 'Escape') {
                        _this.closeDashboardVisibilityPanels();
                    }
                });
        },

        onDashboardVisibilityToggle: function(event) {
            var _this = event.data.self;
            var $button = $(event.currentTarget);
            var $manager = $button.closest('.dashboard-visibility-manager');
            var $panel = $manager.find('.js-dashboard-visibility-panel').first();
            var isOpen = ! $panel.prop('hidden');

            event.preventDefault();
            event.stopPropagation();

            _this.closeDashboardVisibilityPanels();

            if (! isOpen) {
                $panel.prop('hidden', false);
                $button.attr('aria-expanded', 'true');

                var $firstInput = $panel.find('input[type="checkbox"]').first();
                if ($firstInput.length) {
                    _this.icinga.ui.focusElement($firstInput, $panel, false);
                }
            }
        },

        closeDashboardVisibilityPanels: function() {
            $('.js-dashboard-visibility-panel').prop('hidden', true);
            $('.js-dashboard-visibility-toggle').attr('aria-expanded', 'false');
        },

        onDashboardVisibilityChange: function(event) {
            var _this = event.data.self;
            var $checkbox = $(event.currentTarget);
            var $manager = $checkbox.closest('.dashboard-visibility-manager');
            var $controls = $manager.closest('.controls');
            var $dashboard = _this.getAssociatedDashboard($controls);

            if (! $dashboard.length) {
                return;
            }

            _this.applyDashboardTabVisibility($dashboard, {
                changedId: $checkbox.val(),
                checked: $checkbox.is(':checked')
            });
        },

        initDashboardVisibilityManager: function($dashboard) {
            var $controls = this.getAssociatedControls($dashboard);
            if (! $controls.length) {
                return;
            }

            var $manager = $controls.find('.dashboard-visibility-manager').first();
            var $list = $controls.find('.js-dashboard-visibility-list').first();
            var $tabs = $controls.find('.tabs.primary-nav').first();
            var $button = $manager.find('.js-dashboard-visibility-toggle').first();
            var $panel = $manager.find('.js-dashboard-visibility-panel').first();

            if (! $manager.length || ! $list.length || ! $tabs.length) {
                return;
            }

            if ($panel.length && $button.length) {
                if (! $panel.attr('id')) {
                    $panel.attr('id', this.getDashboardVisibilityPanelId($dashboard));
                }

                $button.attr('aria-controls', $panel.attr('id'));
            }

            var tabs = this.collectDashboardTabs($tabs);
            if (tabs.length <= 1) {
                $manager.hide();
                return;
            }

            $manager.show();
            this.renderDashboardVisibilityList($dashboard, $list, tabs);
            this.applyDashboardTabVisibility($dashboard);
        },

        getDashboardVisibilityPanelId: function($dashboard) {
            return ('dashboard-visibility-' + this.getDashboardKey($dashboard))
                .toLowerCase()
                .replace(/[^a-z0-9\-_]+/g, '-')
                .replace(/^-+|-+$/g, '');
        },

        collectDashboardTabs: function($tabs) {
            var _this = this;
            var tabs = [];

            $tabs.children('li').each(function(index) {
                var $tab = $(this);
                var $link = $tab.children('a').first();

                if (
                    ! $link.length ||
                    $tab.hasClass('dropdown-nav-item') ||
                    $tab.hasClass('close-container-btn') ||
                    $link.hasClass('close-container-control') ||
                    $link.hasClass('refresh-container-control')
                ) {
                    return;
                }

                var href = $link.attr('href') || '';
                if (! href || href === '#') {
                    href = $link.attr('data-icinga-url')
                        || $link.attr('data-base-target')
                        || $link.attr('title')
                        || $.trim($link.text())
                        || ('tab-' + index);
                }

                var id = $tab.attr('data-dashboard-tab-id');
                if (! id) {
                    id = _this.buildDashboardTabId(href, $link, index);
                    $tab.attr('data-dashboard-tab-id', id);
                }

                tabs.push({
                    id: id,
                    label: $.trim($link.text()),
                    active: $tab.hasClass('active'),
                    $tab: $tab
                });
            });

            return tabs;
        },

        buildDashboardTabId: function(href, $link, index) {
            var parts = { path: href || '', params: [] };
            try {
                parts = this.icinga.utils.parseUrl(href);
            } catch (error) {
                parts = { path: href || '', params: [] };
            }

            var pane = '';
            for (var i = 0; i < parts.params.length; i++) {
                var param = parts.params[i];
                if (param.key === 'pane') {
                    pane = param.value || '';
                }
            }

            var label = $link && $link.length ? $.trim($link.text()) : '';
            var source = (parts.path + '::' + pane + '::' + label).toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');

            if (! source) {
                source = 'tab-' + index;
            }

            return 'dashboard-tab-' + source;
        },

        renderDashboardVisibilityList: function($dashboard, $list, tabs) {
            var hiddenMap = this.getDashboardHiddenTabs($dashboard);
            var items = [];
            var visibleCount = this.countVisibleTabs(tabs, hiddenMap);

            for (var i = 0; i < tabs.length; i++) {
                var tab = tabs[i];
                var checked = ! hiddenMap[tab.id];
                var disabled = (checked && visibleCount <= 1) ? ' disabled' : '';
                var checkedAttr = checked ? ' checked' : '';

                items.push(
                    '<li>' +
                        '<label>' +
                            '<input type="checkbox" value="' + this.escapeHtml(tab.id) + '"' + checkedAttr + disabled + '>' +
                            '<span>' + this.escapeHtml(tab.label || tab.id) + '</span>' +
                        '</label>' +
                    '</li>'
                );
            }

            $list.html(items.join(''));
        },

        applyDashboardTabVisibility: function($dashboard, change) {
            var $controls = this.getAssociatedControls($dashboard);
            var $tabs = $controls.find('.tabs.primary-nav').first();
            if (! $tabs.length) {
                return;
            }

            var tabs = this.collectDashboardTabs($tabs);
            if (! tabs.length) {
                return;
            }

            var hiddenMap = this.getDashboardHiddenTabs($dashboard);

            if (change && change.changedId) {
                if (change.checked) {
                    delete hiddenMap[change.changedId];
                } else {
                    hiddenMap[change.changedId] = true;
                }
            }

            hiddenMap = this.filterHiddenTabsMap(hiddenMap, tabs);
            // Keep the currently active dashboard tab visible during initialization.
            // Otherwise the content and visible tab bar can get out of sync when
            // an old hidden-tabs preference still contains the active pane.
            if (! change || ! change.changedId) {
                for (var activeIndex = 0; activeIndex < tabs.length; activeIndex++) {
                    if (tabs[activeIndex].active && hiddenMap[tabs[activeIndex].id]) {
                        delete hiddenMap[tabs[activeIndex].id];
                        break;
                    }
                }
            }

            var visibleCount = this.countVisibleTabs(tabs, hiddenMap);

            if (visibleCount === 0 && change && change.changedId) {
                delete hiddenMap[change.changedId];
                visibleCount = this.countVisibleTabs(tabs, hiddenMap);
            }

            if (change && change.changedId && hiddenMap[change.changedId]) {
                var changedTab = null;
                for (var i = 0; i < tabs.length; i++) {
                    if (tabs[i].id === change.changedId) {
                        changedTab = tabs[i];
                        break;
                    }
                }

                if (changedTab && changedTab.active) {
                    for (var j = 0; j < tabs.length; j++) {
                        if (! hiddenMap[tabs[j].id]) {
                            tabs[j].$tab.children('a').first().trigger('click');
                            break;
                        }
                    }
                }
            }

            for (var k = 0; k < tabs.length; k++) {
                var current = tabs[k];
                current.$tab.toggle(! hiddenMap[current.id]);
            }

            this.setDashboardHiddenTabs($dashboard, hiddenMap);
            this.syncDashboardVisibilityCheckboxes($dashboard, tabs, hiddenMap);
        },

        syncDashboardVisibilityCheckboxes: function($dashboard, tabs, hiddenMap) {
            var $controls = this.getAssociatedControls($dashboard);
            var $list = $controls.find('.js-dashboard-visibility-list').first();
            if (! $list.length) {
                return;
            }

            var visibleCount = this.countVisibleTabs(tabs, hiddenMap);

            for (var i = 0; i < tabs.length; i++) {
                var tab = tabs[i];
                var $checkbox = $list.find('input[type="checkbox"]').filter(function() {
                    return $(this).val() === tab.id;
                }).first();
                if (! $checkbox.length) {
                    continue;
                }

                var checked = ! hiddenMap[tab.id];
                $checkbox.prop('checked', checked);
                $checkbox.prop('disabled', checked && visibleCount <= 1);
            }
        },

        countVisibleTabs: function(tabs, hiddenMap) {
            var visibleCount = 0;

            for (var i = 0; i < tabs.length; i++) {
                if (! hiddenMap[tabs[i].id]) {
                    visibleCount += 1;
                }
            }

            return visibleCount;
        },

        getHiddenTabsStore: function() {
            var store = {};

            try {
                store = this.storage.get(this.hiddenTabsKey);
            } catch (error) {
                if (window.console && typeof window.console.warn === 'function') {
                    window.console.warn('Floating dashlets: failed to read hidden dashboard tabs.', error);
                }
            }

            return (store && typeof store === 'object') ? store : {};
        },

        getDashboardHiddenTabs: function($dashboard) {
            var store = this.getHiddenTabsStore();
            var key = this.getDashboardTabsKey($dashboard);
            var map = store[key];
            return (map && typeof map === 'object') ? map : {};
        },

        setDashboardHiddenTabs: function($dashboard, hiddenMap) {
            var store = this.getHiddenTabsStore();
            var key = this.getDashboardTabsKey($dashboard);
            store[key] = hiddenMap;
            this.setHiddenTabsStore(store);
        },

        setHiddenTabsStore: function(store) {
            try {
                this.storage.set(this.hiddenTabsKey, store);
            } catch (error) {
                if (window.console && typeof window.console.warn === 'function') {
                    window.console.warn('Floating dashlets: failed to persist hidden dashboard tabs.', error);
                }
            }
        },

        filterHiddenTabsMap: function(hiddenMap, tabs) {
            var filtered = {};

            if (! hiddenMap || typeof hiddenMap !== 'object') {
                return filtered;
            }

            for (var i = 0; i < tabs.length; i++) {
                var id = tabs[i].id;
                if (hiddenMap[id]) {
                    filtered[id] = true;
                }
            }

            return filtered;
        },

        escapeHtml: function(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },

        getDashboardTabsKey: function($dashboard) {
            var parts = this.icinga.utils.parseUrl(window.location.href);
            var index = $('.dashboard.floating-dashlets').index($dashboard);
            return parts.path + '::tabs::' + index;
        },

        getViewModes: function() {
            var modes = {};

            try {
                modes = this.storage.get(this.viewModeKey);
            } catch (error) {
                if (window.console && typeof window.console.warn === 'function') {
                    window.console.warn('Floating dashlets: failed to read stored view mode.', error);
                }

                modes = {};
            }

            return (modes && typeof modes === 'object') ? modes : {};
        },

        getDashboardViewMode: function($dashboard) {
            var modes = this.getViewModes();
            var key = this.getDashboardKey($dashboard);
            return modes[key] === 'classic' ? 'classic' : 'containers';
        },

        setDashboardViewMode: function($dashboard, mode) {
            var key = this.getDashboardKey($dashboard);
            var modes = this.getViewModes();
            modes[key] = (mode === 'classic') ? 'classic' : 'containers';
            this.setViewModes(modes);
        },

        setViewModes: function(modes) {
            try {
                this.storage.set(this.viewModeKey, modes);
            } catch (error) {
                if (window.console && typeof window.console.warn === 'function') {
                    window.console.warn('Floating dashlets: failed to persist view mode.', error);
                }
            }
        },

        updateViewToggleControl: function($dashboard) {
            var $controls = this.getAssociatedControls($dashboard);
            if (! $controls.length) {
                return;
            }

            var $toggle = $controls.find('.js-toggle-dashlet-view').first();
            if (! $toggle.length) {
                return;
            }

            var labels = {
                classic: $toggle.data('labelClassic') || 'Classic View',
                containers: $toggle.data('labelContainers') || 'Container View',
                unavailable: $toggle.data('labelUnavailable') || 'Container view unavailable in compact layout'
            };
            var blocked = this.shouldDisableFloating($dashboard);
            var mode = this.getDashboardViewMode($dashboard);
            var nextLabel = mode === 'classic' ? labels.containers : labels.classic;

            if (blocked) {
                $toggle.prop('disabled', true);
                $toggle.text(labels.unavailable);
                $toggle.attr('title', labels.unavailable);
                $toggle.attr('aria-pressed', mode === 'classic' ? 'true' : 'false');
            } else {
                $toggle.prop('disabled', false);
                $toggle.text(nextLabel);
                $toggle.attr('title', nextLabel);
                $toggle.attr('aria-pressed', mode === 'classic' ? 'true' : 'false');
            }
        },

        getAssociatedControls: function($dashboard) {
            var $controls = $dashboard.siblings('.controls').first();
            if ($controls.length) {
                return $controls;
            }

            var $container = $dashboard.closest('.container');
            if ($container.length) {
                return $container.find('> .controls').first();
            }

            return $();
        },

        hasSavedLayoutForAllDashlets: function($dashlets, savedLayout) {
            var allSaved = true;

            $dashlets.each(function() {
                var id = $(this).attr('data-floating-id');
                if (! id || typeof savedLayout[id] === 'undefined') {
                    allSaved = false;
                    return false;
                }
            });

            return allSaved;
        },

        autoArrangeDashboard: function($dashboard) {
            var dashboardWidth = $dashboard.innerWidth() || 0;
            if (dashboardWidth <= 0) {
                return;
            }

            var cursorX = DASHBOARD_PADDING;
            var cursorY = DASHBOARD_PADDING;
            var rowHeight = 0;
            var maxDashletWidth = Math.max(MIN_WIDTH, dashboardWidth - DASHBOARD_PADDING * 2);

            $dashboard.children('.container').each(function() {
                var $dashlet = $(this);
                var width = Math.max(MIN_WIDTH, Math.round($dashlet.outerWidth()));
                var height = Math.max(MIN_HEIGHT, Math.round($dashlet.outerHeight()));

                width = Math.min(width, maxDashletWidth);

                if (cursorX + width > dashboardWidth - DASHBOARD_PADDING && cursorX > DASHBOARD_PADDING) {
                    cursorX = DASHBOARD_PADDING;
                    cursorY += rowHeight + DASHBOARD_PADDING;
                    rowHeight = 0;
                }

                $dashlet.css({
                    left: cursorX + 'px',
                    top: cursorY + 'px',
                    width: width + 'px',
                    height: height + 'px'
                });

                cursorX += width + DASHBOARD_PADDING;
                rowHeight = Math.max(rowHeight, height);
            });
        },

        dashboardHasOverlap: function($dashboard) {
            var dashlets = $dashboard.children('.container').toArray();

            for (var i = 0; i < dashlets.length; i++) {
                var rectA = this.getDashletRect($(dashlets[i]));
                for (var j = i + 1; j < dashlets.length; j++) {
                    var rectB = this.getDashletRect($(dashlets[j]));
                    if (this.rectanglesOverlap(rectA, rectB)) {
                        return true;
                    }
                }
            }

            return false;
        },

        getDashletRect: function($dashlet, left, top, width, height) {
            var position = $dashlet.position();
            var rectLeft = (typeof left === 'number') ? left : position.left;
            var rectTop = (typeof top === 'number') ? top : position.top;
            var rectWidth = (typeof width === 'number') ? width : $dashlet.outerWidth();
            var rectHeight = (typeof height === 'number') ? height : $dashlet.outerHeight();

            return {
                left: rectLeft,
                top: rectTop,
                right: rectLeft + rectWidth,
                bottom: rectTop + rectHeight
            };
        },

        rectanglesOverlap: function(a, b) {
            return ! (
                a.right <= b.left ||
                a.left >= b.right ||
                a.bottom <= b.top ||
                a.top >= b.bottom
            );
        },

        placeWithoutOverlap: function($dashboard, $activeDashlet, left, top, width, height) {
            var dashboardWidth = $dashboard.innerWidth() || 0;
            var maxWidth = Math.max(MIN_WIDTH, dashboardWidth - DASHBOARD_PADDING * 2);
            var clampedWidth = Math.min(Math.max(MIN_WIDTH, Math.round(width)), maxWidth);
            var clampedHeight = Math.max(MIN_HEIGHT, Math.round(height));
            var maxLeft = Math.max(0, dashboardWidth - clampedWidth - DASHBOARD_PADDING);
            var nextLeft = Math.min(Math.max(0, Math.round(left)), maxLeft);
            var nextTop = Math.max(0, Math.round(top));
            var moved;
            var iteration = 0;
            var maxIterations = 120;

            do {
                moved = false;

                var activeRect = this.getDashletRect(
                    $activeDashlet,
                    nextLeft,
                    nextTop,
                    clampedWidth,
                    clampedHeight
                );

                $dashboard.children('.container').each(function() {
                    var $dashlet = $(this);
                    if ($dashlet[0] === $activeDashlet[0]) {
                        return;
                    }

                    var otherRect = {
                        left: $dashlet.position().left,
                        top: $dashlet.position().top,
                        right: $dashlet.position().left + $dashlet.outerWidth(),
                        bottom: $dashlet.position().top + $dashlet.outerHeight()
                    };

                    if (
                        ! (
                            activeRect.right <= otherRect.left ||
                            activeRect.left >= otherRect.right ||
                            activeRect.bottom <= otherRect.top ||
                            activeRect.top >= otherRect.bottom
                        )
                    ) {
                        nextTop = otherRect.bottom + DASHBOARD_PADDING;
                        moved = true;
                        return false;
                    }
                });

                iteration += 1;
            } while (moved && iteration < maxIterations);

            return {
                left: nextLeft,
                top: nextTop,
                width: clampedWidth,
                height: clampedHeight
            };
        },

        shouldDisableFloating: function($dashboard) {
            var layoutClass = $('#layout').attr('class') || '';
            var narrowByLayout = /(^|\s)(poor-layout|minimal-layout)(\s|$)/.test(layoutClass);
            var width = $dashboard.innerWidth() || 0;
            var narrowByWidth = width > 0 && width < MIN_FLOATING_WIDTH;

            // Prefer actual available width over layout label to avoid false negatives with custom themes.
            if (narrowByWidth) {
                return true;
            }

            if (narrowByLayout && width > 0 && width < MIN_FLOATING_WIDTH + 120) {
                return true;
            }

            return false;
        },

        teardownDashboard: function($dashboard) {
            $dashboard.removeClass('floating-dashlets-active');
            $dashboard.removeAttr('data-floating-dashlets-active');
            $dashboard.css('min-height', '');

            $dashboard.children('.container').each(function() {
                var $dashlet = $(this);
                var $scrollBody = $dashlet.find('> .dashlet-scroll-body');
                if ($scrollBody.length) {
                    $scrollBody.children().appendTo($dashlet);
                    $scrollBody.remove();
                }

                $dashlet.removeClass('floating-dashlet');
                $dashlet.css({
                    position: '',
                    left: '',
                    top: '',
                    width: '',
                    height: '',
                    zIndex: '',
                    margin: '',
                    boxSizing: '',
                    overflow: '',
                    display: '',
                    flexDirection: ''
                });
                $dashlet.find('> h1').css({
                    cursor: '',
                    userSelect: '',
                    position: '',
                    top: '',
                    zIndex: '',
                    marginBottom: '',
                    background: '',
                    paddingRight: ''
                });
                $dashlet.find('> .dashlet-resize-handle').remove();
            });
        },

        applyInitialLayout: function($dashboard, $dashlets, savedLayout) {
            var _this = this;
            var dashboardOffset = $dashboard.offset();

            var nextTop = DASHBOARD_PADDING;
            var fallbackWidth = Math.max(300, Math.floor($dashboard.innerWidth() / 2) - DASHBOARD_PADDING);

            $dashlets.each(function(index) {
                var $dashlet = $(this);
                var id = $dashlet.attr('data-floating-id');
                if (! id) {
                    id = _this.buildDashletId($dashlet, index);
                    $dashlet.attr('data-floating-id', id);
                }

                var saved = savedLayout[id] || null;
                var x, y, w, h, z;

                if (saved) {
                    x = saved.x;
                    y = saved.y;
                    w = saved.w;
                    h = saved.h;
                    z = saved.z;
                } else {
                    var offset = $dashlet.offset();
                    x = Math.max(0, Math.round(offset.left - dashboardOffset.left));
                    y = Math.max(0, Math.round(offset.top - dashboardOffset.top));
                    w = Math.max(MIN_WIDTH, Math.round($dashlet.outerWidth() || fallbackWidth));
                    h = Math.max(MIN_HEIGHT, Math.round($dashlet.outerHeight() || MIN_HEIGHT));

                    if (! y || y < DASHBOARD_PADDING) {
                        y = nextTop;
                    }

                    nextTop = Math.max(nextTop, y + h + DASHBOARD_PADDING);
                    z = ++_this.zCounter;
                }

                _this.applyDashletStyle($dashboard, $dashlet, x, y, w, h, z);
            });
        },

        applySavedLayout: function($dashboard, $dashlets, savedLayout) {
            var _this = this;
            var maxBottom = DASHBOARD_PADDING;
            var fallbackWidth = Math.max(300, Math.floor($dashboard.innerWidth() / 2) - DASHBOARD_PADDING);

            $dashlets.each(function(index) {
                var $dashlet = $(this);
                var id = $dashlet.attr('data-floating-id');
                if (! id) {
                    id = _this.buildDashletId($dashlet, index);
                    $dashlet.attr('data-floating-id', id);
                }

                var saved = savedLayout[id] || null;
                var x, y, w, h, z;

                if (saved) {
                    x = saved.x;
                    y = saved.y;
                    w = saved.w;
                    h = saved.h;
                    z = saved.z;
                } else {
                    x = DASHBOARD_PADDING;
                    y = maxBottom;
                    w = Math.max(MIN_WIDTH, Math.round($dashlet.outerWidth() || fallbackWidth));
                    h = Math.max(MIN_HEIGHT, Math.round($dashlet.outerHeight() || MIN_HEIGHT));
                    z = ++_this.zCounter;
                }

                _this.applyDashletStyle($dashboard, $dashlet, x, y, w, h, z);
                maxBottom = Math.max(maxBottom, y + h + DASHBOARD_PADDING);
            });
        },

        applyDashletStyle: function($dashboard, $dashlet, x, y, w, h, z) {
            var maxLeft = Math.max(0, $dashboard.innerWidth() - w - DASHBOARD_PADDING);

            $dashlet.addClass('floating-dashlet');
            $dashlet.css({
                position: 'absolute',
                left: Math.min(Math.max(0, x), maxLeft) + 'px',
                top: Math.max(0, y) + 'px',
                width: Math.max(MIN_WIDTH, w) + 'px',
                height: Math.max(MIN_HEIGHT, h) + 'px',
                zIndex: Math.max(1, z || 1),
                margin: 0,
                boxSizing: 'border-box',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
            });

            $dashlet.find('> h1').css({
                cursor: 'move',
                userSelect: 'none',
                position: 'sticky',
                top: 0,
                zIndex: 3,
                marginBottom: 0,
                background: 'inherit',
                paddingRight: '1.5em'
            });

            this.zCounter = Math.max(this.zCounter, parseInt($dashlet.css('z-index'), 10) || 1);
        },

        ensureResizeHandles: function($dashlets) {
            $dashlets.each(function() {
                var $dashlet = $(this);
                if (! $dashlet.find('> .dashlet-resize-handle').length) {
                    $dashlet.append('<div class="dashlet-resize-handle" aria-hidden="true"></div>');
                }

                $dashlet.find('> .dashlet-resize-handle').css({
                    position: 'absolute',
                    right: '0.25em',
                    bottom: '0.25em',
                    width: '1em',
                    height: '1em',
                    cursor: 'nwse-resize',
                    opacity: 0.75,
                    zIndex: 2
                });
            });
        },

        ensurePinnedDashletContent: function($dashlets) {
            $dashlets.each(function() {
                var $dashlet = $(this);
                var $title = $dashlet.children('h1').first();
                if (! $title.length) {
                    return;
                }

                var $resizeHandle = $dashlet.children('.dashlet-resize-handle').first();
                var $scrollBody = $dashlet.children('.dashlet-scroll-body').first();

                if (! $scrollBody.length) {
                    $scrollBody = $('<div class="content dashlet-scroll-body"></div>');
                    $scrollBody.insertAfter($title);
                } else if (! $scrollBody.hasClass('content')) {
                    $scrollBody.addClass('content');
                }

                $dashlet.children().each(function() {
                    var $child = $(this);
                    if (
                        $child.is('h1') ||
                        $child.hasClass('dashlet-scroll-body') ||
                        $child.hasClass('dashlet-resize-handle')
                    ) {
                        return;
                    }

                    $scrollBody.append($child);
                });

                $scrollBody.css({
                    flex: '1 1 auto',
                    minHeight: 0,
                    overflow: 'auto',
                    position: 'relative',
                    paddingBottom: '1.25em'
                });

                if ($resizeHandle.length) {
                    $dashlet.append($resizeHandle);
                }
            });
        },

        bringToFront: function($dashlet) {
            this.zCounter += 1;
            $dashlet.css('z-index', this.zCounter);
        },

        refreshDashboardHeight: function($dashboard) {
            var maxBottom = 240;
            $dashboard.children('.container').each(function() {
                var $dashlet = $(this);
                var position = $dashlet.position();
                var bottom = position.top + $dashlet.outerHeight() + DASHBOARD_PADDING;
                maxBottom = Math.max(maxBottom, bottom);
            });

            $dashboard.css('min-height', Math.ceil(maxBottom) + 'px');
        },

        buildDashletId: function($dashlet, index) {
            var url = $dashlet.data('icingaUrl') || '';
            var title = $.trim($dashlet.find('> h1').text()) || 'dashlet';
            var source = (url + '-' + title).toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            return 'dashlet-' + index + '-' + source.substring(0, 72);
        },

        getDashboardKey: function($dashboard) {
            var parts = this.icinga.utils.parseUrl(window.location.href);
            var pane = '';
            for (var i = 0; i < parts.params.length; i++) {
                if (parts.params[i].key === 'pane') {
                    pane = parts.params[i].value || '';
                    break;
                }
            }

            var index = $('.dashboard.floating-dashlets').index($dashboard);
            return parts.path + '::' + pane + '::' + index;
        },

        getLayouts: function() {
            var layouts = {};

            try {
                layouts = this.storage.get(this.storageKey);
            } catch (error) {
                if (window.console && typeof window.console.warn === 'function') {
                    window.console.warn('Floating dashlets: failed to read stored layout.', error);
                }

                layouts = {};
            }

            return (layouts && typeof layouts === 'object') ? layouts : {};
        },

        setLayouts: function(layouts) {
            try {
                this.storage.set(this.storageKey, layouts);
            } catch (error) {
                if (window.console && typeof window.console.warn === 'function') {
                    window.console.warn('Floating dashlets: failed to persist updated layout store.', error);
                }
            }
        },

        saveLayout: function($dashboard) {
            var layouts = this.getLayouts();
            var key = this.getDashboardKey($dashboard);
            var layout = {};

            $dashboard.children('.container').each(function(index) {
                var $dashlet = $(this);
                var id = $dashlet.attr('data-floating-id');
                if (! id) {
                    id = 'dashlet-' + index;
                    $dashlet.attr('data-floating-id', id);
                }

                var position = $dashlet.position();
                layout[id] = {
                    x: Math.round(position.left),
                    y: Math.round(position.top),
                    w: Math.round($dashlet.outerWidth()),
                    h: Math.round($dashlet.outerHeight()),
                    z: parseInt($dashlet.css('z-index'), 10) || 1
                };
            });

            layouts[key] = layout;
            this.setLayouts(layouts);
        }
    });

    Icinga.Behaviors.FloatingDashlets = FloatingDashlets;

})(Icinga, jQuery);
