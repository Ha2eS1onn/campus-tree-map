# 🌲 侨木志 · 校园树木地图

> 清远市华侨中学校园树木协作统计地图 —— 校友共同记录校园里每一棵树。

一个基于 **Leaflet** 的校园树木地图应用,支持校友协作添加树木标记、上传照片、按树种分组浏览与检索,并可将数据导出为 CSV / GeoJSON。

## ✨ 功能特性

- 🗺️ **交互地图**:Leaflet 地图 + MarkerCluster 聚合,支持街道图 / 浅色图 / 卫星图三种底图切换
- 📍 **校园范围锁定**:地图仅显示清远市华侨中学校园区域,防止越界标记
- 🌳 **协作标记**:点击地图任意位置即可添加树木,记录树种、备注与图片
- 🖼️ **图片上传**:前端自动压缩图片,经 Cloudflare Worker 上传至 GitHub 仓库,通过 jsDelivr CDN 加速分发
- 🔍 **搜索与分组**:按树种名称实时搜索、分组折叠,搜索时地图标记同步过滤
- 🗑️ **权限管理**:本人 24 小时内可删除自己的记录;管理员可通过管理面板全量编辑/删除
- 📥 **数据导出**:一键导出 CSV 或 GeoJSON,便于统计与二次分析
- 📱 **响应式布局**:移动端侧边栏自动变为底部抽屉式面板
- 🔐 **管理员登录**:密码登录后签发 JWT,管理面板操作需携带令牌

## 🛠️ 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | 原生 HTML / CSS / JavaScript + Leaflet + MarkerCluster |
| 数据存储 | Firebase Realtime Database |
| 图片存储 | GitHub 仓库 + jsDelivr CDN |
| 后端 API | Cloudflare Workers |
| 部署 | Cloudflare Pages |

## 📁 项目结构

```
.
├── index.html          # 主页面(地图 + 侧边栏 + 标记/编辑/导出)
├── admin/
│   └── index.html      # 管理面板(登录、编辑、删除、导出)
├── _worker.js          # Cloudflare Worker API(JWT 签发、图片上传/删除)
├── libs/               # 本地 Leaflet 与 MarkerCluster 静态资源
├── favicon.ico         # 站点图标
├── deploy.ps1          # Cloudflare Pages 部署脚本(本地使用)
└── 杂项/                # 宣传海报设计源文件
```

## 🚀 快速开始

本项目为纯静态站点,无需构建,直接本地预览:

```powershell
# 方式一:直接用浏览器打开
start index.html

# 方式二:任意静态服务器
python -m http.server 8080
# 或
npx serve .
```

> 注意:图片上传与管理面板功能依赖线上 Worker 与 Firebase,本地预览仅能浏览地图与现有数据。

## ☁️ 部署指南

### 1. 创建 Firebase 项目

1. 在 [Firebase 控制台](https://console.firebase.google.com/) 创建项目,启用 **Realtime Database**
2. 将 `index.html` 中 `firebaseConfig` 替换为你自己的配置
3. 数据库规则建议:写入需登录或限制匿名写入

### 2. 部署 Cloudflare Pages

项目根目录已包含 `_worker.js`,Pages 会自动将其作为 Worker 运行:

```powershell
# 使用项目自带脚本(需已安装 wrangler 并登录)
.\deploy.ps1

# 或手动执行
wrangler pages deploy . --project-name=trees --branch=production
```

### 3. 配置 Worker 环境变量

在 Cloudflare Pages 项目 → **设置 → 环境变量** 中配置:

| 变量 | 说明 |
| --- | --- |
| `JWT_SECRET` | 管理员登录 JWT 签名密钥(必填) |
| `ADMIN_PASSWORD` | 管理员登录密码(必填) |
| `GITHUB_TOKEN` | GitHub 个人访问令牌,用于图片上传(必填) |

## 📡 API 文档

Worker 基地址:`https://<your-domain>/api`

### `POST /api/auth`

管理员登录,返回 JWT 令牌。

```json
// 请求
{ "password": "你的密码" }
// 响应
{ "token": "<jwt>" }
```

### `POST /api/upload`

上传图片至 GitHub 仓库(需已配置 `GITHUB_TOKEN`),返回 jsDelivr CDN 地址。

```json
// 请求
{ "fileName": "photo.jpg", "fileContent": "<base64>" }
// 响应
{ "cdnUrl": "https://cdn.jsdelivr.net/gh/..." }
```

### `DELETE /api/upload`

按 CDN 地址删除已上传的图片。

```json
// 请求
{ "imageUrl": "https://cdn.jsdelivr.net/gh/..." }
```

## 🗃️ 数据格式

每条树木记录存放在 Firebase Realtime Database 的 `trees` 节点下:

```json
{
  "-Njx...": {
    "name": "银杏",
    "note": "操场东侧第 3 棵",
    "lat": 23.670478,
    "lng": 113.068398,
    "by": "昵称",
    "time": 1710000000000,
    "images": ["https://cdn.jsdelivr.net/gh/..."],
    "editedAt": 1710000000000,
    "editedBy": "昵称"
  }
}
```

## 📜 许可证

本项目代码仅供学习交流使用。
