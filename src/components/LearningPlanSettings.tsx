import type { LearningPreferences } from "../domain/types";
import { learningTargetDate } from "../domain/learning-preferences";
import "./learning-enhancements.css";

type Props = {
  preferences: LearningPreferences;
  dailyNewTarget: number;
  remainingNew: number;
  remainingStudyDays: number;
  onChange: (preferences: LearningPreferences) => void;
  onResetProgress: () => void;
};

export function LearningPlanSettings({
  preferences,
  dailyNewTarget,
  remainingNew,
  remainingStudyDays,
  onChange,
  onResetProgress,
}: Props) {
  const update = (patch: Partial<LearningPreferences>) =>
    onChange({
      ...preferences,
      ...patch,
      updated_at: new Date().toISOString(),
    });

  return (
    <details className="learning-plan-settings">
      <summary>
        <span>
          <strong>Learning plan</strong>
          <small>
            {preferences.target_weeks} weeks ·{" "}
            {preferences.study_days_per_week} days each week
          </small>
        </span>
        <b>{dailyNewTarget} new / session</b>
      </summary>
      <div className="learning-plan-settings__body">
        <div className="learning-plan-settings__controls">
          <label>
            <span>Finish new material in</span>
            <select
              value={preferences.target_weeks}
              onChange={(event) => {
                const targetWeeks = Number(event.target.value) as
                  LearningPreferences["target_weeks"];
                update({
                  target_weeks: targetWeeks,
                  target_date: learningTargetDate(targetWeeks),
                });
              }}
            >
              <option value={2}>2 weeks</option>
              <option value={4}>4 weeks</option>
              <option value={8}>8 weeks</option>
            </select>
          </label>
          <label>
            <span>Study days each week</span>
            <select
              value={preferences.study_days_per_week}
              onChange={(event) =>
                update({
                  study_days_per_week: Number(event.target.value) as
                    LearningPreferences["study_days_per_week"],
                })
              }
            >
              <option value={5}>5 days</option>
              <option value={6}>6 days</option>
              <option value={7}>Every day</option>
            </select>
          </label>
        </div>
        <p>
          <strong>{remainingNew.toLocaleString()}</strong> unfamiliar
          connections over approximately{" "}
          <strong>{remainingStudyDays.toLocaleString()}</strong> planned sessions
          means <strong>{dailyNewTarget.toLocaleString()} new connections</strong>{" "}
          per session. Scheduled reviews are added separately.
        </p>
        <small>
          Target date:{" "}
          {new Date(preferences.target_date).toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </small>
        <div className="learning-plan-settings__danger">
          <div>
            <strong>Reset learning progress</strong>
            <span>
              Removes attempts, mastery, saved quizzes, memory aids, and
              results. Your learning-plan settings are kept.
            </span>
          </div>
          <button type="button" onClick={onResetProgress}>
            Reset progress…
          </button>
        </div>
      </div>
    </details>
  );
}
