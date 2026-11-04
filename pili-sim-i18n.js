/*
 * pili-sim-i18n.js - UI language support (Chinese / English) for the capsule bacterium pili simulation.
 *
 * Author: Lucien
 * Date: 2026-11-04
 *
 * Classic script (no ES modules) so that the page keeps working when pili-sim.html is opened by double-click.
 * Usage:
 *   tr('key', { name: value })   translate a key in the current language, {name} placeholders are replaced
 *   getLanguage() / setLanguage('zh' | 'en')
 *   onLanguageChange(callback)   register a callback that runs after every language change
 * Static markup is translated through attributes: data-i18n (text), data-i18n-title (tooltip).
 */

const LANGUAGE_STORAGE_KEY = 'pili-sim-language';

const I18N_STRINGS = {
    zh: {
        'app.title': '3D胶囊形细菌模型',

        // Control panel
        'sec.size': '菌身尺寸',
        'lbl.height': '胶囊高度:',
        'lbl.radius': '半球半径:',
        'sec.dof': '景深设置',
        'lbl.dofRange': '景深范围:',
        'lbl.focus': '焦点距离:',
        'btn.showSideView': '显示景深侧面视图',
        'sec.rotation': '旋转控制',
        'lbl.rotX': 'X轴旋转:',
        'lbl.rotY': 'Y轴旋转:',
        'lbl.rotZ': 'Z轴旋转:',
        'btn.resetRotation': '复原姿态',
        'sec.pili': '菌毛控制',
        'lbl.count': '菌毛数量:',
        'lbl.meanLength': '平均长度:',
        'lbl.concentration': '集中度:',
        'lbl.anchorMode': '固着点分配:',
        'opt.anchorFixed': '固定比例（实验观测）',
        'opt.anchorArea': '按表面积自适应',
        'lbl.cylinderShare': '圆柱占比:',
        'btn.regenerate': '重新生成菌毛',

        // Views and buttons
        'view.side': '景深侧面视图',
        'btn.hide': '隐藏',
        'view.fluorescence': '荧光视图',
        'view.analysis': '投影分析视图',
        'btn.toAnalysis': '切换分析视图',
        'btn.toFluorescence': '切换荧光视图',
        'view.trueLength': '菌毛真实长度分布',
        'view.projLength': '菌毛投影长度分布',
        'btn.export': '导出',
        'btn.batch': '批量模拟',
        'btn.help': '帮助',
        'btn.lang': 'English',
        'btn.langTitle': 'Switch to English',
        'btn.cancel': '取消',

        // Dialogs
        'batch.title': '批量模拟设置',
        'batch.desc': '系统将使用当前参数多次重新生成菌毛，并在不同姿态下进行分析。',
        'batch.modelCount': '模型数量:',
        'batch.angleCount': '每个模型的姿态数:',
        'batch.stop': '停止模拟',
        'batch.start': '开始模拟',
        'batch.preparing': '准备中...',
        'batch.cancelling': '正在取消...',
        'batch.model': '正在模拟模型 {model}/{models}',
        'batch.progress': '模型 {model}/{models}, 姿态 {pose}/{poses}',
        'batch.done': '批量模拟完成！结果已导出到Excel文件。',
        'batch.noData': '批量模拟完成，但没有收集到数据。',
        'batch.cancelled': '批量模拟已取消。',
        'batch.error': '批量模拟过程中发生错误，请查看控制台获取详情。',
        'help.title': '3D胶囊形细菌模型使用帮助',
        'export.title': '导出选项',
        'export.modelParams': '模型参数',
        'export.trueLengths': '菌毛真实长度数据',
        'export.projLengths': '菌毛投影长度数据',
        'export.format': '导出格式:',

        // Charts and statistics
        'chart.trueLength.label': '菌毛长度分布',
        'chart.projLength.label': '投影菌毛外伸长度分布',
        'chart.axis.length': '长度',
        'chart.axis.frequency': '频率',
        'chart.tooltip.frequency': '频率: {value}',
        'stats.none': '<strong>投影菌毛统计:</strong> 没有符合条件的菌毛外伸出胶囊投影区域（忽略长度&lt;{threshold}）',
        'stats.result': '<strong>统计结果:</strong> 共有 {count} 根菌毛可见(≥{threshold}) | ',
        'stats.noneInView': '<strong>统计结果:</strong> 当前视角下没有菌毛外伸出胶囊表面',
        'legend.body': '胶囊体',
        'legend.visible': '可见菌毛段',
        'legend.inside': '与胞体重叠的菌毛段',
        'legend.outside': '外伸菌毛段（景深内）',
        'legend.outOfDepth': '景深范围外的菌毛段',
        'legend.intersection': '菌毛与胞体边缘交点',
        'gizmo.tip': '菌体自身的 X / Y / Z 轴在当前视角下的朝向（Y 为长轴；实线端带字母的一端为正方向，淡色短线为负方向）',
        'anchor.fixed': '固定比例',
        'anchor.area': '按表面积',
        'anchor.ratio': '{mode}：圆柱 {cylinder}% / 半球 {caps}% {note}',
        'anchor.noCylinder': '（无圆柱段，全部在半球上）',

        // Saved chart images
        'img.title.true': '真实菌毛长度分布',
        'img.title.proj': '投影菌毛长度分布',
        'img.title.visible': '可见菌毛数量分布',
        'img.subtitle': '平均值: {mean}, 中位数: {median}, 标准差: {sd}',
        'img.axis.length': '长度',
        'img.axis.frequency': '频率 (%)',
        'img.axis.percent': '百分比 (%)',
        'img.axis.visibleCount': '可见菌毛数量',

        // File names (without time stamp and extension)
        'file.batchData': '胶囊细菌批量模拟数据',
        'file.modelData': '胶囊细菌模型数据',
        'file.visibleCount': '可见菌毛数量分布',
        'file.trueDist': '胶囊细菌真实长度分布图',
        'file.projDist': '胶囊细菌投影长度分布图',

        // Excel: sheet names
        'sheet.notes': '数据说明',
        'sheet.modelParams': '模型参数',
        'sheet.poseAngles': '姿态角参数',
        'sheet.stats': '统计数据',
        'sheet.trueLengths': '真实菌毛长度',
        'sheet.observations': '菌毛观测数据',
        'sheet.modelDetail': '模型{id}详细数据',
        'sheet.pairing': '菌毛逐根对照',
        'sheet.projLengths': '投影菌毛长度',

        // Excel: headers and cells
        'col.modelId': '模型ID',
        'col.height': '高度',
        'col.radius': '半径',
        'col.hairCount': '菌毛数量',
        'col.meanLength': '平均菌毛长度',
        'col.concentration': '集中度(k)',
        'col.dofRange': '景深范围',
        'col.focus': '焦点距离',
        'col.anchorMode': '固着点分配',
        'col.cylinderShare': '圆柱占比(%)',
        'col.poseId': '姿态ID',
        'col.rotX': 'X轴旋转',
        'col.rotY': 'Y轴旋转',
        'col.rotZ': 'Z轴旋转',
        'col.totalPili': '菌毛总数',
        'col.visiblePili': '可见菌毛数',
        'col.visibleFraction': '可见比例',
        'col.meanOutside': '平均外伸长度',
        'col.minOutside': '最小外伸长度',
        'col.maxOutside': '最大外伸长度',
        'col.hairNo': '菌毛序号',
        'col.hairId': '菌毛ID',
        'col.trueLength': '真实长度',
        'col.observationId': '观测ID',
        'col.projLength': '投影长度',
        'col.visible': '是否可见',
        'col.yes': '是',
        'col.no': '否',
        'col.item': '项目',
        'col.description': '说明',
        'col.parameter': '参数',
        'col.value': '值',
        'col.axisLength': '长轴长度',
        'col.meanHairLength': '平均长度',
        'col.rotationConvention': '旋转约定',
        'col.seq': '序号',
        'col.hairLength': '菌毛长度',
        'col.projOutsideLength': '投影菌毛外伸长度',
        'col.statistic': '统计数据',
        'col.trueHairLength': '菌毛真实长度',
        'col.n': '数量',
        'col.min': '最小值',
        'col.max': '最大值',
        'col.mean': '平均值',

        // Excel: notes sheet
        'note.visible.key': '可见判定',
        'note.visible.text': '焦深内轮廓外伸投影长度 ≥ {threshold}（与模型长度单位相同）',
        'note.trueSheet.key': '真实菌毛长度表',
        'note.trueSheet.text': '每个模型的每根菌毛只出现一行，用于真长分布统计',
        'note.obsSheet.key': '菌毛观测数据表',
        'note.obsSheet.text': '每个姿态一行；同一根菌毛的真实长度会随姿态重复出现，仅用于与该姿态的投影长度配对',
        'note.trueDist.key': '真长分布图',
        'note.trueDist.text': '只使用真实菌毛长度表，不把各姿态的重复真长当作独立样本',
        'note.anchor.key': '固着点分配',
        'note.anchor.text': '“固定比例”为用户设定的圆柱/半球占比（默认 55% / 45%），“按表面积”为按两部分表面积比例；模型参数表记录各模型实际使用的圆柱占比',
        'note.pose.key': '姿态抽样',
        'note.pose.text': '每个姿态为 SO(3) 上均匀随机取向（均匀单位四元数）；表中旋转角为 XYZ 欧拉角（度）；手动旋转控件使用同一约定，把表中角度填入控件即可复现该姿态',
        'note.length.key': '长度换算',
        'note.length.text': '投影长度按正交相机可视宽度 (right-left)/zoom 换算为模型长度单位',

        'alert.excelError': '导出Excel文件时发生错误，请查看控制台获取详情。'
    },

    en: {
        'app.title': '3D Capsule Bacterium Model',

        // Control panel
        'sec.size': 'Cell Size',
        'lbl.height': 'Height:',
        'lbl.radius': 'Radius:',
        'sec.dof': 'Depth of Field',
        'lbl.dofRange': 'DoF range:',
        'lbl.focus': 'Focus dist.:',
        'btn.showSideView': 'Show DoF side view',
        'sec.rotation': 'Rotation',
        'lbl.rotX': 'X rotation:',
        'lbl.rotY': 'Y rotation:',
        'lbl.rotZ': 'Z rotation:',
        'btn.resetRotation': 'Reset pose',
        'sec.pili': 'Pili Control',
        'lbl.count': 'Pili count:',
        'lbl.meanLength': 'Mean length:',
        'lbl.concentration': 'Concentration:',
        'lbl.anchorMode': 'Attachment split:',
        'opt.anchorFixed': 'Fixed share (observed)',
        'opt.anchorArea': 'Area-proportional',
        'lbl.cylinderShare': 'Cylinder share:',
        'btn.regenerate': 'Regenerate pili',

        // Views and buttons
        'view.side': 'DoF Side View',
        'btn.hide': 'Hide',
        'view.fluorescence': 'Fluorescence View',
        'view.analysis': 'Projection Analysis View',
        'btn.toAnalysis': 'Switch to analysis view',
        'btn.toFluorescence': 'Switch to fluorescence view',
        'view.trueLength': 'True Pilus Length Distribution',
        'view.projLength': 'Projected Pilus Length Distribution',
        'btn.export': 'Export',
        'btn.batch': 'Batch Simulation',
        'btn.help': 'Help',
        'btn.lang': '中文',
        'btn.langTitle': '切换到中文',
        'btn.cancel': 'Cancel',

        // Dialogs
        'batch.title': 'Batch Simulation Settings',
        'batch.desc': 'The current parameters are used to regenerate the pili several times and analyse each model in different poses.',
        'batch.modelCount': 'Number of models:',
        'batch.angleCount': 'Poses per model:',
        'batch.stop': 'Stop',
        'batch.start': 'Start',
        'batch.preparing': 'Preparing...',
        'batch.cancelling': 'Cancelling...',
        'batch.model': 'Simulating model {model}/{models}',
        'batch.progress': 'Model {model}/{models}, pose {pose}/{poses}',
        'batch.done': 'Batch simulation finished. Results were exported to an Excel file.',
        'batch.noData': 'Batch simulation finished, but no data was collected.',
        'batch.cancelled': 'Batch simulation cancelled.',
        'batch.error': 'An error occurred during the batch simulation. See the console for details.',
        'help.title': '3D Capsule Bacterium Model - Help',
        'export.title': 'Export Options',
        'export.modelParams': 'Model parameters',
        'export.trueLengths': 'True pilus lengths',
        'export.projLengths': 'Projected pilus lengths',
        'export.format': 'Export format:',

        // Charts and statistics
        'chart.trueLength.label': 'Pilus length distribution',
        'chart.projLength.label': 'Protruding projected length distribution',
        'chart.axis.length': 'Length',
        'chart.axis.frequency': 'Frequency',
        'chart.tooltip.frequency': 'Frequency: {value}',
        'stats.none': '<strong>Projected pili:</strong> no pilus protrudes from the capsule projection (lengths &lt; {threshold} ignored)',
        'stats.result': '<strong>Result:</strong> {count} pili visible (≥{threshold}) | ',
        'stats.noneInView': '<strong>Result:</strong> no pilus protrudes from the capsule surface in the current view',
        'legend.body': 'Capsule body',
        'legend.visible': 'Visible pilus segment',
        'legend.inside': 'Pilus part overlapped by the cell',
        'legend.outside': 'Protruding part (in focus)',
        'legend.outOfDepth': 'Pilus part outside depth of field',
        'legend.intersection': 'Pilus / cell-edge intersection',
        'gizmo.tip': "Orientation of the bacterium's own X / Y / Z axes as seen from the camera (Y is the long axis; the lettered solid end is the positive direction, the faint stub is the negative one)",
        'anchor.fixed': 'Fixed share',
        'anchor.area': 'By surface area',
        'anchor.ratio': '{mode}: cylinder {cylinder}% / hemispheres {caps}% {note}',
        'anchor.noCylinder': '(no cylinder segment; all on the hemispheres)',

        // Saved chart images
        'img.title.true': 'True pilus length distribution',
        'img.title.proj': 'Projected pilus length distribution',
        'img.title.visible': 'Visible pili count distribution',
        'img.subtitle': 'Mean: {mean}, Median: {median}, SD: {sd}',
        'img.axis.length': 'Length',
        'img.axis.frequency': 'Frequency (%)',
        'img.axis.percent': 'Percentage (%)',
        'img.axis.visibleCount': 'Visible pili count',

        // File names (without time stamp and extension)
        'file.batchData': 'Capsule_Bacterium_Batch_Simulation',
        'file.modelData': 'Capsule_Bacterium_Model_Data',
        'file.visibleCount': 'Visible_Pili_Count_Distribution',
        'file.trueDist': 'True_Length_Distribution',
        'file.projDist': 'Projected_Length_Distribution',

        // Excel: sheet names (max. 31 characters)
        'sheet.notes': 'Notes',
        'sheet.modelParams': 'Model parameters',
        'sheet.poseAngles': 'Pose angles',
        'sheet.stats': 'Statistics',
        'sheet.trueLengths': 'True pilus lengths',
        'sheet.observations': 'Pilus observations',
        'sheet.modelDetail': 'Model {id} details',
        'sheet.pairing': 'Per-pilus pairing',
        'sheet.projLengths': 'Projected lengths',

        // Excel: headers and cells
        'col.modelId': 'Model ID',
        'col.height': 'Height',
        'col.radius': 'Radius',
        'col.hairCount': 'Pili count',
        'col.meanLength': 'Mean pilus length',
        'col.concentration': 'Concentration (k)',
        'col.dofRange': 'DoF range',
        'col.focus': 'Focus distance',
        'col.anchorMode': 'Attachment split',
        'col.cylinderShare': 'Cylinder share (%)',
        'col.poseId': 'Pose ID',
        'col.rotX': 'X rotation (deg)',
        'col.rotY': 'Y rotation (deg)',
        'col.rotZ': 'Z rotation (deg)',
        'col.totalPili': 'Total pili',
        'col.visiblePili': 'Visible pili',
        'col.visibleFraction': 'Visible fraction',
        'col.meanOutside': 'Mean protruding length',
        'col.minOutside': 'Min protruding length',
        'col.maxOutside': 'Max protruding length',
        'col.hairNo': 'Pilus no.',
        'col.hairId': 'Pilus ID',
        'col.trueLength': 'True length',
        'col.observationId': 'Observation ID',
        'col.projLength': 'Projected length',
        'col.visible': 'Visible',
        'col.yes': 'Yes',
        'col.no': 'No',
        'col.item': 'Item',
        'col.description': 'Description',
        'col.parameter': 'Parameter',
        'col.value': 'Value',
        'col.axisLength': 'Long-axis length',
        'col.meanHairLength': 'Mean length',
        'col.rotationConvention': 'Rotation convention',
        'col.seq': 'No.',
        'col.hairLength': 'Pilus length',
        'col.projOutsideLength': 'Protruding projected length',
        'col.statistic': 'Statistic',
        'col.trueHairLength': 'True pilus length',
        'col.n': 'Count',
        'col.min': 'Min',
        'col.max': 'Max',
        'col.mean': 'Mean',

        // Excel: notes sheet
        'note.visible.key': 'Visibility rule',
        'note.visible.text': 'Projected length protruding from the outline inside the depth of field >= {threshold} (same unit as the model length)',
        'note.trueSheet.key': 'True pilus lengths sheet',
        'note.trueSheet.text': 'Every pilus of every model appears in exactly one row; used for the true-length distribution',
        'note.obsSheet.key': 'Pilus observations sheet',
        'note.obsSheet.text': 'One row per pilus and pose; the true length of the same pilus repeats across poses and is only used to pair it with its projected length in that pose',
        'note.trueDist.key': 'True-length distribution',
        'note.trueDist.text': 'Uses the true pilus lengths sheet only; repeated true lengths across poses are not treated as independent samples',
        'note.anchor.key': 'Attachment split',
        'note.anchor.text': '"Fixed share" is the user-defined cylinder/hemisphere share (default 55% / 45%); "By surface area" splits in proportion to the two surface areas; the model parameter sheet records the cylinder share actually used for each model',
        'note.pose.key': 'Pose sampling',
        'note.pose.text': 'Every pose is a uniformly random orientation on SO(3) (uniform unit quaternion); the angles are XYZ Euler angles (degrees); the manual rotation controls use the same convention, so entering these angles reproduces the pose',
        'note.length.key': 'Length conversion',
        'note.length.text': 'Projected lengths are converted to model length units using the orthographic camera width (right-left)/zoom',

        'alert.excelError': 'An error occurred while exporting the Excel file. See the console for details.'
    }
};

