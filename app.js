/* Geo Dashboard — Frontend logic (vanilla JS, Leaflet) */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API = 'https://maps.ogsapps.cc';
const DEFAULT_CENTER = [49.19, -122.85]; // Surrey-ish
const DEFAULT_ZOOM = 12;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  map: null,
  lat: null,
  lon: null,
  results: [],
  activeTab: 'places',
  markers: [],
  trailLayers: [],
  sidebarOpen: true,
  customPlacesVisible: false,
  transitVisible: false,
  customMarkers: [],
  transitMarkers: [],
  busStopMarkers: [],
  currentTileLayer: 'Voyager',
  elevationMode: false,
  elevationPoints: [],       // Leaflet markers for elevation route points
  elevationCoords: [],        // [{lat, lng}] for elevation route points
  elevationLine: null,        // Polyline connecting elevation points
  profileChart: null,
  selectedMarker: null,
  // Multi-point route mode
  elevationModeType: 'single', // 'single' (2-pt auto-reset) or 'multi' (keep adding)
  routeProfileData: [],        // merged profile segments [{lat,lon,elevation_m,distance_m}]
  // Measurement tool
  measureMode: false,
  measurePoints: [],           // [{lat, lng}] for measurement route
  measureMarkers: [],          // Leaflet markers for measurement points
  measureLine: null,           // Polyline for measurement route
  measureTooltips: [],         // Leaflet tooltip layers on segments
  // Ferries and Weather
  ferryMarkers: [],
  weatherVisible: false,
  ferriesVisible: false,
  weatherData: null,
  ferriesData: null,
};

let tileLayers = {};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initUI();
  handleUrlParams();
  tryGeolocation();
});

function handleUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const layer = params.get('layer');
  const tab = params.get('tab');
  if (layer === 'custom') toggleCustomPlaces();
  if (layer === 'transit') toggleTransit();
  if (layer === 'elevation') toggleElevationMode();
  if (tab === 'trails') switchTab('trails');
  if (tab === 'custom') switchTab('custom');

  // Force Voyager tile layer after a short delay
  setTimeout(() => {
    if (state.currentTileLayer !== 'Voyager') {
      tileLayers[state.currentTileLayer]?.remove();
      tileLayers['Voyager']?.addTo(state.map);
      state.currentTileLayer = 'Voyager';
      document.querySelectorAll('#tile-switcher button').forEach(b => b.classList.remove('active'));
      document.querySelector('#tile-switcher button[data-tile="Voyager"]')?.classList.add('active');
    }
  }, 200);
}

function initMap() {
  state.map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
  });

  tileLayers = {
    'Voyager': L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, attribution: '&copy; CartoDB',
    }),
    'Topo': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '&copy; OpenTopoMap',
    }),
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: '&copy; Esri',
    }),
  };

  tileLayers['Voyager'].addTo(state.map);
  state.currentTileLayer = 'Voyager';

  L.control.zoom({ position: 'bottomleft' }).addTo(state.map);

  // Click on map to add custom place or route points
  state.map.on('click', (e) => {
    if (state.elevationMode || state.measureMode) {
      handleRouteClick(e.latlng);
    } else if (state.activeTab === 'custom') {
      showAddPlaceModal(e.latlng.lat, e.latlng.lng);
    }
  });

  // Update status bar on move
  state.map.on('moveend', updateStatusBar);

  // Ensure map tiles load after container settles
  setTimeout(() => state.map.invalidateSize(), 100);
}

