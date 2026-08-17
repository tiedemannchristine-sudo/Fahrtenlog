// Gemeinsame Konfiguration für app.js und export.js
const CONFIG = {
  // Kostenlosen API-Key auf https://openrouteservice.org/dev/#/signup holen
  ORS_API_KEY: "TRAGE_HIER_DEINEN_OPENROUTESERVICE_KEY_EIN",
  // Supabase-Projekt "fahrtenlog" (Prototyp-Sync, unabhängig vom Pi)
  SYNC_ENDPOINT: "https://ninqidlagvwhfgfbhhwa.supabase.co/rest/v1/fahrten",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5pbnFpZGxhZ3Z3aGZnZmJoaHdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5NDExNjksImV4cCI6MjEwMjUxNzE2OX0.mI6fc10W39UJVV5TAWCym4ZSS5RDM36RhEmv5WzHA4c",

  // Excel-Export
  EXCEL_TEMPLATE_URL: "vorlage.xlsx",
  EXCEL_SHEET_NAME: "km Parken",
  EXCEL_FIRST_DATA_ROW: 6,
  EXCEL_LAST_DATA_ROW: 29,
  EXCEL_EINSATZBEREICH_ROW: 4,
  EXCEL_EINSATZBEREICH_COLS: ["K", "L", "M", "N"],
};
