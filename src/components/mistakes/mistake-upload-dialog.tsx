'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Sparkles, Upload, X } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Progress,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { Markdown } from '@/components/markdown';
import { ERROR_TYPES, errorTypeLabel } from '@/lib/domain/enums';
import {
  ApiError,
  apiPost,
  toUserMessage,
  type QuestionAnalysisDto,
  type QuestionUploadDto,
} from '@/lib/client-api';
import { cn } from '@/lib/utils';

/**
 * 上传错题图片 → AI 识别 → 学生确认 → 保存。
 *
 * 为什么不让识别结果直接入库：
 * 图片识别（OCR）一定会出错。所以这里先把识别结果摊开给学生核对、修改，
 * 确认之后再调用创建接口 —— 「AI 猜的」和「学生确认过的」必须区分开。
 */

const ACCEPTED = 'image/png,image/jpeg,image/webp';
const MAX_BYTES = 5 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 用 XHR 而不是 fetch：只有 XHR 能拿到上传进度。 */
function uploadWithProgress(
  file: File,
  onProgress: (percent: number) => void,
): Promise<QuestionUploadDto> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/questions/upload');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        body = null;
      }
      const envelope = body as
        | { ok: true; data: QuestionUploadDto }
        | { ok: false; error: { code: string; message: string } }
        | null;

      if (request.status >= 200 && request.status < 300 && envelope && envelope.ok) {
        resolve(envelope.data);
        return;
      }
      reject(
        new ApiError(
          envelope && !envelope.ok ? envelope.error.message : `上传失败（状态码 ${request.status}）`,
          { code: envelope && !envelope.ok ? envelope.error.code : 'UPLOAD_FAILED', status: request.status },
        ),
      );
    };
    request.onerror = () =>
      reject(new ApiError('上传过程中网络中断了，请重试。', { code: 'NETWORK_ERROR', status: 0 }));
    request.ontimeout = () => reject(new ApiError('上传超时了，可以换张更小的图再试。', { code: 'TIMEOUT' }));

    const form = new FormData();
    form.append('file', file);
    request.send(form);
  });
}

