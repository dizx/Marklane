param(
    [string]$IsccPath
)

$ErrorActionPreference = 'Stop'

if (-not $IsccPath) {
    $compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($compiler) {
        $IsccPath = $compiler.Source
    }
    else {
        $candidates = @(
            "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
            "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
            "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
        )
        $IsccPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
}
if (-not $IsccPath -or -not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) {
    throw 'Install Inno Setup 6.3 or later, or supply -IsccPath with the full path to ISCC.exe.'
}
$IsccPath = (Resolve-Path -LiteralPath $IsccPath).Path

$publishDirectory = Join-Path $PSScriptRoot 'artifacts\publish\win-x64'
$prerequisitesDirectory = Join-Path $PSScriptRoot 'artifacts\prerequisites'
$outputDirectory = Join-Path $PSScriptRoot 'artifacts\installer'

Push-Location $PSScriptRoot
try {
    # Publish into a clean folder so removed files cannot leak into a new installer.
    if (Test-Path -LiteralPath $publishDirectory) {
        Remove-Item -LiteralPath $publishDirectory -Recurse -Force
    }
    dotnet publish src/Marklane/Marklane.csproj -c Release -p:Platform=x64 -r win-x64 `
        --self-contained true -p:WindowsAppSDKSelfContained=true `
        -p:PublishSingleFile=false -p:PublishTrimmed=false -o $publishDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Marklane publish failed.' }

    New-Item -ItemType Directory -Path $prerequisitesDirectory -Force | Out-Null
    $prerequisites = @(
        @{ Name = 'vc_redist.x64.exe'; Url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe' }
        @{ Name = 'MicrosoftEdgeWebview2Setup.exe'; Url = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' }
    )
    foreach ($prerequisite in $prerequisites) {
        $destination = Join-Path $prerequisitesDirectory $prerequisite.Name
        Invoke-WebRequest -Uri $prerequisite.Url -OutFile $destination -UseBasicParsing
        $signature = Get-AuthenticodeSignature -LiteralPath $destination
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') {
            throw "The downloaded $($prerequisite.Name) does not have a valid Microsoft signature."
        }
    }

    & $IsccPath "/DPublishDir=$publishDirectory" "/DPrerequisitesDir=$prerequisitesDirectory" `
        "/DInstallerOutputDir=$outputDirectory" 'installer\Marklane.iss'
    if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }
    Write-Host "Installer created in $outputDirectory"
}
finally {
    Pop-Location
}
