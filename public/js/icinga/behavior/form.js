// SPDX-FileCopyrightText: 2018 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Controls behavior of form elements, depending reload and
 */
(function(Icinga, $) {

    "use strict";

    Icinga.Behaviors = Icinga.Behaviors || {};

    var Form = function (icinga) {
        Icinga.EventListener.call(this, icinga);
        this.on('rendered', '.container', this.onRendered, this);
        this.on('input change', '.container form input, .container form select, .container form textarea', this.onInputChange, this);
        this.on('submit', '.container form', this.onSubmit, this);

        this.priority = 1;

        // store the modification state of all input fields
        this.inputs = new WeakMap();
        this.dirtyForms = new WeakMap();

        this.beforeUnloadHandler = this.onBeforeUnload.bind(this);
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
    };
    Form.prototype = new Icinga.EventListener();

    /**
     * @param event
     */
    Form.prototype.onRendered = function (event) {
        var _this = event.data.self;
        var container = event.target;

        container.querySelectorAll('form').forEach(function (form) {
            _this.dirtyForms.set(form, false);
            delete form.dataset.icingaFormSubmitted;

            form.querySelectorAll('input, select, textarea').forEach(function (input) {
                if (! _this.inputs.has(input) && _this.isTrackableInput(input)) {
                    var value = _this.getFieldValue(input);
                    _this.inputs.set(input, value);
                    _this.icinga.logger.debug('registering "' + value + '" as original input value');
                }
            });
        });
    };

    Form.prototype.isTrackableInput = function(input) {
        if (input.disabled || input.readOnly) {
            return false;
        }

        if (input.tagName === 'INPUT') {
            switch (input.type) {
                case 'hidden':
                case 'button':
                case 'submit':
                case 'reset':
                case 'image':
                case 'file':
                    return false;
            }
        }

        return true;
    };

    Form.prototype.getFieldValue = function(input) {
        if (input.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio')) {
            return input.checked ? '1' : '0';
        }

        return input.value;
    };

    Form.prototype.onInputChange = function(event) {
        var _this = event.data.self;
        var input = event.currentTarget;
        var form = input.form;

        if (! form || ! _this.isTrackableInput(input)) {
            return;
        }

        if (! _this.inputs.has(input)) {
            _this.inputs.set(input, _this.getFieldValue(input));
        }

        _this.updateDirtyState(form);
    };

    Form.prototype.updateDirtyState = function(form) {
        var _this = this;
        var dirty = false;

        form.querySelectorAll('input, select, textarea').forEach(function (input) {
            if (! _this.isTrackableInput(input) || ! _this.inputs.has(input)) {
                return;
            }

            if (_this.inputs.get(input) !== _this.getFieldValue(input)) {
                dirty = true;
            }
        });

        this.dirtyForms.set(form, dirty);
        form.dataset.icingaFormDirty = dirty ? '1' : '0';
    };

    Form.prototype.onSubmit = function(event) {
        var _this = event.data.self;
        var form = event.currentTarget;

        _this.dirtyForms.set(form, false);
        delete form.dataset.icingaFormDirty;
        form.dataset.icingaFormSubmitted = '1';

        form.querySelectorAll('input, select, textarea').forEach(function (input) {
            if (_this.isTrackableInput(input)) {
                _this.inputs.set(input, _this.getFieldValue(input));
            }
        });
    };

    Form.prototype.hasDirtyForms = function() {
        var _this = this;
        var dirty = false;

        document.querySelectorAll('.container form').forEach(function (form) {
            if (form.dataset.icingaFormSubmitted === '1' || form.getAttribute('role') === 'search') {
                return;
            }

            if (_this.dirtyForms.get(form)) {
                dirty = true;
            }
        });

        return dirty;
    };

    Form.prototype.onBeforeUnload = function(event) {
        if (! this.hasDirtyForms()) {
            return;
        }

        event.preventDefault();
        event.returnValue = '';
    };

    /**
     * Mutates the HTML before it is placed in the DOM after a reload
     *
     * @param content       {String}    The content to be rendered
     * @param $container    {jQuery}    The target container where the html will be rendered in
     * @param action        {String}    The action-url that caused the reload
     * @param autorefresh   {Boolean}   Whether the rendering is due to an autoRefresh
     * @param autoSubmit    {Boolean}   Whether the rendering is due to an autoSubmit
     *
     * @returns {string|NULL}           The content to be rendered, or NULL, when nothing should be changed
     */
    Form.prototype.renderHook = function(content, $container, action, autorefresh, autoSubmit) {
        if ($container.attr('id') === 'menu') {
            var $search = $container.find('#search');
            if ($search[0] === document.activeElement) {
                return null;
            }
            if ($search.length) {
                var $content = $('<div></div>').append(content);
                $content.find('#search').attr('value', $search.val()).addClass('active');
                return $content.html();
            }
            return content;
        }

        if (! autorefresh || autoSubmit) {
            return content;
        }

        var _this = this;
        var changed = false;
        $container[0].querySelectorAll('form input').forEach(function (input) {
            if (_this.inputs.has(input) && _this.inputs.get(input) !== input.value) {
                changed = true;
                _this.icinga.logger.debug(
                    '"' + _this.inputs.get(input) + '" was changed ("' + input.value + '") and aborts reload...'
                );
            }
        });
        if (changed) {
            return null;
        }

        const origFocus = document.activeElement;
        const containerId = $container.attr('id');
        if ($container[0].contains(origFocus)
            && origFocus.form
            && ! origFocus.matches(
                'input[type=submit], input[type=reset], input[type=button]'
                + ', button[type=submit], button[type=reset], button[type=button]'
                + ', .autosubmit:not(:hover)'
            )
        ) {
            this.icinga.logger.debug('Not changing content for ' + containerId + ' form has focus');
            return null;
        }

        return content;
    };

    Form.prototype.destroy = function() {
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    };

    Icinga.Behaviors.Form = Form;

}) (Icinga, jQuery);