function initUI() {
  // Search
  document.getElementById('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    handleSearch();
  });

  // Tabs
  document.querySelectorAll('.sidebar-tabs button').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // GPS button
  document.getElementById('btn-gps').addEventListener('click', tryGeolocation);

  // Clear button
  document.getElementById('btn-clear').addEventListener('click', clearSearch);

  // Floating GPS share button
  document.getElementById('gps-share-btn').addEventListener('click', () => {
    tryGeolocation();
    showGpsStatus('Getting location...');
  });

  // Sidebar toggle
  document.getElementById('btn-sidebar').addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen;
    document.querySelector('.sidebar').classList.toggle('collapsed', !state.sidebarOpen);
    // Wait for CSS transition before resizing map
    setTimeout(() => state.map.invalidateSize(), 250);
  });

  // Layer toggles
  document.getElementById('layer-custom').addEventListener('click', toggleCustomPlaces);
  document.getElementById('layer-transit').addEventListener('click', toggleTransit);
  document.getElementById('layer-ferries').addEventListener('click', toggleFerries);
  document.getElementById('btn-legend').addEventListener('click', showLegendModal);
  document.getElementById('btn-weather').addEventListener('click', () => switchTab('weather'));
  document.getElementById('btn-theme')?.addEventListener('click', toggleTheme);

  // Search history
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('focus', showSearchHistory);
    searchInput.addEventListener('blur', () => setTimeout(hideSearchHistory, 200));
  }

  // Init theme
  initTheme();

  // Tile layer switcher
  document.querySelectorAll('#tile-switcher button').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.tile;
      if (name === state.currentTileLayer) return;
      tileLayers[state.currentTileLayer].remove();
      tileLayers[name].addTo(state.map);
      state.currentTileLayer = name;
      document.querySelectorAll('#tile-switcher button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Elevation mode toggle
  document.getElementById('layer-elevation').addEventListener('click', toggleElevationMode);
  
  // Measurement tool toggle
  document.getElementById('layer-measure').addEventListener('click', toggleMeasureMode);

  // Route tools buttons in the elevation/measure panel
  document.getElementById('btn-add-point')?.addEventListener('click', addElevationPoint);
  document.getElementById('btn-remove-last')?.addEventListener('click', removeLastPoint);
  document.getElementById('btn-clear-route')?.addEventListener('click', clearRoute);
  document.getElementById('btn-export-gpx')?.addEventListener('click', exportGPX);
  // Mode toggle radio
  document.querySelectorAll('input[name="route-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.elevationModeType = e.target.value;
      // Update UI maybe
    });
  });

  // Radius slider
  const slider = document.getElementById('radius-slider');
  const sliderVal = document.getElementById('radius-value');
  slider.addEventListener('input', () => {
    sliderVal.textContent = slider.value + ' km';
  });

  // Search this area button
  const searchAreaBtn = document.getElementById('search-area-btn');
  searchAreaBtn.addEventListener('click', searchCurrentArea);

  // Show/hide search area button on map move
  state.map.on('moveend', () => {
    updateStatusBar();
    const center = state.map.getCenter();
    const hasResults = state.results.length > 0;
    const moved = state.lat && (
      Math.abs(center.lat - state.lat) > 0.005 ||
      Math.abs(center.lng - state.lon) > 0.005
    );
    searchAreaBtn.style.display = hasResults || moved ? 'block' : 'none';
    loadBusStopsInView();
  });

  // Keyboard shortcut: Escape closes sidebar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModals();
    }
  });
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------
function tryGeolocation() {
  if (!navigator.geolocation) return;
  const btn = document.getElementById('btn-gps');
  btn.classList.add('active');
  showGpsStatus('Getting location...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.lat = pos.coords.latitude;
      state.lon = pos.coords.longitude;
      state.map.setView([state.lat, state.lon], 14);
      sendLocationToServer(state.lat, state.lon, pos.coords.accuracy);
      // Store in localStorage
      localStorage.setItem('lastLocation', JSON.stringify({ lat: state.lat, lon: state.lon, ts: Date.now() }));
      updateStatusBar();
      btn.classList.remove('active');
      showGpsStatus('✓ Location shared!');
      setTimeout(() => showGpsStatus(''), 3000);
    },
    (err) => {
      btn.classList.remove('active');
      showGpsStatus('GPS failed');
      setTimeout(() => showGpsStatus(''), 3000);
      // Use default
      state.lat = DEFAULT_CENTER[0];
      state.lon = DEFAULT_CENTER[1];
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function showGpsStatus(msg) {
  const btn = document.getElementById('gps-share-btn');
  if (btn) {
    if (msg) {
      btn.textContent = msg;
      btn.classList.add('active');
    } else {
      btn.textContent = '📍 Share GPS';
      btn.classList.remove('active');
    }
  }
}

async function sendLocationToServer(lat, lon, accuracy) {
  try {
    await fetch(`${API}/api/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon, accuracy }),
    });
  } catch (e) { /* silent */ }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
async function handleSearch() {
  const input = document.getElementById('search-input').value.trim();
  if (!input) return;

  saveSearchHistory(input);
  hideSearchHistory();

  const q = parseSearchQuery(input);
  clearResults();

  if (q.transit) {
    await searchTransit(q);
  } else if (q.trail) {
    await searchTrails(q);
  } else {
    await searchPlaces(q);
  }
}

function parseSearchQuery(input) {
  const lower = input.toLowerCase();
  const result = { raw: input, trail: false, transit: false, type: null, location: null, q: input };

  // "trails near Whistler", "hiking near ..."
  if (/\b(trail|hike|hiking)\b/.test(lower)) {
    result.trail = true;
    result.q = input.replace(/\b(trails?|hike|hiking|near|around)\b/gi, '').trim();
    return result;
  }

  // "skytrain from Gateway", "next train from ...", "transit ..."
  if (/\b(skytrain|transit|train|station|next)\b/.test(lower)) {
    result.transit = true;
    result.q = input.replace(/\b(skytrain|transit|train|station|next|from|to|schedule)\b/gi, '').trim();
    return result;
  }

  // "coffee near Surrey" — extract type and location
  const nearMatch = lower.match(/^(.+?)\s+(?:near|in|around|at)\s+(.+)$/);
  if (nearMatch) {
    result.q = nearMatch[1];
    result.location = nearMatch[2];
  }

  return result;
}

function getRadius() {
  const slider = document.getElementById('radius-slider');
  return parseInt(slider.value) * 1000; // km to meters
}

async function searchPlaces(q) {
  showLoading();
  try {
    let lat = state.lat, lon = state.lon, radius = getRadius();

    // Geocode location if specified
    if (q.location) {
      const geo = await apiGet('/api/geocode', { q: q.location });
      if (geo.length > 0) {
        lat = geo[0].lat;
        lon = geo[0].lon;
        radius = getRadius();
        state.map.setView([lat, lon], 13);
      }
    }

    const params = {
      q: q.q,
      lat, lon, radius,
      limit: 30,
    };

    const data = await apiGet('/api/places/search', params);
    state.results = data;
    document.getElementById('search-area-btn').style.display = 'block';
    renderResults(data, 'places');
    placeMarkers(data);
  } catch (e) {
    showError('Search failed: ' + e.message);
  }
}

async function searchTrails(q) {
  showLoading();
  try {
    if (q.q) {
      // Search by name
      const data = await apiGet('/api/trails/search', { q: q.q, limit: 20 });
      state.results = data;
      renderResults(data, 'trails');
      placeTrailMarkers(data);
    } else if (state.lat) {
      // Near me
      const data = await apiGet('/api/trails/near', {
        lat: state.lat, lon: state.lon, radius: getRadius(), limit: 20,
      });
      state.results = data;
      renderResults(data, 'trails');
      placeTrailMarkers(data);
    }
  } catch (e) {
    showError('Trail search failed: ' + e.message);
  }
}

async function searchTransit(q) {
  showLoading();
  try {
    if (q.q) {
      // Search stations
      const stations = await apiGet('/api/transit/stations', { q: q.q });
      if (stations.length > 0) {
        // Show schedule for first match
        const schedule = await apiGet('/api/transit/schedule', { station: q.q });
        renderTransitSchedule(stations, schedule);
        placeTransitStationMarkers(stations);
      } else {
        showEmpty('No stations found');
      }
    } else if (state.lat) {
      const data = await apiGet('/api/transit/nearest', {
        lat: state.lat, lon: state.lon, limit: 5,
      });
      state.results = data;
      renderResults(data, 'transit-near');
      placeTransitStationMarkers(data);
    }
  } catch (e) {
    showError('Transit search failed: ' + e.message);
  }
}

async function searchCurrentArea() {
  const center = state.map.getCenter();
  state.lat = center.lat;
  state.lon = center.lng;
  const input = document.getElementById('search-input').value.trim();
  if (input) {
    handleSearch();
  } else {
    // Default to nearby places search
    loadNearby();
  }
  document.getElementById('search-area-btn').style.display = 'none';
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('btn-clear').style.display = 'none';
  state.results = [];
  state.markers.forEach(m => state.map.removeLayer(m));
  state.markers = [];
  state.trailLayers.forEach(l => state.map.removeLayer(l));
  state.trailLayers = [];
  document.getElementById('results-list').innerHTML = '';
  document.getElementById('search-area-btn').style.display = 'none';
  state.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function apiGet(path, params = {}) {
  const url = new URL(`${API}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v);
  });
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || resp.statusText);
  }
  return resp.json();
}

