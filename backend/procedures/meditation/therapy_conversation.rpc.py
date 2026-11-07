import logging
import uuid
import os
import base64
from typing import Optional
from pydantic import BaseModel
from backend.arri import define_rpc
from backend.services.gemini_service import gemini_service
from backend.services.tts_service import tts_service
from backend.db.sqlmodel_db import engine, TherapyHistoryModel
from sqlmodel import Session, select

logger = logging.getLogger("TherapyConversationRPC")

class TherapyConversationParams(BaseModel):
    sessionId: str
    userMessage: Optional[str] = None
    audioData: Optional[str] = None
    voiceId: Optional[str] = None
    stability: Optional[float] = None
    similarityBoost: Optional[float] = None

class TherapyConversationResponse(BaseModel):
    success: bool
    message: str
    therapistResponse: Optional[str] = None
    audioUrl: Optional[str] = None
    conversationId: Optional[str] = None
    transcribedText: Optional[str] = None

@define_rpc(
    name="meditation.therapyConversation",
    path="/meditation/therapy-conversation",
    params=TherapyConversationParams,
    response=TherapyConversationResponse,
)
async def therapy_conversation(params: TherapyConversationParams, request=None) -> TherapyConversationResponse:
    try:
        if not params.userMessage or not params.userMessage.strip():
            return TherapyConversationResponse(
                success=False,
                message="User message cannot be empty",
            )

        with Session(engine) as session:
            # 1. Save user's message to database history
            user_hist = TherapyHistoryModel(
                session_id=params.sessionId,
                role="user",
                message=params.userMessage.strip()
            )
            session.add(user_hist)
            session.commit()

            # 2. Fetch history for this session (up to last 15 messages for context)
            stmt = select(TherapyHistoryModel).where(
                TherapyHistoryModel.session_id == params.sessionId
            ).order_by(TherapyHistoryModel.created_at.asc())
            history = session.exec(stmt).all()

            # Limit to last 15 context turns to avoid massive context size, keeping oldest first
            if len(history) > 15:
                history = history[-15:]

            # 3. Format history for Gemini
            system_instruction = (
                "You are Vyom, a professional, warm, compassionate, and highly empathetic AI therapist. "
                "Help the user explore their thoughts and feelings in a safe, judgment-free space. "
                "Offer gentle validation, active listening, and thoughtful follow-up questions. "
                "Keep your responses concise (1 to 3 sentences maximum) because they will be read aloud to the user via Text-to-Speech. "
                "Always speak directly to the patient. Do not use markdown styling, bullet points, or list structures."
            )

            history_str = ""
            for turn in history[:-1]: # exclude the user message we just inserted as we append it next
                role_name = "User" if turn.role == "user" else "Therapist"
                history_str += f"{role_name}: {turn.message}\n"

            prompt = f"{history_str}User: {params.userMessage.strip()}\nTherapist:"

            logger.info(f"Sending prompt to Gemini (gemini-3.5-flash-lite) for session {params.sessionId}...")
            
            # Call Gemini with gemini-3.5-flash-lite
            reply = gemini_service.generate_content(
                prompt=prompt,
                system_instruction=system_instruction,
                temperature=0.7,
                model_name="gemini-3.5-flash-lite",
            ).strip()

            # Clean reply text (e.g. remove any leading/trailing "Therapist:" prefix if generated)
            if reply.lower().startswith("therapist:"):
                reply = reply[len("therapist:"):].strip()

            # 4. Save therapist response to database history
            therapist_hist = TherapyHistoryModel(
                session_id=params.sessionId,
                role="model",
                message=reply
            )
            session.add(therapist_hist)
            session.commit()

        # 5. Synthesize speech for therapist reply
        voice = params.voiceId or "aria"
        logger.info(f"Synthesizing response via Edge-TTS using voice '{voice}'...")
        tts_result = await tts_service.generate_speech(text=reply, voice=voice)

        audio_url = None
        if tts_result.get("success") and tts_result.get("audio_base64"):
            # Save audio bytes to static uploads directory
            uploads_dir = os.path.abspath(os.path.join("uploads", "meditation_tts"))
            os.makedirs(uploads_dir, exist_ok=True)

            filename = f"{uuid.uuid4().hex}.mp3"
            filepath = os.path.join(uploads_dir, filename)

            audio_bytes = base64.b64decode(tts_result["audio_base64"])
            with open(filepath, "wb") as f:
                f.write(audio_bytes)

            audio_url = f"/uploads/meditation_tts/{filename}"
            logger.info(f"Successfully saved synthesized reply to {audio_url}")
        else:
            logger.warning(f"TTS synthesis failed: {tts_result.get('message', 'Unknown error')}")

        return TherapyConversationResponse(
            success=True,
            message="Therapy conversation processed successfully",
            therapistResponse=reply,
            audioUrl=audio_url,
            conversationId=params.sessionId,
            transcribedText=params.userMessage,
        )

    except Exception as e:
        logger.error(f"Therapy conversation error: {e}", exc_info=True)
        return TherapyConversationResponse(
            success=False,
            message=f"Failed to process therapy conversation: {str(e)}",
        )
