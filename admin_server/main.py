from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from mutagen import File as MutagenFile
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware


SITE_ROOT = Path(os.environ.get("ADMIN_SITE_ROOT", Path(__file__).resolve().parents[1])).resolve()
RUNTIME_DIR = Path(os.environ.get("ADMIN_RUNTIME_DIR", SITE_ROOT / "data" / "runtime")).resolve()
CONFIG_PATH = RUNTIME_DIR / "site-config.json"
DEFAULT_CONFIG_PATH = SITE_ROOT / "config/site-config.default.json"
SESSION_DB_PATH = RUNTIME_DIR / "sessions.db"
ADMIN_PAGE = SITE_ROOT / "admin/index.html"
UPLOAD_ROOT = SITE_ROOT / "uploads"
TEMP_DIR = UPLOAD_ROOT / ".tmp"
PUBLIC_ORIGIN = os.environ.get("ADMIN_PUBLIC_ORIGIN", "").rstrip("/")
ALLOWED_HOSTS = tuple(host.strip() for host in os.environ.get("ADMIN_ALLOWED_HOSTS", "").split(",") if host.strip())
PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "")
SESSION_SECRET = os.environ.get("ADMIN_SESSION_SECRET", "")
SESSION_COOKIE = "__Host-admin_session"
SESSION_IDLE_SECONDS = 30 * 60
SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60
MAX_UPLOAD_BYTES = 30 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_AUDIO_SECONDS = 60 * 60
CONFIG_LOCK = threading.RLock()
PASSWORD_HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
LOGGER = logging.getLogger("paoyingbi.admin")
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

if not PASSWORD_HASH.startswith("$argon2id$"):
    raise RuntimeError("ADMIN_PASSWORD_HASH must contain an Argon2id hash")
if len(SESSION_SECRET) < 43:
    raise RuntimeError("ADMIN_SESSION_SECRET must contain at least 256 bits of entropy")
if not PUBLIC_ORIGIN:
    raise RuntimeError("ADMIN_PUBLIC_ORIGIN must be configured")
if not ALLOWED_HOSTS:
    raise RuntimeError("ADMIN_ALLOWED_HOSTS must contain at least one host")


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def validate_remote_url(value: str) -> str:
    url = value.strip()
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Remote media must use an HTTPS URL without embedded credentials")
    if len(url) > 2048:
        raise ValueError("Remote URL is too long")
    return url


class MediaItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$")
    kind: Literal["background", "music"]
    source: Literal["bundled", "upload", "remote"]
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=2048)
    enabled: bool = True
    created_at: str = Field(min_length=10, max_length=40)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Media name cannot be empty")
        return cleaned

    @model_validator(mode="after")
    def validate_location(self) -> Self:
        if self.source == "remote":
            self.url = validate_remote_url(self.url)
            return self
        if self.source == "upload":
            expected = "/uploads/images/" if self.kind == "background" else "/uploads/audio/"
            if not self.url.startswith(expected) or ".." in self.url:
                raise ValueError("Invalid uploaded media URL")
        elif not self.url.startswith("/assets/") or ".." in self.url:
            raise ValueError("Invalid bundled media URL")
        return self


class SiteSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=1)
    background_mode: Literal["single", "rotate", "shuffle"] = "single"
    background_interval: int = Field(default=18, ge=6, le=300)
    music_mode: Literal["single", "sequence", "shuffle"] = "sequence"
    backgrounds: list[MediaItem] = Field(min_length=1, max_length=30)
    music: list[MediaItem] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_media(self) -> Self:
        items = self.backgrounds + self.music
        if len({item.id for item in items}) != len(items):
            raise ValueError("Media IDs must be unique")
        if any(item.kind != "background" for item in self.backgrounds):
            raise ValueError("Background list contains an invalid media kind")
        if any(item.kind != "music" for item in self.music):
            raise ValueError("Music list contains an invalid media kind")
        if not any(item.enabled for item in self.backgrounds):
            raise ValueError("At least one background must remain enabled")
        return self


class PublicMedia(BaseModel):
    name: str
    url: str


class PublicConfig(BaseModel):
    revision: int
    background_mode: Literal["single", "rotate", "shuffle"]
    background_interval: int
    music_mode: Literal["single", "sequence", "shuffle"]
    backgrounds: list[PublicMedia]
    music: list[PublicMedia]


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=1, max_length=256)


class SessionResponse(BaseModel):
    authenticated: bool
    csrf_token: str
    expires_at: int


class RemoteMediaRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["background", "music"]
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=2048)

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        return validate_remote_url(value)


@dataclass(frozen=True)
class SessionData:
    token_hash: str
    csrf_token: str
    expires_at: int


def database() -> sqlite3.Connection:
    connection = sqlite3.connect(SESSION_DB_PATH, timeout=5)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    with database() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                csrf_token TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip TEXT NOT NULL,
                attempted_at INTEGER NOT NULL
            )
            """
        )


def read_settings_unlocked() -> SiteSettings:
    source = CONFIG_PATH if CONFIG_PATH.exists() else DEFAULT_CONFIG_PATH
    return SiteSettings.model_validate_json(source.read_text(encoding="utf-8"))


def write_settings_unlocked(settings: SiteSettings) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    temporary = CONFIG_PATH.with_suffix(".json.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
    try:
        payload = settings.model_dump_json(indent=2).encode("utf-8")
        os.write(descriptor, payload)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.replace(temporary, CONFIG_PATH)
    directory_descriptor = os.open(RUNTIME_DIR, os.O_RDONLY)
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)


def read_settings() -> SiteSettings:
    with CONFIG_LOCK:
        settings = read_settings_unlocked()
        if not CONFIG_PATH.exists():
            write_settings_unlocked(settings)
        return settings


def token_digest(token: str) -> str:
    return hmac.new(SESSION_SECRET.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()


def create_session() -> tuple[str, SessionData]:
    now = int(time.time())
    expires_at = now + SESSION_ABSOLUTE_SECONDS
    raw_token = secrets.token_urlsafe(32)
    session = SessionData(token_digest(raw_token), secrets.token_urlsafe(24), expires_at)
    with database() as connection:
        connection.execute("DELETE FROM sessions WHERE expires_at <= ? OR last_seen <= ?", (now, now - SESSION_IDLE_SECONDS))
        connection.execute(
            "INSERT INTO sessions(token_hash, csrf_token, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)",
            (session.token_hash, session.csrf_token, now, now, expires_at),
        )
    return raw_token, session


def request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-real-ip", "").strip()
    return forwarded[:64] if forwarded else (request.client.host if request.client else "unknown")


def enforce_origin(request: Request) -> None:
    if request.headers.get("origin") != PUBLIC_ORIGIN:
        raise HTTPException(status_code=403, detail="origin_rejected")
    if request.headers.get("sec-fetch-site", "same-origin") == "cross-site":
        raise HTTPException(status_code=403, detail="cross_site_rejected")


def enforce_login_rate_limit(ip: str) -> None:
    now = int(time.time())
    cutoff = now - 600
    with database() as connection:
        connection.execute("DELETE FROM login_attempts WHERE attempted_at < ?", (cutoff,))
        ip_count = connection.execute("SELECT COUNT(*) FROM login_attempts WHERE ip = ?", (ip,)).fetchone()[0]
    if ip_count >= 6:
        raise HTTPException(status_code=429, detail="too_many_attempts", headers={"Retry-After": "600"})


def record_login_failure(ip: str) -> None:
    with database() as connection:
        connection.execute("INSERT INTO login_attempts(ip, attempted_at) VALUES (?, ?)", (ip, int(time.time())))


def clear_login_failures(ip: str) -> None:
    with database() as connection:
        connection.execute("DELETE FROM login_attempts WHERE ip = ?", (ip,))


def require_session(request: Request) -> SessionData:
    raw_token = request.cookies.get(SESSION_COOKIE)
    if not raw_token or len(raw_token) > 128:
        raise HTTPException(status_code=401, detail="authentication_required")
    digest = token_digest(raw_token)
    now = int(time.time())
    with database() as connection:
        row = connection.execute(
            "SELECT token_hash, csrf_token, last_seen, expires_at FROM sessions WHERE token_hash = ?",
            (digest,),
        ).fetchone()
        if not row or row["expires_at"] <= now or row["last_seen"] <= now - SESSION_IDLE_SECONDS:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (digest,))
            raise HTTPException(status_code=401, detail="session_expired")
        connection.execute("UPDATE sessions SET last_seen = ? WHERE token_hash = ?", (now, digest))
    return SessionData(row["token_hash"], row["csrf_token"], row["expires_at"])


SessionDep = Annotated[SessionData, Depends(require_session)]


def require_csrf(
    request: Request,
    session: SessionDep,
    csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> SessionData:
    enforce_origin(request)
    if not csrf_token or not hmac.compare_digest(csrf_token, session.csrf_token):
        raise HTTPException(status_code=403, detail="csrf_rejected")
    return session


CsrfSessionDep = Annotated[SessionData, Depends(require_csrf)]


def stream_upload(upload: UploadFile) -> tuple[Path, int]:
    temporary = TEMP_DIR / f"upload-{secrets.token_hex(16)}.tmp"
    total = 0
    try:
        with temporary.open("xb") as destination:
            while chunk := upload.file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="file_too_large")
                destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    if total == 0:
        temporary.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="empty_file")
    return temporary, total


def process_image(temporary: Path, media_id: str) -> str:
    final_path = UPLOAD_ROOT / "images" / f"{media_id}.webp"
    encoded_path = TEMP_DIR / f"encoded-{media_id}.webp"
    try:
        with Image.open(temporary) as source:
            width, height = source.size
            if width < 640 or height < 360 or width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=422, detail="invalid_image_dimensions")
            source.load()
            image = ImageOps.exif_transpose(source)
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            image.save(encoded_path, format="WEBP", quality=90, method=6)
        os.chmod(encoded_path, 0o644)
        os.replace(encoded_path, final_path)
    except HTTPException:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as error:
        LOGGER.warning("Image upload processing failed: %s: %s", type(error).__name__, error)
        raise HTTPException(status_code=415, detail="invalid_image") from error
    finally:
        temporary.unlink(missing_ok=True)
        encoded_path.unlink(missing_ok=True)
    return f"/uploads/images/{final_path.name}"


def process_audio(temporary: Path, media_id: str) -> str:
    try:
        parsed = MutagenFile(temporary)
        if parsed is None or not getattr(parsed, "info", None):
            raise HTTPException(status_code=415, detail="invalid_audio")
        duration = float(getattr(parsed.info, "length", 0))
        if duration <= 1 or duration > MAX_AUDIO_SECONDS:
            raise HTTPException(status_code=422, detail="invalid_audio_duration")
        if isinstance(parsed, MP3):
            extension = ".mp3"
        elif isinstance(parsed, OggVorbis):
            extension = ".ogg"
        elif isinstance(parsed, OggOpus):
            extension = ".opus"
        elif isinstance(parsed, MP4):
            extension = ".m4a"
        else:
            raise HTTPException(status_code=415, detail="unsupported_audio_format")
        final_path = UPLOAD_ROOT / "audio" / f"{media_id}{extension}"
        os.chmod(temporary, 0o644)
        os.replace(temporary, final_path)
        return f"/uploads/audio/{final_path.name}"
    finally:
        temporary.unlink(missing_ok=True)


def add_media_item(item: MediaItem) -> SiteSettings:
    with CONFIG_LOCK:
        current = read_settings_unlocked()
        field = "backgrounds" if item.kind == "background" else "music"
        values = current.model_dump()
        values[field].append(item.model_dump())
        values["revision"] = current.revision + 1
        updated = SiteSettings.model_validate(values)
        write_settings_unlocked(updated)
        return updated


def ensure_same_media(current: SiteSettings, proposed: SiteSettings) -> None:
    current_items = {item.id: item for item in current.backgrounds + current.music}
    proposed_items = {item.id: item for item in proposed.backgrounds + proposed.music}
    if current_items.keys() != proposed_items.keys():
        raise HTTPException(status_code=422, detail="media_set_changed")
    for media_id, existing in current_items.items():
        candidate = proposed_items[media_id]
        immutable = ("id", "kind", "source", "url", "created_at")
        if any(getattr(existing, field) != getattr(candidate, field) for field in immutable):
            raise HTTPException(status_code=422, detail="immutable_media_field_changed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    read_settings()
    yield


app = FastAPI(
    title="Paoyingbi Admin",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(ALLOWED_HOSTS))


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path in {"/my", "/login"} or request.url.path.startswith("/api/admin/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; "
            "connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        )
    return response


@app.get("/healthz", include_in_schema=False)
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/my", response_class=FileResponse, include_in_schema=False)
@app.get("/login", response_class=FileResponse, include_in_schema=False)
def login_page() -> FileResponse:
    return FileResponse(ADMIN_PAGE, media_type="text/html")


@app.get("/api/site-config", response_model=PublicConfig)
def public_config(response: Response) -> PublicConfig:
    settings = read_settings()
    response.headers["Cache-Control"] = "no-cache"
    return PublicConfig(
        revision=settings.revision,
        background_mode=settings.background_mode,
        background_interval=settings.background_interval,
        music_mode=settings.music_mode,
        backgrounds=[PublicMedia(name=item.name, url=item.url) for item in settings.backgrounds if item.enabled],
        music=[PublicMedia(name=item.name, url=item.url) for item in settings.music if item.enabled],
    )


@app.post("/api/admin/session", response_model=SessionResponse)
def login(request: Request, credentials: LoginRequest, response: Response) -> SessionResponse:
    enforce_origin(request)
    ip = request_ip(request)
    enforce_login_rate_limit(ip)
    try:
        valid = PASSWORD_HASHER.verify(PASSWORD_HASH, credentials.password)
    except (VerifyMismatchError, InvalidHashError):
        valid = False
    if not valid:
        record_login_failure(ip)
        time.sleep(.18)
        raise HTTPException(status_code=401, detail="invalid_credentials")
    clear_login_failures(ip)
    raw_token, session = create_session()
    response.set_cookie(
        SESSION_COOKIE,
        raw_token,
        max_age=SESSION_ABSOLUTE_SECONDS,
        secure=True,
        httponly=True,
        samesite="strict",
        path="/",
    )
    return SessionResponse(authenticated=True, csrf_token=session.csrf_token, expires_at=session.expires_at)


@app.get("/api/admin/session", response_model=SessionResponse)
def session_status(session: SessionDep) -> SessionResponse:
    return SessionResponse(authenticated=True, csrf_token=session.csrf_token, expires_at=session.expires_at)


@app.delete("/api/admin/session", status_code=204)
def logout(response: Response, session: CsrfSessionDep) -> Response:
    with database() as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash = ?", (session.token_hash,))
    response.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="strict")
    response.status_code = 204
    return response


@app.get("/api/admin/config", response_model=SiteSettings)
def admin_config(_: SessionDep) -> SiteSettings:
    return read_settings()


@app.put("/api/admin/config", response_model=SiteSettings)
def update_config(proposed: SiteSettings, _: CsrfSessionDep) -> SiteSettings:
    with CONFIG_LOCK:
        current = read_settings_unlocked()
        if proposed.revision != current.revision:
            raise HTTPException(status_code=409, detail="stale_revision")
        ensure_same_media(current, proposed)
        updated = proposed.model_copy(update={"revision": current.revision + 1})
        write_settings_unlocked(updated)
        return updated


@app.post("/api/admin/media/uploads", response_model=SiteSettings)
def upload_media(
    _: CsrfSessionDep,
    kind: Annotated[Literal["background", "music"], Form()],
    name: Annotated[str, Form(min_length=1, max_length=120)],
    upload: Annotated[UploadFile, File()],
) -> SiteSettings:
    temporary, _ = stream_upload(upload)
    media_id = uuid.uuid4().hex
    public_url = process_image(temporary, media_id) if kind == "background" else process_audio(temporary, media_id)
    item = MediaItem(id=media_id, kind=kind, source="upload", name=name, url=public_url, enabled=True, created_at=utc_now())
    try:
        return add_media_item(item)
    except Exception:
        (SITE_ROOT / public_url.lstrip("/")).unlink(missing_ok=True)
        raise


@app.post("/api/admin/media/remote", response_model=SiteSettings)
def add_remote_media(payload: RemoteMediaRequest, _: CsrfSessionDep) -> SiteSettings:
    item = MediaItem(
        id=uuid.uuid4().hex,
        kind=payload.kind,
        source="remote",
        name=payload.name,
        url=payload.url,
        enabled=True,
        created_at=utc_now(),
    )
    return add_media_item(item)


@app.delete("/api/admin/media/{media_id}", response_model=SiteSettings)
def delete_media(media_id: str, _: CsrfSessionDep) -> SiteSettings:
    with CONFIG_LOCK:
        current = read_settings_unlocked()
        item = next((candidate for candidate in current.backgrounds + current.music if candidate.id == media_id), None)
        if item is None:
            raise HTTPException(status_code=404, detail="media_not_found")
        if item.source == "bundled":
            raise HTTPException(status_code=422, detail="bundled_media_cannot_be_deleted")
        values = current.model_dump()
        field = "backgrounds" if item.kind == "background" else "music"
        values[field] = [candidate for candidate in values[field] if candidate["id"] != media_id]
        values["revision"] = current.revision + 1
        updated = SiteSettings.model_validate(values)
        write_settings_unlocked(updated)
    if item.source == "upload":
        (SITE_ROOT / item.url.lstrip("/")).unlink(missing_ok=True)
    return updated
