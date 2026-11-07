/**
 * Document Picture-in-Picture（Chrome/Edge 116+），lib.dom 尚未收录。
 * 参考 https://developer.chrome.com/docs/web-platform/document-picture-in-picture
 */

interface DocumentPictureInPicture {
  /** 打开画中画窗口（需用户手势触发） */
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>
  /** 当前画中画窗口，未打开时为 null */
  window: Window | null
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture
}
