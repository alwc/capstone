import * as React from "react"
import * as Rx from "rxjs"
import * as Frame from "./Frame"
import classnames from "classnames"
import * as css from "./Ink.css"
import { Portal } from "react-portal"
import GPS from "gps"
import * as RxOps from "rxjs/operators"
import * as Content from "capstone/Content"

export interface PenPoint {
  x: number
  y: number
  strokeWidth: number
}

export interface InkStroke {
  points: PenPoint[]
  settings: StrokeSettings
}

export interface Props {
  strokes: InkStroke[]
  mode: Content.Mode
  scale?: number
  onInkStroke?: (stroke: InkStroke) => void
}

export interface CanvasProps {
  strokes: InkStroke[]
  mode: Content.Mode
  scale?: number
  onInkStroke?: (stroke: InkStroke) => void
  strokeType?: StrokeType
  updateVisibleEraserPosition: (eraserPosition?: PenPoint) => void
}

enum StrokeType {
  ink = "ink",
  erase = "erase",
  default = ink,
}

export interface StrokeSettings {
  readonly globalCompositeOperation: string
  readonly strokeStyle: string
  readonly lineCap: string
  readonly lineJoin: string
  lineWidth: number
}

const StrokeMappings: { [st: string]: (pressure: number) => number } = {
  [StrokeType.ink]: pressure => {
    return Math.max(1.5, 16 * Math.pow(pressure, 12))
  },
  [StrokeType.erase]: pressure => {
    return Math.max(16, 120 * Math.pow(pressure, 3))
  },
}

const StrokeSettings: { [st: string]: StrokeSettings } = {
  [StrokeType.ink]: {
    globalCompositeOperation: "source-over",
    strokeStyle: "black",
    lineCap: "round",
    lineJoin: "round",
    lineWidth: 1.5,
  },
  [StrokeType.erase]: {
    globalCompositeOperation: "destination-out",
    strokeStyle: "white",
    lineCap: "round",
    lineJoin: "round",
    lineWidth: 8,
  },
}

interface State {
  strokeType?: StrokeType
  eraserPosition?: PenPoint
}

interface CanvasState {}

export default class Ink extends React.Component<Props, State> {
  state: State = {}
  optionsPanel?: HTMLDivElement

  render() {
    const { onInkStroke, strokes, mode, scale } = this.props
    const { eraserPosition, strokeType } = this.state
    const { updateVisibleEraserPosition } = this
    return (
      <div>
        {eraserPosition != undefined ? (
          <div
            className={css.Eraser}
            style={{
              left: eraserPosition.x,
              top: eraserPosition.y,
              width: eraserPosition.strokeWidth,
              height: eraserPosition.strokeWidth,
            }}
          />
        ) : null}

        <InkCanvas
          strokeType={strokeType}
          onInkStroke={onInkStroke}
          updateVisibleEraserPosition={updateVisibleEraserPosition}
          strokes={strokes}
          scale={scale}
          mode={mode}
        />
        {this.props.mode == "fullscreen" ? (
          <Portal>
            <div className={css.Options} ref={this.onOptionsPanelRef}>
              <Option
                label="Ink"
                value={StrokeType.ink}
                selected={strokeType === StrokeType.ink}
                onChange={this.onStrokeTypeChange}
              />
              <Option
                label="Erase"
                value={StrokeType.erase}
                selected={strokeType === StrokeType.erase}
                onChange={this.onStrokeTypeChange}
              />
            </div>
          </Portal>
        ) : null}
      </div>
    )
  }

  componentDidMount() {
    GPS.setInteractionMode(GPS.InteractionMode.default)
  }

  componentWillUnmount() {
    GPS.setInteractionMode(GPS.InteractionMode.default)
  }

  onOptionsPanelRef = (ref: HTMLDivElement) => {
    this.optionsPanel = ref
  }

  onStrokeTypeChange = (strokeType?: StrokeType) => {
    if (this.state.strokeType === strokeType) {
      GPS.setInteractionMode(GPS.InteractionMode.default)
      this.setState({ eraserPosition: undefined, strokeType: undefined })
    } else {
      GPS.setInteractionMode(GPS.InteractionMode.inking)
      this.setState({ strokeType })
    }
  }

  updateVisibleEraserPosition = (eraserPosition?: PenPoint) => {
    this.setState({ eraserPosition })
  }
}

class InkCanvas extends React.Component<CanvasProps, CanvasState> {
  canvasElement?: HTMLCanvasElement | null
  ctx?: CanvasRenderingContext2D | null
  pointerEventSubscription?: Rx.Subscription

  wetStroke?: InkStroke
  lastDrawnPoint = 0
  nextDryStroke = 0

  state: CanvasState = {}

  componentDidMount() {
    this.drawDry()
    this.pointerEventSubscription = GPS.stream()
      .pipe(
        RxOps.map(GPS.onlyPen),
        RxOps.filter(GPS.ifNotEmpty),
        RxOps.map(GPS.toAnyPointer),
        RxOps.map(GPS.toMostRecentEvent),
      )
      .subscribe(this.onPenEvent)
  }

