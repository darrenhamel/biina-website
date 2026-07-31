import type { Lang } from '../i18n/ui';

interface Layer {
  index: string;
  role: string;
  title: string;
  body: string;
}
interface Principle {
  title: string;
  body: string;
}
interface ApproachCopy {
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  lead: string;
  layersHeading: string;
  layers: Layer[];
  whyHeading: string;
  whyBody: string[];
  principlesHeading: string;
  principles: Principle[];
  devLabel: string;
  devText: string;
  ctaHeading: string;
  ctaText: string;
  ctaButton: string;
}

export const approach: Record<Lang, ApproachCopy> = {
  en: {
    title: 'Approach',
    description:
      'How BIINA thinks about building an Arabic-first AI platform for education — a layered model with sovereign infrastructure at the foundation and an Arabic-language layer on top.',
    eyebrow: 'Approach',
    heading: 'A layered model, with Arabic at the top and sovereignty at the base.',
    lead: 'We are designing BIINA as a set of layers. Each has a clear job, so an institution can trust the foundation while we focus on the application and the language that make it useful.',
    layersHeading: 'The layers',
    layers: [
      {
        index: '01',
        role: 'Foundation',
        title: 'Sovereign infrastructure',
        body: 'Underneath everything sits secure, regionally-governed compute and data handling. BIINA is designed to operate on this kind of sovereign foundation — infrastructure governed within the region — rather than depending on compute governed elsewhere. We build to run on it; we do not claim to provide it.',
      },
      {
        index: '02',
        role: 'BIINA · Application',
        title: 'The application layer',
        body: 'On top of the foundation, BIINA builds the application: the tools, workflows, and interfaces that make AI genuinely useful inside a school or a university — designed around how teaching, learning, and administration actually work.',
      },
      {
        index: '03',
        role: 'BIINA · Language',
        title: 'The Arabic-language layer',
        body: 'The layer that gives BIINA its reason to exist. Arabic is treated as a primary language — its grammar, registers, and educational context handled directly, not machine-translated from an English-first system. English is supported alongside it, not above it.',
      },
    ],
    whyHeading: 'Why build it this way',
    whyBody: [
      'Separating the layers keeps responsibilities clear. The foundation can be operated to sovereign and institutional standards, while BIINA concentrates on the two things it is best placed to build: a useful application and a genuine Arabic-language capability.',
      'It also keeps us honest about what is ours. We are building the application and language layers. We are designing them to run on sovereign infrastructure — an intention about how the platform should be deployed, not a claim about arrangements that are not yet in place.',
    ],
    principlesHeading: 'Principles we build by',
    principles: [
      {
        title: 'Arabic-first, not Arabic-added',
        body: 'Arabic is a starting point in the design, not a translation layer applied at the end.',
      },
      {
        title: 'Sovereignty-ready',
        body: 'Designed to run on regionally-governed infrastructure, so data and control can stay within the region.',
      },
      {
        title: 'Built for education',
        body: 'Shaped around the real needs of schools, universities, teachers, and learners.',
      },
      {
        title: 'Honest about stage',
        body: 'We describe what we are building and what is still ahead — without overstating either.',
      },
    ],
    devLabel: 'A note on this page.',
    devText:
      'This describes our design intent for a platform in development. Specifics of infrastructure and capabilities will be shared as they are established.',
    ctaHeading: 'Want to go deeper on the approach?',
    ctaText:
      'We are happy to talk through the model in detail with partners, institutions, and investors.',
    ctaButton: 'Get in touch',
  },
  ar: {
    title: 'منهجنا',
    description:
      'كيف تفكّر BIINA في بناء منصّة ذكاء اصطناعي عربية أولًا للتعليم — نموذج من طبقات، أساسه بنية تحتية سيادية وقمّته طبقة عربية.',
    eyebrow: 'منهجنا',
    heading: 'نموذج من طبقات: العربية في القمّة، والسيادة في الأساس.',
    lead: 'نصمّم BIINA كمجموعة من الطبقات، لكلٍّ منها دور واضح، بحيث تثق المؤسسة بالأساس بينما نركّز نحن على التطبيق واللغة اللذين يجعلانه مفيدًا.',
    layersHeading: 'الطبقات',
    layers: [
      {
        index: '٠١',
        role: 'الأساس',
        title: 'البنية التحتية السيادية',
        body: 'يقوم كل شيء على قدرة حوسبة ومعالجة بيانات آمنة خاضعة للحوكمة المحلية. صُمِّمت BIINA للعمل على أساس سيادي من هذا النوع — بنية تحتية تُدار داخل المنطقة — بدلًا من الاعتماد على حوسبة تُدار خارجها. نحن نبني لتعمل عليها، لا ندّعي أننا نوفّرها.',
      },
      {
        index: '٠٢',
        role: 'BIINA · التطبيق',
        title: 'طبقة التطبيق',
        body: 'فوق الأساس، تبني BIINA التطبيق: الأدوات وسير العمل والواجهات التي تجعل الذكاء الاصطناعي مفيدًا فعلًا داخل المدرسة أو الجامعة، مصمّمة حول طبيعة التعليم والتعلّم والإدارة كما تجري فعلًا.',
      },
      {
        index: '٠٣',
        role: 'BIINA · اللغة',
        title: 'الطبقة العربية',
        body: 'الطبقة التي تمنح BIINA سبب وجودها. تُعامَل العربية كلغة أساسية — بقواعدها ومستوياتها وسياقها التعليمي — تُعالَج مباشرةً، لا تُترجَم آليًا عن نظام إنجليزي أولًا. والإنجليزية مدعومة إلى جانبها، لا فوقها.',
      },
    ],
    whyHeading: 'لماذا نبنيها بهذه الطريقة',
    whyBody: [
      'فصل الطبقات يُبقي المسؤوليات واضحة. يمكن تشغيل الأساس وفق معايير سيادية ومؤسسية، بينما تركّز BIINA على ما هي الأقدر على بنائه: تطبيق مفيد وقدرة عربية حقيقية.',
      'كما يُبقينا صادقين بشأن ما هو ملكنا. نحن نبني طبقتَي التطبيق واللغة، ونصمّمهما للعمل على بنية تحتية سيادية — وهي نيّة بشأن كيفية نشر المنصّة، لا ادّعاء بترتيبات لم تُبرَم بعد.',
    ],
    principlesHeading: 'مبادئ نبني عليها',
    principles: [
      {
        title: 'العربية أولًا، لا العربية مُضافة',
        body: 'العربية نقطة انطلاق في التصميم، لا طبقة ترجمة تُضاف في النهاية.',
      },
      {
        title: 'جاهزة للسيادة',
        body: 'مصمّمة للعمل على بنية تحتية خاضعة للحوكمة المحلية، لتبقى البيانات والتحكّم داخل المنطقة.',
      },
      {
        title: 'مبنية للتعليم',
        body: 'مصوغة حول الاحتياجات الفعلية للمدارس والجامعات والمعلّمين والمتعلّمين.',
      },
      {
        title: 'صادقة بشأن المرحلة',
        body: 'نصف ما نبنيه وما لا يزال أمامنا، دون مبالغة في أيٍّ منهما.',
      },
    ],
    devLabel: 'ملاحظة حول هذه الصفحة.',
    devText:
      'تصف هذه الصفحة نيّتنا التصميمية لمنصّة قيد التطوير. وسنشارك تفاصيل البنية التحتية والقدرات عند ترسّخها.',
    ctaHeading: 'تودّ التعمّق أكثر في المنهج؟',
    ctaText: 'يسعدنا أن نشرح النموذج بالتفصيل مع الشركاء والمؤسسات والمستثمرين.',
    ctaButton: 'تواصل معنا',
  },
};
