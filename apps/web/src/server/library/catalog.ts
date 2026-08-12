import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { libraryCategories, libraryItems } from '@/server/db/schema';
import type { LibraryItemType } from './types';
import { createItem } from './items';
import { createVersion, publishVersion } from './versions';

/**
 * The BIINA-managed curated catalog + discovery categories. All curated items are
 * CONTENT_ONLY or READ_ONLY so they are safely publishable in Phase 16. The seeder is
 * idempotent (keyed by slug) and used by scripts/seed.ts and the DB smoke.
 */

export interface CategorySeed {
  slug: string;
  labelEn: string;
  labelAr: string;
  personaScopes: string[];
  sortOrder: number;
}

export const CATEGORY_SEEDS: CategorySeed[] = [
  // Youth
  { slug: 'learn', labelEn: 'Learn', labelAr: 'تعلّم', personaScopes: ['kids', 'teens'], sortOrder: 10 },
  { slug: 'read', labelEn: 'Read', labelAr: 'اقرأ', personaScopes: ['kids'], sortOrder: 11 },
  { slug: 'create', labelEn: 'Create', labelAr: 'ابتكر', personaScopes: ['kids', 'teens'], sortOrder: 12 },
  { slug: 'explore', labelEn: 'Explore', labelAr: 'استكشف', personaScopes: ['kids'], sortOrder: 13 },
  { slug: 'stories', labelEn: 'Stories', labelAr: 'قصص', personaScopes: ['kids'], sortOrder: 14 },
  { slug: 'math', labelEn: 'Math', labelAr: 'رياضيات', personaScopes: ['kids', 'teens'], sortOrder: 15 },
  { slug: 'science', labelEn: 'Science', labelAr: 'علوم', personaScopes: ['kids', 'teens'], sortOrder: 16 },
  { slug: 'languages', labelEn: 'Languages', labelAr: 'لغات', personaScopes: ['kids', 'teens', 'campus'], sortOrder: 17 },
  // Study / campus
  { slug: 'study', labelEn: 'Study', labelAr: 'دراسة', personaScopes: ['campus', 'teens'], sortOrder: 20 },
  { slug: 'exam-prep', labelEn: 'Exam Prep', labelAr: 'تحضير الامتحانات', personaScopes: ['campus'], sortOrder: 21 },
  { slug: 'notes', labelEn: 'Notes', labelAr: 'ملاحظات', personaScopes: ['campus'], sortOrder: 22 },
  { slug: 'presentations', labelEn: 'Presentations', labelAr: 'عروض تقديمية', personaScopes: ['campus', 'professional'], sortOrder: 23 },
  // General knowledge work
  { slug: 'writing', labelEn: 'Writing', labelAr: 'كتابة', personaScopes: ['professional', 'campus', 'teens'], sortOrder: 30 },
  { slug: 'research', labelEn: 'Research', labelAr: 'بحث', personaScopes: ['professional', 'business', 'government', 'campus'], sortOrder: 31 },
  { slug: 'planning', labelEn: 'Planning', labelAr: 'تخطيط', personaScopes: ['professional', 'business'], sortOrder: 32 },
  { slug: 'productivity', labelEn: 'Productivity', labelAr: 'إنتاجية', personaScopes: ['professional'], sortOrder: 33 },
  { slug: 'career', labelEn: 'Career', labelAr: 'مهنة', personaScopes: ['professional', 'campus', 'teens'], sortOrder: 34 },
  { slug: 'automation', labelEn: 'Automation', labelAr: 'أتمتة', personaScopes: ['professional', 'business'], sortOrder: 35 },
  // Business
  { slug: 'sales', labelEn: 'Sales', labelAr: 'مبيعات', personaScopes: ['business'], sortOrder: 40 },
  { slug: 'marketing', labelEn: 'Marketing', labelAr: 'تسويق', personaScopes: ['business'], sortOrder: 41 },
  { slug: 'operations', labelEn: 'Operations', labelAr: 'العمليات', personaScopes: ['business'], sortOrder: 42 },
  { slug: 'hr', labelEn: 'HR', labelAr: 'الموارد البشرية', personaScopes: ['business'], sortOrder: 43 },
  { slug: 'finance-analysis', labelEn: 'Finance Analysis', labelAr: 'تحليل مالي', personaScopes: ['business'], sortOrder: 44 },
  { slug: 'management', labelEn: 'Management', labelAr: 'إدارة', personaScopes: ['business'], sortOrder: 45 },
  { slug: 'customer-service', labelEn: 'Customer Service', labelAr: 'خدمة العملاء', personaScopes: ['business'], sortOrder: 46 },
  { slug: 'reporting', labelEn: 'Reporting', labelAr: 'تقارير', personaScopes: ['business', 'government'], sortOrder: 47 },
  // Government
  { slug: 'policy', labelEn: 'Policy', labelAr: 'سياسات', personaScopes: ['government'], sortOrder: 50 },
  { slug: 'reports', labelEn: 'Reports', labelAr: 'تقارير', personaScopes: ['government'], sortOrder: 51 },
  { slug: 'document-analysis', labelEn: 'Document Analysis', labelAr: 'تحليل المستندات', personaScopes: ['government'], sortOrder: 52 },
  { slug: 'service-design', labelEn: 'Service Design', labelAr: 'تصميم الخدمات', personaScopes: ['government'], sortOrder: 53 },
  { slug: 'public-communication', labelEn: 'Public Communication', labelAr: 'التواصل العام', personaScopes: ['government'], sortOrder: 54 },
  { slug: 'knowledge', labelEn: 'Knowledge', labelAr: 'معرفة', personaScopes: ['government', 'business'], sortOrder: 55 },
];

