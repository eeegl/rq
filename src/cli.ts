// Requirements register — the CLI shell. `run` turns arguments into an
// Outcome (pure); `perform` carries it out (I/O). Logic lives in core.ts,
// html.ts and doc.ts.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import * as Req from "./core.ts";
import * as Doc from "./doc.ts";
import * as Html from "./html.ts";

const HELP = `rq: requirements register

  rq init                           create an empty requirements.json here
  rq list [--type T] [--feature FE-n] [--priority M|S|L] [--status S]
  rq show <id>
  rq add --type T [--feature FE-n] --text "markdown" [--priority M|S|L]
         [--depends ID,ID] [--traces UC-1,RL-2] [--note "..."]
  rq update <id> [--text] [--priority] [--depends] [--traces] [--note]
  rq approve <id>                   proposed -> approved
  rq retire <id> --reason "..."     the id is never reused
  rq add-feature --title "..." [--note "..."]
  rq check                          validate the register
  rq html [--out file]              static page (stdout by default)
  rq serve [--port 4100]            page that reloads when the file changes
  rq pdf [--out requirements.pdf]   document for customers (needs Chrome)
         [--title "..."] [--subtitle "..."] [--client "..."] [--author "..."]
         [--doc-version 1.0] [--classification Confidential]
         [--status approved]        default: approved,proposed
                                    notes, traces and dates are left out

The register: --file, else $RQ_FILE, else the nearest requirements.json
or docs/requirements/requirements.json in this directory or above.

Types: ${Object.entries(Req.REQUIREMENT_TYPES)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}.
New requirements start as proposed. Ids: FR-<feature>.<n>, otherwise <TYPE>-<n>.`;

type Outcome =
    | { type: "print"; text: string }
    | { type: "create"; file: string; text: string }
    | { type: "pdf"; file: string; html: string }
    | { type: "save"; register: Req.Register; text: string }
    | { type: "writeFile"; file: string; text: string }
    | { type: "serve"; port: number }
    | { type: "fail"; errors: string[] };

const fail = (...errors: string[]): Outcome => ({ type: "fail", errors });
const saved = <T>(
    r: Req.Result<T>,
    register: (v: T) => Req.Register,
    text: (v: T) => string,
): Outcome =>
    r.type === "ok"
        ? { type: "save", register: register(r.value), text: text(r.value) }
        : fail(...r.errors);

const list = (s: string | undefined): string[] | undefined =>
    s
        ?.split(",")
        .map((x) => x.trim())
        .filter(Boolean);

const line = (r: Req.Requirement): string =>
    `${r.id.padEnd(9)} ${(r.priority ?? "-").padEnd(2)}${r.status.padEnd(9)} ${r.text.replace(/\s+/g, " ").slice(0, 100)}`;

type Opts = { [key: string]: string | undefined };