async function apiPost(path, body) {
  const resp = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.error || resp.statusText);
  }
  return resp.json();
}

async function apiDelete(path) {
  const resp = await fetch(`${API}${path}`, { method: 'DELETE' });
  return resp.json();
}

// ---------------------------------------------------------------------------
// Render results
// ---------------------------------------------------------------------------
function renderResults(data, type) {
  document.getElementById('btn-clear').style.display = 'block';
  const container = document.getElementById('sidebar-content');
  if (!data || data.length === 0) {
    showEmpty('No results found');
    return;
  }

  let html = `<div class="results-count">${data.length} results</div>`;

  data.forEach((item, i) => {
    if (type === 'places') {
      html += renderPlaceCard(item, i);
    } else if (type === 'trails') {
      html += renderTrailCard(item, i);
    } else if (type === 'transit-near') {
      html += renderTransitCard(item, i);
    }
  });

  container.innerHTML = html;

  // Click handlers
  container.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index);
      const item = state.results[idx];
      if (item) {
        state.map.setView([item.lat, item.lon], 16);
        // Open popup
        state.markers[idx]?.openPopup();
        // Show star indicator for this result
        selectResult(item);
      }
    });
  });
}

function selectResult(item) {
  // Remove previous selected marker
  if (state.selectedMarker) {
    state.map.removeLayer(state.selectedMarker);
    state.selectedMarker = null;
  }
  // Add a star marker for this result (always visible)
  const starIcon = L.divIcon({
    className: '',
    html: `<div style="font-size:28px;text-shadow:1px 1px 3px #000;color:#FFD700;">⭐</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -30],
  });
  const marker = L.marker([item.lat, item.lon], { icon: starIcon }).addTo(state.map);
  state.selectedMarker = marker;
}

function renderPlaceCard(p, i) {
  const dist = p.distance_m != null ? formatDist(p.distance_m) : '';
  const type = p.subtype || p.type || '';
  return `
    <div class="result-card" data-index="${i}">
      <div class="name">${esc(p.name)}</div>
      <div class="meta">
        ${type ? `<span class="type-badge">${esc(type)}</span>` : ''}
        ${p.cuisine ? `<span class="type-badge">${esc(p.cuisine)}</span>` : ''}
        ${p.address ? esc(p.address) : ''}
      </div>
      ${dist ? `<div class="distance">${dist}</div>` : ''}
      ${p.source === 'custom' ? `<div class="meta" style="color:var(--green)">★ Custom</div>` : ''}
    </div>`;
}

function renderTrailCard(t, i) {
  const diff = difficultyBadge(t.sac_scale);
  const length = t.total_length_km ? `${t.total_length_km.toFixed(1)} km` : (t.length_km ? `${t.length_km.toFixed(1)} km` : '');
  const dist = t.distance_km != null ? `${t.distance_km.toFixed(1)} km away` : '';
  return `
    <div class="result-card" data-index="${i}">
      <div class="name">${esc(t.name)}</div>
      <div class="meta">
        <span class="type-badge">${esc(t.trail_type || 'trail')}</span>
        ${length} ${t.segment_count ? `(${t.segment_count} segments)` : ''}
      </div>
      <div class="meta">
        ${diff}
        ${t.surface ? ` · ${esc(t.surface)}` : ''}
        ${dist ? ` · <span class="distance">${dist}</span>` : ''}
      </div>
    </div>`;
}

function renderTransitCard(s, i) {
  const dist = s.distance_m != null ? formatDist(s.distance_m) : '';
  const lines = (s.lines || []).map(l => `<span class="type-badge">${esc(l.route_name || l)}</span>`).join(' ');
  return `
    <div class="result-card" data-index="${i}">
      <div class="name">${esc(s.name)}</div>
      <div class="meta">${lines}</div>
      ${dist ? `<div class="distance">${dist}</div>` : ''}
    </div>`;
}

function renderTransitSchedule(stations, schedule) {
  const container = document.getElementById('sidebar-content');
  let html = `<div class="results-count">Transit schedule</div>`;

  stations.forEach(s => {
    html += `<div class="result-card">
      <div class="name">${esc(s.name)}</div>
      <div class="meta">${(s.lines || []).map(l => `<span class="type-badge">${esc(l.route_name)}</span>`).join(' ')}</div>
    </div>`;
  });

  // Schedule table
  for (const [station, schedules] of Object.entries(schedule)) {
    if (station === '_day') continue;
    schedules.forEach(s => {
      html += `<div class="result-card" style="cursor:default">
        <div class="name">${esc(station)} — ${esc(s.line)}</div>
        <table class="schedule-table">
          <tr><th>Period</th><th>Headway</th><th>First</th><th>Last</th></tr>
          ${(s.frequencies || []).map(f => `
            <tr>
              <td>${esc(formatPeriod(f.period))}</td>
              <td>${f.headway_min} min</td>
              <td>${esc(f.first)}</td>
              <td>${esc(f.last)}</td>
            </tr>`).join('')}
        </table>
      </div>`;
    });
  }

  container.innerHTML = html;
  state.results = stations;
}

// ---------------------------------------------------------------------------
// Map markers
// ---------------------------------------------------------------------------
function clearResults() {
  state.markers.forEach(m => state.map.removeLayer(m));
  state.markers = [];
  state.trailLayers.forEach(l => state.map.removeLayer(l));
  state.trailLayers = [];
}

function placeMarkers(data) {
  const bounds = [];
  data.forEach(p => {
    if (!p.lat || !p.lon || (p.lat === 0 && p.lon === 0)) return;
    const icon = makeIcon(p.source === 'custom' ? '🟢' : '📍');
    const marker = L.marker([p.lat, p.lon], { icon })
      .addTo(state.map)
      .bindPopup(makePlacePopup(p));
    state.markers.push(marker);
    bounds.push([p.lat, p.lon]);
  });
  if (bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
  }
}

function placeTrailMarkers(data) {
  const bounds = [];
  data.forEach(t => {
    if (!t.lat || !t.lon) return;
    const diff = t.sac_scale || '';
    const color = trailColor(diff);
    const icon = makeIcon('🥾');
    const marker = L.marker([t.lat, t.lon], { icon })
      .addTo(state.map)
      .bindPopup(makeTrailPopup(t));
    state.markers.push(marker);
    bounds.push([t.lat, t.lon]);
  });
  if (bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
  }
}

function placeTransitStationMarkers(data) {
  const bounds = [];
  data.forEach(s => {
    if (!s.lat || !s.lon) return;
    const icon = makeIcon('🚇');
    const marker = L.marker([s.lat, s.lon], { icon })
      .addTo(state.map)
      .bindPopup(makeTransitPopup(s));
    state.markers.push(marker);
    bounds.push([s.lat, s.lon]);
  });
  if (bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
  }
}

function makeIcon(emoji) {
  return L.divIcon({
    className: '',
    html: `<div style="font-size:22px;text-shadow:1px 1px 2px #000;transform:translate(-50%,-100%)">${emoji}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 22],
    popupAnchor: [0, -20],
  });
}

