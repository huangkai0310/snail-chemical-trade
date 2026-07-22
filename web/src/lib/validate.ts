/**
 * 输入校验与消毒工具
 * 防止 XSS / 注入攻击，对用户输入进行格式校验和内容净化
 */

/**
 * 去除 HTML 标签和危险字符
 * 用于自由文本字段（交割地、规格、备注等）的输入消毒
 */
export function sanitizeText(input: string): string {
  if (!input) return "";
  // 去除首尾空格
  let s = input.trim();
  // 移除 HTML 标签
  s = s.replace(/<[^>]*>/g, "");
  // 移除事件处理器 (on开头的事件属性)
  s = s.replace(/\bon\w+\s*=\s*[^"]*["']?/gi, "");
  // 移除 javascript: 协议
  s = s.replace(/javascript:/gi, "");
  // 移除 data: 协议 (可用于XSS)
  s = s.replace(/data:/gi, "");
  // 移除 vbscript: 协议
  s = s.replace(/vbscript:/gi, "");
  // 限制连续空格
  s = s.replace(/\s{3,}/g, "  ");
  return s;
}

/**
 * 用户名校验
 * 规则: 3-64个字符，仅允许中文、字母、数字、下划线、横线
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
  if (!username || username.trim().length < 3) {
    return { valid: false, error: "用户名至少 3 个字符" };
  }
  if (username.length > 64) {
    return { valid: false, error: "用户名最多 64 个字符" };
  }
  // 仅允许中文、字母、数字、下划线、横线
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(username)) {
    return { valid: false, error: "用户名仅支持中文、字母、数字、下划线和横线" };
  }
  // 检查是否包含 HTML 标签
  if (/<[^>]*>/.test(username)) {
    return { valid: false, error: "用户名包含非法字符" };
  }
  return { valid: true };
}

/**
 * 密码强度校验
 * 规则: 至少6位，必须包含字母和数字（可选更严格规则）
 */
export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < 6) {
    return { valid: false, error: "密码至少 6 位" };
  }
  if (password.length > 128) {
    return { valid: false, error: "密码最多 128 位" };
  }
  // 检查是否包含空格
  if (/\s/.test(password)) {
    return { valid: false, error: "密码不能包含空格" };
  }
  return { valid: true };
}

/**
 * 手机号校验（中国大陆）
 * 规则: 11位数字，1开头，第二位3-9
 */
export function validatePhone(phone: string): { valid: boolean; error?: string } {
  if (!phone) {
    return { valid: false, error: "请输入手机号" };
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return { valid: false, error: "请输入正确的手机号格式" };
  }
  return { valid: true };
}

/**
 * 公司名称校验
 * 规则: 2-100个字符，禁止HTML标签和特殊脚本字符
 */
export function validateCompanyName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length < 2) {
    return { valid: false, error: "公司名称至少 2 个字符" };
  }
  if (name.length > 100) {
    return { valid: false, error: "公司名称最多 100 个字符" };
  }
  // 禁止 HTML 标签
  if (/<[^>]*>/.test(name)) {
    return { valid: false, error: "公司名称包含非法字符" };
  }
  // 禁止脚本相关关键字
  const lower = name.toLowerCase();
  if (lower.includes("javascript:") || lower.includes("onload") || lower.includes("onerror")) {
    return { valid: false, error: "公司名称包含非法字符" };
  }
  return { valid: true };
}

/**
 * 通用文本字段校验（交割地、规格、交割方式等）
 * 规则: 最多200个字符，禁止HTML标签和脚本
 */
export function validateGeneralText(
  text: string,
  fieldName: string,
  maxLength = 200
): { valid: boolean; error?: string } {
  if (!text || !text.trim()) {
    return { valid: false, error: `${fieldName}不能为空` };
  }
  if (text.length > maxLength) {
    return { valid: false, error: `${fieldName}最多 ${maxLength} 个字符` };
  }
  // 禁止 HTML 标签
  if (/<[^>]*>/.test(text)) {
    return { valid: false, error: `${fieldName}包含非法字符` };
  }
  return { valid: true };
}

/**
 * 数值校验
 * 规则: 必须是正数
 */
export function validatePositiveNumber(
  value: string,
  fieldName: string
): { valid: boolean; error?: string } {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) {
    return { valid: false, error: `${fieldName}必须为正数` };
  }
  return { valid: true };
}

/**
 * 检查输入是否包含潜在 XSS 攻击模式
 * 返回 true 表示输入安全
 */
export function isSafeInput(input: string): boolean {
  if (!input) return true;
  const lower = input.toLowerCase();
  // 检查常见的 XSS 攻击模式
  const dangerous = [
    "<script",
    "</script>",
    "javascript:",
    "onerror=",
    "onload=",
    "onclick=",
    "onmouseover=",
    "<iframe",
    "<embed",
    "<object",
    "eval(",
    "expression(",
    "<img",
    "<svg",
  ];
  for (const pattern of dangerous) {
    if (lower.includes(pattern)) return false;
  }
  return true;
}
