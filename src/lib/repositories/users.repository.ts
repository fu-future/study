import type { Prisma, StudentProfile, User } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readStringArray, writeStringArray } from '@/lib/db/json';
import { z } from 'zod';

/**
 * 用户与学习档案的数据访问层。
 * 上层（API / 服务）只调用这里的函数，不直接使用 prisma。
 */

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), isArchived: false },
  });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export async function countUsers(): Promise<number> {
  return prisma.user.count({ where: { isArchived: false } });
}

export async function createUser(input: {
  email: string;
  displayName: string;
  passwordHash: string;
  role?: string;
}): Promise<User> {
  return prisma.user.create({
    data: {
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      passwordHash: input.passwordHash,
      role: input.role ?? 'student',
      // 注册即建一份空档案，避免「有用户没有档案」的中间态
      profile: { create: {} },
    },
  });
}

/** 登录时间戳。失败不影响登录流程。 */
export async function touchLastSeen(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
}

/**
 * 软删除用户（注销账号）。
 * 不用物理删除：学习记录（题目、作答、掌握度）都挂在 userId 上，
 * 一旦级联删除就再也无法回溯；置 isArchived 后所有查询层都会过滤掉该用户，
 * 效果上等同于「账号不可再用」，但数据仍可被管理员审计或恢复。
 */
export async function archiveUser(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { isArchived: true } });
}

// -----------------------------------------------------------------------------
// 学习档案
// -----------------------------------------------------------------------------

export type StudentProfileView = Omit<StudentProfile, 'electiveSubjects' | 'preferences'> & {
  electiveSubjects: string[];
  preferences: Record<string, unknown>;
};

export function toProfileView(profile: StudentProfile): StudentProfileView {
  const { electiveSubjects, preferences, ...rest } = profile;
  return {
    ...rest,
    electiveSubjects: readStringArray(electiveSubjects),
    preferences: (() => {
      try {
        const parsed = JSON.parse(preferences) as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    })(),
  };
}

/**
 * 读取学习档案。若用户还没有档案（历史数据/异常情况），自动补一份空的，
 * 而不是抛错 —— 产品上「第一次进来没有档案」必须是可用的状态。
 */
export async function getStudentProfile(userId: string): Promise<StudentProfile> {
  const existing = await prisma.studentProfile.findUnique({ where: { userId } });
  if (existing) return existing;

  return prisma.studentProfile.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

const preferencesSchema = z.record(z.string(), z.unknown());

export async function updateStudentProfile(
  userId: string,
  patch: {
    grade?: string;
    curriculumId?: string | null;
    textbookVersion?: string | null;
    electiveSubjects?: string[];
    studyGoal?: string | null;
    examDate?: Date | null;
    dailyAvailableMinutes?: number;
    weekdayAvailableMinutes?: number | null;
    weekendAvailableMinutes?: number | null;
    reminderEnabled?: boolean;
    reminderTime?: string | null;
    preferences?: Record<string, unknown>;
    onboardingCompleted?: boolean;
  },
): Promise<StudentProfile> {
  const data: Prisma.StudentProfileUncheckedUpdateInput = {};

  if (patch.grade !== undefined) data.grade = patch.grade;
  if (patch.curriculumId !== undefined) data.curriculumId = patch.curriculumId;
  if (patch.textbookVersion !== undefined) data.textbookVersion = patch.textbookVersion;
  if (patch.electiveSubjects !== undefined) data.electiveSubjects = writeStringArray(patch.electiveSubjects);
  if (patch.studyGoal !== undefined) data.studyGoal = patch.studyGoal;
  if (patch.examDate !== undefined) data.examDate = patch.examDate;
  if (patch.dailyAvailableMinutes !== undefined) data.dailyAvailableMinutes = patch.dailyAvailableMinutes;
  if (patch.weekdayAvailableMinutes !== undefined) data.weekdayAvailableMinutes = patch.weekdayAvailableMinutes;
  if (patch.weekendAvailableMinutes !== undefined) data.weekendAvailableMinutes = patch.weekendAvailableMinutes;
  if (patch.reminderEnabled !== undefined) data.reminderEnabled = patch.reminderEnabled;
  if (patch.reminderTime !== undefined) data.reminderTime = patch.reminderTime;
  if (patch.preferences !== undefined) {
    data.preferences = JSON.stringify(preferencesSchema.parse(patch.preferences));
  }
  if (patch.onboardingCompleted !== undefined) data.onboardingCompleted = patch.onboardingCompleted;

  return prisma.studentProfile.upsert({
    where: { userId },
    update: data,
    // userId 放在展开之后，确保不会被 data 里可能存在的同名字段覆盖
    create: { ...(data as Prisma.StudentProfileUncheckedCreateInput), userId },
  });
}
