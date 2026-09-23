// Small DOM helpers for the side panel. No templating library; the views
// build elements directly so no engagement value ever goes through innerHTML.

/**
 * @typedef {string | number | Node | null | undefined | false} Leaf
 */

/**
 * @typedef {Leaf | Leaf[] | (Leaf | Leaf[])[]} Child
 */

/**
 * Create an element with attributes and children. `class`, `dataset`, event
 * handlers (`onclick`), boolean attributes and text children are handled.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, unknown> | null} [attrs]
 * @param {...Child} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'dataset' && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(/** @type {Record<string, unknown>} */ (v))) el.dataset[dk] = String(dv);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), /** @type {EventListener} */ (v));
      } else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

/**
 * @param {Node} parent
 * @param {Child[]} children
 */
export function append(parent, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) {
      append(parent, /** @type {Child[]} */ (c));
    } else if (c instanceof Node) {
      parent.appendChild(c);
    } else {
      parent.appendChild(document.createTextNode(String(c)));
    }
  }
}

/**
 * Replace all children.
 * @param {HTMLElement} el
 * @param {...Child} children
 */
export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

/**
 * Inline SVG icon.
 * @param {'check' | 'clock' | 'x' | 'dot' | 'arrow'} name
 * @returns {SVGSVGElement}
 */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  switch (name) {
    case 'check': path.setAttribute('d', 'M5 13l4 4L19 7'); break;
    case 'clock': path.setAttribute('d', 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'); break;
    case 'x': path.setAttribute('d', 'M6 6l12 12M18 6L6 18'); break;
    case 'arrow': path.setAttribute('d', 'M5 12h14M13 6l6 6-6 6'); break;
    case 'dot': path.setAttribute('d', 'M12 12h.01'); break;
  }
  svg.appendChild(path);
  return svg;
}

/**
 * A status chip.
 * @param {string} text
 * @param {'success' | 'waiting' | 'danger' | 'primary' | 'lock' | 'plain'} [tone]
 * @returns {HTMLSpanElement}
 */
export function chip(text, tone = 'plain') {
  return h('span', { class: `chip${tone === 'plain' ? '' : ` chip--${tone}`}` }, text);
}

/**
 * Inline code.
 * @param {string} text
 * @returns {HTMLElement}
 */
export function code(text) {
  return h('code', null, text);
}

/**
 * Format an ISO timestamp for the panel.
 * @param {string | undefined} iso
 * @returns {string}
 */
export function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
