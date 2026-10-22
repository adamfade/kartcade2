import React, { useEffect } from 'react';

// Kartcade homepage: the existing hero, then the "Broadcast" sections (design proposal A).
import Hero from '../components/Hero';
import Broadcast from '../components/home/Broadcast';
import { stations } from '../config/business';

const Home: React.FC = () => {
  useEffect(() => {
    document.title = "Kartcade | Racing & Flight Simulator Lounge | West Linn, Oregon";

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      const total = stations.reduce((n, s) => n + s.units, 0);
      metaDesc.setAttribute('content', `Oregon's first racing and flight simulator lounge. ${total} simulators, your whole group races at once. Birthday parties, corporate events, and walk-ins welcome. Book your session today!`);
    }

    return () => {
      document.title = "Kartcade | Racing & Flight Simulator Lounge";
    };
  }, []);

  return (
    <div className="relative bg-black">
      <Hero />
      <Broadcast />
    </div>
  );
};

export default Home;
