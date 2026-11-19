-- Nexlyr for Students · starting data. Every row here can be edited later from the admin panel.

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Four plans. Prices are PKR and editable in Admin → Plans.
-- AI cost guide (Sonnet-class model, ~3k tokens in / 1.5k out per answer): roughly Rs 8–12 per check.
insert into public.plans (id, name, tagline, audience, price_pkr, price_note, period_days, checks_per_month,
                          max_marks_per_check, lectures, photo_answers, members_notes, features, sort) values
 ('free', 'Free', 'Try the examiner on short answers.', 'student', 0, 'forever', 30, 3, 10, false, false, false,
  array['3 AI checks a month', 'Questions up to 10 marks', 'Typed answers', 'Every public note from every teacher', 'Examiner-style report'], 1),
 ('student', 'Student', 'For steady weekly practice.', 'student', 999, 'per month', 30, 25, null, true, true, true,
  array['25 AI checks a month', 'Any question length, including essays', 'Photo answers (handwriting)', 'Recorded lectures', 'Members-only notes', 'Report history and progress'], 2),
 ('pro', 'Pro', 'For exam season and full papers.', 'student', 2499, 'per month', 30, 80, null, true, true, true,
  array['80 AI checks a month', 'Full-paper marking', 'Photo answers (handwriting)', 'Recorded lectures', 'Members-only notes', 'Priority checking'], 3),
 ('academy', 'Academy', 'For teachers and academies.', 'teacher', 500, 'per student / month', 30, 20, null, true, true, true,
  array['Your students get 20 AI checks each a month', 'Your notes published on your public page', 'Your recorded lectures, for your class only', 'Review and correct any AI mark', 'Class dashboard and progress', 'One monthly invoice'], 4)
on conflict (id) do nothing;

-- Cambridge O Level
insert into public.subjects (level, code, name, papers, sort) values
 ('O', '1123', 'English Language', array['Paper 1 · Reading', 'Paper 2 · Writing'], 1),
 ('O', '2010', 'Literature in English', array['Paper 1 · Poetry and Prose', 'Paper 2 · Drama'], 2),
 ('O', '4024', 'Mathematics D', array['Paper 1', 'Paper 2'], 3),
 ('O', '4037', 'Additional Mathematics', array['Paper 1', 'Paper 2'], 4),
 ('O', '4040', 'Statistics', array['Paper 1', 'Paper 2'], 5),
 ('O', '5054', 'Physics', array['Paper 1 · Multiple Choice', 'Paper 2 · Theory', 'Paper 4 · Alternative to Practical'], 6),
 ('O', '5070', 'Chemistry', array['Paper 1 · Multiple Choice', 'Paper 2 · Theory', 'Paper 4 · Alternative to Practical'], 7),
 ('O', '5090', 'Biology', array['Paper 1 · Multiple Choice', 'Paper 2 · Theory', 'Paper 4 · Alternative to Practical'], 8),
 ('O', '5129', 'Combined Science', array['Paper 1 · Multiple Choice', 'Paper 2 · Theory'], 9),
 ('O', '2210', 'Computer Science', array['Paper 1 · Theory', 'Paper 2 · Problem-solving and Programming'], 10),
 ('O', '7115', 'Business Studies', array['Paper 1 · Short Answer and Data Response', 'Paper 2 · Case Study'], 11),
 ('O', '7707', 'Accounting', array['Paper 1 · Multiple Choice', 'Paper 2 · Structured Written'], 12),
 ('O', '2281', 'Economics', array['Paper 1 · Multiple Choice', 'Paper 2 · Structured Questions'], 13),
 ('O', '7100', 'Commerce', array['Paper 1 · Multiple Choice', 'Paper 2 · Written'], 14),
 ('O', '2058', 'Islamiyat', array['Paper 1', 'Paper 2'], 15),
 ('O', '2059', 'Pakistan Studies', array['Paper 1 · History and Culture', 'Paper 2 · Environment of Pakistan'], 16),
 ('O', '3248', 'Second Language Urdu', array['Paper 1 · Composition', 'Paper 2 · Comprehension'], 17),
 ('O', '2217', 'Geography', array['Paper 1 · Theory', 'Paper 2 · Investigations'], 18),
 ('O', '2147', 'History', array['Paper 1', 'Paper 2'], 19),
 ('O', '2251', 'Sociology', array['Paper 1', 'Paper 2'], 20),
 ('O', '5014', 'Environmental Management', array['Paper 1', 'Paper 2'], 21),
 ('O', '2069', 'Global Perspectives', array['Component 1 · Written Exam'], 22),
 ('O', '3180', 'Arabic', array['Paper 1 · Composition', 'Paper 2 · Reading and Writing'], 23),
 ('O', '3015', 'French', array['Paper 1 · Listening', 'Paper 2 · Reading and Writing'], 24)
