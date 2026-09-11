export function requirementPayload(values) {
  const dueDate = values.dueDate && typeof values.dueDate.format === 'function'
    ? values.dueDate.format('YYYY-MM-DD')
    : ''
  return { ...values, dueDate }
}

export function safeRequirementUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
