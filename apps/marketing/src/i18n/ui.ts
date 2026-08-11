// Central place for navigation, shared UI strings, and the bilingual route map.
// English lives at the root; Arabic under /ar/. Every page exists in both trees.

export type Lang = 'en' | 'ar';
export type PageKey = 'home' | 'approach' | 'institutions' | 'about' | 'contact';

export const languages: Record<Lang, string> = {
  en: 'English',
  ar: 'العربية',
};

// Canonical path for each page in each language.
export const routes: Record<PageKey, Record<Lang, string>> = {
  home: { en: '/', ar: '/ar/' },
  approach: { en: '/approach', ar: '/ar/approach' },
  institutions: { en: '/institutions', ar: '/ar/institutions' },
  about: { en: '/about', ar: '/ar/about' },
  contact: { en: '/contact', ar: '/ar/contact' },
};

// Order of items in the main navigation.
export const navOrder: PageKey[] = ['home', 'approach', 'institutions', 'about', 'contact'];

export const ui = {
  en: {
    dir: 'ltr',
    htmlLang: 'en',
    // Navigation
    nav: {
      home: 'Home',
      approach: 'Approach',
      institutions: 'For institutions',
      about: 'About',
      contact: 'Contact',
    },
    skipToContent: 'Skip to content',
    // Language switcher
    switchTo: 'العربية',
    switchToAria: 'التبديل إلى العربية',
    // Header / brand
    tagline: 'An Arabic-first AI platform for education',
    // Development banner
    devNoticeShort: 'In development',
    // Footer
    footer: {
      description:
        'BIINA is an early-stage company based in Abu Dhabi, building the application and Arabic-language layer of an AI platform for education.',
      statusHeading: 'Status',
      status: 'In active development. Not yet publicly available.',
      contactHeading: 'Contact',
      navHeading: 'Site',
      rights: 'All rights reserved.',
      // Legal / honesty note kept visible site-wide.
      disclaimer:
        'This website describes work in progress. It does not represent any partnership, endorsement, or availability of a live product.',
    },
    // Placeholder — replace before launch.
    email: 'hello@biina.ai',
  },
  ar: {
    dir: 'rtl',
    htmlLang: 'ar',
    nav: {
      home: 'الرئيسية',
      approach: 'منهجنا',
      institutions: 'للمؤسسات',
      about: 'عن BIINA',
      contact: 'تواصل',
    },
    skipToContent: 'تخطَّ إلى المحتوى',
    switchTo: 'English',
    switchToAria: 'Switch to English',
    tagline: 'منصّة ذكاء اصطناعي للتعليم، تبدأ من العربية',
    devNoticeShort: 'قيد التطوير',
    footer: {
      description:
        'BIINA شركة في مراحلها المبكّرة، مقرّها أبوظبي، تبني طبقة التطبيق والقدرات العربية لمنصّة ذكاء اصطناعي للتعليم.',
      statusHeading: 'الحالة',
      status: 'قيد التطوير الفعّال. لم تُطرح للعموم بعد.',
      contactHeading: 'تواصل',
      navHeading: 'الموقع',
      rights: 'جميع الحقوق محفوظة.',
      disclaimer:
        'يصف هذا الموقع عملًا قيد الإنجاز، ولا يمثّل أي شراكة أو تأييد أو توفّر منتج قائم.',
    },
    email: 'hello@biina.ai',
  },
} as const;

export function t(lang: Lang) {
  return ui[lang];
}
