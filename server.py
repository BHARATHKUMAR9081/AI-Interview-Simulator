from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

import ai_interview  # your file name

app = FastAPI()

# ✅ Allow React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all (for dev)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================
# 📄 Generate Questions API
# ==============================
@app.post("/generate")
async def generate_questions(file: UploadFile = File(...)):
    print(f"[Server] Received file for question generation: {file.filename}", flush=True)
    file_path = "temp.pdf"

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        resume_text = ai_interview.extract_resume(file_path)
        question = ai_interview.generate_first_question(resume_text)
        print(f"[Server] Generated Question: {question}", flush=True)

        return {"question": question}
    except Exception as e:
        print(f"[Server Error] /generate failed: {e}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))


# ==============================
# 🧠 Evaluate Answer API
# ==============================
@app.post("/evaluate")
async def evaluate(data: dict):
    question = data.get("question")
    answer = data.get("answer")
    is_last = data.get("is_last", False)
    print(f"[Server] Evaluating answer for question: '{question[:30]}...'", flush=True)

    try:
        # Re-read resume directly from temp to avoid holding global state
        try:
            resume_text = ai_interview.extract_resume("temp.pdf")
        except Exception:
            resume_text = ""

        score, feedback, spoken, next_question = ai_interview.evaluate_and_generate_next(
            resume_text, question, answer, is_last
        )

        print(f"[Server] Evaluation completed. Score: {score}", flush=True)

        return {
            "score": score,
            "feedback": feedback,
            "spoken": spoken,
            "next_question": next_question
        }
    except Exception as e:
        print(f"[Server Error] /evaluate failed: {e}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))

# ==============================
# ☁️ Save to S3 API
# ==============================
@app.post("/finalize")
async def finalize(data: dict):
    print("[Server] Finalizing interview session...", flush=True)
    success = ai_interview.save_to_s3(data)
    print(f"[Server] Finalized result: {success}", flush=True)
    return {"saved": success}

# ==============================
# 🎙️ Transcribe Audio API
# ==============================
@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    filename = file.filename or "recording.webm"
    ext = os.path.splitext(filename)[1] or ".webm"
    file_path = f"temp_audio{ext}"
    print(f"[Server] Received audio file for transcription: {filename}", flush=True)
    
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        transcript = ai_interview.transcribe_audio(file_path)
        print(f"[Server] Transcribed audio output: '{transcript}'", flush=True)
        
        return {"transcript": transcript}
    except Exception as e:
        print(f"[Server Error] /transcribe failed: {e}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))



# ==============================
# 🚀 Run Server
# ==============================