export interface SignatureDish {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  description: string;
  price: number;
  vegan: boolean;
  jain: boolean;
  glutenFree: boolean;
  allergens: string[];
  spice: 0 | 1 | 2 | 3;
  prepMinutes: number;
  tags: string[];
  cellIndex: number;
  icon: 'mug' | 'book' | 'jar';
}

export const SIGNATURE_DISHES: SignatureDish[] = [
  {
    id: 'PH0003',
    name: 'Post Chai',
    category: 'Chai & Tea',
    subcategory: 'Chai',
    description: 'Signature chai with smoked cardamom and jaggery',
    price: 1.4,
    vegan: false,
    jain: true,
    glutenFree: true,
    allergens: ['dairy'],
    spice: 0,
    prepMinutes: 5,
    tags: ['signature'],
    cellIndex: 4,
    icon: 'mug',
  },
  {
    id: 'PH0060',
    name: 'Maska Pav',
    category: 'Breakfast',
    subcategory: 'Indian breakfast',
    description: 'Toasted pav with plenty of butter',
    price: 1.4,
    vegan: false,
    jain: true,
    glutenFree: false,
    allergens: ['dairy', 'gluten'],
    spice: 0,
    prepMinutes: 12,
    tags: ['signature', 'popular'],
    cellIndex: 11,
    icon: 'jar',
  },
  {
    id: 'PH0152',
    name: 'Himachali Siddu',
    category: 'Indian Mains',
    subcategory: 'Himachali kitchen',
    description:
      'Steamed wheat bread with ghee and mint chutney. Siddu is a Himachali speciality',
    price: 2.4,
    vegan: false,
    jain: false,
    glutenFree: false,
    allergens: ['dairy', 'gluten'],
    spice: 0,
    prepMinutes: 20,
    tags: ['signature', 'popular'],
    cellIndex: 18,
    icon: 'book',
  },
  {
    id: 'PH0097',
    name: 'Pan-Fried Paneer Momos (8 pcs)',
    category: 'Snacks & Small Plates',
    subcategory: 'Momos',
    description:
      'pan-fried momos filled with paneer, with red chilli chutney and mint dip',
    price: 3.1,
    vegan: false,
    jain: false,
    glutenFree: false,
    allergens: ['dairy', 'gluten', 'soy'],
    spice: 2,
    prepMinutes: 14,
    tags: ['signature', 'popular', 'spicy'],
    cellIndex: 29,
    icon: 'jar',
  },
  {
    id: 'PH0203',
    name: 'Jaggery Kheer',
    category: 'Desserts',
    subcategory: 'Indian sweets',
    description: 'Rice pudding sweetened with jaggery',
    price: 2.4,
    vegan: false,
    jain: false,
    glutenFree: true,
    allergens: ['dairy', 'nuts'],
    spice: 0,
    prepMinutes: 4,
    tags: ['signature'],
    cellIndex: 36,
    icon: 'mug',
  },
  {
    id: 'PH0049',
    name: 'Buransh Sharbat',
    category: 'Cold Drinks',
    subcategory: 'Sharbats',
    description: 'Rhododendron squash from the hills, served over ice',
    price: 2.0,
    vegan: true,
    jain: true,
    glutenFree: true,
    allergens: [],
    spice: 0,
    prepMinutes: 5,
    tags: ['signature', 'seasonal'],
    cellIndex: 43,
    icon: 'jar',
  },
];

const REQUIRED_SIGNATURE_IDS = [
  'PH0003',
  'PH0060',
  'PH0152',
  'PH0097',
  'PH0203',
  'PH0049',
];

for (const requiredId of REQUIRED_SIGNATURE_IDS) {
  if (!SIGNATURE_DISHES.some((dish) => dish.id === requiredId)) {
    throw new Error(
      `Build failed: Required signature item ${requiredId} is missing from the café signature catalog.`,
    );
  }
}
