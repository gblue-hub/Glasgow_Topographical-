import { useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import { recordCoordinate } from "../domain/geographic-knowledge";
import type { LearningRecord } from "../domain/types";
import "leaflet/dist/leaflet.css";
import "./map-tap-mission.css";

const metresBetween = (left: [number, number], right: [number, number]) => {
  const latitude = ((left[1] + right[1]) / 2) * Math.PI / 180;
  return Math.hypot((left[0] - right[0]) * 111320 * Math.cos(latitude), (left[1] - right[1]) * 110540);
};

function TapHandler({ onTap }: { onTap: (coordinate: [number, number]) => void }) {
  useMapEvents({ click: (event) => onTap([event.latlng.lng, event.latlng.lat]) });
  return null;
}

export function MapTapMission({ record, onClear, onSkip }: { record: LearningRecord; onClear: () => void; onSkip: () => void }) {
  const target = recordCoordinate(record);
  const [guess, setGuess] = useState<[number, number] | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const tolerance = record.type === "district" ? 900 : record.type === "middle_road" ? 700 : 400;
  if (!target) return null;
  const tap = (coordinate: [number, number]) => {
    const nextDistance = metresBetween(coordinate, target);
    setGuess(coordinate);
    setDistance(nextDistance);
    if (nextDistance <= tolerance) onClear();
  };
  const cleared = distance !== null && distance <= tolerance;
  return <section className={`map-tap-mission ${cleared ? "cleared" : distance !== null ? "retry" : ""}`}>
    <header><div><p className="eyebrow">ACTIVE WORK · MAP TAP</p><h3>Place {record.exam_name} in Glasgow.</h3></div><span>{cleared ? "+ location secured" : `Within ${tolerance}m`}</span></header>
    <div><MapContainer center={[55.8642, -4.2518]} zoom={11} zoomControl={true} scrollWheelZoom={false}><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" opacity={.68} /><TapHandler onTap={tap} />{guess && <CircleMarker center={[guess[1], guess[0]]} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: cleared ? "#087a55" : "#b42318", fillOpacity: 1 }}><Tooltip permanent>{cleared ? "Located" : `${Math.round(distance!)}m away`}</Tooltip></CircleMarker>}{cleared && <CircleMarker center={[target[1], target[0]]} radius={5} pathOptions={{ color: "#087a55", fillColor: "#087a55", fillOpacity: 1 }} />}</MapContainer></div>
    <footer><span>{distance === null ? "Tap where you believe it belongs." : cleared ? "Good—now recall the exact answer without the map." : "Use the city shape and try a closer point."}</span>{!cleared && <button type="button" className="back" onClick={onSkip}>Skip location</button>}</footer>
  </section>;
}
