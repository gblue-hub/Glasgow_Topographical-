import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import "./learning.css";
import "./explorer.css";
import { Explorer, type ExplorerState } from "./components/Explorer";
import { TroubleSpots } from "./components/TroubleSpots";
import { Assessments } from "./components/Assessments";
import { DirectionalFeedback } from "./components/DirectionalFeedback";
import { GeographicKnowledgeCard } from "./components/GeographicKnowledgeCard";
import { SectionQuizBuilder } from "./components/SectionQuizBuilder";
import { StudyBeforeTestCard } from "./components/StudyBeforeTestCard";
import { TodaySessionCard } from "./components/TodaySessionCard";
import { loadLearningData } from "./data/content";
import { db } from "./data/db";
import { applyAttemptEvidence, completion } from "./domain/mastery";
import { explainSelectedDistractors, generateSectionQuestion, getAnswerFeatures, QUESTION_GENERATOR_VERSION } from "./domain/questions";
import { createSessionResult, indexLatestSectionResults, randomiseAssociations, sectionResultKey } from "./domain/session";
import { compareSectionCodes, formatSectionName } from "./domain/sections";
import { buildTroubleSpots } from "./domain/trouble-spots";
import { atomicStreetAttempts } from "./domain/atomic-streets";
import { shouldIgnoreLessonShortcut } from "./domain/lesson-keyboard";
import { buildDirectionalFeedback } from "./domain/directional-feedback";
import { buildGeographicKnowledge } from "./domain/geographic-knowledge";
import { requiredAssociationsForSections } from "./domain/section-groups";
import { learningSessionQueue, validateLearningSession } from "./domain/learning-session";
import { buildDailyLearningPlan } from "./domain/daily-learning";
import {
  hasIndependentSuccessfulRetrieval,
  initialQuestionStage,
  learningStageLabel,
} from "./domain/learning-flow";
import { withUpdatedCoordinate } from "./domain/coordinate-state";
import { categoryLocationFeature, formatExplorerCoordinate } from "./domain/explorer";
import {
  PRIMARY_NAVIGATION,
  primaryAreaForView,
  type AppView,
} from "./domain/navigation";

const coordinateEditingEnabled = import.meta.env.DEV;
import type {
  Association,
  Attempt,
  CoverageLedger,
  LearningContent,
  LearningRecord,
  LearningAnswerReview,
  LearningQuestionStage,
  LearningReturnView,
  LearningSession,
  Mastery,
  StudyAid,
  RoadGeometryCollection,
  SessionResult,
} from "./domain/types";

type View = AppView;
const readinessLabels = {
  getting_started: "Getting started",
  building: "Building",
  progressing: "Progressing",
  nearly_ready: "Nearly ready",
  ready: "Ready",
} as const;
const LearningMap = lazy(() =>
  import("./components/LearningMap").then((module) => ({ default: module.LearningMap })),
);
const Roads = lazy(() =>
  import("./components/Roads").then((module) => ({ default: module.Roads })),
);
const loadJourneysModule = () => import("./components/Journeys");
const Journeys = lazy(() =>
  loadJourneysModule().then((module) => ({ default: module.Journeys })),
);
const GeographicInsights = lazy(() =>
  import("./components/GeographicInsights").then((module) => ({
    default: module.GeographicInsights,
  })),
);

