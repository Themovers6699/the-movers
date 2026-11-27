<#
  Build and deploy the web app to Vercel for one target.
    .\scripts\deploy.ps1 -Target testing                # preview deployment (prints its URL)
    .\scripts\deploy.ps1 -Target testing -Promote       # preview, then make it that target's live address
    .\scripts\deploy.ps1 -Target production -Promote
  Runs the tests first and refuses to deploy if any fail. Uses deploy\targets.json (no secrets).
#>
param(
  [Parameter(Mandatory)][ValidateSet('testing','production')][string]$Target,
  [switch]$Promote,
  [switch]$SkipTests
)
# 'Continue': in Windows PowerShell 5.1, 'Stop' turns npm/vercel progress output on stderr into fatal errors.
# Every step's result is checked explicitly below instead.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$t = (Get-Content (Join-Path $root 'deploy\targets.json') -Raw | ConvertFrom-Json).$Target
if (-not $t.vercelProjectId) { throw "deploy\targets.json: $Target has no vercelProjectId yet." }

if (-not $SkipTests) {
  $out = npm test 2>&1 | Out-String
  if ($out -match 'fail [1-9]' -or $out -notmatch 'database checks passed') { Write-Output $out; throw 'Tests failed; not deploying.' }
}

$env:VITE_TARGET = $Target
try { $build = npm run build 2>&1 | Out-String } finally { Remove-Item Env:VITE_TARGET -ErrorAction SilentlyContinue }
if ($build -notmatch 'built in') { Write-Output $build; throw 'Build failed; not deploying.' }

# Stage: built files + security headers for this target's database + the Vercel project link.
$stage = Join-Path ([IO.Path]::GetTempPath()) ("movers-deploy-$Target-" + (Get-Date -Format yyyyMMddHHmmss))
New-Item -ItemType Directory -Force (Join-Path $stage '.vercel') | Out-Null
Copy-Item (Join-Path $root 'app\dist\*') $stage -Recurse
$host_ = ([uri]$t.supabaseUrl).Host
$csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://$host_; connect-src 'self' https://$host_ wss://$host_; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
$vercel = [ordered]@{
  headers = @(@{ source = '/(.*)'; headers = @(
    @{ key = 'X-Content-Type-Options'; value = 'nosniff' },
    @{ key = 'Referrer-Policy'; value = 'strict-origin-when-cross-origin' },
    @{ key = 'X-Frame-Options'; value = 'DENY' },
    @{ key = 'Cache-Control'; value = 'no-store' },
    @{ key = 'Content-Security-Policy'; value = $csp }) })
  framework = $null; buildCommand = ''; installCommand = ''; outputDirectory = '.'
}
$noBom = New-Object Text.UTF8Encoding($false)   # Windows PowerShell's utf8 adds a BOM, which JSON readers may reject
[IO.File]::WriteAllText((Join-Path $stage 'vercel.json'), ($vercel | ConvertTo-Json -Depth 6), $noBom)
[IO.File]::WriteAllText((Join-Path $stage '.vercel\project.json'), (@{ projectId = $t.vercelProjectId; orgId = $t.vercelOrgId; projectName = $t.vercelProjectName } | ConvertTo-Json), $noBom)

Push-Location $stage
try {
  $dep = npx.cmd --yes vercel@latest deploy --yes --scope the-movers 2>&1 | Out-String
  $url = ([regex]::Match($dep, 'https://[a-z0-9-]+-the-movers\.vercel\.app')).Value
  if (-not $url) { Write-Output $dep; throw 'Deploy failed.' }
  Write-Output "Preview ($Target): $url"
  if ($Promote) {
    npx.cmd --yes vercel@latest promote $url --yes --scope the-movers 2>&1 | Out-Null
    Start-Sleep -Seconds 20
    $bundle = (Get-ChildItem (Join-Path $root 'app\dist\assets') -Filter 'index-*.js').Name
    $served = [regex]::Match((Invoke-WebRequest -Uri $t.address -UseBasicParsing -TimeoutSec 30 -Headers @{ 'Cache-Control' = 'no-cache' }).Content, 'index-[A-Za-z0-9_-]+\.js').Value
    Write-Output "Live ($Target) at $($t.address): serves $served, expected $bundle, match: $($served -eq $bundle)"
  }
} finally { Pop-Location; Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
