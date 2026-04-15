/* Geo Dashboard — Frontend logic (vanilla JS, Leaflet) */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API = window.GEO_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:8090' : '');
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
};

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initUI();
  tryGeolocation();
});

function initMap() {
  state.map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
  });

  L.control.zoom({ position: 'bottomleft' }).addTo(state.map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);

  // Click on map to add custom place
  state.map.on('click', (e) => {
    if (state.activeTab === 'custom') {
      showAddPlaceModal(e.latlng.lat, e.latlng.lng);
    }
  });

  // Update status bar on move
  state.map.on('moveend', updateStatusBar);
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

  // Floating GPS share button
  document.getElementById('gps-share-btn').addEventListener('click', () => {
    tryGeolocation();
    showGpsStatus('Getting location...');
  });

  // Sidebar toggle
  document.getElementById('btn-sidebar').addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen;
    document.querySelector('.sidebar').classList.toggle('collapsed', !state.sidebarOpen);
    state.map.invalidateSize();
  });

  // Layer toggles
  document.getElementById('layer-custom').addEventListener('click', toggleCustomPlaces);
  document.getElementById('layer-transit').addEventListener('click', toggleTransit);

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

async function searchPlaces(q) {
  showLoading();
  try {
    let lat = state.lat, lon = state.lon, radius = 5000;

    // Geocode location if specified
    if (q.location) {
      const geo = await apiGet('/api/geocode', { q: q.location });
      if (geo.length > 0) {
        lat = geo[0].lat;
        lon = geo[0].lon;
        radius = 5000;
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
        lat: state.lat, lon: state.lon, radius: 20000, limit: 20,
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
      }
    });
  });
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
    html: `<div style="font-size:22px;text-shadow:1px 1px 2px #000;transform:translate(-50%,-50%)">${emoji}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
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
  }
}

async function loadCustomPlaces() {
  showLoading();
  try {
    const data = await apiGet('/api/places/custom');
    state.results = data;
    renderResults(data, 'places');
    placeCustomMarkers(data);
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
      lat: state.lat, lon: state.lon, radius: 2000, limit: 30,
    });
    state.results = data;
    renderResults(data, 'places');
    placeMarkers(data);
  } catch (e) {
    showError('Failed: ' + e.message);
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
