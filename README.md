# NCE Study — local-first spaced repetition

A study app for the **National Counselor Examination (NCE)**, built around spaced
repetition. No backend, no accounts, no telemetry — everything runs in your browser
and all progress stays on your device.

512 original cards, weighted to the official NBCC blueprint, every answer carrying
links to a public source you can check.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

### Two ways to use it

| | GitHub Pages build | Single-file build |
|---|---|---|
| Command | `npm run build` → `dist/` | `npm run build:single` → `dist-single/nce-study.html` |
| Distribution | Push to `main`; the workflow deploys it | One 700 KB HTML file — email it, drop it on a USB stick |
| Offline | Yes, installable PWA with service worker | Yes, nothing to fetch at all |
| **Saves progress** | **Yes** | **Usually not — see below** |

> **Which one to use:** the hosted build. The single-file version is the *portable*
> artifact, not the *stateful* one.
>
> Browsers restrict storage on `file://` origins — Safari blocks IndexedDB outright,
> Chrome needs a launch flag. The app probes three tiers at startup
> (**IndexedDB → localStorage → in-memory**) and tells you which one it got. If it
> lands on memory-only, a banner appears and you should export your progress before
> closing the tab. Serving the single file over any local HTTP server restores
> normal persistence.

Progress moves between the two builds through **Settings → Export / Import** (plain
versioned JSON).

---

## What's in the deck

Targeting the **current NCE**, in effect through **2027-06-30**: 200 items, 160
scored, 4 options each, 225 minutes of testing time with a scheduled 15-minute
break after question 100 (255 minutes total session).

| Domain | Exam weight | Cards |
|---|---|---|
| D1 Professional Practice and Ethics | 12% | 60 |
| D2 Intake, Assessment, and Diagnosis | 12% | 60 |
| D3 Areas of Clinical Focus | 29% | 153 |
| D4 Treatment Planning | 9% | 45 |
| D5 Counseling Skills and Interventions | 30% | 154 |
| D6 Core Counseling Attributes | 8% | 40 |

Every one of the **173 blueprint tasks** in the official content outline has at
least one card. Card types are mixed deliberately: exam-style MCQs, applied
"what do you do first?" scenarios, and atomic recall/cloze for the memorization
layer.

### Why cards are tagged twice

The six NBCC domains are **work behaviours, not subject areas**. The exam is
*separately* aligned to the eight CACREP core areas, and the foundational material
you actually have to memorize — Super and Holland on career, Erikson and Piaget on
development, Tuckman and Yalom on groups, reliability and validity — doesn't map
onto the six domains. It hides inside D3 and D5.

So every card carries a domain tag **and** a CACREP tag, and `npm run coverage`
enforces both. This is not theoretical: the first complete draft passed the domain
axis at ±0.0% while Career Development sat at 2.0%, below the floor. The second
axis is what caught it.

---

## How the scheduling works

[FSRS](https://github.com/open-spaced-repetition/ts-fsrs) (v6 via `ts-fsrs`), which
needs roughly 20–30% fewer reviews than SM-2 for the same retention and has been
Anki's default since 23.10.

Two additions for a **dated** exam, since plain FSRS optimizes for an indefinite
horizon:

- **Interval capping** — nothing is scheduled past your exam date. A card that would
  come due afterwards is pulled back to the day before instead.
- **Retention ramp** — inside the last 60 days, target retention rises toward 95%,
  so material is fresher on the day.

Both are switchable in Settings. Sessions **interleave domains** by default: the
evidence on exam preparation favours mixing topics over studying them in blocks,
even though blocked practice feels smoother.

Keyboard-first review: `1`–`4` answer, `space` reveals, `s` suspends.

## How it feels to use

The app opens on a **"choose your path" home screen**, not a queue — one featured next
action plus calm alternatives. Study runs in **chunks of 10 cards**; after each chunk it
pauses, tells you how the chunk went, and asks what you'd like to do (keep going, check
your progress, or stop). Progress reads "Card 3 of 10" rather than "3 of 187", and a
missed card is framed as a useful catch rather than a failure.

Light theme only, deliberately — bright and warm rather than clinical.

---

## Commands

```bash
npm run dev            # dev server
npm run build          # Pages build → dist/
npm run build:single   # portable file → dist-single/nce-study.html
npm test               # scheduler, queue, storage, backup tests
npm run validate       # schema + citation integrity across all decks
npm run coverage       # domain and CACREP balance, task coverage
npm run check          # validate + coverage + test
npx tsx scripts/check-links.ts   # link-check all 64 references (needs network)
```

`npm run validate` fails on a dangling citation, a missing CACREP tag, an MCQ with
the wrong number of options or without exactly one correct answer, and any choice
missing a rationale — every distractor has to explain itself.

---

## Layout

```
content/
  blueprint.json     # transcribed from the NBCC content outline
  references.json    # 64 vetted, link-checked sources; cards cite by id
  decks/*.json       # 512 cards, one file per domain (large ones split)
src/
  scheduler/         # FSRS wrapper, interleaved queue, exam-date logic
  storage/           # 3-tier fallback, export/import
  data/              # card schema + runtime validator
  ui/                # Review, Dashboard, Browse, Exam, Settings
scripts/             # validate, coverage, link-check
```

---

## About the content

Cards are **original**, written against the public blueprint. Live NCE items are
secure and commercial question banks are copyrighted — none of that is reproduced
here. DSM-5-TR is cited by disorder name and code only, never by criterion text.

Two things worth knowing:

- **The ACA Code of Ethics is under revision.** The 2014 code remains in force;
  board adoption of a revised code is expected September 2026. Ethics references
  carry a `codeVersion` field so those cards can be re-audited rather than rebuilt.
- **NBCC replaces the NCE on 2027-07-01** — 170 items, only *three* options each,
  scaled 100–500 scoring with a 360 pass point, and six renamed domains adding AI
  ethics, the Counseling Compact, EHR, and billing. Cards carry an optional
  `blueprint2027` tag. **If you test on or after that date, this deck targets the
  wrong blueprint.**

Accuracy is a human review step, not an automated one. `validate` proves every
citation *resolves*; it cannot prove a citation *supports* the answer. Spot-check
against the linked sources, and correct anything that looks wrong — a card edited
in `content/decks/` flows straight through the validator.

Study aid only. Not affiliated with or endorsed by NBCC.

## Sources

- [NBCC — National Counselor Examination](https://nbcc.org/exams/nce)
- [NCE Content Outline (PDF)](https://nbcc.org/assets/exam/nce_content_outline.pdf) — the blueprint of record
- [2027 Exam Specifications (PDF)](https://nbcc.org/assets/exam/NCE_exam_spec_2027.pdf)
- [ACA Code of Ethics](https://www.counseling.org/resources/ethics)
