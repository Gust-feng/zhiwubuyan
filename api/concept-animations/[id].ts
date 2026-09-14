import handler from "../../src/server/web-api.ts";

/**
 * 成象记录的单条路径（/api/concept-animations/<id>）。
 *
 * 这条是**两层**路径，而根级 catch-all 实测只匹配单层，会被平台先 404 掉
 * （前端拿到的是 HTML 404 页，JSON.parse 报 Unexpected token）。
 * 因此按前缀单独声明一个函数；处理仍由共享的 web-api 完成。
 */
export default handler;
