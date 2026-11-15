export function IslandStatus({ enabled, pinned }: { enabled: boolean; pinned: boolean }): React.JSX.Element {
  return <p className="nx-hint-text" role="status">{!enabled
    ? '动态折叠：未启用，打开上方开关后生效。'
    : pinned
      ? '动态折叠：已固定展开，取消图钉后恢复自动收起。'
      : '动态折叠：已开启，靠近展开、移开后收起。'}</p>
}
