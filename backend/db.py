from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from contextlib import contextmanager
from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, Generator, Optional

from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

load_dotenv()


class Base(DeclarativeBase):
    pass


class SettingRecord(Base):
    __tablename__ = "app_settings"

    key = Column(String(128), primary_key=True)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class AwsCatalogCacheRecord(Base):
    __tablename__ = "aws_catalog_cache"

    cache_key = Column(String(128), primary_key=True)
    payload_json = Column(JSON, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class UserRecord(Base):
    __tablename__ = "users"

    email = Column(String(255), primary_key=True)
    password_hash = Column(Text, nullable=True)
    first_name = Column(String(128), nullable=False, default="")
    last_name = Column(String(128), nullable=False, default="")
    account_type = Column(String(32), nullable=False, default="individual")
    organization = Column(String(255), nullable=False, default="Individual Workspace")
    auth_provider = Column(String(32), nullable=False, default="email")
    mobile_country_code = Column(String(16), nullable=False, default="+1")
    mobile_number = Column(String(64), nullable=False, default="")
    avatar_url = Column(Text, nullable=True)
    created_at = Column(Integer, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmailVerificationRecord(Base):
    __tablename__ = "email_verifications"

    email = Column(String(255), primary_key=True)
    otp_hash = Column(String(255), nullable=False)
    pending_user_json = Column(JSON, nullable=False)
    expires_at = Column(Integer, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    resend_available_at = Column(Integer, nullable=False, default=0)
    created_at = Column(Integer, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class AwsConnectionRecord(Base):
    __tablename__ = "aws_connections"
    __table_args__ = (
        UniqueConstraint("user_email", "type", "access_key", name="uq_aws_conn_user_type_key"),
    )

    id = Column(String(128), primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    account_name = Column(String(255), nullable=False)
    access_key = Column(String(128), nullable=False)
    secret_key_enc = Column(Text, nullable=False)
    region = Column(String(64), nullable=True)
    type = Column(String(32), nullable=False, default="aws")
    status = Column(String(32), nullable=False, default="connected")
    created_at = Column(String(64), nullable=False)
    last_updated = Column(String(64), nullable=False)


class ClusterStateRecord(Base):
    __tablename__ = "cluster_states"
    __table_args__ = (
        UniqueConstraint("user_email", "cluster_name", name="uq_cluster_state_user_cluster"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_email = Column(String(255), nullable=False, index=True)
    cluster_name = Column(String(255), nullable=False, index=True)
    last_updated = Column(String(64), nullable=False)
    state_json = Column(JSON, nullable=False)


class IntegrationRecord(Base):
    __tablename__ = "integrations"

    id = Column(String(64), primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    provider = Column(String(64), nullable=False)
    category = Column(String(64), nullable=False)
    scope = Column(String(255), nullable=False, default="")
    endpoint = Column(String(512), nullable=True)
    credential_hint = Column(String(255), nullable=False, default="")
    status = Column(String(32), nullable=False, default="connected")
    last_checked_at = Column(String(64), nullable=False)
    latency_ms = Column(Integer, nullable=False, default=0)
    managed_by = Column(String(32), nullable=False, default="tesserak")
    metadata_json = Column(JSON, nullable=False, default=dict)
    secret_payload_enc = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class GuardrailRuleRecord(Base):
    __tablename__ = "guardrail_rules"

    user_email = Column(String(255), primary_key=True)
    id = Column(String(64), primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=False, default="")
    category = Column(String(64), nullable=False, default="Security")
    severity = Column(String(32), nullable=False, default="warn")
    enabled = Column(Boolean, nullable=False, default=True)
    threshold = Column(Float, nullable=True)
    violations = Column(Integer, nullable=False, default=0)
    updated_at = Column(String(64), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)


class ApprovalRecord(Base):
    __tablename__ = "approvals"

    id = Column(String(64), primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    resource_id = Column(String(64), nullable=False)
    resource_name = Column(String(255), nullable=False)
    resource_kind = Column(String(64), nullable=False)
    environment = Column(String(32), nullable=False)
    requested_by = Column(String(255), nullable=False)
    estimated_monthly_cost = Column(Float, nullable=False, default=0.0)
    triggered_rule = Column(String(255), nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(32), nullable=False, default="pending")
    created_at = Column(String(64), nullable=False)
    decided_at = Column(String(64), nullable=True)
    comment = Column(Text, nullable=True)
    provision_spec_json = Column(JSON, nullable=True)


class PendingResourceRecord(Base):
    __tablename__ = "pending_resources"

    id = Column(String(64), primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    payload_json = Column(JSON, nullable=False)
    created_at = Column(String(64), nullable=False)


class PipelineRecord(Base):
    __tablename__ = "pipelines"

    id = Column(String(64), primary_key=True)
    user_email = Column(String(255), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    repository_url = Column(String(512), nullable=False)
    branch = Column(String(128), nullable=False, default="main")
    target_cluster = Column(String(255), nullable=False)
    namespace = Column(String(128), nullable=False, default="default")
    manifest_path = Column(String(512), nullable=False, default=".")
    dockerfile_path = Column(String(512), nullable=True)
    image_tag = Column(String(255), nullable=True)
    git_integration_id = Column(String(64), nullable=True)
    verified_remote_sha = Column(String(64), nullable=True)
    last_run_number = Column(Integer, nullable=False, default=0)
    status = Column(String(32), nullable=False, default="Ready")
    duration_sec = Column(Float, nullable=False, default=0.0)
    triggered_by = Column(String(255), nullable=False)
    last_run_at = Column(String(64), nullable=False)
    stages_json = Column(JSON, nullable=False, default=list)
    recent_runs_json = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class MetadataCacheRecord(Base):
    __tablename__ = "metadata_cache"

    cache_key = Column(String(128), primary_key=True)
    payload_json = Column(JSON, nullable=False)
    updated_at = Column(String(64), nullable=False)


def normalize_email(email: Optional[str]) -> str:
    return (email or "guest@tesserak.dev").strip().lower()


def _normalize_database_url(url: str) -> str:
    clean = (url or "").strip()
    if clean.startswith("postgres://"):
        clean = "postgresql://" + clean[len("postgres://") :]
    return clean


class DatabaseManager:
    def __init__(self, database_url: Optional[str] = None):
        raw_url = database_url or os.getenv(
            "DATABASE_URL",
            "postgresql://tesserak:tesserak123@localhost:5432/tesserak",
        )
        self.database_url = _normalize_database_url(raw_url)
        connect_args: Dict[str, Any] = {}
        if self.database_url.startswith("sqlite"):
            connect_args = {"check_same_thread": False}
        self.engine: Engine = create_engine(
            self.database_url,
            pool_pre_ping=True,
            json_serializer=lambda obj: json.dumps(obj, default=str),
            connect_args=connect_args,
        )
        self.SessionLocal = sessionmaker(
            bind=self.engine,
            autocommit=False,
            autoflush=False,
            expire_on_commit=False,
        )
        self._schema_ready = False
        self._cached_secret: Optional[bytes] = None

    def init_schema(self) -> None:
        if self._schema_ready:
            return
        Base.metadata.create_all(bind=self.engine)
        self._schema_ready = True

    @contextmanager
    def session_scope(self) -> Generator[Session, None, None]:
        self.init_schema()
        session = self.SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_app_secret(self) -> bytes:
        env_secret = os.getenv("TESSERAK_SESSION_SECRET", "").strip()
        if env_secret:
            return env_secret.encode("utf-8")
        if self._cached_secret is not None:
            return self._cached_secret

        with self.session_scope() as session:
            row = session.get(SettingRecord, "session_secret")
            if row and row.value:
                self._cached_secret = row.value.strip().encode("utf-8")
                return self._cached_secret
            generated = secrets.token_hex(32)
            session.add(SettingRecord(key="session_secret", value=generated))
            self._cached_secret = generated.encode("utf-8")
            return self._cached_secret

    def _fernet(self) -> Fernet:
        digest = hashlib.sha256(self.get_app_secret()).digest()
        key = base64.urlsafe_b64encode(digest)
        return Fernet(key)

    def encrypt_str(self, plaintext: str) -> str:
        if plaintext is None:
            return ""
        token = self._fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")
        return f"enc:v1:{token}"

    def decrypt_str(self, value: Optional[str]) -> str:
        if not value:
            return ""
        if not value.startswith("enc:v1:"):
            return value
        token = value[len("enc:v1:") :]
        try:
            return self._fernet().decrypt(token.encode("ascii")).decode("utf-8")
        except InvalidToken:
            return ""

    def encrypt_json(self, payload: Dict[str, Any]) -> str:
        if not payload:
            return ""
        return self.encrypt_str(json.dumps(payload, separators=(",", ":")))

    def decrypt_json(self, value: Optional[str]) -> Dict[str, Any]:
        raw = self.decrypt_str(value)
        if not raw:
            return {}
        try:
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}


@lru_cache(maxsize=1)
def get_db() -> DatabaseManager:
    db = DatabaseManager()
    db.init_schema()
    return db
