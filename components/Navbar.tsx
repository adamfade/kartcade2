import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Menu, X, Phone, ArrowUpRight, Gift, User, LogOut, ChevronDown } from 'lucide-react';
import siteConfig from '../config/site';
import { useAuth } from '../contexts/AuthContext';

const Navbar: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, userProfile, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/');
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  // All pages dark themed for Kartcade
  const textColorClass = 'text-white';

  useGSAP(() => {
    ScrollTrigger.create({
      start: "top -50",
      onUpdate: (self) => {
        setIsScrolled(self.direction === 1 || self.scroll() > 50);
      }
    });
  });

  useGSAP(() => {
    if (isMenuOpen && menuRef.current) {
      const items = menuRef.current.querySelectorAll('.mobile-nav-item');
      const footer = menuRef.current.querySelector('.mobile-nav-footer');

      gsap.set(items, { y: 50, opacity: 0 });
      gsap.set(footer, { opacity: 0, y: 20 });

      gsap.to(items, {
        y: 0,
        opacity: 1,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
        delay: 0.2
      });

      gsap.to(footer, {
        y: 0,
        opacity: 1,
        duration: 0.8,
        ease: "power3.out",
        delay: 0.6
      });
    }
  }, [isMenuOpen]);

  useEffect(() => {
    if (navRef.current) {
      if (isMenuOpen) {
        gsap.to(navRef.current, {
          backgroundColor: "transparent",
          backdropFilter: "blur(0px)",
          borderBottom: "1px solid transparent",
          duration: 0.3
        });
        return;
      }

      if (isScrolled) {
        gsap.to(navRef.current, {
          backgroundColor: "rgba(10, 10, 10, 0.95)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          duration: 0.3
        });
      } else {
        gsap.to(navRef.current, {
          backgroundColor: "rgba(0, 0, 0, 0)",
          backdropFilter: "blur(0px)",
          borderBottom: "1px solid transparent",
          duration: 0.3
        });
      }
    }
  }, [isScrolled, location.pathname, isMenuOpen]);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileExperienceOpen, setMobileExperienceOpen] = useState(false);

  // Main nav links
  const mainLinks = [
    { name: 'Pricing', path: '/pricing' },
    { name: 'Events', path: '/events' },
    { name: 'Gallery', path: '/gallery' },
    { name: 'Competitions', path: '/competitions' },
    { name: 'Leaderboard', path: '/leaderboard' },
  ];

  // Dropdown links under "Experiences"
  const experienceLinks = [
    { name: 'Games', path: '/experiences' },
    { name: 'Equipment', path: '/equipment' },
    { name: 'About Us', path: '/about' },
  ];

  return (
    <>
      <nav ref={navRef} className="fixed top-0 left-0 w-full z-[200] transition-all duration-300 py-4 px-6 md:px-8 lg:px-12 flex items-center justify-between">
        {/* Logo */}
        <Link
          to="/"
          className="relative z-50 flex items-center gap-3"
          onClick={() => setIsMenuOpen(false)}
        >
          <img
            src="/logo.png"
            alt="Kartcade"
            className="h-8 w-auto md:h-10"
          />
        </Link>

        {/* Desktop Menu */}
        <div className="hidden lg:flex items-center gap-6 xl:gap-8">
          {/* Experiences Dropdown - First */}
          <div
            className="relative"
            onMouseEnter={() => setDropdownOpen(true)}
            onMouseLeave={() => setDropdownOpen(false)}
          >
            <button
              className={`font-sans text-xs uppercase tracking-widest transition-colors duration-300 flex items-center gap-1 ${textColorClass} hover:text-[#2D9E49]`}
            >
              Experiences
              <svg className={`w-3 h-3 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            <div className={`absolute top-full left-1/2 -translate-x-1/2 pt-4 transition-all duration-200 ${dropdownOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
              <div className="bg-[#141414] border border-white/10 rounded-xl py-2 min-w-[160px] shadow-xl">
                {experienceLinks.map((link) => (
                  <Link
                    key={link.name}
                    to={link.path}
                    className="block px-4 py-2 text-xs uppercase tracking-widest text-white/70 hover:text-[#2D9E49] hover:bg-white/5 transition-colors"
                  >
                    {link.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Main Links */}
          {mainLinks.map((link) => (
            <Link
              key={link.name}
              to={link.path}
              className={`font-sans text-xs uppercase tracking-widest transition-colors duration-300 relative group ${textColorClass} hover:text-[#2D9E49]`}
            >
              {link.name}
              <span className={`absolute -bottom-2 left-0 w-full h-[2px] bg-[#2D9E49] transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left ${location.pathname === link.path ? 'scale-x-100' : ''}`}></span>
            </Link>
          ))}
        </div>

        {/* CTA & Mobile Toggle */}
        <div className="flex items-center gap-3 z-50">
          {/* Auth - Desktop */}
          {currentUser ? (
            <div
              className="hidden md:block relative"
              onMouseEnter={() => setUserDropdownOpen(true)}
              onMouseLeave={() => setUserDropdownOpen(false)}
            >
              <button className="flex items-center gap-2 px-4 py-2 rounded-full font-sans text-xs uppercase tracking-widest font-medium transition-all duration-300 border border-white/20 text-white hover:border-white/40">
                <User className="w-3 h-3" />
                {userProfile?.name?.split(' ')[0] || 'Account'}
                <ChevronDown className={`w-3 h-3 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className={`absolute top-full right-0 pt-2 transition-all duration-200 ${userDropdownOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
                <div className="bg-[#141414] border border-white/10 rounded-xl py-2 min-w-[160px] shadow-xl">
                  <Link
                    to="/dashboard"
                    className="block px-4 py-2 text-xs uppercase tracking-widest text-white/70 hover:text-[#2D9E49] hover:bg-white/5 transition-colors"
                  >
                    Driver Profile
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-xs uppercase tracking-widest text-white/70 hover:text-[#D42428] hover:bg-white/5 transition-colors flex items-center gap-2"
                  >
                    <LogOut className="w-3 h-3" /> Sign Out
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <Link
              to="/login"
              className="hidden md:flex items-center gap-2 px-4 py-2 rounded-full font-sans text-xs uppercase tracking-widest font-medium transition-all duration-300 border border-white/20 text-white hover:border-white/40"
            >
              Sign In
            </Link>
          )}

          {/* Book Now - Desktop */}
          <Link
            to="/book"
            className="hidden md:flex items-center gap-2 px-5 py-2 rounded-full font-sans text-xs uppercase tracking-widest font-bold transition-all duration-300 bg-[#D42428] text-white hover:bg-[#B91C1C] hover:shadow-lg hover:shadow-[#D42428]/30"
          >
            Book Now <ArrowUpRight className="w-3 h-3" />
          </Link>

          <button onClick={toggleMenu} className={`lg:hidden focus:outline-none transition-colors duration-300 ${textColorClass}`}>
            {isMenuOpen ? <X className="w-8 h-8" /> : <Menu className="w-8 h-8" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      <div
        ref={menuRef}
        className={`fixed inset-0 h-[100dvh] bg-[#0A0A0A] z-[150] transform transition-transform duration-[0.8s] ease-[cubic-bezier(0.22,1,0.36,1)] lg:hidden ${isMenuOpen ? 'translate-y-0' : '-translate-y-full'}`}
      >
        <div className="h-full flex flex-col justify-between px-6 pb-8 pt-24">

          {/* Links */}
          <div className="flex flex-col overflow-y-auto max-h-[calc(100vh-280px)]">
            {/* Main Links */}
            {mainLinks.map((link, index) => (
              <Link
                key={link.name}
                to={link.path}
                onClick={toggleMenu}
                className="mobile-nav-item group flex items-baseline justify-between py-3 border-b border-white/10"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[10px] text-[#2D9E49]/60 group-hover:text-[#2D9E49] transition-colors">0{index + 1}</span>
                  <span className="font-display text-xl font-bold uppercase text-white group-hover:text-[#2D9E49] transition-colors leading-none">
                    {link.name}
                  </span>
                </div>
                <ArrowUpRight className="w-4 h-4 text-white/20 group-hover:text-[#2D9E49] transition-all" />
              </Link>
            ))}

            {/* Experience Accordion */}
            <div className="border-b border-white/10">
              <button
                onClick={() => setMobileExperienceOpen(!mobileExperienceOpen)}
                className="mobile-nav-item group flex items-baseline justify-between py-3 w-full"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[10px] text-[#2D9E49]/60">0{mainLinks.length + 1}</span>
                  <span className="font-display text-xl font-bold uppercase text-white leading-none">
                    Experiences
                  </span>
                </div>
                <svg
                  className={`w-4 h-4 text-[#2D9E49] transition-transform duration-300 ${mobileExperienceOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Experience Sub-links */}
              <div className={`overflow-hidden transition-all duration-300 ease-in-out ${mobileExperienceOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'}`}>
                <div className="pl-8 pb-2 space-y-1">
                  {experienceLinks.map((link) => (
                    <Link
                      key={link.name}
                      to={link.path}
                      onClick={toggleMenu}
                      className="group flex items-center justify-between py-2 pr-2"
                    >
                      <span className="font-sans text-sm text-white/70 group-hover:text-[#2D9E49] transition-colors">
                        {link.name}
                      </span>
                      <ArrowUpRight className="w-3 h-3 text-white/20 group-hover:text-[#2D9E49] transition-all" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer / Info */}
          <div className="mobile-nav-footer flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-widest text-white/40 mb-1">Contact</span>
                <a href={`mailto:${siteConfig.email}`} className="block text-white font-sans text-xs mb-1 hover:text-[#2D9E49] transition-colors truncate">{siteConfig.email}</a>
              </div>
              <div>
                <span className="block font-mono text-[9px] uppercase tracking-widest text-white/40 mb-1">Location</span>
                <span className="block text-white font-sans text-sm opacity-80 leading-tight">West Linn,<br />Oregon</span>
              </div>
            </div>

            <a
              href={siteConfig.giftCardsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={toggleMenu}
              className="w-full bg-[#2D9E49]/10 border border-[#2D9E49]/30 text-[#2D9E49] font-display uppercase font-bold text-center py-3 rounded-lg hover:bg-[#2D9E49] hover:text-white transition-colors tracking-widest text-xs mb-2 flex items-center justify-center gap-2"
            >
              <Gift className="w-4 h-4" /> Gift Cards
            </a>

            {/* Auth - Mobile */}
            {currentUser ? (
              <>
                <Link
                  to="/dashboard"
                  onClick={toggleMenu}
                  className="w-full bg-white/10 border border-white/20 text-white font-display uppercase font-bold text-center py-3 rounded-lg hover:bg-white/20 transition-colors tracking-widest text-xs mb-2 flex items-center justify-center gap-2"
                >
                  <User className="w-4 h-4" /> Driver Profile
                </Link>
                <button
                  onClick={() => { handleLogout(); toggleMenu(); }}
                  className="w-full border border-white/20 text-white/70 font-display uppercase font-bold text-center py-3 rounded-lg hover:bg-white/10 transition-colors tracking-widest text-xs mb-2 flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </>
            ) : (
              <Link
                to="/driver-profile"
                onClick={toggleMenu}
                className="w-full bg-white/10 border border-white/20 text-white font-display uppercase font-bold text-center py-3 rounded-lg hover:bg-white/20 transition-colors tracking-widest text-xs mb-2 flex items-center justify-center gap-2"
              >
                <User className="w-4 h-4" /> Driver Profile
              </Link>
            )}

            <Link
              to="/book"
              onClick={toggleMenu}
              className="w-full bg-[#D42428] text-white font-display uppercase font-bold text-center py-3 rounded-lg hover:bg-[#B91C1C] transition-colors tracking-widest text-xs"
            >
              Book Now
            </Link>
          </div>
        </div>
      </div >
    </>
  );
};

export default Navbar;