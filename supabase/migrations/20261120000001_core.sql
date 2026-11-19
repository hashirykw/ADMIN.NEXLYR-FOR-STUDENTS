-- Nexlyr for Students · core tables
-- Run order: 001_core → 002_security → 003_seed. Safe to read top to bottom; every table says what it holds.

create extension if not exists pgcrypto;

-- ───────────────────────── people ─────────────────────────
-- One row per login. Students sign up themselves; teachers and admins are created by the admin function.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  code        text unique,                              -- NX-10001 (student) · NXT-101 (teacher) · NXA-1 (admin)
  full_name   text not null default '',
  email       text,
  phone       text,                                     -- WhatsApp, international format preferred
  country     text not null default 'Pakistan',
  level       text not null default 'O' check (level in ('O', 'A', 'Both')),
  school      text,
  avatar_path text,
  status      text not null default 'active' check (status in ('active', 'suspended')),
  created_at  timestamptz not null default now()
);
create sequence public.student_code_seq start 10001;
create sequence public.teacher_code_seq start 101;
create sequence public.admin_code_seq start 1;

-- Public face of a teacher plus how they are billed.
create table public.teachers (
  id                 uuid primary key references public.profiles (id) on delete cascade,
  slug               text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  display_name       text not null,
  title              text,                              -- "O Level Physics · 12 years"
  bio                text,
  subjects           text[] not null default '{}',      -- subject codes, e.g. {5054,9702}
  levels             text[] not null default '{O,A}',
  city               text,
  photo_path         text,                              -- avatars bucket
  class_code         text not null unique,              -- students type this to join the teacher's class
  rate_per_student   int  not null default 500 check (rate_per_student >= 0),   -- PKR per student per month
  checks_per_student int  not null default 20 check (checks_per_student between 0 and 500),
  is_public          boolean not null default true,
  verified           boolean not null default false,
  billing_status     text not null default 'active' check (billing_status in ('active', 'overdue', 'paused')),
  created_at         timestamptz not null default now()
);

-- Students in a teacher's class. Billing counts the active rows.
create table public.class_members (
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'active' check (status in ('active', 'removed')),
  joined_at  timestamptz not null default now(),
  removed_at timestamptz,
  primary key (teacher_id, student_id)
);
create index on public.class_members (student_id) where status = 'active';

-- ───────────────────────── catalogue ─────────────────────────
create table public.subjects (
  id      serial primary key,
  level   text not null check (level in ('O', 'A')),
  code    text not null,                                -- Cambridge syllabus code
  name    text not null,
  papers  text[] not null default '{}',                 -- "Paper 1 · Multiple Choice", …
  active  boolean not null default true,
  sort    int not null default 0,
  unique (level, code)
);

create table public.plans (
  id                 text primary key,                  -- free · student · pro · academy
  name               text not null,
  tagline            text,
  audience           text not null default 'student' check (audience in ('student', 'teacher')),
  price_pkr          int  not null default 0,
  price_note         text,                              -- "/ month" · "per student / month"
  period_days        int  not null default 30,
  checks_per_month   int  not null default 0,
  max_marks_per_check int,                              -- null = any length, incl. full essays
  lectures           boolean not null default false,
  photo_answers      boolean not null default false,
  members_notes      boolean not null default false,
  features           text[] not null default '{}',
  sort               int not null default 0,
  active             boolean not null default true
);

create table public.subscriptions (
  id         bigserial primary key,
  student_id uuid not null references public.profiles (id) on delete cascade,
  plan_id    text not null references public.plans (id),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  status     text not null default 'active' check (status in ('active', 'cancelled')),
  payment_id bigint,
  created_at timestamptz not null default now()
);
create index on public.subscriptions (student_id, ends_at desc);

