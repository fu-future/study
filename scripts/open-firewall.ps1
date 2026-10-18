# 放行 Windows 防火墙的入站端口，让同一局域网的手机能访问本机服务。
#
# 用法（必须：右键 PowerShell → 以管理员身份运行）：
#   powershell -ExecutionPolicy Bypass -File scripts\open-firewall.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\open-firewall.ps1 -Port 3100
#
# 安全默认值：只对「专用网络（Private）」放行。
# 也就是说连接公共 Wi-Fi（咖啡店、酒店）时，即使服务在跑，别人也访问不到。

param(
  [int]$Port = 3100,
  [string]$Profile = 'Private'
)

$ErrorActionPreference = 'Stop'
$ruleName = "AI Study Coach (TCP $Port)"

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  "已存在放行规则：$ruleName（无需重复添加）"
  exit 0
}

try {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile $Profile `
    -Description '允许同一局域网内的手机访问 AI 高中学习教练' | Out-Null

  "已添加入站放行规则：$ruleName"
  "  端口：TCP $Port"
  "  适用范围：$Profile 网络（家庭 / 学校 Wi-Fi）"
  ""
  "如果仍然连不上，依次检查："
  "  1) 手机和电脑是否在同一个 Wi-Fi（没有走各自的移动数据）"
  "  2) 路由器是否开启了「AP 隔离 / 访客网络隔离」"
  "  3) 电脑上是否还有第三方防火墙（例如安全软件自带的那种）"
}
catch {
  "添加失败：$($_.Exception.Message)"
  ""
  "请以管理员身份重新运行："
  "  右键开始菜单 → Windows PowerShell (管理员) → 执行上面的命令"
  exit 1
}
