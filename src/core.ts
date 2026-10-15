// Requirements register — pure core. The shell (cli.ts) does all I/O.
//
// The register (a requirements.json) is the single source of truth for
// requirement ids. It knows nothing about issues, sprints or status of
// work: that state lives elsewhere and points here by id.

export const REQUIREMENT_TYPES = {
    FR: "Functional",
    QA: "Quality attribute",
    IF: "External interface",
    DR: "Data",
    CO: "Constraint",
    OE: "Operating environment",
};
export type RequirementType = keyof typeof REQUIREMENT_TYPES;
export type Priority = "M" | "S" | "L";
export type Status = "proposed" | "approved" | "retired";
/** Calendar date, `YYYY-MM-DD`. */
export type Day = string;

export type Feature = { id: string; title: string; note?: string };
export type Requirement = {
    id: string;
    type: RequirementType;
    /** `FE-n`; only (and always) for type FR. */
    feature?: string;
    priority?: Priority;
    status: Status;
    /** Markdown. */
    text: string;
    /** Upward links to use cases, user requirements, rules (`UC-3`, `RL-1`). */
    traces?: string[];
    /** Requirement ids this one needs. */
    dependsOn?: string[];
    note?: string;
    created: Day;
    updated: Day;
};
export type Register = { features: Feature[]; requirements: Requirement[] };

export type Result<T> =
    | { type: "ok"; value: T }
    | { type: "err"; errors: string[] };
const ok = <T>(value: T): Result<T> => ({ type: "ok", value });
const err = <T>(...errors: string[]): Result<T> => ({ type: "err", errors });

// ── parse (boundary) ──────────────────────────────────────────────────

type Obj = { [key: string]: unknown };
const isObj = (x: unknown): x is Obj =>
    typeof x === "object" && x !== null && !Array.isArray(x);
export const isStr = (x: unknown): x is string => typeof x === "string";
const isStrArr = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every(isStr);
export const isType = (x: unknown): x is RequirementType =>
    isStr(x) && x in REQUIREMENT_TYPES;
export const PRIORITIES: Priority[] = ["M", "S", "L"];
export const PRIORITY_NAMES: Record<Priority, string> = {
    M: "Must",
    S: "Should",
    L: "Later",
};
export const isPriority = (x: unknown): x is Priority =>
    x === "M" || x === "S" || x === "L";
export const isStatus = (x: unknown): x is Status =>
    x === "proposed" || x === "approved" || x === "retired";

const optional = <T>(
    o: Obj,
    key: string,
    guard: (x: unknown) => x is T,
): T | undefined | null =>
    o[key] === undefined ? undefined : guard(o[key]) ? o[key] : null;

const parseFeature = (x: unknown, i: number): Result<Feature> => {
    if (!isObj(x) || !isStr(x.id) || !isStr(x.title))
        return err(`features[${i}]: needs string id and title`);
    const note = optional(x, "note", isStr);
    if (note === null) return err(`${x.id}: note must be a string`);
    return ok({ id: x.id, title: x.title, ...(note ? { note } : {}) });
};

const parseRequirement = (x: unknown, i: number): Result<Requirement> => {
    if (!isObj(x) || !isStr(x.id))
        return err(`requirements[${i}]: needs a string id`);
    const at = x.id;
    const { type, status, text, created, updated } = x;
    if (!isType(type))
        return err(
            `${at}: type must be one of ${Object.keys(REQUIREMENT_TYPES).join(", ")}`,
        );
    if (!isStatus(status))
        return err(`${at}: status must be proposed, approved or retired`);
    if (!isStr(text) || !isStr(created) || !isStr(updated))
        return err(`${at}: needs text, created, updated`);
    const feature = optional(x, "feature", isStr);
    const priority = optional(x, "priority", isPriority);
    const traces = optional(x, "traces", isStrArr);
    const dependsOn = optional(x, "dependsOn", isStrArr);
    const note = optional(x, "note", isStr);
    if ([feature, priority, traces, dependsOn, note].includes(null))
        return err(`${at}: an optional field has the wrong type`);
    return ok({
        id: at,
        type,
        ...(feature ? { feature } : {}),
        ...(priority ? { priority } : {}),
        status,
        text,
        ...(traces?.length ? { traces } : {}),
        ...(dependsOn?.length ? { dependsOn } : {}),
        ...(note ? { note } : {}),
        created,
        updated,
    });
};

const collect = <T>(results: Result<T>[]): Result<T[]> => {
    const errors = results.flatMap((r) => (r.type === "err" ? r.errors : []));
    return errors.length
        ? err(...errors)
        : ok(results.flatMap((r) => (r.type === "ok" ? [r.value] : [])));
};

