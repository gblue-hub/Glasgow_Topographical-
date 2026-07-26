# Glasgow taxi OSRM data

`glasgow-taxi-area.osm.pbf` is the OpenStreetMap input prepared for local
OSRM preprocessing and route testing.

## Coverage

- Contains every one of the 5,170 coordinates currently published in
  `public/data/learning-content.v1.json`; no learning locations were excluded.
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
docker run --rm -t -v "${PWD}/data/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/glasgow-taxi-area.osm.pbf
docker run --rm -t -v "${PWD}/data/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/glasgow-taxi-area.osrm
docker run --rm -t -v "${PWD}/data/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/glasgow-taxi-area.osrm
```

Start the routing service:

```powershell
docker run --rm -t -p 5000:5000 -v "${PWD}/data/osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld /data/glasgow-taxi-area.osrm
```

The Vite development server proxies `/api/osrm` to
`http://127.0.0.1:5000` by default. Set the server-side `OSRM_BASE_URL`
environment variable before `npm run dev` to use a different service. A
deployed static build can instead set `VITE_OSRM_BASE_URL` at build time.

## Public deployment

`render.yaml` keeps the learner application as its existing static service and
adds `glasgow-topographical-taxi-osrm` as a free Docker web service. Render
builds the MLD routing files from this extract inside its own build
environment, then runs OSRM behind a small Nginx layer that supplies HTTPS
access and browser CORS headers. The static app receives the hosted routing
URL through `VITE_OSRM_BASE_URL`; Docker is not required on a learner's device
or on the developer's computer for the deployed app to operate.
