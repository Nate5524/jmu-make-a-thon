import { useEffect, useRef, useState } from "react";
import { useJarvis } from "./context/JarvisProvider.jsx";
import { AboutDialog } from "./features/AboutDialog.jsx";
import { CalendarCard } from "./features/CalendarCard.jsx";
import { ChatPanel } from "./features/ChatPanel.jsx";
import { DevToolbar } from "./features/DevToolbar.jsx";
import { MusicCard } from "./features/MusicCard.jsx";
import { SchedulesCard } from "./features/SchedulesCard.jsx";
import { SidebarReorder } from "./features/SidebarReorder.jsx";
import { SmartHomeCard } from "./features/SmartHomeCard.jsx";
import { WeatherCard } from "./features/WeatherCard.jsx";
import {
  GRIP_SVG,
  SIDEBAR_CARD_ID_BY_KEY,
  SIDEBAR_CARD_KEYS,
  SIDEBAR_CARD_LABEL,
  SIDEBAR_CARD_ORDER_KEY,
  SIDEBAR_REORDER_HINT_DESKTOP,
  SIDEBAR_REORDER_HINT_MOBILE,
} from "./sidebar/constants.js";

const CARD_ID_TO_KEY = Object.fromEntries(SIDEBAR_CARD_KEYS.map((k) => [SIDEBAR_CARD_ID_BY_KEY[k], k]));

function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const fn = () => setM(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return m;
}

