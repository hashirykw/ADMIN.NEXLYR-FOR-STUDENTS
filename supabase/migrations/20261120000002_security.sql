-- Nexlyr for Students · roles, row security, storage and every RPC the two sites call.
-- Rule of thumb: the browser only ever reads. Anything that creates money, logins or AI results
-- goes through an edge function (service role) or a SECURITY DEFINER function that checks the caller.

-- ───────────────────────── who is calling ─────────────────────────
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;
create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'teacher', false)
$$;
-- true when the caller teaches this student (active class member)
create or replace function public.teaches(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.class_members
                 where teacher_id = auth.uid() and student_id = p_student and status = 'active')
$$;

-- ───────────────────────── new login → profile ─────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, role, code, full_name, email, phone, country, level, school)
  values (
    new.id, 'student', 'NX-' || nextval('public.student_code_seq'),
    left(coalesce(m->>'full_name', ''), 80), new.email,
    left(m->>'phone', 24), left(coalesce(nullif(m->>'country', ''), 'Pakistan'), 60),
    case when m->>'level' in ('O', 'A', 'Both') then m->>'level' else 'O' end,
    left(m->>'school', 120)
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin function promotes a profile; this keeps codes in their own series.
create or replace function public.set_role(p_user uuid, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if p_role not in ('student', 'teacher', 'admin') then raise exception 'bad role'; end if;
  c := case p_role when 'teacher' then 'NXT-' || nextval('public.teacher_code_seq')
                   when 'admin'   then 'NXA-' || nextval('public.admin_code_seq')
                   else 'NX-' || nextval('public.student_code_seq') end;
  update public.profiles set role = p_role, code = c where id = p_user;
  return c;
end $$;
revoke all on function public.set_role(uuid, text) from public, anon, authenticated;
grant execute on function public.set_role(uuid, text) to service_role;

-- ───────────────────────── entitlements ─────────────────────────
-- What a student can do right now. Best of: paid plan, teacher's class, free.
create or replace function public.entitlement(p_student uuid)
returns table (plan_id text, plan_name text, source text, teacher_id uuid, checks_limit int,
               max_marks int, lectures boolean, photo_answers boolean, members_notes boolean, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  with paid as (
    select p.id, p.name, 'plan'::text src, null::uuid tid, p.checks_per_month lim, p.max_marks_per_check mm,
           p.lectures lec, p.photo_answers ph, p.members_notes mn, s.ends_at e
    from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.student_id = p_student and s.status = 'active' and now() between s.starts_at and s.ends_at
    order by p.checks_per_month desc, s.ends_at desc limit 1
  ), cls as (
    select 'academy'::text, coalesce(pl.name, 'Academy'), 'class'::text, t.id, t.checks_per_student,
           null::int, true, true, true, null::timestamptz
    from public.class_members cm join public.teachers t on t.id = cm.teacher_id
    left join public.plans pl on pl.id = 'academy'
    where cm.student_id = p_student and cm.status = 'active' and t.billing_status = 'active'
    order by t.checks_per_student desc limit 1
  ), fr as (
    select id, name, 'free'::text, null::uuid, checks_per_month, max_marks_per_check,
           lectures, photo_answers, members_notes, null::timestamptz
    from public.plans where id = 'free'
  )
  select * from (select * from paid union all select * from cls union all select * from fr) x
  order by x.lim desc nulls last limit 1
$$;
revoke all on function public.entitlement(uuid) from public, anon;
grant execute on function public.entitlement(uuid) to authenticated, service_role;

create or replace function public.checks_used(p_student uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.checks
  where student_id = p_student and status <> 'failed' and not is_demo
    and created_at >= date_trunc('month', now())
$$;
revoke all on function public.checks_used(uuid) from public, anon;
grant execute on function public.checks_used(uuid) to authenticated, service_role;

-- Called only by the ai-check edge function, before it spends anything. Inserts the queued row
-- inside the same transaction, so two taps at once can never both pass the limit.
create or replace function public.reserve_check(
  p_student uuid, p_subject int, p_paper text, p_label text, p_question text, p_question_paths text[],
  p_max_marks int, p_mark_scheme text, p_answer text, p_answer_paths text[], p_demo boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record; used int; s public.settings; spent numeric; new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('check:' || p_student));
  select * into s from public.settings where id = 1;
  if exists (select 1 from public.profiles where id = p_student and status <> 'active') then
    return jsonb_build_object('ok', false, 'reason', 'suspended');
  end if;
  if s.ai_paused and not p_demo then
    return jsonb_build_object('ok', false, 'reason', 'paused', 'message', s.pause_message);
  end if;
  select coalesce(sum(cost_pkr), 0) into spent from public.checks where created_at >= date_trunc('month', now());
  if spent >= s.monthly_budget_pkr and not p_demo then
    return jsonb_build_object('ok', false, 'reason', 'paused', 'message', s.pause_message);
  end if;
  select * into e from public.entitlement(p_student);
  used := public.checks_used(p_student);
  if not p_demo and used >= e.checks_limit then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'used', used, 'limit', e.checks_limit, 'plan', e.plan_name);
  end if;
  if e.max_marks is not null and p_max_marks > e.max_marks then
    return jsonb_build_object('ok', false, 'reason', 'too_long', 'max', e.max_marks, 'plan', e.plan_name);
  end if;
  if coalesce(array_length(p_answer_paths, 1), 0) + coalesce(array_length(p_question_paths, 1), 0) > 0 and not e.photo_answers then
    return jsonb_build_object('ok', false, 'reason', 'photos', 'plan', e.plan_name);
  end if;
  insert into public.checks (student_id, subject_id, paper, question_label, question, question_paths, max_marks,
                             mark_scheme, answer_text, answer_paths, source, teacher_id, is_demo)
  values (p_student, p_subject, left(p_paper, 120), left(p_label, 40), left(p_question, 8000), coalesce(p_question_paths, '{}'),
          p_max_marks, left(p_mark_scheme, 8000), left(p_answer, 20000), coalesce(p_answer_paths, '{}'),
          e.source, e.teacher_id, p_demo)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'used', used + (case when p_demo then 0 else 1 end),
                            'limit', e.checks_limit, 'source', e.source, 'teacher_id', e.teacher_id);
end $$;
revoke all on function public.reserve_check(uuid, int, text, text, text, text[], int, text, text, text[], boolean) from public, anon, authenticated;
grant execute on function public.reserve_check(uuid, int, text, text, text, text[], int, text, text, text[], boolean) to service_role;

-- ───────────────────────── student RPCs ─────────────────────────
create or replace function public.my_account() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; e record; cls jsonb;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then return null; end if;
  select * into e from public.entitlement(p.id);
  select jsonb_agg(jsonb_build_object('teacher', t.display_name, 'slug', t.slug, 'joined', cm.joined_at))
    into cls from public.class_members cm join public.teachers t on t.id = cm.teacher_id
   where cm.student_id = p.id and cm.status = 'active';
  return jsonb_build_object(
    'id', p.id, 'code', p.code, 'role', p.role, 'name', p.full_name, 'email', p.email, 'phone', p.phone,
    'country', p.country, 'level', p.level, 'school', p.school, 'avatar', p.avatar_path,
    'plan', jsonb_build_object('id', e.plan_id, 'name', e.plan_name, 'source', e.source, 'ends_at', e.ends_at,
                               'checks_limit', e.checks_limit, 'max_marks', e.max_marks, 'lectures', e.lectures,
                               'photo_answers', e.photo_answers),
    'checks_used', public.checks_used(p.id),
    'classes', coalesce(cls, '[]'::jsonb),
    'pending_payments', (select count(*) from public.payments where student_id = p.id and status = 'pending'));
end $$;
grant execute on function public.my_account() to authenticated;

create or replace function public.update_my_profile(p_name text, p_phone text, p_country text, p_level text, p_school text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set
    full_name = left(coalesce(nullif(trim(p_name), ''), full_name), 80),
    phone = left(p_phone, 24), country = left(coalesce(nullif(p_country, ''), country), 60),
    level = case when p_level in ('O', 'A', 'Both') then p_level else level end,
    school = left(p_school, 120)
  where id = auth.uid();
end $$;
grant execute on function public.update_my_profile(text, text, text, text, text) to authenticated;

create or replace function public.join_class(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.teachers; me uuid := auth.uid();
begin
  if me is null then raise exception 'sign in first'; end if;
  if public.my_role() <> 'student' then return jsonb_build_object('ok', false, 'reason', 'not_student'); end if;
  select * into t from public.teachers where class_code = upper(trim(p_code));
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'code'); end if;
  insert into public.class_members (teacher_id, student_id) values (t.id, me)
  on conflict (teacher_id, student_id) do update set status = 'active', removed_at = null, joined_at = now();
  insert into public.notifications (recipient_id, kind, title, body, link)
  select t.id, 'class', 'New student in your class', p.full_name || ' (' || p.code || ') joined with your class code.', '/#students'
  from public.profiles p where p.id = me;
  return jsonb_build_object('ok', true, 'teacher', t.display_name, 'slug', t.slug);
end $$;
grant execute on function public.join_class(text) to authenticated;

create or replace function public.leave_class(p_slug text) returns void
language sql security definer set search_path = public as $$
  update public.class_members cm set status = 'removed', removed_at = now()
  from public.teachers t where t.id = cm.teacher_id and t.slug = p_slug and cm.student_id = auth.uid()
$$;
grant execute on function public.leave_class(text) to authenticated;

-- true when the caller is an active student of this teacher
create or replace function public.teaches_me(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_teacher is not null and exists (
    select 1 from public.class_members cm join public.teachers t on t.id = cm.teacher_id
    where cm.teacher_id = p_teacher and cm.student_id = auth.uid() and cm.status = 'active' and t.billing_status = 'active')
$$;
-- Lectures without their video IDs, with whether the caller can play each one.
create or replace function public.list_lectures(p_subject int default null) returns table (
  id bigint, title text, topic text, duration_min int, subject_id int, subject text, level text,
  teacher text, teacher_slug text, created_at timestamptz, can_play boolean)
language sql stable security definer set search_path = public as $$
  select l.id, l.title, l.topic, l.duration_min, s.id, s.name, s.level, coalesce(t.display_name, 'Nexlyr Solutions'), t.slug, l.created_at,
         (case when auth.uid() is null then false
               when public.is_admin() or l.teacher_id = auth.uid() then true
               when l.audience = 'class' then public.teaches_me(l.teacher_id)
               else (select e.lectures from public.entitlement(auth.uid()) e) or public.teaches_me(l.teacher_id) end)
  from public.lectures l join public.subjects s on s.id = l.subject_id
  left join public.teachers t on t.id = l.teacher_id
  where l.published and (p_subject is null or l.subject_id = p_subject)
  order by s.level, s.sort, l.topic nulls last, l.created_at
$$;
grant execute on function public.list_lectures(int) to anon, authenticated;

create or replace function public.get_lecture(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.lectures; ok boolean;
begin
  select * into l from public.lectures where id = p_id and published;
  if l.id is null or auth.uid() is null then return null; end if;
  ok := public.is_admin() or l.teacher_id = auth.uid() or public.teaches_me(l.teacher_id)
        or (l.audience = 'subscribers' and (select e.lectures from public.entitlement(auth.uid()) e));
  if not ok then return null; end if;
  -- the ID is sent reversed and shifted; the player undoes it, so it never sits in the page as plain text
  return jsonb_build_object('t', l.title, 'v', translate(reverse(l.youtube_id),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
    'NOPQRSTUVWXYZABCDEFGHIJKLMnopqrstuvwxyzabcdefghijklm5678901234_-'));
end $$;
grant execute on function public.get_lecture(bigint) to authenticated;

-- Public teacher directory (never exposes class codes or billing).
create or replace function public.public_teachers() returns table (
  slug text, name text, title text, bio text, subjects text[], levels text[], city text, photo_path text,
  verified boolean, notes int, lectures int)
language sql stable security definer set search_path = public as $$
  select t.slug, t.display_name, t.title, t.bio, t.subjects, t.levels, t.city, t.photo_path, t.verified,
         (select count(*)::int from public.notes n where n.teacher_id = t.id and n.published),
         (select count(*)::int from public.lectures l where l.teacher_id = t.id and l.published)
  from public.teachers t join public.profiles p on p.id = t.id
  where t.is_public and p.status = 'active'
  order by t.verified desc, t.display_name
$$;
grant execute on function public.public_teachers() to anon, authenticated;

-- Notes list for the public library. Members-only notes are listed (so students can see what a plan
-- unlocks) but their file path is only returned to people who can open them.
create or replace function public.list_notes(p_level text default null, p_subject int default null, p_teacher text default null, p_q text default null, p_limit int default 200)
returns table (id bigint, title text, topic text, summary text, pages int, visibility text, created_at timestamptz,
               subject_id int, teacher text, teacher_slug text, file_path text, locked boolean, views int)
language sql stable security definer set search_path = public as $$
  with acc as (select coalesce((select e.members_notes from public.entitlement(auth.uid()) e where auth.uid() is not null), false) m)
  select n.id, n.title, n.topic, n.summary, n.pages, n.visibility, n.created_at, n.subject_id,
         coalesce(t.display_name, 'Nexlyr Solutions'), t.slug,
         case when coalesce(n.visibility = 'public' or acc.m or public.teaches_me(n.teacher_id) or public.is_admin() or n.teacher_id = auth.uid(), false) then n.file_path end,
         not coalesce(n.visibility = 'public' or acc.m or public.teaches_me(n.teacher_id) or public.is_admin() or n.teacher_id = auth.uid(), false),
         n.views
  from public.notes n join public.subjects s on s.id = n.subject_id
  left join public.teachers t on t.id = n.teacher_id, acc
  where n.published and (t.id is null or t.is_public or public.teaches_me(t.id))
    and (p_level is null or s.level = p_level) and (p_subject is null or n.subject_id = p_subject)
    and (p_teacher is null or t.slug = p_teacher)
    and (p_q is null or n.title ilike '%' || p_q || '%' or n.topic ilike '%' || p_q || '%')
  order by n.created_at desc limit least(coalesce(p_limit, 200), 500)
$$;
grant execute on function public.list_notes(text, int, text, text, int) to anon, authenticated;

create or replace function public.note_viewed(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update public.notes set views = views + 1 where id = p_id and published
$$;
grant execute on function public.note_viewed(bigint) to anon, authenticated;

create or replace function public.public_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ai_paused', ai_paused, 'pause_message', pause_message,
                            'payment_accounts', payment_accounts, 'whatsapp', whatsapp, 'support_email', support_email)
  from public.settings where id = 1
$$;
grant execute on function public.public_settings() to anon, authenticated;

-- ───────────────────────── teacher RPCs ─────────────────────────
create or replace function public.teacher_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.teachers; n int;
begin
  select * into t from public.teachers where id = auth.uid();
  if t.id is null then return null; end if;
  select count(*) into n from public.class_members where teacher_id = t.id and status = 'active';
  return jsonb_build_object(
    'name', t.display_name, 'slug', t.slug, 'class_code', t.class_code, 'rate', t.rate_per_student,
    'checks_per_student', t.checks_per_student, 'billing_status', t.billing_status,
    'students', n, 'this_month_bill', n * t.rate_per_student,
    'checks_this_month', (select count(*) from public.checks where teacher_id = t.id and created_at >= date_trunc('month', now()) and not is_demo),
    'avg_percent', (select round(avg(marks_awarded * 100.0 / max_marks)) from public.checks
                    where teacher_id = t.id and status = 'done' and created_at >= now() - interval '30 days'),
    'notes', (select count(*) from public.notes where teacher_id = t.id),
    'lectures', (select count(*) from public.lectures where teacher_id = t.id),
    'unpaid', (select coalesce(sum(amount_pkr), 0) from public.invoices where teacher_id = t.id and status = 'unpaid'));
end $$;
grant execute on function public.teacher_overview() to authenticated;

create or replace function public.teacher_students() returns table (
  student_id uuid, code text, name text, phone text, level text, joined_at timestamptz,
  checks_month int, avg_percent int, last_check timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.code, p.full_name, p.phone, p.level, cm.joined_at,
         (select count(*)::int from public.checks c where c.student_id = p.id and c.teacher_id = cm.teacher_id and c.created_at >= date_trunc('month', now())),
         (select round(avg(c.marks_awarded * 100.0 / c.max_marks))::int from public.checks c where c.student_id = p.id and c.status = 'done'),
         (select max(c.created_at) from public.checks c where c.student_id = p.id)
  from public.class_members cm join public.profiles p on p.id = cm.student_id
  where cm.teacher_id = auth.uid() and cm.status = 'active'
  order by p.full_name
$$;
grant execute on function public.teacher_students() to authenticated;

create or replace function public.remove_student(p_student uuid) returns void
language sql security definer set search_path = public as $$
  update public.class_members set status = 'removed', removed_at = now()
  where teacher_id = auth.uid() and student_id = p_student
$$;
grant execute on function public.remove_student(uuid) to authenticated;

create or replace function public.update_my_teacher_page(p_title text, p_bio text, p_subjects text[], p_levels text[], p_city text, p_public boolean)
returns void language sql security definer set search_path = public as $$
  update public.teachers set title = left(p_title, 120), bio = left(p_bio, 1500), subjects = p_subjects[1:30],
    levels = p_levels[1:2], city = left(p_city, 60), is_public = coalesce(p_public, is_public)
  where id = auth.uid()
$$;
grant execute on function public.update_my_teacher_page(text, text, text[], text[], text, boolean) to authenticated;

-- A teacher (of that student) or an admin corrects an AI mark.
create or replace function public.review_check(p_check uuid, p_marks numeric, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.checks;
begin
  select * into c from public.checks where id = p_check;
  if c.id is null then raise exception 'not found'; end if;
  if not (public.is_admin() or public.teaches(c.student_id)) then raise exception 'not allowed'; end if;
  if p_marks < 0 or p_marks > c.max_marks then raise exception 'marks out of range'; end if;
  insert into public.check_reviews (check_id, reviewer_id, marks_awarded, comment) values (p_check, auth.uid(), p_marks, left(p_comment, 2000));
  insert into public.notifications (recipient_id, kind, title, body, link)
  values (c.student_id, 'review', 'Your teacher reviewed a check',
          'Marked ' || p_marks || ' / ' || c.max_marks || coalesce(' — ' || left(p_comment, 120), ''), '/report?id=' || c.id);
end $$;
grant execute on function public.review_check(uuid, numeric, text) to authenticated;

-- ───────────────────────── admin RPCs ─────────────────────────
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return jsonb_build_object(
    'students', (select count(*) from public.profiles where role = 'student'),
    'new_students_7d', (select count(*) from public.profiles where role = 'student' and created_at > now() - interval '7 days'),
    'paying', (select count(distinct student_id) from public.subscriptions where status = 'active' and now() between starts_at and ends_at),
    'teachers', (select count(*) from public.teachers),
    'class_students', (select count(*) from public.class_members where status = 'active'),
    'pending_payments', (select count(*) from public.payments where status = 'pending'),
    'pending_teachers', (select count(*) from public.teacher_applications where status = 'pending'),
    'checks_today', (select count(*) from public.checks where created_at >= date_trunc('day', now()) and not is_demo),
    'checks_month', (select count(*) from public.checks where created_at >= date_trunc('month', now()) and not is_demo),
    'ai_cost_month', (select coalesce(sum(cost_pkr), 0) from public.checks where created_at >= date_trunc('month', now())),
    'revenue_month', (select coalesce(sum(amount_pkr), 0) from public.payments where status = 'approved' and reviewed_at >= date_trunc('month', now())),
    'unpaid_invoices', (select coalesce(sum(amount_pkr), 0) from public.invoices where status = 'unpaid'),
    'budget', (select monthly_budget_pkr from public.settings where id = 1),
    'paused', (select ai_paused from public.settings where id = 1),
    'by_day', (select coalesce(jsonb_agg(x order by x.d), '[]') from (
                 select date_trunc('day', created_at)::date d, count(*) n, round(sum(coalesce(cost_pkr, 0))) cost
                 from public.checks where created_at > now() - interval '30 days' and not is_demo group by 1) x));
end $$;
grant execute on function public.admin_overview() to authenticated;

-- Approve or reject a slip. Approving a plan payment starts (or extends) the subscription.
create or replace function public.review_payment(p_id bigint, p_approve boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay public.payments; pl public.plans; start_at timestamptz; end_at timestamptz;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into pay from public.payments where id = p_id for update;
  if pay.id is null then raise exception 'not found'; end if;
  if pay.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'already ' || pay.status); end if;
  update public.payments set status = case when p_approve then 'approved' else 'rejected' end,
         reject_reason = case when p_approve then null else left(p_reason, 300) end,
         reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  if p_approve and pay.kind = 'plan' then
    select * into pl from public.plans where id = pay.plan_id;
    select greatest(now(), coalesce(max(ends_at), now())) into start_at from public.subscriptions
      where student_id = pay.student_id and plan_id = pay.plan_id and status = 'active';
    end_at := start_at + make_interval(days => pl.period_days * pay.months);
    insert into public.subscriptions (student_id, plan_id, starts_at, ends_at, payment_id)
    values (pay.student_id, pay.plan_id, now(), end_at, pay.id);
    insert into public.notifications (recipient_id, kind, title, body, link)
    values (pay.student_id, 'payment', pl.name || ' plan is active', 'Payment confirmed. Active until ' || to_char(end_at, 'DD Mon YYYY') || '.', '/portal');
  elsif p_approve and pay.kind = 'teacher_invoice' then
    update public.invoices set status = 'paid', payment_id = pay.id where id = pay.invoice_id;
    update public.teachers set billing_status = 'active' where id = pay.teacher_id
      and not exists (select 1 from public.invoices where teacher_id = pay.teacher_id and status = 'unpaid');
    insert into public.notifications (recipient_id, kind, title, body, link)
    values (pay.teacher_id, 'payment', 'Invoice paid', 'Thank you. Your class stays active.', '/#billing');
  elsif not p_approve then
    insert into public.notifications (recipient_id, kind, title, body, link)
    values (coalesce(pay.student_id, pay.teacher_id), 'payment', 'Payment slip not accepted',
            coalesce(p_reason, 'We could not match this slip. Please send it again or message us on WhatsApp.'), '/portal#billing');
  end if;
  insert into public.audit_log (actor_id, action, target, detail)
  values (auth.uid(), case when p_approve then 'payment.approve' else 'payment.reject' end, p_id::text, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.review_payment(bigint, boolean, text) to authenticated;

-- Bills every teacher for the students in their class during that month (joined before it ended,
-- not removed before it began). Re-running a month only fills in teachers that have no invoice yet.
create or replace function public.generate_invoices(p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; n int;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  insert into public.invoices (teacher_id, month, students, rate, amount_pkr)
  select t.id, m, c.n, t.rate_per_student, c.n * t.rate_per_student
  from public.teachers t
  join lateral (select count(*)::int n from public.class_members cm
                where cm.teacher_id = t.id and cm.joined_at < (m + interval '1 month')
                  and (cm.removed_at is null or cm.removed_at >= m)) c on c.n > 0
  on conflict (teacher_id, month) do nothing;
  get diagnostics n = row_count;
  insert into public.notifications (recipient_id, kind, title, body, link)
  select i.teacher_id, 'payment', 'Invoice for ' || to_char(m, 'Mon YYYY'),
         i.students || ' students × Rs ' || i.rate || ' = Rs ' || i.amount_pkr, '/#billing'
  from public.invoices i where i.month = m and i.created_at > now() - interval '1 minute';
  insert into public.audit_log (actor_id, action, target) values (auth.uid(), 'invoices.generate', m::text);
  return n;
end $$;
grant execute on function public.generate_invoices(date) to authenticated;

create or replace function public.notify(p_to text, p_title text, p_body text, p_link text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  insert into public.notifications (recipient_id, kind, title, body, link)
  select id, 'announcement', left(p_title, 120), left(p_body, 600), p_link from public.profiles
  where status = 'active' and (p_to = 'all' or role = p_to);
  get diagnostics n = row_count; return n;
end $$;
grant execute on function public.notify(text, text, text, text) to authenticated;

-- ───────────────────────── row level security ─────────────────────────
alter table public.profiles             enable row level security;
alter table public.teachers             enable row level security;
alter table public.class_members        enable row level security;
alter table public.subjects             enable row level security;
alter table public.plans                enable row level security;
alter table public.subscriptions        enable row level security;
alter table public.payments             enable row level security;
alter table public.teacher_applications enable row level security;
alter table public.invoices             enable row level security;
alter table public.notes                enable row level security;
alter table public.lectures             enable row level security;
alter table public.checks               enable row level security;
alter table public.check_reviews        enable row level security;
alter table public.settings             enable row level security;
alter table public.notifications        enable row level security;
alter table public.rate_limits          enable row level security;
alter table public.audit_log            enable row level security;

-- profiles: yourself, your class (teachers), everyone (admins). Writes go through RPCs / admin.
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.teaches(id));
create policy profiles_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy teachers_read on public.teachers for select to authenticated using (id = auth.uid() or public.is_admin());
create policy teachers_admin on public.teachers for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy class_read on public.class_members for select to authenticated
  using (student_id = auth.uid() or teacher_id = auth.uid() or public.is_admin());
create policy class_admin on public.class_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy subjects_read on public.subjects for select to anon, authenticated using (active or public.is_admin());
create policy subjects_admin on public.subjects for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy plans_read on public.plans for select to anon, authenticated using (active or public.is_admin());
create policy plans_admin on public.plans for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy subs_read on public.subscriptions for select to authenticated using (student_id = auth.uid() or public.is_admin());
create policy subs_admin on public.subscriptions for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy pay_read on public.payments for select to authenticated
  using (student_id = auth.uid() or teacher_id = auth.uid() or public.is_admin());
create policy apps_admin on public.teacher_applications for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy inv_read on public.invoices for select to authenticated using (teacher_id = auth.uid() or public.is_admin());
create policy inv_admin on public.invoices for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- notes: public ones for everybody; members-only for subscribers/class; owners manage their own.
create policy notes_public on public.notes for select to anon, authenticated using (published and visibility = 'public');
create policy notes_members on public.notes for select to authenticated using (
  (published and visibility = 'members' and ((select e.members_notes from public.entitlement(auth.uid()) e) or public.teaches_me(teacher_id)))
  or teacher_id = auth.uid() or public.is_admin());
create policy notes_own on public.notes for all to authenticated
  using (teacher_id = auth.uid() or public.is_admin())
  with check ((teacher_id = auth.uid() and public.is_teacher()) or public.is_admin());

-- lectures: owners and admins only. Students go through list_lectures() / get_lecture().
create policy lectures_own on public.lectures for all to authenticated
  using (teacher_id = auth.uid() or public.is_admin())
  with check ((teacher_id = auth.uid() and public.is_teacher()) or public.is_admin());

create policy checks_read on public.checks for select to authenticated
  using (student_id = auth.uid() or public.is_admin() or public.teaches(student_id));
create policy reviews_read on public.check_reviews for select to authenticated using (
  reviewer_id = auth.uid() or public.is_admin()
  or exists (select 1 from public.checks c where c.id = check_id and (c.student_id = auth.uid() or public.teaches(c.student_id))));

create policy settings_admin on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy notif_own on public.notifications for select to authenticated using (recipient_id = auth.uid());
create policy notif_own_upd on public.notifications for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy notif_own_del on public.notifications for delete to authenticated using (recipient_id = auth.uid());

create policy audit_admin on public.audit_log for select to authenticated using (public.is_admin());
-- rate_limits: no policies → service role only.

-- live notification bell
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ───────────────────────── storage ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('slips',   'slips',   false, 8388608,  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('answers', 'answers', false, 8388608,  array['image/jpeg', 'image/png', 'image/webp']),
  ('notes',   'notes',   true,  31457280, array['application/pdf']),
  ('members-notes', 'members-notes', false, 31457280, array['application/pdf']),
  ('avatars', 'avatars', true,  2097152,  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- slips: written by the payment edge function (service role); read by admins only
create policy slips_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'slips' and public.is_admin());

-- answers: students upload into answers/<their id>/…; they, their teacher and admins can read
create policy answers_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'answers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy answers_read on storage.objects for select to authenticated
  using (bucket_id = 'answers' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
         or public.teaches(((storage.foldername(name))[1])::uuid)));

-- notes: public read (bucket is public); teachers write into notes/<their id>/…; admins anywhere
create policy notes_write on storage.objects for insert to authenticated
  with check (bucket_id = 'notes' and (public.is_admin() or (public.is_teacher() and (storage.foldername(name))[1] = auth.uid()::text)));
create policy notes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'notes' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- members-only notes: private bucket, path members-notes/<teacher id or "nexlyr">/…
create policy mnotes_read on storage.objects for select to authenticated
  using (bucket_id = 'members-notes' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text
         or (select e.members_notes from public.entitlement(auth.uid()) e)
         or ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and public.teaches_me(((storage.foldername(name))[1])::uuid))));
create policy mnotes_write on storage.objects for insert to authenticated
  with check (bucket_id = 'members-notes' and (public.is_admin() or (public.is_teacher() and (storage.foldername(name))[1] = auth.uid()::text)));
create policy mnotes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'members-notes' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

-- ───────────────────────── admin lists ─────────────────────────
create or replace function public.admin_students(p_q text default null, p_limit int default 300)
returns table (id uuid, code text, name text, email text, phone text, country text, level text, status text, created_at timestamptz,
               plan text, plan_source text, ends_at timestamptz, checks_month int, teacher text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
  select p.id, p.code, p.full_name, p.email, p.phone, p.country, p.level, p.status, p.created_at,
         e.plan_name, e.source, e.ends_at, public.checks_used(p.id),
         (select string_agg(t.display_name, ', ') from public.class_members cm join public.teachers t on t.id = cm.teacher_id
           where cm.student_id = p.id and cm.status = 'active')
  from public.profiles p cross join lateral public.entitlement(p.id) e
  where p.role = 'student'
    and (p_q is null or p.full_name ilike '%' || p_q || '%' or p.email ilike '%' || p_q || '%' or p.code ilike '%' || p_q || '%' or p.phone ilike '%' || p_q || '%')
  order by p.created_at desc limit least(coalesce(p_limit, 300), 1000);
end $$;
grant execute on function public.admin_students(text, int) to authenticated;

create or replace function public.admin_teachers() returns table (
  id uuid, code text, slug text, name text, email text, phone text, class_code text, rate int, checks_per_student int,
  billing_status text, verified boolean, is_public boolean, students int, unpaid int, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return query
  select t.id, p.code, t.slug, t.display_name, p.email, p.phone, t.class_code, t.rate_per_student, t.checks_per_student,
         t.billing_status, t.verified, t.is_public,
         (select count(*)::int from public.class_members cm where cm.teacher_id = t.id and cm.status = 'active'),
         (select coalesce(sum(i.amount_pkr), 0)::int from public.invoices i where i.teacher_id = t.id and i.status = 'unpaid'),
         p.status, t.created_at
  from public.teachers t join public.profiles p on p.id = t.id order by t.created_at desc;
end $$;
grant execute on function public.admin_teachers() to authenticated;

create or replace function public.set_my_teacher_photo(p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if split_part(p_path, '/', 1) <> auth.uid()::text then raise exception 'not your file'; end if;
  update public.teachers set photo_path = p_path where id = auth.uid();
end $$;
grant execute on function public.set_my_teacher_photo(text) to authenticated;
