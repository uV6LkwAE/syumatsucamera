import {
  CSSProperties,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

export type ConsoleDropdownValue = string | number

export type ConsoleDropdownOption<T extends ConsoleDropdownValue = string> = {
  value: T
  label: string
  disabled?: boolean
}

type ConsoleDropdownProps<T extends ConsoleDropdownValue> = {
  id?: string
  name?: string
  value: T
  options: Array<ConsoleDropdownOption<T>>
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
  toggleClassName?: string
  menuClassName?: string
  fullWidth?: boolean
  placeholder?: string
}

export default function ConsoleDropdown<T extends ConsoleDropdownValue>({
  id,
  name,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  toggleClassName = '',
  menuClassName = '',
  fullWidth = true,
  placeholder = '',
}: ConsoleDropdownProps<T>) {
  const internalId = useId()
  const buttonId = id ?? `console-dropdown-${internalId}`
  const menuId = `${buttonId}-menu`
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  )

  function updateMenuPosition(): void {
    const button = buttonRef.current
    if (button === null) {
      return
    }

    const rect = button.getBoundingClientRect()
    const viewportPadding = 12
    const maxWidth = Math.min(window.innerWidth - viewportPadding * 2, 360)
    const width = Math.min(Math.max(rect.width, 0), maxWidth)
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      window.innerWidth - viewportPadding - width,
    )

    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left,
      minWidth: width,
      maxWidth,
      zIndex: 1080,
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      return
    }
    updateMenuPosition()
  }, [open, options])

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node
      if (rootRef.current?.contains(target) === true) {
        return
      }
      if (menuRef.current?.contains(target) === true) {
        return
      }
      setOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    function handleViewportChange(): void {
      updateMenuPosition()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [open])

  useEffect(() => {
    if (disabled && open) {
      setOpen(false)
    }
  }, [disabled, open])

  const rootClassName = [
    'dropdown',
    'console-dropdown',
    fullWidth ? 'w-100' : '',
    open ? 'show' : '',
    className,
  ]
    .filter((item) => item !== '')
    .join(' ')

  const toggleClassNameMerged = [
    'btn',
    'dropdown-toggle',
    'console-dropdown-toggle',
    'text-start',
    fullWidth ? 'w-100' : '',
    toggleClassName,
  ]
    .filter((item) => item !== '')
    .join(' ')

  const selectedLabel = selectedOption?.label ?? placeholder

  return (
    <div ref={rootRef} className={rootClassName}>
      {name !== undefined && <input type="hidden" name={name} value={String(value)} />}
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className={toggleClassNameMerged}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return
          }
          setOpen((prev) => !prev)
        }}
      >
        <span
          className={`console-dropdown-current${
            selectedOption === undefined && placeholder !== '' ? ' is-placeholder' : ''
          }`}
        >
          {selectedLabel}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className={[
              'dropdown-menu',
              'show',
              'console-dropdown-menu',
              menuClassName,
            ]
              .filter((item) => item !== '')
              .join(' ')}
            style={menuStyle}
            role="listbox"
            aria-labelledby={buttonId}
          >
            {options.map((option) => (
              <button
                key={String(option.value)}
                type="button"
                className={`dropdown-item console-dropdown-item${
                  option.value === value ? ' active' : ''
                }`}
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) {
                    return
                  }
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
