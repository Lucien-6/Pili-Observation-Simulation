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
fluorescenceRenderer.setSize(400, 400);
document.getElementById('fluorescenceCanvas').appendChild(fluorescenceRenderer.domElement);

// 创建投影场景
const projectionScene = new THREE.Scene();
projectionScene.background = new THREE.Color(0xffffff);

// 创建投影相机（正交相机）
const projectionCamera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 1000);
projectionCamera.position.set(0, 10, 0);  // 从正上方看向原点
projectionCamera.lookAt(0, 0, 0);
projectionCamera.zoom = 0.8;
projectionCamera.updateProjectionMatrix();

// 创建投影渲染器
const projectionRenderer = new THREE.WebGLRenderer({ antialias: true });
projectionRenderer.setSize(400, 400);
document.getElementById('projectionCanvas').appendChild(projectionRenderer.domElement);

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

// 创建投影场景的平行光源
const projectionLight = new THREE.DirectionalLight(0xffffff, 1);
projectionLight.position.copy(projectionCamera.position);
projectionScene.add(projectionLight);
projectionScene.add(new THREE.AmbientLight(0x404040));

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

// ================ 工具函数 ================
// 计算两点之间的距离
function distance(p1, p2) {
    return Math.sqrt(
        Math.pow(p1.x - p2.x, 2) +
        Math.pow(p1.y - p2.y, 2) +
        Math.pow(p1.z - p2.z, 2)
    );
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
function getRandomPointOnCapsule(radius, height) {
    const cylinderHeight = height - 2 * radius;

    // 按照5.5:4的比例决定在圆柱体还是半球上生成点，而不是按表面积比例
    const onCylinder = Math.random() < 0.55; // 60%的点在圆柱体上
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
        const phi = Math.acos(2 * v - 1) / 2;

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
function generatePoissonPoints(radius, height, count, minDistance) {
    const points = [];
    const attempts = 30; // 每个点的最大尝试次数
    const activePoints = [];

    // 生成第一个点
    if (count > 0) {
        const firstPoint = getRandomPointOnCapsule(radius, height);
        points.push(firstPoint);
        activePoints.push(firstPoint);
    }

    // 尝试生成剩余的点
    while (activePoints.length > 0 && points.length < count) {
        // 随机选择一个活动点
        const randomIndex = Math.floor(Math.random() * activePoints.length);
        const currentPoint = activePoints[randomIndex];
        let foundValidPoint = false;

        // 尝试在当前点周围生成新点
        for (let i = 0; i < attempts; i++) {
            const newPoint = getRandomPointOnCapsule(radius, height);

            // 检查新点是否与现有点保持最小距离
            let isValid = true;
            for (let j = 0; j < points.length; j++) {
                if (distance(newPoint.point, points[j].point) < minDistance) {
                    isValid = false;
                    break;
                }
            }

            if (isValid) {
                points.push(newPoint);
                activePoints.push(newPoint);
                foundValidPoint = true;
                break;
            }
        }

        // 如果无法在当前点周围找到有效点，则从活动列表中移除
        if (!foundValidPoint) {
            activePoints.splice(randomIndex, 1);
        }
    }

    // 如果无法生成足够的点，使用随机点填充
    while (points.length < count) {
        points.push(getRandomPointOnCapsule(radius, height));
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
                    label: '菌毛长度分布',
                    data: [],
                    backgroundColor: 'rgba(54, 162, 235, 0.5)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            options: {
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
                            text: '长度'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: '频率'
                        },
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `频率: ${context.parsed.y}`;
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
        console.error('未找到毛发长度图表容器');
    }

    // 投影菌毛长度直方图
    const projHistCtx = document.getElementById('projectionHairLengthCanvas');
    if (projHistCtx) {
        projectionHairLengthChart = new Chart(projHistCtx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: '投影菌毛外伸长度分布',
                    data: [],
                    backgroundColor: 'rgba(75, 192, 192, 0.5)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: '长度'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: '频率'
                        },
                        beginAtZero: true
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `频率: ${(context.parsed.y * 100).toFixed(1)}%`;
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
        console.error('未找到投影菌毛长度图表容器');
    }
}

// 更新毛发长度直方图
function updateHairLengthHistogram(hairLengths) {
    if (!hairLengthHistChart) {
        console.error('毛发长度图表未初始化');
        return;
    }

    if (hairLengths.length === 0) {
        hairLengthHistChart.data.labels = [];
        hairLengthHistChart.data.datasets[0].data = [];
        hairLengthHistChart.update();
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
    hairLengthHistChart.options.scales.y.title.text = '频率';
    hairLengthHistChart.options.plugins.tooltip.callbacks.label = function (context) {
        return `频率: ${(context.parsed.y * 100).toFixed(1)}%`;
    };
    hairLengthHistChart.update();
}

// 更新投影菌毛长度直方图
function updateProjectionHairLengthHistogram(hairLengths) {
    if (!projectionHairLengthChart) {
        console.error('投影菌毛长度图表未初始化');
        return;
    }

    if (hairLengths.length === 0) {
        // 如果没有数据，清空图表
        projectionHairLengthChart.data.labels = [];
        projectionHairLengthChart.data.datasets[0].data = [];
        projectionHairLengthChart.update();

        // 更新统计信息
        const statsInfoElement = document.getElementById('projectionStatsInfo');
        if (statsInfoElement) {
            statsInfoElement.innerHTML =
                `<strong>投影菌毛统计:</strong> 没有符合条件的菌毛外伸出胶囊投影区域（忽略长度&lt;${VISIBLE_PROJECTION_LENGTH_THRESHOLD}）`;
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
    projectionHairLengthChart.update();

    // 计算平均长度和标准差
    const avgLength = hairLengths.reduce((sum, len) => sum + len, 0) / totalCount;
    const variance = hairLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / totalCount;
    const stdDev = Math.sqrt(variance);

    // 更新统计信息 - 添加过滤说明
    const statsInfoElement = document.getElementById('projectionStatsInfo');
    if (statsInfoElement) {
        statsInfoElement.innerHTML =
            `<strong>统计结果:</strong> 共有 ${totalCount} 根菌毛可见(≥${VISIBLE_PROJECTION_LENGTH_THRESHOLD}) | ` +
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
    }

    // 创建一个组来包含所有景深相关的对象
    depthPlanes = new THREE.Group();
    depthPlanes.userData = {};

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
    const linePoints = [];

    // 创建一条垂直线，高度为6
    for (let y = -3; y <= 3; y += 0.01) {
        linePoints.push(new THREE.Vector3(0, y, zPosition));
    }

    lineGeometry.setFromPoints(linePoints);

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
    const cylinderHeight = height - 2 * radius;
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
    
    // 随机角度，最大30度（PI/6弧度）
    const maxAngle = Math.PI / 6;
    const theta = Math.random() * maxAngle; // 方位角范围[0, 30度]
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
        capsule.remove(capsule.children[0]);
    }

    const height = parseFloat(document.getElementById('heightValue').value);
    const radius = parseFloat(document.getElementById('radiusValue').value);
    const hairCount = parseInt(document.getElementById('hairCountValue').value);
    const meanHairLength = parseFloat(document.getElementById('hairLengthValue').value);
    const shapeParam = parseFloat(document.getElementById('shapeParamValue').value);

    // 保存当前四元数旋转
    const currentQuaternion = capsule.quaternion.clone();
    scene.remove(capsule);

    capsule = createCapsule(radius, height, 32);

    // 计算适当的最小距离 - 基于胶囊表面积和毛发数量
    const cylinderHeight = height - 2 * radius;
    const totalSurfaceArea = 2 * Math.PI * radius * cylinderHeight + 4 * Math.PI * radius * radius;
    const minDistance = Math.sqrt(totalSurfaceArea / (hairCount * Math.PI)) * 0.8; // 0.8是调整系数

    // 使用泊松分布生成毛发固着点
    const hairPoints = generatePoissonPoints(radius, height, hairCount, minDistance);

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

    // 更新直方图
    updateHairLengthHistogram(currentHairLengths);

    // 更新侧面视图，如果它存在
    if (sideViewVisible) {
        updateSideView();
    }

    // 更新投影视图
    updateProjectionView();
}

// 更新投影视图
function updateProjectionView() {
    // 清空投影场景
    while (projectionScene.children.length > 0) {
        projectionScene.remove(projectionScene.children[0]);
    }

    // 重新添加光源
    const projectionLight = new THREE.DirectionalLight(0xffffff, 2);
    projectionLight.position.copy(camera.position);
    projectionScene.add(projectionLight);
    projectionScene.add(new THREE.AmbientLight(0x404040, 0.5));

    // 创建投影胶囊的副本
    const projectionCapsule = capsule.clone();
    // 确保投影胶囊的旋转与主胶囊一致
    projectionCapsule.quaternion.copy(capsule.quaternion);

    // 用于存储投影菌毛数据
    projectionHairLengths = [];
    currentHairObservations = [];

    // 创建一个用于检测胶囊体的材质
    const capsuleMaterial = new THREE.MeshBasicMaterial({
        color: 0x156289, // 深蓝色
        side: THREE.DoubleSide
    });

    // 创建一个组来存放胶囊体部分（不包括菌毛）
    const capsuleBody = new THREE.Group();
    // 确保胶囊体的旋转与主胶囊一致
    capsuleBody.rotation.copy(projectionCapsule.rotation);

    // 遍历投影胶囊的所有子对象
    projectionCapsule.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            // 将胶囊体设置为深蓝色的基础材质
            child.material = capsuleMaterial.clone();
            capsuleBody.add(child.clone());  // 添加到胶囊体组
        } else if (child instanceof THREE.Line) {
            // 将毛发设置为亮绿色
            child.material = new THREE.LineBasicMaterial({
                color: 0x00ff00,
                linewidth: 1.5
            });
        }
    });

    // 添加胶囊体到场景
    projectionScene.add(projectionCapsule);

    // 使投影相机与主相机保持一致的朝向
    projectionCamera.position.copy(camera.position);
    projectionCamera.lookAt(controls.target);
    projectionCamera.up.copy(camera.up);

    // 计算合适的正交相机视锥体大小
    const height = parseFloat(document.getElementById('heightValue').value);
    const radius = parseFloat(document.getElementById('radiusValue').value);
    const maxDimension = Math.max(height, radius * 2) * 2.0;

    // 使用固定的缩放因子，不再基于相机距离
    const aspect = projectionRenderer.domElement.width / projectionRenderer.domElement.height;
    const baseSize = maxDimension * 1.2; // 添加20%的边距

    if (aspect >= 1) {
        projectionCamera.left = -baseSize * aspect / 2;
        projectionCamera.right = baseSize * aspect / 2;
        projectionCamera.top = baseSize / 2;
        projectionCamera.bottom = -baseSize / 2;
    }

    projectionCamera.updateProjectionMatrix();

    try {
        // 渲染投影场景
        projectionRenderer.render(projectionScene, projectionCamera);
    } catch (error) {
        console.error('投影视图渲染错误:', error);
        projectionRenderer.render(projectionScene, projectionCamera);
    }

    try {
        // 独立出来的菌毛投影分析功能，放在单独的try-catch块中
        // 传递投影相机和胶囊的完整信息，确保荧光视图与投影视图保持一致
        updateFluorescenceView(projectionCapsule, capsuleBody, projectionCamera);
    } catch (error) {
        console.error('荧光视图渲染错误:', error);
        // 尝试简单渲染荧光场景，不进行复杂分析
        const simpleScene = new THREE.Scene();
        simpleScene.background = new THREE.Color(0x111111);
        fluorescenceRenderer.render(simpleScene, projectionCamera);
    }
}