const run = (
    cmd: string | undefined,
    id: string | undefined,
    o: Opts,
    file: string | undefined,
    loaded: Req.Result<Req.Register>,
    today: Req.Day,
): Outcome => {
    if (cmd === undefined || cmd === "help")
        return { type: "print", text: HELP };
    if (cmd === "init")
        return {
            type: "create",
            file: o.file ?? "requirements.json",
            text: Req.serialize(Req.EMPTY),
        };
    if (cmd === "serve") return { type: "serve", port: Number(o.port ?? 4100) };
    if (loaded.type === "err") return fail(...loaded.errors);
    const reg = loaded.value;
    if (o.priority !== undefined && !Req.isPriority(o.priority))
        return fail("--priority must be M, S or L");
    const priority = Req.isPriority(o.priority) ? o.priority : undefined;
    const needId = (f: (id: string) => Outcome): Outcome =>
        id ? f(id) : fail(`${cmd} needs an id`);
    const unchanged = (r: Req.Result<Req.Register>, verb: string): Outcome =>
        saved(
            r,
            (v) => v,
            () => `${verb} ${id}`,
        );

    switch (cmd) {
        case "check":
            return {
                type: "print",
                text: `ok: ${reg.requirements.length} requirements, ${reg.features.length} features`,
            };
        case "list": {
            const keep = (r: Req.Requirement) =>
                (o.type === undefined || r.type === o.type) &&
                (o.feature === undefined || r.feature === o.feature) &&
                (priority === undefined || r.priority === priority) &&
                (o.status === undefined || r.status === o.status);
            return {
                type: "print",
                text: reg.requirements.filter(keep).map(line).join("\n"),
            };
        }
        case "show":
            return needId((id) => {
                const r = reg.requirements.find((x) => x.id === id);
                return r
                    ? { type: "print", text: JSON.stringify(r, null, 2) }
                    : fail(`${id}: no such requirement`);
            });
        case "html": {
            const text = Html.renderHtml(reg, {
                liveReload: false,
                source: file ?? "",
            });
            return o.out
                ? { type: "writeFile", file: o.out, text }
                : { type: "print", text };
        }
        case "pdf": {
            const statuses = list(o.status) ?? ["approved", "proposed"];
            if (!statuses.every(Req.isStatus))
                return fail("--status takes approved, proposed or retired");
            return {
                type: "pdf",
                file: o.out ?? "requirements.pdf",
                html: Doc.renderDocument(reg, {
                    title: o.title ?? "Requirements Specification",
                    subtitle: o.subtitle,
                    client: o.client,
                    author: o.author,
                    version: o["doc-version"],
                    classification: o.classification,
                    date: today,
                    statuses: statuses.filter(Req.isStatus),
                }),
            };
        }
        case "add": {
            const { type, text } = o;
            if (!Req.isType(type) || !text)
                return fail("add needs --type and --text");
            const cmd = {
                type,
                feature: o.feature,
                priority,
                text,
                traces: list(o.traces),
                dependsOn: list(o.depends),
                note: o.note,
            };
            return saved(
                Req.addRequirement(reg, cmd, today),
                (v) => v.register,
                (v) => `added ${v.id} (proposed)`,
            );
        }
        case "update":
            return needId((id) => {
                const fields = {
                    text: o.text,
                    priority,
                    note: o.note,
                    traces: list(o.traces),
                    dependsOn: list(o.depends),
                };
                const given = Object.fromEntries(
                    Object.entries(fields).filter(([, v]) => v !== undefined),
                );
                return unchanged(
                    Req.updateRequirement(reg, id, given, today),
                    "updated",
                );
            });
        case "approve":
            return needId((id) =>
                unchanged(Req.approveRequirement(reg, id, today), "approved"),
            );
        case "retire":
            return needId((id) =>
                o.reason
                    ? unchanged(
                          Req.retireRequirement(reg, id, o.reason, today),
                          "retired",
                      )
                    : fail("retire needs --reason"),
            );
        case "add-feature":
            return o.title
                ? saved(
                      Req.addFeature(reg, o.title, o.note),
                      (v) => v.register,
                      (v) => `added ${v.id}`,
                  )
                : fail("add-feature needs --title");
        default:
            return fail(`unknown command ${cmd}; try rq help`);
    }
};

const RELOAD = `<script>new EventSource("/events").onmessage = () => location.reload();</script>`;

const serve = (file: string, port: number): void => {
    const clients = new Set<http.ServerResponse>();
    fs.watch(file, () => {
        for (const c of clients) c.write("data: reload\n\n");
    });
    http.createServer((req, res) => {
        if (req.url === "/events") {
            res.writeHead(200, {
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
            });
            clients.add(res);
            req.on("close", () => clients.delete(res));
            return;
        }
        const reg = Req.parseRegister(fs.readFileSync(file, "utf8"));
        res.writeHead(reg.type === "ok" ? 200 : 500, {
            "content-type": "text/html; charset=utf-8",
        });
        res.end(
            reg.type === "ok"
                ? Html.renderHtml(reg.value, { liveReload: true, source: file })
                : `<pre>${reg.errors.join("\n")}</pre>${RELOAD}`,
        );
    }).listen(port, () => console.log(`http://localhost:${port}`));
};

