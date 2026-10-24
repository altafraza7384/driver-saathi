import { encodeGeohash, approxCoord } from "./geohash";

export type CarSosCategory = "tyre" | "mechanic" | "battery" | "other";
export type CarSosStatus =
  | "pending"
  | "accepted"
  | "onway"
  | "completed"
  | "cancelled";

export const CAR_SOS_CATEGORIES: CarSosCategory[] = [
  "tyre",
  "mechanic",
  "battery",
  "other",
];

export const ACTIVE_SOS_STATUSES: CarSosStatus[] = [
  "pending",
  "accepted",
  "onway",
];

export interface CarSosRequest {
  id: string;
  driverId: string;
  category: CarSosCategory;
  description: string | null;
  approxLat: number | null;
  approxLng: number | null;
  geohash: string | null;
  areaText: string | null;
  status: CarSosStatus;
  mechanicId: string | null;
  mechanicName: string | null;
  mechanicPhone: string | null;
  chargesAgreed: number | null;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sos-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// Split a precise GPS fix into the public (approximate) part and the
// private (exact) part. The public request doc never carries the exact
// location or the driver's phone number.
export function splitLocation(lat: number, lng: number) {
  return {
    approxLat: approxCoord(lat),
    approxLng: approxCoord(lng),
    // Precision 6 (~1.2 km x 0.6 km) matches the advertised ~1.1 km
    // rounding; precision 7 (~150 m) used to narrow the public doc far
    // beyond that claim (audit 2026-10-24).
    geohash: encodeGeohash(lat, lng, 6),
    exactLat: lat,
    exactLng: lng,
  };
}

export function isValidPhone(phone: string): boolean {
  // Same strict rule as insurance leads: 10 digits starting 6–9 after
  // stripping a +91/91 prefix. The old ">= 10 digits" check accepted
  // 12–15 digit strings and stored country codes (audit 2026-10-24).
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits);
}
