import React, { useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import ReactLenis from 'lenis/react';

// Components
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import FloatingCallButton from './components/FloatingCallButton';
import ProtectedRoute from './components/ProtectedRoute';
// import Chatbot from './components/Chatbot'; // DISABLED - removed AI chatbot

// Pages
import Home from './pages/Home';
import About from './pages/About';
import Contact from './pages/Contact';
import PricingPage from './pages/PricingPage';
import EventsPage from './pages/EventsPage';
import EquipmentPage from './pages/EquipmentPage';
import EquipmentDetailPage from './pages/EquipmentDetailPage';
import FAQPage from './pages/FAQPage';
import BookingPage from './pages/BookingPage';
import PartyBookingPage from './pages/PartyBookingPage';
import CancelPage from './pages/CancelPage';
import GalleryPage from './pages/GalleryPage';
import RulesPage from './pages/RulesPage';
import ExperiencesPage from './pages/ExperiencesPage';
import WaiverPage from './pages/WaiverPage';
import MembershipPage from './pages/MembershipPage';
import SignUpPage from './pages/SignUpPage';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import DashboardPage from './pages/DashboardPage';
import DriverProfilePage from './pages/DriverProfilePage';
import CheckoutPage from './pages/CheckoutPage';
import LeaderboardPage from './pages/LeaderboardPage';
import { CompetitionsPage, CompetitionDetailPage } from './pages/CompetitionsPage';
import CheckoutSuccessPage from './pages/CheckoutSuccessPage';
import CheckoutCancelPage from './pages/CheckoutCancelPage';
import OnboardingPage from './pages/OnboardingPage';
import BeatTheProPage from './pages/BeatTheProPage';
import CampaignLandingPage from './pages/CampaignLandingPage';
import NotFound from './pages/NotFound';

// Context
import { AuthProvider } from './contexts/AuthContext';

// Register GSAP plugins
gsap.registerPlugin(ScrollTrigger);

// Scroll to top on route change
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const lenis = (window as any).__lenis;
    if (lenis) {
      lenis.scrollTo(0, { immediate: true });
    }
  }, [pathname]);
  return null;
};

const AppContent: React.FC = () => {
  const location = useLocation();
  const isCampaignPage = ['/mailer', '/august', '/email'].includes(location.pathname.toLowerCase());

  return (
    <div className="relative min-h-screen">
      {!isCampaignPage && <Navbar />}
      {!isCampaignPage && <FloatingCallButton />}
      {/* <Chatbot /> */}{/* DISABLED - AI chatbot removed */}

      {/* Main Content Wrapper */}
      <main className="relative z-10 w-full">
        <div className="min-h-screen">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/equipment" element={<EquipmentPage />} />
            <Route path="/equipment/:id" element={<EquipmentDetailPage />} />
            <Route path="/faq" element={<FAQPage />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/book" element={<BookingPage />} />
            <Route path="/book-party" element={<ProtectedRoute><PartyBookingPage /></ProtectedRoute>} />
            <Route path="/beat-the-pro" element={<ProtectedRoute><BeatTheProPage /></ProtectedRoute>} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/cancel" element={<CancelPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/experiences" element={<ExperiencesPage />} />
            <Route path="/waiver" element={<WaiverPage />} />
            <Route path="/membership" element={<MembershipPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/driver-profile" element={<DriverProfilePage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/competitions" element={<CompetitionsPage />} />
            <Route path="/competitions/:id" element={<CompetitionDetailPage />} />
            <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
            <Route path="/checkout" element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>} />
            <Route path="/checkout/success" element={<ProtectedRoute><CheckoutSuccessPage /></ProtectedRoute>} />
            <Route path="/checkout/cancel" element={<CheckoutCancelPage />} />
            
            {/* Campaign Promotion Landing Pages */}
            <Route path="/mailer" element={<CampaignLandingPage />} />
            <Route path="/august" element={<CampaignLandingPage />} />
            <Route path="/email" element={<CampaignLandingPage />} />

            {/* Custom 404 handler instead of homepage redirect */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </main>

      {!isCampaignPage && <Footer />}
    </div>
  );
};

const App: React.FC = () => {
  const lenisRef = useRef<any>(null);

  useEffect(() => {
    const initialRefresh = setTimeout(() => {
      ScrollTrigger.refresh();
    }, 100);

    const delayedRefresh = setTimeout(() => {
      ScrollTrigger.refresh();
    }, 1000);

    const handleLoad = () => {
      setTimeout(() => ScrollTrigger.refresh(), 100);
    };
    window.addEventListener('load', handleLoad);

    return () => {
      clearTimeout(initialRefresh);
      clearTimeout(delayedRefresh);
      window.removeEventListener('load', handleLoad);
    };
  }, []);

  useEffect(() => {
    if (lenisRef.current?.lenis) {
      (window as any).__lenis = lenisRef.current.lenis;
    }
  });

  return (
    <AuthProvider>
      <ReactLenis root ref={lenisRef} options={{ duration: 1.2, smoothWheel: true }}>
        <Router>
          <ScrollToTop />
          <AppContent />
        </Router>
      </ReactLenis>
    </AuthProvider>
  );
};

export default App;