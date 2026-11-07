#include <node_api.h>
#include "tree_sitter/parser.h"

typedef struct TSLanguage TSLanguage;

extern "C" TSLanguage *tree_sitter_hlasm();

napi_value Init(napi_env env, napi_value exports) {
  napi_value language_wrapper;
  napi_status status;

  TSLanguage *language = tree_sitter_hlasm();
  status = napi_create_external(env, language, NULL, NULL, &language_wrapper);
  if (status != napi_ok) return NULL;

  status = napi_set_named_property(env, exports, "language", language_wrapper);
  if (status != napi_ok) return NULL;

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