export function MistakeUploadDialog({
  subjects,
  defaultSubjectId,
  onCreated,
  triggerLabel = '上传图片识别',
}: {
  subjects: { id: string; name: string }[];
  defaultSubjectId?: string;
  /**
   * 保存成功后的回调：把刚建立的题目交回给调用方。
   * 答疑页用它把「刚拍/刚传的题目」直接挂到当前对话上，学生就能马上开始问。
   */
  onCreated?: (question: { id: string; stem: string; imageUrl: string | null }) => void;
  /** 触发按钮文案（错题本用默认值，答疑页用「拍照 / 上传题目」） */
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const [file, setFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [subjectId, setSubjectId] = React.useState(defaultSubjectId ?? subjects[0]?.id ?? '');

  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const [analysis, setAnalysis] = React.useState<QuestionAnalysisDto | null>(null);
  // 必须记住它：保存题目时要带上，否则上传的原图会变成孤儿文件
  const [uploadId, setUploadId] = React.useState<string | null>(null);
  const [stem, setStem] = React.useState('');
  const [choicesText, setChoicesText] = React.useState('');
  const [correctAnswer, setCorrectAnswer] = React.useState('');
  const [explanation, setExplanation] = React.useState('');
  const [errorTypes, setErrorTypes] = React.useState<string[]>([]);

  // 本地预览用的 object URL 必须手动释放，否则会一直占着内存
  React.useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function reset() {
    setFile(null);
    setAnalysis(null);
    setUploadId(null);
    setStem('');
    setChoicesText('');
    setCorrectAnswer('');
    setExplanation('');
    setErrorTypes([]);
    setError(null);
    setProgress(0);
    setSaved(false);
  }

  async function handleAnalyze() {
    setError(null);
    if (!file) {
      setError('请先选择一张题目截图。');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`图片太大了（${formatBytes(file.size)}）。上限 5 MB，可以先用截图工具压缩一下。`);
      return;
    }

    setUploading(true);
    setProgress(0);
    try {
      const uploaded = await uploadWithProgress(file, setProgress);
      setUploadId(uploaded.uploadId);
      setUploading(false);
      setAnalyzing(true);

      const result = await apiPost<QuestionAnalysisDto>('/api/questions/analyze', {
        uploadId: uploaded.uploadId,
        ...(subjectId ? { subjectId } : {}),
        createMistake: false,
      });

      setAnalysis(result);
      setStem(result.analysis.stem ?? '');
      setChoicesText((result.analysis.choices ?? []).join('\n'));
      setCorrectAnswer(result.analysis.correctAnswer ?? '');
      setExplanation(result.analysis.explanation ?? '');
      setErrorTypes(result.analysis.errorTypes ?? []);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setUploading(false);
      setAnalyzing(false);
    }
  }

  async function handleSave() {
    setError(null);
    if (!subjectId) {
      setError('请选择学科，这样错题才能归到正确的科目里。');
      return;
    }
    if (!stem.trim()) {
      setError('题干是空的，请先补上识别不出的部分。');
      return;
    }

    setSaving(true);
    try {
      const created = await apiPost<{
        question: { id: string; stem: string; imageUrl: string | null };
      }>('/api/questions', {
        subjectId,
        stem: stem.trim(),
        stemFormat: 'text',
        // 把上传的原图关联到题目
        imagePath: uploadId,
        choices: choicesText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        correctAnswer: correctAnswer.trim() || null,
        explanation: explanation.trim() || null,
        errorTypes,
        knowledgePointIds: (analysis?.matchedKnowledgePoints ?? []).map((point) => point.id),
        createMistake: true,
      });
      setSaved(true);
      onCreated?.({
        id: created.question.id,
        stem: created.question.stem,
        imageUrl: created.question.imageUrl ?? null,
      });
      router.refresh();
      window.setTimeout(() => {
        setOpen(false);
        reset();
      }, 900);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length > 0) {
        setError(Object.values(err.fieldErrors)[0] ?? toUserMessage(err));
      } else {
        setError(toUserMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Dialog.Trigger asChild>
        <Button variant="outline">
          <Upload aria-hidden />
          {triggerLabel}
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/25" />
        <Dialog.Content className="scroll-thin fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(36rem,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">上传错题图片</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                支持 PNG / JPG / WEBP，单张不超过 5 MB。识别结果会先给你核对，确认后才保存。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <div className="mt-4 space-y-4">
            {error ? (
              <Alert variant="destructive" title="这一步没有成功">
                <p>{error}</p>
              </Alert>
            ) : null}

            <Field
              label="题目截图"
              htmlFor="upload-file"
              hint="尽量只截题目本身，光线均匀、字迹清晰识别会更准"
            >
              <Input
                id="upload-file"
                type="file"
                accept={ACCEPTED}
                disabled={uploading || analyzing || saving}
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  setAnalysis(null);
                  setError(null);
                }}
              />
            </Field>

            {file && previewUrl ? (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                {/* 本地预览用的是 blob: URL，交给浏览器直接显示即可 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="待识别的题目截图预览"
                  className="h-16 w-16 rounded object-cover"
                />
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
              </div>
            ) : null}

            <Field label="学科" htmlFor="upload-subject" hint="指定学科能让知识点匹配更准">
              <Select
                id="upload-subject"
                value={subjectId}
                disabled={uploading || analyzing || saving}
                onChange={(event) => setSubjectId(event.target.value)}
              >
                <option value="">请选择</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            </Field>

            {uploading ? (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  正在上传… {progress}%
                </p>
                <Progress value={progress} label="图片上传进度" />
              </div>
            ) : null}

            {analyzing ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <Sparkles aria-hidden className="size-4 animate-pulse text-primary" />
                正在识别题干与知识点，请稍等…
              </p>
            ) : null}

            {analysis ? (
              <div className="space-y-4 rounded-xl border bg-muted/30 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">识别结果（请核对）</p>
                  {analysis.isMock ? <Badge variant="warning">示例数据</Badge> : null}
                  {analysis.needsUserConfirmation ? (
                    <Badge variant="soft">需要你确认</Badge>
                  ) : null}
                </div>

                {analysis.isMock ? (
                  <Alert variant="warning" title="当前是 Mock 模式">
                    <p>
                      现在没有配置真实 AI，这里显示的是示例结构，不是你题目的真实识别结果。
                      可以直接手动修改下面的内容，或者改用手动录入。
                    </p>
                  </Alert>
                ) : null}

                {analysis.needsUserConfirmation ? (
                  <Alert variant="warning" title="识别结果可能不完整">
                    <p>
                      {analysis.analysis.confidence < 0.5
                        ? 'AI 对这次识别的把握不高，'
                        : ''}
                      请对照原图检查题干与选项，把识别错的地方改过来再保存。
                    </p>
                  </Alert>
                ) : null}

                <Field label="题干" htmlFor="upload-stem">
                  <Textarea
                    id="upload-stem"
                    rows={4}
                    value={stem}
                    onChange={(event) => setStem(event.target.value)}
                  />
                </Field>

                <Field label="选项（一行一个）" htmlFor="upload-choices">
                  <Textarea
                    id="upload-choices"
                    rows={3}
                    value={choicesText}
                    onChange={(event) => setChoicesText(event.target.value)}
                  />
                </Field>

                <Field label="正确答案" htmlFor="upload-correct">
                  <Input
                    id="upload-correct"
                    value={correctAnswer}
                    onChange={(event) => setCorrectAnswer(event.target.value)}
                  />
                </Field>

                <Field label="解析" htmlFor="upload-explanation">
                  <Textarea
                    id="upload-explanation"
                    rows={3}
                    value={explanation}
                    onChange={(event) => setExplanation(event.target.value)}
                  />
                </Field>

                <fieldset>
                  <legend className="text-sm font-medium">
                    错误原因
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      （{errorTypes.length}/4）
                    </span>
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.keys(ERROR_TYPES).map((code) => {
                      const checked = errorTypes.includes(code);
                      return (
                        <label
                          key={code}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors',
                            checked ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-muted',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-3.5 accent-[hsl(var(--primary))]"
                            checked={checked}
                            onChange={() =>
                              setErrorTypes((current) =>
                                current.includes(code)
                                  ? current.filter((item) => item !== code)
                                  : [...current, code].slice(0, 4),
                              )
                            }
                          />
                          {errorTypeLabel(code)}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <div>
                  <p className="text-sm font-medium">匹配到的知识点</p>
                  {analysis.matchedKnowledgePoints.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      没有匹配到已有知识点。可以先保存，之后在错题详情里手动关联。
                    </p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {analysis.matchedKnowledgePoints.map((point) => (
                        <Badge key={point.id} variant="secondary">
                          {point.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {analysis.analysis.likelyCauses.length > 0 ? (
                  <div>
                    <p className="text-sm font-medium">可能的原因</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {analysis.analysis.likelyCauses.map((cause) => (
                        <li key={cause}>{cause}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {analysis.analysis.recommendedActions.length > 0 ? (
                  <div>
                    <p className="text-sm font-medium">接下来可以做什么</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {analysis.analysis.recommendedActions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {explanation.trim() ? (
                  <details className="rounded-lg border bg-card p-3">
                    <summary className="cursor-pointer text-sm font-medium">预览解析的排版</summary>
                    <div className="mt-2">
                      <Markdown>{explanation}</Markdown>
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}

            {saved ? (
              <Alert variant="success">
                <p className="flex items-center gap-2">
                  <Check aria-hidden className="size-4" />
                  已保存为错题，并安排了第一次复习。
                </p>
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle aria-hidden className="size-3.5" />
                识别出错是常事，你改过的内容会以你的版本为准。
              </p>
              <div className="flex gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline" disabled={saving}>
                    取消
                  </Button>
                </Dialog.Close>
                {analysis ? (
                  <Button type="button" onClick={() => void handleSave()} loading={saving}>
                    保存为错题
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => void handleAnalyze()}
                    loading={uploading || analyzing}
                    disabled={!file}
                  >
                    <Sparkles aria-hidden />
                    开始识别
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
