# Icinga Web 2

![Icinga Logo](https://icinga.com/wp-content/uploads/2014/06/icinga_logo.png)

1. [About](#about)
2. [License](#license)
3. [Installation](#installation)
4. [Documentation](#documentation)
5. [Support](#support)
6. [Contributing](#contributing)

## About

**Icinga Web 2** is the next generation open source monitoring web interface, framework
and command-line interface developed by the [Icinga GmbH](https://icinga.com/), supporting Icinga 2,
Icinga DB Web and many more modules.

![Icinga Web 2 Monitoring Module with Graphite](doc/res/monitoring-module-preview.png "Icinga Web 2 Monitoring Module with Graphite")

## License

Icinga Web 2 and the Icinga Web 2 documentation are licensed under the terms of the GNU
General Public License Version 3. You will find a copy of this license in [LICENSE.md](LICENSE.md)
included in the source package.

## Installation

For installing Icinga Web 2 please check the [installation chapter](https://icinga.com/docs/icingaweb2/latest/doc/02-Installation/)
in the documentation.

## Local AI Search

This repository now includes a natural-language assistant for searching hosts, services, host groups, and service groups.
The assistant is designed to talk to an OpenAI-compatible endpoint, so you can run it fully locally on your own server.

### Recommended setup

The simplest private setup is:

1. Run a local LLM server on the Icinga Web 2 host.
2. Bind that server to `127.0.0.1` so it is not exposed publicly.
3. Point Icinga Web 2 to that local endpoint through the `assistant` section in `config.ini`.

We recommend `Ollama` for the host because it is easy to install and can run offline after the model is downloaded.
If you prefer, `llama.cpp` with its OpenAI-compatible server works too.

### Step by step

#### 1. Install Ollama on the server

On Fedora/RHEL-like systems you can install the binary manually and run it as a system service.

```bash
curl -kfsSLo /tmp/ollama-linux-amd64.tar.zst \
  https://github.com/ollama/ollama/releases/download/v0.30.8/ollama-linux-amd64.tar.zst
mkdir -p /tmp/ollama-extract
tar --zstd -xf /tmp/ollama-linux-amd64.tar.zst -C /tmp/ollama-extract
install -m 0755 /tmp/ollama-extract/ollama /usr/local/bin/ollama
```

Create a dedicated service user and data directory:

```bash
useradd --system --home-dir /var/lib/ollama --create-home --shell /sbin/nologin ollama
install -d -o ollama -g ollama /var/lib/ollama
```

Create `/etc/systemd/system/ollama.service` with a localhost-only listener:

```ini
[Unit]
Description=Ollama local LLM service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ollama
Group=ollama
Environment=HOME=/var/lib/ollama
Environment=OLLAMA_HOST=127.0.0.1:11434
WorkingDirectory=/var/lib/ollama
ExecStart=/usr/local/bin/ollama serve
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
systemctl daemon-reload
systemctl enable --now ollama
```

Pull a model:

```bash
ollama pull qwen2.5:1.5b
```

If you want a larger model and have more free disk or RAM, `qwen2.5:3b` or `llama3.2:3b` are also good options.

#### 2. Configure Icinga Web 2

Add this section to `/etc/icingaweb2/config.ini`:

```ini
[assistant]
base_url = "http://127.0.0.1:11434"
endpoint = "/v1/chat/completions"
model = "qwen2.5:1.5b"
temperature = "0"
timeout = "30"
```

No API key is required when the base URL points to a local endpoint.

#### 3. Reload services

Restart PHP-FPM or the web stack if needed, then verify that the assistant page works:

```bash
systemctl restart php-fpm
systemctl restart nginx
```

Open `/assistant` in the browser and try queries such as:

- `hosty prod`
- `serwisy krytyczne`
- `hosty z awarią`

#### 4. Verify the local endpoint

You can test the model directly with:

```bash
curl http://127.0.0.1:11434/v1/chat/completions
```

If the assistant falls back to plain search translation, check the Icinga logs and confirm that the endpoint is reachable from the web server.

## Standalone Ollama Chat

If you want a chat window that is completely separate from Icinga Web 2, there is also a standalone page under `/ollama-chat/`.

It is served directly by nginx from `public/ollama-chat/` and proxies its chat requests to the local Ollama daemon on `127.0.0.1:11434`.

See [doc/99-Ollama-Standalone-Chat.md](doc/99-Ollama-Standalone-Chat.md) for the nginx snippets and deployment steps.

## Documentation

The documentation is located in the [doc/](doc/) directory and also available
on [icinga.com/docs](https://icinga.com/docs/icingaweb2/latest/).

## Support

Check the [project website](https://icinga.com) for status updates. Join the
[community channels](https://icinga.com/community/) for questions
or ask an Icinga partner for [professional support](https://icinga.com/support/).

## Contributing

There are many ways to contribute to Icinga -- whether it be sending patches,
testing, reporting bugs, or reviewing and updating the documentation. Every
contribution is appreciated!

Please continue reading in the [contributing chapter](CONTRIBUTING.md).

### Security Issues

For reporting security issues please visit [this page](https://icinga.com/contact/security/).
