/**
 * 示例数据（**演示数据**）。
 *
 * ⚠️ 重要声明（对应需求「提供少量可追溯的示例数据，明确标注为演示数据」）：
 *   本文件里的学科与课程标准结构是基于公开教材目录**人工整理的教学示例**，
 *   用于让第一版可运行、可演示、可测试。
 *   它们 **不是** 官方课程标准的完整复刻，也没有逐条核对教材页码。
 *   所有知识点都标记 `source: 'demo-seed'`，并在 `sourceNote` 中写明来源性质，
 *   界面上会显示为「演示数据」。正式使用前应由教研人员用 CSV/JSON 导入真实目录替换。
 *
 * 执行：npm run db:seed（幂等，可重复运行）
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes, scryptSync } from 'node:crypto';

const prisma = new PrismaClient();

const DEMO_NOTICE = '演示数据（人工整理的示例目录，非官方课程标准）';

/** 与 src/lib/auth/password.ts 保持一致的 scrypt 格式 */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

const SUBJECTS = [
  { code: 'chinese', name: '语文', isElective: false, sortOrder: 1 },
  { code: 'math', name: '数学', isElective: false, sortOrder: 2 },
  { code: 'english', name: '英语', isElective: false, sortOrder: 3 },
  { code: 'physics', name: '物理', isElective: true, sortOrder: 4 },
  { code: 'chemistry', name: '化学', isElective: true, sortOrder: 5 },
  { code: 'biology', name: '生物', isElective: true, sortOrder: 6 },
  { code: 'history', name: '历史', isElective: true, sortOrder: 7 },
  { code: 'geography', name: '地理', isElective: true, sortOrder: 8 },
  { code: 'politics', name: '思想政治', isElective: true, sortOrder: 9 },
];

const CURRICULUMS = [
  { subject: 'math', name: '人教A版 必修第一册', grade: '高一', publisher: '人民教育出版社' },
  { subject: 'math', name: '人教A版 选择性必修第二册', grade: '高二', publisher: '人民教育出版社' },
  { subject: 'physics', name: '人教版 必修第一册', grade: '高一', publisher: '人民教育出版社' },
  { subject: 'physics', name: '人教版 选择性必修第二册', grade: '高二', publisher: '人民教育出版社' },
  { subject: 'chemistry', name: '人教版 必修第一册', grade: '高一', publisher: '人民教育出版社' },
];

/**
 * 知识点示例：分层（章节 → 子知识点）并带前置关系。
 * `parent` 指向同一批数据里的 code。
 */
type DemoKp = {
  code: string;
  name: string;
  subject: string;
  grade: string;
  chapterPath: string;
  parent?: string;
  difficulty: number;
  description: string;
  commonMistakes: string[];
  typicalQuestionTypes: string[];
};

