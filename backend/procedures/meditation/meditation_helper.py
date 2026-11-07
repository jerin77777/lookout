import logging
import json
import hashlib
from typing import Dict, Any, Optional
from backend.services.gemini_service import gemini_service

logger = logging.getLogger("MeditationHelper")

def generate_meditation_script_with_gemini(
    title: str,
    duration_minutes: int = 10,
    intent: Optional[str] = None
) -> Dict[str, Any]:
    """Meditation specific prompt generator and parser using Gemini service."""
    prompt = f"""
Create a personalized guided meditation session script based on the following specifications:
- Session Title: "{title}"
- Target Duration: {duration_minutes} minutes
- User Intent / State of Mind: "{intent or 'General relaxation and mindfulness'}"

CRITICAL REQUIREMENTS:
1. Divide the session into an array of sequential items ("meditationScript").
2. Each item in "meditationScript" MUST be an object with:
   - "type": string, MUST be one of ["narration", "breathing_cue", "pause"]
   - "value": spoken sentence for narration/breathing_cue, or short description for pause
   - "pauseMs": integer duration in milliseconds to pause AFTER this step (or length of silence for a pause step). For example: 4000 for a 4-second pause, 3000 for 3 seconds, 0 for no pause.
3. Include breathing cues (e.g. "Breathe in deeply...", "Hold...", "Exhale slowly...") with realistic breathing pause durations (3000ms to 6000ms).

Return ONLY valid JSON matching this schema:
{{
  "title": "{title}",
  "script": "Combined complete script text...",
  "meditationScript": [
    {{
      "type": "narration",
      "value": "Welcome to your guided session. Find a quiet space and settle in.",
      "pauseMs": 2000
    }},
    {{
      "type": "breathing_cue",
      "value": "Inhale slowly through your nose for 4 seconds...",
      "pauseMs": 4000
    }},
    {{
      "type": "pause",
      "value": "Hold your breath softly...",
      "pauseMs": 4000
    }},
    {{
      "type": "breathing_cue",
      "value": "Exhale through your mouth, letting go of all tension...",
      "pauseMs": 6000
    }}
  ]
}}
"""

    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()

    # Try cache read
    try:
        from sqlmodel import Session, select
        from backend.db.sqlmodel_db import engine, GeminiCacheModel
        from datetime import datetime, timedelta

        one_day_ago = datetime.utcnow() - timedelta(days=1)
        with Session(engine) as session:
            statement = select(GeminiCacheModel).where(
                GeminiCacheModel.prompt_hash == prompt_hash,
                GeminiCacheModel.created_at >= one_day_ago
            ).order_by(GeminiCacheModel.created_at.desc())
            cached = session.exec(statement).first()
            if cached:
                logger.info("Found cached Gemini response in PostgreSQL")
                parsed = json.loads(cached.response_text)
                if "meditationScript" in parsed and isinstance(parsed["meditationScript"], list):
                    return parsed
    except Exception as cache_err:
        logger.error(f"Error checking Gemini cache: {cache_err}")

    # Generate if not in cache
    try:
        raw_text = gemini_service.generate_content(
            prompt=prompt,
            response_mime_type="application/json",
            temperature=0.7,
            model_name="gemini-3.6-flash"
        )
        parsed = json.loads(raw_text)
        if "meditationScript" in parsed and isinstance(parsed["meditationScript"], list):
            logger.info("Successfully generated meditation script using gemini-3.6-flash")

            # Try cache write
            try:
                from sqlmodel import Session
                from backend.db.sqlmodel_db import engine, GeminiCacheModel
                from datetime import datetime
                with Session(engine) as session:
                    cache_entry = GeminiCacheModel(
                        prompt_hash=prompt_hash,
                        response_text=raw_text,
                        created_at=datetime.utcnow()
                    )
                    session.add(cache_entry)
                    session.commit()
                    logger.info("Saved Gemini response to PostgreSQL cache")
            except Exception as save_err:
                logger.error(f"Error saving to Gemini cache: {save_err}")

            return parsed
    except Exception as e:
        logger.error(f"Error generating meditation script via Gemini: {e}")

    logger.warning("Falling back to default meditation script generator.")
    return get_fallback_meditation_script(title, duration_minutes, intent)

def get_fallback_meditation_script(title: str, duration_minutes: int, intent: Optional[str]) -> Dict[str, Any]:
    topic = intent or title or "Mindful Breathing"
    items = [
        {
            "type": "narration",
            "value": f"Welcome to your guided session for {topic}. Take a comfortable seat and close your eyes gently.",
            "pauseMs": 2000
        },
        {
            "type": "narration",
            "value": "Feel your body relax into this present moment. Release any tightness in your shoulders.",
            "pauseMs": 3000
        },
        {
            "type": "breathing_cue",
            "value": "Inhale slowly and deeply through your nose for 4 seconds...",
            "pauseMs": 4000
        },
        {
            "type": "pause",
            "value": "Hold your breath comfortably...",
            "pauseMs": 4000
        },
        {
            "type": "breathing_cue",
            "value": "Exhale smoothly through your mouth for 6 seconds, releasing all tension.",
            "pauseMs": 6000
        },
        {
            "type": "pause",
            "value": "Rest in gentle stillness...",
            "pauseMs": 4000
        },
        {
            "type": "breathing_cue",
            "value": "Take another deep breath in, feeling your lungs expand fully...",
            "pauseMs": 4000
        },
        {
            "type": "breathing_cue",
            "value": "Softly exhale, grounding yourself in peace.",
            "pauseMs": 5000
        },
        {
            "type": "narration",
            "value": "When you are ready, gently open your eyes and carry this calm with you.",
            "pauseMs": 2000
        }
    ]
    full_script = " ".join([i["value"] for i in items if i["type"] != "pause"])
    return {
        "title": title,
        "script": full_script,
        "meditationScript": items
    }
