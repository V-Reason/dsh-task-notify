# dsh-task-notify

DSH（DeepSeek Harness）Web 插件：Agent / 子代理 / 工作流任务完成时，弹出真正的 **Windows 系统通知**（带提示音与 DeepSeek 图标），可选 PushPlus 微信推送。浏览器关闭也能收到。

## 特性

- **系统级通知**：经 BurntToast（PowerShell 模块）调用 Windows 通知中心，播放系统提示音，无需网页授权；
- **手机推送**：通过 PushPlus 同步推送到微信，电脑不在身边也能收到；
- **通知内容**：会话名（沿父链回溯到根会话）、完成时间、状态（完成 / 失败 / 中止…）；
- **分类开关**：主回合 / 子代理 / 工作流 独立开关，另有总开关一键关闭全部通知；
- **持久配置**：配置存于 DSH settings（`task-notify` 命名空间），重启不丢；
- **布局自适应**：配置面板逐帧（rAF）跟随 dsh-better-sidebar 面板让位，不遮挡。

## 界面

- 会话标题栏右侧铃铛按钮：总开关关 → 空心铃铛；总开关开 → 实心铃铛；总开关开且推送开 → 右上角白色手机剪影；
- 毛玻璃配置面板：总开关 / 提醒对象 / 手机推送，含保存、测试推送、测试通知。

## 环境要求

- DSH Web（profile 插件机制），Windows 10/11；
- PowerShell 7（pwsh）与 BurntToast 模块：

  ```powershell
  Install-Module BurntToast -Scope CurrentUser
  ```

## 安装

1. 在 profile 的 `package.json` 中 `dependencies` 增加：

   ```json
   "dsh-task-notify": "file:<本仓库路径>"
   ```

2. 在 `dsh.profile.bundles` 数组末尾追加 `"dsh-task-notify"`；
3. 在 profile 目录执行 `pnpm install`，重启 DSH。

> 宿主行由本包自带的 bundle 补丁（`cordis.patch.yml`）注入，**不要**再写入 profile 的
> `cordis.patch.yml`，否则启动报 `duplicate loader entry id: dsh-task-notify`。

## 使用

1. 在 https://www.pushplus.plus 扫码登录，复制「一对一推送」token；
2. 点击标题栏铃铛 → 打开「手机推送（PushPlus）」开关 → 粘贴 token → 保存；
3. 用「测试通知」「测试推送」验证两条通道。

## 构建

```powershell
node build.mjs
# pnpm 对 file: 依赖按内容拷贝，改完后同步到 profile 再刷新页面 / 重启：
Copy-Item lib\*.js <profile>\node_modules\dsh-task-notify\lib\ -Force
Copy-Item deepseek.png <profile>\node_modules\dsh-task-notify\ -Force
```

说明：构建使用 DeepSeek Harness 自带的 esbuild 与 vendored schemastery/cosmokit（`@deepseek-ai/dsh-*` 保持外部引用）；harness 不在默认路径时用环境变量指定：

```powershell
$env:DSH_HARNESS = 'D:\path\to\deepseek-harness'
```

wire 编解码为手写严格 schema，无额外运行时依赖。

## 许可

MIT

图标 `deepseek.png` 由 DeepSeek 品牌标识（`deepseek.svg`）转出，仅用作应用图标。
