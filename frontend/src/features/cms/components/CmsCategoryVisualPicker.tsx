import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CmsCategoryNode } from '../types'

type CmsCategoryVisualPickerProps = {
  items: CmsCategoryNode[]
  selectedId: string
  onSelect: (categoryId: string) => void
  mode?: 'select' | 'manage'
  disabled?: boolean
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

type ColumnSpec = {
  key: string
  title: string
  parentNode: CmsCategoryNode | null
  items: CmsCategoryNode[]
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

function findRootId(items: CmsCategoryNode[], categoryId: string): string {
  for (const item of items) {
    if (item.id === categoryId) {
      return item.id
    }
    if (findCategoryById(item.children, categoryId) !== null) {
      return item.id
    }
  }
  return items[0]?.id ?? ''
}

function pathMatchesPrefix(path: CmsCategoryNode[], prefix: CmsCategoryNode[]): boolean {
  return prefix.every((node, index) => path[index]?.id === node.id)
}

function pickPreferredChild(
  parentNode: CmsCategoryNode,
  currentPath: CmsCategoryNode[],
  preferredPaths: CmsCategoryNode[][],
): CmsCategoryNode | null {
  for (const preferredPath of preferredPaths) {
    if (preferredPath.length <= currentPath.length) {
      continue
    }
    if (!pathMatchesPrefix(preferredPath, currentPath)) {
      continue
    }

    const candidate = preferredPath[currentPath.length]
    if (candidate !== undefined && parentNode.children.some((child) => child.id === candidate.id)) {
      return candidate
    }
  }

  return parentNode.children[0] ?? null
}

function buildDisplayPath(basePath: CmsCategoryNode[], preferredPaths: CmsCategoryNode[][]): CmsCategoryNode[] {
  if (basePath.length === 0) {
    return []
  }

  const normalizedBasePath =
    basePath.length > 1 && basePath[basePath.length - 1]?.children.length === 0
      ? basePath.slice(0, -1)
      : [...basePath]

  const displayPath = [...normalizedBasePath]
  let currentNode = displayPath[displayPath.length - 1] ?? null

  while (currentNode !== null && currentNode.children.length > 0) {
    const nextNode = pickPreferredChild(currentNode, displayPath, preferredPaths)
    if (nextNode === null || nextNode.children.length === 0) {
      break
    }

    displayPath.push(nextNode)
    currentNode = nextNode
  }

  return displayPath
}

function buildColumnConnections(columns: ColumnSpec[]): CategoryConnection[] {
  const connections: CategoryConnection[] = []

  for (const column of columns) {
    if (column.parentNode === null) {
      continue
    }

    for (const item of column.items) {
      connections.push({
        parentId: column.parentNode.id,
        childId: item.id,
      })
    }
  }

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

  const [lines, setLines] = useState<CategoryLine[]>([])
  const [hoveredCategoryId, setHoveredCategoryId] = useState('')
  const [previewCategoryId, setPreviewCategoryId] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState('')
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [editingParentId, setEditingParentId] = useState('')
  const [addingRootActive, setAddingRootActive] = useState(false)
  const [addingRootName, setAddingRootName] = useState('')
  const [addingChildParentId, setAddingChildParentId] = useState('')
  const [addingChildName, setAddingChildName] = useState('')
  const [zoomScale, setZoomScale] = useState(1)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })

  const flatCategories = useMemo(() => flattenCategoryTree(items), [items])
  const selectedPath = useMemo(() => (selectedId === '' ? [] : findCategoryPath(items, selectedId)), [items, selectedId])
  const previewPath = useMemo(
    () => (previewCategoryId === '' ? [] : findCategoryPath(items, previewCategoryId)),
    [items, previewCategoryId],
  )

  useEffect(() => {
    zoomScaleRef.current = zoomScale
  }, [zoomScale])

  useEffect(() => {
    if (previewCategoryId !== '' && !flatCategories.some((category) => category.id === previewCategoryId)) {
      setPreviewCategoryId('')
    }
    if (hoveredCategoryId !== '' && !flatCategories.some((category) => category.id === hoveredCategoryId)) {
      setHoveredCategoryId('')
    }
  }, [flatCategories, hoveredCategoryId, previewCategoryId])

  const selectedRootId = useMemo(
    () => (selectedId === '' ? items[0]?.id ?? '' : findRootId(items, selectedId)),
    [items, selectedId],
  )
  const previewRootId = useMemo(
    () => (previewCategoryId === '' ? '' : findRootId(items, previewCategoryId)),
    [items, previewCategoryId],
  )
  const activeRootId = previewRootId !== '' ? previewRootId : selectedRootId
  const activeRoot = items.find((item) => item.id === activeRootId) ?? items[0] ?? null
  const selectedPathWithinRoot = useMemo(() => {
    if (activeRoot === null || selectedPath.length === 0 || selectedPath[0]?.id !== activeRoot.id) {
      return activeRoot === null ? [] : [activeRoot]
    }
    return selectedPath
  }, [activeRoot, selectedPath])
  const previewPathWithinRoot = useMemo(() => {
    if (activeRoot === null || previewPath.length === 0 || previewPath[0]?.id !== activeRoot.id) {
      return []
    }
    return previewPath
  }, [activeRoot, previewPath])
  const activePath = useMemo(() => {
    if (previewPathWithinRoot.length > 0) {
      return previewPathWithinRoot
    }
    return selectedPathWithinRoot
  }, [previewPathWithinRoot, selectedPathWithinRoot])
  const displayPath = useMemo(
    () => buildDisplayPath(activePath, [previewPathWithinRoot, selectedPathWithinRoot]),
    [activePath, previewPathWithinRoot, selectedPathWithinRoot],
  )

  const columns = useMemo<ColumnSpec[]>(() => {
    const nextColumns: ColumnSpec[] = [
      {
        key: 'root',
        title: '親カテゴリ',
        parentNode: null,
        items,
      },
    ]

    for (const node of displayPath) {
      nextColumns.push({
        key: node.id,
        title: `${node.name} 配下`,
        parentNode: node,
        items: node.children,
      })
    }

    return nextColumns
  }, [displayPath, items])

  const connections = useMemo(() => buildColumnConnections(columns), [columns])
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
  }, [columns, editingCategoryId, addingChildParentId, addingRootActive, zoomScale])

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
  }, [activeConnectionKeys, columns, connections, editingCategoryId, hoveredCategoryId, zoomScale])

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
      <div className="console-academic-pill-actions">
        <button
          type="button"
          className="console-academic-pill-action"
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
          className="console-academic-pill-action is-danger"
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

    return (
      <div
        key={item.id}
        ref={(element) => {
          itemRefs.current[item.id] = element
        }}
        className={`console-academic-pill is-manage cms-category-tree-pill${selectedClass}${isEditing ? ' is-editing' : ''}${highlightedCategoryIds.has(item.id) ? ' is-related' : ''}`}
        onClick={() => {
          if (!isEditing) {
            onSelect(item.id)
            setPreviewCategoryId(item.id)
          }
        }}
        onMouseEnter={() => {
          setHoveredCategoryId(item.id)
          setPreviewCategoryId(item.id)
        }}
        onMouseLeave={() => setHoveredCategoryId('')}
      >
        {isEditing ? (
          <div className="console-academic-pill-editor">
            <select
              className="console-academic-pill-select"
              value={editingParentId}
              onChange={(event) => setEditingParentId(event.target.value)}
            >
              <option value="">ルート</option>
              {selectableParents.map((category) => (
                <option key={category.id} value={category.id}>
                  {'　'.repeat(category.depth)}
                  {category.name}
                </option>
              ))}
            </select>
            <input
              className="console-academic-pill-input"
              value={editingCategoryName}
              onChange={(event) => setEditingCategoryName(event.target.value)}
              placeholder="カテゴリ名"
            />
            <div className="console-academic-pill-actions">
              <button
                type="button"
                className="console-academic-pill-action"
                onClick={(event) => {
                  event.stopPropagation()
                  void submitEdit(item.id)
                }}
              >
                <i className="bi bi-check" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="console-academic-pill-action is-ghost"
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
            <span className="console-academic-pill-label">{item.name}</span>
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

    return (
      <div
        className="console-academic-pill is-manage is-add"
        onClick={() => {
          if (!addingRootActive) {
            setAddingRootActive(true)
          }
        }}
      >
        {!addingRootActive ? (
          <span className="console-academic-pill-add" role="button">
            <i className="bi bi-plus" aria-hidden="true" />
            追加
          </span>
        ) : (
          <>
            <input
              className="console-academic-pill-input"
              value={addingRootName}
              onChange={(event) => setAddingRootName(event.target.value)}
              placeholder="カテゴリ名"
            />
            <div className="console-academic-pill-actions">
              <button
                type="button"
                className="console-academic-pill-action"
                onClick={() => void submitRootCreate()}
              >
                <i className="bi bi-check" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="console-academic-pill-action is-ghost"
                onClick={() => {
                  setAddingRootActive(false)
                  setAddingRootName('')
                }}
              >
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  function renderChildCreateControl(parentNode: CmsCategoryNode): JSX.Element | null {
    if (mode !== 'manage' || onCreateChild === undefined) {
      return null
    }

    return (
      <div
        className="console-academic-pill is-manage is-add"
        onClick={() => {
          if (addingChildParentId !== parentNode.id) {
            setAddingChildParentId(parentNode.id)
            setAddingChildName('')
          }
        }}
      >
        {addingChildParentId === parentNode.id ? (
          <>
            <input
              className="console-academic-pill-input"
              value={addingChildName}
              onChange={(event) => setAddingChildName(event.target.value)}
              placeholder="カテゴリ名"
            />
            <div className="console-academic-pill-actions">
              <button
                type="button"
                className="console-academic-pill-action"
                onClick={() => void submitChildCreate(parentNode.id)}
              >
                <i className="bi bi-check" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="console-academic-pill-action is-ghost"
                onClick={() => {
                  setAddingChildParentId('')
                  setAddingChildName('')
                }}
              >
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            </div>
          </>
        ) : (
          <span className="console-academic-pill-add" role="button">
            <i className="bi bi-plus" aria-hidden="true" />
            子カテゴリを追加
          </span>
        )}
      </div>
    )
  }

  function renderColumn(column: ColumnSpec): JSX.Element {
    return (
      <div key={column.key} className="console-academic-block">
        <div className="console-academic-block-title">{column.title}</div>
        <div className="console-academic-block-body cms-category-tree-body">
          {column.items.length === 0 ? (
            <div className="console-placeholder">カテゴリがありません。</div>
          ) : (
            column.items.map((item) => renderCategoryItem(item))
          )}

          {column.parentNode === null
            ? renderRootCreateControl()
            : renderChildCreateControl(column.parentNode)}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={previewRef}
      className="console-academic-preview cms-category-visual-picker"
      onMouseLeave={() => {
        setHoveredCategoryId('')
        setPreviewCategoryId('')
      }}
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) {
          return
        }

        event.preventDefault()
        applyZoom(
          zoomScaleRef.current * Math.exp(-event.deltaY * 0.0025),
          event.clientX,
          event.clientY,
        )
      }}
      onTouchStart={(event) => {
        if (event.touches.length === 2) {
          pinchStateRef.current = {
            distance: getTouchDistance(event.touches),
            scale: zoomScaleRef.current,
          }
        }
      }}
      onTouchMove={(event) => {
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
      }}
      onTouchEnd={() => {
        pinchStateRef.current = null
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
          className="console-academic-canvas"
          style={{
            transform: `scale(${zoomScale})`,
            transformOrigin: 'top left',
          }}
        >
          <svg className="console-academic-lines" aria-hidden="true">
            {lines.map((line, index) => (
              <path
                key={`${line.path}-${index}`}
                d={line.path}
                className={line.isActive ? 'is-active' : 'is-muted'}
              />
            ))}
          </svg>

          <div className="console-academic-preview-columns">
            {columns.map((column) => renderColumn(column))}
          </div>
        </div>
      </div>
    </div>
  )
}
