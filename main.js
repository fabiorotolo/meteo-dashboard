// ========================
// CONFIGURAZIONE THINGSPEAK
// ========================

const INTERNAL_CHANNEL_ID = 3152991;
const INTERNAL_READ_KEY   = "3I7MYYDZS4IKL3YJ";

const INTERNAL_FIELDS = {
  temp: 4,
  hum: 2,
  press: 3,
  cpu: 5
};

const EXTERNAL_CHANNEL_ID = 3181129;
const EXTERNAL_READ_KEY   = "7JYH3JOONPFPNQNE";

const EXTERNAL_FIELDS = {
  hum: 1,
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
// STATO GLOBALE
// ========================

let currentRange = "1d";
let currentEndTime = new Date();   // ⬅️ ORA LOGICA

// ========================
// UTILITÀ DI BASE
// ========================

function fmtTime(d) {
  return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDateTime(d) {
  return d.toLocaleString("it-IT");
}

// ========================
// FETCH THINGSPEAK
// ========================

async function fetchChannelFeeds(channelId, apiKey, maxResults) {
  const url =
    `https://api.thingspeak.com/channels/${channelId}/feeds.json` +
    `?api_key=${apiKey}&results=${maxResults}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);

  const data = await res.json();
  return (data.feeds || []).map(f => ({
    time: new Date(f.created_at),
    raw: f
  }));
}

// ========================
// FILTRO TEMPORALE (CORRETTO)
// ========================

function filterByRange(feeds, hours, endTime) {
  const start = new Date(endTime.getTime() - hours * 3600 * 1000);
  return feeds.filter(f => f.time >= start && f.time <= endTime);
}

// ========================
// OROLOGIO
// ========================

function startClock() {
  const el = document.getElementById("clock-time");
  if (!el) return;
  const tick = () => el.textContent = fmtTime(new Date());
  tick();
  setInterval(tick, 1000);
}

// ========================
// RANGE BUTTONS
// ========================

function setupRangeButtons() {
  const btns = document.querySelectorAll(".btn-range");

  btns.forEach(btn => {
    const r = btn.dataset.range;
    if (r === currentRange) btn.classList.add("active");

    btn.addEventListener("click", () => {
      currentRange = r;
      currentEndTime = new Date();   // ⬅️ reset a ORA
      btns.forEach(b => b.classList.toggle("active", b.dataset.range === r));
      loadAndRender();
    });
  });
}

// ========================
// FORMATI GRAFICI
// ========================

function getXAxisFormat(range) {
  return RANGE_HOURS[range] <= 24 ? "%H:%M" : "%d/%m";
}

function getChartMargins() {
  return window.innerWidth <= 900 ? { l: 35, r: 5, t: 8, b: 18 } : { l: 55, r: 10, t: 10, b: 25 };
}

function getMarkerMode() {
  return window.innerWidth <= 900 ? "markers" : "markers+text";
}

// ========================
// LOAD & RENDER (CORE)
// ========================

async function loadAndRender() {
  const status = document.getElementById("status-bar");

  try {
    status.textContent = "Caricamento dati…";

    const maxResults =
      currentRange === "1y" ? 8000 :
      currentRange === "1m" ? 5000 :
      currentRange === "1w" ? 3000 : 2000;

    const [intFeeds, extFeeds] = await Promise.all([
      fetchChannelFeeds(INTERNAL_CHANNEL_ID, INTERNAL_READ_KEY, maxResults),
      fetchChannelFeeds(EXTERNAL_CHANNEL_ID, EXTERNAL_READ_KEY, maxResults)
    ]);

    const hours = RANGE_HOURS[currentRange];

    const intFiltered = filterByRange(intFeeds, hours, currentEndTime);
    const extFiltered = filterByRange(extFeeds, hours, currentEndTime);

    // ========================
    // PRESSIONE
    // ========================

    const pressPoints = intFiltered
      .map(f => {
        const v = parseFloat(f.raw["field" + INTERNAL_FIELDS.press]);
        return isNaN(v) ? null : { x: f.time, y: v };
      })
      .filter(Boolean);

    let minP, maxP, minPt, maxPt;
    if (pressPoints.length) {
      const ys = pressPoints.map(p => p.y);
      minP = Math.min(...ys);
      maxP = Math.max(...ys);
      minPt = pressPoints.find(p => p.y === minP);
      maxPt = pressPoints.find(p => p.y === maxP);
    }

    Plotly.newPlot("chart-press", [
      {
        x: pressPoints.map(p => p.x),
        y: pressPoints.map(p => p.y),
        mode: "lines",
        line: { color: "#00d4ff", width: 2.5 },
        fill: "tozeroy",
        fillcolor: "rgba(0,212,255,0.15)",
        showlegend: false
      },
      minPt && {
        x: [minPt.x], y: [minPt.y],
        mode: getMarkerMode(),
        marker: { color: "#ff6666", size: 8 },
        text: [minP.toFixed(1)],
        textposition: "bottom center",
        showlegend: false
      },
      maxPt && {
        x: [maxPt.x], y: [maxPt.y],
        mode: getMarkerMode(),
        marker: { color: "#66ff66", size: 8 },
        text: [maxP.toFixed(1)],
        textposition: "top center",
        showlegend: false
      }
    ].filter(Boolean), {
      margin: getChartMargins(),
      dragmode: "pan",
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { color: "#fff" },
      xaxis: { tickformat: getXAxisFormat(currentRange) },
      yaxis: { range: minP != null ? [minP - 2, maxP + 2] : undefined }
    }, { displayModeBar: false });

    // ========================
    // PAN LOGICO → NUOVO END TIME
    // ========================

    const div = document.getElementById("chart-press");
    div.removeAllListeners?.("plotly_relayout");

    div.on("plotly_relayout", ev => {
      if (!ev["xaxis.range[1]"]) return;
      const newEnd = new Date(ev["xaxis.range[1]"]);
      if (Math.abs(newEnd - currentEndTime) < 1000) return;
      currentEndTime = newEnd;
      loadAndRender();
    });

    status.textContent =
      `Range ${currentRange} | Fine: ${fmtDateTime(currentEndTime)} | Punti INT: ${intFiltered.length}`;

  } catch (e) {
    console.error(e);
    status.textContent = "Errore caricamento dati";
  }
}

// ========================
// AVVIO
// ========================

window.addEventListener("load", () => {
  startClock();
  setupRangeButtons();
  loadAndRender();
  setInterval(loadAndRender, 120000);
});