export interface CuratedItemSeed {
  slug: string;
  itemType: LibraryItemType;
  title: string;
  titleAr: string;
  shortDescription: string;
  shortDescriptionAr: string;
  categories: string[];
  tags: string[];
  supportedPersonas: string[];
  featured?: boolean;
  scheduled?: boolean;
  definition: Record<string, unknown>;
}

export const CURATED_ITEMS: CuratedItemSeed[] = [
  {
    slug: 'biina-study-assistant',
    itemType: 'PROMPT_TEMPLATE',
    title: 'BIINA Study Assistant',
    titleAr: 'مساعد الدراسة من BIINA',
    shortDescription: 'Explain a concept simply, with an example and a quick check.',
    shortDescriptionAr: 'اشرح مفهومًا ببساطة مع مثال وسؤال تحقق سريع.',
    categories: ['study', 'exam-prep'],
    tags: ['study', 'explain'],
    supportedPersonas: ['campus', 'teens'],
    featured: true,
    definition: {
      promptTemplate: 'Explain the concept "{concept}" for a {level} student. Use simple language, one worked example, and end with a short question to check understanding.',
      inputFields: [
        { key: 'concept', labelEn: 'Concept', labelAr: 'المفهوم', type: 'text', required: true },
        { key: 'level', labelEn: 'Level', labelAr: 'المستوى', type: 'select', options: ['high school', 'undergraduate', 'graduate'], required: false },
      ],
      outputFormat: 'markdown',
    },
  },
  {
    slug: 'biina-practice-questions',
    itemType: 'PROMPT_TEMPLATE',
    title: 'BIINA Practice Questions',
    titleAr: 'أسئلة تدريبية من BIINA',
    shortDescription: 'Generate practice questions with answers on any topic.',
    shortDescriptionAr: 'أنشئ أسئلة تدريبية مع الإجابات حول أي موضوع.',
    categories: ['exam-prep', 'study'],
    tags: ['exam', 'practice'],
    supportedPersonas: ['campus', 'teens'],
    definition: {
      promptTemplate: 'Create {count} practice questions on "{topic}" at {difficulty} difficulty. Provide an answer key at the end.',
      inputFields: [
        { key: 'topic', labelEn: 'Topic', labelAr: 'الموضوع', type: 'text', required: true },
        { key: 'count', labelEn: 'How many', labelAr: 'العدد', type: 'number', required: false },
        { key: 'difficulty', labelEn: 'Difficulty', labelAr: 'الصعوبة', type: 'select', options: ['easy', 'medium', 'hard'], required: false },
      ],
      outputFormat: 'markdown',
    },
  },
  {
    slug: 'biina-meeting-prep',
    itemType: 'PROMPT_TEMPLATE',
    title: 'BIINA Meeting Prep',
    titleAr: 'تحضير الاجتماعات من BIINA',
    shortDescription: 'Turn an agenda into talking points and questions.',
    shortDescriptionAr: 'حوّل جدول الأعمال إلى نقاط نقاش وأسئلة.',
    categories: ['planning', 'productivity'],
    tags: ['meeting', 'prep'],
    supportedPersonas: ['professional', 'business'],
    featured: true,
    definition: {
      promptTemplate: 'Prepare me for a meeting about "{subject}". Draft talking points, likely questions, and a suggested outcome. Context: {context}',
      inputFields: [
        { key: 'subject', labelEn: 'Subject', labelAr: 'الموضوع', type: 'text', required: true },
        { key: 'context', labelEn: 'Context', labelAr: 'السياق', type: 'text', required: false, maxLength: 4000 },
      ],
      outputFormat: 'markdown',
    },
  },
  {
    slug: 'biina-weekly-report',
    itemType: 'PROMPT_TEMPLATE',
    title: 'BIINA Weekly Report',
    titleAr: 'التقرير الأسبوعي من BIINA',
    shortDescription: 'Draft a concise weekly status report from your notes.',
    shortDescriptionAr: 'صُغ تقرير حالة أسبوعيًا موجزًا من ملاحظاتك.',
    categories: ['reporting', 'management'],
    tags: ['report', 'weekly'],
    supportedPersonas: ['business', 'professional'],
    definition: {
      promptTemplate: 'Write a concise weekly status report from these notes: {notes}. Sections: Highlights, In progress, Blockers, Next week.',
      inputFields: [{ key: 'notes', labelEn: 'Notes', labelAr: 'ملاحظات', type: 'text', required: true, maxLength: 8000 }],
      outputFormat: 'markdown',
    },
  },
  {
    slug: 'biina-research-assistant',
    itemType: 'RESEARCH_TEMPLATE',
    title: 'BIINA Research Assistant',
    titleAr: 'مساعد البحث من BIINA',
    shortDescription: 'Evidence-based research on a topic with citations.',
    shortDescriptionAr: 'بحث قائم على الأدلة حول موضوع مع الاستشهادات.',
    categories: ['research'],
    tags: ['research'],
    supportedPersonas: ['campus', 'professional', 'business', 'government'],
    featured: true,
    definition: {
      objective: 'Research {topic} using authoritative sources and summarize the key findings with citations.',
      depth: 'STANDARD',
      webEnabled: true,
      inputFields: [{ key: 'topic', labelEn: 'Topic', labelAr: 'الموضوع', type: 'text', required: true }],
    },
  },
  {
    slug: 'biina-executive-brief',
    itemType: 'RESEARCH_TEMPLATE',
    title: 'BIINA Executive Brief',
    titleAr: 'الموجز التنفيذي من BIINA',
    shortDescription: 'An evidence-based executive brief on any subject.',
    shortDescriptionAr: 'موجز تنفيذي قائم على الأدلة حول أي موضوع.',
    categories: ['research', 'reporting'],
    tags: ['brief', 'executive'],
    supportedPersonas: ['business', 'government', 'professional'],
    definition: {
      objective: 'Prepare an evidence-based executive brief on {topic} using internal knowledge and current external sources.',
      depth: 'STANDARD',
      webEnabled: true,
      inputFields: [{ key: 'topic', labelEn: 'Topic', labelAr: 'الموضوع', type: 'text', required: true }],
    },
  },
  {
    slug: 'biina-sales-analyst',
    itemType: 'AGENT_TEMPLATE',
    title: 'BIINA Sales Analyst',
    titleAr: 'محلل المبيعات من BIINA',
    shortDescription: 'Read-only assistant that summarizes recent sales emails and files.',
    shortDescriptionAr: 'مساعد للقراءة فقط يلخّص رسائل وملفات المبيعات الأخيرة.',
    categories: ['sales', 'reporting'],
    tags: ['sales', 'read-only'],
    supportedPersonas: ['business', 'professional'],
    definition: {
      instructions: 'You summarize recent sales activity. Read the user’s connected mail and files and produce a concise summary. You never send messages or modify records.',
      allowedTools: ['gmail.search', 'gmail.read', 'drive.search', 'drive.read'],
      allowedConnectors: ['gmail', 'google-drive'],
      approvalPolicy: 'ASK_EVERY_WRITE',
    },
  },
  {
    slug: 'biina-weekly-sales-review',
    itemType: 'WORKFLOW_TEMPLATE',
    title: 'BIINA Weekly Sales Review',
    titleAr: 'مراجعة المبيعات الأسبوعية من BIINA',
    shortDescription: 'Weekly automation that reads recent sales mail and drafts a review.',
    shortDescriptionAr: 'أتمتة أسبوعية تقرأ بريد المبيعات وتُعدّ مسودة مراجعة.',
    categories: ['sales', 'automation'],
    tags: ['sales', 'weekly'],
    supportedPersonas: ['business'],
    scheduled: true,
    definition: {
      goal: 'Each week, review recent sales emails and prepare a short summary draft for the team. Do not send anything without approval.',
      allowedTools: ['gmail.search', 'gmail.read', 'gmail.createDraft'],
      requiredConnectors: ['gmail'],
      suggestedTrigger: { type: 'SCHEDULE', pattern: 'weekly' },
      approvalPolicy: 'ASK_EVERY_WRITE',
    },
  },
];

