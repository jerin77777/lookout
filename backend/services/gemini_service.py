import os
import json
import logging
import urllib.request
import urllib.error
from typing import Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("GeminiService")

class GeminiService:
    """General-purpose service to interact with Google Gemini API (gemini-3.6-flash)."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("GOOGLE_API_KEY", "")

    def generate_content(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        response_mime_type: Optional[str] = None,
        temperature: float = 0.7,
        model_name: Optional[str] = "gemini-3.6-flash",
    ) -> str:
        """
        Generic content generation using Google Gemini REST API.
        Uses exclusively gemini-3.6-flash by default.
        """
        api_key = self.api_key or os.getenv("GOOGLE_API_KEY", "")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY is not configured in environment.")

        model = model_name or "gemini-3.6-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        headers = {"Content-Type": "application/json"}

        contents = []
        if system_instruction:
            contents.append({"role": "user", "parts": [{"text": system_instruction}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})

        gen_config: Dict[str, Any] = {"temperature": temperature}
        if response_mime_type:
            gen_config["responseMimeType"] = response_mime_type

        payload = {
            "contents": contents,
            "generationConfig": gen_config
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            res_body = response.read().decode("utf-8")
            res_json = json.loads(res_body)

            candidates = res_json.get("candidates", [])
            if candidates and "content" in candidates[0]:
                parts = candidates[0]["content"].get("parts", [])
                if parts and "text" in parts[0]:
                    return parts[0]["text"]

            raise RuntimeError("Gemini API response did not contain text content.")

gemini_service = GeminiService()
