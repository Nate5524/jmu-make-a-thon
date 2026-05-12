import { useEffect, useState } from "react";
import { useJarvis } from "../context/JarvisProvider.jsx";

function getAdminToken() {
  const stored = sessionStorage.getItem("admin_token");
  if (stored) return stored;
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (isLocal) return "dev-demo-secret";
  const token = prompt("Enter admin secret:");
  if (token) sessionStorage.setItem("admin_token", token);
  return token || "";
}

export function DevToolbar() {
  const [visible, setVisible] = useState(false);
  const { devReloadPrompt, clearChatDev } = useJarvis();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("dev")) sessionStorage.setItem("dev_mode", "1");
    setVisible(sessionStorage.getItem("dev_mode") === "1");
  }, []);

  if (!visible) return null;

  return (
    <div id="devToolbar">
      <span className="dev-label">DEV</span>
      <button type="button" onClick={() => void devReloadPrompt()}>
        Reload Prompt
      </button>
      <button
        type="button"
        onClick={() => {
          const token = getAdminToken();
          void clearChatDev(token);
        }}
      >
        Clear Chat
      </button>
    </div>
  );
}
