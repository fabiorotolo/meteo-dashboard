// =====================================================
// CONFIGURAZIONE THINGSPEAK
// =====================================================

const INTERNAL_CHANNEL_ID = 3152991;
const INTERNAL_READ_KEY   = "3I7MYYDZS4IKL3YJ";

const INTERNAL_FIELDS = {
  temp:  4,
  hum:   2,
  press: 3,
  cpu:   5
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

// =====================================================
// FILTRI DATI (VALIDATI)
// =====================================================

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
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1].y;
    const curr = points[i].y;
    if (Math.abs(curr - prev) <= maxDelta) out.push(points[i]);
  }
  return out;
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

// =====================================================
// FETCH & UTILITY
// =====================================================

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

// =====================================================
// PLOTLY CONFIG
// =====================================================

const PLOT_CONFIG = {
  displayModeBar: false,
  scrollZoom: false,
  doubleClick: false,
  responsive: true
};

function getXAxisFormat(range) {
  return RANGE_HOURS[range] <= 24 ? "%H:%M" : "%d/%m";
}

function getChartMargins() {
  const small = window.innerHeight <= 600 && window.innerWidth <= 900;
  return small ? { l: 35, r: 5, t: 8, b: 18 } : { l: 55, r: 10, t: 10, b: 25 };
}

// =====================================================
// MIN / MAX SU FINESTRA VISIBILE
// =====================================================

function computeMinMaxInRange(points, x0, x1) {
  const t0 = new Date(x0).getTime();
  const t1 = new Date(x1).getTime();

  let min = null;
  let max = null;

  for (const p of points) {
    const t = p.x.getTime();
    if (t < t0 || t > t1) continue;

    if (!min || p.y < min.y) min = p;
    if (!max || p.y > max.y) max = p;
  }

  return min && max ? { min, max } : null;
}

// =====================================================
// MAIN
// =====================================================

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

  // ==========================
  // PRESSIONE
  // ==========================

  const pressPoints = buildSeries(
    intFiltered,
    "field" + INTERNAL_FIELDS.press,
    LIMITS.press,
    DELTA_LIMITS.press
  );

  const pressDiv = document.getElementById("chart-press");

  const pressLine = {
    x: pressPoints.map(p => p.x),
    y: pressPoints.map(p => p.y),
    mode: "lines",
    line: { color: "#00d4ff", width: 2 },
    fill: "tozeroy",
    fillcolor: "rgba(0,212,255,0.15)",
    hovertemplate: "%{y:.1f} hPa<extra></extra>"
  };

  const pressMinTrace = {
    x: [],
    y: [],
    mode: "markers+text",
    marker: { size: 9, color: "#ff6666" },
    text: [],
    textposition: "bottom center",
    showlegend: false,
    hoverinfo: "skip"
  };

  const pressMaxTrace = {
    x: [],
    y: [],
    mode: "markers+text",
    marker: { size: 9, color: "#66ff66" },
    text: [],
    textposition: "top center",
    showlegend: false,
    hoverinfo: "skip"
  };

  Plotly.newPlot(
    pressDiv,
    [pressLine, pressMinTrace, pressMaxTrace],
    {
      dragmode: "pan",
      margin: getChartMargins(),
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      xaxis: {
        tickformat: getXAxisFormat(currentRange),
        fixedrange: false
      },
      yaxis: {
        title: "hPa",
        fixedrange: true
      }
    },
    PLOT_CONFIG
  );

  // primo calcolo (range iniziale)
  setTimeout(() => {
    const xRange = pressDiv.layout.xaxis.range;
    if (!xRange) return;

    const mm = computeMinMaxInRange(pressPoints, xRange[0], xRange[1]);
    if (!mm) return;

    Plotly.restyle(pressDiv, {
      x: [[mm.min.x]],
      y: [[mm.min.y]],
      text: [[mm.min.y.toFixed(1) + " hPa"]]
    }, [1]);

    Plotly.restyle(pressDiv, {
      x: [[mm.max.x]],
      y: [[mm.max.y]],
      text: [[mm.max.y.toFixed(1) + " hPa"]]
    }, [2]);
  }, 0);

  // ricalcolo DOPO PAN
  pressDiv.on("plotly_relayout", ev => {
    if (!ev["xaxis.range[0]"] || !ev["xaxis.range[1]"]) return;

    const mm = computeMinMaxInRange(
      pressPoints,
      ev["xaxis.range[0]"],
      ev["xaxis.range[1]"]
    );

    if (!mm) return;

    Plotly.restyle(pressDiv, {
      x: [[mm.min.x]],
      y: [[mm.min.y]],
      text: [[mm.min.y.toFixed(1) + " hPa"]]
    }, [1]);

    Plotly.restyle(pressDiv, {
      x: [[mm.max.x]],
      y: [[mm.max.y]],
      text: [[mm.max.y.toFixed(1) + " hPa"]]
    }, [2]);
  });
}

// =====================================================
// RANGE BUTTONS
// =====================================================

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

// =====================================================
// INIT
// =====================================================

setupRangeButtons();
loadAndRender();
