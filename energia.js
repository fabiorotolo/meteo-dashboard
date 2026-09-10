// ========================
// CONFIGURAZIONE THINGSPEAK - CANALE Energy_Cloud
// ========================

const ENERGY_CHANNEL_ID = 3489445;
const ENERGY_READ_KEY = "L3NRPAO60VP1UM4Z";

// Mappatura field -> colonna (vedi energy_cloud_sync.py sul Raspberry)
const ENERGY_FIELDS = {
  casa_w: 1,
  casa_wh_delta: 2,
  prese_w: 3,
  prese_wh_delta: 4,
  clima_w: 5,
  clima_wh_delta: 6,
  altro_w: 7,
  altro_wh_delta: 8
};

const CANALI = [
  { key: "casa", label: "Casa", color: "#3d7cff" },
  { key: "prese", label: "Prese", color: "#66aaff" },
  { key: "clima", label: "Clima", color: "#ff9d4d" },
  { key: "altro", label: "Altro", color: "#66ff99" }
];

// Canali "componenti" di casa (casa = prese + clima + altro per definizione)
const CANALI_COMPONENTI = [
  { key: "prese", label: "Prese", color: "#66aaff" },
  { key: "clima", label: "Clima", color: "#ff9d4d" },
  { key: "altro", label: "Altro", color: "#66ff99" }
];

const RANGE_HOURS = {
  "1h": 1, "3h": 3, "6h": 6, "12h": 12,
  "1d": 24, "1w": 24 * 7, "1m": 24 * 30, "1y": 24 * 365
};

const POWER_LIMIT = { min: -50, max: 20000 };   // W
const ENERGY_LIMIT = { min: -1, max: 20000 };   // Wh per intervallo

// ========================
// TARIFFA - da bolletta Enel "Scegli Tu" (MONORARIO)
// Aggiorna questi valori quando arriva una bolletta nuova o cambia offerta.
// Fattura di riferimento: periodo 01/06/2026-31/07/2026, n. 5461487545
// ========================
const TARIFFA = {
  prezzo_energia_kwh: 0.234817,   // quota consumi (vendita + rete/oneri), €/kWh
  quota_fissa_mese: 13.785472,    // €/mese, indipendente dal consumo
  quota_potenza_kw_mese: 1.944262,// €/kW/mese
  potenza_impegnata_kw: 3.0,      // kW da contratto
  accisa_kwh: 0.0227,             // €/kWh (aliquota dichiarata in bolletta)
  iva: 0.10                       // 10%
};

let currentRange = "1d";
let currentEndTime = new Date();
let isDragging = false;

