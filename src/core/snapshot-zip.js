// ZIP STORE format: portable downloads without a platform CLI or extra dependency.
const table = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
export function zipFiles(files) {
  if (files.length > 65535) throw new Error('交付包文件过多，请拆分交付范围')
  const local = [], central = []
  let offset = 0, centralSize = 0
  for (const file of files) {
    const name = Buffer.from(file.name), bytes = file.bytes, crc = crc32(bytes)
    if (bytes.length > 0xffffffff || offset + 30 + name.length + bytes.length > 0xffffffff) throw new Error('交付包超过 4GB，请拆分交付范围')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(33, 12) // 1980-01-01
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(bytes.length, 18)
    header.writeUInt32LE(bytes.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, bytes)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4)
    header.copy(record, 6, 4, 30)
    record.writeUInt32LE(offset, 42)
    central.push(record, name)
    centralSize += record.length + name.length
    offset += header.length + name.length + bytes.length
  }
  if (offset + centralSize > 0xffffffff) throw new Error('交付包超过 4GB，请拆分交付范围')
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}
