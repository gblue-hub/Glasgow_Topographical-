import { useMemo, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import type { AppTheme, KnowledgeAreaId, MotionPreference, PersonalPlace, PersonalPlaceRelationship } from "../domain/types";
import { knowledgeAreaLabels } from "../domain/geographic-knowledge";
import "leaflet/dist/leaflet.css";
import "./settings.css";
import "./experience-settings.css";

const DELETE_PHRASE = "DELETE MY PROGRESS";
const GLASGOW_CENTRE: [number, number] = [-4.2518, 55.8642];

function MapClick({ onPick }: { onPick: (coordinate: [number, number]) => void }) {
  useMapEvents({
    click: (event) => onPick([event.latlng.lng, event.latlng.lat]),
  });
  return null;
}

const relationshipLabels: Record<PersonalPlaceRelationship, string> = {
  lived: "Lived here",
  worked: "Worked here",
  notable: "Notable place",
  other: "Other connection",
};

const dateRange = (place: PersonalPlace) => {
  if (!place.from_date && !place.to_date) return "No dates added";
  return `${place.from_date || "Unknown start"} – ${place.to_date || "present"}`;
};

type Props = {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  soundEffects: boolean;
  motionPreference: MotionPreference;
  onExperienceChange: (value: { soundEffects: boolean; motionPreference: MotionPreference }) => void;
  onResetProgress: () => Promise<boolean>;
  personalPlaces: PersonalPlace[];
  onSavePersonalPlace: (place: PersonalPlace) => Promise<void>;
  onDeletePersonalPlace: (id: string) => Promise<void>;
};

export function Settings({
  theme,
  onThemeChange,
  soundEffects,
  motionPreference,
  onExperienceChange,
  onResetProgress,
  personalPlaces,
  onSavePersonalPlace,
  onDeletePersonalPlace,
}: Props) {
  const [confirmation, setConfirmation] = useState("");
  const [resetStatus, setResetStatus] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState<KnowledgeAreaId>("centre");
  const [relationship, setRelationship] = useState<PersonalPlaceRelationship>("lived");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [note, setNote] = useState("");
  const [coordinate, setCoordinate] = useState<[number, number]>(GLASGOW_CENTRE);
  const [placeStatus, setPlaceStatus] = useState("");
  const sortedPlaces = useMemo(
    () => [...personalPlaces].sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
    [personalPlaces],
  );

  const clearPlaceForm = () => {
    setEditingId(null);
    setName("");
    setArea("centre");
    setRelationship("lived");
    setFromDate("");
    setToDate("");
    setNote("");
    setCoordinate(GLASGOW_CENTRE);
  };

  const editPlace = (place: PersonalPlace) => {
    setEditingId(place.id);
    setName(place.name);
    setArea(place.area);
    setRelationship(place.relationship);
    setFromDate(place.from_date);
    setToDate(place.to_date);
    setNote(place.note);
    setCoordinate(place.coordinate);
  };

  const savePlace = async () => {
    if (!name.trim()) return;
    const previous = personalPlaces.find((place) => place.id === editingId);
    const now = new Date().toISOString();
    await onSavePersonalPlace({
      id: previous?.id ?? crypto.randomUUID(),
      name: name.trim(),
      area,
      coordinate,
      relationship,
      from_date: fromDate,
      to_date: toDate,
      note: note.trim(),
      created_at: previous?.created_at ?? now,
      updated_at: now,
    });
    setPlaceStatus(`${name.trim()} was saved and is now available in Route Lab.`);
    clearPlaceForm();
  };

  return (
    <div className="settings-page">
      <header className="page-head">
        <div><p>YOUR APP</p><h1>Settings.</h1><span>Control appearance, learning data and the places that make Glasgow personal to you.</span></div>
      </header>

      <section className="settings-section">
        <div className="settings-section__heading"><span>01</span><div><h2>Appearance</h2><p>Switch the entire learner app between light and dark.</p></div></div>
        <div className="theme-options" role="radiogroup" aria-label="Colour theme">
          {(["light", "dark"] as const).map((value) => (
            <button type="button" role="radio" aria-checked={theme === value} className={theme === value ? "selected" : ""} onClick={() => onThemeChange(value)} key={value}>
              <i className={`theme-swatch theme-swatch--${value}`} aria-hidden="true" /><strong>{value === "light" ? "Light" : "Dark"}</strong><span>{value === "light" ? "Bright course workspace" : "Lower-glare night study"}</span>
            </button>
          ))}
        </div>
        <div className="experience-options">
          <label><span>Sound effects</span><button type="button" role="switch" aria-checked={soundEffects} onClick={() => onExperienceChange({ soundEffects: !soundEffects, motionPreference })}>{soundEffects ? "On" : "Off"}</button><small>Brief dispatch and answer cues. Off by default.</small></label>
          <label><span>Motion</span><select value={motionPreference} onChange={(event) => onExperienceChange({ soundEffects, motionPreference: event.target.value as MotionPreference })}><option value="system">Follow device setting</option><option value="full">Full route and reveal effects</option><option value="reduced">Reduce movement</option></select><small>Reduced motion keeps all information without animated travel.</small></label>
        </div>
      </section>

      <section className="settings-section settings-danger">
        <div className="settings-section__heading"><span>02</span><div><h2>Progress & data</h2><p>Delete quiz evidence, mastery, route runs and saved sessions. Your settings and personal places are kept.</p></div></div>
        <label><span>Type <b>{DELETE_PHRASE}</b> to unlock deletion</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
        <button type="button" className="danger-button" disabled={confirmation !== DELETE_PHRASE} onClick={async () => {
          const reset = await onResetProgress();
          setResetStatus(reset ? "All learning progress was deleted." : "Deletion was cancelled or could not be completed.");
          if (reset) setConfirmation("");
        }}>Delete all learning progress</button>
        {resetStatus && <p role="status" className="settings-status">{resetStatus}</p>}
      </section>

      <section className="settings-section settings-preview">
        <div className="settings-section__heading"><span>03</span><div><h2>Premium & difficulty</h2><p>Product preview only. Nothing here changes billing, questions or scoring yet.</p></div></div>
        <div className="preview-grid"><button type="button" disabled><strong>Premium course</strong><span>Advanced dispatch packs and deeper analytics · Coming later</span></button><button type="button" disabled><strong>Exam-pressure difficulty</strong><span>Fewer clues, tighter timing and harder distractors · Coming later</span></button></div>
      </section>

      <section className="settings-section personal-places">
        <div className="settings-section__heading"><span>04</span><div><h2>Your Glasgow timeline</h2><p>Add a meaningful point, when it mattered, and why. Saved points become Route Lab endpoints and appear on territory maps.</p></div></div>
        <div className="personal-place-layout">
          <div className="personal-place-map"><MapContainer center={[coordinate[1], coordinate[0]]} zoom={12} scrollWheelZoom><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" /><MapClick onPick={setCoordinate} />{sortedPlaces.map((place) => <CircleMarker key={place.id} center={[place.coordinate[1], place.coordinate[0]]} radius={7} pathOptions={{ color: "#fff", weight: 3, fillColor: "#7a5af8", fillOpacity: 1 }}><Tooltip><strong>{place.name}</strong><br />{relationshipLabels[place.relationship]} · {dateRange(place)}</Tooltip></CircleMarker>)}<CircleMarker center={[coordinate[1], coordinate[0]]} radius={9} pathOptions={{ color: "#7a5af8", weight: 3, fillColor: "#fff", fillOpacity: .9 }}><Tooltip permanent direction="top">New point</Tooltip></CircleMarker></MapContainer><small>Tap the map to position your point.</small></div>
          <form onSubmit={(event) => { event.preventDefault(); void savePlace(); }}>
            <label><span>Place name</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="My old flat, first rank, favourite café…" /></label>
            <div className="settings-form-row"><label><span>Connection</span><select value={relationship} onChange={(event) => setRelationship(event.target.value as PersonalPlaceRelationship)}>{Object.entries(relationshipLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>City area</span><select value={area} onChange={(event) => setArea(event.target.value as KnowledgeAreaId)}>{(["north", "east", "south", "west", "centre"] as const).map((value) => <option value={value} key={value}>{knowledgeAreaLabels[value]}</option>)}</select></label></div>
            <div className="settings-form-row"><label><span>From</span><input type="month" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label><span>To (blank means present)</span><input type="month" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label></div>
            <label><span>Why it matters</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What happened here, or what makes it useful to remember?" rows={4} /></label>
            <small>{coordinate[1].toFixed(5)}, {coordinate[0].toFixed(5)}</small>
            <div className="settings-form-actions">{editingId && <button type="button" className="back" onClick={clearPlaceForm}>Cancel edit</button>}<button type="submit" className="primary">{editingId ? "Update point" : "Add point"}</button></div>
          </form>
        </div>
        {placeStatus && <p className="settings-status" role="status">{placeStatus}</p>}
        {!!sortedPlaces.length && <div className="personal-place-list">{sortedPlaces.map((place) => <article key={place.id}><i aria-hidden="true" /><div><strong>{place.name}</strong><span>{relationshipLabels[place.relationship]} · {dateRange(place)} · {knowledgeAreaLabels[place.area]}</span>{place.note && <p>{place.note}</p>}</div><button type="button" className="back" onClick={() => editPlace(place)}>Edit</button><button type="button" className="danger-link" onClick={() => { if (window.confirm(`Delete ${place.name}?`)) void onDeletePersonalPlace(place.id); }}>Delete</button></article>)}</div>}
      </section>
    </div>
  );
}
