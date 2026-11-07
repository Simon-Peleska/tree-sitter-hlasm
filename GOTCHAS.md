# Gotchas

- The operand field ends at the first blank outside quotes and parentheses,
  and the rest is remarks. The grammar doesn't know which instructions take no
  operands, so in `LTORG  POOL HERE` the word `POOL` is an operand.
  An unpaired quote there (`CSECT  Don't`) is a parse error.
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
