// ========================
// ACCESSO RISERVATO
// ========================
// Le Read API Key dei canali ThingSpeak NON stanno nel codice (il sito è pubblico):
// si inseriscono una volta e restano salvate solo in questo browser.
// Ogni pagina dichiara le chiavi che le servono: <script src="accesso.js" data-chiavi="int,ext">
// Si può anche aprire una pagina con ?int=XXXX&ext=YYYY&energia=ZZZZ (le chiavi vengono salvate
// e tolte dall'indirizzo).

const ACCESSO_STORE = "meteo-read-keys";
const ACCESSO_CANALI = {
  int:     { nome: "Meteo interno",            canale: 3152991 },
  ext:     { nome: "Meteo esterno (ESP32_01)", canale: 3181129 },
  energia: { nome: "Energia",                  canale: 3489445 }
};
const ACCESSO_RICHIESTE = ((document.currentScript && document.currentScript.dataset.chiavi) || "int,ext")
  .split(",").map(s => s.trim()).filter(k => ACCESSO_CANALI[k]);

function leggiChiavi() {
  let k = {};
  try { k = JSON.parse(localStorage.getItem(ACCESSO_STORE) || "{}") || {}; } catch (e) {}
  try {
    const u = new URL(location.href);
    let cambiato = false;
    for (const id of Object.keys(ACCESSO_CANALI)) {
      const v = u.searchParams.get(id);
      if (v) { k[id] = v.trim(); u.searchParams.delete(id); cambiato = true; }
    }
    if (cambiato) {
      localStorage.setItem(ACCESSO_STORE, JSON.stringify(k));
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  } catch (e) {}
  return k;
}
const ACCESSO_CHIAVI = leggiChiavi();

function meteoKey(id) { return ACCESSO_CHIAVI[id] || ""; }

function esci() {
  try { localStorage.removeItem(ACCESSO_STORE); } catch (e) {}
  location.replace(location.pathname);
}

function chiediChiavi(msg) {
  if (document.getElementById("accesso")) return;
  const d = document.createElement("div");
  d.id = "accesso";
  d.style.cssText = "position:fixed;inset:0;background:rgba(8,10,16,.93);display:flex;align-items:center;justify-content:center;z-index:100000;padding:16px;font-family:system-ui,sans-serif";
  const campi = ACCESSO_RICHIESTE.map(id => `
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:#9aa0b0">
        ${ACCESSO_CANALI[id].nome} <span style="opacity:.7">canale ${ACCESSO_CANALI[id].canale}</span>
        <input data-id="${id}" type="password" autocomplete="off" required value="${(ACCESSO_CHIAVI[id] || "").replace(/"/g, "")}"
          placeholder="Read API Key"
          style="background:#10131c;color:#fff;border:1px solid #383f53;border-radius:7px;padding:9px 10px;font:14px ui-monospace,Menlo,Consolas,monospace">
      </label>`).join("");
  d.innerHTML = `
    <form style="background:#1b2030;border:1px solid #383f53;border-radius:12px;padding:18px;width:100%;max-width:380px;display:flex;flex-direction:column;gap:12px;color:#fff">
      <div style="font-size:18px;font-weight:700">🌤 Meteo kiosk</div>
      <div style="font-size:13px;color:#9aa0b0;line-height:1.4">${msg || "Accesso riservato. Inserisci le Read API Key dei canali ThingSpeak: restano salvate solo in questo browser."}</div>
      ${campi}
      <button type="submit" style="background:#2d8cff;border:0;color:#fff;border-radius:7px;padding:9px 12px;font-size:14px;cursor:pointer">Entra</button>
    </form>`;
  document.body.appendChild(d);
  d.querySelector("form").addEventListener("submit", ev => {
    ev.preventDefault();
    const k = Object.assign({}, ACCESSO_CHIAVI);
    d.querySelectorAll("input[data-id]").forEach(i => { k[i.dataset.id] = i.value.trim(); });
    try { localStorage.setItem(ACCESSO_STORE, JSON.stringify(k)); } catch (e) {}
    location.reload();
  });
  const primo = d.querySelector("input[data-id]");
  if (primo) primo.focus();
}

// Chiave sbagliata o rigenerata: ThingSpeak risponde con errore o con "-1" → richiedi le chiavi
const _fetchOriginale = window.fetch.bind(window);
window.fetch = async function (input, init) {
  const res = await _fetchOriginale(input, init);
  const url = String((input && input.url) || input);
  if (url.includes("api.thingspeak.com")) {
    let errata = res.status === 400 || res.status === 401 || res.status === 403;
    if (!errata && res.ok) {
      try { errata = (await res.clone().text()).trim() === "-1"; } catch (e) {}
    }
    if (errata) chiediChiavi("Una chiave non è valida (o è stata rigenerata su ThingSpeak). Controlla e premi Entra.");
  }
  return res;
};

function accessoAvvio() {
  if (ACCESSO_RICHIESTE.some(id => !ACCESSO_CHIAVI[id])) chiediChiavi();
  document.querySelectorAll("[data-esci]").forEach(b => b.addEventListener("click", esci));
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", accessoAvvio);
else accessoAvvio();
