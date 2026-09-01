//文件存储 API 的入口
const { storage } = require("uxp");
//Photoshop 本体 历史记录、事件 枚举常量
const { app, constants, action } = require("photoshop");
//方便调用本地文件api
const localFileSystem = storage.localFileSystem;

// ---------- 配置常量 ----------
const EFFECT_GROUP_NAME = "HALO68 Effect";
//临时光环文件位置
const HALO_RESOURCE_PATH = "resources/IBUKI.png";
//临时混合模式 = 屏幕（Screen）、不透明度 = 55%、高斯模糊半径 = 18px
const GLOW = {
  blendMode: constants.BlendMode.SCREEN, //滤色
  opacity: 55,
  blurRadius: 18,
};
//组内固定图层名（上→下），集中一处，避免各文件手写字符串对不上
const LAYER_NAMES = {
  subject: "Subject",
  glow: "Halo Glow",
  halo: "Halo",
  background: "Background",
};
//这些名字只可能由插件生成；用户若选中它们当"原图"，说明是上一轮的残留
const GENERATED_LAYER_NAMES = [
  LAYER_NAMES.subject,
  LAYER_NAMES.glow,
  LAYER_NAMES.halo,
];

async function importHaloIntoGroup(haloFile, targetDocument) {
  //目标文档设为活动文档
  await runBatch(
    [
      {
        _obj: "select",
        _target: [{ _ref: "document", _id: targetDocument.id }],
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    "切换活动文档",
  );

  // session token 指向插件内置 PNG
  const token = await localFileSystem.createSessionToken(haloFile);

  // 3) 置入 → 智能对象图层（活动图层），直接落在文档顶层
  await runBatch(
    [
      {
        _obj: "placeEvent",
        null: { _kind: "local", _path: token },
        freeTransformCenterState: {
          _enum: "quadCenterState",
          _value: "QCSAverage",
        },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: 0 },
          vertical: { _unit: "pixelsUnit", _value: 0 },
        },
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    "置入光环",
  );

  // 4) 栅格化为普通像素层（坑 12）+ 改名
  const placedLayer = targetDocument.activeLayers[0];
  if (!placedLayer) {
    throw new Error("光环置入失败");
  }
  await runBatch(
    [
      {
        _obj: "rasterizeLayer",
        _target: [{ _ref: "layer", _id: placedLayer.id }],
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    "栅格化光环",
  );
  placedLayer.name = LAYER_NAMES.halo;

  return placedLayer;
}

//临时放置初始位置
async function fitHaloToCanvas(haloLayer, targetDocument) {
  const initialBounds = haloLayer.boundsNoEffects;
  if (!initialBounds || initialBounds.height <= 0 || initialBounds.width <= 0) {
    throw new Error("光环图层为空");
  }

  const desiredWidth = targetDocument.width * 0.36;
  //大小上下限限制
  const scalePercent = Math.min(
    250,
    Math.max(5, (desiredWidth / initialBounds.width) * 100),
  );
  //缩放 100% 等于没变化，PS 会把它当成无效的"变换"命令而报错，跳过
  if (Math.abs(scalePercent - 100) > 0.01) {
    await haloLayer.scale(
      //水平和垂直缩放比例
      scalePercent,
      scalePercent,
      //图层中心为锚点
      constants.AnchorPosition.MIDDLECENTER,
    );
  }

  const bounds = haloLayer.boundsNoEffects;
  //定目标中心（画布）
  const desiredCenterX = targetDocument.width / 2;
  const desiredCenterY = targetDocument.height * 0.22;
  const offsetX = desiredCenterX - (bounds.left + bounds.width / 2);
  const offsetY = desiredCenterY - (bounds.top + bounds.height / 2);
  //同理：偏移量为 0 的 translate 也会触发「命令"移动"当前不可用」
  if (Math.abs(offsetX) > 0.01 || Math.abs(offsetY) > 0.01) {
    await haloLayer.translate(offsetX, offsetY);
  }
}
//递归遍历文档所有图层（含组内嵌套），返回扁平数组
function collectAllLayers(container) {
  const result = [];
  const visit = (layers) => {
    if (!layers) return;
    for (const layer of Array.from(layers)) {
      result.push(layer);
      //组才有 layers；普通图层是 null
      if (layer.layers) visit(layer.layers);
    }
  };
  visit(container.layers);
  return result;
}

//找出文档里所有效果组（不限层级、不限数量）
function findEffectGroups(targetDocument) {
  return collectAllLayers(targetDocument).filter(
    (layer) =>
      layer.name === EFFECT_GROUP_NAME &&
      layer.kind === constants.LayerKind.GROUP,
  );
}

//统一执行 batchPlay 并检查返回值
//PS 出错时不一定 reject，而是回一个 _obj:"error" 的描述符，
//不检查就会"报警告但代码继续跑"，问题被 PS 弹窗吐出来而不是走我们的错误处理
async function runBatch(descriptors, stepName) {
  const results = await action.batchPlay(descriptors, {
    immediateRedraw: true,
  });
  for (const result of results || []) {
    if (result && String(result._obj).toLowerCase() === "error") {
      throw new Error(`${stepName}失败: ${result.message || "未知错误"}`);
    }
  }
  return results;
}

//用 batchPlay 按 id 删除，比 layer.delete() 更不受"引用失效"影响
async function deleteLayerById(layerId) {
  await runBatch(
    [
      {
        _obj: "delete",
        _target: [{ _ref: "layer", _id: layerId }],
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    "删除图层",
  );
}

//删除之前的效果组（halo68创建的）
//关键点：1) 递归查找，组被挤到任意层级都能找到
//       2) 循环删除，多个同名组一次清空
//       3) 删完复查，还有残留就直接抛错，不带着脏状态继续
async function removePreviousEffect(targetDocument) {
  // 每轮只删一个，然后重新查询：
  // 旧组有可能嵌套（外层删掉时内层 id 已失效），一次性拿完 id 再删会报错
  const maxRounds = 50; //防御死循环：删不掉时不要无限重试
  for (let round = 0; round < maxRounds; round++) {
    const groups = findEffectGroups(targetDocument);
    if (groups.length === 0) return;
    try {
      await deleteLayerById(groups[0].id);
    } catch (e) {
      throw new Error(`旧效果组删除失败: ${e.message}`);
    }
  }

  const stillThere = findEffectGroups(targetDocument);
  if (stillThere.length > 0) {
    throw new Error(`旧效果组删除失败，仍残留 ${stillThere.length} 个`);
  }
}

//把 layer 移到 reference 的正下方。
//用 DOM 的 move + PLACEAFTER（文档明确：placeAfter 把图层放到 relativeObject 下方），
//而不是 batchPlay 的 ordinal "front"。
//ordinal "front" 在目标层已处于目标位置时会被 PS 判为不可用，
//弹「命令"移动"当前不可用」，等同菜单里"置为顶层"在顶层图层上变灰。
async function moveLayerBelow(layer, reference) {
  if (layer.id === reference.id) return;
  await layer.move(reference, constants.ElementPlacement.PLACEAFTER);
}

//判断 lower 是否正好位于 upper 的下一位（同一父容器内）
function isDirectlyBelow(lower, upper) {
  const upperParent = upper.parent;
  const lowerParent = lower.parent;
  const sameParent =
    (upperParent ? upperParent.id : null) ===
    (lowerParent ? lowerParent.id : null);
  if (!sameParent) return false;

  //顶层图层的 parent 为 null，此时兄弟集合就是文档根图层列表
  const siblings = Array.from(
    (upperParent ? upperParent.layers : app.activeDocument.layers) || [],
  );
  const upperIndex = siblings.findIndex((l) => l.id === upper.id);
  const lowerIndex = siblings.findIndex((l) => l.id === lower.id);
  if (upperIndex === -1 || lowerIndex === -1) return false;
  //PS 的 layers 数组是上→下
  return lowerIndex === upperIndex + 1;
}

//把一组图层排成给定顺序（数组顺序 = 上→下），使它们在图层栈中连续相邻。
//以最上面那层为锚，逐个把后一层移到前一层下方。
//已经到位的跳过，不产生多余的 move，从而不会触发"命令不可用"。
async function stackLayersInOrder(layersTopToBottom) {
  for (let i = 0; i < layersTopToBottom.length - 1; i++) {
    const upper = layersTopToBottom[i];
    const lower = layersTopToBottom[i + 1];
    if (isDirectlyBelow(lower, upper)) continue;
    await moveLayerBelow(lower, upper);
  }
}

//按 id 重命名。createLayerGroup 的 name 在部分 PS 版本会被忽略，需要兜底改名
async function renameLayerById(layerId, newName) {
  await runBatch(
    [
      {
        _obj: "set",
        _target: [{ _ref: "layer", _id: layerId }],
        to: { _obj: "layer", name: newName },
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    "重命名图层",
  );
}

//校验源图层是否仍然存在（清理旧组后，源图层有可能已被一起删掉）
function isLayerAlive(targetDocument, layerId) {
  return collectAllLayers(targetDocument).some((l) => l.id === layerId);
}

//用action manager发select命令选中图层
async function selectLayer(layer, targetDocument) {
  await runBatch(
    [
      {
        _obj: "select", // 命令类型：选中
        _target: [{ _ref: "layer", _id: layer.id }], // 用id引用目标图层
        makeVisible: false, //// 选中时不改变图层的可见性
        _options: { dialogOptions: "dontDisplay" }, // 静默执行，不弹任何对话框
      },
    ],
    "选中图层",
  );
}
//在当前面板更新图层树
function refreshLayerList() {
  const layerBox = document.getElementById("layers");
  if (!layerBox) return;

  if (app.documents.length === 0) {
    layerBox.textContent = "暂无可用文档";
    return;
  }
  const lines = [];
  const visit = (layer, indent) => {
    const marker = layer.visible ? "" : "[隐藏]";
    lines.push(`${" ".repeat(indent)}${layer.name}${marker}`);
    if (layer.layers) {
      for (const child of layer.layers) visit(child, indent + 1);
    }
  };
  for (const layer of app.activeDocument.layers) visit(layer, 0);
  layerBox.textContent = lines.join("\n");
}

function setStatus(message, isError = false) {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = isError ? "status error" : "status";
}

function setBusy(isBusy) {
  document.getElementById("btnCreateEffect").disabled = isBusy;
  document.getElementById("btnRefresh").disabled = isBusy;
}

module.exports = {
  EFFECT_GROUP_NAME,
  HALO_RESOURCE_PATH,
  GLOW,
  LAYER_NAMES,
  GENERATED_LAYER_NAMES,
  importHaloIntoGroup,
  fitHaloToCanvas,
  removePreviousEffect,
  selectLayer,
  refreshLayerList,
  setStatus,
  setBusy,
  collectAllLayers,
  findEffectGroups,
  deleteLayerById,
  runBatch,
  moveLayerBelow,
  stackLayersInOrder,
  renameLayerById,
  isLayerAlive,
};
