// 创建主场景
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

// 创建主相机
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 5);

// 创建主渲染器
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 创建荧光渲染器
const fluorescenceRenderer = new THREE.WebGLRenderer({ antialias: true });
fluorescenceRenderer.setSize(512, 512);  // same size as the analysis canvas (512 x 512)
document.getElementById('fluorescenceCanvas').appendChild(fluorescenceRenderer.domElement);

// 创建投影相机（正交相机）
const projectionCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 1000);
projectionCamera.position.set(0, 10, 0);  // 从正上方看向原点
projectionCamera.lookAt(0, 0, 0);
projectionCamera.zoom = 0.8;
projectionCamera.updateProjectionMatrix();

// 创建侧面视图场景、相机和渲染器
const sideViewScene = new THREE.Scene();
sideViewScene.background = new THREE.Color(0xf0f0f0);

// 创建侧面视图相机（正交相机，从侧面看）
const sideViewCamera = new THREE.OrthographicCamera(-4.5, 4.5, 3, -3, 0.1, 1000);
sideViewCamera.position.set(5, 0, 0);  // 从侧面看向原点
sideViewCamera.lookAt(0, 0, 0);
sideViewCamera.zoom = 0.8;
sideViewCamera.updateProjectionMatrix();

// 创建侧面视图渲染器
const sideViewRenderer = new THREE.WebGLRenderer({ antialias: true });
sideViewRenderer.setSize(600, 450);

// 侧面视图显示状态
let sideViewVisible = false;

// 添加景深平面线条变量
let nearDepthLine = null;
let farDepthLine = null;

// 添加轨道控制器
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.autoRotate = false;
controls.enableRotate = false;
controls.enableZoom = true;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 10;

// 添加光源
const ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

// 创建图表
let hairLengthHistChart = null;
let projectionHairLengthChart = null;  // 添加投影菌毛长度图表
let currentHairLengths = [];
let projectionHairLengths = [];  // visible projected outside lengths
let currentHairObservations = [];  // one record per hair, paired with true length
let isBatchSimulationCancelled = false;

// Minimum projected outside length (model units) counted as visible
const VISIBLE_PROJECTION_LENGTH_THRESHOLD = 0.8;

// 添加景深相关变量
let depthOfField = 5.0;  // 景深范围
let focusDistance = 0.0; // 焦点距离
let depthPlanes = null;  // 用于可视化景深平面的对象
let showDepthPlanes = true; // 是否显示景深平面

// ================ Performance helpers ================
// Shared materials: the per-update views used to allocate fresh materials on every refresh.
const SILHOUETTE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
// One palette for the fluorescence view, the projection analysis view and their legend.
// The cell is a mid-dark green so that the yellow "inside" segments (pili overlapped by the cell, shown in the
// analysis view) and the bright green protruding segments both stand out.
const FLUORESCENCE_HEX = {
    background: 0x111111,
    body: 0x2f7f55,
    inside: 0xffe600,
    outside: 0x00ff00,
    outOfDepth: 0xff0000
};
const hexToCss = (hex) => '#' + hex.toString(16).padStart(6, '0');
const FLUORESCENCE_CSS = {
    background: hexToCss(FLUORESCENCE_HEX.background),
    body: hexToCss(FLUORESCENCE_HEX.body),
    inside: hexToCss(FLUORESCENCE_HEX.inside),
    outside: hexToCss(FLUORESCENCE_HEX.outside),
    outOfDepth: hexToCss(FLUORESCENCE_HEX.outOfDepth),
    intersection: '#ffffff'  // pilus / cell-edge intersections on the analysis image
};
const FLUORESCENCE_BODY_MATERIAL = new THREE.MeshBasicMaterial({
    color: FLUORESCENCE_HEX.body, side: THREE.DoubleSide, transparent: false, opacity: 1.0
});
// Visible pilus segments of the fluorescence view
const FLUORESCENCE_OUTSIDE_MATERIAL = new THREE.LineBasicMaterial({
    color: FLUORESCENCE_HEX.outside, linewidth: 2.5, opacity: 1.0, transparent: false
});

// Reusable buffers for the 512x512 silhouette analysis
const SILHOUETTE_SIZE = 512;
const silhouettePixelBuffer = new Uint8Array(SILHOUETTE_SIZE * SILHOUETTE_SIZE * 4);
const silhouetteMap = new Uint8Array(SILHOUETTE_SIZE * SILHOUETTE_SIZE);  // row-major, 1 = capsule body
let silhouetteScene = null;

// While true (batch simulation) updateProjectionView() runs the analysis only: no view rendering, charts or debug drawing
let batchFastMode = false;
// The main view is rendered only when something changed (not every animation frame)
let mainViewDirty = true;

// Release GPU buffers and materials owned by an object tree that is being discarded
function disposeObject3D(root) {
    root.traverse((node) => {
        if (node.geometry) {
            node.geometry.dispose();
        }
        if (node.material) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.forEach((material) => material.dispose());
        }
    });
}

// ================ 工具函数 ================
// 计算两点之间的距离
function distance(p1, p2) {
    return Math.sqrt(
        Math.pow(p1.x - p2.x, 2) +
        Math.pow(p1.y - p2.y, 2) +
        Math.pow(p1.z - p2.z, 2)
    );
}

// Round to fixed decimals but keep a number type
// (toFixed returns a string, which Excel would store as text instead of a number)
function roundTo(value, digits) {
    return Number(Number(value).toFixed(digits));
}

// Standard normal via Box-Muller
function randomStandardNormal() {
    let u = 0;
    let v = 0;
    while (u === 0) {
        u = Math.random();
    }
    while (v === 0) {
        v = Math.random();
    }
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Gamma(shape, scale) with mean = shape * scale
// shape >= 1: Marsaglia-Tsang (2000); shape < 1: Gamma(k+1) * U^{1/k}
function gammaRandom(shape, scale) {
    if (shape <= 0 || scale <= 0) {
        throw new Error('Shape and scale parameters must be positive');
    }

    if (shape < 1) {
        let u = Math.random();
        while (u === 0) {
            u = Math.random();
        }
        return gammaRandom(shape + 1, scale) * Math.pow(u, 1 / shape);
    }

    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    while (true) {
        let x;
        let v;
        do {
            x = randomStandardNormal();
            v = 1 + c * x;
        } while (v <= 0);

        v = v * v * v;
        const u = Math.random();
        if (u < 1 - 0.0331 * x * x * x * x ||
            Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
            return scale * d * v;
        }
    }
}

function generateGammaDistributedLength(meanLength, shape) {
    const scale = meanLength / shape;
    return gammaRandom(shape, scale);
}

// 生成胶囊表面的随机点
// Default share of attachment points on the cylindrical part (percent), from experimental observation.
// The remaining 45% sit on the two hemispherical caps.
const DEFAULT_CYLINDER_SHARE_PERCENT = 55;

// Fraction of the surface area that belongs to the cylindrical part
function getCylinderAreaFraction(radius, height) {
    const cylinderHeight = Math.max(0, height - 2 * radius);
    const cylinderArea = 2 * Math.PI * radius * cylinderHeight;
    const capsArea = 4 * Math.PI * radius * radius;
    return cylinderArea / (cylinderArea + capsArea);
}

// Probability that an attachment point lies on the cylinder.
// mode 'fixed': user-defined share (percent); mode 'area': proportional to surface area.
// A capsule without a cylindrical part (height = 2r) has everything on the caps.
function computeCylinderFraction(radius, height, mode, sharePercent) {
    if (height - 2 * radius <= 1e-9) {
        return 0;
    }
    if (mode === 'area') {
        return getCylinderAreaFraction(radius, height);
    }
    const share = Number.isFinite(sharePercent) ? sharePercent : DEFAULT_CYLINDER_SHARE_PERCENT;
    return Math.max(0, Math.min(100, share)) / 100;
}

// Minimum spacing between attachment points, from the point density of the most crowded region.
// With area-proportional allocation both regions have the same density (same as one global estimate);
// with a fixed share the hemispheres can be denser than the cylinder, so each region is checked separately.
// 0.8 is an empirical packing factor.
function computeMinDistance(radius, height, count, cylinderFraction) {
    if (count <= 0) {
        return Infinity;
    }
    const cylinderHeight = Math.max(0, height - 2 * radius);
    const cylinderArea = 2 * Math.PI * radius * cylinderHeight;
    const capsArea = 4 * Math.PI * radius * radius;

    const areaPerPoint = [];
    if (cylinderFraction > 0 && cylinderArea > 0) {
        areaPerPoint.push(cylinderArea / (count * cylinderFraction));
    }
    if (cylinderFraction < 1) {
        areaPerPoint.push(capsArea / (count * (1 - cylinderFraction)));
    }
    return Math.sqrt(Math.min(...areaPerPoint) / Math.PI) * 0.8;
}

// region: 'cylinder' | 'caps' | undefined (undefined = random, proportional to surface area)
function getRandomPointOnCapsule(radius, height, region) {
    // Cylinder length; clamped so that height < 2r degrades to a sphere instead of a negative length
    const cylinderHeight = Math.max(0, height - 2 * radius);

    let onCylinder;
    if (region === 'cylinder') {
        onCylinder = cylinderHeight > 0;
    } else if (region === 'caps') {
        onCylinder = false;
    } else {
        onCylinder = Math.random() < getCylinderAreaFraction(radius, height);
    }
    let point = new THREE.Vector3();
    let normal = new THREE.Vector3();

    if (onCylinder) {
        // 在圆柱体上均匀分布
        const angle = Math.random() * Math.PI * 2;
        const y = (Math.random() - 0.5) * cylinderHeight;
        point.set(
            radius * Math.cos(angle),
            y,
            radius * Math.sin(angle)
        );
        normal.set(Math.cos(angle), 0, Math.sin(angle));
    } else {
        // 在半球上均匀分布
        const isTop = Math.random() < 0.5; // 半球上的点在上下半球均匀分布
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        // Area-uniform on a hemisphere: cos(phi) is uniform on [0, 1]
        const phi = Math.acos(v);

        const sinPhi = Math.sin(phi);
        const x = radius * sinPhi * Math.cos(theta);
        const z = radius * sinPhi * Math.sin(theta);
        const y = radius * Math.cos(phi) * (isTop ? 1 : -1) + (isTop ? cylinderHeight / 2 : -cylinderHeight / 2);

        point.set(x, y, z);
        normal.copy(point).sub(new THREE.Vector3(0, isTop ? cylinderHeight / 2 : -cylinderHeight / 2, 0)).normalize();
    }

    return { point, normal };
}

// 使用泊松圆盘采样生成均匀分布的点
// cylinderFraction: expected share of points on the cylinder (0-1); undefined = proportional to surface area.
// The number of points per region is drawn as a quota (stochastic rounding, so the expected share is exact),
// then each point is placed by dart throwing inside its region with a minimum spacing.
function generatePoissonPoints(radius, height, count, minDistance, cylinderFraction) {
    const points = [];
    const maxTries = 200; // candidates tried per point

    // Per-region quotas
    const fraction = (cylinderFraction === undefined)
        ? computeCylinderFraction(radius, height, 'area')
        : cylinderFraction;
    const expectedCylinder = count * fraction;
    let cylinderCount = Math.floor(expectedCylinder);
    if (Math.random() < expectedCylinder - cylinderCount) {
        cylinderCount += 1;
    }
    const regions = [];
    for (let i = 0; i < count; i++) {
        regions.push(i < cylinderCount ? 'cylinder' : 'caps');
    }
    // Shuffle so that hair indices are not ordered by region (Fisher-Yates)
    for (let i = regions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [regions[i], regions[j]] = [regions[j], regions[i]];
    }

    for (let k = 0; k < count; k++) {
        const region = regions[k];
        let best = null;
        let bestGap = -Infinity;

        for (let t = 0; t < maxTries; t++) {
            const candidate = getRandomPointOnCapsule(radius, height, region);

            // Distance to the nearest existing point
            let gap = Infinity;
            for (let j = 0; j < points.length; j++) {
                const d = distance(candidate.point, points[j].point);
                if (d < gap) {
                    gap = d;
                }
            }

            if (gap >= minDistance) {
                best = candidate;
                break;
            }
            // Region too crowded for the requested spacing: remember the roomiest candidate
            if (gap > bestGap) {
                bestGap = gap;
                best = candidate;
            }
        }

        points.push(best);
    }

    return points;
}

// ================ 图表函数 ================
// 初始化图表
function initCharts() {
    // 毛发长度直方图
    const histCtx = document.getElementById('hairLengthHistCanvas');
    if (histCtx) {
        // 设置固定的画布大小
        histCtx.style.height = '250px';  // 固定高度
        histCtx.style.width = '100%';    // 宽度自适应

        hairLengthHistChart = new Chart(histCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: tr('chart.trueLength.label'),
                    data: [],
                    backgroundColor: 'rgba(54, 162, 235, 0.5)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                animation: false,           // no 1 s redraw animation on every refresh
                responsive: true,
                maintainAspectRatio: true,  // 保持宽高比
                aspectRatio: 2,             // 设置宽高比为2:1
                layout: {
                    padding: {
                        bottom: 25  // 增加底部内边距
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: tr('chart.axis.length')
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: tr('chart.axis.frequency')
                        },
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return tr('chart.tooltip.frequency', { value: context.parsed.y });
                            }
                        }
                    },
                    legend: {
                        display: false  // 隐藏图例，因为已经有标题了
                    }
                }
            }
        });
        hairLengthHistChart.attached = true;  // 添加attached属性
    } else {
        console.error('True length chart container not found');
    }

    // 投影菌毛长度直方图
    const projHistCtx = document.getElementById('projectionHairLengthCanvas');
    if (projHistCtx) {
        projectionHairLengthChart = new Chart(projHistCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: tr('chart.projLength.label'),
                    data: [],
                    backgroundColor: 'rgba(75, 192, 192, 0.5)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: tr('chart.axis.length')
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: tr('chart.axis.frequency')
                        },
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return tr('chart.tooltip.frequency', { value: `${(context.parsed.y * 100).toFixed(1)}%` });
                            }
                        }
                    },
                    legend: {
                        display: false
                    }
                }
            }
        });
        projectionHairLengthChart.attached = true;
    } else {
        console.error('Projected length chart container not found');
    }
}

// Re-apply the current language to the chart texts (tooltips already read it lazily)
function applyChartLanguage() {
    [
        [hairLengthHistChart, 'chart.trueLength.label'],
        [projectionHairLengthChart, 'chart.projLength.label']
    ].forEach(([chart, labelKey]) => {
        if (!chart) {
            return;
        }
        chart.data.datasets[0].label = tr(labelKey);
        chart.options.scales.x.title.text = tr('chart.axis.length');
        chart.options.scales.y.title.text = tr('chart.axis.frequency');
        chart.update('none');
    });
}

