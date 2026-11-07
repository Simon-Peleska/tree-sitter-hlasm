/**
 * @file IBM High Level Assembler (HLASM) grammar for tree-sitter, including IMS MFS
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// HLASM is column based: a statement continues on the next line when column 72
// is not blank, and columns 73-80 are ignored. A grammar rule can't see
// columns, so src/scanner.c lexes every token that could run into column 72
// (words, strings, remarks, comment lines) and the continuation itself. Blanks
// separate name, operation, operands and remarks, so they are spelled out.

module.exports = grammar({
  name: 'hlasm',

  externals: $ => [
    $._word,
    $.string,
    $._remark,
    $._operand_remark,
    $._comment_line,
    $.continuation,
    $.sequence_number,
    $._error_sentinel,
    $._field,
  ],

  extras: $ => [$.continuation, $.sequence_number],

  conflicts: $ => [],

  rules: {
    source_file: $ => seq(
      optional($._line),
      repeat(seq($._newline, optional($._line))),
    ),

    _line: $ => choice($.statement, $.comment, $._blank),

    statement: $ => seq(
      optional(field('name', $.name)),
      $._blank,
      field('operation', $.operation),
      optional(seq(
        $._blank,
        optional(seq(
          field('operands', $.operands),
          optional(seq($._blank, optional(field('remarks', $.remarks)))),
        )),
      )),
    ),

    // An operand may be empty (`A,,B`). Remarks may follow a comma when the
    // line is continued; they end with the line and the operands go on.
    operands: $ => choice(
      seq($._operand, repeat($._next_operand)),
      repeat1($._next_operand),
    ),

    _next_operand: $ => prec.right(seq(
      ',',
      optional(seq($._blank, optional(field('remarks', alias($._operand_remark, $.remarks))))),
      optional($._operand),
    )),

    _operand: $ => choice($.keyword_operand, $.expression),

    keyword_operand: $ => prec.right(1, seq(
      field('key', alias($._word, $.keyword)),
      '=',
      optional(field('value', $.expression)),
    )),

    expression: $ => prec.right(repeat1($._term)),

    _term: $ => choice($.word, $.string, $.list, $.operator),

    // Inside parentheses conditional assembly allows blanks between terms:
    // AIF ( ('&A' EQ 'B') AND (&N GT 1) ).DONE
    list: $ => seq('(', repeat(choice($._list_item, ',', $._blank)), ')'),

    _list_item: $ => choice($.keyword_operand, $._term),

    // Name and operation are any run of non-blanks: &B(1), :&X (z390), */ in
    // PL/S text that a macro skips. Whether they make sense is semantics.
    name: $ => $._field,
    operation: $ => $._field,

    word: $ => $._word,

    // `=` starts a literal (=F'1') and may stand anywhere in a macro operand.
    operator: _ => /[=+\-*\/<>¬|!?:;%"\\]/,

    remarks: $ => repeat1($._remark),

    comment: $ => seq($._comment_line, repeat($._remark)),

    _blank: _ => /[ \t\x00]+/,
    _newline: _ => /\r?\n/,
  },
});
