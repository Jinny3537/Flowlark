export function filterWatchItems(items = [], project = '') {
  const slug = String(project || '').trim()
  return slug ? items.filter((item) => item.project === slug) : [...items]
}
