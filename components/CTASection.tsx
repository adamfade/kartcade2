import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Phone, Gift } from 'lucide-react';
import siteConfig from '../config/site';
import { minPrice, maxPrice } from '../config/business';

const CTASection: React.FC = () => {
  return (
    <section className="relative py-16 sm:py-24 md:py-32 bg-[#0A0A0A] text-white overflow-hidden">

      {/* Background racing stripes decoration */}
      <div className="absolute inset-0 overflow-hidden opacity-10">
        <div className="absolute top-0 left-1/4 w-32 h-full bg-gradient-to-b from-[#2D9E49] to-transparent transform -skew-x-12"></div>
        <div className="absolute top-0 left-1/3 w-16 h-full bg-gradient-to-b from-white to-transparent transform -skew-x-12"></div>
        <div className="absolute top-0 left-[40%] w-32 h-full bg-gradient-to-b from-[#D42428] to-transparent transform -skew-x-12"></div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 md:px-12 relative z-10 flex flex-col items-center text-center">
        <span className="font-mono text-[#2D9E49] tracking-widest uppercase text-xs sm:text-sm mb-4 sm:mb-6">
          West Linn, Oregon
        </span>

        <h2 className="font-display text-4xl sm:text-5xl md:text-8xl font-bold uppercase leading-none mb-6 sm:mb-12">
          Ready to<br />
          <span className="text-[#D42428]">Race?</span>
        </h2>

        <p className="font-sans text-base sm:text-xl text-white/60 max-w-2xl mb-8 sm:mb-16 leading-relaxed px-2">
          Book your session today and experience Oregon's premier racing simulator lounge.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 w-full sm:w-auto px-4 sm:px-0">
          <Link
            to="/book"
            className="group relative bg-[#D42428] text-white px-8 sm:px-12 py-4 sm:py-6 rounded-full font-display uppercase tracking-widest font-bold text-sm sm:text-base overflow-hidden transition-all hover:scale-105 hover:shadow-lg hover:shadow-[#D42428]/30 text-center"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              Book Now <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform" />
            </span>
          </Link>

          <a
            href={siteConfig.giftCardsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 sm:px-12 py-4 sm:py-6 rounded-full border border-[#2D9E49]/30 text-[#2D9E49] font-display uppercase tracking-widest font-bold text-sm sm:text-base hover:bg-[#2D9E49]/10 transition-colors flex items-center justify-center gap-2"
          >
            <Gift className="w-4 h-4 sm:w-5 sm:h-5" /> Gift Cards
          </a>
        </div>

        {/* Quick Info */}
        <div className="mt-12 sm:mt-20 flex flex-wrap justify-center gap-6 sm:gap-8 md:gap-16 text-center">
          <div>
            <div className="text-xl sm:text-3xl font-bold text-white">${minPrice}-{maxPrice}</div>
            <div className="text-[10px] sm:text-xs uppercase tracking-widest text-white/40 mt-1">per hour</div>
          </div>
          <div className="w-[1px] h-10 sm:h-12 bg-white/20 hidden sm:block"></div>
          <div>
            <div className="text-xl sm:text-3xl font-bold text-white">10</div>
            <div className="text-[10px] sm:text-xs uppercase tracking-widest text-white/40 mt-1">simulators</div>
          </div>
          <div className="w-[1px] h-10 sm:h-12 bg-white/20 hidden sm:block"></div>
          <div>
            <div className="text-xl sm:text-3xl font-bold text-white">Walk-ins</div>
            <div className="text-[10px] sm:text-xs uppercase tracking-widest text-white/40 mt-1">welcome</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;