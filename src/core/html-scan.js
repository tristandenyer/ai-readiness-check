/* A small HTML scanner that replaces a full DOM library. The checkers only
   need to find elements by tag and attribute, read attributes, and read
   text, so this builds just enough of a tree for that and exposes it
   through the few DOM methods they call:

     document.querySelectorAll(selector)   (limited selectors, see below)
     document.body.textContent
     element.getAttribute(name)
     element.textContent

   Parsing follows what browsers and the previous library do in the cases
   that affect the checks: comments and <script>/<style> contents are not
   parsed as tags, void elements never have children, a stray end tag is
   ignored, and an end tag closes any elements left open inside it.

   Supported selectors: a tag name, [attr], [attr="value"], combinations of
   those ("link[rel=\"alternate\"][type=\"text/markdown\"]"), and comma
   lists of them. Anything else throws, so an unsupported selector added to
   a checker fails in tests instead of silently matching nothing. */

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "keygen",
  "link", "meta", "param", "source", "track", "wbr",
]);

/* Contents are raw text: no tags inside. For script and style the text
   is also kept exactly as written (no entity decoding). */
const RAW_TEXT_ELEMENTS = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes"]);
const ESCAPABLE_RAW_TEXT_ELEMENTS = new Set(["textarea", "title"]);

/* Opening one of these closes an open element of the listed kinds, the
   way a browser ends a <p> when the next <p> starts. */
const IMPLIED_CLOSE = {
  p: new Set(["p"]),
  li: new Set(["li"]),
  dt: new Set(["dt", "dd"]),
  dd: new Set(["dt", "dd"]),
  tr: new Set(["tr", "td", "th"]),
  td: new Set(["td", "th"]),
  th: new Set(["td", "th"]),
  option: new Set(["option"]),
  optgroup: new Set(["optgroup", "option"]),
  body: new Set(["head"]),
};
for (const tag of [
  "address", "article", "aside", "blockquote", "details", "div", "dl",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "pre", "section",
  "table", "ul",
]) {
  IMPLIED_CLOSE[tag] = new Set([...(IMPLIED_CLOSE[tag] || []), "p"]);
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", bull: "•", middot: "·",
  times: "×", divide: "÷", minus: "−", plusmn: "±", deg: "°", micro: "µ",
  para: "¶", sect: "§", euro: "€", pound: "£", yen: "¥", cent: "¢",
  curren: "¤", iexcl: "¡", iquest: "¿", shy: "­", ensp: " ",
  emsp: " ", thinsp: " ", zwnj: "‌", zwj: "‍",
  lrm: "‎", rlm: "‏", dagger: "†", Dagger: "‡", permil: "‰",
  prime: "′", Prime: "″", larr: "←", rarr: "→", uarr: "↑", darr: "↓",
  harr: "↔", check: "✓", star: "☆", hearts: "♥", frac12: "½",
  frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³", ordf: "ª",
  ordm: "º", acute: "´", uml: "¨", cedil: "¸", macr: "¯", not: "¬",
  brvbar: "¦", AElig: "Æ", aelig: "æ", szlig: "ß", eacute: "é",
  Eacute: "É", egrave: "è", Egrave: "È", ecirc: "ê", euml: "ë",
  aacute: "á", Aacute: "Á", agrave: "à", Agrave: "À", acirc: "â",
  atilde: "ã", auml: "ä", Auml: "Ä", aring: "å", Aring: "Å", ccedil: "ç",
  Ccedil: "Ç", iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  ntilde: "ñ", Ntilde: "Ñ", oacute: "ó", Oacute: "Ó", ograve: "ò",
  ocirc: "ô", otilde: "õ", ouml: "ö", Ouml: "Ö", oslash: "ø",
  Oslash: "Ø", uacute: "ú", Uacute: "Ú", ugrave: "ù", ucirc: "û",
  uuml: "ü", Uuml: "Ü", yacute: "ý", yuml: "ÿ",
};

/* Numeric references that HTML maps to Windows-1252 characters instead of
   the control characters those numbers mean in Unicode. */
const WINDOWS_1252 = {
  128: 0x20ac, 130: 0x201a, 131: 0x0192, 132: 0x201e, 133: 0x2026,
  134: 0x2020, 135: 0x2021, 136: 0x02c6, 137: 0x2030, 138: 0x0160,
  139: 0x2039, 140: 0x0152, 142: 0x017d, 145: 0x2018, 146: 0x2019,
  147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014,
  152: 0x02dc, 153: 0x2122, 154: 0x0161, 155: 0x203a, 156: 0x0153,
  158: 0x017e, 159: 0x0178,
};

function decodeCodePoint(n) {
  if (WINDOWS_1252[n]) return String.fromCodePoint(WINDOWS_1252[n]);
  if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "�";
  return String.fromCodePoint(n);
}

