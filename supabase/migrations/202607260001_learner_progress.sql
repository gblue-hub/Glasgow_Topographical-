create table if not exists public.learner_progress (
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  store_name text not null check (
    store_name in (
      'attempts',
      'mastery',
      'studyAids',
      'sessionResults',
      'assessmentSessions',
      'assessmentResults',
      'mockQuestionHistory',
      'learningSessions'
    )
  ),
  item_key text not null,
  payload jsonb not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, store_name, item_key)
);

alter table public.learner_progress enable row level security;

create policy "Learners can read their own progress"
on public.learner_progress
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Learners can create their own progress"
on public.learner_progress
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Learners can update their own progress"
on public.learner_progress
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Learners can delete their own progress"
on public.learner_progress
for delete
to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete
on public.learner_progress
to authenticated;

revoke all
on public.learner_progress
from anon;
