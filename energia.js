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
    dati.sort((a, b) => new Date(a.valido_dal) - new Date(b.valido_dal));
    return dati;
  } catch (err) {
    console.error("Impossibile caricare tariffa.json, uso valori di riserva:", err);
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

function getTariffaPerData(date) {
  const applicabili = TARIFFA_STORICO.filter(t => new Date(t.valido_dal) <= date);
  if (applicabili.length) return applicabili[applicabili.length - 1];
  return TARIFFA_STORICO[0];
}

let currentRange = "1d";
let currentEndTime = new Date();
let weeklyEndTime = new Date(); // fine finestra (7 giorni) del grafico "Consumi ultimi 7 giorni", spostabile trascinando
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

// --- Rilevamento mobile basato sulla LARGHEZZA (coerente col breakpoint CSS 650px) ---
function isMobileWidth() {
  return window.innerWidth <= 650;
}

function getChartMargins() {
  return isMobileWidth() ? { l: 40, r: 5, t: 10, b: 20 } : { l: 55, r: 10, t: 10, b: 25 };
}

function getMarkerFontSize() {
  return isMobileWidth() ? 8 : 12;
}

function getMarkerMode() {
  return isMobileWidth() ? "markers" : "markers+text";
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
      weeklyEndTime = new Date();
      btns.forEach(b => b.classList.toggle("active", b.dataset.range === r));
      loadAndRender();
    });
  });
}

