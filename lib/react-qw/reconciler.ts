import ReactReconciler from 'react-reconciler'
import { createContext } from 'react'
import * as gui from 'gui'
import * as os from 'os'
import { applyProps } from './props.js'

type Container = gui.HWND

interface Instance {
  hwnd: gui.HWND
  type: string
  props: Record<string, any>
  children: Instance[]
}

type TextInstance = gui.HWND

let currentUpdatePriority = 0
const DefaultEventPriority = 16

const hostConfig: any = {
  createInstance(type: string, props: Record<string, any>, rootContainer: Container) {
    console.log('[reconciler] createInstance called:', type, props, 'container:', rootContainer)
    const winClass = props.type
    const hwnd = gui.CreateWindow(
      winClass, props.text || '', props.ws ?? 0,
      props.x ?? 0, props.y ?? 0,
      props.width ?? 100, props.height ?? 30,
      rootContainer, null
    )!
    console.log('[reconciler] createInstance hwnd:', hwnd)
    const oldProc = gui.GetWindowLongPtr(hwnd, gui.Gwlp.WNDPROC) as unknown as gui.WNDPROC
    const instance: Instance = { hwnd, type: winClass, props, children: [] }
    // 始终设置窗口过程，以便后续 onEvent 更新能生效
    gui.SetWindowProc(hwnd, (hwnd: gui.HWND, msg: number, wParam: number, lParam: number) => {
      instance.props.onEvent?.({ hwnd, msg, wParam, lParam })
      return gui.CallWindowProc(oldProc, hwnd, msg, wParam, lParam)
    })
    return instance
  },

  createTextInstance(text: string, _rootContainer: Container) {
    console.log('[reconciler] createTextInstance:', text)
    return gui.CreateWindow('STATIC', text, 0, 0, 0, 0, 0, null, null)!
  },

  appendInitialChild(parent: Instance, child: Instance) {
    console.log('[reconciler] appendInitialChild parent:', parent.hwnd, 'child:', child.hwnd)
    gui.SetParent(child.hwnd, parent.hwnd)
  },

  appendChild(parent: Instance, child: Instance) {
    console.log('[reconciler] appendChild parent:', parent.hwnd, 'child:', child.hwnd)
    gui.SetParent(child.hwnd, parent.hwnd)
  },

  appendChildToContainer(container: Container, child: Instance | TextInstance) {
    console.log('[reconciler] appendChildToContainer container:', container, 'child hwnd:', (child as any).hwnd ?? child)
    gui.SetParent((child as any).hwnd ?? child, container)
  },

  insertBefore(parent: Instance, child: Instance, beforeChild: Instance) {
    gui.SetParent(child.hwnd, parent.hwnd)
  },

  insertInContainerBefore(container: Container, child: Instance | TextInstance, _before: any) {
    gui.SetParent((child as any).hwnd ?? child, container)
  },

  removeChild(parent: Instance, child: Instance) {
    gui.DestroyWindow(child.hwnd)
  },

  removeChildFromContainer(container: Container, child: Instance | TextInstance) {
    gui.DestroyWindow((child as any).hwnd ?? child)
  },

  commitTextUpdate(textInstance: TextInstance, _oldText: string, newText: string) {
    gui.SetWindowText(textInstance, newText)
  },

  commitUpdate(instance: Instance, _type: string, oldProps: Record<string, any>, newProps: Record<string, any>, _internalHandle: any) {
    applyProps(instance, newProps, oldProps)
  },


  commitMount(_instance: Instance, _type: string, _props: Record<string, any>, _internal: any) { },

  prepareUpdate(_instance: Instance, _type: string, oldProps: Record<string, any>, newProps: Record<string, any>) {
    return true
  },

  finalizeInitialChildren(instance: Instance, _type: string, props: Record<string, any>) {
    console.log('[reconciler] finalizeInitialChildren instance:', instance.hwnd, 'props:', props)
    applyProps(instance, props, {})
    return false
  },

  resetAfterCommit(_containerInfo: Container) {
    console.log('[reconciler] resetAfterCommit')
  },

  resetTextContent(_instance: Instance) { },

  shouldSetTextContent(_type: string, _props: Record<string, any>) {
    return false
  },

  getPublicInstance(instance: Instance) {
    return instance.hwnd
  },

  getRootHostContext(_rootContainer: Container) {
    return {}
  },

  getChildHostContext(_parentContext: any, _type: string) {
    return {}
  },

  prepareForCommit(_containerInfo: Container) {
    return null
  },

  preparePortalMount(_containerInfo: Container) { },

  clearContainer(container: Container) {
    // TODO: recursively destroy children
  },

  scheduleTimeout(fn: () => void, delay: number) {
    return os.setTimeout(fn, delay)
  },

  cancelTimeout(id: any) {
    os.clearTimeout?.(id)
  },

  noTimeout: -1,

  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  supportsMicrotasks: false,

  setCurrentUpdatePriority(p: number) { currentUpdatePriority = p },
  getCurrentUpdatePriority() { return currentUpdatePriority },
  resolveUpdatePriority() { return DefaultEventPriority },

  resolveEventType() { return null },
  resolveEventTimeStamp() { return -1.1 },
  trackSchedulerEvent() {
    // console.log('[reconciler] trackSchedulerEvent') 
  },

  shouldAttemptEagerTransition() { return false },
  detachDeletedInstance(_instance: Instance) { },

  rendererVersion: '0.1.0',
  rendererPackageName: 'react-qw',
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  resetFormInstance(_form: any) { },
}

const reconciler = ReactReconciler(hostConfig)
export default reconciler
