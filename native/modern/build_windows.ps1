[CmdletBinding()]
param([int]$Jobs = 2)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'The modern customer engine requires a Windows x64 builder.' }
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$lock = Get-Content (Join-Path $PSScriptRoot 'deps.lock.json') -Raw | ConvertFrom-Json
$work = Join-Path $root 'native/build/modern/dependencies'
function Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with $LASTEXITCODE" }
}
Checked 'python' @((Join-Path $PSScriptRoot 'prepare.py'), '--work', $work)
$mongo = Join-Path $work ('mongo-' + $lock.mongo.commit)
$sodium = Join-Path $work ('libsodium-' + $lock.sodium.version)
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if (-not $vs) { throw 'Visual Studio 2022 with the v143 x64 C++ toolset is required.' }
$compiler = Get-ChildItem (Join-Path $vs 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$sdk = Get-ChildItem (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/Include') -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'um/windows.h') } | Sort-Object Name -Descending | Select-Object -First 1
if (-not $compiler -or -not $sdk) { throw 'The x64 compiler and Windows SDK must be installed.' }
$wrapper = Join-Path $work 'vcvars.cmd'
Set-Content $wrapper ('@call "' + (Join-Path $vs 'VC/Auxiliary/Build/vcvarsall.bat') + '" x64 ' + $sdk.Name) -Encoding ascii
$compilerEnvironment = & $env:ComSpec /d /s /c ('"' + $wrapper + '" >nul && set')
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the x64 compiler environment.' }
foreach ($line in $compilerEnvironment) {
    if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}
Checked (Join-Path $vs 'MSBuild/Current/Bin/MSBuild.exe') @((Join-Path $sodium 'builds/msvc/vs2022/libsodium.sln'),
    '/m:2', '/p:Configuration=StaticRelease', '/p:Platform=x64', '/p:PlatformToolset=v143', ('/p:WindowsTargetPlatformVersion=' + $sdk.Name))
$library = Get-ChildItem (Join-Path $sodium 'bin/x64/Release/v143/static') -Recurse -Filter libsodium.lib | Select-Object -First 1
if (-not $library) { throw 'The static libsodium library was not produced.' }
Checked 'python' @((Join-Path $PSScriptRoot 'patch_mongo.py'), $mongo,
    '--sodium-include', (Join-Path $sodium 'src/libsodium/include'), '--sodium-library', $library.FullName)
Push-Location $mongo
try {
    # The upstream wrapper starts its own Bazel bootstrap invocations. They do
    # not inherit our CLI flags, so installed toolchain overrides must also be
    # present in the shared rc file before any wrapper/bootstrap is started.
    @(
        'common --config=local',
        ('common --disk_cache="' + (Join-Path $root 'native/build/modern/bazel-cache').Replace('\','/') + '"'),
        ('common:windows --repo_env=BAZEL_VS="' + $vs.Replace('\','/') + '"'),
        ('common:windows --repo_env=BAZEL_VC="' + (Join-Path $vs 'VC').Replace('\','/') + '"'),
        ('common:windows --repo_env=BAZEL_VC_FULL_VERSION=' + $compiler.Name),
        ('common:windows --repo_env=BAZEL_WINSDK_FULL_VERSION=' + $sdk.Name),
        ('common --define=MONGO_VERSION=' + $lock.mongo.version),
        ('common --define=MONGO_GIT_HASH=' + $lock.mongo.commit)
    ) | Set-Content '.bazelrc.local' -Encoding utf8NoBOM
    Checked 'python' @('buildscripts/install_bazel.py')
    $bazel = Join-Path $env:USERPROFILE '.local/bin/bazel.exe'
    $arguments = @('build', 'install-mongod', '--config=local', '--config=opt', '--build_enterprise=False',
        '--js_engine=none', '--debug_symbols=False', '--separate_debug=False', '--dbg_level=0',
        '--compiler_type=msvc', '--allocator=system', '--features=static_link_msvcrt',
        '--features=-multithreaded_feature', '--features=-single_threaded_feature', ('--jobs=' + $Jobs),
        ('--define=MONGO_VERSION=' + $lock.mongo.version), ('--define=MONGO_GIT_HASH=' + $lock.mongo.commit),
        ('--repo_env=BAZEL_VS=' + $vs), ('--repo_env=BAZEL_VC=' + (Join-Path $vs 'VC')),
        ('--repo_env=BAZEL_VC_FULL_VERSION=' + $compiler.Name), ('--repo_env=BAZEL_WINSDK_FULL_VERSION=' + $sdk.Name))
    $preflight = @('build', '//src/mongo/db/storage:encryption_hooks_with_debug',
        '//src/mongo/db/storage/wiredtiger:storage_wiredtiger_core_with_debug', '//src/mongo/db:mongod_main_with_debug',
        '--output_groups=compilation_outputs') + $arguments[2..($arguments.Length - 1)]
    Checked $bazel $preflight
    Checked $bazel $arguments
    $engine = Get-ChildItem 'bazel-bin/install' -Recurse -Filter mongod.exe | Where-Object { $_.Length -gt 1MB } | Select-Object -First 1
    if (-not $engine) { throw 'Bazel did not produce the engine.' }
    $output = Join-Path $root 'assets/modern-win32-x64'
    New-Item -ItemType Directory -Force $output | Out-Null
    Copy-Item $engine.FullName (Join-Path $output 'mongod.exe')
    Checked $bazel @('shutdown')
} finally { Pop-Location }
$engine = Join-Path $output 'mongod.exe'
$probe = (& $engine '--bsonlite-native-self-test') -join "`n"
if ($LASTEXITCODE -ne 0 -or ($probe | ConvertFrom-Json).selfTest -ne $true) { throw 'The real engine cipher self-test failed.' }
$version = (& $engine '--version') -join "`n"
if ($LASTEXITCODE -ne 0 -or $version -notmatch ('db version v' + [regex]::Escape($lock.mongo.version) + '\b')) { throw 'The actual engine version is incorrect.' }
$imports = (& dumpbin.exe /DEPENDENTS $engine) -join "`n"
if ($LASTEXITCODE -ne 0 -or $imports -match '(?i)\b(?:(?:MSVCP|MSVCR|VCRUNTIME|atl|mfc)\d\w*|libsodium|libcrypto[\w-]*|libssl[\w-]*|ucrtbase)\.dll|\bapi-ms-win-crt-[\w-]+\.dll') {
    throw 'The engine has an unbundled compiler or crypto runtime dependency; distribution is blocked.'
}
$imports = (& dumpbin.exe /IMPORTS $engine) -join "`n"
if ($LASTEXITCODE -ne 0 -or $imports -match 'MiniDumpWriteDump') { throw 'A plaintext engine dump writer remains; distribution is blocked.' }
$patch = Get-Content (Join-Path $mongo '.bsonlite-native-patched') -Raw | ConvertFrom-Json
[ordered]@{
    version=2; engineVersion=$lock.mongo.version; upstreamCommit=$lock.mongo.commit; patchSha256=$patch.patchSha256;
    cipher='xchacha20-poly1305'; mode='builtin'; platform='win32'; arch='x64';
    engineSha256=(Get-FileHash $engine -Algorithm SHA256).Hash.ToLowerInvariant();
    temporaryFiles=$true; libsodiumVersion=$lock.sodium.version; engineManagedDumps=$false;
    windowsIntegration='pending'; selfTestProtocol='json-v1'; staticCRuntime=$true; tlsProvider='Windows SChannel';
} | ConvertTo-Json | Set-Content (Join-Path $output 'native-engine.json') -Encoding utf8NoBOM
Checked 'python' @((Join-Path $PSScriptRoot 'enable_utf8.py'), $engine, (Join-Path $output 'native-engine.json'))
# Marking integration as passed is the responsibility of the separate runtime test job.
Checked 'python' @((Join-Path $PSScriptRoot 'package_source.py'), '--work', $work)
Write-Host 'Modern engine compiled. Integration validation is still pending.'
