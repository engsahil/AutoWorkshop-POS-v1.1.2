/**
 * Tiny XML scanner for the parts of an .xlsx workbook we need.
 *
 * It is not a general XML parser: it only locates elements by name and returns
 * their attribute map and raw inner text. That is enough for worksheet and
 * shared-string XML, works in Node and the browser without a DOM, and never
 * executes anything from the file.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  inner: string;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

const ENTITIES: Record<string, string> = {
  lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0'
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const named = ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

/** Iterate over every element with the given tag name, outermost first. */
export function* iterateElements(xml: string, tag: string): Generator<XmlElement> {
  const open = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  let match: RegExpExecArray | null;
  while ((match = open.exec(xml))) {
    const start = match.index;
    const tagEnd = xml.indexOf('>', start);
    if (tagEnd < 0) return;
    const head = xml.slice(start + 1 + tag.length, tagEnd);
    const selfClosing = head.trimEnd().endsWith('/');
    const attrs = parseAttrs(selfClosing ? head.trimEnd().slice(0, -1) : head);
    if (selfClosing) {
      yield { name: tag, attrs, inner: '' };
      open.lastIndex = tagEnd + 1;
      continue;
    }
    // Find the matching close tag, tracking nested same-name elements.
    let depth = 1;
    let cursor = tagEnd + 1;
    let innerEnd = -1;
    let after = -1;
    const openTag = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
    while (depth > 0) {
      const nextOpen = xml.indexOf(`<${tag}`, cursor);
      const nextClose = xml.indexOf(`</${tag}>`, cursor);
      if (nextClose < 0) return;
      // A nested element only counts when it is really this tag and not self-closed.
      if (nextOpen >= 0 && nextOpen < nextClose && new RegExp(`^<${tag}(?=[\\s/>])`).test(xml.slice(nextOpen, nextOpen + tag.length + 2))) {
        const nestedEnd = xml.indexOf('>', nextOpen);
        if (nestedEnd > 0 && xml[nestedEnd - 1] !== '/') depth++;
        cursor = nestedEnd + 1;
      } else {
        depth--;
        innerEnd = nextClose;
        after = nextClose + tag.length + 3;
        cursor = nextClose + 1;
      }
    }
    open.lastIndex = after;
    yield { name: tag, attrs, inner: xml.slice(tagEnd + 1, innerEnd) };
  }
}

/** Concatenated text of an element's children, entities decoded, tags removed. */
export function textOf(inner: string): string {
  const cdata = inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body: string) => body);
  return decodeEntities(cdata.replace(/<[^>]*>/g, ''));
}

/** First element with this name, or undefined. */
export function firstElement(xml: string, tag: string): XmlElement | undefined {
  for (const el of iterateElements(xml, tag)) return el;
  return undefined;
}

/** Column reference ("A1", "AB12") → zero-based column index. */
export function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
