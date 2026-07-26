# TODO

## Not yet done

In priority order:

_(nothing outstanding)_

## Done

Move from the not-yet-done category after completing.

1. The user has some anxiety about this test. Change the color theme to be more bright and cheerful. Only ship a light theme. No need for a dark theme and no need to respect system light/dark preferences.

   Removed the dark theme and all `prefers-color-scheme` handling. New warm palette in
   `src/styles/app.css`: cream background with soft sunrise gradients, teal primary, amber
   accents. "Wrong" is now a warm orange rather than an alarm red, so a missed card reads
   as information instead of failure. Recorded in `CLAUDE.md` under "Design direction" so
   it doesn't get reintroduced.

2. On the same token as 1, change the interface to be more hand-holding and friendly. For example, the top navigation "Study," "Readiness," "Browse," etc feels to "programmery." The user needs to be led through the application in a more guided way. When the page first loads, offer a more "Choose your path" experience. After the user completes a chunk of cards, guide them to select whether to view their readiness, etc.

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
