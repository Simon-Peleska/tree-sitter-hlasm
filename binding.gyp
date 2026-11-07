{
  "targets": [
    {
      "target_name": "tree_sitter_hlasm_binding",
      "include_dirs": [
        "src"
      ],
      "sources": [
        "bindings/node/binding.cc",
        "src/parser.c",
        "src/scanner.c"
      ],
      "defines": [ "_GNU_SOURCE" ],
      "conditions": [
        ["OS!='win'", {
          "cflags_c": [ "-std=c11" ]
        }]
      ]
    }
  ]
}
