import { station } from './business';
// ─── Equipment Detail Pages Data ─────────────────────────────────────────────
// Used by EquipmentDetailPage.tsx to render individual landing pages.

export interface SpecItem {
    label: string;
    value: string;
}

export interface SpecGroup {
    heading: string;      // e.g. "PC SPECS"
    subheading: string;   // e.g. "The Brain"
    items: SpecItem[];
}

export interface KeyFeature {
    stat: string;   // e.g. "10nm"
    label: string;  // e.g. "Force Feedback"
}

export interface EquipmentVariant {
    id: string;
    label: string;
    specGroups: SpecGroup[];
    keyFeatures: KeyFeature[];
    galleryImages?: string[];  // per-variant override; falls back to item.galleryImages
}

export interface EquipmentItem {
    id: string;
    title: string;
    subtitle: string;
    heroImage: string;
    price: number;
    priceUnit: string;
    description: string;
    route: string;
    hasInterchangeableWheels: boolean;
    variants: EquipmentVariant[];
    galleryImages: string[];
    wheelImages?: string[];
    wheelNames?: string[];
}

// ─── Interchangeable Wheel Data (shared: 3 Rigs + 3 Fanatec Karts) ───────────
const rigWheelImages = [
    '/images/equipment/Wheels/IMG_7912.webp',
    '/images/equipment/Wheels/IMG_7915.webp',
    '/images/equipment/Wheels/IMG_7919.webp',
    '/images/equipment/Wheels/IMG_7914.webp',
    '/images/equipment/Rigs/White Rig - Left/IMG_7857.webp',
    '/images/equipment/Karts/IMG_7895.webp',
];
const rigWheelNames = [
    'CSL GT3',
    'Porsche Vision GT',
    'Wheels',
    'F1 eSports v2',
    'Fanatec Formula 2.5',
    'CSL P1',
];

