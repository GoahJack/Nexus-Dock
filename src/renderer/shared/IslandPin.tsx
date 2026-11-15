export function IslandPin({ pinned, onClick, className = '' }: {
  pinned: boolean
  onClick: () => void
  className?: string
}): React.JSX.Element {
  const label = pinned ? '取消保持展开' : '保持展开'
  return (
    <button type="button" data-island-pin className={`island-pin nx-no-drag ${className}`} aria-label={label} aria-pressed={pinned} title={label} onClick={onClick}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-4 2-3 6-3-3-6 6-1-1 6-6-3-3 6-3z" /></svg>
    </button>
  )
}
