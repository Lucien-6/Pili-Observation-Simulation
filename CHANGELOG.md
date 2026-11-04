# Changelog

All notable changes to **capsule-pili-sim** (胶囊细菌菌毛观察模拟) are recorded here.
Dates use `YYYY-MM-DD`. Author: Lucien (Soft Matter and Microbial Technology Laboratory, UESTC).

本文件记录 **capsule-pili-sim** 的所有重要变更。日期格式为 `YYYY-MM-DD`。作者：Lucien（电子科技大学软物质与微生物技术实验室）。

## [2.0.0] - 2026-11-04

Major release: the program files are renamed (existing bookmarks and shortcuts to `capsule.html` stop working), the interface becomes bilingual, and batch mode is about 15× faster. The simulation results themselves are unchanged from 1.5.0 (bit-identical analysis).

大版本：程序文件改名（指向 `capsule.html` 的书签和快捷方式将失效），界面支持中英双语，批量模拟约快 15 倍。模拟结果本身与 1.5.0 一致（分析结果逐位相同）。

### Changed / 变更

- **Files renamed** to match the project: `capsule.html` → `pili-sim.html`, `capsule.js` → `pili-sim.js`; the new `pili-sim-i18n.js` holds the UI strings and must load before `pili-sim.js`. Update any bookmarks or shortcuts.
  — 文件改名：`capsule.html` → `pili-sim.html`，`capsule.js` → `pili-sim.js`；新增 `pili-sim-i18n.js` 存放界面文本，须先于 `pili-sim.js` 加载。请更新书签或快捷方式。
- **Batch mode is much faster**: about 16–20 ms per pose instead of about 300 ms (default parameters, measured in one browser; timings are indicative). Between poses only the analysis runs; the views, charts and fluorescence scene are not rendered, and the preview refreshes at a low rate. Analysis results are bit-identical to the previous implementation.
  — 批量模拟明显提速：每个姿态约 16–20 ms，旧版约 300 ms（默认参数、单一浏览器实测，数值仅供参考）。姿态之间只做分析，不渲染视图、图表和荧光场景，预览低频刷新。分析结果与旧实现逐位一致。
- **Idle and interaction cost reduced**: the main view renders only when something changed; the debug canvas is drawn only while visible; per-update analysis cost roughly halves; each rotation input triggers exactly one analysis.
  — 空闲与交互开销降低：主视图仅在有变化时渲染；调试画布仅在可见时绘制；单次更新的分析开销约减半；每次旋转输入只触发一次分析。

### Added / 新增

- **Chinese / English interface switch.** A toolbar button toggles the language; the choice is stored in the browser (default follows the browser language). Controls, charts, statistics, legend, help, dialogs, and the sheet names, headers, notes and file names of exports are translated.
  — 中英文界面切换：工具栏按钮切换语言，选择保存在浏览器中（默认跟随浏览器语言）。控件、图表、统计、图例、帮助、对话框，以及导出文件的表名、表头、说明和文件名均已翻译。

### Fixed / 修复

- **GPU memory leak**: discarded capsules, pili and per-frame fluorescence geometries were never disposed. Geometry counts now stay constant over repeated updates (previously about 10,600 extra geometries per 100 updates).
  — GPU 内存泄漏：被丢弃的菌体、菌毛和每帧荧光几何体此前从未释放，现在反复更新时几何体数量保持恒定（此前每 100 次更新约多 10,600 个）。
- **Side-view leak**: every side-view refresh rebuilt two 601-point depth-of-field lines and the centre marker without releasing them (+3 GPU geometries per refresh, also on every pili regeneration while the side view was open). They are now released, and the dashed lines use two end points (same appearance).
  — 侧面视图泄漏：每次刷新侧面视图都会重建两条 601 点的景深线和中心标记却不释放（每次 +3 个 GPU 几何体，侧面视图打开时每次重新生成菌毛也会触发）。现已释放，虚线改用两个端点（外观不变）。
- **Empty numeric inputs**: clearing a size, pili, depth-of-field or rotation box no longer writes `NaN` into the model; the previous value is kept.
  — 数值框清空：清空尺寸、菌毛、景深或旋转输入框后不再把 `NaN` 写入模型，而是保留原值。
- The interface strings now load before the CDN libraries, so English users no longer see a flash of Chinese text on a slow first load; the duplicate start-up analysis was removed.
  — 界面文本改为先于 CDN 库加载，英文用户在首次慢加载时不再先看到一闪而过的中文；并去掉了启动时重复的一次分析。

## [1.5.0] - 2026-11-04

This release consolidates all changes since 1.2.1; no versions in between were published.
**Results from 1.5.0 are not comparable with results (including the example figures) from 1.2.1 and earlier**, because the projected-length bias and the sampling issues below are fixed.

本版本汇总自 1.2.1 以来的全部改动，中间版本号未发布。**1.5.0 的结果不能与 1.2.1 及更早版本的结果（包括示例图）直接对比**，因为下列投影长度偏差和抽样问题已被修复。

### Fixed / 修复

