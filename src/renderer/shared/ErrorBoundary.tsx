/**
 * 渲染层错误边界（v1.5 新增）。
 *
 * 为什么需要：Dock / 音乐卡片都是「隐形点击区不能有」的透明窗口。
 * 旧实现里任何一次渲染抛出（settings 竞态、缺字段、第三方数据异常）都会让 React 卸载整棵树，
 * 结果是屏幕上留下一个看不见、点不掉的空白透明窗，用户只能杀进程。
 * 有了错误边界，至少能看到一句人话 + 一个「重新加载」按钮。
 *
 * 用内联样式：dock / music / settings 三个入口各自只加载自己的 CSS，边界组件必须自包含。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** 出问题时显示在提示里的窗口名（Dock / 音乐卡片 / 设置） */
  name: string
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.name}] 渲染异常：`, error, info.componentStack)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 8,
          margin: 6,
          padding: '10px 12px',
          borderRadius: 12,
          background: 'rgba(24, 26, 33, 0.92)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          color: '#f2f4f8',
          font: '500 12px/1.5 "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif',
          boxShadow: '0 10px 28px rgba(0, 0, 0, 0.42)',
          maxWidth: 320,
          WebkitAppRegion: 'no-drag'
        } as React.CSSProperties}
      >
        <span style={{ fontWeight: 600 }}>{this.props.name}渲染出错</span>
        <span style={{ color: 'rgba(242, 244, 248, 0.72)', fontSize: 11 }}>{error.message}</span>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            marginTop: 2,
            padding: '4px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.18)',
            background: 'rgba(255, 255, 255, 0.1)',
            color: '#f2f4f8',
            font: 'inherit',
            cursor: 'pointer'
          }}
        >
          重新加载
        </button>
      </div>
    )
  }
}
