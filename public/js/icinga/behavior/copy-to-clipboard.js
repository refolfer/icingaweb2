// SPDX-FileCopyrightText: 2023 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

(function (Icinga) {

    "use strict";

    try {
        var CopyToClipboard = require('icinga/icinga-php-library/widget/CopyToClipboard');
    } catch (e) {
        console.warn('Unable to provide copy to clipboard feature. Libraries not available:', e);
        return;
    }

    class CopyToClipboardBehavior extends Icinga.EventListener {
        constructor(icinga)
        {
            super(icinga);

            this.on('rendered', '#main > .container, #layout', this.onRendered, this);
            this.on('click', '[data-icinga-clipboard]', this.onCopyClick, this);

            /**
             * Clipboard buttons
             *
             * @type {WeakMap<object, CopyToClipboard>}
             * @private
             */
            this._clipboards = new WeakMap();
            this._copyNoticeTimers = new WeakMap();
        }

        onRendered(event)
        {
            if (event.currentTarget !== event.target) {
                return;
            }

            let _this = event.data.self;

            event.currentTarget.querySelectorAll('[data-icinga-clipboard]').forEach(button => {
                _this._clipboards.set(button, new CopyToClipboard(button));

                if (button.dataset.icingaClipboardFeedbackBound) {
                    return;
                }

                button.addEventListener('copied', function () {
                    _this.clearFallbackNotice(button);
                    _this.createCopyNotice(button, true);
                });

                button.addEventListener('copyerror', function () {
                    _this.clearFallbackNotice(button);
                    _this.createCopyNotice(button, false);
                });

                button.dataset.icingaClipboardFeedbackBound = '1';
            });
        }

        onCopyClick(event)
        {
            let _this = event.data.self;
            let button = event.currentTarget;

            _this.clearFallbackNotice(button);

            _this._copyNoticeTimers.set(button, window.setTimeout(function () {
                _this.createCopyNotice(button, true);
                _this._copyNoticeTimers.delete(button);
            }, 150));
        }

        clearFallbackNotice(button)
        {
            if (! this._copyNoticeTimers.has(button)) {
                return;
            }

            window.clearTimeout(this._copyNoticeTimers.get(button));
            this._copyNoticeTimers.delete(button);
        }

        createCopyNotice(button, success)
        {
            let severity = success ? 'success' : 'error';
            let fallbackLabel = success ? 'Copied to clipboard' : 'Could not copy to clipboard';
            let labelKey = success ? 'copiedLabel' : 'copyFailedLabel';
            let message = button.dataset[labelKey] || fallbackLabel;

            this.icinga.loader.createNotice(severity, message);
        }
    }

    Icinga.Behaviors = Icinga.Behaviors || {};

    Icinga.Behaviors.CopyToClipboardBehavior = CopyToClipboardBehavior;
})(Icinga);