// 更新毛发长度直方图
function updateHairLengthHistogram(hairLengths) {
    if (!hairLengthHistChart) {
        console.error('True length chart is not initialised');
        return;
    }

    if (hairLengths.length === 0) {
        hairLengthHistChart.data.labels = [];
        hairLengthHistChart.data.datasets[0].data = [];
        hairLengthHistChart.update('none');
        return;
    }

    // 确定直方图的区间范围
    const min = Math.floor(Math.min(...hairLengths));
    const max = Math.ceil(Math.max(...hairLengths));
    const binWidth = 0.5;
    const binCount = Math.ceil((max - min) / binWidth);

    // 创建区间
    const bins = Array(binCount).fill(0);
    const binLabels = [];

    for (let i = 0; i < binCount; i++) {
        const lowerBound = min + i * binWidth;
        const upperBound = min + (i + 1) * binWidth;
        binLabels.push(`${lowerBound.toFixed(1)}-${upperBound.toFixed(1)}`);
    }

    // 统计每个区间的数量
    hairLengths.forEach(length => {
        const binIndex = Math.min(Math.floor((length - min) / binWidth), binCount - 1);
        bins[binIndex]++;
    });

    // 归一化处理
    const totalCount = hairLengths.length;
    const normalizedBins = bins.map(count => count / totalCount);

    // 更新图表数据
    hairLengthHistChart.data.labels = binLabels;
    hairLengthHistChart.data.datasets[0].data = normalizedBins;
    hairLengthHistChart.options.scales.y.title.text = tr('chart.axis.frequency');
    hairLengthHistChart.options.plugins.tooltip.callbacks.label = function (context) {
        return tr('chart.tooltip.frequency', { value: `${(context.parsed.y * 100).toFixed(1)}%` });
    };
    hairLengthHistChart.update('none');
}

// 更新投影菌毛长度直方图
function updateProjectionHairLengthHistogram(hairLengths) {
    if (!projectionHairLengthChart) {
        console.error('Projected length chart is not initialised');
        return;
    }

    if (hairLengths.length === 0) {
        // 如果没有数据，清空图表
        projectionHairLengthChart.data.labels = [];
        projectionHairLengthChart.data.datasets[0].data = [];
        projectionHairLengthChart.update('none');

        // 更新统计信息
        const statsInfoElement = document.getElementById('projectionStatsInfo');
        if (statsInfoElement) {
            statsInfoElement.innerHTML = tr('stats.none', { threshold: VISIBLE_PROJECTION_LENGTH_THRESHOLD });
        }
        return;
    }

    // 确定直方图的区间范围
    const min = Math.floor(Math.min(...hairLengths));
    const max = Math.ceil(Math.max(...hairLengths));
    const binWidth = 0.5;  // 更小的区间宽度以获得更精细的分布
    const binCount = Math.max(1, Math.ceil((max - min) / binWidth));

    // 创建区间
    const bins = Array(binCount).fill(0);
    const binLabels = [];

    for (let i = 0; i < binCount; i++) {
        const lowerBound = min + i * binWidth;
        const upperBound = min + (i + 1) * binWidth;
        binLabels.push(`${lowerBound.toFixed(1)}-${upperBound.toFixed(1)}`);
    }

    // 统计每个区间的数量
    hairLengths.forEach(length => {
        const binIndex = Math.min(Math.floor((length - min) / binWidth), binCount - 1);
        if (binIndex >= 0) bins[binIndex]++;
    });

    // 归一化处理
    const totalCount = hairLengths.length;
    const normalizedBins = bins.map(count => count / totalCount);

    // 更新图表数据
    projectionHairLengthChart.data.labels = binLabels;
    projectionHairLengthChart.data.datasets[0].data = normalizedBins;
    projectionHairLengthChart.update('none');

    // 计算平均长度和标准差
    const avgLength = hairLengths.reduce((sum, len) => sum + len, 0) / totalCount;
    const variance = hairLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / totalCount;
    const stdDev = Math.sqrt(variance);

    // 更新统计信息 - 添加过滤说明
    const statsInfoElement = document.getElementById('projectionStatsInfo');
    if (statsInfoElement) {
        statsInfoElement.innerHTML =
            tr('stats.result', { count: totalCount, threshold: VISIBLE_PROJECTION_LENGTH_THRESHOLD }) +
            `Mean: ${avgLength.toFixed(2)} | ` +
            `STD: ${stdDev.toFixed(2)} | ` +
            `Min: ${min.toFixed(2)}, Max: ${max.toFixed(2)}`;
    }
}

// 修改 createDepthPlanes 函数，添加景深范围外标记
function createDepthPlanes() {
    // 如果已经存在景深平面，先移除
    if (depthPlanes) {
        sideViewScene.remove(depthPlanes);
        disposeObject3D(depthPlanes);
    }

    // 创建一个组来包含所有景深相关的对象
    depthPlanes = new THREE.Group();
    depthPlanes.userData = { ownsResources: true };

    // 计算景深的前后边界
    const nearZ = focusDistance - depthOfField / 2;
    const farZ = focusDistance + depthOfField / 2;

    // 创建近景深点划线（蓝色）
    createDashedLine(nearZ, 0x0088ff);

    // 创建远景深点划线（红色）
    createDashedLine(farZ, 0xff4444);

    // 将景深平面组添加到侧面视图场景
    sideViewScene.add(depthPlanes);
}

// 创建景深点划线函数
function createDashedLine(zPosition, color) {
    // 创建点划线几何体
    const lineGeometry = new THREE.BufferGeometry();

    // A vertical line of height 6; two end points are enough, the dash pattern follows the line distance
    lineGeometry.setFromPoints([
        new THREE.Vector3(0, -3, zPosition),
        new THREE.Vector3(0, 3, zPosition)
    ]);

    // 创建点划线材质，增加线宽和对比度
    const lineMaterial = new THREE.LineDashedMaterial({
        color: color,
        linewidth: 3,
        scale: 1,
        dashSize: 0.3,
        gapSize: 0.15,
    });

    // 创建线条对象
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.computeLineDistances(); // 计算线段的距离，这是点划线必需的

    // 将线条添加到景深平面组
    depthPlanes.add(line);

    // 存储线条引用
    if (color === 0x0088ff) {
        nearDepthLine = line;
    } else {
        farDepthLine = line;
    }

    return line;
}

// 更新景深平面位置
function updateDepthPlanesPosition() {
    if (!depthPlanes) return;

    const nearPlaneDistance = focusDistance - depthOfField / 2;
    const farPlaneDistance = focusDistance + depthOfField / 2;

    // 更新平面位置
    depthPlanes.children[0].position.z = nearPlaneDistance;
    depthPlanes.children[1].position.z = farPlaneDistance;

    // 更新侧面视图
    if (sideViewVisible) {
        updateSideView();
    }
}

// 修改 updateSideView 函数，确保胶囊体在侧面视图中正确显示
function updateSideView() {
    // 确保侧面视图容器存在
    const sideViewCanvas = document.getElementById('sideViewCanvas');
    if (!sideViewCanvas) return;

    // 清空侧面视图
    while (sideViewCanvas.firstChild) {
        sideViewCanvas.removeChild(sideViewCanvas.firstChild);
    }

    // 添加渲染器到容器
    sideViewCanvas.appendChild(sideViewRenderer.domElement);

    // 清空侧面视图场景
    while (sideViewScene.children.length > 0) {
        const obj = sideViewScene.children[0];
        sideViewScene.remove(obj);
        // Release only what the side view owns; the capsule clone shares geometry/materials with the live capsule
        if (obj.userData && obj.userData.ownsResources) {
            disposeObject3D(obj);
        }
    }

    // 添加光源
    const ambientLight = new THREE.AmbientLight(0x404040);
    sideViewScene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(5, 1, 1);
    sideViewScene.add(directionalLight);

    // 添加景深平面
    createDepthPlanes();

    // 克隆胶囊体并添加到侧面视图
    if (capsule) {
        const capsuleClone = capsule.clone();
        // 确保胶囊体在侧面视图中保持与主视图相同的旋转状态
        capsuleClone.rotation.copy(capsule.rotation);
        capsuleClone.quaternion.copy(capsule.quaternion);
        sideViewScene.add(capsuleClone);
    }

    // 添加中心点标记
    const centerGeometry = new THREE.SphereGeometry(0.05, 16, 16);
    const centerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const centerSphere = new THREE.Mesh(centerGeometry, centerMaterial);
    centerSphere.userData.ownsResources = true;
    sideViewScene.add(centerSphere);

    // 渲染侧面视图
    sideViewRenderer.render(sideViewScene, sideViewCamera);

    // 更新标签位置
    updateDepthLabelsPosition();
}

// 修改更新景深标签位置的函数，移除文本标签相关代码
function updateDepthLabelsPosition() {
    if (!depthPlanes) return;

    // 更新点划线
    if (nearDepthLine && farDepthLine) {
        // 计算景深的前后边界
        const nearZ = focusDistance - depthOfField / 2;
        const farZ = focusDistance + depthOfField / 2;

        // 更新近景深点划线位置
        updateDashedLine(nearDepthLine, nearZ);

        // 更新远景深点划线位置
        updateDashedLine(farDepthLine, farZ);
    }
}

// 更新点划线位置的函数
function updateDashedLine(line, zPosition) {
    if (!line) return;

    const positions = line.geometry.attributes.position.array;

    // 更新线条的所有点的Z坐标
    for (let i = 0; i < positions.length; i += 3) {
        positions[i + 2] = zPosition;
    }

    line.geometry.attributes.position.needsUpdate = true;
    line.computeLineDistances(); // 重新计算线段距离
}

// ================ 主要功能函数 ================
// 创建胶囊几何体
function createCapsule(radius, height, segments) {
    const cylinderHeight = Math.max(0, height - 2 * radius);
    const cylinderGeometry = new THREE.CylinderGeometry(radius, radius, cylinderHeight, segments, 1);
    const cylinder = new THREE.Mesh(
        cylinderGeometry,
        new THREE.MeshPhongMaterial({ color: 0x156289, transparent: false, opacity: 1.0 })
    );

    const topSphereGeometry = new THREE.SphereGeometry(radius, segments, segments, 0, Math.PI * 2, 0, Math.PI / 2);
    const topSphere = new THREE.Mesh(
        topSphereGeometry,
        new THREE.MeshPhongMaterial({ color: 0x156289, transparent: false, opacity: 1.0 })
    );
    topSphere.position.y = cylinderHeight / 2;

    const bottomSphereGeometry = new THREE.SphereGeometry(radius, segments, segments, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    const bottomSphere = new THREE.Mesh(
        bottomSphereGeometry,
        new THREE.MeshPhongMaterial({ color: 0x156289, transparent: false, opacity: 1.0 })
    );
    bottomSphere.position.y = -cylinderHeight / 2;

    const capsule = new THREE.Group();
    capsule.add(cylinder);
    capsule.add(topSphere);
    capsule.add(bottomSphere);

    return capsule;
}

// 在法线方向的30度范围内随机调整方向
function randomizeNormalDirection(normal) {
    // 创建正交基 - 找到与法线垂直的两个向量，形成一个本地坐标系
    const temp = new THREE.Vector3(0, 1, 0);
    // 如果法线接近y轴，使用x轴作为参考
    if (Math.abs(normal.y) > 0.95) {
        temp.set(1, 0, 0);
    }
    
    // 创建垂直于法线的第一个向量
    const tangent = new THREE.Vector3().crossVectors(normal, temp).normalize();
    // 创建垂直于法线和第一个向量的第二个向量
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    
    // Uniform over the solid angle of a 30-degree cone: cos(theta) is uniform on [cos(30deg), 1]
    const maxAngle = Math.PI / 6;
    const cosMax = Math.cos(maxAngle);
    const theta = Math.acos(cosMax + (1 - cosMax) * Math.random());
    const phi = Math.random() * Math.PI * 2; // 水平角范围[0, 360度]
    
    // 基于球坐标系计算偏移向量
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    
    // 创建新的方向向量：保持法线方向为主，加上随机偏移
    const randomDir = new THREE.Vector3()
        .copy(normal).multiplyScalar(cosTheta)
        .add(tangent.clone().multiplyScalar(sinTheta * cosPhi))
        .add(bitangent.clone().multiplyScalar(sinTheta * sinPhi));
    
    // 确保向量是单位长度
    return randomDir.normalize();
}

// 创建毛发
function createHair(point, normal, length, hairIndex = 0) {
    const hairGeometry = new THREE.BufferGeometry();
    
    // 随机化毛发生长方向
    const randomDirection = randomizeNormalDirection(normal.clone());
    
    const positions = new Float32Array([
        point.x, point.y, point.z,
        point.x + randomDirection.x * length,
        point.y + randomDirection.y * length,
        point.z + randomDirection.z * length
    ]);

    hairGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const hairMaterial = new THREE.LineBasicMaterial({
        color: 0x00ff00,
        linewidth: 1
    });
    const hair = new THREE.Line(hairGeometry, hairMaterial);
    hair.userData.hairIndex = hairIndex;
    hair.userData.trueLength = length;
    return hair;
}

// 更新胶囊
function updateCapsule() {
    // 清除现有的胶囊和菌毛
    while (capsule.children.length > 0) {
        const oldChild = capsule.children[0];
        capsule.remove(oldChild);
        disposeObject3D(oldChild);
    }

    const height = parseFloat(document.getElementById('heightValue').value);
    const radius = parseFloat(document.getElementById('radiusValue').value);
    const hairCount = parseInt(document.getElementById('hairCountValue').value);
    const meanHairLength = parseFloat(document.getElementById('hairLengthValue').value);
    const shapeParam = parseFloat(document.getElementById('shapeParamValue').value);

    // 保存当前四元数旋转
    const currentQuaternion = capsule.quaternion.clone();
    scene.remove(capsule);
    disposeObject3D(capsule);

    capsule = createCapsule(radius, height, 32);

    // Attachment points: cylinder/hemisphere split follows the UI setting (fixed share or area-proportional)
    const anchorSettings = readAnchorSettings();
    const cylinderFraction = computeCylinderFraction(
        radius, height, anchorSettings.anchorMode, anchorSettings.cylinderShare
    );
    const minDistance = computeMinDistance(radius, height, hairCount, cylinderFraction);
    const hairPoints = generatePoissonPoints(radius, height, hairCount, minDistance, cylinderFraction);
    updateAnchorRatioText(radius, height);

    // 清空当前毛发长度数组
    currentHairLengths = [];

    // 生成符合伽马分布的毛发
    for (let i = 0; i < hairPoints.length; i++) {
        const { point, normal } = hairPoints[i];
        // 生成符合伽马分布的毛发长度
        const hairLength = generateGammaDistributedLength(meanHairLength, shapeParam);
        currentHairLengths.push(hairLength);

        const hair = createHair(point, normal, hairLength, i);
        capsule.add(hair);
    }

    // 应用保存的四元数旋转
    capsule.quaternion.copy(currentQuaternion);
    scene.add(capsule);

    mainViewDirty = true;

    // Batch fast mode: skip the UI-only updates (they are refreshed by the periodic preview and at the end)
    if (!batchFastMode) {
        // 更新直方图
        updateHairLengthHistogram(currentHairLengths);

        // 更新侧面视图，如果它存在
        if (sideViewVisible) {
            updateSideView();
        }
    }

    // 更新投影视图
    updateProjectionView();
}

// 更新投影视图
// Remember the camera/pose that the projection views were last computed for,
// so the animation loop does not repeat an update that was just done explicitly.
function syncViewChangeCache() {
    if (!camera.userData.lastPosition) {
        camera.userData.lastPosition = new THREE.Vector3();
        camera.userData.lastQuaternion = new THREE.Quaternion();
        camera.userData.lastCapsuleQuaternion = new THREE.Quaternion();
    }
    camera.userData.lastPosition.copy(camera.position);
    camera.userData.lastQuaternion.copy(camera.quaternion);
    camera.userData.lastCapsuleQuaternion.copy(capsule.quaternion);
}

function isProjectionViewStale() {
    return !camera.userData.lastPosition ||
        !camera.position.equals(camera.userData.lastPosition) ||
        !camera.quaternion.equals(camera.userData.lastQuaternion) ||
        !capsule.quaternion.equals(camera.userData.lastCapsuleQuaternion);
}

// Update only if the views do not already reflect the current camera/pose
function updateProjectionViewIfStale() {
    if (isProjectionViewStale()) {
        updateProjectionView();
    }
}

// options.forceFull: render all views even while batch fast mode is active
function updateProjectionView(options) {
    const analysisOnly = batchFastMode && !(options && options.forceFull);

    // 创建投影胶囊的副本
    const projectionCapsule = capsule.clone();
    // 确保投影胶囊的旋转与主胶囊一致
    projectionCapsule.quaternion.copy(capsule.quaternion);

    // 用于存储投影菌毛数据
    projectionHairLengths = [];
    currentHairObservations = [];

    // 创建一个组来存放胶囊体部分（不包括菌毛）
    const capsuleBody = new THREE.Group();
    // 确保胶囊体的旋转与主胶囊一致
    capsuleBody.rotation.copy(projectionCapsule.rotation);

    // Collect the cell meshes (the pili stay in projectionCapsule)
    projectionCapsule.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            capsuleBody.add(child.clone());  // 添加到胶囊体组
        }
    });

    // 使投影相机与主相机保持一致的朝向
    projectionCamera.position.copy(camera.position);
    projectionCamera.lookAt(controls.target);
    projectionCamera.up.copy(camera.up);

    // 计算合适的正交相机视锥体大小
    const height = parseFloat(document.getElementById('heightValue').value);
    const radius = parseFloat(document.getElementById('radiusValue').value);
    const maxDimension = Math.max(height, radius * 2) * 2.0;

    // 使用固定的缩放因子，不再基于相机距离
    const aspect = 1;  // the analysis and display images are square (512 x 512)
    const baseSize = maxDimension * 1.2; // 添加20%的边距

    if (aspect >= 1) {
        projectionCamera.left = -baseSize * aspect / 2;
        projectionCamera.right = baseSize * aspect / 2;
        projectionCamera.top = baseSize / 2;
        projectionCamera.bottom = -baseSize / 2;
    }

    projectionCamera.updateProjectionMatrix();

    // World matrices used by the analysis (no renderer touches this copy any more)
    projectionCapsule.updateMatrixWorld(true);
    projectionCamera.updateMatrixWorld(true);

    if (analysisOnly) {
        // Analysis only: no view is drawn
        analyzeFluorescenceHairs(projectionCapsule, capsuleBody, { skipDebug: true });
        return;
    }

    try {
        updateFluorescenceView(projectionCapsule, capsuleBody, projectionCamera);
    } catch (error) {
        console.error('Fluorescence / analysis view error:', error);
    }

    syncViewChangeCache();
}

