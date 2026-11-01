import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { spawnRipple } from './motion'

/* ---------- 基础控件（设置面板/音乐卡片复用） ---------- */

export function Button(props: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  title?: string
  className?: string
  disabled?: boolean
}): React.JSX.Element {
  const { children, onClick, variant = 'default', size = 'md', title, className = '', disabled = false } = props
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
        if (disabled) return
        spawnRipple(event.currentTarget, event)
      }}
      className={`ui-btn ui-btn-${variant} ui-btn-${size} nx-no-drag nx-ripple-host nx-pressable ${className}`}
    >
      {children}
    </button>
  )
}

export function Switch(props: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  hint?: string
  disabled?: boolean
}): React.JSX.Element {
  const { checked, onChange, label, hint, disabled = false } = props
  const toggle = (): void => {
    if (!disabled) onChange(!checked)
  }
  return (
    <label className={`ui-row${disabled ? ' is-disabled' : ''}`}>
      <span className="ui-row-label">
        {label}
        {hint ? <span className="ui-row-hint">{hint}</span> : null}
      </span>
      <span
        className={`ui-switch nx-ripple-host${checked ? ' is-on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(event: ReactPointerEvent<HTMLSpanElement>) => {
          if (!disabled) spawnRipple(event.currentTarget, event, { scale: 3.4 })
        }}
        onClick={toggle}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggle()
          }
        }}
      >
        <span className="ui-switch-knob" />
      </span>
    </label>
  )
}

export function Slider(props: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  label: string
  hint?: string
  format?: (v: number) => string
  disabled?: boolean
}): React.JSX.Element {
  const { value, min, max, step = 1, onChange, label, hint, format, disabled = false } = props
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={`ui-field${disabled ? ' is-disabled' : ''}`}>
      <div className="ui-field-head">
        <span className="ui-row-label">
          {label}
          {hint ? <span className="ui-row-hint">{hint}</span> : null}
        </span>
        <span className="ui-field-value">{format ? format(value) : value}</span>
      </div>
      <input
        className="ui-slider nx-no-drag"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (v: T) => void
  label?: string
  disabled?: boolean
}): React.JSX.Element {
  const { value, options, onChange, label, disabled = false } = props
  return (
    <div className="ui-field">
      {label ? <div className="ui-field-head"><span className="ui-row-label">{label}</span></div> : null}
      <div className="ui-segmented nx-no-drag" role="tablist">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={o.value === value}
            disabled={disabled}
            className={`ui-seg nx-ripple-host nx-pressable ${o.value === value ? 'is-active' : ''}`}
            onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
              if (!disabled) spawnRipple(event.currentTarget, event)
            }}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Section(props: { title: string; desc?: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="ui-section">
      <header className="ui-section-head">
        <h2>{props.title}</h2>
        {props.desc ? <p>{props.desc}</p> : null}
      </header>
      <div className="ui-section-body">{props.children}</div>
    </section>
  )
}

export function Row(props: { label: string; hint?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-row">
      <span className="ui-row-label">
        {props.label}
        {props.hint ? <span className="ui-row-hint">{props.hint}</span> : null}
      </span>
      <div className="ui-row-control">{props.children}</div>
    </div>
  )
}