const languageChangeCallbacks = [];

function detectInitialLanguage() {
    try {
        const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (stored === 'zh' || stored === 'en') {
            return stored;
        }
    } catch (error) {
        // localStorage may be unavailable (privacy mode); fall through to the browser language
    }
    const browserLanguage = (navigator.language || 'en').toLowerCase();
    return browserLanguage.startsWith('zh') ? 'zh' : 'en';
}

let currentLanguage = detectInitialLanguage();

function getLanguage() {
    return currentLanguage;
}

// Translate a key in the current language; falls back to English, then to the key itself
function tr(key, params) {
    const table = I18N_STRINGS[currentLanguage] || I18N_STRINGS.en;
    let text = table[key];
    if (text === undefined) {
        text = I18N_STRINGS.en[key];
    }
    if (text === undefined) {
        return key;
    }
    if (params) {
        text = text.replace(/\{(\w+)\}/g, (match, name) =>
            (params[name] !== undefined ? String(params[name]) : match));
    }
    return text;
}

function onLanguageChange(callback) {
    languageChangeCallbacks.push(callback);
}

// Translate all static markup that carries data-i18n / data-i18n-title attributes
function applyStaticTranslations() {
    document.documentElement.lang = currentLanguage === 'en' ? 'en' : 'zh-CN';
    document.title = tr('app.title');
    document.querySelectorAll('[data-i18n]').forEach((element) => {
        element.textContent = tr(element.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach((element) => {
        element.title = tr(element.getAttribute('data-i18n-title'));
    });
}

function setLanguage(language) {
    if (language !== 'zh' && language !== 'en') {
        return;
    }
    currentLanguage = language;
    try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch (error) {
        // not persisted; the choice still applies to this session
    }
    applyStaticTranslations();
    languageChangeCallbacks.forEach((callback) => {
        try {
            callback(language);
        } catch (error) {
            console.error('Language change callback failed:', error);
        }
    });
}

applyStaticTranslations();

const languageButton = document.getElementById('langBtn');
if (languageButton) {
    languageButton.addEventListener('click', () => {
        setLanguage(currentLanguage === 'zh' ? 'en' : 'zh');
    });
}
