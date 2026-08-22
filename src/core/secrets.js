import { execFileSync } from 'node:child_process'
import { err } from './errors.js'

const SERVICE = 'com.flowlark.integrations'

function accountName(provider, name = 'default') {
  const value = `${provider}:${name}`.toLowerCase()
  if (!/^[a-z0-9._:-]{1,160}$/.test(value)) throw err.bad('SECRET_ACCOUNT_INVALID', '密钥账户名不合法')
  return value
}

export function getSecret(provider, { name = 'default', envKey = null } = {}) {
  if (envKey && process.env[envKey]) return process.env[envKey]
  if (process.platform !== 'darwin') return null
  try {
    return execFileSync('security', [
      'find-generic-password', '-s', SERVICE, '-a', accountName(provider, name), '-w'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || null
  } catch (e) {
    if (e.status === 44) return null
    throw err.bad('KEYCHAIN_READ_FAILED', '无法读取 macOS 钥匙串', '检查“钥匙串访问”权限，或改用环境变量')
  }
}

export function setSecret(provider, value, { name = 'default' } = {}) {
  if (process.platform !== 'darwin') {
    throw err.bad('KEYCHAIN_UNAVAILABLE', '当前系统不支持 macOS 钥匙串', '请使用环境变量配置密钥')
  }
  if (!String(value || '')) throw err.bad('SECRET_EMPTY', '密钥不能为空')
  try {
    execFileSync('security', [
      'add-generic-password', '-U', '-s', SERVICE, '-a', accountName(provider, name), '-w', String(value)
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    return { provider, name, stored: true }
  } catch {
    throw err.bad('KEYCHAIN_WRITE_FAILED', '无法写入 macOS 钥匙串', '检查“钥匙串访问”权限，或改用环境变量')
  }
}

export function deleteSecret(provider, { name = 'default' } = {}) {
  if (process.platform !== 'darwin') return { provider, name, removed: false }
  try {
    execFileSync('security', [
      'delete-generic-password', '-s', SERVICE, '-a', accountName(provider, name)
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    return { provider, name, removed: true }
  } catch (e) {
    if (e.status === 44) return { provider, name, removed: false }
    throw err.bad('KEYCHAIN_DELETE_FAILED', '无法从 macOS 钥匙串删除密钥')
  }
}
