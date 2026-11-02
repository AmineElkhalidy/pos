import { SerialPort } from 'serialport'
import type { AppSettings } from '@shared/settings'

export interface ScaleReading {
  weightGrams: number
  weightKg: number
  stable: boolean
  simulated: boolean
  adapter: string
  raw: string
  timestamp: string
}

export interface ScaleStatus {
  connected: boolean
  simulated: boolean
  adapter: string
  port: string
  lastReading: ScaleReading | null
  lastError: string | null
}

/**
 * Modular Scale Protocol Parser interface.
 *
 * How to add support for a specific electronic scale model:
 * 1. Implement a `ScaleProtocolAdapter` with:
 *    - `id`: unique identifier
 *    - `name`: human-readable model/protocol name
 *    - `defaultPollCommand`: optional command string sent to request weight (e.g. "W\r\n" or "\x05")
 *    - `parseFrame(line, defaultUnit)`: parses one ASCII frame from the scale into `{ weightGrams, stable } | null`
 * 2. Register it in `SCALE_ADAPTERS` below and add its key to `scaleSettingsSchema` in `src/shared/settings.ts`.
 */
export interface ScaleProtocolAdapter {
  id: 'simulated' | 'generic' | 'cas' | 'toledo'
  name: string
  defaultPollCommand: string
  parseFrame(rawFrame: string, defaultUnit: 'kg' | 'g'): { weightGrams: number; stable: boolean } | null
}

export const GenericAsciiScaleAdapter: ScaleProtocolAdapter = {
  id: 'generic',
  name: 'Generic ASCII (ST,GS,+001.250kg)',
  defaultPollCommand: '',
  parseFrame(raw, defaultUnit) {
    const clean = raw.trim()
    if (!clean) return null
    const m = clean.match(/([+-]?\d+(?:[.,]\d+)?)\s*(kg|g)?/i)
    if (!m) return null
    const val = Number(m[1].replace(',', '.'))
    if (!Number.isFinite(val)) return null
    const unit = (m[2]?.toLowerCase() as 'kg' | 'g' | undefined) ?? defaultUnit
    const grams = unit === 'kg' ? Math.round(val * 1000) : Math.round(val)
    const unstable = /US|UNSTABLE|MOTION/i.test(clean)
    return { weightGrams: Math.max(0, grams), stable: !unstable }
  }
}

export const CasScaleAdapter: ScaleProtocolAdapter = {
  id: 'cas',
  name: 'CAS (ER-JR / PR-II / SW-1)',
  defaultPollCommand: 'W\r\n',
  parseFrame(raw, defaultUnit) {
    // Typical CAS frame: "ST,GS,+  1.250kg" or "US,NT,+  0.350kg"
    const clean = raw.replace(/[\x00-\x1F]/g, '').trim()
    const m = clean.match(/(ST|US)?[, ]*(?:GS|NT)?[, ]*([+-]?\s*\d+(?:[.,]\d+)?)\s*(kg|g)?/i)
    if (!m) return null
    const num = Number(m[2].replace(/\s+/g, '').replace(',', '.'))
    if (!Number.isFinite(num)) return null
    const unit = (m[3]?.toLowerCase() as 'kg' | 'g' | undefined) ?? defaultUnit
    const grams = unit === 'kg' ? Math.round(num * 1000) : Math.round(num)
    const stable = (m[1]?.toUpperCase() ?? 'ST') === 'ST'
    return { weightGrams: Math.max(0, grams), stable }
  }
}

export const MettlerToledoScaleAdapter: ScaleProtocolAdapter = {
  id: 'toledo',
  name: 'Mettler-Toledo SICS (S / SI)',
  defaultPollCommand: 'SI\r\n',
  parseFrame(raw, defaultUnit) {
    // Typical SICS response: "S S     0.500 kg" (stable) or "S D     0.500 kg" (dynamic)
    const clean = raw.trim()
    const m = clean.match(/S\s+([SD])\s+([+-]?\d+(?:[.,]\d+)?)\s*(kg|g)?/i)
    if (!m) return GenericAsciiScaleAdapter.parseFrame(raw, defaultUnit)
    const num = Number(m[2].replace(',', '.'))
    if (!Number.isFinite(num)) return null
    const unit = (m[3]?.toLowerCase() as 'kg' | 'g' | undefined) ?? defaultUnit
    const grams = unit === 'kg' ? Math.round(num * 1000) : Math.round(num)
    return { weightGrams: Math.max(0, grams), stable: m[1].toUpperCase() === 'S' }
  }
}

export const SCALE_ADAPTERS: Record<string, ScaleProtocolAdapter> = {
  generic: GenericAsciiScaleAdapter,
  cas: CasScaleAdapter,
  toledo: MettlerToledoScaleAdapter
}

class ScaleService {
  private port: SerialPort | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private buffer = ''
  private simulatedGrams = 350
  private simulatedStable = true
  private lastReading: ScaleReading | null = null
  private lastError: string | null = null
  private listeners = new Set<(reading: ScaleReading) => void>()

