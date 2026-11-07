// NeoMacros 补充环境声明
// neomacros.d.ts 引用了 GraalJS↔Java 互操作的功能接口与快照类型但未声明；
// 此文件按各 facade 文档语义补齐，随 extraLib 一并加载（可随 d.ts 新版一起维护）。

// ---- Java 功能接口的 JS 侧形态 ----

/** 可调用体（clock.runOnMain 的任务）：任意函数，返回值回传给 promise。 */
type Callable = (...args: never[]) => unknown;

/** 消费者：接收事件负载的回调。 */
type Consumer<T = any> = (value: T) => void;

/** 谓词：onSync 返回真值取消事件（过滤式）；waitForUntil 作匹配过滤。 */
type Predicate<T = any> = (value: T) => boolean;

/** 无参回调（input.registerKeybind / registerKeyPress 的 sink）。 */
type Runnable = () => void;

/** 双精度消费者（input.onScroll 的 sink，参数为滚动偏移）。 */
type DoubleConsumer = (value: number) => void;

// ---- 快照类型（handle.snapshot() 的时点拷贝）----

/** 实体时点快照（字段取自 EntityHandle 文档）。 */
interface EntitySnapshot {
    /** 实体类型标识，如 minecraft:pig */
    type: string;
    /** 显示名称 */
    name: string;
    /** 实体 UUID 字符串 */
    uuid: string;
    x: number;
    y: number;
    z: number;
    /** 生命值 */
    health: number;
    /** JSON 形态（与 handle.toJSON 同构） */
    toJSON?(): Record<string, unknown>;
}

/** 本地玩家时点快照（字段取自 PlayerHandle 文档）。 */
interface PlayerSnapshot {
    /** 玩家名 */
    name: string;
    /** 玩家 UUID 字符串 */
    uuid: string;
    x: number;
    y: number;
    z: number;
    /** 生命值 */
    health: number;
    /** 饥饿值 */
    hunger: number;
    /** 氧气值 */
    air: number;
    /** 是否在世界中 */
    valid: boolean;
    /** JSON 形态（与 handle.toJSON 同构） */
    toJSON?(): Record<string, unknown>;
}
