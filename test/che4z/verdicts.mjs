// Asks the Che4z HLASM language server for its verdict on every file in <paths file> and prints
// "path<TAB>ok|error<TAB>first syntax diagnostic" per file.
//
//   node verdicts.mjs <language server binary> <paths file>
//
// Che4z reports syntax errors with codes starting with S. Everything else (unknown macros
// without a macro library, semantic checks) is not a syntax verdict and is ignored.
//
// Some files send Che4z into an endless loop that eats memory without bound (rt/test/TESTAIN3.MLC:
// a macro that AINSERTs a COPY of itself grew past 118 GB and took the desktop down). A file that
// isn't analysed within FILE_TIMEOUT_MS is left out of the verdicts, and the server is restarted.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const FILE_TIMEOUT_MS = 10_000;

const [serverBinary, pathsFile] = process.argv.slice(2);
const paths = readFileSync(pathsFile, "utf8").split("\n").filter(Boolean);
const rootUri = pathToFileURL(dirname(paths[0])).href;

async function startServer() {
  const child = spawn(serverBinary, [], { stdio: ["pipe", "pipe", "ignore"] });
  const server = { child, killed: false, nextId: 1, pending: new Map(), diagnostics: new Map() };
  child.on("exit", (code) => {
    if (server.killed) return;
    console.error(`verdicts: [CZ001] language server exited with ${code}`);
    process.exit(2);
  });
  // Writes to a server killed after a timeout fail; that server is abandoned anyway.
  child.stdin.on("error", () => {});

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
        server.diagnostics.set(message.params.uri, message.params.diagnostics);
      } else if (message.method === "workspace/configuration") {
        // The server's requests have ids of their own, which collide with ours, so they are
        // told apart by their method. It analyses nothing until this one is answered.
        send(server, { id: message.id, result: message.params.items.map(() => null) });
      } else if (message.method !== undefined) {
        if (message.id !== undefined) send(server, { id: message.id, result: null });
      } else if (server.pending.has(message.id)) {
        const { resolve, reject } = server.pending.get(message.id);
        server.pending.delete(message.id);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      }
    }
  });

  await request(server, "initialize", {
    processId: process.pid,
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: "corpus" }],
    capabilities: {},
  });
  send(server, { method: "initialized", params: {} });
  return server;
}

function send(server, message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
  server.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  server.child.stdin.write(body);
}

function request(server, method, params) {
  const id = server.nextId++;
  send(server, { id, method, params });
  return new Promise((resolve, reject) => server.pending.set(id, { resolve, reject }));
}

function stopServer(server) {
  server.killed = true;
  server.child.kill("SIGKILL");
}

let server = await startServer();
let timedOut = 0;

for (const path of paths) {
  const uri = pathToFileURL(path).href;
  const text = readFileSync(path, "latin1");
  send(server, { method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "hlasm", version: 1, text } } });
  // The server answers a request on a document only after analysing it, by when the
  // diagnostics for it have been published.
  let timer;
  const analysed = await Promise.race([
    request(server, "textDocument/documentSymbol", { textDocument: { uri } }).then(() => true),
    new Promise((resolve) => (timer = setTimeout(() => resolve(false), FILE_TIMEOUT_MS))),
  ]);
  clearTimeout(timer);

  if (!analysed) {
    console.error(`verdicts: [CZ002] no verdict for ${path} within ${FILE_TIMEOUT_MS} ms; restarting the server`);
    timedOut++;
    stopServer(server);
    server = await startServer();
    continue;
  }

  const syntaxErrors = (server.diagnostics.get(uri) ?? []).filter((d) => /^S/.test(String(d.code ?? "")));
  send(server, { method: "textDocument/didClose", params: { textDocument: { uri } } });
  const first = syntaxErrors[0];
  const message = first ? `${first.range.start.line + 1}:${first.range.start.character} ${first.code} ${first.message}` : "";
  console.log(`${path}\t${first ? "error" : "ok"}\t${message.replace(/[\t\r\n]+/g, " ")}`);
}

if (timedOut) console.error(`verdicts: ${timedOut} file(s) left out after timing out`);

// The server does not exit on shutdown/exit, and all verdicts are printed by now.
stopServer(server);
