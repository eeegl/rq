import assert from "node:assert/strict";
import { test } from "node:test";
import * as Req from "../src/core.ts";
import * as Doc from "../src/doc.ts";

const day = "2026-10-15";
const value = <T>(r: Req.Result<T>): T => {
    if (r.type === "err") throw new Error(r.errors.join("; "));
    return r.value;
};

const withFeature = value(Req.addFeature(Req.EMPTY, "Sign-in")).register;
const add = (reg: Req.Register, text: string) =>
    value(Req.addRequirement(reg, { type: "FR", feature: "FE-1", text }, day));

test("a retired id is never reused", () => {
    const first = add(withFeature, "The system shall A.");
    const retired = value(
        Req.retireRequirement(first.register, first.id, "obsolete", day),
    );
    assert.equal(add(retired, "The system shall B.").id, "FR-1.2");
});

test("depending on a retired requirement is refused", () => {
    const a = add(withFeature, "A.");
    const b = value(
        Req.addRequirement(
            a.register,
            { type: "QA", text: "B.", dependsOn: [a.id] },
            day,
        ),
    );
    assert.equal(
        Req.retireRequirement(b.register, a.id, "gone", day).type,
        "err",
    );
});

test("serialize and parse round-trip", () => {
    const { register } = add(withFeature, "The system shall A.");
    assert.deepEqual(
        value(Req.parseRegister(Req.serialize(register))),
        register,
    );
});

test("the customer document leaves out retired requirements and notes", () => {
    const a = add(withFeature, "Kept.");
    const b = add(a.register, "Dropped.");
    const reg = value(
        Req.retireRequirement(
            value(
                Req.updateRequirement(
                    b.register,
                    a.id,
                    { note: "internal" },
                    day,
                ),
            ),
            b.id,
            "x",
            day,
        ),
    );
    const html = Doc.renderDocument(reg, {
        title: "Spec",
        date: day,
        statuses: ["approved", "proposed"],
    });
    assert.match(html, /Kept\./);
    assert.doesNotMatch(html, /Dropped\.|internal/);
});
