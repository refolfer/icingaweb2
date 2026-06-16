(function () {
  'use strict';

  const app = document.querySelector('[data-ollama-app]');

  if (!app) {
    return;
  }

  const state = {
    messages: [],
    abortController: null
  };

  const endpoint = app.dataset.endpoint || '/ollama-chat/api/chat';
  const storageKey = 'ollama-chat:conversation:v1';
  const modelInput = app.querySelector('[data-model]');
  const systemPromptInput = app.querySelector('[data-system-prompt]');
  const chat = app.querySelector('[data-chat]');
  const form = app.querySelector('[data-form]');
  const input = app.querySelector('[data-input]');
  const sendButton = app.querySelector('[data-send]');
  const stopButton = app.querySelector('[data-stop]');
  const resetButton = app.querySelector('[data-reset]');
  const copyButton = app.querySelector('[data-copy]');
  const exampleButtons = Array.from(app.querySelectorAll('[data-example]'));
  const modelPalette = app.querySelector('[data-model-palette]');
  const promptPalette = app.querySelector('[data-prompt-palette]');
  const refreshModelsButton = app.querySelector('[data-refresh-models]');
  const modelStatus = app.querySelector('[data-model-status]');

  const promptPresets = [
    {
      id: 'helpful',
      label: 'Helpful',
      prompt: 'You are a helpful assistant. Answer clearly, stay concise, and be practical.'
    },
    {
      id: 'concise',
      label: 'Concise',
      prompt: 'Answer in a short, direct way. Prefer bullets when they improve clarity.'
    },
    {
      id: 'report',
      label: 'Report writer',
      prompt: 'Write structured summaries with a clear headline, short sections, and actionable next steps.'
    },
    {
      id: 'planner',
      label: 'Planner',
      prompt: 'Help plan work step by step. Break the answer into a concise sequence of actions.'
    },
    {
      id: 'chart',
      label: 'Chart helper',
      prompt: 'When the user asks for a chart or report, suggest the best chart type, required data, and a simple way to present it.'
    }
  ];

  const defaultSystemPrompt = systemPromptInput ? systemPromptInput.value.trim() : '';
  const defaultModel = modelInput ? modelInput.value.trim() : 'qwen2.5:1.5b';
  const fallbackModels = [defaultModel];
  let availableModels = [];

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed.messages)) {
        state.messages = parsed.messages.filter((message) => message && typeof message.role === 'string' && typeof message.content === 'string');
      }

      if (modelInput && typeof parsed.model === 'string' && parsed.model.trim()) {
        modelInput.value = parsed.model;
      }

      if (systemPromptInput && typeof parsed.systemPrompt === 'string') {
        systemPromptInput.value = parsed.systemPrompt;
      }
    } catch (error) {
      console.warn('Failed to restore Ollama chat state', error);
    }
  }

  function persistState() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          messages: state.messages,
          model: modelInput ? modelInput.value.trim() : defaultModel,
          systemPrompt: systemPromptInput ? systemPromptInput.value : defaultSystemPrompt
        })
      );
    } catch (error) {
      console.warn('Failed to persist Ollama chat state', error);
    }
  }

  function getCurrentModel() {
    return modelInput ? modelInput.value.trim() || defaultModel : defaultModel;
  }

  function getCurrentSystemPrompt() {
    return systemPromptInput ? systemPromptInput.value.trim() : '';
  }

  function setModel(value) {
    if (!modelInput) {
      return;
    }

    modelInput.value = value.trim();
    persistState();
    renderModelPalette();
  }

  function setSystemPrompt(value) {
    if (!systemPromptInput) {
      return;
    }

    systemPromptInput.value = value;
    persistState();
    renderPromptPalette();
  }

  function renderModelPalette() {
    if (!modelPalette) {
      return;
    }

    const models = [];
    const seen = new Set();

    [getCurrentModel(), ...availableModels, ...fallbackModels].forEach((model) => {
      const name = String(model || '').trim();

      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      models.push(name);
    });

    modelPalette.innerHTML = '';

    if (!models.length) {
      const empty = document.createElement('div');
      empty.className = 'ollama-palette__note';
      empty.textContent = 'No local models found yet.';
      modelPalette.appendChild(empty);
      return;
    }

    models.forEach((model) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `button button--compact${model === getCurrentModel() ? ' button--active' : ''}`;
      button.textContent = model;
      button.dataset.modelName = model;
      button.addEventListener('click', () => setModel(model));
      modelPalette.appendChild(button);
    });
  }

  function renderPromptPalette() {
    if (!promptPalette) {
      return;
    }

    const currentPrompt = getCurrentSystemPrompt();

    promptPalette.innerHTML = '';

    promptPresets.forEach((preset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ollama-chip${currentPrompt === preset.prompt ? ' ollama-chip--active' : ''}`;
      button.textContent = preset.label;
      button.dataset.presetId = preset.id;
      button.title = preset.prompt;
      button.addEventListener('click', () => {
        setSystemPrompt(preset.prompt);
      });
      promptPalette.appendChild(button);
    });
  }

  function updateModelStatus(text) {
    if (modelStatus) {
      modelStatus.textContent = text;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMessage(content) {
    return escapeHtml(content).replace(/\n/g, '<br>');
  }

  function setBusy(isBusy) {
    if (sendButton) {
      sendButton.disabled = isBusy;
    }

    if (stopButton) {
      stopButton.hidden = !isBusy;
    }

    if (input) {
      input.disabled = isBusy;
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chat.scrollTop = chat.scrollHeight;
    });
  }

  function createMessageElement(message) {
    const wrapper = document.createElement('article');
    wrapper.className = `ollama-message ollama-message--${message.role}`;

    const label = document.createElement('div');
    label.className = 'ollama-message__label';
    label.textContent = message.role === 'user' ? 'You' : 'Ollama';

    const bubble = document.createElement('div');
    bubble.className = 'ollama-message__bubble';
    bubble.innerHTML = formatMessage(message.content);

    wrapper.append(label, bubble);
    return wrapper;
  }

  function renderChat() {
    chat.innerHTML = '';

    if (!state.messages.length) {
      const empty = document.createElement('div');
      empty.className = 'ollama-message ollama-message--assistant';
      empty.innerHTML = `
        <div class="ollama-message__label">Ollama</div>
        <div class="ollama-message__bubble">
          Start with a question, ask for a report, or request a chart. The conversation stays local to this host.
        </div>
      `;
      chat.appendChild(empty);
      return;
    }

    state.messages.forEach((message) => {
      chat.appendChild(createMessageElement(message));
    });

    scrollToBottom();
  }

  function buildMessagesForRequest() {
    const systemPrompt = systemPromptInput ? systemPromptInput.value.trim() : '';
    const messages = [];
    const conversation = state.messages.filter((message, index) => {
      return !(index === state.messages.length - 1
        && message.role === 'assistant'
        && message.content === '...');
    });

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    conversation.forEach((message) => {
      messages.push({ role: message.role, content: message.content });
    });

    return messages;
  }

  function getTranscript() {
    return state.messages
      .map((message) => {
        const speaker = message.role === 'user' ? 'You' : 'Ollama';
        return `${speaker}: ${message.content}`;
      })
      .join('\n\n');
  }

  async function submitMessage(rawText) {
    const text = rawText.trim();

    if (!text) {
      return;
    }

    if (state.abortController) {
      state.abortController.abort();
    }

    state.messages.push({ role: 'user', content: text });
    renderChat();
    persistState();
    setBusy(true);

    const assistantMessage = { role: 'assistant', content: '...' };
    state.messages.push(assistantMessage);
    renderChat();

    const controller = new AbortController();
    state.abortController = controller;

    try {
      const requestMessages = buildMessagesForRequest();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: getCurrentModel(),
          messages: requestMessages,
          stream: false
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const content = payload?.message?.content
        || payload?.choices?.[0]?.message?.content
        || payload?.response
        || 'No response received.';

      assistantMessage.content = String(content).trim() || 'No response received.';
      persistState();
      renderChat();
    } catch (error) {
      if (error && error.name === 'AbortError') {
        assistantMessage.content = 'Request cancelled.';
      } else {
        assistantMessage.content = `Error: ${error && error.message ? error.message : 'Unable to reach Ollama.'}`;
      }

      persistState();
      renderChat();
    } finally {
      if (state.abortController === controller) {
        state.abortController = null;
      }

      setBusy(false);
    }
  }

  function resetConversation() {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }

    state.messages = [];

    if (modelInput) {
      modelInput.value = defaultModel;
    }

    if (systemPromptInput) {
      systemPromptInput.value = defaultSystemPrompt;
    }

    localStorage.removeItem(storageKey);
    setBusy(false);
    renderChat();
    renderModelPalette();
    renderPromptPalette();
  }

  async function copyConversation() {
    const text = getTranscript() || 'Conversation is empty.';

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const helper = document.createElement('textarea');
        helper.value = text;
        helper.setAttribute('readonly', 'readonly');
        helper.style.position = 'absolute';
        helper.style.left = '-9999px';
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        helper.remove();
      }
      if (copyButton) {
        copyButton.textContent = 'Copied';
        window.setTimeout(() => {
          copyButton.textContent = 'Copy transcript';
        }, 1200);
      }
    } catch (error) {
      console.warn('Failed to copy transcript', error);
    }
  }

  loadState();
  renderChat();
  renderModelPalette();
  renderPromptPalette();

  async function loadAvailableModels() {
    updateModelStatus('Loading...');

    try {
      const response = await fetch('/ollama-chat/api/tags', {
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const models = Array.isArray(payload && payload.models)
        ? payload.models
            .map((item) => item && item.name)
            .filter((name) => typeof name === 'string' && name.trim())
        : [];

      availableModels = models;

      if (modelStatus) {
        modelStatus.textContent = models.length ? `${models.length} local models` : 'No local models found';
      }

      renderModelPalette();
    } catch (error) {
      console.warn('Failed to load Ollama models', error);
      updateModelStatus('Using current model');
      renderModelPalette();
    }
  }

  loadAvailableModels();

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitMessage(input ? input.value : '');
      if (input) {
        input.value = '';
        input.focus();
      }
    });
  }

  if (resetButton) {
    resetButton.addEventListener('click', resetConversation);
  }

  if (copyButton) {
    copyButton.addEventListener('click', copyConversation);
  }

  if (stopButton) {
    stopButton.addEventListener('click', () => {
      if (state.abortController) {
        state.abortController.abort();
      }
    });
  }

  exampleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (input) {
        input.value = button.dataset.example || '';
        input.focus();
      }
    });
  });

  if (modelInput) {
    modelInput.addEventListener('change', () => {
      persistState();
      renderModelPalette();
    });
    modelInput.addEventListener('input', () => {
      persistState();
      renderModelPalette();
    });
  }

  if (systemPromptInput) {
    systemPromptInput.addEventListener('change', () => {
      persistState();
      renderPromptPalette();
    });
    systemPromptInput.addEventListener('input', () => {
      persistState();
      renderPromptPalette();
    });
  }

  if (refreshModelsButton) {
    refreshModelsButton.addEventListener('click', loadAvailableModels);
  }
})();
