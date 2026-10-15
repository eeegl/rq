# rq

A requirements register in one JSON file: permanent ids, priorities
(Must/Should/Later), dependencies, `proposed -> approved -> retired`. Read it
as a live page, or print a PDF to send to customers.

```sh
pnpm install && pnpm link --global   # Node >= 24, runs the TypeScript directly
rq init                              # requirements.json in this directory
rq add-feature --title "Sign-in"
rq add --type FR --feature FE-1 --priority M --text "The system shall ..."
rq serve                             # http://localhost:4100, reloads on change
rq pdf --subtitle "Project" --client "Customer AB" --author "Us" \
       --doc-version 1.0 --classification Confidential
```

`rq help` lists every command. The PDF needs Chrome, Chromium or Edge
(`CHROME_PATH` to override). It includes approved and proposed requirements
(proposed ones are marked, and the cover says draft); `--status approved`
sends only approved ones. Notes, traces and dates stay internal.

Layout: `src/core.ts` register logic, `src/html.ts` live page,
`src/doc.ts` customer document (all pure); `src/cli.ts` the shell.
`pnpm check` typechecks, lints and tests.
