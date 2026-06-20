import os
import json
import time
import asyncio
import shutil
import tempfile
from contextlib import asynccontextmanager
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path=_env_path, override=True)

from classifier import classify_intent, get_intent_classifier

whisper_model = None
gemini_model_ready = False

# ── Allowed origins ────────────────────────────────────────────────────────────
# Add your Vercel URL here. Keep localhost for local dev.
ALLOWED_ORIGINS = [
    os.getenv("FRONTEND_URL", "http://localhost:5500"),
    "http://localhost:3000",
    "http://127.0.0.1:5500",
]

# ── Max upload size (5 MB) ─────────────────────────────────────────────────────
MAX_AUDIO_BYTES = 5 * 1024 * 1024
ALLOWED_AUDIO_TYPES = {"audio/wav", "audio/webm", "audio/ogg", "audio/mpeg"}

@asynccontextmanager
async def lifespan(app: FastAPI):
    global whisper_model, gemini_model_ready
    try:
        from faster_whisper import WhisperModel
        print("Loading faster-whisper model ('tiny.en') …")
        whisper_model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
        print("Whisper model loaded.")
    except Exception as e:
        print(f"Whisper load error: {e}")

    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if gemini_api_key:
        try:
            from google import genai as genai_sdk  # noqa: F401
            gemini_model_ready = True
            print("Gemini API configured.")
        except Exception as e:
            print(f"Gemini config error: {e}")
    else:
        print("WARNING: GEMINI_API_KEY not set.")

    logs_file = os.path.join(os.path.dirname(__file__), "data", "commands_log.jsonl")
    os.makedirs(os.path.dirname(logs_file), exist_ok=True)
    if not os.path.exists(logs_file):
        open(logs_file, "w").close()

    yield


