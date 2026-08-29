//注册面板/命令入口 文件存储 API 的入口
const { entrypoints, storage } = require("uxp");
//Photoshop 本体 核心事务：历史记录、事件 枚举常量
const { app, core, constants } = require("photoshop");
//方便调用本地文件api
const localFileSystem = storage.localFileSystem;

//创建出的图层组的名字
const EFFECT_GROUP_NAME = "HALO68 Effect";
const HALO_ASSET_PATH = "resources/IBUKI.png";
//临时混合模式 = 屏幕（Screen）、不透明度 = 55%、高斯模糊半径 = 18px
const GLOW = {
  blendMode: constants.BlendMode.SCREEN,
  opacity: 55,
  blurRadius: 18,
};

//向UXP提交注册有这个面板
entrypoints.setup({
  panels: {
    halo68Panel: {
      show() {
        refreshLayerList();
      }, //调用（点击时用hooks更新show当前的面板）
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
    await core.executeAsModal(async () => {
      //防止重复操作，删除幂图层
      await removePreviousHaloEffect(documentToEdit);

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
      await fitHaloToCanvas(halo, documentToEdit);//?自动摆放位置

      //glow副本图层 混合+不透明度+高斯模糊
      const glow = await halo.duplicate(
        effectGroup,
        constants.ElementPlacement.PLACEINSIDE,
        "Halo Glow"
      );
      glow.opacity = 55;//不透明度
      glow.blendMode = constants.BlendMode.SCREEN;//混合模式滤色

      //只要对有效的Halo图层打上高斯模糊
      await glow.applyGaussianBlur(18);//高斯模糊

      //主体层
      const subject = await sourceLayer.duplicate(
        effectGroup,
        constants.ElementPlacement.PLACEINSIDE,
        "Subject"
      );
      subject.visible = false;

      halo.link(glow);

      await selectLayer(halo,documentToEdit);
    },{ commandName: "Create Halo Effect" });
    setStatus("光环效果已创建");
    await refreshLayerList();
  } catch (error) {
    console.error(error);
    setStatus(`创建失败:${error.message}`, true);
  }finally{
    setBusy(false);
  }

  
}
