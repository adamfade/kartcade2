import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ChevronDown, Phone, Mail, ArrowRight } from 'lucide-react';
import siteConfig from '../config/site';

const faqCategories = [
    {
        name: "General",
        questions: [
            {
                q: "What is Kartcade?",
                a: "Kartcade is Oregon's first racing simulator lounge, offering 9 racing simulators and 1 flight simulator with an incredible variety of games. Unlike traditional sim racing centers, we celebrate all types of driving experiences from hardcore simulation to arcade fun."
            },
            {
                q: "Do I need racing experience?",
                a: "Not at all! We welcome everyone from complete beginners to experienced sim racers. Our staff will help you choose games that match your skill level, and many games have assist features to make driving easier."
            },
            {
                q: "What should I wear?",
                a: "Wear comfortable clothing and CLEAN closed-toe shoes with flat soles. Racing shoes aren't necessary, but avoid flip-flops, high heels, or anything that might slip off the pedals."
            },
            {
                q: "Can I walk in, or do I need to book?",
                a: "Both! We accept walk-ins based on availability, but we strongly recommend booking ahead, especially for weekends, evenings, and groups. Book online at kartcade.com/book to check real-time availability."
            }
        ]
    },
    {
        name: "Age & Size Requirements",
        questions: [
            {
                q: "What's the minimum age?",
                a: "We recommend ages 8 and up for the racing karts, and ages 10+ for the full-size rigs. The motion simulator is recommended for ages 12+ due to intensity. All minors must be accompanied by a parent or guardian."
            },
            {
                q: "Is there a height requirement?",
                a: "For the racing karts: minimum 4'0\". For full-size rigs: minimum 4'8\". Maximum: about 6'6\" and 300 lbs for comfort."
            },
            {
                q: "Can younger kids try it?",
                a: "If your child is 6 or older and enthusiastic about racing, yes! We can sometimes accommodate younger kids on the karts depending on their size and maturity. It's case-by-case."
            }
        ]
    },
    {
        name: "Gameplay Questions",
        questions: [
            {
                q: "How many games do you have?",
                a: "Our library includes many games, like Le Mans Ultimate, Dirt Rally 2.0, Grid Legends, CarX Drift Online, Wreckfest, Deathsprint 66, BeamNG, American Truck Simulator, Star Wars Squadrons, and more. We're constantly adding new titles based on customer requests."
            },
            {
                q: "Can I play games not on your list?",
                a: "Maybe! We take requests seriously and can often add games if they work with our equipment. Configuration may require some time, so if you give us enough notice, we can have it ready for you when you arrive."
            },
            {
                q: "Do you have multiplayer racing?",
                a: "Absolutely! Most of our games support multiplayer, so you can race directly against your friends or other customers, or race online against the public."
            },
            {
                q: "How realistic are the simulators?",
                a: "It depends on the game! Titles like Assetto Corsa, Le Mans Ultimate and Dirt Rally 2.0 are incredibly realistic with professional-grade physics. Games like Wreckfest and Grid Legends are more arcade-style but still use realistic steering and control. We have options across the full spectrum. The motion simulator adds a level of immersion that makes you feel like you're in the car!"
            }
        ]
    },
    {
        name: "Amenities",
        questions: [
            {
                q: "Do you serve food and drinks?",
                a: "Currently, we have light snacks, a water cooler with ice, and a drink cooler with sodas and energy drinks for sale. We're expanding into the space next door to add a full bar and restaurant in the coming months!"
            },
            {
                q: "Can I bring my own food?",
                a: "Yes! Feel free to bring snacks, cake for parties, or outside food. Just clean up after yourself, and keep the food and drinks away from the machines."
            },
            {
                q: "Is there parking?",
                a: "Yes, we have plenty of parking during the day and evening."
            },
            {
                q: "Do you have WiFi?",
                a: "Yes, free WiFi is available for all guests."
            }
        ]
    },
    {
        name: "Pricing & Booking",
        questions: [
            {
                q: "How does pricing work?",
                a: "Pricing is per person, not per simulator. This means everyone in your group gets their own rig to race simultaneously—no taking turns! Rates start at $30/hour on the racing karts and $40/hour on the full sim rigs."
            },
            {
                q: "What's included in my session?",
                a: "Your session includes simulator access, our full game library, staff assistance with game selection and setup, and basic support during your racing time."
            },
            {
                q: "Can I extend my session if I'm having fun?",
                a: "If simulators are available, absolutely! Just check with staff and we'll add time to your session."
            },
            {
                q: "Do you offer gift cards?",
                a: "Yes! Gift cards are available online and make perfect gifts for racing fans, gamers, and thrill seekers."
            }
        ]
    }
];

