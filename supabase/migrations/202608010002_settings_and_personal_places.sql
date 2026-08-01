alter table public.learner_progress
drop constraint if exists learner_progress_store_name_check;

alter table public.learner_progress
add constraint learner_progress_store_name_check check (
  store_name in (
    'attempts',
    'mastery',
    'studyAids',
    'sessionResults',
    'assessmentSessions',
    'assessmentResults',
    'mockQuestionHistory',
    'learningSessions',
    'learningPreferences',
    'routeAttempts',
    'routeSessions',
    'territoryProgress',
    'appSettings',
    'personalPlaces'
  )
);
