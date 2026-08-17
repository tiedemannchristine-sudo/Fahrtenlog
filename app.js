// ============================================================
// KONFIGURATION – hier später echte Werte eintragen
// ============================================================
const CONFIG = {
  // Kostenlosen API-Key auf https://openrouteservice.org/dev/#/signup holen
  ORS_API_KEY: "TRAGE_HIER_DEINEN_OPENROUTESERVICE_KEY_EIN",
  // Sync-Ziel: fürs Prototyping z.B. Supabase-URL, später Server der Firma
  SYNC_ENDPOINT: null, // z.B. "https://xxxx.supabase.co/rest/v1/fahrten"
};

// ============================================================
// STORAGE
// ============================================================
const STORAGE_KEY = "fahrtentracker_trips_v1";
const ACTIVE_KEY = "fahrtentracker_active_v1";

function loadTrips() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function saveTrips(trips) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
}
function loadActive() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_KEY)) || null;
  } catch {
    return null;
  }
}
function saveActive(active) {
  if (active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
  else localStorage.removeItem(ACTIVE_KEY);
}

// ============================================================
// STATE
// ============================================================
let trips = loadTrips();
let active = loadActive(); // { startTime, startDate, startCoords, kst, mode, gpsTrack: [] }
let mode = active?.mode || "route"; // "route" | "gps"
let watchId = null;

// ============================================================
// DOM
// ============================================================
const el = (id) => document.getElementById(id);
const idleView = el("idleView");
const runningView = el("runningView");
const liveClock = el("liveClock");
const liveDate = el("liveDate");
const startedClock = el("startedClock");
const startedMeta = el("startedMeta");
const gpsPreview = el("gpsPreview");
const runningGpsInfo = el("runningGpsInfo");
const kstSelect = el("kst");
const modeRouteBtn = el("modeRoute");
const modeGpsBtn = el("modeGps");
const startBtn = el("startBtn");
const stopBtn = el("stopBtn");
const tripListEl = el("tripList");
const syncBtn = el("syncBtn");
const toastEl = el("toast");
const onlineStatus = el("onlineStatus");

// ============================================================
// HELPERS
// ============================================================
function pad(n) { return String(n).padStart(2, "0"); }
function fmtTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function fmtDate(d) { return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; }

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2400);
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Kein GPS verfügbar"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function updateOnlineStatus() {
  onlineStatus.textContent = navigator.onLine ? "Online" : "Offline";
}
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

// ============================================================
// CLOCK
// ============================================================
setInterval(() => {
  const now = new Date();
  liveClock.textContent = fmtTime(now).slice(0, 5);
  liveDate.textContent = fmtDate(now);
}, 1000);

// ============================================================
// MODE TOGGLE
// ============================================================
function setMode(m) {
  mode = m;
  modeRouteBtn.classList.toggle("active", m === "route");
  modeGpsBtn.classList.toggle("active", m === "gps");
}
modeRouteBtn.addEventListener("click", () => setMode("route"));
modeGpsBtn.addEventListener("click", () => setMode("gps"));
setMode(mode);

// ============================================================
// START / STOP
// ============================================================
startBtn.addEventListener("click", async () => {
  if (!kstSelect.value) {
    showToast("Bitte zuerst eine Kostenstelle wählen");
    return;
  }
  startBtn.disabled = true;
  gpsPreview.textContent = "GPS wird ermittelt…";
  try {
    const coords = await getPosition();
    const now = new Date();
    active = {
      startTime: now.toISOString(),
      startCoords: coords,
      kst: kstSelect.value,
      mode,
      gpsTrack: mode === "gps" ? [{ ...coords, t: now.toISOString() }] : [],
    };
    saveActive(active);

    if (mode === "gps" && navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, t: new Date().toISOString() };
          active.gpsTrack.push(p);
          saveActive(active);
          runningGpsInfo.textContent = `${active.gpsTrack.length} GPS-Punkte erfasst`;
        },
        (err) => console.warn("GPS-Tracking Fehler:", err),
        { enableHighAccuracy: true, maximumAge: 5000 }
      );
    }
    renderRunning();
  } catch (err) {
    showToast("GPS-Standort konnte nicht ermittelt werden");
    console.error(err);
  } finally {
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  try {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    const coords = await getPosition();
    const now = new Date();

    const trip = {
      id: crypto.randomUUID(),
      kst: active.kst,
      mode: active.mode,
      startTime: active.startTime,
      startCoords: active.startCoords,
      stopTime: now.toISOString(),
      stopCoords: coords,
      gpsTrack: active.gpsTrack || [],
      km: null,
      kmSource: null,
      synced: false,
    };

    if (trip.mode === "gps" && trip.gpsTrack.length > 1) {
      let sum = 0;
      for (let i = 1; i < trip.gpsTrack.length; i++) {
        sum += haversineKm(trip.gpsTrack[i - 1], trip.gpsTrack[i]);
      }
      trip.km = Math.round(sum * 10) / 10;
      trip.kmSource = "gps-track";
    } else {
      trip.kmSource = "route-pending";
    }

    trips.unshift(trip);
    saveTrips(trips);
    active = null;
    saveActive(null);
    renderTrips();
    renderIdle();

    if (trip.kmSource === "route-pending") {
      resolveRouteKm(trip);
    }
  } catch (err) {
    showToast("GPS-Standort beim Stopp konnte nicht ermittelt werden");
    console.error(err);
  } finally {
    stopBtn.disabled = false;
  }
});

