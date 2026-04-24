import { useState, useRef } from "react";

export default function useSpeechToText() {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Use webm, it's standard for MediaRecorder on Chrome
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        // Fallback for Safari
        mimeType = 'audio/mp4'; 
      }
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        
        // Stop all tracks to quickly release the microphone icon in browser
        stream.getTracks().forEach(track => track.stop());
        
        // Immediately start uploading
        await sendToTranscribe(audioBlob, mimeType);
      };

      mediaRecorder.start();
      setListening(true);
      setText(""); // Reset hook text on new record
    } catch (error) {
      console.error("Microphone access denied:", error);
      alert("Microphone access denied. Please allow microphone permissions in your browser.");
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && listening) {
      mediaRecorderRef.current.stop();
      setListening(false);
      setIsTranscribing(true); // Switch to waiting state
    }
  };

  const sendToTranscribe = async (audioBlob, mimeType) => {
    const formData = new FormData();
    const extension = mimeType.split('/')[1].split(';')[0];
    formData.append("file", audioBlob, `recording.${extension}`);

    try {
      const res = await fetch("http://127.0.0.1:8000/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      setText(data.transcript);
    } catch (e) {
      console.error("Transcription failed:", e);
      alert("Failed to transcribe audio. Is the backend running?");
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