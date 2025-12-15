// =======================
// THINGSPEAK CONFIG
// =======================

const INT_CH = 3152991;
const INT_KEY = "3I7MYYDZS4IKL3YJ";

const INT_FIELDS = { press: 3 };

const RANGE_HOURS = {
  "1h": 1,
  "3h": 3,
  "6h": 6,
  "12h": 12,
  "1d": 24
};

// =======================
// DATA FILTERS
// =======================

const PRESS_LIMITS = { min: 950, max: 1050 };
const PRESS_DELTA = 4;

function valid(v) {
  return Number.isFinite(v) && v >= PRESS_LIMITS.min && v <= PRESS_LIMITS.max;
}

function filterSpikes(arr) {
  if (arr.length < 2) return arr;
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    if (Math.abs(arr[i].y - out[out.length - 1].y) <= PRESS_DELTA)
      out.push(arr[i]);
  }
  return out;
}

// =======================
// FETCH
// =======================

async function fetchData(hours) {
  const res = await fetch(
    `https://api.thingspeak.com/channels/${INT_CH}/feeds.json?api_key=${INT_KEY}&results=2000`
  );
  const json = await res.json();

  const cut = Date.now() - hours * 3600 * 1000;

  const pts = json.feeds
    .map(f => {
      const v = parseFloat(f["field" + INT_FIELDS.press]);
      if (!valid(v)) return null;
      const t = new Date(f.created_at);
      if (t.getTime() < cut) return null;
      return { x: t, y: v };
    })
    .filter(Boolean);

  return filterSpikes(pts);
}

// =======================
// MIN / MAX
// =======================

function minMax(points, x0, x1) {
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

// =======================
// MAIN
// =======================

let currentRange = "1d";
let pressPoints = [];

async function render() {

  pressPoints = await fetchData(RANGE_HOURS[currentRange]);

  const div = document.getElementById("chart-press");

  const line = {
    x: pressPoints.map(p => p.x),
    y: pressPoints.map(p => p.y),
    mode: "lines",
    line: { color: "#00d4ff", width: 2 }
  };

  const minTrace = {
    x: [], y: [],
    mode: "markers+text",
    marker: { size: 9, color: "#ff6666" },
    text: [],
    showlegend: false
  };

  const maxTrace = {
    x: [], y: [],
    mode: "markers+text",
    marker: { size: 9, color: "#66ff66" },
    text: [],
    showlegend: false
  };

  Plotly.newPlot(div, [line, minTrace, maxTrace], {
    dragmode: "pan",
    xaxis: { fixedrange: false },
    yaxis: { autorange: true, title: "hPa" },
    margin: { l: 50, r: 10, t: 10, b: 30 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)"
  }, { displayModeBar: false });

  div.on("plotly_relayout", ev => {
    if (!ev["xaxis.range[0]"]) return;

    const mm = minMax(
      pressPoints,
      ev["xaxis.range[0]"],
      ev["xaxis.range[1]"]
    );
    if (!mm) return;

    Plotly.restyle(div, {
      x: [[mm.min.x]],
      y: [[mm.min.y]],
      text: [[mm.min.y.toFixed(1) + " hPa"]]
    }, [1]);

    Plotly.restyle(div, {
      x: [[mm.max.x]],
      y: [[mm.max.y]],
      text: [[mm.max.y.toFixed(1) + " hPa"]]
    }, [2]);
  });
}

render();
