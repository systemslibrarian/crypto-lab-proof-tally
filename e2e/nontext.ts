import type { Page } from '@playwright/test'

export interface NonTextFailure {
  selector: string
  detail: string
  ratio: number
}

export async function auditNonText(page: Page): Promise<NonTextFailure[]> {
  return page.evaluate(() => {
    interface Rgb { r: number; g: number; b: number; a: number }
    const parse = (value: string): Rgb | null => {
      const match = value.match(/rgba?\((\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\)/)
      return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) } : null
    }
    const luminance = (color: Rgb): number => {
      const linear = (channel: number): number => {
        const value = channel / 255
        return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
      }
      return .2126 * linear(color.r) + .7152 * linear(color.g) + .0722 * linear(color.b)
    }
    const ratio = (left: Rgb, right: Rgb): number => {
      const first = luminance(left)
      const second = luminance(right)
      return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
    }
    const selector = (element: Element): string => element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}.${Array.from(element.classList).join('.')}`
    const failures: NonTextFailure[] = []
    const controls = Array.from(document.querySelectorAll('button,input,summary,a.cl-btn'))
    for (const control of controls) {
      if (!(control as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue
      if (control instanceof HTMLInputElement && control.type === 'checkbox') continue
      const style = getComputedStyle(control)
      const parent = control.parentElement ? getComputedStyle(control.parentElement) : getComputedStyle(document.body)
      const outside = parse(parent.backgroundColor)?.a ? parse(parent.backgroundColor) : parse(getComputedStyle(document.body).backgroundColor)
      const fill = parse(style.backgroundColor)
      if (!outside || !fill) continue
      const fillRatio = fill.a > 0 ? ratio(fill, outside) : 0
      const sides = [
        [style.borderTopStyle, style.borderTopWidth, style.borderTopColor],
        [style.borderRightStyle, style.borderRightWidth, style.borderRightColor],
        [style.borderBottomStyle, style.borderBottomWidth, style.borderBottomColor],
        [style.borderLeftStyle, style.borderLeftWidth, style.borderLeftColor],
      ] as const
      const paintedSides = sides.filter(([borderStyle, width, color]) => {
        const parsed = parse(color)
        return borderStyle !== 'none' && Number.parseFloat(width) > 0 && Boolean(parsed?.a)
      })
      if (fill.a === 0 && paintedSides.length === 0) continue
      const borderRatio = paintedSides.reduce((best, [, , color]) => {
        const parsed = parse(color)
        return parsed ? Math.max(best, ratio(parsed, outside)) : best
      }, 0)
      if (fillRatio < 3 && borderRatio < 3) {
        failures.push({ selector: selector(control), detail: `fill ${fillRatio.toFixed(2)}, best painted side ${borderRatio.toFixed(2)}`, ratio: Math.max(fillRatio, borderRatio) })
      }
    }
    return failures
  })
}