export interface Event {
  id: string;
  title: string;
  description: string;
  free: boolean;
  price: string;
  dtstart: string;
  dtend: string;
  time: string;
  audience: string;
  "event-location": string;
  locality: string;
  "postal-code": string;
  "street-address": string;
  latitude: number | null;
  longitude: number | null;
  "organization-name": string;
  link: string;
  image: string | null;
  distrito: string;
  barrio: string;
  "excluded-days": string;
  distance: number;
  subway: string;
  subwayLines?: { number: number; color: string }[];
}

export interface ImageResponse {
  url: string;
  image: string;
}

export interface FilterState {
  today: boolean;
  thisWeek: boolean;
  thisWeekend: boolean;
  thisMonth: boolean;
  free: boolean;
  children: boolean;
}

export interface SortState {
  by: 'date' | 'distance' | null;
  order: 'asc' | 'desc';
}