export function decodeEntities(text) {
  if (!text.includes("&")) return text;
  return text.replace(/&(?:#[xX]([0-9a-fA-F]{1,6});?|#([0-9]{1,7});?|([A-Za-z][A-Za-z0-9]{1,31});)/g,
    (match, hex, dec, name) => {
      if (hex) return decodeCodePoint(Number.parseInt(hex, 16));
      if (dec) return decodeCodePoint(Number.parseInt(dec, 10));
      return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match;
    });
}

class Element {
  constructor(tagName, attributes, doc) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.doc = doc;
    this.textStart = 0;
    this.textEnd = 0;
  }

  getAttribute(name) {
    const value = this.attributes.get(String(name).toLowerCase());
    return value === undefined ? null : value;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name).toLowerCase());
  }

  get textContent() {
    return this.doc.texts.slice(this.textStart, this.textEnd).join("");
  }
}

/* Parses selectors of the supported shape into
   [{ tag, attrs: [{ name, value? }] }, ...], one entry per comma part. */
function parseSelector(selector) {
  return selector.split(",").map((part) => {
    const trimmed = part.trim();
    const m = trimmed.match(/^([a-zA-Z][a-zA-Z0-9-]*)?((?:\[[^\]]+\])*)$/);
    if (!m || (!m[1] && !m[2])) {
      throw new Error(`html-scan: unsupported selector "${trimmed}"`);
    }
    const attrs = [];
    for (const [, inner] of m[2].matchAll(/\[([^\]]+)\]/g)) {
      const a = inner.match(/^\s*([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?\s*$/);
      if (!a) throw new Error(`html-scan: unsupported selector "${trimmed}"`);
      attrs.push({ name: a[1].toLowerCase(), value: a[2] ?? a[3] ?? a[4] });
    }
    return { tag: m[1]?.toLowerCase(), attrs };
  });
}

/* HTML compares these attribute values without regard to case in
   selectors; every other attribute's value is compared exactly. */
const CASE_INSENSITIVE_VALUES = new Set(["type", "rel", "http-equiv", "charset", "lang", "media", "hreflang"]);

function matches(el, compound) {
  if (compound.tag && el.tagName !== compound.tag) return false;
  for (const { name, value } of compound.attrs) {
    const actual = el.attributes.get(name);
    if (actual === undefined) return false;
    if (value === undefined) continue;
    if (CASE_INSENSITIVE_VALUES.has(name)) {
      if (actual.toLowerCase() !== value.toLowerCase()) return false;
    } else if (actual !== value) {
      return false;
    }
  }
  return true;
}

class Document {
  constructor() {
    this.elements = [];
    this.texts = [];
    this.body = null;
  }

