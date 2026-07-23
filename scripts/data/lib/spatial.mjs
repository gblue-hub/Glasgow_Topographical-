const radians = (degrees) => degrees * Math.PI / 180;
const degrees = (radiansValue) => radiansValue * 180 / Math.PI;

function cartesian(lat, lon, height, a, b) {
  const e2 = 1 - (b * b) / (a * a);
  const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return {
    x: (nu + height) * Math.cos(lat) * Math.cos(lon),
    y: (nu + height) * Math.cos(lat) * Math.sin(lon),
    z: ((1 - e2) * nu + height) * Math.sin(lat),
  };
}

function transform(point, { tx, ty, tz, rx, ry, rz, scale }) {
  const arcseconds = Math.PI / (180 * 3600);
  const s = 1 + scale * 1e-6;
  const xRot = rx * arcseconds;
  const yRot = ry * arcseconds;
  const zRot = rz * arcseconds;
  return {
    x: tx + point.x * s - point.y * zRot + point.z * yRot,
    y: ty + point.x * zRot + point.y * s - point.z * xRot,
    z: tz - point.x * yRot + point.y * xRot + point.z * s,
  };
}

function geodetic(point, a, b) {
  const e2 = 1 - (b * b) / (a * a);
  const p = Math.hypot(point.x, point.y);
  let lat = Math.atan2(point.z, p * (1 - e2));
  let previous;
  do {
    previous = lat;
    const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(point.z + e2 * nu * Math.sin(lat), p);
  } while (Math.abs(lat - previous) > 1e-12);
  return { lat, lon: Math.atan2(point.y, point.x) };
}

const AIRY = { a: 6377563.396, b: 6356256.909 };
const WGS84 = { a: 6378137, b: 6356752.3141 };
const WGS_TO_OSGB = {
  tx: -446.448, ty: 125.157, tz: -542.06,
  rx: -0.1502, ry: -0.247, rz: -0.8421, scale: 20.4894,
};
const OSGB_TO_WGS = Object.fromEntries(
  Object.entries(WGS_TO_OSGB).map(([key, value]) => [key, -value]),
);

function projectOsGrid(lat, lon) {
  const { a, b } = AIRY;
  const f0 = 0.9996012717;
  const lat0 = radians(49);
  const lon0 = radians(-2);
  const n0 = -100000;
  const e0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);
  const nu = a * f0 / Math.sqrt(1 - e2 * sinLat ** 2);
  const rho = a * f0 * (1 - e2) / (1 - e2 * sinLat ** 2) ** 1.5;
  const eta2 = nu / rho - 1;
  const dLat = lat - lat0;
  const sumLat = lat + lat0;
  const m = b * f0 * (
    (1 + n + 5 / 4 * n ** 2 + 5 / 4 * n ** 3) * dLat
    - (3 * n + 3 * n ** 2 + 21 / 8 * n ** 3) * Math.sin(dLat) * Math.cos(sumLat)
    + (15 / 8 * n ** 2 + 15 / 8 * n ** 3) * Math.sin(2 * dLat) * Math.cos(2 * sumLat)
    - 35 / 24 * n ** 3 * Math.sin(3 * dLat) * Math.cos(3 * sumLat)
  );
  const dLon = lon - lon0;
  const i = m + n0;
  const ii = nu / 2 * sinLat * cosLat;
  const iii = nu / 24 * sinLat * cosLat ** 3 * (5 - tanLat ** 2 + 9 * eta2);
  const iiia = nu / 720 * sinLat * cosLat ** 5 * (61 - 58 * tanLat ** 2 + tanLat ** 4);
  const iv = nu * cosLat;
  const v = nu / 6 * cosLat ** 3 * (nu / rho - tanLat ** 2);
  const vi = nu / 120 * cosLat ** 5 * (5 - 18 * tanLat ** 2 + tanLat ** 4 + 14 * eta2 - 58 * tanLat ** 2 * eta2);
  return {
    x: e0 + iv * dLon + v * dLon ** 3 + vi * dLon ** 5,
    y: i + ii * dLon ** 2 + iii * dLon ** 4 + iiia * dLon ** 6,
  };
}

