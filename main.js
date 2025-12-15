// =====================================================
// CONFIG THINGSPEAK
// =====================================================

const CH = 3152991;
const KEY = "3I7MYYDZS4IKL3YJ";
const FIELD_PRESS = 3;

// =====================================================
// RANGE DEFINIZIONI
// =====================================================

const RANGE_HOURS = {
  "1d": 24,
  "1w": 168,
  "1m": 720,
  "3m": 2160,
  "1y": 8760,
  "2y": 17520
};

// gerarchia di caricamento
const RANGE_PARENT = {
  "1d": "1w",
  "1w": "1m",
  "1m": "3m",
  "3m": "1y",
  "1y": "2y"
};

// =====================================================
// CACHE DATI
// =====================================================

const dataCache = {
  "1w": null,
  "1m": null,
  "3m": null,
  "1y": null,
  "2y": null
};

// =====================================================
// FILTRI PRESSIONE
// =====================================================

const PRESS_LIMITS = { min: 950, max: 1050 };
const PRESS_DELTA = 4;

function validPress(v) {
  return Number.isFinite(v) && v >= PRESS_LIMITS.min && v <= PRESS_LIMITS.max;
}

function filterSpikes(points) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].y - out[out.length - 1].y) <= PRESS_DELTA)
      out.push(points[i]);
  }
  return out;
}

// =====================================================
// FETCH & CACHE
// =====================================================

async function loadRange(range) {
  if (dataCache[range]) return dataCache[range];

  const results =
    range === "2y" ? 8000 :
    range === "1y" ? 7000 :
    range === "3m" ? 5000 :
    range === "1m" ? 4000 :
    range === "1w" ? 3000 : 2000;

  const res = await fetch(
    `https://api.thingspeak.com/channels/${CH}/feeds.json?api_key=${KEY}&results=${results}`
  );
  const json = await res.json();

  const points = json.feeds
    .map(f => {
      const v = parseFloat(f["field" + FIELD_PRESS]);
      if (!validPress(v)) return null;
      return { x: new Date(f.created_at), y: v };
    })
    .filter(Boolean);

  dataCache[range] = filterSpikes(points);
  return dataCache[range];
}

// =====================================================
// DATA PER RANGE RICHIESTO
// =====================================================

async function getDataForRange(range) {

  // se ho già il range esatto
  if (dataCache[range]) return dataCache[range];

  // uso il parent
  const parent = RANGE_PARENT[range];
  const parentData = await loadRange(parent);

  const cut = Date.now() - RANGE_HOURS[range] * 3600 * 1000;
  return parentData.filter(p => p.x.getTime() >= cut);
}

// =====================================================
// UTILS
// =====================================================

function minMax(points) {
  let min = points[0], max = points[0];
  for (const p of points) {
    if (p.y < min.y) min = p;
    if (p.y > max.y) max = p;
  }
  return { min, max };
}

// =====================================================
// RENDER
// =====================================================

function render(points) {

  const mm = minMax(points);

  Plotly.react("chart-press", [
    {
      x: points.map(p => p.x),
      y: points.map(p => p.y),
      mode: "lines",
      line: { color: "#00d4ff", width: 2 }
    },
    {
      x: [mm.min.x],
      y: [mm.min.y],
      mode: "markers+text",
      text: [mm.min.y.toFixed(1) + " hPa"],
      marker: { color: "#ff6666", size: 9 },
      showlegend: false
    },
    {
      x: [mm.max.x],
      y: [mm.max.y],
      mode: "markers+text",
      text: [mm.max.y.toFixed(1) + " hPa"],
      marker: { color: "#66ff66", size: 9 },
      showlegend: false
    }
  ], {
    dragmode: "pan",
    xaxis: { fixedrange: false },
    yaxis: { autorange: true, title: "hPa" },
    margin: { l: 50, r: 10, t: 10, b: 30 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)"
  }, { displayModeBar: false });
}

// =====================================================
// INIT & RANGE BUTTONS
// =====================================================

let currentRange = "1d";

async function updateRange(range) {
  currentRange = range;
  const data = await getDataForRange(range);
  render(data);
}

// preload intelligente (background)
setTimeout(() => loadRange("1w"), 500);
setTimeout(() => loadRange("1m"), 1200);
setTimeout(() => loadRange("3m"), 2000);
setTimeout(() => loadRange("1y"), 3000);
setTimeout(() => loadRange("2y"), 4500);

// init
updateRange("1d");

// bottoni range (se presenti)
document.querySelectorAll(".btn-range").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".btn-range")
      .forEach(b => b.classList.toggle("active", b === btn));
    updateRange(btn.dataset.range);
  });
});