  querySelectorAll(selector) {
    const compounds = parseSelector(selector);
    return this.elements.filter((el) => compounds.some((c) => matches(el, c)));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

const ATTRIBUTE_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;

function parseAttributes(source) {
  const attributes = new Map();
  for (const [, rawName, dq, sq, uq] of source.matchAll(ATTRIBUTE_RE)) {
    const name = rawName.toLowerCase();
    if (attributes.has(name)) continue; // the first occurrence wins
    const raw = dq ?? sq ?? uq;
    attributes.set(name, raw === undefined ? "" : decodeEntities(raw));
  }
  return attributes;
}

/* Finds the end of a start tag, skipping over ">" inside quoted
   attribute values. Returns the index of ">" or -1. */
function findTagEnd(html, from) {
  let quote = null;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

export function parseHtml(html) {
  const doc = new Document();
  const stack = []; // open elements
  let foreignDepth = 0; // inside <svg> or <math>, where "/>" closes an element
  /* Inside <template>. Template content is not part of the page (a
     browser's querySelectorAll never finds it, and it has no text), so
     nothing in it is recorded. Server-rendered web components put whole
     page sections in <template shadowrootmode>, which a browser attaches
     as a shadow root that document-level queries also don't enter. */
  let templateDepth = 0;
  let pos = 0;
  const len = html.length;

  const addText = (text) => {
    if (text && templateDepth === 0) doc.texts.push(text);
  };
  const close = (index) => {
    // Close stack[index] and everything opened inside it.
    for (let i = stack.length - 1; i >= index; i--) {
      const el = stack[i];
      el.textEnd = doc.texts.length;
      if (el.tagName === "svg" || el.tagName === "math") foreignDepth--;
    }
    stack.length = index;
  };

  while (pos < len) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) {
      addText(decodeEntities(html.slice(pos)));
      break;
    }
    if (lt > pos) addText(decodeEntities(html.slice(pos, lt)));
    pos = lt;

    // Comment.
    if (html.startsWith("<!--", pos)) {
      const end = html.indexOf("-->", pos + 4);
      pos = end === -1 ? len : end + 3;
      continue;
    }
    // Doctype, CDATA, and other markup declarations; processing instructions.
    if (html[pos + 1] === "!" || html[pos + 1] === "?") {
      const end = html.indexOf(">", pos + 2);
      pos = end === -1 ? len : end + 1;
      continue;
    }
    // End tag.
    const endTag = /^<\/([a-zA-Z][^\s/>]*)[^>]*>/.exec(html.slice(pos, pos + 256));
    if (endTag) {
      const name = endTag[1].toLowerCase();
      pos += endTag[0].length;
      if (templateDepth > 0) {
        if (name === "template") templateDepth--;
        continue;
      }
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName === name) {
          close(i);
          break;
        }
      }
      continue;
    }
    // Start tag.
    const nameMatch = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(pos, pos + 256));
    if (!nameMatch) {
      // A "<" that doesn't start a tag is text.
      addText("<");
      pos += 1;
      continue;
    }
    const tagEnd = findTagEnd(html, pos + nameMatch[0].length);
    if (tagEnd === -1) {
      // Unclosed start tag at the end of the document: drop it.
      break;
    }
    const tagName = nameMatch[1].toLowerCase();
    let attrSource = html.slice(pos + nameMatch[0].length, tagEnd).trimEnd();
    /* A trailing "/" marks a self-closing tag, except when it ends an
       unquoted attribute value: in <a href=/about/> the value is
       "/about/" and the tag is not self-closing. */
    let selfClosing = false;
    if (attrSource.endsWith("/") && !/=\s*[^\s"'=<>`][^\s>]*$/.test(attrSource)) {
      selfClosing = true;
      attrSource = attrSource.slice(0, -1);
    }
    pos = tagEnd + 1;

    if (tagName === "template") {
      templateDepth++;
      continue;
    }
    if (templateDepth > 0) {
      // Skip a raw-text element's contents so a "<" in a script inside
      // the template isn't read as a tag.
      if (RAW_TEXT_ELEMENTS.has(tagName) || ESCAPABLE_RAW_TEXT_ELEMENTS.has(tagName)) {
        const closeRe = new RegExp(`</${tagName}(?=[\\s/>])[^>]*>`, "gi");
        closeRe.lastIndex = pos;
        const m = closeRe.exec(html);
        pos = m ? m.index + m[0].length : len;
      }
      continue;
    }

    const implied = IMPLIED_CLOSE[tagName];
    if (implied) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const open = stack[i].tagName;
        if (implied.has(open)) {
          close(i);
          break;
        }
        // Don't reach past these when looking for an element to close.
        if (["div", "section", "article", "table", "ul", "ol", "body", "html"].includes(open)) break;
      }
    }

    const el = new Element(tagName, parseAttributes(attrSource), doc);
    el.textStart = doc.texts.length;
    el.textEnd = doc.texts.length;
    doc.elements.push(el);
    if (tagName === "body" && !doc.body) doc.body = el;

    if (VOID_ELEMENTS.has(tagName) || (selfClosing && foreignDepth > 0)) {
      continue;
    }

    if (RAW_TEXT_ELEMENTS.has(tagName) || ESCAPABLE_RAW_TEXT_ELEMENTS.has(tagName)) {
      // Search from pos in place; slicing the rest of the page for every
      // <script> would copy up to 1 MB per script.
      const closeRe = new RegExp(`</${tagName}(?=[\\s/>])[^>]*>`, "gi");
      closeRe.lastIndex = pos;
      const m = closeRe.exec(html);
      const raw = m ? html.slice(pos, m.index) : html.slice(pos);
      addText(RAW_TEXT_ELEMENTS.has(tagName) ? raw : decodeEntities(raw));
      el.textEnd = doc.texts.length;
      pos = m ? m.index + m[0].length : len;
      continue;
    }

    if (tagName === "svg" || tagName === "math") foreignDepth++;
    stack.push(el);
  }

  close(0);

  /* <html>, <head>, and <body> tags are all optional in HTML. Without a
     <body> tag, a browser puts everything after the head into an implied
     body, so its text is all the text outside <head> and <title>. (The
     previous DOM library threw an error here instead, which reported the
     site as unreachable.) */
  if (!doc.body) {
    const excluded = doc.elements.filter((el) => el.tagName === "head" || el.tagName === "title");
    const body = new Element("body", new Map(), doc);
    const kept = doc.texts.filter(
      (_t, i) => !excluded.some((el) => i >= el.textStart && i < el.textEnd),
    );
    Object.defineProperty(body, "textContent", { value: kept.join("") });
    doc.body = body;
  }
  return doc;
}
