# 知无不言标志资源

本目录是知无不言标志的唯一来源。界面、网页图标与安装包图标都从这里取用，不再各自维护一份图形。

标志是经过定制的「言」：顶部蓝色方点、三层横画与完整的「口」组成稳定的近方形轮廓，没有合字或隐藏字谜，缩小后仍可辨认。

## 标准颜色

- 石墨黑：`#17191C`
- 品牌蓝：`#1772F6`
- 暖象牙白：`#F7F5EF`
- 纯白：`#FFFFFF`

## 文件

| 文件 | 用途 |
| --- | --- |
| `symbol-color.svg` | 首选独立图标，透明背景；工作台侧栏、网页侧栏与登录提示都用它 |
| `symbol-reverse.svg` | 深色背景上的独立图标 |
| `symbol-mono-black.svg` | 单色印刷或受限场景 |
| `lockup-horizontal-color.svg` | 横向组合标，透明背景，文字已转轮廓 |
| `lockup-horizontal-reverse.svg` | 深色背景上的横向组合标 |
| `lockup-horizontal-mono.svg` | 单色横向组合标 |
| `app-icon-light.svg` / `app-icon-dark.svg` | 圆角方形应用图标，浅色与深色两版 |
| `zhiwubuyan.ico` | Windows 应用图标，安装包与可执行文件用 |
| `logo-system-preview.png` | 标志系统总览，仅供查阅 |

界面上按文字颜色随主题变化的标志，由 `src/workbench/src/components/brand-mark.tsx` 内联 `symbol-color.svg` 并把石墨黑替换为 `currentColor`，蓝色方点保持品牌固定色。需要静态图片时（`<img>`、`public/` 目录）直接引用 SVG 文件本身。

## 使用约定

- 图标四周至少保留「顶部蓝点宽度」大小的净空。
- 独立图标不小于 `20 px`；横向组合标不小于 `160 px` 宽；小于 `24 px` 时只用独立图标。
- 不拉伸、压扁或旋转标志，不改变笔画间距，不加阴影、渐变、描边或发光，不在复杂图片上直接使用彩色版，不单独改变蓝点颜色。

## 分发物对照

- `src/workbench/public/favicon.svg`、`src/web/public/favicon.svg`：`app-icon-light.svg` 的副本，浏览器图标必须是被直接提供的静态文件，因此各端保留一份。
- `build/icon.ico`：`zhiwubuyan.ico` 的副本，electron-builder 只在 `buildResources` 目录里找图标。

改动标志时先改本目录的源文件，再同步这两类副本。

## 说明

本目录尚未包含商标近似检索。长期商业化使用前，建议在正式注册前做一次图形商标检索。
