import { useCallback, useEffect, useRef, useState } from "react";
import { useJarvis } from "../context/JarvisProvider.jsx";

function formatVolumeLabel(p) {
  return String(Math.round(Math.max(0, Math.min(100, Number(p) || 0)))) + "%";
}

export function MusicCard({ prepend, reorderDropTargetProps = {} }) {
  const { state, dispatch, setStatus, refreshSpotifyPlayerIntoState } = useJarvis();
  const spotifyWebPlayerRef = useRef(null);
  const spotifyWebConnectingRef = useRef(false);
  const [hasWebPlayer, setHasWebPlayer] = useState(false);
  const [musicVolumeDragging, setMusicVolumeDragging] = useState(false);
  const musicVolumeSendTimerRef = useRef(null);
  const spotifySearchTimerRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchItems, setSearchItems] = useState([]);
  const [musicWebStatus, setMusicWebStatus] = useState("");

  const spotifyDevQuery = () =>
    state.spotifyWebDeviceId ? "?device_id=" + encodeURIComponent(state.spotifyWebDeviceId) : "";

  const updateMusicVolumeFill = (sliderEl, percent) => {
    if (!sliderEl) return;
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    sliderEl.style.setProperty("--music-vol-pct", p + "%");
  };

  const spotifyPutVolume = useCallback(
    async (percent, sliderEl) => {
      const p = Math.max(0, Math.min(100, Math.round(Number(percent))));
      const q = new URLSearchParams({ volume_percent: String(p) });
      if (state.spotifyWebDeviceId) q.set("device_id", state.spotifyWebDeviceId);
      if (spotifyWebPlayerRef.current?.setVolume) {
        try {
          await spotifyWebPlayerRef.current.setVolume(p / 100);
        } catch {
          /* ignore */
        }
      }
      const r = await fetch("/api/spotify/player/volume?" + q.toString(), { method: "PUT" });
      if (r.status !== 204 && !r.ok) {
        const err = await r.json().catch(() => ({}));
        setStatus(err.error || "Spotify volume failed");
      }
    },
    [setStatus, state.spotifyWebDeviceId],
  );

  const spotifyTogglePlayPause = async () => {
    const pr = await fetch("/api/spotify/player");
    const pd = await pr.json().catch(() => ({}));
    const playing = pd.player && pd.player.is_playing;
    const url = playing ? "/api/spotify/player/pause" + spotifyDevQuery() : "/api/spotify/player/play" + spotifyDevQuery();
    const r = await fetch(url, { method: "PUT" });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      setStatus(err.error || "Spotify playback failed");
    }
    await refreshSpotifyPlayerIntoState();
  };

  const spotifyNext = async () => {
    const r = await fetch("/api/spotify/player/next" + spotifyDevQuery(), { method: "POST" });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      setStatus(err.error || "Next track failed");
    }
    await refreshSpotifyPlayerIntoState();
  };

  const spotifyPrevious = async () => {
    const r = await fetch("/api/spotify/player/previous" + spotifyDevQuery(), { method: "POST" });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      setStatus(err.error || "Previous track failed");
    }
    await refreshSpotifyPlayerIntoState();
  };

  const spotifyPlayUri = async (uri) => {
    const r = await fetch("/api/spotify/player/play" + spotifyDevQuery(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: [uri] }),
    });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      setStatus(err.error || "Could not start track");
      return;
    }
    setSearchItems([]);
    await refreshSpotifyPlayerIntoState();
  };

  const spotifyQueueUri = async (uri) => {
    if (!state.spotifyConfigured) return;
    const q = state.spotifyWebDeviceId ? "?device_id=" + encodeURIComponent(state.spotifyWebDeviceId) : "";
    const r = await fetch("/api/spotify/player/queue" + q, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri }),
    });
    if (r.status !== 204 && !r.ok) {
      const err = await r.json().catch(() => ({}));
      setStatus(err.error || "Could not add to queue");
      return;
    }
    setStatus("Added to queue");
    await refreshSpotifyPlayerIntoState();
  };

  useEffect(() => {
    if (!state.spotifyConfigured) return;
    const q = searchQuery.trim();
    if (!q) {
      setSearchItems([]);
      return;
    }
    clearTimeout(spotifySearchTimerRef.current);
    spotifySearchTimerRef.current = setTimeout(async () => {
      try {
        const r = await fetch("/api/spotify/search?q=" + encodeURIComponent(q));
        if (!r.ok) return;
        const data = await r.json();
        setSearchItems((data.tracks && data.tracks.items) || []);
      } catch (e) {
        console.warn("Spotify search", e);
      }
    }, 380);
    return () => clearTimeout(spotifySearchTimerRef.current);
  }, [searchQuery, state.spotifyConfigured]);

  const loadSpotifySdk = () =>
    new Promise((resolve, reject) => {
      if (window.Spotify) {
        resolve();
        return;
      }
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      const s = document.createElement("script");
      s.src = "https://sdk.scdn.co/spotify-player.js";
      s.async = true;
      s.onerror = () => reject(new Error("Could not load Spotify Web Playback SDK"));
      document.head.appendChild(s);
    });

  const initSpotifyWebPlayer = async () => {
    if (hasWebPlayer || spotifyWebPlayerRef.current) {
      setMusicWebStatus("Browser player already active.");
      return;
    }
    if (spotifyWebConnectingRef.current) return;
    spotifyWebConnectingRef.current = true;
    setMusicWebStatus("Connecting browser player…");
    try {
      const tok = await fetch("/api/spotify/oauth-token");
      if (!tok.ok) {
        setMusicWebStatus("OAuth token unavailable (check server .env).");
        spotifyWebConnectingRef.current = false;
        return;
      }
      await loadSpotifySdk();
      const player = new window.Spotify.Player({
        name: "PowerSleep Jarvis",
        getOAuthToken: (cb) => {
          fetch("/api/spotify/oauth-token")
            .then((r) => r.json())
            .then((d) => cb(d.access_token))
            .catch(() => cb(""));
        },
        volume: 0.85,
      });
      player.addListener("initialization_error", ({ message }) => {
        setMusicWebStatus(message || "Initialization error");
      });
      player.addListener("authentication_error", ({ message }) => {
        setMusicWebStatus(message || "Authentication error");
      });
      player.addListener("account_error", ({ message }) => {
        setMusicWebStatus(message || "Premium required for in-browser playback.");
      });
      player.addListener("playback_error", ({ message }) => {
        setMusicWebStatus(message || "Playback error");
      });
      player.addListener("ready", async ({ device_id }) => {
        dispatch({ type: "SET_SPOTIFY_WEB_DEVICE", payload: device_id });
        setHasWebPlayer(true);
        setMusicWebStatus("Playing in this tab — pick a track or press play.");
        await fetch("/api/spotify/player/transfer", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_ids: [device_id], play: false }),
        });
        await refreshSpotifyPlayerIntoState();
      });
      player.addListener("not_ready", ({ device_id }) => {
        dispatch({ type: "SET_SPOTIFY_WEB_DEVICE", payload: null });
        setHasWebPlayer(false);
      });
      const connected = await player.connect();
      if (connected) {
        spotifyWebPlayerRef.current = player;
      } else {
        setMusicWebStatus("Could not connect to Spotify.");
      }
    } catch (e) {
      console.warn("Spotify web player", e);
      setMusicWebStatus(e.message || "Web player failed.");
    } finally {
      spotifyWebConnectingRef.current = false;
    }
  };

  const player = state.spotifyPlayer;
  const isPlaying = !!(player && player.is_playing);
  const track = player?.item;
  const images = track?.album?.images ? [...track.album.images].sort((a, b) => (a.height || 0) - (b.height || 0)) : [];
  const img = images.find((i) => (i.height || 0) >= 48) || images[images.length - 1];
  const imgUrl = img?.url || "";
  const artists = (track?.artists || []).map((a) => a.name).join(", ");

  const volPercent =
    !musicVolumeDragging && player?.device && typeof player.device.volume_percent === "number"
      ? player.device.volume_percent
      : state.spotifyWebDeviceId
        ? 85
        : 70;

  if (!state.spotifyConfigured) {
    return (
      <div className="card" id="musicCard" {...reorderDropTargetProps}>
        {prepend}
        <h3>Music</h3>
        <div id="musicContent">
          <span className="no-items">Spotify not configured.</span>
          <p className="music-hint">
            Add <code>SPOTIFY_CLIENT_ID</code>, <code>SPOTIFY_CLIENT_SECRET</code>, and{" "}
            <code>SPOTIFY_REFRESH_TOKEN</code> to the server <code>.env</code>. Get a refresh token via{" "}
            <a className="music-link" href="/api/spotify/login">
              one-time OAuth
            </a>
            , then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" id="musicCard" {...reorderDropTargetProps}>
      {prepend}
      <h3>Music</h3>
      {state.spotifyLoadError ? (
        <div id="musicContent">
          <span className="no-items">{state.spotifyLoadError}</span>
        </div>
      ) : !track ? (
        <div id="musicContent">
          <span className="no-items">Nothing playing</span>
          <p className="music-hint">Search for a track below or start playback on your Spotify account.</p>
        </div>
      ) : (
        <div id="musicContent">
          <div className="music-now">
            {imgUrl ? (
              <img className="music-art" src={imgUrl} width={56} height={56} alt="" crossOrigin="anonymous" />
            ) : (
              <div className="music-art music-art--placeholder" aria-hidden="true" />
            )}
            <div className="music-meta">
              <div className="music-title">{track.name}</div>
              <div className="music-artist">{artists}</div>
            </div>
          </div>
        </div>
      )}
      <div className={`music-controls-row visible`} id="musicControls" aria-label="Playback controls">
        <button type="button" className="music-icon-btn" id="musicPrevBtn" title="Previous" aria-label="Previous track" onClick={spotifyPrevious}>
          <p className="music-prev">⏮</p>
        </button>
        <button
          type="button"
          className="music-icon-btn"
          id="musicPlayPauseBtn"
          title="Play or pause"
          aria-label="Play or pause"
          onClick={spotifyTogglePlayPause}
        >
          <p className="music-pp-play" style={{ display: isPlaying ? "none" : "block" }}>
            ▶
          </p>
          <p className="music-pp-pause" style={{ display: isPlaying ? "block" : "none" }}>
            ⏸
          </p>
        </button>
        <button type="button" className="music-icon-btn" id="musicNextBtn" title="Next" aria-label="Next track" onClick={spotifyNext}>
          <p className="music-next">⏭</p>
        </button>
      </div>
      <div className="music-volume-row visible" id="musicVolumeRow" aria-label="Playback volume">
        <label className="music-volume-label" htmlFor="musicVolumeSlider">
          Vol
        </label>
        <div className="music-volume-slider-wrap">
          <input
            key={volPercent}
            type="range"
            id="musicVolumeSlider"
            min={0}
            max={100}
            defaultValue={volPercent}
            disabled={!state.spotifyWebDeviceId && !player}
            onPointerDown={() => setMusicVolumeDragging(true)}
            onPointerUp={(e) => {
              setMusicVolumeDragging(false);
              clearTimeout(musicVolumeSendTimerRef.current);
              spotifyPutVolume(Number(e.target.value), e.target);
            }}
            onInput={(e) => {
              const v = Number(e.target.value);
              document.getElementById("musicVolumeValue").textContent = formatVolumeLabel(v);
              updateMusicVolumeFill(e.target, v);
              clearTimeout(musicVolumeSendTimerRef.current);
              musicVolumeSendTimerRef.current = setTimeout(() => spotifyPutVolume(v, e.target), 120);
            }}
          />
        </div>
        <span className="music-volume-value" id="musicVolumeValue">
          {formatVolumeLabel(volPercent)}
        </span>
      </div>
      {!hasWebPlayer && (
        <button type="button" className="music-web-btn" id="musicWebPlayerBtn" onClick={initSpotifyWebPlayer}>
          Play in this browser
        </button>
      )}
      <p className="music-web-status" id="musicWebStatus">
        {musicWebStatus}
      </p>
      <div className="music-search-wrap">
        <input
          type="search"
          id="musicSearchInput"
          placeholder="Search tracks…"
          autoComplete="off"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchItems.length > 0 && (
          <ul className="music-results" id="musicSearchResults">
            {searchItems.map((t) => (
              <li key={t.uri} className="music-result-row">
                <span className="music-result-label">
                  {t.name} — {(t.artists || []).map((a) => a.name).join(", ")}
                </span>
                <span className="music-result-actions">
                  <button type="button" className="music-result-btn--play" onClick={() => spotifyPlayUri(t.uri)}>
                    Play
                  </button>
                  <button type="button" className="music-result-btn--queue" onClick={() => spotifyQueueUri(t.uri)}>
                    Queue
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
