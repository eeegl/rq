// The customer document (`rq pdf`) — pure. A print-ready HTML page that the
// shell hands to headless Chrome. Internal fields (notes, traces, dates)
// stay out; ids, priorities and dependencies stay in.

import * as Req from "./core.ts";
import { esc, md } from "./html.ts";

export type DocumentOptions = {
    title: string;
    subtitle?: string;
    client?: string;
    author?: string;
    version?: string;
    classification?: string;
    date: Req.Day;
    /** Which statuses to include. */
    statuses: Req.Status[];
};

type Section = {
    number: string;
    id: string;
    title: string;
    note?: string;
    rows: Req.Requirement[];
};

const cssStr = (s: string): string => `"${s.replace(/["\\]/g, "\\$&")}"`;

export const renderDocument = (
    reg: Req.Register,
    opts: DocumentOptions,
): string => {
    const included = Req.canonical(reg).requirements.filter((r) =>
        opts.statuses.includes(r.status),
    );
    const known = new Set(included.map((r) => r.id));
    const link = (id: string): string =>
        known.has(id) ? `<a href="#${esc(id)}">${esc(id)}</a>` : esc(id);

    const features = reg.features
        .map((f) => ({
            f,
            rows: included.filter((r) => r.feature === f.id),
        }))
        .filter(({ rows }) => rows.length);
    const others = Req.TYPE_ORDER.filter(Req.isType)
        .filter((t) => t !== "FR")
        .map((t) => ({ t, rows: included.filter((r) => r.type === t) }))
        .filter(({ rows }) => rows.length);
    const firstOther = features.length ? 3 : 2;
    const sections: Section[] = [
        ...features.map(({ f, rows }, i) => ({
            number: `2.${i + 1}`,
            id: f.id,
            title: f.title,
            note: f.note,
            rows,
        })),
        ...others.map(({ t, rows }, i) => ({
            number: `${firstOther + i}`,
            id: t,
            title: `${Req.REQUIREMENT_TYPES[t]} requirements`,
            rows,
        })),
    ];
    const proposed = included.filter((r) => r.status === "proposed").length;

    const requirement = (r: Req.Requirement): string => `
<article class="req" id="${esc(r.id)}">
<header><span class="rid">${esc(r.id)}</span>${r.priority ? `<span class="tag p${r.priority}">${Req.PRIORITY_NAMES[r.priority]}</span>` : ""}${r.status === "proposed" ? `<span class="tag proposed">Proposed</span>` : ""}</header>
<div class="text">${md(r.text, known)}</div>
${r.dependsOn?.length ? `<p class="deps">Depends on ${r.dependsOn.map(link).join(", ")}</p>` : ""}
</article>`;
    const section = (s: Section, level: 2 | 3): string => `
<section class="block">
<h${level} id="${esc(s.id)}"><span class="num">${s.number}</span>${esc(s.title)}${level === 3 ? ` <span class="fid">${esc(s.id)}</span>` : ""}</h${level}>
${s.note ? `<div class="lead">${md(s.note, known)}</div>` : ""}
${s.rows.map(requirement).join("")}
</section>`;

    const count = (rows: Req.Requirement[], p?: Req.Priority) =>
        rows.filter((r) => p === undefined || r.priority === p).length;
    const cell = (n: number) => `<td class="n">${n || "–"}</td>`;
    const summaryRow = (label: string, rows: Req.Requirement[], cls = "") =>
        `<tr class="${cls}"><td>${label}</td>${Req.PRIORITIES.map((p) => cell(count(rows, p))).join("")}${cell(rows.length)}</tr>`;
    const summary = `<table class="summary"><thead><tr><th>Section</th>${Req.PRIORITIES.map((p) => `<th class="n">${Req.PRIORITY_NAMES[p]}</th>`).join("")}<th class="n">Total</th></tr></thead><tbody>
${sections.map((s) => summaryRow(`${s.number} ${esc(s.title)}`, s.rows)).join("\n")}
${summaryRow("All", included, "total")}</tbody></table>`;

    const meta: [string, string | undefined][] = [
        ["Prepared for", opts.client],
        ["Prepared by", opts.author],
        ["Version", opts.version],
        ["Date", opts.date],
        [
            "Status",
            proposed
                ? `Draft: ${proposed} of ${included.length} requirements proposed, not yet approved`
                : "All requirements approved",
        ],
        ["Classification", opts.classification],
    ];
    const cover = `
<section class="cover">
${opts.author ? `<p class="org">${esc(opts.author)}</p>` : ""}
<h1>${esc(opts.title)}</h1>
${opts.subtitle ? `<p class="subtitle">${esc(opts.subtitle)}</p>` : ""}
<table class="meta">${meta
        .filter((m): m is [string, string] => m[1] !== undefined)
        .map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`)
        .join("")}</table>
</section>`;

    const tocEntry = (number: string, id: string, title: string, sub = "") =>
        `<li class="${sub}"><a href="#${esc(id)}"><span class="num">${number}</span>${esc(title)}</a></li>`;
    const toc = `
<nav class="toc"><h2 class="plain">Contents</h2><ol>
${tocEntry("1", "conventions", "Conventions")}
${features.length ? tocEntry("2", "functional", "Functional requirements") : ""}
${sections.map((s) => tocEntry(s.number, s.id, s.title, s.number.includes(".") ? "sub" : "")).join("\n")}
</ol></nav>`;

    const typeList = Object.entries(Req.REQUIREMENT_TYPES)
        .map(([k, v]) => `<li><b>${k}</b> ${v}</li>`)
        .join("");
    const conventions = `