function makePlacePopup(p) {
  return `<div class="popup-title">${esc(p.name)}</div>
    <div class="popup-meta">
      ${[p.type, p.subtype, p.cuisine].filter(Boolean).map(esc).join(' · ')}<br>
      ${p.address ? esc(p.address) + '<br>' : ''}
      ${p.distance_m != null ? formatDist(p.distance_m) : ''}
      ${p.source === 'custom' ? '<br><span style="color:#66bb6a">★ Custom place</span>' : ''}
    </div>
    <div style="margin-top:4px">
      <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}" target="_blank">OSM ↗</a>
    </div>`;
}

function makeTrailPopup(t) {
  const length = t.total_length_km || t.length_km || 0;
  return `<div class="popup-title">${esc(t.name)}</div>
    <div class="popup-meta">
      ${esc(t.trail_type || 'trail')} · ${length.toFixed(1)} km
      ${t.sac_scale ? '<br>' + esc(formatSAC(t.sac_scale)) : ''}
      ${t.surface ? ' · ' + esc(t.surface) : ''}
    </div>
    <div style="margin-top:4px">
      <a href="#" onclick="loadTrailGeojson(${t.id});return false">Show on map</a>
    </div>`;
}

function makeTransitPopup(s) {
  const lines = (s.lines || []).map(l => esc(l.route_name || l)).join(', ');
  return `<div class="popup-title">🚇 ${esc(s.name)}</div>
    <div class="popup-meta">Lines: ${lines || 'N/A'}</div>
    <div style="margin-top:4px">
      <a href="#" onclick="loadStationSchedule('${esc(s.name)}');return false">Show schedule</a>
    </div>`;
}

// ---------------------------------------------------------------------------
// Trail GeoJSON loading
// ---------------------------------------------------------------------------
async function loadTrailGeojson(id) {
  try {
    const data = await apiGet(`/api/trails/info/${id}`, { geojson: 1 });
    if (data.geojson) {
      let geojson;
      if (data.geojson.type === 'FeatureCollection') {
        geojson = data.geojson;
      } else {
        geojson = { type: 'FeatureCollection', features: [data.geojson] };
      }
      const layer = L.geoJSON(geojson, {
        style: {
          color: trailColor(data.sac_scale),
          weight: 3,
          opacity: 0.8,
        },
      }).addTo(state.map);
      state.trailLayers.push(layer);
      state.map.fitBounds(layer.getBounds(), { padding: [30, 30] });
    }
  } catch (e) {
    alert('Failed to load trail: ' + e.message);
  }
}

// Make it accessible from popup onclick
window.loadTrailGeojson = loadTrailGeojson;

async function loadStationSchedule(name) {
  try {
    const schedule = await apiGet('/api/transit/schedule', { station: name });
    const stations = await apiGet('/api/transit/stations', { q: name });
    renderTransitSchedule(stations, schedule);
    switchTab('places'); // show sidebar
    state.sidebarOpen = true;
    document.querySelector('.sidebar').classList.remove('collapsed');
  } catch (e) {
    alert('Failed to load schedule: ' + e.message);
  }
}
window.loadStationSchedule = loadStationSchedule;

// ---------------------------------------------------------------------------
// Sidebar tabs
// ---------------------------------------------------------------------------
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.sidebar-tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  const container = document.getElementById('sidebar-content');

  if (tab === 'places') {
    // Keep current results or show empty
    if (state.results.length === 0) showEmpty('Search for places, trails, or transit');
  } else if (tab === 'custom') {
    loadCustomPlaces();
  } else if (tab === 'near') {
    loadNearby();
  } else if (tab === 'weather') {
    loadWeather();
  } else if (tab === 'ferries') {
    loadFerries();
  }
}