function fmtTime(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function fmtDateTime(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${mo}/${y} ${fmtTime(date)}`;
}

function fmtDayLabel(date) {
  const giorni = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
  const d = String(date.getDate()).padStart(2, "0");
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  return `${giorni[date.getDay()]} ${d}/${mo}`;
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

async function fetchChannelFeeds(channelId, apiKey, maxResults = 2000) {
  const url =
    `https://api.thingspeak.com/channels/${channelId}/feeds.json` +
    `?api_key=${apiKey}&results=${maxResults}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Errore HTTP " + res.status);
  const data = await res.json();
  return (data.feeds || []).map(f => ({
    time: new Date(f.created_at),
    raw: f
  }));
}

function filterByRange(feeds, hours, endTime) {
  if (!feeds.length) return [];
  const start = new Date(endTime.getTime() - hours * 3600 * 1000);
  return feeds.filter(f => f.time >= start && f.time <= endTime);
}

function isValid(v, lim) {
  return Number.isFinite(v) && v >= lim.min && v <= lim.max;
}

function buildSeries(feeds, fieldNum, limits) {
  return feeds
    .map(f => {
      const v = parseFloat(f.raw["field" + fieldNum]);
      if (!isValid(v, limits)) return null;
      return { x: f.time, y: v };
    })
    .filter(Boolean);
}

function getXAxisFormat(range) {
  const hours = RANGE_HOURS[range] || 24;
  return hours <= 24 ? "%H:%M" : "%d/%m";
}

function getChartMargins() {
  const isSmall = window.innerHeight <= 600 && window.innerWidth <= 900;
  return isSmall ? { l: 40, r: 5, t: 10, b: 20 } : { l: 55, r: 10, t: 10, b: 25 };
}

function startClock() {
  const el = document.getElementById("clock-time");
  if (!el) return;
  const tick = () => { el.textContent = fmtTime(new Date()); };
  tick();
  setInterval(tick, 1000);
}

function setupRangeButtons() {
  const btns = document.querySelectorAll(".btn-range");
  btns.forEach(btn => {
    const r = btn.dataset.range;
    if (r === currentRange) btn.classList.add("active");
    btn.addEventListener("click", () => {
      currentRange = r;
      currentEndTime = new Date();
      btns.forEach(b => b.classList.toggle("active", b.dataset.range === r));
      loadAndRender();
    });
  });
}

function setupPanHandler(chartId) {
  const div = document.getElementById(chartId);
  if (!div) return;

  div.on("plotly_relayouting", () => { isDragging = true; });

  div.on("plotly_relayout", ev => {
    if (!isDragging) return;
    if (!ev["xaxis.range[1]"]) return;
    isDragging = false;

    const newEnd = new Date(ev["xaxis.range[1]"]);
    if (Math.abs(newEnd - currentEndTime) < 1000) return;

    currentEndTime = newEnd;
    loadAndRender();
  });
}

function darkLayout(yTitle, extra = {}) {
  return Object.assign({
    margin: getChartMargins(),
    dragmode: "pan",
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#ffffff" },
    xaxis: {
      showgrid: true,
      gridcolor: "#555555",
      tickfont: { color: "#ffffff" },
      linecolor: "#ffffff",
      tickformat: getXAxisFormat(currentRange)
    },
    yaxis: {
      showgrid: true,
      gridcolor: "#555555",
      tickfont: { color: "#ffffff" },
      linecolor: "#ffffff",
      title: { text: yTitle, font: { color: "#ffffff" } }
    },
    legend: { orientation: "h", y: 1.15 }
  }, extra);
}

// ========================
// CALCOLO COSTI STIMATI
// ========================

// Ritorna il costo "energia" (variabile + accisa + IVA) per un consumo in kWh,
// SENZA quota fissa (usato per i sotto-canali prese/clima/altro).
function costoEnergiaSenzaFissi(kwh) {
  const variabile = kwh * TARIFFA.prezzo_energia_kwh;
  const accisa = kwh * TARIFFA.accisa_kwh;
  const imponibile = variabile + accisa;
  return imponibile * (1 + TARIFFA.iva);
}

// Costo fisso giornaliero (quota fissa + quota potenza), prorato sui giorni
// del mese corrente. Non dipende dal consumo.
function costoFissoGiorno(date) {
  const totaleMensile = TARIFFA.quota_fissa_mese +
    (TARIFFA.quota_potenza_kw_mese * TARIFFA.potenza_impegnata_kw);
  const imponibileGiorno = totaleMensile / daysInMonth(date);
  return imponibileGiorno * (1 + TARIFFA.iva);
}

// Costo totale "Casa" = energia sul consumo totale + costi fissi del giorno
function costoTotaleCasa(kwhCasa, date) {
  return costoEnergiaSenzaFissi(kwhCasa) + costoFissoGiorno(date);
}

// ========================
// FETCH CONDIVISO (settimana + mese in corso, un'unica chiamata)
// ========================

// Somma i Wh delta per canale tra due date, su un array di feed già filtrato.
function sommaKwhPerCanale(feedsInRange) {
  const kwh = { casa: 0, prese: 0, clima: 0, altro: 0 };
  for (const f of feedsInRange) {
    for (const c of CANALI) {
      const v = parseFloat(f.raw["field" + ENERGY_FIELDS[c.key + "_wh_delta"]]);
      if (isValid(v, ENERGY_LIMIT)) kwh[c.key] += v / 1000;
    }
  }
  return kwh;
}

async function fetchFeedsMese(now) {
  // Copre da inizio mese fino ad ora (max 8000 risultati, limite ThingSpeak).
  // Se il mese ha piu' di ~27 giorni pieni di dati, i primissimi giorni
  // potrebbero non rientrare: approssimazione accettabile per una stima.
  const giorniDaCoprire = now.getDate() + 1; // giorno del mese + margine
  const maxResults = Math.min(8000, giorniDaCoprire * 300);
  return fetchChannelFeeds(ENERGY_CHANNEL_ID, ENERGY_READ_KEY, maxResults);
}

// ========================
// RENDER GRAFICO SETTIMANALE (barre impilate prese+clima+altro)
// ========================

function renderWeeklyChart(feedsMese, now) {
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);

  const inRange = feedsMese.filter(f => f.time >= start && f.time <= now);

  const perGiorno = {};
  for (const f of inRange) {
    const d = f.time;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    if (!perGiorno[key]) perGiorno[key] = { prese: 0, clima: 0, altro: 0, casa: 0, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()) };

    for (const c of CANALI) {
      const v = parseFloat(f.raw["field" + ENERGY_FIELDS[c.key + "_wh_delta"]]);
      if (isValid(v, ENERGY_LIMIT)) perGiorno[key][c.key] += v;
    }
  }

  const giorniOrdinati = Object.keys(perGiorno).sort();
  const labels = giorniOrdinati.map(k => fmtDayLabel(perGiorno[k].date));
  const totaliGiorno = giorniOrdinati.map(k => perGiorno[k].casa / 1000);

  const traces = CANALI_COMPONENTI.map(c => ({
    x: labels,
    y: giorniOrdinati.map(k => perGiorno[k][c.key] / 1000),
    name: c.label,
    type: "bar",
    marker: { color: c.color }
  }));

  Plotly.newPlot("chart-weekly", traces, darkLayout("kWh", {
    barmode: "stack",
    margin: getChartMargins(),
    xaxis: { tickfont: { color: "#ffffff" }, linecolor: "#ffffff" }
  }), { displayModeBar: false });

  const totaleSettimana = totaliGiorno.reduce((a, b) => a + b, 0);
  document.getElementById("weekly-total").textContent =
    giorniOrdinati.length ? `tot: ${totaleSettimana.toFixed(1)} kWh` : "--";
}

// ========================
// RENDER RIEPILOGO COSTI: OGGI + DA INIZIO MESE (numeri + barre raggruppate)
// ========================

function renderRiepilogoCosti(feedsMese, now) {
  const midnightOggi = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const inizioMese = new Date(now.getFullYear(), now.getMonth(), 1);

  const feedsOggi = feedsMese.filter(f => f.time >= midnightOggi && f.time <= now);
  const feedsMeseCorrente = feedsMese.filter(f => f.time >= inizioMese && f.time <= now);

  const kwhOggi = sommaKwhPerCanale(feedsOggi);
  const kwhMese = sommaKwhPerCanale(feedsMeseCorrente);

  // Costi fissi: oggi = 1 giorno prorato; mese = giorni trascorsi nel mese prorati
  const giorniTrascorsiMese = now.getDate(); // 1..31
  const fissoGiorno = costoFissoGiorno(now);
  const fissoMese = fissoGiorno * giorniTrascorsiMese;

  const costi = {
    oggi: {
      prese: costoEnergiaSenzaFissi(kwhOggi.prese),
      clima: costoEnergiaSenzaFissi(kwhOggi.clima),
      altro: costoEnergiaSenzaFissi(kwhOggi.altro),
      fissi: fissoGiorno
    },
    mese: {
      prese: costoEnergiaSenzaFissi(kwhMese.prese),
      clima: costoEnergiaSenzaFissi(kwhMese.clima),
      altro: costoEnergiaSenzaFissi(kwhMese.altro),
      fissi: fissoMese
    }
  };

  const totaleOggi = costi.oggi.prese + costi.oggi.clima + costi.oggi.altro + costi.oggi.fissi;
  const totaleMese = costi.mese.prese + costi.mese.clima + costi.mese.altro + costi.mese.fissi;

  document.getElementById("riepilogo-totale-oggi").textContent = totaleOggi.toFixed(2) + " €";
  document.getElementById("riepilogo-totale-mese").textContent = totaleMese.toFixed(2) + " €";

  const categorie = ["Prese", "Clima", "Altro", "Fissi"];
  const traceOggi = {
    x: categorie,
    y: [costi.oggi.prese, costi.oggi.clima, costi.oggi.altro, costi.oggi.fissi],
    name: "Oggi",
    type: "bar",
    marker: { color: "#3d7cff" }
  };
  const traceMese = {
    x: categorie,
    y: [costi.mese.prese, costi.mese.clima, costi.mese.altro, costi.mese.fissi],
    name: "Da inizio mese",
    type: "bar",
    marker: { color: "#66aaff" }
  };

  Plotly.newPlot("chart-costi", [traceOggi, traceMese], darkLayout("€", {
    barmode: "group",
    margin: { l: 40, r: 5, t: 5, b: 25 },
    legend: { orientation: "h", y: 1.2 }
  }), { displayModeBar: false });
}

// ========================
// RENDER GRAFICI POTENZA E CONSUMO (range selezionabile)
// ========================

async function loadAndRender() {
  const status = document.getElementById("status-bar");
  try {
    status.textContent = "Caricamento dati da ThingSpeak…";

    const maxResults = currentRange === "1y" ? 8000 :
                        currentRange === "1m" ? 5000 :
                        currentRange === "1w" ? 3000 : 2000;

    const feeds = await fetchChannelFeeds(ENERGY_CHANNEL_ID, ENERGY_READ_KEY, maxResults);
    const hours = RANGE_HOURS[currentRange] || 24;
    const filtered = filterByRange(feeds, hours, currentEndTime);

    // === GRAFICO POTENZA (W) - 4 serie sovrapposte ===
    const powerTraces = CANALI.map(c => {
      const pts = buildSeries(filtered, ENERGY_FIELDS[c.key + "_w"], POWER_LIMIT);
      return {
        x: pts.map(p => p.x),
        y: pts.map(p => p.y),
        mode: "lines",
        name: c.label,
        line: { width: 2, color: c.color }
      };
    });
    Plotly.newPlot("chart-power", powerTraces, darkLayout("W"), { displayModeBar: false });
    setupPanHandler("chart-power");

    // === GRAFICO CONSUMO (Wh) - 4 serie sovrapposte ===
    const energyTraces = CANALI.map(c => {
      const pts = buildSeries(filtered, ENERGY_FIELDS[c.key + "_wh_delta"], ENERGY_LIMIT);
      return {
        x: pts.map(p => p.x),
        y: pts.map(p => p.y),
        mode: "lines",
        name: c.label,
        line: { width: 2, color: c.color }
      };
    });
    Plotly.newPlot("chart-energy", energyTraces, darkLayout("Wh"), { displayModeBar: false });
    setupPanHandler("chart-energy");

    if (filtered.length) {
      const lastTime = filtered[filtered.length - 1].time;
      status.textContent = `Ultimo dato: ${fmtDateTime(lastTime)} | Punti: ${filtered.length}`;
    } else {
      status.textContent = "Nessun dato nell'intervallo selezionato";
    }

    // Pannelli indipendenti dal range selezionato (sempre "oggi" / "mese" / "ultimi 7 gg")
    // Un'unica fetch condivisa tra i due pannelli, per non duplicare chiamate a ThingSpeak.
    const now = new Date();
    const feedsMese = await fetchFeedsMese(now);
    renderWeeklyChart(feedsMese, now);
    renderRiepilogoCosti(feedsMese, now);

  } catch (err) {
    status.textContent = "Errore caricamento dati: " + err.message;
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  startClock();
  setupRangeButtons();
  loadAndRender();
  setInterval(loadAndRender, 60 * 1000); // auto-refresh ogni minuto
});
