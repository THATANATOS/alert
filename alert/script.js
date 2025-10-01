/* ================================
   Full updated script.js
   - USGS (map, list, stats, major) — filtered for Philippines
   - Auto-refresh (single unified cycle)
   - Fixed auto-refresh & countdown logic
================================= */

'use strict';

/* ---------------------------
   DOM elements & constants
   --------------------------- */
const quakeListEl = document.getElementById('quakeList');
const lastUpdatedEl = document.getElementById('lastUpdated');
const timeRangeSel = document.getElementById('timeRange');
const refreshBtn = document.getElementById('refreshBtn');
const toastContainer = document.getElementById('toastContainer');

const mhContent = document.getElementById('mhContent');
const mhUpdated = document.getElementById('mhUpdated');

const refreshSecondsInput = document.getElementById('refreshSeconds');
const toggleAutoBtn = document.getElementById('toggleAuto');
const countdownEl = document.getElementById('countdown');

const statDailyCountEl = document.getElementById('statDailyCount');
const statWeeklyCountEl = document.getElementById('statWeeklyCount');
const statLargest24hEl = document.getElementById('statLargest24h');
const weekChartCanvasEl = document.getElementById('weekChart');
const weekChartCanvas = weekChartCanvasEl ? weekChartCanvasEl.getContext('2d') : null;

/* Philippines bounding box */
const PH_BBOX = {
  minlatitude: 4.5,
  maxlatitude: 21.0,
  minlongitude: 116.0,
  maxlongitude: 127.0
};

/* ----------------------------
   Map (Leaflet)
   ---------------------------- */
const map = L.map('map', { preferCanvas: true }).setView([12.8797, 121.7740], 5);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OSM contributors & Carto',
  subdomains: 'abcd',
  maxZoom: 19
}).addTo(map);

let quakeLayer = L.layerGroup().addTo(map);
let seenQuakes = new Set();

/* ----------------------------
   Auto-refresh state
   ---------------------------- */
let autoInterval = Math.max(5000, Number(refreshSecondsInput?.value ?? 30) * 1000);
let autoTimerId = null;
let countdownTimerId = null;
let countdownRemaining = Math.floor(autoInterval / 1000);
let autoEnabled = true;

/* ----------------------------
   Chart state
   ---------------------------- */
let weekChart = null;

/* ----------------------------
   Helpers
   ---------------------------- */
function buildUSGSUrl({ startTimeISO = null, endTimeISO = null, orderby = 'time', limit = 200, minmag = null, bbox = PH_BBOX } = {}) {
  const base = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
  const params = new URLSearchParams({
    format: 'geojson',
    orderby,
    limit: String(limit),
    minlatitude: String(bbox.minlatitude),
    maxlatitude: String(bbox.maxlatitude),
    minlongitude: String(bbox.minlongitude),
    maxlongitude: String(bbox.maxlongitude)
  });
  if (startTimeISO) params.set('starttime', startTimeISO);
  if (endTimeISO) params.set('endtime', endTimeISO);
  if (minmag !== null) params.set('minmagnitude', String(minmag));
  return `${base}?${params.toString()}`;
}

function niceTime(unixMs) {
  try { return new Date(unixMs).toLocaleString(); } catch { return String(unixMs); }
}
function magClass(m) {
  if (m >= 5) return 'high';
  if (m >= 4) return 'mid';
  return 'low';
}
function magColor(m) {
  if (m >= 6) return '#d32f2f';
  if (m >= 5) return '#ff5c5c';
  if (m >= 4) return '#ffb86b';
  return '#64ffda';
}
function showToast(msg, duration = 5000) {
  if (!toastContainer) return;
  const div = document.createElement('div');
  div.className = 'toast';
  div.innerHTML = msg;
  toastContainer.appendChild(div);
  setTimeout(() => div.remove(), duration);
}
function focusMap(lat, lon, zoom = 7) {
  map.setView([lat, lon], zoom, { animate: true, duration: 0.9 });
}

/* ----------------------------
   USGS: fetch & render list + map
   ---------------------------- */
