import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Calendar, Users, Trophy, Gift, Phone, ArrowRight, Cake, Building2, Gamepad2, ArrowUpRight } from 'lucide-react';
import siteConfig from '../config/site';

const eventPackages = [
    {
        icon: <Cake className="w-10 h-10" />,
        title: "Birthday Party Package",
        price: "Starting at $400 ($720 value)",
        features: [
            "2 hours of racing time",
            "Up to 40 guests (Unlimited racing)",
            "Extra hours $200 each",
            "Entire facility reservation",
            "Bring your own decorations and cake",
            "Staff assistance throughout"
        ],
        highlight: true,
        link: "/book-party",
        cta: "Book Your Party"
    },
    {
        icon: <Building2 className="w-10 h-10" />,
        title: "Corporate Team Building",
        price: "Custom Pricing",
        features: [
            "Custom time blocks (2-4 hours recommended)",
            "Flexible scheduling for your team",
            "Tournament organization with leaderboards",
            "Perfect for building camaraderie",
            "Friendly competition setup"
        ],
        highlight: false
    },
    {
        icon: <Trophy className="w-10 h-10" />,
        title: "Tournament Nights",
        price: "Contact for Details",
        features: [
            "Multi-race tournaments with brackets",
            "Custom game selection across our library",
            "Leaderboard tracking",
            "Trophy/prizes (you provide or we can arrange)",
            "Championship atmosphere"
        ],
        highlight: false
    }
];

