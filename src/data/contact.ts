import type { Lang } from '../i18n/ui';

interface ContactCopy {
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  lead: string;
  formHeading: string;
  nameLabel: string;
  emailLabel: string;
  orgLabel: string;
  orgOptional: string;
  subjectLabel: string;
  subjectOptions: string[];
  messageLabel: string;
  submit: string;
  privacy: string;
  altHeading: string;
  altBody: string;
  directEmail: string;
  devLabel: string;
  devText: string;
}

export const contact: Record<Lang, ContactCopy> = {
  en: {
    title: 'Contact',
    description:
      'Get in touch with BIINA — for partnership, institutional, or investment enquiries about an Arabic-first AI platform for education, in development in Abu Dhabi.',
    eyebrow: 'Contact',
    heading: 'Get in touch.',
    lead: 'For partnership, institutional, or investment enquiries. We read everything that comes in and reply personally.',
    formHeading: 'Send a message',
    nameLabel: 'Name',
    emailLabel: 'Email',
    orgLabel: 'Organisation',
    orgOptional: 'optional',
    subjectLabel: 'I am reaching out about',
    subjectOptions: [
      'Partnership / infrastructure',
      'School or university',
      'Investment',
      'Something else',
    ],
    messageLabel: 'Message',
    submit: 'Send message',
    privacy:
      'We only use what you send here to reply to you. We do not sell or share it, and we collect nothing beyond this form.',
    altHeading: 'Prefer email?',
    altBody: 'You can reach us directly at:',
    directEmail: 'or write to us directly',
    devLabel: 'A quick note.',
    devText:
      'BIINA is in development. There is no product to sign up for — this form is simply the way to start a conversation.',
  },
  ar: {
    title: 'تواصل',
    description:
      'تواصل مع BIINA — للاستفسارات المتعلّقة بالشراكات أو المؤسسات أو الاستثمار حول منصّة ذكاء اصطناعي عربية أولًا للتعليم، قيد التطوير في أبوظبي.',
    eyebrow: 'تواصل',
    heading: 'تواصل معنا.',
    lead: 'للاستفسارات المتعلّقة بالشراكات أو المؤسسات أو الاستثمار. نقرأ كل ما يصلنا ونردّ شخصيًّا.',
    formHeading: 'أرسل رسالة',
    nameLabel: 'الاسم',
    emailLabel: 'البريد الإلكتروني',
    orgLabel: 'المؤسسة',
    orgOptional: 'اختياري',
    subjectLabel: 'أتواصل بخصوص',
    subjectOptions: [
      'شراكة / بنية تحتية',
      'مدرسة أو جامعة',
      'استثمار',
      'موضوع آخر',
    ],
    messageLabel: 'الرسالة',
    submit: 'إرسال الرسالة',
    privacy:
      'نستخدم ما ترسله هنا للردّ عليك فقط. لا نبيعه ولا نشاركه، ولا نجمع أي شيء خارج هذا النموذج.',
    altHeading: 'تفضّل البريد الإلكتروني؟',
    altBody: 'يمكنك الوصول إلينا مباشرةً عبر:',
    directEmail: 'أو راسلنا مباشرةً',
    devLabel: 'ملاحظة سريعة.',
    devText:
      'BIINA قيد التطوير. لا يوجد منتج للتسجيل فيه — هذا النموذج ببساطة وسيلة لبدء حوار.',
  },
};