// ---- Fluorescence / projection analysis window ----
// One window, two images drawn from the same analysis: the fluorescence view (visible pilus segments only)
// and the projection analysis view (every analysed segment). They share one mouse-wheel zoom, which only changes
// how the images are displayed; the analysis itself always uses the fixed orthographic camera.
let analysisViewActive = false;      // false: fluorescence view, true: projection analysis view
let analysisViewZoom = 1;
let analysisViewZoomDirty = false;   // set by the wheel handler, applied once per animation frame
let analysisViewCanvas = null;       // 2D canvas of the projection analysis view
const ANALYSIS_VIEW_ZOOM_MIN = 0.5;
const ANALYSIS_VIEW_ZOOM_MAX = 10;
const fluorescenceViewCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 1000);

function updateFluorescenceView(projectionCapsule, capsuleBody, camera) {
    // The analysis always runs: it fills the statistics and, when that view is active, the analysis image
    const hairSegments = analyzeFluorescenceHairs(projectionCapsule, capsuleBody);

    if (!analysisViewActive) {
        renderFluorescenceImage(capsuleBody, hairSegments, camera);
    }

    // 更新投影菌毛长度直方图
    if (projectionHairLengthChart) {
        updateProjectionHairLengthHistogram(projectionHairLengths);
    } else {
        console.error('Projected length chart is not initialised');
        initCharts();
    }

    // 如果没有检测到外伸菌毛，显示提示信息
    if (projectionHairLengths.length === 0) {
        const statsInfoElement = document.getElementById('projectionStatsInfo');
        if (statsInfoElement) {
            statsInfoElement.innerHTML = tr('stats.noneInView');
        }
    }
}

// Fluorescence image: the cell plus the visible pilus segments only (in focus, protruding from the outline and
// at least VISIBLE_PROJECTION_LENGTH_THRESHOLD long). Parts overlapped by the cell and parts outside the depth of
// field are not shown; they are drawn in the projection analysis view.
function renderFluorescenceImage(capsuleBody, hairSegments, camera) {
    const fluorescenceScene = new THREE.Scene();
    fluorescenceScene.background = new THREE.Color(FLUORESCENCE_HEX.background);  // dark grey background

    const fluorescenceGroup = new THREE.Group();
    fluorescenceScene.add(fluorescenceGroup);

    const fluorescenceCapsuleBody = new THREE.Group();
    capsuleBody.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            const mesh = child.clone();
            mesh.material = FLUORESCENCE_BODY_MATERIAL;
            fluorescenceCapsuleBody.add(mesh);
        }
    });
    fluorescenceCapsuleBody.quaternion.copy(capsuleBody.quaternion);
    fluorescenceGroup.add(fluorescenceCapsuleBody);

    const hairLinesGroup = new THREE.Group();
    hairSegments.forEach((segment) => {
        if (!segment.observation || !segment.observation.isVisible) {
            return;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            segment.outside.start.x, segment.outside.start.y, segment.outside.start.z,
            segment.outside.end.x, segment.outside.end.y, segment.outside.end.z
        ]), 3));
        hairLinesGroup.add(new THREE.Line(geometry, FLUORESCENCE_OUTSIDE_MATERIAL));
    });
    fluorescenceGroup.add(hairLinesGroup);

    // Display zoom about the image centre (the cell centre); the analysis camera itself is not changed
    fluorescenceViewCamera.copy(camera);
    fluorescenceViewCamera.zoom = camera.zoom * analysisViewZoom;
    fluorescenceViewCamera.updateProjectionMatrix();
    fluorescenceRenderer.render(fluorescenceScene, fluorescenceViewCamera);

    // The line geometries were created for this frame only: free their GPU buffers
    hairLinesGroup.children.forEach((line) => line.geometry.dispose());
}

// Shared offscreen renderer for the silhouette analysis
let sharedTempRenderer = null;
let sharedRenderTarget = null;

function createHairObservation(child, sequentialIndex) {
    const hairIndex = (child.userData && Number.isInteger(child.userData.hairIndex))
        ? child.userData.hairIndex
        : sequentialIndex;
    const trueLength = (child.userData && typeof child.userData.trueLength === 'number')
        ? child.userData.trueLength
        : (currentHairLengths[hairIndex] || 0);
    return {
        hairIndex: hairIndex,
        trueLength: trueLength,
        projectionLength: 0,
        isVisible: false
    };
}

function recordHairObservation(observation, outsideLength) {
    const length = (typeof outsideLength === 'number' && isFinite(outsideLength) && outsideLength > 0)
        ? outsideLength
        : 0;
    observation.projectionLength = length;
    observation.isVisible = length >= VISIBLE_PROJECTION_LENGTH_THRESHOLD;
    if (observation.isVisible) {
        projectionHairLengths.push(length);
    }
    currentHairObservations.push(observation);
}

// options.skipDebug: do not draw the debug canvas (batch fast mode)
function analyzeFluorescenceHairs(projectionCapsule, capsuleBody, options) {
    // 存储菌毛分段信息，用于后续渲染
    const hairSegments = [];

    projectionHairLengths = [];
    currentHairObservations = [];

    // 创建一个临时场景用于渲染胶囊体的二维投影（场景复用，白色共享材质）
    if (!silhouetteScene) {
        silhouetteScene = new THREE.Scene();
        silhouetteScene.background = new THREE.Color(0x000000); // 黑色背景
    }
    const tempScene = silhouetteScene;

    // 添加胶囊体到临时场景（使用白色材质以便于区分）
    const capsuleBodyClone = capsuleBody.clone();

    capsuleBodyClone.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.material = SILHOUETTE_MATERIAL;
        }
    });
    tempScene.add(capsuleBodyClone);

    // 使用共享的临时渲染器，如果不存在则创建
    if (!sharedTempRenderer) {
        sharedTempRenderer = new THREE.WebGLRenderer({ antialias: true });
        sharedTempRenderer.setSize(512, 512);
        sharedRenderTarget = new THREE.WebGLRenderTarget(512, 512);

    }

    // 使用与投影视图相同的相机设置
    const tempCamera = projectionCamera.clone();

    // 渲染胶囊体到纹理
    sharedTempRenderer.setRenderTarget(sharedRenderTarget);
    sharedTempRenderer.render(tempScene, tempCamera);
    sharedTempRenderer.setRenderTarget(null);
    tempScene.remove(capsuleBodyClone);

    // 读取像素数据（复用缓冲区）
    const pixelBuffer = silhouettePixelBuffer;
    sharedTempRenderer.readRenderTargetPixels(sharedRenderTarget, 0, 0, 512, 512, pixelBuffer);

    // 用一维 Uint8Array（行优先，下标 y * 512 + x）表示胶囊体的投影区域
    const projectionMap = silhouetteMap;
    for (let i = 0; i < 512; i++) {
        // 注意：这里使用 (511 - i) 来实现上下反转
        const sourceRow = (511 - i) * 512;
        const targetRow = i * 512;
        for (let j = 0; j < 512; j++) {
            // 如果像素是白色（胶囊体），则标记为1，否则为0
            projectionMap[targetRow + j] = (pixelBuffer[(sourceRow + j) * 4] > 200) ? 1 : 0;
        }
    }

    // The analysis image is drawn only while that view is shown (and never in batch fast mode)
    const drawDebug = !(options && options.skipDebug) && analysisViewActive;

    // 检查点是否在相机视锥体内（相机在本次分析中不变，只需构造一次）
    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(
            tempCamera.projectionMatrix,
            tempCamera.matrixWorldInverse
        )
    );

    // 计算景深的前后边界（世界坐标系）
    const nearPlaneDistance = focusDistance - depthOfField / 2;
    const farPlaneDistance = focusDistance + depthOfField / 2;

    // 分析菌毛投影
    const debugDots = [];
    let sequentialHairIndex = 0;
    projectionCapsule.traverse((child) => {
        if (child instanceof THREE.Line) {
            const observation = createHairObservation(child, sequentialHairIndex);
            sequentialHairIndex += 1;

            // 获取菌毛的起点和终点
            const positions = child.geometry.attributes.position.array;
            const start3D = new THREE.Vector3(positions[0], positions[1], positions[2]);
            const end3D = new THREE.Vector3(positions[3], positions[4], positions[5]);

            // 使用对象的matrixWorld属性获取完整的世界变换
            const worldMatrix = child.matrixWorld.clone();

            // 应用世界变换到起点和终点
            const rotatedStart3D = start3D.clone().applyMatrix4(worldMatrix);
            const rotatedEnd3D = end3D.clone().applyMatrix4(worldMatrix);

            // 新增：检查菌毛是否在景深范围内
            // 将菌毛线段与景深平面相交，得到在景深范围内的部分
            const hairInDepthOfField = clipLineToDepthRange(
                rotatedStart3D.clone(),
                rotatedEnd3D.clone(),
                nearPlaneDistance,
                farPlaneDistance
            );

            // Completely outside depth of field: keep the hair record, mark invisible
            if (!hairInDepthOfField) {
                currentHairObservations.push(observation);
                return;
            }

            // 使用景深范围内的菌毛段替代原始菌毛
            const depthClippedStart3D = hairInDepthOfField.start;
            const depthClippedEnd3D = hairInDepthOfField.end;

            // Both endpoints outside the frustum: keep the hair record, mark invisible
            if (!frustum.containsPoint(rotatedStart3D) && !frustum.containsPoint(rotatedEnd3D)) {
                currentHairObservations.push(observation);
                return;
            }

            // 将3D点转换为2D投影坐标
            const start2D = projectPointTo2D(depthClippedStart3D, tempCamera, 512, 512);
            const end2D = projectPointTo2D(depthClippedEnd3D, tempCamera, 512, 512);

            // 将3D点转换为2D投影坐标(边缘截断)
            const start2DLimit = projectPointTo2DLimit(depthClippedStart3D, tempCamera, 512, 512);
            const end2DLimit = projectPointTo2DLimit(depthClippedEnd3D, tempCamera, 512, 512);

            // 使用Bresenham算法在投影图上找到菌毛线段与胶囊体边缘的交点
            const intersections = findLineIntersectionsWithCapsule(start2DLimit, end2DLimit, projectionMap);

            // Collect the intersections; they are drawn on the analysis image after the segments
            if (drawDebug) {
                intersections.forEach(point => debugDots.push(point));
            }

            // 如果没有找到交点，检查起点是否在胶囊体内
            if (intersections.length === 0) {
                const startInside = isPointInsideCapsule(start2D, projectionMap);

                if (startInside) {
                    // 整个菌毛在胶囊体内部
                    hairSegments.push({
                        inside: {
                            start: depthClippedStart3D.clone(),
                            end: depthClippedEnd3D.clone()
                        },
                        outside: {
                            start: depthClippedEnd3D.clone(),
                            end: depthClippedEnd3D.clone() // 起点和终点相同，表示没有外伸部分
                        },
                        // 添加景深信息，确保包含原始点信息
                        depthInfo: hairInDepthOfField,
                        observation: observation
                    });
                    recordHairObservation(observation, 0);
                } else {
                    // 整个菌毛在胶囊体外部
                    hairSegments.push({
                        inside: {
                            start: depthClippedStart3D.clone(),
                            end: depthClippedStart3D.clone() // 起点和终点相同，表示没有内部部分
                        },
                        outside: {
                            start: depthClippedStart3D.clone(),
                            end: depthClippedEnd3D.clone()
                        },
                        // 添加景深信息，确保包含原始点信息
                        depthInfo: hairInDepthOfField,
                        observation: observation
                    });
                    const projectionLength = distanceBetween2DPoints(start2D, end2D);
                    recordHairObservation(observation, projectionLength);
                }
                // 跳过当前循环迭代,继续处理下一个菌毛
                return
            }

            // 对交点进行排序（按照与起点的距离）
            intersections.sort((a, b) => {
                return distanceBetween2DPoints(start2D, a) - distanceBetween2DPoints(start2D, b);
            });

            // 获取第一个交点（最接近起点的交点）
            const intersection2D = intersections[0];

            // 计算交点在3D空间中的位置（通过线性插值）
            const t = distanceBetween2DPoints(start2D, intersection2D) / distanceBetween2DPoints(start2D, end2D);
            const intersection3D = new THREE.Vector3().lerpVectors(depthClippedStart3D, depthClippedEnd3D, t);

            // 检查起点是否在胶囊体内部
            const startInside = isPointInsideCapsule(start2D, projectionMap);

            if (startInside) {
                // 起点在内部，终点在外部
                hairSegments.push({
                    inside: {
                        start: depthClippedStart3D.clone(),
                        end: intersection3D.clone()
                    },
                    outside: {
                        start: intersection3D.clone(),
                        end: depthClippedEnd3D.clone()
                    },
                    // 添加景深信息，确保包含原始点信息
                    depthInfo: hairInDepthOfField,
                        observation: observation
                });

                // 计算外伸长度并记录 - 修改为使用2D投影长度
                const outsideLength = distanceBetween2DPoints(intersection2D, end2D);
                recordHairObservation(observation, outsideLength);
            } else {
                // 起点在外部，终点在内部
                hairSegments.push({
                    inside: {
                        start: intersection3D.clone(),
                        end: depthClippedEnd3D.clone()
                    },
                    outside: {
                        start: depthClippedStart3D.clone(),
                        end: intersection3D.clone()
                    },
                    // 添加景深信息，确保包含原始点信息
                    depthInfo: hairInDepthOfField,
                        observation: observation
                });

                const outsideLength = distanceBetween2DPoints(start2D, intersection2D);
                recordHairObservation(observation, outsideLength);
            }
        }
    });

    currentHairObservations.sort((a, b) => a.hairIndex - b.hairIndex);

    if (drawDebug) {
        drawAnalysisImage(projectionCapsule, hairSegments, tempCamera, debugDots);
    }
    return hairSegments;
}

