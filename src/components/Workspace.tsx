import * as Preact from "preact"
import createWidget, { WidgetProps, AnyDoc } from "./Widget"
import * as Link from "../data/Link"
import * as Reify from "../data/Reify"
import Content, { DocumentActor } from "./Content"
import Touch, { TouchEvent } from "./Touch"

export interface Model {
  backUrls: string[]
  currentUrl: string
  archiveUrl: string
}

class WorkspaceActor extends DocumentActor<Model> {
  static async receive(message: any) {
    const { id } = Link.parse(message.to)
    // TODO: yikes
    const doc = await Content.getDoc<Model>(message.to)
    const actor = new this(message.to, id, doc)
    actor.onMessage(message)
  }

  onMessage(message: any) {
    switch (message.type) {
      case "DocumentCreated": {
        if (message.from !== this.doc.archiveUrl) {
          this.emit({ ...message, to: this.doc.archiveUrl })
        }
        break
      }
    }
  }
}

class Workspace extends Preact.Component<WidgetProps<Model>> {
  static reify(doc: AnyDoc): Model {
    return {
      currentUrl: Reify.link(doc.currentUrl),
      backUrls: Reify.array(doc.backUrls),
      archiveUrl: Reify.link(doc.archiveUrl),
    }
  }

  render() {
    const { currentUrl } = this.props.doc
    return (
      <Touch
        onThreeFingerSwipeDown={this.onThreeFingerSwipeDown}
        onThreeFingerSwipeUp={this.onThreeFingerSwipeUp}
        onPinchEnd={this.onPinchEnd}>
        <div class="Workspace" style={style.Workspace}>
          <Content
            mode={this.props.mode}
            url={currentUrl}
            onNavigate={this.navigateTo}
          />
        </div>
      </Touch>
    )
  }

  onThreeFingerSwipeDown = (event: TouchEvent) => {
    if (!this.props.doc) return
    if (this.props.doc.currentUrl !== this.props.doc.archiveUrl) {
      this.navigateTo(this.props.doc.archiveUrl)
    }
  }

  onThreeFingerSwipeUp = (event: TouchEvent) => {
    if (!this.props.doc) return
    if (this.props.doc.currentUrl === this.props.doc.archiveUrl) {
      this.navigateBack()
    }
  }

  onPinchEnd = (event: TouchEvent) => {
    if (event.scale > 1) return
    this.navigateBack()
  }

  navigateBack = () => {
    this.props.change(doc => {
      const url = doc.backUrls.pop()
      if (url) {
        doc.currentUrl = url
      }
      return doc
    })
  }

  navigateTo = (url: string) => {
    if (this.props.doc && this.props.doc.currentUrl === url) return

    this.props.change(doc => {
      doc.backUrls.push(doc.currentUrl)
      doc.currentUrl = url
      return doc
    })
  }
}

const style = {
  Workspace: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  },
}

export default createWidget<Model>(
  "Workspace",
  Workspace,
  Workspace.reify,
  WorkspaceActor,
)