-- ───────────────────────── money in: slips ─────────────────────────
-- Every bank / JazzCash / Easypaisa slip lands here. Admin approves → subscription or invoice settles.
create table public.payments (
  id            bigserial primary key,
  kind          text not null check (kind in ('plan', 'teacher_invoice')),
  student_id    uuid references public.profiles (id) on delete set null,
  teacher_id    uuid references public.teachers (id) on delete set null,
  plan_id       text references public.plans (id),
  invoice_id    bigint,
  months        int not null default 1 check (months between 1 and 12),
  amount_pkr    int,
  method        text,                                   -- Bank transfer · JazzCash · Easypaisa · Card abroad
  reference     text,                                   -- transaction ID typed by the payer
  slip_path     text,                                   -- slips bucket (private)
  payer_note    text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  reviewed_by   uuid references public.profiles (id),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index on public.payments (status, created_at desc);

-- Teachers who want to join. Admin turns an approved application into a teacher login.
create table public.teacher_applications (
  id          bigserial primary key,
  full_name   text not null,
  email       text not null,
  phone       text not null,
  city        text,
  country     text default 'Pakistan',
  subjects    text[] not null default '{}',
  levels      text[] not null default '{}',
  experience  text,
  students    text,                                     -- rough class size they expect
  links       text,                                     -- notes / YouTube / Instagram
  note        text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  teacher_id  uuid references public.teachers (id) on delete set null,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  ip_hash     text,
  created_at  timestamptz not null default now()
);

create table public.invoices (
  id         bigserial primary key,
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  month      date not null,                             -- first day of the billed month
  students   int not null,
  rate       int not null,
  amount_pkr int not null,
  status     text not null default 'unpaid' check (status in ('unpaid', 'paid', 'waived')),
  payment_id bigint references public.payments (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (teacher_id, month)
);

-- ───────────────────────── learning material ─────────────────────────
create table public.notes (
  id          bigserial primary key,
  teacher_id  uuid references public.teachers (id) on delete cascade,   -- null = Nexlyr's own notes
  subject_id  int not null references public.subjects (id),
  title       text not null,
  topic       text,
  summary     text,
  file_path   text not null,                            -- notes bucket (public)
  pages       int,
  size_kb     int,
  visibility  text not null default 'public' check (visibility in ('public', 'members')),
  published   boolean not null default true,
  views       int not null default 0,
  created_at  timestamptz not null default now()
);
create index on public.notes (subject_id) where published;

-- Recorded lectures are unlisted YouTube videos. The ID never leaves the database except through get_lecture().
create table public.lectures (
  id           bigserial primary key,
  teacher_id   uuid references public.teachers (id) on delete cascade,  -- null = Nexlyr's own
  subject_id   int not null references public.subjects (id),
  title        text not null,
  topic        text,
  youtube_id   text not null check (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  duration_min int,
  audience     text not null default 'subscribers' check (audience in ('subscribers', 'class')),
  published    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ───────────────────────── AI checking ─────────────────────────
create table public.checks (
  id                 uuid primary key default gen_random_uuid(),
  student_id         uuid not null references public.profiles (id) on delete cascade,
  subject_id         int references public.subjects (id),
  paper              text,
  question_label     text,                              -- "Q3(b)"
  question           text,
  question_paths     text[] not null default '{}',      -- answers bucket
  max_marks          int not null check (max_marks between 1 and 100),
  mark_scheme        text,
  answer_text        text,
  answer_paths       text[] not null default '{}',      -- answers bucket
  status             text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  report             jsonb,
  marks_awarded      numeric(5,1),
  model              text,
  tokens_in          int,
  tokens_out         int,
  cost_pkr           numeric(10,2),
  source             text not null default 'free' check (source in ('free', 'plan', 'class')),
  teacher_id         uuid references public.teachers (id) on delete set null,
  is_demo            boolean not null default false,
  error              text,
  created_at         timestamptz not null default now()
);
create index on public.checks (student_id, created_at desc);
create index on public.checks (teacher_id, created_at desc);
create index on public.checks (created_at);

-- A teacher's correction of an AI mark. The checker reads recent ones as calibration.
create table public.check_reviews (
  id            bigserial primary key,
  check_id      uuid not null references public.checks (id) on delete cascade,
  reviewer_id   uuid not null references public.profiles (id) on delete cascade,
  marks_awarded numeric(5,1) not null,
  comment       text,
  created_at    timestamptz not null default now()
);
create index on public.check_reviews (check_id);

-- ───────────────────────── settings & plumbing ─────────────────────────
create table public.settings (
  id               int primary key default 1 check (id = 1),
  ai_paused        boolean not null default false,
  pause_message    text not null default 'The AI checker is paused for an upgrade. Your checks are safe — try again soon.',
  model_main       text not null default 'claude-sonnet-5-5',
  model_light      text not null default 'claude-haiku-5-5',
  light_max_marks  int  not null default 6,              -- questions up to this many marks, typed answers only → light model
  usd_pkr          numeric(8,2) not null default 280,
  main_in_usd_mtok   numeric(8,3) not null default 3,     -- set from Anthropic's pricing page
  main_out_usd_mtok  numeric(8,3) not null default 15,
  light_in_usd_mtok  numeric(8,3) not null default 1,
  light_out_usd_mtok numeric(8,3) not null default 5,
  monthly_budget_pkr int not null default 50000,          -- checker pauses itself past this
  free_checks_ip_day int not null default 10,
  payment_accounts jsonb not null default '[]',           -- [{method, title, number, holder, note}]
  whatsapp         text not null default '+92 305 3687680',
  support_email    text not null default 'nexlyr.solutions@gmail.com',
  updated_at       timestamptz not null default now()
);

create table public.notifications (
  id           bigserial primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind         text not null default 'announcement',     -- payment · report · review · class · lecture · announcement
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on public.notifications (recipient_id, created_at desc);

create table public.rate_limits (
  id         bigserial primary key,
  bucket     text not null,                             -- register:<ip-hash> · apply:<ip-hash> · check:<uid>
  created_at timestamptz not null default now()
);
create index on public.rate_limits (bucket, created_at desc);

create table public.audit_log (
  id         bigserial primary key,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  target     text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
