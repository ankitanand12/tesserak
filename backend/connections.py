from typing import Dict, List, Optional, Tuple
from pydantic import BaseModel
from datetime import datetime
import asyncio
import os
import boto3
from botocore.config import Config
import time
import uuid

from db import AwsConnectionRecord, DatabaseManager, get_db, normalize_email

STS_BOTO_CONFIG = Config(connect_timeout=4, read_timeout=6, retries={"max_attempts": 1})
AWS_CLIENT_CONFIG = Config(connect_timeout=5, read_timeout=15, retries={"max_attempts": 1})
STS_CACHE_TTL_SECONDS = 60.0

class ConnectionBase(BaseModel):
    accessKey: str
    secretKey: str
    region: Optional[str] = None
    accountName: str
    type: str = "aws"

class Connection(ConnectionBase):
    id: str
    status: str
    createdAt: str
    createdBy: str
    lastUpdated: str

class ConnectionManager:
    def __init__(self, storage_path: str = "connections", db: Optional[DatabaseManager] = None):
        self.storage_path = storage_path
        self.db = db or get_db()
        self._sts_cache: Dict[Tuple[str, str], Tuple[float, bool, str, Optional[str]]] = {}
        self._create_lock = asyncio.Lock()

    def _row_to_connection(self, row: AwsConnectionRecord) -> Connection:
        return Connection(
            id=row.id,
            accessKey=row.access_key,
            secretKey=self.db.decrypt_str(row.secret_key_enc),
            region=row.region,
            accountName=row.account_name,
            type=row.type,
            status=row.status,
            createdAt=row.created_at,
            createdBy=row.user_email,
            lastUpdated=row.last_updated,
        )

    def invalidate_cache(self, access_key: Optional[str] = None) -> None:
        if not access_key:
            self._sts_cache.clear()
            return
        keys_to_drop = [k for k in self._sts_cache if k[0] == access_key]
        for k in keys_to_drop:
            self._sts_cache.pop(k, None)

    @staticmethod
    def _test_sts_sync(access_key: str, secret_key: str, region: Optional[str]) -> str:
        client = boto3.client(
            'sts',
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region or 'us-east-1',
            config=STS_BOTO_CONFIG,
        )
        identity = client.get_caller_identity()
        return identity['Account']

    async def test_connection(
        self,
        connection: ConnectionBase,
        use_cache: bool = False,
    ) -> tuple[bool, str, Optional[str]]:
        cache_key = (connection.accessKey, connection.region or 'us-east-1')
        now_mono = time.monotonic()
        if use_cache:
            cached = self._sts_cache.get(cache_key)
            if cached and cached[0] > now_mono:
                return cached[1], cached[2], cached[3]

        try:
            account_id = await asyncio.to_thread(
                self._test_sts_sync,
                connection.accessKey,
                connection.secretKey,
                connection.region,
            )
            result = (True, "Connection successful", account_id)
            self._sts_cache[cache_key] = (time.monotonic() + STS_CACHE_TTL_SECONDS, *result)
            return result
        except Exception as e:
            error_message = str(e)
            if "InvalidClientTokenId" in error_message:
                result = (False, "Invalid AWS Access Key ID", None)
            elif "SignatureDoesNotMatch" in error_message:
                result = (False, "Invalid AWS Secret Access Key", None)
            elif "InvalidAccessKeyId" in error_message:
                result = (False, "Invalid AWS Access Key ID", None)
            else:
                print(f"Connection test failed: {error_message}")
                result = (False, f"Connection failed: {error_message}", None)
            if use_cache:
                self._sts_cache[cache_key] = (time.monotonic() + 10.0, *result)
            return result

    def _upsert_connection_sync(
        self,
        connection: ConnectionBase,
        user_email: str,
        now: str,
    ) -> Connection:
        normalized_email = normalize_email(user_email)
        normalized_key = connection.accessKey.strip()
        secret_enc = self.db.encrypt_str(connection.secretKey)

        with self.db.session_scope() as session:
            existing = (
                session.query(AwsConnectionRecord)
                .filter(
                    AwsConnectionRecord.user_email == normalized_email,
                    AwsConnectionRecord.type == connection.type,
                    AwsConnectionRecord.access_key == normalized_key,
                )
                .first()
            )
            if existing:
                existing.account_name = connection.accountName
                existing.secret_key_enc = secret_enc
                existing.region = connection.region
                existing.status = "connected"
                existing.last_updated = now
                row = existing
            else:
                connection_id = f"{connection.type}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:6]}"
                row = AwsConnectionRecord(
                    id=connection_id,
                    user_email=normalized_email,
                    account_name=connection.accountName,
                    access_key=normalized_key,
                    secret_key_enc=secret_enc,
                    region=connection.region,
                    type=connection.type,
                    status="connected",
                    created_at=now,
                    last_updated=now,
                )
                session.add(row)
            session.flush()
            return self._row_to_connection(row)

    def _list_connections_sync(self, user_email: Optional[str] = None) -> List[Connection]:
        with self.db.session_scope() as session:
            query = session.query(AwsConnectionRecord)
            if user_email is not None:
                query = query.filter(AwsConnectionRecord.user_email == normalize_email(user_email))
            rows = query.order_by(AwsConnectionRecord.created_at.desc()).all()
            return [self._row_to_connection(r) for r in rows]

    def _delete_connection_sync(self, connection_id: str) -> bool:
        with self.db.session_scope() as session:
            row = session.get(AwsConnectionRecord, connection_id)
            if not row:
                return False
            self.invalidate_cache(row.access_key)
            session.delete(row)
            return True

    def _get_connection_sync(self, connection_id: str) -> Optional[Connection]:
        with self.db.session_scope() as session:
            row = session.get(AwsConnectionRecord, connection_id)
            return self._row_to_connection(row) if row else None

    async def create_connection(self, connection: ConnectionBase, user_email: str) -> Connection:
        # Test the connection first without blocking the event loop
        is_valid, message, _ = await self.test_connection(connection, use_cache=False)
        if not is_valid:
            raise ValueError(message)

        now = datetime.utcnow().isoformat()
        async with self._create_lock:
            return await asyncio.to_thread(self._upsert_connection_sync, connection, user_email, now)

    async def list_connections(self, user_email: Optional[str] = None) -> List[Connection]:
        return await asyncio.to_thread(self._list_connections_sync, user_email)

    async def delete_connection(self, connection_id: str) -> bool:
        return await asyncio.to_thread(self._delete_connection_sync, connection_id)

    async def get_connection(self, connection_id: str) -> Optional[Connection]:
        return await asyncio.to_thread(self._get_connection_sync, connection_id)

    async def get_valid_connection(self, user_email: str) -> Optional[Connection]:
        """Get the newest valid AWS connection for the user."""
        connections = await self.list_connections(user_email)
        sorted_conns = sorted(
            connections,
            key=lambda x: x.lastUpdated or x.createdAt or "",
            reverse=True,
        )
        for conn in sorted_conns:
            is_valid, _, _ = await self.test_connection(conn, use_cache=True)
            if is_valid:
                return conn
        return None

    async def get_connection_for_account(
        self,
        user_email: str,
        account_id: Optional[str] = None,
    ) -> Optional[Connection]:
        """Strictly resolve the user's valid AWS connector matching `account_id` when supplied."""
        clean_acct = (account_id or "").strip()
        if not clean_acct:
            return await self.get_valid_connection(user_email)

        connections = await self.list_connections(user_email)
        sorted_conns = sorted(
            connections,
            key=lambda x: x.lastUpdated or x.createdAt or "",
            reverse=True,
        )
        for conn in sorted_conns:
            is_valid, _, verified_acct = await self.test_connection(conn, use_cache=True)
            if is_valid and verified_acct == clean_acct:
                return conn
        return None

    @staticmethod
    def get_platform_catalog_connection() -> Optional[Connection]:
        """Optional read-only platform IAM fallback for global AWS catalog endpoints."""
        ak = os.getenv("TESSERAK_CATALOG_AWS_ACCESS_KEY_ID", "").strip()
        sk = os.getenv("TESSERAK_CATALOG_AWS_SECRET_ACCESS_KEY", "").strip()
        if not ak or not sk:
            return None
        region = os.getenv("TESSERAK_CATALOG_AWS_REGION", "us-east-1").strip() or "us-east-1"
        return Connection(
            id="platform_catalog",
            accessKey=ak,
            secretKey=sk,
            region=region,
            accountName="Platform Read-Only Catalog",
            type="aws",
            status="connected",
            createdAt="",
            createdBy="system",
            lastUpdated="",
        )

    async def get_catalog_connection(
        self,
        user_email: str,
        account_id: Optional[str] = None,
    ) -> Optional[Connection]:
        """Resolve optional platform catalog IAM key first, else user's valid connector."""
        platform_conn = self.get_platform_catalog_connection()
        if platform_conn:
            return platform_conn
        if account_id:
            matched = await self.get_connection_for_account(user_email, account_id)
            if matched:
                return matched
        return await self.get_valid_connection(user_email)

    async def get_aws_client(
        self,
        user_email: str,
        service: str = 'eks',
        region: Optional[str] = None,
        account_id: Optional[str] = None,
    ) -> Optional[boto3.client]:
        """Get a boto3 client using valid credentials strictly scoped when `account_id` is given."""
        conn = await self.get_connection_for_account(user_email, account_id)
        if not conn:
            return None

        return boto3.client(
            service,
            aws_access_key_id=conn.accessKey,
            aws_secret_access_key=conn.secretKey,
            region_name=region or conn.region or 'us-east-1',
            config=AWS_CLIENT_CONFIG,
        )

    async def get_active_connection(self, user_email: str) -> Optional[Connection]:
        try:
            print(f"Debug: Getting active connection for user {user_email}")
            connections = await self.list_connections(user_email)
            if not connections:
                print("Debug: No connections found")
                return None

            # Sort connections by creation time (newest first)
            sorted_connections = sorted(
                connections,
                key=lambda x: datetime.fromisoformat(x.createdAt),
                reverse=True
            )
            
            print(f"Debug: Found active connection with ID {sorted_connections[0].id}")
            return sorted_connections[0]
        except Exception as e:
            print(f"Debug: Error getting active connection - {str(e)}")
            return None
