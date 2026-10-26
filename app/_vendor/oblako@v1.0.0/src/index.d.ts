// Типы для игр на TypeScript (Тетколор и др.). Источник истины — oblako.js.
export interface Hranilische { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export function nastroit(chto: Partial<{ adres: string; taimautMs: number; taimautZapisiMs: number; hranilische: Hranilische; fetch: typeof fetch }>): void;
export function igrokId(): string;
export function getZavodskie<T extends Record<string, unknown>>(igra: string, vstroennye?: T): Promise<T & Record<string, unknown>>;
export function getZavodskie<T extends Record<string, unknown>>(igra: string, vstroennye: T, opts: { podrobno: true }): Promise<{ nastroyki: T & Record<string, unknown>; istochnik: 'oblako' | 'vstroennye'; obnovleno: string; prichina: string }>;
export function saveOblako(igra: string, dannye: unknown, versiya?: number): Promise<boolean>;
export function loadOblako(igra: string): Promise<{ dannye: unknown; versiya: number; obnovleno: string } | null>;
export function rekord(igra: string, zapis: { ochki: number; rezhim?: string; imya?: string }): Promise<boolean>;
export function rekordy(igra: string, opts?: { rezhim?: string; skolko?: number }): Promise<Array<{ imya: string; ochki: number; rezhim: string; kogda: string }>>;
export function voitiVladeltsem(klyuch: string): Promise<{ ok: boolean; prichina: string }>;
export function vladeletsVoshel(): boolean;
export function vyitiVladeltsu(): void;
export function prodlitVhod(): Promise<boolean>;
export function sdelatZavodskim(igra: string, klyuch: string, znachenie: unknown): Promise<{ ok: boolean; prichina: string }>;