  componentWillUnmount() {
    this.pointerEventSubscription && this.pointerEventSubscription.unsubscribe()
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.strokes.length !== this.props.strokes.length) {
      requestAnimationFrame(this.drawDry)
    }
  }

  shouldComponentUpdate() {
    return false
  }

  render() {
    return <canvas ref={this.canvasAdded} className={css.InkLayer} />
  }

  onPenEvent = (event: PointerEvent) => {
    if (!this.props.strokeType) return
    const target = event.target as HTMLElement
    // don't record strokes on the options buttons
    if (target && target.className && target.className.indexOf("Option") >= 0)
      return
    if (event.type == "pointerdown") {
      this.onPanStart(event)
    } else if (event.type == "pointerup" || event.type == "pointercancel") {
      this.onPanEnd(event)
    } else if (event.type == "pointermove") {
      this.onPanMove(event)
    }
  }

  onPanStart = (event: PointerEvent) => {
    this.onPanMove(event)
  }

  onPanMove = (event: PointerEvent) => {
    const { x, y } = event
    const { strokeType } = this.props
    if (!strokeType) return

    const coalesced: PointerEvent[] = event.getCoalescedEvents()
    if (!this.wetStroke) {
      this.wetStroke = {
        points: [],
        settings: StrokeSettings[strokeType],
      }
    }
    this.wetStroke.points.push(
      ...coalesced.map((value, i, a) => {
        return {
          x: value.x,
          y: value.y,
          strokeWidth: StrokeMappings[strokeType](value.pressure),
        }
      }),
    )

    if (strokeType == StrokeType.erase) {
      const eraserPosition = {
        x: event.x,
        y: event.y,
        strokeWidth: StrokeMappings[strokeType](event.pressure),
      }
      this.props.updateVisibleEraserPosition(eraserPosition)
    }

    this.drawWet()
  }

  onPanEnd = (event: PointerEvent) => {
    this.lastDrawnPoint = 0
    if (this.props.strokeType === StrokeType.erase) {
      this.props.updateVisibleEraserPosition(undefined)
    }
    this.inkStroke()
    this.resetWetStroke()
  }

  inkStroke = () => {
    if (!this.props.onInkStroke || !this.props.strokeType) {
      return
    }
    this.wetStroke && this.props.onInkStroke(this.wetStroke)
  }

  resetWetStroke() {
    this.wetStroke = undefined
    this.lastDrawnPoint = 0
    if (this.ctx && this.canvasElement) {
      this.ctx.beginPath()
    }
  }

  prepareCanvas(canvas: HTMLCanvasElement) {
    // Get the device pixel ratio, falling back to 1.
    var dpr = window.devicePixelRatio || 1
    const scale = (this.props.scale || 1) * dpr
    // Get the size of the canvas in CSS pixels.

    if (this.props.mode == "fullscreen") {
      canvas.width = window.innerWidth * scale
      canvas.height = window.innerHeight * scale
    } else {
      var rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
    }

    var ctx = canvas.getContext("2d")
    // Scale all drawing operations by the dpr, so you
    // don't have to worry about the difference.
    if (ctx) {
      ctx.translate(0.5, 0.5)
      ctx.scale(scale, scale)
    }
    return ctx
  }

  canvasAdded = (canvas: HTMLCanvasElement | null) => {
    this.canvasElement = canvas
    if (canvas) {
      this.ctx = this.prepareCanvas(canvas)
    }
  }

  drawWet = Frame.throttle(() => {
    if (!this.ctx || !this.wetStroke || !this.props.strokeType) return

    for (
      this.lastDrawnPoint;
      this.lastDrawnPoint < this.wetStroke.points.length;
      this.lastDrawnPoint++
    ) {
      let point = this.wetStroke.points[this.lastDrawnPoint]
      let settings = StrokeSettings[this.props.strokeType]
      settings.lineWidth = point.strokeWidth
      Object.assign(this.ctx, settings)
      if (this.lastDrawnPoint === 0) {
        continue
      }
      const twoPoints = [this.wetStroke.points[this.lastDrawnPoint - 1], point]
      const pathString =
        "M " + twoPoints.map(point => `${point.x} ${point.y}`).join(" L ")
      const path = new Path2D(pathString)
      this.ctx.stroke(path)
    }
  })

  drawDry = Frame.throttle(() => {
    if (!this.canvasElement) return
    const { strokes } = this.props
    this.prepareCanvas(this.canvasElement)
    const ctx = this.canvasElement.getContext("2d")
    if (!ctx || strokes.length == 0) return
    strokes
      .slice(this.nextDryStroke)
      .forEach(stroke => this.drawDryStroke(stroke))
    this.nextDryStroke = strokes.length
  })

  drawDryStroke(stroke: InkStroke) {
    const ctx = this.canvasElement && this.canvasElement.getContext("2d")
    if (!ctx || stroke.points.length == 0) return
    let strokeSettings = stroke.settings

    let from = stroke.points[0]
    if (!from) return

    let pathString = ""
    if (stroke.points.length === 1) {
      pathString = `M ${from.x} ${from.y} C`
      const path = new Path2D(pathString)
      strokeSettings.lineWidth = from.strokeWidth
      Object.assign(ctx, stroke)
      ctx.stroke(path)
    } else {
      stroke.points.forEach((to, index) => {
        if (!to || !from) return
        pathString = `M ${from.x} ${from.y} L ${to.x} ${to.y}`
        const path = new Path2D(pathString)
        strokeSettings.lineWidth = to.strokeWidth
        Object.assign(ctx, strokeSettings)
        ctx.stroke(path)
        from = to
      })
    }
  }
}

interface OptionProps {
  label: React.ReactNode
  value: StrokeType
  selected: boolean
  onChange: (value?: StrokeType) => void
}

class Option<T> extends React.Component<OptionProps> {
  render() {
    const { value, selected, onChange } = this.props
    const baseName =
      value == StrokeType.ink ? css.OptionButtonInk : css.OptionButtonEraser

    return (
      <div
        className={css.Option}
        onPointerDown={() => onChange(value)}
        onContextMenu={this.onContextMenu}>
        <div
          className={classnames(baseName, {
            [css.selected]: selected,
            [css.deselected]: !selected,
          })}
        />
      </div>
    )
  }

  onContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
  }
}
