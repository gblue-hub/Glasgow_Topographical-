import type {
  DistractorExplanation,
  SectionQuestion,
} from "../domain/questions";

type Props = {
  question: SectionQuestion;
  selectedAnswers: string[];
  correctAnswers: string[];
  missingAnswers: string[];
  extraAnswers: string[];
  explanations: DistractorExplanation[];
  memoryAid?: string;
  onCompare: (optionId: string) => void;
};

function StreetSignature({ names }: { names: string[] }) {
  return (
    <ul className="correction-signature">
      {names.map((name) => <li key={name}>{name}</li>)}
    </ul>
  );
}

export function WrongAnswerCorrection({
  question,
  selectedAnswers,
  correctAnswers,
  missingAnswers,
  extraAnswers,
  explanations,
  memoryAid,
  onCompare,
}: Props) {
  const recognition = question.direction === "streets_to_category";
  const correctName = correctAnswers.join(" · ");
  const selectedName = selectedAnswers.join(" · ");
  const selectedExplanation = explanations[0];

  return (
    <section
      className="correction-card"
      role="status"
      aria-live="polite"
      aria-labelledby="correction-title"
    >
      <header>
        <span>CORRECTION</span>
        <h2 id="correction-title">
          {recognition
            ? `${correctName}, not ${selectedName}`
            : `Complete the street set for ${question.prompt}`}
        </h2>
      </header>

      {recognition ? (
        <>
          <p className="correction-intro">
            The distinction is in the street group. Compare the two signatures:
          </p>
          <div className="correction-signature-contrast">
            <article className="signature-correct">
              <span>These identify</span>
              <strong>{correctName}</strong>
              <StreetSignature names={question.street_names} />
            </article>
            {selectedExplanation && (
              <article className="signature-confused">
                <span>You confused it with</span>
                <strong>{selectedExplanation.belongsTo}</strong>
                <StreetSignature names={selectedExplanation.associatedAnswers} />
              </article>
            )}
          </div>
          <p className="correction-retrieval">
            <span>Say it once</span>
            {question.street_names.join(" · ")} → <strong>{correctName}</strong>
          </p>
        </>
      ) : (
        <>
          <div className="correction-complete-set">
            <span>Complete answer</span>
            <strong>{question.prompt}</strong>
            <StreetSignature names={correctAnswers} />
          </div>
          {(missingAnswers.length > 0 || extraAnswers.length > 0) && (
            <div className="correction-set-difference">
              {missingAnswers.length > 0 && (
                <div className="difference-missing">
                  <span>Add to your answer</span>
                  <StreetSignature names={missingAnswers} />
                </div>
              )}
              {extraAnswers.length > 0 && (
                <div className="difference-extra">
                  <span>Remove from your answer</span>
                  <StreetSignature names={extraAnswers} />
                </div>
              )}
            </div>
          )}
          {explanations.map((explanation) => (
            <p className="correction-belongs-elsewhere" key={explanation.optionId}>
              <strong>{explanation.selectedLabel}</strong> belongs with{" "}
              <strong>{explanation.belongsTo}</strong>, not {question.prompt}.
            </p>
          ))}
          <p className="correction-retrieval">
            <span>Say the complete set</span>
            {question.prompt} → <strong>{correctAnswers.join(" · ")}</strong>
          </p>
        </>
      )}

      {selectedExplanation && (
        <button
          className="correction-map-link"
          type="button"
          onClick={() => onCompare(selectedExplanation.optionId)}
        >
          Compare {correctName} and {selectedExplanation.belongsTo} on the map
        </button>
      )}
      {memoryAid && (
        <p className="memory-aid-reminder">
          <strong>Your memory aid:</strong> {memoryAid}
        </p>
      )}
    </section>
  );
}
