import { useState } from 'react'
import { X } from 'lucide-react'

interface NavItem {
  name: string
  icon: React.ComponentType<{ className?: string }>
  href: string
}

interface CircularNavigationProps {
  navItems: NavItem[]
  isOpen: boolean
  toggleMenu: () => void
  onSelect?: (name: string) => void
}

export default function CircularNavigation({
  navItems,
  isOpen,
  toggleMenu,
  onSelect,
}: CircularNavigationProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  if (!isOpen) return null

  return (
    <div
      className="menu-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/80"
      onClick={toggleMenu}
    >
      <div
        className="menu-circle relative flex aspect-square w-[420px] max-w-[90vw] items-center justify-center rounded-full"
        style={{
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow:
            'inset 2px 2px 2px rgba(255,255,255,0.5), inset -1px -1px 1px rgba(255,255,255,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={toggleMenu}
          aria-label="Close navigation"
          className="absolute z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white text-black"
        >
          <X className="h-6 w-6" />
        </button>

        {navItems.map((item, index) => {
          const Icon = item.icon
          const angle = (360 / navItems.length) * index

          return (
            <div
              key={item.name}
              className="absolute"
              style={{
                transform: `rotate(${angle}deg) translate(150px) rotate(-${angle}deg)`,
              }}
            >
              <a
                href={item.href}
                className={`flex h-20 w-20 flex-col items-center justify-center rounded-full no-underline transition-colors duration-200 ${
                  hoveredItem === item.name ? 'bg-white text-black' : 'text-white'
                }`}
                onMouseEnter={() => setHoveredItem(item.name)}
                onMouseLeave={() => setHoveredItem(null)}
                onClick={(e) => {
                  e.preventDefault()
                  onSelect?.(item.name)
                  toggleMenu()
                }}
              >
                <Icon className="mb-1 h-6 w-6" />
                <span className="text-xs font-medium">{item.name}</span>
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}
