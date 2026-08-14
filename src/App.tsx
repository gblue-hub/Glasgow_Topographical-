import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import "./learning.css";
import "./explorer.css";
import "./theme.css";
import "./shift-game.css";
import { Explorer, type ExplorerState } from "./components/Explorer";
import { TroubleSpots } from "./components/TroubleSpots";
import { Assessments } from "./components/Assessments";
import { DirectionalFeedback } from "./components/DirectionalFeedback";
import { GeographicKnowledgeCard } from "./components/GeographicKnowledgeCard";
import { SectionQuizBuilder } from "./components/SectionQuizBuilder";
import { StudyBeforeTestCard } from "./components/StudyBeforeTestCard";
import { TodaySessionCard } from "./components/TodaySessionCard";
import { LearningPlanSettings } from "./components/LearningPlanSettings";
import { SessionHistory } from "./components/SessionHistory";
import { AccountPanel } from "./components/AccountPanel";
import { loadCoreLearningData, loadSupportingLearningData } from "./services/content";
import { db } from "./services/db";
import { applyAttemptEvidence, completion } from "./domain/mastery";
import { explainSelectedDistractors, generateSectionQuestion, getAnswerFeatures, QUESTION_GENERATOR_VERSION } from "./domain/questions";
import { createSessionResult, indexLatestSectionResults, randomiseAssociations, sectionResultKey } from "./domain/session";
import { compareSectionCodes, formatSectionName } from "./domain/sections";
import { buildTroubleSpots } from "./domain/trouble-spots";
import { atomicStreetAttempts } from "./domain/atomic-streets";
import { shouldIgnoreLessonShortcut } from "./domain/lesson-keyboard";
import { buildDirectionalFeedback } from "./domain/directional-feedback";
import {
  buildGeographicKnowledge,
  knowledgeAreaLabels,
  type GeographicScope,
  type KnowledgeArea,
} from "./domain/geographic-knowledge";
import { buildAreaQuizGroups, requiredAssociationsForArea } from "./domain/area-quiz-groups";
import { normaliseSectionCodes, requiredAssociationsForSections } from "./domain/section-groups";
import { buildCareerMapModel } from "./domain/career-map";
import { learningSessionQueue, validateLearningSession } from "./domain/learning-session";
import {
  buildDailyLearningPlan,
  calculateDailyNewTarget,
  DEFAULT_DAILY_REVIEW_LIMIT,
} from "./domain/daily-learning";
import {
  hasIndependentSuccessfulRetrieval,
  inferAnswerConfidence,
  initialQuestionConfidence,
  initialQuestionStage,
  learningStageLabel,
  correctionSessionQueue,
  dailySessionQueue,
} from "./domain/learning-flow";
import { withUpdatedCoordinate } from "./domain/coordinate-state";
import {
  defaultLearningPreferences,
  learningTargetDate,
} from "./domain/learning-preferences";
import {
  categoryLocationFeature,
  filterExplorerRecords,
  formatExplorerCoordinate,
} from "./domain/explorer";
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
  RouteAttempt,
  RouteSession,
  RoutingManifest,
  TerritoryContent,
  TerritoryDefinition,
  TerritoryProgress,
  LearningPreferences,
  Mastery,
  StudyAid,
  RoadGeometryCollection,
  SessionResult,
  AppTheme,
  MotionPreference,
  PersonalPlace,
} from "./domain/types";

type View = AppView;
const readinessLabels = {
  getting_started: "Getting started",
  building: "Building",
  progressing: "Progressing",
  nearly_ready: "Nearly ready",
  ready: "Ready",
} as const;
const dailyDirectionLabel = (
  direction: Association["direction"] | "mixed",
) =>
  direction === "reverse"
    ? "Identify the place"
    : direction === "forward"
      ? "Recall all streets"
      : "Mixed learning";
