[CmdletBinding()]
param(
    [string]$WorkDirectory = (Join-Path $PSScriptRoot 'build/dependencies'),
    [string]$Python3 = 'python',
    [switch]$InstallBuildTools
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'A native Windows x64 build host is required.' }
$projectRoot = Split-Path $PSScriptRoot -Parent
$work = [IO.Path]::GetFullPath($WorkDirectory)
function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
Invoke-Checked $Python3 @((Join-Path $PSScriptRoot 'prepare.py'), '--windows', '--work', $work)
$lock = Get-Content (Join-Path $PSScriptRoot 'deps.lock.json') -Raw | ConvertFrom-Json
$mongo = Join-Path $work ('mongo-' + $lock.mongo.commit)
$sodium = Join-Path $work ('libsodium-' + $lock.sodium.version)
$python27 = Join-Path $work 'python27/tools/python.exe'
# Python 2 exists only on the developer/CI host, never in the customer artifact.
if ($InstallBuildTools) {
    $runtimeInstaller = Join-Path $work $lock.vc90.filename
    $signature = Get-AuthenticodeSignature -LiteralPath $runtimeInstaller
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw 'The pinned build-host VC90 installer does not have a valid Microsoft signature.'
    }
    $runtimeInstallation = Start-Process -FilePath $runtimeInstaller -ArgumentList @('/q','/norestart') -Wait -PassThru
    if ($runtimeInstallation.ExitCode -notin @(0,1638,3010)) {
        throw "The Python 2 build-host runtime installation failed: $($runtimeInstallation.ExitCode)"
    }
}
Invoke-Checked $python27 @('-c', 'import sys,yaml,typing; assert sys.version_info[:2] == (2,7)')
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'Install Visual Studio Build Tools with the v141 x64 toolset on the build host.' }
$vs = (& $vswhere -latest -products '*' -property installationPath | Select-Object -First 1)
if (-not $vs) { throw 'Visual Studio Build Tools was not found.' }
$tools = @(Get-ChildItem (Join-Path $vs 'VC/Tools/MSVC') -Directory -Filter '14.16.*' -ErrorAction SilentlyContinue)
$sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/Include/10.0.19041.0'
if (-not $tools.Count -or -not (Test-Path $sdk)) {
    if (-not $InstallBuildTools) { throw 'The builder needs the v141 x64 toolset and Windows SDK 10.0.19041.0. CI passes -InstallBuildTools; customer apps do not install these.' }
    $installer = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vs_installer.exe'
    $installArgs = @('modify', '--installPath', ('"' + $vs + '"'), '--add', 'Microsoft.VisualStudio.Component.VC.v141.x86.x64', '--add', 'Microsoft.VisualStudio.Component.Windows10SDK.19041', '--quiet', '--norestart', '--nocache')
    $installation = Start-Process -FilePath $installer -ArgumentList $installArgs -Wait -PassThru
    if ($installation.ExitCode -notin @(0,3010)) { throw "Build tool installation failed: $($installation.ExitCode)" }
}
$vcvars = Join-Path $vs 'VC/Auxiliary/Build/vcvarsall.bat'
$wrapper = Join-Path $work 'bsonlite-vcvars.cmd'
Set-Content -LiteralPath $wrapper -Encoding ascii -Value ('@call "' + $vcvars + '" x64 10.0.19041.0 -vcvars_ver=14.16')
$command = '"' + $wrapper + '" >nul && set'
$compilerEnvironment = & $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw 'The native compiler environment could not be prepared.' }
foreach ($line in $compilerEnvironment) {
    if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
$msbuild = Join-Path $vs 'MSBuild/Current/Bin/MSBuild.exe'
Invoke-Checked $msbuild @((Join-Path $sodium 'builds/msvc/vs2017/libsodium.sln'), '/m:2', '/p:Configuration=StaticRelease', '/p:Platform=x64', '/p:PlatformToolset=v141', '/p:WindowsTargetPlatformVersion=10.0.19041.0')
$sodiumLibrary = Get-ChildItem (Join-Path $sodium 'bin/x64/Release/v141/static') -Filter 'libsodium.lib' -Recurse | Select-Object -First 1
if (-not $sodiumLibrary) { throw 'The static libsodium library was not produced.' }
$include = Join-Path $sodium 'src/libsodium/include'
Invoke-Checked $Python3 @((Join-Path $PSScriptRoot 'patch_mongo.py'), $mongo, '--sodium-include', $include, '--sodium-library', $sodiumLibrary.FullName)
$output = Join-Path $projectRoot 'assets/native-win32-x64'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$probeOutput = Join-Path $PSScriptRoot 'build/win32-x64'
New-Item -ItemType Directory -Force -Path $probeOutput | Out-Null
Push-Location $probeOutput
try {
    Invoke-Checked 'cl.exe' @('/nologo','/W4','/O2','/MT','/DSODIUM_STATIC',('/I' + $include),('/I' + (Join-Path $PSScriptRoot 'src')),(Join-Path $PSScriptRoot 'src/bsonlite_crypto.c'),(Join-Path $PSScriptRoot 'src/crypto_probe.c'),$sodiumLibrary.FullName,'advapi32.lib','bcrypt.lib','/Fe:crypto_probe.exe')
    Invoke-Checked (Join-Path $probeOutput 'crypto_probe.exe') @()
} finally { Pop-Location }
Push-Location $mongo
try {
    # SCons 2.5 uses the 14.0 driver interface; the explicit wrapper selects v141.
    # Static CRT + Windows SChannel avoid customer-side crypto/compiler DLLs.
    Invoke-Checked $python27 @('buildscripts/scons.py','-j2','--release','--opt=on','--dbg=off','--ssl','--ssl-provider=native','--allocator=system','--js-engine=none','--disable-warnings-as-errors','MSVC_VERSION=14.0',('MSVC_USE_SCRIPT=' + $wrapper),'MONGO_VERSION=4.0.28-bsonlite-preview2',('MONGO_GIT_HASH=' + $lock.mongo.commit),'mongod')
    $engine = Get-ChildItem (Join-Path $mongo 'build') -Filter 'mongod.exe' -Recurse | Where-Object { $_.Length -gt 1MB } | Select-Object -First 1
    if (-not $engine) { throw 'The rebuilt MongoDB executable was not found.' }
    Copy-Item $engine.FullName (Join-Path $output 'mongod.exe')
} finally { Pop-Location }
Invoke-Checked (Join-Path $output 'mongod.exe') @('--bsonlite-native-self-test')
$imports = & 'dumpbin.exe' '/DEPENDENTS' (Join-Path $output 'mongod.exe')
if ($LASTEXITCODE -ne 0 -or ($imports -match '(?i)(MSVCP[0-9]+|VCRUNTIME[0-9]+|libsodium|libcrypto|libssl)\.dll')) {
    throw 'The engine has an unexpected external runtime dependency. Do not publish it.'
}
$manifest = [ordered]@{
    version=1; cipher='xchacha20-poly1305'; mode='builtin'; platform='win32'; arch='x64';
    engineVersion='4.0.28'; engineSha256=(Get-FileHash (Join-Path $output 'mongod.exe') -Algorithm SHA256).Hash.ToLowerInvariant();
    temporaryFiles=$true; libsodiumVersion=$lock.sodium.version; upstreamCommit=$lock.mongo.commit;
    patchSha256=(Get-Content (Join-Path $mongo '.bsonlite-native-patched') -Raw).Trim();
    windowsIntegration='pending'; tlsProvider='Windows SChannel'; staticCRuntime=$true
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $output 'native-engine.json') -Encoding utf8NoBOM
Copy-Item (Join-Path $sodium 'LICENSE') (Join-Path $projectRoot 'licenses/libsodium-LICENSE.txt')
Invoke-Checked $Python3 @((Join-Path $PSScriptRoot 'package_source.py'), '--work', $work)
Write-Host 'Native engine built. Run the Windows tests before bundling or distributing it.'
