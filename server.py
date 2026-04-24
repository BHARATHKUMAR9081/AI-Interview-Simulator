from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import shutil
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
    file_path = "temp.pdf"

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    resume_text = ai_interview.extract_resume(file_path)
    question = ai_interview.generate_first_question(resume_text)

    return {"question": question}


# ==============================
# 🧠 Evaluate Answer API
# ==============================
@app.post("/evaluate")
async def evaluate(data: dict):
    question = data.get("question")
    answer = data.get("answer")
    is_last = data.get("is_last", False)

    # Re-read resume directly from temp to avoid holding global state
    try:
        resume_text = ai_interview.extract_resume("temp.pdf")
    except Exception:
        resume_text = ""

    score, feedback, spoken, next_question = ai_interview.evaluate_and_generate_next(
        resume_text, question, answer, is_last
    )

    return {
        "score": score,
        "feedback": feedback,
        "spoken": spoken,
        "next_question": next_question
    }

# ==============================
# ☁️ Save to S3 API
# ==============================
@app.post("/finalize")
async def finalize(data: dict):
    success = ai_interview.save_to_s3(data)
    return {"saved": success}

# ==============================
# 🎙️ Transcribe Audio API
# ==============================
@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    file_path = "temp_audio.webm"
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    transcript = ai_interview.transcribe_audio(file_path)
    
    return {"transcript": transcript}



# ==============================
# 🚀 Run Server
# ==============================