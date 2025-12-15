// =====================================================
// CONFIGURAZIONE THINGSPEAK
// =====================================================

const INTERNAL_CHANNEL_ID = 3152991;
const INTERNAL_READ_KEY   = "3I7MYYDZS4IKL3YJ";

const INTERNAL_FIELDS = {
  temp:  4,
  hum:   2,
  press: 3
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
  "1w": 168
};

// =====================================================
// FILTRI DATI
// =====================================================

const LIMITS = {
  tempInt: { min: -10, max: 50 },
  tempExt: { min: -30, max: 50 },
  hum:     { min: 0,   max: 100 },
  press:   { min: 950, max: 1050 }
};

const DELTA_LIMITS = {
  tempInt: 3,
  tempExt: 4,
  humInt:  10,
  humExt:  15,
  press:   4
};

function isValid(v, lim) {
  return Number.isFinite(v) && v >= lim.min && v <= lim.max;
}

function filterSpikes(points, maxDelta) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].y - out[out.length - 1].y) <= maxDelta)
      out.push(points[i]);
  }
  return out;
}

function buildSeries(feeds, field, limits, deltaLimit) {
  const raw = feeds.map(f => {
    const v = parseFloat(f.raw[field]);
    if (!isValid(v, limits)) return null;
    return { x: f.time, y: v };
  }).filter(Boolean);

  return deltaLimit ? filterSpikes(raw, deltaLimit) : raw;
}

// =====================================================
// UTILITY
// =====================================================

async function fetchChannelFeeds(id, key, n) {
  const res = await fetch(
    `https://api.thingspeak.com/channels/${id}/feeds.json?api_key=${key}&results=${n}`
  );
  const json = await res.json();
  return (json.feeds || []).map(f => ({
    time: new Date(f.created_at),
    raw: f
  }));
}

function filterByRange(feeds, h) {
  const cut = Date.now() - h * 3600 * 1000;
  return feeds.filter(f => f.time.getTime() >= cut);
}

// =====================================================
// MIN / MAX VISIBILI
// =====================================================

function minMaxInRange(points, x0, x1) {
  const t0 = new Date(x0).getTime();
  const t1 = new Date(x1).getTime();

  let min = null, max = null;
  for (const p of points) {
    const t = p.x.getTime();
    if (t < t0 || t > t1) continue;
    if (!min || p.y < min.y) min = p;
    if (!max || p.y > max.y) max = p;
  }
  return min && max ? { min, max } : null;
}

// =====================================================
// GRAFICO PRESSIONE
// =====================================================

function renderPressure(div, points) {

  const line = {
    x: points.map(p => p.x),
    y: points.map(p => p.y),
    mode: "lines",
    line: { color: "#00d4ff", width: 2 }
  };

  const minTrace = { x: [], y: [], mode: "markers+text",
    marker: { size: 9, color: "#ff6666" }, text: [], showlegend: false };

  const maxTrace = { x: [], y: [], mode: "markers+text",
    marker: { size: 9, color: "#66ff66" }, text: [], showlegend: false };

  Plotly.newPlot(div, [line, minTrace, maxTrace], {
    dragmode: "pan",
    xaxis: { fixedrange: false },
    yaxis: { fixedrange: true, title: "hPa" },
    margin: { l: 50, r: 10, t: 10, b: 30 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)"
  }, { displayModeBar: false });

  div.on("plotly_relayout", ev => {
    if (!ev["xaxis.range[0]"]) return;
    const mm = minMaxInRange(points, ev["xaxis.range[0]"], ev["xaxis.range[1]"]);
    if (!mm) return;

    const pad = 2;
    Plotly.relayout(div, {
      "yaxis.range": [mm.min.y - pad, mm.max.y + pad]
    });

    Plotly.restyle(div, {
      x: [[mm.min.x]], y: [[mm.min.y]], text: [[mm.min.y.toFixed(1) + " hPa"]]
    }, [1]);

    Plotly.restyle(div, {
      x: [[mm.max.x]], y: [[mm.max.y]], text: [[mm.max.y.toFixed(1) + " hPa"]]
    }, [2]);
  });
}

// =====================================================
// MAIN
// =====================================================

let currentRange = "1d";

async function loadAndRender() {

  const maxResults = 2000;
  const [intF, extF] = await Promise.all([
    fetchChannelFeeds(INTERNAL_CHANNEL_ID, INTERNAL_READ_KEY, maxResults),
    fetchChannelFeeds(EXTERNAL_CHANNEL_ID, EXTERNAL_READ_KEY, maxResults)
  ]);

  const intData = filterByRange(intF, RANGE_HOURS[currentRange]);
  const press = buildSeries(intData,
    "field" + INTERNAL_FIELDS.press,
    LIMITS.press,
    DELTA_LIMITS.press
  );

  renderPressure(document.getElementById("chart-press"), press);
}

// =====================================================
// INIT
// =====================================================

loadAndRender();
