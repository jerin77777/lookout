import os
import uuid
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("MediaServer")

class MediaServer:
    def __init__(self, upload_dir: str = "uploads"):
        self.upload_dir = os.path.abspath(upload_dir)
        os.makedirs(self.upload_dir, exist_ok=True)

    async def upload_media(
        self, original_name: str, bytes_data: bytes, content_type: Optional[str] = None, directory: Optional[str] = None
    ) -> Dict[str, Any]:
        dir_path = self.upload_dir
        if directory:
            dir_path = os.path.join(self.upload_dir, directory)
            os.makedirs(dir_path, exist_ok=True)

        ext = os.path.splitext(original_name)[1]
        filename = f"{uuid.uuid4()}{ext}"
        filepath = os.path.join(dir_path, filename)

        with open(filepath, "wb") as f:
            f.write(bytes_data)

        rel_path = os.path.relpath(filepath, self.upload_dir).replace("\\", "/")
        url = f"/uploads/{rel_path}"

        return {
            "url": url,
            "rawUrl": url,
            "coverImageUrl": url if ext.lower() in [".png", ".jpg", ".jpeg", ".webp"] else "",
            "duration": 0,
        }

media_server = MediaServer()