const KNOWLEDGE_POINTS: DemoKp[] = [
  // ---------- 数学 ----------
  {
    code: 'MATH-G1-FUNC-01',
    name: '函数的概念与表示',
    subject: 'math',
    grade: '高一',
    chapterPath: '函数与导数/函数的概念',
    difficulty: 2,
    description: '理解函数的定义、定义域与值域，掌握解析法、列表法、图象法三种表示。',
    commonMistakes: ['忽略定义域限制', '把值域与函数值混为一谈', '判断两个函数是否相同时只看解析式'],
    typicalQuestionTypes: ['求定义域', '判断函数相等', '分段函数求值'],
  },
  {
    code: 'MATH-G1-FUNC-02',
    name: '函数的单调性',
    subject: 'math',
    grade: '高一',
    chapterPath: '函数与导数/函数的基本性质',
    parent: 'MATH-G1-FUNC-01',
    difficulty: 3,
    description: '掌握增函数与减函数的定义，能用定义法和导数法判断单调性。',
    commonMistakes: ['作差时符号判断错误', '把"单调递增"与"恒为正"混淆', '区间端点是否包含不严谨'],
    typicalQuestionTypes: ['用定义证明单调性', '求单调区间', '利用单调性比较大小'],
  },
  {
    code: 'MATH-G2-DERIV-01',
    name: '导数的概念与几何意义',
    subject: 'math',
    grade: '高二',
    chapterPath: '函数与导数/导数',
    parent: 'MATH-G1-FUNC-02',
    difficulty: 4,
    description: '理解平均变化率与瞬时变化率，掌握导数在一点处的几何意义（切线斜率）。',
    commonMistakes: ['把平均变化率当作瞬时变化率', '切线方程漏掉切点纵坐标', '在非切点处误用切线斜率'],
    typicalQuestionTypes: ['求切线方程', '由切线条件反求参数', '导数的定义式求极限'],
  },
  {
    code: 'MATH-G2-DERIV-02',
    name: '导数的运算法则',
    subject: 'math',
    grade: '高二',
    chapterPath: '函数与导数/导数',
    parent: 'MATH-G2-DERIV-01',
    difficulty: 3,
    description: '掌握基本初等函数的导数公式与四则运算法则、复合函数求导（链式法则）。',
    commonMistakes: ['商的求导公式记错分子顺序', '复合函数漏乘内层导数', '常数项求导写成 1'],
    typicalQuestionTypes: ['求复杂函数导数', '复合函数求导', '化简后求导'],
  },
  {
    code: 'MATH-G2-DERIV-03',
    name: '利用导数研究函数单调性与极值',
    subject: 'math',
    grade: '高二',
    chapterPath: '函数与导数/导数的应用',
    parent: 'MATH-G2-DERIV-02',
    difficulty: 5,
    description: '由导数的符号判断单调区间，求极值点与极值，处理含参讨论。',
    commonMistakes: ['含参时未讨论参数对根的个数的影响', '把驻点直接当作极值点', '忽略定义域导致区间判断错误'],
    typicalQuestionTypes: ['求极值', '含参单调性讨论', '恒成立求参数范围'],
  },
  {
    code: 'MATH-G1-TRIG-01',
    name: '三角函数图象与性质',
    subject: 'math',
    grade: '高一',
    chapterPath: '三角函数/三角函数的图象与性质',
    difficulty: 3,
    description: '掌握正弦、余弦、正切函数的周期、奇偶、单调与最值，以及相位平移变换。',
    commonMistakes: ['相位平移方向搞反', '周期公式与欧米伽的取值混淆', '忽略题目的区间限制'],
    typicalQuestionTypes: ['求解析式', '求单调区间', '图象变换'],
  },
  {
    code: 'MATH-G2-SEQ-01',
    name: '等差数列与等比数列',
    subject: 'math',
    grade: '高二',
    chapterPath: '数列/数列求和与通项',
    difficulty: 4,
    description: '掌握等差、等比数列的通项公式、求和公式以及性质的应用。',
    commonMistakes: ['等比求和漏考虑公比为 1 的情形', '项数与下标错位', '求和时首项与末项搞错'],
    typicalQuestionTypes: ['求通项', '求前 n 项和', '错位相减求和'],
  },

  // ---------- 物理 ----------
  {
    code: 'PHYS-G1-NEWTON-01',
    name: '牛顿第二定律',
    subject: 'physics',
    grade: '高一',
    chapterPath: '力与运动/牛顿运动定律',
    difficulty: 3,
    description: 'F = ma 的矢量性与瞬时性，理解合外力的含义并能用于受力分析。',
    commonMistakes: ['把某个力直接当作合力', '忘记摩擦力方向判断', '单位不统一（克与千克混用）'],
    typicalQuestionTypes: ['动力学的两类基本问题', '连接体问题', '临界与极值问题'],
  },
  {
    code: 'PHYS-G1-NEWTON-02',
    name: '力的合成与分解',
    subject: 'physics',
    grade: '高一',
    chapterPath: '力与运动/相互作用',
    difficulty: 3,
    description: '平行四边形定则、正交分解法，以及共点力平衡条件。',
    commonMistakes: ['正交分解时坐标轴选得不合理', '漏掉某个方向的力', '三角函数对应边搞错'],
    typicalQuestionTypes: ['三力平衡', '斜面上物体的受力分析', '动态平衡'],
  },
  {
    code: 'PHYS-G2-CIRCUIT-01',
    name: '闭合电路欧姆定律',
    subject: 'physics',
    grade: '高二',
    chapterPath: '恒定电流/电路',
    parent: 'PHYS-G1-NEWTON-01',
    difficulty: 4,
    description: '理解电动势、内阻与路端电压的关系，掌握闭合电路欧姆定律与电路动态分析。',
    commonMistakes: ['把电动势与路端电压混为一谈', '动态分析时变量方向判断反了', '忽略电流表内阻影响'],
    typicalQuestionTypes: ['滑动变阻器动态分析', '电源效率与输出功率', '含容电路'],
  },
  {
    code: 'PHYS-G2-EM-01',
    name: '楞次定律与法拉第电磁感应定律',
    subject: 'physics',
    grade: '高二',
    chapterPath: '电磁感应/电磁感应定律',
    difficulty: 5,
    description: '判断感应电流方向（楞次定律）与感应电动势大小（法拉第定律）。',
    commonMistakes: ['"阻碍"的对象判断错误', '磁通量变化方向与正负搞混', '公式中 n 与面积取错'],
    typicalQuestionTypes: ['判断感应电流方向', '求感应电动势', '导体棒切割磁感线'],
  },

  // ---------- 化学 ----------
  {
    code: 'CHEM-G1-MOLE-01',
    name: '物质的量与摩尔质量',
    subject: 'chemistry',
    grade: '高一',
    chapterPath: '化学计量/物质的量',
    difficulty: 3,
    description: '物质的量、摩尔质量、阿伏加德罗常数之间的关系与换算。',
    commonMistakes: ['单位写错或漏写', '把摩尔质量与相对分子质量混用', '气体摩尔体积使用条件（标准状况）遗漏'],
    typicalQuestionTypes: ['物质的量换算', '阿伏加德罗常数判断题', '气体体积计算'],
  },
  {
    code: 'CHEM-G1-MOLE-02',
    name: '物质的量浓度与溶液配制',
    subject: 'chemistry',
    grade: '高一',
    chapterPath: '化学计量/溶液的配制',
    parent: 'CHEM-G1-MOLE-01',
    difficulty: 4,
    description: '物质的量浓度的计算、稀释规律与一定浓度溶液的配制步骤。',
    commonMistakes: ['定容时仰视/俯视刻度线', '洗涤液未转移导致偏低', '容量瓶规格选择错误'],
    typicalQuestionTypes: ['浓度计算', '误差分析', '配制步骤排序'],
  },
  {
    code: 'CHEM-G2-REDOX-01',
    name: '氧化还原反应',
    subject: 'chemistry',
    grade: '高一',
    chapterPath: '化学反应/氧化还原',
    difficulty: 4,
    description: '化合价升降与电子转移、氧化剂与还原剂的判断、配平。',
    commonMistakes: ['化合价判断错误', '电子守恒关系写错', '把氧化剂与还原产物对应错'],
    typicalQuestionTypes: ['判断氧化剂还原剂', '氧化还原方程式配平', '电子转移数目计算'],
  },

  // ---------- 英语 ----------
  {
    code: 'EN-G2-GRAM-01',
    name: '定语从句',
    subject: 'english',
    grade: '高二',
    chapterPath: '语法/从句',
    difficulty: 4,
    description: '关系代词与关系副词的选用、限制性与非限制性定语从句的区别。',
    commonMistakes: ['关系词与先行词脱节', 'that 与 which 使用场合混淆', '非限制性从句误用 that'],
    typicalQuestionTypes: ['语法填空', '单句改错', '写作中的定语从句运用'],
  },
  {
    code: 'EN-G2-GRAM-02',
    name: '非谓语动词',
    subject: 'english',
    grade: '高二',
    chapterPath: '语法/非谓语',
    difficulty: 5,
    description: '不定式、动名词、现在分词与过去分词作各种成分的区别与选用。',
    commonMistakes: ['分词逻辑主语与句子主语不一致', '固定搭配后的形式记错', '独立主格结构判断错误'],
    typicalQuestionTypes: ['语法填空', '单句改错', '翻译'],
  },
  {
    code: 'EN-G2-VOCAB-01',
    name: '高频词汇与熟词生义',
    subject: 'english',
    grade: '高二',
    chapterPath: '词汇/核心词汇',
    difficulty: 3,
    description: '高考高频词的一词多义、固定搭配与语境中的含义判断。',
    commonMistakes: ['只记第一个意思', '忽略搭配介词', '词性判断错误导致语法填空失分'],
    typicalQuestionTypes: ['完形填空', '阅读理解词义猜测', '语法填空词性转换'],
  },

  // ---------- 语文 ----------
  {
    code: 'CN-G2-READ-01',
    name: '文言实词与虚词',
    subject: 'chinese',
    grade: '高二',
    chapterPath: '文言文阅读/实词与虚词',
    difficulty: 4,
    description: '常见实词的一词多义、词类活用，以及 18 个常见虚词的用法辨析。',
    commonMistakes: ['以今义解古义', '词类活用判断错误', '虚词用法辨析缺少语境依据'],
    typicalQuestionTypes: ['实词解释', '虚词意义用法比较', '句子翻译'],
  },
  {
    code: 'CN-G2-WRITE-01',
    name: '议论文论证结构',
    subject: 'chinese',
    grade: '高二',
    chapterPath: '写作/议论文',
    difficulty: 4,
    description: '论点与分论点的确立、论证方法的选用、材料的分析与扣题。',
    commonMistakes: ['分论点之间逻辑重叠', '只列举材料不分析', '结尾不扣题'],
    typicalQuestionTypes: ['材料作文', '分论点拟写', '素材分析'],
  },
];

