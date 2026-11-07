#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

#include <string.h>

// HLASM source is 80 columns: statement text in 1-71, a continuation
// indicator in 72, sequence numbers in 73-80. When column 72 is not blank the
// statement goes on in column 16 of the next line. Every token that could run
// into column 72 is lexed here so it stops at column 71; columns are 0-based
// below (CONTINUATION_COLUMN is column 72).

enum TokenType { WORD, STRING, REMARK, OPERAND_REMARK, COMMENT_LINE, CONTINUATION, SEQUENCE_NUMBER, ERROR_SENTINEL };

#define CONTINUATION_COLUMN 71

// Remarks after a comma end with their line; the operands go on after the
// continuation. To tell them apart the scanner remembers where the last
// continuation it lexed ended.
typedef struct {
  bool continued;
  uint32_t column;
} Scanner;

void *tree_sitter_hlasm_external_scanner_create(void) { return ts_calloc(1, sizeof(Scanner)); }
void tree_sitter_hlasm_external_scanner_destroy(void *payload) { ts_free(payload); }

unsigned tree_sitter_hlasm_external_scanner_serialize(void *payload, char *buffer) {
  memcpy(buffer, payload, sizeof(Scanner));
  return sizeof(Scanner);
}

void tree_sitter_hlasm_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *scanner = payload;
  scanner->continued = false;
  scanner->column = 0;
  if (length == sizeof(Scanner)) memcpy(scanner, buffer, sizeof(Scanner));
}

static bool at_line_end(TSLexer *lexer) {
  return lexer->eof(lexer) || lexer->lookahead == '\n' || lexer->lookahead == '\r';
}

// Letters, digits, the national characters @ # $ and whatever a code page
// turned them into (German EBCDIC shows them as § Ä Ü), `_`, `&` for variable
// symbols and `.` for concatenation, qualified names and sequence symbols.
static bool is_word_char(int32_t c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
         c == '@' || c == '#' || c == '$' || c == '_' || c == '&' || c == '.' || c > 127;
}

static bool is_attribute(int32_t c) {
  switch (c) {
    case 'L': case 'T': case 'K': case 'N': case 'D': case 'I': case 'S': case 'O':
    case 'l': case 't': case 'k': case 'n': case 'd': case 'i': case 's': case 'o':
      return true;
    default:
      return false;
  }
}

// Skips the continuation indicator, the rest of the line, the line end and
// the blanks that indent the continuation line (operands go on in column 16,
// remarks anywhere).
static void skip_continuation(TSLexer *lexer) {
  while (!at_line_end(lexer)) lexer->advance(lexer, false);
  if (lexer->lookahead == '\r') lexer->advance(lexer, false);
  if (lexer->lookahead == '\n') lexer->advance(lexer, false);
  while (lexer->lookahead == ' ') lexer->advance(lexer, false);
}

bool tree_sitter_hlasm_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  Scanner *scanner = payload;
  if (at_line_end(lexer)) return false;
  uint32_t column = lexer->get_column(lexer);
  bool just_continued = scanner->continued && scanner->column == column;
  scanner->continued = false;

  if (column >= CONTINUATION_COLUMN) {
    if (column == CONTINUATION_COLUMN && lexer->lookahead != ' ' && valid_symbols[CONTINUATION]) {
      skip_continuation(lexer);
      scanner->continued = true;
      scanner->column = lexer->get_column(lexer);
      lexer->result_symbol = CONTINUATION;
      return true;
    }
    if (!valid_symbols[SEQUENCE_NUMBER]) return false;
    while (!at_line_end(lexer)) lexer->advance(lexer, false);
    lexer->result_symbol = SEQUENCE_NUMBER;
    return true;
  }
  if (valid_symbols[ERROR_SENTINEL]) return false;

  // A `*` or `.*` in column 1 starts a comment line. Like any statement it is
  // continued when column 72 is not blank (a box of 72 asterisks swallows the
  // next line, as in HLASM).
  if (column == 0 && valid_symbols[COMMENT_LINE] && lexer->lookahead == '*') {
    while (column < CONTINUATION_COLUMN && !at_line_end(lexer)) {
      lexer->advance(lexer, false);
      column++;
    }
    lexer->result_symbol = COMMENT_LINE;
    return true;
  }
  if (column == 0 && valid_symbols[COMMENT_LINE] && lexer->lookahead == '.') {
    lexer->advance(lexer, false);
    column++;
    if (lexer->lookahead == '*') {
      while (column < CONTINUATION_COLUMN && !at_line_end(lexer)) {
        lexer->advance(lexer, false);
        column++;
      }
      lexer->result_symbol = COMMENT_LINE;
      return true;
    }
    if (!valid_symbols[WORD]) return false;
    while (column < CONTINUATION_COLUMN && is_word_char(lexer->lookahead)) {
      lexer->advance(lexer, false);
      column++;
    }
    lexer->result_symbol = WORD;
    return true;
  }

  bool operand_remark = valid_symbols[OPERAND_REMARK] && !just_continued;
  if ((valid_symbols[REMARK] || operand_remark) && lexer->lookahead != ' ') {
    while (column < CONTINUATION_COLUMN && !at_line_end(lexer)) {
      lexer->advance(lexer, false);
      column++;
    }
    lexer->result_symbol = valid_symbols[REMARK] ? REMARK : OPERAND_REMARK;
    return true;
  }

  if (valid_symbols[STRING] && lexer->lookahead == '\'') {
    lexer->advance(lexer, false);
    column++;
    for (;;) {
      if (column == CONTINUATION_COLUMN && !at_line_end(lexer)) {
        skip_continuation(lexer);
        column = lexer->get_column(lexer);
        continue;
      }
      if (at_line_end(lexer)) return false;
      if (lexer->lookahead == '\'') {
        lexer->advance(lexer, false);
        column++;
        if (lexer->lookahead != '\'' || column == CONTINUATION_COLUMN) break;
      }
      lexer->advance(lexer, false);
      column++;
    }
    lexer->result_symbol = STRING;
    return true;
  }

  if (valid_symbols[WORD] && is_word_char(lexer->lookahead)) {
    int32_t first = lexer->lookahead;
    unsigned length = 0;
    for (;;) {
      while (column < CONTINUATION_COLUMN && is_word_char(lexer->lookahead)) {
        lexer->advance(lexer, false);
        column++;
        length++;
      }
      lexer->mark_end(lexer);
      // A word that runs into column 72 goes on in column 16 of the next line.
      if (column != CONTINUATION_COLUMN || at_line_end(lexer) || lexer->lookahead == ' ') break;
      skip_continuation(lexer);
      if (!is_word_char(lexer->lookahead)) break;
      column = lexer->get_column(lexer);
    }
    // L'FIELD is the length attribute of FIELD, not L followed by a string.
    if (length == 1 && is_attribute(first) && lexer->lookahead == '\'' && column + 1 < CONTINUATION_COLUMN) {
      lexer->advance(lexer, false);
      column++;
      int32_t next = lexer->lookahead;
      // L'=C'ABC' is the length attribute of a literal.
      if (next == '=' || (is_word_char(next) && !(next >= '0' && next <= '9') && next != '.')) {
        if (next == '=') {
          lexer->result_symbol = WORD;
          lexer->mark_end(lexer);
          return true;
        }
        while (column < CONTINUATION_COLUMN && is_word_char(lexer->lookahead)) {
          lexer->advance(lexer, false);
          column++;
        }
        lexer->mark_end(lexer);
      }
    }
    lexer->result_symbol = WORD;
    return true;
  }

  return false;
}
