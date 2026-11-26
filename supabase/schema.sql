create table if not exists public.saved_projects (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  project jsonb not null,
  assets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  last_opened_at timestamptz,
  preview text
);

alter table public.saved_projects
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists last_opened_at timestamptz,
  add column if not exists preview text;

create index if not exists saved_projects_user_updated_idx
  on public.saved_projects (user_id, updated_at desc);

alter table public.saved_projects enable row level security;
revoke all on table public.saved_projects from anon, authenticated;
grant select, insert, update, delete on table public.saved_projects to authenticated;

drop policy if exists "GarageBand users can read their own projects" on public.saved_projects;
create policy "GarageBand users can read their own projects"
  on public.saved_projects for select
  using ((select auth.uid()) = user_id);

drop policy if exists "GarageBand users can create their own projects" on public.saved_projects;
create policy "GarageBand users can create their own projects"
  on public.saved_projects for insert
  with check ((select auth.uid()) = user_id);

drop policy if exists "GarageBand users can update their own projects" on public.saved_projects;
create policy "GarageBand users can update their own projects"
  on public.saved_projects for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "GarageBand users can delete their own projects" on public.saved_projects;
create policy "GarageBand users can delete their own projects"
  on public.saved_projects for delete
  using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public)
values ('project-audio', 'project-audio', false)
on conflict (id) do update set public = false;

drop policy if exists "GarageBand users can read their own project audio" on storage.objects;
create policy "GarageBand users can read their own project audio"
  on storage.objects for select
  using (
    bucket_id = 'project-audio'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "GarageBand users can upload their own project audio" on storage.objects;
create policy "GarageBand users can upload their own project audio"
  on storage.objects for insert
  with check (
    bucket_id = 'project-audio'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "GarageBand users can update their own project audio" on storage.objects;
create policy "GarageBand users can update their own project audio"
  on storage.objects for update
  using (
    bucket_id = 'project-audio'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'project-audio'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "GarageBand users can delete their own project audio" on storage.objects;
create policy "GarageBand users can delete their own project audio"
  on storage.objects for delete
  using (
    bucket_id = 'project-audio'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
