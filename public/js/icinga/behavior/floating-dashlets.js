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

        this.scheduleSetupPasses();
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

            if (this.shouldDisableFloating($dashboard)) {
                this.teardownDashboard($dashboard);
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
            this.refreshDashboardHeight($dashboard);
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
                $dashlet.removeClass('floating-dashlet');
                $dashlet.css({
                    position: '',
                    left: '',
                    top: '',
                    width: '',
                    height: '',
                    zIndex: ''
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
                overflow: 'auto'
            });

            $dashlet.find('> h1').css({
                cursor: 'move',
                userSelect: 'none'
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
            try {
                this.storage.set(this.storageKey, layouts);
            } catch (error) {
                if (window.console && typeof window.console.warn === 'function') {
                    window.console.warn('Floating dashlets: failed to save layout.', error);
                }
            }
        }
    });

    Icinga.Behaviors.FloatingDashlets = FloatingDashlets;

})(Icinga, jQuery);