function SubviewNavigation({
  label,
  view,
  items,
  onSelect,
}: {
  label: string;
  view: View;
  items: Array<{ view: View; label: string }>;
  onSelect: (view: View) => void;
}) {
  return (
    <nav className="subview-tabs" aria-label={label}>
      {items.map((item) => (
        <button
          type="button"
          className={view === item.view ? "active" : ""}
          aria-current={view === item.view ? "page" : undefined}
          onClick={() => onSelect(item.view)}
          key={item.view}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export default function App() {
  const [content, setContent] = useState<LearningContent | null>(null),
    [ledger, setLedger] = useState<CoverageLedger | null>(null),
    [roads, setRoads] = useState<any>(null),
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
    [learnerStateReady, setLearnerStateReady] = useState(false),
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
    [questionStage, setQuestionStage] =
      useState<LearningQuestionStage>("prompt"),
    [studiedRecordIds, setStudiedRecordIds] = useState<Set<string>>(new Set()),
    [mapOpen, setMapOpen] = useState(false),
    [comparisonRecordId, setComparisonRecordId] = useState<string | null>(null),
    [usedAssistance, setUsedAssistance] = useState(false),
    [hintLevel, setHintLevel] = useState(0),
    [confidence, setConfidence] = useState<1 | 2 | 3>(2),
    [studyAid, setStudyAid] = useState<StudyAid | null>(null),
    [exploreRecord, setExploreRecord] = useState<LearningRecord | null>(null),
    [explorerState, setExplorerState] = useState<ExplorerState>({ query: "", sectionCode: "", type: "all", page: 1 }),
    [explorerReturnY, setExplorerReturnY] = useState<number | null>(null),
    [mapStreetNames, setMapStreetNames] = useState(true),
    [mobileMenuOpen, setMobileMenuOpen] = useState(false),
    [clock, setClock] = useState(() => new Date()),
    [answerSaving, setAnswerSaving] = useState(false),
    [recoveryNotice, setRecoveryNotice] = useState(""),
    [error, setError] = useState("");
  const exploreCategoryLocation = exploreRecord
    ? categoryLocationFeature(exploreRecord)
    : null;
  const activePrimaryArea =
    ["lesson", "results"].includes(view) &&
    ["feedback", "trouble", "mastery"].includes(sessionReturnView)
      ? "progress"
      : primaryAreaForView(view);
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
    Promise.all([
      db.mastery.toArray(),
      db.attempts.toArray(),
      db.sessionResults.toArray(),
    ])
      .then(([masteryRows, attemptRows, resultRows]) => {
        setMastery(
          new Map(masteryRows.map((row) => [row.association_id, row])),
        );
        setAttempts(attemptRows);
        setLatestSectionResults(indexLatestSectionResults(resultRows));
        setLearnerStateReady(true);
      })
      .catch((cause) =>
        setError(
          `Learner progress could not be loaded: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        ),
      );
  }, []);
  useEffect(() => {
    if (!content || !roads) return;
    let cancelled = false;
    const prepare = () => {
      void Promise.all([
        loadJourneysModule(),
        import("./domain/journeys"),
      ]).then(([, journeys]) => {
        if (!cancelled)
          journeys.prepareJourneyWorkshop(content.records, roads);
      });
    };
    const idleCallback = window.requestIdleCallback?.(prepare, {
      timeout: 1_500,
    });
    const timer =
      idleCallback === undefined ? window.setTimeout(prepare, 250) : undefined;
    return () => {
      cancelled = true;
      if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [content, roads]);
  useEffect(() => {
    if (!content || !ledger || !learnerStateReady) return;
    let cancelled = false;
    db.learningSessions
      .get("active:learning")
      .then(async (saved) => {
        if (cancelled) return;
        if (!saved) {
          setLearningRecoveryReady(true);
          return;
        }
        const reason = validateLearningSession(
          saved,
          ledger.associations,
          content.content_version,
        );
        if (reason) {
          await db.learningSessions.delete(saved.id);
          if (!cancelled)
            setRecoveryNotice(
              `A saved learning quiz was retired safely: ${reason}.`,
            );
        } else if (!cancelled) setSavedLearningSession(saved);
        if (!cancelled) setLearningRecoveryReady(true);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            `Saved-session recovery could not be completed: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          );
      });
    return () => { cancelled = true; };
  }, [content, learnerStateReady, ledger]);
  useEffect(() => {
    const updateClock = () => setClock(new Date());
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") updateClock();
    };
    const timer = window.setInterval(updateClock, 60_000);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);
  const allIds =
      ledger?.associations.filter((a) => a.required).map((a) => a.id) || [],
    course = completion(allIds, mastery);
  const dailyPlan = useMemo(
    () => {
      const now = clock;
      const dayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      return buildDailyLearningPlan({
        associations: ledger?.associations ?? [],
        mastery,
        attempts,
        now,
        dayStart,
        seed: `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`,
      });
    },
    [attempts, clock, ledger, mastery],
  );
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
  const geographicKnowledge = useMemo(
    () =>
      buildGeographicKnowledge({
        records: content?.records ?? [],
        associations: ledger?.associations ?? [],
        mastery,
        attempts,
        now: clock,
      }),
    [attempts, clock, content, ledger, mastery],
  );
  const startSession = (
    selectedQueue: Association[],
    code: string,
    returnView: Exclude<LearningReturnView, "sections">,
    sourceMode: LearningSession["source_mode"],
    sectionCodes: string[] = code ? [code] : [],
    label = "",
    replaceSaved = false,
    preserveOrder = false,
  ) => {
    if (!selectedQueue.length) return;
    if (!replaceSaved && savedLearningSession && !window.confirm(`Starting a new quiz will replace your saved ${savedLearningSession.selection_label || "learning quiz"}. Continue?`)) return;
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    const seed = values[0].toString(36);
    const now = new Date().toISOString();
    const preparedQueue = preserveOrder
      ? [...selectedQueue]
      : randomiseAssociations(selectedQueue);
    const firstAssociation = preparedQueue[0];
    setQueue(preparedQueue);
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
    setStudiedRecordIds(new Set());
    setQuestionStage(
      initialQuestionStage({
        association: firstAssociation,
        sourceMode,
        mastery: mastery.get(firstAssociation.id),
        hasPriorAttempt: attempts.some(
          (attempt) => attempt.association_id === firstAssociation.id,
        ),
        studiedRecordIds: new Set(),
        correctionMode: false,
      }),
    );
    setMapOpen(false);
    setComparisonRecordId(null);
    setUsedAssistance(false);
    setHintLevel(0);
    setConfidence(2);
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
  const beginDaily = () => {
    if (!dailyPlan.queue.length) return;
    const sectionCodes = [
      ...new Set(dailyPlan.queue.map((association) => association.section_code)),
    ];
    startSession(
      dailyPlan.queue,
      "",
      "overview",
      "daily",
      sectionCodes,
      `Today's ${dailyPlan.direction === "reverse" ? "Recognition" : "Recall"} session`,
      false,
      true,
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
    setQuestionStage(savedLearningSession.question_stage);
    setStudiedRecordIds(new Set(savedLearningSession.studied_record_ids));
    setMapOpen(savedLearningSession.map_open);
    setComparisonRecordId(null);
    setUsedAssistance(savedLearningSession.used_assistance);
    setHintLevel(savedLearningSession.hint_level);
    setConfidence(savedLearningSession.confidence);
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
      saved.source_mode === "daily",
    );
  };
  const association = queue[position],
    record = association
      ? content?.records.find((r) => r.id === association.record_id)
      : undefined;
  const comparisonRecord = comparisonRecordId
    ? content?.records.find((candidate) => candidate.id === comparisonRecordId)
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
  const hasPriorIndependentSuccess = association
    ? hasIndependentSuccessfulRetrieval(
        attempts,
        association.id,
        sessionSeed,
      )
    : false;
  const question =
    record && association
      ? generateSectionQuestion(
          record,
          association,
          sectionRecords,
          roads,
          `${sessionSeed}:${position}`,
          sessionSourceMode === "daily" && !hasPriorIndependentSuccess
            ? "supported"
            : "exam",
        )
      : null;
  const answerCorrect = question
    ? selected.length === question.answer_option_ids.length &&
      question.answer_option_ids.every((id) => selected.includes(id))
    : false;
  const wrongOptionExplanations = question
    ? explainSelectedDistractors(question, selected, sectionRecords)
    : [];
  const progressiveHint =
    question && hintLevel > 0
      ? question.direction === "category_to_streets"
        ? hintLevel === 1
          ? `${question.street_names.length} street${question.street_names.length === 1 ? "" : "s"} in the answer`
          : `Street initials: ${question.street_names.map((name) => name[0]).join(" · ")}`
        : hintLevel === 1
          ? `The category answer begins with “${record?.exam_name.trim()[0] ?? ""}”.`
          : `Category initials: ${record?.exam_name
              .trim()
              .split(/\s+/)
              .map((word) => word[0])
              .join(" · ")}`
      : "";
  const sessionPracticeDirection =
    queue.length && queue.every((item) => item.direction === queue[0].direction)
      ? queue[0].direction
      : undefined;
  const nextSessionReviewAt = queue
    .map((item) => mastery.get(item.id)?.next_due_at)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const nextSessionReviewLabel = nextSessionReviewAt
    ? new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(nextSessionReviewAt))
    : "after more learning evidence";
  useEffect(() => {
    if (!learningRecoveryReady || view !== "lesson" || !sessionSeed || !queue.length || !content) return;
    const now = new Date().toISOString();
    const snapshot: LearningSession = {
      id: "active:learning",
      schema_version: "1.1.0",
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
      question_stage: questionStage,
      studied_record_ids: [...studiedRecordIds],
      selected_option_ids: selected,
      checked,
      map_open: mapOpen,
      used_assistance: usedAssistance,
      hint_level: hintLevel,
      confidence,
      first_pass_correct: firstPassCorrect,
      mistake_ids: [...mistakes],
      answer_review: answerReview,
      created_at: sessionCreatedAt || now,
      updated_at: now,
    };
    void db.learningSessions
      .put(snapshot)
      .then(() => setSavedLearningSession(snapshot))
      .catch((cause) =>
        setError(
          `This learning session could not be saved: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        ),
      );
  }, [answerReview, checked, confidence, content, correctionMode, firstPassCorrect, hintLevel, learningRecoveryReady, mapOpen, mistakes, position, questionStage, queue, round, section, selected, sessionCreatedAt, sessionLabel, sessionPracticeDirection, sessionReturnView, sessionSectionCodes, sessionSeed, sessionSourceMode, studiedRecordIds, usedAssistance, view]);
  const recordId = record?.id;
  useEffect(() => {
    let cancelled = false;
    setStudyAid(null);
    if (recordId)
      void db.studyAids.get(recordId).then((value) => {
        if (cancelled) return;
        setStudyAid(
          value || {
            record_id: recordId,
            mnemonic: "",
            confusion_note: "",
            updated_at: new Date().toISOString(),
          },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);
  const saveAid = (next: StudyAid) => {
    setStudyAid(next);
    db.studyAids.put({ ...next, updated_at: new Date().toISOString() });
  };
  const check = async () => {
    if (
      !association ||
      !question ||
      checked ||
      answerSaving ||
      questionStage !== "choices"
    )
      return;
    setAnswerSaving(true);
    const correct =
      selected.length === question.answer_option_ids.length &&
      question.answer_option_ids.every((id) => selected.includes(id));
    const attemptContext = {
      exercise_family: "multiple_choice",
      used_reveal: usedAssistance,
      latency_ms: Math.round(performance.now() - started),
      confidence,
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
    const nextMastery = applyAttemptEvidence(
      mastery,
      evidence,
      correctionMode ? "correction" : "first_pass",
    );
    try {
      await db.transaction("rw", db.attempts, db.mastery, async () => {
        await db.attempts.bulkAdd(evidence);
        if (!correctionMode)
          await db.mastery.bulkPut(
            evidence.map((item) => nextMastery.get(item.association_id)!),
          );
      });
    } catch (cause) {
      setAnswerSaving(false);
      setError(
        `This answer could not be saved: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return;
    }
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
    if (!correctionMode && correct)
      setFirstPassCorrect((current) => current + 1);
    setMistakes((current) => {
      const updated = new Set(current);
      if (correct) updated.delete(association.id);
      else updated.add(association.id);
      return updated;
    });
    setAttempts((current) => [...current, ...evidence]);
    if (!correctionMode) setMastery(nextMastery);
    setChecked(true);
    setQuestionStage("feedback");
    setAnswerSaving(false);
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
        setQuestionStage("prompt");
        setMapOpen(false);
        setComparisonRecordId(null);
        setUsedAssistance(false);
        setHintLevel(0);
        setConfidence(2);
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
    const nextAssociation = queue[position + 1];
    setPosition(position + 1);
    setSelected([]);
    setChecked(false);
    setQuestionStage(
      initialQuestionStage({
        association: nextAssociation,
        sourceMode: sessionSourceMode,
        mastery: mastery.get(nextAssociation.id),
        hasPriorAttempt: attempts.some(
          (attempt) => attempt.association_id === nextAssociation.id,
        ),
        studiedRecordIds,
        correctionMode,
      }),
    );
    setMapOpen(false);
    setComparisonRecordId(null);
    setUsedAssistance(false);
    setHintLevel(0);
    setConfidence(2);
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
    setQuestionStage("prompt");
    setMapOpen(false);
    setComparisonRecordId(null);
    setUsedAssistance(false);
    setHintLevel(0);
    setConfidence(2);
    setStarted(performance.now());
    setView("lesson");
  };
  const completeStudy = () => {
    if (!record || questionStage !== "study") return;
    setStudiedRecordIds((current) => new Set(current).add(record.id));
    setQuestionStage("prompt");
    setStarted(performance.now());
  };
  const revealChoices = () => {
    if (questionStage !== "prompt") return;
    setQuestionStage("choices");
    setStarted(performance.now());
  };
  const lessonKeyboardState = useRef({
    view,
    question,
    questionStage,
    checked,
    selected,
    check,
    next,
    completeStudy,
    revealChoices,
  });
  lessonKeyboardState.current = {
    view,
    question,
    questionStage,
    checked,
    selected,
    check,
    next,
    completeStudy,
    revealChoices,
  };
  useEffect(() => {
    if (view !== "lesson" || !association) return;
    const frame = window.requestAnimationFrame(() => {
      const target =
        questionStage === "study"
          ? document.querySelector<HTMLElement>(
              ".study-before-test-card h2",
            )
          : questionStage === "choices"
            ? document.querySelector<HTMLElement>(
                ".mc-options button:not(:disabled)",
              )
            : document.getElementById("learning-question-heading");
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [association, position, questionStage, view]);
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
      if (
        optionIndex >= 0 &&
        current.questionStage === "choices" &&
        !current.checked &&
        current.question.options[optionIndex]
      ) {
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
        if (current.questionStage === "study") current.completeStudy();
        else if (current.questionStage === "prompt") current.revealChoices();
        else if (current.questionStage === "feedback") void current.next();
        else if (current.selected.length) void current.check();
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
  if (!content || !ledger || !learnerStateReady || !learningRecoveryReady)
    return <main className="loading">Preparing all learning records…</main>;
  return (
    <div className="shell">
      <aside className={mobileMenuOpen ? "menu-open" : ""}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">GK</span>
          <span>
            Glasgow Knowledge
            <small>THE CITY · AREA BY AREA</small>
          </span>
        </div>
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
          {PRIMARY_NAVIGATION.map((item) => (
            <button
              key={item.id}
              className={activePrimaryArea === item.id ? "active" : ""}
              aria-current={activePrimaryArea === item.id ? "page" : undefined}
              onClick={() => {
                setView(item.view);
                setMobileMenuOpen(false);
              }}
            >
              {item.label}
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
                {` · ${learningStageLabel[savedLearningSession.question_stage]}`}
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
        {(view === "overview" || view === "practice") && (
          <SubviewNavigation
            label="Learn"
            view={view}
            items={[
              { view: "overview", label: "Recommended" },
              { view: "practice", label: "Build a quiz" },
            ]}
            onSelect={setView}
          />
        )}
        {(view === "explore" || view === "roads" || view === "journeys") && (
          <SubviewNavigation
            label="Explore"
            view={view}
            items={[
              { view: "explore", label: "Answers" },
              { view: "roads", label: "Roads" },
              { view: "journeys", label: "Journeys" },
            ]}
            onSelect={setView}
          />
        )}
        {(view === "areas" || view === "feedback" || view === "trouble" || view === "mastery") && (
          <SubviewNavigation
            label="Progress"
            view={view}
            items={[
              { view: "mastery", label: "Mastery" },
              { view: "areas", label: "Areas" },
              { view: "feedback", label: "Feedback" },
              { view: "trouble", label: "Slips" },
            ]}
            onSelect={setView}
          />
        )}
        {view === "overview" && (
          <>
            <header className="page-head overview-hero">
              <div>
                <p>YOUR PERSONALISED ROUTE</p>
                <h1>Build the city, area by area.</h1>
                <span>
                  Follow a clear route through Glasgow, strengthen the places
                  you know less well, and keep every connection ready for the
                  exam.
                </span>
              </div>
              <div className="overview-hero__route" aria-label="Current learning route">
                <span>Today</span>
                <i aria-hidden="true" />
                <strong>
                  {dailyPlan.direction === "reverse" ? "Recognition" : "Recall"}
                </strong>
                <small>
                  {dailyPlan.focusSectionCode
                    ? formatSectionName(
                        content.sections.find(
                          (item) => item.code === dailyPlan.focusSectionCode,
                        )?.name ?? `Section ${dailyPlan.focusSectionCode}`,
                      )
                    : "Scheduled review"}
                </small>
              </div>
            </header>
            <TodaySessionCard
              counts={dailyPlan.counts}
              totalItemCount={dailyPlan.counts.total}
              focusLabel={
                dailyPlan.focusSectionCode
                  ? formatSectionName(
                      content.sections.find(
                        (item) => item.code === dailyPlan.focusSectionCode,
                      )?.name ?? `Section ${dailyPlan.focusSectionCode}`,
                    )
                  : undefined
              }
              estimatedMinutes={
                dailyPlan.counts.total
                  ? Math.max(5, Math.ceil(dailyPlan.counts.total * 0.75))
                  : 0
              }
              onStart={beginDaily}
              emptyState={
                <>
                  <strong>You&apos;re caught up for today.</strong>
                  <span>
                    Build a focused quiz if you would like extra practice.
                  </span>
                </>
              }
            />
            <section className="stats">
              <article>
                <span>Learning readiness</span>
                <b>{dailyPlan.readiness.score.toFixed(0)}%</b>
                <small>{readinessLabels[dailyPlan.readiness.level]}</small>
              </article>
              <article>
                <span>Mastered</span>
                <b>{course.mastered.toLocaleString()}</b>
                <small>
                  of {course.total.toLocaleString()} required connections
                </small>
              </article>
              <article>
                <span>Today&apos;s track</span>
                <b>
                  {dailyPlan.direction === "reverse"
                    ? "Recognition"
                    : "Recall"}
                </b>
                <small>Directions stay separate while you practise</small>
              </article>
            </section>
            <GeographicKnowledgeCard
              summary={geographicKnowledge}
              onOpenInsights={() => setView("areas")}
            />
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
              onModeChange={setView}
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
                  roads={roads}
                  mode="explore"
                  editable={coordinateEditingEnabled}
                  onCoordinateSaved={(featureIndex, coordinates) =>
                    updateLoadedCoordinate(exploreRecord.id, featureIndex, coordinates)
                  }
                />
              </Suspense>
              <article>
                <p className="eyebrow">EXAM ENTRY</p>
                <h1>{exploreRecord.exam_name}</h1>
                {exploreCategoryLocation && (
                  <dl className="detail-location">
                    <div>
                      <dt>Category location</dt>
                      <dd>{exploreCategoryLocation.exam_name}</dd>
                    </div>
                    <div>
                      <dt>Place coordinate</dt>
                      <dd>
                        <code>
                          {formatExplorerCoordinate(
                            exploreCategoryLocation.effective_coordinates,
                          )}
                        </code>
                      </dd>
                    </div>
                    {exploreCategoryLocation.postcode && (
                      <div>
                        <dt>Postcode</dt>
                        <dd>{exploreCategoryLocation.postcode}</dd>
                      </div>
                    )}
                  </dl>
                )}
                <p className="detail-intro">
                  {exploreRecord.type === "middle_road"
                    ? "This road runs between:"
                    : exploreRecord.type === "district"
                      ? "Roads associated with this district:"
                      : "Associated roads:"}
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
              <button
                className="back"
                type="button"
                onClick={() => setView(sessionReturnView)}
              >
                ← Leave session
              </button>
              <div>
                <b>
                  {sessionLabel || formatSectionName(record.section.name)}
                  {round > 1 && ` · Correction round ${round - 1}`}
                </b>
                <span>
                  {sessionSectionCodes.length > 1 &&
                    `${formatSectionName(record.section.name)} · `}
                  {position + 1} of {queue.length} ·{" "}
                  {learningStageLabel[questionStage]}
                </span>
              </div>
            </header>
            {questionStage === "study" ? (
              <StudyBeforeTestCard
                record={record}
                onReady={completeStudy}
                readyLabel="I'm ready — test me"
                mapSlot={
                  <Suspense
                    fallback={
                      <div className="map-panel map-loading" role="status">
                        Loading study map…
                      </div>
                    }
                  >
                    <LearningMap
                      key={`study:${record.id}`}
                      record={record}
                      roads={roads}
                      mode="study"
                      labelled
                    />
                  </Suspense>
                }
                instructions={
                  <>
                    <h3>Build the connection</h3>
                    <p>
                      Notice where the exam entry and its roads sit together.
                      The spellings shown here are the exact exam wording.
                    </p>
                    {studyAid?.mnemonic && (
                      <p className="study-memory-aid">
                        <strong>Your memory aid:</strong> {studyAid.mnemonic}
                      </p>
                    )}
                  </>
                }
              />
            ) : (
              <>
                {mapOpen && (
                  <MapClueDialog
                    record={record}
                    roads={roads}
                    labelled={mapStreetNames}
                    editable={coordinateEditingEnabled}
                    onLabelledChange={setMapStreetNames}
                    onCoordinateSaved={(featureIndex, coordinates) =>
                      updateLoadedCoordinate(
                        record.id,
                        featureIndex,
                        coordinates,
                      )
                    }
                    onClose={() => setMapOpen(false)}
                  />
                )}
                {comparisonRecord && (
                  <ConfusionMapDialog
                    correctRecord={record}
                    confusedRecord={comparisonRecord}
                    roads={roads}
                    onClose={() => setComparisonRecordId(null)}
                  />
                )}
                <section className="lesson">
                  <div className="task">
                    <p>
                      {question.direction === "streets_to_category"
                        ? "RECOGNITION · STREETS TO CATEGORY"
                        : "RECALL · CATEGORY TO STREETS"}{" "}
                      · {record.type.replace("_", " ")}
                    </p>
                    <h1 id="learning-question-heading" tabIndex={-1}>
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
                        onClick={() => {
                          setMapOpen(true);
                          if (questionStage !== "feedback")
                            setUsedAssistance(true);
                        }}
                      >
                        {questionStage === "feedback"
                          ? "Review map"
                          : "View map"}
                      </button>
                      {questionStage !== "feedback" && (
                        <button
                          type="button"
                          onClick={() => {
                            setHintLevel(Math.min(2, hintLevel + 1));
                            setUsedAssistance(true);
                          }}
                        >
                          Progressive clue
                        </button>
                      )}
                    </div>
                    {hintLevel > 0 && (
                      <div className="hint">
                        {progressiveHint}
                      </div>
                    )}
                    {questionStage === "prompt" ? (
                      <section
                        className="think-first"
                        aria-labelledby="think-first-title"
                      >
                        <p className="learning-enhancement-eyebrow">
                          THINK FIRST
                        </p>
                        <h2 id="think-first-title">
                          Bring the answer to mind before seeing the choices.
                        </h2>
                        <p>
                          There is nothing to type or say. Take a moment, then
                          continue in the same multiple-choice format as the
                          real exam.
                        </p>
                        <button
                          className="primary"
                          type="button"
                          onClick={revealChoices}
                        >
                          I&apos;ve thought of it — show choices
                        </button>
                        <small>
                          Keyboard: press <kbd>Space</kbd> when ready
                        </small>
                      </section>
                    ) : (
                      <>
                        {question.direction === "category_to_streets" && (
                          <p className="multi-instruction">
                            {question.selection_mode === "multiple"
                              ? "Select every associated street. There may be more than one."
                              : "Choose the street associated with this entry."}
                          </p>
                        )}
                        <div
                          className="mc-options"
                          role="group"
                          aria-labelledby="learning-question-heading"
                          aria-live={
                            questionStage === "choices" ? "polite" : "off"
                          }
                        >
                          {question.options.map((option, index) => (
                            <button
                              type="button"
                              key={option.id}
                              disabled={
                                questionStage === "feedback" || answerSaving
                              }
                              aria-pressed={selected.includes(option.id)}
                              className={`${selected.includes(option.id) ? "selected " : ""}${questionStage === "feedback" && question.answer_option_ids.includes(option.id) ? "correct " : ""}${questionStage === "feedback" && selected.includes(option.id) && !question.answer_option_ids.includes(option.id) ? "wrong" : ""}`}
                              onClick={() =>
                                setSelected((current) =>
                                  question.selection_mode === "multiple"
                                    ? current.includes(option.id)
                                      ? current.filter(
                                          (item) => item !== option.id,
                                        )
                                      : [...current, option.id]
                                    : [option.id],
                                )
                              }
                            >
                              <span>
                                {
                                  ["A", "S", "D", "F", "Z", "X", "C", "V"][
                                    index
                                  ]
                                }
                              </span>
                              {option.label}
                            </button>
                          ))}
                        </div>
                        {questionStage === "choices" && (
                          <>
                            <fieldset className="confidence-check">
                              <legend>How sure are you?</legend>
                              {(
                                [
                                  [1, "Guessing"],
                                  [2, "Unsure"],
                                  [3, "Confident"],
                                ] as const
                              ).map(([value, label]) => (
                                <button
                                  type="button"
                                  aria-pressed={confidence === value}
                                  className={
                                    confidence === value ? "selected" : ""
                                  }
                                  onClick={() => setConfidence(value)}
                                  key={value}
                                >
                                  {label}
                                </button>
                              ))}
                              <small>
                                This only adjusts when the connection returns;
                                it never changes whether your answer is right.
                              </small>
                            </fieldset>
                            <p className="keyboard-help">
                              <kbd>A</kbd>
                              <kbd>S</kbd>
                              <kbd>D</kbd>
                              <kbd>F</kbd> choose
                              {question.options.length > 4 && (
                                <span className="extra-keys">
                                  <kbd>Z</kbd>
                                  <kbd>X</kbd>
                                  <kbd>C</kbd>
                                  <kbd>V</kbd>
                                </span>
                              )}
                              <span>·</span>
                              <kbd>Space</kbd> check
                            </p>
                          </>
                        )}
                        {questionStage === "feedback" && (
                          <div
                            className={
                              answerCorrect
                                ? "feedback correct"
                                : "feedback wrong"
                            }
                            role="status"
                            aria-live="polite"
                          >
                            <b>
                              {answerCorrect
                                ? "Correct"
                                : "Not yet mastered"}
                            </b>
                            <span>
                              Exact answer:{" "}
                              {question.options
                                .filter((option) =>
                                  question.answer_option_ids.includes(
                                    option.id,
                                  ),
                                )
                                .map((option) => option.label)
                                .join(" · ")}
                            </span>
                            {usedAssistance ? (
                              <small>
                                A clue was used, so this returns sooner and does
                                not count as unassisted mastery.
                              </small>
                            ) : confidence === 1 ? (
                              <small>
                                You marked this as a guess, so it will return
                                sooner even if the choice was correct.
                              </small>
                            ) : confidence === 2 ? (
                              <small>
                                You marked this as unsure, so it will return
                                sooner for reinforcement.
                              </small>
                            ) : (
                              <small>
                                Repeated confident attempts are required for
                                mastery.
                              </small>
                            )}
                            {!answerCorrect &&
                              !!wrongOptionExplanations.length && (
                                <div className="wrong-option-explanations">
                                  <b>Where your wrong choice is listed</b>
                                  {wrongOptionExplanations.map(
                                    (explanation) => (
                                      <div
                                        className="wrong-option-explanation"
                                        key={explanation.optionId}
                                      >
                                        <p>
                                          <strong>
                                            {explanation.selectedLabel}
                                          </strong>{" "}
                                          {question.direction ===
                                          "category_to_streets" ? (
                                            <>
                                              is listed under{" "}
                                              <strong>
                                                {explanation.belongsTo}
                                              </strong>
                                              .
                                            </>
                                          ) : (
                                            <>
                                              is{" "}
                                              <strong>
                                                {explanation.belongsTo}
                                              </strong>
                                              , associated with{" "}
                                              {explanation.associatedAnswers.join(
                                                " · ",
                                              )}
                                              .
                                            </>
                                          )}
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setComparisonRecordId(
                                              explanation.recordId,
                                            )
                                          }
                                        >
                                          Compare both on the map
                                        </button>
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                            {studyAid?.mnemonic && (
                              <p className="memory-aid-reminder">
                                <strong>Your memory aid:</strong>{" "}
                                {studyAid.mnemonic}
                              </p>
                            )}
                          </div>
                        )}
                        <button
                          className="primary wide"
                          type="button"
                          disabled={
                            answerSaving ||
                            (questionStage === "choices" && !selected.length)
                          }
                          onClick={
                            questionStage === "feedback" ? next : check
                          }
                        >
                          {answerSaving
                            ? "Saving answer…"
                            : questionStage === "feedback"
                            ? "Next question"
                            : "Check answer"}
                        </button>
                        {questionStage === "feedback" && (
                          <details className="notebook">
                            <summary>My memory aids</summary>
                            <label htmlFor="mnemonic">
                              Mnemonic or mental image
                            </label>
                            <textarea
                              id="mnemonic"
                              value={studyAid?.mnemonic || ""}
                              disabled={!studyAid}
                              onChange={(event) =>
                                studyAid &&
                                saveAid({
                                  ...studyAid,
                                  mnemonic: event.target.value,
                                })
                              }
                              placeholder="Add a memorable story, image or phrase…"
                            />
                            <label htmlFor="confusion">
                              I confuse this with…
                            </label>
                            <textarea
                              id="confusion"
                              value={studyAid?.confusion_note || ""}
                              disabled={!studyAid}
                              onChange={(event) =>
                                studyAid &&
                                saveAid({
                                  ...studyAid,
                                  confusion_note: event.target.value,
                                })
                              }
                              placeholder="Record the similar item and the difference…"
                            />
                          </details>
                        )}
                      </>
                    )}
                  </div>
                </section>
              </>
            )}
          </>
        )}
        {view === "results" && sessionResult && (
          <>
            <header className="page-head results-head">
              <div>
                <p>
                  {sessionSourceMode === "daily"
                    ? "TODAY'S LEARNING COMPLETE"
                    : sessionResult.scope === "section_set"
                      ? "COMBINED SECTION TEST COMPLETE"
                      : "SECTION TEST COMPLETE"}
                </p>
                <h1>
                  {sessionSourceMode === "daily"
                    ? "A clear step forward."
                    : "Your answers, while they are still fresh."}
                </h1>
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
            {sessionSourceMode === "daily" && (
              <section className="daily-session-finish" role="status">
                <div>
                  <p className="learning-enhancement-eyebrow">
                    WHAT HAPPENS NEXT
                  </p>
                  <h2>
                    {sessionResult.correct_count} connection
                    {sessionResult.correct_count === 1 ? "" : "s"} strengthened
                    today
                  </h2>
                </div>
                <p>
                  Missed or uncertain answers return sooner. Your earliest
                  scheduled review is <strong>{nextSessionReviewLabel}</strong>.
                </p>
              </section>
            )}
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
        {view === "roads" && content && (
          <Suspense fallback={<div className="loading" role="status">Loading road study…</div>}>
            <Roads records={content.records} geometry={roads} />
          </Suspense>
        )}
        {view === "journeys" && content && roads && (
          <Suspense fallback={<div className="loading" role="status">Loading journey builder…</div>}>
            <Journeys records={content.records} geometry={roads} />
          </Suspense>
        )}
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
        {view === "areas" && (
          <Suspense fallback={<div className="loading" role="status">Loading area insights…</div>}>
            <GeographicInsights
              summary={geographicKnowledge}
              records={content.records}
              associations={ledger.associations}
              mastery={mastery}
            />
          </Suspense>
        )}
        {view === "mastery" && (
          <>
            <header className="page-head">
              <div>
                <p>MASTERY</p>
                <h1>See what is secure and what remains.</h1>
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
                <span>Learning readiness</span>
                <b>{dailyPlan.readiness.score.toFixed(0)}%</b>
                <small>{readinessLabels[dailyPlan.readiness.level]}</small>
              </article>
            </section>
            <section className="panel readiness-explanation">
              <div>
                <p className="learning-enhancement-eyebrow">
                  READINESS, NOT JUST COVERAGE
                </p>
                <h2>Your score grows through repeated, unassisted evidence.</h2>
                <p>
                  Recent first-pass accuracy:{" "}
                  <strong>
                    {dailyPlan.readiness.recentUnassistedFirstPass
                      .accuracyPercentage === null
                      ? "Not enough evidence yet"
                      : `${dailyPlan.readiness.recentUnassistedFirstPass.accuracyPercentage.toFixed(0)}%`}
                  </strong>
                  . Due reviews and uncertain answers stay in your learning
                  plan instead of disappearing behind an average score.
                </p>
              </div>
              <button
                className="primary"
                type="button"
                onClick={beginDaily}
                disabled={!dailyPlan.queue.length}
              >
                Start today&apos;s recommended session
              </button>
            </section>
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

function ConfusionMapDialog({
  correctRecord,
  confusedRecord,
  roads,
  onClose,
}: {
  correctRecord: LearningRecord;
  confusedRecord: LearningRecord;
  roads: RoadGeometryCollection;
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
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
        className="map-clue-dialog confusion-map-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confusion-map-title"
      >
        <header>
          <div>
            <p>CONFUSION COMPARISON</p>
            <h2 id="confusion-map-title">
              See what separates these two answers
            </h2>
          </div>
          <button
            ref={closeButton}
            type="button"
            className="map-clue-close"
            onClick={onClose}
          >
            <span aria-hidden="true">&times;</span> Close
          </button>
        </header>
        <div className="confusion-map-grid">
          <article>
            <div>
              <small>CORRECT RELATIONSHIP</small>
              <h3>{correctRecord.exam_name}</h3>
            </div>
            <Suspense
              fallback={
                <div className="map-panel map-loading" role="status">
                  Loading correct map…
                </div>
              }
            >
              <LearningMap
                key={`correct:${correctRecord.id}`}
                record={correctRecord}
                roads={roads}
                mode="study"
                labelled
              />
            </Suspense>
          </article>
          <article>
            <div>
              <small>YOUR SELECTED ALTERNATIVE</small>
              <h3>{confusedRecord.exam_name}</h3>
            </div>
            <Suspense
              fallback={
                <div className="map-panel map-loading" role="status">
                  Loading alternative map…
                </div>
              }
            >
              <LearningMap
                key={`confused:${confusedRecord.id}`}
                record={confusedRecord}
                roads={roads}
                mode="study"
                labelled
              />
            </Suspense>
          </article>
        </div>
      </section>
    </div>
  );
}
