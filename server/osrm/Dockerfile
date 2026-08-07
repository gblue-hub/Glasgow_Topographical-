FROM node:22.15.0-bookworm-slim AS content

WORKDIR /app
COPY scripts ./scripts
COPY config ./config
COPY content-source ./content-source
COPY server/osrm/glasgow-taxi-area.osm.pbf ./server/osrm/glasgow-taxi-area.osm.pbf
RUN node --disable-warning=ExperimentalWarning scripts/data/build-canonical.mjs \
    && node --disable-warning=ExperimentalWarning scripts/app/build-learning-content.mjs

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS prepare

WORKDIR /work
COPY server/osrm/glasgow-taxi-area.osm.pbf .

RUN osrm-extract -p /opt/car.lua glasgow-taxi-area.osm.pbf \
    && osrm-partition glasgow-taxi-area.osrm \
    && osrm-customize glasgow-taxi-area.osrm

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/*

COPY --from=prepare /work/glasgow-taxi-area.osrm* /data/
COPY --from=content /app/.content-build/course-content /srv/course-content
COPY server/osrm/nginx.conf /etc/nginx/nginx.conf

EXPOSE 10000

CMD ["/bin/sh", "-c", "osrm-routed --algorithm mld --port 5000 /data/glasgow-taxi-area.osrm & exec nginx -g 'daemon off;'"]
