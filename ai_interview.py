
import os
import sys
import PyPDF2
import pyttsx3
import speech_recognition as sr
from groq import Groq

# ==============================
# 🔑 CONFIG
# ==============================
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
client = Groq(api_key=GROQ_API_KEY)
recognizer = sr.Recognizer()
GROQ_LLM_MODEL = "llama-3.3-70b-versatile"
GROQ_AUDIO_MODEL = "whisper-large-v3"

SAMPLERATE = 16000
NUM_QUESTIONS = 5

import re as _re
import time as _time
import json
import uuid
import datetime
import boto3
from botocore.exceptions import ClientError

# ==============================
# 🔊 TEXT TO SPEECH
# ==============================
def speak(text):
    if not text.strip():
        return
    
    print(f"🤖 AI: {text}")
    
    engine = pyttsx3.init()
    engine.setProperty('rate', 170)
    engine.setProperty('volume', 1.0)
    
    engine.say(text)
    engine.runAndWait()
    engine.stop()

# ==============================
# 📄 PDF READER
# ==============================
def extract_resume(path):
    text = ""
    with open(path, "rb") as file:
        reader = PyPDF2.PdfReader(file)
        for page in reader.pages:
            text += page.extract_text() or ""
    return text

# ==============================
# 🤖 GROQ LLM CALL
# ==============================
def _groq_generate(prompt) -> str:
    # Handle if a list arrives from old code calls
    if isinstance(prompt, list):
        prompt = next((p for p in prompt if isinstance(p, str)), str(prompt))
        
    for attempt in range(4):
        try:
            chat_completion = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model=GROQ_LLM_MODEL,
            )
            return chat_completion.choices[0].message.content.strip()
        except Exception as e:
            msg = str(e)
            if "429" in msg or "Rate limit" in msg:
                wait_time = 3 * (2 ** attempt)
                if attempt < 3:
                    print(f"\n⏳ API Busy. Retrying in {wait_time}s... (Attempt {attempt + 1}/4)")
                    try:
                        speak(f"API busy. Retrying in {wait_time} seconds.")
                    except:
                        pass
                    _time.sleep(wait_time)
                else:
                    raise RuntimeError("Groq API heavily loaded or rate limits exhausted.")
            else:
                raise

# ==============================
# 🧠 QUESTION GENERATION
# ==============================
def generate_first_question(resume_text: str):
    print(f"\n🧠 Generating first question...")
    
    prompt = f"""
Based on the following resume, ask the single most important introductory technical interview question to assess the candidate's core competency.
Return ONLY the question text (no numbering, no intro).

Resume:
{resume_text}
"""
    raw = _groq_generate(prompt)
    clean = raw.strip()
    clean = _re.sub(r'^[0-9]+[.)-]*\s*', '', clean)
    return clean

# ==============================
# 🧠 EVALUATION & ADAPTIVE DIFFICULTY
# ==============================
def evaluate_and_generate_next(resume_text: str, question: str, answer: str, is_last: bool = False):
    next_q_prompt = ""
    if not is_last:
        next_q_prompt = f"""
Next Question:
<a single next question that adapts to the candidate. If the score is >=7, ask a slightly harder or deeper question related to their resume. If the score is <7, ask a foundational question or shift to a simpler concept.>
"""
    
    prompt = f"""
You are an interviewer evaluating an answer based on this resume:
{resume_text[:2000]}

Evaluate the candidate's answer strictly.
Return ONLY in this format:

Score: X/10
Feedback:
- <point 1>

Improved Answer:
<short improved answer>
{next_q_prompt}

Question: {question}
Answer: {answer}
"""
    text = _groq_generate(prompt)

    score = 0
    feedback = ""
    next_question = ""

    current_section = ""
    for line in text.split("\n"):
        line_s = line.strip()
        if "Score:" in line:
            try:
                score = int(line.split(":")[1].split("/")[0].strip())
            except:
                pass
        elif line.startswith("Feedback:"):
            current_section = "feedback"
        elif line.startswith("Improved Answer:"):
            current_section = "improved"
            feedback += "\n" + line
        elif line.startswith("Next Question:"):
            current_section = "next"
        else:
            if current_section == "feedback":
                feedback += "\n" + line
            elif current_section == "improved":
                feedback += "\n" + line
            elif current_section == "next":
                next_question += " " + line_s

    feedback = feedback.strip()
    next_question = next_question.strip()

    spoken_feedback = feedback.split('Improved Answer:')[0] if 'Improved Answer:' in feedback else feedback
    spoken = f"You scored {score} out of 10. {spoken_feedback.replace('-', '').replace('*', '').strip()}"
    return score, feedback, spoken, next_question