app = FastAPI(title="Vakya AI Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOGS_FILE = os.path.join(os.path.dirname(__file__), "data", "commands_log.jsonl")


def log_command(command: str, intent: str, confidence: float, duration: float, success: bool):
    try:
        entry = {
            "timestamp": time.time(),
            "command": command,
            "intent": intent,
            "confidence": confidence,
            "duration": duration,
            "success": success,
        }
        with open(LOGS_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        print(f"Logging error: {e}")


class ClassifyRequest(BaseModel):
    text: str


@app.get("/")
def read_root():
    return {"status": "ok", "message": "Vakya AI Backend running."}


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    global whisper_model
    if whisper_model is None:
        raise HTTPException(status_code=503, detail="Whisper model not loaded.")

    # ── Security: validate MIME type ──────────────────────────────────────────
    if file.content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio type '{file.content_type}'. Accepted: wav, webm, ogg, mpeg."
        )

    start_time = time.time()

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        # ── Security: enforce size limit ──────────────────────────────────────
        total = 0
        chunk_size = 65536
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_AUDIO_BYTES:
                os.remove(tmp.name)
                raise HTTPException(status_code=413, detail="Audio file exceeds 5 MB limit.")
            tmp.write(chunk)
        temp_path = tmp.name

    try:
        # ── Run Whisper in a thread so the event loop stays free ─────────────
        def _transcribe():
            segs, info = whisper_model.transcribe(temp_path, beam_size=5)
            text = " ".join(s.text for s in segs).strip()
            return text, info.duration, info.language

        text, duration, language = await asyncio.to_thread(_transcribe)

        return {
            "text": text,
            "duration": duration,
            "language": language,
            "processing_time": time.time() - start_time,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/classify")
async def classify_text(request: ClassifyRequest):
    try:
        return classify_intent(request.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/command")
async def process_command(
    command: str = Form(None),
    code: str = Form(""),
    language: str = Form("python"),
    file: UploadFile = File(None),
):
    start_time = time.time()
    final_command = command
    duration = 0.0

    if file:
        result = await transcribe_audio(file)
        final_command = result["text"]
        duration = result["duration"]

    if not final_command or not final_command.strip():
        raise HTTPException(status_code=400, detail="No command text or audio provided.")

    final_command = final_command.strip()
    print(f"Command: '{final_command}' | lang: {language} | code-len: {len(code)}")

    # ── Classify ──────────────────────────────────────────────────────────────
    try:
        classification = classify_intent(final_command)
    except Exception as e:
        print(f"Classification fallback: {e}")
        classification = {"intent": "EDIT", "confidence": 1.0, "fallback": True, "probabilities": {}}

    intent = classification["intent"]
    confidence = classification["confidence"]
    fallback = classification["fallback"]

    # ── UNDO — no LLM needed ──────────────────────────────────────────────────
    if intent == "UNDO" and not fallback:
        log_command(final_command, intent, confidence, time.time() - start_time, True)
        return {
            "command": final_command,
            "intent": intent,
            "confidence": confidence,
            "fallback": False,
            "action": "undo",
            "result": {"startLine": 1, "endLine": 1, "newCode": "", "explanation": "Undid the last action."},
        }

    # ── Gemini ────────────────────────────────────────────────────────────────
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key or not gemini_model_ready:
        log_command(final_command, intent, confidence, time.time() - start_time, False)
        return {
            "command": final_command, "intent": intent, "confidence": confidence,
            "fallback": True, "error": "Gemini API key not configured.",
            "result": {"startLine": 1, "endLine": 1, "newCode": "",
                       "explanation": "No Gemini API key found. Check your backend .env file."},
        }

    lines = code.splitlines()
    code_with_line_numbers = "\n".join(f"{i+1}: {ln}" for i, ln in enumerate(lines)) if lines else ""

    system_prompt = (
        "You are an AI assistant built into a voice-controlled browser-based code editor called Vakya.\n"
        "Return ONLY a valid raw JSON object — no markdown, no preamble.\n\n"
        "JSON structure:\n"
        "{\n"
        "  \"startLine\": integer (1-indexed),\n"
        "  \"endLine\": integer (1-indexed, >= startLine),\n"
        "  \"newCode\": \"replacement code — NO line-number prefixes\",\n"
        "  \"explanation\": \"brief markdown summary\"\n"
        "}\n\n"
        "EDIT/REFACTOR/GENERATE: replace exactly [startLine, endLine]. Match surrounding indentation.\n"
        "EXPLAIN: newCode = \"\". Put explanation in markdown.\n"
        "NAVIGATE: newCode = \"\". startLine = endLine = target line."
    )

    user_prompt = (
        f"User Command: \"{final_command}\"\n"
        f"Language: {language}\n"
        f"Intent hint: {intent} (confidence {confidence:.2f})\n\n"
        f"Code (with line numbers):\n```\n{code_with_line_numbers}\n```"
    )

    raw_response = ""
    try:
        from google import genai as genai_sdk
        from google.genai import types as genai_types

        client = genai_sdk.Client(api_key=gemini_api_key)
        config = genai_types.GenerateContentConfig(
            system_instruction=system_prompt,
            response_mime_type="application/json",
        )

        # ── Async — does NOT block the event loop ─────────────────────────────
        response = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-2.5-flash-lite",
            contents=user_prompt,
            config=config,
        )

        if not getattr(response, "candidates", None):
            raise HTTPException(status_code=500, detail="Gemini returned no candidates.")

        raw_response = response.text.strip()
        if not raw_response:
            raise HTTPException(status_code=500, detail="Gemini returned empty response.")

        result_json = json.loads(raw_response)
        log_command(final_command, intent, confidence, time.time() - start_time, True)

        return {
            "command": final_command,
            "intent": intent,
            "confidence": confidence,
            "fallback": fallback,
            "action": intent.lower(),
            "result": result_json,
        }

    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}. Raw: {raw_response}")
        log_command(final_command, intent, confidence, time.time() - start_time, False)
        raise HTTPException(status_code=500, detail=f"Gemini returned invalid JSON: {raw_response[:200]}")
    except Exception as e:
        err = str(e)
        log_command(final_command, intent, confidence, time.time() - start_time, False)
        if any(k in err for k in ["429", "RESOURCE_EXHAUSTED", "quota"]):
            raise HTTPException(status_code=429, detail="Gemini quota exceeded.")
        raise HTTPException(status_code=500, detail=f"Gemini error: {err}")


@app.get("/metrics")
def get_metrics():
    if not os.path.exists(LOGS_FILE):
        return {"total_commands": 0, "intent_distribution": {}, "average_confidence": 0.0, "success_rate": 0.0}

    total = successes = 0
    intent_counts: dict = {}
    total_conf = 0.0

    with open(LOGS_FILE) as f:
        for line in f:
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
                total += 1
                successes += int(entry.get("success", False))
                intent = entry.get("intent", "UNKNOWN")
                intent_counts[intent] = intent_counts.get(intent, 0) + 1
                total_conf += entry.get("confidence", 0.0)
            except Exception:
                pass

    return {
        "total_commands": total,
        "intent_distribution": intent_counts,
        "average_confidence": total_conf / total if total else 0.0,
        "success_rate": successes / total if total else 0.0,
    }
