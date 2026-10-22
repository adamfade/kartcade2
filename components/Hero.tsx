import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

const Hero: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useGSAP(() => {
    // 1. Initial Load Animation
    const tl = gsap.timeline();

    // Scale text down from 1.1 to 1 and Fade In stagger
    tl.fromTo(".hero-text-char",
      { y: 100, opacity: 0 },
      { y: 0, opacity: 1, duration: 1, stagger: 0.05, ease: "power3.out", delay: 0.5 }
    );

    tl.fromTo(textContainerRef.current,
      { scale: 1.1 },
      { scale: 1, duration: 1.5, ease: "power2.out" },
      "<"
    );

    // 2. Scroll Interaction (Blur & Fade)
    ScrollTrigger.create({
      trigger: containerRef.current,
      start: "top top",
      end: "bottom top",
      scrub: true,
      onUpdate: (self) => {
        if (videoRef.current) {
          gsap.set(videoRef.current, {
            filter: `blur(${self.progress * 15}px)`,
            scale: 1 + (self.progress * 0.1)
          });
        }
        if (textContainerRef.current) {
          gsap.set(textContainerRef.current, {
            opacity: 1 - self.progress * 1.5,
            y: -self.progress * 100
          });
        }
      }
    });

  }, { scope: containerRef });

  return (
    <div ref={containerRef} className="h-screen w-full sticky top-0 z-0 overflow-hidden bg-[#0A0A0A]">

      {/* Video Background */}
      <div className="absolute inset-0 w-full h-full">
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/hero-poster.jpg"
          className="w-full h-full object-cover opacity-50"
        >
          {/* Same footage: 1.7 MB phone cut, 3.5 MB desktop cut, both faststart */}
          <source src="/hero-mobile.mp4" type="video/mp4" media="(max-width: 767px)" />
          <source src="/hero.mp4" type="video/mp4" />
        </video>
        {/* Fallback image if video doesn't load */}
        {/* Fallback image removed as per user request to prioritize video */}
        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent" />
      </div>

      {/* Typography Content */}
      <div
        ref={textContainerRef}
        className="absolute inset-0 flex flex-col items-center justify-center z-20 px-4"
      >
        {/* Animated Logo */}
        <div className="hero-text-char">
          <img
            src="/logo.png"
            alt="Kartcade"
            className="w-64 sm:w-80 md:w-96 lg:w-[500px] h-auto drop-shadow-[0_0_50px_rgba(45,158,73,0.3)]"
          />
        </div>

        {/* Tagline */}
        <div className="mt-6 sm:mt-8 hero-text-char">
          <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-light tracking-[0.2em] sm:tracking-[0.3em] uppercase text-white/80">
            Race<span className="text-[#2D9E49]">.</span> Fly<span className="text-[#D42428]">.</span> Win<span className="text-white">.</span>
          </p>
        </div>

        <div className="mt-6 sm:mt-8 flex items-center gap-4 sm:gap-6 text-white/60 font-sans tracking-[0.15em] sm:tracking-[0.3em] text-xs sm:text-sm md:text-base uppercase hero-text-char">
          <span className="w-10 sm:w-16 h-[1px] bg-gradient-to-r from-transparent via-[#2D9E49] to-transparent"></span>
          <span className="text-center font-medium">Oregon's Premier Simulator Lounge</span>
          <span className="w-10 sm:w-16 h-[1px] bg-gradient-to-r from-transparent via-[#D42428] to-transparent"></span>
        </div>

        {/* Phones: book straight from the hero */}
        <Link
          to="/book"
          className="md:hidden mt-8 inline-flex items-center justify-center min-h-[52px] px-8 rounded-md bg-[#D42428] text-white font-bold text-base tracking-wide hero-text-char"
        >
          Book a rig
        </Link>

        {/* Stats Row */}
        <div className="mt-10 sm:mt-16 flex items-center gap-6 sm:gap-12 md:gap-16 hero-text-char">
          <div className="text-center">
            <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-white">10</div>
            <div className="text-[10px] sm:text-xs md:text-sm uppercase tracking-widest text-white/50 mt-1">Sims</div>
          </div>
          <div className="w-[1px] h-10 sm:h-14 bg-white/20"></div>
          <div className="text-center">
            <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-white">40+</div>
            <div className="text-[10px] sm:text-xs md:text-sm uppercase tracking-widest text-white/50 mt-1">Games</div>
          </div>
          <div className="w-[1px] h-10 sm:h-14 bg-white/20"></div>
          <div className="text-center">
            <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-white">1</div>
            <div className="text-[10px] sm:text-xs md:text-sm uppercase tracking-widest text-white/50 mt-1">Epic Time</div>
          </div>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-6 sm:bottom-10 left-1/2 transform -translate-x-1/2 z-20 flex flex-col items-center gap-2">
        <span className="text-[8px] sm:text-[10px] uppercase tracking-[0.3em] text-white/40">Scroll</span>
        <div className="w-[1px] h-6 sm:h-8 bg-gradient-to-b from-white/40 to-transparent animate-pulse"></div>
      </div>
    </div>
  );
};

export default Hero;