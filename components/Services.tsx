import React, { useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { station } from '../config/business';

const simulators = [
  {
    id: "01",
    title: "Racing Karts",
    subtitle: "5 Units Available",
    description: "Designed for younger drivers and anyone under about 6'3\". Comfortable seating positions and adjusted controls make them perfect for kids, teens, and beginners who want the full racing experience.",
    bestFor: `Ages ${station('karts').ageLabel}, teens, smaller adults, beginners`,
    image: "/images/kartcade/karts.webp"
  },
  {
    id: "02",
    title: "Full-Size Rigs",
    subtitle: "4 Units Available",
    description: "Professional-quality racing simulators with direct-drive force feedback wheels, load cell pedals, and comfortable racing seats. Handle everything from gentle cruising to white-knuckle racing.",
    bestFor: "Adults, serious sim racers, full force feedback",
    image: "/images/kartcade/rigs.webp"
  },
  {
    id: "03",
    title: "Motion Simulator",
    subtitle: "1 Unit - The Crown Jewel",
    description: "Three screens wrap around you for incredible immersion, plus a motion platform that physically moves with the action. Feel every bump, drift, and collision as the simulator pitches, rolls, and vibrates.",
    bestFor: `Ages ${station('motion').ageLabel}, ultimate experience, special occasions`,
    image: "/images/kartcade/motion_home.webp"
  },
  {
    id: "04",
    title: "Flight Simulator",
    subtitle: "1 Unit - Take to the Skies",
    description: "Not everything needs wheels! Full HOTAS (hands-on throttle and stick) setup for aerial combat and space flight. Perfect for a change of pace or anyone who loves dogfighting in Star Wars Squadrons.",
    bestFor: "Star Wars fans, flight enthusiasts, variety seekers",
    image: "/images/kartcade/flight_home.webp"
  }
];

const Services: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useGSAP(() => {
    const mm = gsap.matchMedia();

    mm.add("(min-width: 768px)", () => {
      ScrollTrigger.create({
        trigger: containerRef.current,
        start: "top top",
        end: "bottom bottom",
        pin: leftColRef.current,
        pinSpacing: false,
      });
    });

    const items = gsap.utils.toArray('.service-item');
    items.forEach((item: any, i) => {
      ScrollTrigger.create({
        trigger: item,
        start: "top center",
        end: "bottom center",
        onEnter: () => setActiveIndex(i),
        onEnterBack: () => setActiveIndex(i),
      });
    });

  }, { scope: containerRef });

  return (
    <section ref={containerRef} className="relative w-full bg-white text-black z-10 flex flex-col md:flex-row">

      {/* Left Column - Image (Sticky) */}
      <div ref={leftColRef} className="w-full md:w-1/2 h-[40vh] md:h-screen sticky top-0 md:relative overflow-hidden bg-[#0A0A0A] z-0">
        {simulators.map((sim, index) => (
          <div
            key={sim.id}
            className={`absolute inset-0 w-full h-full transition-opacity duration-1000 ease-in-out ${index === activeIndex ? 'opacity-100' : 'opacity-0'}`}
          >
            <img
              src={sim.image}
              alt={sim.title}
              className="w-full h-full object-cover opacity-70"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

            {/* Image overlay content */}
            <div className="absolute bottom-8 left-8 right-8">
              <div className="inline-block px-4 py-2 bg-[#2D9E49] rounded-full mb-4">
                <span className="text-white text-xs font-bold uppercase tracking-wider">{sim.subtitle}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Right Column - Scrolling Text */}
      <div ref={rightColRef} className="w-full md:w-1/2 min-h-screen py-12 md:py-[20vh] bg-white relative z-10">
        {/* Section Header */}
        <div className="px-6 md:px-10 lg:px-20 mb-12">
          <span className="text-[#D42428] text-xs font-bold uppercase tracking-widest">Our Equipment</span>
          <h2 className="font-display text-3xl md:text-4xl font-bold uppercase mt-2">10 Simulators Ready</h2>
        </div>

        <div className="px-6 md:px-10 lg:px-20 flex flex-col gap-16 md:gap-[30vh]">
          {simulators.map((sim, index) => (
            <div
              key={sim.id}
              className={`service-item flex flex-col gap-6 transition-all duration-500 ${index === activeIndex ? 'opacity-100 blur-0' : 'opacity-20 blur-sm'}`}
            >
              <div className="flex items-start gap-4 md:gap-6">
                <span className="font-display font-medium text-lg text-[#2D9E49] pt-1 md:pt-2">{sim.id}</span>
                <div className="relative pl-6 border-l-2 border-[#2D9E49]/30">
                  <div
                    className="absolute left-[-2px] top-0 w-[2px] bg-[#2D9E49] transition-all duration-700 ease-out"
                    style={{ height: index === activeIndex ? '100%' : '0%' }}
                  ></div>
                  <h3 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold uppercase leading-none break-words hyphens-auto">
                    {sim.title}
                  </h3>
                </div>
              </div>
              <p className="font-sans text-lg md:text-xl text-black/60 max-w-md ml-12 leading-relaxed">
                {sim.description}
              </p>
              <div className="ml-12 mt-2">
                <span className="text-xs uppercase tracking-widest text-black/40">Best For:</span>
                <p className="text-sm text-[#D42428] font-medium mt-1">{sim.bestFor}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Services;