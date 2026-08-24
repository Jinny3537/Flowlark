import { Message, Modal, Notification } from '@arco-design/web-vue'

export const notify = {
  success(content) {
    return Message.success({ content })
  },
  error(content) {
    return Message.error({ content })
  },
  warning(content) {
    return Message.warning({ content })
  },
  info(content) {
    return Message.info({ content })
  }
}

export function confirmDanger({ title, content, okText = '确认', cancelText = '取消', onOk }) {
  return Modal.confirm({
    title,
    content,
    okText,
    cancelText,
    okButtonProps: { status: 'danger' },
    onOk
  })
}

export function confirmAction({ title, content, okText = '确认', cancelText = '取消', onOk }) {
  return Modal.confirm({
    title,
    content,
    okText,
    cancelText,
    onOk
  })
}

export const notification = Notification
