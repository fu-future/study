import { NextResponse } from 'next/server';
import { withApiHandler, readJsonBody } from '@/lib/api/http';
import { toAppError } from '@/lib/errors';
import { requireUser } from '@/lib/auth/current-user';
import { chatBodySchema } from '@/lib/validation/schemas';
import {
  buildTutorContext,
  ensureConversation,
  saveUserMessage,
  streamTutorReply,
} from '@/lib/ai/services/tutoring.service';

/**
 * AI 答疑（SSE 流式）。
 *
 * 为什么要用 SSE 而不是普通 JSON：
 *   学习讲解是长文本，逐字返回能显著降低「等待感」；
 *   而且一旦客户端断开，可以立刻 abort 上游请求，不白烧 token。
 *
 * 事件协议：每条消息 `data: <JSON>\n\n`，最后以 `data: [DONE]\n\n` 收尾。
 * 每个事件都带 conversationId —— 首次提问时前端才知道该把后续追问接到哪个会话。
 */
export const POST = withApiHandler(async (request: Request) => {
  const user = await requireUser();
  const body = chatBodySchema.parse(await readJsonBody(request));

  // 会话归属在服务层校验（别人的 conversationId 会直接 404）
  const conversationId = await ensureConversation(user.id, {
    conversationId: body.conversationId,
    mode: body.mode,
    subjectId: body.subjectId,
    grade: body.grade,
    questionId: body.questionId,
  });

  const context = await buildTutorContext(user.id, {
    mode: body.mode,
    conversationId,
    subjectId: body.subjectId,
    grade: body.grade,
    questionId: body.questionId,
  });

  // 先存提问再生成：即使生成失败，「问过什么」也一定有记录
  await saveUserMessage(conversationId, body.message, {
    mode: body.mode,
    subjectId: body.subjectId ?? null,
    questionId: body.questionId ?? null,
  });

  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (chunk: string) => {
        // 客户端断开后 controller 已失效，继续 enqueue 会抛错，这里静默收手
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      try {
        for await (const event of streamTutorReply({
          userId: user.id,
          conversationId,
          context,
          userMessage: body.message,
          // 客户端断开 → 立刻中止上游，避免为无人接收的回复继续付费
          abortSignal: request.signal,
        })) {
          write(`data: ${JSON.stringify(event)}\n\n`);
        }
        write('data: [DONE]\n\n');
      } catch (error) {
        // 流已开始，无法再改状态码；用错误事件把原因如实告诉前端
        const appError = toAppError(error);
        write(
          `data: ${JSON.stringify({
            type: 'error',
            code: appError.code,
            message: appError.userMessage,
            conversationId,
          })}\n\n`,
        );
        write('data: [DONE]\n\n');
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // 已断开，忽略
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 反向代理（nginx 等）默认会缓冲响应，导致流式失效
      'X-Accel-Buffering': 'no',
    },
  });
});