async function loadCustomPlaces() {
  showLoading();
  try {
    const data = await apiGet('/api/places/custom');
    state.results = data;
    renderResults(data, 'places');
    placeMarkers(data);
  } catch (e) {
    showError('Failed: ' + e.message);
  }
}

async function loadNearby() {
  if (!state.lat) {
    showEmpty('Enable GPS first or click the 📍 button');
    return;
  }
  showLoading();
  try {
    const data = await apiGet('/api/places/near', {
      lat: state.lat, lon: state.lon, radius: getRadius(), limit: 30,
    });
    state.results = data;
    renderResults(data, 'places');
    placeMarkers(data);
  } catch (e) {
    showError('Failed: ' + e.message);
  }
}

async function loadWeather() {
  showLoading();
  let lat = state.lat, lon = state.lon;
  if (lat === null || lon === null) {
    const center = state.map.getCenter();
    lat = center.lat;
    lon = center.lng;
  }
  try {
    const data = await apiGet('/api/weather', { lat, lon });
    state.weatherData = data;
    renderWeather(data);
  } catch (e) {
    showError('Weather load failed: ' + e.message);
  }
}

async function loadFerries() {
  showLoading();
  try {
    const data = await apiGet('/api/ferries');
    state.ferriesData = data;
    renderFerries(data);
  } catch (e) {
    showError('Ferries load failed: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// Layer toggles
// ---------------------------------------------------------------------------
async function toggleCustomPlaces() {
  state.customPlacesVisible = !state.customPlacesVisible;
  document.getElementById('layer-custom').classList.toggle('active', state.customPlacesVisible);

  if (state.customPlacesVisible) {
    try {
      const data = await apiGet('/api/places/custom');
      placeCustomMarkers(data);
    } catch (e) { /* silent */ }
  } else {
    state.customMarkers.forEach(m => state.map.removeLayer(m));
    state.customMarkers = [];
  }
}

function placeCustomMarkers(data) {
  state.customMarkers.forEach(m => state.map.removeLayer(m));
  state.customMarkers = [];
  data.forEach(p => {
    if (!p.lat || !p.lon) return;
    const icon = makeIcon('⭐');
    const marker = L.marker([p.lat, p.lon], { icon })
      .addTo(state.map)
      .bindPopup(makePlacePopup({ ...p, source: 'custom' }));
    state.customMarkers.push(marker);
  });
}

async function toggleTransit() {
  state.transitVisible = !state.transitVisible;
  document.getElementById('layer-transit').classList.toggle('active', state.transitVisible);

  if (state.transitVisible) {
    try {
      const data = await apiGet('/api/transit/stations');
      placeTransitLayer(data);
    } catch (e) { /* silent */ }
  } else {
    state.transitMarkers.forEach(m => state.map.removeLayer(m));
    state.transitMarkers = [];
    state.busStopMarkers.forEach(m => state.map.removeLayer(m));
    state.busStopMarkers = [];
  }
}

async function toggleFerries() {
  state.ferriesVisible = !state.ferriesVisible;
  document.getElementById('layer-ferries').classList.toggle('active', state.ferriesVisible);

  if (state.ferriesVisible) {
    try {
      const data = await apiGet('/api/ferries');
      placeFerryMarkers(data);
    } catch (e) { /* silent */ }
  } else {
    state.ferryMarkers.forEach(m => state.map.removeLayer(m));
    state.ferryMarkers = [];
  }
}

function placeTransitLayer(data) {
  state.transitMarkers.forEach(m => state.map.removeLayer(m));
  state.transitMarkers = [];
  data.forEach(s => {
    if (!s.lat || !s.lon) return;
    const icon = makeIcon('🚇');
    const marker = L.marker([s.lat, s.lon], { icon })
      .addTo(state.map)
      .bindPopup(makeTransitPopup(s));
    state.transitMarkers.push(marker);
  });
}

// ---------------------------------------------------------------------------
// Bus stops (zoom-dependent overlay)
// ---------------------------------------------------------------------------
async function loadBusStopsInView() {
  if (!state.transitVisible) return;
  const zoom = state.map.getZoom();
  if (zoom < 15) {
    // Too zoomed out — clear bus stops
    state.busStopMarkers.forEach(m => state.map.removeLayer(m));
    state.busStopMarkers = [];
    return;
  }

  const bounds = state.map.getBounds();
  try {
    const data = await apiGet('/api/transit/bus-stops', {
      south: bounds.getSouth().toFixed(5),
      north: bounds.getNorth().toFixed(5),
      west: bounds.getWest().toFixed(5),
      east: bounds.getEast().toFixed(5),
      limit: 150,
    });
    // Clear old markers
    state.busStopMarkers.forEach(m => state.map.removeLayer(m));
    state.busStopMarkers = [];

    data.forEach(s => {
      const routes = (s.routes || []).join(', ');
      const icon = makeIcon('🚌');
      const marker = L.marker([s.stop_lat, s.stop_lon], { icon })
        .addTo(state.map)
        .bindPopup(`<div class="popup-title">🚌 ${esc(s.stop_name)}</div>
          <div class="popup-meta">Routes: ${esc(routes || 'N/A')}</div>`);
      state.busStopMarkers.push(marker);
    });
  } catch (e) { /* silent */ }
}

// ---------------------------------------------------------------------------
// Elevation query & profile
// ---------------------------------------------------------------------------
function toggleElevationMode() {
  state.elevationMode = !state.elevationMode;
  if (state.elevationMode && state.measureMode) {
    state.measureMode = false;
    document.getElementById('layer-measure').classList.remove('active');
    clearMeasurementState();
  }
  document.getElementById('layer-elevation').classList.toggle('active', state.elevationMode);
  state.map.getContainer().style.cursor = state.elevationMode ? 'crosshair' : '';

  if (!state.elevationMode) {
    clearElevationState();
  }
}

function toggleMeasureMode() {
  state.measureMode = !state.measureMode;
  if (state.measureMode && state.elevationMode) {
    state.elevationMode = false;
    document.getElementById('layer-elevation').classList.remove('active');
    clearElevationState();
  }
  document.getElementById('layer-measure').classList.toggle('active', state.measureMode);
  state.map.getContainer().style.cursor = state.measureMode ? 'crosshair' : '';

  if (!state.measureMode) {
    clearMeasurementState();
  }
}

function clearMeasurementState() {
  state.measureMarkers.forEach(m => state.map.removeLayer(m));
  state.measureMarkers = [];
  state.measurePoints = [];
  if (state.measureLine) { state.map.removeLayer(state.measureLine); state.measureLine = null; }
  state.measureTooltips.forEach(t => state.map.removeLayer(t));
  state.measureTooltips = [];
  const panel = document.getElementById('elevation-panel');
  if (panel) panel.style.display = 'none';
}

// Helper functions for measurement tool
function computeDistance(p1, p2) {
  return p1.distanceTo(p2); // meters
}

function formatDistance(meters) {
  return formatDist(meters);
}

function updateMeasurementLine() {
  if (state.measureLine) {
    state.map.removeLayer(state.measureLine);
    state.measureLine = null;
  }
  if (state.measurePoints.length >= 2) {
    state.measureLine = L.polyline(state.measurePoints, {
      color: '#4fc3f7',
      weight: 3,
      dashArray: null
    }).addTo(state.map);
  }
}

function updateMeasurementTooltips() {
  // Remove existing tooltips
  state.measureTooltips.forEach(t => state.map.removeLayer(t));
  state.measureTooltips = [];
  
  // Add tooltips for each segment
  for (let i = 0; i < state.measurePoints.length - 1; i++) {
    const p1 = state.measurePoints[i];
    const p2 = state.measurePoints[i + 1];
    const distance = computeDistance(p1, p2);
    const cumulative = state.measurePoints.slice(0, i + 1).reduce((total, _, idx, arr) => {
      if (idx === 0) return 0;
      return total + computeDistance(arr[idx - 1], arr[idx]);
    }, 0) + distance;
    
    const midpoint = L.latLng(
      (p1.lat + p2.lat) / 2,
      (p1.lng + p2.lng) / 2
    );
    
    const tooltip = L.tooltip({
      permanent: true,
      direction: 'center',
      className: 'measure-tooltip',
      offset: [0, 0]
    })
      .setLatLng(midpoint)
      .setContent(`<div class="measure-segment">${formatDistance(distance)}</div><div class="measure-cumulative">Σ ${formatDistance(cumulative)}</div>`)
      .addTo(state.map);
    state.measureTooltips.push(tooltip);
  }
}

function clearMeasurement() {
  clearMeasurementState();
}

function clearRoute() {
  if (state.elevationMode) clearElevationState();
  if (state.measureMode) clearMeasurementState();
}

function removeLastPoint() {
  if (state.elevationMode && state.elevationPoints.length > 0) {
    const marker = state.elevationPoints.pop();
    state.elevationCoords.pop();
    if (marker) state.map.removeLayer(marker);
    // Update line
    if (state.elevationLine) state.map.removeLayer(state.elevationLine);
    if (state.elevationCoords.length >= 2) {
      state.elevationLine = L.polyline(state.elevationCoords, { 
        color: '#ff6b35', 
        weight: 3, 
        dashArray: '8 4'
      }).addTo(state.map);
    } else {
      state.elevationLine = null;
    }
    // Update profile panel if needed
    if (state.elevationCoords.length < 2) {
      const panel = document.getElementById('elevation-panel');
      if (panel) panel.style.display = 'none';
    }
  }
  if (state.measureMode && state.measureMarkers.length > 0) {
    const marker = state.measureMarkers.pop();
    state.measurePoints.pop();
    if (marker) state.map.removeLayer(marker);
    // Update measurement line and tooltips
    updateMeasurementLine();
    updateMeasurementTooltips();
    // Hide panel if no points
    if (state.measurePoints.length === 0) {
      const panel = document.getElementById('elevation-panel');
      if (panel) panel.style.display = 'none';
    }
  }
}

function addElevationPoint() {
  // This function would typically prompt user for a location
  // For now, we'll just focus the map and show a message
  alert('Click on the map to add an elevation point');
}

function clearElevationState() {
  state.elevationPoints.forEach(m => state.map.removeLayer(m));
  state.elevationPoints = [];
  if (state.elevationLine) { state.map.removeLayer(state.elevationLine); state.elevationLine = null; }
  const panel = document.getElementById('elevation-panel');
  if (panel) panel.style.display = 'none';
}

async function handleRouteClick(latlng) {
  const isElevation = state.elevationMode;
  const isMeasure = state.measureMode;
  if (!isElevation && !isMeasure) return;

  if (isElevation) {
    // Elevation mode
    const icon = makeIcon('📍');
    const marker = L.marker([latlng.lat, latlng.lng], { icon }).addTo(state.map);
    state.elevationPoints.push(marker);
    state.elevationCoords.push(latlng);

    // If first point, query elevation at point
    if (state.elevationPoints.length === 1) {
      try {
        const data = await apiGet('/api/elevation', { lat: latlng.lat.toFixed(6), lon: latlng.lng.toFixed(6) });
        marker.bindPopup(`<div class="popup-title">📏 Elevation</div>
          <div class="popup-meta">${data.elevation_m != null ? data.elevation_m + ' m' : 'No data'}</div>
          <div class="popup-meta">${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}</div>`).openPopup();
      } catch (e) { /* silent */ }
    }

    // Update route line
    if (state.elevationLine) state.map.removeLayer(state.elevationLine);
    if (state.elevationCoords.length >= 2) {
      state.elevationLine = L.polyline(state.elevationCoords, { 
        color: '#ff6b35', 
        weight: 3, 
        dashArray: '8 4'
      }).addTo(state.map);
    }

    // Determine mode: single segment (auto‑profile) vs multi‑point route
    const mode = state.elevationModeType; // 'single' or 'multi'
    if (state.elevationCoords.length === 2 && mode === 'single') {
      // Two points in single‑segment mode → fetch elevation profile
      await loadElevationProfile(state.elevationCoords[0], state.elevationCoords[1]);
      // Auto‑clear after delay (existing behavior)
      setTimeout(() => { clearElevationState(); }, 15000);
    } else if (state.elevationCoords.length >= 2 && mode === 'multi') {
      // Multi‑point route: fetch profile for each new segment and merge
      await updateMultiPointElevationProfile();
    }
  }

  if (isMeasure) {
    // Measurement mode
    const icon = makeIcon('📍');
    const marker = L.marker([latlng.lat, latlng.lng], { icon }).addTo(state.map);
    state.measureMarkers.push(marker);
    state.measurePoints.push(latlng);

    // Update measurement line and tooltips
    updateMeasurementLine();
    updateMeasurementTooltips();
  }

  // Show the route tools panel if not already visible
  const panel = document.getElementById('elevation-panel');
  if (panel) panel.style.display = 'block';
}

async function loadElevationProfile(p1, p2) {
  const dist = p1.distanceTo(p2);
  const numPoints = Math.min(Math.max(Math.round(dist / 50), 10), 100);
  try {
    const data = await apiGet('/api/elevation/profile', {
      lat1: p1.lat.toFixed(6), lon1: p1.lng.toFixed(6),
      lat2: p2.lat.toFixed(6), lon2: p2.lng.toFixed(6),
      points: numPoints,
    });
    showElevationPanel(data);
  } catch (e) { /* silent */ }
}

function showElevationProfile(data) {
  const panel = document.getElementById('elevation-panel');
  const canvas = document.getElementById('elevation-canvas');
  if (!panel || !canvas) return;

  panel.style.display = 'block';
  const pts = data.points.filter(p => p.elevation_m != null);
  if (pts.length < 2) { panel.style.display = 'none'; return; }

  const minEl = Math.min(...pts.map(p => p.elevation_m));
  const maxEl = Math.max(...pts.map(p => p.elevation_m));
  const pad = Math.max((maxEl - minEl) * 0.1, 10);

  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.clientWidth * 2;
  const H = canvas.height = canvas.clientHeight * 2;
  ctx.clearRect(0, 0, W, H);

  // Draw filled area
  ctx.beginPath();
  ctx.moveTo(0, H);
  pts.forEach((p, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - ((p.elevation_m - minEl + pad) / (maxEl - minEl + pad * 2)) * H;
    ctx.lineTo(x, y);
  });
  ctx.lineTo(W, H);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,107,53,0.6)');
  grad.addColorStop(1, 'rgba(255,107,53,0.05)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw line
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - ((p.elevation_m - minEl + pad) / (maxEl - minEl + pad * 2)) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#ff6b35';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Labels
  document.getElementById('el-gain').textContent = `↑${data.elevation_gain_m}m`;
  document.getElementById('el-loss').textContent = `↓${data.elevation_loss_m}m`;
  document.getElementById('el-min').textContent = `Min: ${data.elevation_min_m}m`;
  document.getElementById('el-max').textContent = `Max: ${data.elevation_max_m}m`;
}

function showElevationPanel(data) {
  const panel = document.getElementById('elevation-panel');
  if (!panel) return;
  panel.style.display = 'block';

  const closeBtn = document.getElementById('elevation-close');
  if (closeBtn) closeBtn.onclick = () => { panel.style.display = 'none'; clearElevationState(); };

  showElevationProfile(data);
}

// ---------------------------------------------------------------------------
// Custom place modal
// ---------------------------------------------------------------------------
function showAddPlaceModal(lat, lon) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-add-place';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Add Custom Place</h3>
      <label>Name</label>
      <input type="text" id="cp-name" placeholder="Place name" required>
      <label>Type</label>
      <select id="cp-type">
        <option value="amenity">Amenity</option>
        <option value="shop">Shop</option>
        <option value="tourism">Tourism</option>
        <option value="leisure">Leisure</option>
      </select>
      <label>Subtype</label>
      <input type="text" id="cp-subtype" placeholder="cafe, restaurant, pharmacy...">
      <label>Notes</label>
      <textarea id="cp-notes" placeholder="Optional notes"></textarea>
      <div class="meta" style="margin-top:8px;font-size:11px;color:var(--text-dim)">
        📍 ${lat.toFixed(5)}, ${lon.toFixed(5)}
      </div>
      <div class="btn-row">
        <button class="btn-secondary" onclick="closeModals()">Cancel</button>
        <button class="btn" onclick="submitCustomPlace(${lat}, ${lon})">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModals(); });
  document.getElementById('cp-name').focus();
}
window.showAddPlaceModal = showAddPlaceModal;

