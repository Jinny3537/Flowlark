export function requirementPayload(values) {
  const dueDate = values.dueDate && typeof values.dueDate.format === 'function'
    ? values.dueDate.format('YYYY-MM-DD')
    : ''
  return { ...values, dueDate }
}
