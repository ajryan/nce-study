/**
 * Minimal DOM helpers.
 *
 * The app has five views and no reactive state graph worth pulling in a
 * framework for, so this is the whole view layer: an element factory that
 * escapes by construction (text goes through textContent, never innerHTML).
 */

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'html') {
      // Only ever used with strings this module builds itself.
      node.innerHTML = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** Formats a scheduling interval the way a study app should: coarse, not exact. */
export function formatInterval(days: number): string {
  if (days < 1 / 24) return '<1m';
  if (days < 1) {
    const hours = days * 24;
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    return `${Math.round(hours)}h`;
  }
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30.44).toFixed(1)}mo`;
  return `${(days / 365.25).toFixed(1)}y`;
}

export function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

/** Renders a cloze prompt, either masked or revealed. */
export function renderCloze(prompt: string, revealed: boolean): DocumentFragment {
  const out = document.createDocumentFragment();
  const pattern = /\{\{([^}]+)\}\}/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(prompt)) !== null) {
    if (match.index > last) {
      out.appendChild(document.createTextNode(prompt.slice(last, match.index)));
    }
    out.appendChild(
      revealed
        ? el('span', { class: 'cloze' }, match[1]!)
        : el('span', { class: 'cloze-hidden' }, ' '),
    );
    last = match.index + match[0].length;
  }
  if (last < prompt.length) out.appendChild(document.createTextNode(prompt.slice(last)));
  return out;
}
