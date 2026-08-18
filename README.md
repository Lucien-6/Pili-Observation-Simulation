# capsule-pili-sim

**Capsule Pili Simulator** · **胶囊细菌菌毛观察模拟**

A browser-based geometric model of a capsule-shaped bacterium and its pili, used to quantify how 3D pilus length is reduced to what an ideal optical microscope can count.

浏览器端的胶囊形细菌与菌毛几何模型，用于量化三维菌毛真长在理想光学显微镜观察下会被压缩成怎样的可见数量与投影长度。

[中文](#zhongwen) | [English](#english)

---

<a id="zhongwen"></a>

## 中文

### 项目简介

本程序在浏览器中构建一颗胶囊形细菌（圆柱加两端半球），并在菌体表面生成菌毛。镜头固定、只旋转细菌，用正交投影模拟俯视观察，再用菌体轮廓遮挡和硬景深裁剪，得到「显微镜里能看见的」菌毛根数与外伸投影长度。

它模拟的是**理想几何显微镜**：不包含点扩散函数、离焦模糊或菌毛之间的相互遮挡。目的是把姿态投影、轮廓遮挡和景深这三项几何效应单独算清楚，便于与实验直方图对照。

作者：Lucien（电子科技大学软物质与微生物技术实验室）  
邮箱：lucien-6@qq.com  
版本：1.2.1（2025-04），文档更新日期：2026-08-18

### 功能

- 三维胶囊菌体 + 直线菌毛，主视图可滚轮缩放
- 正交投影视图（模拟显微镜俯视）
- 荧光视图：轮廓内（黄）、焦深内外伸（绿）、焦深外（红）
- 可选侧面视图，显示近/远焦平面
- 菌毛真长直方图、投影外伸长度直方图及可见根数统计
- 单次导出 JSON / Excel（含逐根真长–投影长对照）
- 批量模拟：固定当前尺寸与菌毛参数，多次重新抽样菌毛并随机姿态，导出 Excel 与分布图

### 如何运行

无需安装 Node.js 或 Python。用浏览器直接打开 `capsule.html` 即可。

首次运行需要联网，以便加载 CDN 上的 [Three.js](https://threejs.org/)、[Chart.js](https://www.chartjs.org/) 和 [SheetJS](https://sheetjs.com/)。之后可离线使用已缓存的页面。

建议使用最新版 Chrome、Edge 或 Firefox。

### 主要参数

| 参数 | 含义 |
| --- | --- |
| 胶囊高度 / 半球半径 | 菌体长轴与半径（模型长度单位） |
| 景深范围 / 焦点距离 | 沿世界 Z 轴的硬景深窗口，光轴固定 |
| X / Y / Z 旋转 | 只转细菌，不转镜头 |
| 菌毛数量 | 表面固着点数量 |
| 平均长度 | 伽马分布的均值 $`\mu`$ |
| 形状参数 $`k`$ | 标准伽马分布 $`\mathrm{Gamma}(k,\theta)`$，$`\theta=\mu/k`$ |

菌毛长度按标准伽马分布抽样（Marsaglia–Tsang；当 $`k<1`$ 时用 $`\mathrm{Gamma}(k+1)\times U^{1/k}`$）。固着点用带最小间距的表面采样；生长方向在表面法线 30° 圆锥内随机偏转。

### 可见判定

一根菌毛被计为可见，当且仅当：

1. 至少有一段落在焦深窗口内；
2. 二维投影后，相对菌体轮廓有外伸段；
3. 该外伸段的投影长度 $`\ge 0.8`$（与模型长度单位相同）。

批量结果里：

- **真实菌毛长度**表：每个模型的每根菌毛只出现一行，用于真长分布；
- **菌毛观测数据**表：每个姿态一行，按菌毛编号与该姿态的投影长度配对。同一根菌毛的真长会随姿态重复出现，**不要**把这些行当作独立真长样本。

### 文件说明

| 文件 | 说明 |
| --- | --- |
| `capsule.html` | 页面、控件与帮助 |
| `capsule.js` | 几何、投影分析、批量模拟与导出 |
| `LICENSE` | 学术非商业许可 |
| 示例 `*.png` | 历史批量运行的分布图，仅作界面示意 |

运行时生成的 Excel / JSON 默认不纳入版本库，可在程序内重新导出。

### 引用

若本工具对研究有帮助，请注明项目名称 **capsule-pili-sim**、作者 Lucien，以及实验室：电子科技大学软物质与微生物技术实验室。

### 许可

学术研究与教学可免费使用与修改。未经作者书面许可，禁止商业用途。详见 `LICENSE`。

---

<a id="english"></a>

## English

### Overview

This project builds a capsule-shaped bacterium (cylinder plus two hemispherical caps) in the browser and grows pili on its surface. The camera stays fixed while the cell rotates. An orthographic view mimics a top-down microscope; the cell silhouette and a hard depth-of-field window then determine how many pili are countable and how long their projected tips appear.

The optical model is an **ideal geometric microscope**. It does not include a point-spread function, defocus blur, or occlusion between pili. The point is to isolate three geometric effects—pose projection, silhouette clipping, and depth of field—so simulated histograms can be compared with experimental ones.

Author: Lucien (Soft Matter and Microbial Technology Laboratory, UESTC)  
Email: lucien-6@qq.com  
Version: 1.2.1 (2025-04); documentation updated 2026-08-18

### Features

- 3D capsule body with straight pili; scroll-wheel zoom in the main view
- Orthographic projection view (microscope-like top view)
- Fluorescence view: inside the outline (yellow), in-focus protruding tips (green), out of focus (red)
- Optional side view showing near/far focal planes
- Histograms of true pilus length and projected tip length, plus visible-count statistics
- Single-run export to JSON / Excel, including per-pilus true vs projected length
- Batch mode: keep size and pilus parameters, resample pili and randomize pose, then export Excel and distribution figures

### How to run

No Node.js or Python install is required. Open `capsule.html` in a web browser.

An internet connection is needed on the first load to fetch [Three.js](https://threejs.org/), [Chart.js](https://www.chartjs.org/), and [SheetJS](https://sheetjs.com/) from a CDN. Cached pages can be reused offline.

Use a recent Chrome, Edge, or Firefox build.

### Main parameters

| Parameter | Meaning |
| --- | --- |
| Capsule height / hemisphere radius | Cell long-axis length and radius (model units) |
| Depth of field / focus distance | Hard DoF slab along world Z; optical axis is fixed |
| X / Y / Z rotation | Rotates the cell only, not the camera |
| Pilus count | Number of surface attachment points |
| Mean length | Mean $`\mu`$ of the gamma distribution |
| Shape $`k`$ | Standard gamma $`\mathrm{Gamma}(k,\theta)`$ with $`\theta=\mu/k`$ |

True lengths are drawn from a standard gamma generator (Marsaglia–Tsang; for $`k<1`$, $`\mathrm{Gamma}(k+1)\times U^{1/k}`$). Attachment points use a minimum-distance surface sampler. Growth directions are jittered inside a 30° cone around the surface normal.

### Visibility rule

A pilus is counted as visible if and only if:

1. at least part of it lies inside the depth-of-field window;
2. after 2D projection it extends beyond the cell outline;
3. that protruding projected length is $`\ge 0.8`$ (same units as the model).

In batch output:

- the **true-length** sheet lists each pilus once per model, for true-length histograms;
- the **observation** sheet lists one row per pose, pairing each pilus with that pose’s projected length. True length is repeated across poses for pairing only—**do not** treat those rows as independent true-length samples.

### Repository layout

| File | Role |
| --- | --- |
| `capsule.html` | Page, controls, and in-app help |
| `capsule.js` | Geometry, projection analysis, batch runs, and export |
| `LICENSE` | Academic non-commercial license |
| Example `*.png` | Histograms from an older batch run, for illustration only |

Excel / JSON files produced at runtime are gitignored and can be regenerated from the app.

### Citation

If this tool helps your work, please mention **capsule-pili-sim**, the author Lucien, and the Soft Matter and Microbial Technology Laboratory, UESTC.

### License

Free to use and modify for academic research and teaching. Commercial use requires prior written permission. See `LICENSE`.
