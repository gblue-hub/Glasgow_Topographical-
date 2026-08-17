import { TileLayer } from "react-leaflet";

const attribution =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export function TaxiMapTiles({
  labelled = true,
  opacity = 1,
}: {
  labelled?: boolean;
  opacity?: number;
}) {
  return (
    <TileLayer
      key={labelled ? "taxi-map-labelled" : "taxi-map-unlabelled"}
      attribution={attribution}
      url={`https://{s}.basemaps.cartocdn.com/${labelled ? "light_all" : "light_nolabels"}/{z}/{x}/{y}{r}.png`}
      opacity={opacity}
    />
  );
}
