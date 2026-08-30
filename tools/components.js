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

/*
async function importHaloIntoGroup(haloFile, targetDocument, targetGroup) {
  const haloDocument = await app.open(haloFile);
  try {
    const sourceHaloLayer = haloDocument.activeLayers[0];
    if (!sourceHaloLayer) {
      throw new Error("光环无可导入的图层");
    }
    return await sourceHaloLayer.duplicate(
      targetGroup,
      constants.ElementPlacement.PLACEINSIDE,
      "Halo",
    );
  } finally {
    await haloDocument.close(constants.SaveOptions.DONOTSAVECHANGES);
  }
}*/
async function importHaloIntoGroup(haloFile, targetDocument, targetGroup) {
  //跨文档移动图层，不用duplicate
  //用action manager的placement来调用

  //batchplay = 录制的"动作"
  //选中当前文档设置为活动文档，让placement可以操作
  await action.batchPlay(
    [
      {
        _obj: "select",
        _target: [
          {
            _ref: "document",
            _id: targetDocument.id,
          },
        ],
      },
    ],
    { immediateRedraw: true },
  );

  const token = await localFileSystem.createSessionToken(haloFile); //生成一个临时的会话令牌,token表示该文件路径的字符串

  //生成一个智能对象图层，把 “token” 指向的图片作为智能对象图层置入当前文档，并成为活动图层。
  await action.batchPlay(
    [
      {
        _obj: "placeEvent", //placeEvent无需将图片打开为一个文档
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
    { immediateRedraw: true },
  );

  //选中当前选择/激活的图层,这个图层的顶子图层
  //组内最顶层的子图层
  const placedLayer = targetDocument.activeLayers[0];

  if (!placedLayer) {
    throw new Error("光环置入失败");
  }

  await action.batchPlay(
    [
      {
        _obj: "rasterizeLayer",
        _target: [
          {
            _ref: "layer",
            _id: placedLayer.id,
          },
        ],
      },
    ],
    { immediateRedraw: true },
  );
  //改名
  placedLayer.name = "Halo";
  //选中的顶子图层
  const firstChild = targetGroup.layers[0];
  if (firstChild) {
    await placedLayer.moveBefore(firstChild);
  }
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
  await haloLayer.scale(
    //水平和垂直缩放比例
    scalePercent,
    scalePercent,
    //图层中心为锚点
    constants.AnchorPosition.MIDDLECENTER,
  );

  const bounds = haloLayer.boundsNoEffects;
  //定目标中心（画布）
  const desiredCenterX = targetDocument.width / 2;
  const desiredCenterY = targetDocument.height * 0.22;
  //将光环位移到目标中心
  await haloLayer.translate(
    desiredCenterX - (bounds.left + bounds.width / 2),
    desiredCenterY - (bounds.top + bounds.height / 2),
  );
}
//删除之前的效果组（halo68创建的）
async function removePreviousEffect(targetDocument) {
  const existingEffect = Array.from(targetDocument.layers).find(
    (layer) => layer.name === EFFECT_GROUP_NAME,
  );
  if (existingEffect) {
    await existingEffect.delete();
  }
}

//用action manager发select命令选中图层
async function selectLayer(layer, targetDocument) {
  await require("photoshop").action.batchPlay(
    [
      {
        _obj: "select", // 命令类型：选中
        _target: [{ _ref: "layer", _id: layer.id }], // 用id引用目标图层
        makeVisible: false, //// 选中时不改变图层的可见性
        _options: { dialogOptions: "dontDisplay" }, // 静默执行，不弹任何对话框
      },
    ],
    { immediateRedraw: true }, //执行后立即重绘画布
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
  importHaloIntoGroup,
  fitHaloToCanvas,
  removePreviousEffect,
  selectLayer,
  refreshLayerList,
  setStatus,
  setBusy,
};
