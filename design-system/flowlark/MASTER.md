# Flowlark 设计系统 · Master

> 全局唯一真相。页面级覆盖放 `pages/<页面>.md`，存在时覆盖本文件。

*Where prototypes flow*

## 这份文档是怎么来的

用 `ui-ux-pro-max` 技能查了 product / style / color / typography / ux / stack 六个域，**但没有照单全收**。两处偏离，理由记在下面，免得以后有人拿工具输出来质疑：

| 工具建议 | 实际采用 | 为什么 |
|---|---|---|
| 落地页版式 "Newsletter / Content First"、"Real-Time Operations Landing" | 不采用 | 查询词被路由到了落地页域。Flowlark 没有落地页，是纯工作台。这是误命中，不是建议。 |
| 开发者工具首选暗色（`#020617` 底 + `#22C55E` 强调） | 亮色为主，暗色预留 | 原型预览多是白底，工作台暗色会和 iframe 内容强烈打架。且品牌色已定为青绿，另起一套强调色等于两个品牌。token 写成语义变量，将来补一组覆盖值即可。 |

采纳的：Inter 字体（技能库对开发者工具/高端生产力工具的一致推荐）、密集型仪表盘间距档（8–32px）、Soft UI Evolution 的阴影思路（比扁平有层次、比拟物克制）、以及全部无障碍规则。

## 色彩

品牌色见 [`assets/brand/README.md`](../../assets/brand/README.md)。这里是 UI 语义层。

| Token | 值 | 用途 |
|---|---|---|
| `--fl-primary` | `#0E9384` | 主按钮、链接、选中态、基线标识 |
| `--fl-primary-hover` | `#12A594` | hover |
| `--fl-primary-active` | `#0B7A6E` | active |
| `--fl-primary-deep` | `#0B5F55` | 浅底上的文字 |
| `--fl-primary-border` | `#7FD8CA` | 卡片 hover 边框、引用块左边线 |
| `--fl-primary-bg` | `#E6F7F4` | 选中行、标签底 |
| `--fl-text` | `#101828` | 正文 |
| `--fl-text-2` | `#475467` | 次要说明 |
| `--fl-text-3` | `#98A2B3` | 元信息、时间戳 |
| `--fl-line` | `#EAECF0` | 分隔线、边框 |
| `--fl-bg` | `#F9FAFB` | 页面底 |
| `--fl-surface` | `#FFFFFF` | 卡片、面板 |
| `--fl-draft` | `#DC6803` | 草稿状态 |
| `--fl-history` | `#667085` | 历史版本 |
| `--fl-danger` | `#D92D20` | 删除、废弃 |

**版本状态不能只靠颜色。** 草稿 / 基线 / 历史 / 已废弃四种状态必须同时有文字标签，色点只作辅助 —— 这是技能库优先级 1 的规则（`色彩单独承载信息`），色觉障碍用户否则读不出差别。

**暗色预留：** 所有组件只引用上表变量，不写字面量。补暗色时新增一组 `[data-theme="dark"]` 覆盖即可，不必翻组件。

## 字阶

界面基准 13px（Ant Design 生态惯例，密集型工具合适），规格书正文单独提到 15px。

| Token | 值 | 用途 |
|---|---|---|
| `--fl-fs-1` | 11px | 元信息、时间戳、角标 |
| `--fl-fs-2` | 12px | 次要说明、表格副文本 |
| `--fl-fs-3` | 13px | **界面基准**：按钮、标签、正文 |
| `--fl-fs-4` | 15px | 规格书正文 |
| `--fl-fs-5` | 20px | 页面标题 |
| `--fl-fs-6` | 26px | 基线版本号等主数字 |

行高：正文 1.5，长文（规格书）1.65，标题 1.25。

**砍掉 12.5px / 13.5px。** 现有代码里这两个值出现 11 次，没有一处是有意为之，且半像素在不同缩放下渲染不一致。

**规格书为什么单独给 15px：** 那是全站唯一需要连续阅读的区域。13px 读一屏就累，而它恰恰是研发要逐行核对的内容。

## 间距

4 的倍数，密集型仪表盘档位：

`--fl-s-1: 4px` · `--fl-s-2: 8px` · `--fl-s-3: 12px` · `--fl-s-4: 16px` · `--fl-s-5: 24px` · `--fl-s-6: 32px`

工作台一屏要同时装下预览、规格书、变更、需求四类内容。间距给到 40+ 会逼出滚动条，而滚动是这个页面最不该有的东西。

## 圆角与阴影

`--fl-r-1: 4px`（标签）· `--fl-r-2: 6px`（按钮、输入框）· `--fl-r-3: 8px`（卡片）· `--fl-r-4: 12px`（弹窗）

阴影走 Soft UI Evolution 的思路 —— 比扁平有层次，比拟物克制：

- `--fl-shadow-1: 0 1px 2px rgba(16,24,40,.06)` 静态卡片
- `--fl-shadow-2: 0 2px 8px rgba(14,147,132,.09)` hover 抬起（带主色，不是灰）
- `--fl-shadow-3: 0 8px 24px rgba(16,24,40,.12)` 弹窗、抽屉

## 动效

时长 150–250ms，缓动 `cubic-bezier(.4,0,.2,1)`。动效只用来表达空间关系（抽屉从右侧滑入、卡片抬起），**不做纯装饰**。

必须有全局降级：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

前庭敏感用户会因位移动画产生生理不适。这不是偏好设置，是无障碍要求。

## 无障碍基线

按技能库优先级 1–2，以下每条都是硬性的：

- **焦点可见。** 所有可交互元素 `:focus-visible` 显示 `2px solid var(--fl-primary)` + `outline-offset: 2px`。用 `:focus-visible` 而非 `:focus`，鼠标点击不显示描边。**绝不 `outline: none` 了事。**
- **语义元素。** 可点击的东西用 `<button>` / `<a>`，不用 `<div @click>`。换掉就同时拿到键盘可达和读屏支持，不必补 ARIA。
- **对比度 ≥ 4.5:1。** 主色 `#0E9384` 对白底是 4.6:1。正文不得低于 12px。
- **图标按钮必须有 `aria-label`。**
- **加载超过 300ms 给反馈**，优先骨架屏（按真实内容形状占位，加载完不跳版），其次转圈。
- **破坏性操作二次确认**（删除、废弃、回滚）。
- **成功要出声。** 静默成功让人怀疑没生效。

## 图标

统一用 `@ant-design/icons`。**不用 emoji 当图标** —— 跨平台渲染不一致，读屏软件会念出表情名。

现有代码里 `🔒 沙箱隔离`、`⇤ 全宽` 这类要换成图标组件。

## 技术栈约定

React 19 + TypeScript/TSX + React Router 7 + Ant Design 6 + Vite 5。

- CSS token 定义在 `web/src/styles/global.css` 的 `:root`；Ant Design token 通过 `web/src/main.tsx` 的 `ConfigProvider` 配置。调整主题时同步维护这两个当前来源。
- 组件里**不写字面量颜色和字号**，只引用 `var(--fl-*)`。
- 现有 255 处内联 `style="..."` 逐步收进类名。判断标准：出现两次以上的样式组合就该有名字。
- ARIA 属性使用 JSX 动态值（`aria-expanded={open}`），不写死。

## 响应式

断点 `768px` / `1024px` / `1440px`。

工作台在 900px 以下从左右分栏改为上下堆叠 —— 横向硬挤的结果是两边都难用（已实现）。表格用 `overflow-x: auto` 包裹，不让它撑破视口。