function moveKeyInOrder(order, key, delta) {
  const i = order.indexOf(key);
  if (i < 0) return order;
  const j = i + delta;
  if (j < 0 || j >= order.length) return order;
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function JarvisApp() {
  const { state, dispatch } = useJarvis();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const isMobile = useIsMobile();
  const [reorderMode, setReorderMode] = useState(false);
  const [draftOrder, setDraftOrder] = useState(null);
  const snapshotRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && reorderMode) {
        e.preventDefault();
        if (snapshotRef.current) {
          dispatch({ type: "SET_SIDEBAR_ORDER", payload: snapshotRef.current });
        }
        setDraftOrder(null);
        snapshotRef.current = null;
        setReorderMode(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reorderMode, dispatch]);

  const order = reorderMode && draftOrder ? draftOrder : state.sidebarCardOrder;

  const enterReorder = () => {
    snapshotRef.current = [...state.sidebarCardOrder];
    setDraftOrder([...state.sidebarCardOrder]);
    setReorderMode(true);
    if (isMobile) setSidebarOpen(true);
  };

  const cancelReorder = () => {
    if (snapshotRef.current) {
      dispatch({ type: "SET_SIDEBAR_ORDER", payload: snapshotRef.current });
    }
    setDraftOrder(null);
    snapshotRef.current = null;
    setReorderMode(false);
    if (isMobile) setSidebarOpen(false);
  };

  const applyReorder = () => {
    const keys = draftOrder || state.sidebarCardOrder;
    if (keys.length === SIDEBAR_CARD_KEYS.length) {
      try {
        localStorage.setItem(SIDEBAR_CARD_ORDER_KEY, JSON.stringify(keys));
      } catch {
        /* ignore */
      }
      dispatch({ type: "SET_SIDEBAR_ORDER", payload: keys });
    }
    setDraftOrder(null);
    snapshotRef.current = null;
    setReorderMode(false);
  };

  const onDragStart = (e, cardId) => {
    e.dataTransfer.setData("text/plain", cardId);
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.closest(".card")?.classList.add("card--reorder-dragging");
  };

  const onDragEnd = (e) => {
    e.currentTarget.closest(".card")?.classList.remove("card--reorder-dragging");
  };

  const onCardDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onCardDrop = (e, targetCardId) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === targetCardId) return;
    const fromKey = CARD_ID_TO_KEY[draggedId];
    const toKey = CARD_ID_TO_KEY[targetCardId];
    if (!fromKey || !toKey) return;
    setDraftOrder((prev) => {
      const base = prev || state.sidebarCardOrder;
      const from = base.indexOf(fromKey);
      const to = base.indexOf(toKey);
      if (from < 0 || to < 0) return base;
      const next = base.slice();
      next.splice(from, 1);
      next.splice(to, 0, fromKey);
      return next;
    });
  };

  const reorderDropTargetPropsForKey = (key) => {
    if (!reorderMode || isMobile) return {};
    const id = SIDEBAR_CARD_ID_BY_KEY[key];
    return {
      onDragOver: onCardDragOver,
      onDrop: (e) => onCardDrop(e, id),
    };
  };

  const prependForKey = (key) => {
    if (!reorderMode) return null;
    const cardId = SIDEBAR_CARD_ID_BY_KEY[key];
    if (isMobile) {
      return (
        <div className="sidebar-card-reorder-mobile">
          <span className="sidebar-card-reorder-mobile__label">{SIDEBAR_CARD_LABEL[key] || key}</span>
          <div className="sidebar-card-reorder-mobile__btns">
            <button
              type="button"
              className="sidebar-card-reorder-mobile__btn"
              aria-label="Move up"
              disabled={order.indexOf(key) === 0}
              onClick={() => setDraftOrder((p) => moveKeyInOrder(p || state.sidebarCardOrder, key, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              className="sidebar-card-reorder-mobile__btn"
              aria-label="Move down"
              disabled={order.indexOf(key) === order.length - 1}
              onClick={() => setDraftOrder((p) => moveKeyInOrder(p || state.sidebarCardOrder, key, 1))}
            >
              ↓
            </button>
          </div>
        </div>
      );
    }
    return (
      <div
        className="sidebar-card-drag-handle"
        draggable
        onDragStart={(e) => onDragStart(e, cardId)}
        onDragEnd={onDragEnd}
      >
        <span dangerouslySetInnerHTML={{ __html: GRIP_SVG }} />
        <span>{SIDEBAR_CARD_LABEL[key] || key}</span>
      </div>
    );
  };

  const renderCard = (key) => {
    const prep = prependForKey(key);
    const drop = reorderDropTargetPropsForKey(key);
    switch (key) {
      case "weather":
        return <WeatherCard key={key} prepend={prep} reorderDropTargetProps={drop} />;
      case "music":
        return <MusicCard key={key} prepend={prep} reorderDropTargetProps={drop} />;
      case "calendar":
        return <CalendarCard key={key} prepend={prep} reorderDropTargetProps={drop} />;
      case "smartHome":
        return <SmartHomeCard key={key} prepend={prep} reorderDropTargetProps={drop} />;
      case "schedules":
        return <SchedulesCard key={key} prepend={prep} reorderDropTargetProps={drop} />;
      default:
        return null;
    }
  };

  return (
    <>
      <DevToolbar />
      <header>
        <button
          type="button"
          className="sidebar-toggle"
          id="sidebarToggle"
          aria-label="Toggle sidebar"
          onClick={() => setSidebarOpen((o) => !o)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="logo">PowerSleep</span>
        <div className="header-actions">
          <button type="button" className="btn" id="aboutOpenBtn" aria-haspopup="dialog" aria-controls="aboutDialog" onClick={() => setAboutOpen(true)}>
            About Us
          </button>
        </div>
      </header>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      <div
        className={"sidebar-backdrop" + (sidebarOpen ? " visible" : "")}
        id="sidebarBackdrop"
        onClick={() => {
          if (reorderMode && isMobile) cancelReorder();
          else setSidebarOpen(false);
        }}
      />

      <div className="layout">
        <aside className={"sidebar" + (sidebarOpen ? " open" : "") + (reorderMode ? " is-reordering" : "")}>
          <button type="button" className="sidebar-close" id="sidebarClose" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
          {order.map((key) => renderCard(key))}

          <SidebarReorder
            reorderMode={reorderMode}
            hint={isMobile ? SIDEBAR_REORDER_HINT_MOBILE : SIDEBAR_REORDER_HINT_DESKTOP}
            onEnter={enterReorder}
            onCancel={cancelReorder}
            onApply={applyReorder}
          />
        </aside>

        <ChatPanel />
      </div>
    </>
  );
}
