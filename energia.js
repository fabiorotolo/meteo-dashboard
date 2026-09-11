// ========================
// CONFIGURAZIONE THINGSPEAK - CANALE Energy_Cloud
// ========================

const ENERGY_CHANNEL_ID = 3489445;
const ENERGY_READ_KEY = "L3NRPAO60VP1UM4Z";

const ENERGY_FIELDS = {
  casa_w: 1, casa_wh_delta: 2,
  prese_w: 3, prese_wh_delta: 4,
  clima_w: 5, clima_wh_delta: 6,
  altro_w: 7, altro_wh_delta: 8
};

const CANALI = [
  { key: "casa", label: "Casa", color: "#3d7cff" },
  { key: "prese", label: "Prese", color: "#66aaff" },
  { key: "clima", label: "Clima", color: "#ff9d4d" },
  { key: "altro", label: "Utenze", color: "#66ff99" }
];

const CANALI_COMPONENTI = [
  { key: "prese", label: "Prese", color: "#66aaff" },
  { key: "clima", label: "Clima", color: "#ff9d4d" },
  { key: "altro", label: "Utenze", color: "#66ff99" }
];

const RANGE_HOURS = {
  "1h": 1, "3h": 3, "6h": 6, "12h": 12,
  "1d": 24, "1w": 24 * 7, "1m": 24 * 30, "1y": 24 * 365
};

const POWER_LIMIT = { min: -50, max: 20000 };
const ENERGY_LIMIT = { min: -1, max: 20000 };

// ========================
// TARIFFA - caricata da tariffa.json (elenco periodi), non più hardcoded qui.
// Ad ogni bolletta nuova, aggiungi una riga a tariffa.json invece di toccare
// questo file: lo script usa sempre l'ultimo periodo valido rispetto ad oggi.
// ========================
let TARIFFA_STORICO = [];

async function loadTariffaStorico() {
  try {
    const res = await fetch("tariffa.json");
    if (!res.ok) throw new Error("Errore HTTP " + res.status);
    const dati = await res.json();
    // Ordina per data crescente, cosi' l'ultima valida e' sempre in fondo
    dati.sort((a, b) => new Date(a.valido_dal) - new Date(b.valido_dal));
    return dati;
  } catch (err) {
    console.error("Impossibile caricare tariffa.json, uso valori di riserva:", err);
    // Valori di riserva (bolletta giu-lug 2026), usati solo se tariffa.json non e' raggiungibile
    return [{
      valido_dal: "2026-06-01",
      prezzo_energia_kwh: 0.234817,
      quota_fissa_mese: 13.785472,
      quota_potenza_kw_mese: 1.944262,
      potenza_impegnata_kw: 3.0,
      accisa_kwh: 0.0227,
      iva: 0.10
    }];
  }
}

// Ritorna il periodo tariffario applicabile a una data: l'ultimo con
// valido_dal <= data. Se la data e' precedente al primo periodo noto,
// usa comunque il primo disponibile (meglio di niente).
function getTariffaPerData(date) {
  const applicabili = TARIFFA_STORICO.filter(t => new Date(t.valido_dal) <= date);
  if (applicabili.length) return applicabili[applicabili.length - 1];
  return TARIFFA_STORICO[0];
}

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
  return (data.feeds || []).map(f => ({ time: new Date(f.created_at), raw: f }));
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

function getMarkerFontSize() {
  const isSmall = window.innerHeight <= 600 && window.innerWidth <= 900;
  return isSmall ? 7 : 12;
}

function getMarkerMode() {
  const isSmall = window.innerHeight <= 600 && window.innerWidth <= 900;
  return isSmall ? "markers" : "markers+text";
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
      showgrid: true, gridcolor: "#555555",
      tickfont: { color: "#ffffff" }, linecolor: "#ffffff",
      tickformat: getXAxisFormat(currentRange)
    },
    yaxis: {
      showgrid: true, gridcolor: "#555555",
      tickfont: { color: "#ffffff" }, linecolor: "#ffffff",
      title: { text: yTitle, font: { color: "#ffffff" } }
    },
    legend: { orientation: "h", y: 1.15 }
  }, extra);
}

