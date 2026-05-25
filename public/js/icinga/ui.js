// SPDX-FileCopyrightText: 2018 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Icinga.UI
 *
 * Our user interface
 */
(function(Icinga, $) {

    'use strict';

    Icinga.UI = function (icinga) {

        this.icinga = icinga;

        this.currentLayout = 'default';

        this.columnSplitterStorage = null;
        this.columnSplitterStorageKey = 'column-split-ratio';
        this.columnSplitRatioMin = 0.2;
        this.columnSplitRatioMax = 0.8;
        this.columnSplitterDrag = null;

        this.debug = false;

        this.debugTimer = null;

        // detect currentLayout
        var classList = $('#layout').attr('class').split(/\s+/);
        var _this = this;
        var matched;
        $.each(classList, function(index, item) {
            if (null !== (matched = item.match(/^([a-z]+)-layout$/))) {
                var layout = matched[1];
                if (layout !== 'fullscreen') {
                    _this.currentLayout = layout;
                    // Break loop
                    return false;
                }
            }
        });
    };

    Icinga.UI.prototype = {

        initialize: function () {
            $('html').removeClass('no-js').addClass('js');
            this.triggerWindowResize();
            this.fadeNotificationsAway();
            this.initializeColumnSplitter();
            this.applyStoredColumnSplitRatio();

            $(document).on('click', '#mobile-menu-toggle', { self: this }, this.toggleMobileMenu);
            $(document).on('keypress', '#search',{ self: this, type: 'key' }, this.closeMobileMenu);
            $(document).on('mouseleave', '#sidebar', { self: this, type: 'leave' }, this.closeMobileMenu);
            $(document).on('click', '#sidebar a', { self: this, type: 'navigate' }, this.closeMobileMenu);
            $(document).on('keydown', { self: this }, this.handleGlobalShortcuts);
            $(document).on('focus', '#search', { self: this }, this.populateSearchHistory);
            $(document).on('submit', 'form.search-control', { self: this }, this.rememberSearchQuery);

            this.setMobileMenuExpanded($('#sidebar').hasClass('expanded'));
        },

        fadeNotificationsAway: function() {
            var icinga = this.icinga;
            $('#notifications li')
                .not('.fading-out')
                .not('.persist')
                .addClass('fading-out')
                .delay(7000)
                .fadeOut('slow',
            function() {
                $(this).remove();
            });
        },

        toggleDebug: function() {
            if (this.debug) {
                return this.disableDebug();
            } else {
                return this.enableDebug();
            }
        },

        enableDebug: function () {
            if (this.debug === true) { return this; }
            this.debug = true;
            this.debugTimer = this.icinga.timer.register(
                this.refreshDebug,
                this,
                1000
            );
            this.fixDebugVisibility();

            return this;
        },

        fixDebugVisibility: function () {
            if (this.debug) {
                $('#responsive-debug').css({display: 'block'});
            } else {
                $('#responsive-debug').css({display: 'none'});
            }
            return this;
        },

        disableDebug: function () {
            if (this.debug === false) { return; }

            this.debug = false;
            this.icinga.timer.unregister(this.debugTimer);
            this.debugTimer = null;
            this.fixDebugVisibility();
            return this;
        },

        reloadCss: function () {
            var icinga = this.icinga;
            icinga.logger.info('Reloading CSS');
            $('link').each(function() {
                var $oldLink = $(this);
                if ($oldLink.hasAttr('type') && $oldLink.attr('type').indexOf('css') > -1) {
                    var $newLink = $oldLink.clone().attr(
                        'href',
                        icinga.utils.addUrlParams(
                            $oldLink.attr('href'),
                            { id: new Date().getTime() } // Only required for Firefox to reload CSS automatically
                        )
                    ).on('load', function() {
                        $oldLink.remove();
                        $('head').trigger('css-reloaded');
                    });

                    $newLink.appendTo($('head'));
                }
            });
        },

        /**
         * Focus the given element and scroll to its position
         *
         * @param   {string}    element         The name or id of the element to focus
         * @param   {object}    [$container]    The container containing the element
         * @param   {boolean}   [scroll]        Whether the viewport should be scrolled to the focused element
         */
        focusElement: function(element, $container, scroll) {
            var $element = element;

            if (typeof scroll === 'undefined') {
                scroll = true;
            }

            if (typeof element === 'string') {
                if ($container && $container.length) {
                    $element = $container.find('#' + element);
                } else {
                    $element = $('#' + element);
                }

                if (! $element.length) {
                    // The name attribute is actually deprecated, on anchor tags,
                    // but we'll possibly handle links from another source
                    // (module etc) so that's used as a fallback
                    if ($container && $container.length) {
                        $element = $container.find('[name="' + element.replace(/'/, '\\\'') + '"]');
                    } else {
                        $element = $('[name="' + element.replace(/'/, '\\\'') + '"]');
                    }
                }
            }

            if ($element.length) {
                if (! this.isFocusable($element)) {
                    $element.attr('tabindex', -1);
                }

                $element[0].focus();

                if (scroll && $container && $container.length) {
                    if (! $container.is('.container')) {
                        $container = $container.closest('.container');
                    }

                    if ($container.css('display') === 'flex' && $container.is('.container')) {
                        var $controls = $container.find('.controls');
                        var $content = $container.find('.content');
                        $content.scrollTop($element.offsetTopRelativeTo($content) - $controls.outerHeight() - (
                            $element.outerHeight(true) - $element.innerHeight()
                        ));
                    } else {
                        $container.scrollTop($element.first().position().top);
                    }
                }
            }
        },

        isFocusable: function ($element) {
            return $element.is('*[tabindex], a[href], input:not([disabled]), button:not([disabled])' +
                ', select:not([disabled]), textarea:not([disabled]), iframe, area[href], object' +
                ', embed, *[contenteditable]');
        },

        moveToLeft: function () {
            var col2 = this.cutContainer($('#col2'));
            var kill = this.cutContainer($('#col1'));
            this.pasteContainer($('#col1'), col2);
            this.icinga.behaviors.navigation.trySetActiveAndSelectedByUrl($('#col1').data('icingaUrl'));
            $('#col1').trigger('column-moved', 'col2');
        },

        moveToRight: function () {
            let col1 = document.getElementById('col1'),
                col2 = document.getElementById('col2'),
                col1Backup = this.cutContainer($(col1));

            this.cutContainer($(col2)); // Clear col2 states
            this.pasteContainer($(col2), col1Backup);
            this.layout2col();
            $(col2).trigger('column-moved', 'col1');
        },

        cutContainer: function ($col) {
            var props = {
              'elements': $('#' + $col.attr('id') + ' > *').detach(),
              'data': {
                'data-icinga-url': $col.data('icingaUrl'),
                'data-icinga-title': $col.data('icingaTitle'),
                'data-icinga-refresh': $col.data('icingaRefresh'),
                'data-last-update': $col.data('lastUpdate'),
                'data-icinga-module': $col.data('icingaModule'),
                'data-icinga-container-id': $col[0].dataset.icingaContainerId
              },
              'class': $col.attr('class')
            };
            this.icinga.loader.stopPendingRequestsFor($col);
            $col.removeData('icingaUrl');
            $col.removeData('icingaTitle');
            $col.removeData('icingaRefresh');
            $col.removeData('lastUpdate');
            $col.removeData('icingaModule');
            delete $col[0].dataset.icingaContainerId;
            $col.removeAttr('class').attr('class', 'container');
            return props;
        },

        pasteContainer: function ($col, backup) {
            backup['elements'].appendTo($col);
            $col.attr('class', backup['class']); // TODO: ie memleak? remove first?
            $col.data('icingaUrl', backup['data']['data-icinga-url']);
            $col.data('icingaTitle', backup['data']['data-icinga-title']);
            $col.data('icingaRefresh', backup['data']['data-icinga-refresh']);
            $col.data('lastUpdate', backup['data']['data-last-update']);
            $col.data('icingaModule', backup['data']['data-icinga-module']);
            $col[0].dataset.icingaContainerId = backup['data']['data-icinga-container-id'];
        },

        triggerWindowResize: function () {
            this.onWindowResize({data: {self: this}});
        },

        /**
         * Our window got resized, let's fix our UI
         */
        onWindowResize: function (event) {
            var _this = event.data.self;

            if (_this.layoutHasBeenChanged()) {
                _this.icinga.logger.info(
                    'Layout change detected, switching to',
                    _this.currentLayout
                );
            }

            _this.refreshDebug();
        },

        /**
         * Returns whether the layout is too small for more than one column
         *
         * @returns {boolean}   True when more than one column is available
         */
        hasOnlyOneColumn: function () {
            return this.currentLayout === 'poor' || this.currentLayout === 'minimal';
        },

        layoutHasBeenChanged: function () {

            var layout = $('html').css('fontFamily').replace(/['",]/g, '');
            var matched;

            if (null !== (matched = layout.match(/^([a-z]+)-layout$/))) {
                if (matched[1] === this.currentLayout &&
                    $('#layout').hasClass(layout)
                ) {
                    return false;
                } else {
                    $('#layout').removeClass(this.currentLayout + '-layout').addClass(layout);
                    this.currentLayout = matched[1];
                    if (this.currentLayout === 'poor' || this.currentLayout === 'minimal') {
                        this.layout1col();
                        this.icinga.history.replaceCurrentState();
                    } else if (this.icinga.initialized) {
                        // layout1col() also triggers this, that's why an else is required
                        $('#layout').trigger('layout-change');
                    }
                    return true;
                }
            }
            this.icinga.logger.error(
                'Someone messed up our responsiveness hacks, html font-family is',
                layout
            );
            return false;
        },

        /**
         * Returns whether only one column is displayed
         *
         * @returns {boolean}   True when only one column is displayed
         */
        isOneColLayout: function () {
            return ! $('#layout').hasClass('twocols');
        },

        layout1col: function () {
            if (this.isOneColLayout()) { return; }
            this.icinga.logger.debug('Switching to single col');
            $('#layout').removeClass('twocols');
            this.resetColumnSplitStyles();
            this.closeContainer($('#col2'));

            if (this.icinga.initialized) {
                $('#layout').trigger('layout-change');
            }

            // one-column layouts never have any selection active
            $('#col1').removeData('icinga-actiontable-former-href');
            this.icinga.behaviors.actiontable.clearAll();
        },

        closeContainer: function($c) {
            this.icinga.loader.stopPendingRequestsFor($c);
            $c.removeData('icingaUrl');
            $c.removeData('icingaTitle');
            $c.removeData('icingaRefresh');
            $c.removeData('lastUpdate');
            $c.removeData('icingaModule');
            delete $c[0].dataset.icingaContainerId;
            $c.removeAttr('class').attr('class', 'container');
            $c.trigger('close-column');
            $c.html('');
        },

        layout2col: function () {
            if (! this.isOneColLayout()) { return; }
            this.icinga.logger.debug('Switching to double col');
            $('#layout').addClass('twocols');
            this.applyStoredColumnSplitRatio();

            if (this.icinga.initialized) {
                $('#layout').trigger('layout-change');
            }
        },

        initializeColumnSplitter: function () {
            if (typeof Icinga.Storage !== 'undefined' && typeof Icinga.Storage.BehaviorStorage === 'function') {
                this.columnSplitterStorage = Icinga.Storage.BehaviorStorage('ui');
            }

            $(document).on('mousedown', '#col-splitter', {self: this}, this.onColumnSplitterMouseDown);
        },

        onColumnSplitterMouseDown: function (event) {
            var _this = event.data.self;
            var e = event.originalEvent || event;
            var $layout = $('#layout');
            var $main = $('#main');
            var $col1 = $('#col1');
            var $col2 = $('#col2');
            var $splitter = $('#col-splitter');
            var splitterWidth;
            var availableWidth;

            if (_this.isOneColLayout() || _this.hasOnlyOneColumn()) {
                return;
            }

            if (typeof e.button !== 'undefined' && e.button !== 0) {
                return;
            }

            splitterWidth = $splitter.outerWidth() || 0;
            availableWidth = ($main.innerWidth() || 0) - splitterWidth;

            if (availableWidth <= 0 || ! $col1.length || ! $col2.length) {
                return;
            }

            _this.columnSplitterDrag = {
                'startX': e.clientX,
                'leftAtStart': $col1.outerWidth() || 0,
                'availableWidth': availableWidth
            };

            $layout.addClass('column-resizing');
            $splitter.addClass('dragging');

            $(document).on('mousemove.icingaColumnSplitter', {'self': _this}, _this.onColumnSplitterMouseMove);
            $(document).on('mouseup.icingaColumnSplitter', {'self': _this}, _this.onColumnSplitterMouseUp);

            event.preventDefault();
        },

        onColumnSplitterMouseMove: function (event) {
            var _this = event.data.self;
            var drag = _this.columnSplitterDrag;
            var e = event.originalEvent || event;
            var leftWidth;
            var ratio;

            if (drag === null) {
                return;
            }

            leftWidth = drag.leftAtStart + (e.clientX - drag.startX);
            ratio = leftWidth / drag.availableWidth;
            _this.applyColumnSplitRatio(ratio, false);

            event.preventDefault();
        },

        onColumnSplitterMouseUp: function (event) {
            var _this = event.data.self;

            if (_this.columnSplitterDrag === null) {
                return;
            }

            _this.columnSplitterDrag = null;
            $('#layout').removeClass('column-resizing');
            $('#col-splitter').removeClass('dragging');
            $(document).off('.icingaColumnSplitter');
            _this.saveColumnSplitRatio();

            event.preventDefault();
        },

        saveColumnSplitRatio: function () {
            var ratio;

            if (this.columnSplitterStorage === null) {
                return;
            }

            ratio = this.getCurrentColumnSplitRatio();
            if (ratio === null) {
                this.columnSplitterStorage.remove(this.columnSplitterStorageKey);
                return;
            }

            this.columnSplitterStorage.set(this.columnSplitterStorageKey, ratio);
        },

        loadColumnSplitRatio: function () {
            var ratio;

            if (this.columnSplitterStorage === null) {
                return null;
            }

            ratio = this.columnSplitterStorage.get(this.columnSplitterStorageKey);
            if (typeof ratio !== 'number') {
                return null;
            }

            return ratio;
        },

        getCurrentColumnSplitRatio: function () {
            var $main = $('#main');
            var $col1 = $('#col1');
            var splitterWidth = $('#col-splitter').outerWidth() || 0;
            var availableWidth = ($main.innerWidth() || 0) - splitterWidth;

            if (availableWidth <= 0 || this.isOneColLayout()) {
                return null;
            }

            return this.normalizeColumnSplitRatio(($col1.outerWidth() || 0) / availableWidth);
        },

        normalizeColumnSplitRatio: function (ratio) {
            if (typeof ratio !== 'number' || isNaN(ratio)) {
                return null;
            }

            if (ratio < this.columnSplitRatioMin) {
                return this.columnSplitRatioMin;
            }

            if (ratio > this.columnSplitRatioMax) {
                return this.columnSplitRatioMax;
            }

            return ratio;
        },

        applyStoredColumnSplitRatio: function () {
            var ratio = this.loadColumnSplitRatio();

            if (ratio === null) {
                this.resetColumnSplitStyles();
                return;
            }

            this.applyColumnSplitRatio(ratio, false);
        },

        applyColumnSplitRatio: function (ratio, persist) {
            var normalizedRatio = this.normalizeColumnSplitRatio(ratio);
            var left;
            var right;

            if (normalizedRatio === null || this.isOneColLayout() || this.hasOnlyOneColumn()) {
                return;
            }

            left = (normalizedRatio * 100).toFixed(4) + '%';
            right = ((1 - normalizedRatio) * 100).toFixed(4) + '%';

            $('#col1').css('flex', '0 0 ' + left);
            $('#col2').css('flex', '0 0 ' + right);
            $('#col-splitter').attr('aria-valuenow', Math.round(normalizedRatio * 100));

            if (persist) {
                this.saveColumnSplitRatio();
            }
        },

        resetColumnSplitStyles: function () {
            $('#col1').css('flex', '');
            $('#col2').css('flex', '');
            $('#col-splitter').removeAttr('aria-valuenow').removeClass('dragging');
            $('#layout').removeClass('column-resizing');
            this.columnSplitterDrag = null;
            $(document).off('.icingaColumnSplitter');
        },

        prepareColumnFor: function ($el, $target) {
            var explicitTarget;

            if ($target.attr('id') === 'col2') {
                if ($el.closest('#col2').length) {
                    explicitTarget = $el.closest('[data-base-target]').data('baseTarget');
                    if (typeof explicitTarget !== 'undefined' && explicitTarget === '_next') {
                        this.moveToLeft();
                    }
                } else {
                    this.layout2col();
                }
            } else { // if ($target.attr('id') === 'col1')
                explicitTarget = $el.closest('[data-base-target]').data('baseTarget');
                if (typeof explicitTarget !== 'undefined' && explicitTarget === '_main') {
                    this.layout1col();
                }
            }
        },

        getAvailableColumnSpace: function () {
            return $('#main').width() / this.getDefaultFontSize();
        },

        setColumnCount: function (count) {
            if (count === 3) {
                $('#main > .container').css({
                    width: '33.33333%'
                });
            } else if (count === 2) {
                $('#main > .container').css({
                    width: '50%'
                });
            } else {
                $('#main > .container').css({
                    width: '100%'
                });
            }
        },

        setTitle: function (title) {
            document.title = title;
            return this;
        },

        getColumnCount: function () {
            return $('#main > .container').length;
        },

        /**
         * Assign a unique ID to each .container without such
         *
         * This usually applies to dashlets
         */
        assignUniqueContainerIds: function() {
            var currentMax = 0;
            $('.container').each(function() {
                var $el = $(this);
                var m;
                if (!$el.attr('id')) {
                    return;
                }
                if (m = $el.attr('id').match(/^ciu_(\d+)$/)) {
                    if (parseInt(m[1]) > currentMax) {
                         currentMax = parseInt(m[1]);
                    }
                }
            });
            $('.container').each(function() {
                var $el = $(this);
                if (!!$el.attr('id')) {
                    return;
                }
                currentMax++;
                $el.attr('id', 'ciu_' + currentMax);
            });
        },

        refreshDebug: function () {
            if (! this.debug) {
                return;
            }

            var size = this.getDefaultFontSize().toString();
            var winWidth = $( window ).width();
            var winHeight = $( window ).height();
            var loading = '';

            $.each(this.icinga.loader.requests, function (el, req) {
                if (loading === '') {
                    loading = '<br />Loading:<br />';
                }
                loading += el + ' => ' + encodeURI(req.url);
            });

            $('#responsive-debug').html(
                '   Time: ' +
                this.icinga.utils.formatHHiiss(new Date()) +
                '<br />    1em: ' +
                size +
                'px<br />    Win: ' +
                winWidth +
                'x'+
                winHeight +
                'px<br />' +
                ' Layout: ' +
                this.currentLayout +
                loading
            );
        },

        createFontSizeCalculator: function () {
            var $el = $('<div id="fontsize-calc">&nbsp;</div>');
            $('#layout').append($el);
            return $el;
        },

        getDefaultFontSize: function () {
            var $calc = $('#fontsize-calc');
            if (! $calc.length) {
                $calc = this.createFontSizeCalculator();
            }
            return $calc.width() / 1000;
        },

        isEditableTarget: function(target) {
            if (! target || target.nodeType !== 1) {
                return false;
            }

            var $target = $(target);

            return $target.is('input, textarea, select, button')
                || $target.is('[contenteditable]')
                || $target.closest('[contenteditable]').length > 0;
        },

        handleGlobalShortcuts: function(event) {
            var _this = event.data.self;
            var key = event.key || '';

            if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }

            if ((key === '/' || event.code === 'Slash') && ! _this.isEditableTarget(event.target)) {
                if (_this.focusSearchField()) {
                    event.preventDefault();
                }
                return;
            }

            if (key === 'Escape') {
                _this.setMobileMenuExpanded(false);

                var $search = $('#search');
                if ($search.length && document.activeElement === $search[0]) {
                    $search.trigger('blur');
                }
            }
        },

        focusSearchField: function() {
            var $search = $('#search').first();
            if (! $search.length) {
                return false;
            }

            if (this.currentLayout === 'minimal') {
                this.setMobileMenuExpanded(true);
            }

            $search.trigger('focus');
            $search[0].select();
            return true;
        },

        getSearchHistoryKey: function() {
            return 'menu-search-history';
        },

        readSearchHistory: function() {
            var history = [];

            try {
                var raw = window.sessionStorage.getItem(this.getSearchHistoryKey());
                history = raw ? JSON.parse(raw) : [];
            } catch (error) {
                history = [];
            }

            return Array.isArray(history) ? history : [];
        },

        writeSearchHistory: function(history) {
            try {
                window.sessionStorage.setItem(this.getSearchHistoryKey(), JSON.stringify(history));
            } catch (error) {
                // Ignore storage failures (private mode, disabled storage, quota limits)
            }
        },

        rememberSearchQuery: function(event) {
            var _this = event.data.self;
            var $input = $(event.currentTarget).find('#search').first();
            var value;
            var history;

            if (! $input.length) {
                return;
            }

            value = $.trim($input.val());
            if (! value.length) {
                return;
            }

            history = _this.readSearchHistory().filter(function (entry) {
                return entry !== value;
            });
            history.unshift(value);
            history = history.slice(0, 8);

            _this.writeSearchHistory(history);
            _this.populateSearchHistory(event);
        },

        populateSearchHistory: function(event) {
            var _this = event.data.self;
            var $list = $('#search-history-list');
            var history = _this.readSearchHistory();
            var options = [];

            if (! $list.length) {
                return;
            }

            for (var i = 0; i < history.length; i++) {
                options.push('<option value="' + _this.icinga.utils.escape(history[i]) + '"></option>');
            }

            $list.html(options.join(''));
        },

        setMobileMenuExpanded: function(expanded) {
            var $sidebar = $('#sidebar');
            var $toggle = $('#mobile-menu-toggle > button').first();
            var isExpanded = !! expanded;

            $sidebar.toggleClass('expanded', isExpanded);

            if ($toggle.length) {
                $toggle.attr('aria-expanded', isExpanded ? 'true' : 'false');
            }
        },

        /**
         * Toggle mobile menu
         *
         * @param {object} e Event
         */
        toggleMobileMenu: function(e) {
            var _this = e && e.data && e.data.self ? e.data.self : null;
            var isExpanded = ! $('#sidebar').hasClass('expanded');

            if (_this) {
                _this.setMobileMenuExpanded(isExpanded);
            } else {
                $('#sidebar').toggleClass('expanded', isExpanded);
            }

            if (isExpanded) {
                var $search = $('#search').first();
                if ($search.length) {
                    window.setTimeout(function() {
                        $search.trigger('focus');
                    }, 0);
                }
            }
        },

        /**
         * Close mobile menu when the enter key is pressed during search or the user leaves the sidebar
         *
         * @param {object} e Event
         */
        closeMobileMenu: function(e) {
            if (e.data.self.currentLayout !== 'minimal') {
                return;
            }

            if (e.data.type === 'key') {
                if (e.which === 13 || e.which === 27 || e.key === 'Escape') {
                    e.data.self.setMobileMenuExpanded(false);
                    $(e.target)[0].blur();
                }
            } else {
                e.data.self.setMobileMenuExpanded(false);
            }
        },

        toggleFullscreen: function () {
            $('#layout').toggleClass('fullscreen-layout');
        },

        getUniqueContainerId: function (container) {
            if (typeof container.jquery !== 'undefined') {
                if (! container.length) {
                    return null;
                }

                container = container[0];
            } else if (typeof container === 'undefined') {
                return null;
            }

            var containerId = container.dataset.icingaContainerId || null;
            if (containerId === null) {
                /**
                 * Only generate an id if it's not for col1 or the menu (which are using the non-suffixed window id).
                 * This is based on the assumption that the server only knows about the menu and first column
                 * and therefore does not need to protect its ids. (As the menu is most likely part of the sidebar)
                 */
                var col1 = document.getElementById('col1');
                if (container.id !== 'menu' && col1 !== null && ! col1.contains(container)) {
                    containerId = this.icinga.utils.generateId(6); // Random because the content may move
                    container.dataset.icingaContainerId = containerId;
                }
            }

            return containerId;
        },

        getWindowId: function () {
            if (! this.hasWindowId()) {
                return undefined;
            }
            return window.name.match(/^Icinga-([a-zA-Z0-9]+)$/)[1];
        },

        hasWindowId: function () {
            var res = window.name.match(/^Icinga-([a-zA-Z0-9]+)$/);
            return typeof res === 'object' && null !== res;
        },

        setWindowId: function (id) {
            this.icinga.logger.debug('Setting new window id', id);
            window.name = 'Icinga-' + id;
        },

        destroy: function () {
            // This is gonna be hard, clean up the mess
            this.icinga = null;
            this.debugTimer = null;
        }
    };

}(Icinga, jQuery));