/** 前置关系：from 是 to 的前置知识 */
const RELATIONS: { from: string; to: string; strength: number; note: string }[] = [
  { from: 'MATH-G1-FUNC-01', to: 'MATH-G1-FUNC-02', strength: 5, note: '不理解函数定义，就无法讨论单调性' },
  { from: 'MATH-G1-FUNC-02', to: 'MATH-G2-DERIV-01', strength: 4, note: '单调性是理解导数符号意义的基础' },
  { from: 'MATH-G2-DERIV-01', to: 'MATH-G2-DERIV-02', strength: 5, note: '先有导数概念才谈运算法则' },
  { from: 'MATH-G2-DERIV-02', to: 'MATH-G2-DERIV-03', strength: 5, note: '求导不熟则无法研究单调性' },
  { from: 'MATH-G1-FUNC-01', to: 'MATH-G1-TRIG-01', strength: 3, note: '三角函数本质是函数' },
  { from: 'PHYS-G1-NEWTON-02', to: 'PHYS-G1-NEWTON-01', strength: 4, note: '受力分析出错会直接导致 F=ma 用错' },
  { from: 'PHYS-G1-NEWTON-01', to: 'PHYS-G2-CIRCUIT-01', strength: 2, note: '电路动态分析仍需受力式的变量分析思维' },
  { from: 'CHEM-G1-MOLE-01', to: 'CHEM-G1-MOLE-02', strength: 5, note: '不会算物质的量就无法算浓度' },
  { from: 'CHEM-G1-MOLE-01', to: 'CHEM-G2-REDOX-01', strength: 3, note: '电子转移数目计算依赖物质的量' },
  { from: 'EN-G2-GRAM-01', to: 'EN-G2-GRAM-02', strength: 2, note: '从句判断有助于理解非谓语作定语的转换' },
];

