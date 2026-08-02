import { useState, useRef } from "react";

export default function useSpeechToText() {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const startListening = async () => {
    setText("");
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else {
          mimeType = ''; // Let browser use default
        }
      }

      const options = mimeType ? { mimeType } : {};
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop stream tracks
        stream.getTracks().forEach(track => track.stop());

        const actualMime = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMime });
        
        console.log(`[Audio Recorder] Recorded blob size: ${audioBlob.size} bytes, type: ${actualMime}`);

        if (audioBlob.size > 0) {
          await sendToTranscribe(audioBlob, actualMime);
        } else {
          console.warn("[Audio Recorder] Audio blob is 0 bytes!");
          setIsTranscribing(false);
        }
      };

      // Collect data every 250ms
      mediaRecorder.start(250);
      setListening(true);
    } catch (error) {
      console.error("Microphone access denied or error:", error);
      alert("Microphone access error. Please ensure microphone permissions are allowed in your browser.");
      setListening(false);
      setIsTranscribing(false);
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setListening(false);
      setIsTranscribing(true);
    }
  };

  const sendToTranscribe = async (audioBlob, mimeType) => {
    const formData = new FormData();
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    formData.append("file", audioBlob, `recording.${ext}`);

    try {
      const res = await fetch("http://127.0.0.1:8000/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      const transcribed = data.transcript ? data.transcript.trim() : "";
      
      console.log("[Audio Recorder] Server returned transcript:", transcribed);
      
      const lower = transcribed.toLowerCase();
      // Only filter if transcript is strictly just a silence dot or empty
      if (lower === "." || lower === "thank you." || lower === "thank you") {
        setText("");
      } else {
        setText(transcribed);
      }
    } catch (e) {
      console.error("Transcription API failed:", e);
      alert("Failed to transcribe audio. Is the backend server running at http://127.0.0.1:8000?");
    } finally {
      setIsTranscribing(false);
    }
  };

  return {
    text,
    listening,
    isTranscribing,
    startListening,
    stopListening
  };
}