// 修改 updateFluorescenceView 函数，添加错误处理
function updateFluorescenceView(projectionCapsule, capsuleBody, camera) {
    // 创建荧光场景
    const fluorescenceScene = new THREE.Scene();
    fluorescenceScene.background = new THREE.Color(0x111111); // 深灰色背景，更好地显示对比

    // 添加光源 - 确保光源位置与投影视图一致
    const fluorescenceLight = new THREE.DirectionalLight(0xffffff, 2);
    fluorescenceLight.position.copy(camera.position);
    fluorescenceScene.add(fluorescenceLight);
    fluorescenceScene.add(new THREE.AmbientLight(0x404040, 0.5));

    // 创建一个组来包含所有荧光视图元素，以便统一应用旋转
    const fluorescenceGroup = new THREE.Group();
    fluorescenceScene.add(fluorescenceGroup);

    // 添加胶囊体 - 使用浅绿色
    const fluorescenceCapsuleBody = new THREE.Group();
    capsuleBody.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            const mesh = child.clone();
            mesh.material = new THREE.MeshBasicMaterial({
                color: 0xa8e0a8, // 浅绿色
                side: THREE.DoubleSide,
                transparent: false,
                opacity: 1.0
            });
            fluorescenceCapsuleBody.add(mesh);
        }
    });

    // 确保胶囊体的旋转与主胶囊一致（四元数）
    fluorescenceCapsuleBody.quaternion.copy(capsuleBody.quaternion);

    // 将胶囊体添加到荧光组
    fluorescenceGroup.add(fluorescenceCapsuleBody);

    // 分析菌毛投影并添加到荧光场景
    const hairSegments = analyzeFluorescenceHairs(projectionCapsule, capsuleBody);

    // 创建一个组来存放所有菌毛线段
    const hairLinesGroup = new THREE.Group();

    // 在荧光场景中添加分段菌毛
    hairSegments.forEach(segment => {
        // 添加内部段（与胶囊重叠部分）- 黄色
        const insideGeometry = new THREE.BufferGeometry();
        const insidePositions = new Float32Array([
            segment.inside.start.x, segment.inside.start.y, segment.inside.start.z,
            segment.inside.end.x, segment.inside.end.y, segment.inside.end.z
        ]);
        insideGeometry.setAttribute('position', new THREE.BufferAttribute(insidePositions, 3));
        const insideMaterial = new THREE.LineBasicMaterial({
            color: 0xffcc00, // 黄色
            linewidth: 2,
            opacity: 0.8,
            transparent: true
        });
        const insideLine = new THREE.Line(insideGeometry, insideMaterial);
        hairLinesGroup.add(insideLine);

        // 添加外部段（外伸部分）- 亮绿色
        const outsideGeometry = new THREE.BufferGeometry();
        const outsidePositions = new Float32Array([
            segment.outside.start.x, segment.outside.start.y, segment.outside.start.z,
            segment.outside.end.x, segment.outside.end.y, segment.outside.end.z
        ]);
        outsideGeometry.setAttribute('position', new THREE.BufferAttribute(outsidePositions, 3));
        const outsideMaterial = new THREE.LineBasicMaterial({
            color: 0x00ff00, // 亮绿色
            linewidth: 2.5,
            opacity: 0.8,
            transparent: true
        });
        const outsideLine = new THREE.Line(outsideGeometry, outsideMaterial);
        hairLinesGroup.add(outsideLine);

        // 新增：添加景深范围外的菌毛部分（红色标记）
        if (segment.depthInfo && !segment.depthInfo.fullyInRange) {
            // 如果起点在景深范围外
            if (!segment.depthInfo.startInRange && segment.depthInfo.originalStart) {
                const outOfDepthStartGeometry = new THREE.BufferGeometry();
                const outOfDepthStartPositions = new Float32Array([
                    segment.depthInfo.originalStart.x, segment.depthInfo.originalStart.y, segment.depthInfo.originalStart.z,
                    segment.depthInfo.start.x, segment.depthInfo.start.y, segment.depthInfo.start.z
                ]);
                outOfDepthStartGeometry.setAttribute('position', new THREE.BufferAttribute(outOfDepthStartPositions, 3));
                const outOfDepthStartMaterial = new THREE.LineBasicMaterial({
                    color: 0xff0000, // 红色
                    linewidth: 2.5,
                    opacity: 1.0,
                    transparent: false
                });
                const outOfDepthStartLine = new THREE.Line(outOfDepthStartGeometry, outOfDepthStartMaterial);
                hairLinesGroup.add(outOfDepthStartLine);
            }

            // 如果终点在景深范围外
            if (!segment.depthInfo.endInRange && segment.depthInfo.originalEnd) {
                const outOfDepthEndGeometry = new THREE.BufferGeometry();
                const outOfDepthEndPositions = new Float32Array([
                    segment.depthInfo.end.x, segment.depthInfo.end.y, segment.depthInfo.end.z,
                    segment.depthInfo.originalEnd.x, segment.depthInfo.originalEnd.y, segment.depthInfo.originalEnd.z
                ]);
                outOfDepthEndGeometry.setAttribute('position', new THREE.BufferAttribute(outOfDepthEndPositions, 3));
                const outOfDepthEndMaterial = new THREE.LineBasicMaterial({
                    color: 0xff0000, // 红色
                    linewidth: 2.5,
                    opacity: 1.0,
                    transparent: false
                });
                const outOfDepthEndLine = new THREE.Line(outOfDepthEndGeometry, outOfDepthEndMaterial);
                hairLinesGroup.add(outOfDepthEndLine);
            }
        }
    });

    // 将菌毛线段组添加到主组
    fluorescenceGroup.add(hairLinesGroup);

    // 添加图例说明
    addFluorescenceLegend(fluorescenceScene);

    // 渲染荧光场景 - 使用与投影视图相同的相机
    fluorescenceRenderer.render(fluorescenceScene, camera);

    // 更新投影菌毛长度直方图
    if (projectionHairLengthChart) {
        updateProjectionHairLengthHistogram(projectionHairLengths);
    } else {
        console.error('投影菌毛长度图表未初始化');
        initCharts();
    }

    // 如果没有检测到外伸菌毛，显示提示信息
    if (projectionHairLengths.length === 0) {
        const statsInfoElement = document.getElementById('projectionStatsInfo');
        if (statsInfoElement) {
            statsInfoElement.innerHTML =
                `<strong>统计结果:</strong> 当前视角下没有菌毛外伸出胶囊表面`;
        }
    }
}