/** Demo 用户的错题（用于让掌握度诊断一开始就有真实证据） */
const DEMO_QUESTIONS = [
  {
    kpCode: 'MATH-G2-DERIV-03',
    subject: 'math',
    stem: '已知函数 f(x)=x^3-3ax+1，讨论 a 的取值对 f(x) 单调性的影响，并求极大值点。',
    correctAnswer: 'f′(x)=3x^2-3a；a≤0 时 f′(x)≥0 恒成立，f 在 R 上单调递增；a>0 时 f 在 (-∞,-√a) 与 (√a,+∞) 递增，在 (-√a,√a) 递减，极大值点为 x=-√a。',
    explanation: '关键是先求导并因式分解，再对参数 a 的符号分类讨论。容易漏掉 a≤0 的情形。',
    studentAnswer: 'f′(x)=3x^2-3a>0 解得 x>√a，所以单调递增区间为 (√a,+∞)。',
    errorTypes: ['concept', 'incomplete-reasoning'],
    independence: 'independent',
    isCorrect: false,
  },
  {
    kpCode: 'MATH-G2-DERIV-03',
    subject: 'math',
    stem: '求函数 f(x)=x^3-6x^2+9x 的极值。',
    correctAnswer: 'f′(x)=3x^2-12x+9=3(x-1)(x-3)；x=1 处取极大值 4，x=3 处取极小值 0。',
    explanation: '求导 → 因式分解求驻点 → 判断导数符号变化确定极大/极小。',
    studentAnswer: 'x=1 或 x=3 时 f′=0，所以极值是 f(1)=4。',
    errorTypes: ['incomplete-reasoning'],
    independence: 'with-hint',
    isCorrect: false,
  },
  {
    kpCode: 'MATH-G2-DERIV-03',
    subject: 'math',
    stem: '求 f(x)=x^3-3x 在 [-2,2] 上的最大值与最小值。',
    correctAnswer: 'f′(x)=3x^2-3=0 → x=±1；比较 f(-2)=-2, f(-1)=2, f(1)=-2, f(2)=2，最大值为 2，最小值为 -2。',
    explanation: '闭区间上的最值要比较驻点与端点的函数值，三处都不能漏。',
    studentAnswer: 'x=±1，f(-1)=2, f(1)=-2，所以最大值 2，最小值 -2。',
    errorTypes: ['incomplete-reasoning'],
    independence: 'independent',
    isCorrect: true,
  },
  {
    kpCode: 'PHYS-G2-CIRCUIT-01',
    subject: 'physics',
    stem: '电源电动势 6V、内阻 1Ω，外接滑动变阻器。当外电阻由 2Ω 增大到 5Ω 时，路端电压如何变化？电流如何变化？',
    correctAnswer: 'I=ε/(R+r) 随 R 增大而减小；U=IR=εR/(R+r) 随 R 增大而增大。',
    explanation: '先由闭合电路欧姆定律看电流，再由 U=ε-Ir 看路端电压，两者方向相反。',
    studentAnswer: '外电阻增大，电流增大，路端电压也增大。',
    errorTypes: ['concept', 'formula'],
    independence: 'independent',
    isCorrect: false,
  },
  {
    kpCode: 'PHYS-G2-CIRCUIT-01',
    subject: 'physics',
    stem: '上题中若把滑动变阻器换成定值电阻 R=2Ω，求电源输出功率与效率。',
    correctAnswer: 'I=6/3=2A，输出功率 P=I²R=8W，总功率 P总=εI=12W，效率 η=P/P总≈66.7%。',
    explanation: '输出功率是外电路消耗的功率；效率是输出功率与总功率之比，别把两者混在一起。',
    studentAnswer: 'P=UI=6×2/3=4W。',
    errorTypes: ['concept', 'calculation'],
    independence: 'with-solution',
    isCorrect: false,
  },
  {
    kpCode: 'CHEM-G1-MOLE-02',
    subject: 'chemistry',
    stem: '配制 100 mL 0.1 mol/L NaCl 溶液，需要 NaCl 多少克？（NaCl 摩尔质量 58.5 g/mol）',
    correctAnswer: 'n=0.1×0.1=0.01 mol，m=0.01×58.5=0.585 g。',
    explanation: 'n=cV 是核心公式，注意体积要换算成升。',
    studentAnswer: 'n=0.1×100=10 mol，m=585 g。',
    errorTypes: ['calculation', 'formula'],
    independence: 'independent',
    isCorrect: false,
  },
  {
    kpCode: 'CHEM-G1-MOLE-02',
    subject: 'chemistry',
    stem: '用 NaCl 固体配制 500 mL 0.2 mol/L 溶液，下列操作会使浓度偏高的是？A 定容时俯视刻度线 B 洗涤液未转移 C 转移时溶液溅出 D 容量瓶未干燥',
    correctAnswer: 'A。俯视刻度线导致加入的水偏少，体积偏小，浓度偏高。',
    explanation: '误差分析统一从 c=n/V 出发，判断操作影响的是 n 还是 V及其方向。',
    studentAnswer: 'B，因为少了一部分溶质，浓度偏高。',
    errorTypes: ['reading', 'method'],
    independence: 'with-hint',
    isCorrect: false,
  },
  {
    kpCode: 'CHEM-G1-MOLE-02',
    subject: 'chemistry',
    stem: '把 50 mL 2 mol/L 盐酸稀释到 200 mL，求稀释后浓度。',
    correctAnswer: 'c1V1=c2V2 → 2×50=c2×200 → c2=0.5 mol/L。',
    explanation: '稀释过程中溶质的物质的量不变。',
    studentAnswer: '0.5 mol/L',
    errorTypes: [],
    independence: 'independent',
    isCorrect: true,
  },
];

