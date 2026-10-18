'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  FileText,
  Info,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Label,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';
import { Markdown, plainPreview } from '@/components/markdown';
import { MistakeUploadDialog } from '@/components/mistakes/mistake-upload-dialog';
import { MistakeEntryDialog } from '@/components/mistakes/mistake-entry-dialog';
import {
  DEFAULT_TEACHING_MODE,
  TEACHING_MODE_CODES,
  teachingModeLabel,
  type TeachingMode,
} from '@/lib/domain/enums';
import { cn, formatRelative } from '@/lib/utils';
import {
  apiGet,
  isApiError,
  type ConversationDetailDto,
  type ConversationDto,
  type SubjectDto,
} from '@/lib/client-api';

/**
 * AI 答疑。
 *
 * 流式渲染的关键点：
 *   1. 用 fetch + response.body.getReader() 自己解析 SSE（每行 `data: <json>`）
 *   2. 增量拼接助手消息，边收边渲染（Markdown + KaTeX）
 *   3. 「停止生成」用 AbortController，已经生成的部分保留下来，不会白丢
 *   4. 非 SSE 的错误响应（HTTP 4xx/5xx）按统一错误体处理，给出可读提示
 */

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 正在流式接收中 */
  streaming?: boolean;
  /** 这条消息相关的提示（中断、失败原因等） */
  notice?: string;
};

/** 快捷指令文案（与服务端 QUICK_INSTRUCTIONS 的措辞保持一致，这里不引服务端模块）。 */
const QUICK_INSTRUCTIONS: { label: string; text: string }[] = [
  { label: '讲简单点', text: '上面的解释我还是不太懂。请用更简单的方式重新讲一遍，多用生活里的类比，少用术语。' },
  { label: '只讲这一步', text: '请只讲这一步：为什么可以这样做？其他部分先不用管。' },
  { label: '再来一道类似的', text: '请再给我出一道类似的例题（不要给答案），我想自己试试。' },
  { label: '出两道练习题', text: '请给我 2 道巩固练习题（先不要给答案），我做完再来对。' },
  { label: '帮我复盘这道错题', text: '我刚做错了这道题。请帮我复盘：错误发生在哪一步，以及下次怎么避免。' },
];

