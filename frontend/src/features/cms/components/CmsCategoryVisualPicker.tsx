import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ConsoleDropdown from '../../../components/ConsoleDropdown'
import type { CmsCategoryNode } from '../types'

type CmsCategoryVisualPickerProps = {
  items: CmsCategoryNode[]
  selectedId: string
  onSelect: (categoryId: string) => void
  mode?: 'select' | 'manage'
  disabled?: boolean
  onRefresh?: () => Promise<void> | void
  refreshDisabled?: boolean
  onCreateRoot?: (name: string) => Promise<void>
  onCreateChild?: (parentId: string, name: string) => Promise<void>
  onUpdateCategory?: (categoryId: string, name: string, parentId: string) => Promise<void>
  onDeleteCategory?: (category: CmsCategoryNode) => Promise<void>
}

type FlatCategoryOption = {
  id: string
  name: string
  depth: number
}

type CategoryLine = {
  path: string
  isActive: boolean
}

type CategoryConnection = {
  parentId: string
  childId: string
}

type ElementBox = {
  left: number
  top: number
  width: number
  height: number
  right: number
}

function findCategoryById(items: CmsCategoryNode[], categoryId: string): CmsCategoryNode | null {
  for (const item of items) {
    if (item.id === categoryId) {
      return item
    }
    const child = findCategoryById(item.children, categoryId)
    if (child !== null) {
      return child
    }
  }
  return null
}

function findCategoryPath(items: CmsCategoryNode[], categoryId: string): CmsCategoryNode[] {
  for (const item of items) {
    if (item.id === categoryId) {
      return [item]
    }

    const childPath = findCategoryPath(item.children, categoryId)
    if (childPath.length > 0) {
      return [item, ...childPath]
    }
  }

  return []
}

function flattenCategoryTree(items: CmsCategoryNode[], depth = 0): FlatCategoryOption[] {
  const flattened: FlatCategoryOption[] = []

  for (const item of items) {
    flattened.push({
      id: item.id,
      name: item.name,
      depth,
    })
    flattened.push(...flattenCategoryTree(item.children, depth + 1))
  }

  return flattened
}

function collectDescendantIds(item: CmsCategoryNode): Set<string> {
  const ids = new Set<string>()

  for (const child of item.children) {
    ids.add(child.id)
    for (const descendantId of collectDescendantIds(child)) {
      ids.add(descendantId)
    }
  }

  return ids
}

function buildTreeConnections(items: CmsCategoryNode[]): CategoryConnection[] {
  const connections: CategoryConnection[] = []

  function walk(nodes: CmsCategoryNode[]): void {
    for (const item of nodes) {
      for (const child of item.children) {
        connections.push({
          parentId: item.id,
          childId: child.id,
        })
      }
      walk(item.children)
    }
  }

  walk(items)
  return connections
}

function getElementBox(element: HTMLElement, container: HTMLElement): ElementBox {
  let left = 0
  let top = 0
  let current: HTMLElement | null = element

  while (current !== null && current !== container) {
    left += current.offsetLeft
    top += current.offsetTop
    current = current.offsetParent as HTMLElement | null
  }

  const width = element.offsetWidth
  const height = element.offsetHeight

  return {
    left,
    top,
    width,
    height,
    right: left + width,
  }
}

function buildCurvePath(parentBox: ElementBox, childBox: ElementBox): string {
  const startX = parentBox.right
  const startY = parentBox.top + parentBox.height / 2
  const endX = childBox.left
  const endY = childBox.top + childBox.height / 2
  const controlOffset = Math.max((endX - startX) * 0.42, 2)

  return [
    `M ${startX} ${startY}`,
    `C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`,
  ].join(' ')
}

function clampScale(value: number): number {
  return Math.min(Math.max(value, 0.55), 2.4)
}

function getTouchDistance(touches: TouchList): number {
  if (touches.length < 2) {
    return 0
  }

  const deltaX = touches[0].clientX - touches[1].clientX
  const deltaY = touches[0].clientY - touches[1].clientY
  return Math.hypot(deltaX, deltaY)
}

function getTouchMidpoint(touches: TouchList): { x: number; y: number } {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  }
}