async function main(): Promise<void> {
  console.log('开始写入演示数据…');

  // ---- 1. 学科 ----
  const subjectIdByCode = new Map<string, string>();
  for (const subject of SUBJECTS) {
    const saved = await prisma.subject.upsert({
      where: { code: subject.code },
      update: { name: subject.name, isElective: subject.isElective, sortOrder: subject.sortOrder },
      create: subject,
    });
    subjectIdByCode.set(subject.code, saved.id);
  }
  console.log(`  学科 ${SUBJECTS.length} 个`);

  // ---- 2. 教材版本 ----
  const curriculumIdByKey = new Map<string, string>();
  for (const curriculum of CURRICULUMS) {
    const subjectId = subjectIdByCode.get(curriculum.subject);
    if (!subjectId) continue;

    const existing = await prisma.curriculum.findFirst({
      where: { subjectId, name: curriculum.name, grade: curriculum.grade },
    });

    const saved = existing
      ? await prisma.curriculum.update({
          where: { id: existing.id },
          data: { publisher: curriculum.publisher, sourceNote: DEMO_NOTICE },
        })
      : await prisma.curriculum.create({
          data: {
            subjectId,
            name: curriculum.name,
            grade: curriculum.grade,
            publisher: curriculum.publisher,
            // 演示数据未经教研审核，isApproved 保持 false
            isApproved: false,
            sourceNote: DEMO_NOTICE,
          },
        });

    curriculumIdByKey.set(`${curriculum.subject}:${curriculum.name}`, saved.id);
  }
  console.log(`  教材版本 ${curriculumIdByKey.size} 个`);

  // ---- 3. 知识点 ----
  const kpIdByCode = new Map<string, string>();
  for (const kp of KNOWLEDGE_POINTS) {
    const subjectId = subjectIdByCode.get(kp.subject);
    if (!subjectId) continue;

    const curriculumId =
      CURRICULUMS.find((c) => c.subject === kp.subject && c.grade === kp.grade)?.name
        ? curriculumIdByKey.get(
            `${kp.subject}:${CURRICULUMS.find((c) => c.subject === kp.subject && c.grade === kp.grade)!.name}`,
          ) ?? null
        : null;

    const chapter = kp.chapterPath.split('/')[0] ?? kp.chapterPath;

    const saved = await prisma.knowledgePoint.upsert({
      where: { code: kp.code },
      update: {
        name: kp.name,
        subjectId,
        grade: kp.grade,
        curriculumId,
        chapter,
        chapterPath: kp.chapterPath,
        description: kp.description,
        difficulty: kp.difficulty,
        commonMistakes: JSON.stringify(kp.commonMistakes),
        typicalQuestionTypes: JSON.stringify(kp.typicalQuestionTypes),
        // 人工整理的演示目录视为「已审核」，但来源标注为 demo-seed，
        // 界面会显示「演示数据」，不会被当成官方课程目录
        reviewStatus: 'reviewed',
        source: 'demo-seed',
        sourceNote: DEMO_NOTICE,
      },
      create: {
        code: kp.code,
        name: kp.name,
        subjectId,
        grade: kp.grade,
        curriculumId,
        chapter,
        chapterPath: kp.chapterPath,
        description: kp.description,
        difficulty: kp.difficulty,
        commonMistakes: JSON.stringify(kp.commonMistakes),
        typicalQuestionTypes: JSON.stringify(kp.typicalQuestionTypes),
        reviewStatus: 'reviewed',
        source: 'demo-seed',
        sourceNote: DEMO_NOTICE,
      },
    });

    kpIdByCode.set(kp.code, saved.id);
  }

  // 解析父子关系与深度
  for (const kp of KNOWLEDGE_POINTS) {
    const id = kpIdByCode.get(kp.code);
    if (!id) continue;
    const parentId = kp.parent ? (kpIdByCode.get(kp.parent) ?? null) : null;
    const depth = Math.max(0, kp.chapterPath.split('/').filter(Boolean).length - 1);
    await prisma.knowledgePoint.update({ where: { id }, data: { parentId, depth } });
  }
  console.log(`  知识点 ${kpIdByCode.size} 个`);

  // ---- 4. 前置关系 ----
  let relationCount = 0;
  for (const relation of RELATIONS) {
    const fromId = kpIdByCode.get(relation.from);
    const toId = kpIdByCode.get(relation.to);
    if (!fromId || !toId) continue;

    await prisma.knowledgePointRelation.upsert({
      where: { fromId_toId_relationType: { fromId, toId, relationType: 'prerequisite' } },
      update: { strength: relation.strength, note: relation.note, source: 'demo-seed' },
      create: {
        fromId,
        toId,
        relationType: 'prerequisite',
        strength: relation.strength,
        note: relation.note,
        source: 'demo-seed',
      },
    });
    relationCount += 1;
  }
  console.log(`  前置关系 ${relationCount} 条`);

  // ---- 5. 内部资源（系统已核验：指向站内知识点页，不是伪造的外链） ----
  let resourceCount = 0;
  for (const kp of KNOWLEDGE_POINTS) {
    const kpId = kpIdByCode.get(kp.code);
    if (!kpId) continue;

    const url = `/knowledge/${kpId}`;
    const existing = await prisma.learningResource.findFirst({ where: { url } });

    const saved = existing
      ? await prisma.learningResource.update({
          where: { id: existing.id },
          data: {
            title: `${kp.name} · 知识讲解`,
            description: kp.description,
            content: `## ${kp.name}\n\n${kp.description}\n\n### 常见错误\n${kp.commonMistakes
              .map((m) => `- ${m}`)
              .join('\n')}\n\n### 典型题型\n${kp.typicalQuestionTypes.map((t) => `- ${t}`).join('\n')}`,
            verificationStatus: 'verified',
            lastVerifiedAt: new Date(),
            verifiedBy: 'demo-seed',
          },
        })
      : await prisma.learningResource.create({
          data: {
            title: `${kp.name} · 知识讲解`,
            resourceType: 'explanation',
            provider: 'internal',
            platform: '系统内部',
            url,
            // 站内页面，内容由本系统的示例目录生成 —— 可以标为已验证
            verificationStatus: 'verified',
            lastVerifiedAt: new Date(),
            verifiedBy: 'demo-seed',
            subjectId: subjectIdByCode.get(kp.subject) ?? null,
            grade: kp.grade,
            difficulty: kp.difficulty,
            description: kp.description,
            content: `## ${kp.name}\n\n${kp.description}\n\n### 常见错误\n${kp.commonMistakes
              .map((m) => `- ${m}`)
              .join('\n')}\n\n### 典型题型\n${kp.typicalQuestionTypes.map((t) => `- ${t}`).join('\n')}`,
            createdBy: 'system',
          },
        });

    await prisma.resourceKnowledgePoint.upsert({
      where: { resourceId_knowledgePointId: { resourceId: saved.id, knowledgePointId: kpId } },
      update: {},
      create: { resourceId: saved.id, knowledgePointId: kpId, relevance: 1, matchSource: 'manual' },
    });
    resourceCount += 1;
  }
  console.log(`  内部资源 ${resourceCount} 个（站内链接，已核验）`);

  // ---- 6. 演示用户与错题（让诊断一开始就有真实证据） ----
  const demoEmail = 'demo@study.local';
  let demoUser = await prisma.user.findFirst({ where: { email: demoEmail } });

  if (!demoUser) {
    demoUser = await prisma.user.create({
      data: {
        email: demoEmail,
        displayName: '演示学生',
        passwordHash: hashPassword('study-coach-2026'),
        role: 'student',
        profile: {
          create: {
            grade: '高二',
            textbookVersion: '人教A版',
            electiveSubjects: JSON.stringify(['physics', 'chemistry']),
            studyGoal: '期末把数学和物理的薄弱章节补上',
            dailyAvailableMinutes: 90,
            weekendAvailableMinutes: 120,
            onboardingCompleted: true,
          },
        },
      },
    });
    console.log(`  演示账号：${demoEmail} / study-coach-2026`);
  } else {
    console.log(`  演示账号已存在：${demoEmail}`);
  }

  // ---- 7. 演示错题 + 作答历史（有真实证据，诊断才有意义） ----
  let attemptCount = 0;
  for (const demo of DEMO_QUESTIONS) {
    const subjectId = subjectIdByCode.get(demo.subject);
    const kpId = kpIdByCode.get(demo.kpCode);
    if (!subjectId || !kpId) continue;

    const existing = await prisma.question.findFirst({
      where: { userId: demoUser.id, stem: demo.stem },
    });

    if (existing) continue;

    const kp = KNOWLEDGE_POINTS.find((item) => item.code === demo.kpCode)!;

    const question = await prisma.question.create({
      data: {
        userId: demoUser.id,
        subjectId,
        grade: kp.grade,
        chapter: kp.chapterPath.split('/')[0] ?? null,
        stem: demo.stem,
        stemFormat: 'markdown',
        choices: JSON.stringify([]),
        correctAnswer: demo.correctAnswer,
        explanation: demo.explanation,
        source: 'manual',
        sourceNote: '演示数据（人工编写，用于展示诊断流程）',
      },
    });

    await prisma.questionKnowledgePoint.create({
      data: { questionId: question.id, knowledgePointId: kpId, isPrimary: true, source: 'manual', confidence: 1 },
    });

    const record = await prisma.wrongAnswerRecord.create({
      data: {
        userId: demoUser.id,
        questionId: question.id,
        studentAnswer: demo.studentAnswer,
        correctAnswerSnapshot: demo.correctAnswer,
        errorTypes: JSON.stringify(demo.errorTypes),
        likelyCauses: JSON.stringify(
          demo.errorTypes.includes('concept')
            ? ['对概念本身的理解有偏差，导致后续判断整体偏移。']
            : ['推理过程不完整，只走了前半段就下结论。'],
        ),
        explanation: demo.explanation,
        // 演示数据里的错误原因是人工编写的事实，因此置信度给 1；
        // 真实 AI 分析出来的结果不会这么高。
        errorConfidence: 1,
        editedByUser: true,
        source: 'manual',
        sourceNote: '演示数据',
        status: demo.isCorrect ? 'resolved' : 'needs-review',
        attemptCount: 1,
        correctCount: demo.isCorrect ? 1 : 0,
        lastReviewResult: demo.isCorrect ? 'correct' : 'wrong',
      },
    });

    // 每题再补两条历史作答，让「近期正确率」与「重复错误」有足够证据
    const sequence = demo.isCorrect
      ? [false, false, true]
      : [false, false, true, false];

    for (const [index, isCorrect] of sequence.entries()) {
      await prisma.answerAttempt.create({
        data: {
          userId: demoUser.id,
          questionId: question.id,
          wrongAnswerRecordId: record.id,
          answer: isCorrect ? demo.correctAnswer : demo.studentAnswer,
          isCorrect,
          independence: demo.independence,
          difficultySnapshot: kp.difficulty,
          timeSpentSeconds: 120 + index * 30,
          errorTypes: JSON.stringify(isCorrect ? [] : demo.errorTypes),
          context: index === 0 ? 'initial' : index === sequence.length - 1 ? 'review' : 'practice',
          // 让证据分布在一段时间里，体现「近期表现 vs 历史表现」
          createdAt: new Date(Date.now() - (sequence.length - index) * 3 * 86_400_000),
        },
      });
      attemptCount += 1;
    }

    await prisma.reviewSchedule.create({
      data: {
        userId: demoUser.id,
        wrongAnswerRecordId: record.id,
        status: 'scheduled',
        dueAt: new Date(Date.now() - 86_400_000),
        intervalDays: 1,
        repetition: 1,
        easeFactor: 2.5,
        lastResult: demo.isCorrect ? 'correct' : 'wrong',
        lastReviewedAt: new Date(Date.now() - 3 * 86_400_000),
        origin: 'rule-engine',
      },
    });
  }
  console.log(`  演示题目 ${DEMO_QUESTIONS.length} 道，作答记录 ${attemptCount} 条`);

  // ---- 8. 素材库补充：例题 / 视频类型示例（都指向站内页，不伪造外链） ----
  const exampleKp = kpIdByCode.get('MATH-G2-DERIV-03');
  if (exampleKp) {
    const url = `/knowledge/${exampleKp}`;
    const existing = await prisma.learningResource.findFirst({
      where: { url, resourceType: 'practice' },
    });
    if (!existing) {
      const created = await prisma.learningResource.create({
        data: {
          title: '导数与极值 · 针对性练习（示例）',
          resourceType: 'practice',
          provider: 'internal',
          platform: '系统内部',
          url,
          verificationStatus: 'verified',
          lastVerifiedAt: new Date(),
          verifiedBy: 'demo-seed',
          subjectId: subjectIdByCode.get('math') ?? null,
          grade: '高二',
          difficulty: 4,
          description: '含参讨论与闭区间最值的练习组合。',
          createdBy: 'system',
        },
      });
      await prisma.resourceKnowledgePoint.create({
        data: { resourceId: created.id, knowledgePointId: exampleKp, relevance: 1, matchSource: 'manual' },
      });
    }
  }

  // ---- 9. 用诊断算法算出掌握度 ----
  // 为什么要在这里跑一遍：掌握度**只能**由 src/lib/diagnosis/engine.ts 的确定性算法得出，
  // 它不在数据库里自动触发。直接往库里塞作答记录而不同步掌握度，
  // 会让演示数据看起来"有练习但没有诊断"，那是假的。
  // 生产环境里这一步由 /api/questions/[id]/attempts 在作答后自动完成。
  const masteryCount = await recomputeMastery(demoUser.id);
  console.log(`  掌握度估计 ${masteryCount} 条（由 diagnosis/engine.ts 计算）`);

  console.log('演示数据写入完成。');
  console.log('注意：以上目录为人工整理的演示数据，正式使用前请由教研人员用 CSV/JSON 导入真实课程目录。');
}