// ============================================================
// AUTOROUTE (OpenRouteService)
// ============================================================
async function resolveRouteKm(trip) {
  if (!CONFIG.ORS_API_KEY || CONFIG.ORS_API_KEY.startsWith("TRAGE_HIER")) {
    showToast("ORS-API-Key fehlt – km müssen manuell nachgetragen werden");
    return;
  }
  try {
    const url = "https://api.openrouteservice.org/v2/directions/driving-car";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: CONFIG.ORS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        coordinates: [
          [trip.startCoords.lon, trip.startCoords.lat],
          [trip.stopCoords.lon, trip.stopCoords.lat],
        ],
      }),
    });
    if (!res.ok) throw new Error(`ORS-Fehler: ${res.status}`);
    const data = await res.json();
    const meters = data.routes[0].summary.distance;
    trip.km = Math.round((meters / 1000) * 10) / 10;
    trip.kmSource = "autoroute";
  } catch (err) {
    console.error(err);
    trip.kmSource = "route-failed";
    showToast("Autoroute konnte nicht berechnet werden (offline?)");
  } finally {
    const idx = trips.findIndex((t) => t.id === trip.id);
    if (idx !== -1) trips[idx] = trip;
    saveTrips(trips);
    renderTrips();
  }
}

// ============================================================
// SYNC (Stub – Endpunkt später eintragen)
// ============================================================
syncBtn.addEventListener("click", async () => {
  const open = trips.filter((t) => !t.synced);
  if (open.length === 0) {
    showToast("Alle Fahrten sind bereits synchronisiert");
    return;
  }
  if (!CONFIG.SYNC_ENDPOINT) {
    showToast(`Kein Sync-Ziel konfiguriert (${open.length} offene Fahrt(en))`);
    return;
  }
  syncBtn.disabled = true;
  syncBtn.textContent = "Sync läuft…";
  try {
    for (const trip of open) {
      await fetch(CONFIG.SYNC_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trip),
      });
      trip.synced = true;
    }
    saveTrips(trips);
    renderTrips();
    showToast(`${open.length} Fahrt(en) synchronisiert`);
  } catch (err) {
    console.error(err);
    showToast("Sync fehlgeschlagen – bitte erneut versuchen");
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = "Sync";
  }
});

// ============================================================
// RENDER
// ============================================================
function renderIdle() {
  idleView.style.display = "block";
  runningView.style.display = "none";
  kstSelect.value = "";
}
function renderRunning() {
  idleView.style.display = "none";
  runningView.style.display = "block";
  const d = new Date(active.startTime);
  startedClock.textContent = fmtTime(d).slice(0, 5);
  startedMeta.textContent = `${fmtDate(d)} · Kostenstelle: ${active.kst} · ${active.mode === "gps" ? "GPS-Tracking" : "Autoroute"}`;
  runningGpsInfo.textContent = active.mode === "gps" ? `${active.gpsTrack.length} GPS-Punkte erfasst` : "Route wird beim Stopp berechnet";
}

function kmSourceLabel(t) {
  switch (t.kmSource) {
    case "gps-track": return "GPS-Track";
    case "autoroute": return "Autoroute";
    case "route-pending": return "Route wird berechnet…";
    case "route-failed": return "Route fehlgeschlagen";
    default: return "–";
  }
}

function renderTrips() {
  if (trips.length === 0) {
    tripListEl.innerHTML = `<div class="empty">Noch keine Fahrten erfasst</div>`;
    return;
  }
  tripListEl.innerHTML = trips
    .map((t) => {
      const start = new Date(t.startTime);
      const stop = new Date(t.stopTime);
      const kmDisplay = t.km !== null ? `${t.km.toFixed(1)}<span> km</span>` : `<span>${kmSourceLabel(t)}</span>`;
      return `
        <div class="trip ${t.synced ? "synced" : ""}">
          <div class="trip-top">
            <div class="trip-km">${kmDisplay}</div>
            <div class="trip-badge">${t.synced ? "Synchronisiert" : "Lokal"}</div>
          </div>
          <div class="trip-meta">
            <b>${fmtDate(start)}</b> · ${fmtTime(start).slice(0, 5)} – ${fmtTime(stop).slice(0, 5)}<br>
            Kostenstelle: <b>${t.kst}</b> · ${t.mode === "gps" ? "GPS-Tracking" : "Autoroute"}${t.km !== null ? ` · ${kmSourceLabel(t)}` : ""}
          </div>
        </div>`;
    })
    .join("");
}

// ============================================================
// INIT
// ============================================================
if (active) {
  setMode(active.mode);
  renderRunning();
  if (active.mode === "gps" && navigator.geolocation) {
    // Tracking nach Reload fortsetzen
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, t: new Date().toISOString() };
        active.gpsTrack.push(p);
        saveActive(active);
        runningGpsInfo.textContent = `${active.gpsTrack.length} GPS-Punkte erfasst`;
      },
      (err) => console.warn(err),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }
} else {
  renderIdle();
}
renderTrips();

// Service Worker registrieren (PWA, Offline-Fähigkeit)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW-Registrierung fehlgeschlagen:", err));
  });
}
