import { useEffect, useRef } from "react";

export function AboutDialog({ open, onOpenChange }) {
  const aboutRef = useRef(null);

  useEffect(() => {
    const d = aboutRef.current;
    if (!d) return;
    if (open) {
      if (!d.open) d.showModal();
    } else if (d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={aboutRef}
      id="aboutDialog"
      className="about-dialog"
      aria-labelledby="aboutDialogTitle"
      onClick={(e) => e.target === aboutRef.current && onOpenChange(false)}
    >
      <div className="about-dialog__panel">
        <h2 id="aboutDialogTitle" className="about-dialog__title">
          About Us: The PowerSleep Mission
        </h2>
        <div className="about-dialog__body">
          <p>
            We are Sleepy Heads, a multi-disciplinary team of students from James Madison University. Our project, PowerSleep, was born from a simple, relatable problem: waking up is hard, and poor sleep habits are a direct drain on mental and
            physical health. We believe that technology should be a &quot;force multiplier&quot; for your well-being, not just another screen to stare at.
          </p>
          <h3 className="about-dialog__section-title">What is PowerSleep?</h3>
          <p>
            PowerSleep is an open-source home automation hub designed to turn your morning struggle into a seamless, high-performance routine. By integrating your Google Calendar, real-time Weather, and Spotify, PowerSleep automates your environment
            to help you rise naturally. Our centerpiece is Jarvis, an advanced AI companion capable of speech-to-text and natural voice interaction. Jarvis doesn&apos;t just display your day—he talks you through it, manages your smart home hardware like
            blinds and lights, and helps you stay on track with your habits.
          </p>
          <h3 className="about-dialog__section-title">Our Motivation</h3>
          <p>
            We are invested in this because we&apos;ve lived the problem. As students, we know how easy it is to sacrifice sleep, and we wanted to build the tool we wish we had to optimize our own &quot;sleepmaxxing&quot; routines. Unlike rigid, closed-source smart
            home systems, PowerSleep is built to be consumer-supportive and innovative. We provide a premium AI experience that focuses on resiliency, using agentic capabilities to make waking up fun, productive, and—most importantly—better for your
            soul.
          </p>
          <h3 className="about-dialog__section-title">Quick Stats &amp; Info:</h3>
          <p>
            <strong>The Team:</strong> A diverse group including Layla, Nate, Enzo, Ben, Jack, and Charlie.
          </p>
          <p>
            <strong>The Tech:</strong> Powered by an agentic LLM framework, integrated with Spotify and Google APIs, and hosted for a fully interactive experience.
          </p>
          <p>
            <strong>Our Goal:</strong> To fix sleeping habits and improve societal mental health through accessible, open-source infrastructure.
          </p>
        </div>
        <button type="button" className="btn about-dialog__close" id="aboutCloseBtn" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </div>
    </dialog>
  );
}
