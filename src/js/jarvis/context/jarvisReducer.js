import { SIDEBAR_CARD_KEYS } from "../sidebar/constants.js";
import { INITIAL_GREETING } from "../shared/constants.js";
import { normalizeSmartHomeClient } from "../lib/normalizeSmartHome.js";

export function initialJarvisState() {
  return {
    lastDemoRevision: -1,
    remotePersonality: "",
    remoteSmartHome: normalizeSmartHomeClient([]),
    remoteSchedules: [],
    sidebarCardOrder: [...SIDEBAR_CARD_KEYS],
    calendarViewDate: "",
    calendarEvents: [],
    calendarContextEvents: [],
    weatherData: null,
    weatherFailed: false,
    spotifyConfigured: true,
    spotifyPlayer: null,
    spotifyContextHint: "",
    spotifyLoadError: "",
    spotifyWebDeviceId: null,
    conversationTurns: [{ role: "assistant", content: INITIAL_GREETING }],
    statusText: "Ready",
  };
}

function mergeChatFromServer(conversationTurns, serverHistory) {
  if (!Array.isArray(serverHistory)) return conversationTurns;
  const localLen = conversationTurns.length;
  if (serverHistory.length <= localLen) return conversationTurns;
  const newMessages = serverHistory.slice(localLen);
  return [...conversationTurns, ...newMessages];
}

/** @param {ReturnType<typeof initialJarvisState>} state */
export function jarvisReducer(state, action) {
  switch (action.type) {
    case "HYDRATE_SIDEBAR": {
      const order = action.payload;
      if (!Array.isArray(order) || order.length !== SIDEBAR_CARD_KEYS.length) return state;
      const set = new Set(order);
      if (set.size !== SIDEBAR_CARD_KEYS.length) return state;
      for (const k of SIDEBAR_CARD_KEYS) {
        if (!set.has(k)) return state;
      }
      return { ...state, sidebarCardOrder: order };
    }
    case "SET_SIDEBAR_ORDER":
      return { ...state, sidebarCardOrder: action.payload };
    case "SET_STATUS":
      return { ...state, statusText: action.payload };
    case "SET_WEATHER":
      return { ...state, weatherData: action.payload, weatherFailed: false };
    case "SET_WEATHER_FAILED":
      return { ...state, weatherFailed: true };
    case "SET_CALENDAR_VIEW_DATE":
      return { ...state, calendarViewDate: action.payload };
    case "SET_CALENDAR_EVENTS":
      return { ...state, calendarEvents: action.payload };
    case "SET_CALENDAR_CONTEXT":
      return { ...state, calendarContextEvents: action.payload };
    case "SET_SPOTIFY": {
      const p = action.payload;
      return {
        ...state,
        spotifyConfigured: p.configured,
        spotifyPlayer: p.player,
        spotifyContextHint: p.contextHint ?? state.spotifyContextHint,
        spotifyLoadError: p.loadError ?? "",
      };
    }
    case "SET_SPOTIFY_WEB_DEVICE":
      return { ...state, spotifyWebDeviceId: action.payload };
    case "MERGE_POLL": {
      const {
        revision,
        personality,
        smartHomeDevices,
        schedules,
        chatHistory,
      } = action.payload;
      const normalized = normalizeSmartHomeClient(smartHomeDevices);
      if (
        state.lastDemoRevision === revision &&
        JSON.stringify(normalized) === JSON.stringify(state.remoteSmartHome)
      ) {
        return state;
      }
      const nextSchedules = Array.isArray(schedules) ? schedules : state.remoteSchedules;
      const nextTurns = mergeChatFromServer(state.conversationTurns, chatHistory);
      return {
        ...state,
        lastDemoRevision: Number.isFinite(Number(revision)) ? Number(revision) : state.lastDemoRevision,
        remotePersonality: typeof personality === "string" ? personality : "",
        remoteSmartHome: normalized,
        remoteSchedules: nextSchedules,
        conversationTurns: nextTurns,
      };
    }
    case "SET_SMARTHOME_FROM_DEVICES":
      return {
        ...state,
        remoteSmartHome: normalizeSmartHomeClient(action.payload),
        lastDemoRevision:
          action.revision != null && Number.isFinite(Number(action.revision))
            ? Number(action.revision)
            : state.lastDemoRevision,
      };
    case "ADD_SCHEDULE":
      return { ...state, remoteSchedules: [...state.remoteSchedules, action.payload] };
    case "REMOVE_SCHEDULE":
      return {
        ...state,
        remoteSchedules: state.remoteSchedules.filter((s) => s.id !== action.payload),
      };
    case "APPEND_USER_THEN_ASSISTANT": {
      const { userText, assistantText } = action.payload;
      return {
        ...state,
        conversationTurns: [
          ...state.conversationTurns,
          { role: "user", content: userText },
          { role: "assistant", content: assistantText },
        ],
      };
    }
    case "APPEND_USER":
      return {
        ...state,
        conversationTurns: [...state.conversationTurns, { role: "user", content: action.payload }],
      };
    case "APPEND_ASSISTANT":
      return {
        ...state,
        conversationTurns: [...state.conversationTurns, { role: "assistant", content: action.payload }],
      };
    case "RESET_CHAT":
      return {
        ...state,
        conversationTurns: [{ role: "assistant", content: action.payload }],
        lastDemoRevision:
          action.revision != null && Number.isFinite(Number(action.revision))
            ? Number(action.revision)
            : state.lastDemoRevision,
      };
    case "SET_LAST_REVISION":
      return {
        ...state,
        lastDemoRevision:
          Number.isFinite(Number(action.payload)) ? Number(action.payload) : state.lastDemoRevision,
      };
    default:
      return state;
  }
}
