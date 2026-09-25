import { describe, it, expect } from "./helpers/expect.js";
import { parseHtml, decodeEntities } from "../src/core/html-scan.js";

const hrefs = (doc, sel = "a[href]") =>
  doc.querySelectorAll(sel).map((el) => el.getAttribute("href"));
const texts = (doc, sel) => doc.querySelectorAll(sel).map((el) => el.textContent.trim());

describe("html-scan: the selectors the checkers use", () => {
  const doc = parseHtml(`<!doctype html><html><head>
    <meta name="robots" content="noai, noimageai">
    <meta name="googlebot" content="noindex">
    <meta name="description" content="not this one">
    <link rel="alternate" type="text/markdown" href="/index.md">
    <link rel="alternate" type="application/rss+xml" href="/feed.xml">
    <script type="application/ld+json">{"@type":"WebSite","name":"A &amp; B"}</script>
    </head><body>
    <div aria-hidden="true">hint <b>text</b></div>
    <div aria-hidden="false">visible</div>
    <a href="/one">1</a><a>no href</a><a href="#top">top</a>
    </body></html>`);

  it("finds meta robots and googlebot", () => {
    const metas = doc.querySelectorAll('meta[name="robots"], meta[name="googlebot"]');
    expect(metas.map((m) => m.getAttribute("content"))).toEqual(["noai, noimageai", "noindex"]);
  });

  it("finds the markdown alternate link only", () => {
    expect(hrefs(doc, 'link[rel="alternate"][type="text/markdown"]')).toEqual(["/index.md"]);
  });

  it("returns JSON-LD exactly as written, without decoding entities", () => {
    expect(texts(doc, 'script[type="application/ld+json"]')).toEqual([
      '{"@type":"WebSite","name":"A &amp; B"}',
    ]);
  });

  it("reads the text of aria-hidden elements, including nested elements", () => {
    expect(texts(doc, '[aria-hidden="true"]')).toEqual(["hint text"]);
  });

  it("finds links that have an href", () => {
    expect(hrefs(doc)).toEqual(["/one", "#top"]);
  });

  it("throws on a selector it doesn't support, instead of matching nothing", () => {
    expect(() => doc.querySelectorAll("div > a")).toThrow(/unsupported selector/);
    expect(() => doc.querySelectorAll(".class")).toThrow(/unsupported selector/);
  });
});

