# TODO

## Not yet done

In priority order:

1. **Let the user type their answer on short-answer cards.** On recall and cloze cards
   there is nothing to do before revealing, so it is easy to think "yes, I knew that" without
   ever having produced the answer — which is the weakest form of practice. Give them a box
   to write in, with the prompt:

   > This is just a note. It will be shown next to the real answer the next time you see
   > this question.

   Store it per card and show it beside the real answer. Never scored or graded — it is the
   user's own note, and the honest self-check is the whole value.

2. **Tell the user when a new version is available, and reassure them about their progress.**
   The site now deploys on every push, and the service worker serves cached hashed assets,
   so someone with the app open — or installed as a PWA — can sit on a stale build without
   knowing. Detect a waiting service worker and offer a refresh.

   The reassurance is the point, not a nicety: this user is anxious, and "reload to update"
   reads as "lose your place". Progress lives in IndexedDB and survives a refresh entirely,
   so the prompt should say so plainly. Must not be a blocking modal — never interrupt
   mid-card.

3. **Confirm settings changes visually.** Settings save silently on change, so there is no
   feedback that anything happened. Add an unobtrusive saved indicator.

4. **When the exam date changes, offer the daily new-card number.** The Progress page
   already computes the required cards-per-day to finish in time. On changing the exam date,
   surface that as a prompt with a button that applies it, rather than making the user work
   out the arithmetic and find the right field.


## Done

Move from the not-yet-done category after completing.

1. **Prompt for the exam date on the home screen when it isn't set.** There is a tip in the
   home footer today, but it sits below everything and reads as optional. The exam date
   drives interval capping, the retention ramp and the pacing advice — with it unset, all
   three quietly do nothing — so it deserves a prompt above the "Study your cards" card,
   with a button through to Settings.

   **Done.** An amber prompt now sits directly above the "Study your cards" card whenever no
   date is set — "When is your exam?" with a "Set exam date" button through to Settings — and
   disappears once one exists. The old footer tip is gone, since it said the same thing
   somewhere nobody looks.

   Adding it pushed the fourth card past the fold on a phone (808px against a 780px
   viewport), which the visual check caught rather than a reviewer. The prompt is now one
   tight row on small screens with the description hidden and the button inline instead of
   full-width; the hero also lost a little. Back to 750px, and the fold assertion now names
   whether the prompt was showing so the harder case is the one being measured.

1. **Spell out the timing labels under the difficulty buttons.** "1m" is ambiguous — minute
   or month — and it appears under every rating on every card. Months currently render as
   "mo" and minutes as "m", which is a distinction no one should have to notice.

   **Done.** `formatInterval` now returns words — "10 minutes", "3 hours", "8 days",
   "2 months", "1.1 years" — and buttons read "in 8 days" rather than "8d".

   Two things fell out of it. It now always returns a *duration*, never a point in time: a
   friendlier "tomorrow" would have produced "in tomorrow" at every call site that prefixes
   it, so that phrasing belongs to the caller. And negative intervals — overdue cards in the
   browser — used to fall through to "under a minute"; they return "now", with Browse saying
   "ready to review now".

   The longer labels then broke the mobile layout, wrapping every button onto three or four
   lines and re-inflating the action bar the sticky-bar work had just trimmed. Grading is now
   two-up on phones instead of four, and the "(2)" shortcut hints are hidden there since
   there is no keyboard. Bar measures 155px on desktop and 189px on a 780px phone.

