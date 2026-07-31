import type { Lang } from '../i18n/ui';

interface Layer {
  tag: string;
  title: string;
  body: string;
}
interface HomeCopy {
  title: string;
  description: string;
  heroEyebrow: string;
  heroTitle: string;
  heroSentence: string;
  ctaApproach: string;
  ctaInstitutions: string;
  buildingEyebrow: string;
  buildingStatement: string;
  approachEyebrow: string;
  approachHeading: string;
  approachLead: string;
  layers: Layer[];
  layersMore: string;
  whoEyebrow: string;
  whoHeading: string;
  whoBody: string;
  whoLink: string;
  checks: string[];
  devLabel: string;
  devText: string;
  ctaHeading: string;
  ctaText: string;
  ctaButton: string;
}

export const home: Record<Lang, HomeCopy> = {
  en: {
    title: 'An AI platform for education, built around Arabic',
    description:
      'BIINA is an early-stage company in Abu Dhabi building the application and Arabic-language layer of an AI platform for schools and universities — designed to run on sovereign infrastructure.',
    heroEyebrow: 'Abu Dhabi · In development',
    heroTitle: 'An AI platform for education, built around Arabic.',
    heroSentence:
      'BIINA is building the application and Arabic-language layer of an AI platform for schools and universities — designed to run on sovereign infrastructure, with Arabic treated as a primary language, not a translation.',
    ctaApproach: 'Our approach',
    ctaInstitutions: 'For institutions',
    buildingEyebrow: "What we're building",
    buildingStatement:
      'We are building an AI platform that puts the Arabic language and the needs of Arab educational institutions at its centre — the application layer and the Arabic-language capabilities that sit on top of sovereign, regionally-governed AI infrastructure.',
    approachEyebrow: 'The approach',
    approachHeading: 'Built in layers',
    approachLead:
      'We think about the platform as layers — a secure foundation, an application, and a language layer that treats Arabic as first-class.',
    layers: [
      {
        tag: 'Layer',
        title: 'The Arabic-language layer',
        body: 'Arabic handled as a primary language — its structure, register, and educational context — rather than machine-translated from English.',
      },
      {
        tag: 'BIINA',
        title: 'The application layer',
        body: 'The tools and interfaces that make AI genuinely useful inside a classroom, a department, or an institution.',
      },
      {
        tag: 'Foundation',
        title: 'Sovereign infrastructure',
        body: 'BIINA is designed to run on secure, regionally-governed compute — a foundation an institution can trust, rather than compute governed outside the region.',
      },
    ],
    layersMore: 'Read more about our approach',
    whoEyebrow: "Who it's for",
    whoHeading: 'Working with schools and universities',
    whoBody:
      'We are designing BIINA to work alongside educational institutions across the region. There is no product to adopt yet — but the conversations we have now shape what we build.',
    whoLink: 'How we work with institutions',
    checks: [
      'Arabic as a first-class language',
      'Designed for sovereign, regionally-governed infrastructure',
      'Built for the realities of schools and universities',
    ],
    devLabel: 'Currently in development.',
    devText:
      'BIINA is in active development and is not yet publicly available. This site describes what we are building and how we approach it. We will share more as the platform matures.',
    ctaHeading: 'Building something for the region?',
    ctaText:
      'We would like to hear from infrastructure partners, educational institutions, and investors interested in an Arabic-first AI platform.',
    ctaButton: 'Get in touch',
  },
  ar: {
    title: 'منصّة ذكاء اصطناعي للتعليم، تبدأ من العربية',
    description:
      'BIINA شركة في مراحلها المبكّرة مقرّها أبوظبي، تبني طبقة التطبيق والقدرات العربية لمنصّة ذكاء اصطناعي للمدارس والجامعات، مصمّمة للعمل على بنية تحتية سيادية.',
    heroEyebrow: 'أبوظبي · قيد التطوير',
    heroTitle: 'منصّة ذكاء اصطناعي للتعليم، تبدأ من العربية.',
    heroSentence:
      'تبني BIINA طبقة التطبيق والقدرات العربية لمنصّة ذكاء اصطناعي موجَّهة للمدارس والجامعات، مصمّمة للعمل على بنية تحتية سيادية، وتتعامل مع اللغة العربية كلغة أساسية لا كترجمة.',
    ctaApproach: 'منهجنا',
    ctaInstitutions: 'للمؤسسات',
    buildingEyebrow: 'ما الذي نبنيه',
    buildingStatement:
      'نبني منصّة ذكاء اصطناعي تضع اللغة العربية واحتياجات المؤسسات التعليمية العربية في صميمها: طبقة التطبيق والقدرات العربية التي تعمل فوق بنية تحتية سيادية للذكاء الاصطناعي خاضعة للحوكمة المحلية.',
    approachEyebrow: 'المنهج',
    approachHeading: 'بنية من طبقات',
    approachLead:
      'ننظر إلى المنصّة كطبقات: أساس آمن، وطبقة تطبيق، وطبقة لغوية تتعامل مع العربية كلغة أساسية.',
    layers: [
      {
        tag: 'طبقة',
        title: 'الطبقة العربية',
        body: 'تتعامل مع العربية كلغة أساسية — ببنيتها ومستوياتها وسياقها التعليمي — لا كترجمة آلية عن الإنجليزية.',
      },
      {
        tag: 'BIINA',
        title: 'طبقة التطبيق',
        body: 'الأدوات والواجهات التي تجعل الذكاء الاصطناعي مفيدًا فعلًا داخل الصف الدراسي أو القسم أو المؤسسة.',
      },
      {
        tag: 'الأساس',
        title: 'البنية التحتية السيادية',
        body: 'صُمِّمت BIINA للعمل على قدرة حوسبة آمنة خاضعة للحوكمة المحلية — أساس تثق به المؤسسة، بدلًا من حوسبة تُدار خارج المنطقة.',
      },
    ],
    layersMore: 'اقرأ المزيد عن منهجنا',
    whoEyebrow: 'لمن هذه المنصّة',
    whoHeading: 'العمل مع المدارس والجامعات',
    whoBody:
      'نصمّم BIINA لتعمل جنبًا إلى جنب مع المؤسسات التعليمية في المنطقة. لا يوجد منتج للاعتماد بعد، لكنّ الحوارات التي نجريها الآن هي ما يشكّل ما نبنيه.',
    whoLink: 'كيف نعمل مع المؤسسات',
    checks: [
      'العربية كلغة أساسية',
      'مصمّمة لبنية تحتية سيادية خاضعة للحوكمة المحلية',
      'مبنية لواقع المدارس والجامعات',
    ],
    devLabel: 'قيد التطوير حاليًا.',
    devText:
      'BIINA قيد التطوير الفعّال ولم تُطرح للعموم بعد. يوضّح هذا الموقع ما نبنيه وكيف نفكّر فيه، وسنشارك المزيد مع نضوج المنصّة.',
    ctaHeading: 'تبني شيئًا للمنطقة؟',
    ctaText:
      'يسعدنا التواصل مع شركاء البنية التحتية والمؤسسات التعليمية والمستثمرين المهتمّين بمنصّة ذكاء اصطناعي عربية أولًا.',
    ctaButton: 'تواصل معنا',
  },
};
