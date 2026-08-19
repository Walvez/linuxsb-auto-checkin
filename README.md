# linuxsb-auto-checkin

linux.sb 每日自动签到脚本（**脚本猫 ScriptCat 定时脚本**版），在浏览器后台自动完成 [linux.sb](https://linux.sb/) 每日签到。

- 脚本文件：`linuxsb-auto-checkin.scriptcat.user.js`
- 使用说明：见 [SCRIPT_CAT.md](./SCRIPT_CAT.md)
- 安装：脚本猫（ScriptCat），浏览器需已登录 linux.sb

## 脚本猫安装

1. 安装并启用 [脚本猫 ScriptCat](https://scriptcat.org/)
2. 打开并登录 [linux.sb](https://linux.sb/)
3. 安装 `linuxsb-auto-checkin.scriptcat.user.js`（可用脚本猫的「新建脚本」粘贴，或通过脚本猫站点安装）
4. 授权脚本访问 `linux.sb` / `www.linux.bi` 的 Cookie
5. 首次建议从脚本菜单执行一次「立即签到」验证

## 调度

`@crontab 5-55/5 * once * *` —— 每 5 分钟触发一次、`once` 保证一天只执行一次，因此**浏览器开着时，打开后 5 分钟内自动完成签到**。

## 原理

linux.sb 每日签到走 `/daily_checkin`：`GET` 读取状态并提取 `_csrf`，未签到则 `POST _csrf` 提交。已签到即跳过。接口逻辑参考 [vfhky/linux-sb-pro](https://github.com/vfhky/linux-sb-pro)（Apache-2.0）。

## License

MIT
