import { useEffect, useRef, useState } from "react";
import { useJarvis } from "../context/JarvisProvider.jsx";

function getSupportedMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

export function ChatPanel() {
  const { state, sendToJarvis, setStatus } = useJarvis();
  const [text, setText] = useState("");
  const messagesEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const isRecordingRef = useRef(false);
  const [recordingUi, setRecordingUi] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.conversationTurns]);

  const sendTextMessage = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    void sendToJarvis(t);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    isRecordingRef.current = false;
    setRecordingUi(false);
  };

  const transcribeAudio = async (blob) => {
    setStatus("Transcribing...");
    try {
      const result = await globalThis.puter.ai.speech2txt(blob, {
        model: "gpt-4o-transcribe",
        language: "en",
      });
      const t = (typeof result === "string" ? result : result?.text || "").trim();
      if (t) await sendToJarvis(t);
      else setStatus("I didn't catch that. Try again?");
    } catch (e) {
      console.error("STT error:", e);
      setStatus("Transcription failed — try again");
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Microphone requires an HTTPS connection");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: getSupportedMime() });
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!audioChunksRef.current.length) {
          setStatus("No audio captured");
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType });
        await transcribeAudio(blob);
      };
      mr.start();
      isRecordingRef.current = true;
      setRecordingUi(true);
      setStatus("Listening...");
    } catch (e) {
      console.error("Mic error:", e);
      setStatus("Microphone access denied");
    }
  };

  return (
    <section className="chat">
      <div className="messages" id="messages">
        {state.conversationTurns.map((m, i) => (
          <div className={"msg " + m.role} key={i}>
            <div className="label">{m.role === "user" ? "You" : "Jarvis"}</div>
            {m.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="status-bar" id="status">
        {state.statusText}
      </div>
      <div className="input-bar">
        <input
          type="text"
          id="textInput"
          placeholder="Type a message..."
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendTextMessage();
            }
          }}
        />
        <button
          type="button"
          className={"mic-btn" + (recordingUi ? " recording" : "")}
          id="micBtn"
          title="Hold or click to record"
          onMouseDown={() => {
            if (!isRecordingRef.current) void startRecording();
          }}
          onMouseUp={stopRecording}
          onMouseLeave={stopRecording}
          onTouchStart={(e) => {
            e.preventDefault();
            if (!isRecordingRef.current) void startRecording();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            stopRecording();
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="1" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="17" x2="12" y2="21" />
            <line x1="8" y1="21" x2="16" y2="21" />
          </svg>
        </button>
        <button type="button" className="send-btn" id="sendBtn" title="Send message" onClick={sendTextMessage}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </section>
  );
}
