// =======================
// CONFIG
// =======================

const CH = 3152991;
const KEY = "3I7MYYDZS4IKL3YJ";
const FIELD = 3;

let allPoints = [];
let currentRange = "1d";

const RANGE_HOURS = {
  "1h": 1,
  "3h": 3,
  "6h": 6,
  "12h": 12,
  "1d": 24
};

// =======================
// FETCH
// =======================

async function loadData() {
  const res = await fetch(
    `https://api.thingspeak.com/channels/${CH}/feeds.json?api_key=${KEY}&results=2000`
  );
  const json = await res.json();

  allPoints = json.feeds.map(f => ({
    x: new Date(f.created_at),
    y: parseFloat(f["field" + FIELD])
  })).filter(p => Number.isFinite(p.y));
}

// =======================
// UTILS
// =======================

function filterByX(points, x0, x1) {
  const t0 = new Date(x0).getTime();
  const t1 = new Date(x1).getTime();
  return points.filter(p => {
    const t = p.x.getTime();
    return t >= t0 && t <= t1;
  });
}

function minMax(points) {
  let min = points[0], max = points[0];
  for (const p of points) {
    if (p.y < min.y) min = p;
    if (p.y > max.y) max = p;
  }
  return { min, max };
}

// =======================
// RENDER
// =======================

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

// =======================
// INIT
// =======================

async function init() {
  await loadData();

  const cut = Date.now() - RANGE_HOURS[currentRange] * 3600 * 1000;
  const initial = allPoints.filter(p => p.x.getTime() >= cut);
  render(initial);

  const div = document.getElementById("chart-press");

  div.on("plotly_relayout", ev => {
    if (!ev["xaxis.range[0]"]) return;

    const filtered = filterByX(
      allPoints,
      ev["xaxis.range[0]"],
      ev["xaxis.range[1]"]
    );

    if (filtered.length > 2) render(filtered);
  });
}

init();
