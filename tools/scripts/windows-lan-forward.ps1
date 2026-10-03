#requires -Version 5.1
<#
.SYNOPSIS
  Publish a WSL-hosted DSH Web GUI to the LAN on Windows.

.DESCRIPTION
  The DSH Web GUI listens on 127.0.0.1 inside WSL, and its own CLI refuses
  --host 0.0.0.0. WSL2's NAT address is not routable from the LAN, so Windows
  itself has to forward a port. This script:

    1. finds the WSL2 NAT address (the netsh portproxy target),
    2. picks the external port (3080, or 3081 when Windows already owns 3080),
    3. adds   netsh interface portproxy  EXTERNAL -> WSL:INTERNAL,
    4. adds an inbound firewall rule for EXTERNAL,
    5. prints the exact URL and the restart command for the WSL side.

  It does NOT restart dsh. Output is ASCII on purpose: Windows PowerShell 5.1
  reads a BOM-less .ps1 as ANSI, so non-ASCII text can garble.

.PARAMETER LanIp
  The Windows adapter address your other device can reach. REQUIRED, because
  guessing it would silently publish on the wrong interface.

.PARAMETER InternalPort
  The port dsh web listens on inside WSL. Default 3080.

.PARAMETER ExternalPort
  The port Windows listens on. Default 0 = auto (3080, else 3081).

.PARAMETER Distro
  WSL distribution that hosts dsh. Default: the WSL default distribution.

.PARAMETER RemoteAddress
  Optional. Restrict the firewall rule to these addresses/subnets, e.g.
  '10.1.1.0/24'. Omit to allow any source that can reach the port.

.PARAMETER WslTimeoutSeconds
  How long to wait for WSL to report an IPv4 address. Default 60.

.PARAMETER RegisterLogonTask
  Also register a scheduled task that re-applies this forwarding at every logon
  (SYSTEM, highest privileges). Needed because a reboot leaves the portproxy
  listeners uninitialized AND changes WSL's NAT address.

.EXAMPLE
  .\windows-lan-forward.ps1 -LanIp 10.1.1.69
  .\windows-lan-forward.ps1 -LanIp 10.1.1.69 -RemoteAddress 10.1.1.0/24
  .\windows-lan-forward.ps1 -LanIp 10.1.1.69 -RegisterLogonTask
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$LanIp,
    [int]$InternalPort = 3080,
    [int]$ExternalPort = 0,
    [string]$Distro = '',
    [string]$RemoteAddress = '',
    [int]$WslTimeoutSeconds = 60,
    [switch]$RegisterLogonTask
)

$ErrorActionPreference = 'Stop'

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Host 'ERROR: run this from an elevated PowerShell (Run as Administrator).'
    Write-Host '       netsh portproxy and firewall rules both need administrator rights.'
    exit 1
}

# --- 1. WSL2 NAT address -----------------------------------------------------
# A reboot leaves WSL's NAT address different, and its VM may not be up yet, so
# retry until `hostname -I` answers with an IPv4 address.
$WslIp = ''
$deadline = (Get-Date).AddSeconds($WslTimeoutSeconds)
while (-not $WslIp) {
    $wslText = if ($Distro) { (& wsl.exe -d $Distro -- hostname -I 2>$null) } else { (& wsl.exe -- hostname -I 2>$null) }
    if ($wslText) {
        $WslIp = @($wslText -split '\s+' | Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' })[0]
    }
    if ($WslIp) { break }
    if ((Get-Date) -ge $deadline) {
        Write-Host "ERROR: no WSL IPv4 address after ${WslTimeoutSeconds}s ('wsl -- hostname -I' gave: $wslText)."
        Write-Host '       Is the distro installed and able to start? Raise -WslTimeoutSeconds if it is just slow.'
        exit 1
    }
    Write-Host "waiting for WSL to answer (up to ${WslTimeoutSeconds}s)..."
    Start-Sleep -Seconds 3
}

# Guard: in mirrored networking mode WSL shares the Windows addresses, so the
# "WSL IP" is already a Windows adapter address and forwarding to it would loop.
$mirrored = Get-NetIPAddress -IPAddress $WslIp -ErrorAction SilentlyContinue
if ($mirrored) {
    Write-Host "ERROR: $WslIp is a Windows adapter address (interface '$($mirrored.InterfaceAlias)')."
    Write-Host '       WSL is in mirrored networking mode, so this forwarding is unnecessary and would loop.'
    Write-Host '       Just open http://<windows-lan-ip>:3080/ from the other device instead.'
    exit 1
}

# NOTE: this script deliberately targets the WSL IP, never 127.0.0.1.
# Windows 127.0.0.1:PORT is the wslrelay (WSL localhost forwarding) endpoint, so
# a portproxy pointing there would chain through it -- or loop onto itself.

# --- 2. choose the external port --------------------------------------------
if ($ExternalPort -le 0) {
    $ExternalPort = $InternalPort
    $busy = Get-NetTCPConnection -State Listen -LocalPort $ExternalPort -ErrorAction SilentlyContinue
    if ($busy) {
        Write-Host "NOTE: Windows already listens on $ExternalPort (WSL localhost forwarding, most likely)."
        Write-Host "      Using $($ExternalPort + 1) as the external port instead."
        $ExternalPort = $ExternalPort + 1
    }
}

$ruleName = "DSH Web GUI (LAN, TCP $ExternalPort)"

Write-Host ''
Write-Host 'DSH Web GUI -> LAN'
Write-Host "  WSL target          : ${WslIp}:${InternalPort}"
Write-Host "  Windows listen      : 0.0.0.0:${ExternalPort}"
Write-Host "  URL for other devices: http://${LanIp}:${ExternalPort}/?token=<token printed by dsh web>"
Write-Host ''

# --- 3. portproxy ------------------------------------------------------------
# Reboots are why this is a delete+add rather than a bare add: the rules survive
# in the registry, but their listeners do not re-initialize until the IP Helper
# service refreshes -- and WSL's NAT address has changed anyway. Restarting the
# service and re-adding the rule covers both.
Restart-Service iphlpsvc -Force -ErrorAction SilentlyContinue
& netsh interface portproxy delete v4tov4 listenport=$ExternalPort listenaddress=0.0.0.0 2>$null | Out-Null
& netsh interface portproxy add v4tov4 listenport=$ExternalPort listenaddress=0.0.0.0 `
    connectport=$InternalPort connectaddress=$WslIp | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERROR: netsh interface portproxy add failed.'
    Write-Host '       Check that the IP Helper service (iphlpsvc) is running.'
    exit 1
}

# Is the listener actually up? `portproxy show all` lists stale rules too, so the
# table alone proves nothing -- this is the check that catches the reboot case.
$listening = Get-NetTCPConnection -State Listen -LocalPort $ExternalPort -ErrorAction SilentlyContinue
if (-not $listening) {
    Write-Host "WARNING: no listener on port $ExternalPort yet -- restarting IP Helper once and retrying."
    Restart-Service iphlpsvc -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    & netsh interface portproxy add v4tov4 listenport=$ExternalPort listenaddress=0.0.0.0 `
        connectport=$InternalPort connectaddress=$WslIp | Out-Null
}

