# Gotchas

- The operand field ends at the first blank outside quotes and parentheses,
  and the rest is remarks. The instructions whose whole operand field HLASM
  takes as a remark (Appendix A: `ANOP`, `CSECT`, `LTORG`, `MEND`, ...) are
  listed in `src/scanner.c`, which remembers the last field it lexed: the
  operation. A macro that redefines one of them still gets remarks.
- The line after `REPRO` is data (`repro_data`), whatever it holds.
- `L'X` is an attribute reference, but `D'&INT'` is a D-type constant and
  `MAC1 L'AREA'B` a string in a macro operand, so a letter-quote-symbol run
  that ends in another quote is a word and a string. `L'*` is `L'` and `*`.
- The name and operation fields are any run of non-blanks, as in Che4z:
  z390's `:&N SETA 1`, banner lines of dashes and PL/S text that macros skip
  (`BYTES)  */`) all parse. A quoted part may hold blanks (z390:
  `'X0 AR 1,2 '  LR R2,R3`); an unpaired quote is an error.
- NUL bytes count as blanks, as in Che4z (files that went through a binary
  transfer have them).
- Che4z hides every diagnostic of a file with more than 10 of them behind one
  `SUP` diagnostic. `test/che4z/verdicts.mjs` raises that limit; without it
  most of Che4z's "errors" were suppressions, not syntax errors.
- Known differences from Che4z: it checks operands per instruction (`AIF`
  without a target, MFS `SOR=(x,IGNORE)`, operands on `AREAD`, a tab before
  the opcode), which a grammar without opcode tables can't. It doesn't check
  parentheses in model statements of unknown macros, so PL/S comment text with
  a stray `(` or `)` inside MVS macros parses there and fails here.
- Blanks inside parentheses are accepted everywhere (conditional assembly
  needs them). HLASM rejects them in ordinary operands.
- `ICTL` is ignored: columns are always 1 / 16 / 71 / 72.
- A comment line with something in column 72 continues, as in HLASM: a box
  of 72 asterisks swallows the next line into the comment.
- A word or string split at column 72 is one token whose text contains the
  line break and the indentation (`LONGN` `X` `AME`).
- Remarks after a comma end with their line. The scanner tells "operands go on
  after this continuation" apart by remembering where its last continuation
  ended, so it is stateful (`Scanner` in `src/scanner.c`).
- Code page conversions turn the national characters `@ # $` into other
  characters (German EBCDIC: `§ Ä Ü`). Any non-ASCII character counts as a
  letter in names.
- The scanner calls `get_column` at every token start, which costs some speed
  (about 4 KB/ms).
- Running `test/che4z/run.sh` executes the downloaded Che4z language server
  binary (statically linked, Linux x64).
