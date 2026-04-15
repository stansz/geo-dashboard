# Geo Dashboard

A personal geo web dashboard with interactive map, POI search, BC trails, SkyTrain schedules, and custom places.

## Architecture

```
┌────────────────────┐         ┌──────────────────┐
│  Cloudflare Pages  │  fetch  │  VPS (Flask API) │
│  (Frontend Static) │────────▶│  bin/geo-api.py  │
│  HTML/JS/CSS       │         │  Port 8090       │
└────────────────────┘         └────────┬─────────┘
                                        │
                               ┌────────┴─────────┐
                               │   SQLite DBs      │
                               │  data/*.db        │
                               └──────────────────┘
```

## Quick Start (Local)

```bash
# 1. Start the API
python3 bin/geo-api.py --port 8090

# 2. Serve the frontend
cd web/geo-dashboard
python3 -m http.server 3000
# Open http://localhost:3000

# 3. Or just open index.html directly
```

### Configure API URL

For production, set `window.GEO_API_URL` before `app.js` loads in `index.html`:

```html
<script>window.GEO_API_URL = 'https://your-api.example.com';</script>
```

Or for a reverse-proxy setup (API on same domain), leave it empty — the frontend will use relative paths.

## Deploy Frontend → Cloudflare Pages

### One-click setup

1. Push this folder to GitHub
2. Go to [Cloudflare Dashboard → Pages](https://dash.cloudflare.com/?to=/:account/pages)
3. Click **Create a project** → **Connect to Git**
4. Select your repo
5. Settings:
   - **Build command:** _(leave empty)_
   - **Build output directory:** `web/geo-dashboard` (or `.` if this is the repo root)
6. Deploy!

### Manual deploy (Wrangler CLI)

```bash
npm install -g wrangler
cd web/geo-dashboard
wrangler pages deploy . --project-name=geo-dashboard
```

### Custom domain (optional)

In Cloudflare Pages settings → Custom domains → Add your domain.

## Deploy Backend → VPS

See `../../README.md` or run:

```bash
# Quick
python3 bin/geo-api.py --port 8090

# Production (systemd)
sudo tee /etc/systemd/system/geo-api.service << 'EOF'
[Unit]
Description=Geo Dashboard API
After=network.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/home/openclaw/.openclaw/workspace
ExecStart=/usr/bin/python3 bin/geo-api.py --port 8090
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now geo-api
```

### Caddy reverse proxy (recommended)

```
your-domain.com {
    handle /api/* {
        reverse_proxy localhost:8090
    }
    handle {
        root * /path/to/web/geo-dashboard
        file_server
    }
}
```

Or use Cloudflare Pages for frontend + proxy `/api/*` to VPS via Cloudflare Workers.

## GPS Share Page

Open `gps.html` on your phone to share your GPS location to the dashboard.
Lightweight, works on Android 6+, auto-saves to localStorage and sends to API.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/places/search?q=&lat=&lon=&radius=` | Search POIs |
| GET | `/api/places/near?lat=&lon=&type=` | Nearby POIs |
| GET | `/api/places/custom` | List custom places |
| POST | `/api/places/custom` | Add custom place |
| DELETE | `/api/places/custom/<id>` | Delete custom place |
| GET | `/api/trails/search?q=` | Search trails |
| GET | `/api/trails/near?lat=&lon=` | Nearby trails |
| GET | `/api/trails/info/<id>?geojson=1` | Trail details + GeoJSON |
| GET | `/api/transit/stations?q=` | Search stations |
| GET | `/api/transit/schedule?station=&day=` | Station schedule |
| GET | `/api/transit/nearest?lat=&lon=` | Nearest stations |
| GET | `/api/geocode?q=` | Local geocoder |
| POST | `/api/location` | Store client GPS |