/**
 * 重算某用户所有（有作答记录的）知识点的掌握度。
 *
 * 直接复用业务代码里的纯算法，而不是在 seed 里重新实现一遍 ——
 * 这样演示数据反映的就是线上真实会得到的结论。
 */
async function recomputeMastery(userId: string): Promise<number> {
  const { estimateMastery } = await import('../src/lib/diagnosis/engine');

  const links = await prisma.questionKnowledgePoint.findMany({
    where: { question: { userId } },
    select: { knowledgePointId: true },
    distinct: ['knowledgePointId'],
  });

  let count = 0;

  for (const link of links) {
    const attempts = await prisma.answerAttempt.findMany({
      where: {
        userId,
        question: { knowledgePointLinks: { some: { knowledgePointId: link.knowledgePointId } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (attempts.length === 0) continue;

    const evidence = attempts.map((attempt) => ({
      id: attempt.id,
      isCorrect: attempt.isCorrect,
      independence: attempt.independence as 'independent' | 'with-hint' | 'with-solution',
      difficulty: attempt.difficultySnapshot,
      context: attempt.context as 'initial' | 'practice' | 'review' | 'retest',
      createdAt: attempt.createdAt,
      errorTypes: JSON.parse(attempt.errorTypes) as never,
    }));

    const result = estimateMastery(evidence);

    const repeatedErrorTypes: Record<string, number> = {};
    for (const item of result.repeatedErrorTypes) {
      repeatedErrorTypes[item.type] = item.count;
    }

    const payload = {
      level: result.level,
      score: result.score,
      confidence: result.confidence,
      evidenceCount: result.evidenceCount,
      recentAccuracy: result.recentAccuracy,
      recentSampleSize: result.recentSampleSize,
      repeatedErrorTypes: JSON.stringify(repeatedErrorTypes),
      needsPrerequisiteReview: result.needsPrerequisiteReview,
      nextAction: result.nextAction,
      lastEvaluatedAt: new Date(),
    };

    await prisma.userKnowledgeMastery.upsert({
      where: {
        userId_knowledgePointId: { userId, knowledgePointId: link.knowledgePointId },
      },
      update: payload,
      create: { userId, knowledgePointId: link.knowledgePointId, ...payload },
    });

    count += 1;
  }

  return count;
}
main()
  .catch((error) => {
    console.error('种子数据写入失败：', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
