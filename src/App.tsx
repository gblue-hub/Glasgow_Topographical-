import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import "./learning.css";
import "./explorer.css";
import { Explorer, type ExplorerState } from "./components/Explorer";
import { Journeys } from "./components/Journeys";
import { TroubleSpots } from "./components/TroubleSpots";
import { Assessments } from "./components/Assessments";
import { DirectionalFeedback } from "./components/DirectionalFeedback";
import { SectionQuizBuilder } from "./components/SectionQuizBuilder";
import { loadLearningData, loadRoadData } from "./data/content";
import { db } from "./data/db";
import { applyAttempt, completion } from "./domain/mastery";
import { explainSelectedDistractors, generateSectionQuestion, getAnswerFeatures, QUESTION_GENERATOR_VERSION } from "./domain/questions";
import { createSessionResult, indexLatestSectionResults, randomiseAssociations, sectionResultKey } from "./domain/session";
import { compareSectionCodes } from "./domain/sections";
import { buildTroubleSpots } from "./domain/trouble-spots";
import { atomicStreetAttempts } from "./domain/atomic-streets";
import { shouldIgnoreLessonShortcut } from "./domain/lesson-keyboard";
import { buildDirectionalFeedback } from "./domain/directional-feedback";
import { requiredAssociationsForSections } from "./domain/section-groups";
import { learningSessionQueue, validateLearningSession } from "./domain/learning-session";
import { withUpdatedCoordinate } from "./domain/coordinate-state";

const coordinateEditingEnabled = import.meta.env.DEV;
import type {
  Association,
  Attempt,
  CoverageLedger,
  LearningContent,
  LearningRecord,
  LearningAnswerReview,
  LearningReturnView,
  LearningSession,
  Mastery,
  StudyAid,
  RoadGeometryCollection,
  RoadTopology,
  SessionResult,
} from "./domain/types";

type View = "overview" | "practice" | "mock" | "final" | "explore" | "explore-record" | "lesson" | "results" | "roads" | "journeys" | "trouble" | "feedback" | "mastery";
const LearningMap = lazy(() =>
  import("./components/LearningMap").then((module) => ({ default: module.LearningMap })),
);
const Roads = lazy(() =>
  import("./components/Roads").then((module) => ({ default: module.Roads })),
);

