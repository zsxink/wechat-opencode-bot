# wechat-opencode-bot 架构评审报告

**日期**：2026-03-26
**评审人**：AI Assistant
**版本**：v1.0.0

---

## 一、项目概述

**项目类型**：微信机器人 + OpenCode AI 对话系统
**技术栈**：TypeScript + Node.js + 微信 ILink API
**架构模式**：事件驱动 + 长轮询 + 消息队列

---

## 二、当前架构分析

```
┌─────────────────────────────────────────────────────────────┐
│                     微信客户端 (用户)                         │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/ILink API
┌────────────────────────▼────────────────────────────────────┐
│                   wechat-opencode-bot                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Monitor     │→ │  Handler     │→ │  OpenCode        │  │
│  │  (长轮询)    │  │  (命令处理)  │  │  Provider        │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│         ↓                                     ↓             │
│  ┌──────────────┐                  ┌──────────────────┐    │
│  │  Sender     │                  │  OpenCode Service │    │
│  │  (消息发送) │←─────────────────│  (本地服务)       │    │
│  └──────────────┘                  └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 模块说明

| 模块 | 文件 | 职责 |
|------|------|------|
| Monitor | monitor.ts | 长轮询微信消息 |
| Handler | handlers.ts | 命令路由和处理 |
| Sender | send.ts | 消息发送和 typing 状态 |
| Provider | provider.ts | OpenCode API 交互 |
| Session | session.ts | 会话状态管理 |
| Permission | permission.ts | 权限控制 |

---

## 三、问题与改进建议

### 🔴 高优先级问题

#### 1. 并发消息处理缺陷

**问题**：`sendToOpenCode` 是异步函数，但没有并发控制。多个用户同时发消息可能导致：
- OpenCode 会话被多个请求共享
- 响应混乱
- typing 状态混乱

**位置**：main.ts - `sendToOpenCode` 函数

**建议**：添加消息队列或并发控制机制

```typescript
// 建议：添加消息队列
const messageQueue = new PQueue({ concurrency: 1 });

async function sendToOpenCode(...) {
  return messageQueue.add(async () => {
    // 处理逻辑
  });
}
```

---

#### 2. 会话状态管理混乱

**问题**：
- `chatHistory` 在内存和 OpenCode 两边同时存在
- 切换用户/目录时状态可能不一致
- `/new` 命令只清除内存状态，不清除 OpenCode 会话

**位置**：main.ts, session.ts

**建议**：统一会话状态管理，考虑使用 OpenCode 的会话管理 API

---

#### 3. Typing Keepalive 没有取消机制

**问题**：如果 OpenCode 请求失败，`typingKeepalive` 可能仍在运行

**位置**：main.ts:370

**建议**：确保所有退出路径都清除定时器

```typescript
// 当前代码 (main.ts:370)
} catch (err) {
  // 缺少 typingKeepalive 的清理
}
```

---

### 🟡 中优先级问题

#### 4. 错误处理不完善

**问题**：
- `fetch` 失败只记录日志
- 没有重试机制
- 没有断路器模式

**建议**：

```typescript
// 添加重试机制
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(1000 * Math.pow(2, i));
    }
  }
}
```

---

#### 5. 日志系统不统一

**问题**：
- 部分使用 `console.log`，部分使用 `logger`
- 日志级别混乱
- 缺少请求 ID 追踪

**建议**：统一使用 logger，添加请求 ID

---

#### 6. 配置管理分散

**问题**：
- 配置分散在环境变量、config.env、命令行参数
- 没有配置验证
- 缺少默认值说明

**建议**：使用 zod 或类似库进行配置校验

---

### 🟢 低优先级优化

#### 7. 代码组织优化

**问题**：
- `main.ts` 过大（约 480 行）
- 模块边界不清晰
- 部分函数缺少类型定义

**建议**：拆分模块

```
src/
├── wechat/
│   ├── monitor.ts      # 长轮询
│   ├── sender.ts       # 消息发送
│   ├── api.ts          # API 封装
│   └── types.ts        # 类型定义
├── opencode/
│   ├── provider.ts     # OpenCode 交互
│   └── types.ts
├── commands/
│   ├── router.ts      # 命令路由
│   └── handlers.ts     # 命令处理
├── session/
│   └── manager.ts      # 会话管理
├── core/
│   ├── message-queue.ts
│   ├── error-handler.ts
│   └── logger.ts
└── main.ts
```

---

#### 8. 性能优化点

| 优化项 | 说明 | 优先级 |
|--------|------|--------|
| 模型配置缓存 | `getModelConfig()` 每次请求都调用 API，应该缓存 | 高 |
| 会话复用优化 | 根据上下文长度智能决定是否创建新会话 | 高 |
| 消息分块发送 | 长文本消息分块发送，提升用户体验 | 中 |
| Typing 状态优化 | 考虑使用流式响应 | 中 |

---

#### 9. 可观测性不足

**建议**：

```typescript
// 添加 metrics
const metrics = {
  messagesReceived: counter,
  messagesSent: counter,
  opencodeLatency: histogram,
  errorRate: gauge,
};
```

---

## 四、安全问题

### 1. 权限模式风险

**位置**：handlers.ts:83

```typescript
auto: '自动批准所有工具（危险模式）',
```

- `auto` 模式风险极高，建议增加二次确认
- 考虑添加 IP 白名单

---

### 2. API Token 安全

- Token 存储在 config.env，建议使用密钥管理服务
- 避免在日志中打印敏感信息

---

## 五、高并发架构演进建议

### 目标架构

```
                    ┌─────────────────┐
                    │   Load Balancer │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
    ┌─────▼─────┐    ┌──────▼──────┐    ┌──────▼──────┐
    │  Instance1 │    │  Instance2  │    │  Instance3  │
    └─────┬─────┘    └──────┬──────┘    └──────┬──────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Redis (会话)   │
                    │  消息队列        │
                    └─────────────────┘
```

### 关键组件

| 组件 | 用途 |
|------|------|
| Redis | 分布式会话存储、消息队列 |
| 消息队列 | 解耦请求处理，支持高并发 |
| 健康检查 | 多实例间故障转移 |
| 配置中心 | 统一配置管理 |

---

## 六、测试建议

```typescript
// 1. 单元测试
describe('sendToOpenCode', () => {
  it('should handle concurrent requests');
  it('should cleanup typing on error');
  it('should retry on fetch failure');
});

// 2. 集成测试
describe('Message flow', () => {
  it('should handle user → bot → opencode → response');
});

// 3. 压力测试
// 使用 k6 或 artillery 模拟高并发
```

---

## 七、总结

| 维度 | 评分 | 说明 |
|------|------|------|
| **功能完整性** | ⭐⭐⭐⭐ | 核心功能完善，命令系统丰富 |
| **代码质量** | ⭐⭐⭐ | 基本可用，但需重构大型模块 |
| **架构设计** | ⭐⭐⭐ | 适合单机，低并发场景 |
| **可维护性** | ⭐⭐⭐ | 模块边界需加强 |
| **性能** | ⭐⭐⭐ | 需优化会话管理和并发控制 |
| **安全性** | ⭐⭐⭐ | 需加强权限控制和敏感信息管理 |

### 建议优先处理

1. 添加并发控制
2. 统一会话管理
3. 添加重试机制和断路器
4. 拆分大型模块

---

## 八、后续跟踪

| 问题 | 状态 | 负责人 | 完成日期 |
|------|------|--------|----------|
| 并发控制 | 待处理 | - | - |
| 会话管理 | 待处理 | - | - |
| 重试机制 | 待处理 | - | - |
| 模块拆分 | 待处理 | - | - |