function setupPanHandler(chartId) {
  const div = document.getElementById(chartId);
  if (!div) return;

  // Consente al browser di gestire lo scroll verticale della pagina (touch-action: pan-y)
  // mentre Plotly gestisce solo il trascinamento orizzontale (asse Y bloccato via fixedrange).
  div.style.touchAction = "pan-y";

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

// Per il grafico "Riepilogo costi" (barre categoriche, non ha una finestra temporale
// continua) non ha senso alcun trascinamento: blocchiamo tutto e lasciamo scorrere la
// pagina liberamente in entrambe le direzioni quando si tocca il grafico da mobile.
function lockChartScroll(chartId) {
  const div = document.getElementById(chartId);
  if (!div) return;
  div.style.touchAction = "pan-y";
}

// ========================
// TRASCINAMENTO ORIZZONTALE - GRAFICO "CONSUMI ULTIMI 7 GIORNI"
// ========================
// Essendo un grafico a barre con asse X categorico (etichette giorno), non può
// usare il dragmode "pan" nativo di Plotly come i grafici a linee temporali.
// Misuriamo quindi noi lo spostamento orizzontale del gesto (mouse o touch) e,
// al rilascio, spostiamo la finestra di 7 giorni indietro/avanti nel tempo.
function setupWeeklyDragHandler(chartId) {
  const div = document.getElementById(chartId);
  if (!div) return;

  const DEAD_ZONE = 8;     // px di movimento prima di capire se il gesto è orizzontale o verticale
  const MIN_DRAG = 20;     // px minimi per considerare un trascinamento valido (evita click accidentali)

  let startX = null;
  let startY = null;
  let axisLocked = null;   // "x" (trasciniamo il grafico) | "y" (lasciamo scorrere la pagina) | null

  div.style.cursor = "ew-resize"; // freccia orizzontale: qui si trascina a sinistra/destra, non su/giù

  const shiftWeekly = (deltaX) => {
    const rect = div.getBoundingClientRect();
    if (!rect.width) return;
    const dayWidth = rect.width / 7; // 7 giorni visibili nel grafico
    const daysShift = Math.round(deltaX / dayWidth);
    if (!daysShift) return;

    // Trascinare verso destra (deltaX > 0) fa scorrere la vista indietro nel tempo,
    // come "tirare" dati più vecchi verso lo schermo.
    let newEnd = new Date(weeklyEndTime.getTime() - daysShift * 24 * 3600 * 1000);
    const oggi = new Date();
    if (newEnd > oggi) newEnd = oggi; // non si può andare oltre il presente
    weeklyEndTime = newEnd;
    refreshWeeklyAndCosti();
  };

  const reset = () => {
    startX = null;
    startY = null;
    axisLocked = null;
    div.style.cursor = "ew-resize";
  };

  // Determina solo la DIREZIONE del gesto (una volta sola), senza spostare
  // visivamente il grafico: gli assi restano fermi, l'aggiornamento avviene
  // solo al rilascio, come nella versione precedente.
  const onMove = (clientX, clientY) => {
    if (startX === null || axisLocked) return;
    const dx = clientX - startX;
    const dy = clientY - startY;
    if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return; // troppo presto, aspetta

    axisLocked = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (axisLocked === "x") div.style.cursor = "grabbing";
  };

  const onEnd = (clientX) => {
    if (startX === null) return;
    const dx = clientX - startX;
    const wasHorizontalDrag = axisLocked === "x";
    reset();
    if (wasHorizontalDrag && Math.abs(dx) >= MIN_DRAG) shiftWeekly(dx);
  };

  div.addEventListener("mousedown", e => { startX = e.clientX; startY = e.clientY; });
  window.addEventListener("mousemove", e => onMove(e.clientX, e.clientY));
  window.addEventListener("mouseup", e => onEnd(e.clientX));

  div.addEventListener("touchstart", e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  div.addEventListener("touchmove", e => {
    onMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  div.addEventListener("touchend", e => onEnd(e.changedTouches[0].clientX), { passive: true });
  div.addEventListener("touchcancel", reset, { passive: true });
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
      title: { text: yTitle, font: { color: "#ffffff" } },
      fixedrange: true // blocca zoom/pan verticale: non serve e crea conflitti con lo scroll della pagina su mobile
    },
    legend: { orientation: "h", y: 1.15 }
  }, extra);
}

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

async function fetchFeedsMese(now, weeklyEndTime = now) {
  const msPerDay = 24 * 3600 * 1000;
  const giorniMese = now.getDate() + 1; // giorni dal primo del mese ad oggi, per il riepilogo costi
  const giorniIndietroSettimana = Math.max(0, Math.ceil((now - weeklyEndTime) / msPerDay));
  const giorniDaCoprire = Math.max(giorniMese, giorniIndietroSettimana + 8); // +8: finestra di 7 giorni + margine
  const maxResults = Math.min(8000, giorniDaCoprire * 300);
  return fetchChannelFeeds(ENERGY_CHANNEL_ID, ENERGY_READ_KEY, maxResults);
}

// ========================
// RENDER GRAFICO SETTIMANALE (barre impilate kWh + colonna costo affiancata)
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

  const baseClima = preseKwh;
  const baseUtenze = preseKwh.map((v, i) => v + climaKwh[i]);

  const costoValues = giorniOrdinati.map(k => {
    const kwh = perGiorno[k].casa / 1000;
    const data = perGiorno[k].date;
    return costoEnergiaSenzaFissi(kwh, data) + costoFissoGiorno(data);
  });

  const isMobile = isMobileWidth();
  const fontSizeEtichette = isMobile ? 8 : 10;

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
    textfont: { color: "#ffffff", size: fontSizeEtichette },
    cliponaxis: false
  };
  const traceCosto = {
    x: labels, y: costoValues, base: 0,
    name: "Costo (€)", type: "bar", offsetgroup: "costo",
    yaxis: "y2",
    marker: { color: "#3d7cff" },
    text: costoValues.map(v => v.toFixed(2) + " €"),
    textposition: "outside",
    textfont: { color: "#ffffff", size: fontSizeEtichette },
    cliponaxis: false
  };

  const layoutSettimanale = darkLayout("kWh", {
    barmode: "group",
    bargap: isMobile ? 0.15 : 0.3,
    bargroupgap: isMobile ? 0.05 : 0.1,
    margin: isMobile
      ? { l: 40, r: 40, t: 70, b: 20 }
      : { l: 55, r: 55, t: 30, b: 25 },
    dragmode: false, // disabilita zoom/riquadro nativo di Plotly: il trascinamento è gestito a parte (vedi setupWeeklyDragHandler)
    xaxis: { tickfont: { color: "#ffffff", size: isMobile ? 9 : 12 }, linecolor: "#ffffff", fixedrange: true },
    yaxis2: {
      overlaying: "y",
      side: "right",
      showgrid: false,
      rangemode: "tozero",
      tickfont: { color: "#ffffff" },
      linecolor: "#ffffff",
      title: { text: "€", font: { color: "#ffffff" } }
    },
    legend: {
      orientation: "h",
      y: isMobile ? 1.35 : 1.15,
      font: { size: isMobile ? 10 : 12 }
    }
  });
  layoutSettimanale.yaxis.rangemode = "tozero";

  Plotly.newPlot("chart-weekly", [tracePrese, traceClima, traceUtenze, traceCosto], layoutSettimanale, { displayModeBar: false });
  lockChartScroll("chart-weekly");

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
    dragmode: false, // asse X categorico (Prese/Clima/Utenze/Fissi): il trascinamento non ha senso qui
    xaxis: {
      showgrid: true, gridcolor: "#555555",
      tickfont: { color: "#ffffff" }, linecolor: "#ffffff",
      fixedrange: true
    },
    legend: { orientation: "h", y: 1.2 }
  }), { displayModeBar: false });
  lockChartScroll("chart-costi");
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

    await refreshWeeklyAndCosti();

  } catch (err) {
    status.textContent = "Errore caricamento dati: " + err.message;
    console.error(err);
  }
}

// Ridisegna solo "Consumi ultimi 7 giorni" e "Riepilogo costi" (usati dopo il
// trascinamento del grafico settimanale, senza dover ricaricare tutto il resto).
async function refreshWeeklyAndCosti() {
  const now = new Date();
  const feedsMese = await fetchFeedsMese(now, weeklyEndTime);
  renderWeeklyChart(feedsMese, weeklyEndTime);
  renderRiepilogoCosti(feedsMese, now);
}

document.addEventListener("DOMContentLoaded", async () => {
  startClock();
  setupRangeButtons();
  setupWeeklyDragHandler("chart-weekly");
  TARIFFA_STORICO = await loadTariffaStorico();
  loadAndRender();
  setInterval(loadAndRender, 60 * 1000);
});
