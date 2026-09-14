import handler from "../src/server/web-api.ts";

/**
 * 单段路径的入口（/api/status、/api/hot、/api/research-tasks 等）。
 *
 * 实测 Vercel 会把根级 catch-all 只编译成单层路由，多段路径（如 /api/user/archive）
 * 会先被平台 404 拦下，因此多段路由改由 `api/**` 下的显式文件声明；
 * 这里保留 catch-all 以承接单段路径，并为将来新增的同类路径兜底。
 */
export default handler;
