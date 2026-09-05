import { MAX_PANEL_HTML } from "../../shared/panels.js";

const HTML_TAGS = new Set("div span p pre code section article aside header footer main figure figcaption details summary table thead tbody tfoot tr td th caption colgroup col br hr h1 h2 h3 h4 h5 h6 ul ol li dl dt dd b strong i em s del u small sub sup blockquote img style input label".split(" "));
const SVG_TAGS = new Set("svg g path rect circle ellipse line polyline polygon text tspan defs lineargradient radialgradient stop clippath mask pattern filter feblend fecolormatrix fecomponenttransfer fecomposite feconvolvematrix fediffuselighting fedisplacementmap fedistantlight fedropshadow feflood fefunca fefuncb fefuncg fefuncr fegaussianblur femerge femergenode femorphology feoffset fepointlight fespecularlighting fespotlight fetile feturbulence title desc".split(" "));
const ATTRS = new Set("id class style title role aria-label aria-hidden aria-expanded aria-controls for type name checked open colspan rowspan scope width height alt src viewbox preserveaspectratio d x y x1 x2 y1 y2 cx cy r rx ry points fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity opacity transform xmlns offset stop-color stop-opacity gradientunits gradienttransform patternunits patterntransform clip-path mask filter color font-size text-anchor dominant-baseline dx dy stddeviation in in2 result mode values type operator k1 k2 k3 k4 flood-color flood-opacity".split(" "));

/** Sanitization is defense in depth; the opaque-origin sandbox and CSP remain mandatory. */
export function panelDocument(html: string, remote = false): string {
  if (html.length > MAX_PANEL_HTML) throw new Error("This card exceeds the 100 KB preview limit.");
  if (/\{\{[\s\S]*?\}\}/.test(html)) throw new Error("Unresolved host macros. Import the rendered card instead of its template.");
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    const tag = element.localName.toLowerCase();
    if (["html", "head", "body"].includes(tag)) continue;
    if (!HTML_TAGS.has(tag) && !SVG_TAGS.has(tag)) { element.remove(); continue; }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ATTRS.has(name) || name.startsWith("on")) element.removeAttribute(attr.name);
    }
    if (tag === "input" && !["checkbox", "radio"].includes(element.getAttribute("type") ?? "")) { element.remove(); continue; }
    if (tag === "img") {
      const src = element.getAttribute("src") ?? "";
      if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src) && !(remote && /^https:\/\//i.test(src))) element.removeAttribute("src");
      element.setAttribute("referrerpolicy", "no-referrer");
    }
  }
  const csp = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'${remote ? " https:" : ""}; img-src data:${remote ? " https:" : ""}; font-src ${remote ? "https:" : "'none'"}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>html{color-scheme:dark}body{margin:8px;color:#e8e8ed;font:14px/1.5 system-ui;overflow-wrap:anywhere}*,*:before,*:after{box-sizing:border-box}img,svg{max-width:100%}pre{white-space:pre-wrap}a{pointer-events:none}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}</style>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>`;
}