// Projection analysis image (512 x 512). The cell is drawn analytically (an orthographic capsule is a stadium),
// so it stays sharp when zoomed; the pilus segments use the same colours as the legend:
// inside the cell outline, protruding in focus, and outside the depth of field.
function drawAnalysisImage(projectionCapsule, hairSegments, camera, intersectionDots) {
    if (!analysisViewCanvas) {
        return;
    }
    const size = SILHOUETTE_SIZE;
    const ctx = analysisViewCanvas.getContext('2d');
    const toCanvas = (point3D) => {
        const v = point3D.clone().project(camera);
        return { x: (v.x + 1) * size / 2, y: (1 - v.y) * size / 2 };
    };

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = FLUORESCENCE_CSS.background;
    ctx.fillRect(0, 0, size, size);

    // Display zoom about the image centre; line widths and dot sizes are kept constant on screen
    const zoom = analysisViewZoom;
    ctx.translate(size / 2, size / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-size / 2, -size / 2);
    ctx.lineCap = 'round';

    // Cell: stadium through the projected hemisphere centres
    const radius = parseFloat(document.getElementById('radiusValue').value);
    const height = parseFloat(document.getElementById('heightValue').value);
    const halfCylinder = Math.max(0, height - 2 * radius) / 2;
    const pixelsPerUnit = size / ((camera.right - camera.left) / camera.zoom);
    const endA = toCanvas(new THREE.Vector3(0, halfCylinder, 0).applyMatrix4(projectionCapsule.matrixWorld));
    const endB = toCanvas(new THREE.Vector3(0, -halfCylinder, 0).applyMatrix4(projectionCapsule.matrixWorld));
    ctx.strokeStyle = FLUORESCENCE_CSS.body;
    ctx.fillStyle = FLUORESCENCE_CSS.body;
    ctx.lineWidth = 2 * radius * pixelsPerUnit;
    ctx.beginPath();
    ctx.moveTo(endA.x, endA.y);
    ctx.lineTo(endB.x, endB.y);
    ctx.stroke();
    [endA, endB].forEach((end) => {
        ctx.beginPath();
        ctx.arc(end.x, end.y, radius * pixelsPerUnit, 0, Math.PI * 2);
        ctx.fill();
    });

    const drawLine = (p3D, q3D, color) => {
        const p = toCanvas(p3D);
        const q = toCanvas(q3D);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
    };

    hairSegments.forEach((segment) => {
        drawLine(segment.inside.start, segment.inside.end, FLUORESCENCE_CSS.inside);
        drawLine(segment.outside.start, segment.outside.end, FLUORESCENCE_CSS.outside);
        const depth = segment.depthInfo;
        if (depth && !depth.fullyInRange) {
            if (!depth.startInRange && depth.originalStart) {
                drawLine(depth.originalStart, depth.start, FLUORESCENCE_CSS.outOfDepth);
            }
            if (!depth.endInRange && depth.originalEnd) {
                drawLine(depth.end, depth.originalEnd, FLUORESCENCE_CSS.outOfDepth);
            }
        }
    });

    // Pilus / cell-edge intersections (found on the 512 x 512 silhouette map)
    ctx.fillStyle = FLUORESCENCE_CSS.intersection;
    intersectionDots.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x + 0.5, point.y + 0.5, 3 / zoom, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// 新增：裁剪线段到景深范围内的函数
function clipLineToDepthRange(start, end, nearZ, farZ) {
    // 获取线段的Z坐标
    const startZ = start.z;
    const endZ = end.z;

    // 如果线段完全在景深范围外，返回null
    if ((startZ < nearZ && endZ < nearZ) || (startZ > farZ && endZ > farZ)) {
        return null;
    }

    // 如果线段完全在景深范围内，直接返回原线段
    if (startZ >= nearZ && startZ <= farZ && endZ >= nearZ && endZ <= farZ) {
        return { start: start, end: end, fullyInRange: true };
    }

    // 线段与景深平面相交，需要裁剪
    let clippedStart = start.clone();
    let clippedEnd = end.clone();
    let startInRange = true;
    let endInRange = true;

    // 计算线段方向向量
    const direction = new THREE.Vector3().subVectors(end, start);

    // 如果起点在近景深平面之前
    if (startZ < nearZ) {
        // 计算与近景深平面的交点
        const t = (nearZ - startZ) / direction.z;
        clippedStart = new THREE.Vector3(
            start.x + direction.x * t,
            start.y + direction.y * t,
            nearZ
        );
        startInRange = false;
    }

    // 如果终点在远景深平面之后
    if (endZ > farZ) {
        // 计算与远景深平面的交点
        const t = (farZ - startZ) / direction.z;
        clippedEnd = new THREE.Vector3(
            start.x + direction.x * t,
            start.y + direction.y * t,
            farZ
        );
        endInRange = false;
    }

    // 如果起点在远景深平面之后
    if (startZ > farZ) {
        // 计算与远景深平面的交点
        const t = (farZ - startZ) / direction.z;
        clippedStart = new THREE.Vector3(
            start.x + direction.x * t,
            start.y + direction.y * t,
            farZ
        );
        startInRange = false;
    }

    // 如果终点在近景深平面之前
    if (endZ < nearZ) {
        // 计算与近景深平面的交点
        const t = (nearZ - startZ) / direction.z;
        clippedEnd = new THREE.Vector3(
            start.x + direction.x * t,
            start.y + direction.y * t,
            nearZ
        );
        endInRange = false;
    }

    return {
        start: clippedStart,
        end: clippedEnd,
        fullyInRange: false,
        startInRange: startInRange,
        endInRange: endInRange,
        originalStart: start.clone(),
        originalEnd: end.clone()
    };
}

// ================ 批量模拟功能 ================
// 批量模拟对话框
function setupBatchSimulationButton() {
    const batchBtn = document.getElementById('batchBtn');
    const batchDialog = document.getElementById('batchDialog');
    const cancelBatch = document.getElementById('cancelBatch');
    const startBatch = document.getElementById('startBatch');
    const cancelRunningBatch = document.getElementById('cancelRunningBatch');

    // 添加错误检查
    if (!batchBtn || !batchDialog || !cancelBatch || !startBatch) {
        console.error('HTML elements required by the batch simulation were not found');
        return; // 如果元素不存在，提前退出函数
    }

    batchBtn.addEventListener('click', () => {
        batchDialog.style.display = 'block';
    });

    cancelBatch.addEventListener('click', () => {
        batchDialog.style.display = 'none';
    });

    startBatch.addEventListener('click', () => {
        // 获取批量模拟参数
        const modelCount = parseInt(document.getElementById('modelCount').value);
        const angleCount = parseInt(document.getElementById('angleCount').value);
        const progressBar = document.getElementById('batchProgress');
        const progressText = document.getElementById('progressText');

        // 显示进度条
        progressBar.style.display = 'block';
        progressBar.value = 0;
        progressBar.max = modelCount * angleCount;
        progressText.textContent = tr('batch.preparing');

        // 隐藏开始按钮，显示取消按钮
        if (cancelRunningBatch) {
            startBatch.style.display = 'none';
            cancelRunningBatch.style.display = 'inline-block';
        }

        // 延迟一点开始模拟，让UI有时间更新
        setTimeout(() => {
            startBatchSimulation(modelCount, angleCount, progressBar, progressText);
        }, 100);
    });

    // 添加取消运行中的批量模拟的事件处理
    if (cancelRunningBatch) {
        cancelRunningBatch.addEventListener('click', () => {
            isBatchSimulationCancelled = true;
            progressText.textContent = tr('batch.cancelling');
        });
    }
}

// 生成随机模型参数 - 修改为只保留原始参数
function generateRandomModelParams() {
    // 获取当前参数并直接返回，不做随机变化
    return {
        height: parseFloat(document.getElementById('heightValue').value),
        radius: parseFloat(document.getElementById('radiusValue').value),
        hairCount: parseInt(document.getElementById('hairCountValue').value),
        meanHairLength: parseFloat(document.getElementById('hairLengthValue').value),
        shapeParam: parseFloat(document.getElementById('shapeParamValue').value),
        ...readAnchorSettings(),
        // 保持旋转角度不变
        rotationX: parseFloat(document.getElementById('rotationXValue').value),
        rotationY: parseFloat(document.getElementById('rotationYValue').value),
        rotationZ: parseFloat(document.getElementById('rotationZValue').value)
    };
}

const BATCH_CANCELLED = 'BATCH_CANCELLED';

// Let the browser handle events and paint. MessageChannel is not clamped like setTimeout(0),
// and it is not throttled to 1 s when the tab is in the background.
function yieldToBrowser() {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            resolve();
        };
        channel.port2.postMessage(0);
    });
}

// 修改 startBatchSimulation 函数
async function startBatchSimulation(modelCount, angleCount, progressBar, progressText) {
    // 重置取消标志
    isBatchSimulationCancelled = false;

    // 保存当前模型参数，以便模拟结束后恢复
    const originalParams = {
        height: parseFloat(document.getElementById('heightValue').value),
        radius: parseFloat(document.getElementById('radiusValue').value),
        hairCount: parseInt(document.getElementById('hairCountValue').value),
        meanHairLength: parseFloat(document.getElementById('hairLengthValue').value),
        shapeParam: parseFloat(document.getElementById('shapeParamValue').value),
        ...readAnchorSettings(),
        rotationX: parseFloat(document.getElementById('rotationXValue').value),
        rotationY: parseFloat(document.getElementById('rotationYValue').value),
        rotationZ: parseFloat(document.getElementById('rotationZValue').value)
    };

    // 禁用交互控件
    const controlInputs = document.querySelectorAll('#controls input, #controls button, #controls select');
    controlInputs.forEach(input => {
        if (input.id !== 'cancelRunningBatch') {
            input.disabled = true;
        }
    });

    // 准备存储所有模拟结果的数组
    const allResults = [];
    let progress = 0;

    // Everything below is synchronous per pose: the analysis result is complete as soon as applyAngleParams() returns,
    // so no fixed waits are needed. The loop only yields to the browser in short time slices (UI stays responsive).
    batchFastMode = true;
    let lastYieldTime = performance.now();
    let lastPreviewTime = lastYieldTime;

    try {
        // 循环生成不同的模型（只重新生成菌毛，不改变参数）
        for (let modelIndex = 0; modelIndex < modelCount; modelIndex++) {
            // 检查是否取消
            if (isBatchSimulationCancelled) {
                throw new Error(BATCH_CANCELLED);
            }

            // 获取当前参数
            const modelParams = generateRandomModelParams();

            // 应用参数并重新生成菌毛
            applyModelParams(modelParams);

            // 更新进度信息
            progressText.textContent = tr('batch.model', { model: modelIndex + 1, models: modelCount });

            // 循环生成不同的姿态角
            for (let angleIndex = 0; angleIndex < angleCount; angleIndex++) {
                // 再次检查是否取消
                if (isBatchSimulationCancelled) {
                    throw new Error(BATCH_CANCELLED);
                }

                // 为每个姿态随机生成角度
                const angleParams = generateRandomAngles();

                // 应用随机角度到UI和模型（同步完成投影分析）
                applyAngleParams(angleParams);

                // 收集当前模型和姿态下的数据
                const result = collectSimulationData(modelIndex, angleIndex, modelParams, angleParams);
                allResults.push(result);

                // 更新进度条
                progress++;

                // Yield to the browser every ~40 ms; refresh the views as a low-rate live preview
                const now = performance.now();
                if (now - lastYieldTime > 40) {
                    progressBar.value = progress;
                    progressText.textContent = tr('batch.progress', {
                        model: modelIndex + 1, models: modelCount, pose: angleIndex + 1, poses: angleCount
                    });
                    if (now - lastPreviewTime > 250) {
                        updateProjectionView({ forceFull: true });
                        lastPreviewTime = now;
                    }
                    await yieldToBrowser();
                    lastYieldTime = performance.now();
                }
            }
        }

        progressBar.value = progress;

        // 导出所有结果到Excel
        if (allResults.length > 0) {
            exportBatchResultsToExcel(allResults);
            progressText.textContent = tr('batch.done');
        } else {
            progressText.textContent = tr('batch.noData');
        }
    } catch (error) {
        if (error.message === BATCH_CANCELLED) {
            progressText.textContent = tr('batch.cancelled');
        } else {
            console.error('Error during batch simulation:', error);
            progressText.textContent = tr('batch.error');
        }
    } finally {
        batchFastMode = false;

        // 恢复原始参数
        applyModelParams(originalParams);
        applyAngleParams(originalParams);

        // 恢复交互控件
        controlInputs.forEach(input => {
            input.disabled = false;
        });
        // Re-apply the mode-dependent disabled state of the share inputs
        syncAnchorControlState();

        // 隐藏进度条
        progressBar.style.display = 'none';

        // 恢复UI状态 - 确保这些元素存在
        const startBatchBtn = document.getElementById('startBatch');
        const cancelRunningBatchBtn = document.getElementById('cancelRunningBatch');

        if (startBatchBtn) startBatchBtn.style.display = 'inline-block';
        if (cancelRunningBatchBtn) cancelRunningBatchBtn.style.display = 'none';

        // 3秒后关闭对话框
        setTimeout(() => {
            const batchDialog = document.getElementById('batchDialog');
            if (batchDialog) batchDialog.style.display = 'none';
            if (progressText) progressText.textContent = '';
        }, 3000);
    }
}

