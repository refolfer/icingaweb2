# Modern UI Package for Icinga Web 2

This directory contains a production-ready deployment package definition for the NeoNOC/Modern UI changes.

## Contents

- `manifest.txt`: list of files included in the package
- `install.sh`: installer with backup and restore capabilities
- `build-package.sh`: creates a distributable `.tar.gz` archive

## Build

From repository root:

```bash
bash deployment/modern-ui-package/build-package.sh
```

The archive will be created in `dist/`.

## Deploy on Production

1. Copy the generated archive to the production host.
2. Extract it.
3. Run:

```bash
cd icingaweb2-modern-ui-package
bash install.sh install --target /usr/share/icingaweb2
```

The installer restores SELinux labels for installed files (via `restorecon`, if available)
to avoid context-related runtime errors on enforcing systems.

## Restore Original Files

Restore from the latest backup:

```bash
bash install.sh restore --target /usr/share/icingaweb2 --latest
```

Or restore a specific backup id:

```bash
bash install.sh restore --target /usr/share/icingaweb2 --backup-id 20260515-120000
```
