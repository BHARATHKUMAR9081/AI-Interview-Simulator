import { useState, useEffect } from "react";
import useSpeechToText from "./useSpeechToText";
import "./App.css";

const TOTAL_QUESTIONS = 5;

function App() {
  // Application Modes: 'UPLOAD' | 'INTERVIEW' | 'FEEDBACK' | 'SUMMARY'
  const [appMode, setAppMode] = useState("UPLOAD");
  
  // Interview State
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [questionIndex, setQuestionIndex] = useState(1);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [totalScore, setTotalScore] = useState(0);
  const [s3Saved, setS3Saved] = useState(false);
  const [hasAutomaticallyListened, setHasAutomaticallyListened] = useState(false);

  const { text, listening, isTranscribing, startListening, stopListening } = useSpeechToText();

  // 🔊 Speak function
  const speak = (text) => {
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "en-US";
    speech.rate = 1.0;
    speech.pitch = 1.0;
    window.speechSynthesis.speak(speech);
  };

  // 📄 Upload Resume -> Get first question
  const uploadResume = async (file) => {
    if (!file) return;
    setIsLoading(true);
    setLoadingText("Analyzing your resume and generating the perfect first question...");
    setAppMode("UPLOAD");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://127.0.0.1:8000/generate", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      setCurrentQuestion(data.question);
      setAppMode("INTERVIEW");
      setQuestionIndex(1);
      setCurrentAnswer("");
      setHasAutomaticallyListened(false);
    } catch (e) {
      alert("Error starting interview. Is the backend running?");
    } finally {
      setIsLoading(false);
    }
  };

  // 🔊 Speak question aloud when page loads
  useEffect(() => {
    // When a question appears in INTERVIEW mode
    if (appMode === "INTERVIEW" && currentQuestion && !hasAutomaticallyListened) {
      speak(`Question ${questionIndex}. ${currentQuestion}`);
      setHasAutomaticallyListened(true);
    }
  }, [appMode, currentQuestion, questionIndex, hasAutomaticallyListened]);

  // 🎤 Auto fill answer from voice
  useEffect(() => {
    if (text) {
      setCurrentAnswer(prev => {
        if (!prev.trim()) return text;
        if (prev.includes(text)) return prev;
        return prev + " " + text;
      });
    }
  }, [text]);

  // 🧠 Submit Answer
  const submitAnswer = async () => {
    // Stop listening if accidentally still active
    if (listening) {
      stopListening();
    }
    
    setIsLoading(true);
    setLoadingText("Evaluating your answer and generating adaptive feedback...");
    
    const isLast = questionIndex >= TOTAL_QUESTIONS;

    try {
      const res = await fetch("http://127.0.0.1:8000/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: currentQuestion,
          answer: currentAnswer || "No answer provided.",
          is_last: isLast
        }),
      });

      const data = await res.json();
      const earnedScore = data.score || 0;
      setFeedback(data);
      setTotalScore(prev => prev + earnedScore);
      
      speak(data.spoken);
      setAppMode("FEEDBACK");
    } catch(e) {
      alert("Error evaluating answer!");
    } finally {
      setIsLoading(false);
    }
  };

  // ➡️ Next Question or Finish
  const handleNextStep = async () => {
    setFeedback(null);
    setCurrentAnswer("");
    setHasAutomaticallyListened(false);
    
    if (questionIndex >= TOTAL_QUESTIONS) {
      // It was the last question, go to summary
      setAppMode("SUMMARY");
      speak(`Interview completed! Your total score is ${totalScore} out of ${TOTAL_QUESTIONS * 10}. Outstanding effort.`);
      
      // Hit finalize to just indicate UI side is done if we want, 
      // but S3 is actually saved by the backend in run_interview... 
      // Wait, in our new setup, the backend API evaluates one at a time.
      // Let's call /finalize
      try {
         setIsLoading(true);
         setLoadingText("Saving session to S3...");
         await fetch("http://127.0.0.1:8000/finalize", {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ final_score: totalScore, max_score: TOTAL_QUESTIONS * 10 })
         });
         setS3Saved(true);
      } catch (e) {
         console.warn("Could not finalize S3 upload");
      } finally {
         setIsLoading(false);
      }
    } else {
      // Advance to next question
      setCurrentQuestion(feedback.next_question);
      setQuestionIndex(prev => prev + 1);
      setAppMode("INTERVIEW");
    }
  };

  return (
    <div className="app-container">
      <div className="header">
        <h1>AI Interview Simulator</h1>
        <p>Master your skills with dynamic questions and instant feedback.</p>
      </div>

      {isLoading && (
        <div className="loader-container">
          <div className="loader"></div>
          <p className="loader-text">{loadingText}</p>
        </div>
      )}

      {/* Mode: UPLOAD */}
      {!isLoading && appMode === "UPLOAD" && (
        <div className="upload-box">
          <label htmlFor="resume-upload" className="upload-label">
            Upload Your Resume (PDF)
          </label>
          <input
            id="resume-upload"
            type="file"
            accept=".pdf"
            onChange={(e) => uploadResume(e.target.files[0])}
          />
          <p style={{marginTop: "16px", color: "var(--text-muted)"}}>
            We'll customize your interview based on your experience.
          </p>
        </div>
      )}

      {/* Mode: INTERVIEW */}
      {!isLoading && appMode === "INTERVIEW" && (
        <div className="question-panel">
          <div style={{color: "var(--accent-base)", fontWeight: 700, marginBottom: "8px"}}>
            QUESTION {questionIndex} OF {TOTAL_QUESTIONS}
          </div>
          <h2>{currentQuestion}</h2>

          <textarea
            className="answer-area"
            value={currentAnswer}
            onChange={(e) => setCurrentAnswer(e.target.value)}
            placeholder="Your answer will appear here as you speak... You can also type manually."
          />

          <div className="control-row">
            {!listening && !isTranscribing ? (
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  window.speechSynthesis.cancel();
                  startListening();
                }}
              >
                🎙️ Start Speaking
              </button>
            ) : listening ? (
              <button className="btn btn-danger" onClick={stopListening}>
                🛑 Stop Speaking
              </button>
            ) : null}

            {listening && <div className="mic-indicator">● Listening...</div>}
            {isTranscribing && (
              <div className="mic-indicator" style={{ background: "rgba(98, 54, 255, 0.9)", animation: "none" }}>
                ⏳ Transcribing with AI...
              </div>
            )}
          </div>

          <button 
            className="btn btn-primary" 
            onClick={submitAnswer}
            disabled={!currentAnswer.trim() && !listening}
          >
            Submit Answer & Get Feedback
          </button>
        </div>
      )}

      {/* Mode: FEEDBACK */}
      {!isLoading && appMode === "FEEDBACK" && feedback && (
        <div className="question-panel">
          <h2>Evaluation Complete</h2>
          
          <div className="feedback-panel">
            <div className="score-badge">Score: {feedback.score} / 10</div>
            <h4>Detailed Feedback</h4>
            <p>{feedback.feedback}</p>
          </div>

          <div className="control-row" style={{marginTop: "32px"}}>
            <button className="btn btn-primary" onClick={handleNextStep}>
              {questionIndex >= TOTAL_QUESTIONS ? "View Final Summary 🏆" : "Proceed to Next Adaptive Question ➡️"}
            </button>
          </div>
        </div>
      )}

      {/* Mode: SUMMARY */}
      {!isLoading && appMode === "SUMMARY" && (
        <div className="summary-panel">
          <h2>Interview Completed</h2>
          <div className="final-score">
            {totalScore} <span style={{fontSize: "24px", color: "var(--text-muted)"}}>/ {TOTAL_QUESTIONS * 10}</span>
          </div>
          
          <p style={{fontSize: "18px", lineHeight: "1.6"}}>
            You've completed all {TOTAL_QUESTIONS} questions. Consistent practice makes perfect!
          </p>
          
          {s3Saved && (
             <div className="status-badge">✅ Session Data Secured to AWS S3</div>
          )}

          <div style={{marginTop: "40px"}}>
             <button className="btn btn-secondary" onClick={() => window.location.reload()}>
                Start a New Interview
             </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;