// 生成随机姿态角
// Uniform random orientation on SO(3) (Shoemake, 1992).
// Uniform Euler angles are NOT isotropic; a uniform unit quaternion is.
// The pose is returned as XYZ Euler angles (degrees, 0.01 deg resolution) and applied from exactly these values,
// so the exported angles reproduce the analysed pose exactly (the UI sliders use the same convention).
function generateRandomAngles() {
    const u1 = Math.random();
    const u2 = Math.random();
    const u3 = Math.random();
    const a = Math.sqrt(1 - u1);
    const b = Math.sqrt(u1);
    const quaternion = new THREE.Quaternion(
        a * Math.sin(2 * Math.PI * u2),
        a * Math.cos(2 * Math.PI * u2),
        b * Math.sin(2 * Math.PI * u3),
        b * Math.cos(2 * Math.PI * u3)
    );
    const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
    const toDeg = (rad) => Number(THREE.MathUtils.radToDeg(rad).toFixed(2));
    return {
        rotationX: toDeg(euler.x),
        rotationY: toDeg(euler.y),
        rotationZ: toDeg(euler.z)
    };
}

function describeAnchorMode(mode) {
    return mode === 'area' ? tr('anchor.area') : tr('anchor.fixed');
}

// Single definition of the pose convention: Euler XYZ (three.js order), angles in degrees
function quaternionFromEulerDegrees(rotationX, rotationY, rotationZ) {
    const euler = new THREE.Euler(
        THREE.MathUtils.degToRad(rotationX),
        THREE.MathUtils.degToRad(rotationY),
        THREE.MathUtils.degToRad(rotationZ),
        'XYZ'
    );
    return new THREE.Quaternion().setFromEuler(euler);
}

// 应用模型参数到UI和模型
function applyModelParams(params) {
    document.getElementById('heightValue').value = params.height.toFixed(1);
    document.getElementById('height').value = params.height;

    document.getElementById('radiusValue').value = params.radius.toFixed(1);
    document.getElementById('radius').value = params.radius;

    document.getElementById('hairCountValue').value = params.hairCount;
    document.getElementById('hairCount').value = params.hairCount;

    document.getElementById('hairLengthValue').value = params.meanHairLength.toFixed(1);
    document.getElementById('hairLength').value = params.meanHairLength;

    document.getElementById('shapeParamValue').value = params.shapeParam.toFixed(1);
    document.getElementById('shapeParam').value = params.shapeParam;

    applyAnchorSettings(params);

    // 更新胶囊模型
    updateCapsule();
}

// 应用姿态角到UI和模型
function applyAngleParams(params) {
    document.getElementById('rotationXValue').value = params.rotationX;
    document.getElementById('rotationX').value = params.rotationX;

    document.getElementById('rotationYValue').value = params.rotationY;
    document.getElementById('rotationY').value = params.rotationY;

    document.getElementById('rotationZValue').value = params.rotationZ;
    document.getElementById('rotationZ').value = params.rotationZ;

    // The pose is defined by the XYZ Euler angles shown in the UI and written to the export
    const quaternion = quaternionFromEulerDegrees(params.rotationX, params.rotationY, params.rotationZ);

    // 应用四元数到胶囊
    capsule.quaternion.copy(quaternion);

    // 更新投影视图
    updateProjectionView();
}

// 修改 collectSimulationData 函数，添加景深信息
function collectSimulationData(modelIndex, angleIndex, modelParams, angleParams) {
    try {
        const hairObservations = currentHairObservations.map((item) => ({
            hairIndex: item.hairIndex,
            trueLength: item.trueLength,
            projectionLength: item.projectionLength,
            isVisible: item.isVisible
        }));

        const result = {
            modelIndex: modelIndex + 1,
            angleIndex: angleIndex + 1,
            modelParams: { ...modelParams },
            angleParams: { ...angleParams },
            depthOfFieldParams: {
                depthOfField: depthOfField,
                focusDistance: focusDistance
            },
            hairLengths: [...currentHairLengths],
            projectionHairLengths: [...projectionHairLengths],
            hairObservations: hairObservations
        };

        // 添加统计信息
        if (result.hairLengths.length > 0) {
            result.hairStats = {
                count: result.hairLengths.length,
                min: Math.min(...result.hairLengths),
                max: Math.max(...result.hairLengths),
                mean: result.hairLengths.reduce((a, b) => a + b, 0) / result.hairLengths.length
            };
        } else {
            result.hairStats = { count: 0, min: 0, max: 0, mean: 0 };
        }

        if (result.projectionHairLengths.length > 0) {
            result.projectionStats = {
                count: result.projectionHairLengths.length,
                min: Math.min(...result.projectionHairLengths),
                max: Math.max(...result.projectionHairLengths),
                mean: result.projectionHairLengths.reduce((a, b) => a + b, 0) / result.projectionHairLengths.length
            };
        } else {
            result.projectionStats = { count: 0, min: 0, max: 0, mean: 0 };
        }

        return result;
    } catch (error) {
        console.error('Error while collecting simulation data:', error);
        return {
            modelIndex: modelIndex + 1,
            angleIndex: angleIndex + 1,
            modelParams: { ...modelParams },
            angleParams: { ...angleParams },
            depthOfFieldParams: {
                depthOfField: depthOfField,
                focusDistance: focusDistance
            },
            hairLengths: [],
            projectionHairLengths: [],
            hairObservations: [],
            hairStats: { count: 0, min: 0, max: 0, mean: 0 },
            projectionStats: { count: 0, min: 0, max: 0, mean: 0 },
            error: error.message
        };
    }
}

// 修改 exportBatchResultsToExcel 函数
function exportBatchResultsToExcel(results) {
    try {
        // 创建工作簿
        const wb = XLSX.utils.book_new();

        // 创建模型参数工作表
        const modelParamsRows = [[
            tr('col.modelId'), tr('col.height'), tr('col.radius'), tr('col.hairCount'), tr('col.meanLength'),
            tr('col.concentration'), tr('col.dofRange'), tr('col.focus'), tr('col.anchorMode'), tr('col.cylinderShare')
        ]];

        // 创建姿态角工作表
        const angleParamsRows = [[
            tr('col.modelId'), tr('col.poseId'), tr('col.rotX'), tr('col.rotY'), tr('col.rotZ')
        ]];

        // 创建统计数据工作表
        const statsRows = [[
            tr('col.modelId'), tr('col.poseId'), tr('col.totalPili'), tr('col.visiblePili'), tr('col.visibleFraction'),
            tr('col.meanOutside'), tr('col.minOutside'), tr('col.maxOutside')
        ]];

        const trueLengthRows = [[
            tr('col.modelId'), tr('col.hairNo'), tr('col.hairId'), tr('col.trueLength')
        ]];

        const observationRows = [[
            tr('col.modelId'), tr('col.poseId'), tr('col.hairNo'), tr('col.observationId'),
            tr('col.trueLength'), tr('col.projLength'), tr('col.visible')
        ]];

        const notesRows = [
            [tr('col.item'), tr('col.description')],
            [tr('note.visible.key'), tr('note.visible.text', { threshold: VISIBLE_PROJECTION_LENGTH_THRESHOLD })],
            [tr('note.trueSheet.key'), tr('note.trueSheet.text')],
            [tr('note.obsSheet.key'), tr('note.obsSheet.text')],
            [tr('note.trueDist.key'), tr('note.trueDist.text')],
            [tr('note.anchor.key'), tr('note.anchor.text')],
            [tr('note.pose.key'), tr('note.pose.text')],
            [tr('note.length.key'), tr('note.length.text')]
        ];

        // 填充数据
        const uniqueModels = new Set();

        results.forEach(result => {
            const modelId = result.modelIndex;
            const angleId = result.angleIndex;

            // 格式化ID为两位数
            const modelIdStr = modelId.toString().padStart(2, '0');
            const angleIdStr = angleId.toString().padStart(2, '0');

            // 只添加唯一的模型参数
            if (!uniqueModels.has(modelId)) {
                uniqueModels.add(modelId);
                modelParamsRows.push([
                    modelId,
                    roundTo(result.modelParams.height, 2),
                    roundTo(result.modelParams.radius, 2),
                    result.modelParams.hairCount,
                    roundTo(result.modelParams.meanHairLength, 2),
                    roundTo(result.modelParams.shapeParam, 2),
                    roundTo(result.depthOfFieldParams.depthOfField, 2),
                    roundTo(result.depthOfFieldParams.focusDistance, 2),
                    describeAnchorMode(result.modelParams.anchorMode),
                    roundTo(computeCylinderFraction(
                        result.modelParams.radius,
                        result.modelParams.height,
                        result.modelParams.anchorMode,
                        result.modelParams.cylinderShare
                    ) * 100, 1)
                ]);

                if (result.hairLengths && result.hairLengths.length > 0) {
                    result.hairLengths.forEach((length, index) => {
                        const hairIdStr = (index + 1).toString().padStart(2, '0');
                        trueLengthRows.push([
                            modelId,
                            index + 1,
                            `${modelIdStr}-${hairIdStr}`,
                            roundTo(length, 3)
                        ]);
                    });
                }
            }

            // 添加姿态角数据
            angleParamsRows.push([
                modelId,
                angleId,
                result.angleParams.rotationX,
                result.angleParams.rotationY,
                result.angleParams.rotationZ
            ]);

            // 添加统计数据
            const totalHairs = result.hairStats.count;
            const visibleHairs = result.projectionStats.count;
            const visibleRatio = totalHairs > 0 ? roundTo(visibleHairs / totalHairs, 2) : 0;

            statsRows.push([
                modelId,
                angleId,
                totalHairs,
                visibleHairs,
                visibleRatio,
                roundTo(result.projectionStats.mean, 2),
                roundTo(result.projectionStats.min, 2),
                roundTo(result.projectionStats.max, 2)
            ]);

            const observations = (result.hairObservations && result.hairObservations.length > 0)
                ? result.hairObservations
                : (result.hairLengths || []).map((length, index) => ({
                    hairIndex: index,
                    trueLength: length,
                    projectionLength: 0,
                    isVisible: false
                }));

            observations.forEach((item) => {
                const hairNumber = item.hairIndex + 1;
                const hairIdStr = hairNumber.toString().padStart(2, '0');
                observationRows.push([
                    modelId,
                    angleId,
                    hairNumber,
                    `${modelIdStr}-${angleIdStr}-${hairIdStr}`,
                    roundTo(item.trueLength, 3),
                    roundTo(item.projectionLength, 3),
                    item.isVisible ? tr('col.yes') : tr('col.no')
                ]);
            });
        });

        // 创建工作表
        const notesWs = XLSX.utils.aoa_to_sheet(notesRows);
        const modelParamsWs = XLSX.utils.aoa_to_sheet(modelParamsRows);
        const angleParamsWs = XLSX.utils.aoa_to_sheet(angleParamsRows);
        const statsWs = XLSX.utils.aoa_to_sheet(statsRows);
        const trueLengthWs = XLSX.utils.aoa_to_sheet(trueLengthRows);
        const observationWs = XLSX.utils.aoa_to_sheet(observationRows);

        XLSX.utils.book_append_sheet(wb, notesWs, tr('sheet.notes'));
        XLSX.utils.book_append_sheet(wb, modelParamsWs, tr('sheet.modelParams'));
        XLSX.utils.book_append_sheet(wb, angleParamsWs, tr('sheet.poseAngles'));
        XLSX.utils.book_append_sheet(wb, statsWs, tr('sheet.stats'));
        XLSX.utils.book_append_sheet(wb, trueLengthWs, tr('sheet.trueLengths'));
        XLSX.utils.book_append_sheet(wb, observationWs, tr('sheet.observations'));

        // 为每个模型创建详细数据工作表
        uniqueModels.forEach(modelId => {
            const modelResults = results.filter(r => r.modelIndex === modelId);

            if (modelResults.length > 0) {
                // 创建该模型的详细数据工作表
                const detailRows = [[
                    tr('col.poseId'), tr('col.rotX'), tr('col.rotY'), tr('col.rotZ'),
                    tr('col.visiblePili'), tr('col.meanOutside')
                ]];

                modelResults.forEach(result => {
                    detailRows.push([
                        result.angleIndex,
                        result.angleParams.rotationX,
                        result.angleParams.rotationY,
                        result.angleParams.rotationZ,
                        result.projectionStats.count,
                        roundTo(result.projectionStats.mean, 2)
                    ]);
                });

                const detailWs = XLSX.utils.aoa_to_sheet(detailRows);
                XLSX.utils.book_append_sheet(wb, detailWs, tr('sheet.modelDetail', { id: modelId }));
            }
        });

        // 生成Excel文件并下载
        const now = new Date();
        const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;

        XLSX.writeFile(wb, `${tr('file.batchData')}_${timestamp}.xlsx`);

        // 新增：绘制并保存全局分布图
        generateAndSaveDistributionCharts(results, timestamp);

        return true;
    } catch (error) {
        console.error('Error while exporting the Excel file:', error);
        alert(tr('alert.excelError'));
        return false;
    }
}

// 新增函数：生成并保存分布图
function generateAndSaveDistributionCharts(results, timestamp) {
    try {
        // 收集所有菌毛长度数据
        const allHairLengths = [];
        const allProjectionLengths = [];
        const allVisibleHairCounts = [];
        const seenModels = new Set();

        results.forEach(result => {
            if (!seenModels.has(result.modelIndex)) {
                seenModels.add(result.modelIndex);
                if (result.hairLengths && result.hairLengths.length > 0) {
                    allHairLengths.push(...result.hairLengths);
                }
            }

            if (result.projectionHairLengths && result.projectionHairLengths.length > 0) {
                allProjectionLengths.push(...result.projectionHairLengths);
            }

            if (result.projectionStats && typeof result.projectionStats.count === 'number') {
                if (result.projectionStats.count > 0) {
                    allVisibleHairCounts.push(result.projectionStats.count);
                }
            }
        });

        // 如果有数据，则绘制并保存图表
        if (allHairLengths.length > 0) {
            saveDistributionChart(allHairLengths, tr('img.title.true'), timestamp, 'file.trueDist');
        }

        if (allProjectionLengths.length > 0) {
            saveDistributionChart(allProjectionLengths, tr('img.title.proj'), timestamp, 'file.projDist');
        }
        
        // 新增：如果有可见菌毛数量数据，绘制并保存分布图
        if (allVisibleHairCounts.length > 0) {
            saveVisibleHairCountChart(allVisibleHairCounts, tr('img.title.visible'), timestamp);
        }
    } catch (error) {
        console.error('Error while generating the distribution charts:', error);
    }
}