describe("html-scan: parsing rules", () => {
  it("doesn't read tags inside comments", () => {
    const doc = parseHtml('<body><!-- <link rel="alternate" type="text/markdown" href="/x.md"> --><p>t</p></body>');
    expect(hrefs(doc, 'link[rel="alternate"][type="text/markdown"]')).toEqual([]);
  });

  it("doesn't read tags inside scripts, styles, textareas, or titles", () => {
    const doc = parseHtml(
      "<head><title><a href=/t>T</a></title><style>a[href]{}</style></head>" +
        '<body><script>if (a<b) document.write("<a href=/s>")</script>' +
        "<textarea><a href=/ta>x</a></textarea></body>",
    );
    expect(hrefs(doc)).toEqual([]);
  });

  it("ignores everything inside <template>, including declarative shadow roots", () => {
    const doc = parseHtml(
      '<body><template><a href="/tpl">t</a></template>' +
        '<div><template shadowrootmode="open"><a href="/shadow">s</a><template><a href="/nested"></a></template></template></div>' +
        '<a href="/real">r</a></body>',
    );
    expect(hrefs(doc)).toEqual(["/real"]);
    expect(doc.body.textContent).toBe("r");
  });

  it("reads double-quoted, single-quoted, and unquoted attributes", () => {
    const doc = parseHtml(`<body><a href="/dq">1</a><a href='/sq'>2</a><a href=/uq>3</a></body>`);
    expect(hrefs(doc)).toEqual(["/dq", "/sq", "/uq"]);
  });

  it("keeps a trailing slash in an unquoted value", () => {
    // In <a href=/about/> the "/" belongs to the value; the tag is not self-closing.
    const doc = parseHtml("<body><a class=nav href=/about/>About</a><a href=/>Home</a></body>");
    expect(hrefs(doc)).toEqual(["/about/", "/"]);
    expect(doc.querySelectorAll("a[href]")[0].textContent).toBe("About");
  });

  it("decodes entities in attribute values", () => {
    const doc = parseHtml(`<body><a href="/a?x=1&amp;y=2">a</a><a href='/b?q=&quot;z&quot;'>b</a></body>`);
    expect(hrefs(doc)).toEqual(["/a?x=1&y=2", '/b?q="z"']);
  });

  it("allows > inside quoted attribute values", () => {
    const doc = parseHtml('<body><a href="/x?a>b" title="1 > 0">g</a></body>');
    expect(hrefs(doc)).toEqual(["/x?a>b"]);
  });

  it("matches tag and attribute names regardless of case", () => {
    const doc = parseHtml('<BODY><A HREF="/UP">x</A><META NAME="robots" CONTENT="noai"></BODY>');
    expect(hrefs(doc)).toEqual(["/UP"]);
    expect(doc.querySelectorAll('meta[name="robots"]')).toHaveLength(1);
  });

  it("compares rel and type values regardless of case, other values exactly", () => {
    const doc = parseHtml(
      '<head><link rel="Alternate" type="Text/Markdown" href="/case.md"><meta name="Robots" content="x"></head>',
    );
    expect(hrefs(doc, 'link[rel="alternate"][type="text/markdown"]')).toEqual(["/case.md"]);
    expect(doc.querySelectorAll('meta[name="robots"]')).toHaveLength(0);
  });

  it("uses the first of two attributes with the same name", () => {
    const doc = parseHtml('<body><a href="/first" href="/second">d</a></body>');
    expect(hrefs(doc)).toEqual(["/first"]);
  });

  it("treats an attribute with no value as present and empty", () => {
    const doc = parseHtml("<body><a href>empty</a><div aria-hidden>n</div></body>");
    expect(hrefs(doc)).toEqual([""]);
    expect(doc.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(doc.querySelectorAll("[aria-hidden]")).toHaveLength(1);
  });

  it("ignores a self-closing slash on normal elements, but honors it in SVG", () => {
    const doc = parseHtml(
      '<body><div aria-hidden="true"/>after</div><svg><g aria-hidden="true"/><text>svg</text></svg></body>',
    );
    expect(texts(doc, '[aria-hidden="true"]')).toEqual(["after", ""]);
  });

  it("closes an open <p> when the next one starts", () => {
    const doc = parseHtml('<body><p aria-hidden="true">one<p>two</body>');
    expect(texts(doc, '[aria-hidden="true"]')).toEqual(["one"]);
  });

  it("ignores stray end tags", () => {
    const doc = parseHtml("<body></span></div><p>ok</p></body></html>");
    expect(doc.body.textContent).toBe("ok");
  });
});

describe("html-scan: body text", () => {
  it("includes script text inside the body, like a browser's textContent", () => {
    const doc = parseHtml("<body><p>a</p><script>var x = 1;</script></body>");
    expect(doc.body.textContent).toBe("avar x = 1;");
  });

  it("finds the body when a script sits between </head> and <body>", () => {
    // react.dev's markup. The previous DOM library found no body here and
    // reported the site as client-rendered.
    const doc = parseHtml(
      "<!doctype html><html><head><title>t</title></head><script>gtag()</script><body><main>content</main></body></html>",
    );
    expect(doc.body.textContent).toBe("content");
  });

  it("uses an implied body when there is no <body> tag", () => {
    const doc = parseHtml("<!doctype html><title>Title</title><p>hello there</p>");
    expect(doc.body.textContent).toBe("hello there");
  });

  it("handles text with no tags at all", () => {
    expect(parseHtml("just some text").body.textContent).toBe("just some text");
  });
});

describe("html-scan: malformed and hostile input", () => {
  it("survives an unclosed comment", () => {
    const doc = parseHtml("<body><p>before</p><!-- never closed <a href=/x>");
    expect(hrefs(doc)).toEqual([]);
    expect(doc.body.textContent).toBe("before");
  });

  it("survives an unclosed start tag at the end", () => {
    const doc = parseHtml('<body><p>ok</p><a href="/x');
    expect(doc.body.textContent).toBe("ok");
  });

  it("survives an unclosed script", () => {
    const doc = parseHtml("<body><p>ok</p><script>never closed <a href=/x>");
    expect(hrefs(doc)).toEqual([]);
  });

  /* The limits allow for slow CI machines. Parsing that grows with the
     square of the input takes many seconds on 1 MB, so it still fails. */
  it("parses 1 MB of deeply nested tags quickly", () => {
    const html = "<body>" + "<div><span>".repeat(100000) + "</body>";
    expect(html.length).toBeGreaterThan(1024 * 1024);
    const t0 = performance.now();
    parseHtml(html);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("parses 1 MB with thousands of scripts quickly", () => {
    const html = "<body>" + "<script>var a = 1 < 2;</script><p>x</p>".repeat(25000) + "</body>";
    const t0 = performance.now();
    const doc = parseHtml(html);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(doc.body.textContent.length).toBeGreaterThan(0);
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal, and hex references", () => {
    expect(decodeEntities("&amp; &lt; &gt; &quot; &#39; &#x27; &copy; &mdash; &nbsp;")).toBe(
      "& < > \" ' ' © —  ",
    );
  });

  it("maps the Windows-1252 range the way HTML does", () => {
    expect(decodeEntities("&#150; &#8211;")).toBe("– –");
  });

  it("leaves unknown names and bare ampersands alone", () => {
    expect(decodeEntities("&notarealentity; & &amp")).toBe("&notarealentity; & &amp");
  });

  it("replaces invalid code points", () => {
    expect(decodeEntities("&#0; &#xD800; &#x110000;")).toBe("� � �");
  });
});
