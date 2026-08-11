import type { Lang } from '../i18n/ui';

interface Fact {
  label: string;
  value: string;
}
interface AboutCopy {
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  lead: string;
  facts: Fact[];
  bodyHeading: string;
  body: string[];
  whyHeading: string;
  whyBody: string[];
  teamHeading: string;
  teamBody: string;
  contactHeading: string;
  contactBody: string;
  devLabel: string;
  devText: string;
  ctaHeading: string;
  ctaText: string;
  ctaButton: string;
}

export const about: Record<Lang, AboutCopy> = {
  en: {
    title: 'About',
    description:
      'BIINA is an early-stage company based in Abu Dhabi, building the application and Arabic-language layer of an AI platform for education.',
    eyebrow: 'About',
    heading: 'An early-stage company, based in Abu Dhabi.',
    lead: 'BIINA is building the application and Arabic-language layer of an AI platform for schools and universities — designed to run on sovereign infrastructure.',
    facts: [
      { label: 'Based in', value: 'Abu Dhabi, UAE' },
      { label: 'Stage', value: 'Early-stage · in development' },
      { label: 'Focus', value: 'Arabic-first AI for education' },
    ],
    bodyHeading: 'What we are doing',
    body: [
      'BIINA is building an AI platform for education that treats the Arabic language as first-class. We focus on two layers: the application that makes AI useful inside a school or university, and the Arabic-language capability underneath it — designed to run on sovereign, regionally-governed infrastructure.',
      'We are early. The platform is in active development and not yet publicly available. This site sets out what we are building and how we think, so the people we want to work with can understand us before there is a product to show.',
    ],
    whyHeading: 'Why Abu Dhabi, why now',
    whyBody: [
      'The region is investing seriously in artificial intelligence and in the infrastructure to run it. We think education deserves tools built around the Arabic language from the beginning — not adapted from English-first systems after the fact.',
      'Abu Dhabi is where we are based and where we are building. It puts us close to the institutions, the language, and the infrastructure conversation that this work depends on.',
    ],
    teamHeading: 'Team',
    teamBody:
      'BIINA is founder-led and building its team. We will introduce the people behind it here as the company grows.',
    contactHeading: 'Contact',
    contactBody:
      'For partnership, institutional, or investment enquiries, the fastest way to reach us is by email.',
    devLabel: 'Currently in development.',
    devText:
      'BIINA is in active development and not yet publicly available. Nothing on this site should be read as a live product, a partnership, or an endorsement.',
    ctaHeading: 'Want to talk?',
    ctaText:
      'We are glad to hear from partners, institutions, and investors who share our interest in Arabic-first AI.',
    ctaButton: 'Contact us',
  },
  ar: {
    title: 'عن BIINA',
    description:
      'BIINA شركة في مراحلها المبكّرة مقرّها أبوظبي، تبني طبقة التطبيق والقدرات العربية لمنصّة ذكاء اصطناعي للتعليم.',
    eyebrow: 'عن BIINA',
    heading: 'شركة في مراحلها المبكّرة، مقرّها أبوظبي.',
    lead: 'تبني BIINA طبقة التطبيق والقدرات العربية لمنصّة ذكاء اصطناعي للمدارس والجامعات، مصمّمة للعمل على بنية تحتية سيادية.',
    facts: [
      { label: 'المقر', value: 'أبوظبي، الإمارات العربية المتحدة' },
      { label: 'المرحلة', value: 'مبكّرة · قيد التطوير' },
      { label: 'التركيز', value: 'ذكاء اصطناعي عربي أولًا للتعليم' },
    ],
    bodyHeading: 'ما الذي نقوم به',
    body: [
      'تبني BIINA منصّة ذكاء اصطناعي للتعليم تتعامل مع اللغة العربية كلغة أساسية. نركّز على طبقتين: التطبيق الذي يجعل الذكاء الاصطناعي مفيدًا داخل المدرسة أو الجامعة، والقدرة العربية التي تحته — مصمّمة للعمل على بنية تحتية سيادية خاضعة للحوكمة المحلية.',
      'نحن في بداياتنا. المنصّة قيد التطوير الفعّال ولم تُطرح للعموم بعد. يوضّح هذا الموقع ما نبنيه وكيف نفكّر، ليفهمنا مَن نودّ العمل معهم قبل وجود منتج نعرضه.',
    ],
    whyHeading: 'لماذا أبوظبي، ولماذا الآن',
    whyBody: [
      'تستثمر المنطقة بجدّية في الذكاء الاصطناعي وفي البنية التحتية اللازمة لتشغيله. ونرى أنّ التعليم يستحقّ أدوات مبنيّة حول اللغة العربية منذ البداية، لا مُكيَّفة عن أنظمة إنجليزية أولًا بعد وقوعها.',
      'أبوظبي هي مقرّنا ومكان بنائنا، وتضعنا قريبين من المؤسسات ومن اللغة ومن حوار البنية التحتية الذي يعتمد عليه هذا العمل.',
    ],
    teamHeading: 'الفريق',
    teamBody:
      'تقود BIINA بقيادة مؤسّسها وتبني فريقها. وسنعرّف بمن خلفها هنا مع نموّ الشركة.',
    contactHeading: 'تواصل',
    contactBody:
      'للاستفسارات المتعلّقة بالشراكات أو المؤسسات أو الاستثمار، أسرع وسيلة للوصول إلينا هي البريد الإلكتروني.',
    devLabel: 'قيد التطوير حاليًا.',
    devText:
      'BIINA قيد التطوير الفعّال ولم تُطرح للعموم بعد. ولا ينبغي قراءة أيّ شيء في هذا الموقع على أنه منتج قائم أو شراكة أو تأييد.',
    ctaHeading: 'تودّ التحدّث؟',
    ctaText:
      'يسعدنا أن نسمع من الشركاء والمؤسسات والمستثمرين الذين يشاركوننا اهتمامنا بالذكاء الاصطناعي العربي أولًا.',
    ctaButton: 'تواصل معنا',
  },
};
