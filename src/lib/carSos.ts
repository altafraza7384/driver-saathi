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
    geohash: encodeGeohash(lat, lng, 7),
    exactLat: lat,
    exactLng: lng,
  };
}

export function isValidPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 10;
}
