export function validateHtmlFile(file, maxBytes) {
  if (!/\.html?$/i.test(String(file?.name || ''))) return '仅支持 .html 或 .htm 文件'
  if (Number(file?.size || 0) > Number(maxBytes || Infinity)) return `文件超过 ${formatBytes(maxBytes)} 上限`
  return ''
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function sourceSummary(html, externalRefs = []) {
  if (!html) return '尚未读取 HTML'
  const bytes = new TextEncoder().encode(html).byteLength
  return `${formatBytes(bytes)} · ${externalRefs.length ? `${externalRefs.length} 个外部依赖` : '无外部依赖'}`
}