async function fetchQuakesAndRender() {
  const daysBack = Number(timeRangeSel?.value ?? 7);
  const url = buildUSGSUrl({
    startTimeISO: new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString(),
    orderby: 'time',
    limit: 500,
    bbox: PH_BBOX
  });

  if (quakeListEl) quakeListEl.innerHTML = '<p style="color:var(--muted);padding:8px">Loading…</p>';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Network response not ok');
    const data = await res.json();

    if (lastUpdatedEl) lastUpdatedEl.textContent = 'Updated: ' + new Date().toLocaleString();
    if (quakeListEl) quakeListEl.innerHTML = '';
    quakeLayer.clearLayers();

    if (!data.features || data.features.length === 0) {
      if (quakeListEl) quakeListEl.innerHTML = '<p style="color:var(--muted);padding:8px">No recent earthquakes in the Philippines.</p>';
      return;
    }

    data.features.forEach(f => {
      const props = f.properties || {};
      const coords = f.geometry && f.geometry.coordinates || [];
      const mag = (props.mag === null || props.mag === undefined) ? 0 : props.mag;
      const place = props.place || 'Unknown location';
      const time = props.time || Date.now();
      const id = f.id;

      // build list card
      const card = document.createElement('div');
      card.className = 'quake';
      card.dataset.id = id;
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;justify-content:space-between">
          <div class="mag ${magClass(mag)}">${(typeof mag === 'number') ? mag.toFixed(1) : mag}</div>
          <div style="flex:1;margin-left:8px">
            <div style="font-weight:700">${place}</div>
            <div style="font-size:0.82rem;color:var(--muted)">${niceTime(time)}</div>
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        if (coords.length >= 2) focusMap(coords[1], coords[0], 7);
      });
      quakeListEl && quakeListEl.appendChild(card);

      // add marker to map
      if (coords.length >= 2) {
        const lat = coords[1], lon = coords[0], depth = coords[2] ?? '—';
        const circle = L.circleMarker([lat, lon], {
          radius: Math.max(4, 4 + (mag || 0)),
          color: magColor(mag || 0),
          fillOpacity: 0.75,
          weight: 1
        });
        const popupHtml = `
          <div style="font-weight:700;margin-bottom:6px">M${(typeof mag === 'number') ? mag.toFixed(1) : mag} — ${place}</div>
          <div style="font-size:0.9rem;color:var(--muted)">Time: ${niceTime(time)}<br/>Depth: ${depth} km</div>
          <div style="margin-top:8px"><a href="${props.url || '#'}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">Details</a></div>
        `;
        circle.bindPopup(popupHtml);
        quakeLayer.addLayer(circle);
      }

      // toast for new
      if (!seenQuakes.has(id)) {
        seenQuakes.add(id);
        if ((Date.now() - time) < 60 * 60 * 1000) {
          showToast(`<strong>New Quake</strong> M${(typeof mag === 'number') ? mag.toFixed(1) : mag} — ${place}`);
        }
      }
    });
  } catch (err) {
    console.error('fetchQuakesAndRender error', err);
    if (lastUpdatedEl) lastUpdatedEl.textContent = 'Error';
    if (quakeListEl) quakeListEl.innerHTML = '<p style="color:#ff8b8b;padding:8px">Error fetching USGS data. Try again later.</p>';
  }
}

/* ----------------------------
   Major highlight (M >= 5)
   ---------------------------- */
