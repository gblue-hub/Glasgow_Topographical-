import { useMemo, useState } from "react";
import { seededRandom } from "../domain/session";
import type { StreetLandmarkSequence } from "../domain/street-landmark-sequences";
import "./street-sequence-mission.css";

type Props = {
  sequence: StreetLandmarkSequence;
  activeRecordId: string;
  seed: string;
  onClear: () => void;
  onSkip: () => void;
};

export function StreetSequenceMission({ sequence, activeRecordId, seed, onClear, onSkip }: Props) {
  const mission = useMemo(() => {
    const activeIndex = sequence.landmarks.findIndex((item) => item.recordId === activeRecordId);
    const random = seededRandom(`${seed}:${sequence.id}:${activeRecordId}`);
    let forward = random() >= 0.5;
    if (activeIndex === sequence.landmarks.length - 1) forward = false;
    if (activeIndex === 0) forward = true;
    const nextIndex = activeIndex + (forward ? 1 : -1);
    const correct = sequence.landmarks[nextIndex];
    const distractors = sequence.landmarks.filter((item) => item.recordId !== activeRecordId && item.recordId !== correct.recordId);
    const options = [correct, ...distractors].sort((left, right) => random() - 0.5 || left.recordId.localeCompare(right.recordId)).slice(0, 4);
    return { active: sequence.landmarks[activeIndex], correct, options, heading: forward ? sequence.forwardHeading : sequence.reverseHeading };
  }, [activeRecordId, seed, sequence]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  return (
    <section className="street-sequence-mission" aria-labelledby="street-sequence-title">
      <p className="learning-enhancement-eyebrow">DRIVE-BY ORDER · CITY CENTRE</p>
      <div className="street-sequence-mission__road" aria-hidden="true">
        <span>{mission.heading} ↑</span><i /><b>{sequence.roadName}</b><i />
      </div>
      <h3 id="street-sequence-title">Heading {mission.heading}, you have just passed {mission.active.name}. What comes immediately next?</h3>
      <div className="street-sequence-mission__options">
        {mission.options.map((option) => (
          <button key={option.recordId} type="button" disabled={cleared} className={chosen === option.recordId ? (option.recordId === mission.correct.recordId ? "is-correct" : "is-wrong") : ""} onClick={() => {
            setChosen(option.recordId);
            if (option.recordId === mission.correct.recordId) { setCleared(true); onClear(); }
          }}>{option.name}</button>
        ))}
      </div>
      {chosen && chosen !== mission.correct.recordId && <small>Not on this approach. Read the direction and try the next landmark again.</small>}
      {cleared && <small>Correct — {mission.correct.name} is next along {sequence.roadName}.</small>}
      {!cleared && <button type="button" className="back" onClick={onSkip}>Show me — I&apos;m stuck</button>}
    </section>
  );
}
