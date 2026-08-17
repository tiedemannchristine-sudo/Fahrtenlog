// ============================================================
// EXCEL-EXPORT (läuft komplett im Browser, kein Server nötig)
// ============================================================
const exportBtn = document.getElementById("exportBtn");

async function fetchAllTripsFromSupabase() {
  const url = `${CONFIG.SYNC_ENDPOINT}?select=*&order=start_time.asc`;
  const res = await fetch(url, {
    headers: {
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase-Fehler: ${res.status}`);
  return res.json();
}

const geocodeCache = new Map();

async function reverseGeocode(coords) {
  if (!coords || coords.lat == null || coords.lon == null) return "";
  const key = `${coords.lat.toFixed(5)},${coords.lon.toFixed(5)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.lat}&lon=${coords.lon}&addressdetails=1`;
  let result;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const addr = data.address || {};
    const street = addr.road || "";
    const num = addr.house_number || "";
    const city = addr.city || addr.town || addr.village || "";
    if (street) {
      result = `${street} ${num}`.trim() + (city ? `, ${city}` : "");
    } else {
      result = data.display_name || `${coords.lat}, ${coords.lon}`;
    }
  } catch (err) {
    console.warn("Reverse-Geocoding fehlgeschlagen:", err);
    result = `${coords.lat}, ${coords.lon}`;
  }
  geocodeCache.set(key, result);
  await new Promise((r) => setTimeout(r, 1100)); // Nominatim: max. 1 Anfrage/Sekunde
  return result;
}

function fmtDatum(isoString) {
  const d = new Date(isoString);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  syncBtn.disabled = true;
  try {
    exportBtn.textContent = "Lade Fahrten…";
    const allTrips = await fetchAllTripsFromSupabase();
    const usable = allTrips.filter((t) => t.km !== null && t.km !== undefined);
    const skipped = allTrips.length - usable.length;

    if (usable.length === 0) {
      showToast("Keine Fahrten mit berechneten km gefunden");
      return;
    }

    const areas = [];
    for (const t of usable) {
      if (!areas.includes(t.kst)) areas.push(t.kst);
    }
    if (areas.length > 4) {
      showToast(`Zu viele Einsatzbereiche (${areas.length}, max. 4) – Export nicht möglich`);
      return;
    }
    const maxRows = CONFIG.EXCEL_LAST_DATA_ROW - CONFIG.EXCEL_FIRST_DATA_ROW + 1;
    if (usable.length > maxRows) {
      showToast(`Zu viele Fahrten (${usable.length}, max. ${maxRows}) – Zeitraum eingrenzen`);
      return;
    }

    exportBtn.textContent = "Lade Vorlage…";
    const templateRes = await fetch(CONFIG.EXCEL_TEMPLATE_URL);
    if (!templateRes.ok) throw new Error("Vorlage (vorlage.xlsx) nicht gefunden");
    const templateBuffer = await templateRes.arrayBuffer();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer);
    const ws = workbook.getWorksheet(CONFIG.EXCEL_SHEET_NAME);
    if (!ws) throw new Error(`Tabellenblatt "${CONFIG.EXCEL_SHEET_NAME}" nicht gefunden`);

    const areaToCol = {};
    areas.forEach((area, i) => {
      const col = CONFIG.EXCEL_EINSATZBEREICH_COLS[i];
      ws.getCell(`${col}${CONFIG.EXCEL_EINSATZBEREICH_ROW}`).value = area;
      areaToCol[area] = col;
    });

    let row = CONFIG.EXCEL_FIRST_DATA_ROW;
    for (let i = 0; i < usable.length; i++) {
      const t = usable[i];
      exportBtn.textContent = `Adressen ${i + 1}/${usable.length}…`;
      const von = await reverseGeocode(t.start_coords);
      const nach = await reverseGeocode(t.stop_coords);

      ws.getCell(`A${row}`).value = fmtDatum(t.start_time);
      ws.getCell(`B${row}`).value = t.klient || "";
      ws.getCell(`C${row}`).value = von;
      ws.getCell(`G${row}`).value = nach;
      ws.getCell(`${areaToCol[t.kst]}${row}`).value = t.km;
      row++;
    }

    exportBtn.textContent = "Erstelle Datei…";
    const outBuffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([outBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `fahrtkostenabrechnung_${new Date().toISOString().slice(0, 10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);

    showToast(
      skipped > 0
        ? `Export fertig (${skipped} Fahrt(en) ohne km übersprungen)`
        : "Export fertig"
    );
  } catch (err) {
    console.error(err);
    showToast(`Export fehlgeschlagen: ${err.message}`);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = "Excel-Export";
    syncBtn.disabled = false;
  }
});