async function updateMajorHighlight() {
  const now = new Date();
  const start7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url7 = buildUSGSUrl({ startTimeISO: start7, orderby: 'time', limit: 50, minmag: 5.0, bbox: PH_BBOX });

  const start30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const url30 = buildUSGSUrl({ startTimeISO: start30, orderby: 'time', limit: 200, minmag: 5.0, bbox: PH_BBOX });

  if (mhContent) mhContent.innerHTML = `<div class="mh-empty">Checking for major quakes (M≥5)…</div>`;
  if (mhUpdated) mhUpdated.textContent = '';

  try {
    let res = await fetch(url7);
    if (!res.ok) throw new Error('Network error');
    let data = await res.json();

    if (!data.features || data.features.length === 0) {
      res = await fetch(url30);
      data = await res.json();
    }

    if (!data.features || data.features.length === 0) {
      if (mhContent) mhContent.innerHTML = `<div class="mh-empty">No major earthquakes (M≥5) in the last 30 days in the Philippines.</div>`;
      if (mhUpdated) mhUpdated.textContent = `Checked: ${new Date().toLocaleString()}`;
      return;
    }

    const top = data.features[0];
    const p = top.properties || {};
    const g = top.geometry || {};
    const coords = g.coordinates || [];
    const mag = p.mag ?? 0;
    const place = p.place || 'Unknown place';
    const time = p.time || Date.now();
    const id = top.id;
    const depth = coords[2] ?? '—';

    if (mhContent) {
      mhContent.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center">
          <div style="font-size:1.6rem;font-weight:800;color:${mag >= 6 ? '#ff6b6b' : mag >= 5 ? '#ff8a65' : 'var(--accent)'}">
            M${mag.toFixed(1)}
          </div>
          <div style="flex:1">
            <div style="font-weight:700">${place}</div>
            <div style="font-size:0.9rem;color:var(--muted)">Depth: ${depth} km · ${niceTime(time)}</div>
            <div style="margin-top:8px;display:flex;gap:8px">
              <a class="minor-link" href="${p.url || '#'}" target="_blank" rel="noopener noreferrer">Details</a>
              <button id="focusMajorBtn" style="background:var(--accent);border:none;padding:6px 8px;border-radius:6px;color:#000;cursor:pointer">Focus on map</button>
            </div>
          </div>
        </div>
      `;
    }

    const focusBtn = document.getElementById('focusMajorBtn');
    if (focusBtn && coords.length >= 2) {
      focusBtn.addEventListener('click', () => focusMap(coords[1], coords[0], 7));
    }

    if (mhUpdated) mhUpdated.textContent = `Updated: ${new Date().toLocaleString()}`;

    if (coords.length >= 2) {
      const majorMarker = L.circleMarker([coords[1], coords[0]], {
        radius: 10 + (mag || 0),
        color: (mag >= 6 ? '#ff6b6b' : '#ff8a65'),
        fillOpacity: 0.15,
        weight: 2,
        dashArray: '3'
      }).addTo(map);
      setTimeout(() => map.removeLayer(majorMarker), 60 * 1000);
    }

    seenQuakes.add(id);
  } catch (err) {
    console.error('updateMajorHighlight error', err);
    if (mhContent) mhContent.innerHTML = `<div class="mh-empty">Unable to check major quakes.</div>`;
    if (mhUpdated) mhUpdated.textContent = `Error: ${new Date().toLocaleString()}`;
  }
}

/* ----------------------------
   Statistics (update + chart)
   ---------------------------- */
async function updateStatistics() {
  try {
    const now = new Date();
    const start7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const url = buildUSGSUrl({ startTimeISO: start7, orderby: 'time', limit: 2000, bbox: PH_BBOX });

    const res = await fetch(url);
    if (!res.ok) throw new Error('Network error fetching stats');
    const data = await res.json();
    const features = data.features || [];

    const past24Cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const features24 = features.filter(f => (f.properties && f.properties.time) && f.properties.time >= past24Cutoff);

    const dailyCount = features24.length;
    const weeklyCount = features.length;

    let largest24 = null;
    for (const f of features24) {
      const mag = f.properties && f.properties.mag;
      if (mag === null || mag === undefined) continue;
      if (!largest24 || mag > largest24.mag) {
        largest24 = { mag, place: f.properties.place, time: f.properties.time, id: f.id, url: f.properties.url };
      }
    }

    if (statDailyCountEl) statDailyCountEl.textContent = String(dailyCount);
    if (statWeeklyCountEl) statWeeklyCountEl.textContent = String(weeklyCount);
    if (statLargest24hEl) statLargest24hEl.textContent = largest24 ? `M${largest24.mag.toFixed(1)}` : '—';

    if (largest24 && largest24.mag >= 5.0 && !seenQuakes.has(largest24.id)) {
      showToast(`<strong>Major (24h)</strong> M${largest24.mag.toFixed(1)} — ${largest24.place}`, 8000);
      seenQuakes.add(largest24.id);
    }

    // buckets for last 7 days
    const buckets = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = 0;
    }
    features.forEach(f => {
      const t = f.properties && f.properties.time;
      if (!t) return;
      const d = new Date(t);
      const key = d.toISOString().slice(0, 10);
      if (key in buckets) buckets[key] += 1;
    });
    const labels = Object.keys(buckets);
    const counts = labels.map(l => buckets[l]);

    if (weekChartCanvas) {
      if (!weekChart) {
        weekChart = new Chart(weekChartCanvas, {
          type: 'bar',
          data: {
            labels,
            datasets: [{
              label: 'Quakes per day',
              data: counts,
              backgroundColor: counts.map(c => c > 0 ? 'rgba(124,77,255,0.7)' : 'rgba(255,255,255,0.04)'),
              borderRadius: 6,
              barThickness: 18
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: { grid: { display: false }, ticks: { color: '#cfd8e3' } },
              y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#cfd8e3', beginAtZero: true } }
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: ctx => ` ${ctx.parsed.y} quake(s)`
                }
              }
            }
          }
        });
      } else {
        weekChart.data.labels = labels;
        weekChart.data.datasets[0].data = counts;
        weekChart.data.datasets[0].backgroundColor = counts.map(c => c > 0 ? 'rgba(124,77,255,0.7)' : 'rgba(255,255,255,0.04)');
        weekChart.update();
      }
    }
  } catch (err) {
    console.error('updateStatistics error', err);
    if (statDailyCountEl) statDailyCountEl.textContent = '—';
    if (statWeeklyCountEl) statWeeklyCountEl.textContent = '—';
    if (statLargest24hEl) statLargest24hEl.textContent = '—';
  }
}

/* ----------------------------
   Full refresh (one cycle)
   ---------------------------- */
async function doFullRefresh() {
  await Promise.all([
    fetchQuakesAndRender(),
    updateMajorHighlight(),
    updateStatistics()
  ]);
}

/* ----------------------------
   Auto-refresh & countdown (complete)
   ---------------------------- */
function stopAuto() {
  if (autoTimerId) { clearInterval(autoTimerId); autoTimerId = null; }
  if (countdownTimerId) { clearInterval(countdownTimerId); countdownTimerId = null; }
}

function startAuto() {
  // clear any existing timers first
  stopAuto();

  // read and validate user interval (minimum 5s)
  const secs = Number(refreshSecondsInput?.value ?? 30);
  const validatedSecs = (!isNaN(secs) && secs >= 5) ? secs : 30;
  autoInterval = Math.max(5000, Math.floor(validatedSecs) * 1000);
  countdownRemaining = Math.floor(autoInterval / 1000);

  // update toggle button label
  if (toggleAutoBtn) toggleAutoBtn.textContent = autoEnabled ? '⏸ Pause Auto Refresh' : '▶ Resume Auto Refresh';

  // if auto disabled, show paused and exit
  if (!autoEnabled) {
    if (countdownEl) countdownEl.textContent = 'Paused';
    return;
  }

  // start periodic refresh
  autoTimerId = setInterval(() => {
    doFullRefresh().catch(err => console.error('doFullRefresh error', err));
    // reset countdown for the next interval after run
    countdownRemaining = Math.floor(autoInterval / 1000);
  }, autoInterval);

  // start countdown tick
  if (countdownEl) countdownEl.textContent = String(countdownRemaining);
  countdownTimerId = setInterval(() => {
    countdownRemaining -= 1;
    if (countdownRemaining <= 0) {
      // keep it in sync with the interval (do not trigger refresh here; interval already does)
      countdownRemaining = Math.floor(autoInterval / 1000);
    }
    if (countdownEl) countdownEl.textContent = String(countdownRemaining);
  }, 1000);
}

/* ----------------------------
   Event bindings
   ---------------------------- */
timeRangeSel?.addEventListener('change', () => {
  fetchQuakesAndRender().catch(err => console.error(err));
  updateStatistics().catch(err => console.error(err));
});

refreshBtn?.addEventListener('click', () => {
  doFullRefresh().catch(err => console.error(err));
});

toggleAutoBtn?.addEventListener('click', () => {
  autoEnabled = !autoEnabled;
  if (toggleAutoBtn) toggleAutoBtn.textContent = autoEnabled ? '⏸ Pause Auto Refresh' : '▶ Resume Auto Refresh';
  startAuto();
});

refreshSecondsInput?.addEventListener('change', () => {
  // ensure a sane value and restart timers if enabled
  const v = Number(refreshSecondsInput.value);
  if (isNaN(v) || v < 5) {
    refreshSecondsInput.value = 30;
  }
  startAuto();
});

/* ----------------------------
   Initial load
   ---------------------------- */
(async function init() {
  try {
    await doFullRefresh(); // run immediately
  } catch (err) {
    console.error('Initial refresh error', err);
  }
  // start auto-refresh timers
  startAuto();
})();

const tableBody = document.getElementById("quake-table-body");
tableBody.innerHTML = ""; // clear loading

if (quakes.length === 0) {
  tableBody.innerHTML = `<tr><td colspan="4">No seismic events found</td></tr>`;
} else {
  quakes.forEach(eq => {
    const props = eq.properties;
    const coords = eq.geometry.coordinates;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(props.time).toLocaleString()}</td>
      <td>${coords[2]} km</td>
      <td>${props.mag}</td>
      <td>${props.place}</td>
    `;
    tableBody.appendChild(row);
  });
}
const quakes = data.features.filter(eq => 
  eq.properties.place.toLowerCase().includes("philippines")
);
async function testUSGS() {
  const url = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2025-09-01&endtime=2025-10-02&minmagnitude=3";
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log("USGS Data:", data);
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}
async function loadWeather() {
  const lat = 14.5995;   // Manila
  const lon = 120.9842;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=Asia%2FManila`;

  try {
    console.log("Fetching weather from:", url);
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP error " + res.status);

    const data = await res.json();
    console.log("Weather API response:", data);

    const cw = data.current_weather;
    document.getElementById("weather-data").innerHTML = `
      <p><b>Location:</b> Manila</p>
      <p><b>Temperature:</b> ${cw.temperature} °C</p>
      <p><b>Wind Speed:</b> ${cw.windspeed} m/s</p>
      <p><b>Time:</b> ${cw.time}</p>
    `;
  } catch (err) {
    console.error("Weather fetch failed:", err);
    document.getElementById("weather-data").innerHTML = 
      `<p>⚠️ Failed to load weather: ${err.message}</p>`;
  }
}

loadWeather();




testUSGS();

