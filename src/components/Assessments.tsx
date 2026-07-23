import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../data/db";
import {
  createAssessmentSession,
  mockCoverage,
  validateAssessmentSession,
} from "../domain/assessment";
import { atomicStreetAttempts } from "../domain/atomic-streets";
import { applyAttempt } from "../domain/mastery";
import {
  generateSectionQuestion,
  getAnswerFeatures,
  isExactAnswer,
} from "../domain/questions";
import type {
  AssessmentMode,
  AssessmentResult,
  AssessmentSession,
  Attempt,
  CoverageLedger,
  LearningContent,
  Mastery,
  MockQuestionHistory,
} from "../domain/types";

type Props = {
  visibleMode: AssessmentMode;
  content: LearningContent;
  ledger: CoverageLedger;
  roads: unknown;
  mastery: Map<string, Mastery>;
  onFinalEvidence: (attempts: Attempt[], mastery: Map<string, Mastery>) => void;
};

const emptyActive: Record<AssessmentMode, AssessmentSession | null> = {
  final: null,
  mock: null,
};
const randomSeed = () => {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return `${values[0].toString(36)}${values[1].toString(36)}`;
};

export function Assessments({
  visibleMode,
  content,
  ledger,
  roads,
  mastery,
  onFinalEvidence,
}: Props) {
  const [active, setActive] = useState(emptyActive);
  const [session, setSession] = useState<AssessmentSession | null>(null);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [history, setHistory] = useState<MockQuestionHistory[]>([]);
  const [recentResults, setRecentResults] = useState<AssessmentResult[]>([]);
  const [suppliedSeed, setSuppliedSeed] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewWrongOnly, setReviewWrongOnly] = useState(false);
  const [reviewPage, setReviewPage] = useState(0);
  const questionStarted = useRef(performance.now());
  const associationsById = useMemo(
    () => new Map(ledger.associations.map((item) => [item.id, item])),
    [ledger],
  );
  const recordsById = useMemo(
    () => new Map(content.records.map((item) => [item.id, item])),
    [content],
  );
  const recordsBySection = useMemo(() => {
    const grouped = new Map<string, LearningContent["records"]>();
    for (const record of content.records) {
      const values = grouped.get(record.section.code) ?? [];
      values.push(record);
      grouped.set(record.section.code, values);
    }
    return grouped;
  }, [content]);
  const contentVersion = content.content_version;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      db.assessmentSessions.toArray(),
      db.mockQuestionHistory.toArray(),
      db.assessmentResults.orderBy("submitted_at").reverse().limit(8).toArray(),
    ]).then(async ([sessions, served, results]) => {
      if (cancelled) return;
      const recovered = { ...emptyActive };
      const discarded: string[] = [];
      for (const candidate of sessions) {
        const reason = validateAssessmentSession(
          candidate,
          ledger.associations,
          contentVersion,
        );
        if (reason) {
          await db.assessmentSessions.delete(candidate.id);
          discarded.push(`${candidate.mode}: ${reason}`);
        } else recovered[candidate.mode] = candidate;
      }
      setActive(recovered);
      setHistory(served);
      setRecentResults(results);
      if (discarded.length)
        setNotice(`A saved session was safely retired (${discarded.join("; ")}).`);
    });
    return () => {
      cancelled = true;
    };
  }, [contentVersion, ledger.associations]);

  const coverage = useMemo(
    () => mockCoverage(ledger.associations, history),
    [ledger.associations, history],
  );
  const start = async (mode: AssessmentMode) => {
    if (content.content_version !== ledger.content_version) {
      setNotice("Learning content and question ledger versions do not match.");
      return;
    }
    const explicitSeed = mode === "mock" && Boolean(suppliedSeed.trim());
    const next = createAssessmentSession({
      mode,
      associations: ledger.associations,
      contentVersion,
      seed: explicitSeed ? suppliedSeed.trim() : randomSeed(),
      history,
      suppliedSeed: explicitSeed,
    });
    await db.assessmentSessions.put(next);
    setActive((current) => ({ ...current, [mode]: next }));
    setSession(next);
    setResult(null);
    setNotice("");
    questionStarted.current = performance.now();
  };
  const resume = (candidate: AssessmentSession) => {
    setSession(candidate);
    setResult(null);
    setNotice("");
    questionStarted.current = performance.now();
  };

  const association = session
    ? associationsById.get(session.association_ids[session.position])
    : undefined;
  const record = association ? recordsById.get(association.record_id) : undefined;
  const question = useMemo(
    () =>
      session && association && record
        ? generateSectionQuestion(
            record,
            association,
            recordsBySection.get(record.section.code) ?? [],
            roads,
            `${session.seed}:${session.position}`,
          )
        : null,
    [association, record, recordsBySection, roads, session],
  );
  const selected =
    (association && session?.answers[association.id]?.selected_option_ids) ?? [];
  const answeredCount = session ? Object.keys(session.answers).length : 0;

  const saveAnswer = async (optionId: string) => {
    if (!session || !association || !question) return;
    const nextSelected =
      question.selection_mode === "multiple"
        ? selected.includes(optionId)
          ? selected.filter((item) => item !== optionId)
          : [...selected, optionId]
        : [optionId];
    const previous = session.answers[association.id];
    const now = new Date().toISOString();
    const answer = {
      association_id: association.id,
      selected_option_ids: nextSelected,
      selected_labels: question.options
        .filter((option) => nextSelected.includes(option.id))
        .map((option) => option.label),
      correct_labels: question.options
        .filter((option) => question.answer_option_ids.includes(option.id))
        .map((option) => option.label),
      correct: isExactAnswer(nextSelected, question.answer_option_ids),
      latency_ms:
        previous?.latency_ms ?? Math.round(performance.now() - questionStarted.current),
      answered_at: previous?.answered_at ?? now,
    };
    const answers = { ...session.answers };
    if (nextSelected.length) answers[association.id] = answer;
    else delete answers[association.id];
    const next = { ...session, answers, updated_at: now };
    setSession(next);
    setActive((current) => ({ ...current, [session.mode]: next }));
    if (session.mode === "mock" && !previous && nextSelected.length) {
      const prior = history.find((item) => item.association_id === association.id);
      const served: MockQuestionHistory = {
        association_id: association.id,
        times_served: (prior?.times_served ?? 0) + 1,
        first_served_at: prior?.first_served_at ?? now,
        last_served_at: now,
        last_session_id: session.id + ":" + session.seed,
      };
      await db.transaction(
        "rw",
        db.assessmentSessions,
        db.mockQuestionHistory,
        async () => {
          await db.assessmentSessions.put(next);
          await db.mockQuestionHistory.put(served);
        },
      );
      setHistory((current) => [
        ...current.filter((item) => item.association_id !== association.id),
        served,
      ]);
    } else await db.assessmentSessions.put(next);
  };

  const move = async (position: number) => {
    if (!session) return;
    const next = {
      ...session,
      position: Math.max(0, Math.min(session.association_ids.length - 1, position)),
      updated_at: new Date().toISOString(),
    };
    await db.assessmentSessions.put(next);
    setSession(next);
    setActive((current) => ({ ...current, [session.mode]: next }));
    questionStarted.current = performance.now();
  };

  const submit = async () => {
    if (!session || answeredCount !== session.association_ids.length) return;
    const submittedAt = new Date().toISOString();
    const correctCount = Object.values(session.answers).filter(
      (answer) => answer.correct,
    ).length;
    const submitted: AssessmentResult = {
      schema_version: "1.0.0",
      session_id: `${session.mode}:${session.seed}:${session.created_at}`,
      mode: session.mode,
      selection_strategy: session.selection_strategy,
      content_version: session.content_version,
      seed: session.seed,
      association_ids: session.association_ids,
      answers: session.answers,
      question_count: session.association_ids.length,
      correct_count: correctCount,
      percentage: (correctCount / session.association_ids.length) * 100,
      submitted_at: submittedAt,
    };
    if (session.mode === "final") {
      const evidence: Attempt[] = [];
      for (const associationId of session.association_ids) {
        const item = associationsById.get(associationId)!;
        const itemRecord = recordsById.get(item.record_id)!;
        const answer = session.answers[associationId];
        const context = {
          exercise_family: "final_assessment",
          used_reveal: false,
          latency_ms: answer.latency_ms,
          confidence: answer.correct ? (3 as const) : (1 as const),
          created_at: submittedAt,
          session_id: submitted.session_id,
          content_version: session.content_version,
          phase: "first_pass" as const,
          source_mode: "final" as const,
          question_instance_id: `${session.seed}:${session.position}:${associationId}`,
        };
        evidence.push({
          association_id: associationId,
          correct: answer.correct,
          selected_option_ids: answer.selected_option_ids,
          keyed_option_ids: item.direction === "forward"
            ? getAnswerFeatures(itemRecord).map((feature) => `${itemRecord.id}:feature:${feature.index}`)
            : [itemRecord.id],
          ...context,
        });
        evidence.push(
          ...atomicStreetAttempts(
            item,
            ledger.associations,
            {
              id: `question:${item.id}`,
              association_id: item.id,
              record_id: item.record_id,
              direction: item.kind as "streets_to_category" | "category_to_streets",
              prompt: item.prompt,
              street_names: [],
              options: [],
              answer_option_ids: getAnswerFeatures(itemRecord).map(
                (feature) => `${itemRecord.id}:feature:${feature.index}`,
              ),
              selection_mode: "multiple",
            },
            answer.selected_option_ids,
            context,
          ),
        );
      }
      const nextMastery = new Map(mastery);
      for (const attempt of evidence)
        nextMastery.set(
          attempt.association_id,
          applyAttempt(nextMastery.get(attempt.association_id), attempt),
        );
      await db.transaction(
        "rw",
        db.attempts,
        db.mastery,
        db.assessmentResults,
        db.assessmentSessions,
        async () => {
          await db.attempts.bulkAdd(evidence);
          await db.mastery.bulkPut([...nextMastery.values()]);
          await db.assessmentResults.add(submitted);
          await db.assessmentSessions.delete(session.id);
        },
      );
      onFinalEvidence(evidence, nextMastery);
    } else {
      await db.transaction(
        "rw",
        db.assessmentResults,
        db.assessmentSessions,
        async () => {
          await db.assessmentResults.add(submitted);
          await db.assessmentSessions.delete(session.id);
        },
      );
    }
    setActive((current) => ({ ...current, [session.mode]: null }));
    setRecentResults((current) => [submitted, ...current].slice(0, 8));
    setResult(submitted);
    setSession(null);
    setReviewWrongOnly(false);
    setReviewPage(0);
  };

  const keyboardState = useRef({ session, question, selected, saveAnswer, move });
  keyboardState.current = { session, question, selected, saveAnswer, move };
  useEffect(() => {
    const keys = ["a", "s", "d", "f", "z", "x", "c", "v"];
    const onKeyDown = (event: KeyboardEvent) => {
      const current = keyboardState.current;
      if (!current.session || !current.question) return;
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const index = keys.indexOf(event.key.toLowerCase());
      if (index >= 0 && current.question.options[index]) {
        event.preventDefault();
        void current.saveAnswer(current.question.options[index].id);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        void current.move(current.session.position - 1);
      } else if (event.key === "ArrowRight" && current.selected.length) {
        event.preventDefault();
        void current.move(current.session.position + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (session && association && record && question)
    return (
      <>
        <header className="lesson-head assessment-head">
          <button className="back" onClick={() => setSession(null)}>
            ← Save and leave
          </button>
          <div>
            <b>{session.mode === "final" ? "Final Mastery Assessment" : "100-question Mock"}</b>
            <span>
              Question {session.position + 1} of {session.association_ids.length} · {answeredCount} answered
            </span>
          </div>
        </header>
        <section className="assessment-session">
          <div className="assessment-rule" role="note">
            Strict assessment: answers are saved automatically. Correctness and keyed answers remain hidden until the complete assessment is submitted.
          </div>
          <div className="assessment-progress">
            <progress value={answeredCount} max={session.association_ids.length} />
            <span>Seed {session.seed}</span>
          </div>
          <div className="task assessment-task">
            <p>{question.direction === "streets_to_category" ? "STREETS TO CATEGORY" : "CATEGORY TO STREETS"} · {record.type.replace("_", " ")}</p>
            <h1>
              {question.direction === "streets_to_category"
                ? question.street_names.join(" · ")
                : question.prompt}
            </h1>
            {question.selection_mode === "multiple" && (
              <p className="multi-instruction">Select every required street. Missing one or selecting any extra option makes the grouped answer incorrect.</p>
            )}
            <div className="mc-options strict-options">
              {question.options.map((option, index) => (
                <button
                  key={option.id}
                  aria-pressed={selected.includes(option.id)}
                  className={selected.includes(option.id) ? "selected" : ""}
                  onClick={() => void saveAnswer(option.id)}
                >
                  <span>{["A", "S", "D", "F", "Z", "X", "C", "V"][index]}</span>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="assessment-nav">
              <button className="back" disabled={!session.position} onClick={() => void move(session.position - 1)}>Previous</button>
              {session.position + 1 < session.association_ids.length ? (
                <button className="primary" disabled={!selected.length} onClick={() => void move(session.position + 1)}>Save and next</button>
              ) : answeredCount === session.association_ids.length ? (
                <button className="primary" onClick={() => void submit()}>Submit complete assessment</button>
              ) : (
                <button
                  className="primary"
                  onClick={() => {
                    const missing = session.association_ids.findIndex((id) => !session.answers[id]);
                    void move(missing);
                  }}
                >Go to first unanswered</button>
              )}
            </div>
          </div>
        </section>
      </>
    );

  if (result) {
    const review = result.association_ids
      .map((id) => result.answers[id])
      .filter((answer) => answer && (!reviewWrongOnly || !answer.correct));
    const page = review.slice(reviewPage * 50, reviewPage * 50 + 50);
    return (
      <>
        <header className="page-head results-head">
          <div>
            <p>{result.mode === "final" ? "FINAL ASSESSMENT SUBMITTED" : "MOCK SUBMITTED"}</p>
            <h1>{result.correct_count} of {result.question_count} exact answers correct.</h1>
            <span>Seed {result.seed} · content {result.content_version.slice(0, 28)}…</span>
          </div>
          <button className="back" onClick={() => setResult(null)}>Back to assessments</button>
        </header>
        <section className="stats">
          <article><span>Score</span><b>{result.percentage.toFixed(1)}%</b></article>
          <article><span>Correct</span><b>{result.correct_count.toLocaleString()}</b></article>
          <article><span>Incorrect</span><b>{(result.question_count - result.correct_count).toLocaleString()}</b></article>
        </section>
        <section className="answer-breakdown">
          <div className="answer-breakdown-heading">
            <div><p className="eyebrow">POST-SUBMISSION REVIEW</p><h2>Answers and keyed responses</h2></div>
            <label><input type="checkbox" checked={reviewWrongOnly} onChange={(event) => { setReviewWrongOnly(event.target.checked); setReviewPage(0); }} /> Incorrect only</label>
          </div>
          <ol start={reviewPage * 50 + 1}>
            {page.map((answer) => (
              <li className={answer.correct ? "review-correct" : "review-wrong"} key={answer.association_id}>
                <div className="review-content">
                  <div className="review-status"><b>{answer.correct ? "Correct" : "Incorrect"}</b></div>
                  <dl>
                    <div><dt>Your answer</dt><dd>{answer.selected_labels.join(" · ")}</dd></div>
                    <div><dt>Correct answer</dt><dd>{answer.correct_labels.join(" · ")}</dd></div>
                  </dl>
                </div>
              </li>
            ))}
          </ol>
          {review.length > 50 && <div className="assessment-nav"><button className="back" disabled={!reviewPage} onClick={() => setReviewPage((value) => value - 1)}>Previous 50</button><span>{reviewPage * 50 + 1}–{Math.min(review.length, reviewPage * 50 + 50)} of {review.length}</span><button className="back" disabled={(reviewPage + 1) * 50 >= review.length} onClick={() => setReviewPage((value) => value + 1)}>Next 50</button></div>}
        </section>
      </>
    );
  }

  const requiredCount = ledger.associations.filter(
    (item) => item.required && item.scope === "record_set",
  ).length;
  const visibleResults = recentResults.filter((item) => item.mode === visibleMode);
  return (
    <>
      <header className="page-head">
        <div>
          <p>{visibleMode === "mock" ? "STRICT MOCK EXAM" : "EXHAUSTIVE FINAL ASSESSMENT"}</p>
          <h1>{visibleMode === "mock" ? "Rehearse the real 100-question format." : "Prove the complete question bank."}</h1>
          <span>Answers are resumable and remain hidden until the complete assessment is submitted.</span>
        </div>
      </header>
      {notice && <p className="assessment-notice" role="status">{notice}</p>}
      <section className="assessment-cards single-mode">
        {visibleMode === "final" && <article>
          <p className="eyebrow">A · EXHAUSTIVE</p>
          <h2>Final Mastery Assessment</h2>
          <strong>{requiredCount.toLocaleString()} questions</strong>
          <p>Every required record-set association is tested, including previously mastered items. Atomic street Slips are not added as extra questions.</p>
          {active.final ? (
            <button className="primary" onClick={() => resume(active.final!)}>Resume {Object.keys(active.final.answers).length.toLocaleString()} answered</button>
          ) : (
            <button className="primary" onClick={() => void start("final")}>Start exhaustive assessment</button>
          )}
        </article>}
        {visibleMode === "mock" && <article>
          <p className="eyebrow">B · REAL-WORLD REHEARSAL</p>
          <h2>Rotating 100-question Mock</h2>
          <strong>{coverage.served.toLocaleString()} / {coverage.total.toLocaleString()} bank coverage</strong>
          <progress value={coverage.served} max={coverage.total} />
          <p>Default attempts prioritise unseen and least-recently served questions. Mock scores never change learning mastery.</p>
          {active.mock ? (
            <button className="primary" onClick={() => resume(active.mock!)}>Resume {Object.keys(active.mock.answers).length} of 100 answered</button>
          ) : (
            <>
              <label htmlFor="mock-seed">Optional reproducible seed</label>
              <input id="mock-seed" value={suppliedSeed} onChange={(event) => setSuppliedSeed(event.target.value)} placeholder="Leave blank for rotating selection" />
              <button className="primary" onClick={() => void start("mock")}>Start 100-question mock</button>
            </>
          )}
        </article>}
      </section>
      {!!visibleResults.length && (
        <section className="panel assessment-history">
          <div className="panel-title"><div><h2>Submitted assessment history</h2><p>Mock results remain separate from course mastery.</p></div></div>
          <ol>
            {visibleResults.map((item) => (
              <li key={item.session_id}><span>{item.mode === "final" ? "Final" : "Mock"} · {new Date(item.submitted_at).toLocaleString()}</span><b>{item.correct_count}/{item.question_count} · {item.percentage.toFixed(1)}%</b></li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
