"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { windowsJSON } = require("./windows.cjs");
const { BsonLiteError } = require("./errors.cjs");

const checkScript = `
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$directory = [IO.Path]::GetFullPath($inputData.directory)
$mount = [IO.Path]::GetPathRoot($directory)
$encrypted = $false
try {
  $volume = Get-BitLockerVolume -MountPoint $mount -ErrorAction Stop
  $encrypted = ($volume.VolumeStatus.ToString() -eq 'FullyEncrypted' -and $volume.ProtectionStatus.ToString() -eq 'On')
} catch { }
if ($encrypted) { @{ verified=$true; method='bitlocker' } | ConvertTo-Json -Compress; exit 0 }
$efs = (([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::Encrypted) -ne 0)
if ($efs) {
  foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force -Recurse)) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ($item.Attributes -band [IO.FileAttributes]::Encrypted) -eq 0) { $efs=$false; break }
  }
}
if ($efs) {
  $probe = Join-Path $directory ('.bsonlite-encryption-probe-' + [Guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($probe, 'BsonLite encryption inheritance probe')
    $efs = (([IO.File]::GetAttributes($probe) -band [IO.FileAttributes]::Encrypted) -ne 0)
  } finally { if ([IO.File]::Exists($probe)) { [IO.File]::Delete($probe) } }
}
@{ verified=[bool]$efs; method=$(if ($efs) {'efs'} else {'unverified'}) } | ConvertTo-Json -Compress
`;

async function verifyStorage(directory, policy, execute = windowsJSON, platform = process.platform) {
  const unverified = reason => Object.freeze({ policy, required: policy === "required", verified: false, method: "unverified", reason });
  if (policy === "none") return unverified("disabled");
  if (!["auto", "required"].includes(policy)) throw new BsonLiteError("BSONLITE_INVALID_OPTIONS", "Unknown storage encryption policy.");
  if (platform !== "win32") {
    if (policy === "auto") return unverified("verification-not-supported");
    throw new BsonLiteError("BSONLITE_STORAGE_ENCRYPTION", "Automatic verification of live data encryption is currently supported on Windows only. Use encrypted Windows storage for production. storageEncryption:'none' is an explicit development opt-out, not encryption.");
  }
  let result;
  try { result = await execute(checkScript, { directory: path.resolve(directory) }, "BSONLITE_STORAGE_ENCRYPTION"); }
  catch (error) {
    if (policy === "auto" && error instanceof BsonLiteError && error.code === "BSONLITE_STORAGE_ENCRYPTION") return unverified("verification-unavailable");
    throw error;
  }
  if (!result || result.verified !== true || !["efs", "bitlocker"].includes(result.method)) {
    if (policy === "auto") return unverified("encryption-not-verified");
    throw new BsonLiteError("BSONLITE_STORAGE_ENCRYPTION", "Live data encryption could not be verified. Put Database on a fully encrypted BitLocker volume with protection On, or an EFS-encrypted folder with inheritance. BsonLite will not enable whole-drive encryption or silently use plaintext. See START_HERE.md.");
  }
  return Object.freeze({ policy, required: policy === "required", verified: true, method: result.method });
}
function rejectLinks(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
    throw new BsonLiteError("BSONLITE_UNSAFE_PATH", "Database storage cannot contain symbolic links or special files.");
  }
  if (stat.isDirectory()) for (const name of fs.readdirSync(directory)) rejectLinks(path.join(directory, name));
}
module.exports = { verifyStorage, rejectLinks };
