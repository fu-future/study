'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Save } from 'lucide-react';
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
import { ApiError, apiPatch, toUserMessage, type ProfileDto } from '@/lib/client-api';
import { cn } from '@/lib/utils';

/**
 * 学习偏好表单。
 *
 * 这里改的都是「影响计划怎么排」的参数：可用时间改了，下次生成的计划就会跟着变。
 * 已经记录的学习数据不会因为改这些而丢失。
 */
export function ProfileForm({
  profile,
  subjects,
}: {
  profile: ProfileDto;
  subjects: { id: string; code: string; name: string; isElective: boolean }[];
}) {
  const router = useRouter();

  const [grade, setGrade] = React.useState(profile.grade ?? '');
  const [textbookVersion, setTextbookVersion] = React.useState(profile.textbookVersion ?? '');
  const [electives, setElectives] = React.useState<string[]>(profile.electiveSubjects ?? []);
  const [studyGoal, setStudyGoal] = React.useState(profile.studyGoal ?? '');
  const [examDate, setExamDate] = React.useState(
    profile.examDate ? new Date(profile.examDate).toISOString().slice(0, 10) : '',
  );
  const [dailyMinutes, setDailyMinutes] = React.useState(String(profile.dailyAvailableMinutes || 90));
  const [weekdayMinutes, setWeekdayMinutes] = React.useState(
    profile.weekdayAvailableMinutes !== null ? String(profile.weekdayAvailableMinutes) : '',
  );
  const [weekendMinutes, setWeekendMinutes] = React.useState(
    profile.weekendAvailableMinutes !== null ? String(profile.weekendAvailableMinutes) : '',
  );
  const [reminderEnabled, setReminderEnabled] = React.useState(profile.reminderEnabled);
  const [reminderTime, setReminderTime] = React.useState(profile.reminderTime ?? '');

  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  function toggleElective(code: string) {
    setSaved(false);
    setElectives((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code],
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    const next: Record<string, string> = {};
    if (!grade) next.grade = '请选择年级';
    if (electives.length === 0) next.electiveSubjects = '至少保留 1 个学科';

    const daily = Number(dailyMinutes);
    if (!dailyMinutes || Number.isNaN(daily)) next.dailyAvailableMinutes = '请填写每天可用时间';
    else if (daily < 15 || daily > 600) next.dailyAvailableMinutes = '请填 15 到 600 分钟之间';

    for (const [key, value] of [
      ['weekdayAvailableMinutes', weekdayMinutes],
      ['weekendAvailableMinutes', weekendMinutes],
    ] as const) {
      if (value === '') continue;
      const parsed = Number(value);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 600) {
        next[key] = '请填 0 到 600 分钟之间，留空表示与每天可用时间相同';
      }
    }

    if (reminderEnabled && reminderTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
      next.reminderTime = '时间格式应为 HH:mm';
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await apiPatch('/api/profile', {
        grade,
        textbookVersion: textbookVersion.trim() || null,
        electiveSubjects: electives,
        studyGoal: studyGoal.trim() || null,
        examDate: examDate || null,
        dailyAvailableMinutes: daily,
        weekdayAvailableMinutes: weekdayMinutes === '' ? null : Number(weekdayMinutes),
        weekendAvailableMinutes: weekendMinutes === '' ? null : Number(weekendMinutes),
        reminderEnabled,
        reminderTime: reminderTime || null,
      });
      setSaved(true);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      }
      setFormError(toUserMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>学习偏好</CardTitle>
        <CardDescription>
          这些设置会影响学习计划怎么排，以及讲解的深度。改完保存就会生效。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {formError ? (
            <Alert variant="destructive" title="保存没有成功">
              <p>{formError}</p>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="年级" htmlFor="settings-grade" error={errors.grade} required>
              <Select
                id="settings-grade"
                value={grade}
                onChange={(event) => {
                  setSaved(false);
                  setGrade(event.target.value);
                }}
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
              htmlFor="settings-textbook"
              error={errors.textbookVersion}
              hint="影响讲解里引用的章节顺序"
            >
              <Input
                id="settings-textbook"
                value={textbookVersion}
                maxLength={60}
                onChange={(event) => {
                  setSaved(false);
                  setTextbookVersion(event.target.value);
                }}
              />
            </Field>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">选科</legend>
            <div className="mt-2 flex flex-wrap gap-2">
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
                      disabled={submitting}
                      onChange={() => toggleElective(subject.code)}
                    />
                    {subject.name}
                    {subject.isElective ? <Badge variant="outline">选考</Badge> : null}
                  </label>
                );
              })}
            </div>
            {errors.electiveSubjects ? (
              <p className="mt-2 text-xs font-medium text-destructive" role="alert">
                {errors.electiveSubjects}
              </p>
            ) : null}
          </fieldset>

          <Field label="学习目标" htmlFor="settings-goal" error={errors.studyGoal}>
            <Textarea
              id="settings-goal"
              rows={3}
              maxLength={200}
              value={studyGoal}
              onChange={(event) => {
                setSaved(false);
                setStudyGoal(event.target.value);
              }}
            />
          </Field>

          <Field
            label="近期考试日期（可选）"
            htmlFor="settings-exam"
            error={errors.examDate}
            hint="填了之后，临近考试时复习任务会自动提前"
          >
            <Input
              id="settings-exam"
              type="date"
              value={examDate}
              onChange={(event) => {
                setSaved(false);
                setExamDate(event.target.value);
              }}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="每天可用（分钟）"
              htmlFor="settings-daily"
              error={errors.dailyAvailableMinutes}
              required
            >
              <Input
                id="settings-daily"
                type="number"
                min={15}
                max={600}
                step={5}
                value={dailyMinutes}
                onChange={(event) => {
                  setSaved(false);
                  setDailyMinutes(event.target.value);
                }}
                aria-invalid={Boolean(errors.dailyAvailableMinutes)}
              />
            </Field>

            <Field
              label="工作日可用（分钟）"
              htmlFor="settings-weekday"
              error={errors.weekdayAvailableMinutes}
              hint="留空＝同每天可用"
            >
              <Input
                id="settings-weekday"
                type="number"
                min={0}
                max={600}
                step={5}
                value={weekdayMinutes}
                onChange={(event) => {
                  setSaved(false);
                  setWeekdayMinutes(event.target.value);
                }}
              />
            </Field>

            <Field
              label="周末可用（分钟）"
              htmlFor="settings-weekend"
              error={errors.weekendAvailableMinutes}
              hint="留空＝同每天可用"
            >
              <Input
                id="settings-weekend"
                type="number"
                min={0}
                max={600}
                step={5}
                value={weekendMinutes}
                onChange={(event) => {
                  setSaved(false);
                  setWeekendMinutes(event.target.value);
                }}
              />
            </Field>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 accent-[hsl(var(--primary))]"
                checked={reminderEnabled}
                disabled={submitting}
                onChange={(event) => {
                  setSaved(false);
                  setReminderEnabled(event.target.checked);
                }}
              />
              开启复习提醒时间
            </label>
            <Field
              label="提醒时间"
              htmlFor="settings-reminder"
              error={errors.reminderTime}
              hint="只作为你自己的参考时间，系统不会给你发通知"
            >
              <Input
                id="settings-reminder"
                type="time"
                value={reminderTime}
                disabled={!reminderEnabled || submitting}
                onChange={(event) => {
                  setSaved(false);
                  setReminderTime(event.target.value);
                }}
              />
            </Field>
          </div>

          {saved ? (
            <Alert variant="success">
              <p className="flex items-center gap-2">
                <Check aria-hidden className="size-4" />
                已保存。下次生成计划时会用新的时间安排。
              </p>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={submitting}>
              <Save aria-hidden />
              保存设置
            </Button>
            <p className="text-xs text-muted-foreground">
              已记录的学习数据不会因为修改设置而丢失。
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