// 新增函数：保存可见菌毛数量分布图
function saveVisibleHairCountChart(data, title, timestamp) {
    const fileBaseName = tr('file.visibleCount');
    // 创建一个离屏画布
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);

    // 设置画布背景为白色
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 计算统计数据
    const count = data.length;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const mean = data.reduce((sum, val) => sum + val, 0) / count;

    // 计算中位数
    const sortedData = [...data].sort((a, b) => a - b);
    const median = count % 2 === 0
        ? (sortedData[count / 2 - 1] + sortedData[count / 2]) / 2
        : sortedData[Math.floor(count / 2)];

    // 计算标准差
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count;
    const stdDev = Math.sqrt(variance);

    // 确定直方图的区间范围
    const minBin = Math.max(0, Math.floor(min) - 1);  // 确保不会有负值
    const maxBin = Math.ceil(max) + 1;
    const binWidth = 1;  // 固定为1，因为菌毛数量是整数
    const binCount = Math.ceil((maxBin - minBin) / binWidth);

    // 创建区间
    const bins = Array(binCount).fill(0);
    const binLabels = [];

    for (let i = 0; i < binCount; i++) {
        const value = minBin + i * binWidth;
        binLabels.push(`${value}`);  // 直接使用整数作为标签
    }

    // 统计每个区间的数量
    data.forEach(value => {
        const binIndex = Math.min(Math.floor((value - minBin) / binWidth), binCount - 1);
        if (binIndex >= 0) bins[binIndex]++;
    });

    // 将频数转换为频率（百分比）
    const frequencies = bins.map(bin => (bin / count) * 100);

    // 创建图表
    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: binLabels,
            datasets: [{
                label: title,
                data: frequencies,
                backgroundColor: 'rgba(75, 192, 192, 0.5)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                title: {
                    display: true,
                    text: `${title} (n=${count})`,
                    font: {
                        size: 36,
                        weight: 'bold'
                    },
                    padding: {
                        top: 20,
                        bottom: 10
                    }
                },
                subtitle: {
                    display: true,
                    text: tr('img.subtitle', {
                        mean: mean.toFixed(1), median: median.toFixed(1), sd: stdDev.toFixed(1)
                    }),
                    font: {
                        size: 28
                    },
                    padding: {
                        bottom: 20
                    }
                },
                legend: {
                    display: false
                },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: tr('img.axis.percent'),
                        font: {
                            size: 24
                        }
                    },
                    ticks: {
                        font: {
                            size: 20
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: tr('img.axis.visibleCount'),
                        font: {
                            size: 24
                        }
                    },
                    ticks: {
                        font: {
                            size: 20
                        }
                    }
                }
            }
        }
    });

    // 等待图表渲染完成
    setTimeout(() => {
        try {
            // 修改：确保导出时背景是白色的
            // 1. 先让Chart.js完成渲染
            chart.render();

            // 2. 创建一个新的画布，确保背景是白色的
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = canvas.width;
            exportCanvas.height = canvas.height;
            const exportCtx = exportCanvas.getContext('2d');

            // 3. 填充白色背景
            exportCtx.fillStyle = 'white';
            exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

            // 4. 将原始画布内容绘制到新画布上
            exportCtx.drawImage(canvas, 0, 0);

            // 5. 从新画布导出图片，明确指定不要透明度
            const url = exportCanvas.toDataURL('image/png', 1.0);

            const a = document.createElement('a');
            a.href = url;
            a.download = `${fileBaseName}_${timestamp}.png`;
            a.click();

            // 清理
            document.body.removeChild(canvas);
            chart.destroy();
        } catch (error) {
            console.error('Error while saving the visible pili count chart:', error);
        }
    }, 500);  // 给Chart.js足够的时间渲染
}

// 新增函数：保存分布图
function saveDistributionChart(data, title, timestamp, fileNameKey) {
    // Resolve texts now so a language switch during the 500 ms render delay cannot mix languages
    const fileBaseName = tr(fileNameKey);
    // 创建一个离屏画布
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    document.body.appendChild(canvas);

    // 设置画布背景为白色
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 计算统计数据
    const count = data.length;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const mean = data.reduce((sum, val) => sum + val, 0) / count;

    // 计算中位数
    const sortedData = [...data].sort((a, b) => a - b);
    const median = count % 2 === 0
        ? (sortedData[count / 2 - 1] + sortedData[count / 2]) / 2
        : sortedData[Math.floor(count / 2)];

    // 计算标准差
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count;
    const stdDev = Math.sqrt(variance);

    // 确定直方图的区间范围
    const minBin = Math.floor(min);
    const maxBin = Math.ceil(max);
    const binWidth = 1.0;
    const binCount = Math.ceil((maxBin - minBin) / binWidth);

    // 创建区间
    const bins = Array(binCount).fill(0);
    const binLabels = [];

    for (let i = 0; i < binCount; i++) {
        const lowerBound = minBin + i * binWidth;
        const upperBound = minBin + (i + 1) * binWidth;
        binLabels.push(`${lowerBound.toFixed(1)}-${upperBound.toFixed(1)}`);
    }

    // 统计每个区间的数量
    data.forEach(value => {
        const binIndex = Math.min(Math.floor((value - minBin) / binWidth), binCount - 1);
        if (binIndex >= 0) bins[binIndex]++;
    });

    // 将频数转换为频率（百分比）
    const frequencies = bins.map(bin => (bin / count) * 100);

    // 创建图表 - 修改背景颜色并添加网格
    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: binLabels,
            datasets: [{
                label: title,
                data: frequencies,  // 使用频率而不是频数
                backgroundColor: 'rgba(54, 162, 235, 0.5)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                title: {
                    display: true,
                    text: `${title} (n=${count})`,
                    font: {
                        size: 36,
                        weight: 'bold'
                    },
                    padding: {
                        top: 20,
                        bottom: 10
                    }
                },
                subtitle: {
                    display: true,
                    text: tr('img.subtitle', {
                        mean: mean.toFixed(2), median: median.toFixed(2), sd: stdDev.toFixed(2)
                    }),
                    font: {
                        size: 28
                    },
                    padding: {
                        bottom: 20
                    }
                },
                legend: {
                    display: false
                },
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: tr('img.axis.length'),
                        font: {
                            size: 28,
                            weight: 'bold'
                        },
                        padding: {
                            top: 10
                        }
                    },
                    ticks: {
                        font: {
                            size: 24
                        },
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        display: true,
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: tr('img.axis.frequency'),
                        font: {
                            size: 28,
                            weight: 'bold'
                        }
                    },
                    ticks: {
                        font: {
                            size: 24
                        },
                        callback: function (value) {
                            return value;  // 在刻度值后添加百分号
                        }
                    },
                    beginAtZero: true,
                    grid: {
                        display: true,
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                }
            }
        }
    });

    // 等待图表渲染完成
    setTimeout(() => {
        try {
            // 修改：确保导出时背景是白色的
            // 1. 先让Chart.js完成渲染
            chart.render();

            // 2. 创建一个新的画布，确保背景是白色的
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = canvas.width;
            exportCanvas.height = canvas.height;
            const exportCtx = exportCanvas.getContext('2d');

            // 3. 填充白色背景
            exportCtx.fillStyle = 'white';
            exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

            // 4. 将原始画布内容绘制到新画布上
            exportCtx.drawImage(canvas, 0, 0);

            // 5. 从新画布导出图片，明确指定不要透明度
            const url = exportCanvas.toDataURL('image/png', 1.0);

            const a = document.createElement('a');
            a.href = url;
            a.download = `${fileBaseName}_${timestamp}.png`;
            a.click();

            // 清理
            document.body.removeChild(canvas);
            chart.destroy();
        } catch (error) {
            console.error('Error while saving the chart image:', error);
        }
    }, 500);
}

// 辅助函数：将3D点投影到2D平面，并确保在有效范围内
function projectPointTo2DLimit(point3D, camera, width, height) {
    const vector = point3D.clone();
    vector.project(camera);

    // 计算投影坐标
    let x = Math.round((vector.x + 1) * width / 2);
    let y = Math.round((-vector.y + 1) * height / 2);

    // 确保坐标在有效范围内
    x = Math.max(0, Math.min(width - 1, x));
    y = Math.max(0, Math.min(height - 1, y));

    return { x, y };
}

// 辅助函数：将3D点投影到2D平面
function projectPointTo2D(point3D, camera, width, height) {
    const vector = point3D.clone();
    vector.project(camera);

    // 计算投影坐标
    let x = Math.round((vector.x + 1) * width / 2);
    let y = Math.round((-vector.y + 1) * height / 2);

    return { x, y };
}

// 辅助函数：检查点是否在胶囊体内部
function isPointInsideCapsule(point2D, projectionMap) {
    const x = Math.floor(point2D.x);
    const y = Math.floor(point2D.y);

    if (x < 0 || x >= 512 || y < 0 || y >= 512) {
        return false;
    }

    return projectionMap[y * 512 + x] === 1;
}

// 辅助函数：计算两个2D点之间的距离
function distanceBetween2DPoints(p1, p2) {
    const pixelDistance = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

    // Convert pixel distance to model units.
    // Orthographic visible width = (right - left) / zoom, so zoom must be included.
    const pixelToWorldRatio = (projectionCamera.right - projectionCamera.left) /
        (projectionCamera.zoom * 512);

    // 返回实际长度
    return pixelDistance * pixelToWorldRatio;
}

// 辅助函数：使用Bresenham算法找到线段与胶囊体边缘的交点
function findLineIntersectionsWithCapsule(start, end, projectionMap) {
    const intersections = [];

    // Bresenham算法参数
    let x0 = Math.floor(start.x);
    let y0 = Math.floor(start.y);
    let x1 = Math.floor(end.x);
    let y1 = Math.floor(end.y);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1;
    const sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;

    let lastState = null; // 上一个点的状态（内部/外部）

    while (true) {
        // 检查当前点是否在有效范围内
        if (x0 < 0 || x0 >= 512 || y0 < 0 || y0 >= 512) {
            break;
        }

        // 检查当前点是否在胶囊体内部
        const currentState = (projectionMap[y0 * 512 + x0] === 1);

        // 如果状态发生变化，记录交点
        if (lastState !== null && currentState !== lastState) {
            intersections.push({ x: x0, y: y0 });
        }

        lastState = currentState;

        // 到达终点时退出
        if (x0 === x1 && y0 === y1) {
            break;
        }

        // Bresenham算法的核心部分
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
    }

    return intersections;
}

// Legend swatches share FLUORESCENCE_CSS with the fluorescence view and the projection analysis image
function legendLineSwatch(color) {
    return `<span style="display:inline-block;width:14px;height:3px;background-color:${color};margin-right:5px;vertical-align:middle;"></span>`;
}

function legendDotSwatch(color) {
    return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background-color:${color};margin:0 8px 0 3px;vertical-align:middle;"></span>`;
}

// Colour legend (HTML overlay in the window corner); its rows follow the active view and the language
function renderViewLegend(legendDiv) {
    const row = (swatch, text, isLast) =>
        `<div style="margin-bottom:${isLast ? 0 : 4}px;">${swatch}${text}</div>`;
    if (analysisViewActive) {
        legendDiv.innerHTML =
            row(legendLineSwatch(FLUORESCENCE_CSS.body), tr('legend.body')) +
            row(legendLineSwatch(FLUORESCENCE_CSS.inside), tr('legend.inside')) +
            row(legendLineSwatch(FLUORESCENCE_CSS.outside), tr('legend.outside')) +
            row(legendLineSwatch(FLUORESCENCE_CSS.outOfDepth), tr('legend.outOfDepth')) +
            row(legendDotSwatch(FLUORESCENCE_CSS.intersection), tr('legend.intersection'), true);
    } else {
        legendDiv.innerHTML =
            row(legendLineSwatch(FLUORESCENCE_CSS.body), tr('legend.body')) +
            row(legendLineSwatch(FLUORESCENCE_CSS.outside), tr('legend.visible'), true);
    }
}

// Title, toggle button text, visible image and legend for the active view
function applyAnalysisViewMode() {
    const titleElement = document.getElementById('fluorescenceViewTitle');
    const toggleButton = document.getElementById('analysisViewToggle');
    if (titleElement) {
        titleElement.textContent = tr(analysisViewActive ? 'view.analysis' : 'view.fluorescence');
    }
    if (toggleButton) {
        toggleButton.textContent = tr(analysisViewActive ? 'btn.toFluorescence' : 'btn.toAnalysis');
    }
    fluorescenceRenderer.domElement.style.display = analysisViewActive ? 'none' : 'block';
    if (analysisViewCanvas) {
        analysisViewCanvas.style.display = analysisViewActive ? 'block' : 'none';
    }
    const legendDiv = document.getElementById('fluorescenceLegendText');
    if (legendDiv) {
        renderViewLegend(legendDiv);
    }
}

// Build the analysis canvas, legend overlay, toggle button, wheel zoom and double-click reset
function setupAnalysisView() {
    const container = document.getElementById('fluorescenceCanvas');
    if (!container) {
        return;
    }
    fluorescenceRenderer.domElement.style.display = 'block';

    analysisViewCanvas = document.createElement('canvas');
    analysisViewCanvas.width = SILHOUETTE_SIZE;
    analysisViewCanvas.height = SILHOUETTE_SIZE;
    analysisViewCanvas.style.display = 'none';
    container.appendChild(analysisViewCanvas);

    const legendDiv = document.createElement('div');
    legendDiv.id = 'fluorescenceLegendText';
    legendDiv.style.position = 'absolute';
    legendDiv.style.bottom = '5px';
    legendDiv.style.right = '5px';
    legendDiv.style.color = 'white';
    legendDiv.style.fontSize = '11px';
    legendDiv.style.fontFamily = 'Arial, sans-serif';
    legendDiv.style.textShadow = '1px 1px 1px black';
    legendDiv.style.pointerEvents = 'none';  // do not intercept mouse events
    legendDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    legendDiv.style.padding = '5px';
    legendDiv.style.borderRadius = '3px';
    container.appendChild(legendDiv);

    document.getElementById('analysisViewToggle').addEventListener('click', () => {
        analysisViewActive = !analysisViewActive;
        applyAnalysisViewMode();
        if (!batchFastMode) {
            updateProjectionView({ forceFull: true });  // draw the newly shown image
        }
    });

    // Mouse wheel: zoom the displayed image (shared by both views)
    container.addEventListener('wheel', (event) => {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.0015);
        analysisViewZoom = Math.min(ANALYSIS_VIEW_ZOOM_MAX, Math.max(ANALYSIS_VIEW_ZOOM_MIN, analysisViewZoom * factor));
        analysisViewZoomDirty = true;
    }, { passive: false });

    // Double click: back to the default zoom
    container.addEventListener('dblclick', () => {
        analysisViewZoom = 1;
        analysisViewZoomDirty = true;
    });

    applyAnalysisViewMode();
}

// ================ 控制函数 ================
// 尺寸控制
function setupSizeControls() {
    const heightSlider = document.getElementById('height');
    const heightInput = document.getElementById('heightValue');
    const radiusSlider = document.getElementById('radius');
    const radiusInput = document.getElementById('radiusValue');

    // Keep height >= 2 * radius (a capsule needs a non-negative cylinder length):
    // the height lower bound follows the radius, the radius upper bound follows the height.
    function syncSizeLimits() {
        const h = parseFloat(heightInput.value);
        const r = parseFloat(radiusInput.value);
        const minHeight = Math.max(1, Math.ceil(2 * r * 10 - 1e-9) / 10);
        const maxRadius = Math.min(1, Math.floor(h * 5 + 1e-9) / 10);
        heightSlider.min = heightInput.min = minHeight;
        radiusSlider.max = radiusInput.max = maxRadius;
    }
    syncSizeLimits();

    heightSlider.addEventListener('input', () => {
        heightInput.value = heightSlider.value;
        syncSizeLimits();
        updateCapsule();
    });

    heightInput.addEventListener('change', () => {
        let value = readNumberOr(heightInput, heightSlider);
        value = Math.max(parseFloat(heightInput.min), Math.min(5, value));
        heightSlider.value = value;
        heightInput.value = value;
        syncSizeLimits();
        updateCapsule();
    });

    radiusSlider.addEventListener('input', () => {
        radiusInput.value = radiusSlider.value;
        syncSizeLimits();
        updateCapsule();
    });

    radiusInput.addEventListener('change', () => {
        let value = readNumberOr(radiusInput, radiusSlider);
        value = Math.max(0.1, Math.min(parseFloat(radiusInput.max), value));
        radiusSlider.value = value;
        radiusInput.value = value;
        syncSizeLimits();
        updateCapsule();
    });
}

