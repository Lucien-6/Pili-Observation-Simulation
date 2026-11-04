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
版本：2.1.0（2026-11-04），文档更新日期：2026-11-04  
更新记录见 [`CHANGELOG.md`](CHANGELOG.md)

### 功能

- 三维胶囊菌体 + 直线菌毛，主视图可滚轮缩放，按住鼠标左键拖动可旋转（角度同步写回旋转控件，精确到 0.01°）
- 右上角的荧光视图 / 投影分析视图（正交投影，模拟显微镜俯视），共用同一窗口，用窗口右上角的按钮切换，滚轮可缩放图像（双击恢复）
  - 荧光视图：只显示可见菌毛段（景深内、外伸出轮廓且投影长度达到阈值的部分），不显示与胞体重叠和景深外的部分
  - 投影分析视图：显示全部分析结果——胞体轮廓内（黄）、景深内外伸（绿）、景深外（红）、菌毛与胞体边缘的交点（白点），带图例
- 左下角坐标轴示意图：显示菌体自身 X / Y / Z 轴在当前视角下的朝向（Y 为长轴），随旋转与视角同步变化
- 可选侧面视图，显示近/远焦平面
- 菌毛真长直方图、投影外伸长度直方图及可见根数统计
- 固着点分配可设置：默认圆柱面 55% / 半球面 45%（实验观测值），占比可调，也可按表面积自适应
- 手动旋转使用 XYZ 欧拉角，与批量模拟和导出文件同一约定，导出的角度可精确复现姿态
- 单次导出 JSON / Excel（含逐根真长–投影长对照），Excel 中的长度均为数值格式
- 批量模拟：固定当前尺寸与菌毛参数，多次重新抽样菌毛并在空间中均匀随机取向，导出 Excel 与分布图
- 中英文界面：工具栏的语言按钮一键切换，选择会记在浏览器里；首次打开按浏览器语言决定。图表、统计、帮助、导出文件的表名/表头/文件名同步切换
- 运行效率：批量模拟中间只做分析、不渲染视图，每个姿态约 16–20 ms（旧版约 300 ms）；界面空闲时不重复渲染，并修复了反复更新时的 GPU 内存泄漏

### 如何运行

无需安装 Node.js 或 Python，本项目没有 `requirements.txt` 之类的依赖清单。用浏览器直接打开 `pili-sim.html` 即可（程序为普通脚本，双击打开也能运行）。

首次运行需要联网，以便加载 CDN 上的第三方库。之后可离线使用已缓存的页面。页面固定引用以下版本：