const LearningMap = lazy(() =>
  import("./components/LearningMap").then((module) => ({ default: module.LearningMap })),
);
const TerritoryCourse = lazy(() =>
  import("./components/TerritoryCourse").then((module) => ({
    default: module.TerritoryCourse,
  })),
);
const Roads = lazy(() =>
  import("./components/Roads").then((module) => ({ default: module.Roads })),
);
const loadJourneysModule = () => import("./components/Journeys");
const Journeys = lazy(() =>
  loadJourneysModule().then((module) => ({ default: module.Journeys })),
);
const Settings = lazy(() =>
  import("./components/Settings").then((module) => ({ default: module.Settings })),
);
const CareerMap = lazy(() =>
  import("./components/CareerMap").then((module) => ({ default: module.CareerMap })),
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

type AppProps = {
  account: {
    email: string;
    name: string;
    avatarUrl: string | null;
  };
};

export default function App({ account }: AppProps) {
  const [content, setContent] = useState<LearningContent | null>(null),
    [ledger, setLedger] = useState<CoverageLedger | null>(null),
    [roads, setRoads] = useState<any>(null),
    [territoryContent, setTerritoryContent] = useState<TerritoryContent | null>(null),
    [routingManifest, setRoutingManifest] = useState<RoutingManifest | null>(null),
    [mastery, setMastery] = useState(new Map<string, Mastery>()),
    [attempts, setAttempts] = useState<Attempt[]>([]),
    [view, setView] = useState<View>("overview"),
    [sessionReturnView, setSessionReturnView] = useState<View>("practice"),
    [section, setSection] = useState(""),
    [sessionSectionCodes, setSessionSectionCodes] = useState<string[]>([]),
    [sessionLabel, setSessionLabel] = useState(""),
    [queue, setQueue] = useState<Association[]>([]),
    [sessionSeed, setSessionSeed] = useState(""),
    [questionSeed, setQuestionSeed] = useState(""),
    [sessionSourceMode, setSessionSourceMode] = useState<LearningSession["source_mode"]>("section"),
    [dailySessionFocusArea, setDailySessionFocusArea] =
      useState<KnowledgeArea | null>(null),
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
    [sessionResults, setSessionResults] = useState<SessionResult[]>([]),
    [routeAttempts, setRouteAttempts] = useState<RouteAttempt[]>([]),
    [territoryProgress, setTerritoryProgress] = useState(new Map<string, TerritoryProgress>()),
    [savedRouteSession, setSavedRouteSession] = useState<RouteSession | null>(null),
    [theme, setTheme] = useState<AppTheme>(() =>
      localStorage.getItem("glasgow-knowledge-theme") === "dark" ? "dark" : "light",
    ),
    [soundEffects, setSoundEffects] = useState(false),
    [motionPreference, setMotionPreference] = useState<MotionPreference>("system"),
    [personalPlaces, setPersonalPlaces] = useState<PersonalPlace[]>([]),
    [careerMapTerritoryId, setCareerMapTerritoryId] = useState<string | null>(null),
    [round, setRound] = useState(1),
    [position, setPosition] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [checked, setChecked] = useState(false),
    [started, setStarted] = useState(0),
    [questionPresentedAt, setQuestionPresentedAt] = useState(0),
    [preRevealLatencyMs, setPreRevealLatencyMs] = useState<number | null>(null),
    [lastSelectionLatencyMs, setLastSelectionLatencyMs] = useState<number | null>(null),
    [selectionInteractionCount, setSelectionInteractionCount] = useState(0),
    [questionStage, setQuestionStage] =
      useState<LearningQuestionStage>("prompt"),
    [corridorBriefingOpen, setCorridorBriefingOpen] = useState(false),
    [studyRecordIds, setStudyRecordIds] = useState<Set<string>>(new Set()),
    [studiedRecordIds, setStudiedRecordIds] = useState<Set<string>>(new Set()),
    [mapOpen, setMapOpen] = useState(false),
    [comparisonRecordId, setComparisonRecordId] = useState<string | null>(null),
    [usedAssistance, setUsedAssistance] = useState(false),
    [hintLevel, setHintLevel] = useState(0),
    [confidence, setConfidence] = useState<1 | 2 | 3>(2),
    [learningPreferences, setLearningPreferences] =
      useState<LearningPreferences>(defaultLearningPreferences),
    [studyAid, setStudyAid] = useState<StudyAid | null>(null),
    [exploreRecord, setExploreRecord] = useState<LearningRecord | null>(null),
    [explorerState, setExplorerState] = useState<ExplorerState>({ query: "", sectionCode: "", type: "all", area: "all", page: 1 }),
    [explorerReturnY, setExplorerReturnY] = useState<number | null>(null),
    [mapStreetNames, setMapStreetNames] = useState(true),
    [mobileMenuOpen, setMobileMenuOpen] = useState(false),
    [clock, setClock] = useState(() => new Date()),
    [answerSaving, setAnswerSaving] = useState(false),
    [recoveryNotice, setRecoveryNotice] = useState(""),
    [error, setError] = useState("");
  const resetQuestionTelemetry = () => {
    const now = performance.now();
    setQuestionPresentedAt(now);
    setPreRevealLatencyMs(null);
    setLastSelectionLatencyMs(null);
    setSelectionInteractionCount(0);
    setStarted(now);
  };
  const exploreCategoryLocation = exploreRecord
    ? categoryLocationFeature(exploreRecord)
    : null;
  const exploreRecords = useMemo(
    () =>
      content
        ? filterExplorerRecords(
            content.records,
            explorerState.query,
            explorerState.sectionCode,
            explorerState.type,
            explorerState.area,
          )
        : [],
    [
      content,
      explorerState.area,
      explorerState.query,
      explorerState.sectionCode,
      explorerState.type,
    ],
  );
  const exploreRecordIndex = exploreRecord
    ? exploreRecords.findIndex((record) => record.id === exploreRecord.id)
    : -1;
  const closeExplorerViewer = () => setView("explore");
  const moveExplorerViewer = (direction: -1 | 1) => {
    const nextIndex = exploreRecordIndex + direction;
    const nextRecord = exploreRecords[nextIndex];
    if (!nextRecord) return;
    setExploreRecord(nextRecord);
    setExplorerState((current) => ({ ...current, page: nextIndex + 1 }));
  };
  const activePrimaryArea =
    ["lesson", "results"].includes(view) &&
    ["feedback", "trouble", "mastery"].includes(sessionReturnView)
      ? "progress"
      : primaryAreaForView(view);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem("glasgow-knowledge-theme", theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.motion = motionPreference;
  }, [motionPreference]);
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
    if (view !== "explore-record") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleViewerKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "Escape") setView("explore");
      const direction =
        event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const nextIndex = exploreRecordIndex + direction;
      const nextRecord = direction ? exploreRecords[nextIndex] : null;
      if (nextRecord) {
        setExploreRecord(nextRecord);
        setExplorerState((current) => ({ ...current, page: nextIndex + 1 }));
      }
    };
    window.addEventListener("keydown", handleViewerKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleViewerKey);
    };
  }, [exploreRecordIndex, exploreRecords, view]);
  useEffect(() => {
    loadCoreLearningData()
      .then(([c, l]) => {
        setContent(c);
        setLedger(l);
        setSection(c.sections[0]?.code || "");
        void loadSupportingLearningData().then(([r, territories, routing]) => {
          setRoads(r);
          setTerritoryContent(territories);
          setRoutingManifest(routing);
        }).catch((e) => setError(e.message));
      })
      .catch((e) => setError(e.message));
    Promise.all([
      db.mastery.toArray(),
      db.attempts.toArray(),
      db.sessionResults.toArray(),
      db.learningPreferences.toArray(),
      db.routeAttempts.toArray(),
      db.territoryProgress.toArray(),
      db.routeSessions.toArray(),
      db.appSettings.toArray(),
      db.personalPlaces.toArray(),
    ])
      .then(([masteryRows, attemptRows, resultRows, preferenceRows, routeAttemptRows, territoryProgressRows, routeSessionRows, appSettingRows, personalPlaceRows]) => {
        setMastery(
          new Map(masteryRows.map((row) => [row.association_id, row])),
        );
        setAttempts(attemptRows);
        setSessionResults(resultRows);
        setLatestSectionResults(indexLatestSectionResults(resultRows));
        setRouteAttempts(routeAttemptRows);
        setTerritoryProgress(new Map(territoryProgressRows.map((row) => [row.territory_id, row])));
        setSavedRouteSession(routeSessionRows.find((row) => row.id === "active:route") ?? null);
        const savedAppSettings = appSettingRows.find((row) => row.id === "app-settings");
        if (savedAppSettings) {
          setTheme(savedAppSettings.theme);
          setSoundEffects(savedAppSettings.sound_effects ?? false);
          setMotionPreference(savedAppSettings.motion_preference ?? "system");
        }
        setPersonalPlaces(personalPlaceRows);
        const savedPreferences = preferenceRows.find(
          (row) => row.id === "learning-plan",
        );
        if (savedPreferences) {
          if (Date.parse(savedPreferences.target_date) > Date.now())
            setLearningPreferences(savedPreferences);
          else {
            const refreshed = defaultLearningPreferences();
            refreshed.target_weeks = savedPreferences.target_weeks;
            refreshed.study_days_per_week =
              savedPreferences.study_days_per_week;
            refreshed.target_date = learningTargetDate(
              savedPreferences.target_weeks,
            );
            setLearningPreferences(refreshed);
            void db.learningPreferences.put(refreshed);
          }
        }
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
  const dailyPace = useMemo(
    () =>
      calculateDailyNewTarget({
        associations: ledger?.associations ?? [],
        mastery,
        targetDate: learningPreferences.target_date,
        studyDaysPerWeek: learningPreferences.study_days_per_week,
        now: clock,
      }),
    [clock, learningPreferences, ledger, mastery],
  );
  const dailyPlan = useMemo(
    () => {
      const now = clock;
      return buildDailyLearningPlan({
        associations: ledger?.associations ?? [],
        records: content?.records ?? [],
        roadGeometry: roads,
        territories: territoryContent?.territories,
        stitches: territoryContent?.stitches,
        personalPlaces,
        activeCorridor: learningPreferences.active_corridor ?? null,
        mastery,
        attempts,
        now,
        seed: `${now.toISOString()}:${attempts.length}`,
        limit: dailyPace.dailyNewTarget + DEFAULT_DAILY_REVIEW_LIMIT,
        newLimit: dailyPace.dailyNewTarget,
        reviewLimit: DEFAULT_DAILY_REVIEW_LIMIT,
      });
    },
    [attempts, clock, content, dailyPace.dailyNewTarget, learningPreferences.active_corridor, ledger, mastery, personalPlaces, roads, territoryContent],
  );
  const careerMapModel = useMemo(
    () =>
      territoryContent
        ? buildCareerMapModel({
            records: content?.records ?? [],
            associations: ledger?.associations ?? [],
            mastery,
            attempts,
            territories: territoryContent.territories,
            stitches: territoryContent.stitches,
            territoryProgress,
            routeAttempts,
            readiness: dailyPlan.readiness.score,
            now: clock,
          })
        : null,
    [attempts, clock, content, dailyPlan.readiness.score, ledger, mastery, routeAttempts, territoryContent, territoryProgress],
  );
  const saveLearningPreferences = (next: LearningPreferences) => {
    setLearningPreferences(next);
    void db.learningPreferences.put(next).catch(() => {
      setRecoveryNotice("Your learning-plan settings could not be saved.");
    });
  };
  const resetLearningProgress = async (): Promise<boolean> => {
    if (
      !window.confirm(
        "Reset all learning progress? This removes attempts, mastery, saved quizzes, memory aids, and results.",
      )
    )
      return false;
    if (
      !window.confirm(
        "Final warning: this cannot be undone. Your learning-plan settings will be kept. Reset progress now?",
      )
    )
      return false;
    try {
      await db.resetLearningProgress();
      setMastery(new Map());
      setAttempts([]);
      setSessionResults([]);
      setLatestSectionResults(new Map());
      setSavedLearningSession(null);
      setSessionResult(null);
      setRouteAttempts([]);
      setTerritoryProgress(new Map());
      setSavedRouteSession(null);
      setDailySessionFocusArea(null);
      setAnswerReview([]);
      setMistakes(new Set());
      setCorrectionsComplete(false);
      setRecoveryNotice(
        "Learning progress was reset. Your plan settings were kept.",
      );
      return true;
    } catch {
      setRecoveryNotice(
        "Learning progress could not be reset. Nothing was cleared locally.",
      );
      return false;
    }
  };
  const changeTheme = (nextTheme: AppTheme) => {
    setTheme(nextTheme);
    void db.appSettings.put({
      id: "app-settings",
      theme: nextTheme,
      sound_effects: soundEffects,
      motion_preference: motionPreference,
      updated_at: new Date().toISOString(),
    }).catch(() => setRecoveryNotice("Your appearance setting could not be saved to your account."));
  };
  const changeExperience = (value: { soundEffects: boolean; motionPreference: MotionPreference }) => {
    setSoundEffects(value.soundEffects);
    setMotionPreference(value.motionPreference);
    void db.appSettings.put({ id: "app-settings", theme, sound_effects: value.soundEffects, motion_preference: value.motionPreference, updated_at: new Date().toISOString() })
      .catch(() => setRecoveryNotice("Your sound or motion setting could not be saved."));
  };
  const playCue = useCallback((kind: "dispatch" | "correct" | "wrong") => {
    if (!soundEffects) return;
    const AudioContextClass = window.AudioContext;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "wrong" ? "sawtooth" : "sine";
    oscillator.frequency.value = kind === "dispatch" ? 620 : kind === "correct" ? 760 : 180;
    gain.gain.setValueAtTime(.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .16);
    oscillator.addEventListener("ended", () => void context.close());
  }, [soundEffects]);
  const savePersonalPlace = async (place: PersonalPlace) => {
    const now = new Date().toISOString();
    const displaced = place.is_home_base
      ? personalPlaces.filter((item) => item.id !== place.id && item.is_home_base).map((item) => ({ ...item, is_home_base: false, updated_at: now }))
      : [];
    await Promise.all([db.personalPlaces.put(place), ...displaced.map((item) => db.personalPlaces.put(item))]);
    setPersonalPlaces((current) => [
      ...current.filter((item) => item.id !== place.id).map((item) => place.is_home_base && item.is_home_base ? { ...item, is_home_base: false, updated_at: now } : item),
      place,
    ]);
  };
  const deletePersonalPlace = async (id: string) => {
    await db.personalPlaces.delete(id);
    setPersonalPlaces((current) => current.filter((place) => place.id !== id));
  };
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
  const areaQuizGroups = useMemo(
    () =>
      buildAreaQuizGroups(
        content?.records ?? [],
        ledger?.associations ?? [],
      ),
    [content, ledger],
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
    recordsToStudy: ReadonlySet<string> = new Set(),
    questionSeedOverride?: string,
  ) => {
    if (!selectedQueue.length) return;
    if (!replaceSaved && savedLearningSession && !window.confirm(`Starting a new quiz will replace your saved ${savedLearningSession.selection_label || "learning quiz"}. Continue?`)) return;
    setCorridorBriefingOpen(false);
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    const seed = values[0].toString(36);
    const now = new Date().toISOString();
    const preparedQueue = preserveOrder
      ? [...selectedQueue]
      : randomiseAssociations(selectedQueue);
    const firstAssociation = preparedQueue[0];
    const firstHasPriorAttempt = attempts.some(
      (attempt) => attempt.association_id === firstAssociation.id,
    );
    setQueue(preparedQueue);
    setSessionSeed(seed);
    setQuestionSeed(questionSeedOverride ?? seed);
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
    setStudyRecordIds(new Set(recordsToStudy));
    setStudiedRecordIds(new Set());
    setQuestionStage(
      recordsToStudy.size
        ? "study"
        : initialQuestionStage({
        association: firstAssociation,
        sourceMode,
        mastery: mastery.get(firstAssociation.id),
        hasPriorAttempt: firstHasPriorAttempt,
        studiedRecordIds: new Set(),
        correctionMode: false,
          }),
    );
    setMapOpen(false);
    setComparisonRecordId(null);
    setUsedAssistance(false);
    setHintLevel(0);
    setConfidence(
      initialQuestionConfidence({
        hasPriorAttempt: firstHasPriorAttempt,
        mastery: mastery.get(firstAssociation.id),
        correctionMode: false,
      }),
    );
    resetQuestionTelemetry();
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
        ? `${dailyDirectionLabel(direction)} · ${content?.sections.find((item) => item.code === code)?.name ?? `Section ${code}`}`
        : "Course review",
    );
  };
  const beginDaily = () => {
    if (!dailyPlan.queue.length || !ledger) return;
    const studyRecordIds = new Set(
      dailyPlan.items
        .filter((item) => item.block === "new" || item.block === "recovery")
        .map((item) => item.association.record_id),
    );
    const selectedQueue = dailySessionQueue({
      planned: dailyPlan.queue,
      studyRecordIds,
      associations: ledger.associations,
    });
    const sectionCodes = [
      ...new Set(selectedQueue.map((association) => association.section_code)),
    ];
    setDailySessionFocusArea(dailyPlan.focusArea);
    startSession(
      selectedQueue,
      "",
      "overview",
      "daily",
      sectionCodes,
      dailyPlan.corridor?.stageName
        ? `${knowledgeAreaLabels[dailyPlan.corridor.area]} corridor · ${dailyPlan.corridor.stageName}`
        : `Learning session · mixed recognition and recall`,
      false,
      studyRecordIds.size > 0,
      studyRecordIds,
    );
    setCorridorBriefingOpen(
      Boolean(dailyPlan.corridor?.incomingRoadNames.length),
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
  const beginAreaQuiz = (
    area: GeographicScope,
    label: string,
    direction: Association["direction"],
  ) => {
    if (!ledger || !content) return;
    const selected = requiredAssociationsForArea(
      content.records,
      ledger.associations,
      area,
      direction,
    );
    const sectionCodes = normaliseSectionCodes(
      selected.map((association) => association.section_code),
    );
    startSession(
      selected,
      "",
      "practice",
      "section_set",
      sectionCodes,
      label,
      false,
      true,
    );
  };
  const beginTerritoryFacts = (territory: TerritoryDefinition) => {
    if (!ledger) return;
    const recordIds = new Set([
      territory.district_record_id,
      ...territory.nearby_record_ids,
      ...territory.approach_record_ids,
    ]);
    const selected = ledger.associations.filter(
      (association) =>
        association.required && recordIds.has(association.record_id),
    );
    startSession(
      selected,
      "",
      "territories",
      "section_set",
      normaliseSectionCodes(selected.map((association) => association.section_code)),
      `${territory.name} · street facts`,
    );
  };
  const saveTerritoryAttempt = async (
    attempt: RouteAttempt,
    progress: TerritoryProgress,
  ) => {
    await Promise.all([
      db.routeAttempts.put(attempt),
      db.territoryProgress.put(progress),
    ]);
    setRouteAttempts((current) => [
      ...current.filter((item) => item.id !== attempt.id),
      attempt,
    ]);
    setTerritoryProgress((current) =>
      new Map(current).set(progress.territory_id, progress),
    );
  };
  const saveRouteSession = useCallback(async (session: RouteSession) => {
    await db.routeSessions.put(session);
    setSavedRouteSession(session);
  }, []);
  const clearRouteSession = useCallback(async () => {
    await db.routeSessions.delete("active:route");
    setSavedRouteSession(null);
  }, []);
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
    setQuestionSeed(
      savedLearningSession.question_seed ?? savedLearningSession.session_id,
    );
    setSessionSourceMode(savedLearningSession.source_mode);
    setDailySessionFocusArea(savedLearningSession.daily_focus_area ?? null);
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
    setStudyRecordIds(new Set(savedLearningSession.study_record_ids ?? []));
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
    resetQuestionTelemetry();
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
      true,
      new Set(saved.study_record_ids ?? []),
      saved.question_seed ?? saved.session_id,
    );
  };
  const replayCompletedSession = (
    result: SessionResult,
    associationIds: string[],
  ) => {
    if (!ledger) return;
    const byId = new Map(
      ledger.associations.map((candidate) => [candidate.id, candidate]),
    );
    const replayQueue = associationIds
      .map((id) => byId.get(id))
      .filter((item): item is Association => Boolean(item));
    if (replayQueue.length !== associationIds.length) {
      setRecoveryNotice(
        "Part of that earlier session is no longer in the current course, so it cannot be replayed exactly.",
      );
      return;
    }
    const sourceMode =
      result.source_mode ??
      (result.scope === "section_set"
        ? "section_set"
        : result.scope === "section"
          ? "section"
          : "daily");
    setDailySessionFocusArea(result.focus_area ?? null);
    startSession(
      replayQueue,
      result.section_code ?? "",
      "history",
      sourceMode,
      result.section_codes ?? [],
      `Replay · ${result.selection_label || "Learning session"}`,
      false,
      true,
      new Set(result.study_record_ids ?? []),
      result.question_seed ?? result.session_id,
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
          `${questionSeed || sessionSeed}:${position}`,
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
  const dailyNewRecordIds =
    sessionSourceMode === "daily"
      ? new Set(
          queue
            .filter(
              (item) =>
                item.direction === "reverse" &&
                (studiedRecordIds.has(item.record_id) ||
                  !attempts.some(
                    (attempt) => attempt.association_id === item.id,
                  )),
            )
            .map((item) => item.record_id),
        )
      : new Set<string>();
  const dailyNewPosition = record
    ? [...dailyNewRecordIds].indexOf(record.id) + 1
    : 0;
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
  const nextFocusArea = dailyPlan.focusArea;
  const nextFocusAreaRecords = nextFocusArea
    ? (() => {
        const recordIds = new Set(
          geographicKnowledge.areaTotals[nextFocusArea].recordIds,
        );
        return (content?.records ?? [])
          .filter((item) => recordIds.has(item.id))
          .slice(0, 3);
      })()
    : [];
  const nextSessionContinuesCurrentArea =
    !!dailySessionFocusArea && nextFocusArea === dailySessionFocusArea;
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
      question_seed: questionSeed || sessionSeed,
      source_mode: sessionSourceMode,
      selection_label: sessionLabel,
      section_code: section || null,
      section_codes: sessionSectionCodes,
      ...(sessionPracticeDirection ? { practice_direction: sessionPracticeDirection } : {}),
      ...(sessionSourceMode === "daily"
        ? { daily_focus_area: dailySessionFocusArea }
        : {}),
      return_view: sessionReturnView as LearningReturnView,
      association_ids: queue.map((item) => item.id),
      position,
      round,
      phase: correctionMode ? "correction" : "first_pass",
      question_stage: questionStage,
      study_record_ids: [...studyRecordIds],
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
  }, [answerReview, checked, confidence, content, correctionMode, dailySessionFocusArea, firstPassCorrect, hintLevel, learningRecoveryReady, mapOpen, mistakes, position, questionSeed, questionStage, queue, round, section, selected, sessionCreatedAt, sessionLabel, sessionPracticeDirection, sessionReturnView, sessionSectionCodes, sessionSeed, sessionSourceMode, studiedRecordIds, studyRecordIds, usedAssistance, view]);
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
    const answerLatencyMs = Math.round(performance.now() - started);
    const answerSelectionLatencyMs = lastSelectionLatencyMs ?? answerLatencyMs;
    const inferredConfidence = inferAnswerConfidence({
      correct,
      usedAssistance,
      preRevealLatencyMs,
      answerSelectionLatencyMs,
      selectionInteractionCount,
      expectedSelectionCount: question.answer_option_ids.length,
    });
    setConfidence(inferredConfidence);
    const attemptContext = {
      exercise_family: "multiple_choice",
      used_reveal: usedAssistance,
      latency_ms: answerLatencyMs,
      pre_reveal_latency_ms: preRevealLatencyMs,
      answer_selection_latency_ms: answerSelectionLatencyMs,
      selection_interaction_count: selectionInteractionCount,
      confidence: inferredConfidence,
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
    playCue(correct ? "correct" : "wrong");
    setAnswerSaving(false);
  };
  const prepareDailyCorrections = (
    missedAssociationIds: ReadonlySet<string>,
    nextRound: number,
  ) => {
    if (!ledger) return false;
    const retryQueue = correctionSessionQueue(
      missedAssociationIds,
      ledger.associations,
    );
    if (!retryQueue.length) return false;
    setQueue(retryQueue);
    setMistakes(new Set(retryQueue.map((item) => item.id)));
    setCorrectionMode(true);
    setRound(nextRound);
    setPosition(0);
    setSelected([]);
    setChecked(false);
    setStudyRecordIds(
      new Set(retryQueue.map((item) => item.record_id)),
    );
    setStudiedRecordIds(new Set());
    setQuestionStage("study");
    setMapOpen(false);
    setComparisonRecordId(null);
    setUsedAssistance(false);
    setHintLevel(0);
    setConfidence(3);
    resetQuestionTelemetry();
    return true;
  };
  const next = async () => {
    if (position + 1 >= queue.length) {
      if (correctionMode && mistakes.size) {
        if (
          sessionSourceMode === "daily" &&
          prepareDailyCorrections(mistakes, round + 1)
        )
          return;
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
        setConfidence(
          initialQuestionConfidence({
            hasPriorAttempt: true,
            mastery: undefined,
            correctionMode: true,
          }),
        );
        setRound((current) => current + 1);
        resetQuestionTelemetry();
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
        sourceMode: sessionSourceMode,
        associationIds: queue.map((item) => item.id),
        studyRecordIds: [...studyRecordIds],
        focusArea: dailySessionFocusArea,
        questionSeed: questionSeed || sessionSeed,
      });
      await db.sessionResults.add(result);
      setSessionResults((current) => [
        ...current.filter((item) => item.session_id !== result.session_id),
        result,
      ]);
      setSessionResult(result);
      if (result.section_code)
        setLatestSectionResults((current) =>
          result.practice_direction
            ? new Map(current).set(sectionResultKey(result.section_code!, result.practice_direction), result)
            : current,
        );
      if (
        sessionSourceMode === "daily" &&
        mistakes.size &&
        prepareDailyCorrections(mistakes, 2)
      )
        return;
      await db.learningSessions.delete("active:learning");
      setSavedLearningSession(null);
      setView("results");
      return;
    }
    const nextAssociation = queue[position + 1];
    const nextHasPriorAttempt = attempts.some(
      (attempt) => attempt.association_id === nextAssociation.id,
    );
    setPosition(position + 1);
    setSelected([]);
    setChecked(false);
    setQuestionStage(
      initialQuestionStage({
        association: nextAssociation,
        sourceMode: sessionSourceMode,
        mastery: mastery.get(nextAssociation.id),
        hasPriorAttempt: nextHasPriorAttempt,
        studiedRecordIds,
        correctionMode,
      }),
    );
    setMapOpen(false);
    setComparisonRecordId(null);
    setUsedAssistance(false);
    setHintLevel(0);
    setConfidence(
      initialQuestionConfidence({
        hasPriorAttempt: nextHasPriorAttempt,
        mastery: mastery.get(nextAssociation.id),
        correctionMode,
      }),
    );
    resetQuestionTelemetry();
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
    setConfidence(
      initialQuestionConfidence({
        hasPriorAttempt: true,
        mastery: undefined,
        correctionMode: true,
      }),
    );
    resetQuestionTelemetry();
    setView("lesson");
  };
  const completeStudy = () => {
    if (!record || questionStage !== "study") return;
    const studied = new Set(studiedRecordIds).add(record.id);
    setStudiedRecordIds(studied);
    const nextStudyIndex = queue.findIndex((candidate) => {
      if (studied.has(candidate.record_id)) return false;
      return (
        studyRecordIds.has(candidate.record_id) &&
        candidate.direction === "reverse"
      );
    });
    if (nextStudyIndex >= 0) {
      setPosition(nextStudyIndex);
      setMapOpen(false);
      setComparisonRecordId(null);
    } else {
      setQueue(randomiseAssociations(queue));
      setPosition(0);
      setQuestionStage("prompt");
    }
    resetQuestionTelemetry();
  };
  const revealChoices = () => {
    if (questionStage !== "prompt") return;
    const now = performance.now();
    setPreRevealLatencyMs(Math.max(0, Math.round(now - questionPresentedAt)));
    setLastSelectionLatencyMs(null);
    setSelectionInteractionCount(0);
    setQuestionStage("choices");
    setStarted(now);
  };
  const lessonKeyboardState = useRef({
    view,
    question,
    questionStage,
    checked,
    selected,
    started,
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
    started,
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
          : questionStage === "prompt"
            ? document.querySelector<HTMLElement>(".think-first button.primary")
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
        setLastSelectionLatencyMs(
          Math.max(0, Math.round(performance.now() - current.started)),
        );
        setSelectionInteractionCount((count) => count + 1);
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
          <AccountPanel account={account} />
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
        {(view === "overview" || view === "territories" || view === "practice" || view === "history") && (
          <SubviewNavigation
            label="Learn"
            view={view}
            items={[
              { view: "overview", label: "Recommended" },
              { view: "territories", label: "Territory course" },
              { view: "practice", label: "Focused practice" },
              { view: "history", label: "Run history" },
            ]}
            onSelect={setView}
          />
        )}
        {(view === "explore" || view === "roads") && (
          <SubviewNavigation
            label="Knowledge Atlas"
            view={view}
            items={[
              { view: "explore", label: "Places & answers" },
              { view: "roads", label: "Street atlas" },
            ]}
            onSelect={setView}
          />
        )}
        {(view === "areas" || view === "feedback" || view === "trouble" || view === "mastery") && (
          <SubviewNavigation
            label="Progress"
            view={view}
            items={[
              { view: "mastery", label: "Career Map" },
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
                <p>YOUR LEARNING PLAN</p>
                <h1>Memorise Glasgow, one geographic group at a time.</h1>
                <span>
                  Study the exact named associations, recognise them in exam-style
                  choices, recall them in both directions, and review them before
                  they fade.
                </span>
              </div>
              <div className="overview-hero__route" aria-label="Current learning route">
                <span>Next session</span>
                <i aria-hidden="true" />
                <strong>
                  {dailyDirectionLabel(dailyPlan.direction)}
                </strong>
                <small>
                  {dailyPlan.corridor?.stageName
                    ? `${knowledgeAreaLabels[dailyPlan.corridor.area]} · ${dailyPlan.corridor.stageName}`
                    : dailyPlan.focusArea
                    ? `${knowledgeAreaLabels[dailyPlan.focusArea]} area`
                    : dailyPlan.focusSectionCode
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
              counts={dailyPlan.blockCounts}
              totalItemCount={dailyPlan.blockCounts.total}
              homeBase={dailyPlan.homeBase}
              corridor={dailyPlan.corridor}
              availableCorridors={dailyPlan.availableCorridors}
              onSelectCorridor={(area) =>
                saveLearningPreferences({
                  ...learningPreferences,
                  active_corridor: area,
                  updated_at: new Date().toISOString(),
                })
              }
              focusLabel={
                dailyPlan.focusArea
                  ? `${knowledgeAreaLabels[dailyPlan.focusArea]} area`
                  : dailyPlan.focusSectionCode
                  ? formatSectionName(
                      content.sections.find(
                        (item) => item.code === dailyPlan.focusSectionCode,
                      )?.name ?? `Section ${dailyPlan.focusSectionCode}`,
                    )
                  : undefined
              }
              estimatedMinutes={
                dailyPlan.blockCounts.total
                  ? Math.max(
                      5,
                      Math.ceil(
                        (dailyPlan.blockCounts.recovery +
                          dailyPlan.blockCounts.maintenance +
                          dailyPlan.blockCounts.recognition +
                          dailyPlan.blockCounts.promotion) *
                          0.8 +
                          dailyPlan.blockCounts.new * 2,
                      ),
                    )
                  : 0
              }
              onStart={beginDaily}
              emptyState={
                <>
                  <strong>
                    {!learningPreferences.active_corridor
                      ? "Choose a corridor to begin."
                      : dailyPlan.corridor?.complete
                        ? "This corridor is complete."
                        : "You’re caught up."}
                  </strong>
                  <span>
                    {!learningPreferences.active_corridor
                      ? "Your first stage starts in the matching side of the City Centre."
                      : dailyPlan.corridor?.complete
                        ? "Choose another direction to continue building outward."
                        : "Build a focused quiz if you would like extra practice."}
                  </span>
                </>
              }
            />
            <LearningPlanSettings
              preferences={learningPreferences}
              dailyNewTarget={dailyPace.dailyNewTarget}
              remainingNew={dailyPace.remainingNew}
              remainingStudyDays={dailyPace.remainingStudyDays}
              onChange={saveLearningPreferences}
              onResetProgress={() => void resetLearningProgress()}
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
                <span>Session track</span>
                <b>
                  {dailyDirectionLabel(dailyPlan.direction)}
                </b>
                <small>Easier identification grows into harder recall</small>
              </article>
            </section>
            <GeographicKnowledgeCard
              summary={geographicKnowledge}
              onOpenInsights={() => setView("areas")}
            />
          </>
        )}
        {view === "territories" && territoryContent && routingManifest && (
          <Suspense fallback={<div className="loading" role="status">Building your territory map…</div>}>
            <TerritoryCourse
              territories={territoryContent.territories}
              records={content.records}
              geometry={roads}
              routing={routingManifest}
              associations={ledger.associations}
              mastery={mastery}
              attempts={routeAttempts}
              progress={territoryProgress}
              onAttempt={saveTerritoryAttempt}
              savedSession={savedRouteSession}
              onSessionSave={saveRouteSession}
              onSessionClear={clearRouteSession}
              onPracticeFacts={beginTerritoryFacts}
              personalPlaces={personalPlaces}
              stitches={territoryContent.stitches}
              initialTerritoryId={careerMapTerritoryId}
            />
          </Suspense>
        )}
        {view === "explore" && (
          <Explorer
            content={content}
            state={explorerState}
            onStateChange={setExplorerState}
            onOpenRecord={(record) => {
              setExplorerReturnY(window.scrollY);
              setExploreRecord(record);
              const recordIndex = exploreRecords.findIndex((item) => item.id === record.id);
              if (recordIndex >= 0)
                setExplorerState((current) => ({ ...current, page: recordIndex + 1 }));
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
          <section
            className="explorer-viewer"
            role="dialog"
            aria-modal="true"
            aria-label={`Explore ${exploreRecord.exam_name}`}
          >
            <header className="explorer-viewer-head">
              <button className="explorer-viewer-close" onClick={closeExplorerViewer}>
                <span aria-hidden="true">×</span> Change group
              </button>
              <div>
                <b>{exploreRecord.section.name}</b>
                <span>{exploreRecordIndex + 1} of {exploreRecords.length.toLocaleString()}</span>
              </div>
              <nav className="explorer-viewer-nav" aria-label="Answer navigation">
                <button
                  type="button"
                  onClick={() => moveExplorerViewer(-1)}
                  disabled={exploreRecordIndex <= 0}
                  aria-label="Previous answer"
                >
                  <span aria-hidden="true">←</span><span>Previous</span>
                </button>
                <button
                  type="button"
                  onClick={() => moveExplorerViewer(1)}
                  disabled={exploreRecordIndex < 0 || exploreRecordIndex >= exploreRecords.length - 1}
                  aria-label="Next answer"
                >
                  <span>Next</span><span aria-hidden="true">→</span>
                </button>
              </nav>
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
          </section>
        )}
        {view === "practice" && (
          <>
            <SectionQuizBuilder
              sections={sectionStats}
              areaGroups={areaQuizGroups}
              onStartSingle={begin}
              onStartMultiple={beginCombinedSections}
              onStartArea={beginAreaQuiz}
            />
          </>
        )}
        {view === "history" && (
          <SessionHistory
            results={sessionResults}
            attempts={attempts}
            associations={ledger?.associations ?? []}
            onReplay={replayCompletedSession}
          />
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
            {corridorBriefingOpen && dailyPlan.corridor ? (
              <section className="shift-briefing" aria-labelledby="corridor-briefing-title">
                <div className="shift-briefing__dispatch"><span>{dailyPlan.corridor.incomingKind === "stitch_road" ? "DISTRICT HANDOVER" : "MAIN-ROAD APPROACH"}</span><i aria-hidden="true">•••</i></div>
                <p className="eyebrow">{knowledgeAreaLabels[dailyPlan.corridor.area].toUpperCase()} CORRIDOR · STAGE {dailyPlan.corridor.stagePosition} OF {dailyPlan.corridor.stageCount}</p>
                <h1 id="corridor-briefing-title">Enter {dailyPlan.corridor.stageName} by the named road.</h1>
                <p className="shift-briefing__intro">This is the connection from territory you have already covered into the next district. Learn the handover before its district facts.</p>
                <div className="shift-briefing__runs">
                  {dailyPlan.corridor.incomingRoadNames.map((name, index) => (
                    <article key={`${name}:${index}`}><span>{index + 1}</span><div><strong>{name}</strong><small>{dailyPlan.corridor?.incomingKind === "stitch_road" ? "Named stitch road" : "Dataset main-road approach"}</small></div></article>
                  ))}
                </div>
                <ol className="shift-briefing__stages"><li>Known territory</li><li>Connecting road</li><li>{dailyPlan.corridor.stageName}</li><li>Every local association</li></ol>
                <button type="button" className="primary" onClick={() => setCorridorBriefingOpen(false)}>Follow this road →</button>
              </section>
            ) : questionStage === "study" ? (
              <StudyBeforeTestCard
                record={record}
                onReady={completeStudy}
                readyLabel="Next association"
                eyebrow={
                  sessionSourceMode === "daily" && dailyNewPosition
                    ? `READING SET · ${dailyNewPosition} OF ${dailyNewRecordIds.size}`
                    : undefined
                }
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
                    <h3>Learn the named association</h3>
                    <ol className="guided-study-steps">
                      <li>
                        <strong>Read it</strong>
                        <span>Read the exact exam name and its associated street names together.</span>
                      </li>
                      <li>
                        <strong>Say it</strong>
                        <span>Say the named association aloud once, in both directions.</span>
                      </li>
                      <li>
                        <strong>Picture it</strong>
                         <span>Use the map only as supporting context, then bring the names back to mind.</span>
                      </li>
                    </ol>
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
                        <p className="learning-enhancement-eyebrow">ACTIVE RECALL · BEFORE THE CHOICES</p>
                        <h2 id="think-first-title">
                          {question.direction === "streets_to_category"
                            ? "Name the place these streets identify."
                            : "Bring every associated street to mind."}
                        </h2>
                        <p>
                          Pause and recall the named association before revealing
                          the exam-style choices. No typing is required.
                        </p>
                        <button
                          className="primary"
                          type="button"
                          onClick={revealChoices}
                          autoFocus
                        >
                          Show {question.options.length} options
                        </button>
                        <small>
                          Bring your answer to mind first. There is nothing to type and revealing the choices does not count against you.
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
                              onClick={() => {
                                setLastSelectionLatencyMs(
                                  Math.max(
                                    0,
                                    Math.round(performance.now() - started),
                                  ),
                                );
                                setSelectionInteractionCount(
                                  (count) => count + 1,
                                );
                                setSelected((current) =>
                                  question.selection_mode === "multiple"
                                    ? current.includes(option.id)
                                      ? current.filter(
                                          (item) => item !== option.id,
                                        )
                                      : [...current, option.id]
                                    : [option.id],
                                );
                              }}
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
                            ) : !answerCorrect ? (
                              <small>
                                Incorrect answers return sooner for another
                                retrieval attempt.
                              </small>
                            ) : confidence === 1 ? (
                              <small>
                                Your answer pattern showed several signs of
                                uncertainty, so this will return sooner.
                              </small>
                            ) : confidence === 2 ? (
                              <small>
                                The app detected some hesitation and will bring
                                this back sooner for reinforcement.
                              </small>
                            ) : (
                              <small>
                                This was recorded as a fluent answer. Repeated
                                fluent attempts build mastery.
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
                    ? "LEARNING SESSION COMPLETE"
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
              <>
                <section className="daily-session-finish" role="status">
                  <div>
                    <p className="learning-enhancement-eyebrow">
                      WHAT HAPPENS NEXT
                    </p>
                    <h2>
                      {sessionResult.correct_count} connection
                      {sessionResult.correct_count === 1 ? "" : "s"} strengthened
                       this session
                    </h2>
                  </div>
                  <p>
                    Anything that needed more than one pass will join the
                    reading set in your next session. Start that session
                    whenever you are ready; the next scheduled maintenance
                    review is <strong>{nextSessionReviewLabel}</strong>.
                  </p>
                </section>
                {careerMapModel && (
                  <section className="career-shift-debrief" role="status">
                    <div className="career-shift-debrief__route" aria-hidden="true"><span>Pickup</span><i /><span>Knowledge worked</span><i /><span>Career Map</span></div>
                    <div><p className="eyebrow">SHIFT DEBRIEF</p><h2>{careerMapModel.rank} · {careerMapModel.competencePoints.toLocaleString()} competence points</h2><p>Your unassisted answers have strengthened {careerMapModel.totals.operationalRecords} operational records and {careerMapModel.totals.secureStitches} district stitches. Open the map to see exactly where the evidence landed.</p></div>
                    <button type="button" className="primary" onClick={() => setView("mastery")}>See the map reveal</button>
                  </section>
                )}
                {nextFocusArea && (
                  <section
                    className="tomorrow-section-preview"
                    aria-labelledby="tomorrow-section-title"
                  >
                    <div>
                      <p className="learning-enhancement-eyebrow">
                        {nextSessionContinuesCurrentArea
                          ? "NEXT SESSION CONTINUES"
                          : "COMING NEXT"}
                      </p>
                      <h2 id="tomorrow-section-title">
                        {knowledgeAreaLabels[nextFocusArea]} area
                      </h2>
                      <p>
                        {nextSessionContinuesCurrentArea
                          ? "This area still has connected districts, roads and places to introduce, so the next session keeps the same geographic context."
                          : "You completed this area’s new material, so this is the next geographic curriculum area to be introduced."}
                      </p>
                    </div>
                    {!!nextFocusAreaRecords.length && (
                      <ul aria-label="A preview of the next new material">
                        {nextFocusAreaRecords.map((item) => (
                          <li key={item.id}>{item.exam_name}</li>
                        ))}
                      </ul>
                    )}
                    <div className="tomorrow-section-preview__actions">
                      <small>
                        Previewing does not change your progress or start the
                        section early.
                      </small>
                      <button
                        type="button"
                        className="back"
                        onClick={() => {
                          setView("areas");
                        }}
                      >
                        Open area overview
                      </button>
                    </div>
                  </section>
                )}
              </>
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
                {sessionReturnView === "trouble" ? "Back to slips" : sessionReturnView === "feedback" ? "Back to feedback" : sessionReturnView === "overview" ? "Back to learn" : sessionReturnView === "history" ? "Back to session history" : "Back to practice"}
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
            <Journeys records={content.records} geometry={roads} personalPlaces={personalPlaces} />
          </Suspense>
        )}
        {view === "settings" && (
          <Suspense fallback={<div className="loading" role="status">Opening settings…</div>}>
            <Settings
              theme={theme}
              onThemeChange={changeTheme}
              soundEffects={soundEffects}
              motionPreference={motionPreference}
              onExperienceChange={changeExperience}
              onResetProgress={resetLearningProgress}
              personalPlaces={personalPlaces}
              onSavePersonalPlace={savePersonalPlace}
              onDeletePersonalPlace={deletePersonalPlace}
            />
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
        {view === "mastery" && careerMapModel && territoryContent && (
          <Suspense fallback={<div className="loading" role="status">Drawing your career map…</div>}>
            <CareerMap
              model={careerMapModel}
              territories={territoryContent.territories}
              stitches={territoryContent.stitches}
              geometry={roads}
              records={content.records}
              routeAttempts={routeAttempts}
              personalPlaces={personalPlaces}
              territoryProgress={territoryProgress}
              onStartShift={beginDaily}
              canStartShift={Boolean(dailyPlan.queue.length)}
              onOpenTerritory={(territoryId) => {
                setCareerMapTerritoryId(territoryId);
                setView("territories");
              }}
            />
          </Suspense>
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
