# 关闭 Windows 防火墙「是否允许应用访问网络」弹窗（点击「允许」）
# 仅在自动化验收环境使用：弹窗会阻塞 dev server 绑定端口
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition
)

$targets = @()
foreach ($win in $windows) {
  try {
    $name = $win.Current.Name
    $class = $win.Current.ClassName
    if ($class -eq '#32770' -and ($name -match '安全|Security|防火墙|Firewall')) {
      $targets += $win
    }
  } catch { }
}

if ($targets.Count -eq 0) {
  Write-Host 'NO_FIREWALL_DIALOG'
  exit 0
}

foreach ($win in $targets) {
  Write-Host "DIALOG=$($win.Current.Name) CLASS=$($win.Current.ClassName)"
  $buttons = $win.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button))
  )
  foreach ($button in $buttons) {
    try {
      $label = $button.Current.Name
      Write-Host "  BUTTON=$label"
      if ($label -match '^允\s*许|^Allow') {
        $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        Write-Host "  CLICKED=$label"
      }
    } catch {
      Write-Host "  CLICK_FAILED=$($_.Exception.Message)"
    }
  }
}
