import type { ReactNode } from 'react'

interface ButtonProps {
  children: ReactNode
  onClick(): void
  active?: boolean
  primary?: boolean
  disabled?: boolean
  title?: string
}

export function ControlButton({ children, onClick, active, primary, disabled, title }: ButtonProps) {
  const tone = primary
    ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25'
    : active
      ? 'border-cyan-300/50 bg-cyan-300/10 text-cyan-100'
      : 'border-white/10 bg-white/[0.03] text-cyan-100/70 hover:border-cyan-300/40 hover:text-cyan-100'
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 font-mono text-[11px] font-semibold tracking-[0.14em] whitespace-nowrap transition-colors duration-200 disabled:pointer-events-none disabled:opacity-30 sm:px-4 ${tone}`}
    >
      {children}
    </button>
  )
}

export function ControlBar({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-auto mx-auto max-w-full rounded-full border border-white/10 bg-black/50 p-1.5 shadow-[0_0_40px_rgba(34,211,238,0.08)] backdrop-blur-md">
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">{children}</div>
    </div>
  )
}