| 库 | 版本 | 用途 |
| --- | --- | --- |
| [Three.js](https://threejs.org/)（含 OrbitControls） | r132 | 三维建模与渲染 |
| [Chart.js](https://www.chartjs.org/) | 3.7.0 | 直方图 |
| [SheetJS (xlsx)](https://sheetjs.com/) | 0.18.5 | Excel 导出 |

建议使用最新版 Chrome、Edge 或 Firefox。

### 主要参数

| 参数 | 含义 |
| --- | --- |
| 胶囊高度 / 半球半径 | 菌体总长与半径（模型长度单位），需满足高度 ≥ 2 × 半径，界面会自动联动限制 |
| 景深范围 / 焦点距离 | 沿世界 Z 轴的硬景深窗口，光轴固定 |
| X / Y / Z 旋转 | 只转细菌，不转镜头 |
| 菌毛数量 | 表面固着点数量 |
| 固着点分配 / 圆柱占比 | 圆柱与半球之间的点数分配：固定比例（默认 55% / 45%，占比可调）或按表面积自适应 |
| 平均长度 | 伽马分布的均值 $`\mu`$ |
| 集中度 $`k`$ | 长度分布的集中程度，即伽马分布的形状参数，$`k`$ 越大越集中；标准伽马分布 $`\mathrm{Gamma}(k,\theta)`$，$`\theta=\mu/k`$ |

菌毛长度按标准伽马分布抽样（Marsaglia–Tsang；当 $`k<1`$ 时用 $`\mathrm{Gamma}(k+1)\times U^{1/k}`$）。固着点用带最小间距的表面采样。圆柱面与两个半球面之间的分配比例可在界面“固着点分配”中选择：

- **固定比例（默认）**：圆柱面 55%、两个半球面 45%，来自实验观测，可用“圆柱占比”修改；
- **按表面积自适应**：按圆柱与半球的表面积比例分配。

每个模型先按比例确定两部分各自的点数（随机取整，期望比例严格等于设定值），再在各部分内做带最小间距的采样，半球内面积均匀；最小间距按两部分中较密的一侧估算。高度等于 2 倍半径（无圆柱段）时，全部点落在半球上。批量导出的“模型参数”表会记录分配方式和实际使用的圆柱占比。

生长方向在表面法线 30° 圆锥内按立体角均匀随机偏转。

批量模拟中的每个姿态是 SO(3) 上的均匀随机取向（均匀单位四元数），因此菌体长轴方向在空间中各向同性。姿态用 XYZ 欧拉角（Three.js 顺序，单位度，精度 0.01°）表示，批量模拟、手动旋转控件和导出文件使用同一约定：模型实际使用的姿态就是由导出的角度构造的，把导出的三个角度填入旋转控件即可精确复现该姿态。

投影长度按正交相机的实际可视宽度 $`(\text{right}-\text{left})/\text{zoom}`$ 换算为模型长度单位，像素量化误差约为一个像素。

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
| `pili-sim.html` | 页面、控件与帮助（用户指南在页面内“帮助”对话框中，含中英文两版） |
| `pili-sim.js` | 几何、投影分析、批量模拟与导出 |
| `pili-sim-i18n.js` | 中英文界面文本与语言切换（须先于 `pili-sim.js` 加载） |
| `CHANGELOG.md` | 版本更新记录 |
| `LICENSE` | 学术非商业许可 |
| 示例 `*.png` | 1.2.1 版本历史批量运行的分布图，仅作界面示意；数值受 1.5.0 已修复的偏差影响（见 `CHANGELOG.md`），不应与新结果对比 |

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
Version: 2.1.0 (2026-11-04); documentation updated 2026-11-04  
Release notes: see [`CHANGELOG.md`](CHANGELOG.md)

### Features

- 3D capsule body with straight pili; scroll-wheel zoom in the main view and left-button drag to rotate (the angles are written back to the rotation controls, to 0.01°)
- Fluorescence view / projection analysis view at the top right (orthographic projection, microscope-like top view) share one window; a button in its title bar switches between them, the mouse wheel zooms the image (double-click restores it)
  - Fluorescence view: only the visible pilus segments (inside the depth of field, protruding from the outline and reaching the length threshold); parts overlapped by the cell and parts outside the depth of field are not shown
  - Projection analysis view: the complete analysis — inside the outline (yellow), protruding in focus (green), outside the depth of field (red), pilus / cell-edge intersections (white dots), with a legend
- Axis gizmo at the bottom left: the bacterium's own X / Y / Z axes as seen from the camera (Y is the long axis), following the rotation and the viewpoint
- Optional side view showing near/far focal planes
- Histograms of true pilus length and projected tip length, plus visible-count statistics
- Configurable attachment allocation: 55% cylinder / 45% hemispheres by default (experimental observation), adjustable, or area-proportional
- Manual rotation uses XYZ Euler angles, the same convention as batch mode and the exports, so exported angles reproduce a pose exactly
- Single-run export to JSON / Excel, including per-pilus true vs projected length; lengths are numeric cells in Excel
- Batch mode: keep size and pilus parameters, resample pili and draw isotropic random orientations, then export Excel and distribution figures
- Bilingual UI (Chinese / English): one-click language button in the toolbar, remembered in the browser; the first visit follows the browser language. Charts, statistics, help, and the sheet names / headers / file names of exports switch together
- Performance: batch mode only analyses (no view rendering) between poses, about 16–20 ms per pose (about 300 ms before); the page does not re-render while idle, and a GPU memory leak on repeated updates is fixed

### How to run

No Node.js or Python install is required, and there is no `requirements.txt`-style dependency list. Open `pili-sim.html` in a web browser (the scripts are classic scripts, so double-clicking the file works).

An internet connection is needed on the first load to fetch third-party libraries from a CDN. Cached pages can be reused offline. The page pins these versions:

| Library | Version | Purpose |
| --- | --- | --- |
| [Three.js](https://threejs.org/) (with OrbitControls) | r132 | 3D modelling and rendering |
| [Chart.js](https://www.chartjs.org/) | 3.7.0 | Histograms |
| [SheetJS (xlsx)](https://sheetjs.com/) | 0.18.5 | Excel export |

Use a recent Chrome, Edge, or Firefox build.

### Main parameters

| Parameter | Meaning |
| --- | --- |
| Capsule height / hemisphere radius | Total cell length and radius (model units); height ≥ 2 × radius is enforced by linked limits in the UI |
| Depth of field / focus distance | Hard DoF slab along world Z; optical axis is fixed |
| X / Y / Z rotation | Rotates the cell only, not the camera |
| Pilus count | Number of surface attachment points |
| Attachment allocation / cylinder share | How points are split between the cylinder and the hemispheres: fixed share (default 55% / 45%, adjustable) or area-proportional |
| Mean length | Mean $`\mu`$ of the gamma distribution |
| Concentration $`k`$ (labelled "集中度" in the Chinese UI) | Spread of the length distribution, i.e. the gamma shape parameter; larger $`k`$ gives a narrower distribution. Standard gamma $`\mathrm{Gamma}(k,\theta)`$ with $`\theta=\mu/k`$ |

True lengths are drawn from a standard gamma generator (Marsaglia–Tsang; for $`k<1`$, $`\mathrm{Gamma}(k+1)\times U^{1/k}`$). Attachment points use a minimum-distance surface sampler. The split between the cylinder and the two hemispheres is set under "Attachment allocation" in the UI:

- **Fixed share (default)**: 55% on the cylinder and 45% on the two hemispheres, from experimental observation; the cylinder share is adjustable;
- **Area-proportional**: points are split in proportion to the surface areas of the two parts.

For each model the per-region point counts are drawn first (stochastic rounding, so the expected share equals the setting exactly), then points are placed inside each region with a minimum spacing, area-uniformly within each hemisphere; the spacing is derived from the denser of the two regions. When height equals 2 × radius (no cylinder), all points lie on the hemispheres. The batch "model parameters" sheet records the allocation mode and the cylinder share actually used.

Growth directions are jittered inside a 30° cone around the surface normal, uniformly over the solid angle.

In batch mode each pose is a uniform random orientation on SO(3) (uniform unit quaternion), so the cell's long axis is isotropic in space. A pose is expressed as XYZ Euler angles (three.js order, degrees, 0.01° resolution), and batch mode, the manual rotation controls and the exports all use this convention: the pose that is analysed is built from exactly the exported angles, so entering the exported angles into the rotation controls reproduces the pose exactly.

Projected lengths are converted to model units using the true orthographic visible width $`(\text{right}-\text{left})/\text{zoom}`$; the quantization error is about one pixel.

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
| `pili-sim.html` | Page, controls, and in-app help (the user guide is the bilingual Help dialog in the page) |
| `pili-sim.js` | Geometry, projection analysis, batch runs, and export |
| `pili-sim-i18n.js` | Chinese / English UI strings and language switching (must load before `pili-sim.js`) |
| `CHANGELOG.md` | Release notes |
| `LICENSE` | Academic non-commercial license |
| Example `*.png` | Histograms from a version 1.2.1 batch run, for illustration only; the values are affected by the bias fixed in 1.5.0 (see `CHANGELOG.md`) and should not be compared with new results |

Excel / JSON files produced at runtime are gitignored and can be regenerated from the app.

### Citation

If this tool helps your work, please mention **capsule-pili-sim**, the author Lucien, and the Soft Matter and Microbial Technology Laboratory, UESTC.

### License

Free to use and modify for academic research and teaching. Commercial use requires prior written permission. See `LICENSE`.