const CHROMES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ...[
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
    ].flatMap((name) =>
        (process.env.PATH ?? "")
            .split(path.delimiter)
            .map((dir) => path.join(dir, name)),
    ),
];

const findChrome = (): string | undefined =>
    [process.env.CHROME_PATH, ...CHROMES]
        .filter(Req.isStr)
        .find((p) => fs.existsSync(p));

/** Prints `html` to `file` with headless Chrome; returns why not, if it failed. */
const printPdf = (html: string, file: string): string | undefined => {
    const chrome = findChrome();
    if (!chrome) return "no Chrome or Chromium found; set CHROME_PATH";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rq-"));
    const page = path.join(tmp, "requirements.html");
    fs.writeFileSync(page, html);
    const run = spawnSync(chrome, [
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        "--generate-pdf-document-outline",
        `--user-data-dir=${path.join(tmp, "profile")}`,
        `--print-to-pdf=${path.resolve(file)}`,
        pathToFileURL(page).href,
    ]);
    fs.rmSync(tmp, { recursive: true, force: true });
    return run.status === 0
        ? undefined
        : `Chrome failed: ${run.error?.message ?? run.stderr.toString().trim()}`;
};

/** The register's path, or undefined when there is none to be found. */
const locate = (given: string | undefined): string | undefined => {
    if (given) return path.resolve(given);
    const up = (dir: string): string | undefined =>
        ["requirements.json", "docs/requirements/requirements.json"]
            .map((f) => path.join(dir, f))
            .find((f) => fs.existsSync(f)) ??
        (path.dirname(dir) === dir ? undefined : up(path.dirname(dir)));
    return up(process.cwd());
};

const load = (file: string | undefined): Req.Result<Req.Register> =>
    file === undefined
        ? {
              type: "err",
              errors: [
                  "no requirements.json found; run rq init or pass --file",
              ],
          }
        : fs.existsSync(file)
          ? Req.parseRegister(fs.readFileSync(file, "utf8"))
          : { type: "err", errors: [`${file}: no such file`] };

const perform = (out: Outcome, file: string | undefined): void => {
    const failed = (...errors: string[]) =>
        perform({ type: "fail", errors }, file);
    switch (out.type) {
        case "print":
            console.log(out.text);
            break;
        case "create":
            if (fs.existsSync(out.file)) {
                failed(`${out.file} already exists`);
                break;
            }
            fs.writeFileSync(out.file, out.text);
            console.log(`created ${out.file}`);
            break;
        case "pdf": {
            const why = printPdf(out.html, out.file);
            if (why) {
                failed(why);
                break;
            }
            console.log(`wrote ${out.file}`);
            break;
        }
        case "save":
            if (!file) {
                failed("no register to save to");
                break;
            }
            fs.writeFileSync(file, Req.serialize(out.register));
            console.log(out.text);
            break;
        case "writeFile":
            fs.writeFileSync(out.file, out.text);
            break;
        case "serve":
            if (!file) {
                failed("no register to serve");
                break;
            }
            serve(file, out.port);
            break;
        case "fail":
            for (const e of out.errors) console.error(`error: ${e}`);
            process.exitCode = 1;
    }
};

const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: Object.fromEntries(
        [
            "type",
            "feature",
            "priority",
            "status",
            "text",
            "depends",
            "traces",
            "note",
            "reason",
            "title",
            "out",
            "port",
            "file",
            "subtitle",
            "client",
            "author",
            "doc-version",
            "classification",
        ].map((k) => [k, { type: "string" }]),
    ),
});
const opts: Opts = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
        k,
        typeof v === "string" ? v : undefined,
    ]),
);
const [cmd, id] = positionals;
const file = locate(opts.file ?? process.env.RQ_FILE);
perform(
    run(
        cmd,
        id,
        opts,
        file,
        load(file),
        new Date().toLocaleDateString("sv-SE"),
    ),
    file,
);
