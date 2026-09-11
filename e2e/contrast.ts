import type { Page } from '@playwright/test'

export interface ContrastFailure {
  selector: string
  text: string
  ratio: number
  required: number
}

export async function auditContrast(page: Page): Promise<ContrastFailure[]> {
  return page.evaluate(() => {
    interface Rgba { r: number; g: number; b: number; a: number }

    const parse = (value: string): Rgba | null => {
      const match = value.match(/rgba?\((\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\)/)
      if (!match) return null
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) }
    }
    const over = (source: Rgba, destination: Rgba): Rgba => {
      const alpha = source.a + destination.a * (1 - source.a)
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
      return {
        r: (source.r * source.a + destination.r * destination.a * (1 - source.a)) / alpha,
        g: (source.g * source.a + destination.g * destination.a * (1 - source.a)) / alpha,
        b: (source.b * source.a + destination.b * destination.a * (1 - source.a)) / alpha,
        a: alpha,
      }
    }
    const backdrop = (element: Element): Rgba => {
      const layers: Rgba[] = []
      for (let current: Element | null = element; current; current = current.parentElement) {
        const color = parse(getComputedStyle(current).backgroundColor)
        if (color && color.a > 0) layers.push(color)
      }
      return layers.reverse().reduce((result, layer) => over(layer, result), { r: 9, g: 13, b: 12, a: 1 })
    }
    const luminance = (color: Rgba): number => {
      const linear = (channel: number): number => {
        const value = channel / 255
        return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
      }
      return .2126 * linear(color.r) + .7152 * linear(color.g) + .0722 * linear(color.b)
    }
    const ratio = (left: Rgba, right: Rgba): number => {
      const first = luminance(left)
      const second = luminance(right)
      return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
    }
    const selector = (element: Element): string => {
      if (element.id) return `#${element.id}`
      const classes = Array.from(element.classList).slice(0, 2).join('.')
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`
    }

    const failures: ContrastFailure[] = []
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const ownText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .trim()
      if (!ownText || !(element as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue
      const style = getComputedStyle(element)
      const foreground = parse(style.color)
      if (!foreground) continue
      const background = backdrop(element)
      const paintedForeground = over({ ...foreground, a: foreground.a * Number(style.opacity) }, background)
      const measured = ratio(paintedForeground, background)
      const large = Number.parseFloat(style.fontSize) >= 24 || (Number.parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700)
      const required = large ? 3 : 4.5
      if (measured + .01 < required) failures.push({ selector: selector(element), text: ownText.slice(0, 80), ratio: measured, required })
    }
    return failures
  })
}

export function formatContrastFailures(failures: readonly ContrastFailure[]): string {
  return failures.map((failure) => `${failure.selector} ${failure.ratio.toFixed(2)}:${failure.required} "${failure.text}"`).join('\n')
}