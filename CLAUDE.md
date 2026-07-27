# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-first spaced-repetition study app for the **National Counselor Examination (NCE)**.
No backend, no accounts, no network calls at runtime — all 512 cards are bundled into the
JS payload and all progress stays in the browser.

## Working agreement

**Read `TODO.md` at the start of a session, and keep working it.** It carries the user's
pending product direction in priority order.

- **At every stopping point, continue with the next TODO item in priority order.** Do not
  stop and ask what to do next while items remain — finish, report, and carry on.
- **When the user gives a new TODO, write it into `TODO.md` yourself and place it in the
  order you judge best.** Say where you put it and why. Correctness bugs outrank polish;
  things seen on every card outrank things seen once in Settings.
- **Move an item from `## Not yet done` to `## Done` when it is finished**, keeping the
  user's original wording and appending what was actually done.
- **Commit *and push* after every completed item.** The site is live at
  https://ajryan.github.io/nce-study/ and deploys from `main` on push, so an unpushed commit
  is work the user cannot see. Check the run went green (`gh run list`) before reporting
  done.
- Verify claims about behaviour against the code before writing them into a TODO — several
  items here were sharpened by checking rather than assuming.

## Design direction — non-negotiable

**The person using this is anxious about the exam.** That single fact drives the interface,
and it outranks engineering taste. Two standing constraints follow:

- **Light theme only, bright and cheerful.** Do not add a dark theme, a theme toggle, or
  `prefers-color-scheme` handling. This was asked for explicitly and reversed an earlier
  theme-aware implementation.
- **Guided, warm, and plain-spoken — never "programmery."** The app opens on a
  "choose your path" home screen rather than dropping the user into a queue. Navigation uses
  human labels ("Study Cards", "My Progress"), not system nouns ("Dashboard", "Browse").
  After each chunk of cards the app pauses and offers a next step instead of silently
  continuing.

Practical consequences when writing UI: frame wrong answers as learning rather than failure
(note `--wrong` is a warm orange, not an alarm red), and never leave the user at a dead end
without an obvious next action.

**Warmth comes from specifics, never from telling the user how to feel.** This was reversed
after the copy was read back and found to be full of the constructions people recognise as
machine-written. "The 3 you missed come back sooner than the rest" is reassuring and cannot
be smug, because it is a fact. "A snapshot, not a verdict" is reassurance by assertion, and
it planted the anxiety it claimed to soothe — nobody was thinking *verdict* until the app
said it. Report the number, say what happens to those cards next, and stop.

`tests/copy.test.ts` fails the build on the specific tells, scanning source strings rather
than rendered output so that states no test renders are covered too:

- the negation pivot — `X, not Y` / `not just` / `it's not`. The most-recognised tell of all,
  and "not a verdict" had been used twice as the same stock foil.
- **any em dash in prose.** The bolted-on afterthought clause is the punctuation tic. There
  were 27; a full stop or a colon says the same thing.
- claims the app cannot support — "you clearly know this material" off ten cards, addressed
  to someone whose entire worry is whether they know the material.
- self-congratulation — "this is the system working", said to a user who just did badly.
- emotional instruction — "and remember,", "there's no wrong answer here", "don't worry".
- tacked-on praise — "You've started every card at least once. **Nice.**"

Verify a new rule actually fires before trusting it: reintroduce the offending string and
watch the test fail. Guards that pass for the wrong reason have bitten this repo twice.

## Commands

```bash
npm run dev            # dev server (http://localhost:5173/nce-study/)
npm run build          # Pages build → dist/
npm run build:single   # portable single file → dist-single/nce-study.html
npm test               # all tests
npm run validate       # deck schema + citation integrity (no network)
npm run coverage       # domain and CACREP balance + blueprint task coverage
npm run check          # validate + coverage + bias + test — run this before declaring done
npm run visual         # builds, then drives a real Chromium: layout, routing, settings
npm run check:update   # builds, then exercises the whole service-worker update flow
npx tsc --noEmit       # typecheck (strict, noUncheckedIndexedAccess)
npx tsx scripts/check-links.ts   # link-check all references — NEEDS NETWORK, not in `check`
```

