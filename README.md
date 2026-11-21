# csv-reader-speed-01 — a faster drop-in for csv-reader 1.0.0

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Puyu46/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Puyu46/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Entry for [csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121):
`run(input)` in `solve.js` returns exactly csv-reader 1.0.0's `{columns, rows,
errors}` for every `{text, header}` — same BOM handling, same record ends,
same broken-row errors (`stray_cr`, `unterminated_quote`, `quote_junk`,
`short_row`, `long_row`) with the same line/row numbers — only faster.

## How it gets faster

csv-reader reads the text one character at a time, building every field a
character at a time. This entry never visits a character twice from
JavaScript code:

- **Fast path:** a record whose first line holds no quote and no stray CR is
  answered with one `slice` plus `String.split(',')` — one native call for
  the whole record.
- **Slow path:** every other record is read field by field with
  `indexOf(',')` / `indexOf('\n')` to find each field's end and `slice` for
  the values. Quoted fields find their closing quote with `indexOf('"')`,
  skipping doubled quotes, and only normalize line breaks (`CRLF`/lone CR
  to `LF`) and doubled quotes when the content actually holds them.
- No regex, no per-character loop, no string built a character at a time.
- The driver runs with V8's incremental marking off, as the house driver does.

## Verification

On the kit's practice set (6 cases, ~10.7 MB of CSV) the entry scores
6/6 identical with the kit scorer, and its answers are byte-identical to
the house baseline's. CPU time on the same machine and input, median of 7
alternating runs (child `getrusage` user+sys): entry ~0.90 s, house baseline
~1.88 s — about **2.1x faster**.

`main.ts` reads `/input/cases.json`, answers each case alone with `run`, and
writes `/output/answers.json`.