// 在全局变量区域添加一个共享的临时渲染器
let sharedTempRenderer = null;
let sharedRenderTarget = null;
let debugProjectionCanvas = null; // 新增：用于显示临时投影图的画布

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

function analyzeFluorescenceHairs(projectionCapsule, capsuleBody) {
    // 存储菌毛分段信息，用于后续渲染
    const hairSegments = [];

    projectionHairLengths = [];
    currentHairObservations = [];

    // 创建一个临时场景用于渲染胶囊体的二维投影
    const tempScene = new THREE.Scene();
    tempScene.background = new THREE.Color(0x000000); // 黑色背景

    // 添加胶囊体到临时场景（使用白色材质以便于区分）
    const capsuleBodyClone = capsuleBody.clone();

    capsuleBodyClone.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.material = new THREE.MeshBasicMaterial({
                color: 0xffffff, // 白色
                side: THREE.DoubleSide
            });
        }
    });
    tempScene.add(capsuleBodyClone);

    // 使用共享的临时渲染器，如果不存在则创建
    if (!sharedTempRenderer) {
        sharedTempRenderer = new THREE.WebGLRenderer({ antialias: true });
        sharedTempRenderer.setSize(512, 512);
        sharedRenderTarget = new THREE.WebGLRenderTarget(512, 512);

        // 新增：创建用于显示临时投影图的画布
        debugProjectionCanvas = document.createElement('canvas');
        debugProjectionCanvas.width = 512;
        debugProjectionCanvas.height = 512;
        debugProjectionCanvas.style.position = 'absolute';
        debugProjectionCanvas.style.top = '10px';
        debugProjectionCanvas.style.right = '420px';
        debugProjectionCanvas.style.border = '1px solid #333';
        debugProjectionCanvas.style.borderRadius = '5px';
        debugProjectionCanvas.style.zIndex = '1000';
        debugProjectionCanvas.style.display = 'none'; // 默认隐藏
        debugProjectionCanvas.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';

        // 添加标题
        const titleDiv = document.createElement('div');
        titleDiv.style.position = 'absolute';
        titleDiv.style.top = '10px';
        titleDiv.style.right = '515px';
        titleDiv.style.backgroundColor = 'rgba(0,0,0,0.7)';
        titleDiv.style.color = 'white';
        titleDiv.style.padding = '5px 10px';
        titleDiv.style.borderRadius = '5px 5px 0 0';
        titleDiv.style.fontSize = '12px';
        titleDiv.style.zIndex = '1000';
        titleDiv.style.display = 'none';
        titleDiv.textContent = '投影分析图 (红点为菌毛与胞体边缘交点，红色线段为景深范围外菌毛片段)';

        // 添加切换按钮
        const toggleButton = document.createElement('button');
        toggleButton.textContent = '显示/隐藏分析图';
        toggleButton.style.position = 'absolute';
        toggleButton.style.top = '450px';
        toggleButton.style.right = '10px';
        toggleButton.style.zIndex = '1001';
        toggleButton.style.padding = '5px 10px';
        toggleButton.style.backgroundColor = '#4CAF50';
        toggleButton.style.color = 'white';
        toggleButton.style.border = 'none';
        toggleButton.style.borderRadius = '4px';
        toggleButton.style.cursor = 'pointer';

        toggleButton.addEventListener('click', () => {
            const isVisible = debugProjectionCanvas.style.display !== 'none';
            debugProjectionCanvas.style.display = isVisible ? 'none' : 'block';
            titleDiv.style.display = isVisible ? 'none' : 'block';
        });

        document.body.appendChild(debugProjectionCanvas);
        document.body.appendChild(titleDiv);
        document.body.appendChild(toggleButton);
    }

    // 使用与投影视图相同的相机设置
    const tempCamera = projectionCamera.clone();

    // 渲染胶囊体到纹理
    sharedTempRenderer.setRenderTarget(sharedRenderTarget);
    sharedTempRenderer.render(tempScene, tempCamera);
    sharedTempRenderer.setRenderTarget(null);

    // 读取像素数据
    const pixelBuffer = new Uint8Array(512 * 512 * 4);
    sharedTempRenderer.readRenderTargetPixels(sharedRenderTarget, 0, 0, 512, 512, pixelBuffer);

    // 创建一个二维数组表示胶囊体的投影区域
    const projectionMap = new Array(512);
    for (let i = 0; i < 512; i++) {
        projectionMap[i] = new Array(512);
        // 注意：这里使用 (511 - i) 来实现上下反转
        for (let j = 0; j < 512; j++) {
            const index = ((511 - i) * 512 + j) * 4;
            // 如果像素是白色（胶囊体），则标记为1，否则为0
            projectionMap[i][j] = (pixelBuffer[index] > 200) ? 1 : 0;
        }
    }

    // 新增：将投影图显示到调试画布上
    const ctx = debugProjectionCanvas.getContext('2d');
    const imageData = ctx.createImageData(512, 512);

    // 绘制投影图
    for (let i = 0; i < 512; i++) {
        for (let j = 0; j < 512; j++) {
            const idx = (i * 512 + j) * 4;
            const value = projectionMap[i][j] === 1 ? 255 : 0;
            imageData.data[idx] = value;     // R
            imageData.data[idx + 1] = value; // G
            imageData.data[idx + 2] = value; // B
            imageData.data[idx + 3] = 255;   // A
        }
    }

    // 将图像数据放到画布上
    ctx.putImageData(imageData, 0, 0);

    // 计算景深的前后边界（世界坐标系）
    const nearPlaneDistance = focusDistance - depthOfField / 2;
    const farPlaneDistance = focusDistance + depthOfField / 2;

    // 分析菌毛投影
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

            // 检查点是否在相机视锥体内
            const frustum = new THREE.Frustum();
            frustum.setFromProjectionMatrix(
                new THREE.Matrix4().multiplyMatrices(
                    tempCamera.projectionMatrix,
                    tempCamera.matrixWorldInverse
                )
            );

            // Both endpoints outside the frustum: keep the hair record, mark invisible
            if (!frustum.containsPoint(rotatedStart3D) && !frustum.containsPoint(rotatedEnd3D)) {
                currentHairObservations.push(observation);
                return;
            }

            // 新增：存储菌毛的2D原始起点和终点，用于标记景深范围外的菌毛
            const originalStart2D = projectPointTo2D(rotatedStart3D, tempCamera, 512, 512);
            const originalEnd2D = projectPointTo2D(rotatedEnd3D, tempCamera, 512, 512);

            // 将3D点转换为2D投影坐标
            const start2D = projectPointTo2D(depthClippedStart3D, tempCamera, 512, 512);
            const end2D = projectPointTo2D(depthClippedEnd3D, tempCamera, 512, 512);

            // 将3D点转换为2D投影坐标(边缘截断)
            const start2DLimit = projectPointTo2DLimit(depthClippedStart3D, tempCamera, 512, 512);
            const end2DLimit = projectPointTo2DLimit(depthClippedEnd3D, tempCamera, 512, 512);

            // 修复：在调试画布上绘制菌毛线段，使用不同颜色表示景深内外
            // 确保先设置样式再绘制线段
            if (originalStart2D && originalEnd2D) {  // 添加空值检查
                // 根据菌毛在景深范围内外的情况使用不同颜色
                if (hairInDepthOfField.fullyInRange) {
                    // 完全在景深范围内 - 绿色
                    ctx.beginPath();
                    ctx.moveTo(originalStart2D.x, originalStart2D.y);
                    ctx.lineTo(originalEnd2D.x, originalEnd2D.y);
                    ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                } else {
                    // 部分在景深范围内 - 橙色
                    // 先绘制整个线段为橙色
                    ctx.beginPath();
                    ctx.moveTo(originalStart2D.x, originalStart2D.y);
                    ctx.lineTo(originalEnd2D.x, originalEnd2D.y);
                    ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    // 再绘制景深范围外的部分为红色
                    // 计算景深边界点的2D坐标
                    const depthClippedStart2D = projectPointTo2D(depthClippedStart3D, tempCamera, 512, 512);
                    const depthClippedEnd2D = projectPointTo2D(depthClippedEnd3D, tempCamera, 512, 512);

                    if (!hairInDepthOfField.startInRange && depthClippedStart2D) {
                        ctx.beginPath();
                        ctx.moveTo(originalStart2D.x, originalStart2D.y);
                        ctx.lineTo(depthClippedStart2D.x, depthClippedStart2D.y);
                        ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }

                    if (!hairInDepthOfField.endInRange && depthClippedEnd2D) {
                        ctx.beginPath();
                        ctx.moveTo(originalEnd2D.x, originalEnd2D.y);
                        ctx.lineTo(depthClippedEnd2D.x, depthClippedEnd2D.y);
                        ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }

            // 使用Bresenham算法在投影图上找到菌毛线段与胶囊体边缘的交点
            const intersections = findLineIntersectionsWithCapsule(start2DLimit, end2DLimit, projectionMap);

            // 新增：在调试画布上标记交点
            intersections.forEach(point => {
                ctx.beginPath();
                ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
                ctx.fill();
            });

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
                        depthInfo: hairInDepthOfField
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
                        depthInfo: hairInDepthOfField
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
                    depthInfo: hairInDepthOfField
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
                    depthInfo: hairInDepthOfField
                });

                const outsideLength = distanceBetween2DPoints(start2D, intersection2D);
                recordHairObservation(observation, outsideLength);
            }
        }
    });

    currentHairObservations.sort((a, b) => a.hairIndex - b.hairIndex);
    return hairSegments;
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
        console.error('批量模拟所需的HTML元素未找到，请检查HTML文件');
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
        progressText.textContent = '准备中...';

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
            progressText.textContent = '正在取消...';
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
        // 保持旋转角度不变
        rotationX: parseFloat(document.getElementById('rotationXValue').value),
        rotationY: parseFloat(document.getElementById('rotationYValue').value),
        rotationZ: parseFloat(document.getElementById('rotationZValue').value)
    };
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
        rotationX: parseFloat(document.getElementById('rotationXValue').value),
        rotationY: parseFloat(document.getElementById('rotationYValue').value),
        rotationZ: parseFloat(document.getElementById('rotationZValue').value)
    };

    // 禁用交互控件
    const controlInputs = document.querySelectorAll('#controls input, #controls button');
    controlInputs.forEach(input => {
        if (input.id !== 'cancelRunningBatch') {
            input.disabled = true;
        }
    });

    // 准备存储所有模拟结果的数组
    const allResults = [];
    let progress = 0;

    try {
        // 循环生成不同的模型（只重新生成菌毛，不改变参数）
        for (let modelIndex = 0; modelIndex < modelCount; modelIndex++) {
            // 检查是否取消
            if (isBatchSimulationCancelled) {
                throw new Error('用户取消了批量模拟');
            }

            // 获取当前参数
            const modelParams = generateRandomModelParams();

            // 应用参数并重新生成菌毛
            applyModelParams(modelParams);

            // 确保菌毛生成后等待足够时间，让currentHairLengths数组被正确填充
            await new Promise(resolve => setTimeout(resolve, 200));

            // 更新进度信息
            progressText.textContent = `正在模拟模型 ${modelIndex + 1}/${modelCount}`;

            // 循环生成不同的姿态角
            for (let angleIndex = 0; angleIndex < angleCount; angleIndex++) {
                // 再次检查是否取消
                if (isBatchSimulationCancelled) {
                    throw new Error('用户取消了批量模拟');
                }

                // 为每个姿态随机生成角度
                const angleParams = generateRandomAngles();

                // 应用随机角度到UI和模型
                applyAngleParams(angleParams);

                // 等待一小段时间，确保模型和视图更新完成，投影菌毛长度数组被正确填充
                await new Promise(resolve => setTimeout(resolve, 200));

                // 收集当前模型和姿态下的数据
                const result = collectSimulationData(modelIndex, angleIndex, modelParams, angleParams);
                allResults.push(result);

                // 更新进度条
                progress++;
                progressBar.value = progress;
                progressText.textContent = `模型 ${modelIndex + 1}/${modelCount}, 姿态 ${angleIndex + 1}/${angleCount}`;

                // 让UI有时间更新
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        // 导出所有结果到Excel
        if (allResults.length > 0) {
            exportBatchResultsToExcel(allResults);
            progressText.textContent = '批量模拟完成！结果已导出到Excel文件。';
        } else {
            progressText.textContent = '批量模拟完成，但没有收集到数据。';
        }
    } catch (error) {
        console.error('批量模拟过程中发生错误:', error);

        if (error.message === '用户取消了批量模拟') {
            progressText.textContent = '批量模拟已取消。';
        } else {
            progressText.textContent = '批量模拟过程中发生错误，请查看控制台获取详情。';
        }
    } finally {
        // 恢复原始参数
        applyModelParams(originalParams);
        applyAngleParams(originalParams);

        // 恢复交互控件
        controlInputs.forEach(input => {
            input.disabled = false;
        });

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
function generateRandomAngles() {
    return {
        rotationX: Math.round(Math.random() * 360 - 180),
        rotationY: Math.round(Math.random() * 360 - 180),
        rotationZ: Math.round(Math.random() * 360 - 180)
    };
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

    // 创建一个表示当前旋转的四元数
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler(
        THREE.MathUtils.degToRad(params.rotationX),
        THREE.MathUtils.degToRad(params.rotationY),
        THREE.MathUtils.degToRad(params.rotationZ),
        'XYZ'
    );
    quaternion.setFromEuler(euler);

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
        console.error('收集模拟数据时发生错误:', error);
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
        const modelParamsRows = [
            ['模型ID', '高度', '半径', '菌毛数量', '平均菌毛长度', '形状参数', '景深范围', '焦点距离']
        ];

        // 创建姿态角工作表
        const angleParamsRows = [
            ['模型ID', '姿态ID', 'X轴旋转', 'Y轴旋转', 'Z轴旋转']
        ];

        // 创建统计数据工作表
        const statsRows = [
            ['模型ID', '姿态ID', '菌毛总数', '可见菌毛数', '可见比例', '平均外伸长度', '最小外伸长度', '最大外伸长度']
        ];

        const trueLengthRows = [
            ['模型ID', '菌毛序号', '菌毛ID', '真实长度']
        ];

        const observationRows = [
            ['模型ID', '姿态ID', '菌毛序号', '观测ID', '真实长度', '投影长度', '是否可见']
        ];

        const notesRows = [
            ['项目', '说明'],
            ['可见判定', `焦深内轮廓外伸投影长度 ≥ ${VISIBLE_PROJECTION_LENGTH_THRESHOLD}（与模型长度单位相同）`],
            ['真实菌毛长度表', '每个模型的每根菌毛只出现一行，用于真长分布统计'],
            ['菌毛观测数据表', '每个姿态一行；同一根菌毛的真实长度会随姿态重复出现，仅用于与该姿态的投影长度配对'],
            ['真长分布图', '只使用真实菌毛长度表，不把各姿态的重复真长当作独立样本']
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
                    result.modelParams.height.toFixed(2),
                    result.modelParams.radius.toFixed(2),
                    result.modelParams.hairCount,
                    result.modelParams.meanHairLength.toFixed(2),
                    result.modelParams.shapeParam.toFixed(2),
                    result.depthOfFieldParams.depthOfField.toFixed(2),
                    result.depthOfFieldParams.focusDistance.toFixed(2)
                ]);

                if (result.hairLengths && result.hairLengths.length > 0) {
                    result.hairLengths.forEach((length, index) => {
                        const hairIdStr = (index + 1).toString().padStart(2, '0');
                        trueLengthRows.push([
                            modelId,
                            index + 1,
                            `${modelIdStr}-${hairIdStr}`,
                            Number(length).toFixed(3)
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
            const visibleRatio = totalHairs > 0 ? (visibleHairs / totalHairs).toFixed(2) : '0.00';

            statsRows.push([
                modelId,
                angleId,
                totalHairs,
                visibleHairs,
                visibleRatio,
                result.projectionStats.mean.toFixed(2),
                result.projectionStats.min.toFixed(2),
                result.projectionStats.max.toFixed(2)
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
                    Number(item.trueLength).toFixed(3),
                    Number(item.projectionLength).toFixed(3),
                    item.isVisible ? '是' : '否'
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

        XLSX.utils.book_append_sheet(wb, notesWs, '数据说明');
        XLSX.utils.book_append_sheet(wb, modelParamsWs, '模型参数');
        XLSX.utils.book_append_sheet(wb, angleParamsWs, '姿态角参数');
        XLSX.utils.book_append_sheet(wb, statsWs, '统计数据');
        XLSX.utils.book_append_sheet(wb, trueLengthWs, '真实菌毛长度');
        XLSX.utils.book_append_sheet(wb, observationWs, '菌毛观测数据');

        // 为每个模型创建详细数据工作表
        uniqueModels.forEach(modelId => {
            const modelResults = results.filter(r => r.modelIndex === modelId);

            if (modelResults.length > 0) {
                // 创建该模型的详细数据工作表
                const detailRows = [
                    ['姿态ID', 'X轴旋转', 'Y轴旋转', 'Z轴旋转', '可见菌毛数', '平均外伸长度']
                ];

                modelResults.forEach(result => {
                    detailRows.push([
                        result.angleIndex,
                        result.angleParams.rotationX,
                        result.angleParams.rotationY,
                        result.angleParams.rotationZ,
                        result.projectionStats.count,
                        result.projectionStats.mean.toFixed(2)
                    ]);
                });

                const detailWs = XLSX.utils.aoa_to_sheet(detailRows);
                XLSX.utils.book_append_sheet(wb, detailWs, `模型${modelId}详细数据`);
            }
        });

        // 生成Excel文件并下载
        const now = new Date();
        const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;

        XLSX.writeFile(wb, `胶囊细菌批量模拟数据_${timestamp}.xlsx`);

        // 新增：绘制并保存全局分布图
        generateAndSaveDistributionCharts(results, timestamp);

        return true;
    } catch (error) {
        console.error('导出Excel文件时发生错误:', error);
        alert('导出Excel文件时发生错误，请查看控制台获取详情。');
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
            saveDistributionChart(allHairLengths, '真实菌毛长度分布', timestamp);
        }

        if (allProjectionLengths.length > 0) {
            saveDistributionChart(allProjectionLengths, '投影菌毛长度分布', timestamp);
        }
        
        // 新增：如果有可见菌毛数量数据，绘制并保存分布图
        if (allVisibleHairCounts.length > 0) {
            saveVisibleHairCountChart(allVisibleHairCounts, '可见菌毛数量分布', timestamp);
        }
    } catch (error) {
        console.error('生成分布图时发生错误:', error);
    }
}

// 新增函数：保存可见菌毛数量分布图
function saveVisibleHairCountChart(data, title, timestamp) {
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
                    text: `平均值: ${mean.toFixed(1)}, 中位数: ${median.toFixed(1)}, 标准差: ${stdDev.toFixed(1)}`,
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
                        text: '百分比 (%)',
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
                        text: '可见菌毛数量',
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
            a.download = `可见菌毛数量分布_${timestamp}.png`;
            a.click();

            // 清理
            document.body.removeChild(canvas);
            chart.destroy();
        } catch (error) {
            console.error('保存可见菌毛数量分布图时发生错误:', error);
        }
    }, 500);  // 给Chart.js足够的时间渲染
}

// 新增函数：保存分布图
function saveDistributionChart(data, title, timestamp) {
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
                    text: `平均值: ${mean.toFixed(2)}, 中位数: ${median.toFixed(2)}, 标准差: ${stdDev.toFixed(2)}`,
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
                        text: '长度',
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
                        text: '频率 (%)',  // 修改Y轴标题为频率
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
            const chartType = title.includes('真实') ? '真实长度' : '投影长度';
            a.href = url;
            a.download = `胶囊细菌${chartType}分布图_${timestamp}.png`;
            a.click();

            // 清理
            document.body.removeChild(canvas);
            chart.destroy();
        } catch (error) {
            console.error('保存图表图片时发生错误:', error);
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

    return projectionMap[y][x] === 1;
}

// 辅助函数：计算两个2D点之间的距离
function distanceBetween2DPoints(p1, p2) {
    const pixelDistance = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

    // 将像素距离转换为实际长度
    // 基于正交相机的视锥体宽度和渲染目标的宽度计算比例
    const pixelToWorldRatio = (projectionCamera.right - projectionCamera.left) / 512;

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
        const currentState = (projectionMap[y0][x0] === 1);

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

// 修改 addFluorescenceLegend 函数，添加景深范围外标记的图例
function addFluorescenceLegend(scene) {
    // 首先清除场景中可能存在的旧图例对象
    for (let i = scene.children.length - 1; i >= 0; i--) {
        const child = scene.children[i];
        // 通过位置或材质颜色识别图例元素
        if (child instanceof THREE.Mesh &&
            child.material &&
            child.material.color &&
            child.material.color.getHex() === 0x222222) {
            scene.remove(child);
        } else if (child instanceof THREE.Line &&
            (child.material.color.getHex() === 0x88cc88 ||
                child.material.color.getHex() === 0xffcc00 ||
                child.material.color.getHex() === 0x00ff00 ||
                child.material.color.getHex() === 0xff0000)) {
            // 检查线段的位置是否在图例区域
            const positions = child.geometry.attributes.position.array;
            const x = positions[0];
            if (x > 0.3) { // 图例在右侧
                scene.remove(child);
            }
        }
    }

    // 添加文字标签 - 使用HTML叠加层
    const fluorescenceCanvas = document.getElementById('fluorescenceCanvas');
    if (fluorescenceCanvas) {
        // 移除旧的图例文字（如果存在）
        const oldLegend = document.getElementById('fluorescenceLegendText');
        if (oldLegend) {
            oldLegend.remove();
        }

        const legendDiv = document.createElement('div');
        legendDiv.id = 'fluorescenceLegendText';
        legendDiv.style.position = 'absolute';
        legendDiv.style.bottom = '5px';
        legendDiv.style.right = '5px';
        legendDiv.style.color = 'white';
        legendDiv.style.fontSize = '10px';
        legendDiv.style.fontFamily = 'Arial, sans-serif';
        legendDiv.style.textShadow = '1px 1px 1px black';
        legendDiv.style.pointerEvents = 'none'; // 防止干扰鼠标事件
        legendDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        legendDiv.style.padding = '5px';
        legendDiv.style.borderRadius = '3px';
        legendDiv.innerHTML = `
            <div style="margin-bottom:4px;"><span style="display:inline-block;width:12px;height:2px;background-color:#88cc88;margin-right:5px;"></span>胶囊体</div>
            <div style="margin-bottom:4px;"><span style="display:inline-block;width:12px;height:2px;background-color:#ffcc00;margin-right:5px;"></span>菌毛内部段</div>
            <div style="margin-bottom:4px;"><span style="display:inline-block;width:12px;height:2px;background-color:#00ff00;margin-right:5px;"></span>菌毛外伸段</div>
            <div><span style="display:inline-block;width:12px;height:2px;background-color:#ff0000;margin-right:5px;border-top:1px dashed #ff0000;"></span>景深范围外</div>
        `;
        fluorescenceCanvas.appendChild(legendDiv);
    }
}

// ================ 控制函数 ================
// 尺寸控制
function setupSizeControls() {
    const heightSlider = document.getElementById('height');
    const heightInput = document.getElementById('heightValue');
    const radiusSlider = document.getElementById('radius');
    const radiusInput = document.getElementById('radiusValue');

    heightSlider.addEventListener('input', () => {
        heightInput.value = heightSlider.value;
        updateCapsule();
    });

    heightInput.addEventListener('change', () => {
        let value = parseFloat(heightInput.value);
        value = Math.max(1, Math.min(5, value));
        heightSlider.value = value;
        heightInput.value = value;
        updateCapsule();
    });

    radiusSlider.addEventListener('input', () => {
        radiusInput.value = radiusSlider.value;
        updateCapsule();
    });

    radiusInput.addEventListener('change', () => {
        let value = parseFloat(radiusInput.value);
        value = Math.max(0.1, Math.min(1, value));
        radiusSlider.value = value;
        radiusInput.value = value;
        updateCapsule();
    });
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
        depthOfFieldSlider.value = this.value;
        depthOfField = parseFloat(this.value);
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
        focusDistanceSlider.value = this.value;
        focusDistance = parseFloat(this.value);
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
            this.textContent = '隐藏';
            sideViewVisible = true;
            updateSideView();
        } else {
            sideView.style.display = 'none';
            this.textContent = '隐藏';
            sideViewVisible = false;
        }
    });
}

// 修改 setupRotationControls 函数中的旋转处理
function setupRotationControls() {
    const axes = ['X', 'Y', 'Z'];

    // 创建一个四元数来存储当前旋转状态
    let currentQuaternion = new THREE.Quaternion();

    const resetButton = document.getElementById('resetRotation');
    resetButton.addEventListener('click', () => {
        // 重置四元数为单位四元数（无旋转）
        currentQuaternion.set(0, 0, 0, 1);

        // 更新UI显示
        axes.forEach(axis => {
            const slider = document.getElementById(`rotation${axis}`);
            const input = document.getElementById(`rotation${axis}Value`);
            slider.value = 0;
            input.value = 0;
        });

        // 应用四元数到胶囊
        capsule.quaternion.copy(currentQuaternion);

        // 重置旋转时更新所有视图
        updateProjectionView();

        // 新增：如果侧面视图可见，更新侧面视图
        if (sideViewVisible) {
            updateSideView();
        }
    });

    // 创建防抖版本的投影视图更新函数
    const debouncedUpdateProjectionView = debounce(updateProjectionView, 100);
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

            // 创建一个表示当前轴旋转的四元数
            const axisQuaternion = new THREE.Quaternion();
            const axisVector = new THREE.Vector3();

            // 设置旋转轴
            if (axis === 'X') axisVector.set(1, 0, 0);
            else if (axis === 'Y') axisVector.set(0, 1, 0);
            else if (axis === 'Z') axisVector.set(0, 0, 1);

            // 设置旋转角度（弧度）
            axisQuaternion.setFromAxisAngle(axisVector, THREE.MathUtils.degToRad(value));

            // 从当前欧拉角重建基础四元数
            const eulerAngles = new THREE.Euler();
            axes.forEach(a => {
                if (a !== axis) {
                    const val = parseFloat(document.getElementById(`rotation${a}Value`).value);
                    eulerAngles[a.toLowerCase()] = THREE.MathUtils.degToRad(val);
                }
            });

            // 从欧拉角创建基础四元数
            const baseQuaternion = new THREE.Quaternion().setFromEuler(eulerAngles);

            // 应用当前轴的旋转
            currentQuaternion = axisQuaternion.multiply(baseQuaternion);

            // 应用四元数到胶囊
            capsule.quaternion.copy(currentQuaternion);

            // 实时更新主视图
            renderer.render(scene, camera);

            // 使用防抖函数更新投影视图，减少渲染频率
            debouncedUpdateProjectionView();

            // 新增：使用防抖函数更新侧面视图
            debouncedUpdateSideView();
        });

        input.addEventListener('change', () => {
            let value = parseFloat(input.value);
            value = Math.max(-180, Math.min(180, value));
            slider.value = value;
            input.value = value;

            // 创建一个表示当前轴旋转的四元数
            const axisQuaternion = new THREE.Quaternion();
            const axisVector = new THREE.Vector3();

            // 设置旋转轴
            if (axis === 'X') axisVector.set(1, 0, 0);
            else if (axis === 'Y') axisVector.set(0, 1, 0);
            else if (axis === 'Z') axisVector.set(0, 0, 1);

            // 设置旋转角度（弧度）
            axisQuaternion.setFromAxisAngle(axisVector, THREE.MathUtils.degToRad(value));

            // 从当前欧拉角重建基础四元数
            const eulerAngles = new THREE.Euler();
            axes.forEach(a => {
                if (a !== axis) {
                    const val = parseFloat(document.getElementById(`rotation${a}Value`).value);
                    eulerAngles[a.toLowerCase()] = THREE.MathUtils.degToRad(val);
                }
            });

            // 从欧拉角创建基础四元数
            const baseQuaternion = new THREE.Quaternion().setFromEuler(eulerAngles);

            // 应用当前轴的旋转
            currentQuaternion = axisQuaternion.multiply(baseQuaternion);

            // 应用四元数到胶囊
            capsule.quaternion.copy(currentQuaternion);

            // 输入值变化时更新所有视图
            if (camera.userData.lastCapsuleRotation) {
                camera.userData.lastCapsuleRotation.copy(capsule.quaternion);
            }

            // 如果侧面视图可见，更新侧面视图
            if (sideViewVisible) {
                updateSideView();
            }
            // 更新投影视图
            updateProjectionView();
        });
    });
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
        let value = parseInt(hairCountInput.value);
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
        let value = parseFloat(hairLengthInput.value);
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
        let value = parseFloat(shapeParamInput.value);
        value = Math.max(0.5, Math.min(10, value));
        shapeParamSlider.value = value;
        shapeParamInput.value = value;
        // 删除对伽马分布图的更新
    });

    // 重新生成菌毛按钮
    regenerateButton.addEventListener('click', () => {
        updateCapsule();  // 这里会触发直方图的更新
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
                rotationX: parseFloat(document.getElementById('rotationXValue').value),
                rotationY: parseFloat(document.getElementById('rotationYValue').value),
                rotationZ: parseFloat(document.getElementById('rotationZValue').value)
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
    link.download = `胶囊细菌模型数据_${timestamp}.json`;
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
            ['参数', '值'],
            ['长轴长度', data.modelParameters.height],
            ['半径', data.modelParameters.radius],
            ['菌毛数量', data.modelParameters.hairCount],
            ['平均长度', data.modelParameters.meanHairLength],
            ['形状参数', data.modelParameters.shapeParam],
            ['X轴旋转', data.modelParameters.rotationX],
            ['Y轴旋转', data.modelParameters.rotationY],
            ['Z轴旋转', data.modelParameters.rotationZ]
        ];

        const paramWs = XLSX.utils.aoa_to_sheet(paramRows);
        XLSX.utils.book_append_sheet(wb, paramWs, '模型参数');
    }

    // 添加菌毛真实长度工作表
    if (data.hairLengths && data.hairLengths.length > 0) {
        const hairRows = [['序号', '菌毛长度']];
        data.hairLengths.forEach((length, index) => {
            hairRows.push([index + 1, length]);
        });

        const hairWs = XLSX.utils.aoa_to_sheet(hairRows);
        XLSX.utils.book_append_sheet(wb, hairWs, '菌毛真实长度');
    }

    if (data.hairObservations && data.hairObservations.length > 0) {
        const pairedRows = [
            ['菌毛序号', '真实长度', '投影长度', '是否可见']
        ];
        data.hairObservations.forEach((item) => {
            pairedRows.push([
                item.hairIndex + 1,
                Number(item.trueLength).toFixed(3),
                Number(item.projectionLength).toFixed(3),
                item.isVisible ? '是' : '否'
            ]);
        });
        const pairedWs = XLSX.utils.aoa_to_sheet(pairedRows);
        XLSX.utils.book_append_sheet(wb, pairedWs, '菌毛逐根对照');
    }

    // 添加投影菌毛长度工作表
    if (data.projectionHairLengths && data.projectionHairLengths.length > 0) {
        const projRows = [['序号', '投影菌毛外伸长度']];
        data.projectionHairLengths.forEach((length, index) => {
            projRows.push([index + 1, length]);
        });

        const projWs = XLSX.utils.aoa_to_sheet(projRows);
        XLSX.utils.book_append_sheet(wb, projWs, '投影菌毛长度');
    }

    // 添加统计数据工作表
    const statsWs = XLSX.utils.aoa_to_sheet([
        ['统计数据', '菌毛真实长度', '投影菌毛外伸长度'],
        ['数量', data.hairLengths ? data.hairLengths.length : 0, data.projectionHairLengths ? data.projectionHairLengths.length : 0],
        ['最小值', data.hairLengths ? Math.min(...data.hairLengths).toFixed(2) : 'N/A', data.projectionHairLengths && data.projectionHairLengths.length > 0 ? Math.min(...data.projectionHairLengths).toFixed(2) : 'N/A'],
        ['最大值', data.hairLengths ? Math.max(...data.hairLengths).toFixed(2) : 'N/A', data.projectionHairLengths && data.projectionHairLengths.length > 0 ? Math.max(...data.projectionHairLengths).toFixed(2) : 'N/A'],
        ['平均值', data.hairLengths ? (data.hairLengths.reduce((a, b) => a + b, 0) / data.hairLengths.length).toFixed(2) : 'N/A',
            data.projectionHairLengths && data.projectionHairLengths.length > 0 ? (data.projectionHairLengths.reduce((a, b) => a + b, 0) / data.projectionHairLengths.length).toFixed(2) : 'N/A']
    ]);
    XLSX.utils.book_append_sheet(wb, statsWs, '统计数据');

    // 生成Excel文件并下载
    const now = new Date();
    const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;

    XLSX.writeFile(wb, `胶囊细菌模型数据_${timestamp}.xlsx`);
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

