import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceSummary, validateHtmlFile } from './newVersionModel.js'

test('accepts html and htm files within the configured limit', () => {
  assert.equal(validateHtmlFile({ name: 'demo.html', size: 100 }, 200), '')
  assert.equal(validateHtmlFile({ name: 'demo.htm', size: 100 }, 200), '')
})

test('rejects wrong extensions and oversized files', () => {
  assert.equal(validateHtmlFile({ name: 'demo.txt', size: 100 }, 200), '仅支持 .html 或 .htm 文件')
  assert.equal(validateHtmlFile({ name: 'demo.html', size: 201 }, 200), '文件超过 200 B 上限')
})

test('summarizes bytes and external dependencies', () => {
  assert.equal(sourceSummary('', []), '尚未读取 HTML')
  assert.equal(sourceSummary('1234', []), '4 B · 无外部依赖')
  assert.equal(sourceSummary('1234', ['https://cdn/a.css']), '4 B · 1 个外部依赖')
})
