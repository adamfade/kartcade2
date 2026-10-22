// Typed access to config/business.json, the one place hours, ages and prices live.
import data from './business.json';

export type StationId = 'karts' | 'rigs' | 'motion' | 'flight';
export interface Station {
    id: StationId; name: string; shortName: string; price: number; units: number;
    minAge: number; ageLabel: string; blurb: string;
}

export const business = data as typeof data & { stations: Station[] };
export const stations: Station[] = business.stations as Station[];
export const station = (id: StationId) => stations.find((s) => s.id === id)!;

/** Opening hours by weekday (0 = Sunday): [open, close) in 24h, or null when closed. */
export const hoursByDay: Record<number, [number, number] | null> = Object.fromEntries(
    Object.entries(business.hours).map(([d, h]) => [Number(d), h as [number, number] | null])
);
const open = Object.values(hoursByDay).filter(Boolean) as [number, number][];
export const earliestOpen = Math.min(...open.map((h) => h[0]));
export const latestClose = Math.max(...open.map((h) => h[1]));

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const formatHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? 'pm' : 'am'}`;
export const hoursLabel = (day: number) => {
    const h = hoursByDay[day];
    return h ? `${formatHour(h[0])} to ${formatHour(h[1])}` : 'Closed';
};
/** Monday-first rows for an hours table. */
export const weekRows = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ day: d, name: DAY_NAMES[d], label: hoursLabel(d), closed: !hoursByDay[d] }));

export const minPrice = Math.min(...stations.map((s) => s.price));
export const maxPrice = Math.max(...stations.map((s) => s.price));
export const partyPrice = (hours: number) =>
    business.party.basePrice + Math.max(0, hours - business.party.minHours) * business.party.extraHourPrice;
export const fullAddress = `${business.address.street}, ${business.address.city}, ${business.address.region} ${business.address.postalCode}`;

export default business;
