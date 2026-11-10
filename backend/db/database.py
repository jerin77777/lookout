import os
import logging
from typing import Any, Dict, List, Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger("Database")
DATABASE_URL = os.getenv("DATABASE_URL")

class Database:
    def __init__(self):
        self.pool = None

    async def connect(self):
        if not DATABASE_URL:
            err_msg = (
                "Missing required environment variable 'DATABASE_URL'. "
                "Please configure DATABASE_URL in your .env file "
                "(e.g. DATABASE_URL=postgresql://<username>:<password>@localhost:5432/<dbname>). "
                "Server startup aborted."
            )
            logger.critical(f"❌ {err_msg}")
            raise RuntimeError(err_msg)

        if not ("postgresql://" in DATABASE_URL or "postgres://" in DATABASE_URL):
            err_msg = f"Invalid or non-PostgreSQL DATABASE_URL: '{DATABASE_URL}'. An active PostgreSQL database is required."
            logger.critical(f"❌ {err_msg}")
            raise RuntimeError(err_msg)

        try:
            import asyncpg
        except ImportError as e:
            err_msg = (
                f"Missing required PostgreSQL driver 'asyncpg': {e}. "
                "Please install asyncpg (e.g. `pip install asyncpg`) to connect to the database. "
                "Server startup aborted."
            )
            logger.critical(f"❌ {err_msg}")
            raise RuntimeError(err_msg) from e

        try:
            logger.info("Connecting to PostgreSQL via asyncpg...")
            self.pool = await asyncpg.create_pool(DATABASE_URL)
            async with self.pool.acquire() as conn:
                await conn.execute("SELECT 1")
            logger.info("✅ Connected to PostgreSQL via asyncpg successfully.")
        except Exception as e:
            self.pool = None
            err_msg = f"Could not connect to PostgreSQL ({e}). Server startup aborted."
            logger.critical(f"❌ {err_msg}")
            raise RuntimeError(err_msg) from e

    async def disconnect(self):
        if self.pool:
            await self.pool.close()
            self.pool = None
            logger.info("PostgreSQL connection pool closed.")

    async def execute(self, query: str, *args):
        if not self.pool:
            raise RuntimeError("Database pool is not connected. Active PostgreSQL connection is required.")
        async with self.pool.acquire() as conn:
            return await conn.execute(query, *args)

    async def fetch(self, query: str, *args) -> List[Dict[str, Any]]:
        if not self.pool:
            raise RuntimeError("Database pool is not connected. Active PostgreSQL connection is required.")
        async with self.pool.acquire() as conn:
            records = await conn.fetch(query, *args)
            return [dict(record) for record in records]

    async def fetchrow(self, query: str, *args) -> Optional[Dict[str, Any]]:
        if not self.pool:
            raise RuntimeError("Database pool is not connected. Active PostgreSQL connection is required.")
        async with self.pool.acquire() as conn:
            record = await conn.fetchrow(query, *args)
            return dict(record) if record else None

db = Database()