<section class="block">
<h2 id="conventions"><span class="num">1</span>Conventions</h2>
<p>Each requirement has a permanent identifier. Identifiers are never reused; a requirement that no longer applies is withdrawn, not renumbered. "Shall" marks what the system must do.</p>
<p>Functional requirements are grouped by feature and numbered <code>FR-&lt;feature&gt;.&lt;n&gt;</code>; all others are numbered <code>&lt;type&gt;-&lt;n&gt;</code>. Types:</p>
<ul class="types">${typeList}</ul>
<p>Priority: <b>Must</b> is required in the release this document covers; <b>Should</b> is delivered if time allows; <b>Later</b> is planned for a later release.${proposed ? " Requirements marked <b>Proposed</b> are not yet approved and may change." : ""}</p>
<h3 class="plain">Summary</h3>
${summary}
</section>`;

    const footerLeft = [opts.title, opts.version && `Version ${opts.version}`]
        .filter(Req.isStr)
        .join(" · ");
    const headerRight = [opts.client, opts.classification]
        .filter(Req.isStr)
        .join(" · ");
    const box = (where: string, content: string) =>
        `@${where} { content: ${content}; font: 8pt/1.2 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #6b7280; }`;
    const pageCss = `
@page { size: A4; margin: 24mm 20mm 22mm;
  ${box("top-left", cssStr(opts.subtitle ?? ""))}
  ${box("top-right", cssStr(headerRight))}
  ${box("bottom-left", cssStr(footerLeft))}
  ${box("bottom-right", '"Page " counter(page) " of " counter(pages)')}
}
@page :first { @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }`;

    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc([opts.title, opts.subtitle].filter(Req.isStr).join(": "))}</title>
<style>${pageCss}${CSS}</style></head><body>
${cover}
${toc}
<main>
${conventions}
${features.length ? `<h2 id="functional" class="part"><span class="num">2</span>Functional requirements</h2>` : ""}
${sections.map((s) => section(s, s.number.includes(".") ? 3 : 2)).join("\n")}
</main></body></html>`;
};

const CSS = `
:root { --ink: #111827; --dim: #6b7280; --rule: #d1d5db; --accent: #1e3a5f; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: var(--ink); font: 10.5pt/1.5 Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif; }
h1, h2, h3, th, .rid, .tag, .toc, .org, .meta, .deps, .num, .fid { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
a { color: inherit; text-decoration: none; }
code { font: 9pt ui-monospace, Menlo, monospace; }

.cover { height: 247mm; display: flex; flex-direction: column; justify-content: center; break-after: page; }
.cover .org { margin: 0 0 18mm; font-size: 10pt; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
.cover h1 { margin: 0; font-size: 30pt; line-height: 1.15; font-weight: 600; color: var(--accent); }
.cover .subtitle { margin: 4mm 0 0; font-size: 16pt; color: var(--dim); }
.meta { margin-top: 22mm; border-collapse: collapse; border-top: 2px solid var(--accent); font-size: 9.5pt; }
.meta th, .meta td { text-align: left; padding: 2mm 8mm 2mm 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
.meta th { font-weight: 600; color: var(--dim); white-space: nowrap; }

.toc { break-after: page; }
.toc ol { list-style: none; padding: 0; margin: 0; font-size: 10.5pt; }
.toc li { padding: 1.4mm 0; border-bottom: 1px dotted var(--rule); }
.toc li.sub { padding-left: 9mm; font-size: 9.5pt; }
.num { display: inline-block; min-width: 9mm; color: var(--dim); font-weight: 400; }

h2 { font-size: 15pt; font-weight: 600; color: var(--accent); margin: 0 0 4mm; padding-bottom: 1.5mm; border-bottom: 1px solid var(--accent); break-after: avoid; }
h2.plain { border: 0; }
h3 { font-size: 12pt; font-weight: 600; margin: 9mm 0 3mm; break-after: avoid; }
h3.plain { margin-top: 7mm; }
.fid { font-size: 8.5pt; font-weight: 400; color: var(--dim); margin-left: 2mm; }
.block + .block, .part { margin-top: 10mm; }
.part + .block h3 { margin-top: 4mm; }
.lead { color: var(--dim); font-style: italic; margin-bottom: 3mm; }
.lead p { margin: 0; }

.req { break-inside: avoid; padding: 2.5mm 0 3mm; border-top: 1px solid var(--rule); }
.req header { display: flex; align-items: baseline; gap: 2mm; margin-bottom: 1mm; }
.rid { font-weight: 700; font-size: 9.5pt; color: var(--accent); min-width: 20mm; }
.tag { font-size: 7pt; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; padding: .3mm 1.6mm; border-radius: 1mm; border: 1px solid currentColor; }
.tag.pM { color: #fff; background: var(--accent); border-color: var(--accent); }
.tag.pS { color: var(--accent); }
.tag.pL, .tag.proposed { color: var(--dim); }
.tag.proposed { border-style: dashed; }
.text p { margin: 0; } .text p + p, .text ul, .text ol { margin-top: 1.5mm; }
.text ul, .text ol { margin-bottom: 0; padding-left: 6mm; }
.deps { margin: 1.5mm 0 0; font-size: 8.5pt; color: var(--dim); }
.deps a, .text a { color: var(--accent); }

.types { columns: 2; padding-left: 5mm; }
.summary { width: 100%; border-collapse: collapse; font-size: 9pt; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
.summary th, .summary td { padding: 1.4mm 2mm; border-bottom: 1px solid var(--rule); text-align: left; }
.summary th { color: var(--dim); font-weight: 600; border-bottom: 1px solid var(--ink); }
.summary .n { text-align: right; width: 16mm; font-variant-numeric: tabular-nums; }
.summary .total td { font-weight: 700; border-top: 1px solid var(--ink); border-bottom: 0; }
`;