`visual` and `check:update` both build first, on purpose: they serve `dist/`, and for a
while `visual` did not build, so it silently checked whatever was last built — a routing
change reported six failures against a bundle that had no routing in it.

**Anything involving the browser's own machinery has to be checked in a browser.** jsdom
implements no `<dialog>` (not `showModal`, not `close`), service worker update states do not
exist there at all, and it cannot tell you whether an element that is in the DOM is actually
*visible*. Three shipped-looking bugs got through unit tests this way.

Single test file or single case:

```bash
npx vitest run tests/fsrs.test.ts
npx vitest run -t "caps the interval at the exam date"
npx vitest              # watch mode
```

Tests default to the `node` environment. `tests/ui.test.ts` opts into jsdom via a
`@vitest-environment jsdom` docblock — keep that if you add DOM tests.

## Architecture

### The two-axis coverage model — the central design decision

The six NBCC domains (D1–D6) are **work behaviours, not subject areas**. The exam is
*separately* aligned to the eight CACREP core areas, and foundational subject matter
(career theory, human development, group work, research/stats) does not map onto the six
domains — it is spread across D3 and D5.

So **every card is tagged on both axes** (`domain` + `cacrep[]`), and `npm run coverage`
enforces both. This is not theoretical: the first complete draft passed the domain axis at
±0.0% while Career Development sat at 2.0%, below the floor. Never "simplify" this to a
single axis.

`scripts/coverage-report.ts` only enforces thresholds once the deck is ≥90% of target size,
so a work-in-progress deck doesn't fail CI.

### Content pipeline

```
content/blueprint.json   → domain weights, item counts, and the full task list
content/references.json  → 64 vetted sources; cards cite by id, never inline URLs
content/decks/*.json     → the cards themselves
```

Cards cite references **by id** so a citation is written and corrected in exactly one
place, and the validator can prove every `refs` entry resolves.

There are **two loaders** for the same content, and they must stay in sync:

- `src/data/loader.ts` — browser. Uses `import.meta.glob(..., { eager: true })` so deck
  JSON lands in the bundle rather than being fetched. This is what makes the single-file
  build work offline.
- `scripts/lib/content.ts` — Node. Reads the same files from disk, because `import.meta.glob`
  doesn't exist under plain `tsx`.

Multiple deck files may declare the same `domain` (D3 and D5 are split across several files
for size). `validate` flags a card whose `domain` disagrees with its file's declared domain,
since that would silently skew the blueprint weighting.

### Card invariants enforced by `src/data/schema.ts`

The validator is the only thing between a typo and a study session that teaches something
wrong. It reports every problem at once rather than throwing on the first. It rejects:

- a `task` code that isn't in the blueprint. Format is **domain number + letter** — `"1F"`,
  `"3AJ"` — while `blueprint.json` keys tasks by letter alone.
- any MCQ/scenario without exactly `blueprint.exam.optionsPerItem` choices (currently 4),
  or without exactly one `correct: true`
- **any choice missing a `rationale`** — every distractor must explain itself, since knowing
  why the wrong answers are wrong is most of the learning
- a dangling `refs` id, a missing `cacrep` tag, a `cloze` prompt without a `{{deletion}}`,
  duplicate card ids, or duplicate choice text

### Scheduling (`src/scheduler/`)

`ts-fsrs` (FSRS-6) owns the memory model. This layer owns everything around it:

- **`fsrs.ts`** — serialization, MCQ→rating derivation (a wrong answer is always `Again`;
  a right one defaults to `Good`), and `safeNow()`, which clamps `now` forward to
  `last_review`. Without that guard, a backwards clock jump (DST, timezone change, NTP
  correction) makes FSRS throw on a negative elapsed time and the answer is lost mid-session.
- **`examDate.ts`** — the two adjustments plain FSRS lacks for a *dated* exam: interval
  capping (nothing schedules past the exam) and a retention ramp over the final 60 days.
  The ramp only ever raises retention — a user who sets retention above `MAX_RETENTION`
  keeps their setting.