export default function App() {
  const [content, setContent] = useState<LearningContent | null>(null),
    [ledger, setLedger] = useState<CoverageLedger | null>(null),
    [roads, setRoads] = useState<any>(null),
    [roadTopology, setRoadTopology] = useState<RoadTopology | null>(null),
    [roadGeometry, setRoadGeometry] = useState<RoadGeometryCollection | null>(null),
    [mastery, setMastery] = useState(new Map<string, Mastery>()),
    [attempts, setAttempts] = useState<Attempt[]>([]),
    [view, setView] = useState<View>("overview"),
    [sessionReturnView, setSessionReturnView] = useState<View>("practice"),
    [section, setSection] = useState(""),
    [sessionSectionCodes, setSessionSectionCodes] = useState<string[]>([]),
    [sessionLabel, setSessionLabel] = useState(""),
    [queue, setQueue] = useState<Association[]>([]),
    [sessionSeed, setSessionSeed] = useState(""),
    [sessionSourceMode, setSessionSourceMode] = useState<LearningSession["source_mode"]>("section"),
    [sessionCreatedAt, setSessionCreatedAt] = useState(""),
    [savedLearningSession, setSavedLearningSession] = useState<LearningSession | null>(null),
    [learningRecoveryReady, setLearningRecoveryReady] = useState(false),
    [mistakes, setMistakes] = useState<Set<string>>(new Set()),
    [firstPassCorrect, setFirstPassCorrect] = useState(0),
    [correctionMode, setCorrectionMode] = useState(false),
    [correctionsComplete, setCorrectionsComplete] = useState(false),
    [sessionResult, setSessionResult] = useState<SessionResult | null>(null),
    [answerReview, setAnswerReview] = useState<LearningAnswerReview[]>([]),
    [latestSectionResults, setLatestSectionResults] = useState(new Map<string, SessionResult>()),
    [round, setRound] = useState(1),
    [position, setPosition] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [checked, setChecked] = useState(false),
    [started, setStarted] = useState(0),
    [clue, setClue] = useState(false),
    [hintLevel, setHintLevel] = useState(0),
    [studyAid, setStudyAid] = useState<StudyAid | null>(null),
    [exploreRecord, setExploreRecord] = useState<LearningRecord | null>(null),
    [explorerState, setExplorerState] = useState<ExplorerState>({ query: "", sectionCode: "", type: "all", page: 1 }),
    [explorerReturnY, setExplorerReturnY] = useState<number | null>(null),
    [mapStreetNames, setMapStreetNames] = useState(true),
    [mobileMenuOpen, setMobileMenuOpen] = useState(false),
    [recoveryNotice, setRecoveryNotice] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeMenu);
    return () => window.removeEventListener("keydown", closeMenu);
  }, [mobileMenuOpen]);
  useEffect(() => {
    if (view !== "explore" || explorerReturnY === null) return;
    requestAnimationFrame(() => {
      window.scrollTo({ top: explorerReturnY });
      setExplorerReturnY(null);
    });
  }, [view, explorerReturnY]);
  useEffect(() => {
    loadLearningData()
      .then(([c, l, r]) => {
        setContent(c);
        setLedger(l);
        setRoads(r);
        setSection(c.sections[0]?.code || "");
      })
      .catch((e) => setError(e.message));
    loadRoadData()
      .then(([topology, geometry]) => {
        setRoadTopology(topology);
        setRoadGeometry(geometry);
      })
      .catch((e) => setError(e.message));
    db.mastery
      .toArray()
      .then((rows) =>
        setMastery(new Map(rows.map((row) => [row.association_id, row]))),
      );
    db.attempts.toArray().then(setAttempts);
    db.sessionResults.toArray().then((rows) => {
      setLatestSectionResults(indexLatestSectionResults(rows));
    });
  }, []);
  useEffect(() => {
    if (!content || !ledger) return;
    let cancelled = false;
    db.learningSessions.get("active:learning").then(async (saved) => {
      if (cancelled) return;
      if (!saved) {
        setLearningRecoveryReady(true);
        return;
      }
      const reason = validateLearningSession(saved, ledger.associations, content.content_version);
      if (reason) {
        await db.learningSessions.delete(saved.id);
        if (!cancelled) setRecoveryNotice(`A saved learning quiz was retired safely: ${reason}.`);
      } else if (!cancelled) setSavedLearningSession(saved);
      if (!cancelled) setLearningRecoveryReady(true);
    });
    return () => { cancelled = true; };
  }, [content, ledger]);
  const allIds =
      ledger?.associations.filter((a) => a.required).map((a) => a.id) || [],
    course = completion(allIds, mastery);
  const sectionStats = useMemo(
    () =>
      content?.sections.map((s) => {
        const ids =
          ledger?.associations
            .filter((a) => a.section_code === s.code && a.required)
            .map((a) => a.id) || [];
        return {
          ...s,
          ...completion(ids, mastery),
          directionTotals: {
            reverse: ledger?.associations.filter((a) => a.section_code === s.code && a.required && a.direction === "reverse").length ?? 0,
            forward: ledger?.associations.filter((a) => a.section_code === s.code && a.required && a.direction === "forward").length ?? 0,
          },
          latestResults: {
            reverse: latestSectionResults.get(sectionResultKey(s.code, "reverse")),
            forward: latestSectionResults.get(sectionResultKey(s.code, "forward")),
          },
        };
      }).sort(compareSectionCodes) || [],
    [content, ledger, mastery, latestSectionResults],
  );
  const troubleSpots = useMemo(
    () => buildTroubleSpots(ledger?.associations ?? [], attempts),
    [ledger, attempts],
  );
  const directionalFeedback = useMemo(
    () => buildDirectionalFeedback(content?.records ?? [], ledger?.associations ?? [], attempts),
    [content, ledger, attempts],
  );
  const startSession = (
    selectedQueue: Association[],
    code: string,
    returnView: Exclude<LearningReturnView, "sections">,
    sourceMode: LearningSession["source_mode"],
    sectionCodes: string[] = code ? [code] : [],
    label = "",
    replaceSaved = false,
  ) => {
    if (!selectedQueue.length) return;
    if (!replaceSaved && savedLearningSession && !window.confirm(`Starting a new quiz will replace your saved ${savedLearningSession.selection_label || "learning quiz"}. Continue?`)) return;
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    const seed = values[0].toString(36);
    const now = new Date().toISOString();
    setQueue(randomiseAssociations(selectedQueue));
    setSessionSeed(seed);
    setSessionSourceMode(sourceMode);
    setSessionCreatedAt(now);
    setMistakes(new Set());
    setFirstPassCorrect(0);
    setCorrectionMode(false);
    setCorrectionsComplete(false);
    setSessionResult(null);
    setAnswerReview([]);
    setRound(1);
    setPosition(0);
    setSelected([]);
    setChecked(false);
    setClue(false);
    setHintLevel(0);
    setStarted(performance.now());
    setSection(code);
    setSessionSectionCodes(sectionCodes);
    setSessionLabel(label);
    setSessionReturnView(returnView);
    setView("lesson");
  };
  const begin = (code?: string, direction: Association["direction"] = "reverse") => {
    if (!ledger) return;
    const requiredAssociations = (
      code
        ? ledger.associations.filter((a) => a.section_code === code)
        : ledger.associations
    ).filter((a) => a.required && (!code || a.direction === direction));
    const selectedQueue = code
      ? requiredAssociations
      : requiredAssociations.filter((a) => mastery.get(a.id)?.state !== "mastered");
    startSession(
      selectedQueue,
      code || "",
      code ? "practice" : "overview",
      code ? "section" : "course",
      code ? [code] : [],
      code
        ? `${direction === "reverse" ? "Recognition" : "Recall"} · ${content?.sections.find((item) => item.code === code)?.name ?? `Section ${code}`}`
        : "Course review",
    );
  };
  const beginTroubleSpots = (associationIds: string[]) => {
    if (!ledger) return;
    const selectedIds = new Set(associationIds);
    startSession(
      ledger.associations.filter(
        (association) => selectedIds.has(association.id),
      ),
      "",
      "trouble",
      "trouble",
      [],
      "Slips practice",
    );
  };
  const beginDirectionalPractice = (associationIds: string[]) => {
    if (!ledger) return;
    const selectedIds = new Set(associationIds);
    startSession(
      ledger.associations.filter((association) => selectedIds.has(association.id)),
      "",
      "feedback",
      "feedback",
      [],
      "Directional practice",
    );
  };
  const beginCombinedSections = (sectionCodes: string[], label: string, direction: Association["direction"]) => {
    if (!ledger) return;
    startSession(
      requiredAssociationsForSections(ledger.associations, sectionCodes, direction),
      "",
      "practice",
      "section_set",
      sectionCodes,
      label,
    );
  };
  const resumeLearningSession = async () => {
    if (!savedLearningSession || !ledger || !content) return;
    const reason = validateLearningSession(savedLearningSession, ledger.associations, content.content_version);
    if (reason) {
      await db.learningSessions.delete(savedLearningSession.id);
      setSavedLearningSession(null);
      setRecoveryNotice(`The saved quiz could not be resumed: ${reason}.`);
      return;
    }
    const restoredQueue = learningSessionQueue(savedLearningSession, ledger.associations);
    setQueue(restoredQueue);
    setSessionSeed(savedLearningSession.session_id);
    setSessionSourceMode(savedLearningSession.source_mode);
    setSessionCreatedAt(savedLearningSession.created_at);
    setMistakes(new Set(savedLearningSession.mistake_ids));
    setFirstPassCorrect(savedLearningSession.first_pass_correct);
    setCorrectionMode(savedLearningSession.phase === "correction");
    setCorrectionsComplete(false);
    setAnswerReview(savedLearningSession.answer_review);
    setRound(savedLearningSession.round);
    setPosition(savedLearningSession.position);
    setSelected(savedLearningSession.selected_option_ids);
    setChecked(savedLearningSession.checked);
    setClue(savedLearningSession.clue);
    setHintLevel(savedLearningSession.hint_level);
    setSection(savedLearningSession.section_code ?? "");
    setSessionSectionCodes(savedLearningSession.section_codes);
    setSessionLabel(savedLearningSession.selection_label);
    setSessionReturnView(savedLearningSession.return_view === "sections" ? "practice" : savedLearningSession.return_view);
    setStarted(performance.now());
    if (savedLearningSession.phase === "correction") {
      const result = await db.sessionResults.where("session_id").equals(savedLearningSession.session_id).last();
      setSessionResult(result ?? null);
    } else setSessionResult(null);
    setView("lesson");
  };
  const discardLearningSession = async () => {
    await db.learningSessions.delete("active:learning");
    setSavedLearningSession(null);
    setRecoveryNotice("Saved learning quiz discarded.");
  };
  const restartLearningSession = async () => {
    if (!savedLearningSession || !ledger) return;
    const saved = savedLearningSession;
    await db.learningSessions.delete(saved.id);
    setSavedLearningSession(null);
    startSession(
      learningSessionQueue(saved, ledger.associations),
      saved.section_code ?? "",
      saved.return_view === "sections" ? "practice" : saved.return_view,
      saved.source_mode,
      saved.section_codes,
      saved.selection_label,
      true,
    );
  };
  const association = queue[position],
    record = association
      ? content?.records.find((r) => r.id === association.record_id)
      : undefined;
  const updateLoadedCoordinate = (
    targetRecordId: string,
    featureIndex: number,
    coordinates: [number, number],
  ) => {
    const updateRecord = (current: LearningRecord) =>
      withUpdatedCoordinate(current, targetRecordId, featureIndex, coordinates);
    setExploreRecord((current) => (current ? updateRecord(current) : current));
    setContent((current) =>
      current
        ? { ...current, records: current.records.map(updateRecord) }
        : current,
    );
  };
  const sectionRecords = record
    ? content?.records.filter(
        (item) => item.section.code === record.section.code,
      ) || []
    : [];
  const question =
    record && association
      ? generateSectionQuestion(
          record,
          association,
          sectionRecords,
          roads,
          `${sessionSeed}:${position}`,
        )
      : null;
  const answerCorrect = question
    ? selected.length === question.answer_option_ids.length &&
      question.answer_option_ids.every((id) => selected.includes(id))
    : false;
  const wrongOptionExplanations = question
    ? explainSelectedDistractors(question, selected, sectionRecords)
    : [];
  const sessionPracticeDirection =
    queue.length && queue.every((item) => item.direction === queue[0].direction)
      ? queue[0].direction
      : undefined;
  useEffect(() => {
    if (!learningRecoveryReady || view !== "lesson" || !sessionSeed || !queue.length || !content) return;
    const now = new Date().toISOString();
    const snapshot: LearningSession = {
      id: "active:learning",
      schema_version: "1.0.0",
      status: "active",
      content_version: content.content_version,
      generator_version: QUESTION_GENERATOR_VERSION,
      session_id: sessionSeed,
      source_mode: sessionSourceMode,
      selection_label: sessionLabel,
      section_code: section || null,
      section_codes: sessionSectionCodes,
      ...(sessionPracticeDirection ? { practice_direction: sessionPracticeDirection } : {}),
      return_view: sessionReturnView as LearningReturnView,
      association_ids: queue.map((item) => item.id),
      position,
      round,
      phase: correctionMode ? "correction" : "first_pass",
      selected_option_ids: selected,
      checked,
      clue,
      hint_level: hintLevel,
      first_pass_correct: firstPassCorrect,
      mistake_ids: [...mistakes],
      answer_review: answerReview,
      created_at: sessionCreatedAt || now,
      updated_at: now,
    };
    void db.learningSessions.put(snapshot).then(() => setSavedLearningSession(snapshot));
  }, [answerReview, checked, clue, content, correctionMode, firstPassCorrect, hintLevel, learningRecoveryReady, mistakes, position, queue, round, section, selected, sessionCreatedAt, sessionLabel, sessionPracticeDirection, sessionReturnView, sessionSectionCodes, sessionSeed, sessionSourceMode, view]);
  const recordId = record?.id;
  useEffect(() => {
    if (recordId)
      db.studyAids
        .get(recordId)
        .then((value) =>
          setStudyAid(
            value || {
              record_id: recordId,
              mnemonic: "",
              confusion_note: "",
              updated_at: new Date().toISOString(),
            },
          ),
        );
  }, [recordId]);
  const saveAid = (next: StudyAid) => {
    setStudyAid(next);
    db.studyAids.put({ ...next, updated_at: new Date().toISOString() });
  };
  const check = () => {
    if (!association || !question || checked) return;
    setChecked(true);
    const correct =
      selected.length === question.answer_option_ids.length &&
      question.answer_option_ids.every((id) => selected.includes(id));
    if (!correctionMode) {
      setAnswerReview((current) => [
        ...current,
        {
          association_id: association.id,
          prompt: question.prompt,
          direction: question.direction,
          selected_answers: question.options
            .filter((option) => selected.includes(option.id))
            .map((option) => option.label),
          correct_answers: question.options
            .filter((option) => question.answer_option_ids.includes(option.id))
            .map((option) => option.label),
          correct,
        },
      ]);
    }
    if (!correctionMode && correct) setFirstPassCorrect((current) => current + 1);
    setMistakes((current) => {
      const updated = new Set(current);
      if (correct) updated.delete(association.id);
      else updated.add(association.id);
      return updated;
    });
    const attemptContext = {
      exercise_family: "multiple_choice",
      used_reveal: clue || hintLevel > 0,
      latency_ms: Math.round(performance.now() - started),
      confidence: correct ? (3 as const) : (1 as const),
      created_at: new Date().toISOString(),
      session_id: sessionSeed,
      content_version: content?.content_version,
      phase: correctionMode ? ("correction" as const) : ("first_pass" as const),
      source_mode: sessionSourceMode,
      question_instance_id: `${sessionSeed}:${round}:${position}`,
    };
    const attempt: Attempt = {
      association_id: association.id,
      correct,
      selected_option_ids: [...selected],
      keyed_option_ids: [...question.answer_option_ids],
      ...attemptContext,
    };
    const evidence = [
      attempt,
      ...atomicStreetAttempts(
        association,
        ledger?.associations ?? [],
        question,
        selected,
        attemptContext,
      ),
    ];
    const nextMastery = new Map(mastery);
    for (const item of evidence)
      nextMastery.set(
        item.association_id,
        applyAttempt(nextMastery.get(item.association_id), item),
      );
    db.transaction("rw", db.attempts, db.mastery, async () => {
      await db.attempts.bulkAdd(evidence);
      await db.mastery.bulkPut(
        evidence.map((item) => nextMastery.get(item.association_id)!),
      );
    });
    setAttempts((current) => [...current, ...evidence]);
    setMastery(nextMastery);
  };
  const next = async () => {
    if (position + 1 >= queue.length) {
      if (correctionMode && mistakes.size) {
        setQueue(
          randomiseAssociations(
            queue.filter((item) => mistakes.has(item.id)),
          ),
        );
        setPosition(0);
        setSelected([]);
        setChecked(false);
        setClue(false);
        setHintLevel(0);
        setRound((current) => current + 1);
        setStarted(performance.now());
        return;
      }
      if (correctionMode) {
        await db.learningSessions.delete("active:learning");
        setSavedLearningSession(null);
        setCorrectionsComplete(true);
        setView("results");
        return;
      }
      const result = createSessionResult({
        sessionId: sessionSeed,
        sectionCode: section || null,
        sectionCodes: sessionSectionCodes,
        selectionLabel: sessionLabel,
        practiceDirection:
          sessionSourceMode === "section" || sessionSourceMode === "section_set"
            ? sessionPracticeDirection
            : undefined,
        questionCount: queue.length,
        correctCount: firstPassCorrect,
        incorrectAssociationIds: mistakes,
      });
      await db.sessionResults.add(result);
      await db.learningSessions.delete("active:learning");
      setSavedLearningSession(null);
      setSessionResult(result);
      if (result.section_code)
        setLatestSectionResults((current) =>
          result.practice_direction
            ? new Map(current).set(sectionResultKey(result.section_code!, result.practice_direction), result)
            : current,
        );
      setView("results");
      return;
    }
    setPosition(position + 1);
    setSelected([]);
    setChecked(false);
    setClue(false);
    setHintLevel(0);
    setStarted(performance.now());
  };
  const reviewCorrections = () => {
    if (!sessionResult?.incorrect_association_ids.length) return;
    const ids = new Set(sessionResult.incorrect_association_ids);
    setMistakes(ids);
    setQueue(randomiseAssociations(queue.filter((item) => ids.has(item.id))));
    setCorrectionMode(true);
    setRound(2);
    setPosition(0);
    setSelected([]);
    setChecked(false);
    setClue(false);
    setHintLevel(0);
    setStarted(performance.now());
    setView("lesson");
  };
  const lessonKeyboardState = useRef({ view, question, checked, selected, check, next });
  lessonKeyboardState.current = { view, question, checked, selected, check, next };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = lessonKeyboardState.current;
      if (current.view !== "lesson" || !current.question) return;
      const target = event.target as HTMLElement;
      if (shouldIgnoreLessonShortcut(target)) return;
      const keys = ["a", "s", "d", "f", "z", "x", "c", "v"].slice(
        0,
        current.question.options.length,
      );
      const optionIndex = keys.indexOf(
        event.key.toLowerCase(),
      );
      if (optionIndex >= 0 && !current.checked && current.question.options[optionIndex]) {
        event.preventDefault();
        const id = current.question.options[optionIndex].id;
        setSelected((current) =>
          lessonKeyboardState.current.question?.selection_mode === "multiple"
            ? current.includes(id)
              ? current.filter((item) => item !== id)
              : [...current, id]
            : [id],
        );
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (current.checked) void current.next();
        else if (current.selected.length) current.check();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  if (error)
    return (
      <main className="fatal">
        <h1>Learning content unavailable</h1>
        <p>{error}</p>
      </main>
    );
  if (!content || !ledger)
    return <main className="loading">Preparing all learning records…</main>;
  return (
    <div className="shell">
      <aside className={mobileMenuOpen ? "menu-open" : ""}>
        <div className="brand">Glasgow Knowledge</div>
        <button
          type="button"
          className="mobile-menu-toggle"
          aria-expanded={mobileMenuOpen}
          aria-controls="course-navigation"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{mobileMenuOpen ? "×" : "☰"}</span>
          {mobileMenuOpen ? "Close" : "Menu"}
        </button>
        <p className="course-label">YOUR COURSE</p>
        <nav id="course-navigation" aria-label="Course navigation">
          {[
            ["overview", "Learn"],
            ["practice", "Practice"],
            ["mock", "Mock Exam"],
            ["final", "Final Assessment"],
            ["explore", "Explore answers"],
            ["feedback", "Feedback"],
            ["trouble", "Slips"],
            ["roads", "Roads"],
            ["journeys", "Journeys"],
            ["mastery", "Mastery review"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id as View);
                setMobileMenuOpen(false);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="side-progress">
          <div>
            <span>Course mastery</span>
            <b>{course.percentage.toFixed(1)}%</b>
          </div>
          <progress value={course.mastered} max={course.total} />
          <small>
            {course.mastered.toLocaleString()} of{" "}
            {course.total.toLocaleString()} associations mastered
          </small>
        </div>
      </aside>
      <main className={`main view-${view}`}>
        {recoveryNotice && view !== "lesson" && (
          <p className="assessment-notice" role="status">{recoveryNotice}</p>
        )}
        {savedLearningSession && view !== "lesson" && view !== "results" && (
          <section className="learning-resume" aria-label="Saved learning quiz">
            <div>
              <p className="eyebrow">SAVED QUIZ</p>
              <h2>{savedLearningSession.selection_label || "Learning quiz"}</h2>
              <span>
                Question {savedLearningSession.position + 1} of {savedLearningSession.association_ids.length}
                {savedLearningSession.phase === "correction" && ` · Correction round ${savedLearningSession.round - 1}`}
              </span>
            </div>
            <div>
              <button className="primary" onClick={() => void resumeLearningSession()}>Resume quiz</button>
              <button className="back" onClick={() => void restartLearningSession()}>Restart</button>
              <button className="back danger-link" onClick={() => void discardLearningSession()}>Discard</button>
            </div>
          </section>
        )}
        {view === "overview" && (
          <>
            <header className="page-head">
              <div>
                <p>FULL COURSE</p>
                <h1>Know every connection.</h1>
                <span>
                  Completion requires mastery of all{" "}
                  {course.total.toLocaleString()} required associations.
                </span>
              </div>
              <button className="primary" onClick={() => begin()}>
                Continue full course
              </button>
            </header>
            <section className="stats">
              <article>
                <span>Required associations</span>
                <b>{course.total.toLocaleString()}</b>
                <small>Every item is tracked</small>
              </article>
              <article>
                <span>Mastered</span>
                <b>{course.mastered.toLocaleString()}</b>
                <small>{course.total - course.mastered} remaining</small>
              </article>
              <article>
                <span>Source records</span>
                <b>{content.records.length.toLocaleString()}</b>
                <small>Nothing omitted</small>
              </article>
            </section>
            <section className="panel assessment-callout">
              <div>
                <p className="eyebrow">STRICT ASSESSMENT</p>
                <h2>Practice and exam conditions are separate.</h2>
                <p>Build each direction independently in Practice, rehearse 100 questions in Mock Exam, or prove exhaustive coverage in Final Assessment.</p>
              </div>
              <div className="mode-actions">
                <button className="primary" onClick={() => setView("practice")}>Choose practice</button>
                <button className="back" onClick={() => setView("mock")}>Open mock exam</button>
              </div>
            </section>
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h2>Latest recognition scores</h2>
                  <p>
                    Your most recent first-pass score for each section. A new
                    completed quiz replaces the score shown.
                  </p>
                </div>
                <button className="link" onClick={() => setView("practice")}>
                  Open both practice tracks
                </button>
              </div>
              <div className="section-table">
                {sectionStats.slice(0, 6).map((s) => {
                  const result = s.latestResults.reverse;
                  return <button key={s.code} onClick={() => begin(s.code, "reverse")}>
                    <span>{s.name}</span>
                    <progress
                      value={result?.correct_count ?? 0}
                      max={result?.question_count || 1}
                      aria-label={result ? `${result.correct_count} of ${result.question_count} correct on the last quiz` : "No completed quiz"}
                    />
                    <b>{result ? `${result.percentage.toFixed(0)}%` : "—"}</b>
                    <small>{result ? `${result.correct_count}/${result.question_count} correct` : "Not taken"}</small>
                  </button>;
                })}
              </div>
            </section>
          </>
        )}
        {view === "explore" && (
          <Explorer
            content={content}
            state={explorerState}
            onStateChange={setExplorerState}
            onOpenRecord={(record) => {
              setExplorerReturnY(window.scrollY);
              setExploreRecord(record);
              setView("explore-record");
            }}
          />
        )}
        {(view === "mock" || view === "final") && (
          <Assessments
            visibleMode={view}
            content={content}
            ledger={ledger}
            roads={roads}
            mastery={mastery}
            onFinalEvidence={(evidence, nextMastery) => {
              setAttempts((current) => [...current, ...evidence]);
              setMastery(nextMastery);
            }}
          />
        )}
        {view === "explore-record" && exploreRecord && (
          <>
            <header className="lesson-head explorer-detail-head">
              <button className="back" onClick={() => setView("explore")}>
                ← Back to all answers
              </button>
              <div>
                <b>{exploreRecord.section.name}</b>
                <span>{exploreRecord.type.replace("_", " ")}</span>
              </div>
            </header>
            <section className="explorer-detail">
              <Suspense fallback={<div className="map-panel map-loading" role="status">Loading map…</div>}>
                <LearningMap
                  record={exploreRecord}
                  roads={roadGeometry ?? roads}
                  labelled={mapStreetNames}
                  editable={coordinateEditingEnabled}
                  onLabelledChange={setMapStreetNames}
                  onCoordinateSaved={(featureIndex, coordinates) =>
                    updateLoadedCoordinate(exploreRecord.id, featureIndex, coordinates)
                  }
                />
              </Suspense>
              <article>
                <p className="eyebrow">EXAM ENTRY</p>
                <h1>{exploreRecord.exam_name}</h1>
                <p className="detail-intro">
                  {exploreRecord.type === "middle_road"
                    ? "This road runs between:"
                    : exploreRecord.type === "district"
                      ? "Roads associated with this district:"
                      : "Street answer:"}
                </p>
                <ol className="detail-answers">
                  {getAnswerFeatures(exploreRecord).map((feature) => (
                    <li key={feature.index}>
                      <span>{feature.exam_name}</span>
                      {feature.postcode && <small>{feature.postcode}</small>}
                    </li>
                  ))}
                </ol>
                <p className="read-only-note">
                  {coordinateEditingEnabled
                    ? "Dragging a map point saves that coordinate to glasgow-taxis.json and records an audit entry. "
                    : "Coordinate editing is available only in the local development environment. "}
                  Browsing does not alter course mastery or test history.
                </p>
              </article>
            </section>
          </>
        )}
        {view === "practice" && (
          <>
            <SectionQuizBuilder
              sections={sectionStats}
              onStartSingle={begin}
              onStartMultiple={beginCombinedSections}
            />
          </>
        )}
        {view === "lesson" && association && record && question && (
          <>
            <header className="lesson-head">
              <button className="back" onClick={() => setView(sessionReturnView)}>
                ← Leave session
              </button>
              <div>
                <b>
                  {sessionLabel || record.section.name}
                  {round > 1 && ` · Correction round ${round - 1}`}
                </b>
                <span>
                  {sessionSectionCodes.length > 1 && `${record.section.name} · `}{position + 1} of {queue.length}
                </span>
              </div>
            </header>
            {clue && <MapClueDialog
              record={record}
              roads={roadGeometry ?? roads}
              labelled={mapStreetNames}
              editable={coordinateEditingEnabled}
              onLabelledChange={setMapStreetNames}
              onCoordinateSaved={(featureIndex, coordinates) =>
                updateLoadedCoordinate(record.id, featureIndex, coordinates)
              }
              onClose={() => setClue(false)}
            />}
            <section className="lesson">
              <div className="task">
                <p>
                  {question.direction === "streets_to_category"
                    ? "EASY · STREETS TO CATEGORY"
                    : "CATEGORY TO STREETS"}{" "}
                  · {record.type.replace("_", " ")}
                </p>
                <h1>
                  {question.direction === "streets_to_category"
                    ? question.street_names.map((name) => (
                        <span className="street-prompt" key={name}>
                          {name}
                        </span>
                      ))
                    : question.prompt}
                </h1>
                <div className="aids">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setClue(true)}
                  >
                    View map
                  </button>
                  <button
                    onClick={() => setHintLevel(Math.min(2, hintLevel + 1))}
                  >
                    Progressive clue
                  </button>
                  <button
                    onClick={() => document.getElementById("mnemonic")?.focus()}
                  >
                    Mnemonic
                  </button>
                </div>
                {hintLevel > 0 && (
                  <div className="hint">
                    {hintLevel === 1
                      ? `${question.street_names.length} street${question.street_names.length === 1 ? "" : "s"} in the answer`
                      : `Initials: ${question.street_names.map((name) => name[0]).join(" · ")}`}
                  </div>
                )}
                {question.direction === "category_to_streets" && (
                  <p className="multi-instruction">
                    {question.selection_mode === "multiple"
                      ? "Select every associated street. There may be more than one."
                      : "Choose the street associated with this entry."}
                  </p>
                )}
                <div className="mc-options">
                  {question.options.map((option, index) => (
                    <button
                      key={option.id}
                      disabled={checked}
                      aria-pressed={selected.includes(option.id)}
                      className={`${selected.includes(option.id) ? "selected " : ""}${checked && question.answer_option_ids.includes(option.id) ? "correct " : ""}${checked && selected.includes(option.id) && !question.answer_option_ids.includes(option.id) ? "wrong" : ""}`}
                      onClick={() =>
                        setSelected((current) =>
                          question.selection_mode === "multiple"
                            ? current.includes(option.id)
                              ? current.filter((item) => item !== option.id)
                              : [...current, option.id]
                            : [option.id],
                        )
                      }
                    >
                      <span>
                        {["A", "S", "D", "F", "Z", "X", "C", "V"][index]}
                      </span>
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="keyboard-help">
                  <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd> choose
                  {question.options.length > 4 && (
                    <span className="extra-keys">
                      <kbd>Z</kbd><kbd>X</kbd><kbd>C</kbd><kbd>V</kbd>
                    </span>
                  )}
                  <span>·</span><kbd>Space</kbd> check / next
                </p>
                {checked && (
                  <div className={answerCorrect ? "feedback correct" : "feedback wrong"}>
                    <b>{answerCorrect ? "Correct" : "Not yet mastered"}</b>
                    <span>
                      Exact answer:{" "}
                      {question.options
                        .filter((option) =>
                          question.answer_option_ids.includes(option.id),
                        )
                        .map((option) => option.label)
                        .join(" · ")}
                    </span>
                    {clue || hintLevel ? (
                      <small>
                        Clues were used, so this attempt does not count as
                        unassisted mastery.
                      </small>
                    ) : (
                      <small>
                        Repeated correct attempts are required for mastery.
                      </small>
                    )}
                    {!answerCorrect && !!wrongOptionExplanations.length && (
                      <div className="wrong-option-explanations">
                        <b>Where your wrong choice is listed</b>
                        {wrongOptionExplanations.map((explanation) => (
                          <p key={explanation.optionId}>
                            <strong>{explanation.selectedLabel}</strong>{" "}
                            {question.direction === "category_to_streets"
                              ? <>is listed under <strong>{explanation.belongsTo}</strong>.</>
                              : <>is <strong>{explanation.belongsTo}</strong>, associated with {explanation.associatedAnswers.join(" · ")}.</>}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button
                  className="primary wide"
                  disabled={!selected.length}
                  onClick={checked ? next : check}
                >
                  {checked ? "Next question" : "Check answer"}
                </button>
                <details className="notebook">
                  <summary>My memory aids</summary>
                  <label htmlFor="mnemonic">Mnemonic or mental image</label>
                  <textarea
                    id="mnemonic"
                    value={studyAid?.mnemonic || ""}
                    onChange={(e) =>
                      studyAid &&
                      saveAid({ ...studyAid, mnemonic: e.target.value })
                    }
                    placeholder="Add a memorable story, image or phrase…"
                  />
                  <label htmlFor="confusion">I confuse this with…</label>
                  <textarea
                    id="confusion"
                    value={studyAid?.confusion_note || ""}
                    onChange={(e) =>
                      studyAid &&
                      saveAid({ ...studyAid, confusion_note: e.target.value })
                    }
                    placeholder="Record the similar item and the difference…"
                  />
                </details>
              </div>
            </section>
          </>
        )}
        {view === "results" && sessionResult && (
          <>
            <header className="page-head results-head">
              <div>
                <p>{sessionResult.scope === "section_set" ? "COMBINED SECTION TEST COMPLETE" : "SECTION TEST COMPLETE"}</p>
                <h1>Your answers, while they are still fresh.</h1>
                <span>
                  {sessionResult.selection_label || content?.sections.find((item) => item.code === sessionResult.section_code)?.name || "Course review"}
                </span>
              </div>
            </header>
            <section className="stats" aria-label="Test score summary">
              <article>
                <span>First-pass score</span>
                <b>{sessionResult.correct_count} / {sessionResult.question_count}</b>
              </article>
              <article>
                <span>Percentage</span>
                <b>{sessionResult.percentage.toFixed(0)}%</b>
              </article>
              <article>
                <span>Answers to revisit</span>
                <b>{sessionResult.incorrect_association_ids.length}</b>
              </article>
            </section>
            {correctionsComplete && (
              <p className="corrections-complete" role="status">
                Correction round complete. Your original first-pass results are shown below.
              </p>
            )}
            <section className="answer-breakdown" aria-labelledby="answer-breakdown-title">
              <div className="answer-breakdown-heading">
                <div>
                  <p className="eyebrow">ANSWER BREAKDOWN</p>
                  <h2 id="answer-breakdown-title">Every answer from this test</h2>
                </div>
                <span>{answerReview.length} reviewed</span>
              </div>
              <ol>
                {answerReview.map((item, index) => (
                  <li className={item.correct ? "review-correct" : "review-wrong"} key={item.association_id}>
                    <div className="review-number" aria-hidden="true">{index + 1}</div>
                    <div className="review-content">
                      <div className="review-status">
                        <b>{item.correct ? "Correct" : "Incorrect"}</b>
                        <span>
                          {item.direction === "streets_to_category" ? "Streets to place" : "Place to streets"}
                        </span>
                      </div>
                      <h3>{item.prompt}</h3>
                      <dl>
                        <div>
                          <dt>Your answer</dt>
                          <dd>{item.selected_answers.join(" · ")}</dd>
                        </div>
                        <div>
                          <dt>Correct answer</dt>
                          <dd>{item.correct_answers.join(" · ")}</dd>
                        </div>
                      </dl>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <div className="results-actions">
              {!!sessionResult.incorrect_association_ids.length && !correctionsComplete && (
                <button className="primary" onClick={reviewCorrections}>
                  Practise {sessionResult.incorrect_association_ids.length} missed {sessionResult.incorrect_association_ids.length === 1 ? "answer" : "answers"}
                </button>
              )}
              <button className="back" onClick={() => setView(sessionReturnView)}>
                {sessionReturnView === "trouble" ? "Back to slips" : sessionReturnView === "feedback" ? "Back to feedback" : sessionReturnView === "overview" ? "Back to learn" : "Back to practice"}
              </button>
            </div>
          </>
        )}
        {view === "roads" && content && roadTopology && roadGeometry && (
          <Suspense fallback={<div className="loading" role="status">Loading road study…</div>}>
            <Roads records={content.records} topology={roadTopology} geometry={roadGeometry} />
          </Suspense>
        )}
        {view === "journeys" && <Journeys />}
        {view === "trouble" && (
          <TroubleSpots
            spots={troubleSpots}
            sections={content.sections}
            onPractice={beginTroubleSpots}
          />
        )}
        {view === "feedback" && (
          <DirectionalFeedback
            items={directionalFeedback}
            sections={content.sections}
            onPractice={beginDirectionalPractice}
          />
        )}
        {view === "mastery" && (
          <>
            <header className="page-head">
              <div>
                <p>MASTERY REVIEW</p>
                <h1>No unknown item can hide.</h1>
                <span>
                  Progress is association-level, not an average quiz score.
                </span>
              </div>
            </header>
            <section className="stats">
              <article>
                <span>Unseen / learning</span>
                <b>{course.total - course.mastered}</b>
              </article>
              <article>
                <span>Mastered</span>
                <b>{course.mastered}</b>
              </article>
              <article>
                <span>Completion rule</span>
                <b>100%</b>
              </article>
            </section>
            <button className="primary" onClick={() => begin()}>
              Review required items
            </button>
          </>
        )}
      </main>
    </div>
  );
}
function MapClueDialog({
  record,
  roads,
  labelled,
  editable,
  onLabelledChange,
  onCoordinateSaved,
  onClose,
}: {
  record: LearningRecord;
  roads: RoadGeometryCollection;
  labelled: boolean;
  editable: boolean;
  onLabelledChange: (labelled: boolean) => void;
  onCoordinateSaved: (featureIndex: number, coordinates: [number, number]) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="map-clue-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="map-clue-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-clue-title"
      >
        <header>
          <div>
            <p>MAP CLUE</p>
            <h2 id="map-clue-title">{record.exam_name}</h2>
          </div>
          <button ref={closeButton} type="button" className="map-clue-close" onClick={onClose}>
            <span aria-hidden="true">&times;</span> Close
          </button>
        </header>
        <Suspense fallback={<div className="map-panel map-loading" role="status">Loading map…</div>}>
          <LearningMap
            record={record}
            roads={roads}
            labelled={labelled}
            editable={editable}
            onLabelledChange={onLabelledChange}
            onCoordinateSaved={onCoordinateSaved}
          />
        </Suspense>
      </section>
    </div>
  );
}