/** JSON text to a checked register. */
export const parseRegister = (json: string): Result<Register> => {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch (e) {
        return err(`not valid JSON: ${String(e)}`);
    }
    if (
        !isObj(raw) ||
        !Array.isArray(raw.features) ||
        !Array.isArray(raw.requirements)
    )
        return err("expected { features: [], requirements: [] }");
    const features = collect(raw.features.map(parseFeature));
    const requirements = collect(raw.requirements.map(parseRequirement));
    if (features.type === "err" || requirements.type === "err")
        return err(
            ...(features.type === "err" ? features.errors : []),
            ...(requirements.type === "err" ? requirements.errors : []),
        );
    return check({
        features: features.value,
        requirements: requirements.value,
    });
};

// ── ids ───────────────────────────────────────────────────────────────

const FR_ID = /^FR-(\d+|OP)\.(\d+)$/;
const OTHER_ID = /^(QA|IF|DR|CO|OE)-(\d+)$/;
const FE_ID = /^FE-(\d+|OP)$/;

/** The feature number (or `OP`) and serial of an id, if well formed for its type. */
const idParts = (
    r: Pick<Requirement, "id" | "type">,
): { scope: string; serial: number } | undefined => {
    const m = r.type === "FR" ? r.id.match(FR_ID) : r.id.match(OTHER_ID);
    if (!m || (r.type !== "FR" && m[1] !== r.type)) return undefined;
    return {
        scope: r.type === "FR" ? `FE-${m[1]}` : r.type,
        serial: Number(m[2]),
    };
};

/** Next id: one above the highest serial ever used in the scope. Retired ids count, so ids never repeat. */
export const nextId = (
    reg: Register,
    type: RequirementType,
    feature?: string,
): string => {
    const scope = type === "FR" ? (feature ?? "") : type;
    const max = Math.max(
        0,
        ...reg.requirements
            .map(idParts)
            .filter((p) => p?.scope === scope)
            .map((p) => p?.serial ?? 0),
    );
    return type === "FR"
        ? `FR-${scope.slice(3)}.${max + 1}`
        : `${type}-${max + 1}`;
};

export const nextFeatureId = (reg: Register): string =>
    `FE-${Math.max(0, ...reg.features.map((f) => Number(f.id.match(FE_ID)?.[1]) || 0)) + 1}`;

// ── check (invariants) ────────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const cycleFrom = (
    byId: Map<string, Requirement>,
    start: string,
): string[] | undefined => {
    const walk = (id: string, path: string[]): string[] | undefined => {
        if (path.includes(id)) return [...path, id];
        return (byId.get(id)?.dependsOn ?? [])
            .map((d) => walk(d, [...path, id]))
            .find(Boolean);
    };
    return walk(start, []);
};

/** Matches every well-formed requirement id in a text. */
export const ID_IN_TEXT = /\b(FR-(?:\d+|OP)\.\d+|(?:QA|IF|DR|CO|OE)-\d+)\b/g;

export const EMPTY: Register = { features: [], requirements: [] };

export const check = (reg: Register): Result<Register> => {
    const byId = new Map(reg.requirements.map((r) => [r.id, r]));
    const featureIds = new Set(reg.features.map((f) => f.id));
    const dupes = (ids: string[]) =>
        ids.filter((id, i) => ids.indexOf(id) !== i);
    const errors = [
        ...dupes(reg.features.map((f) => f.id)).map(
            (id) => `${id}: duplicate feature id`,
        ),
        ...reg.features
            .filter((f) => !FE_ID.test(f.id))
            .map((f) => `${f.id}: feature ids look like FE-n`),
        ...dupes(reg.requirements.map((r) => r.id)).map(
            (id) => `${id}: duplicate requirement id`,
        ),
        ...reg.requirements.flatMap((r) => {
            const parts = idParts(r);
            const deps = r.dependsOn ?? [];
            return [
                ...(parts ? [] : [`${r.id}: id does not match type ${r.type}`]),
                ...(r.type === "FR" && parts && r.feature !== parts.scope
                    ? [`${r.id}: feature must be ${parts.scope}`]
                    : []),
                ...(r.type === "FR" && r.feature && !featureIds.has(r.feature)
                    ? [`${r.id}: unknown feature ${r.feature}`]
                    : []),
                ...(r.type !== "FR" && r.feature
                    ? [`${r.id}: only FR requirements have a feature`]
                    : []),
                ...(r.text.trim() ? [] : [`${r.id}: empty text`]),
                ...(DAY.test(r.created) && DAY.test(r.updated)
                    ? []
                    : [`${r.id}: dates must be YYYY-MM-DD`]),
                ...(r.created <= r.updated
                    ? []
                    : [`${r.id}: updated is before created`]),
                ...deps
                    .filter((d) => !byId.has(d))
                    .map((d) => `${r.id}: depends on unknown ${d}`),
                ...(r.status !== "retired"
                    ? deps
                          .filter((d) => byId.get(d)?.status === "retired")
                          .map((d) => `${r.id}: depends on retired ${d}`)
                    : []),
            ];
        }),
        ...[
            ...new Set(
                reg.requirements
                    .map((r) => cycleFrom(byId, r.id)?.join(" -> "))
                    .filter(isStr),
            ),
        ].map((c) => `dependency cycle: ${c}`),
    ];
    return errors.length ? err(...errors) : ok(reg);
};

// ── commands (each returns the next register or why not) ──────────────

