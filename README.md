# Nexlyr for Students · Admin, teacher panel and backend

Two things live in this repo:

1. **The panel** (`index.html` + `assets/`) for `admin.students.nexlyr.solutions`. Admins and teachers sign in to the same page; each sees their own menu.
2. **The whole backend** (`supabase/`): database tables, security rules, storage buckets and the four server functions. The student site (`NEXLYR-FOR-STUDENTS`) talks to the same Supabase project.

Static files, no build step. With no Supabase keys in `assets/js/config.js` the panel runs in **preview mode** with sample data. On the sign-in page, pick Admin or Teacher to look around.

---

## How it works

| Flow | What happens |
|---|---|
| Student signs up | `register` function creates the login immediately (Free plan works straight away). A class code puts them in a teacher's class. A paid plan sends the slip with the form. |
| Payment slip | Lands in **Payment slips** (bell + count in the menu). The slip opens in the panel. **Approve** starts or extends the plan and notifies the student. **Reject** asks for a reason the student sees. |
| Teacher joins | They apply on `/join?as=teacher`. **Approve** creates their login, a 6-letter class code and a public page, then shows a message to send on WhatsApp. You can also **Add a teacher** directly. |
| Teacher billing | On the 1st, **Teacher billing → Create invoices** bills last month: students in each class during that month × the teacher's rate (Rs 500 by default). Teachers pay with a slip from their panel. You approve it like any other slip. |
| AI checking | `ai-check` reserves the check and counts the quota in one locked step. Short typed answers (≤ 6 marks) go to the light model; essays and photos go to Sonnet. The report comes back in the Cambridge examiner-report format. Teacher corrections are fed back as calibration for that subject. |
| Cost control | A monthly AI budget pauses the checker by itself. **AI settings** has a pause switch with the message students see. Failed checks never count. |
| Lectures | Unlisted YouTube links. The ID never reaches the browser as a link: `get_lecture()` checks the plan or class first. The player hides YouTube's own controls and shows the student ID moving across the video. |
| Notes | Public notes are in the public `notes` bucket. Members-only notes are in the private `members-notes` bucket and open only for paid plans or the teacher's own class. |

### Plans (editable in **Plans**)

| | Free | Student | Pro | Academy |
|---|---|---|---|---|
| Price | Rs 0 | Rs 999 / month | Rs 2,499 / month | Rs 500 per student / month (teacher pays) |
| AI checks a month | 3 | 25 | 80 | 20 per student |
| Longest question | 10 marks | any | any | any |
| Photo answers, lectures, members' notes | — | ✓ | ✓ | ✓ (their teacher's) |

Rough AI cost per check, using a Sonnet-class model at about 3k tokens in and 1.5k out: **Rs 8–12**. The light model costs much less. So Student costs about Rs 250 of AI at full use, Pro about Rs 800, and an Academy student about Rs 200. Enter the real per-token prices from Anthropic's pricing page in **AI settings** so the cost figures are exact.

---

## Setting it up (once)

1. **Create the Supabase project** in the new account. Note the project URL and the **publishable** key (Settings → API).
2. **Run the database files**: in the SQL editor, run these in order:
   `supabase/migrations/20261120000001_core.sql` → `…02_security.sql` → `…03_seed.sql`
   Or, with the Supabase CLI linked to the project, run `supabase db push`.
3. **Auth settings** (Authentication → URL configuration):
   Site URL `https://students.nexlyr.solutions`. Add the redirect URL `https://students.nexlyr.solutions/portal`.
4. **Deploy the functions** (CLI, from this repo):
   ```
   supabase functions deploy register payment admin ai-check
   ```
   `supabase/config.toml` already turns off the gateway JWT check: every function checks the caller itself.
5. **Secrets**:
   ```
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-…            # leave out until you're ready: checks return labelled preview reports
   supabase secrets set ALLOWED_ORIGINS=https://students.nexlyr.solutions,https://admin.students.nexlyr.solutions
   supabase secrets set IP_SALT=<any long random text>
   ```
6. **Keys in both sites**: paste the URL and publishable key into `assets/js/config.js` here and in `NEXLYR-FOR-STUDENTS`.
7. **Make yourself admin**: sign up on the student site with `nexlyr.solutions@gmail.com`, then run this in the SQL editor:
   ```sql
   select public.set_role(id, 'admin') from auth.users where email = 'nexlyr.solutions@gmail.com';
   ```
   After that, add other admins from **Settings → Admins**.
8. **Payment accounts**: Settings → Payment accounts. Until you add them, students see "Account details coming soon" and a WhatsApp button.
9. **Vercel**: one project per repo. `NEXLYR-FOR-STUDENTS` → `students.nexlyr.solutions`, this repo → `admin.students.nexlyr.solutions`.

---

## Files

```
index.html                 the panel (sign-in + shell)
assets/css/                tokens.css · base.css (shared with the student site) · report.css · admin.css
assets/js/config.js        Supabase URL + publishable key
assets/js/admin-core.js    helpers, modal, preview data
assets/js/admin-views.js   admin pages: overview, slips, students, teachers, billing, checks, notes, lectures, plans, subjects, AI, settings
assets/js/teacher-views.js teacher pages: my class, students, reports to review, notes, lectures, billing, public page
assets/js/admin-app.js     sign-in, menu, router, notification bell
assets/js/report.js        examiner report renderer (same file as the student site)
supabase/migrations/       001 tables · 002 security, storage and every RPC · 003 plans, subjects, settings
supabase/functions/        register · payment · admin · ai-check (+ _shared/util.ts)
```

## Security notes
- The browser only ever has the publishable key. Row-level security is on for every table.
- Logins, money and AI results are only written by the functions, using the service role, or by `SECURITY DEFINER` functions that check the caller.
- Students can't change their own role or plan. `profiles` has no update policy for them; they use `update_my_profile()`, which only touches name, phone, country, level and school.
- Slips are in a private bucket that only admins can read. Answer photos can be read by the student, their teacher and admins.
- The Anthropic key is only a function secret. It is never in the database, this panel or the student site.
- The student's answer goes to the model marked as data, with an instruction to ignore anything inside it that asks for marks.

Designed and built by Nexlyr Solutions.
