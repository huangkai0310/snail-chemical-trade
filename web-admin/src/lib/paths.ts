/** 管理后台静态部署在 /admin 前缀下，客户端跳转需用绝对路径 */
export const ADMIN_AUTH_PATH = "/admin/auth";
export const ADMIN_HOME_PATH = "/admin";

export function goAdminAuth() {
  if (typeof window !== "undefined") {
    window.location.href = ADMIN_AUTH_PATH;
  }
}

export function goAdminHome() {
  if (typeof window !== "undefined") {
    window.location.href = ADMIN_HOME_PATH;
  }
}