// Parse a numeric text input; an empty or invalid entry falls back to the paired slider's current value
function readNumberOr(input, slider) {
    const value = parseFloat(input.value);
    return Number.isFinite(value) ? value : parseFloat(slider.value);
}

// 添加一个简单的防抖函数
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// 修改景深控制事件监听器
function setupDepthOfFieldControls() {
    const depthOfFieldSlider = document.getElementById('depthOfField');
    const depthOfFieldValue = document.getElementById('depthOfFieldValue');
    const focusDistanceSlider = document.getElementById('focusDistance');
    const focusDistanceValue = document.getElementById('focusDistanceValue');
    const showSideViewButton = document.getElementById('showSideView');

    // 景深范围控制
    depthOfFieldSlider.addEventListener('input', function () {
        depthOfFieldValue.value = this.value;
        depthOfField = parseFloat(this.value);
        updateDepthPlanesPosition();
        updateProjectionView();
    });

    depthOfFieldValue.addEventListener('change', function () {
        const value = readNumberOr(this, depthOfFieldSlider);
        this.value = value;
        depthOfFieldSlider.value = value;
        depthOfField = value;
        updateDepthPlanesPosition();
        updateProjectionView();
    });

    // 焦点距离控制
    focusDistanceSlider.addEventListener('input', function () {
        focusDistanceValue.value = this.value;
        focusDistance = parseFloat(this.value);
        updateDepthPlanesPosition();
        updateProjectionView();
    });

    focusDistanceValue.addEventListener('change', function () {
        const value = readNumberOr(this, focusDistanceSlider);
        this.value = value;
        focusDistanceSlider.value = value;
        focusDistance = value;
        updateDepthPlanesPosition();
        updateProjectionView();
    });

    // 显示侧面视图按钮
    showSideViewButton.addEventListener('click', function () {
        const sideView = document.getElementById('sideView');
        sideView.style.display = 'block';
        sideViewVisible = true;
        updateSideView();
    });

    // 侧面视图切换按钮
    const toggleSideViewButton = document.getElementById('toggleSideView');
    toggleSideViewButton.addEventListener('click', function () {
        const sideView = document.getElementById('sideView');
        if (sideView.style.display === 'none') {
            sideView.style.display = 'block';
            sideViewVisible = true;
            updateSideView();
        } else {
            sideView.style.display = 'none';
            sideViewVisible = false;
        }
    });
}

// 修改 setupRotationControls 函数中的旋转处理
function setupRotationControls() {
    const axes = ['X', 'Y', 'Z'];

    // The three controls define the pose directly as XYZ Euler angles (degrees),
    // the same convention that batch simulation uses and that is written to the exports.
    function applyControlRotation() {
        const angles = axes.map(axis => {
            const value = parseFloat(document.getElementById(`rotation${axis}Value`).value);
            return Number.isFinite(value) ? value : 0;
        });
        capsule.quaternion.copy(quaternionFromEulerDegrees(angles[0], angles[1], angles[2]));
    }

    const resetButton = document.getElementById('resetRotation');
    resetButton.addEventListener('click', () => {
        // 更新UI显示
        axes.forEach(axis => {
            const slider = document.getElementById(`rotation${axis}`);
            const input = document.getElementById(`rotation${axis}Value`);
            slider.value = 0;
            input.value = 0;
        });

        // 重置为无旋转
        applyControlRotation();

        // 重置旋转时更新所有视图
        updateProjectionView();

        // 新增：如果侧面视图可见，更新侧面视图
        if (sideViewVisible) {
            updateSideView();
        }
    });

    // 创建防抖版本的投影视图更新函数
    const debouncedUpdateProjectionView = debounce(updateProjectionViewIfStale, 100);
    // 新增：创建防抖版本的侧面视图更新函数
    const debouncedUpdateSideView = debounce(() => {
        if (sideViewVisible) {
            updateSideView();
        }
    }, 100);

    axes.forEach(axis => {
        const slider = document.getElementById(`rotation${axis}`);
        const input = document.getElementById(`rotation${axis}Value`);

        slider.addEventListener('input', () => {
            const value = parseFloat(slider.value);
            input.value = value;

            // Rebuild the pose from all three Euler angles (XYZ)
            applyControlRotation();

            // 实时更新主视图（the animation loop renders it on the next frame; no duplicate render here）
            mainViewDirty = true;

            // 使用防抖函数更新投影视图，减少渲染频率
            debouncedUpdateProjectionView();

            // 新增：使用防抖函数更新侧面视图
            debouncedUpdateSideView();
        });

        input.addEventListener('change', () => {
            let value = readNumberOr(input, slider);
            value = Math.max(-180, Math.min(180, value));
            slider.value = value;
            input.value = value;

            // Rebuild the pose from all three Euler angles (XYZ)
            applyControlRotation();

            // 如果侧面视图可见，更新侧面视图
            if (sideViewVisible) {
                updateSideView();
            }
            // 更新投影视图
            updateProjectionView();
        });
    });

    // ---- Drag with the left mouse button in the main view to rotate the bacterium ----
    // The camera stays fixed (as in the microscope model); the cell turns about the screen's vertical and horizontal
    // axes, like a trackball. After every step the pose is written back as XYZ Euler angles rounded to 0.01 deg and
    // the cell is rebuilt from exactly those angles, so the controls and the exports still match the pose exactly.
    const DRAG_DEGREES_PER_PIXEL = 0.5;
    const dragSurface = renderer.domElement;
    const dragScreenUp = new THREE.Vector3();
    const dragScreenRight = new THREE.Vector3();
    const dragRotation = new THREE.Quaternion();
    const dragPitch = new THREE.Quaternion();
    let dragPointerId = null;
    let dragLastX = 0;
    let dragLastY = 0;

    dragSurface.style.touchAction = 'none';  // let touch screens drag too
    dragSurface.style.cursor = 'grab';

    function writeAnglesFromQuaternion(quaternion) {
        const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
        const degrees = [euler.x, euler.y, euler.z].map(
            (radians) => Number(THREE.MathUtils.radToDeg(radians).toFixed(2))
        );
        axes.forEach((axis, index) => {
            document.getElementById(`rotation${axis}Value`).value = degrees[index];
            document.getElementById(`rotation${axis}`).value = degrees[index];  // the slider itself snaps to whole degrees
        });
        applyControlRotation();  // rebuild the pose from the written angles
    }

    function endDrag(event) {
        if (dragPointerId === null || event.pointerId !== dragPointerId) {
            return;
        }
        if (dragSurface.hasPointerCapture && dragSurface.hasPointerCapture(dragPointerId)) {
            dragSurface.releasePointerCapture(dragPointerId);
        }
        dragPointerId = null;
        dragSurface.style.cursor = 'grab';
    }

    dragSurface.addEventListener('pointerdown', (event) => {
        // Left button / primary touch only; the controls are locked while a batch run is going on
        if (event.button !== 0 || dragPointerId !== null || batchFastMode) {
            return;
        }
        event.preventDefault();
        dragPointerId = event.pointerId;
        dragLastX = event.clientX;
        dragLastY = event.clientY;
        try {
            dragSurface.setPointerCapture(dragPointerId);  // keep receiving moves when the pointer leaves the canvas
        } catch (error) {
            // capture is only a convenience; dragging still works while the pointer stays over the canvas
        }
        dragSurface.style.cursor = 'grabbing';
    });

    dragSurface.addEventListener('pointermove', (event) => {
        if (event.pointerId !== dragPointerId || batchFastMode) {
            return;
        }
        const deltaX = event.clientX - dragLastX;
        const deltaY = event.clientY - dragLastY;
        dragLastX = event.clientX;
        dragLastY = event.clientY;
        if (deltaX === 0 && deltaY === 0) {
            return;
        }

        // Screen axes in world coordinates: drag right turns the near side to the right, drag down turns it down
        dragScreenUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
        dragScreenRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        dragRotation.setFromAxisAngle(dragScreenUp, THREE.MathUtils.degToRad(deltaX * DRAG_DEGREES_PER_PIXEL));
        dragPitch.setFromAxisAngle(dragScreenRight, THREE.MathUtils.degToRad(deltaY * DRAG_DEGREES_PER_PIXEL));
        dragRotation.multiply(dragPitch);
        capsule.quaternion.premultiply(dragRotation).normalize();

        writeAnglesFromQuaternion(capsule.quaternion);

        // Same follow-up as the sliders: the animation loop renders the main view and refreshes the analysis;
        // the side view is refreshed with a short debounce
        mainViewDirty = true;
        debouncedUpdateSideView();
    });

    dragSurface.addEventListener('pointerup', endDrag);
    dragSurface.addEventListener('pointercancel', endDrag);
}

// 毛发控制
function setupHairControls() {
    const hairCountSlider = document.getElementById('hairCount');
    const hairCountInput = document.getElementById('hairCountValue');
    const hairLengthSlider = document.getElementById('hairLength');
    const hairLengthInput = document.getElementById('hairLengthValue');
    const shapeParamSlider = document.getElementById('shapeParam');
    const shapeParamInput = document.getElementById('shapeParamValue');
    const regenerateButton = document.getElementById('regenerateHairs');

    hairCountSlider.addEventListener('input', () => {
        hairCountInput.value = hairCountSlider.value;
        updateCapsule();
    });

    hairCountInput.addEventListener('change', () => {
        let value = Math.round(readNumberOr(hairCountInput, hairCountSlider));
        value = Math.max(0, Math.min(50, value));
        hairCountSlider.value = value;
        hairCountInput.value = value;
        updateCapsule();
    });

    hairLengthSlider.addEventListener('input', () => {
        hairLengthInput.value = hairLengthSlider.value;
        // 删除对伽马分布图的更新
    });

    hairLengthInput.addEventListener('change', () => {
        let value = readNumberOr(hairLengthInput, hairLengthSlider);
        value = Math.max(0.5, Math.min(10, value));
        hairLengthSlider.value = value;
        hairLengthInput.value = value;
        // 删除对伽马分布图的更新
    });

    shapeParamSlider.addEventListener('input', () => {
        shapeParamInput.value = shapeParamSlider.value;
        // 删除对伽马分布图的更新
    });

    shapeParamInput.addEventListener('change', () => {
        let value = readNumberOr(shapeParamInput, shapeParamSlider);
        value = Math.max(0.5, Math.min(10, value));
        shapeParamSlider.value = value;
        shapeParamInput.value = value;
        // 删除对伽马分布图的更新
    });

    // 重新生成菌毛按钮
    regenerateButton.addEventListener('click', () => {
        updateCapsule();  // 这里会触发直方图的更新
    });

    // Attachment point allocation: fixed cylinder share or area-proportional
    const anchorModeSelect = document.getElementById('anchorMode');
    const shareSlider = document.getElementById('cylinderShare');
    const shareInput = document.getElementById('cylinderShareValue');

    anchorModeSelect.addEventListener('change', () => {
        syncAnchorControlState();
        updateCapsule();
    });

    shareSlider.addEventListener('input', () => {
        shareInput.value = shareSlider.value;
        updateCapsule();
    });

    shareInput.addEventListener('change', () => {
        let value = parseFloat(shareInput.value);
        if (!Number.isFinite(value)) {
            value = DEFAULT_CYLINDER_SHARE_PERCENT;
        }
        value = Math.max(0, Math.min(100, value));
        shareSlider.value = value;
        shareInput.value = value;
        updateCapsule();
    });

    syncAnchorControlState();
    updateAnchorRatioText(
        parseFloat(document.getElementById('radiusValue').value),
        parseFloat(document.getElementById('heightValue').value)
    );
}

// ---- Attachment point allocation settings ----
function readAnchorSettings() {
    const modeElement = document.getElementById('anchorMode');
    const shareElement = document.getElementById('cylinderShareValue');
    const share = parseFloat(shareElement.value);
    return {
        anchorMode: modeElement.value === 'area' ? 'area' : 'fixed',
        cylinderShare: Number.isFinite(share) ? share : DEFAULT_CYLINDER_SHARE_PERCENT
    };
}

// Write settings into the controls only; the caller regenerates the capsule
function applyAnchorSettings(params) {
    if (!params || params.anchorMode === undefined) {
        return;
    }
    document.getElementById('anchorMode').value = params.anchorMode === 'area' ? 'area' : 'fixed';
    document.getElementById('cylinderShareValue').value = params.cylinderShare;
    document.getElementById('cylinderShare').value = params.cylinderShare;
    syncAnchorControlState();
}

// The share inputs only apply in 'fixed' mode
function syncAnchorControlState() {
    const isFixed = document.getElementById('anchorMode').value !== 'area';
    document.getElementById('cylinderShare').disabled = !isFixed;
    document.getElementById('cylinderShareValue').disabled = !isFixed;
}

function updateAnchorRatioText(radius, height) {
    const textElement = document.getElementById('anchorRatioText');
    if (!textElement) {
        return;
    }
    const { anchorMode, cylinderShare } = readAnchorSettings();
    const fraction = computeCylinderFraction(radius, height, anchorMode, cylinderShare);
    const cylinderPercent = (fraction * 100).toFixed(1);
    const capsPercent = ((1 - fraction) * 100).toFixed(1);
    const note = (height - 2 * radius <= 1e-9) ? tr('anchor.noCylinder') : '';
    textElement.textContent = tr('anchor.ratio', {
        mode: describeAnchorMode(anchorMode), cylinder: cylinderPercent, caps: capsPercent, note: note
    });
}

// ================ 新增功能函数 ================
// 设置导出功能
function setupExportButton() {
    const exportBtn = document.getElementById('exportBtn');
    const exportDialog = document.getElementById('exportDialog');
    const cancelExport = document.getElementById('cancelExport');
    const confirmExport = document.getElementById('confirmExport');

    exportBtn.addEventListener('click', () => {
        exportDialog.style.display = 'block';
    });

    cancelExport.addEventListener('click', () => {
        exportDialog.style.display = 'none';
    });

    confirmExport.addEventListener('click', () => {
        // 获取选中的导出选项
        const exportModelParams = document.getElementById('exportModelParams').checked;
        const exportHairLengths = document.getElementById('exportHairLengths').checked;
        const exportProjectionData = document.getElementById('exportProjectionData').checked;

        // 获取选中的导出格式
        const exportFormat = document.querySelector('input[name="exportFormat"]:checked').value;

        // 准备导出数据
        const exportData = {};

        if (exportModelParams) {
            exportData.modelParameters = {
                height: parseFloat(document.getElementById('heightValue').value),
                radius: parseFloat(document.getElementById('radiusValue').value),
                hairCount: parseInt(document.getElementById('hairCountValue').value),
                meanHairLength: parseFloat(document.getElementById('hairLengthValue').value),
                shapeParam: parseFloat(document.getElementById('shapeParamValue').value),
                anchorMode: readAnchorSettings().anchorMode,
                cylinderSharePercent: roundTo(computeCylinderFraction(
                    parseFloat(document.getElementById('radiusValue').value),
                    parseFloat(document.getElementById('heightValue').value),
                    readAnchorSettings().anchorMode,
                    readAnchorSettings().cylinderShare
                ) * 100, 1),
                rotationX: parseFloat(document.getElementById('rotationXValue').value),
                rotationY: parseFloat(document.getElementById('rotationYValue').value),
                rotationZ: parseFloat(document.getElementById('rotationZValue').value),
                rotationConvention: 'Euler XYZ (three.js order), degrees'
            };
        }

        if (exportHairLengths) {
            exportData.hairLengths = currentHairLengths;
        }

        if (exportProjectionData) {
            exportData.projectionHairLengths = projectionHairLengths;
            exportData.hairObservations = currentHairObservations.map((item) => ({
                hairIndex: item.hairIndex,
                trueLength: item.trueLength,
                projectionLength: item.projectionLength,
                isVisible: item.isVisible
            }));
            exportData.visibleThreshold = VISIBLE_PROJECTION_LENGTH_THRESHOLD;
        }

        // 根据选择的格式导出数据
        if (exportFormat === 'json') {
            exportAsJSON(exportData);
        } else if (exportFormat === 'excel') {
            exportAsExcel(exportData);
        }

        exportDialog.style.display = 'none';
    });
}