const FAQPage: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [activeCategory, setActiveCategory] = useState(0);
    const [openQuestion, setOpenQuestion] = useState<string | null>(null);

    useGSAP(() => {
        gsap.fromTo(".faq-hero-text",
            { y: 60, opacity: 0 },
            { y: 0, opacity: 1, duration: 1, stagger: 0.1, ease: "power3.out", delay: 0.3 }
        );
    }, { scope: containerRef });

    return (
        <div ref={containerRef} className="bg-[#0A0A0A] text-white min-h-screen">
            {/* Hero Section */}
            <section className="relative pt-32 pb-16 px-6 md:px-12 overflow-hidden">
                <div className="max-w-6xl mx-auto relative z-10">
                    <span className="faq-hero-text block text-[#2D9E49] text-xs font-bold uppercase tracking-widest mb-4">
                        Got Questions?
                    </span>
                    <h1 className="faq-hero-text font-display text-5xl md:text-7xl lg:text-8xl font-bold uppercase leading-none mb-8">
                        Frequently<br />
                        <span className="text-[#D42428]">Asked</span>
                    </h1>
                </div>
            </section>

            {/* FAQ Content */}
            <section className="py-12 px-6 md:px-12">
                <div className="max-w-6xl mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">
                        {/* Category Tabs */}
                        <div className="lg:col-span-1">
                            <div className="sticky top-24 space-y-2">
                                {faqCategories.map((cat, index) => (
                                    <button
                                        key={index}
                                        onClick={() => setActiveCategory(index)}
                                        className={`w-full text-left px-4 py-3 rounded-lg transition-all text-sm font-medium ${activeCategory === index
                                                ? 'bg-[#2D9E49] text-white'
                                                : 'text-white/60 hover:text-white hover:bg-white/5'
                                            }`}
                                    >
                                        {cat.name}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Questions */}
                        <div className="lg:col-span-3">
                            <h2 className="font-display text-2xl font-bold uppercase mb-8 text-[#2D9E49]">
                                {faqCategories[activeCategory].name}
                            </h2>

                            <div className="space-y-4">
                                {faqCategories[activeCategory].questions.map((item, index) => (
                                    <div
                                        key={index}
                                        className="border border-white/10 rounded-xl overflow-hidden"
                                    >
                                        <button
                                            onClick={() => setOpenQuestion(openQuestion === item.q ? null : item.q)}
                                            className="w-full flex items-center justify-between p-6 text-left hover:bg-white/5 transition-colors"
                                        >
                                            <span className="font-medium text-lg pr-4">{item.q}</span>
                                            <ChevronDown
                                                className={`w-5 h-5 flex-shrink-0 transition-transform ${openQuestion === item.q ? 'rotate-180 text-[#2D9E49]' : 'text-white/40'
                                                    }`}
                                            />
                                        </button>
                                        {openQuestion === item.q && (
                                            <div className="px-6 pb-6">
                                                <p className="text-white/60 leading-relaxed">{item.a}</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Still Have Questions CTA */}
            <section className="py-20 px-6 md:px-12 bg-[#141414]">
                <div className="max-w-4xl mx-auto text-center">
                    <h2 className="font-display text-3xl md:text-4xl font-bold uppercase mb-6">
                        Still Have Questions?
                    </h2>
                    <p className="text-white/60 text-lg mb-10">
                        We're here to help! Send us an email or message anytime.
                    </p>

                    <div className="flex flex-col md:flex-row gap-6 justify-center">
                        <a
                            href={`mailto:${siteConfig.email}`}
                            className="flex items-center justify-center gap-3 px-10 py-5 bg-[#D42428] text-white rounded-full font-bold uppercase tracking-widest hover:bg-[#B91C1C] transition-colors"
                        >
                            <Mail className="w-5 h-5" /> Email Us
                        </a>
                        <Link
                            to="/contact"
                            className="flex items-center justify-center gap-3 px-10 py-5 border border-white/20 text-white rounded-full font-bold uppercase tracking-widest hover:bg-white/5 transition-colors"
                        >
                            Contact Us <ArrowRight className="w-5 h-5" />
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default FAQPage;