export const TYPE_ORDER = Object.keys(REQUIREMENT_TYPES);
const sortKey = (r: Requirement): number[] => {
    const p = idParts(r);
    const scope = p?.scope.startsWith("FE-")
        ? Number(p.scope.slice(3)) || 999
        : 0;
    return [TYPE_ORDER.indexOf(r.type), scope, p?.serial ?? 0];
};
const byKey = (a: Requirement, b: Requirement): number => {
    const [ka, kb] = [sortKey(a), sortKey(b)];
    return ka.map((x, i) => x - (kb[i] ?? 0)).find((d) => d !== 0) ?? 0;
};
/** Canonical order, so diffs stay small: type, then feature, then serial. */
export const canonical = (reg: Register): Register => ({
    features: reg.features,
    requirements: [...reg.requirements].sort(byKey),
});

export type AddRequirement = {
    type: RequirementType;
    feature?: string;
    priority?: Priority;
    text: string;
    traces?: string[];
    dependsOn?: string[];
    note?: string;
};

export const addRequirement = (
    reg: Register,
    cmd: AddRequirement,
    today: Day,
): Result<{ register: Register; id: string }> => {
    if (cmd.type === "FR" && !cmd.feature)
        return err("an FR requirement needs --feature FE-n");
    const id = nextId(reg, cmd.type, cmd.feature);
    const added: Requirement = {
        id,
        ...cmd,
        ...(cmd.type === "FR" ? {} : { feature: undefined }),
        status: "proposed",
        created: today,
        updated: today,
    };
    const next = check(
        canonical({
            ...reg,
            requirements: [...reg.requirements, stripEmpty(added)],
        }),
    );
    return next.type === "ok" ? ok({ register: next.value, id }) : next;
};

export type UpdateRequirement = Partial<
    Pick<Requirement, "priority" | "text" | "traces" | "dependsOn" | "note">
>;

const change = (
    reg: Register,
    id: string,
    today: Day,
    f: (r: Requirement) => Result<Requirement>,
): Result<Register> => {
    const current = reg.requirements.find((r) => r.id === id);
    if (!current) return err(`${id}: no such requirement`);
    const changed = f(current);
    if (changed.type === "err") return changed;
    const updated = stripEmpty({ ...changed.value, updated: today });
    return check({
        ...reg,
        requirements: reg.requirements.map((r) => (r.id === id ? updated : r)),
    });
};

export const updateRequirement = (
    reg: Register,
    id: string,
    cmd: UpdateRequirement,
    today: Day,
): Result<Register> =>
    change(reg, id, today, (r) =>
        r.status === "retired"
            ? err(`${id}: retired; add a new requirement instead`)
            : ok({ ...r, ...cmd }),
    );

export const approveRequirement = (
    reg: Register,
    id: string,
    today: Day,
): Result<Register> =>
    change(reg, id, today, (r) =>
        r.status === "proposed"
            ? ok({ ...r, status: "approved" })
            : err(`${id}: is ${r.status}, not proposed`),
    );

export const retireRequirement = (
    reg: Register,
    id: string,
    reason: string,
    today: Day,
): Result<Register> =>
    change(reg, id, today, (r) =>
        r.status === "retired"
            ? err(`${id}: already retired`)
            : ok({
                  ...r,
                  status: "retired",
                  note: [r.note, `Retired ${today}: ${reason}`]
                      .filter(isStr)
                      .join(" "),
              }),
    );

export const addFeature = (
    reg: Register,
    title: string,
    note?: string,
): Result<{ register: Register; id: string }> => {
    const id = nextFeatureId(reg);
    return ok({
        register: {
            ...reg,
            features: [
                ...reg.features,
                { id, title, ...(note ? { note } : {}) },
            ],
        },
        id,
    });
};

const stripEmpty = (r: Requirement): Requirement => {
    const { feature, priority, traces, dependsOn, note, ...rest } = r;
    return {
        ...rest,
        ...(feature ? { feature } : {}),
        ...(priority ? { priority } : {}),
        ...(traces?.length ? { traces } : {}),
        ...(dependsOn?.length ? { dependsOn } : {}),
        ...(note ? { note } : {}),
    };
};

/** Stable JSON in the repo's format: field order fixed, string lists on one line. */
export const serialize = (reg: Register): string => {
    const order = [
        "id",
        "type",
        "feature",
        "priority",
        "status",
        "text",
        "traces",
        "dependsOn",
        "note",
        "created",
        "updated",
    ];
    const ordered = (_k: string, v: unknown) =>
        isObj(v) && "id" in v && "type" in v
            ? Object.fromEntries(
                  order.filter((k) => k in v).map((k) => [k, v[k]]),
              )
            : v;
    const json = JSON.stringify(canonical(reg), ordered, 4).replace(
        /\[\n\s+("[^"\n]*"(?:,\n\s+"[^"\n]*")*)\n\s+\]/g,
        (_m, items: string) => `[${items.split(/,\n\s+/).join(", ")}]`,
    );
    return `${json}\n`;
};
