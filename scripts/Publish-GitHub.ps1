# Developer helper. Does not run on customer PCs or build the database locally.
[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9-]*$')]
    [string]$Owner = 'MohammadAtikurRahman',
    [ValidateSet('private', 'public')]
    [string]$Visibility = 'private'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$repository = "$Owner/BsonLite"
$url = "https://github.com/$repository.git"

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git for Windows is required on this developer PC: https://git-scm.com/download/win'
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI is required on this developer PC: https://cli.github.com/'
}
Push-Location $root
try {
    & gh auth status --hostname github.com 2>$null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Checked 'gh' @('auth','login','--hostname','github.com','--git-protocol','https','--web','--scopes','workflow')
    }
    $login = & gh api user --jq .login
    if ($LASTEXITCODE -ne 0 -or $login -ine $Owner) {
        throw "Sign in to the GitHub account '$Owner' before publishing this new personal repository."
    }
    if (-not (Test-Path '.git')) {
        # Downloaded ZIPs also contain a complete local repository bundle.
        if (Test-Path 'BsonLite-repository.bundle') {
            Invoke-Checked 'git' @('init','--initial-branch=main')
            Invoke-Checked 'git' @('fetch','./BsonLite-repository.bundle','main')
            Invoke-Checked 'git' @('reset','--mixed','FETCH_HEAD')
        } else {
            throw 'Use the provided repository bundle or the original Git checkout before publishing.'
        }
    }
    $status = & git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $status) {
        throw 'Commit or review local source changes before publishing. No remote changes were made.'
    }
    $branch = & git branch --show-current
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Publish from the prepared main branch.' }
    $origin = & git config --get remote.origin.url
    if ($origin -and $origin -notin @($url,"https://github.com/$repository","git@github.com:$repository.git")) {
        throw "The current origin points to a different repository: $origin"
    }
    & gh repo view $repository --json name 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Invoke-Checked 'gh' @('repo','create',$repository,("--" + $Visibility),'--description','Portable MongoDB-based Node.js SDK with native encrypted storage. Windows validation in progress.')
    }
    # Reuse the user's official GitHub CLI credential helper without changing
    # global Git configuration or copying tokens into arguments/environment.
    $credentials = @('-c','credential.helper=','-c','credential.https://github.com.helper=!gh auth git-credential')
    $heads = & git @credentials ls-remote --heads $url
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the new remote repository.' }
    if ($heads) { throw 'The remote has existing branches. This helper only publishes to a new empty repository; it never force-pushes.' }
    if (-not $origin) { Invoke-Checked 'git' @('remote','add','origin',$url) }
    Invoke-Checked 'git' @($credentials + @('push','--set-upstream','origin','main'))
    Write-Host "Published source: https://github.com/$repository"
    Write-Host "Windows build: https://github.com/$repository/actions"
    Write-Host 'The customer SDK is available only if the native build and all integration tests succeed.'
} finally { Pop-Location }
