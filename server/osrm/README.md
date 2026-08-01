# Glasgow taxi backend

This container serves generated course content from `/api/content/` and
routing responses from OSRM.

`glasgow-taxi-area.osm.pbf` is the OpenStreetMap input prepared for local
OSRM preprocessing and route testing.

## Coverage

- Contains every one of the 5,170 course-content coordinates; no learning
  locations were excluded.
- The extraction boundary is the course-data bounding box plus an
  approximately 3 km margin on every side.
- Long roads may finish outside the extraction boundary after their final
  relevant connection. The `complete_ways` extraction strategy preserves
  complete ways crossing the boundary so roads do not stop exactly at the
  boundary.
- Exact coverage geometry is recorded in
  `glasgow-taxi-routing-bounds.geojson`.

## Source and extraction

- Source: Geofabrik Scotland snapshot dated 2026-07-24
- Source URL:
  `https://download.geofabrik.de/europe/united-kingdom/scotland-260724.osm.pbf`
- Extraction strategy: Osmium `complete_ways`
- Extract size: 28,994,301 bytes
- SHA-256:
  `B709D0FEC83A80369D94980ED24E25D839A0C6881F51270717B10B90565942A6`

The extract passed Osmium's node-to-way reference check with no missing node
references. It is ready to be passed through the normal OSRM `extract`,
`partition`, and `customize` pipeline. The application integration uses the
standard car profile route API through the local development proxy.

## Prepare and run locally

With Docker Desktop running, execute these commands from the repository root:

```powershell
docker run --rm -t -v "${PWD}/server/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/glasgow-taxi-area.osm.pbf
docker run --rm -t -v "${PWD}/server/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/glasgow-taxi-area.osrm
docker run --rm -t -v "${PWD}/server/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/glasgow-taxi-area.osrm
```

Start the routing service:

```powershell
docker run --rm -t -p 5000:5000 -v "${PWD}/server/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld /data/glasgow-taxi-area.osrm
```

The Vite development server proxies `/api/osrm` to
`http://127.0.0.1:5000` by default. Set the server-side `OSRM_BASE_URL`
environment variable before `npm run dev` to use a different service. A
deployed frontend sets `VITE_BACKEND_BASE_URL` at build time.

## Public deployment

`render.yaml` deploys the React frontend and the
`glasgow-topographical-taxi-osrm` backend service. During the backend image
build, Render generates the five course-content contracts and the MLD routing
files. Nginx serves the contracts and proxies routing requests to OSRM with
HTTPS and browser CORS headers. The frontend receives the backend URL through
`VITE_BACKEND_BASE_URL`; no course dataset is bundled into the frontend.
