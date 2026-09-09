# LongStitch

浏览器本地运行的纵向长截图拼接工具。选图 → 自动识别重叠 → 检查/校正接缝 → 裁剪首尾 / 遮挡隐私 → PNG/JPEG 导出。图片不上传，完整宽度保留。

## 本地运行

需要 Node.js 22.18+（本次验证 Node 26.8.1），npm 9.6.5+。

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:4321/`。Astro 7 的 dev 命令可能转为后台服务，用 `npx astro dev status` / `npx astro dev stop` 管理。

```sh
npm run verify
npm run samples  # 可选：需要本地 samples/*.PNG
```

`samples/` 和 `artifacts/` 被 Git 忽略，永远不放进 `public/`。`npm run samples` 读取原图，输出本地分析 JSON、长图和接缝裁图；不会上传。

## 部署到 Cloudflare

推荐 Workers Static Assets，不需要服务端 Worker 脚本、数据库、R2 或图片 API。

```sh
npm run build
npm run check:build
npm run deploy:check
```

上述 dry-run 不创建远程部署。确认 Cloudflare 账户与 `wrangler.jsonc` 的项目名后，正式发布：

```sh
npx wrangler login
npx wrangler deploy
```

本次没有执行 login 或远程 deploy。Wrangler 的本地 Miniflare 通过 package.json 的 Sharp override 使用修复版 0.35.4；升级 Wrangler 后应复核是否仍需要该覆盖。自定义域名在 Cloudflare 配置。正式发布前通过环境配置填写 `PUBLIC_SITE_URL`、`PUBLIC_CONTACT_EMAIL`，不要向聊天或仓库提供登录令牌。

Pages 也可以部署同一个 `dist/`：构建命令 `npm run build`，输出目录 `dist`，Node 版本 22.18+，不设置 Functions。CLI 使用 `npx wrangler pages deploy dist --project-name=<your-project>`。`public/_headers` 提供安全头，`404.html` 使不存在的路径返回 404，不会进入编辑器。

## 实现和边界

- Astro 7 静态内容，React 19 编辑器，TypeScript 拼接核心，浏览器 Web Worker 计算。Sharp 只用于本地脚本/测试，不进入浏览器。
- 相邻原图独立匹配、多个内容块与原图纹理验证、整数位移、整宽接缝；不对文字做模糊融合或生成补画。
- 匹配可以忽略边缘，但输出不裁边。滚动条候选和用户标记的遮挡只能从有真实覆盖、上下文匹配的原图恢复；无法恢复时保留并提示。
- 遮挡范围在原截图上框选、移动或拖角缩放，支持撤销与放大；不需要输入坐标。
- 最终长图支持可视化顶部/底部裁剪，默认关闭，不改动原始文件或完整宽度；红色区域表示将删除的部分。已有隐私遮挡按内容坐标保持位置，先写入像素再裁剪。重新拼接/应用接缝或范围会重置裁剪与遮挡。
- 低置信度会要求校正。手动选择直接连接后才允许不去重输出。自动乱序推断、录屏、HEIC、云保存不在此版内。
- 输入同宽、同缩放；单张 16MP / 一批 32MP，输出 48MP。上限不保证低内存手机都能处理；浏览器画布/编码失败会显示错误，可减少输入或选择缩小导出。
- 当前依靠完整输入解码进行分析，未来若真实手机内存证据要求，再增加按对流式处理。不宣称已完成所有手机适配。
- 不加载广告、埋点、第三方字体和会话回放。编辑器与公开内容页通过完整导航隔离。

## 广告后续

当前没有广告代码、假发布者 ID 或广告账户。待真实域名、运营联系信息、平台审核与地域同意方案确定后，仅在公开内容页接入 AdSense，并按实际 ID 添加 `ads.txt`。保持编辑文档无广告脚本，广告加载失败不能影响工具。

完整研究见 [产品调研](docs/research/2026-09-09-product-research.md)，切片与当前验收见 [PLAN](docs/PLAN.md)。真机、大陆网络、实际 Cloudflare 发布和广告获批属于后续外部门槛，不以本地构建代替。
