import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JarvisProvider } from "./context/JarvisProvider.jsx";
import { JarvisApp } from "./JarvisApp.jsx";

const root = document.getElementById("jarvis-root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <JarvisProvider>
        <JarvisApp />
      </JarvisProvider>
    </StrictMode>,
  );
}