// Marker min/max stile meteo, applicato a UNA serie (di solito "Casa")
function buildMinMaxMarkers(points, color) {
  if (!points.length) return { markers: [], min: null, max: null };
  const values = points.map(p => p.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const minPoint = points.find(p => p.y === min);
  const maxPoint = points.find(p => p.y === max);

  const markers = [
    {
      x: [minPoint.x], y: [minPoint.y],
      mode: getMarkerMode(),
      marker: { size: 8, color, symbol: "circle" },
      text: [min.toFixed(0)], textposition: "bottom center",
      textfont: { color: "#ffffff", size: getMarkerFontSize(), weight: "bold" },
      showlegend: false, hoverinfo: "skip"
    },
    {
      x: [maxPoint.x], y: [maxPoint.y],
      mode: getMarkerMode(),
      marker: { size: 8, color, symbol: "circle" },
      text: [max.toFixed(0)], textposition: "top center",
      textfont: { color: "#ffffff", size: getMarkerFontSize(), weight: "bold" },
      showlegend: false, hoverinfo: "skip"
    }
  ];
  return { markers, min, max };
}

// ========================
// CALCOLO COSTI STIMATI
// ========================

function costoEnergiaSenzaFissi(kwh, date) {
  const t = getTariffaPerData(date);
  const variabile = kwh * t.prezzo_energia_kwh;
  const accisa = kwh * t.accisa_kwh;
  const imponibile = variabile + accisa;
  return imponibile * (1 + t.iva);
}

function costoFissoGiorno(date) {
  const t = getTariffaPerData(date);
  const totaleMensile = t.quota_fissa_mese + (t.quota_potenza_kw_mese * t.potenza_impegnata_kw);
  const imponibileGiorno = totaleMensile / daysInMonth(date);
  return imponibileGiorno * (1 + t.iva);
}

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
  const giorniDaCoprire = now.getDate() + 1;
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

  const preseKwh = giorniOrdinati.map(k => perGiorno[k].prese / 1000);
  const climaKwh = giorniOrdinati.map(k => perGiorno[k].clima / 1000);
  const utenzeKwh = giorniOrdinati.map(k => perGiorno[k].altro / 1000);
  const totaleKwhGiorno = giorniOrdinati.map((k, i) => preseKwh[i] + climaKwh[i] + utenzeKwh[i]);

  // base = dove parte ogni segmento, per impilarli manualmente
  const baseClima = preseKwh;
  const baseUtenze = preseKwh.map((v, i) => v + climaKwh[i]);

  const costoValues = giorniOrdinati.map(k => {
    const kwh = perGiorno[k].casa / 1000;
    const data = perGiorno[k].date;
    return costoEnergiaSenzaFissi(kwh, data) + costoFissoGiorno(data);
  });

  const tracePrese = {
    x: labels, y: preseKwh, base: 0,
    name: "Prese", type: "bar", offsetgroup: "kwh",
    marker: { color: "#66aaff" }
  };
  const traceClima = {
    x: labels, y: climaKwh, base: baseClima,
    name: "Clima", type: "bar", offsetgroup: "kwh",
    marker: { color: "#ff9d4d" }
  };
  const traceUtenze = {
    x: labels, y: utenzeKwh, base: baseUtenze,
    name: "Utenze", type: "bar", offsetgroup: "kwh",
    marker: { color: "#66ff99" },
    text: totaleKwhGiorno.map(v => v.toFixed(1) + " kWh"),
    textposition: "outside",
    textfont: { color: "#ffffff", size: 10 }
  };
  const traceCosto = {
    x: labels, y: costoValues, base: 0,
    name: "Costo (€)", type: "bar", offsetgroup: "costo",
    yaxis: "y2",
    marker: { color: "#3d7cff" },
    text: costoValues.map(v => v.toFixed(2) + " €"),
    textposition: "outside",
    textfont: { color: "#ffffff", size: 10 }
  };

  Plotly.newPlot("chart-weekly", [tracePrese, traceClima, traceUtenze, traceCosto], darkLayout("kWh", {
    barmode: "group",
    margin: { l: 45, r: 45, t: 25, b: 25 },
    xaxis: { tickfont: { color: "#ffffff" }, linecolor: "#ffffff" },
    yaxis2: {
      overlaying: "y",
      side: "right",
      showgrid: false,
      tickfont: { color: "#ffffff" },
      linecolor: "#ffffff",
      title: { text: "€", font: { color: "#ffffff" } }
    }
  }), { displayModeBar: false });

  const totKwh = totaleKwhGiorno.reduce((a, b) => a + b, 0);
  const totCosto = costoValues.reduce((a, b) => a + b, 0);
  document.getElementById("weekly-total").textContent =
    giorniOrdinati.length ? `tot: ${totKwh.toFixed(1)} kWh | ${totCosto.toFixed(2)} €` : "--";
}
// ========================
// RENDER RIEPILOGO COSTI: OGGI + DA INIZIO MESE
// ========================

