// 关闭「应用程序无法正常启动(0xc0000142)」弹窗
async function main() {
  const script = String.raw`
Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null
$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$closed = 0
foreach ($w in $windows) {
  try {
    $name = [string]$w.Current.Name
    if ($name -match 'Application Error|应用程序错误|无法正常启动') {
      $buttons = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
      foreach ($b in $buttons) {
        try {
          if ($b.Current.Name -match '确定|OK') {
            $p = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $p.Invoke()
            $closed++
          }
        } catch { }
      }
    }
  } catch { }
}
Write-Output ("CLOSED=" + $closed)
`
  const { execSync } = await import('node:child_process')
  const { writeFileSync } = await import('node:fs')
  writeFileSync('scripts/out/close-dialogs.ps1', script, 'utf8')
  console.log(execSync('powershell -NoProfile -ExecutionPolicy Bypass -File scripts/out/close-dialogs.ps1', { encoding: 'utf8' }))
}
await main()
