'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { GRADES } from '@/lib/domain/enums';
import { ApiError, apiPatch, toUserMessage } from '@/lib/client-api';
import { cn } from '@/lib/utils';

/**
 * 首次使用向导。
 *
 * 拆成三步而不是一张长表单：一次只问一类事情，中途可以退回去改，
 * 出错也能精确定位到是哪一步的问题。
 */

export type OnboardingSubject = { id: string; code: string; name: string; isElective: boolean };

const STEPS = ['年级与教材', '选科与目标', '时间安排'] as const;

export function OnboardingWizard({
  subjects,
  initial,
}: {
  subjects: OnboardingSubject[];
  initial: {
    grade: string;
    textbookVersion: string;
    electiveSubjects: string[];
    studyGoal: string;
    examDate: string;
    dailyAvailableMinutes: number;
  };
}) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [grade, setGrade] = React.useState(initial.grade);
  const [textbookVersion, setTextbookVersion] = React.useState(initial.textbookVersion);
  const [electives, setElectives] = React.useState<string[]>(initial.electiveSubjects);
  const [studyGoal, setStudyGoal] = React.useState(initial.studyGoal);
  const [examDate, setExamDate] = React.useState(initial.examDate);
  const [dailyMinutes, setDailyMinutes] = React.useState(String(initial.dailyAvailableMinutes || 90));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  function toggleElective(code: string) {
    setElectives((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  }

  /** 每一步只校验本步相关的字段，避免「还没填到就先标红」的挫败感。 */
  function validateStep(index: number): boolean {
    const next: Record<string, string> = {};

    if (index === 0) {
      if (!grade) next.grade = '请选择你现在的年级';
    }

    if (index === 1) {
      if (electives.length === 0) next.electiveSubjects = '至少选择 1 个学科，之后可以随时增减';
    }

    if (index === 2) {
      const minutes = Number(dailyMinutes);
      if (!dailyMinutes || Number.isNaN(minutes)) next.dailyAvailableMinutes = '请填写每天大概能空出的分钟数';
      else if (minutes < 15) next.dailyAvailableMinutes = '至少 15 分钟，太短了很难安排出效果';
      else if (minutes > 600) next.dailyAvailableMinutes = '一天超过 10 小时不太现实，请填写更接近真实的数字';
      if (examDate && Number.isNaN(new Date(examDate).getTime())) next.examDate = '日期格式不正确';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (!validateStep(step)) return;
    setStep((value) => Math.min(STEPS.length - 1, value + 1));
  }

  function goBack() {
    setErrors({});
    setStep((value) => Math.max(0, value - 1));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validateStep(2)) return;

    setSubmitting(true);
    try {
      await apiPatch('/api/profile', {
        grade,
        textbookVersion: textbookVersion.trim() || null,
        electiveSubjects: electives,
        studyGoal: studyGoal.trim() || null,
        examDate: examDate || null,
        dailyAvailableMinutes: Number(dailyMinutes),
        onboardingCompleted: true,
      });
      router.push('/dashboard');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      }
      setFormError(toUserMessage(error));
      setSubmitting(false);
    }
  }

  const gradeLabel = grade || '还没选';

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* 步骤指示 */}
      <ol className="flex flex-wrap items-center gap-2" aria-label="向导步骤">
        {STEPS.map((label, index) => {
          const active = index === step;
          const done = index < step;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
                  active
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : done
                      ? 'border-success/25 bg-success/10 text-success'
                      : 'border-border text-muted-foreground',
                )}
              >
                {done ? <Check aria-hidden className="size-3.5" /> : null}
                第 {index + 1} 步 · {label}
              </span>
            </li>
          );
        })}
      </ol>

      {formError ? (
        <Alert variant="destructive" title="保存没有成功">
          <p>{formError}</p>
        </Alert>
      ) : null}

      {step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>先认识一下你的学习背景</CardTitle>
            <CardDescription>
              这些信息只用来调整讲解的深度和计划的分量，不会影响任何评分。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="年级" htmlFor="onboarding-grade" error={errors.grade} required>
              <Select
                id="onboarding-grade"
                value={grade}
                onChange={(event) => setGrade(event.target.value)}
                aria-invalid={Boolean(errors.grade)}
              >
                <option value="">请选择</option>
                {GRADES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="教材版本"
              htmlFor="onboarding-textbook"
              error={errors.textbookVersion}
              hint="例如「人教版必修第一册」「北师大版选择性必修」。不确定可以先留空"
            >
              <Input
                id="onboarding-textbook"
                value={textbookVersion}
                maxLength={60}
                placeholder="人教版必修第一册"
                onChange={(event) => setTextbookVersion(event.target.value)}
              />
            </Field>
          </CardContent>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>你选了哪些科目</CardTitle>
            <CardDescription>
              至少选 1 个。计划与资源会优先围绕你选的科目来安排，之后能随时调整。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">选科（可多选）</legend>
              <div className="flex flex-wrap gap-2">
                {subjects.map((subject) => {
                  const checked = electives.includes(subject.code);
                  return (
                    <label
                      key={subject.code}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                        checked ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-muted',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[hsl(var(--primary))]"
                        checked={checked}
                        onChange={() => toggleElective(subject.code)}
                      />
                      <span>{subject.name}</span>
                      {subject.isElective ? <Badge variant="outline">选考</Badge> : null}
                    </label>
                  );
                })}
              </div>
              {errors.electiveSubjects ? (
                <p className="mt-2 text-xs font-medium text-destructive" role="alert">
                  {errors.electiveSubjects}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">已选 {electives.length} 个学科</p>
              )}
            </fieldset>

            <Field
              label="学习目标"
              htmlFor="onboarding-goal"
              error={errors.studyGoal}
              hint="一句话就够，比如「把函数与导数的题做稳」"
            >
              <Textarea
                id="onboarding-goal"
                value={studyGoal}
                maxLength={200}
                rows={3}
                placeholder="我这学期想把数学的函数部分补上"
                onChange={(event) => setStudyGoal(event.target.value)}
              />
            </Field>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>时间安排</CardTitle>
            <CardDescription>
              请填「平时真正能空出来」的时间，而不是理想中的时间。计划会照这个数字自动精简。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="每天可用学习时间（分钟）"
              htmlFor="onboarding-minutes"
              error={errors.dailyAvailableMinutes}
              hint="不确定就填 90。之后在设置里可以改"
              required
            >
              <Input
                id="onboarding-minutes"
                type="number"
                inputMode="numeric"
                min={15}
                max={600}
                step={5}
                value={dailyMinutes}
                onChange={(event) => setDailyMinutes(event.target.value)}
                aria-invalid={Boolean(errors.dailyAvailableMinutes)}
              />
            </Field>

            <Field
              label="近期考试日期（可选）"
              htmlFor="onboarding-exam"
              error={errors.examDate}
              hint="填了之后，临近考试时计划会自动把复习任务提前；不填也没关系"
            >
              <Input
                id="onboarding-exam"
                type="date"
                value={examDate}
                onChange={(event) => setExamDate(event.target.value)}
              />
            </Field>

            <Alert variant="muted" title="接下来会是什么样">
              <ul className="list-disc space-y-1 pl-5">
                <li>计划会按「{gradeLabel} · 每天 {dailyMinutes || 90} 分钟」来安排，超出时间的任务会被自动砍掉。</li>
                <li>复习时间按间隔重复安排，做对之后间隔会自动拉长，不会反复来烦你。</li>
                <li>掌握程度只有在你真实作答之后才会更新 —— 看完讲解不会算作「已掌握」。</li>
              </ul>
            </Alert>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={goBack} disabled={step === 0 || submitting}>
          <ArrowLeft aria-hidden />
          上一步
        </Button>

        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={goNext}>
            下一步
            <ArrowRight aria-hidden />
          </Button>
        ) : (
          <Button type="submit" loading={submitting}>
            {submitting ? null : <Check aria-hidden />}
            保存并开始
          </Button>
        )}
      </div>

      {submitting ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          正在保存你的学习档案…
        </p>
      ) : null}
    </form>
  );
}
