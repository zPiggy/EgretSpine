# EgretSpine
白鹭版spine运行库 目前只支持spine v3.6

参考自库 https://github.com/fightingcat/egret-spine

新增功能
- 二进制 .skel 文件加载
- spine裁剪
- spine染色(TintBlack)
- 预乘


加载 .skel 文件时使用以下API 并按类型提示传参
let skelData = spine.createSkeletonDataByBinary(binary, texAtlas);


我很懒, 其他示例请直接参考 参考库