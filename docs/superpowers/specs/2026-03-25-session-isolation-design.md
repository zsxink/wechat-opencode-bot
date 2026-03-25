# 会话隔离与工作目录管理设计

## 概述

解决微信 OpenCode Bot 中会话管理的三个问题：
1. 会话按工作目录隔离，防止跨目录会话混乱
2. 正在输入状态显示
3. 消息队列处理（防止重复处理）

## 问题分析

### 问题1：会话恢复混乱
- 当前 `session.sdkSessionId` 是全局的
- 切换工作目录后仍然使用旧会话
- 导致会话在错误的工作目录下恢复

### 问题2：正在输入状态
- 用户发送消息后，微信端看不到"正在输入"标识
- 需要发送 `MessageState.GENERATING` 状态

### 问题3：消息队列
- OpenCode 处理消息时，用户又发消息
- 需要回复"正在处理上一条消息，请稍后"并丢弃消息

## 设计方案

### 1. 会话存储结构

```typescript
// session.ts
interface Session {
  // 旧的单一会话 ID（废弃）
  // sdkSessionId?: string;
  
  // 新的：按工作目录存储会话
  sessionsByCwd: Record<string, string>;  // { "/path/to/project": "session-id-123" }
  
  // 微信创建的会话 ID 列表
  wechatSessions: string[];
  
  workingDirectory: string;
  // ... 其他字段
}
```

### 2. 启动流程

1. `npm run daemon:start` 只连接 OpenCode，不创建会话
2. 用户发消息时，查找当前工作目录的会话
3. 没有会话则在工作目录创建新会话

### 3. 会话名称

- 使用用户第一条消息的前20字作为会话标题
- 格式：`微信: {用户消息前20字}...`

### 4. 命令系统

| 命令 | 功能 |
|------|------|
| `/sessions` | 显示微信创建的会话列表 |
| `/session <id>` | 切换到指定会话 |
| `/new` | 清除当前工作目录的会话 |
| `/cwd <path>` | 切换工作目录（可跳出根目录） |

### 5. 隔离机制

- 微信只能看到/使用 `wechatSessions` 中的会话
- 其他方式创建的会话对微信不可见

### 6. 正在输入状态

修改 `sendTyping` 函数：
- 添加占位符文本项 `text_item: { text: '' }`
- 发送 `MessageState.GENERATING` 状态
- 处理完成后发送 `MessageState.FINISH` 状态

### 7. 消息队列处理

在 `handleMessage` 中检测 `session.state`：
```typescript
if (session.state === 'processing') {
  await sender.sendText(fromUserId, contextToken, '⏳ 正在处理上一条消息，请稍后...');
  return;
}
```

## 数据流

```
用户发送消息
    ↓
检查 session.state
    ↓ (如果是 processing)
回复"正在处理中"并丢弃
    ↓ (如果是 idle)
查找 sessionsByCwd[workingDirectory]
    ↓ (如果有会话)
恢复会话
    ↓ (如果没有会话)
创建新会话，添加到 wechatSessions
    ↓
发送"正在输入"状态
    ↓
调用 OpenCode API
    ↓
发送回复，停止"正在输入"状态
```

## 文件修改

1. **src/session.ts**
   - 修改 Session 接口
   - 添加 sessionsByCwd 和 wechatSessions 字段
   - 修改 load/save 函数

2. **src/opencode/provider.ts**
   - 修改 openCodeQuery 支持按工作目录查找会话
   - 添加 createSessionWithSummary 函数

3. **src/main.ts**
   - 修改 sendToOpenCode 使用新的会话逻辑
   - 添加 /sessions 和 /session 命令处理

4. **src/wechat/send.ts**
   - 修改 sendTyping 添加占位符文本项

5. **src/commands/handlers.ts**
   - 添加 handleSessions 和 handleSession 命令

## 测试要点

1. 切换工作目录后，会话是否正确隔离
2. 正在输入状态是否显示
3. 消息队列处理是否正确
4. /sessions 命令是否只显示微信创建的会话
5. /session 命令是否能正确切换会话
