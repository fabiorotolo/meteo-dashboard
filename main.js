// ========================
// CONFIGURAZIONE THINGSPEAK
// ========================

// Canale interno (meteo_data)
const INTERNAL_CHANNEL_ID = 3152991;         // meteo_data
const INTERNAL_READ_KEY   = "3I7MYYDZS4IKL3YJ";   // esempio, quella del canale interno

// mapping campi canale interno
const INTERNAL_FIELDS = {
  temp: 4,   // temp aria Si7021 interna
  hum: 2,    // umidità interna
  press: 3,  // pressione
  cpu: 5     // temp CPU
};

// Canale esterno (ESP32_01)
const EXTERNAL_CHANNEL_ID = 3181129;         // ESP32_01
const EXTERNAL_READ_KEY   = "7JYH3JOONPFPNQNE"; // esempio, quella del canale esterno

// mapping campi canale esterno
const EXTERNAL_FIELDS = {
  hum: 1,    // umidità esterna
  temp: 2    // temp aria esterna
};

// intervalli in ore
const RANGE_HOURS = {
  "1h": 1,
  "3h": 3,
  "6h": 6,
  "12h": 12,
  "1d": 24,
  "1w": 24 * 7,
  "1m": 24 * 30,
  "1y": 24 * 365
};

// ========================
// UTILITÀ DI BASE
// ========================

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