// ─── Equipment Data ───────────────────────────────────────────────────────────
export const equipmentData: EquipmentItem[] = [
    // ─── MOTION ─────────────────────────────────────────────────────────────
    {
        id: 'motion',
        title: 'Motion Simulator',
        subtitle: 'The Crown Jewel',
        heroImage: '/images/equipment/Motion/IMG_7831.webp',
        price: 50,
        priceUnit: 'per person / hour',
        description:
            'Feel every corner of every circuit. Our motion rig pitches, rolls and vibrates in sync with the simulation — triple 4K screens wrapping your vision, hydraulic pedals translating every brake zone. This is as close as it gets without a race license.',
        route: '/equipment/motion',
        hasInterchangeableWheels: false,
        galleryImages: [
            '/images/equipment/Motion/IMG_7835.webp',
            '/images/equipment/Motion/IMG_7834.webp',
            '/images/equipment/Motion/IMG_7837.webp',
            '/images/equipment/Motion/IMG_7845.webp',
            '/images/equipment/Motion/IMG_7850.webp',
        ],
        variants: [
            {
                id: 'motion-default',
                label: 'Motion',
                keyFeatures: [
                    { stat: '10nm', label: 'Force Feedback' },
                    { stat: 'Triple 4K', label: '240Hz Screens' },
                    { stat: 'RTX 5090', label: 'GPU' },
                ],
                specGroups: [
                    {
                        heading: 'PC SPECS',
                        subheading: 'The Brain',
                        items: [
                            { label: 'GPU', value: 'Nvidia RTX 5090' },
                            { label: 'Display', value: 'Triple MSI 32" 240Hz 4K' },
                        ],
                    },
                    {
                        heading: 'SIM HARDWARE',
                        subheading: 'The Control',
                        items: [
                            { label: 'Wheelbase', value: 'Simagic Alpha Neo Mini (10nm)' },
                            { label: 'Wheels', value: 'Simagic Neo X · Simagic GT Neo' },
                            { label: 'Pedals', value: 'Simagic P2000r hydraulic (ABS/TC haptics)' },
                            { label: 'Shifter', value: 'Simagic DS-8X (H-pattern & sequential)' },
                            { label: 'Handbrake', value: 'Simagic TB-RS hydraulic' },
                        ],
                    },
                    {
                        heading: 'COCKPIT',
                        subheading: 'The Cockpit',
                        items: [
                            { label: 'Frame', value: 'Next Level Racing GT Elite' },
                            { label: 'Seat', value: 'NLR PRS2 with motion platform' },
                        ],
                    },
                    {
                        heading: 'IMMERSION',
                        subheading: 'The Experience',
                        items: [
                            { label: 'Sound', value: '5.1 Surround Sound' },
                            { label: 'Haptics', value: 'Slip-angle 4-corner bass shakers' },
                        ],
                    },
                ],
            },
        ],
    },

    // ─── RIGS ────────────────────────────────────────────────────────────────
    {
        id: 'rigs',
        title: 'Full-Size Racing Rigs',
        subtitle: '3 Pro-Grade Builds',
        heroImage: '/images/equipment/Rigs/IMG_0505.webp',
        price: 40,
        priceUnit: 'per person / hour',
        description:
            'Pro-grade direct drive force feedback. Whether you\'re chasing lap times on iRacing or drifting through Tokyo in Assetto Corsa, these rigs deliver the authentic sensation sim racers live for.',
        route: '/equipment/rigs',
        hasInterchangeableWheels: true,
        wheelImages: rigWheelImages,
        wheelNames: rigWheelNames,
        galleryImages: [
            '/images/equipment/Rigs/White Rig - Left/IMG_7904.webp',
            '/images/equipment/Rigs/White Rig - Left/IMG_1258.webp',
            '/images/equipment/Rigs/White Rig - Left/IMG_1251.webp',
            '/images/equipment/Rigs/White Rig - Left/IMG_7863.webp',
            '/images/equipment/Rigs/White Rig - Left/IMG_7929.webp',
        ],
        variants: [
            {
                id: 'fanatec-l',
                label: 'Fanatec (L)',
                galleryImages: [
                    '/images/equipment/Rigs/White Rig - Left/IMG_7904.webp',
                    '/images/equipment/Rigs/White Rig - Left/IMG_1258.webp',
                    '/images/equipment/Rigs/White Rig - Left/IMG_1251.webp',
                    '/images/equipment/Rigs/White Rig - Left/IMG_7863.webp',
                    '/images/equipment/Rigs/White Rig - Left/IMG_7929.webp',
                ],
                keyFeatures: [
                    { stat: 'VR Ready', label: 'Bigscreen Beyond 2' },
                    { stat: '20nm', label: 'Force Feedback' },
                    { stat: '57" 4K', label: '240Hz Screen' },
                ],
                specGroups: [
                    {
                        heading: 'PC SPECS',
                        subheading: 'The Brain',
                        items: [
                            { label: 'GPU', value: 'Nvidia RTX 4070ti' },
                            { label: 'Display', value: 'Samsung 57" Odyssey Neo G9 240Hz 4K' },
                            { label: 'VR', value: 'Bigscreen Beyond 2 VR Headset' },
                        ],
                    },
                    {
                        heading: 'SIM HARDWARE',
                        subheading: 'The Control',
                        items: [
                            { label: 'Wheelbase', value: 'Fanatec Podium DD1 (20nm)' },
                            { label: 'Pedals', value: 'Heusinkveld Sprint' },
                            { label: 'Shifter', value: 'Heusinkveld Magshift (sequential)' },
                            { label: 'Handbrake', value: 'Heusinkveld' },
                        ],
                    },
                    {
                        heading: 'COCKPIT',
                        subheading: 'The Cockpit',
                        items: [
                            { label: 'Frame', value: 'Fanatec GT (white)' },
                            { label: 'Seat', value: 'Fanatec GT (white)' },
                        ],
                    },
                    {
                        heading: 'WHEELS',
                        subheading: 'Interchangeable',
                        items: [
                            { label: 'Compatible', value: 'Formula 2.5 · Porsche Vision GT · CSL GT3 · CSL P1 · F1 eSports v2' },
                        ],
                    },
                    {
                        heading: 'VR SPOTLIGHT',
                        subheading: 'Bigscreen Beyond 2',
                        items: [
                            { label: 'Display', value: 'Dual 2.5K Micro-OLED' },
                            { label: 'Weight', value: '127g (Ultra-Lightweight)' },
                            { label: 'Resolution', value: '5120 x 2560 (13.1MP)' },
                        ],
                    },
                ],
            },
            {
                id: 'fanatec-r',
                label: 'Fanatec (R)',
                galleryImages: [
                    '/images/equipment/Rigs/IMG_0505.webp',
                    '/images/equipment/Rigs/White Rig - Right/IMG_7943.webp',
                    '/images/equipment/Rigs/White Rig - Right/IMG_7907.webp',
                    '/images/equipment/Rigs/White Rig - Right/IMG_7873.webp',
                    '/images/equipment/Rigs/White Rig - Right/IMG_7869.webp',
                ],
                keyFeatures: [
                    { stat: '12nm', label: 'Force Feedback' },
                    { stat: '57" 4K', label: '240Hz Screen' },
                    { stat: 'RTX 4070ti', label: 'GPU' },
                ],
                specGroups: [
                    {
                        heading: 'PC SPECS',
                        subheading: 'The Brain',
                        items: [
                            { label: 'GPU', value: 'Nvidia RTX 4070ti' },
                            { label: 'Display', value: 'Samsung 57" Odyssey Neo G9 240Hz 4K' },
                        ],
                    },
                    {
                        heading: 'SIM HARDWARE',
                        subheading: 'The Control',
                        items: [
                            { label: 'Wheelbase', value: 'Fanatec Clubsport DD (12nm)' },
                            { label: 'Pedals', value: 'Fanatec Clubsport v3 Inverted' },
                            { label: 'Shifter', value: 'Fanatec Clubsport SQ 1.5 (H-pattern & sequential)' },
                            { label: 'Handbrake', value: 'Fanatec' },
                        ],
                    },
                    {
                        heading: 'COCKPIT',
                        subheading: 'The Cockpit',
                        items: [
                            { label: 'Frame', value: 'Fanatec GT (white)' },
                            { label: 'Seat', value: 'Fanatec GT (white)' },
                        ],
                    },
                    {
                        heading: 'WHEELS',
                        subheading: 'Interchangeable',
                        items: [
                            { label: 'Compatible', value: 'Formula 2.5 · Porsche Vision GT · CSL GT3 · CSL P1 · F1 eSports v2' },
                        ],
                    },
                ],
            },
            {
                id: 'trakrace',
                label: 'Trak Racer TR8 Pro',
                galleryImages: [
                    '/images/equipment/Rigs/Black Rig/IMG_7875.webp',
                    '/images/equipment/Rigs/Black Rig/IMG_7871.webp',
                    '/images/equipment/Rigs/Black Rig/IMG_7879.webp',
                    '/images/equipment/Rigs/Black Rig/IMG_7908.webp',
                ],
                keyFeatures: [
                    { stat: '12nm', label: 'Force Feedback' },
                    { stat: '49" 240Hz', label: 'Ultrawide' },
                    { stat: 'RTX 4080', label: 'GPU' },
                ],
                specGroups: [
                    {
                        heading: 'PC SPECS',
                        subheading: 'The Brain',
                        items: [
                            { label: 'GPU', value: 'Nvidia RTX 4080' },
                            { label: 'Display', value: 'Samsung 49" G9 240Hz' },
                        ],
                    },
                    {
                        heading: 'SIM HARDWARE',
                        subheading: 'The Control',
                        items: [
                            { label: 'Wheelbase', value: 'Fanatec Clubsport DD (12nm)' },
                            { label: 'Pedals', value: 'SimLab XP-1' },
                            { label: 'Shifter', value: 'SimLab SQ-1' },
                            { label: 'Handbrake', value: 'SimLab XB-1' },
                        ],
                    },
                    {
                        heading: 'COCKPIT',
                        subheading: 'The Cockpit',
                        items: [
                            { label: 'Frame', value: 'Trak Racer TR8 Pro' },
                            { label: 'Seat', value: 'O-Rouge Air Conditioned' },
                        ],
                    },
                    {
                        heading: 'WHEELS',
                        subheading: 'Interchangeable',
                        items: [
                            { label: 'Compatible', value: 'Formula 2.5 · Porsche Vision GT · CSL GT3 · CSL P1 · F1 eSports v2' },
                        ],
                    },
                ],
            },
        ],
    },

    // ─── FLIGHT ──────────────────────────────────────────────────────────────
    {
        id: 'flight',
        title: 'Flight Simulator',
        subtitle: 'Take to the Skies',
        heroImage: '/images/equipment/Flight/IMG_7886.webp',
        price: 40,
        priceUnit: 'per person / hour',
        description:
            "Slip into the cockpit of an F/A-18 Super Hornet. From dogfighting in Star Wars Squadrons to precision landings in DCS — the full HOTAS setup and Boeing-spec cockpit make every flight feel like a mission.",
        route: '/equipment/flight',
        hasInterchangeableWheels: false,
        galleryImages: [
            '/images/equipment/Flight/IMG_7891.webp',
            '/images/equipment/Flight/IMG_7886.webp',
            '/images/equipment/Flight/IMG_7884.webp',
            '/images/equipment/Flight/IMG_7890.webp',
            '/images/equipment/Flight/IMG_7892.webp',
        ],
        variants: [
            {
                id: 'flight-default',
                label: 'Flight',
                keyFeatures: [
                    { stat: 'HOTAS', label: 'Full Setup' },
                    { stat: '55"', label: 'ARK Display' },
                    { stat: 'Boeing', label: 'Spec Cockpit' },
                ],
                specGroups: [
                    {
                        heading: 'PC SPECS',
                        subheading: 'The Brain',
                        items: [
                            { label: 'GPU', value: 'Nvidia RTX 4060' },
                            { label: 'Display', value: 'Samsung 55" ARK' },
                        ],
                    },
                    {
                        heading: 'CONTROLS',
                        subheading: 'The Stick & Throttle',
                        items: [
                            { label: 'Flight Stick', value: 'F/A-18 Super Hornet' },
                            { label: 'Throttle', value: 'Thrustmaster Viper TQS Mission Pack' },
                            { label: 'Rudder', value: 'Thrustmaster Pendular Rudder' },
                        ],
                    },
                    {
                        heading: 'COCKPIT',
                        subheading: 'The Cockpit',
                        items: [
                            { label: 'Frame', value: 'NLR Boeing Flight Cockpit' },
                            { label: 'Seat', value: 'NLR Boeing Seat' },
                        ],
                    },
                    {
                        heading: 'EXPERIENCE',
                        subheading: 'The Feel',
                        items: [
                            { label: 'Best For', value: 'Star Wars Squadrons, DCS, Ace Combat 7' },
                            { label: 'Skill Level', value: 'All levels welcome' },
                        ],
                    },
                ],
            },
        ],
    },

    // ─── KARTS ───────────────────────────────────────────────────────────────
    {
        id: 'karts',
        title: 'Racing Karts',
        subtitle: `${station('karts').units} Units — Ages ${station('karts').ageLabel}`,
        heroImage: '/images/equipment/Karts/IMG_7899.webp',
        price: 30,
        priceUnit: 'per person / hour',
        description:
            'Built for kids, brilliant for everyone. Our kart cockpits put you low and close to the action — paddles at your fingertips, eyes locked on the screen. A gateway to sim racing the whole family can enjoy.',
        route: '/equipment/karts',
        hasInterchangeableWheels: false,
        wheelImages: [
            '/images/equipment/Wheels/IMG_7912.webp',
            '/images/equipment/Wheels/IMG_7915.webp',
            '/images/equipment/Wheels/IMG_7919.webp',
        ],
        wheelNames: [
            'Fanatec Formula 2.5',
            'Porsche Vision GT',
            'CSL GT3',
        ],
        galleryImages: [
            '/images/equipment/Karts/IMG_7901.webp',
            '/images/equipment/Karts/IMG_7898.webp',
            '/images/equipment/Karts/IMG_7895.webp',
            '/images/equipment/Wheels/IMG_7912.webp',
            '/images/equipment/Wheels/IMG_7913.webp',
        ],
        variants: [
            {
                id: 'karts-1-3',
                label: 'Karts 1–3',
                keyFeatures: [
                    { stat: '8nm', label: 'Force Feedback' },
                    { stat: '34"', label: 'Screen' },
                    { stat: 'Fanatec', label: 'CSL Setup' },
                ],
                specGroups: [
                    {
                        heading: 'PC SPECS',
                        subheading: 'The Brain',
                        items: [
                            { label: 'GPU', value: 'Nvidia RTX 4060' },
                            { label: 'Display', value: 'Samsung G5 34"' },
                        ],
                    },
                    {
                        heading: 'SIM HARDWARE',
                        subheading: 'The Control',
                        items: [
                            { label: 'Wheelbase', value: 'Fanatec CSL (8nm)' },
                            { label: 'Wheel', value: 'Fanatec CSL' },
                            { label: 'Pedals', value: 'Fanatec CSL' },
                            { label: 'Shifter', value: 'Paddles' },
                        ],
                    },
                    {
                        heading: 'COCKPIT',
                        subheading: 'The Cockpit',
                        items: [
                            { label: 'Frame', value: 'Next Level Racing Kart' },
                            { label: 'Seat', value: 'Kart-style seat' },
                        ],
                    },
                    {
                        heading: 'BEST FOR',
                        subheading: 'Who It Suits',
                        items: [
                            { label: 'Age', value: `Ages ${station('karts').ageLabel}` },
                            { label: 'Height', value: '4\'0" minimum' },
                            { label: 'Experience', value: 'All levels, beginner-friendly' },
                        ],
                    },
                ],
            },
            {
                id: 'karts-4-5',
                label: 'Karts 4–5',
                keyFeatures: [
                    { stat: 'Moza R5', label: 'Wheelbase' },
                    { stat: '34"', label: 'Screen' },
                    { stat: 'RTX 4060', label: 'GPU' },
                ],
                specGroups: [
                    {
                        heading: 'PC SPECS',
                        subheading: 'The Brain',
                        items: [
                            { label: 'GPU', value: 'Nvidia RTX 4060' },
                            { label: 'Display', value: 'Samsung G5 34"' },
                        ],
                    },
                    {
                        heading: 'SIM HARDWARE',
                        subheading: 'The Control',
                        items: [
                            { label: 'Wheelbase', value: 'Moza R5' },
                            { label: 'Wheel', value: 'Moza R5' },
                            { label: 'Pedals', value: 'Moza R5' },
                            { label: 'Shifter', value: 'Paddles' },
                        ],
                    },
                    {
                        heading: 'COCKPIT',
                        subheading: 'The Cockpit',
                        items: [
                            { label: 'Frame', value: 'Next Level Racing Kart' },
                            { label: 'Seat', value: 'Kart-style seat' },
                        ],
                    },
                    {
                        heading: 'BEST FOR',
                        subheading: 'Who It Suits',
                        items: [
                            { label: 'Age', value: `Ages ${station('karts').ageLabel}` },
                            { label: 'Height', value: '4\'0" minimum' },
                            { label: 'Experience', value: 'All levels, beginner-friendly' },
                        ],
                    },
                ],
            },
        ],
    },
];

export default equipmentData;
