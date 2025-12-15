// ========================
// CONFIGURAZIONE THINGSPEAK
// ========================

const INTERNAL_CHANNEL_ID = 3152991;
const INTERNAL_READ_KEY   = "3I7MYYDZS4IKL3YJ";

const INTERNAL_FIELDS = {
  temp: 4,
  hum:  2,
  press: 3,
  cpu:  5
};

const EXTERNAL_CHANNEL_ID = 3181129;
const EXTERNAL_READ_KEY   = "7JYH3JOONPFPNQNE";

const EXTERNAL_FIELDS = {
  hum:  1,
  temp: 2
};

const RANGE_HOURS = {
  "1h": 1,
  "3h": 3,
  "6h": 6,
  "12h": 12,
  "1d": 24,
  "1w": 168,
  "1m": 720,
  "1y": 8760
};

// ========================
// FILTRI DATI (VALIDATI)
// ========================

const LIMITS = {
  tempInt: { min: -10, max: 50 },
  tempExt: { min: -30, max: 50 },
  hum:     { min: 0,   max: 100 },
  press:   { min: 950, max: 1050 },
  cpu:     { min: 0,   max: 100 }
};

const DELTA_LIMITS = {
  tempInt: 3.0,
  tempExt: 4.0,
  press:   4.0,
  humInt:  10,
  humExt:  15
};

function isValid(v, lim) {
  return Number.isFinite(v) && v >= lim.min && v <= lim.max;
}

function filterSpikes(points, maxDelta) {
  if (points.length < 2) return points;
  const clean = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = clean[clean.length - 1].y;
    const curr = points[i].y;
    if (Math.abs(curr - prev) <= maxDelta) {
      clean.push(points[i]);
    }
  }
  return clean;
}

function buildSeries(feeds, field, limits, deltaLimit) {
  const raw = feeds
    .map(f => {
      const v = parseFloat(f.raw[field]);
      if (!isValid(v, limits)) return null;
      return { x: f.time, y: v };
    })
    .filter(Boolean);

  return deltaLimit ? filterSpikes(raw, deltaLimit) : raw;
}

// ========================
// UTILITY
// ========================

function fmtTime(d) {
  return d.toLocaleTimeString("it-IT");
}

function fmtDateTime(d) {
  return d.toLocaleString("it-IT");
}

async function fetchChannelFeeds(channelId, apiKey, maxResults) {
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

function filterByRange(feeds, hours) {
  const cutoff = Date.now() - hours * 3600 * 1000;
  return feeds.filter(f => f.time.getTime() >= cutoff);
}

// ========================
// PLOTLY CONFIG
// ========================

const PLOT_CONFIG = {
  displayModeBar: false,
  scrollZoom: false,
  doubleClick: false,
  responsive: true
};

function baseLayout(yTitle, rangeX, rangeY) {
  return {
    dragmode: "pan",
    margin: getChartMargins(),
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#ffffff" },
    xaxis: {
      showgrid: true,
      gridcolor: "#555",
      tickformat: getXAxisFormat(currentRange),
      fixedrange: false,
      range: rangeX || null
    },
    yaxis: {
      showgrid: true,
      gridcolor: "#555",
      title: yTitle,
      fixedrange: true,
      range: rangeY || null
    }
  };
}

// ========================
// UI HELPERS
// ========================

function getXAxisFormat(range) {
  return RANGE_HOURS[range] <= 24 ? "%H:%M" : "%d/%m";
}

function getChartMargins() {
  const small = window.innerHeight <= 600 && window.innerWidth <= 900;
  return small ? { l: 35, r: 5, t: 8, b: 18 } : { l: 55, r: 10, t: 10, b: 25 };
}

// ========================
// MAIN RENDER
// ========================

let currentRange = "1d";

async function loadAndRender() {
  const maxResults =
    currentRange === "1y" ? 8000 :
    currentRange === "1m" ? 5000 :
    currentRange === "1w" ? 3000 : 2000;

  const [intFeeds, extFeeds] = await Promise.all([
    fetchChannelFeeds(INTERNAL_CHANNEL_ID, INTERNAL_READ_KEY, maxResults),
    fetchChannelFeeds(EXTERNAL_CHANNEL_ID, EXTERNAL_READ_KEY, maxResults)
  ]);

  const hours = RANGE_HOURS[currentRange];
  const intFiltered = filterByRange(intFeeds, hours);
  const extFiltered = filterByRange(extFeeds, hours);

  // ========================
  // PRESSIONE
  // ========================

  const pressPoints = buildSeries(
    intFiltered,
    "field" + INTERNAL_FIELDS.press,
    LIMITS.press,
    DELTA_LIMITS.press
  );

  const pressTrace = {
    x: pressPoints.map(p => p.x),
    y: pressPoints.map(p => p.y),
    mode: "lines",
    line: { color: "#00d4ff", width: 2 },
    fill: "tozeroy",
    fillcolor: "rgba(0,212,255,0.15)",
    hovertemplate: "%{y:.1f} hPa<extra></extra>"
  };

  const pVals = pressPoints.map(p => p.y);
  const pMin = Math.min(...pVals);
  const pMax = Math.max(...pVals);

  Plotly.newPlot(
    "chart-press",
    [pressTrace],
    baseLayout("hPa", null, [pMin - 2, pMax + 2]),
    PLOT_CONFIG
  );

  // ========================
  // TEMPERATURE
  // ========================

  const tempInt = buildSeries(
    intFiltered,
    "field" + INTERNAL_FIELDS.temp,
    LIMITS.tempInt,
    DELTA_LIMITS.tempInt
  );

  const tempExt = buildSeries(
    extFiltered,
    "field" + EXTERNAL_FIELDS.temp,
    LIMITS.tempExt,
    DELTA_LIMITS.tempExt
  );

  Plotly.newPlot(
    "chart-temp",
    [
      {
        x: tempInt.map(p => p.x),
        y: tempInt.map(p => p.y),
        name: "Temp INT",
        mode: "lines",
        line: { color: "#ff6666" }
      },
      {
        x: tempExt.map(p => p.x),
        y: tempExt.map(p => p.y),
        name: "Temp EXT",
        mode: "lines",
        line: { color: "#66aaff" }
      }
    ],
    baseLayout("°C"),
    PLOT_CONFIG
  );

  // ========================
  // UMIDITÀ
  // ========================

  const humInt = buildSeries(
    intFiltered,
    "field" + INTERNAL_FIELDS.hum,
    LIMITS.hum,
    DELTA_LIMITS.humInt
  );

  const humExt = buildSeries(
    extFiltered,
    "field" + EXTERNAL_FIELDS.hum,
    LIMITS.hum,
    DELTA_LIMITS.humExt
  );

  Plotly.newPlot(
    "chart-hum",
    [
      {
        x: humInt.map(p => p.x),
        y: humInt.map(p => p.y),
        name: "UR INT",
        mode: "lines",
        line: { color: "#ff6666" }
      },
      {
        x: humExt.map(p => p.x),
        y: humExt.map(p => p.y),
        name: "UR EXT",
        mode: "lines",
        line: { color: "#66aaff" }
      }
    ],
    baseLayout("%"),
    PLOT_CONFIG
  );
}

// ========================
// RANGE BUTTONS
// ========================

function setupRangeButtons() {
  document.querySelectorAll(".btn-range").forEach(btn => {
    btn.addEventListener("click", () => {
      currentRange = btn.dataset.range;
      document.querySelectorAll(".btn-range")
        .forEach(b => b.classList.toggle("active", b === btn));
      loadAndRender();
    });
  });
}

// ========================
// INIT
// ========================

setupRangeButtons();
loadAndRender();
