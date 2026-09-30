/** What the pointer is over. Produced by the active screen's picker. */
export interface PickHit {
  kind: 'entity' | 'vehicle' | 'bank' | 'mapNode' | 'ui3d';
  id: string;
  /** World-space hit point. */
  point?: { x: number; y: number; z: number };
}

/** Implemented by the active screen (world map or level). */
export interface PointerHandler {
  pick(ndcX: number, ndcY: number): PickHit | null;
  onHover(hit: PickHit | null, clientX: number, clientY: number): void;
  onClick(hit: PickHit | null, button: number): void;
  canDrag(hit: PickHit): boolean;
  onDragStart(hit: PickHit, clientX: number, clientY: number): void;
  onDragMove(clientX: number, clientY: number, ndcX: number, ndcY: number): void;
  onDragEnd(clientX: number, clientY: number, ndcX: number, ndcY: number): void;
  onDragCancel(): void;
  rotateCamera(dx: number, dy: number): void;
  panCamera(dx: number, dy: number): void;
  zoomCamera(deltaY: number): void;
}

const DRAG_THRESHOLD = 6;

type PressState =
  | { type: 'none' }
  | { type: 'pressed'; button: number; x: number; y: number; hit: PickHit | null; id: number }
  | { type: 'entityDrag'; id: number }
  | { type: 'orbit'; button: number; x: number; y: number; id: number };

/**
 * Pointer input for the 3D canvas. Hover picking is throttled to once per animation frame.
 * Mouse only is sufficient for everything; touch works through pointer events as well.
 */
export class PointerInput {
  handler: PointerHandler | null = null;
  enabled = true;
  private press: PressState = { type: 'none' };
  private hoverDirty = false;
  private lastMove = { x: -1, y: -1 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private disposers: Array<() => void> = [];

  constructor(private readonly el: HTMLElement) {
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => this.onDown(e));
    on('pointermove', (e) => this.onMove(e));
    on('pointerup', (e) => this.onUp(e));
    on('pointercancel', (e) => this.onCancel(e));
    on('pointerleave', () => {
      if (this.press.type === 'none') {
        this.lastMove = { x: -1, y: -1 };
        this.handler?.onHover(null, -1, -1);
      }
    });
    on('wheel', (e) => this.onWheel(e), { passive: false });
    on('contextmenu', (e) => e.preventDefault());
  }

  private ndc(clientX: number, clientY: number): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1];
  }

  private onDown(e: PointerEvent): void {
    if (!this.enabled || !this.handler) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // start pinch zoom, cancel other interactions
      if (this.press.type === 'entityDrag') this.handler.onDragCancel();
      this.press = { type: 'none' };
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    if (this.press.type !== 'none') return;
    this.el.setPointerCapture?.(e.pointerId);
    const [nx, ny] = this.ndc(e.clientX, e.clientY);
    const hit = this.handler.pick(nx, ny);
    this.press = { type: 'pressed', button: e.button, x: e.clientX, y: e.clientY, hit, id: e.pointerId };
  }

  private onMove(e: PointerEvent): void {
    if (!this.handler) return;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) this.handler.zoomCamera((this.pinchDist - d) * 4);
      this.pinchDist = d;
      return;
    }
    const p = this.press;
    if (p.type === 'pressed' && p.id === e.pointerId) {
      const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (dist > DRAG_THRESHOLD) {
        if (p.button === 0 && p.hit && this.handler.canDrag(p.hit)) {
          this.press = { type: 'entityDrag', id: p.id };
          this.handler.onDragStart(p.hit, e.clientX, e.clientY);
        } else {
          this.press = { type: 'orbit', button: p.button, x: e.clientX, y: e.clientY, id: p.id };
          this.handler.onHover(null, -1, -1);
        }
      }
      return;
    }
    if (p.type === 'entityDrag' && p.id === e.pointerId) {
      const [nx, ny] = this.ndc(e.clientX, e.clientY);
      this.handler.onDragMove(e.clientX, e.clientY, nx, ny);
      return;
    }
    if (p.type === 'orbit' && p.id === e.pointerId) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (p.button === 0 && !e.shiftKey) this.handler.rotateCamera(dx, dy);
      else this.handler.panCamera(dx, dy);
      return;
    }
    // plain hover – resolved once per frame in update()
    this.lastMove = { x: e.clientX, y: e.clientY };
    this.hoverDirty = true;
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (!this.handler) return;
    const p = this.press;
    if (p.type === 'none' || ('id' in p && p.id !== e.pointerId)) return;
    this.el.releasePointerCapture?.(e.pointerId);
    this.press = { type: 'none' };
    if (p.type === 'pressed') {
      if (this.enabled) this.handler.onClick(p.hit, p.button);
    } else if (p.type === 'entityDrag') {
      const [nx, ny] = this.ndc(e.clientX, e.clientY);
      this.handler.onDragEnd(e.clientX, e.clientY, nx, ny);
    }
    this.lastMove = { x: e.clientX, y: e.clientY };
    this.hoverDirty = true;
  }

  private onCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.press.type === 'entityDrag') this.handler?.onDragCancel();
    this.press = { type: 'none' };
  }

  private onWheel(e: WheelEvent): void {
    if (!this.handler) return;
    e.preventDefault();
    const scale = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1;
    this.handler.zoomCamera(e.deltaY * scale);
  }

  /** Must be called once per frame; performs throttled hover picking. */
  update(): void {
    if (!this.handler || !this.hoverDirty || this.press.type !== 'none') return;
    this.hoverDirty = false;
    if (this.lastMove.x < 0) return;
    const [nx, ny] = this.ndc(this.lastMove.x, this.lastMove.y);
    this.handler.onHover(this.enabled ? this.handler.pick(nx, ny) : null, this.lastMove.x, this.lastMove.y);
  }

  /** Forces a hover re-evaluation (e.g. after objects moved). */
  refreshHover(): void {
    this.hoverDirty = true;
  }

  get isDragging(): boolean {
    return this.press.type === 'entityDrag' || this.press.type === 'orbit';
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
