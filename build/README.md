# Windows 应用图标

`icon.ico` 是知无不言 Windows 包的应用图标，副本来自品牌资源
`src/brand/zhiwubuyan.ico`；`src/brand/` 是标志的唯一来源。

electron-builder 只在 `buildResources` 目录里找图标，所以这里保留一份副本。
图标文件是发布资源，构建时不依赖机器上安装的图像转换工具。
