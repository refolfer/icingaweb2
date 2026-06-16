// SPDX-FileCopyrightText: 2026 Icinga GmbH <https://icinga.com>
// SPDX-License-Identifier: GPL-3.0-or-later

(function (window, document) {
    'use strict';

    function parseConfig(root) {
        try {
            return JSON.parse(root.getAttribute('data-assistant-config') || '{}');
        } catch (error) {
            return {};
        }
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (typeof text === 'string') {
            node.textContent = text;
        }
        return node;
    }

    function appendMessage(chat, type, label, body) {
        var message = el('div', 'assistant-message assistant-message--' + type);
        var heading = el('div', 'assistant-message__label', label);
        var content = el('div', 'assistant-message__body');
        content.textContent = body;
        message.appendChild(heading);
        message.appendChild(content);
        chat.appendChild(message);
        chat.scrollTop = chat.scrollHeight;
        return {
            root: message,
            body: content
        };
    }

    function addLink(node, label, href) {
        var link = el('a', 'button assistant-open-search', label);
        link.href = href;
        link.target = '_top';
        node.appendChild(link);
    }

    function sendRequest(endpoint, message, done, fail) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', endpoint, true);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) {
                return;
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    done(JSON.parse(xhr.responseText));
                } catch (error) {
                    fail(error);
                }
            } else {
                fail(new Error('HTTP ' + xhr.status));
            }
        };
        xhr.send('message=' + encodeURIComponent(message));
    }

    function initAssistant(root) {
        var config = parseConfig(root);
        var chat = root.querySelector('[data-assistant-chat]');
        if (! chat) {
            chat = root.querySelector('.assistant-chat');
        }
        var form = root.querySelector('[data-assistant-form]');
        var input = root.querySelector('[data-assistant-input]');
        var submit = root.querySelector('[data-assistant-submit]');
        var examples = root.querySelectorAll('[data-assistant-example]');
        var busy = false;

        if (! chat || ! form || ! input) {
            return;
        }

        function setBusy(value) {
            busy = value;
            input.disabled = value;
            if (submit) {
                submit.disabled = value;
                submit.textContent = value ? (config.labels.thinking || 'Thinking...') : (config.labels.send || 'Ask');
            }
        }

        function submitMessage(message) {
            if (busy) {
                return;
            }

            var text = (message || '').trim();
            if (! text) {
                return;
            }

            appendMessage(chat, 'user', 'You', text);
            setBusy(true);

            var pending = appendMessage(chat, 'assistant', 'Assistant', config.labels.thinking || 'Thinking...');
            sendRequest(config.endpoint, text, function (response) {
                var data = response && response.data ? response.data : null;
                var reply = data && data.message ? data.message : (config.labels.empty || 'Type a request and I will translate it into a search query.');
                pending.body.textContent = reply;

                if (data && data.openUrl) {
                    addLink(pending.root, data.searchUrl ? (config.labels.openSearch || 'Open search results') : (config.labels.openView || 'Open result'), data.openUrl);
                }

                setBusy(false);
                input.value = '';
                input.focus();
            }, function () {
                pending.body.textContent = config.labels.error || 'Unable to reach the assistant.';
                setBusy(false);
            });
        }

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            submitMessage(input.value);
        });

        for (var i = 0; i < examples.length; i++) {
            examples[i].addEventListener('click', function () {
                input.value = this.getAttribute('data-assistant-example') || '';
                input.focus();
            });
        }

        if (chat.getAttribute('data-assistant-chat') !== null) {
            chat.setAttribute('data-assistant-chat', 'ready');
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        var roots = document.querySelectorAll('[data-assistant-root]');
        for (var i = 0; i < roots.length; i++) {
            initAssistant(roots[i]);
        }
    });
})(window, document);