# --- 4. firewall -------------------------------------------------------------
$rule = @{
    DisplayName = $ruleName
    Direction   = 'Inbound'
    Action      = 'Allow'
    Protocol    = 'TCP'
    LocalPort   = $ExternalPort
    Profile     = 'Any'
}
if ($RemoteAddress) { $rule.RemoteAddress = $RemoteAddress }
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    # Keep the rule idempotent: covers both this script being re-run (after every
    # reboot, so the WSL IP can be refreshed) and registration as a logon task.
    $existing | Set-NetFirewallRule -Enabled True -Action Allow -Profile Any | Out-Null
} else {
    New-NetFirewallRule @rule | Out-Null
}

# --- 5. verify and report ----------------------------------------------------
Write-Host 'portproxy table:'
& netsh interface portproxy show v4tov4
Write-Host ''

$probe = Test-NetConnection -ComputerName $LanIp -Port $ExternalPort -InformationLevel Quiet -WarningAction SilentlyContinue
Write-Host ("Windows self-check on ${LanIp}:${ExternalPort} : " + $(if ($probe) { 'OPEN' } else { 'no answer (firewall or binding)' }))
Write-Host ''

Write-Host 'NEXT: restart dsh inside WSL in its own terminal window, then copy the ?token= it prints:'
Write-Host "  dsh --profile web --host $WslIp --trusted-host $LanIp"
Write-Host ''
Write-Host 'Then open on the other device:'
Write-Host "  http://${LanIp}:${ExternalPort}/?token=<token>"
Write-Host ''
Write-Host 'Troubleshooting:'
Write-Host '  403 on /api  -> dsh was started without --trusted-host <LanIp>, or the address differs.'
Write-Host '  401 on /      -> the token was lost; use the URL exactly as dsh printed it.'
Write-Host '  refused       -> the WSL IP changed (WSL restarted); re-run this script.'
Write-Host ''
Write-Host 'AFTER EVERY REBOOT this forwarding stops working on its own: the rules survive'
Write-Host 'in the registry but their listeners do not, and the WSL IP changes anyway.'
Write-Host "Automate it with:  .\windows-lan-forward.ps1 -LanIp $LanIp -RegisterLogonTask"

# --- 6. optional: re-apply at every logon ------------------------------------
if ($RegisterLogonTask) {
    $taskName = 'DSH Web GUI LAN forward'
    $scriptPath = $PSCommandPath
    if (-not $scriptPath) {
        Write-Host 'ERROR: cannot resolve this script path for the scheduled task; pass it by running the saved file.'
        exit 1
    }
    $args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -LanIp $LanIp -InternalPort $InternalPort -ExternalPort $ExternalPort"
    if ($Distro) { $args += " -Distro $Distro" }
    if ($RemoteAddress) { $args += " -RemoteAddress $RemoteAddress" }

    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host ''
    Write-Host "Registered scheduled task '$taskName' (SYSTEM, at logon)."
    Write-Host 'It re-applies the forwarding whenever you log on, including after a reboot.'
    Write-Host "Keep this script where it is; the task calls: $scriptPath"
    Write-Host "Remove it later with:  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
}
