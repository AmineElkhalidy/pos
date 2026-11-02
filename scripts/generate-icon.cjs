/**
 * Generates a valid 256x256 PNG and embeds it in a standard Windows .ico file
 * at build/icon.ico and build/icon.png (navy background #0f172a with emerald badge #059669).
 */
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function createIconPng(size = 256) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const cx = size / 2
  const cy = size / 2
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0 // filter type 0
    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 4
      const dx = Math.abs(x - cx)
      const dy = Math.abs(y - cy)
      const inOuter = dx < size * 0.45 && dy < size * 0.45
      const inInner = dx < size * 0.28 && dy < size * 0.28
      const inCrossH = dx < size * 0.16 && dy < size * 0.05
      const inCrossV = dx < size * 0.05 && dy < size * 0.16
      if (!inOuter) {
        raw[idx] = 0
        raw[idx + 1] = 0
        raw[idx + 2] = 0
        raw[idx + 3] = 0
      } else if (inCrossH || inCrossV) {
        // White center emblem
        raw[idx] = 255
        raw[idx + 1] = 255
        raw[idx + 2] = 255
        raw[idx + 3] = 255
      } else if (inInner) {
        // Emerald #059669
        raw[idx] = 5
        raw[idx + 1] = 150
        raw[idx + 2] = 105
        raw[idx + 3] = 255
      } else {
        // Navy #0f172a
        raw[idx] = 15
        raw[idx + 1] = 23
        raw[idx + 2] = 42
        raw[idx + 3] = 255
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function createIcoFromPng(pngBuf) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type 1 = ICO
  header.writeUInt16LE(1, 4) // 1 image

  const dir = Buffer.alloc(16)
  dir[0] = 0 // 0 means 256 px width
  dir[1] = 0 // 0 means 256 px height
  dir[2] = 0
  dir[3] = 0
  dir.writeUInt16LE(1, 4) // color planes
  dir.writeUInt16LE(32, 6) // bits per pixel
  dir.writeUInt32LE(pngBuf.length, 8)
  dir.writeUInt32LE(6 + 16, 12)

  return Buffer.concat([header, dir, pngBuf])
}

const buildDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(buildDir, { recursive: true })
const png = createIconPng(256)
const ico = createIcoFromPng(png)
fs.writeFileSync(path.join(buildDir, 'icon.png'), png)
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico)
console.log('Generated build/icon.ico and build/icon.png')