// chiama ThingSpeak e ritorna feeds [] con Date + fields
async function fetchChannelFeeds(channelId, apiKey, maxResults = 2000) {
  const url =
    `https://api.thingspeak.com/channels/${channelId}/feeds.json` +
    `?api_key=${apiKey}&results=${maxResults}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Errore HTTP " + res.status);
  }
  const data = await res.json();
  return (data.feeds || []).map(f => ({
    time: new Date(f.created_at),
    raw: f
  }));
}

// Filtra per intervallo in ore rispetto a "ora"
function filterByRange(feeds, hours) {
  if (!feeds.length) return [];
  const now = new Date();
  const cutoff = new Date(now.getTime() - hours * 3600 * 1000);
  return feeds.filter(f => f.time >= cutoff);
}

// ========================
// FEATURE & FORECAST LOGIC (porting da forecast.py)
// ========================

const MAX_WINDOW_HOURS = 24.0;
const P_HIGH = 1020.0;
const P_LOW = 1002.0;   // o 1000.0 se vuoi essere ancora più permissivo
const DP3_STRONG = 4.0;
const DP3_MEDIUM = 2.0;

function deltaOverWindow(tsList, values, windowHours) {
  if (!tsList.length || !values.length) return null;
  const tsLast = tsList[tsList.length - 1];
  const cutoff = new Date(tsLast.getTime() - windowHours * 3600 * 1000);

  let firstVal = null;
  let lastVal = null;

  for (let i = 0; i < tsList.length; i++) {
    const t = tsList[i];
    const v = values[i];
    if (t < cutoff) continue;
    if (v == null || Number.isNaN(v)) continue;
    if (firstVal === null) firstVal = v;
    lastVal = v;
  }
  if (firstVal === null || lastVal === null) return null;
  return lastVal - firstVal;
}

function safeLast(values) {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null && !Number.isNaN(v)) return v;
  }
  return null;
}

function computeTimeFeatures(tsNow) {
  const hour = tsNow.getHours();
  const startOfYear = new Date(tsNow.getFullYear(), 0, 1);
  const doy = Math.floor((tsNow - startOfYear) / (24 * 3600 * 1000)) + 1;

  const hourAngle = 2 * Math.PI * (hour / 24.0);
  const doyAngle = 2 * Math.PI * (doy / 365.0);

  const hourSin = Math.sin(hourAngle);
  const hourCos = Math.cos(hourAngle);
  const doySin = Math.sin(doyAngle);
  const doyCos = Math.cos(doyAngle);

  return { hour, doy, hourSin, hourCos, doySin, doyCos };
}

function buildForecastFeatures(intFiltered, extFiltered) {
  if (!intFiltered.length) return null;

  // ultimi MAX_WINDOW_HOURS di pressione
  const recentPress = filterByRange(intFiltered, MAX_WINDOW_HOURS);
  if (recentPress.length < 3) return null;

  const tsPress = recentPress.map(p => p.time);
  const pVals = recentPress.map(p => {
    const v = parseFloat(p.raw["field" + INTERNAL_FIELDS.press]);
    return Number.isFinite(v) ? v : null;
  });

  // serie esterne (umidità e temperatura)
  const recentExt = filterByRange(extFiltered, MAX_WINDOW_HOURS);
  const tsExt = recentExt.map(p => p.time);
  const uExtVals = recentExt.map(p => {
    const v = parseFloat(p.raw["field" + EXTERNAL_FIELDS.hum]);
    return Number.isFinite(v) ? v : null;
  });
  const tExtVals = recentExt.map(p => {
    const v = parseFloat(p.raw["field" + EXTERNAL_FIELDS.temp]);
    return Number.isFinite(v) ? v : null;
  });

  const tsAll = tsPress.length ? tsPress : tsExt;
  if (!tsAll.length) return null;
  const tsNow = tsAll[tsAll.length - 1];

  const pNow = safeLast(pVals);
  const uExtNow = safeLast(uExtVals);
  const tExtNow = safeLast(tExtVals);

  const dp1h = deltaOverWindow(tsPress, pVals, 1.0);
  const dp3h = deltaOverWindow(tsPress, pVals, 3.0);
  const dp6h = deltaOverWindow(tsPress, pVals, 6.0);

  const du3h = deltaOverWindow(tsExt, uExtVals, 3.0);
  const du6h = deltaOverWindow(tsExt, uExtVals, 6.0);

  const timeFeat = computeTimeFeatures(tsNow);

  return {
    tsNow,
    pNow,
    tExtNow,
    uExtNow,
    dp1h,
    dp3h,
    dp6h,
    du3h,
    du6h,
    hour: timeFeat.hour,
    doy: timeFeat.doy,
    hourSin: timeFeat.hourSin,
    hourCos: timeFeat.hourCos,
    doySin: timeFeat.doySin,
    doyCos: timeFeat.doyCos,
    nPoints: recentPress.length
  };
}

function classifyPressureLevel(pNow) {
  if (pNow == null) return "unknown";
  if (pNow >= P_HIGH) return "high";
  if (pNow <= P_LOW) return "low";
  return "normal";
}

function classifyPressureTrend(dp3h) {
  if (dp3h == null) return "unknown";
  if (dp3h <= -DP3_STRONG) return "strong_down";
  if (dp3h <= -DP3_MEDIUM) return "down";
  if (dp3h >= DP3_STRONG) return "strong_up";
  if (dp3h >= DP3_MEDIUM) return "up";
  return "stable";
}

function computeInstabilityIndex(feat) {
  let inst = 0.0;
  const list = [
    [1.0, feat.dp3h],
    [0.5, feat.dp6h],
    [0.3, feat.dp1h]
  ];
  for (const [w, dp] of list) {
    if (dp != null) inst += w * Math.abs(dp);
  }

  if (feat.uExtNow != null) {
    inst += 0.02 * Math.max(0, feat.uExtNow - 70);
  }

  const duList = [
    [0.3, feat.du3h],
    [0.5, feat.du6h]
  ];
  for (const [w, du] of duList) {
    if (du != null && du > 0) inst += w * (du / 10.0);
  }

  // modulazione stagionale (estate + instabile)
  inst *= 1.0 + 0.1 * feat.doySin;
  return inst;
}

function decideWeather(feat) {
  const level = classifyPressureLevel(feat.pNow);
  const trend = classifyPressureTrend(feat.dp3h);
  const inst = computeInstabilityIndex(feat);

  const tExt = feat.tExtNow;
  const uExt = feat.uExtNow;

  let icon = "cloud";
  let summary = "Condizioni stabili";
  let detail = "Nessuna variazione significativa prevista nelle prossime ore.";
  let iceRisk = false;

  if (feat.pNow == null) {
    if (uExt != null && uExt > 80) {
      icon = "rain";
      summary = "Possibile pioggia";
      detail = "Umidità molto elevata, possibili rovesci locali.";
    } else {
      icon = "cloud";
      summary = "Meteo incerto";
      detail = "Dati di pressione mancanti, previsione poco affidabile.";
    }
    return { icon, summary, detail, iceRisk, trend: "unknown", inst };
  }

  if (trend === "strong_up" || trend === "up") {
    if (level === "high") {
      icon = "sun";
      summary = "Miglioramento, bel tempo";
      detail = "Pressione in aumento su valori alti: cielo generalmente sereno.";
    } else {
      icon = "partly";
      summary = "Tendenza al miglioramento";
      detail = "Pressione in aumento: possibile attenuazione di nubi o precipitazioni.";
    }
  } else if (trend === "strong_down" || trend === "down") {
    if (inst > 6.0) {
      icon = "storm";
      summary = "Peggioramento deciso";
      detail =
        "Pressione in forte calo e atmosfera instabile: possibili rovesci o temporali nelle prossime ore.";
    } else {
      icon = "rain";
      summary = "Peggioramento";
      detail = "Pressione in calo: aumento di nubi e possibili precipitazioni.";
    }
  } else {
    if (level === "high") {
      icon = "sun";
      summary = "Condizioni stabili e buone";
      detail = "Pressione su valori alti e trend stabile: tempo generalmente buono.";
    } else if (level === "low") {
      if (inst > 5.0) {
        icon = "rain";
        summary = "Instabilità persistente";
        detail = "Pressione bassa e atmosfera instabile: possibili rovesci sparsi.";
      } else {
        icon = "cloud";
        summary = "Cielo coperto o variabile";
        detail =
          "Pressione bassa ma poco movimento: prevalenza di nubi, fenomeni limitati.";
      }
    } else {
      if (inst > 5.0) {
        icon = "rain";
        summary = "Instabilità moderata";
        detail =
          "Pressione nella norma ma atmosfera un po' instabile: possibili brevi rovesci locali.";
      } else {
        icon = "partly";
        summary = "Meteo per lo più stabile";
        detail =
          "Leggera variabilità ma senza segnali forti di peggioramento o miglioramento.";
      }
    }
  }

  // neve / ghiaccio
  if (tExt != null) {
    if (tExt >= -3.0 && tExt <= 1.0 && (uExt || 0) >= 80) {
      iceRisk = true;
    }

    if (tExt <= 1.0 && (icon === "rain" || icon === "storm")) {
      if (iceRisk) {
        icon = "ice";
        summary = "Neve o ghiaccio in formazione";
        detail =
          "Precipitazioni con temperature prossime allo zero: possibili nevicate e formazione di ghiaccio al suolo.";
      } else {
        icon = "snow";
        summary = "Possibili nevicate";
        detail =
          "Precipitazioni con temperature basse: possibili nevicate, specie nelle ore più fredde.";
      }
    } else if (iceRisk && (icon === "cloud" || icon === "partly" || icon === "sun")) {
      icon = "ice";
      summary = "Rischio ghiaccio / gelate";
      detail =
        "Temperature attorno allo zero e umidità elevata: possibili gelate su superfici esposte.";
    }
  }

  return { icon, summary, detail, iceRisk, trend, inst, dp3h: feat.dp3h, uExtNow: uExt };
}

function computeForecast(intFiltered, extFiltered) {
  const feat = buildForecastFeatures(intFiltered, extFiltered);
  if (!feat) return null;
  return decideWeather(feat);
}

// ========================
// GESTIONE OROLOGIO
// ========================

function startClock() {
  const el = document.getElementById("clock-time");
  if (!el) return;
  function tick() {
    el.textContent = fmtTime(new Date());
  }
  tick();
  setInterval(tick, 1000);
}

// ========================
// GESTIONE RANGE BUTTONS
// ========================
let currentRange = "1d";

function setupRangeButtons() {
  const btns = document.querySelectorAll(".btn-range");
  btns.forEach(btn => {
    const r = btn.dataset.range;
    if (r === currentRange) btn.classList.add("active");
    btn.addEventListener("click", () => {
      currentRange = r;
      btns.forEach(b => b.classList.toggle("active", b.dataset.range === r));
      loadAndRender();
    });
  });
}

// Determina il formato dell'asse X in base all'intervallo
function getXAxisFormat(range) {
  const hours = RANGE_HOURS[range] || 24;
  
  // Per intervalli brevi (< 1 giorno): mostra solo l'ora
  if (hours <= 24) {
    return "%H:%M";
  }
  // Per intervalli lunghi (>= 1 settimana): mostra solo la data
  else {
    return "%d/%m";
  }
}

// Determina i margini del grafico in base alla risoluzione
function getChartMargins() {
  const isSmallScreen = window.innerHeight <= 600 && window.innerWidth <= 900;
  if (isSmallScreen) {
    // Margini ridotti per 800x480 - meno spazio necessario senza testo marker
    return { l: 35, r: 5, t: 8, b: 18 };
  }
  // Margini normali per schermi grandi
  return { l: 55, r: 10, t: 10, b: 25 };
}

// Determina la dimensione del font dei marker in base alla risoluzione
function getMarkerFontSize() {
  const isSmallScreen = window.innerHeight <= 600 && window.innerWidth <= 900;
  return isSmallScreen ? 7 : 13; // 7px su 800x480 per stare dentro
}

function getMarkerFontSizeSmall() {
  const isSmallScreen = window.innerHeight <= 600 && window.innerWidth <= 900;
  return isSmallScreen ? 7 : 12; // Per grafici temp/umidità
}

// Determina il mode del marker (con o senza testo)
function getMarkerMode() {
  const isSmallScreen = window.innerHeight <= 600 && window.innerWidth <= 900;
  return isSmallScreen ? "markers" : "markers+text"; // Solo pallini su 800x480
}

// ========================
// RENDER GRAFICI
// ========================

async function loadAndRender() {
  const status = document.getElementById("status-bar");
  try {
    status.textContent = "Caricamento dati da ThingSpeak…";

    const maxResults = currentRange === "1y" ? 8000 : 
                       currentRange === "1m" ? 5000 : 
                       currentRange === "1w" ? 3000 : 2000;

    const [intFeeds, extFeeds] = await Promise.all([
      fetchChannelFeeds(INTERNAL_CHANNEL_ID, INTERNAL_READ_KEY, maxResults),
      fetchChannelFeeds(EXTERNAL_CHANNEL_ID, EXTERNAL_READ_KEY, maxResults)
    ]);

    const hours = RANGE_HOURS[currentRange] || 24;

    const intFiltered = filterByRange(intFeeds, hours);
    const extFiltered = filterByRange(extFeeds, hours);

    // === STATISTICHE IN ALTO ===
    if (intFiltered.length) {
      const lastInt = intFiltered[intFiltered.length - 1].raw;
      const lastTime = new Date(lastInt.created_at);

      const tempInt = parseFloat(lastInt["field" + INTERNAL_FIELDS.temp]);
      const humInt = parseFloat(lastInt["field" + INTERNAL_FIELDS.hum]);
      const pressInt = parseFloat(lastInt["field" + INTERNAL_FIELDS.press]);
      const cpu = parseFloat(lastInt["field" + INTERNAL_FIELDS.cpu]);

      if (!isNaN(tempInt)) {
        const el = document.getElementById("stat-temp-int");
        el.innerHTML = tempInt.toFixed(2) + ' <span class="unit-small">°C</span>';
      }
      if (!isNaN(humInt)) document.getElementById("debug-rh").textContent = humInt.toFixed(1) + " %";
      if (!isNaN(pressInt)) {
        const el = document.getElementById("stat-press");
        el.innerHTML = pressInt.toFixed(1) + ' <span class="unit-small">hPa</span>';
      }
      if (!isNaN(cpu)) document.getElementById("stat-temp-cpu").textContent = cpu.toFixed(1) + " °C";

      document.getElementById("stat-last-ts").textContent = fmtDateTime(lastTime);
    }

    if (extFiltered.length) {
      const lastExt = extFiltered[extFiltered.length - 1].raw;
      const tempExt = parseFloat(lastExt["field" + EXTERNAL_FIELDS.temp]);
      const humExt = parseFloat(lastExt["field" + EXTERNAL_FIELDS.hum]);

      if (!isNaN(tempExt)) {
        const el = document.getElementById("stat-temp-ext");
        el.innerHTML = tempExt.toFixed(2) + ' <span class="unit-small">°C</span>';
      }
      if (!isNaN(humExt)) {
        const el = document.getElementById("stat-hum-ext");
        el.innerHTML = humExt.toFixed(1) + ' <span class="unit-small">%</span>';
      }
    }

    // === GRAFICO PRESSIONE (solo canale interno) ===
    const pressPoints = intFiltered
      .map(f => {
        const v = parseFloat(f.raw["field" + INTERNAL_FIELDS.press]);
        return isNaN(v) ? null : { x: f.time, y: v };
      })
      .filter(Boolean);

    // Calcola min/max pressione e trova i punti esatti
    let minPress, maxPress, minPressPoint, maxPressPoint;
    if (pressPoints.length > 0) {
      const pressValues = pressPoints.map(p => p.y);
      minPress = Math.min(...pressValues);
      maxPress = Math.max(...pressValues);
      
      // Trova i punti esatti dove si verificano min e max
      minPressPoint = pressPoints.find(p => p.y === minPress);
      maxPressPoint = pressPoints.find(p => p.y === maxPress);
      
      document.getElementById("press-minmax").textContent = 
        `min: ${minPress.toFixed(1)} hPa | max: ${maxPress.toFixed(1)} hPa`;
    } else {
      document.getElementById("press-minmax").textContent = "--";
    }

    const pressTrace = {
      x: pressPoints.map(p => p.x),
      y: pressPoints.map(p => p.y),
      mode: "lines",
      line: { width: 2, color: "#ffffff" },
      showlegend: false
    };

    // Trace per i marker min/max
    const pressTraces = [pressTrace];
    const pressAnnotations = [];
    
    if (minPressPoint) {
      pressTraces.push({
        x: [minPressPoint.x],
        y: [minPressPoint.y],
        mode: getMarkerMode(),
        marker: { size: 10, color: "#66aaff", symbol: "circle" },
        text: [minPress.toFixed(1)],
        textposition: "bottom center",
        textfont: { color: "#ffffff", size: getMarkerFontSize(), family: "system-ui", weight: "bold" },
        showlegend: false,
        hoverinfo: "skip"
      });
    }
    
    if (maxPressPoint) {
      pressTraces.push({
        x: [maxPressPoint.x],
        y: [maxPressPoint.y],
        mode: getMarkerMode(),
        marker: { size: 10, color: "#ff6666", symbol: "circle" },
        text: [maxPress.toFixed(1)],
        textposition: "top center",
        textfont: { color: "#ffffff", size: getMarkerFontSize(), family: "system-ui", weight: "bold" },
        showlegend: false,
        hoverinfo: "skip"
      });
    }

    Plotly.newPlot("chart-press", pressTraces, {
      margin: getChartMargins(),
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
        title: { text: "hPa", font: { color: "#ffffff" } }
      }
    }, { displayModeBar: false });

    // === GRAFICO TEMPERATURA INT/EXT ===
    const tempIntPoints = intFiltered
      .map(f => {
        const v = parseFloat(f.raw["field" + INTERNAL_FIELDS.temp]);
        return isNaN(v) ? null : { x: f.time, y: v };
      })
      .filter(Boolean);

    const tempExtPoints = extFiltered
      .map(f => {
        const v = parseFloat(f.raw["field" + EXTERNAL_FIELDS.temp]);
        return isNaN(v) ? null : { x: f.time, y: v };
      })
      .filter(Boolean);

    // Calcola min/max temperatura e trova i punti esatti
    let tempMinMaxText = "";
    let minTempInt, maxTempInt, minTempExt, maxTempExt;
    let minTempIntPoint, maxTempIntPoint, minTempExtPoint, maxTempExtPoint;
    
    if (tempIntPoints.length > 0) {
      const tempIntValues = tempIntPoints.map(p => p.y);
      minTempInt = Math.min(...tempIntValues);
      maxTempInt = Math.max(...tempIntValues);
      minTempIntPoint = tempIntPoints.find(p => p.y === minTempInt);
      maxTempIntPoint = tempIntPoints.find(p => p.y === maxTempInt);
      tempMinMaxText += `INT: ${minTempInt.toFixed(1)}-${maxTempInt.toFixed(1)}°C`;
    }
    if (tempExtPoints.length > 0) {
      const tempExtValues = tempExtPoints.map(p => p.y);
      minTempExt = Math.min(...tempExtValues);
      maxTempExt = Math.max(...tempExtValues);
      minTempExtPoint = tempExtPoints.find(p => p.y === minTempExt);
      maxTempExtPoint = tempExtPoints.find(p => p.y === maxTempExt);
      if (tempMinMaxText) tempMinMaxText += " | ";
      tempMinMaxText += `EXT: ${minTempExt.toFixed(1)}-${maxTempExt.toFixed(1)}°C`;
    }
    document.getElementById("temp-minmax").textContent = tempMinMaxText || "--";

    const tempIntTrace = {
      x: tempIntPoints.map(p => p.x),
      y: tempIntPoints.map(p => p.y),
      mode: "lines",
      name: "Temp INT",
      line: { width: 2, color: "#ff6666" }
    };

    const tempExtTrace = {
      x: tempExtPoints.map(p => p.x),
      y: tempExtPoints.map(p => p.y),
      mode: "lines",
      name: "Temp EXT",
      line: { width: 2, color: "#66aaff" }
    };

    const tempTraces = [tempIntTrace, tempExtTrace];
    
    // Marker per temperatura INTERNA
    if (minTempIntPoint) {
      tempTraces.push({
        x: [minTempIntPoint.x],
        y: [minTempIntPoint.y],
        mode: getMarkerMode(),
        marker: { size: 8, color: "#ff6666", symbol: "circle" },
        text: [minTempInt.toFixed(1)],
        textposition: "bottom center",
        textfont: { color: "#ffffff", size: getMarkerFontSizeSmall(), weight: "bold" },
        showlegend: false,
        hoverinfo: "skip"
      });
    }
    if (maxTempIntPoint) {
      tempTraces.push({
        x: [maxTempIntPoint.x],
        y: [maxTempIntPoint.y],
        mode: getMarkerMode(),
        marker: { size: 8, color: "#ff6666", symbol: "circle" },
        text: [maxTempInt.toFixed(1)],
        textposition: "top center",
        textfont: { color: "#ffffff", size: getMarkerFontSizeSmall(), weight: "bold" },
        showlegend: false,
        hoverinfo: "skip"
      });
    }
    
    // Marker per temperatura ESTERNA
    if (minTempExtPoint) {
      tempTraces.push({
        x: [minTempExtPoint.x],
        y: [minTempExtPoint.y],
        mode: getMarkerMode(),
        marker: { size: 8, color: "#66aaff", symbol: "circle" },
        text: [minTempExt.toFixed(1)],
        textposition: "bottom center",
        textfont: { color: "#ffffff", size: getMarkerFontSizeSmall(), weight: "bold" },
        showlegend: false,
        hoverinfo: "skip"
      });
    }
    if (maxTempExtPoint) {
      tempTraces.push({
        x: [maxTempExtPoint.x],
        y: [maxTempExtPoint.y],
        mode: getMarkerMode(),
        marker: { size: 8, color: "#66aaff", symbol: "circle" },
        text: [maxTempExt.toFixed(1)],
        textposition: "top center",
        textfont: { color: "#ffffff", size: getMarkerFontSizeSmall(), weight: "bold" },
        showlegend: false,
        hoverinfo: "skip"
      });
    }

    Plotly.newPlot("chart-temp", tempTraces, {
      margin: getChartMargins(),
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
        title: { text: "°C", font: { color: "#ffffff" } }
      },
      legend: { orientation: "h", y: 1.15 }
    }, { displayModeBar: false });

    // === GRAFICO UMIDITÀ INT/EXT ===
    const humIntPoints = intFiltered
      .map(f => {
        const v = parseFloat(f.raw["field" + INTERNAL_FIELDS.hum]);
        return isNaN(v) ? null : { x: f.time, y: v };
      })
      .filter(Boolean);

    const humExtPoints = extFiltered
      .map(f => {
        const v = parseFloat(f.raw["field" + EXTERNAL_FIELDS.hum]);
        return isNaN(v) ? null : { x: f.time, y: v };
      })
      .filter(Boolean);

    // Calcola min/max umidità e trova i punti esatti
    let humMinMaxText = "";
    let minHumInt, maxHumInt, minHumExt, maxHumExt;
    let minHumIntPoint, maxHumIntPoint, minHumExtPoint, maxHumExtPoint;
    
    if (humIntPoints.length > 0) {
      const humIntValues = humIntPoints.map(p => p.y);
      minHumInt = Math.min(...humIntValues);
      maxHumInt = Math.max(...humIntValues);
      minHumIntPoint = humIntPoints.find(p => p.y === minHumInt);
      maxHumIntPoint = humIntPoints.find(p => p.y === maxHumInt);
      humMinMaxText += `INT: ${minHumInt.toFixed(0)}-${maxHumInt.toFixed(0)}%`;
    }
    if (humExtPoints.length > 0) {
      const humExtValues = humExtPoints.map(p => p.y);
      minHumExt = Math.min(...humExtValues);
      maxHumExt = Math.max(...humExtValues);
      minHumExtPoint = humExtPoints.find(p => p.y === minHumExt);
      maxHumExtPoint = humExtPoints.find(p => p.y === maxHumExt);
      if (humMinMaxText) humMinMaxText += " | ";
      humMinMaxText += `EXT: ${minHumExt.toFixed(0)}-${maxHumExt.toFixed(0)}%`;
    }
    document.getElementById("hum-minmax").textContent = humMinMaxText || "--";

    const humIntTrace = {
      x: humIntPoints.map(p => p.x),
      y: humIntPoints.map(p => p.y),
      mode: "lines",
      name: "UR INT",
      line: { width: 2, color: "#ff6666" }
    };

    const humExtTrace = {
      x: humExtPoints.map(p => p.x),
      y: humExtPoints.map(p => p.y),
      mode: "lines",
      name: "UR EXT",
      line: { width: 2, color: "#66aaff" }
    };

    const humTraces = [humIntTrace, humExtTrace];
    
    // Marker per umidità INTERNA
    if (minHumIntPoint) {
      humTraces.push({
        x: [minHumIntPoint.x],
        y: [minHumIntPoint.y],
        mode: getMarkerMode(),
        marker: { size: 8, color: "#ff6666", symbol: "circle" },
        text: [minHumInt.toFixed(0)],
        textposition: "bottom center",
        textfont: { color: "#ffffff", size: getMarkerFontSizeSmall(), weight: "bold" },
        showlegend: false,
        hoverinfo: "skip"
      });
    }
    if (maxHumIntPoint) {
      humTraces.push({
        x: [maxHumIntPoint.x],
        y: [maxHumIntPoint.y],
        mode: getMarkerMode(),
        marker: { size: 8, color: "#ff6666", symbol: "circle" },
        text: [maxHumInt.toFixed(0)],
        textposition: "top center",
        textfont: { color: "#ffffff", size: getMarkerFontSizeSmall(), weight: "bold" },
        showlegend: false,
        hoverinfo: "skip"
      });
    }
    
    // Marker per umidità ESTERNA
    if (minHumExtPoint) {
      humTraces.push({
        x: [minHumExtPoint.x],
        y: [minHumExtPoint.y],
        mode: getMarkerMode(),
        marker: { size: 8, color: "#66aaff", symbol: "circle" },
        text: [minHumExt.toFixed(0)],
        textposition: "bottom center",
        textfont: { color: "#ffffff", size: getMarkerFontSizeSmall(), weight: "bold" },
        showlegend: false,
        hoverinfo: "skip"
      });
    }
    if (maxHumExtPoint) {
      humTraces.push({
        x: [maxHumExtPoint.x],
        y: [maxHumExtPoint.y],
        mode: getMarkerMode(),
        marker: { size: 8, color: "#66aaff", symbol: "circle" },
        text: [maxHumExt.toFixed(0)],
        textposition: "top center",
        textfont: { color: "#ffffff", size: getMarkerFontSizeSmall(), weight: "bold" },
        showlegend: false,
        hoverinfo: "skip"
      });
    }

    Plotly.newPlot("chart-hum", humTraces, {
      margin: getChartMargins(),
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
        title: { text: "%", font: { color: "#ffffff" } }
      },
      legend: { orientation: "h", y: 1.15 }
    }, { displayModeBar: false });

    // === PREVISIONE METEO AVANZATA ===
    const forecast = computeForecast(intFiltered, extFiltered);
    let forecastText = "Dati insufficienti per la tendenza.";
    let dp3hTxt = "n/d";

    if (forecast) {
      forecastText = `<strong>${forecast.summary}</strong><br><span style="font-size:12px">${forecast.detail}</span>`;
      if (forecast.dp3h != null) {
        dp3hTxt = forecast.dp3h.toFixed(1) + " hPa";
      }

      const iconMap = {
        sun: "☀️",
        partly: "⛅",
        cloud: "☁️",
        rain: "🌧️",
        snow: "❄️",
        storm: "⛈️",
        ice: "🧊"
      };
      const iconEl = document.getElementById("forecast-icon");
      if (iconEl) {
        iconEl.textContent = iconMap[forecast.icon] || "ℹ️";
      }

      if (forecast.uExtNow != null) {
        document.getElementById("debug-rh").textContent = forecast.uExtNow.toFixed(1) + " %";
      }
      document.getElementById("debug-thresh").textContent =
        `DP3 medium=${DP3_MEDIUM} hPa, strong=${DP3_STRONG} hPa`;
    }

    document.getElementById("forecast-text").innerHTML = forecastText;
    document.getElementById("debug-dp3h").textContent = dp3hTxt;

    status.textContent =
      `Intervallo: ${currentRange} – punti INT: ${intFiltered.length}, EXT: ${extFiltered.length}`;
  } catch (err) {
    console.error(err);
    status.textContent = "Errore nel caricamento ThingSpeak.";
  }
}

// ========================
// DATI ASTRONOMICI (FASE LUNARE E POSIZIONE SOLE)
// ========================

// Coordinate Pescara
const LAT = 42.120333;
const LON = 14.401111;

// Calcola la fase lunare usando l'algoritmo astronomico
function calculateMoonPhase(date = new Date()) {
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  const day = date.getDate();
  
  // Algoritmo per calcolare i giorni dalla luna nuova (0-29.53)
  let c, e, jd, b;
  
  if (month < 3) {
    year--;
    month += 12;
  }
  
  ++month;
  c = 365.25 * year;
  e = 30.6 * month;
  jd = c + e + day - 694039.09;
  jd /= 29.5305882;
  b = parseInt(jd);
  jd -= b;
  b = Math.round(jd * 8);
  
  if (b >= 8) b = 0;
  
  const phase = b;
  const illumination = jd;
  
  // Calcola la percentuale di illuminazione (0-100%)
  const illumPercent = Math.round((1 - Math.cos(illumination * 2 * Math.PI)) * 50);
  
  // Nomi delle fasi in italiano
  const phaseNames = [
    "Nuova",
    "Crescente",
    "Primo quarto",
    "Gibbosa crescente",
    "Piena",
    "Gibbosa calante",
    "Ultimo quarto",
    "Calante"
  ];
  
  // Emoji per le fasi lunari
  const moonEmojis = [
    "🌑", // Nuova
    "🌒", // Crescente
    "🌓", // Primo quarto
    "🌔", // Gibbosa crescente
    "🌕", // Piena
    "🌖", // Gibbosa calante
    "🌗", // Ultimo quarto
    "🌘"  // Calante
  ];
  
  console.log("Calcolo fase lunare - year:", year, "month:", month, "day:", day, "phase:", phase, "illumination:", illumPercent);
  
  return {
    phase: phaseNames[phase],
    illumination: illumPercent,
    emoji: moonEmojis[phase]
  };
}

// Carica dati del sole da API sunrise-sunset.org
async function loadSunData() {
  try {
    // Formatta la data correttamente (YYYY-MM-DD)
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    const url = `https://api.sunrise-sunset.org/json?lat=${LAT}&lng=${LON}&formatted=0&date=${dateStr}`;
    console.log("Chiamata API sole:", url);
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log("Risposta API sole:", data);
    
    if (data.status === "OK") {
      const sunrise = new Date(data.results.sunrise);
      const sunset = new Date(data.results.sunset);
      const now = new Date();
      
      console.log("Alba:", sunrise.toLocaleString());
      console.log("Tramonto:", sunset.toLocaleString());
      
      // Calcola la progressione del sole (0 = alba, 1 = tramonto)
      let progress = 0;
      if (now >= sunrise && now <= sunset) {
        const totalDaylight = sunset - sunrise;
        const elapsed = now - sunrise;
        progress = elapsed / totalDaylight;
      } else if (now > sunset) {
        progress = 1;
      }
      
      return {
        sunrise,
        sunset,
        progress: Math.max(0, Math.min(1, progress))
      };
    } else {
      console.error("API sole ha risposto con status:", data.status);
    }
  } catch (error) {
    console.error("Errore nel caricamento dati sole:", error);
  }
  
  // Valori di fallback realistici per Pescara
  const now = new Date();
  const fallbackSunrise = new Date(now);
  fallbackSunrise.setHours(7, 0, 0, 0);
  const fallbackSunset = new Date(now);
  fallbackSunset.setHours(17, 0, 0, 0);
  
  let progress = 0.5;
  if (now >= fallbackSunrise && now <= fallbackSunset) {
    const totalDaylight = fallbackSunset - fallbackSunrise;
    const elapsed = now - fallbackSunrise;
    progress = elapsed / totalDaylight;
  } else if (now > fallbackSunset) {
    progress = 1;
  }
  
  console.warn("Uso valori di fallback per alba/tramonto");
  
  return {
    sunrise: fallbackSunrise,
    sunset: fallbackSunset,
    progress: Math.max(0, Math.min(1, progress))
  };
}

