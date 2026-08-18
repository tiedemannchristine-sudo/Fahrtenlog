// ============================================================
// PARKSCHEIN – Foto aufnehmen, lokal speichern, mit Sync hochladen
// ============================================================
const PARK_STORAGE_KEY = "fahrtentracker_parkscheine_v1";

const parkBtn = document.getElementById("parkBtn");
const parkFile = document.getElementById("parkFile");
const parkPreviewWrap = document.getElementById("parkPreviewWrap");
const parkPreview = document.getElementById("parkPreview");
const parkSaveBtn = document.getElementById("parkSaveBtn");
const parkCancelBtn = document.getElementById("parkCancelBtn");
const parkList = document.getElementById("parkList");

let parkscheine = loadParkscheine();
let pendingPhotoDataUrl = null;

function loadParkscheine() {
  try {
    return JSON.parse(localStorage.getItem(PARK_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function saveParkscheine() {
  localStorage.setItem(PARK_STORAGE_KEY, JSON.stringify(parkscheine));
}

// Foto verkleinern/komprimieren, damit es lokal nicht zu viel Platz braucht
function compressImage(file, maxWidth = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

parkBtn.addEventListener("click", () => parkFile.click());

parkFile.addEventListener("change", async () => {
  const file = parkFile.files[0];
  if (!file) return;
  pendingPhotoDataUrl = await compressImage(file);
  parkPreview.src = pendingPhotoDataUrl;
  parkPreviewWrap.style.display = "block";
});

parkCancelBtn.addEventListener("click", () => {
  pendingPhotoDataUrl = null;
  parkFile.value = "";
  parkPreviewWrap.style.display = "none";
});

parkSaveBtn.addEventListener("click", () => {
  if (!pendingPhotoDataUrl) return;
  const entry = {
    id: crypto.randomUUID(),
    photoDataUrl: pendingPhotoDataUrl,
    mitarbeiter: (mitarbeiterInput.value || "").trim(),
    kst: kstSelect.value || "",
    datum: new Date().toISOString().slice(0, 10),
    synced: false,
  };
  parkscheine.unshift(entry);
  saveParkscheine();
  renderParkList();

  pendingPhotoDataUrl = null;
  parkFile.value = "";
  parkPreviewWrap.style.display = "none";
  showToast("Parkschein gespeichert");
});

function renderParkList() {
  if (parkscheine.length === 0) {
    parkList.innerHTML = "";
    return;
  }
  parkList.innerHTML = parkscheine
    .map(
      (p) => `
        <div class="trip ${p.synced ? "synced" : ""}" style="display:flex; gap:12px; align-items:center;">
          <img src="${p.photoDataUrl}" style="width:52px; height:52px; object-fit:cover; border-radius:8px; flex-shrink:0;">
          <div style="flex:1;">
            <div class="trip-meta">
              <b>${p.datum}</b> · ${p.kst || "–"} · ${p.mitarbeiter || "–"}
            </div>
          </div>
          <div class="trip-badge">${p.synced ? "Synchronisiert" : "Lokal"}</div>
        </div>`
    )
    .join("");
}
renderParkList();

const parkDownloadBtn = document.getElementById("parkDownloadBtn");

async function fetchAllParkscheineFromSupabase() {
  const url = `${CONFIG.PARKSCHEINE_ENDPOINT}?select=*&order=datum.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase-Fehler: ${res.status}`);
  return res.json();
}

function safeFilePart(s) {
  return (s || "unbekannt").replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, "_");
}

parkDownloadBtn.addEventListener("click", async () => {
  parkDownloadBtn.disabled = true;
  parkDownloadBtn.textContent = "Lade Liste…";
  try {
    const records = await fetchAllParkscheineFromSupabase();
    if (records.length === 0) {
      showToast("Keine Parkscheine in Supabase gefunden");
      return;
    }

    const zip = new JSZip();
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      parkDownloadBtn.textContent = `Foto ${i + 1}/${records.length}…`;
      const res = await fetch(r.foto_url);
      if (!res.ok) {
        console.warn("Foto nicht ladbar:", r.foto_url);
        continue;
      }
      const blob = await res.blob();
      const mitarbeiterOrdner = safeFilePart(r.mitarbeiter);
      const dateiname = `${r.datum}_${safeFilePart(r.kst)}_${r.id.slice(0, 8)}.jpg`;
      zip.folder(mitarbeiterOrdner).file(dateiname, blob);
    }

    parkDownloadBtn.textContent = "Erstelle ZIP…";
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(zipBlob);
    link.download = `parkscheine_${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);

    showToast(`${records.length} Parkschein-Foto(s) heruntergeladen`);

    const loeschen = window.confirm(
      `${records.length} Foto(s) wurden heruntergeladen.\n\nJetzt aus Supabase löschen, um Platz zu sparen?`
    );
    if (loeschen) {
      parkDownloadBtn.textContent = "Lösche…";
      for (const r of records) {
        const path = r.foto_url.split("/parkscheine/")[1];
        await fetch(`${CONFIG.STORAGE_BUCKET_URL}/parkscheine/${path}`, {
          method: "DELETE",
          headers: {
            apikey: CONFIG.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
          },
        });
      }
      const ids = records.map((r) => r.id).join(",");
      await fetch(`${CONFIG.PARKSCHEINE_ENDPOINT}?id=in.(${ids})`, {
        method: "DELETE",
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        },
      });
      showToast("Parkscheine in Supabase gelöscht");
    }
  } catch (err) {
    console.error(err);
    showToast(`Download fehlgeschlagen: ${err.message}`);
  } finally {
    parkDownloadBtn.disabled = false;
    parkDownloadBtn.textContent = "Fotos herunterladen";
  }
});
syncBtn.addEventListener("click", async () => {
  const open = parkscheine.filter((p) => !p.synced);
  if (open.length === 0) return;
  try {
    for (const p of open) {
      const path = `${p.id}.jpg`;
      const blob = dataUrlToBlob(p.photoDataUrl);
      const uploadRes = await fetch(`${CONFIG.STORAGE_BUCKET_URL}/parkscheine/${path}`, {
        method: "POST",
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
          "Content-Type": "image/jpeg",
        },
        body: blob,
      });
      if (!uploadRes.ok) throw new Error(`Foto-Upload fehlgeschlagen: ${uploadRes.status}`);

      const fotoUrl = `${CONFIG.STORAGE_PUBLIC_URL}/parkscheine/${path}`;
      const metaRes = await fetch(CONFIG.PARKSCHEINE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          id: p.id,
          mitarbeiter: p.mitarbeiter,
          kst: p.kst,
          datum: p.datum,
          foto_url: fotoUrl,
        }),
      });
      if (!metaRes.ok) throw new Error(`Parkschein-Sync fehlgeschlagen: ${metaRes.status}`);

      p.synced = true;
    }
    saveParkscheine();
    renderParkList();
  } catch (err) {
    console.error(err);
    showToast("Parkschein-Sync fehlgeschlagen");
  }
});