export default function CmsCategoryVisualPicker({
  items,
  selectedId,
  onSelect,
  mode = 'select',
  disabled = false,
  onRefresh,
  refreshDisabled = false,
  onCreateRoot,
  onCreateChild,
  onUpdateCategory,
  onDeleteCategory,
}: CmsCategoryVisualPickerProps) {
  const previewRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const zoomScaleRef = useRef(1)
  const pinchStateRef = useRef<{ distance: number; scale: number } | null>(null)
  const dragStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)

  const [lines, setLines] = useState<CategoryLine[]>([])
  const [hoveredCategoryId, setHoveredCategoryId] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState('')
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [editingParentId, setEditingParentId] = useState('')
  const [addingRootActive, setAddingRootActive] = useState(false)
  const [addingRootName, setAddingRootName] = useState('')
  const [addingChildParentId, setAddingChildParentId] = useState('')
  const [addingChildName, setAddingChildName] = useState('')
  const [zoomScale, setZoomScale] = useState(1)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false)

  const flatCategories = useMemo(() => flattenCategoryTree(items), [items])
  const selectedPath = useMemo(() => {
    if (selectedId.trim() === '') {
      return []
    }
    return findCategoryPath(items, selectedId)
  }, [items, selectedId])
  const selectedPathText = selectedPath.length > 0
    ? selectedPath.map((category) => category.name).join(' > ')
    : 'カテゴリーを選択してください。'

  useEffect(() => {
    zoomScaleRef.current = zoomScale
  }, [zoomScale])

  useEffect(() => {
    if (hoveredCategoryId !== '' && !flatCategories.some((category) => category.id === hoveredCategoryId)) {
      setHoveredCategoryId('')
    }
  }, [flatCategories, hoveredCategoryId])

  const connections = useMemo(() => buildTreeConnections(items), [items])
  const highlightedCategoryIds = useMemo(() => {
    if (hoveredCategoryId === '') {
      return new Set<string>()
    }

    const hoveredNode = findCategoryById(items, hoveredCategoryId)
    if (hoveredNode === null) {
      return new Set<string>()
    }

    const path = findCategoryPath(items, hoveredCategoryId)
    const ids = new Set<string>(path.map((node) => node.id))
    for (const descendantId of collectDescendantIds(hoveredNode)) {
      ids.add(descendantId)
    }
    return ids
  }, [hoveredCategoryId, items])
  const activeConnectionKeys = useMemo(() => {
    if (hoveredCategoryId === '') {
      return new Set<string>()
    }

    return new Set(
      connections
        .filter(
          (connection) =>
            highlightedCategoryIds.has(connection.parentId) &&
            highlightedCategoryIds.has(connection.childId),
        )
        .map((connection) => `${connection.parentId}:${connection.childId}`),
    )
  }, [connections, highlightedCategoryIds, hoveredCategoryId])

  useLayoutEffect(() => {
    const canvasElement = canvasRef.current
    if (canvasElement === null) {
      return
    }

    function updateCanvasSize(): void {
      setCanvasSize({
        width: canvasElement.offsetWidth,
        height: canvasElement.offsetHeight,
      })
    }

    updateCanvasSize()

    const observer = new ResizeObserver(() => {
      updateCanvasSize()
    })
    observer.observe(canvasElement)

    return () => {
      observer.disconnect()
    }
  }, [items, editingCategoryId, addingChildParentId, addingRootActive, zoomScale])

  useLayoutEffect(() => {
    function updateLinePaths(): void {
      const canvasElement = canvasRef.current
      if (canvasElement === null) {
        setLines([])
        return
      }

      const nextLines: CategoryLine[] = []

      for (const connection of connections) {
        const parentElement = itemRefs.current[connection.parentId]
        const childElement = itemRefs.current[connection.childId]
        if (parentElement === null || parentElement === undefined || childElement === null || childElement === undefined) {
          continue
        }

        nextLines.push({
          path: buildCurvePath(
            getElementBox(parentElement, canvasElement),
            getElementBox(childElement, canvasElement),
          ),
          isActive: activeConnectionKeys.has(`${connection.parentId}:${connection.childId}`),
        })
      }

      setLines(nextLines)
    }

    updateLinePaths()

    if (typeof window === 'undefined') {
      return
    }

    window.addEventListener('resize', updateLinePaths)
    return () => {
      window.removeEventListener('resize', updateLinePaths)
    }
  }, [activeConnectionKeys, connections, editingCategoryId, hoveredCategoryId, items, zoomScale])

  function applyZoom(nextScale: number, clientX: number, clientY: number): void {
    const viewportElement = previewRef.current
    if (viewportElement === null) {
      return
    }

    const clampedScale = clampScale(nextScale)
    const viewportRect = viewportElement.getBoundingClientRect()
    const offsetX = clientX - viewportRect.left + viewportElement.scrollLeft
    const offsetY = clientY - viewportRect.top + viewportElement.scrollTop
    const contentX = offsetX / zoomScaleRef.current
    const contentY = offsetY / zoomScaleRef.current

    setZoomScale(clampedScale)

    window.requestAnimationFrame(() => {
      viewportElement.scrollLeft = contentX * clampedScale - (clientX - viewportRect.left)
      viewportElement.scrollTop = contentY * clampedScale - (clientY - viewportRect.top)
    })
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false
    }

    return target.closest('button, input, select, textarea, a, label, .cms-category-pill') !== null
  }

  useEffect(() => {
    const viewportElement = previewRef.current
    if (viewportElement === null) {
      return
    }

    function handleWheel(event: WheelEvent): void {
      if (isInteractiveTarget(event.target)) {
        return
      }

      event.preventDefault()
      applyZoom(
        zoomScaleRef.current * Math.exp(-event.deltaY * 0.0025),
        event.clientX,
        event.clientY,
      )
    }

    function handleTouchStart(event: TouchEvent): void {
      if (event.touches.length === 2) {
        pinchStateRef.current = {
          distance: getTouchDistance(event.touches),
          scale: zoomScaleRef.current,
        }
      }
    }

    function handleTouchMove(event: TouchEvent): void {
      if (event.touches.length !== 2 || pinchStateRef.current === null) {
        return
      }

      event.preventDefault()
      const nextDistance = getTouchDistance(event.touches)
      const midpoint = getTouchMidpoint(event.touches)
      applyZoom(
        pinchStateRef.current.scale * (nextDistance / pinchStateRef.current.distance),
        midpoint.x,
        midpoint.y,
      )
    }

    function handleTouchEnd(): void {
      pinchStateRef.current = null
    }

    viewportElement.addEventListener('wheel', handleWheel, { passive: false })
    viewportElement.addEventListener('touchstart', handleTouchStart, { passive: true })
    viewportElement.addEventListener('touchmove', handleTouchMove, { passive: false })
    viewportElement.addEventListener('touchend', handleTouchEnd, { passive: true })
    viewportElement.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      viewportElement.removeEventListener('wheel', handleWheel)
      viewportElement.removeEventListener('touchstart', handleTouchStart)
      viewportElement.removeEventListener('touchmove', handleTouchMove)
      viewportElement.removeEventListener('touchend', handleTouchEnd)
      viewportElement.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [])

  async function submitRootCreate(): Promise<void> {
    if (onCreateRoot === undefined) {
      return
    }

    const normalized = addingRootName.trim()
    if (normalized === '') {
      return
    }

    await onCreateRoot(normalized)
    setAddingRootName('')
    setAddingRootActive(false)
  }

  async function submitChildCreate(parentId: string): Promise<void> {
    if (onCreateChild === undefined) {
      return
    }

    const normalized = addingChildName.trim()
    if (normalized === '') {
      return
    }

    await onCreateChild(parentId, normalized)
    setAddingChildParentId('')
    setAddingChildName('')
  }

  function startEdit(category: CmsCategoryNode): void {
    setEditingCategoryId(category.id)
    setEditingCategoryName(category.name)
    setEditingParentId(category.parent_id ?? '')
  }

  function cancelEdit(): void {
    setEditingCategoryId('')
    setEditingCategoryName('')
    setEditingParentId('')
  }

  async function submitEdit(categoryId: string): Promise<void> {
    if (onUpdateCategory === undefined) {
      return
    }

    const normalized = editingCategoryName.trim()
    if (normalized === '') {
      return
    }

    await onUpdateCategory(categoryId, normalized, editingParentId)
    cancelEdit()
  }

  function renderManageActions(category: CmsCategoryNode): JSX.Element | null {
    if (mode !== 'manage') {
      return null
    }

    return (
      <div className="cms-category-pill-actions">
        {onCreateChild !== undefined && (
          <button
            type="button"
            className={`cms-category-pill-action${addingChildParentId === category.id ? ' is-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              if (addingChildParentId === category.id) {
                setAddingChildParentId('')
                setAddingChildName('')
                return
              }
              setAddingChildParentId(category.id)
              setAddingChildName('')
            }}
            disabled={disabled}
          >
            <i className="bi bi-plus-lg" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="cms-category-pill-action"
          onClick={(event) => {
            event.stopPropagation()
            startEdit(category)
          }}
          disabled={disabled}
        >
          <i className="bi bi-pencil" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cms-category-pill-action is-danger"
          onClick={(event) => {
            event.stopPropagation()
            void onDeleteCategory?.(category)
          }}
          disabled={disabled}
        >
          <i className="bi bi-trash" aria-hidden="true" />
        </button>
      </div>
    )
  }

  function renderCategoryItem(item: CmsCategoryNode): JSX.Element {
    const isEditing = editingCategoryId === item.id
    const excludedIds = isEditing ? collectDescendantIds(item) : new Set<string>()
    const selectableParents = flatCategories.filter(
      (category) => category.id !== item.id && !excludedIds.has(category.id),
    )
    const selectedClass = mode === 'select' && selectedId === item.id ? ' is-selected' : ''
    const currentClass = selectedId === item.id ? ' is-current' : ''

    return (
      <div
        key={item.id}
        ref={(element) => {
          itemRefs.current[item.id] = element
        }}
        className={`cms-category-pill is-manage cms-category-tree-pill${selectedClass}${currentClass}${isEditing ? ' is-editing' : ''}${highlightedCategoryIds.has(item.id) ? ' is-related' : ''}`}
        onClick={() => {
          if (!isEditing) {
            onSelect(item.id)
          }
        }}
        onMouseEnter={() => {
          setHoveredCategoryId(item.id)
        }}
        onMouseLeave={() => setHoveredCategoryId('')}
      >
        {isEditing ? (
          <div className="cms-category-pill-editor">
            <ConsoleDropdown
              className="cms-category-pill-select"
              value={editingParentId}
              options={[
                { value: '', label: 'ルート' },
                ...selectableParents.map((category) => ({
                  value: category.id,
                  label: `${'　'.repeat(category.depth)}${category.name}`,
                })),
              ]}
              onChange={(nextValue) => setEditingParentId(nextValue)}
            />
            <input
              className="cms-category-pill-input form-control"
              value={editingCategoryName}
              onChange={(event) => setEditingCategoryName(event.target.value)}
              placeholder="カテゴリ名"
            />
            <div className="cms-category-pill-actions">
              <button
                type="button"
                className="cms-category-pill-action"
                onClick={(event) => {
                  event.stopPropagation()
                  void submitEdit(item.id)
                }}
              >
                <i className="bi bi-check" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="cms-category-pill-action is-ghost"
                onClick={(event) => {
                  event.stopPropagation()
                  cancelEdit()
                }}
              >
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : (
          <>
            <span className="cms-category-pill-label">{item.name}</span>
            {renderManageActions(item)}
          </>
        )}
      </div>
    )
  }

  function renderRootCreateControl(): JSX.Element | null {
    if (mode !== 'manage' || onCreateRoot === undefined) {
      return null
    }

    if (!addingRootActive) {
      return (
        <div className="cms-category-root-create">
          <button
            type="button"
            className="console-secondary console-icon-button"
            onClick={() => {
              setAddingRootActive(true)
            }}
          >
            <i className="bi bi-plus-lg" aria-hidden="true" />
            親カテゴリを追加
          </button>
        </div>
      )
    }

    return (
      <div className="cms-category-inline-create is-root">
        <input
          className="cms-category-pill-input form-control"
          value={addingRootName}
          onChange={(event) => setAddingRootName(event.target.value)}
          placeholder="カテゴリ名"
        />
        <div className="cms-category-pill-actions">
          <button
            type="button"
            className="cms-category-pill-action"
            onClick={() => void submitRootCreate()}
          >
            <i className="bi bi-check" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cms-category-pill-action is-ghost"
            onClick={() => {
              setAddingRootActive(false)
              setAddingRootName('')
            }}
          >
            <i className="bi bi-x" aria-hidden="true" />
          </button>
        </div>
      </div>
    )
  }

  function renderChildCreateControl(parentNode: CmsCategoryNode): JSX.Element | null {
    if (mode !== 'manage' || onCreateChild === undefined || addingChildParentId !== parentNode.id) {
      return null
    }

    return (
      <div className="cms-category-inline-create">
        <input
          className="cms-category-pill-input form-control"
          value={addingChildName}
          onChange={(event) => setAddingChildName(event.target.value)}
          placeholder="カテゴリ名"
        />
        <div className="cms-category-pill-actions">
          <button
            type="button"
            className="cms-category-pill-action"
            onClick={() => void submitChildCreate(parentNode.id)}
          >
            <i className="bi bi-check" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cms-category-pill-action is-ghost"
            onClick={() => {
              setAddingChildParentId('')
              setAddingChildName('')
            }}
          >
            <i className="bi bi-x" aria-hidden="true" />
          </button>
        </div>
      </div>
    )
  }

  function renderBranch(item: CmsCategoryNode): JSX.Element {
    return (
      <div key={item.id} className="cms-category-branch">
        <div className="cms-category-node-stack cms-category-tree-body">
          {renderCategoryItem(item)}
          {renderChildCreateControl(item)}
        </div>
        {item.children.length > 0 && (
          <div className="cms-category-branch-children">
            {item.children.map((child) => renderBranch(child))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="cms-category-picker-shell">
      <div className={`cms-category-selected-path${selectedPath.length > 0 ? ' has-selection' : ''}`}>
        <span className="cms-category-selected-path-label">選択中のカテゴリー</span>
        <strong className="cms-category-selected-path-value">{selectedPathText}</strong>
      </div>
      <div
        className={`cms-category-preview-frame${mode === 'manage' && onRefresh !== undefined ? ' has-refresh-button' : ''}`}
      >
        <div
          ref={previewRef}
          className={`cms-category-preview cms-category-visual-picker${isDraggingCanvas ? ' is-dragging' : ''}`}
          onMouseLeave={() => {
            setHoveredCategoryId('')
          }}
          onPointerDown={(event) => {
            if (event.pointerType !== 'mouse' || event.button !== 0 || isInteractiveTarget(event.target)) {
              return
            }

            const viewportElement = previewRef.current
            if (viewportElement === null) {
              return
            }

            dragStateRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              scrollLeft: viewportElement.scrollLeft,
              scrollTop: viewportElement.scrollTop,
            }
            setIsDraggingCanvas(true)
            viewportElement.setPointerCapture(event.pointerId)
            event.preventDefault()
          }}
          onPointerMove={(event) => {
            const viewportElement = previewRef.current
            const dragState = dragStateRef.current
            if (viewportElement === null || dragState === null || dragState.pointerId !== event.pointerId) {
              return
            }

            viewportElement.scrollLeft = dragState.scrollLeft - (event.clientX - dragState.startX)
            viewportElement.scrollTop = dragState.scrollTop - (event.clientY - dragState.startY)
          }}
          onPointerUp={(event) => {
            const viewportElement = previewRef.current
            if (dragStateRef.current?.pointerId !== event.pointerId) {
              return
            }

            dragStateRef.current = null
            setIsDraggingCanvas(false)
            viewportElement?.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={(event) => {
            const viewportElement = previewRef.current
            if (dragStateRef.current?.pointerId !== event.pointerId) {
              return
            }

            dragStateRef.current = null
            setIsDraggingCanvas(false)
            viewportElement?.releasePointerCapture(event.pointerId)
          }}
        >
          <div
            className="cms-category-zoom-stage"
            style={{
              width: `${Math.max(canvasSize.width * zoomScale, canvasSize.width)}px`,
              height: `${Math.max(canvasSize.height * zoomScale, canvasSize.height)}px`,
            }}
          >
            <div
              ref={canvasRef}
              className="cms-category-canvas"
              style={{
                transform: `scale(${zoomScale})`,
                transformOrigin: 'top left',
              }}
            >
              <svg className="cms-category-lines" aria-hidden="true">
                {lines.map((line, index) => (
                  <path
                    key={`${line.path}-${index}`}
                    d={line.path}
                    className={line.isActive ? 'is-active' : 'is-muted'}
                  />
                ))}
              </svg>

              <div className="cms-category-root-list">
                {items.length === 0 ? (
                  <div className="console-placeholder">カテゴリがありません。</div>
                ) : (
                  items.map((item) => renderBranch(item))
                )}
                {renderRootCreateControl()}
              </div>
            </div>
          </div>
        </div>
        <div className="cms-category-gesture-hint" aria-hidden="true">
          <div className="cms-category-gesture-hint-icons">
            <span className="cms-category-gesture-hint-icon is-touch">
              <i className="bi bi-phone" />
              <i className="bi bi-arrows-angle-expand cms-category-gesture-zoom-icon" />
            </span>
            <span className="cms-category-gesture-hint-icon is-pointer">
              <i className="bi bi-mouse" />
              <i className="bi bi-arrows-angle-expand cms-category-gesture-zoom-icon" />
            </span>
          </div>
          <span className="cms-category-gesture-hint-copy">ピンチ / ホイールで拡大縮小</span>
        </div>
        {mode === 'manage' && onRefresh !== undefined && (
          <button
            type="button"
            className="console-secondary console-icon-button cms-category-refresh-button"
            onClick={() => {
              void onRefresh()
            }}
            disabled={refreshDisabled}
          >
            <i className="bi bi-arrow-clockwise" aria-hidden="true" />
            更新
          </button>
        )}
      </div>
    </div>
  )
}
