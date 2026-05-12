import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import systemPromptMdUrl from "../data/jarvis-system-prompt.md?url";
import { JARVIS_TOOLS } from "../data/jarvis-accepted-functions.js";
import { SIDEBAR_CARD_ORDER_KEY } from "../sidebar/constants.js";
import { INITIAL_GREETING } from "../shared/constants.js";
import { buildLlmContextString } from "../lib/buildLlmContext.js";
import { apiFetchCalendarRange } from "../lib/calendarApi.js";
import { calendarDayBoundsIso, localIsoDate } from "../lib/calendarDates.js";
import { completeJarvisWithTools } from "../lib/jarvisChat.js";
import { createJarvisToolDispatch } from "../lib/jarvisToolsDispatch.js";
import { initialJarvisState, jarvisReducer } from "./jarvisReducer.js";

const JarvisContext = createContext(null);

function sidebarOrderFromStorage() {
  try {
    const raw = localStorage.getItem(SIDEBAR_CARD_ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function spotifyHintFromPlayer(player) {
  if (!player || !player.item) {
    return "Spotify: nothing playing (open Spotify on a device or use search below).";
  }
  const track = player.item;
  const artists = (track.artists || []).map((a) => a.name).join(", ");
  return `Spotify: ${player.is_playing ? "playing" : "paused"} — "${track.name}" by ${artists}.`;
}

export function JarvisProvider({ children }) {
  const [state, dispatch] = useReducer(jarvisReducer, undefined, () => {
    const s = initialJarvisState();
    s.calendarViewDate = localIsoDate();
    return s;
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const smartHomeMutationPendingRef = useRef(false);
  const systemPromptCacheRef = useRef(null);
  const systemPromptPromiseRef = useRef(null);
  const speechQueueRef = useRef(Promise.resolve());
  const sessionGeoCoordsRef = useRef(null);
  const sessionGeoDeniedRef = useRef(false);
  const sessionGeoReadPromiseRef = useRef(null);

  const setStatus = useCallback((msg) => {
    dispatch({ type: "SET_STATUS", payload: msg });
  }, []);

  const postChatMessage = useCallback((role, content) => {
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content }),
    }).catch((e) => console.warn("Failed to sync chat message to server", e));
  }, []);

  const applySmartHomeFromResponse = useCallback((devices, revision) => {
    dispatch({ type: "SET_SMARTHOME_FROM_DEVICES", payload: devices, revision });
  }, []);

  const setLastRevision = useCallback((rev) => {
    dispatch({ type: "SET_LAST_REVISION", payload: rev });
  }, []);

  const appendSchedule = useCallback((s) => {
    dispatch({ type: "ADD_SCHEDULE", payload: s });
  }, []);

  const removeSchedule = useCallback((id) => {
    dispatch({ type: "REMOVE_SCHEDULE", payload: id });
  }, []);

  const refetchCalendarDay = useCallback(async (dateOverride) => {
      const view = dateOverride ?? (stateRef.current.calendarViewDate || localIsoDate());
    try {
      const { timeMin, timeMax } = calendarDayBoundsIso(view);
      const events = await apiFetchCalendarRange(timeMin, timeMax);
      if (events != null) dispatch({ type: "SET_CALENDAR_EVENTS", payload: events });
    } catch (e) {
      console.warn("Calendar fetch failed", e);
    }
  }, []);

  const refetchCalendarContext = useCallback(async () => {
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 60);
      const events = await apiFetchCalendarRange(start.toISOString(), end.toISOString());
      if (events != null) dispatch({ type: "SET_CALENDAR_CONTEXT", payload: events });
    } catch (e) {
      console.warn("Calendar context fetch failed", e);
    }
  }, []);

  const refetchCalendarFull = useCallback(async () => {
    await refetchCalendarDay();
    await refetchCalendarContext();
  }, [refetchCalendarDay, refetchCalendarContext]);

  const refreshSpotifyPlayerIntoState = useCallback(async () => {
    try {
      const r = await fetch("/api/spotify/player");
      if (r.status === 503) {
        dispatch({
          type: "SET_SPOTIFY",
          payload: {
            configured: false,
            player: null,
            contextHint: "Spotify: not configured on the server.",
            loadError: "",
          },
        });
        return;
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        dispatch({
          type: "SET_SPOTIFY",
          payload: {
            configured: true,
            player: null,
            contextHint: stateRef.current.spotifyContextHint,
            loadError: err.error || "Could not load Spotify player",
          },
        });
        return;
      }
      const data = await r.json();
      const player = data.player;
      dispatch({
        type: "SET_SPOTIFY",
        payload: {
          configured: true,
          player,
          contextHint: spotifyHintFromPlayer(player),
          loadError: "",
        },
      });
    } catch (e) {
      console.warn("Spotify player", e);
    }
  }, []);

  const dispatchJarvisToolRef = useRef(async () => {});
  dispatchJarvisToolRef.current = createJarvisToolDispatch({
    getState: () => ({
      spotifyConfigured: stateRef.current.spotifyConfigured,
      spotifyWebDeviceId: stateRef.current.spotifyWebDeviceId,
    }),
    dispatch,
    refetchCalendar: refetchCalendarFull,
    applySmartHomeFromResponse,
    setLastRevision,
    refreshSpotifyPlayer: refreshSpotifyPlayerIntoState,
    appendSchedule,
    removeSchedule,
  });

  const dispatchJarvisTool = useCallback(async (name, args) => {
    return dispatchJarvisToolRef.current(name, args);
  }, []);

  const getLlmContextSlice = useCallback(() => {
    const s = stateRef.current;
    return {
      weatherData: s.weatherData,
      calendarContextEvents: s.calendarContextEvents,
      spotifyContextHint: s.spotifyContextHint,
      remoteSchedules: s.remoteSchedules,
    };
  }, []);

  const getSystemPrompt = useCallback(async () => {
    if (systemPromptCacheRef.current != null) return systemPromptCacheRef.current;
    if (!systemPromptPromiseRef.current) {
      systemPromptPromiseRef.current = fetch(`${systemPromptMdUrl}?cb=${Date.now()}`)
        .then((r) => {
          if (!r.ok) throw new Error("Failed to load jarvis-system-prompt.md");
          return r.text();
        })
        .then((t) => {
          systemPromptCacheRef.current = t.trim();
          return systemPromptCacheRef.current;
        });
    }
    return systemPromptPromiseRef.current;
  }, []);

  const invalidateSystemPrompt = useCallback(() => {
    systemPromptCacheRef.current = null;
    systemPromptPromiseRef.current = null;
  }, []);

  const queueSpeech = useCallback((text) => {
    speechQueueRef.current = speechQueueRef.current
      .then(async () => {
        try {
          const audio = await globalThis.puter.ai.txt2speech(text, {
            voice: "Matthew",
            engine: "neural",
          });
          await new Promise((resolve) => {
            audio.onended = resolve;
            audio.onerror = resolve;
            audio.play().catch(resolve);
          });
        } catch (e) {
          console.warn("TTS error, falling back to browser speech synthesis:", e);
          await new Promise((resolve) => {
            const utter = new SpeechSynthesisUtterance(text);
            utter.rate = 1.05;
            utter.onend = resolve;
            utter.onerror = resolve;
            speechSynthesis.speak(utter);
          });
        }
      })
      .catch(() => {});
    return speechQueueRef.current;
  }, []);

  const sendToJarvis = useCallback(
    async (userText) => {
      const prevTurns = stateRef.current.conversationTurns;
      const afterUser = [...prevTurns, { role: "user", content: userText }];
      dispatch({ type: "APPEND_USER", payload: userText });
      postChatMessage("user", userText);
      setStatus("Jarvis is thinking...");
      let systemPrompt;
      try {
        systemPrompt = await getSystemPrompt();
      } catch (e) {
        console.error("System prompt load failed:", e);
        setStatus("Error — could not load system prompt");
        const fallback = "Configuration error: jarvis-system-prompt.md could not be loaded.";
        dispatch({ type: "APPEND_ASSISTANT", payload: fallback });
        postChatMessage("assistant", fallback);
        return;
      }
      const contextBlock = buildLlmContextString(getLlmContextSlice());
      const personality = stateRef.current.remotePersonality.trim();
      const demoBlock = personality ? "\n\n--- DEMO FEED / PERSONALITY ---\n" + personality : "";
      const messages = [
        {
          role: "system",
          content: systemPrompt + demoBlock + "\n\n--- LIVE CONTEXT ---\n" + contextBlock,
        },
        ...afterUser.slice(-20).map((m) => ({ role: m.role, content: m.content })),
      ];
      const chatOptions = { model: "openai/gpt-5-nano", stream: false, tools: JARVIS_TOOLS };
      try {
        const reply = await completeJarvisWithTools(
          messages,
          chatOptions,
          dispatchJarvisTool,
          globalThis.puter.ai,
        );
        dispatch({ type: "APPEND_ASSISTANT", payload: reply });
        postChatMessage("assistant", reply);
        setStatus("Speaking...");
        await queueSpeech(reply);
        setStatus("Ready");
      } catch (e) {
        console.error("LLM error:", e);
        const fallback =
          "My apologies, I'm having trouble reaching the AI service. Check your network or try again.";
        dispatch({ type: "APPEND_ASSISTANT", payload: fallback });
        postChatMessage("assistant", fallback);
        setStatus("Error — AI unavailable");
      }
    },
    [dispatchJarvisTool, getLlmContextSlice, getSystemPrompt, postChatMessage, queueSpeech, setStatus],
  );

  const runScheduledJob = useCallback(
    async (job) => {
      const scheduleShouldSpeak = job.speak !== false;
      if (job.mode === "static") {
        const text = String(job.storedAssistantText || "");
        dispatch({ type: "APPEND_ASSISTANT", payload: text });
        postChatMessage("assistant", text);
        if (scheduleShouldSpeak && text.trim()) queueSpeech(text);
        return;
      }
      const toolResults = [];
      if (Array.isArray(job.toolSteps)) {
        for (const step of job.toolSteps) {
          try {
            const out = await dispatchJarvisTool(step.name, step.args || {});
            toolResults.push({ tool: step.name, result: out });
          } catch (err) {
            toolResults.push({ tool: step.name, error: err.message || String(err) });
          }
        }
      }
      let systemPrompt;
      try {
        systemPrompt = await getSystemPrompt();
      } catch {
        systemPrompt = "";
      }
      const contextBlock = buildLlmContextString(getLlmContextSlice());
      const repeatLabel = job.repeat === "once" ? "one-time" : job.repeat;
      const preamble = [
        `[SCHEDULED MESSAGE — triggered ${new Date().toLocaleString()} | ${repeatLabel} schedule | created by ${job.createdBy}]`,
        `Instruction: ${job.storedInstruction}`,
      ];
      if (toolResults.length) {
        preamble.push("Tool results:\n" + JSON.stringify(toolResults, null, 2));
      }
      const messages = [
        { role: "system", content: systemPrompt + "\n\n--- LIVE CONTEXT ---\n" + contextBlock },
        { role: "user", content: preamble.join("\n\n") },
      ];
      const reducedTools = JARVIS_TOOLS.filter((t) => {
        const n = t?.function?.name;
        return n !== "create_schedule" && n !== "cancel_schedule";
      });
      const chatOptions = {
        model: "openai/gpt-5-nano",
        stream: false,
        tools: reducedTools.length ? reducedTools : undefined,
      };
      try {
        const reply = await completeJarvisWithTools(
          messages,
          chatOptions,
          dispatchJarvisTool,
          globalThis.puter.ai,
        );
        dispatch({ type: "APPEND_ASSISTANT", payload: reply });
        postChatMessage("assistant", reply);
        if (scheduleShouldSpeak) queueSpeech(reply);
      } catch (err) {
        console.error("Scheduled job LLM error:", err);
        const fallback = `[Scheduled: ${job.label || "job"}] Sorry, I couldn't complete that scheduled task.`;
        dispatch({ type: "APPEND_ASSISTANT", payload: fallback });
        postChatMessage("assistant", fallback);
        if (scheduleShouldSpeak) queueSpeech(fallback);
      }
    },
    [dispatchJarvisTool, getLlmContextSlice, getSystemPrompt, postChatMessage, queueSpeech],
  );

  const consumeAndRunScheduledJobs = useCallback(async () => {
    try {
      const r = await fetch("/api/schedules/consume-due", { method: "POST" });
      if (!r.ok) return;
      const data = await r.json();
      if (!Array.isArray(data.jobs) || !data.jobs.length) return;
      for (const job of data.jobs) {
        await runScheduledJob(job);
      }
    } catch (e) {
      console.warn("consume-due failed:", e);
    }
  }, [runScheduledJob]);

  const pollDemoState = useCallback(async () => {
    if (smartHomeMutationPendingRef.current) return;
    try {
      const r = await fetch("/api/state");
      if (!r.ok) return;
      const data = await r.json();
      dispatch({
        type: "MERGE_POLL",
        payload: {
          revision: data.revision,
          personality: data.feed?.personality,
          smartHomeDevices: data.smartHome?.devices,
          schedules: data.schedules,
          chatHistory: data.chatHistory,
        },
      });
    } catch (e) {
      console.warn("Demo state poll failed", e);
    }
  }, []);

  useEffect(() => {
    const order = sidebarOrderFromStorage();
    if (order) dispatch({ type: "HYDRATE_SIDEBAR", payload: order });
  }, []);

  useEffect(() => {
    async function ensurePuter() {
      if (typeof globalThis.puter === "undefined" || !globalThis.puter.auth) {
        setStatus("Puter.js did not load");
        return;
      }
      try {
        if (
          typeof globalThis.puter.auth.isSignedIn === "function" &&
          globalThis.puter.auth.isSignedIn()
        ) {
          return;
        }
      } catch (e) {
        console.warn("Puter sign-in state:", e);
      }
      try {
        setStatus("Signing in to Puter...");
        await globalThis.puter.auth.signIn();
        setStatus("Puter connected");
      } catch (e) {
        setStatus("Puter sign-in failed: " + (e && e.message ? e.message : String(e)));
        console.warn("Puter sign-in:", e);
      }
    }
    void ensurePuter();
  }, [setStatus]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        console.warn("Microphone not available at load:", e);
      }
    })();
  }, []);

  useEffect(() => {
    void pollDemoState();
    const t = setInterval(pollDemoState, 2000);
    return () => clearInterval(t);
  }, [pollDemoState]);

  useEffect(() => {
    void refreshSpotifyPlayerIntoState();
    const t = setInterval(refreshSpotifyPlayerIntoState, 4000);
    return () => clearInterval(t);
  }, [refreshSpotifyPlayerIntoState]);

  useEffect(() => {
    void consumeAndRunScheduledJobs();
    const t = setInterval(consumeAndRunScheduledJobs, 3000);
    return () => clearInterval(t);
  }, [consumeAndRunScheduledJobs]);

  useEffect(() => {
    void refetchCalendarDay();
    void refetchCalendarContext();
    const t = setInterval(() => {
      void refetchCalendarDay();
      void refetchCalendarContext();
    }, 30000);
    return () => clearInterval(t);
  }, [refetchCalendarDay, refetchCalendarContext]);

  const getSessionGeoCoords = useCallback(async () => {
    if (sessionGeoCoordsRef.current) return sessionGeoCoordsRef.current;
    if (sessionGeoDeniedRef.current) return null;
    if (sessionGeoReadPromiseRef.current) return sessionGeoReadPromiseRef.current;
    if (!navigator.geolocation) return null;
    sessionGeoReadPromiseRef.current = (async () => {
      try {
        const pos = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, maximumAge: 0 }),
        );
        sessionGeoCoordsRef.current = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        return sessionGeoCoordsRef.current;
      } catch (e) {
        console.warn("Geolocation unavailable for weather", e);
        if (e && Number(e.code) === 1) sessionGeoDeniedRef.current = true;
        return null;
      } finally {
        sessionGeoReadPromiseRef.current = null;
      }
    })();
    return sessionGeoReadPromiseRef.current;
  }, []);

  const loadWeather = useCallback(async () => {
    const fallbackUrl =
      "https://api.open-meteo.com/v1/forecast?latitude=38.45&longitude=-78.87&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1&daily=temperature_2m_max,temperature_2m_min";
    const fetchUrl = async (url) => {
      const resp = await fetch(url);
      return resp.json();
    };
    try {
      const coords = await getSessionGeoCoords();
      if (!coords) {
        const data = await fetchUrl(fallbackUrl);
        dispatch({ type: "SET_WEATHER", payload: data });
        return;
      }
      const { latitude, longitude } = coords;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1&daily=temperature_2m_max,temperature_2m_min`;
      const data = await fetchUrl(url);
      dispatch({ type: "SET_WEATHER", payload: data });
    } catch (e) {
      console.warn("Weather fetch failed, trying fallback location", e);
      try {
        const data = await fetchUrl(fallbackUrl);
        dispatch({ type: "SET_WEATHER", payload: data });
      } catch {
        dispatch({ type: "SET_WEATHER_FAILED" });
      }
    }
  }, [getSessionGeoCoords]);

  useEffect(() => {
    void loadWeather();
  }, [loadWeather]);

  const clearChatDev = useCallback(
    async (token) => {
      if (!token) {
        setStatus("No admin token — aborted");
        return;
      }
      try {
        const r = await fetch("/api/chat", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${r.status}`);
        }
        const data = await r.json();
        const rev = Number(data.revision);
        dispatch({
          type: "RESET_CHAT",
          payload: INITIAL_GREETING,
          revision: Number.isFinite(rev) ? rev : undefined,
        });
        setStatus("Chat history cleared");
      } catch (e) {
        console.error("Clear chat failed:", e);
        setStatus("Failed to clear chat: " + e.message);
      }
    },
    [setStatus],
  );

  const devReloadPrompt = useCallback(async () => {
    invalidateSystemPrompt();
    await getSystemPrompt();
    setStatus("System prompt reloaded");
  }, [getSystemPrompt, invalidateSystemPrompt, setStatus]);

  const value = useMemo(
    () => ({
      state,
      dispatch,
      setStatus,
      postChatMessage,
      sendToJarvis,
      getSystemPrompt,
      invalidateSystemPrompt,
      devReloadPrompt,
      clearChatDev,
      refetchCalendarDay,
      refetchCalendarContext,
      refreshSpotifyPlayerIntoState,
      loadWeather,
      smartHomeMutationPendingRef,
      queueSpeech,
    }),
    [
      state,
      sendToJarvis,
      setStatus,
      postChatMessage,
      getSystemPrompt,
      invalidateSystemPrompt,
      devReloadPrompt,
      clearChatDev,
      refetchCalendarDay,
      refetchCalendarContext,
      refreshSpotifyPlayerIntoState,
      loadWeather,
      queueSpeech,
    ],
  );

  return <JarvisContext.Provider value={value}>{children}</JarvisContext.Provider>;
}

export function useJarvis() {
  const v = useContext(JarvisContext);
  if (!v) throw new Error("useJarvis must be used within JarvisProvider");
  return v;
}
