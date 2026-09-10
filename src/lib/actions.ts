// Alle server actions, samlet på ett sted slik importene i komponentene
// alltid har vært (`import { x } from "@/lib/actions"`). Selve koden
// ligger i actions/-mappen, delt opp etter domene — filen her var på
// 4 120 linjer og 129 actions.
//
// Ingen "use server" her: dette er en ren re-eksport. Direktivet står i
// hver enkelt modul, som er der Next knytter action-ID-ene.

export * from "./actions/calendar";
export * from "./actions/companies";
export * from "./actions/deals";
export * from "./actions/email";
export * from "./actions/estimates";
export * from "./actions/imports";
export * from "./actions/notifications";
export * from "./actions/people";
export * from "./actions/savedViews";
export * from "./actions/search";
export * from "./actions/settings";
export * from "./actions/users";