function renderRiepilogoCosti(feedsMese, now) {
  const midnightOggi = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const inizioMese = new Date(now.getFullYear(), now.getMonth(), 1);

  const feedsOggi = feedsMese.filter(f => f.time >= midnightOggi && f.time <= now);
  const feedsMeseCorrente = feedsMese.filter(f => f.time >= inizioMese && f.time <= now);

  const kwhOggi = sommaKwhPerCanale(feedsOggi);
  const kwhMese = sommaKwhPerCanale(feedsMeseCorrente);

  const giorniTrascorsiMese = now.getDate();
  const fissoGiorno = costoFissoGiorno(now);
  const fissoMese = fissoGiorno * giorniTrascorsiMese;

  const costi = {
    oggi: {
      prese: costoEnergiaSenzaFissi(kwhOggi.prese, now),
      clima: costoEnergiaSenzaFissi(kwhOggi.clima, now),
      altro: costoEnergiaSenzaFissi(kwhOggi.altro, now),
      fissi: fissoGiorno
    },
    mese: {
      prese: costoEnergiaSenzaFissi(kwhMese.prese, now),
      clima: costoEnergiaSenzaFissi(kwhMese.clima, now),
      altro: costoEnergiaSenzaFissi(kwhMese.altro, now),
      fissi: fissoMese
    }
  };

  const totaleOggi = costi.oggi.prese + costi.oggi.clima + costi.oggi.altro + costi.oggi.fissi;
  const totaleMese = costi.mese.prese + costi.mese.clima + costi.mese.altro + costi.mese.fissi;

  document.getElementById("riepilogo-totale-oggi").textContent = totaleOggi.toFixed(2) + " €";
  document.getElementById("riepilogo-totale-mese").textContent = totaleMese.toFixed(2) + " €";

  const categorie = ["Prese", "Clima", "Utenze", "Fissi"];
  const traceOggi = {
    x: categorie,
    y: [costi.oggi.prese, costi.oggi.clima, costi.oggi.altro, costi.oggi.fissi],
    name: "Oggi", type: "bar", marker: { color: "#3d7cff" }
  };
  const traceMese = {
    x: categorie,
    y: [costi.mese.prese, costi.mese.clima, costi.mese.altro, costi.mese.fissi],
    name: "Da inizio mese", type: "bar", marker: { color: "#66aaff" }
  };

  Plotly.newPlot("chart-costi", [traceOggi, traceMese], darkLayout("€", {
    barmode: "group",
    margin: { l: 40, r: 5, t: 5, b: 25 },
    legend: { orientation: "h", y: 1.2 }
  }), { displayModeBar: false });
}

// ========================
// RENDER GRAFICI POTENZA E CONSUMO (con marker min/max su "Casa")
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

    // === STATISTICHE IN ALTO (ultima lettura) ===
    if (filtered.length) {
      const last = filtered[filtered.length - 1].raw;
      for (const c of CANALI) {
        const w = parseFloat(last["field" + ENERGY_FIELDS[c.key + "_w"]]);
        const el = document.getElementById(`stat-${c.key}-w`);
        if (el && !isNaN(w)) el.innerHTML = w.toFixed(1) + ' <span class="unit-small">W</span>';
      }
      document.getElementById("stat-last-ts").textContent = fmtDateTime(filtered[filtered.length - 1].time);
      document.getElementById("stat-total-points").textContent = filtered.length;
    }

    // === GRAFICO POTENZA (W) - 4 serie + marker min/max su Casa ===
    const powerTraces = CANALI.map(c => {
      const pts = buildSeries(filtered, ENERGY_FIELDS[c.key + "_w"], POWER_LIMIT);
      return { x: pts.map(p => p.x), y: pts.map(p => p.y), mode: "lines", name: c.label, line: { width: 2, color: c.color } };
    });
    const casaPowerPts = buildSeries(filtered, ENERGY_FIELDS["casa_w"], POWER_LIMIT);
    const { markers: powerMarkers, min: minPowerCasa, max: maxPowerCasa } = buildMinMaxMarkers(casaPowerPts, "#3d7cff");
    document.getElementById("power-minmax").textContent =
      casaPowerPts.length ? `Casa: ${minPowerCasa.toFixed(0)}-${maxPowerCasa.toFixed(0)} W` : "--";

    Plotly.newPlot("chart-power", [...powerTraces, ...powerMarkers], darkLayout("W"), { displayModeBar: false });
    setupPanHandler("chart-power");

    // === GRAFICO CONSUMO (Wh) - 4 serie + marker min/max su Casa ===
    const energyTraces = CANALI.map(c => {
      const pts = buildSeries(filtered, ENERGY_FIELDS[c.key + "_wh_delta"], ENERGY_LIMIT);
      return { x: pts.map(p => p.x), y: pts.map(p => p.y), mode: "lines", name: c.label, line: { width: 2, color: c.color } };
    });
    const casaEnergyPts = buildSeries(filtered, ENERGY_FIELDS["casa_wh_delta"], ENERGY_LIMIT);
    const { markers: energyMarkers, min: minEnergyCasa, max: maxEnergyCasa } = buildMinMaxMarkers(casaEnergyPts, "#3d7cff");
    document.getElementById("energy-minmax").textContent =
      casaEnergyPts.length ? `Casa: ${minEnergyCasa.toFixed(1)}-${maxEnergyCasa.toFixed(1)} Wh` : "--";

    Plotly.newPlot("chart-energy", [...energyTraces, ...energyMarkers], darkLayout("Wh"), { displayModeBar: false });
    setupPanHandler("chart-energy");

    status.textContent = filtered.length
      ? `Ultimo dato: ${fmtDateTime(filtered[filtered.length - 1].time)}`
      : "Nessun dato nell'intervallo selezionato";

    const now = new Date();
    const feedsMese = await fetchFeedsMese(now);
    renderWeeklyChart(feedsMese, now);
    renderRiepilogoCosti(feedsMese, now);

  } catch (err) {
    status.textContent = "Errore caricamento dati: " + err.message;
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  startClock();
  setupRangeButtons();
  TARIFFA_STORICO = await loadTariffaStorico();
  loadAndRender();
  setInterval(loadAndRender, 60 * 1000);
});
