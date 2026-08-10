# Paoyingbi

An interactive coin-toss experience with physics-driven gestures, 3D heads/tails rendering, ambient effects, history, statistics, and an optional protected media manager.

## What is included

- Static frontend in `index.html` and `assets/`.
- Matter.js is vendored under `assets/vendor/` so the game runs without a CDN.
- A FastAPI media-management service in `admin_server/`.
- OpenResty Lua statistics endpoint in `lua/stats.lua`.
- Generic deployment templates in `deploy/`.

## Security and repository boundaries

This repository intentionally excludes all production-only material:

- Administrator password hashes and session secrets.
- Runtime settings, session databases, visitor statistics, logs, and uploaded media.
- TLS certificates, server IP addresses, production reverse-proxy configuration, and service definitions.

The management page is available at `/my` in the deployment template. Its path is not a secret. Access is enforced with an Argon2id password hash, secure HttpOnly SameSite cookies, server-side opaque sessions, CSRF validation, Trusted Host validation, origin checks, and rate limits.

## Local setup

1. Create a Python virtual environment and install dependencies:

   ```bash
   python3 -m venv .venv
   .venv/bin/pip install -r admin_server/requirements.txt
   ```

2. Generate a deployment-only environment file outside this repository:

   ```bash
   .venv/bin/python admin_server/bootstrap_secrets.py \
     --output /etc/example-app/admin.env \
     --origin https://example.com \
     --allowed-hosts example.com,www.example.com
   ```

3. Use `deploy/paoyingbi-admin.service.example` and `deploy/nginx.conf.example` as starting points. Replace every example path, host, certificate location, and service account for your own environment.

4. Start the API only behind HTTPS reverse proxying. It uses secure cookies and validates the configured public origin.

## Operational notes

- Keep `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` outside Git and readable only by the service account.
- Store `ADMIN_RUNTIME_DIR` outside the web root. It contains media settings and session records.
- Do not expose `data/`, `config/`, `admin_server/`, `lua/`, or upload temporary files through the web server.
- If a secret is ever committed, rotate it immediately; deleting a later commit does not remove it from Git history.

## License

Matter.js is included under its own MIT license in `assets/vendor/node_modules/matter-js/LICENSE`.
