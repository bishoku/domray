/**
 * dom-sanitizer.ts — Semantic DOM Sanitizer & Token Pruning Engine.
 *
 * Compresses raw HTML subtrees to minimize LLM token budget consumption
 * (typically 75-90% reduction) while preserving crucial semantic layout,
 * forms, accessibility markers, error classes, and state.
 */

export interface PruneOptions {
  maxCharacters?: number;
  preserveClasses?: boolean;
}

const DEFAULT_MAX_CHARS = 4000;

// Semantic & state classes to keep when pruning Tailwind / CSS utility noise
const SEMANTIC_CLASS_REGEX =
  /(error|err|invalid|valid|danger|warn|warning|active|current|selected|hidden|show|open|close|disabled|loading|busy|modal|dialog|toast|alert|btn|button|card|form|input|badge|tab|panel)/i;

/**
 * Performs deep semantic pruning on HTML string.
 */
export function semanticPrune(raw: string, options: PruneOptions = {}): string {
  const maxChars = options.maxCharacters ?? DEFAULT_MAX_CHARS;

  let html = raw;

  // 1. Remove scripts, styles, links, noscripts, templates, iframes
  html = html.replace(/<(script|style|noscript|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  html = html.replace(/<link\b[^>]*\/?>/gi, "");

  // 2. Compact massive SVG elements (major token killer)
  html = html.replace(/<svg\b([^>]*)>[\s\S]*?<\/svg>/gi, (_match, attrs: string) => {
    const ariaMatch = attrs.match(/aria-label=["']([^"']+)["']/i);
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    const desc = ariaMatch ? ` aria-label="${ariaMatch[1]}"` : idMatch ? ` id="${idMatch[1]}"` : ' role="img"';
    return `<svg${desc}><!-- [SVG Icon] --></svg>`;
  });

  // 3. Redact passwords and private fields
  html = html.replace(/(<input[^>]*type=["']password["'][^>]*value=["'])[^"']*["']/gi, '$1***MASKED***"');
  html = html.replace(/(<[^>]*\bdata-private\b[^>]*value=["'])[^"']*["']/gi, '$1***MASKED***"');
  html = html.replace(/\b(token|secret|api[-_]?key|jwt|auth[-_]?token)=["'][^"']*["']/gi, '$1="***MASKED***"');

  // 4. Prune noisy utility classes (Tailwind, UnoCSS, Bootstrap layout clutter)
  html = html.replace(/\sclass=["']([^"']+)["']/gi, (_match, classNames: string) => {
    const tokens = classNames.split(/\s+/).filter(Boolean);
    const meaningful = tokens.filter((cls) => SEMANTIC_CLASS_REGEX.test(cls));
    return meaningful.length > 0 ? ` class="${meaningful.join(" ")}"` : "";
  });

  // 5. Shorten verbose data-* attributes that aren't state-related
  html = html.replace(/\sdata-(v|testid|test|cy|track|analytics|component)=["'][^"']*["']/gi, "");

  // 6. Truncate long static text runs (e.g. paragraphs of placeholder text)
  html = html.replace(/>([^<]{180,})</g, (_match, text: string) => {
    return `>${text.slice(0, 150)}... [truncated ${text.length - 150} chars]<`;
  });

  // 7. Minify whitespace between tags
  html = html.replace(/>\s+</g, "><").trim();

  // 8. Enforce maximum character/token budget
  if (html.length > maxChars) {
    html = `${html.slice(0, maxChars)}\n<!-- [DOM output truncated to stay within LLM token budget] -->`;
  }

  return html;
}