// 初始化投影视图和荧光视图
// 确保在初始化时就创建投影视图和荧光视图
updateProjectionView();

// 修改 animate 函数中的旋转跟踪部分
function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // 检查相机位置或旋转是否发生变化
    if (!camera.userData.lastPosition) {
        camera.userData.lastPosition = new THREE.Vector3();
        camera.userData.lastQuaternion = new THREE.Quaternion();
        camera.userData.lastCapsuleQuaternion = new THREE.Quaternion();
    }

    // 如果相机位置、旋转或胶囊旋转发生变化，更新投影视图
    if (!camera.position.equals(camera.userData.lastPosition) ||
        !camera.quaternion.equals(camera.userData.lastQuaternion) ||
        !capsule.quaternion.equals(camera.userData.lastCapsuleQuaternion)) {

        camera.userData.lastPosition.copy(camera.position);
        camera.userData.lastQuaternion.copy(camera.quaternion);
        camera.userData.lastCapsuleQuaternion.copy(capsule.quaternion);

        // 如果侧面视图可见，更新侧面视图
        if (sideViewVisible) {
            sideViewRenderer.render(sideViewScene, sideViewCamera);
            updateDepthLabelsPosition();
        }

        // 更新投影视图
        updateProjectionView();
    }

    renderer.render(scene, camera);
}

// 开始动画循环
animate();

// 窗口大小调整
window.addEventListener('resize', () => {
    // 更新主视图
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 更新投影视图
    updateProjectionView();

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
            console.error('调整毛发长度图表大小时出错:', e);
        }
    }
    if (projectionHairLengthChart && typeof projectionHairLengthChart.resize === 'function') {
        try {
            projectionHairLengthChart.resize();
        } catch (e) {
            console.error('调整投影菌毛长度图表大小时出错:', e);
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
        console.warn('投影统计视图容器不存在，请检查HTML');
    }

    // 检查投影画布是否存在
    const projectionCanvas = document.getElementById('projectionCanvas');
    if (!projectionCanvas) {
        console.warn('投影画布容器不存在，请检查HTML');
    }

    // 初始更新投影视图
    updateProjectionView();
});