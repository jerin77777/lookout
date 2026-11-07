import os
import logging
from typing import Any, Dict, List, Optional
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger("Database")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:0007!asd@localhost:5432/vyom")

class Database:
    def __init__(self):
        self.pool = None

    async def connect(self):
        try:
            import asyncpg
            self.pool = await asyncpg.create_pool(DATABASE_URL)
            logger.info("Connected to PostgreSQL via asyncpg")
        except Exception as e:
            logger.error(f"Could not connect to PostgreSQL ({e}). Server crashing.")
            raise RuntimeError(f"Could not connect to PostgreSQL ({e})") from e

    async def execute(self, query: str, *args):
        if self.pool:
            async with self.pool.acquire() as conn:
                return await conn.execute(query, *args)
        return None

    async def fetch(self, query: str, *args) -> List[Dict[str, Any]]:
        if self.pool:
            async with self.pool.acquire() as conn:
                records = await conn.fetch(query, *args)
                return [dict(record) for record in records]
        return []

    async def fetchrow(self, query: str, *args) -> Optional[Dict[str, Any]]:
        if self.pool:
            async with self.pool.acquire() as conn:
                record = await conn.fetchrow(query, *args)
                return dict(record) if record else None
        return None

db = Database()