# ==============================
# ☁️ S3 STORAGE
# ==============================
def save_to_s3(session_data: dict):
    bucket_name = "ai-interview-simulator-bucket-data" # Configurable, must be globally unique
    s3 = boto3.client('s3')
    
    session_id = str(uuid.uuid4())
    key = f"interviews/interview_{session_id}.json"
    
    session_data['session_id'] = session_id
    session_data['timestamp'] = datetime.datetime.now().isoformat()
    
    try:
        s3.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=json.dumps(session_data, indent=2),
            ContentType='application/json'
        )
        print(f"✅ Successfully exported results to S3: s3://{bucket_name}/{key}")
        return True
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'NoSuchBucket':
            try:
                s3.create_bucket(Bucket=bucket_name)
                s3.put_object(
                    Bucket=bucket_name,
                    Key=key,
                    Body=json.dumps(session_data, indent=2),
                    ContentType='application/json'
                )
                print(f"✅ Created bucket and exported results to S3")
                return True
            except Exception as e2:
                 print(f"❌ Could not create bucket: {e2}")
        else:
            print(f"❌ S3 Upload Failed: {e}")
    except Exception as e:
        print(f"❌ General S3 Error: {e}")
        
    return False


# ==============================
# 🎙️ AUDIO TRANSCRIPTION
# ==============================
def transcribe_audio(file_path: str):
    print(f"\n[STT] Transcribing audio using Groq Whisper...")
    try:
        with open(file_path, "rb") as file:
            transcription = client.audio.transcriptions.create(
              file=(file_path, file.read()),
              model=GROQ_AUDIO_MODEL,
            )
        
        print(f"[STT] Transcribed: {transcription.text}")
        return transcription.text
    except Exception as e:
        print(f"[Error] Transcription Failed: {e}")
        return ""

# ==============================
# 🎤 SPEECH INPUT
# ==============================
def listen():
    with sr.Microphone() as source:
        print("🎤 Speak...")
        recognizer.adjust_for_ambient_noise(source, duration=1)  # adapt to background noise
        recognizer.pause_threshold = 2.0       # wait 2 seconds of silence before stopping
        recognizer.energy_threshold = 300      # sensitivity to sound
        recognizer.phrase_threshold = 0.3      # minimum speech before recording starts
        audio = recognizer.listen(source, timeout=10, phrase_time_limit=60)  # increased to 60s

    try:
        text = recognizer.recognize_google(audio, language="en-IN")
        print(f"🧑 {text}")
        return text
    except:
        speak("Sorry, I could not hear you clearly. Please try again.")
        return ""
# ==============================
# 🎯 MAIN INTERVIEW
# ==============================
def run_interview(resume_text):
    speak("Welcome to AI Interview. Please wait while I analyze your resume.")

    q = generate_first_question(resume_text)
    speak("Your interview is ready. I will now ask you the first question.")

    scores = []
    interview_log = []

    for i in range(1, NUM_QUESTIONS + 1):
        print(f"\nQ{i}: {q}")
        speak(f"Question {i}. {q}")

        ans = ""
        retries = 0
        while not ans and retries < 3:
            ans = listen()
            retries += 1

        if not ans:
            speak("No answer detected. Moving to the next question.")
            scores.append(0)
            interview_log.append({"question": q, "answer": "", "score": 0, "feedback": "No answer"})
            q = "Could you please explain a project you are proud of?"
            continue

        is_last = (i == NUM_QUESTIONS)
        score, feedback, spoken, next_question = evaluate_and_generate_next(resume_text, q, ans, is_last)
        
        scores.append(score)
        interview_log.append({"question": q, "answer": ans, "score": score, "feedback": feedback})
        
        speak(spoken)
        if not is_last:
            q = next_question

    total = sum(scores)
    print(f"\nFinal Score: {total}/{len(scores)*10}")
    speak(f"Interview complete. Your total score is {total} out of {len(scores) * 10}. Thank you for attending.")
    
    # Save to S3
    session_data = {
        "final_score": total,
        "max_score": len(scores) * 10,
        "qa_log": interview_log
    }
    save_to_s3(session_data)

# ==============================
# 🚀 ENTRY
# ==============================
if __name__ == "__main__":
    resume_path = input("Enter resume path: ").strip()

    if not os.path.isfile(resume_path):
        print("❌ File not found")
        speak("File not found. Please check the path and try again.")
        sys.exit()

    resume_text = extract_resume(resume_path)
    run_interview(resume_text)

