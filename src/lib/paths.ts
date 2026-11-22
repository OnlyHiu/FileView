// 路径工具：相对链接解析等纯逻辑（可单元测试）

/**
 * 解析相对链接：相对当前文档所在目录，返回规范化后的路径。
 *
 * 支持 `./` `../` 与正斜杠分隔；结果为 Windows 路径（`C:\docs\README.md`）。
 * 解析失败或链接为空返回 null。
 *
 * 例：
 * - `resolveRelativePath("C:\\a\\b.md", "README.md")` → `C:\a\README.md`
 * - `resolveRelativePath("C:\\a\\b.md", "../README.md")` → `C:\README.md`
 * - `resolveRelativePath("C:\\a\\b.md", "docs/x.md")` → `C:\a\docs\x.md`
 */
export function resolveRelativePath(baseFile: string, href: string): string | null {
  try {
    const decoded = decodeURIComponent(href).trim();
    if (!decoded) return null;
    // 绝对路径原样返回
    if (/^[a-zA-Z]:[\\/]/.test(decoded) || decoded.startsWith("\\\\")) return decoded;
    // 取所在目录（含末尾分隔符）；没有目录时为空（相对当前工作目录）
    const dirMatch = baseFile.match(/^(.*[\\/])/);
    const dir = dirMatch ? dirMatch[1] : "";
    const raw = dir ? `${dir}${decoded}` : decoded;
    const out: string[] = [];
    for (const seg of raw.split(/[\\/]/)) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        out.pop();
        continue;
      }
      out.push(seg);
    }
    return out.join("\\");
  } catch {
    return null;
  }
}
