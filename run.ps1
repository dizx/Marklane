param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    dotnet build src/Marklane/Marklane.csproj -p:Platform=x64 -c $Configuration
    if ($LASTEXITCODE -ne 0) { throw 'Marklane build failed.' }
    $executable = Join-Path $PSScriptRoot "src\Marklane\bin\x64\$Configuration\net10.0-windows10.0.19041.0\win-x64\Marklane.exe"
    Start-Process $executable
}
finally {
    Pop-Location
}
