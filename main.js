const { entrypoints } = require("uxp");
const { createHaloEffect } = require("./halo-effect.js");
const { refreshLayerList } = require("./tools/components.js");

//向UXP提交注册有这个面板
entrypoints.setup({
  panels: {
    halo68Panel: {
      show() {
        refreshLayerList();
      },
    },
  },
});
//当前界面加载出来才能点击调用btn
document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("btnCreateEffect")
    .addEventListener("click", createHaloEffect);
  document
    .getElementById("btnRefresh")
    .addEventListener("click", refreshLayerList);
});
/*
async function createHaloEffect() {
  //检查当前文档和图层是否存在
  if (app.documents.length === 0) {
    setStatus("请打开一张图片", true); //第二个参数是红色错误样式
    return;
  }

  const documentToEdit = app.activeDocument; //当前文档
  const sourceLayer = documentToEdit.activeLayers[0]; //当前选中的图层

  if (!sourceLayer) {
    setStatus("请选择图片图层", true);
    return;
  }
  if (
    sourceLayer.kind === "group" || // 选中的是整个图层组？
    sourceLayer.name === EFFECT_GROUP_NAME || // 选中的图层组是创建出来的光环组本身
    (sourceLayer.parent && sourceLayer.parent.name === EFFECT_GROUP_NAME) // 选中的图层组是光环组下的嵌套图层组
  ) {
    setStatus("请选择原图照片图层", true);
    return;
  }

  let haloFile = null;
  try {
    const pluginFolder = await localFileSystem.getPluginFolder();
    haloFile = await pluginFolder.getEntry(HALO_RESOURCE_PATH);
    if (!haloFile.isFile) throw new Error("当前文件有误");
  } catch (e) {
    setStatus(e.message, true);
    return;
  }
  setBusy(true);
  setStatus("正在建立图层中...");

  try {
    //所有文档都被executeAsModal包裹起来，保证操作是原子的，不会被其他操作打断防止并发、失败回滚
    await core.executeAsModal(
      async () => {
        //防止重复操作，删除幂图层
        await removePreviousEffect(documentToEdit);

        //新建组
        const effectGroup = await documentToEdit.createLayerGroup({
          name: EFFECT_GROUP_NAME,
        });

        //复制出背景图层
        //从上到下：subject->haloglow->halo->Background

        await sourceLayer.duplicate(
          effectGroup,
          constants.ElementPlacement.PLACEINSIDE,
          "Background",
        );

        //导入光环放入组内,background上方
        const halo = await importHaloIntoGroup(
          haloFile,
          documentToEdit,
          effectGroup,
        );
        await fitHaloToCanvas(halo, documentToEdit); //?自动摆放位置

        //glow副本图层 混合+不透明度+高斯模糊
        const glow = await halo.duplicate(
          effectGroup,
          constants.ElementPlacement.PLACEINSIDE,
          "Halo Glow",
        );
        glow.opacity = GLOW.opacity; //不透明度
        glow.blendMode = GLOW.blendMode;
        //constants.BlendMode.SCREEN; //混合模式滤色

        //只要对有效的Halo图层打上高斯模糊
        await glow.applyGaussianBlur(GLOW.blurRadius); //高斯模糊

        //主体层
        const subject = await sourceLayer.duplicate(
          effectGroup,
          constants.ElementPlacement.PLACEINSIDE,
          "Subject",
        );
        subject.visible = false;

        halo.link(glow);

        await selectLayer(halo, documentToEdit);
      },
      { commandName: "Create Halo Effect" },
    );
    setStatus("光环效果已创建");
    await refreshLayerList();
  } catch (error) {
    console.error(error);
    setStatus(`创建失败:${error.message}`, true);
  } finally {
    setBusy(false);
  }
}
*/

/*
//打开内置png，复制进图层组，同时关闭临时文档
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
*/