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
        var text = el('div', 'assistant-message__text');
        text.textContent = body;
        content.appendChild(text);
        message.appendChild(heading);
        message.appendChild(content);
        chat.appendChild(message);
        chat.scrollTop = chat.scrollHeight;
        return {
            root: message,
            body: text,
            meta: content
        };
    }

    function clearChildren(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function renderAction(node, action, config) {
        if (! action || ! action.url) {
            return;
        }

        var label = action.label || (action.type === 'report' ? (config.labels.openReport || 'Create report') : (action.type === 'search' ? (config.labels.openSearch || 'Open search results') : (config.labels.openView || 'Open result')));
        var link = el('a', 'button assistant-open-search', label);
        link.href = action.url;
        link.target = '_top';
        if (action.type) {
            link.setAttribute('data-assistant-action-type', action.type);
        }
        node.appendChild(link);
    }

    function renderFollowUps(node, followUps, config, onClick) {
        if (! followUps || ! followUps.length) {
            return;
        }

        var label = el('div', 'assistant-response__meta-label', config.labels.followUp || 'Follow-up');
        node.appendChild(label);

        for (var i = 0; i < followUps.length; i++) {
            if (typeof followUps[i] === 'string') {
                (function (text) {
                    var list = el('div', 'assistant-followups');
                    var button = el('button', 'assistant-followup', text);
                    button.type = 'button';
                    button.addEventListener('click', function () {
                        onClick(text, false);
                    });
                    list.appendChild(button);
                    node.appendChild(list);
                })(followUps[i]);
                continue;
            }

            if (! followUps[i] || typeof followUps[i] !== 'object' || ! followUps[i].question || ! followUps[i].options) {
                continue;
            }

            (function (group) {
                var question = el('div', 'assistant-followup-group__question', group.question);
                var list = el('div', 'assistant-followups assistant-followups--group');
                node.appendChild(question);
                node.appendChild(list);

                for (var j = 0; j < group.options.length; j++) {
                    if (! group.options[j] || ! group.options[j].message) {
                        continue;
                    }

                    (function (option) {
                        var button = el('button', 'assistant-followup', option.label || option.message);
                        button.type = 'button';
                        button.addEventListener('click', function () {
                            onClick(option.message, true);
                        });
                        list.appendChild(button);
                    })(group.options[j]);
                }
            })(followUps[i]);
        }
    }

    function sendRequest(endpoint, message, history, done, fail) {
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
        xhr.send(
            'message=' + encodeURIComponent(message) +
            '&history=' + encodeURIComponent(JSON.stringify(history || []))
        );
    }

    function appendSuggestionToInput(input, text) {
        var current;
        var normalizedCurrent;
        var normalizedText;

        if (! input) {
            return;
        }

        current = (input.value || '').trim();
        normalizedCurrent = current.toLowerCase();
        normalizedText = (text || '').trim();

        if (! normalizedText) {
            return;
        }

        if (! current) {
            input.value = normalizedText;
            return;
        }

        if (normalizedCurrent.indexOf(normalizedText.toLowerCase()) !== -1) {
            input.value = current;
            return;
        }

        input.value = current + '\n' + normalizedText;
    }

    function initAssistant(root) {
        var config = parseConfig(root);
        var chat = root.querySelector('[data-assistant-chat]') || root.querySelector('.assistant-chat');
        var form = root.querySelector('[data-assistant-form]');
        var input = root.querySelector('[data-assistant-input]');
        var submit = root.querySelector('[data-assistant-submit]');
        var examples = root.querySelectorAll('[data-assistant-example]');
        var busy = false;
        var history = [];

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

        function addHistory(role, content) {
            history.push({
                role: role,
                content: content
            });
            if (history.length > 12) {
                history = history.slice(history.length - 12);
            }
        }

        function renderAssistantPayload(pending, data) {
            var reply = data && data.message ? data.message : (config.labels.empty || 'Type a request and I will answer in context.');
            pending.body.textContent = reply;
            clearChildren(pending.meta);
            pending.meta.appendChild(pending.body);

            if (data && data.mode) {
                pending.meta.setAttribute('data-assistant-mode', data.mode);
            }

            if (data && data.actions && data.actions.length) {
                var actions = el('div', 'assistant-response__actions');
                for (var i = 0; i < data.actions.length; i++) {
                    var action = data.actions[i];
                    if (! action || ! action.url) {
                        continue;
                    }
                    renderAction(actions, action, config);
                }
                if (actions.children.length) {
                    pending.meta.appendChild(actions);
                }
            } else if (data && data.openUrl) {
                renderAction(pending.meta, {
                    type: data.reportUrl ? 'report' : (data.searchUrl ? 'search' : 'open'),
                    label: data.reportUrl ? (config.labels.openReport || 'Create report') : (data.searchUrl ? (config.labels.openSearch || 'Open search results') : (config.labels.openView || 'Open result')),
                    url: data.openUrl
                }, config);
            }

            if (data && data.followUps && data.followUps.length) {
                renderFollowUps(pending.meta, data.followUps, config, function (text) {
                    appendSuggestionToInput(input, text);
                    input.focus();
                });
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
            addHistory('user', text);
            setBusy(true);

            var pending = appendMessage(chat, 'assistant', 'Assistant', config.labels.thinking || 'Thinking...');
            sendRequest(config.endpoint, text, history, function (response) {
                var data = response && response.data ? response.data : null;
                if (data && data.message) {
                    addHistory('assistant', data.message);
                }
                renderAssistantPayload(pending, data);
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