  public onReading(cb: (reading: ScaleReading) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(r: ScaleReading): void {
    this.lastReading = r
    for (const cb of this.listeners) {
      try {
        cb(r)
      } catch {
        // ignore listener error
      }
    }
  }

  public async listPorts(): Promise<{ path: string; manufacturer?: string; friendlyName?: string }[]> {
    try {
      const ports = await SerialPort.list()
      return ports.map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
        friendlyName: (p as { friendlyName?: string }).friendlyName ?? p.manufacturer ?? p.path
      }))
    } catch {
      return []
    }
  }

  public setSimulatedWeight(grams: number, stable = true): ScaleReading {
    this.simulatedGrams = Math.max(0, Math.round(grams))
    this.simulatedStable = stable
    const reading: ScaleReading = {
      weightGrams: this.simulatedGrams,
      weightKg: Number((this.simulatedGrams / 1000).toFixed(3)),
      stable: this.simulatedStable,
      simulated: true,
      adapter: 'simulated',
      raw: `SIM:${this.simulatedGrams}g`,
      timestamp: new Date().toISOString()
    }
    this.emit(reading)
    return reading
  }

  public getStatus(cfg: AppSettings['scale']): ScaleStatus {
    if (cfg.adapter === 'simulated') {
      const reading: ScaleReading = this.lastReading?.simulated
        ? this.lastReading
        : {
            weightGrams: this.simulatedGrams,
            weightKg: Number((this.simulatedGrams / 1000).toFixed(3)),
            stable: this.simulatedStable,
            simulated: true,
            adapter: 'simulated',
            raw: `SIM:${this.simulatedGrams}g`,
            timestamp: new Date().toISOString()
          }
      return {
        connected: cfg.enabled,
        simulated: true,
        adapter: 'simulated',
        port: 'SIMULATED',
        lastReading: reading,
        lastError: null
      }
    }
    return {
      connected: !!this.port?.isOpen,
      simulated: false,
      adapter: cfg.adapter,
      port: cfg.port,
      lastReading: this.lastReading && !this.lastReading.simulated ? this.lastReading : null,
      lastError: this.lastError
    }
  }

  public async readWeight(cfg: AppSettings['scale']): Promise<ScaleReading> {
    if (cfg.adapter === 'simulated') {
      return this.setSimulatedWeight(this.simulatedGrams, this.simulatedStable)
    }
    if (!this.port || !this.port.isOpen) {
      await this.connect(cfg)
    }
    const adapter = SCALE_ADAPTERS[cfg.adapter] ?? GenericAsciiScaleAdapter
    const cmd = cfg.pollCommand || adapter.defaultPollCommand
    if (cmd && this.port?.isOpen) {
      this.port.write(cmd)
    }
    await new Promise((r) => setTimeout(r, 180))
    if (this.lastReading && !this.lastReading.simulated) return this.lastReading
    throw new Error(this.lastError || 'SCALE_NO_DATA')
  }

  public async connect(cfg: AppSettings['scale']): Promise<ScaleStatus> {
    await this.disconnect()
    this.lastError = null
    if (cfg.adapter === 'simulated') {
      this.setSimulatedWeight(this.simulatedGrams, true)
      return this.getStatus(cfg)
    }
    if (!cfg.port) {
      this.lastError = 'SCALE_PORT_REQUIRED'
      throw new Error('SCALE_PORT_REQUIRED')
    }
    const adapter = SCALE_ADAPTERS[cfg.adapter] ?? GenericAsciiScaleAdapter
    await new Promise<void>((resolve, reject) => {
      const sp = new SerialPort(
        {
          path: cfg.port,
          baudRate: cfg.baudRate,
          dataBits: cfg.dataBits,
          parity: cfg.parity,
          stopBits: cfg.stopBits,
          autoOpen: false
        },
        (err) => {
          if (err) reject(err)
        }
      )
      sp.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('ascii')
        const parts = this.buffer.split(/[\r\n]+/)
        this.buffer = parts.pop() ?? ''
        for (const frame of parts) {
          const parsed = adapter.parseFrame(frame, cfg.weightUnit)
          if (parsed) {
            this.emit({
              weightGrams: parsed.weightGrams,
              weightKg: Number((parsed.weightGrams / 1000).toFixed(3)),
              stable: parsed.stable,
              simulated: false,
              adapter: cfg.adapter,
              raw: frame.trim(),
              timestamp: new Date().toISOString()
            })
          }
        }
      })
      sp.on('error', (e) => {
        this.lastError = e.message
      })
      sp.on('close', () => {
        if (this.pollTimer) {
          clearInterval(this.pollTimer)
          this.pollTimer = null
        }
      })
      sp.open((err) => {
        if (err) {
          this.lastError = err.message
          reject(err)
          return
        }
        this.port = sp
        const cmd = cfg.pollCommand || adapter.defaultPollCommand
        if (cmd) {
          this.pollTimer = setInterval(() => {
            if (this.port?.isOpen) this.port.write(cmd)
          }, Math.max(150, cfg.pollIntervalMs || 300))
        }
        resolve()
      })
    })
    return this.getStatus(cfg)
  }

  public async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.port) {
      const p = this.port
      this.port = null
      if (p.isOpen) {
        await new Promise<void>((resolve) => p.close(() => resolve()))
      }
    }
  }

  public async testConnection(cfg: AppSettings['scale']): Promise<{
    ok: boolean
    simulated: boolean
    reading: ScaleReading | null
    message: string
  }> {
    try {
      if (cfg.adapter === 'simulated') {
        const r = this.setSimulatedWeight(this.simulatedGrams, true)
        return {
          ok: true,
          simulated: true,
          reading: r,
          message: 'Mode balance simulée actif (aucune balance matérielle connectée).'
        }
      }
      await this.connect(cfg)
      try {
        const r = await this.readWeight(cfg)
        return { ok: true, simulated: false, reading: r, message: `Connecté sur ${cfg.port}` }
      } catch {
        return {
          ok: true,
          simulated: false,
          reading: null,
          message: `Port ${cfg.port} ouvert. En attente d'une trame de pesée de la balance.`
        }
      }
    } catch (e) {
      return {
        ok: false,
        simulated: cfg.adapter === 'simulated',
        reading: null,
        message: (e as Error).message
      }
    }
  }
}

export const scaleService = new ScaleService()
