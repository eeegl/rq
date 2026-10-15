// The live register page (`rq html`, `rq serve`) — pure. Every requirement
// a table row with its own anchor.

import { marked } from "marked";
import * as Req from "./core.ts";

export const esc = (s: string): string =>
    s.replace(
        /[&<>"]/g,
        (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
    );
const link = (id: string): string => `<a href="#${esc(id)}">${esc(id)}</a>`;

/** Markdown to HTML, with every known requirement id linked to its anchor. */
export const md = (text: string, known: Set<string>): string =>
    marked.parse(
        text.replace(Req.ID_IN_TEXT, (id) =>
            known.has(id) ? `[${id}](#${id})` : id,
        ),
        { async: false },
    );

export type RenderOptions = { liveReload: boolean; source: string };

export const renderHtml = (reg: Req.Register, opts: RenderOptions): string => {
    const known = new Set(reg.requirements.map((r) => r.id));
    const neededBy = (id: string) =>
        reg.requirements
            .filter((r) => r.dependsOn?.includes(id))
            .map((r) => r.id);
    const row = (
        r: Req.Requirement,
    ): string => `<tr id="${esc(r.id)}" class="${r.status}">
<td class="id"><a href="#${esc(r.id)}">${esc(r.id)}</a></td>
<td>${r.priority ?? "–"}</td><td>${r.status}</td>
<td class="text">${md(r.text, known)}${r.note ? `<p class="note">${esc(r.note)}</p>` : ""}</td>
<td>${(r.dependsOn ?? []).map(link).join(" ")}</td><td>${neededBy(r.id).map(link).join(" ")}</td>
<td>${esc((r.traces ?? []).join(", "))}</td><td class="day">${r.created}</td><td class="day">${r.updated}</td></tr>`;
    const table = (
        rows: Req.Requirement[],
    ): string => `<div class="scroll"><table><thead><tr>
<th>Id</th><th>Prio</th><th>Status</th><th>Requirement</th><th>Depends on</th><th>Needed by</th><th>Traces</th><th>Created</th><th>Updated</th>
</tr></thead><tbody>${rows.map(row).join("\n")}</tbody></table></div>`;
    const sorted = Req.canonical(reg).requirements;
    const featureSections = reg.features
        .map((f) => ({ f, rows: sorted.filter((r) => r.feature === f.id) }))
        .filter(({ rows }) => rows.length)
        .map(
            ({ f, rows }) =>
                `<h3 id="${esc(f.id)}">${esc(f.id)} ${esc(f.title)}</h3>${f.note ? `<p class="note">${esc(f.note)}</p>` : ""}${table(rows)}`,
        );
    const typeSections = Req.TYPE_ORDER.filter(Req.isType)
        .filter((t) => t !== "FR")
        .map((t) => ({ t, rows: sorted.filter((r) => r.type === t) }))
        .filter(({ rows }) => rows.length)
        .map(
            ({ t, rows }) =>
                `<h2 id="${t}">${t} ${Req.REQUIREMENT_TYPES[t]}</h2>${table(rows)}`,
        );
    const counts = Req.PRIORITIES.map(
        (p) =>
            `${p} ${sorted.filter((r) => r.priority === p && r.status !== "retired").length}`,
    ).join(" · ");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Requirements</title><style>${CSS}</style></head><body><main>
<h1>Requirements</h1><p class="meta">${sorted.length} requirements · ${counts} · source: ${esc(opts.source)}</p>
<h2 id="FR">FR Functional</h2>${featureSections.join("\n")}
${typeSections.join("\n")}
</main>${opts.liveReload ? `<script>new EventSource("/events").onmessage = () => location.reload();</script>` : ""}</body></html>`;
};

const CSS = `
:root { color-scheme: light dark; --bg: #fbfbf9; --fg: #1d1d1b; --dim: #6b6b66; --line: #e2e2dc; --hl: #fff3c4; }
@media (prefers-color-scheme: dark) { :root { --bg: #171716; --fg: #e8e8e3; --dim: #9a9a93; --line: #2e2e2b; --hl: #4a4220; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
main { max-width: 90rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { margin: 0 0 .25rem; } h2 { margin-top: 2.5rem; } h3 { margin-top: 1.75rem; }
.meta, .note { color: var(--dim); } .note { font-size: 13px; margin: .25rem 0 0; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; min-width: 60rem; table-layout: fixed; }
th:nth-child(1) { width: 6.5rem; } th:nth-child(2) { width: 3rem; } th:nth-child(3) { width: 5.5rem; }
th:nth-child(5), th:nth-child(6) { width: 7rem; } th:nth-child(7) { width: 6rem; } th:nth-child(8), th:nth-child(9) { width: 6.5rem; }
th, td { text-align: left; vertical-align: top; padding: .4rem .6rem; border-bottom: 1px solid var(--line); }
th { font-weight: 600; color: var(--dim); white-space: nowrap; }
td.text p { margin: 0; } td.text p + p { margin-top: .25rem; }
td.id, td.day { white-space: nowrap; font-variant-numeric: tabular-nums; }
a { color: inherit; } td.id a { font-weight: 600; text-decoration: none; }
tr:target { background: var(--hl); }
tr.retired { color: var(--dim); text-decoration: line-through; }
tr.proposed td.id::after { content: " ?"; color: var(--dim); }
`;
