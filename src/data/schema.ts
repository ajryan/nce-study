/**
 * Deck content types and a dependency-free runtime validator.
 *
 * Cards are hand-authored JSON, so the validator is the only thing standing
 * between a typo and a study session that teaches something wrong. It is
 * deliberately strict and reports every problem at once rather than throwing
 * on the first.
 */

export type CardType = 'mcq' | 'scenario' | 'recall' | 'cloze';

export type DomainId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6';

export type CacrepArea =
  | 'professional-ethics'
  | 'social-cultural'
  | 'human-growth'
  | 'career'
  | 'helping-relationships'
  | 'group-work'
  | 'assessment'
  | 'research';

export interface Choice {
  text: string;
  correct: boolean;
  /** Shown after answering — for wrong options this is the teaching moment. */
  rationale: string;
}

export interface Card {
  id: string;
  type: CardType;
  domain: DomainId;
  /** Task letter from Content Outline Table 2, e.g. "1F", "3AJ". */
  task: string;
  cacrep: CacrepArea[];
  tags: string[];
  /** Question stem (mcq/scenario) or the front of the card (recall/cloze). */
  prompt: string;
  /** mcq/scenario only. Exactly one `correct: true`. */
  choices?: Choice[];
  /** recall/cloze only. The thing to be recalled. */
  answer?: string;
  /** Always shown after answering: the "why", beyond per-option rationales. */
  explanation: string;
  /** Reference ids resolving into references.json. At least one required. */
  refs: string[];
  /** Optional mapping onto the 2027 blueprint, for forward compatibility. */
  blueprint2027?: { domain: string; task: string };
}

export interface Reference {
  id: string;
  label: string;
  url: string;
  citation: string;
  category: string;
  codeVersion?: string;
  note?: string;
}

export interface Domain {
  id: DomainId;
  number: number;
  name: string;
  weight: number;
  scoredItems: number;
  targetCards: number;
  description: string;
  tasks: Record<string, string>;
}

export interface Blueprint {
  source: Record<string, string>;
  exam: {
    id: string;
    label: string;
    totalItems: number;
    scoredItems: number;
    fieldTestItems: number;
    optionsPerItem: number;
    /** Testing time only, excluding tutorial and the scheduled break. */
    timeLimitMinutes: number;
    totalSessionMinutes?: number;
    scheduledBreak?: string;
    delivery?: string;
    effectiveUntil: string;
    sourceNote?: string;
  };
  successorExam: Record<string, unknown>;
  cacrepAreas: Array<{ id: CacrepArea; name: string }>;
  domains: Domain[];
}

export interface Deck {
  domain: DomainId;
  cards: Card[];
}

const CARD_TYPES: readonly CardType[] = ['mcq', 'scenario', 'recall', 'cloze'];
const CHOICE_TYPES: readonly CardType[] = ['mcq', 'scenario'];

export const CACREP_AREAS: readonly CacrepArea[] = [
  'professional-ethics',
  'social-cultural',
  'human-growth',
  'career',
  'helping-relationships',
  'group-work',
  'assessment',
  'research',
];

export interface ValidationIssue {
  cardId: string;
  message: string;
}

export interface ValidationContext {
  blueprint: Blueprint;
  referenceIds: Set<string>;
  /** Number of options an MCQ must have on the target exam form. */
  optionsPerItem: number;
}

/** Cloze cards mark the deletion with {{...}}. */
const CLOZE_PATTERN = /\{\{[^}]+\}\}/;

export function validateCard(card: Card, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const id = card.id || '(missing id)';
  const fail = (message: string) => issues.push({ cardId: id, message });

  if (!card.id || !/^[a-z0-9-]+$/.test(card.id)) {
    fail('id must be a non-empty kebab-case slug');
  }
  if (!CARD_TYPES.includes(card.type)) {
    fail(`type must be one of ${CARD_TYPES.join(', ')} (got ${JSON.stringify(card.type)})`);
  }

  const domain = ctx.blueprint.domains.find((d) => d.id === card.domain);
  if (!domain) {
    fail(`unknown domain ${JSON.stringify(card.domain)}`);
  } else {
    // Task codes are stored as "1F" (domain number + letter) but keyed by letter.
    const letter = card.task.replace(/^\d+/, '');
    const prefix = card.task.slice(0, card.task.length - letter.length);
    if (prefix !== String(domain.number)) {
      fail(`task ${card.task} does not start with its domain number (${domain.number})`);
    } else if (!(letter in domain.tasks)) {
      fail(`task ${card.task} is not a task in ${domain.id} (${domain.name})`);
    }
  }

  if (!Array.isArray(card.cacrep) || card.cacrep.length === 0) {
    fail('at least one CACREP area is required (this is the second coverage axis)');
  } else {
    for (const area of card.cacrep) {
      if (!CACREP_AREAS.includes(area)) fail(`unknown CACREP area ${JSON.stringify(area)}`);
    }
  }

  if (!card.prompt?.trim()) fail('prompt is empty');
  if (!card.explanation?.trim()) fail('explanation is empty');

  if (!Array.isArray(card.refs) || card.refs.length === 0) {
    fail('at least one reference is required');
  } else {
    for (const ref of card.refs) {
      if (!ctx.referenceIds.has(ref)) fail(`reference ${JSON.stringify(ref)} not in references.json`);
    }
  }

  if (CHOICE_TYPES.includes(card.type)) {
    const choices = card.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      fail(`${card.type} card requires choices`);
    } else {
      if (choices.length !== ctx.optionsPerItem) {
        fail(`expected ${ctx.optionsPerItem} choices to match the exam form, got ${choices.length}`);
      }
      const correct = choices.filter((c) => c.correct);
      if (correct.length !== 1) {
        fail(`expected exactly 1 correct choice, got ${correct.length}`);
      }
      choices.forEach((choice, i) => {
        if (!choice.text?.trim()) fail(`choice ${i + 1} has empty text`);
        // Every distractor must explain itself, or the card teaches recognition
        // of the right answer without teaching why the others are wrong.
        if (!choice.rationale?.trim()) fail(`choice ${i + 1} is missing a rationale`);
      });
      const texts = choices.map((c) => c.text.trim().toLowerCase());
      if (new Set(texts).size !== texts.length) fail('duplicate choice text');
    }
    if (card.answer) fail(`${card.type} card should not have an "answer" field`);
  } else {
    if (!card.answer?.trim()) fail(`${card.type} card requires an answer`);
    if (card.choices) fail(`${card.type} card should not have choices`);
    if (card.type === 'cloze' && !CLOZE_PATTERN.test(card.prompt)) {
      fail('cloze card prompt must contain a {{deletion}}');
    }
  }

  return issues;
}

export function validateDeck(cards: Card[], ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    if (seen.has(card.id)) {
      issues.push({ cardId: card.id, message: 'duplicate card id' });
    }
    seen.add(card.id);
    issues.push(...validateCard(card, ctx));
  }

  return issues;
}