on conflict (level, code) do nothing;

-- Cambridge International AS & A Level
insert into public.subjects (level, code, name, papers, sort) values
 ('A', '9093', 'English Language', array['Paper 1 · Reading', 'Paper 2 · Writing', 'Paper 3 · Language Analysis', 'Paper 4 · Language Topics'], 1),
 ('A', '9695', 'Literature in English', array['Paper 1 · Drama and Poetry', 'Paper 2 · Prose and Unseen'], 2),
 ('A', '9709', 'Mathematics', array['Paper 1 · Pure 1', 'Paper 3 · Pure 3', 'Paper 4 · Mechanics', 'Paper 5 · Probability & Statistics 1'], 3),
 ('A', '9231', 'Further Mathematics', array['Paper 1 · Further Pure 1', 'Paper 2 · Further Pure 2', 'Paper 3 · Further Mechanics', 'Paper 4 · Further Probability & Statistics'], 4),
 ('A', '9702', 'Physics', array['Paper 2 · AS Structured', 'Paper 4 · A Level Structured', 'Paper 5 · Planning, Analysis and Evaluation'], 5),
 ('A', '9701', 'Chemistry', array['Paper 2 · AS Structured', 'Paper 4 · A Level Structured', 'Paper 5 · Planning, Analysis and Evaluation'], 6),
 ('A', '9700', 'Biology', array['Paper 2 · AS Structured', 'Paper 4 · A Level Structured', 'Paper 5 · Planning, Analysis and Evaluation'], 7),
 ('A', '9618', 'Computer Science', array['Paper 1 · Theory Fundamentals', 'Paper 2 · Problem-solving', 'Paper 3 · Advanced Theory', 'Paper 4 · Practical'], 8),
 ('A', '9626', 'Information Technology', array['Paper 1 · Theory', 'Paper 3 · Advanced Theory'], 9),
 ('A', '9609', 'Business', array['Paper 1 · Business Concepts 1', 'Paper 2 · Business Concepts 2', 'Paper 3 · Business Decision-making', 'Paper 4 · Business Strategy'], 10),
 ('A', '9706', 'Accounting', array['Paper 2 · Structured', 'Paper 3 · Structured'], 11),
 ('A', '9708', 'Economics', array['Paper 2 · AS Data Response and Essays', 'Paper 4 · A Level Data Response and Essays'], 12),
 ('A', '9990', 'Psychology', array['Paper 1 · Approaches, Issues and Debates', 'Paper 2 · Research Methods', 'Paper 3 · Specialist Options: Theory', 'Paper 4 · Specialist Options: Application'], 13),
 ('A', '9699', 'Sociology', array['Paper 1 · Socialisation, Identity and Methods', 'Paper 2 · The Family', 'Paper 3 · Education', 'Paper 4 · Globalisation, Media and Religion'], 14),
 ('A', '9696', 'Geography', array['Paper 1 · Core Physical', 'Paper 2 · Core Human', 'Paper 3 · Physical Options', 'Paper 4 · Human Options'], 15),
 ('A', '9489', 'History', array['Paper 1 · Document Question', 'Paper 2 · Outline Study', 'Paper 3 · Interpretations', 'Paper 4 · Depth Study'], 16),
 ('A', '9084', 'Law', array['Paper 1 · English Legal System', 'Paper 2 · Criminal Law', 'Paper 3 · Law of Contract', 'Paper 4 · Law of Tort'], 17),
 ('A', '9488', 'Islamic Studies', array['Paper 1', 'Paper 2', 'Paper 3'], 18),
 ('A', '9686', 'Urdu', array['Paper 2 · Reading and Writing', 'Paper 3 · Essay', 'Paper 4 · Texts'], 19),
 ('A', '9239', 'Global Perspectives & Research', array['Paper 1 · Written Exam'], 20),
 ('A', '9607', 'Media Studies', array['Paper 2 · Key Media Concepts', 'Paper 4 · Critical Perspectives'], 21),
 ('A', '9395', 'Travel and Tourism', array['Paper 1 · Core', 'Paper 2 · Planning and Managing a Travel and Tourism Event'], 22)
on conflict (level, code) do nothing;