- **Projected lengths were 20% too short.** The pixel-to-length conversion ignored the orthographic camera zoom (0.8). The conversion now uses the true visible width `(right - left) / zoom`; the remaining error is below one pixel (about 0.01 model units).
  — 投影长度偏小 20%：像素到长度的换算没有计入正交相机的 zoom（0.8）。现按实际可视宽度 `(right - left) / zoom` 换算，剩余误差小于一个像素（约 0.01 模型单位）。
  Measured impact with default parameters (10 models x 20 poses): mean visible pili 8.64 → 9.79 and mean projected length 1.612 → 1.886 from this fix alone.
  默认参数下（10 个模型 × 20 个姿态）仅此一项修复，平均可见根数由 8.64 变为 9.79，平均投影长度由 1.612 变为 1.886。
- **Hemisphere sampling was not area-uniform** (points clustered near the poles); it is now area-uniform.
  — 半球上的固着点不是面积均匀（向极点聚集），现已改为面积均匀。
- **Capsule degenerated when height < 2 x radius.** Height and radius controls are now linked so that height ≥ 2 × radius always holds; the cylinder length is also clamped at 0.
  — 高度小于 2 倍半径时胶囊退化：高度与半径控件现已联动，始终满足高度 ≥ 2 × 半径，圆柱段长度也限制为不小于 0。
- **Excel numbers were stored as text** (`toFixed` strings). All numeric cells in batch and single exports are now real numbers; empty data shows `N/A`.
  — Excel 中的数值被存成文本（`toFixed` 字符串）：批量与单次导出里所有数值单元格现为真正的数值，空数据显示 `N/A`。
- **Manual rotation did not match the exported angles.** The Y and Z sliders used a different composition than the XYZ Euler angles written to the exports. All three sliders now define XYZ Euler angles directly.
  — 手动旋转与导出角度不对应：Y、Z 滑块的组合方式与导出的 XYZ 欧拉角不一致，现三个滑块直接定义 XYZ 欧拉角。

### Changed / 变更

- **Attachment allocation.** The cylinder / hemisphere split now defaults to a fixed 55% / 45% (from experimental observation) instead of an implicit ratio. Per-region point counts are drawn as a quota (stochastic rounding, expected share exact), and the minimum spacing is derived from the denser region.
  — 固着点分配：圆柱/半球的分配默认改为固定 55% / 45%（实验观测值）。各区域点数按配额抽取（随机取整，期望比例精确），最小间距按较密一侧估算。
- **Batch poses are now isotropic.** Each pose is a uniform random orientation on SO(3) (uniform unit quaternion) rather than three uniform Euler angles, which over-sampled orientations along the optical axis. Poses are applied from the exported Euler angles (0.01° resolution), so they reproduce exactly.
  — 批量姿态各向同性：每个姿态为 SO(3) 上的均匀随机取向（均匀单位四元数），不再是三个均匀分布的欧拉角（该方式在光轴方向上采样偏多）。姿态由导出的欧拉角（精度 0.01°）构造，可精确复现。
- **Growth direction jitter** inside the 30° cone is now uniform over the solid angle (previously uniform in polar angle).
  — 30° 圆锥内的生长方向偏转改为立体角均匀（原为极角均匀）。
- **Parameter renamed**: "形状参数" is now "集中度" (the gamma shape parameter k; it controls the spread of pilus lengths, not their shape). Exported headers read "集中度(k)".
  — 参数改名：“形状参数”改为“集中度”（即伽马分布的形状参数 k，控制的是菌毛长度的离散程度，而非菌毛形状）。导出表头为“集中度(k)”。
- Batch Excel: the model-parameter sheet gains "固着点分配" and "圆柱占比(%)" columns; the notes sheet documents the pose sampling, length conversion and allocation. The single-run export records the allocation and rotation convention.
  — 批量 Excel：“模型参数”表新增“固着点分配”“圆柱占比(%)”两列，“数据说明”表补充姿态抽样、长度换算和分配方式的说明；单次导出记录分配方式和旋转约定。

### Added / 新增

- UI controls for attachment allocation: mode selector (fixed share / area-proportional), cylinder share slider and input, and a live readout of the effective split. The setting is saved and restored by batch runs.
  — 固着点分配的界面控件：方式选择（固定比例 / 按表面积自适应）、圆柱占比滑块与输入框，以及实际比例的实时显示；批量模拟会保存并恢复该设置。
- This `CHANGELOG.md`; the README now lists the pinned CDN library versions (there is no `requirements.txt`, because the project has no Python or Node dependencies).
  — 新增本 `CHANGELOG.md`；README 现列出固定引用的 CDN 库版本（项目没有 Python 或 Node 依赖，因此没有 `requirements.txt`）。
- In-app help (user guide) updated for all of the above.
  — 页面内帮助（用户指南）已同步更新。

## [1.2.1] - 2025-04

The day of the month was not recorded. / 具体日期未记录。

- Formal version: 3D capsule body with straight pili, orthographic projection view, fluorescence view, optional depth-of-field side view, histograms of true and projected length, JSON / Excel export, and batch simulation with Excel and distribution-figure export.
  — 正式版本：三维胶囊菌体与直线菌毛、正交投影视图、荧光视图、可选景深侧面视图、真长与投影长度直方图、JSON / Excel 导出，以及批量模拟（导出 Excel 与分布图）。