const EventsPage: React.FC = () => {
    const heroRef = useRef<HTMLDivElement>(null);

    useGSAP(() => {
        gsap.fromTo(".event-hero-text",
            { y: 40, opacity: 0 },
            { y: 0, opacity: 1, duration: 0.8, stagger: 0.08, ease: "power3.out", delay: 0.2 }
        );

        gsap.fromTo(".event-card",
            { y: 80, opacity: 0 },
            {
                y: 0,
                opacity: 1,
                duration: 0.8,
                stagger: 0.15,
                ease: "power3.out",
                scrollTrigger: {
                    trigger: ".event-cards-container",
                    start: "top 80%"
                }
            }
        );
    }, { scope: heroRef });

    return (
        <div ref={heroRef} className="bg-[#0A0A0A] text-white min-h-screen">
            {/* Hero Section - Full Image */}
            <section className="relative h-[70vh] min-h-[500px] flex items-end overflow-hidden">
                {/* Background Image */}
                <div className="absolute inset-0">
                    <img
                        src="/images/kartcade/rigs.webp"
                        alt="Kartcade Events"
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/60 to-transparent" />
                    <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0A]/80 to-transparent" />
                </div>

                {/* Content */}
                <div className="relative z-10 max-w-6xl mx-auto px-6 md:px-12 pb-16 w-full">
                    <p className="event-hero-text text-[#2D9E49] text-sm font-medium tracking-[0.2em] uppercase mb-4">
                        Private Events
                    </p>
                    <h1 className="event-hero-text text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
                        Host Your<br />
                        <span className="text-[#D42428]">Event</span> Here
                    </h1>
                    <p className="event-hero-text text-lg md:text-xl text-white/70 max-w-md leading-relaxed">
                        Kartcade is the perfect venue for birthday parties, corporate team building, bachelor/bachelorette parties.
                        We can accommodate up to 40 people with our full fleet of 10 simulators.
                    </p>
                </div>
            </section>

            {/* Private Party Upsell Banner */}
            <section className="py-20 px-6 md:px-12">
                <div className="max-w-4xl mx-auto">
                    <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-[#D42428]/50 to-amber-500/50 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                        <div className="relative bg-[#0A0A0A] border border-[#D42428]/30 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden">
                            <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-[#D42428]/5 rounded-full blur-3xl"></div>

                            <div className="flex-1 text-center md:text-left z-10">
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D42428]/10 border border-[#D42428]/20 text-[#D42428] text-[10px] font-bold uppercase tracking-widest mb-3">
                                    <Gift className="w-3 h-3" /> Exclusive Event
                                </div>
                                <h3 className="font-display text-xl sm:text-2xl font-bold uppercase mb-2">
                                    Hosting a Large Group?
                                </h3>
                                <p className="text-white/60 text-sm sm:text-base">
                                    Rent the <span className="text-white font-bold">entire venue</span> for a private party! Premium racing, priority queue, and elite amenities.
                                </p>
                            </div>

                            <Link
                                to="/book-party"
                                className="group/btn relative inline-flex items-center gap-3 px-8 py-4 bg-white text-black rounded-full font-bold uppercase tracking-widest text-xs hover:bg-[#D42428] hover:text-white transition-all duration-300 z-10"
                            >
                                Book Private Party <ArrowUpRight className="w-4 h-4 group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform" />
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* Event Packages */}
            <section className="py-20 px-6 md:px-12 bg-[#0A0A0A]">
                <div className="max-w-6xl mx-auto event-cards-container">
                    <h2 className="text-3xl md:text-4xl font-bold mb-12">Event Packages</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {eventPackages.map((pkg, index) => (
                            <div
                                key={index}
                                className={`event-card p-8 rounded-2xl border transition-all duration-300 hover:scale-[1.02] ${pkg.highlight
                                    ? 'bg-gradient-to-b from-[#D42428]/20 to-transparent border-[#D42428]/50'
                                    : 'bg-[#141414] border-white/10 hover:border-[#2D9E49]/50'
                                    }`}
                            >
                                <div className={`mb-6 ${pkg.highlight ? 'text-[#D42428]' : 'text-[#2D9E49]'}`}>
                                    {pkg.icon}
                                </div>
                                <h3 className="text-2xl font-bold mb-2">{pkg.title}</h3>
                                <p className={`text-lg font-bold mb-6 ${pkg.highlight ? 'text-[#D42428]' : 'text-[#2D9E49]'}`}>
                                    {pkg.price}
                                </p>
                                <ul className="space-y-3 mb-8">
                                    {pkg.features.map((feature, i) => (
                                        <li key={i} className="flex items-start gap-3 text-white/60 text-sm">
                                            <span className={`w-1.5 h-1.5 rounded-full mt-2 ${pkg.highlight ? 'bg-[#D42428]' : 'bg-[#2D9E49]'}`}></span>
                                            {feature}
                                        </li>
                                    ))}
                                </ul>
                                <Link
                                    to={(pkg as any).link || "/contact"}
                                    className={`block text-center py-3 rounded-full font-bold uppercase tracking-widest text-sm transition-all ${pkg.highlight
                                        ? 'bg-[#D42428] text-white hover:bg-[#B91C1C]'
                                        : 'border border-white/20 text-white hover:bg-white/5'
                                        }`}
                                >
                                    {(pkg as any).cta || "Inquire Now"}
                                </Link>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* What's Included */}
            <section className="py-20 px-6 md:px-12">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-3xl md:text-4xl font-bold mb-12">What's Included</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {[
                            { icon: <Gamepad2 className="w-8 h-8" />, title: "Full Game Library", desc: "Access to all games across our library" },
                            { icon: <Users className="w-8 h-8" />, title: "Expert Staff", desc: "Staff to manage setup and troubleshooting" },
                            { icon: <Calendar className="w-8 h-8" />, title: "Private Space", desc: "Exclusive or semi-private space" },
                            { icon: <Gift className="w-8 h-8" />, title: "Refreshments", desc: "Snacks and cold beverages available" }
                        ].map((item, i) => (
                            <div key={i} className="p-6 border border-white/10 rounded-xl hover:border-[#2D9E49]/50 transition-colors">
                                <div className="text-[#2D9E49] mb-4">{item.icon}</div>
                                <h3 className="text-lg font-bold mb-2">{item.title}</h3>
                                <p className="text-white/60 text-sm">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Booking CTA */}
            <section className="py-20 px-6 md:px-12 bg-[#141414]">
                <div className="max-w-4xl mx-auto text-center">
                    <h2 className="text-4xl md:text-5xl font-bold mb-6">
                        Ready to Book?
                    </h2>
                    <p className="text-white/60 text-xl mb-12 max-w-2xl mx-auto">
                        Contact us at least 2 weeks in advance for private events.
                        Email info@kartcade.com to discuss your needs and customize your experience.
                    </p>

                    <div className="flex flex-col md:flex-row gap-6 justify-center">
                        <Link
                            to="/contact"
                            className="flex items-center justify-center gap-3 px-12 py-5 bg-[#D42428] text-white rounded-full font-bold uppercase tracking-widest hover:bg-[#B91C1C] transition-colors"
                        >
                            Email Us <ArrowRight className="w-5 h-5" />
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default EventsPage;
