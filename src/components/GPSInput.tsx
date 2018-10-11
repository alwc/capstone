import * as React from "react"
import * as Rx from "rxjs"
import * as GPS from "../logic/GPS"

export default class GPSInput extends React.Component {
  componentDidMount() {
    GPS.connectInput(
      Rx.merge(
        Rx.fromEvent<PointerEvent>(document.body, "pointerdown"),
        Rx.fromEvent<PointerEvent>(document.body, "pointermove"),
        Rx.fromEvent<PointerEvent>(document.body, "pointerup"),
        Rx.fromEvent<PointerEvent>(document.body, "pointercancel"),
      ),
    )
  }

  render() {
    return null
  }
}
