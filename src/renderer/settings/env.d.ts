/**
 * 设置面板的样式副作用导入声明。
 * 项目当前 tsconfig 只引入 node 类型、未包含 vite/client，
 * 而 TS 7 会对无法解析的 CSS 副作用导入报 TS2882。
 * 这里按最窄范围声明（空模块，与 vite/client 的 '*.css' 声明可合并），
 * 若后续在全局补充 `/// <reference types="vite/client" />`，本文件可直接删除。
 */
declare module '*.css' {}