1. **Show practice test results on the Progress page, with a placeholder before the first
   one.** Right now a practice test score is the single most exam-like signal in the app and
   it is thrown away the moment you navigate off the results screen.

   Prerequisite, confirmed in the code: results are not persisted at all. `session` in
   `src/ui/ExamView.ts` is module-level state, cleared by `abandon()` and by "Try another
   test", and storage only holds `progress`, `settings`, `daily` and `reviewLog` — there is
   no exam key. So this needs a stored history first: date, length, score, time taken, and
   the per-topic breakdown.

   On the Progress page: most recent score, the trend across attempts once there are two or
   more, and per-topic performance — which is the interesting part, because it is measured
   under exam conditions rather than inferred from spaced-repetition state, and the two can
   disagree. Before the first attempt, a placeholder that explains what a practice test adds
   and links straight to it, rather than an empty panel.

   Worth deciding while building: whether the Progress headline should stay
   coverage-based or blend in practice-test performance once one exists.

   **Done.** Results are now persisted (`ExamResult` in `src/storage/progress.ts`, last 50,
   included in export/import so switching devices doesn't lose them). The panel shows the
   most recent score, the change in points since the previous attempt, a trend bar per
   attempt once there are two, and a per-topic breakdown of the latest test — bars turn teal
   at 70% and stay amber below.

   Before the first attempt there is a placeholder that argues for taking one ("it measures
   something the numbers above cannot: how you do under time pressure") with a button
   straight into it, rather than an empty box.

   The headline stays coverage-only, as proposed, with a test asserting a perfect practice
   score does not move it. The first end-to-end run made the case by accident: coverage read
   0 cards worked through while the test scored 40%. They measure different things, and
   collapsing them into one number would hide exactly the disagreement worth seeing.

1. Commit the dist so that we can set up GitHub Pages.

   **Done differently, and the difference matters.** `dist/` was not committed and should
   not be — the repo already carries a workflow that builds and deploys via
   `actions/deploy-pages`. The real blocker was that Pages had never been enabled, so every
   run failed at `actions/configure-pages` with "Get Pages site failed. Please verify that
   the repository has Pages enabled and configured to build using GitHub Actions." Enabling
   it with `build_type: workflow` fixed it; the next push deployed green.

   Also found: the base path still said `/nce-anki/` while the repo is `nce-study`. CI
   derives it from the repo name so deploys were unaffected, but a plain local
   `npm run build` produced a bundle with wrong asset paths. Defaults now match.

   Live at **https://ajryan.github.io/nce-study/** — verified in a browser, not just by
   status code: four cards with four buttons, and studying a real card off the bundled deck
   with no console errors.

1. **Only the action button on a home card should be clickable.** The whole card currently
   carries a click handler as a convenience, but that makes the card's own hover lift a
   promise about a region that shouldn't be a target. Confine the click to the button, and
   drop the card-level affordances (pointer cursor, hover lift) that imply otherwise.

   **Done.** The card-level `onclick` is gone, along with the `stopPropagation` the button
   needed to work around it. The pointer cursor and hover lift moved off the card and onto
   the button, so the only thing that looks pressable is the only thing that is. A test
   clicks the card, its title and its description and asserts nothing navigates, then clicks
   the button and asserts it does.

1. **Home cards don't look clickable, and the fourth falls below the fold.** The whole home
   screen is four `<button class="path">` elements styled as panels. They work, but nothing
   signals that — no affordance beyond a hover state, which is invisible on touch. For an
   anxious user the failure mode is being unsure how to start at all, and this is the front
   door: everything else is unreachable behind it.

   Make them plain cards with an explicit call-to-action button inside each, so the action
   is a button that looks like a button. Then make all four fit above the fold on ordinary
   laptop and phone viewports — exceptionally short windows excepted — which means the hero
   and the card padding both have to come down. Verify by measurement in the browser, not by
   eye.

   **Done.** Each path is now a `div.path` containing a real `button.cta` — "Start
   studying", "See my progress", "Start a practice test", "Browse the cards" — so the action
   looks like an action. The whole card stays clickable for convenience, but the button is
   what communicates it.

   To fit all four above the fold the hero lost a line and shrank, card padding came down,
   and the featured card went horizontal so it costs one row instead of two. On phones the
   descriptions are hidden and the featured card stacks. Measured rather than eyeballed:
   `npm run visual` now asserts the last card's bottom edge against the viewport at 1000x700,
   1440x800 and 390x780 — currently 507px, 507px and 693px. Two jsdom tests also require
   every card to carry a non-empty CTA button that navigates on its own click.

1. **Rating labels are not a parallel construction.** "Hard / Good / Easy" mixes a judgement
   of the question with a judgement of the answer, so the three do not answer one question.
   All three should complete "how difficult was this?" — e.g. Hard / OK / Easy, or
   "A struggle / Took a moment / Straight away". "Again" is a fourth case and genuinely
   different: it means *wrong*, not a difficulty. Keep it visually distinct rather than
   forcing it into the same scale.

   **Done.** The three difficulty options now all answer one question, asked explicitly
   above them ("How hard was that?"): **A struggle / Took a moment / Easy**. "Good" is gone
   — it judged the answer, not the difficulty, so it never belonged on the same scale.

   "Again" was kept off the scale, as suspected: it means the answer was *wrong*, not that
   it was hard. It reads "Didn't know it", sits in the warm not-quite orange rather than as
   a fourth rung, and appears only after a wrong answer — where the prompt drops the
   question entirely ("This one will come back around sooner"), since posing a question with
   one possible answer is silly. The keyboard hint follows suit: `2`–`4` when rating a
   correct answer, `1` alone when there is only one option.

1. **Exam-date changes don't reschedule cards that were already rated.** Confirmed in the
   code, not assumed: `capDueDate` is only applied inside `review()` and `previewIntervals()`
   in `src/scheduler/fsrs.ts`, both at rating time. `AppState.rebuildQueue` re-filters by
   stored due date but never re-caps it, and `ProgressRepository.updateSettings` writes the
   setting without touching progress.

   So a card rated before the exam date was set — or before it was moved earlier — keeps a
   due date that can fall *after* the exam. That silently defeats the headline promise of
   "Make sure everything comes up before exam day", and it fails in the least visible
   direction: the cards that drop out are the well-known ones with the longest intervals.

   Fix: re-cap every stored due date when the exam date changes (and when the capping
   setting is toggled on). Needs a test that sets a far-future exam, matures a card past it,
   then moves the exam earlier and asserts the card is pulled back inside the window.

   **Done.** `reapplyExamDate` in `src/scheduler/fsrs.ts` recomputes every stored due date,
   and `AppState.updateSettings` is now the only route for changing settings so no caller
   can forget to trigger it. Settings confirms with "Moved N cards so they come up before
   your exam."

   The subtlety worth keeping: `CardProgress` now also stores `naturalDue`, the date FSRS
   chose before capping. Recomputing from that rather than from the current `due` is what
   makes the change reversible — capping an already-capped value would ratchet intervals
   permanently shorter with every edit, and moving the exam later could never restore them.
   Six tests cover both directions, repeated edits, capping switched off, new cards, and
   backfilling `naturalDue` for progress saved before it existed.

1. **Rework the "My Progress" page.** It is the weakest screen in the app and currently
   works against the design direction — for someone anxious about this exam it leads with
   "0% feeling solid" and "498 not started yet".

   Raised directly:

   - The six stat cards all carry the same visual weight but mix percentages and counts
     (0% / 498 / 14 / 0 / 29% / 29%). No hierarchy, and no reason why "Feeling solid" is a
     percentage while "Still learning" and "Sticking well" are counts.
   - "Sticking" means nothing to the user: it is not one of the choices on the rating UI
     (Again / Hard / Good / Easy), so the vocabulary doesn't connect to anything they do.
   - The per-topic progress bars look like a duplicate of the "Share of exam" column. They
     should instead break down whatever percentage the headline stat card reports.
   - Two near-identical tables (by exam topic, by subject area) — probably one table behind
     a tabbed switcher.

   Also found while looking at it:

   - "Feeling solid" is computed as stability ≥ a 21-day horizon, which nothing can reach
     in early sessions. So it reads 0% after a genuinely good run of 14 cards. A headline
     number that cannot move on day one is worse than no headline number.
   - "Not started yet: 498" is the largest figure on the page and the most discouraging.
   - "Recent answers right" and "All-time answers right" are the same number until well
     into a deck, so one of them is noise.
   - The 14-day forecast is one bar and thirteen empty slots.

   Direction: one clear headline that moves from the first card, secondary stats visibly
   subordinate to it, progress states named in the same vocabulary as the rating buttons,
   per-topic bars that decompose the headline (stacked: solid / learning / not started),
   and the two tables merged behind tabs.

   **Done.** Headline is now a single count — "14 cards worked through — that's 3% of the
   deck" — because with 512 cards a percentage still rounds to 0% after the first two
   answers, which was the original complaint. Secondary stats are visibly smaller. The three
   states are Solid / Still learning / Not started, where "Solid" means the card graduated
   out of learning by being rated well enough, so it describes something the user did.
   "Sticking" and "feeling solid" are gone, with a test asserting neither returns. Every bar
   — headline and per-row — is the same stacked breakdown of those three states, so a row
   decomposes the headline instead of echoing the share-of-exam column. The two tables are
   one table behind a By exam topic / By subject area switcher. The duplicate accuracy stat
   is gone and the forecast is hidden until it has something to show.

1. The hard/good/easy/suspend UX is usually "below the fold" and requires scrolling up and down after answering each question. References can be hidden behind some expansion UX. As for the answer details and difficulty rating, let's see if we can ensure the difficulty rating UX is always above the fold. It's OK for the answer details to require some scrolling to read all of it.

   The rating controls now live in a sticky action bar (`.actionbar`) that is a sibling of
   the card rather than inside it, pinned to the bottom of the viewport with
   `position: sticky; bottom: 0`. However long the explanation runs, Again/Hard/Good/Easy and
   "Hide this card" stay on screen — no scrolling back down to rate. The reveal button for
   recall and cloze cards sits there too, so the primary action is always in the same place.

   References are folded into a `<details>` expander labelled "Where this comes from
   (N sources)", collapsed by default. The explanation is capped at `40vh` with its own
   scroll, so a long one can be read without pushing everything else off screen.

   Three tests in `tests/ui.test.ts` lock the structure in: the grading element must be
   inside `.actionbar` and *not* inside `.card`, the bar must follow the card in document
   order, and references must be a closed `<details>` that still contains its links.

2. **Remove the answer-length tell from the multiple-choice cards.** Correct answers were
   systematically the longest, most-qualified option — measured at 94.1% (chance is 25%), so
   someone who always picked the longest option would have scored 94% without knowing any
   counseling. That makes the deck actively misleading as practice.

   All 404 multiple-choice cards rebalanced. Now 31.9% strictly longest, mean length ratio
   1.025 (correct 55.0 chars vs distractors 53.6), and always-pick-longest scores 35.8%.
   `scripts/answer-bias.ts` measures it and gates `npm run check`;
   `scripts/apply-choice-texts.ts` rewrites option text in place by card id, leaving
   rationales and citations untouched.

   Note on the measure: ties for longest are excluded, since two equal-length options give a
   guesser no signal. The headline number is the expected score for always guessing longest,
   which is what actually matters.

3. The user has some anxiety about this test. Change the color theme to be more bright and cheerful. Only ship a light theme. No need for a dark theme and no need to respect system light/dark preferences.

   Removed the dark theme and all `prefers-color-scheme` handling. New warm palette in
   `src/styles/app.css`: cream background with soft sunrise gradients, teal primary, amber
   accents. "Wrong" is now a warm orange rather than an alarm red, so a missed card reads
   as information instead of failure. Recorded in `CLAUDE.md` under "Design direction" so
   it doesn't get reintroduced.

4. On the same token as 1, change the interface to be more hand-holding and friendly. For example, the top navigation "Study," "Readiness," "Browse," etc feels to "programmery." The user needs to be led through the application in a more guided way. When the page first loads, offer a more "Choose your path" experience. After the user completes a chunk of cards, guide them to select whether to view their readiness, etc.

   The app now opens on a "choose your path" home screen (`src/ui/HomeView.ts`) with a
   time-of-day greeting, one featured next action, and plain-language alternatives.
   Navigation renamed from system nouns to human labels — "Start", "Study Cards",
   "My Progress", "Practice Test", "All Cards". Study sessions are broken into chunks of
   10 (`CHECKPOINT_EVERY` in `src/app.ts`): after each chunk the app pauses on a checkpoint
   reporting how it went and asking what to do next — keep going / see progress / take a
   break — and in-session progress reads "Card 3 of 10" rather than "3 of 187". Finishing
   the queue lands on a warm completion screen with onward options rather than a dead end.
   Dashboard headings rewritten in plain language ("How you're doing", "Your progress by
   exam topic").

5. Plain-language pass over every screen — the copy was too technical.

   Settings was the worst offender and was rewritten wholesale: "Target retention" became
   "How well do you want to remember things?", "Interleave domains within a session" became
   "Mix up the topics while you study", "Storage in use: IndexedDB (persistent)" became
   "✅ Your progress is being saved on this device", and Export/Import became "Save a copy" /
   "Load a saved copy". The same pass covered the practice test ("A timed mock built to the
   live blueprint: 160 scored-equivalent items drawn in domain proportion" → "A timed
   practice run that works like the real thing"), the card browser, and the dashboard tables
   ("Domain" → "Topic", "Mastered" → "Sticking", "Exam wt." → "Share of exam").

   "Suspend" was replaced everywhere with "Hide this card" / "Show this card again", and the
   keyboard shortcut moved to `h` (with `s` still accepted). Raw blueprint codes like
   "D1 · 1F" no longer appear on cards — the topic and task are shown in words.

   A regex guard in `tests/ui.test.ts` now fails the build if the Settings screen renders
   any of: retention, interval, IndexedDB, localStorage, FSRS, domain, scheduling, JSON,
   serialize. Copy drifts technical again on the next edit; a comment doesn't stop that.
