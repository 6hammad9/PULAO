$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Set-Location -LiteralPath $scriptDir
py -3.12 -m pip install -r "$scriptDir\requirements.txt"
