import { WeChatApi } from './api.js';
import { MessageItemType, MessageType, MessageState, type MessageItem, type OutboundMessage } from './types.js';
import { logger } from '../logger.js';

export function createSender(api: WeChatApi, botAccountId: string) {
  let clientCounter = 0;

  function generateClientId(): string {
    return `wcc-${Date.now()}-${++clientCounter}`;
  }

  async function sendText(toUserId: string, contextToken: string, text: string): Promise<void> {
    const clientId = generateClientId();

    const items: MessageItem[] = [
      {
        type: MessageItemType.TEXT,
        text_item: { text },
      },
    ];

    const msg: OutboundMessage = {
      from_user_id: botAccountId,
      to_user_id: toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: items,
    };

    logger.info('Sending text message', { toUserId, clientId, textLength: text.length });
    await api.sendMessage({ msg });
    logger.info('Text message sent', { toUserId, clientId });
  }

  async function sendTyping(toUserId: string, contextToken: string): Promise<string> {
    const clientId = generateClientId();

    const items: MessageItem[] = [
      {
        type: MessageItemType.TEXT,
        text_item: { text: '' },
      },
    ];

    const msg: OutboundMessage = {
      from_user_id: botAccountId,
      to_user_id: toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.GENERATING,
      context_token: contextToken,
      item_list: items,
    };

    logger.info('Sending typing indicator', { toUserId, clientId });
    await api.sendMessage({ msg });
    logger.info('Typing indicator sent', { toUserId, clientId });
    return clientId;
  }

  async function stopTyping(toUserId: string, contextToken: string, typingClientId: string): Promise<void> {
    const items: MessageItem[] = [
      {
        type: MessageItemType.TEXT,
        text_item: { text: '' },
      },
    ];

    const msg: OutboundMessage = {
      from_user_id: botAccountId,
      to_user_id: toUserId,
      client_id: typingClientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      context_token: contextToken,
      item_list: items,
    };

    logger.info('Stopping typing indicator', { toUserId, clientId: typingClientId });
    await api.sendMessage({ msg });
    logger.info('Typing indicator stopped', { toUserId, clientId: typingClientId });
  }

  return { sendText, sendTyping, stopTyping };
}
