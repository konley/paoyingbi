from __future__ import annotations

import argparse
import getpass
import os
import secrets
from pathlib import Path

from argon2 import PasswordHasher


def main() -> None:
    parser = argparse.ArgumentParser(description="Create paoyingbi admin secrets")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--origin", required=True, help="Public HTTPS origin, for example https://example.com")
    parser.add_argument("--allowed-hosts", required=True, help="Comma-separated Host header allowlist")
    args = parser.parse_args()

    password = os.environ.pop("ADMIN_INITIAL_PASSWORD", None) or getpass.getpass("Admin password: ")
    if len(password) < 10:
        raise SystemExit("Password must contain at least 10 characters")

    password_hash = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2).hash(password)
    session_secret = secrets.token_urlsafe(48)
    content = (
        f"ADMIN_PASSWORD_HASH={password_hash}\n"
        f"ADMIN_SESSION_SECRET={session_secret}\n"
        f"ADMIN_PUBLIC_ORIGIN={args.origin}\n"
        f"ADMIN_ALLOWED_HOSTS={args.allowed_hosts}\n"
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
    try:
        os.write(descriptor, content.encode("utf-8"))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    print(f"Secrets written to {args.output}")


if __name__ == "__main__":
    main()