// 导出为JSON格式
function exportAsJSON(data) {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;

    const link = document.createElement('a');
    link.href = url;
    link.download = `${tr('file.modelData')}_${timestamp}.json`;
    link.click();

    URL.revokeObjectURL(url);
}

// 导出为Excel格式
function exportAsExcel(data) {
    // 创建工作簿
    const wb = XLSX.utils.book_new();

    // 添加模型参数工作表
    if (data.modelParameters) {
        const paramRows = [
            [tr('col.parameter'), tr('col.value')],
            [tr('col.axisLength'), data.modelParameters.height],
            [tr('col.radius'), data.modelParameters.radius],
            [tr('col.hairCount'), data.modelParameters.hairCount],
            [tr('col.meanHairLength'), data.modelParameters.meanHairLength],
            [tr('col.concentration'), data.modelParameters.shapeParam],
            [tr('col.anchorMode'), describeAnchorMode(data.modelParameters.anchorMode)],
            [tr('col.cylinderShare'), data.modelParameters.cylinderSharePercent],
            [tr('col.rotX'), data.modelParameters.rotationX],
            [tr('col.rotY'), data.modelParameters.rotationY],
            [tr('col.rotZ'), data.modelParameters.rotationZ],
            [tr('col.rotationConvention'), data.modelParameters.rotationConvention || 'Euler XYZ (three.js order), degrees']
        ];

        const paramWs = XLSX.utils.aoa_to_sheet(paramRows);
        XLSX.utils.book_append_sheet(wb, paramWs, tr('sheet.modelParams'));
    }

    // 添加菌毛真实长度工作表
    if (data.hairLengths && data.hairLengths.length > 0) {
        const hairRows = [[tr('col.seq'), tr('col.hairLength')]];
        data.hairLengths.forEach((length, index) => {
            hairRows.push([index + 1, length]);
        });

        const hairWs = XLSX.utils.aoa_to_sheet(hairRows);
        XLSX.utils.book_append_sheet(wb, hairWs, tr('sheet.trueLengths'));
    }

    if (data.hairObservations && data.hairObservations.length > 0) {
        const pairedRows = [
            [tr('col.hairNo'), tr('col.trueLength'), tr('col.projLength'), tr('col.visible')]
        ];
        data.hairObservations.forEach((item) => {
            pairedRows.push([
                item.hairIndex + 1,
                roundTo(item.trueLength, 3),
                roundTo(item.projectionLength, 3),
                item.isVisible ? tr('col.yes') : tr('col.no')
            ]);
        });
        const pairedWs = XLSX.utils.aoa_to_sheet(pairedRows);
        XLSX.utils.book_append_sheet(wb, pairedWs, tr('sheet.pairing'));
    }

    // 添加投影菌毛长度工作表
    if (data.projectionHairLengths && data.projectionHairLengths.length > 0) {
        const projRows = [[tr('col.seq'), tr('col.projOutsideLength')]];
        data.projectionHairLengths.forEach((length, index) => {
            projRows.push([index + 1, length]);
        });

        const projWs = XLSX.utils.aoa_to_sheet(projRows);
        XLSX.utils.book_append_sheet(wb, projWs, tr('sheet.projLengths'));
    }

    // 添加统计数据工作表
    // Numeric summary (keeps number type); 'N/A' when the list is empty
    const summarize = (values, reducer) =>
        (values && values.length > 0) ? roundTo(reducer(values), 2) : 'N/A';
    const minOf = (v) => Math.min(...v);
    const maxOf = (v) => Math.max(...v);
    const meanOf = (v) => v.reduce((a, b) => a + b, 0) / v.length;
    const statsWs = XLSX.utils.aoa_to_sheet([
        [tr('col.statistic'), tr('col.trueHairLength'), tr('col.projOutsideLength')],
        [tr('col.n'), data.hairLengths ? data.hairLengths.length : 0, data.projectionHairLengths ? data.projectionHairLengths.length : 0],
        [tr('col.min'), summarize(data.hairLengths, minOf), summarize(data.projectionHairLengths, minOf)],
        [tr('col.max'), summarize(data.hairLengths, maxOf), summarize(data.projectionHairLengths, maxOf)],
        [tr('col.mean'), summarize(data.hairLengths, meanOf), summarize(data.projectionHairLengths, meanOf)]
    ]);
    XLSX.utils.book_append_sheet(wb, statsWs, tr('sheet.stats'));

    // 生成Excel文件并下载
    const now = new Date();
    const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;

    XLSX.writeFile(wb, `${tr('file.modelData')}_${timestamp}.xlsx`);
}

// 帮助功能
function setupHelpButton() {
    const helpBtn = document.getElementById('helpBtn');
    const helpDialog = document.getElementById('helpDialog');
    const closeBtn = helpDialog.querySelector('.close-btn');

    helpBtn.addEventListener('click', () => {
        helpDialog.style.display = 'block';
    });

    closeBtn.addEventListener('click', () => {
        helpDialog.style.display = 'none';
    });

    // 点击对话框外部关闭
    window.addEventListener('click', (event) => {
        if (event.target === helpDialog) {
            helpDialog.style.display = 'none';
        }
    });
}

// ================ 初始化和事件监听 ================
// 初始化图表
initCharts();

// 创建初始胶囊并添加毛发
let capsule = createCapsule(0.5, 2, 32);
currentHairLengths = [];

// 使用伽马分布生成初始毛发
for (let i = 0; i < 15; i++) {
    const { point, normal } = getRandomPointOnCapsule(0.5, 2);
    const hairLength = generateGammaDistributedLength(2.0, 3.0);
    currentHairLengths.push(hairLength);
    const hair = createHair(point, normal, hairLength, i);
    capsule.add(hair);
}
scene.add(capsule);

// 更新初始直方图
updateHairLengthHistogram(currentHairLengths);

// 设置控制器
setupSizeControls();
setupRotationControls();
setupHairControls();

// 创建景深平面
createDepthPlanes();

// 设置景深控制
setupDepthOfFieldControls();

// 初始化功能按钮
setupExportButton();
setupHelpButton();
setupBatchSimulationButton();

// Fluorescence / analysis window, then the first analysis
setupAnalysisView();
updateProjectionView();

// 修改 animate 函数中的旋转跟踪部分
// ---- Orientation gizmo (bottom left, right of the true-length histogram) ----
// Shows the bacterium's own X / Y / Z axes as seen from the camera, like the axis widget of a modelling program.
// Body frame -> view frame: inverse(camera rotation) * capsule rotation. At zero rotation with the default camera:
// X points right, Y up (the long axis), Z towards the viewer.
const AXIS_GIZMO_AXES = [
    { name: 'X', vector: new THREE.Vector3(1, 0, 0), color: '#e53935' },
    { name: 'Y', vector: new THREE.Vector3(0, 1, 0), color: '#43a047' },
    { name: 'Z', vector: new THREE.Vector3(0, 0, 1), color: '#1e88e5' }
];
const axisGizmoRotation = new THREE.Quaternion();

function drawAxisGizmo() {
    const canvas = document.getElementById('axisGizmoCanvas');
    if (!canvas || canvas.clientWidth <= 0) {
        return;
    }
    const dpr = window.devicePixelRatio || 1;
    const cssSize = canvas.clientWidth;
    const pixelSize = Math.round(cssSize * dpr);
    if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
        canvas.width = pixelSize;
        canvas.height = pixelSize;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);

    const center = cssSize / 2;
    const axisLength = cssSize * 0.34;
    const tipRadius = Math.max(6, cssSize * 0.085);

    axisGizmoRotation.copy(camera.quaternion).invert().multiply(capsule.quaternion);

    // Far axes first so the near ones are drawn on top
    const projected = AXIS_GIZMO_AXES.map((axis) => {
        const v = axis.vector.clone().applyQuaternion(axisGizmoRotation);
        return { axis, x: v.x, y: v.y, z: v.z };
    }).sort((a, b) => a.z - b.z);

    ctx.lineCap = 'round';
    projected.forEach(({ axis, x, y, z }) => {
        const depthAlpha = 0.6 + 0.4 * (z + 1) / 2;  // axes pointing away from the viewer are slightly faded

        // Negative half: short faint stub
        ctx.globalAlpha = 0.35 * depthAlpha;
        ctx.strokeStyle = axis.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.lineTo(center - x * axisLength * 0.45, center + y * axisLength * 0.45);
        ctx.stroke();

        // Positive half: solid line with a lettered tip
        const tipX = center + x * axisLength;
        const tipY = center - y * axisLength;
        ctx.globalAlpha = depthAlpha;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        ctx.fillStyle = axis.color;
        ctx.beginPath();
        ctx.arc(tipX, tipY, tipRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(tipRadius * 1.15)}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(axis.name, tipX, tipY + 0.5);
    });
    ctx.globalAlpha = 1;
}

// What the main view was last rendered for
const mainViewState = {
    position: new THREE.Vector3(NaN, NaN, NaN),
    quaternion: new THREE.Quaternion(NaN, NaN, NaN, NaN),
    capsuleQuaternion: new THREE.Quaternion(NaN, NaN, NaN, NaN)
};

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Main view: render only when the camera or the pose changed (or something marked it dirty)
    if (!camera.position.equals(mainViewState.position) ||
        !camera.quaternion.equals(mainViewState.quaternion) ||
        !capsule.quaternion.equals(mainViewState.capsuleQuaternion)) {
        mainViewState.position.copy(camera.position);
        mainViewState.quaternion.copy(camera.quaternion);
        mainViewState.capsuleQuaternion.copy(capsule.quaternion);
        mainViewDirty = true;
        drawAxisGizmo();
    }

    // Mouse-wheel zoom of the fluorescence / analysis image: redraw once per frame
    if (analysisViewZoomDirty && !batchFastMode) {
        analysisViewZoomDirty = false;
        updateProjectionView({ forceFull: true });
    }

    // Projection views: refresh if they were computed for a different camera/pose.
    // Explicit updateProjectionView() calls record what they computed, so nothing is analysed twice.
    // During a batch run the batch loop drives the (low-rate) preview itself.
    if (!batchFastMode && camera.userData.lastPosition && isProjectionViewStale()) {

        // 如果侧面视图可见，更新侧面视图
        if (sideViewVisible) {
            sideViewRenderer.render(sideViewScene, sideViewCamera);
            updateDepthLabelsPosition();
        }

        // 更新投影视图
        updateProjectionView();
    }

    if (mainViewDirty) {
        renderer.render(scene, camera);
        mainViewDirty = false;
    }
}

// 开始动画循环
animate();

// Language switch: refresh everything that is not static markup
onLanguageChange(() => {
    applyChartLanguage();

    applyAnalysisViewMode();

    updateAnchorRatioText(
        parseFloat(document.getElementById('radiusValue').value),
        parseFloat(document.getElementById('heightValue').value)
    );

    // Re-run the (cheap) view update so the statistics line is regenerated in the new language
    if (!batchFastMode) {
        updateProjectionView({ forceFull: true });
    }
});

// The projection analysis is the expensive part: run it once after the resize burst ends
const updateProjectionViewAfterResize = debounce(() => updateProjectionView({ forceFull: true }), 120);

// 窗口大小调整
window.addEventListener('resize', () => {
    // 更新主视图
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    mainViewDirty = true;
    drawAxisGizmo();  // the gizmo width follows the window width

    // 更新投影视图
    updateProjectionViewAfterResize();

    // 更新侧面视图
    if (sideViewVisible) {
        const sideViewCanvas = document.getElementById('sideViewCanvas');
        if (sideViewCanvas) {
            sideViewRenderer.setSize(
                sideViewCanvas.clientWidth,
                sideViewCanvas.clientHeight
            );
            updateSideView();
        }
    }

    // 更新图表
    if (hairLengthHistChart && typeof hairLengthHistChart.resize === 'function') {
        try {
            hairLengthHistChart.resize();
        } catch (e) {
            console.error('Error while resizing the true length chart:', e);
        }
    }
    if (projectionHairLengthChart && typeof projectionHairLengthChart.resize === 'function') {
        try {
            projectionHairLengthChart.resize();
        } catch (e) {
            console.error('Error while resizing the projected length chart:', e);
        }
    }
    // 更新荧光渲染器大小
    if (document.getElementById('fluorescenceCanvas')) {
        const fluorescenceCanvas = document.getElementById('fluorescenceCanvas');
        fluorescenceRenderer.setSize(
            fluorescenceCanvas.clientWidth,
            fluorescenceCanvas.clientHeight
        );
    }
});

// 添加一个清理函数，在页面卸载时释放共享资源
function cleanupResources() {
    if (sharedRenderTarget) {
        sharedRenderTarget.dispose();
        sharedRenderTarget = null;
    }

    if (sharedTempRenderer) {
        sharedTempRenderer.dispose();
        sharedTempRenderer = null;
    }

    // 清理其他可能的WebGL资源
    if (hairLengthHistChart) {
        hairLengthHistChart.destroy();
    }

    if (projectionHairLengthChart) {
        projectionHairLengthChart.destroy();
    }
}

// 在页面卸载时调用清理函数
window.addEventListener('beforeunload', cleanupResources);

// 修复Chart.js的resize方法
if (typeof Chart !== 'undefined' && Chart.prototype && !Chart.prototype.resize) {
    Chart.prototype.resize = function () {
        if (this.attached) {
            const canvas = this.canvas;
            const parent = canvas.parentNode;
            if (parent) {
                const width = parent.clientWidth;
                const height = parent.clientHeight;
                if (width && height) {
                    this.width = width;
                    this.height = height;
                    this.update('resize');
                }
            }
        }
    };
}

// 添加一个初始化函数，确保所有组件都正确加载
window.addEventListener('DOMContentLoaded', () => {
    // 检查投影统计视图容器是否存在
    const projectionStatsView = document.getElementById('projectionStatsView');
    if (!projectionStatsView) {
        console.warn('Projection statistics container not found');
    }

    // The initial projection view is already computed by the top-level updateProjectionView() call
});