// ========================
// ACCESSO RISERVATO
// ========================
// Le Read API Key ThingSpeak non stanno nel codice in chiaro: sono cifrate in chiavi-cifrate.js
// e si sbloccano con la password delle dashboard (cassaforte.js), una volta per dispositivo.
// È la stessa password di barca-dashboard (da inserire una volta anche lì).
// Ogni pagina dichiara le chiavi che le servono: <script src="accesso.js" data-chiavi="int,ext">

const ACCESSO_RICHIESTE = ((document.currentScript && document.currentScript.dataset.chiavi) || "int,ext")
  .split(",").map(s => s.trim()).filter(Boolean);

function leggiChiavi() {
  try { return JSON.parse(localStorage.getItem(CASSAFORTE_METEO) || "{}") || {}; } catch (e) { return {}; }
}
const ACCESSO_CHIAVI = leggiChiavi();

function meteoKey(id) { return ACCESSO_CHIAVI[id] || ""; }

// Chiave sbagliata o rigenerata: ThingSpeak risponde con errore o con "-1" → richiedi la password
const _fetchOriginale = window.fetch.bind(window);
window.fetch = async function (input, init) {
  const res = await _fetchOriginale(input, init);
  const url = String((input && input.url) || input);
  if (url.includes("api.thingspeak.com") && ACCESSO_RICHIESTE.every(id => ACCESSO_CHIAVI[id])) {
    let errata = res.status === 400 || res.status === 401 || res.status === 403;
    if (!errata && res.ok) {
      try { errata = (await res.clone().text()).trim() === "-1"; } catch (e) {}
    }
    if (errata) {
      try { localStorage.removeItem(CASSAFORTE_METEO); } catch (e) {}
      cassaforteForm("Una chiave ThingSpeak salvata non funziona più (rigenerata?). Inserisci la password; se il problema resta, aggiorna chiavi-cifrate.js con cifra-chiavi.html.");
    }
  }
  return res;
};

function accessoAvvio() {
  if (ACCESSO_RICHIESTE.some(id => !ACCESSO_CHIAVI[id])) cassaforteForm();
  document.querySelectorAll("[data-esci]").forEach(b => b.addEventListener("click", cassaforteEsci));
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", accessoAvvio);
else accessoAvvio();
