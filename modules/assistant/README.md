# Assistant module

This module contains the Icinga Web 2 AI assistant, natural language search, and the standalone Ollama chat source files.

## What is included

- `application/controllers/AssistantController.php` for the AI search UI and API
- `library/Assistant/` for the assistant, translator, and LLM client logic
- `public/ollama-chat/` for the standalone Ollama chat page assets inside this module
- `doc/assistant.ini.example` for local LLM configuration

## Configuration

The assistant uses the `assistant` config section and environment variables such as:

- `ICINGAWEB_ASSISTANT_API_KEY`
- `ICINGAWEB_ASSISTANT_BASE_URL`
- `ICINGAWEB_ASSISTANT_ENDPOINT`
- `ICINGAWEB_ASSISTANT_MODEL`
- `ICINGAWEB_ASSISTANT_TEMPERATURE`
- `ICINGAWEB_ASSISTANT_TIMEOUT`

## Standalone Ollama chat

The standalone Ollama chat files live in `modules/assistant/public/ollama-chat/`.
If you want to serve the page directly from nginx, copy that directory into the webroot
or point nginx to the module assets directory.
