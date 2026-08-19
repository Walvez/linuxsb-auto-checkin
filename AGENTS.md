# AGENTS.md

本仓库提供一个 linux.sb 每日自动签到的**脚本猫（ScriptCat）定时脚本**。

## 关键文件

- `linuxsb-auto-checkin.scriptcat.user.js` —— 脚本本体（脚本猫/油猴兼容格式，用户脚本元数据 + 后台定时逻辑）
- `SCRIPT_CAT.md` —— 发布到脚本猫站点时使用的脚本说明（源码指向该文档时用）
- `README.md` —— GitHub 仓库 README

## 命名与发布约定

- 脚本文件固定命名为 `<repo>-auto-checkin.scriptcat.user.js`，与 `ablesci-auto-checkin` 仓库的 `ablesci.auto-checkin.scriptcat.user.js` 惯例一致。
- 脚本内 `@updateURL` / `@downloadURL` 指向本仓库 `main` 分支的 raw 地址：
  `https://raw.githubusercontent.com/Walvez/linuxsb-auto-checkin/main/linuxsb-auto-checkin.scriptcat.user.js`
- 脚本说明（脚本猫页面上的「脚本说明」）指向：
  `https://raw.githubusercontent.com/Walvez/linuxsb-auto-checkin/main/SCRIPT_CAT.md`

## 调度

`@crontab 5-55/5 * once * *` —— 每 5 分钟触发一次，`once` 保证一天只真正执行一次签到；因此浏览器开着时，打开后 5 分钟内完成签到。

## 维护

修改脚本后，记住同步升级 `@version` 与 `package.json` 版本号。