- **`queue.ts`** — interleaves domains by default (evidence favours mixing over blocked
  practice) and introduces new cards in blueprint-deficit order, so the studied deck drifts
  toward the exam's own distribution.

### Storage (`src/storage/`)

Three-tier fallback, probed at startup with a real write round-trip:
**IndexedDB → localStorage → in-memory**.

This exists because the single-file build is opened from `file://`, where Safari blocks
IndexedDB outright and Chrome needs a launch flag. When the app lands on the memory tier it
surfaces a banner and pushes an export — it must never silently lose progress. `isDurable()`
drives that.

State is stored as a few coarse blobs (whole progress map, settings, daily counts, review
log) rather than a row per card. Use `__setStore()` to inject a `MemoryStore` in tests.

### UI (`src/ui/`)

Hand-rolled view layer, no framework. `src/ui/dom.ts` is the whole thing: an `el()` factory
that escapes by construction (text goes through `textContent`; `html:` is only ever used
with strings the module builds itself). Views are plain `render*(app, root)` functions that
clear and rebuild; `AppState.onChange` triggers a re-render.

**Every view starts by clearing the element it is handed**, which has one sharp consequence:
nothing put into `<main>` before the view's own render survives. Banners therefore live in
their own `.banners` container between the header and `<main>`. This was not theoretical —
the update prompt *and* the "Progress will not be saved" warning were both being appended to
`<main>` and wiped microseconds later, so the storage warning had never once appeared on the
`file://` origins where losing progress is a real risk.

Navigation goes through the URL, not around it (`src/router.ts`): `go()` only sets the hash,
and a `hashchange` listener calls `applyView()`, which owns the per-view cleanup. A tab
click, a card button, the Back button and a pasted URL all take that one path — routing
cleanup through `go()` alone would skip it on every history navigation. Hashes rather than
paths because Pages has no rewrite rules and the single-file build runs from `file://`.

State that must survive a re-render (a "Saved" confirmation, a pending prompt) has to be
module-level. A change re-renders the whole view, so anything held in the render closure is
destroyed by the very act that created it. Each such module has a `reset*View()` test seam.

### Build targets (`vite.config.ts`)

One codebase, two outputs, keyed off `mode === 'single'`:

- default → `dist/`, base path `/nce-study/` (override with `PAGES_BASE`; CI derives it from
  the repo name), service worker. Live at https://ajryan.github.io/nce-study/ — Pages is set
  to build from GitHub Actions, so **`dist/` is never committed**; the workflow builds and
  deploys it.
- `--mode single` → `dist-single/nce-study.html`, base `./`, everything inlined, manifest
  link stripped, SW never registered (`__SINGLE_FILE__` guard in `main.ts`)

The ~700 KB bundle is intentional — the whole deck is inlined so there is nothing to fetch.

## Content conventions

Cards are **original**, written against the public blueprint. Live NCE items are secure and
commercial question banks are copyrighted — do not reproduce either. Cite DSM-5-TR by
disorder name and code only, never criterion text.

When adding a reference, run `check-links.ts` **and confirm the page is actually the article
you claim**. A valid-but-wrong NCBI Bookshelf id returns HTTP 200: an earlier draft had six
StatPearls citations resolving to unrelated articles (suicide risk → "Frontalis Muscle") that
a status-code check passed cleanly.

`validate` proves a citation *resolves*; it cannot prove a citation *supports* the answer.
That remains a human review step.

### Exam-version awareness

The deck targets the **current NCE** (through 2027-06-30): 200 items, 160 scored, 4 options,
225 min testing. NBCC replaces it on **2027-07-01** with a 170-item, 3-option form, scaled
100–500 scoring, and six renamed domains adding AI ethics, the Counseling Compact, EHR, and
billing. `blueprint.json` carries the successor spec, and cards have an optional
`blueprint2027` tag — switching targets is a re-tagging job, not a rewrite.

Separately, the **ACA Code of Ethics is under revision** (2014 code still in force; adoption
of a revision expected September 2026). Ethics references carry a `codeVersion` field so
those cards can be re-audited.
