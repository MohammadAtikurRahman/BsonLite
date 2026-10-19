"use strict";
const path = require("node:path");
const { spawn } = require("node:child_process");
const { BsonLiteError } = require("./errors.cjs");

// Fixed scripts only. Secrets and paths are JSON on stdin, never command arguments.
function windowsJSON(script, input, code) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const env = { ...process.env };
    delete env.BSONLITE_VAULT_PASSWORD;
    delete env.BSONLITE_BACKUP_PASSWORD;
    // Node pipes UTF-8; Windows PowerShell otherwise inherits a legacy code page.
    const prelude = "$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n" +
      "[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false,$true)\n" +
      "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)\n";
    const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(prelude + script, "utf16le").toString("base64")],
    { windowsHide: true, env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", done = false;
    const timer = setTimeout(() => { child.kill(); fail("Windows security verification timed out."); }, 20000);
    function fail(message) { if (done) return; done = true; clearTimeout(timer); reject(new BsonLiteError(code, message)); }
    child.once("error", () => fail("Cannot start the Windows security helper. Windows PowerShell is required."));
    child.stdin.on("error", () => {});
    child.stderr.on("data", () => {}); // Never echo a helper's input or secret-bearing error.
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.length > 1024 * 1024) { child.kill(); fail("Invalid Windows security helper response."); }
    });
    child.once("close", status => {
      if (done) return;
      if (status !== 0) return fail("Windows security operation failed. Check the current account, encryption support and policy; no insecure fallback was used.");
      try { const result = JSON.parse(output.replace(/^\uFEFF/, "").trim()); done = true; clearTimeout(timer); resolve(result); }
      catch (_) { fail("Windows security helper did not return a verified result."); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
module.exports = { windowsJSON };