// Aggiorna la visualizzazione dei dati astronomici
async function updateAstroData() {
  console.log("=== Aggiornamento dati astronomici ===");
  
  try {
    // Fase lunare
    const moon = calculateMoonPhase();
    console.log("Fase lunare:", moon);
    
    const moonIconEl = document.getElementById("moon-icon");
    const moonPhaseEl = document.getElementById("moon-phase");
    const moonIllumEl = document.getElementById("moon-illumination");
    
    if (moonIconEl) {
      moonIconEl.textContent = moon.emoji;
      console.log("✓ Moon icon impostato:", moon.emoji);
    } else {
      console.error("✗ Elemento moon-icon non trovato!");
    }
    
    if (moonPhaseEl) {
      moonPhaseEl.textContent = moon.phase;
      console.log("✓ Moon phase impostato:", moon.phase);
    } else {
      console.error("✗ Elemento moon-phase non trovato!");
    }
    
    if (moonIllumEl) {
      moonIllumEl.textContent = `Illuminazione: ${moon.illumination}%`;
      console.log("✓ Moon illumination impostato:", moon.illumination + "%");
    } else {
      console.error("✗ Elemento moon-illumination non trovato!");
    }
    
    console.log("✓ Fase lunare aggiornata");
  } catch (error) {
    console.error("Errore aggiornamento fase lunare:", error);
  }
  
  try {
    // Posizione del sole
    const sun = await loadSunData();
    console.log("Dati sole ricevuti:", sun);
    
    const sunriseStr = sun.sunrise.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const sunsetStr = sun.sunset.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    
    console.log("Alba formattata:", sunriseStr);
    console.log("Tramonto formattato:", sunsetStr);
    console.log("Progresso sole:", sun.progress);
    
    const sunriseEl = document.getElementById("sunrise-time");
    const sunsetEl = document.getElementById("sunset-time");
    const sunIndicatorEl = document.getElementById("sun-indicator");
    
    if (sunriseEl) sunriseEl.textContent = sunriseStr;
    if (sunsetEl) sunsetEl.textContent = sunsetStr;
    
    // Posiziona l'indicatore del sole sull'arcobaleno seguendo la curva
    if (sunIndicatorEl) {
      const progress = sun.progress; // 0..1
      
      // Calcola la posizione X (orizzontale) - 0% a sinistra, 100% a destra
      const leftPercent = progress * 100;
      
      // Calcola la posizione Y (verticale) seguendo un arco sinusoidale
      // L'arco parte da 0 (alba), sale fino a 50px (mezzogiorno), scende a 0 (tramonto)
      const arcHeight = 50; // altezza massima dell'arco in px
      const yPosition = Math.sin(progress * Math.PI) * arcHeight;
      
      sunIndicatorEl.style.left = leftPercent + "%";
      sunIndicatorEl.style.bottom = yPosition + "px";
      
      console.log("Indicatore sole posizionato al", leftPercent + "% (bottom: " + yPosition + "px)");
    }
    
    console.log("✓ Dati sole aggiornati");
  } catch (error) {
    console.error("Errore aggiornamento dati sole:", error);
  }
  
  console.log("=== Fine aggiornamento dati astronomici ===");
}

// ========================
// AVVIO
// ========================

window.addEventListener("load", () => {
  startClock();
  setupRangeButtons();
  loadAndRender();
  updateAstroData();

  // refresh periodico (es. ogni 2 minuti)
  setInterval(loadAndRender, 120000);
  // aggiorna dati astronomici ogni 10 minuti
  setInterval(updateAstroData, 600000);
});

// --- Ricarica pagina quando il device ruota --- //
window.addEventListener("orientationchange", () => {
  document.body.style.opacity = "0";
  setTimeout(() => {
    location.reload();
  }, 200);
});

