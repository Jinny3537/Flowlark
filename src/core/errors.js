/**
 * 统一业务错误。CLI 用 code 决定退出码与提示，HTTP 用 status 决定响应码。
 * 两边共用同一套错误，不存在「CLI 报一个话术、网页报另一个」的分裂。
 */
export class PhError extends Error {
  constructor(code, message, { status = 400, hint = null } = {}) {
    super(message)
    this.name = 'PhError'
    this.code = code
    this.status = status
    /** 给终端用户的下一步建议，网页端忽略 */
    this.hint = hint
  }
}

export const err = {
  notFound: (what, hint) => new PhError('NOT_FOUND', `${what}不存在`, { status: 404, hint }),
  bad: (code, message, hint) => new PhError(code, message, { status: 400, hint }),
  forbidden: (code, message, hint) => new PhError(code, message, { status: 403, hint }),
  conflict: (code, message, hint) => new PhError(code, message, { status: 409, hint }),
  noRepo: () =>
    new PhError('NO_REPO', '当前目录及其上级目录中没有找到 Flowlark 仓库', {
      status: 400,
      hint: '执行 `flowlark init` 创建一个，或 cd 到已有仓库目录'
    })
}