function unprojectOsGrid(easting, northing) {
  const { a, b } = AIRY;
  const f0 = 0.9996012717;
  const lat0 = radians(49);
  const lon0 = radians(-2);
  const n0 = -100000;
  const e0 = 400000;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  let lat = lat0;
  let m = 0;
  do {
    lat = (northing - n0 - m) / (a * f0) + lat;
    const dLat = lat - lat0;
    const sumLat = lat + lat0;
    m = b * f0 * (
      (1 + n + 5 / 4 * n ** 2 + 5 / 4 * n ** 3) * dLat
      - (3 * n + 3 * n ** 2 + 21 / 8 * n ** 3) * Math.sin(dLat) * Math.cos(sumLat)
      + (15 / 8 * n ** 2 + 15 / 8 * n ** 3) * Math.sin(2 * dLat) * Math.cos(2 * sumLat)
      - 35 / 24 * n ** 3 * Math.sin(3 * dLat) * Math.cos(3 * sumLat)
    );
  } while (Math.abs(northing - n0 - m) >= 0.00001);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);
  const nu = a * f0 / Math.sqrt(1 - e2 * sinLat ** 2);
  const rho = a * f0 * (1 - e2) / (1 - e2 * sinLat ** 2) ** 1.5;
  const eta2 = nu / rho - 1;
  const dE = easting - e0;
  const vii = tanLat / (2 * rho * nu);
  const viii = tanLat / (24 * rho * nu ** 3) * (5 + 3 * tanLat ** 2 + eta2 - 9 * tanLat ** 2 * eta2);
  const ix = tanLat / (720 * rho * nu ** 5) * (61 + 90 * tanLat ** 2 + 45 * tanLat ** 4);
  const x = 1 / (cosLat * nu);
  const xi = 1 / (6 * cosLat * nu ** 3) * (nu / rho + 2 * tanLat ** 2);
  const xii = 1 / (120 * cosLat * nu ** 5) * (5 + 28 * tanLat ** 2 + 24 * tanLat ** 4);
  const xiia = 1 / (5040 * cosLat * nu ** 7) * (61 + 662 * tanLat ** 2 + 1320 * tanLat ** 4 + 720 * tanLat ** 6);
  return { lat: lat - vii * dE ** 2 + viii * dE ** 4 - ix * dE ** 6, lon: lon0 + x * dE - xi * dE ** 3 + xii * dE ** 5 - xiia * dE ** 7 };
}

export function wgs84ToBng([longitude, latitude]) {
  const wgsCartesian = cartesian(radians(latitude), radians(longitude), 0, WGS84.a, WGS84.b);
  const airy = geodetic(transform(wgsCartesian, WGS_TO_OSGB), AIRY.a, AIRY.b);
  return projectOsGrid(airy.lat, airy.lon);
}

export function bngToWgs84({ x, y }) {
  const airy = unprojectOsGrid(x, y);
  const airyCartesian = cartesian(airy.lat, airy.lon, 0, AIRY.a, AIRY.b);
  const wgs = geodetic(transform(airyCartesian, OSGB_TO_WGS), WGS84.a, WGS84.b);
  return [degrees(wgs.lon), degrees(wgs.lat)];
}

export function readGpkgGeometry(blob) {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== 0x47 || view.getUint8(1) !== 0x50) throw new Error('Invalid GeoPackage geometry');
  const flags = view.getUint8(3);
  const envelopeCode = (flags >> 1) & 7;
  const envelopeBytes = [0, 32, 48, 48, 64][envelopeCode];
  let offset = 8 + envelopeBytes;
  const littleEndian = view.getUint8(offset) === 1;
  offset += 1;
  let type = view.getUint32(offset, littleEndian);
  offset += 4;
  type %= 1000;
  if (type === 1) return { type: 'Point', coordinates: [view.getFloat64(offset, littleEndian), view.getFloat64(offset + 8, littleEndian)] };
  if (type !== 2) throw new Error(`Unsupported WKB geometry type ${type}`);
  const count = view.getUint32(offset, littleEndian);
  offset += 4;
  const coordinates = [];
  for (let index = 0; index < count; index += 1) {
    coordinates.push([view.getFloat64(offset, littleEndian), view.getFloat64(offset + 8, littleEndian)]);
    offset += 16;
  }
  return { type: 'LineString', coordinates };
}

export function pointToLineDistance(point, coordinates) {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const denominator = dx * dx + dy * dy;
    const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / denominator));
    best = Math.min(best, Math.hypot(point.x - (a[0] + t * dx), point.y - (a[1] + t * dy)));
  }
  return best;
}

export function nearestPointOnLine(point, coordinates) {
  let best = { distance: Number.POSITIVE_INFINITY, coordinate: null };
  for (let index = 1; index < coordinates.length; index += 1) {
    const a = coordinates[index - 1];
    const b = coordinates[index];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const denominator = dx * dx + dy * dy;
    const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / denominator));
    const coordinate = [a[0] + t * dx, a[1] + t * dy];
    const distance = Math.hypot(point.x - coordinate[0], point.y - coordinate[1]);
    if (distance < best.distance) best = { distance, coordinate, segmentIndex: index - 1, t };
  }
  return best;
}
