# 🔊 Connect AI — 로컬 Qwen3-TTS 서버
# GPU(NVIDIA) 있는 PC에서 이걸 띄우면, Connect AI 앱이 호출해 완전 로컬·무료로 자비스 음성을 냅니다.
# 계약(앱과 약속): POST /tts  { "text": "...", "voice": "Sohee" }  →  audio/wav 바이트
#
# ── 설치 (Python 3.12, NVIDIA GPU 권장) ──
#   conda create -n qwen3-tts python=3.12 -y && conda activate qwen3-tts
#   pip install -U qwen-tts fastapi "uvicorn[standard]" soundfile
#   pip install -U flash-attn --no-build-isolation     # GPU 가속(선택, 권장)
#
# ── 실행 ──
#   uvicorn qwen_tts_server:app --host 127.0.0.1 --port 7920
#   → 그다음 Connect AI: ⚙️ 설정 → 고급 → "로컬 Qwen3-TTS 서버"에  http://127.0.0.1:7920  입력
#     그리고 🔊 목소리에서 Qwen 음성(예: Sohee 한국어) 선택.
#
# ⚠️ 맥북(Apple Silicon)은 CUDA/FlashAttention 미지원이라 사실상 안 됩니다. GPU PC에서 쓰세요.

import io
import torch
import soundfile as sf
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse
from qwen_tts import Qwen3TTSModel

MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"  # 가벼운 0.6B. 더 좋은 품질은 1.7B-CustomVoice.
SPEAKERS = {"vivian", "serena", "uncle_fu", "dylan", "eric", "ryan", "aiden", "ono_anna", "sohee"}

print(f"[qwen-tts] loading {MODEL} …")
_kw = dict(device_map="cuda:0" if torch.cuda.is_available() else "cpu", dtype=torch.bfloat16)
try:
    model = Qwen3TTSModel.from_pretrained(MODEL, attn_implementation="flash_attention_2", **_kw)
except Exception:
    model = Qwen3TTSModel.from_pretrained(MODEL, **_kw)  # FlashAttention 없으면 폴백
print("[qwen-tts] ready.")

app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/tts")
async def tts(req: Request):
    body = await req.json()
    text = (body.get("text") or "").strip()
    voice = (body.get("voice") or "Sohee").replace(" ", "_")
    if not text:
        return JSONResponse({"error": "no text"}, status_code=400)
    speaker = voice if voice.lower() in SPEAKERS else "Sohee"
    # language="Auto" → 텍스트 언어 자동 감지. instruct로 감정/톤도 지정 가능.
    wavs, sr = model.generate_custom_voice(text=text, language="Auto", speaker=speaker)
    buf = io.BytesIO()
    sf.write(buf, wavs[0], sr, format="WAV")
    buf.seek(0)
    return Response(content=buf.read(), media_type="audio/wav")
