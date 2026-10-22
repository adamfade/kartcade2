import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Check, ArrowRight, Gift, Users, Clock, Phone } from 'lucide-react';
import siteConfig from '../config/site';
import business, { station, minPrice, maxPrice } from '../config/business';

const PricingPage: React.FC = () => {
    const heroRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        document.title = "Pricing | Kartcade Racing Simulator Lounge";
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.setAttribute('content', `Kartcade pricing: $${minPrice}-${maxPrice}/hour. Birthday party packages from $${business.party.basePrice}. Book your racing simulator session today.`);
        }
    }, []);

    useGSAP(() => {
        gsap.fromTo(".pricing-hero-text",
            { y: 60, opacity: 0 },
            { y: 0, opacity: 1, duration: 1, stagger: 0.1, ease: "power3.out", delay: 0.3 }
        );
    }, { scope: heroRef });

    const sessionPricing = [
        {
            title: "Racing Karts",
            subtitle: `Ages ${station('karts').ageLabel} (Kids & Teens)`,
            price: `$${station('karts').price}`,
            period: "/hour",
            features: [
                "Dedicated racing karts",
                "Intermediate speed",
                "Beginner-friendly games",
                "Staff supervision",
                "Fun for all skill levels"
            ],
            color: "#2D9E49",
            popular: false
        },
        {
            title: "Full Sim Rig",
            subtitle: `Direct Drive (Ages ${station('rigs').ageLabel})`,
            price: `$${station('rigs').price}`,
            period: "/hour",
            features: [
                "Professional direct-drive wheels",
                "High-fidelity pedals",
                "Full game library access",
                "Race against friends",
                "Staff assistance & setup"
            ],
            color: "#FFFFFF",
            popular: true
        },
        {
            title: "Motion Simulator",
            subtitle: `Full Motion (Ages ${station('motion').ageLabel})`,
            price: `$${station('motion').price}`,
            period: "/hour",
            features: [
                "Full motion platform",
                "Triple screen immersion",
                "Ultimate racing realism",
                "Advanced force feedback",
                "Pro-level experience"
            ],
            color: "#D42428",
            popular: false
        },
        {
            title: "Flight Simulator",
            subtitle: `HOTAS Setup (${station('flight').ageLabel})`,
            price: `$${station('flight').price}`,
            period: "/hour",
            features: [
                "Detailed flight controls",
                "Wide ultrawide monitor",
                "Space & Atmo flight sims",
                "Immersive experience",
                "Beginner to Pro"
            ],
            color: "#2D9E49",
            popular: false
        }
    ];

    const eventPackages = [
        {
            title: "Birthday Party",
            price: `From $${business.party.basePrice}`,
            description: `${business.party.minHours} hours, up to ${business.party.maxGuests} guests (Unlimited racing). Extra hours $${business.party.extraHourPrice} each.`,
            features: ["Entire facility reservation", "Bring your own cake & decorations", "Staff assistance"]
        },
        {
            title: "Corporate Events",
            price: "Custom",
            description: "Team building with tournaments & leaderboards",
            features: ["Flexible time blocks", "Tournament organization", "Custom setup"]
        },
        {
            title: "Tournament Night",
            price: "Contact Us",
            description: "Host your own championship",
            features: ["Bracket racing", "Leaderboard tracking", "Trophy ceremonies"]
        }
    ];

    return (
        <div ref={heroRef} className="bg-[#0A0A0A] text-white min-h-screen">
            {/* Hero Section - Full Image */}
            <section className="relative h-[60vh] min-h-[450px] flex items-end overflow-hidden">
                {/* Background Image */}
                <div className="absolute inset-0">
                    <img
                        src="/images/kartcade/karts.webp"
                        alt="Kartcade Pricing"
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/70 to-[#0A0A0A]/30" />
                    <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0A]/80 to-transparent" />
                </div>

                {/* Content */}
                <div className="relative z-10 max-w-6xl mx-auto px-6 md:px-12 pb-16 w-full">
                    <p className="pricing-hero-text text-[#2D9E49] text-sm font-medium tracking-[0.2em] uppercase mb-4">
                        Transparent Pricing
                    </p>
                    <h1 className="pricing-hero-text text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
                        Pay Per<br />
                        <span className="text-[#D42428]">Person</span>
                    </h1>
                    <p className="pricing-hero-text text-lg md:text-xl text-white/70 max-w-md leading-relaxed">
                        Everyone races simultaneously—no taking turns.
                        Pricing is per person per hour.
                    </p>
                </div>
            </section>

            {/* Session Pricing Cards */}
            <section className="py-16 px-6 md:px-12">
                <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {sessionPricing.map((plan, index) => (
                        <div
                            key={index}
                            className={`relative p-6 rounded-2xl border transition-all duration-300 hover:scale-[1.02] flex flex-col h-full ${plan.popular
                                ? 'bg-gradient-to-b from-[#D42428]/20 to-[#141414] border-[#D42428]/50'
                                : 'bg-[#141414] border-white/10 hover:border-[#2D9E49]/50'
                                }`}
                        >
                            {plan.popular && (
                                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                                    <span className="bg-[#D42428] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full whitespace-nowrap">
                                        Most Popular
                                    </span>
                                </div>
                            )}

                            <div className="mb-4">
                                <h3 className="font-display text-xl font-bold uppercase truncate" title={plan.title}>{plan.title}</h3>
                                <p className="text-white/50 text-xs">{plan.subtitle}</p>
                            </div>

                            <div className="flex items-baseline gap-1 mb-6">
                                <span className="font-display text-4xl font-bold" style={{ color: plan.color }}>{plan.price}</span>
                                <span className="text-white/40 text-sm">{plan.period}</span>
                            </div>

                            <ul className="space-y-3 mb-8 flex-grow">
                                {plan.features.map((feature, i) => (
                                    <li key={i} className="flex items-start gap-2 text-white/70 text-xs">
                                        <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: plan.color }} />
                                        <span className="leading-tight">{feature}</span>
                                    </li>
                                ))}
                            </ul>

                            <div className="grid grid-cols-1 gap-3 mt-auto">
                                <Link
                                    to="/book"
                                    className="block text-center py-3 rounded-xl font-bold uppercase tracking-widest text-xs transition-all hover:brightness-110"
                                    style={{
                                        backgroundColor: plan.color,
                                        color: plan.color === '#FFFFFF' ? 'black' : 'white'
                                    }}
                                >
                                    Book Now
                                </Link>
                                <Link
                                    to="/equipment"
                                    className="block text-center py-3 rounded-xl font-bold uppercase tracking-widest text-xs transition-all border border-white/10 hover:bg-white/5 text-white/60 hover:text-white"
                                >
                                    View Equipment
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Sharing Policy Disclaimer */}
                <div className="max-w-4xl mx-auto mt-16 p-8 bg-[#141414] border border-white/10 rounded-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-[#2D9E49]"></div>
                    <div className="relative z-10 flex flex-col md:flex-row gap-6 items-start md:items-center">
                        <div className="p-3 bg-white/5 rounded-full text-[#2D9E49]">
                            <Users className="w-8 h-8" />
                        </div>
                        <div>
                            <h3 className="font-display text-xl font-bold uppercase mb-2">Machine Sharing Policy</h3>
                            <p className="text-white/70 leading-relaxed text-sm md:text-base">
                                If you book multiple rigs, you and a friend are able to freely trade machines back and forth to sample the different components,
                                but <strong>all drivers must have a paid entry and driver profile</strong>.
                                Spectators are welcome to watch, but may only drive if they have a paid entry and driver profile.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* What's Included */}
            <section className="py-16 px-6 md:px-12 bg-[#141414]">
                <div className="max-w-4xl mx-auto">
                    <h2 className="font-display text-3xl font-bold uppercase text-center mb-12">What's Included</h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {[
                            { icon: <Clock className="w-8 h-8" />, title: "Full Hour", desc: "No rushing—enjoy your full session time" },
                            { icon: <Users className="w-8 h-8" />, title: "Race Together", desc: "Everyone in your group gets a rig" },
                            { icon: <Gift className="w-8 h-8" />, title: "40+ Games", desc: "Access to our entire game library" }
                        ].map((item, i) => (
                            <div key={i} className="text-center p-6">
                                <div className="text-[#2D9E49] mb-4 flex justify-center">{item.icon}</div>
                                <h3 className="font-display text-lg font-bold uppercase mb-2">{item.title}</h3>
                                <p className="text-white/50 text-sm">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Event Packages */}
            <section className="py-20 px-6 md:px-12">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-12">
                        <span className="text-[#2D9E49] text-xs font-bold uppercase tracking-widest">Private Events</span>
                        <h2 className="font-display text-4xl font-bold uppercase mt-2">Group Packages</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {eventPackages.map((pkg, index) => (
                            <div key={index} className="p-8 bg-[#141414] border border-white/10 rounded-2xl hover:border-[#2D9E49]/50 transition-colors">
                                <h3 className="font-display text-xl font-bold uppercase mb-2">{pkg.title}</h3>
                                <p className="text-[#D42428] font-bold text-2xl mb-4">{pkg.price}</p>
                                <p className="text-white/50 text-sm mb-6">{pkg.description}</p>
                                <ul className="space-y-2">
                                    {pkg.features.map((f, i) => (
                                        <li key={i} className="flex items-center gap-2 text-white/60 text-sm">
                                            <span className="w-1.5 h-1.5 rounded-full bg-[#2D9E49]"></span>
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    <div className="text-center mt-12">
                        <Link
                            to="/events"
                            className="inline-flex items-center gap-2 text-[#2D9E49] hover:underline"
                        >
                            Learn more about events <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>
            </section>

            {/* Gift Cards CTA */}
            <section className="py-16 px-6 md:px-12 bg-[#141414]">
                <div className="max-w-4xl mx-auto text-center">
                    <Gift className="w-12 h-12 text-[#2D9E49] mx-auto mb-6" />
                    <h2 className="font-display text-3xl font-bold uppercase mb-4">Gift Cards Available</h2>
                    <p className="text-white/60 mb-8">Perfect for racing fans, gamers, and thrill seekers!</p>
                    <a
                        href={siteConfig.giftCardsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-3 px-10 py-5 bg-[#2D9E49] text-white rounded-full font-bold uppercase tracking-widest hover:bg-[#248C3E] transition-colors"
                    >
                        <Gift className="w-5 h-5" /> Purchase Gift Card
                    </a>
                </div>
            </section>

            {/* CTA */}
            <section className="py-20 px-6 md:px-12">
                <div className="max-w-4xl mx-auto text-center">
                    <h2 className="font-display text-4xl md:text-5xl font-bold uppercase mb-6">
                        Ready to <span className="text-[#D42428]">Race?</span>
                    </h2>
                    <p className="text-white/60 text-xl mb-12">Book your session online to check availability</p>

                    <div className="flex flex-col md:flex-row gap-6 justify-center">
                        <Link
                            to="/book"
                            className="flex items-center justify-center gap-3 px-12 py-5 bg-[#D42428] text-white rounded-full font-bold uppercase tracking-widest hover:bg-[#B91C1C] transition-colors"
                        >
                            Book Now <ArrowRight className="w-5 h-5" />
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default PricingPage;
