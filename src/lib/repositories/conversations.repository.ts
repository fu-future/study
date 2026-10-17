import type { Conversation, Message } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readObject, toJsonText } from '@/lib/db/json';

/**
 * 答疑对话的数据访问层。
 *
 * 隐私注意：对话内容可能包含学生个人信息，所有查询都强制带 userId；
 * 消息元数据只记录模型名、耗时、token 用量，**不记录任何密钥或完整提示词**。
 */

export type MessageView = Omit<Message, 'metadataJson'> & { metadata: Record<string, unknown> };

export function toMessageView(message: Message): MessageView {
  const { metadataJson, ...rest } = message;
  return { ...rest, metadata: readObject(metadataJson) };
}

export async function createConversation(
  userId: string,
  input: {
    title?: string;
    mode?: string;
    subjectId?: string | null;
    grade?: string | null;
    questionId?: string | null;
  },
): Promise<Conversation> {
  return prisma.conversation.create({
    data: {
      userId,
      title: input.title?.slice(0, 80) ?? '新的提问',
      mode: input.mode ?? 'guided',
      subjectId: input.subjectId ?? null,
      grade: input.grade ?? null,
      questionId: input.questionId ?? null,
    },
  });
}

export async function findConversationForUser(
  userId: string,
  conversationId: string,
): Promise<Conversation | null> {
  return prisma.conversation.findFirst({
    where: { id: conversationId, userId, isArchived: false },
  });
}

export async function listConversations(userId: string, options: { limit?: number } = {}) {
  return prisma.conversation.findMany({
    where: { userId, isArchived: false },
    orderBy: { updatedAt: 'desc' },
    take: options.limit ?? 30,
    include: {
      _count: { select: { messages: true } },
      subject: { select: { id: true, name: true } },
    },
  });
}

export async function getConversationWithMessages(userId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId, isArchived: false },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conversation) return null;

  return {
    conversation,
    messages: conversation.messages.map(toMessageView),
  };
}

export async function appendMessage(
  conversationId: string,
  input: {
    role: string;
    content: string;
    contentType?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<Message> {
  const message = await prisma.message.create({
    data: {
      conversationId,
      role: input.role,
      content: input.content,
      contentType: input.contentType ?? 'markdown',
      metadataJson: toJsonText(input.metadata ?? {}, '{}'),
    },
  });

  // 顺带刷新会话的 updatedAt，让「最近提问」排序正确
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return message;
}

/** 用首条提问自动生成会话标题（截断到 30 字），避免所有会话都叫「新的提问」。 */
export async function autoTitleConversation(conversationId: string, firstUserMessage: string): Promise<void> {
  const title = firstUserMessage.replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!title) return;
  await prisma.conversation.updateMany({
    where: { id: conversationId, title: '新的提问' },
    data: { title },
  });
}

export async function countMessages(conversationId: string): Promise<number> {
  return prisma.message.count({ where: { conversationId } });
}

/** 取最近 N 条消息作为多轮对话上下文（不含本次），控制上下文长度。 */
export async function listRecentMessages(conversationId: string, limit = 12): Promise<Message[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.reverse();
}

export async function archiveConversation(userId: string, conversationId: string): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: conversationId, userId },
    data: { isArchived: true },
  });
}
