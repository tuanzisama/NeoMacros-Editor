/**
 * 两条日志流(宿主日志 / 脚本 console)共享的单调到达序号:
 * 合并控制台按 ts 排序,ts 相同(或缺失)时以到达序决胜,保持同刻消息的
 * 真实先后。计数器只在页面生命周期内单调,重连重放会重新编号,无持久语义。
 */

let counter = 0

/** 取下一个到达序号 */
export function nextArrival(): number {
  return ++counter
}