/** Idempotently seed categories + curated items. Returns counts. */
export async function seedLibrary(adminUserId: string): Promise<{ categories: number; items: number }> {
  const db = getDb();
  let cats = 0;
  for (const c of CATEGORY_SEEDS) {
    const [existing] = await db.select({ id: libraryCategories.id }).from(libraryCategories).where(eq(libraryCategories.slug, c.slug)).limit(1);
    if (existing) {
      await db.update(libraryCategories).set({ labelEn: c.labelEn, labelAr: c.labelAr, personaScopes: c.personaScopes, sortOrder: c.sortOrder }).where(eq(libraryCategories.id, existing.id));
    } else {
      await db.insert(libraryCategories).values({ slug: c.slug, labelEn: c.labelEn, labelAr: c.labelAr, personaScopes: c.personaScopes, sortOrder: c.sortOrder });
      cats++;
    }
  }

  let items = 0;
  for (const seed of CURATED_ITEMS) {
    const [existing] = await db.select({ id: libraryItems.id }).from(libraryItems).where(eq(libraryItems.slug, seed.slug)).limit(1);
    if (existing) continue; // idempotent: leave published curated items as-is
    // Create the item with a stable curated slug (override the auto-slug).
    const item = await createItem({
      itemType: seed.itemType,
      title: seed.title,
      titleAr: seed.titleAr,
      shortDescription: seed.shortDescription,
      shortDescriptionAr: seed.shortDescriptionAr,
      publisherType: 'BIINA',
      visibility: 'BIINA_CURATED',
      categories: seed.categories,
      tags: seed.tags,
      supportedPersonas: seed.supportedPersonas,
      createdByUserId: adminUserId,
    });
    await db.update(libraryItems).set({ slug: seed.slug, featured: seed.featured ?? false }).where(eq(libraryItems.id, item.id));
    const withSlug = { ...item, slug: seed.slug };

    const { version, validation } = await createVersion(withSlug, {
      itemType: seed.itemType,
      definition: seed.definition,
      changeNotes: 'Initial curated release',
      scheduled: seed.scheduled,
      supportedPersonas: seed.supportedPersonas,
      createdByUserId: adminUserId,
    });
    if (!validation.ok) {
      // A curated item that fails validation is a build error — surface it loudly.
      throw new Error(`Curated item ${seed.slug} failed validation: ${validation.flags.map((f) => f.code).join(', ')}`);
    }
    await publishVersion(withSlug, version);
    items++;
  }
  return { categories: cats, items };
}

export async function listCategories(persona?: string | null) {
  const rows = await getDb().select().from(libraryCategories).where(eq(libraryCategories.enabled, true));
  const filtered = persona ? rows.filter((r) => r.personaScopes.length === 0 || r.personaScopes.includes(persona)) : rows;
  return filtered.sort((a, b) => a.sortOrder - b.sortOrder);
}
