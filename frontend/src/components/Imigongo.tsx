export function ImigongoBand({ className = '' }: { className?: string }) {
  return (
    <div className={`imigongo-band w-full ${className}`} role="presentation" aria-hidden="true" />
  )
}

export function ImigongoTile({ className = '' }: { className?: string }) {
  return <div className={`imigongo-tile ${className}`} role="presentation" aria-hidden="true" />
}
