"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { BsonLiteError } = require("./errors.cjs");
const execFileAsync = promisify(execFile);
const diagnosticPrefix = "BSONLITE_ACL_ERROR:";

// Fixed script: directory names enter through the environment, never as code.
// Update only the Access/DACL section. Changing ownership is unnecessary and
// can require a privilege unavailable to an otherwise writable standard account.
const windowsScript = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "$operation = 'read-current-account'",
  "$target = $env:BSONLITE_PRIVATE_DIRECTORY",
  "try {",
  "  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  "  $section = [System.Security.AccessControl.AccessControlSections]::Access",
  "  $full = [System.Security.AccessControl.FileSystemRights]::FullControl",
  "  $allow = [System.Security.AccessControl.AccessControlType]::Allow",
  "  $root = $env:BSONLITE_PRIVATE_DIRECTORY",
  "  $targets = @($root)",
  "  if ($env:BSONLITE_ACL_RECURSIVE -ne '0') { $targets += @(Get-ChildItem -LiteralPath $root -Force -Recurse | ForEach-Object { if (($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Symbolic links and reparse points are not allowed in protected storage.' }; $_.FullName }) }",
  "  foreach ($target in $targets) {",
  "    $operation = 'read-access-rules'",
  "    $isDirectory = [System.IO.Directory]::Exists($target)",
  "    if ($isDirectory) {",
  "      $item = [System.IO.DirectoryInfo]::new($target)",
  "      $inherit = 'OICI'",
  "    } else {",
  "      $item = [System.IO.FileInfo]::new($target)",
  "      $inherit = ''",
  "    }",
  "    $acl = $item.GetAccessControl($section)",
  "    $sddl = 'D:P(A;' + $inherit + ';FA;;;' + $sid + ')(A;' + $inherit + ';FA;;;SY)'",
  "    $operation = 'write-access-rules'",
  "    $acl.SetSecurityDescriptorSddlForm($sddl, $section)",
  "    $item.SetAccessControl($acl)",
  "    $operation = 'verify-access-rules'",
  "    $actual = $item.GetAccessControl($section)",
  "    $rules = $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])",
  "    if (-not $actual.AreAccessRulesProtected -or $rules.Count -ne 2) {",
  "      throw 'The filesystem did not retain the required private access rules.'",
  "    }",
  "    $seen = @{}",
  "    foreach ($rule in $rules) {",
  "      $identity = $rule.IdentityReference.Value",
  "      if (($identity -ne $sid -and $identity -ne 'S-1-5-18') -or $rule.IsInherited -or $rule.AccessControlType -ne $allow -or ($rule.FileSystemRights -band $full) -ne $full) {",
  "        throw 'The resulting access rules contain an unexpected account or permission.'",
  "      }",
  "      $seen[$identity] = $true",
  "    }",
  "    if (-not $seen.ContainsKey($sid) -or -not $seen.ContainsKey('S-1-5-18')) {",
  "      throw 'The required account or SYSTEM grant is missing.'",
  "    }",
  "  }",
  "  Write-Output 'BSONLITE_ACL_OK'",
  "  exit 0",
  "} catch {",
  "  $base = $_.Exception.GetBaseException()",
  "  $detail = @{ operation = $operation; target = $target; reason = $base.Message; systemCode = $base.HResult } | ConvertTo-Json -Compress",
  "  Write-Output ('BSONLITE_ACL_ERROR:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($detail)))",
  "  exit 1",
  "}"
].join("\n");

function permissionError(directory, cause, detail) {
  const reason = detail && typeof detail.reason === "string" ? detail.reason :
    String(cause.code || "") + (cause.message ? ": " + cause.message : "");
  const operation = detail && typeof detail.operation === "string" ? " [" + detail.operation + "]" : "";
  const target = detail && typeof detail.target === "string" ? detail.target : directory;
  const concise = reason.replace(/[\r\n\t]+/g, " ").slice(0, 700);
  return new BsonLiteError("BSONLITE_PERMISSIONS",
    "Cannot protect " + target + operation + ". " + concise +
    " Use a private writable folder on an ACL-capable filesystem (NTFS on Windows). Existing data was not reset.", cause);
}
async function protectWindowsDirectory(directory, execute, recursive = true) {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32",
    "WindowsPowerShell", "v1.0", "powershell.exe");
  const env = Object.assign({}, process.env, { BSONLITE_PRIVATE_DIRECTORY: directory, BSONLITE_ACL_RECURSIVE: recursive ? "1" : "0" });
  delete env.BSONLITE_VAULT_PASSWORD;
  delete env.BSONLITE_BACKUP_PASSWORD;
  try {
    const result = await (execute || execFileAsync)(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive",
      "-EncodedCommand", Buffer.from(windowsScript, "utf16le").toString("base64")], {
      windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
      env
    });
    if (!/^BSONLITE_ACL_OK\s*$/m.test(result.stdout)) {
      throw Object.assign(new Error("Windows permission verification did not return a success marker."), { code: "ACL_UNVERIFIED" });
    }
  } catch (error) {
    const output = String(error.stdout || "");
    const marker = output.match(/BSONLITE_ACL_ERROR:([A-Za-z0-9+/=]+)/);
    let detail;
    if (marker) {
      try { detail = JSON.parse(Buffer.from(marker[1], "base64").toString("utf8")); } catch (_) {}
    }
    // Do not include execFile's full command message: it contains the whole
    // encoded script rather than the useful Windows error. Never dump env/auth.
    if (!detail) {
      const stderr = String(error.stderr || "").replace(/<[^>]*>/g, " ").replace(/_x000D_|_x000A_/g, " ").trim();
      const reason = error.code === "ENOENT" ? "Windows PowerShell was not found." :
        error.killed ? "Windows permission setup exceeded its time limit." :
        stderr || "Windows PowerShell failed (code " + String(error.code || "unknown") + ").";
      detail = { operation: "run-windows-permission-helper", target: directory, reason: reason };
    }
    throw permissionError(directory, error, detail);
  }
}
async function protectDirectory(directory, children = ["data", "logs"], recursive = true) {
  try {
    for (const target of [directory, ...children.map(name => path.join(directory, name))]) {
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      if (fs.lstatSync(target).isSymbolicLink()) {
        throw new Error("A protected directory is a symbolic link: " + target);
      }
      if (process.platform !== "win32") fs.chmodSync(target, 0o700);
    }
    function verifyTree(target) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error("Protected storage contains a link or special file.");
      if (process.platform !== "win32") fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
      if (recursive && stat.isDirectory()) for (const name of fs.readdirSync(target)) verifyTree(path.join(target, name));
    }
    verifyTree(directory);
    if (process.platform === "win32") await protectWindowsDirectory(directory, undefined, recursive);
  } catch (error) {
    if (error instanceof BsonLiteError) throw error;
    throw permissionError(directory, error);
  }
}
module.exports = { protectDirectory, protectWindowsDirectory };
