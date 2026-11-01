// 生成验收用测试音频（WAV，无第三方依赖）
// 用法：node scripts/make-test-audio.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const OUTPUT = resolve('docs/verification/media/sample.wav')
const SAMPLE_RATE = 44100
const DURATION = 36
const CHANNELS = 2

// Am - F - C - G 的柔和琶音，便于听出「像音乐」而不是测试音
const CHORDS = [
  [220.0, 261.63, 329.63, 440.0],
  [174.61, 220.0, 261.63, 349.23],
  [261.63, 329.63, 392.0, 523.25],
  [196.0, 246.94, 293.66, 392.0]
]

const frames = SAMPLE_RATE * DURATION
const data = Buffer.alloc(frames * CHANNELS * 2)

const envelope = (t, len) => {
  const attack = 0.02
  const release = 0.35
  if (t < attack) return t / attack
  if (t > len - release) return Math.max(0, (len - t) / release)
  return 1
}

for (let i = 0; i < frames; i += 1) {
  const t = i / SAMPLE_RATE
  const barLength = 3
  const bar = Math.floor(t / barLength) % CHORDS.length
  const chord = CHORDS[bar]
  const noteLength = barLength / 4
  const noteIndex = Math.floor((t % barLength) / noteLength) % chord.length
  const noteStart = Math.floor((t % barLength) / noteLength) * noteLength
  const localT = t - Math.floor(t / barLength) * barLength - noteStart
  const freq = chord[noteIndex]
  const env = envelope(localT, noteLength)

  const fundamental = Math.sin(2 * Math.PI * freq * t)
  const second = 0.28 * Math.sin(2 * Math.PI * freq * 2 * t)
  const third = 0.12 * Math.sin(2 * Math.PI * freq * 3 * t)
  const pad = 0.1 * Math.sin(2 * Math.PI * chord[0] * t)
  const sample = (fundamental + second + third) * env * 0.32 + pad * 0.12

  const left = Math.max(-1, Math.min(1, sample))
  const right = Math.max(-1, Math.min(1, sample * 0.94))
  const offset = i * CHANNELS * 2
  data.writeInt16LE(Math.round(left * 32767), offset)
  data.writeInt16LE(Math.round(right * 32767), offset + 2)
}

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + data.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(CHANNELS, 22)
header.writeUInt32LE(SAMPLE_RATE, 24)
header.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28)
header.writeUInt16LE(CHANNELS * 2, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(data.length, 40)

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(OUTPUT, Buffer.concat([header, data]))
console.log(`WAV_BYTES=${header.length + data.length} PATH=${OUTPUT}`)
