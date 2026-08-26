import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export type Anchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = Pick<Anchor, 'x' | 'y'>;

type AnnotationOverlayProps = {
  active: boolean;
  anchor: Anchor | null;
  onSelect: (anchor: Anchor) => void;
  onCancel: () => void;
};

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 5,
  touchAction: 'none',
  userSelect: 'none',
};

const boxStyle: CSSProperties = {
  position: 'absolute',
  border: '2px solid var(--fl-primary)',
  background: 'color-mix(in srgb, var(--fl-primary) 12%, transparent)',
  boxShadow: '0 0 0 9999px color-mix(in srgb, var(--fl-text) 8%, transparent)',
  pointerEvents: 'none',
};

const labelStyle: CSSProperties = {
  position: 'absolute',
  left: -2,
  display: 'flex',
  minHeight: 24,
  alignItems: 'center',
  padding: '0 var(--fl-s-2)',
  borderRadius: 'var(--fl-r-1)',
  background: 'var(--fl-primary-deep)',
  color: 'var(--fl-surface)',
  fontSize: 'var(--fl-fs-2)',
  lineHeight: 1,
  whiteSpace: 'nowrap',
};

const instructionStyle: CSSProperties = {
  position: 'absolute',
  top: 'var(--fl-s-4)',
  left: '50%',
  maxWidth: 'calc(100% - 2 * var(--fl-s-4))',
  padding: '7px var(--fl-s-3)',
  borderRadius: 'var(--fl-r-2)',
  background: 'var(--fl-text)',
  boxShadow: 'var(--fl-shadow-2)',
  color: 'var(--fl-surface)',
  fontSize: 'var(--fl-fs-2)',
  textAlign: 'center',
  transform: 'translateX(-50%)',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function pointFromEvent(event: ReactPointerEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp(rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0),
    y: clamp(rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0),
  };
}

function anchorBetween(start: Point, end: Point): Anchor {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function AnnotationOverlay({
  active,
  anchor,
  onSelect,
  onCancel,
}: AnnotationOverlayProps) {
  const [draft, setDraft] = useState<Anchor | null>(anchor);
  const [dragging, setDragging] = useState(false);
  const startPointRef = useRef<Point | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (pointerIdRef.current === null) setDraft(anchor);
  }, [anchor]);

  if (!active && !anchor) return null;

  const visibleAnchor = active ? draft ?? anchor : anchor;

  function releasePointer(target: HTMLDivElement) {
    const pointerId = pointerIdRef.current;
    if (pointerId !== null && target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  }

  function cancelSelection(target?: HTMLDivElement) {
    if (target) releasePointer(target);
    pointerIdRef.current = null;
    startPointRef.current = null;
    setDragging(false);
    setDraft(anchor);
    onCancel();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!active || !event.isPrimary || event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);

    const start = pointFromEvent(event);
    pointerIdRef.current = event.pointerId;
    startPointRef.current = start;
    setDraft({ ...start, width: 0, height: 0 });
    setDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current !== event.pointerId || !startPointRef.current) return;
    setDraft(anchorBetween(startPointRef.current, pointFromEvent(event)));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current !== event.pointerId || !startPointRef.current) return;

    const nextAnchor = anchorBetween(startPointRef.current, pointFromEvent(event));
    releasePointer(event.currentTarget);
    pointerIdRef.current = null;
    startPointRef.current = null;
    setDragging(false);

    if (nextAnchor.width < 0.01 || nextAnchor.height < 0.01) {
      setDraft(anchor);
      return;
    }

    setDraft(nextAnchor);
    onSelect(nextAnchor);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current !== event.pointerId) return;
    cancelSelection(event.currentTarget);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancelSelection(event.currentTarget);
  }

  return (
    <div
      role="application"
      tabIndex={0}
      aria-label="原型标注区域"
      style={{
        ...overlayStyle,
        cursor: active ? 'crosshair' : 'default',
        pointerEvents: active ? 'auto' : 'none',
        background: active
          ? 'color-mix(in srgb, var(--fl-text) 8%, transparent)'
          : 'transparent',
      }}
      onKeyDown={handleKeyDown}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {visibleAnchor ? (
        <div
          aria-hidden="true"
          style={{
            ...boxStyle,
            left: `${visibleAnchor.x * 100}%`,
            top: `${visibleAnchor.y * 100}%`,
            width: `${visibleAnchor.width * 100}%`,
            height: `${visibleAnchor.height * 100}%`,
          }}
        >
          <span
            style={{
              ...labelStyle,
              top: visibleAnchor.y < 0.05 ? 0 : -26,
            }}
          >
            反馈区域
          </span>
        </div>
      ) : null}

      {active && !dragging && !visibleAnchor ? (
        <div role="status" style={instructionStyle}>
          拖动框选需要反馈的区域，按 Esc 退出
        </div>
      ) : null}
    </div>
  );
}
