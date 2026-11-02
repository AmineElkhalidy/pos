declare module 'bwip-js' {
  export interface RenderOptions {
    bcid: string
    text: string
    scale?: number
    height?: number
    includetext?: boolean
    textxalign?: 'left' | 'center' | 'right'
    backgroundcolor?: string
  }
  export function toBuffer(opts: RenderOptions): Promise<Buffer>
  const bwipjs: {
    toBuffer(opts: RenderOptions): Promise<Buffer>
  }
  export default bwipjs
}

