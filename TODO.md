# TODO

## Not yet done

In priority order:

_(nothing outstanding)_

## Done

Move from the not-yet-done category after completing.

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
