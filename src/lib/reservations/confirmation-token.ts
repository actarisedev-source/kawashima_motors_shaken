import { randomBytes } from "node:crypto";

export const reservationConfirmationTokenLength = 64;

export const createReservationConfirmationToken = () =>
  randomBytes(32).toString("hex");

export const isReservationConfirmationToken = (value: string) =>
  new RegExp(`^[a-f0-9]{${reservationConfirmationTokenLength}}$`).test(value);
