# Ollama Standalone Chat

This repository includes a standalone chat page that can be served directly by nginx, without going through Icinga Web 2 routing or controllers.

The page lives under `/ollama-chat/` and is backed by a local Ollama instance on `127.0.0.1:11434`.

## What it provides

- A dedicated chat UI at `/ollama-chat/`
- Local-only backend access through nginx proxying
- Conversation memory in the browser
- Reset, stop, and copy actions
- A simple model selector
- One-click prompt presets for common chat styles
- Local model discovery through Ollama's `/api/tags`
- A default `balanced` profile based on `qwen3:1.7b`
- Quick model tiers such as `fast`, `balanced`, and `quality`

## File layout

- `public/ollama-chat/index.html`
- `public/ollama-chat/ollama-chat.css`
- `public/ollama-chat/ollama-chat.js`

## nginx configuration

Add the following locations to the nginx server block that serves Icinga Web 2:

```nginx
location = /ollama-chat {
  return 301 /ollama-chat/;
}

location ^~ /ollama-chat/ {
  try_files $uri $uri/ /ollama-chat/index.html;
}

location ^~ /ollama-chat/api/ {
  proxy_pass http://127.0.0.1:11434/api/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Port $server_port;
  proxy_set_header Connection "";
  proxy_read_timeout 600;
}
```

If you use separate HTTP and HTTPS server blocks, add the same locations to both.

## Ollama setup

Run Ollama on the same host and bind it to localhost only:

```ini
Environment=OLLAMA_HOST=127.0.0.1:11434
```

Then pull a model such as:

```bash
ollama pull qwen3:1.7b
```

Recommended local set for this server:

```bash
ollama pull qwen2.5:1.5b
ollama pull qwen3:1.7b
ollama pull qwen3:4b
```

Suggested usage:

- `fast`: `qwen2.5:1.5b`
- `balanced`: `qwen3:1.7b`
- `quality`: `qwen3:4b`

## Deployment steps

1. Copy the `public/ollama-chat/` directory to `/usr/share/icingaweb2/public/ollama-chat/` on the host.
2. Add the nginx locations above.
3. Reload nginx.
4. Open `http://192.168.56.106/ollama-chat/` or the HTTPS equivalent.

## Notes

This page is intentionally separate from the Icinga Web 2 assistant integration. It only exposes the standalone Ollama chat UI and the local proxy endpoint.