export function TutorClient({ subjects }: { subjects: SubjectDto[] }) {
  const searchParams = useSearchParams();
  const questionId = searchParams.get('questionId') ?? '';

  const [conversations, setConversations] = React.useState<ConversationDto[]>([]);
  const [conversationsLoading, setConversationsLoading] = React.useState(true);
  const [conversationsError, setConversationsError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = React.useState(false);
  const [mode, setMode] = React.useState<TeachingMode>(DEFAULT_TEACHING_MODE);
  const [subjectId, setSubjectId] = React.useState('');
  const [input, setInput] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  /**
   * 学生刚交给 AI 的那道题。
   *
   * 有了它，/api/chat 会把题干、已记录的答案与解析一起作为背景交给模型，
   * 学生就不用再把题目重新打一遍 —— 这也是「答疑」和「错题本」打通的连接点。
   */
  const [attachedQuestion, setAttachedQuestion] = React.useState<{
    id: string;
    stem: string;
    imageUrl: string | null;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showList, setShowList] = React.useState(false);

  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  // 记录最后一次发送的内容，出错后可以一键重试
  const lastSentRef = React.useRef<string | null>(null);

  // ---- 会话列表 ----
  const loadConversations = React.useCallback(async () => {
    setConversationsLoading(true);
    setConversationsError(null);
    try {
      const data = await apiGet<{ items: ConversationDto[] }>('/api/conversations');
      setConversations(data.items ?? []);
    } catch (err) {
      setConversationsError(isApiError(err) ? err.message : '读取历史对话失败，请重试。');
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // ---- 打开某段历史对话 ----
  const openConversation = React.useCallback(async (id: string) => {
    setActiveId(id);
    setShowList(false);
    setError(null);
    setMessagesLoading(true);
    try {
      const data = await apiGet<ConversationDetailDto>(`/api/conversations/${id}`);
      setMessages(
        (data.messages ?? []).map((message) => ({
          id: message.id,
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content,
        })),
      );
      if (data.conversation.mode && TEACHING_MODE_CODES.includes(data.conversation.mode as TeachingMode)) {
        setMode(data.conversation.mode as TeachingMode);
      }
      if (data.conversation.subjectId) setSubjectId(data.conversation.subjectId);
    } catch (err) {
      setError(isApiError(err) ? err.message : '这段对话没能打开。');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  function startNewConversation() {
    setActiveId(null);
    setMessages([]);
    setError(null);
    setShowList(false);
  }

  // 自动滚到底部（只滚容器，不影响整页）
  React.useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  // 离开页面时取消未完成的请求
  React.useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * 把刚录入/识别的题目挂到当前对话上。
   *
   * 同时预填一句可以直接发送的起手问题 —— 面向高中生，
   * 「先给提示、不要直接给答案」是默认更有利于学习的问法（引导模式）。
   */
  function attachQuestion(question: { id: string; stem: string; imageUrl: string | null }) {
    setAttachedQuestion(question);
    setError(null);
    setInput((current) =>
      current.trim()
        ? current
        : question.imageUrl
          ? '这是我刚上传的题目。请先告诉我该从哪里入手，不要直接给完整答案。'
          : '这是我想要问的题目。请先给我一个思路提示，不要直接给完整答案。',
    );
  }

  // ---- 发送 + SSE 解析 ----
  async function sendMessage(rawText: string) {
    const text = rawText.trim();
    if (!text || streaming) return;

    lastSentRef.current = text;
    setError(null);
    setInput('');

    const userMessage: ChatMessage = { id: `local-user-${Date.now()}`, role: 'user', content: text };
    const assistantId = `local-assistant-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const patchAssistant = (patch: Partial<ChatMessage>) => {
      setMessages((current) =>
        current.map((message) => (message.id === assistantId ? { ...message, ...patch } : message)),
      );
    };
    const appendAssistant = (chunk: string) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, content: message.content + chunk } : message,
        ),
      );
    };

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        signal: controller.signal,
        body: JSON.stringify({
          ...(activeId ? { conversationId: activeId } : {}),
          message: text,
          mode,
          ...(subjectId ? { subjectId } : {}),
          // 已关联的题目优先于从错题本跳转过来带的 questionId
          ...(attachedQuestion?.id || questionId
            ? { questionId: attachedQuestion?.id ?? questionId }
            : {}),
        }),
      });

      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok || !contentType.includes('text/event-stream')) {
        // 错误响应不是 SSE，body 是统一错误体
        let message = `请求没有成功（状态码 ${response.status}）。`;
        try {
          const body = (await response.json()) as {
            ok?: boolean;
            error?: { message?: string; code?: string };
          };
          if (body?.error?.message) message = body.error.message;
        } catch {
          /* 保底用上面的通用文案 */
        }
        patchAssistant({ streaming: false, notice: message });
        setError(message);
        return;
      }

      if (!response.body) {
        patchAssistant({ streaming: false, notice: '没有收到内容，请重试。' });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;

      const handlePayload = (payload: string) => {
        if (payload === '[DONE]') {
          finished = true;
          return;
        }
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          return; // 半截 JSON 直接忽略，等下一行
        }

        const type = typeof event.type === 'string' ? event.type : '';

        if (type === 'start') {
          const conversationId = typeof event.conversationId === 'string' ? event.conversationId : '';
          if (conversationId) setActiveId((current) => current ?? conversationId);
          return;
        }
        if (type === 'delta') {
          const chunk = typeof event.text === 'string' ? event.text : '';
          if (chunk) appendAssistant(chunk);
          return;
        }
        if (type === 'error') {
          const message = typeof event.message === 'string' ? event.message : '这次回复中断了。';
          patchAssistant({ streaming: false, notice: message });
          setError(message);
          return;
        }
        if (type === 'done') {
          patchAssistant({ streaming: false });
          return;
        }
        // usage 事件只用于统计，界面不展示
      };

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.startsWith('data:')) handlePayload(line.slice(5).trim());
          newlineIndex = buffer.indexOf('\n');
        }
      }

      if (buffer.trim().startsWith('data:')) handlePayload(buffer.trim().slice(5).trim());

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                streaming: false,
                content:
                  message.content.trim().length > 0
                    ? message.content
                    : '这次没有收到内容。可以换个说法再问一次，或者把题目拆小一点。',
              }
            : message,
        ),
      );

      // 新会话可能出现，刷新左侧列表
      void loadConversations();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        patchAssistant({ streaming: false, notice: '已停止生成。已经写出来的部分保留在上面。' });
      } else {
        const message = '网络中断了，这次回复没有完成。再点一次发送可以重试。';
        patchAssistant({ streaming: false, notice: message });
        setError(message);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  const activeConversation = conversations.find((item) => item.id === activeId) ?? null;

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">AI 答疑</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          提问时把「你已经想到哪一步」说出来，讲解会更贴合你的思路。默认是引导模式：
          先提示，不直接把答案给你。
        </p>
      </header>

      {questionId ? (
        <Alert variant="info" title="正在围绕一道错题提问">
          <p className="flex flex-wrap items-center gap-2">
            这次对话会把那道题的题干与已记录的解析作为背景。
            <Link className="underline underline-offset-2" href={`/mistakes/${questionId}`}>
              返回错题详情
            </Link>
          </p>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* 会话列表 */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Button
            variant="outline"
            className="w-full lg:hidden"
            onClick={() => setShowList((value) => !value)}
            aria-expanded={showList}
          >
            <MessageCircle aria-hidden />
            历史对话（{conversations.length}）
          </Button>

          <div className={cn('space-y-2', showList ? 'mt-2 block' : 'hidden lg:block')}>
            <Button className="w-full" onClick={startNewConversation}>
              <Plus aria-hidden />
              新对话
            </Button>

            {conversationsLoading ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : conversationsError ? (
              <Alert variant="destructive" title="历史对话没读出来">
                <p>{conversationsError}</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => void loadConversations()}>
                  <RefreshCw aria-hidden />
                  重试
                </Button>
              </Alert>
            ) : conversations.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                还没有历史对话。问出第一个问题后，这里会保存下来，方便你下次接着问。
              </p>
            ) : (
              <ul className="space-y-1">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => void openConversation(conversation.id)}
                      aria-current={conversation.id === activeId ? 'true' : undefined}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                        conversation.id === activeId
                          ? 'border-primary/30 bg-primary/10 text-primary'
                          : 'hover:bg-muted',
                      )}
                    >
                      <span className="block truncate font-medium">
                        {conversation.title || '新的提问'}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {teachingModeLabel(conversation.mode)} · {conversation.messageCount} 条 ·{' '}
                        {formatRelative(conversation.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* 对话区 */}
        <Card className="flex min-h-[32rem] flex-col">
          <CardContent className="flex flex-1 flex-col gap-3 p-4">
            {/* 对话设置 */}
            <div className="flex flex-col gap-3 border-b pb-3">
              <div>
                <Label id="mode-label">讲解模式</Label>
                <div
                  className="mt-1.5 flex flex-wrap gap-1.5"
                  role="group"
                  aria-labelledby="mode-label"
                >
                  {TEACHING_MODE_CODES.map((code) => (
                    <Button
                      key={code}
                      type="button"
                      size="sm"
                      variant={mode === code ? 'default' : 'outline'}
                      aria-pressed={mode === code}
                      disabled={streaming}
                      onClick={() => setMode(code as TeachingMode)}
                    >
                      {teachingModeLabel(code)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[10rem] flex-1">
                  <Label htmlFor="tutor-subject">学科（可选）</Label>
                  <Select
                    id="tutor-subject"
                    className="mt-1.5"
                    value={subjectId}
                    disabled={streaming}
                    onChange={(event) => setSubjectId(event.target.value)}
                  >
                    <option value="">不指定</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </Select>
                </div>
                {activeConversation ? (
                  <Badge variant="secondary" className="mb-2">
                    正在进行：{plainPreview(activeConversation.title, 16)}
                  </Badge>
                ) : null}
              </div>
            </div>

            {/* 消息区 */}
            <div
              ref={scrollRef}
              className="scroll-thin min-h-[16rem] flex-1 space-y-4 overflow-y-auto pr-1"
              aria-live="polite"
              aria-busy={streaming}
            >
              {messagesLoading ? (
                <div className="space-y-3" aria-busy="true">
                  <Skeleton className="ml-auto h-16 w-2/3" />
                  <Skeleton className="h-24 w-5/6" />
                </div>
              ) : messages.length === 0 ? (
                <EmptyState
                  icon={<Sparkles aria-hidden />}
                  title="想从哪里开始？"
                  description="可以直接把题目贴进来，也可以说说你卡在哪一步。写清楚「我试过什么、卡在哪里」，讲解会更有用。"
                />
              ) : (
                messages.map((message) =>
                  message.role === 'user' ? (
                    <div key={message.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
                        {message.content}
                      </div>
                    </div>
                  ) : (
                    <div key={message.id} className="space-y-1.5">
                      <div className="rounded-2xl rounded-bl-sm border bg-card px-3.5 py-2.5">
                        {message.content ? (
                          <Markdown streaming={message.streaming}>{message.content}</Markdown>
                        ) : (
                          <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 aria-hidden className="size-4 animate-spin" />
                            正在想…
                          </p>
                        )}
                      </div>
                      {message.notice ? (
                        <p className="flex items-start gap-2 text-xs text-muted-foreground">
                          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                          {message.notice}
                        </p>
                      ) : null}
                    </div>
                  ),
                )
              )}
            </div>

            {/* 快捷指令 */}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_INSTRUCTIONS.map((instruction) => (
                <Button
                  key={instruction.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={streaming || messages.length === 0}
                  onClick={() => void sendMessage(instruction.text)}
                >
                  {instruction.label}
                </Button>
              ))}
            </div>

            {error ? (
              <Alert variant="destructive" title="这次没有成功">
                <p>{error}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={streaming || !lastSentRef.current}
                    onClick={() => {
                      if (lastSentRef.current) void sendMessage(lastSentRef.current);
                    }}
                  >
                    <RefreshCw aria-hidden />
                    重试刚才的问题
                  </Button>
                </div>
              </Alert>
            ) : null}

            {/* 输入区 */}
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage(input);
              }}
            >
              {/* 题目入口：拍照 / 上传图片识别，或手动输入题干 */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-muted/30 p-2.5">
                <span className="pl-1 text-xs text-muted-foreground">要把一道题目交给 AI？</span>
                <MistakeUploadDialog
                  subjects={subjects}
                  defaultSubjectId={subjectId || undefined}
                  triggerLabel="拍照 / 上传题目图片"
                  onCreated={attachQuestion}
                />
                <MistakeEntryDialog
                  subjects={subjects}
                  defaultSubjectId={subjectId || undefined}
                  triggerLabel="手动输入题目"
                  triggerVariant="outline"
                  onCreated={attachQuestion}
                />
              </div>

              {attachedQuestion ? (
                <div className="rounded-xl border bg-muted/40 p-3">
                  <div className="flex items-start gap-3">
                    {attachedQuestion.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attachedQuestion.imageUrl}
                        alt="已关联的题目图片"
                        className="size-16 shrink-0 rounded-lg border object-cover"
                      />
                    ) : (
                      <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground">
                        <FileText aria-hidden className="size-5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        已关联这道题（AI 会看到题干、答案与解析）
                      </p>
                      <p className="mt-1 line-clamp-3 text-sm">{attachedQuestion.stem}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="取消关联这道题"
                      onClick={() => setAttachedQuestion(null)}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                </div>
              ) : null}

              <Label htmlFor="tutor-input">你的问题</Label>
              <Textarea
                id="tutor-input"
                value={input}
                rows={3}
                maxLength={4000}
                placeholder="例如：这题我算到第二步就不会了，为什么这里要提取公因式？"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={streaming}
                className="min-h-[76px]"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Enter 发送 · Shift + Enter 换行 · {input.length}/4000
                </p>
                {streaming ? (
                  <Button type="button" variant="outline" onClick={handleStop}>
                    <Square aria-hidden />
                    停止生成
                  </Button>
                ) : (
                  <Button type="submit" disabled={!input.trim()}>
                    <Send aria-hidden />
                    发送
                  </Button>
                )}
              </div>
            </form>

            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              AI 的讲解可能有错。如果和你的老师、教材说法不一致，请以教材和老师为准，也欢迎直接指出。
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
