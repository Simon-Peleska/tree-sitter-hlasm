# tree-sitter-hlasm

A [tree-sitter](https://tree-sitter.github.io/) grammar for IBM High Level
Assembler source in fixed 80-column format, written for the IMS MFS screen
definitions (`FMT`, `DEV`, `DIV`, `DPAGE`, `DFLD`, `FMTEND`, `MSG`, `SEG`,
`MFLD`, `MSGEND`) of an IMS / MVS shop. MFS uses the assembler's statement
format, so the grammar is a generic HLASM statement grammar. It reads macros,
conditional assembly and ordinary assembler code too, without knowing any
instruction.

## What it parses

- Every line is a `statement` with an optional `name` (column 1), an
  `operation`, `operands` and `remarks`, or a `comment` (`*` or `.*` in
  column 1).
- Operands are `keyword_operand`s (`POS=(3,20)`: `key`, `value`) or
  `expression`s: `word`s, `string`s, parenthesised `list`s and `operator`s.
  Lists nest as deep as the source does and may contain blanks
  (`AIF ( ('&A' EQ 'B') ).DONE`).
- Column 72 continuation: operands go on after a comma, a string or a word
  can run into column 72 and resume in column 16, remarks continue. The
  `continuation` node covers the indicator and the indentation.
- Sequence numbers in columns 73-80 are `sequence_number` extras.
- Subscripted and created SET symbols in the name and operation fields
  (`&B(1)`, `#@IF_&LVL(&N)_X`), attribute references (`L'FIELD`, `T'&P`),
  literals (`=F'0'`).

`src/scanner.c` does the column work: every token that could run into
column 72 (words, strings, remarks, comment lines) is lexed there.

Finding the formats, messages and fields of an MFS source:

```scheme
(statement
  name: (name) @format
  operation: (operation) @op (#eq? @op "FMT"))

(statement
  name: (name) @message
  operation: (operation) @op (#eq? @op "MSG")
  operands: (operands
    (keyword_operand key: (keyword) @k (#eq? @k "SOR")
      value: (expression (list . (word) @format)))))
```

## Development

```sh
nix develop
tree-sitter generate && tree-sitter test
```

## Comparison with Che4z

The [Che4z HLASM Language Support](https://github.com/eclipse-che4z/che-che4z-lsp-for-hlasm)
language server (EPL-2.0) is the open-source reference for HLASM syntax.
No open-source parser for IMS MFS exists, but MFS sources are assembler
statements, so the same check covers them.

`test/che4z/run.sh` downloads the language server release 1.23.1 and
[z390](https://github.com/z390development/z390) (GPL-2.0, test data only, not
committed) at a pinned commit into `test/che4z/.work`. It asks the server for
its syntax diagnostics (codes `S...`) on 878 assembler sources and checks both
verdicts against the committed `baseline.tsv` with `test/compare.mjs`.
`--update` accepts new verdicts. The sources include the IMS MFS screens of
MVS 3.8J (`mvs/maclib/BNGIS*.MAC`).

```sh
nix develop -c test/che4z/run.sh
```

This grammar accepts 829 of the 878 files. The 49 it rejects are PL/S
sources mixed into the macro library (`/* ... */`, `%IF`), z390's own
syntax extensions (`:&X SETA`), z390's error tests and a few files with
unbalanced parentheses or junk lines.

Known gaps are in `GOTCHAS.md`.