async function submitCustomPlace(lat, lon) {
  const name = document.getElementById('cp-name').value.trim();
  if (!name) { alert('Name required'); return; }

  try {
    await apiPost('/api/places/custom', {
      name,
      lat, lon,
      type: document.getElementById('cp-type').value,
      subtype: document.getElementById('cp-subtype').value.trim(),
      notes: document.getElementById('cp-notes').value.trim(),
    });
    closeModals();
    if (state.activeTab === 'custom') loadCustomPlaces();
    // Refresh custom layer if visible
    if (state.customPlacesVisible) toggleCustomPlaces();
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}
window.submitCustomPlace = submitCustomPlace;

async function deleteCustomPlace(id) {
  if (!confirm('Delete this place?')) return;
  try {
    await apiDelete(`/api/places/custom/${id}`);
    loadCustomPlaces();
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}
window.deleteCustomPlace = deleteCustomPlace;

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
}
window.closeModals = closeModals;

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function showLoading() {
  document.getElementById('sidebar-content').innerHTML = '<div class="loading">Searching</div>';
}

function showEmpty(msg) {
  document.getElementById('sidebar-content').innerHTML = `
    <div class="empty-state">
      <div class="icon">🗺️</div>
      <div>${esc(msg)}</div>
    </div>`;
}

function showError(msg) {
  document.getElementById('sidebar-content').innerHTML = `
    <div class="empty-state">
      <div class="icon">⚠️</div>
      <div style="color:var(--red)">${esc(msg)}</div>
    </div>`;
}

function updateStatusBar() {
  const center = state.map.getCenter();
  const zoom = state.map.getZoom();
  const bar = document.getElementById('status-bar');
  if (bar) {
    bar.innerHTML = `<span>${center.lat.toFixed(4)}, ${center.lng.toFixed(4)} · z${zoom}</span>
      <span>${state.results.length} results · ${state.markers.length} markers</span>`;
  }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
function formatDist(m) {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function formatPeriod(p) {
  const labels = {
    early_morning: 'Early AM',
    morning_rush: 'AM Rush',
    midday: 'Midday',
    evening_rush: 'PM Rush',
    evening: 'Evening',
    night: 'Night',
  };
  return labels[p] || p;
}

function formatSAC(s) {
  const m = {
    hiking: 'T1 Easy', mountain_hiking: 'T2 Moderate', demanding_mountain_hiking: 'T3 Hard',
    alpine_hiking: 'T4 Alpine', demanding_alpine_hiking: 'T5 Difficult', difficult_alpine_hiking: 'T6 Extreme',
    strolling: 'Stroll',
  };
  return m[s] || s;
}

// ---------------------------------------------------------------------------
// Map Legend
// ---------------------------------------------------------------------------
function showLegendModal() {
  const existing = document.getElementById('legend-modal');
  if (existing) { existing.remove(); return; }
  const layers = [
    { icon: '📍', name: 'OSM Places', desc: 'Restaurants, cafés, shops, POIs from OpenStreetMap' },
    { icon: '⭐', name: 'Custom Places', desc: 'Airports, malls, hospitals, universities, ski resorts, ferry terminals' },
    { icon: '🚇', name: 'Transit', desc: 'SkyTrain stations and bus stops' },
    { icon: '🥾', name: 'Trails', desc: 'BC hiking trails with difficulty ratings' },
    { icon: '📏', name: 'Elevation', desc: 'Point elevation query and multi-point profiles' },
    { icon: '📐', name: 'Measure', desc: 'Distance measurement between points' },
    { icon: '⛴️', name: 'Ferries', desc: 'BC Ferries terminals with schedules and capacity' },
    { icon: '☁️', name: 'Weather', desc: 'Current conditions and hourly forecast (Open-Meteo)' },
  ];
  const modal = document.createElement('div');
  modal.id = 'legend-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal legend-modal-content">
      <div class="modal-header">
        <h3>📖 Map Legend</h3>
        <button class="btn-icon" onclick="document.getElementById('legend-modal').remove()">✕</button>
      </div>
      <div class="legend-grid">
        ${layers.map(l => `
          <div class="legend-item">
            <span class="legend-icon">${l.icon}</span>
            <div class="legend-info">
              <strong>${l.name}</strong>
              <span>${l.desc}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// ---------------------------------------------------------------------------
// Dark/Light Theme
// ---------------------------------------------------------------------------
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  updateThemeIcon();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.getElementById('btn-theme');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.textContent = isDark ? '☀️' : '🌙';
}

// ---------------------------------------------------------------------------
// Search History
// ---------------------------------------------------------------------------
function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem('searchHistory') || '[]'); }
  catch { return []; }
}

function saveSearchHistory(query) {
  if (!query || query.trim().length < 2) return;
  let history = getSearchHistory();
  // Remove duplicate
  history = history.filter(h => h.q.toLowerCase() !== query.toLowerCase());
  history.unshift({ q: query, ts: Date.now() });
  // Keep last 10
  history = history.slice(0, 10);
  localStorage.setItem('searchHistory', JSON.stringify(history));
}

function showSearchHistory() {
  const dropdown = document.getElementById('search-history');
  if (!dropdown) return;
  const history = getSearchHistory();
  if (history.length === 0) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = history.map(h => {
    const ago = timeAgo(h.ts);
    return `<div class="history-item" onclick="applySearchHistory('${esc(h.q)}')">
      <span class="history-query">${esc(h.q)}</span>
      <span class="history-time">${ago}</span>
    </div>`;
  }).join('') + '<div class="history-item history-clear" onclick="clearSearchHistory()">🗑️ Clear history</div>';
  dropdown.style.display = 'block';
}

function hideSearchHistory() {
  const dropdown = document.getElementById('search-history');
  if (dropdown) dropdown.style.display = 'none';
}

function applySearchHistory(query) {
  document.getElementById('search-input').value = query;
  hideSearchHistory();
  handleSearch();
}

function clearSearchHistory() {
  localStorage.removeItem('searchHistory');
  hideSearchHistory();
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

function difficultyBadge(sac) {
  if (!sac) return '';
  const level = sac.replace(/^(demanding_|difficult_)/, '').replace('_hiking', '').replace('mountain', 't2');
  const cls = { hiking: 't1', mountain_hiking: 't2', demanding_mountain_hiking: 't3',
    alpine_hiking: 't4', demanding_alpine_hiking: 't5', difficult_alpine_hiking: 't6', strolling: 't1' }[sac] || 't1';
  return `<span class="trail-difficulty ${cls}">${esc(formatSAC(sac))}</span>`;
}

function trailColor(sac) {
  return { hiking: '#4caf50', mountain_hiking: '#8bc34a', demanding_mountain_hiking: '#ffc107',
    alpine_hiking: '#ff9800', demanding_alpine_hiking: '#f44336', difficult_alpine_hiking: '#9c27b0',
    strolling: '#4caf50' }[sac] || '#4fc3f7';
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
