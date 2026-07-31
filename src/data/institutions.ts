import type { Lang } from '../i18n/ui';

interface Item {
  title: string;
  body: string;
}
interface InstitutionsCopy {
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  lead: string;
  audienceHeading: string;
  audience: Item[];
  howHeading: string;
  howLead: string;
  how: Item[];
  caresHeading: string;
  cares: string[];
  devLabel: string;
  devText: string;
  ctaHeading: string;
  ctaText: string;
  ctaButton: string;
}

export const institutions: Record<Lang, InstitutionsCopy> = {
  en: {
    title: 'For institutions',
    description:
      'How schools, universities, and education bodies would work with BIINA as we build an Arabic-first AI platform. There is no product to adopt yet — early conversations shape what we build.',
    eyebrow: 'For institutions',
    heading: 'Built with schools and universities in mind.',
    lead: 'We are designing BIINA for educational institutions across the Arab world. We would like to build it alongside the people who would use it — before there is a finished product, not after.',
    audienceHeading: 'Who we are building for',
    audience: [
      {
        title: 'Schools',
        body: 'Primary and secondary schools that want AI tools built around Arabic and around how teaching actually happens.',
      },
      {
        title: 'Universities',
        body: 'Higher-education institutions weighing how AI fits teaching, research, and administration — with language and governance that meet their standards.',
      },
      {
        title: 'Education bodies',
        body: 'Groups and authorities responsible for education who care about Arabic-language capability and where data and control sit.',
      },
    ],
    howHeading: 'How we would work together',
    howLead:
      'At this stage, working together means shaping the platform — not deploying one. The most useful thing an institution can do now is help us build the right thing.',
    how: [
      {
        title: 'Early conversations',
        body: 'We listen to how your institution teaches, operates, and thinks about AI, language, and data — and where the real needs are.',
      },
      {
        title: 'Design input',
        body: 'Interested institutions can help shape priorities: which problems matter most, and what "good" looks like in an Arabic-first tool.',
      },
      {
        title: 'Future pilots',
        body: 'As the platform matures, we intend to work with a small number of institutions on early pilots. These are ahead of us, not available today.',
      },
    ],
    caresHeading: 'What we pay attention to',
    cares: [
      'Arabic-language quality, across registers and real classroom use',
      'Data governance — where information lives and who controls it',
      'The day-to-day realities of teachers, students, and administrators',
      'Fitting alongside existing systems rather than replacing everything',
    ],
    devLabel: 'To be clear about stage.',
    devText:
      'BIINA is in development. There is no product to purchase or deploy today. Any conversation now is about shaping what we build together — with no commitment implied on either side.',
    ctaHeading: 'Interested in an Arabic-first AI platform?',
    ctaText:
      'If your institution wants to help shape the direction, we would like to hear from you.',
    ctaButton: 'Start a conversation',
  },
  ar: {
    title: 'للمؤسسات',
    description:
      'كيف تعمل المدارس والجامعات والجهات التعليمية مع BIINA ونحن نبني منصّة ذكاء اصطناعي عربية أولًا. لا يوجد منتج للاعتماد بعد، والحوارات المبكّرة هي ما يشكّل ما نبنيه.',
    eyebrow: 'للمؤسسات',
    heading: 'مبنيّة مع أخذ المدارس والجامعات في الحسبان.',
    lead: 'نصمّم BIINA للمؤسسات التعليمية في العالم العربي، ونودّ بناءها جنبًا إلى جنب مع من سيستخدمونها — قبل وجود منتج مكتمل، لا بعده.',
    audienceHeading: 'لمن نبني',
    audience: [
      {
        title: 'المدارس',
        body: 'مدارس التعليم الأساسي والثانوي التي تريد أدوات ذكاء اصطناعي مبنية حول العربية وحول طبيعة التدريس كما يجري فعلًا.',
      },
      {
        title: 'الجامعات',
        body: 'مؤسسات التعليم العالي التي توازن كيفية اندماج الذكاء الاصطناعي في التدريس والبحث والإدارة، بلغة وحوكمة تلبّيان معاييرها.',
      },
      {
        title: 'الجهات التعليمية',
        body: 'الهيئات والجهات المسؤولة عن التعليم التي تهتمّ بالقدرة على العربية وبمكان وجود البيانات والتحكّم بها.',
      },
    ],
    howHeading: 'كيف نعمل معًا',
    howLead:
      'في هذه المرحلة، العمل معًا يعني تشكيل المنصّة، لا نشرها. وأنفع ما يمكن أن تقدّمه المؤسسة الآن هو مساعدتنا على بناء الشيء الصحيح.',
    how: [
      {
        title: 'حوارات مبكّرة',
        body: 'نصغي إلى كيفية تدريس مؤسستكم وعملها وتفكيرها في الذكاء الاصطناعي واللغة والبيانات، وأين تكمن الاحتياجات الحقيقية.',
      },
      {
        title: 'مساهمة في التصميم',
        body: 'يمكن للمؤسسات المهتمّة أن تساعد في تحديد الأولويات: أي المشكلات أهمّ، وكيف يبدو «الجيّد» في أداة عربية أولًا.',
      },
      {
        title: 'تجارب مستقبلية',
        body: 'مع نضوج المنصّة، نعتزم العمل مع عدد محدود من المؤسسات على تجارب أولى. هذه أمامنا، وليست متاحة اليوم.',
      },
    ],
    caresHeading: 'ما نوليه اهتمامنا',
    cares: [
      'جودة اللغة العربية عبر مستوياتها وفي الاستخدام الصفّي الحقيقي',
      'حوكمة البيانات — أين تُحفَظ المعلومات ومن يتحكّم بها',
      'الواقع اليومي للمعلّمين والطلبة والإداريين',
      'الاندماج مع الأنظمة القائمة بدلًا من استبدال كل شيء',
    ],
    devLabel: 'توضيحًا للمرحلة.',
    devText:
      'BIINA قيد التطوير. لا يوجد منتج للشراء أو النشر اليوم. وأي حوار الآن هو حول تشكيل ما نبنيه معًا، دون أي التزام ضمنيّ من أيّ طرف.',
    ctaHeading: 'مهتمّون بمنصّة ذكاء اصطناعي عربية أولًا؟',
    ctaText: 'إن أرادت مؤسستكم المساهمة في تشكيل الاتجاه، فيسعدنا أن نسمع منكم.',
    ctaButton: 'ابدأ الحوار',
  },
};
