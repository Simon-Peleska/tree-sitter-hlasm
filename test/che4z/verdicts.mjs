// Asks the Che4z HLASM language server for its verdict on every file in <paths file> and prints
// "path<TAB>ok|error<TAB>first syntax diagnostic" per file.
//
//   node verdicts.mjs <language server binary> <paths file>
//
// Che4z reports syntax errors with codes starting with S. Everything else (unknown macros
// without a macro library, semantic checks) is not a syntax verdict and is ignored.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const [server, pathsFile] = process.argv.slice(2);
const paths = readFileSync(pathsFile, "utf8").split("\n").filter(Boolean);

const child = spawn(server, [], { stdio: ["pipe", "pipe", "ignore"] });
child.on("exit", (code) => {
  if (code) {
    console.error(`verdicts: [CZ001] language server exited with ${code}`);
    process.exit(2);
  }
});

let nextId = 1;
const pending = new Map();
const diagnostics = new Map();

function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
}

function request(method, params) {
  const id = nextId++;
  send({ id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

let buffer = Buffer.alloc(0);
child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, headerEnd).toString())?.[1]);
    if (buffer.length < headerEnd + 4 + length) return;
    const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8"));
    buffer = buffer.subarray(headerEnd + 4 + length);
    if (message.method === "textDocument/publishDiagnostics") {
      diagnostics.set(message.params.uri, message.params.diagnostics);
    } else if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    } else if (message.id !== undefined && message.method) {
      send({ id: message.id, result: null });
    }
  }
});

const rootUri = pathToFileURL(dirname(paths[0])).href;
await request("initialize", {
  processId: process.pid,
  rootUri,
  workspaceFolders: [{ uri: rootUri, name: "corpus" }],
  capabilities: {},
});
send({ method: "initialized", params: {} });

for (const path of paths) {
  const uri = pathToFileURL(path).href;
  const text = readFileSync(path, "latin1");
  send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "hlasm", version: 1, text } } });
  // The server answers a request on a document only after analysing it, by when the
  // diagnostics for it have been published.
  await request("textDocument/documentSymbol", { textDocument: { uri } });
  const syntaxErrors = (diagnostics.get(uri) ?? []).filter((d) => /^S/.test(String(d.code ?? "")));
  send({ method: "textDocument/didClose", params: { textDocument: { uri } } });
  const first = syntaxErrors[0];
  const message = first ? `${first.range.start.line + 1}:${first.range.start.character} ${first.code} ${first.message}` : "";
  console.log(`${path}\t${first ? "error" : "ok"}\t${message.replace(/[\t\r\n]+/g, " ")}`);
}

await request("shutdown", null);
send({ method: "exit" });
