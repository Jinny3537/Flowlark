/** Self-contained browser runtime, embedded in saved HTML so downloads work too. */
export function prototypeEdits(initial = []) {
  const runtimeId = 'flowlark-saved-edits'
  const ignored = '#flowlark-edit-bridge,#flowlark-edit-style,#flowlark-saved-edits'
  const patches = initial
  let pending = null
  let applying = false
  const clean = (element) => {
    const clone = element.cloneNode(true)
    clone.querySelectorAll(ignored).forEach(node => node.remove())
    clone.querySelectorAll('[data-flowlark-edit-target]').forEach(node => node.removeAttribute('data-flowlark-edit-target'))
    clone.removeAttribute('data-flowlark-edit-target')
    if (element === document.body) {
      clone.removeAttribute('contenteditable')
      clone.removeAttribute('spellcheck')
    }
    return JSON.stringify({
      html: clone.innerHTML,
      attributes: Array.from(clone.attributes, attr => [attr.name, attr.value]).sort(([a], [b]) => a.localeCompare(b))
    })
  }
  const children = node => Array.from(node.childNodes).filter(child => !(child.nodeType === 1 && child.matches(ignored)))
  const equal = (a, b) => {
    if (a.nodeType !== b.nodeType) return false
    if (a.nodeType !== 1) return a.nodeValue === b.nodeValue
    const clone = a.cloneNode(true)
    clone.removeAttribute('data-flowlark-edit-target')
    clone.querySelectorAll('[data-flowlark-edit-target]').forEach(node => node.removeAttribute('data-flowlark-edit-target'))
    return clone.outerHTML === b.outerHTML
  }
  // Reuse unchanged nodes, including their listeners and live form values.
  const reconcile = (parent, desired) => {
    let live = children(parent)
    const wanted = children(desired)
    for (let i = 0; i < wanted.length; i++) {
      const next = wanted[i]
      if (live[i] && equal(live[i], next)) continue
      const later = live.findIndex((node, index) => index > i && equal(node, next))
      if (later !== -1) {
        live.slice(i, later).forEach(node => node.remove())
        live = children(parent)
        continue
      }
      const current = live[i]
      // Insertion before a retained sibling must not destroy that sibling.
      const retained = current && wanted.slice(i + 1).some(node => equal(current, node))
      if (!current || retained) {
        parent.insertBefore(next.cloneNode(true), current || null)
      } else if (current.nodeType === next.nodeType && current.nodeName === next.nodeName) {
        if (current.nodeType === 1) {
          for (const attr of Array.from(current.attributes)) {
            if (attr.name !== 'data-flowlark-edit-target' && !next.hasAttribute(attr.name)) current.removeAttribute(attr.name)
          }
          for (const attr of Array.from(next.attributes)) {
            if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value)
          }
          reconcile(current, next)
        } else current.nodeValue = next.nodeValue
      } else current.replaceWith(next.cloneNode(true))
      live = children(parent)
    }
    children(parent).slice(wanted.length).forEach(node => node.remove())
  }
  const resolve = patch => patch.id ? document.getElementById(patch.id) : document.body
  const apply = () => {
    if (pending || applying) return
    applying = true
    try {
      for (const patch of patches) {
        const target = resolve(patch)
        // Exact context guards against deleting similarly named fields on other screens.
        if (!target || clean(target) !== patch.before) continue
        const desired = target.cloneNode(false)
        const state = JSON.parse(patch.after)
        desired.innerHTML = state.html
        for (const attr of Array.from(desired.attributes)) desired.removeAttribute(attr.name)
        for (const [name, value] of state.attributes) desired.setAttribute(name, value)
        for (const attr of Array.from(target.attributes)) {
          if (attr.name === 'data-flowlark-edit-target' || (target === document.body && ['contenteditable', 'spellcheck'].includes(attr.name))) continue
          if (!desired.hasAttribute(attr.name)) target.removeAttribute(attr.name)
        }
        for (const attr of Array.from(desired.attributes)) {
          if (target.getAttribute(attr.name) !== attr.value) target.setAttribute(attr.name, attr.value)
        }
        reconcile(target, desired)
      }
    } finally {
      observer.takeRecords()
      applying = false
    }
  }
  const observer = new MutationObserver(apply)
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true })
  const begin = (element) => {
    if (pending) return
    apply()
    if (!element) {
      const selection = window.getSelection()
      element = selection && selection.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : document.body
    }
    if (element.nodeType !== 1) element = element.parentElement
    // A stable container plus its exact original HTML scopes edits to one page/state.
    while (element && element !== document.body && !element.id) element = element.parentElement
    if (!element || !document.body.contains(element)) element = document.body
    pending = { target: element, id: element === document.body ? null : element.id, before: clean(element) }
  }
  const finish = () => {
    if (!pending) return
    const { target, id, before } = pending
    pending = null
    const after = clean(target)
    if (before !== after) {
      const last = patches[patches.length - 1]
      if (last && last.id === id && last.after === before) {
        last.after = after
        if (last.before === after) patches.pop()
      } else patches.push({ id, before, after })
    }
    observer.takeRecords()
  }
  window.__flowlarkEdits = { begin, finish, patches, runtimeId }
  apply()
  document.addEventListener('DOMContentLoaded', apply, { once: true })
}

const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export function editsRuntimeScript(patches = []) {
  return `<script id="flowlark-saved-edits">(${prototypeEdits.toString()})(${scriptJson(patches)})</script>`
}

export function injectBeforeBodyEnd(html, script) {
  // Use the last closing tag: script templates can themselves contain </body>.
  const matches = [...html.matchAll(/<\/body\s*>/gi)]
  const offset = matches.length ? matches[matches.length - 1].index : html.length
  return html.slice(0, offset) + script + html.slice(offset)
}
