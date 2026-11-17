export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  linkText?: string;
  linkHref?: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'faq-vegetarian',
    question: 'Is it vegetarian?',
    answer: 'Yes. The café is fully vegetarian and eggless.',
  },
  {
    id: 'faq-delivery',
    question: 'Do you deliver?',
    answer: 'No. We offer dine-in and takeaway only. We do not deliver or cater.',
  },
  {
    id: 'faq-parking',
    question: 'Is there parking?',
    answer: 'Yes. Street parking is available nearby for about five cars.',
  },
  {
    id: 'faq-pets',
    question: 'Can I bring my dog?',
    answer: 'Pets are welcome in our outdoor seating area on the stone steps only.',
  },
  {
    id: 'faq-wifi',
    question: 'Is there Wi-Fi?',
    answer: 'Yes. High-speed Wi-Fi is available, with plug points at every table.',
  },
  {
    id: 'faq-jain',
    question: 'Jain options?',
    answer:
      'Dishes marked with the Jain badge can be prepared without onion, garlic, or root vegetables on request.',
    linkText: 'Browse Jain options on the menu',
    linkHref: '/menu?jain=1',
  },
  {
    id: 'faq-vegan',
    question: 'Vegan options?',
    answer:
      'Dishes marked with the vegan badge are dairy-free. Some other dishes can be made vegan on request.',
    linkText: 'Browse vegan options on the menu',
    linkHref: '/menu?vegan=1',
  },
  {
    id: 'faq-nuts',
    question: 'Nut allergy?',
    answer:
      'Dishes containing nuts list them clearly. The kitchen also handles nuts, so please inform our team before ordering.',
  },
  {
    id: 'faq-monday',
    question: 'Are you open on Monday?',
    answer: 'No. Monday is our weekly closing day for sorting and rest.',
  },
  {
    id: 'faq-birthday',
    question: 'Can I host a birthday?',
    answer: 'Yes. We host small gatherings of up to 12 guests with advance notice.',
    linkText: 'See Gatherings',
    linkHref: '/gatherings',
  },
  {
    id: 'faq-openmic',
    question: 'When is open-mic night?',
    answer: 'Open-mic evening takes place on the first Saturday of every month.',
    linkText: 'See Gatherings',
    linkHref: '/gatherings',
  },
  {
    id: 'faq-bookings',
    question: 'How do bookings work?',
    answer:
      'Slots seat two, four, or six guests. Same-day bookings close two hours ahead. Groups of eight or more need 24 hours notice. Slots are held for 15 minutes.',
    linkText: 'Reserve a slot',
    linkHref: '/reserve',
  },
  {
    id: 'faq-takeaway',
    question: 'How do takeaway orders work?',
    answer:
      'Average preparation takes 15 to 20 minutes. Orders are dispatched to our WhatsApp, and you pay at pickup.',
    linkText: 'Order takeaway',
    linkHref: '/order',
  },
];
