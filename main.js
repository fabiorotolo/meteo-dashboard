async function updateAstroData() {
  try {
    const moon = calculateMoonPhase();
    
    const moonIconEl = document.getElementById("moon-icon");
    const moonPhaseEl = document.getElementById("moon-phase");
    const moonIllumEl = document.getElementById("moon-illumination");
    
    if (moonIconEl) moonIconEl.textContent = moon.emoji;
    if (moonPhaseEl) moonPhaseEl.textContent = moon.phase;
    if (moonIllumEl) moonIllumEl.textContent = `Illuminazione: ${moon.illumination}%`;
  } catch (error) {
    console.error("Errore aggiornamento fase lunare:", error);
  }
  
  // SOLE CON OPACITÀ DINAMICA
  try {
    const sun = await loadSunData();
    
    const sunriseStr = sun.sunrise.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    const sunsetStr = sun.sunset.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    
    const sunriseEl = document.getElementById("sunrise-time");
    const sunsetEl = document.getElementById("sunset-time");
    const sunIndicatorEl = document.getElementById("sun-indicator");
    
    if (sunriseEl) sunriseEl.textContent = sunriseStr;
    if (sunsetEl) sunsetEl.textContent = sunsetStr;
    
    if (sunIndicatorEl) {
      const progress = sun.progress;
      const leftPercent = progress * 100;
      const arcHeight = 50;
      const yPosition = Math.sin(progress * Math.PI) * arcHeight;
      const yOffset = 8; // Sole più alto
      
      sunIndicatorEl.style.left = leftPercent + "%";
      sunIndicatorEl.style.bottom = (yPosition + yOffset) + "px";
      
      // 🆕 OPACITÀ DINAMICA: trasparente se non visibile
      const now = new Date();
      if (now < sun.sunrise || now > sun.sunset) {
        sunIndicatorEl.style.opacity = "0.2";  // Trasparente (non visibile)
      } else {
        sunIndicatorEl.style.opacity = "1";    // Opaco (visibile)
      }
    }
  } catch (error) {
    console.error("Errore aggiornamento dati sole:", error);
  }
  
  // LUNA CON OPACITÀ DINAMICA E -1d / +1d
  try {
    const moonData = await loadMoonData();
    
    const moonriseEl = document.getElementById("moonrise-time");
    const moonsetEl = document.getElementById("moonset-time");
    const moonIndicatorEl = document.getElementById("moon-indicator");
    
    // 🆕 Moonrise con -1d se era ieri
    if (moonriseEl) {
      let moonriseText = "--:--";
      
      if (moonData.moonrise) {
        const timeStr = moonData.moonrise.toLocaleTimeString("it-IT", { 
          hour: "2-digit", 
          minute: "2-digit" 
        });
        
        // Aggiungi -1d se era ieri
        moonriseText = moonData.moonriseWasYesterday 
          ? `-1d ${timeStr}` 
          : timeStr;
      }
      
      moonriseEl.textContent = moonriseText;
    }
    
    // 🆕 Moonset con +1d se è domani
    if (moonsetEl) {
      let moonsetText = "--:--";
      
      if (moonData.moonset) {
        const timeStr = moonData.moonset.toLocaleTimeString("it-IT", { 
          hour: "2-digit", 
          minute: "2-digit" 
        });
        
        // Aggiungi +1d se è domani
        moonsetText = moonData.moonsetIsNextDay 
          ? `+1d ${timeStr}` 
          : timeStr;
      }
      
      moonsetEl.textContent = moonsetText;
    }
    
    if (moonIndicatorEl) {
      const progress = moonData.progress;
      const leftPercent = progress * 100;
      const arcHeight = 50;
      const yPosition = Math.sin(progress * Math.PI) * arcHeight;
      const yOffset = -6; // Luna più bassa
      
      moonIndicatorEl.style.left = leftPercent + "%";
      moonIndicatorEl.style.bottom = (yPosition + yOffset) + "px";
      
      // 🆕 OPACITÀ DINAMICA: trasparente se non visibile
      const now = new Date();
      if (moonData.moonrise && moonData.moonset) {
        if (now < moonData.moonrise || now > moonData.moonset) {
          moonIndicatorEl.style.opacity = "0.2";  // Trasparente (non visibile)
        } else {
          moonIndicatorEl.style.opacity = "1";    // Opaco (visibile)
        }
      } else {
        // Fallback: usa progress (0-1 = visibile)
        moonIndicatorEl.style.opacity = (progress >= 0 && progress <= 1) ? "1" : "0.2";
      }
    }
  } catch (error) {
    console.error("Errore aggiornamento dati luna:", error);
  }
}
